-- Migratie 303: Tapijt-stickers ook bij standaard-artikelen (per-klant opt-in)
--
-- Achtergrond: maatwerk-orders krijgen sinds mig 295 een klant-facing
-- tapijt-sticker via de snijplanning-flow (op het tapijt zelf vlak vóór
-- verzending). Enkele klanten willen diezelfde sticker óók op standaard-
-- afmetingen (catalogus-rollen, niet-maatwerk). Deze migratie voegt:
--
--   1. `debiteuren.tapijt_sticker_bij_standaard BOOLEAN` — per-klant opt-in.
--      Default FALSE want het is een minderheid van klanten.
--
--   2. View `zending_regel_sticker_data` — zelfde shape als
--      `snijplan_sticker_data` (mig 295 + 300) maar gevoed uit
--      `zending_regels → order_regels → producten → kwaliteiten` voor
--      niet-maatwerk regels. Maatwerk-regels worden bewust EXCLUDED — die
--      hebben hun eigen sticker via `snijplan_sticker_data`, anders krijg je
--      dubbele stickers (1× bij snijden + 1× bij verzending).
--
-- Layout (StickerLayout-component) verwacht exact dezelfde velden, dus de
-- frontend rendert beide datasets identiek. Geen wijziging aan
-- StickerLayout, snijplan_sticker_data of de snijplanning-flow.

BEGIN;

------------------------------------------------------------------------
-- 1. debiteuren.tapijt_sticker_bij_standaard — per-klant voorkeur
------------------------------------------------------------------------

ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS tapijt_sticker_bij_standaard BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN debiteuren.tapijt_sticker_bij_standaard IS
  'Mig 303. TRUE = bij het printen van de vervoerderslabels voor deze klant '
  'óók een klant-facing tapijt-sticker (148×106mm) printen voor standaard '
  '(niet-maatwerk) artikelen. Maatwerk krijgt al via snijplan_sticker_data '
  'een sticker tijdens het snijden. Per-zending overrijdbaar op de '
  'verzendset-print-pagina door de operator.';

------------------------------------------------------------------------
-- 2. zending_regel_sticker_data — sticker-data voor standaard-regels
------------------------------------------------------------------------
-- Spiegelt `snijplan_sticker_data` exact qua kolommen (volgorde + types),
-- zodat de frontend dezelfde StickerLayout en formatter zonder vertakking
-- kan hergebruiken. De primary key is `zending_regel_id` i.p.v.
-- `snijplan_id`.
--
-- Filter:
--   - oreg.is_maatwerk = FALSE  → maatwerk heeft eigen snijplan-sticker
--   - is_admin_pseudo(oreg.artikelnr) = FALSE  → administratieve regels
--     (verzendkosten, etc.) krijgen geen sticker (mig 272)
--   - p.kwaliteit_code IS NOT NULL  → alleen tapijt-artikelen, geen
--     toebehoren/ondertapijt
--
-- (kw, kl)-resolutie: producten-rij is leidend (geen maatwerk_*-fallback
-- nodig, want is_maatwerk=FALSE). Display-naam via resolve_klanteigen_naam
-- (mig 199, 200) en EAN via sticker_ean_voor_kw_kl (mig 295) — identiek
-- aan snijplan_sticker_data zodat klanteigen branding consistent is.

CREATE OR REPLACE VIEW zending_regel_sticker_data AS
WITH base AS (
  SELECT
    zr.id          AS zending_regel_id,
    z.id           AS zending_id,
    z.zending_nr,
    o.id           AS order_id,
    o.order_nr,
    o.afleverdatum,
    o.debiteur_nr,
    d.naam         AS klant_naam,
    d.tapijt_sticker_bij_standaard,
    oreg.id        AS order_regel_id,
    -- Afmeting: producten.lengte_cm / breedte_cm (catalogus-maat).
    -- Niet maatwerk_* (NULL voor niet-maatwerk).
    p.lengte_cm    AS lengte_cm,
    p.breedte_cm   AS breedte_cm,
    p.kwaliteit_code,
    p.kleur_code,
    zr.aantal
  FROM zending_regels zr
  JOIN order_regels oreg ON oreg.id = zr.order_regel_id
  JOIN zendingen z       ON z.id    = zr.zending_id
  JOIN orders o          ON o.id    = oreg.order_id
  JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
  JOIN producten p       ON p.artikelnr   = oreg.artikelnr
  WHERE COALESCE(oreg.is_maatwerk, FALSE) = FALSE
    AND NOT is_admin_pseudo(oreg.artikelnr)
    AND p.kwaliteit_code IS NOT NULL
    AND p.kleur_code     IS NOT NULL
)
SELECT
  b.zending_regel_id,
  b.zending_id,
  b.zending_nr,
  b.order_id,
  b.order_nr,
  b.order_regel_id,
  b.debiteur_nr,
  b.klant_naam,
  b.tapijt_sticker_bij_standaard,
  b.kwaliteit_code,
  b.kleur_code,
  b.lengte_cm,
  b.breedte_cm,
  b.aantal,
  -- Klanteigen kwaliteits-naam → fallback canonieke omschrijving → code
  COALESCE(
    resolve_klanteigen_naam(b.debiteur_nr, b.kwaliteit_code, b.kleur_code),
    k.omschrijving,
    b.kwaliteit_code
  ) AS kwaliteit_naam,
  k.poolmateriaal,
  sticker_ean_voor_kw_kl(b.kwaliteit_code, b.kleur_code) AS ean_code,
  verzendweek_voor_datum(b.afleverdatum) AS verzendweek_iso
FROM base b
LEFT JOIN kwaliteiten k ON k.code = b.kwaliteit_code;

COMMENT ON VIEW zending_regel_sticker_data IS
  'Mig 303: sticker-data per zending_regel voor standaard (niet-maatwerk) '
  'artikelen. Bron-van-waarheid voor de optionele klant-facing tapijt-sticker '
  'die geprint wordt bij de vervoerderslabels als '
  'debiteuren.tapijt_sticker_bij_standaard=TRUE. Maatwerk-regels EXCLUDED — '
  'die lopen via snijplan_sticker_data (mig 295). Kolom-shape spiegelt '
  'snijplan_sticker_data zodat de frontend StickerLayout zonder vertakking '
  'hergebruikt.';

COMMIT;

NOTIFY pgrst, 'reload schema';
