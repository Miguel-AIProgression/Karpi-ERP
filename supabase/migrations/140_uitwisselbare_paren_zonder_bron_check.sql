-- Migration 140: uitwisselbare_paren() — bron-check verwijderen
--
-- Diagnose: na migratie 139 gaf `uitwisselbaarheid_map1_diff` 154 rijen i.p.v.
-- de verwachte 0. Oorzaak zat niet in de data maar in de functie zelf.
--
-- De versie in migratie 138 joinde target-kwaliteiten alleen wanneer er voor
-- (target_kw, target_kl) een rij bestaat in `producten ∪ rollen ∪
-- maatwerk_m2_prijzen`. De gedachte was "een paar moet ergens echt bestaan".
-- Maar: pure aliassen zoals SOPI/SOPV worden in de praktijk vaak NIET als
-- product of rol opgevoerd — voorraad staat onder de "primaire" naam (CISC of
-- VELV) en pas bij output (sticker na snijden, of stickerwissel bij vaste
-- maten) wordt de alias-naam toegekend. De aliassing-relatie staat dus los
-- van of er voorraad onder die naam bestaat.
--
-- Een caller die specifiek "rollen voor deze (kw, kl)" wil, joint na deze
-- functie zelf met `rollen` — dan filtert hij vanzelf de aliassen weg waar
-- niets onder ligt. Maar de RELATIE moet symmetrisch en compleet blijven.
--
-- Aanpassing: bron-check valt weg. Tegelijk simplificeert het returntype:
-- `target_kleur_code` is voortaan altijd de genormaliseerde vorm (zonder
-- trailing ".0"). Callers die joinen op `rollen.kleur_code` etc. moeten zelf
-- `normaliseer_kleur_code()` aan hun side gebruiken — dat is consistent met
-- hoe de rest van het schema kleur-codes ziet (één canonieke vorm).

CREATE OR REPLACE FUNCTION uitwisselbare_paren(
  p_kwaliteit_code TEXT,
  p_kleur_code     TEXT
) RETURNS TABLE (
  target_kwaliteit_code TEXT,
  target_kleur_code     TEXT,  -- ALTIJD genormaliseerd (".0"-suffix gestript)
  is_zelf               BOOLEAN
)
LANGUAGE sql STABLE AS $$
  WITH coll AS (
    SELECT collectie_id
    FROM kwaliteiten
    WHERE code = p_kwaliteit_code
      AND collectie_id IS NOT NULL
  )
  -- Alle kwaliteiten in dezelfde collectie als input → kandidaat-aliassen.
  -- De target-kleur is per definitie de genormaliseerde input-kleur (de
  -- aliassing-regel werkt op identieke kleur-nummers, niet op cross-color).
  SELECT
    k.code                                AS target_kwaliteit_code,
    normaliseer_kleur_code(p_kleur_code)  AS target_kleur_code,
    (k.code = p_kwaliteit_code)           AS is_zelf
  FROM coll c
  JOIN kwaliteiten k ON k.collectie_id = c.collectie_id

  UNION

  -- Self-row als vangnet: input verschijnt altijd minstens één keer, ook
  -- wanneer de kwaliteit geen collectie_id heeft. Callers die "alleen
  -- partners" willen filteren op `WHERE NOT is_zelf`.
  SELECT
    p_kwaliteit_code,
    normaliseer_kleur_code(p_kleur_code),
    true;
$$;

COMMENT ON FUNCTION uitwisselbare_paren(TEXT, TEXT) IS
  'Canonieke uitwisselbaarheid (zie data-woordenboek). Resolver: zelfde '
  'collectie_id én genormaliseerde kleur-code. target_kleur_code is altijd '
  'genormaliseerd; callers normaliseren hun join-side. Bron-van-waarheid voor '
  'snijplanning, order-aanmaak en voorraad-aggregatie.';

-- ---------------------------------------------------------------------------
-- Diff-check view bijwerken voor de nieuwe signatuur
-- ---------------------------------------------------------------------------
-- target_kleur_code in de output is nu altijd genormaliseerd, dus de
-- caller-side normalisatie aan de m.target_kl-zijde volstaat. De "target
-- bestaat nergens"-reden vervalt (geen bron-check meer in de functie).

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
      SELECT 1 FROM kwaliteiten WHERE code = m.input_kw AND collectie_id IS NOT NULL
    ) THEN 'input-kwaliteit zonder collectie_id'
    WHEN NOT EXISTS (
      SELECT 1 FROM kwaliteiten WHERE code = m.target_kw AND collectie_id IS NOT NULL
    ) THEN 'target-kwaliteit zonder collectie_id'
    WHEN NOT EXISTS (
      SELECT 1 FROM kwaliteiten k1
      JOIN kwaliteiten k2 ON k1.collectie_id = k2.collectie_id
      WHERE k1.code = m.input_kw AND k2.code = m.target_kw
    ) THEN 'kwaliteiten in andere collecties'
    WHEN normaliseer_kleur_code(m.input_kl) <> normaliseer_kleur_code(m.target_kl)
      THEN 'kleur-codes niet gelijk na normalisatie'
    ELSE 'onbekende reden — onderzoeken'
  END AS reden
FROM map1_paren m
WHERE NOT EXISTS (
  SELECT 1 FROM uitwisselbare_paren(m.input_kw, m.input_kl) up
  WHERE up.target_kwaliteit_code = m.target_kw
    AND up.target_kleur_code     = normaliseer_kleur_code(m.target_kl)
);
