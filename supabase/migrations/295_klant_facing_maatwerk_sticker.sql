-- Migratie 295: fundament voor de klant-facing maatwerk-sticker
--
-- Vervangt de pre-bestaande interne sticker met QR + afwerking door een
-- pixel-getrouwe klant-facing branding-sticker (148×106 mm) zoals
-- vastgelegd in data-woordenboek "Klant-facing maatwerk-sticker" en
-- "Sticker-EAN-bron".
--
-- Operator-info (vorm, afwerking, klant, ordernr, scancode) verdwijnt
-- van de sticker en loopt voortaan via de werkbon/scanstation-scherm.
-- Sticker bevat alleen wat de eindafnemer ziet: logo + kwaliteit +
-- poolmateriaal + kleur + afmeting + EAN-13.
--
-- Drie wijzigingen:
--   1. Kolom `kwaliteiten.poolmateriaal` (TEXT, NULL toegestaan) — wordt
--      handmatig gevuld per kwaliteit door Karpi (Piet-Hein).
--   2. SQL-helper `sticker_ean_voor_kw_kl(kw, kl)` — resolutie-keten
--      MAATWERK-pseudo → rol-artikel-EAN. Single source of truth voor
--      welke barcode op de sticker komt.
--   3. View `snijplan_sticker_data` — alle velden die de sticker nodig
--      heeft, in 1 row per snijplan. Bewust een aparte view en NIET een
--      uitbreiding van `snijplanning_overzicht` (44 kolommen, breed
--      gebruikt — uitbreiding = onnodig risico).
--
-- Geen aanpassingen aan:
--   - snijplanning_overzicht-view (operator-flow ongewijzigd)
--   - reststuk-sticker en rol-sticker (out-of-scope per grilling-sessie)
--   - producten.ean_code (al gevuld via brondata-import)

BEGIN;

------------------------------------------------------------------------
-- 1. kwaliteiten.poolmateriaal — bron-van-waarheid voor sticker-veld
------------------------------------------------------------------------

ALTER TABLE kwaliteiten
  ADD COLUMN IF NOT EXISTS poolmateriaal TEXT;

COMMENT ON COLUMN kwaliteiten.poolmateriaal IS
  'Tekstuele samenstelling van het pool-materiaal, bv. "100% Polypropyleen" '
  'of "60% Wol 40% Nylon". Verschijnt op de klant-facing maatwerk-sticker '
  'onder "Poolmateriaal :". Per kwaliteit één waarde — kleur-variatie heeft '
  'geen invloed. NULL = niet getoond op sticker. Handmatig gevuld door '
  'Karpi-eigenaar via /instellingen/kwaliteiten of import.';

------------------------------------------------------------------------
-- 2. sticker_ean_voor_kw_kl — EAN-resolutie-keten voor de sticker
------------------------------------------------------------------------
-- Resolutie-volgorde:
--   (a) `producten.ean_code` van een `*MAATWERK`-pseudo-product voor
--       deze (kw, kl), bv. LUXR68MAATWERK → 8715954264751
--   (b) fallback: eerste rol-/breed-artikel van deze (kw, kl) met
--       ean_code IS NOT NULL — Karpi's brondata-import (stap 4) heeft
--       523 MAATWERK-EAN's al gemerged naar BREED-rij, dus voor 474
--       (kw, kl)-paren zit de EAN op het rol-artikel zoals LORA13400JUT.
--
-- Kleur-normalisatie via `normaliseer_kleur_code()` (mig 138) — strip
-- trailing `.0` en spaties, consistent met uitwisselbare_paren-keten.
--
-- STABLE — geen side-effects, output puur functie van input.

CREATE OR REPLACE FUNCTION sticker_ean_voor_kw_kl(
  p_kwaliteit_code TEXT,
  p_kleur_code     TEXT
) RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  WITH maatwerk_match AS (
    SELECT p.ean_code, p.artikelnr
    FROM producten p
    WHERE p.kwaliteit_code = p_kwaliteit_code
      AND normaliseer_kleur_code(p.kleur_code) = normaliseer_kleur_code(p_kleur_code)
      AND p.karpi_code LIKE '%MAATWERK'
      AND p.ean_code IS NOT NULL
      AND p.ean_code <> ''
    ORDER BY p.artikelnr
    LIMIT 1
  ),
  rol_match AS (
    SELECT p.ean_code, p.artikelnr
    FROM producten p
    WHERE p.kwaliteit_code = p_kwaliteit_code
      AND normaliseer_kleur_code(p.kleur_code) = normaliseer_kleur_code(p_kleur_code)
      AND p.ean_code IS NOT NULL
      AND p.ean_code <> ''
    ORDER BY p.artikelnr
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT ean_code FROM maatwerk_match),
    (SELECT ean_code FROM rol_match)
  );
