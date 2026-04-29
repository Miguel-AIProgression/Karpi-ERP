-- Migration 138: uitwisselbare_paren() — canonieke seam voor uitwisselbaarheid
--
-- Vervangt de versplinterde uitwissel-logica die nu op vier plekken parallel
-- leeft met afwijkende semantiek:
--   * `_shared/db-helpers.ts` (fetchUitwisselbarePairs + fetchUitwisselbareCodes
--     fallback-cascade in de snijplanning-edges)
--   * `snijplanning_tekort_analyse()` (Map1 → collectie → self CTE-keten)
--   * `kleuren_voor_kwaliteit()` (alléén Map1, géén collectie-fallback)
--   * `op-maat.ts` `fetchMaatwerkArtikelNr` / `fetchStandaardBandKleur` (Map1)
--
-- Bron-van-waarheid wordt `kwaliteiten.collectie_id` + matchende kleur-code
-- (na normalisatie via `normaliseer_kleur_code()`). Dat is dezelfde regel die
-- de Producten → "Uitwisselbaar"-tab in de UI al gebruikt: 56 collecties met
-- 170 leden, kleuren met hetzelfde nummer worden automatisch gekoppeld.
--
-- De legacy tabel `kwaliteit_kleur_uitwisselgroepen` (Map1, geïmporteerd uit
-- Map1.xlsx) is een parallel spoor dat hierdoor afgeschaft kan worden. De
-- diagnostische view `uitwisselbaarheid_map1_diff` toont welke Map1-paren
-- NIET door de nieuwe regel gedekt zijn — die moeten eerst gerepareerd worden
-- (door collectie-membership uit te breiden via de UI) voordat Map1 fysiek
-- gedropt mag worden in een latere migratie.
--
-- Dit ontwerp behandelt rollen en producten gelijk: voor rollen is de
-- aliassing puur identiteit (sticker komt pas na snijden, zie
-- `data-woordenboek.md` → Aliassing-lagen). Voor vaste-maat producten kost
-- uitwisseling een sticker-wissel — die afweging blijft in de UI-laag, niet
-- in deze functie.

-- ---------------------------------------------------------------------------
-- 1. Canonieke functie: uitwisselbare_paren(kw, kl)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION uitwisselbare_paren(
  p_kwaliteit_code TEXT,
  p_kleur_code     TEXT
) RETURNS TABLE (
  target_kwaliteit_code TEXT,
  target_kleur_code     TEXT,
  is_zelf               BOOLEAN
)
LANGUAGE sql STABLE AS $$
  WITH coll AS (
    SELECT collectie_id
    FROM kwaliteiten
    WHERE code = p_kwaliteit_code
      AND collectie_id IS NOT NULL
  ),
  bronnen AS (
    -- (kw, kl)-paren die ergens in het systeem bestaan: producten ∪ rollen
    -- ∪ maatwerk_m2_prijzen. Drie bronnen omdat een paar kan bestaan zonder
    -- product (bv. alleen rollen-voorraad) of zonder rollen (bv. alleen
    -- prijslijn). Een caller die specifiek rollen of producten wil filtert
    -- daarna zelf op zijn eigen tabel.
    SELECT k.code AS kw, src.kl AS kl
    FROM coll c
    JOIN kwaliteiten k ON k.collectie_id = c.collectie_id
    CROSS JOIN LATERAL (
      SELECT p.kleur_code AS kl FROM producten p
        WHERE p.kwaliteit_code = k.code AND p.kleur_code IS NOT NULL
      UNION
      SELECT r.kleur_code FROM rollen r
        WHERE r.kwaliteit_code = k.code AND r.kleur_code IS NOT NULL
      UNION
      SELECT mp.kleur_code FROM maatwerk_m2_prijzen mp
        WHERE mp.kwaliteit_code = k.code AND mp.kleur_code IS NOT NULL
    ) src
    WHERE normaliseer_kleur_code(src.kl) = normaliseer_kleur_code(p_kleur_code)
  )
  SELECT DISTINCT
    kw AS target_kwaliteit_code,
    kl AS target_kleur_code,
    (kw = p_kwaliteit_code) AS is_zelf
  FROM bronnen
  UNION
  -- Self-row als vangnet: input-paar verschijnt altijd minstens één keer,
  -- ook wanneer de kwaliteit geen collectie_id heeft of de bron-tabellen
  -- nog leeg zijn voor dat (kw, kl). Callers die "alleen partners" willen
  -- filteren op `WHERE NOT is_zelf`.
  SELECT p_kwaliteit_code, p_kleur_code, true;
