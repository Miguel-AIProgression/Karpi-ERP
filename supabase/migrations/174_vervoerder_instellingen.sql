-- Migratie 174: vervoerder-instellingen + statistiek-view
-- Plan: docs/superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md (Fase A)
--
-- Breidt vervoerders-tabel uit met API-config, contactgegevens en vrije-tekst tarief-notities.
-- Voegt view vervoerder_stats toe voor het overzichtsdashboard (klant-aantal,
-- zending-aantal totaal/maand, en HST-specifieke success/fail-counts).
--
-- Idempotent.

-- ============================================================================
-- Nieuwe kolommen op vervoerders
-- ============================================================================
ALTER TABLE vervoerders
  ADD COLUMN IF NOT EXISTS api_endpoint     TEXT,
  ADD COLUMN IF NOT EXISTS api_customer_id  TEXT,
  ADD COLUMN IF NOT EXISTS account_nummer   TEXT,
  ADD COLUMN IF NOT EXISTS kontakt_naam     TEXT,
  ADD COLUMN IF NOT EXISTS kontakt_email    TEXT,
  ADD COLUMN IF NOT EXISTS kontakt_telefoon TEXT,
  ADD COLUMN IF NOT EXISTS tarief_notities  TEXT;

COMMENT ON COLUMN vervoerders.api_endpoint IS
  'Werkelijke API-URL voor type=api vervoerders. NULL voor EDI.';
COMMENT ON COLUMN vervoerders.api_customer_id IS
  'Klant-ID bij vervoerder voor API-authenticatie (bv. HST CustomerID 038267).';
COMMENT ON COLUMN vervoerders.account_nummer IS
  'Algemeen account-/contractnummer bij vervoerder (zichtbaar op facturen van vervoerder naar Karpi).';
COMMENT ON COLUMN vervoerders.kontakt_naam IS
  'Contactpersoon bij vervoerder.';
COMMENT ON COLUMN vervoerders.kontakt_email IS
  'Contactpersoon bij vervoerder.';
COMMENT ON COLUMN vervoerders.kontakt_telefoon IS
  'Contactpersoon bij vervoerder.';
COMMENT ON COLUMN vervoerders.tarief_notities IS
  'Vrije-tekst-notities over tarieven, zones, kortingen. Fase B vervangt dit door gestructureerde tabellen.';

-- ============================================================================
-- View vervoerder_stats — dashboard-cijfers per vervoerder
-- ============================================================================
CREATE OR REPLACE VIEW vervoerder_stats AS
SELECT
  v.code,
  v.display_naam,
  v.type,
  v.actief,
  COALESCE(klanten.aantal, 0)            AS aantal_klanten,
  COALESCE(zendingen_totaal.aantal, 0)   AS aantal_zendingen_totaal,
  COALESCE(zendingen_maand.aantal, 0)    AS aantal_zendingen_deze_maand,
  COALESCE(hst_succes.aantal, 0)         AS hst_aantal_verstuurd,
  COALESCE(hst_fout.aantal, 0)           AS hst_aantal_fout
FROM vervoerders v
LEFT JOIN (
  SELECT vervoerder_code, COUNT(*)::INT AS aantal
    FROM edi_handelspartner_config
   WHERE vervoerder_code IS NOT NULL
   GROUP BY vervoerder_code
) klanten ON klanten.vervoerder_code = v.code
LEFT JOIN (
  SELECT ehc.vervoerder_code, COUNT(z.id)::INT AS aantal
    FROM zendingen z
    JOIN orders o  ON o.id = z.order_id
    JOIN edi_handelspartner_config ehc ON ehc.debiteur_nr = o.debiteur_nr
   GROUP BY ehc.vervoerder_code
) zendingen_totaal ON zendingen_totaal.vervoerder_code = v.code
LEFT JOIN (
  SELECT ehc.vervoerder_code, COUNT(z.id)::INT AS aantal
    FROM zendingen z
    JOIN orders o  ON o.id = z.order_id
    JOIN edi_handelspartner_config ehc ON ehc.debiteur_nr = o.debiteur_nr
   WHERE z.created_at >= date_trunc('month', now())
   GROUP BY ehc.vervoerder_code
) zendingen_maand ON zendingen_maand.vervoerder_code = v.code
LEFT JOIN (
  SELECT 'hst_api'::TEXT AS code, COUNT(*)::INT AS aantal
    FROM hst_transportorders WHERE status = 'Verstuurd'
) hst_succes ON hst_succes.code = v.code
LEFT JOIN (
  SELECT 'hst_api'::TEXT AS code, COUNT(*)::INT AS aantal
    FROM hst_transportorders WHERE status = 'Fout'
) hst_fout ON hst_fout.code = v.code;

COMMENT ON VIEW vervoerder_stats IS
  'Per-vervoerder dashboard: aantal klanten, zendingen, success/fail-counts. '
  'Voorlopig zijn hst_aantal_* alleen niet-NULL voor hst_api; bij EDI-vervoerders '
  'volgt later iets vergelijkbaars uit edi_berichten.';

GRANT SELECT ON vervoerder_stats TO authenticated;

-- ============================================================================
-- VERIFICATIE NA APPLY:
--   \d vervoerders                                  -- check nieuwe kolommen
--   SELECT * FROM vervoerder_stats;                  -- check view werkt
--   UPDATE vervoerders SET api_endpoint='https://accp.hstonline.nl/rest/api/v1', api_customer_id='038267'
--     WHERE code='hst_api';
--   SELECT code, api_endpoint, api_customer_id FROM vervoerders WHERE code='hst_api';
-- ============================================================================