$$;

COMMENT ON FUNCTION sticker_ean_voor_kw_kl(TEXT, TEXT) IS
  'Mig 295: resolutie-keten voor de EAN-13 op de klant-facing '
  'maatwerk-sticker. Eerst MAATWERK-pseudo-product (bv. LUXR68MAATWERK), '
  'fallback rol-/BREED-artikel met EAN (bv. LORA13400JUT). Single source '
  'of truth — alle sticker-render-callers gaan hierdoor.';

------------------------------------------------------------------------
-- 3. snijplan_sticker_data — alle velden voor 1 sticker-render in 1 row
------------------------------------------------------------------------
-- Aparte view (NIET snijplanning_overzicht uitbreiden) — laagste-risico-pad:
-- die view heeft 44 vaste kolom-posities en wordt gelezen door packer,
-- scanstation, rol-uitvoer en operator-pagina's. Een sticker-data-view is
-- semantisch een ander concern.
--
-- (kwaliteit, kleur)-resolutie volgt hetzelfde patroon als
-- snijplanning_overzicht (mig 290): order_regel.maatwerk_* leidend,
-- fallback naar rol, dan product. Display-naam via resolve_klanteigen_naam
-- (mig 199, 200) zodat Room108 "CHIQUE" ziet ipv canoniek "LUXURY".

CREATE OR REPLACE VIEW snijplan_sticker_data AS
WITH base AS (
  SELECT
    sp.id          AS snijplan_id,
    sp.snijplan_nr,
    sp.scancode,
    sp.status,
    o.id           AS order_id,
    o.order_nr,
    o.debiteur_nr,
    d.naam         AS klant_naam,
    oreg.id        AS order_regel_id,
    oreg.maatwerk_lengte_cm  AS bestelde_lengte_cm,
    oreg.maatwerk_breedte_cm AS bestelde_breedte_cm,
    sp.lengte_cm   AS snij_lengte_cm,
    sp.breedte_cm  AS snij_breedte_cm,
    -- (kw, kl)-fallback identiek aan snijplanning_overzicht col 24/25
    COALESCE(oreg.maatwerk_kwaliteit_code, r.kwaliteit_code, p.kwaliteit_code) AS kwaliteit_code,
    COALESCE(oreg.maatwerk_kleur_code,     r.kleur_code,     p.kleur_code)     AS kleur_code
  FROM snijplannen sp
  JOIN order_regels oreg ON oreg.id = sp.order_regel_id
  JOIN orders o          ON o.id    = oreg.order_id
  JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
  LEFT JOIN producten p  ON p.artikelnr   = oreg.artikelnr
  LEFT JOIN rollen r     ON r.id          = sp.rol_id
)
SELECT
  b.snijplan_id,
  b.snijplan_nr,
  b.scancode,
  b.status,
  b.order_id,
  b.order_nr,
  b.order_regel_id,
  b.debiteur_nr,
  b.klant_naam,
  b.kwaliteit_code,
  b.kleur_code,
  -- Bestelde maat (klant-perspectief), met fallback naar snij-maat
  -- voor edge-cases waar maatwerk_* nog NULL is.
  COALESCE(b.bestelde_lengte_cm,  b.snij_lengte_cm)  AS lengte_cm,
  COALESCE(b.bestelde_breedte_cm, b.snij_breedte_cm) AS breedte_cm,
  -- Klanteigen kwaliteits-naam → fallback canonieke kwaliteits-omschrijving
  COALESCE(
    resolve_klanteigen_naam(b.debiteur_nr, b.kwaliteit_code, b.kleur_code),
    k.omschrijving,
    b.kwaliteit_code
  ) AS kwaliteit_naam,
  k.poolmateriaal,
  sticker_ean_voor_kw_kl(b.kwaliteit_code, b.kleur_code) AS ean_code
FROM base b
LEFT JOIN kwaliteiten k ON k.code = b.kwaliteit_code;

COMMENT ON VIEW snijplan_sticker_data IS
  'Mig 295: alle velden voor de klant-facing maatwerk-sticker in 1 row. '
  'Bron-van-waarheid voor wat op de sticker komt. Sticker render-call '
  'leest hieruit; geen verspreide product/kwaliteit/klanteigen lookups in '
  'de frontend. Aparte view om snijplanning_overzicht (operator-flow, 44 '
  'kolommen, brede consumers) niet aan te raken.';

COMMIT;

NOTIFY pgrst, 'reload schema';