$$;

COMMENT ON FUNCTION uitwisselbare_paren(TEXT, TEXT) IS
  'Canonieke uitwisselbaarheid (zie data-woordenboek). Resolver: zelfde '
  'collectie_id én genormaliseerde kleur-code matcht. Bron-van-waarheid voor '
  'snijplanning, order-aanmaak en voorraad-aggregatie. Vervangt de eerdere '
  'Map1-tabel `kwaliteit_kleur_uitwisselgroepen`.';

-- ---------------------------------------------------------------------------
-- 2. Diagnostische view: welke Map1-paren dekt de nieuwe regel niet?
-- ---------------------------------------------------------------------------
--
-- Resultaat van `SELECT * FROM uitwisselbaarheid_map1_diff` moet leeg zijn
-- voordat `kwaliteit_kleur_uitwisselgroepen` (Map1) gedropt mag worden.
-- Voor elke niet-gedekt rij geeft de `reden`-kolom aan waarom de regel mist;
-- de meeste gevallen zullen oplosbaar zijn door `collectie_id` aan een
-- kwaliteit toe te voegen via de UI Producten → Uitwisselbaar.

CREATE OR REPLACE VIEW uitwisselbaarheid_map1_diff AS
WITH map1_paren AS (
  SELECT
    g1.kwaliteit_code AS input_kw,
    g1.kleur_code     AS input_kl,
    g2.kwaliteit_code AS target_kw,
    g2.kleur_code     AS target_kl,
    g1.basis_code,
    g1.variant_nr
  FROM kwaliteit_kleur_uitwisselgroepen g1
  JOIN kwaliteit_kleur_uitwisselgroepen g2
    ON g1.basis_code = g2.basis_code
   AND g1.variant_nr = g2.variant_nr
   AND (g1.kwaliteit_code, g1.kleur_code) <> (g2.kwaliteit_code, g2.kleur_code)
)
SELECT
  m.input_kw,
  m.input_kl,
  m.target_kw,
  m.target_kl,
  m.basis_code,
  m.variant_nr,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM kwaliteiten
      WHERE code = m.input_kw AND collectie_id IS NOT NULL
    ) THEN 'input-kwaliteit zonder collectie_id'
    WHEN NOT EXISTS (
      SELECT 1 FROM kwaliteiten
      WHERE code = m.target_kw AND collectie_id IS NOT NULL
    ) THEN 'target-kwaliteit zonder collectie_id'
    WHEN NOT EXISTS (
      SELECT 1 FROM kwaliteiten k1
      JOIN kwaliteiten k2 ON k1.collectie_id = k2.collectie_id
      WHERE k1.code = m.input_kw AND k2.code = m.target_kw
    ) THEN 'kwaliteiten in andere collecties'
    WHEN normaliseer_kleur_code(m.input_kl) <> normaliseer_kleur_code(m.target_kl)
      THEN 'kleur-codes niet gelijk na normalisatie'
    ELSE 'target (kw,kl) bestaat nergens in producten/rollen/maatwerk_m2_prijzen'
  END AS reden
FROM map1_paren m
WHERE NOT EXISTS (
  SELECT 1 FROM uitwisselbare_paren(m.input_kw, m.input_kl) up
  WHERE up.target_kwaliteit_code = m.target_kw
    AND normaliseer_kleur_code(up.target_kleur_code) = normaliseer_kleur_code(m.target_kl)
);

COMMENT ON VIEW uitwisselbaarheid_map1_diff IS
  'Diagnostiek: Map1-paren die NIET door uitwisselbare_paren() afgedekt worden. '
  'Moet 0 rijen geven voordat kwaliteit_kleur_uitwisselgroepen kan worden '
  'gedropt. Reden-kolom wijst naar de fix (meestal: collectie_id toevoegen).';
