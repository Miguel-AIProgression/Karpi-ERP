-- Migratie 156: EDI-handelspartner-configuratie + GLN-velden
--
-- Eerste stap richting Transus API-koppeling (vervangt Windows Connect op MITS-CA-01-009).
-- Plan: docs/superpowers/plans/2026-04-29-edi-transus-koppeling.md
--
-- Wat deze migratie doet:
--   1. `bedrijfsgegevens.gln_eigen` — onze GLN als afzender voor uitgaande EDI-berichten
--   2. `edi_handelspartner_config` — per debiteur welke EDI-berichten actief zijn
--   3. Drie-staps-keten op orders: aparte besteller (BY), factuuradres (IV), afleveradres (DP)
--      met snapshots + GLN-velden, voor inkomende EDI-orders
--
-- Idempotent. Geen breaking changes voor handmatige/Lightspeed-orders (NULLs zijn toegestaan).

-- ============================================================================
-- 1. Karpi's eigen GLN in app_config.bedrijfsgegevens
--
-- Bedrijfsgegevens zijn JSONB onder sleutel 'bedrijfsgegevens' (zie migratie 120).
-- Voegt veld `gln_eigen` toe als het ontbreekt.
-- ============================================================================
UPDATE app_config
   SET waarde = waarde || jsonb_build_object('gln_eigen', '8715954999998')
 WHERE sleutel = 'bedrijfsgegevens'
   AND NOT (waarde ? 'gln_eigen');

-- Karpi's eigen GLN-nummer (Global Location Number, 13 cijfers). Wordt door de
-- EDI-laag gebruikt als NAD+SU / SupplierGLN in uitgaande Transus-berichten.
-- Standaardwaarde 8715954999998 afgeleid uit echte productie-EDI-berichten op 2026-04-29.
-- Frontend pagina Instellingen → Bedrijfsgegevens kan deze later aanpassen.

-- ============================================================================
-- 2. edi_handelspartner_config — per debiteur welke berichttypen actief
-- ============================================================================
CREATE TABLE IF NOT EXISTS edi_handelspartner_config (
  debiteur_nr        INTEGER PRIMARY KEY REFERENCES debiteuren(debiteur_nr) ON DELETE CASCADE,
  -- Hoofdschakelaar: doet deze klant überhaupt EDI via Transus?
  transus_actief     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Per berichttype een toggle. Komt overeen met Transus-Online "Processen"-block per partner.
  order_in           BOOLEAN NOT NULL DEFAULT FALSE,
  orderbev_uit       BOOLEAN NOT NULL DEFAULT FALSE,
  factuur_uit        BOOLEAN NOT NULL DEFAULT FALSE,
  verzend_uit        BOOLEAN NOT NULL DEFAULT FALSE,
  -- Test-modus: alle uitgaande berichten met `IsTestMessage=Y` markeren.
  -- Gebruikt voor cutover-test-handelspartner of staging-omgeving zonder code-wijziging.
  test_modus         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Vrije tekst-veld voor partner-specifieke notes (bv. "Karpi-artnr in BP-veld", versie van schema, etc.)
  notities           TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edi_handelspartner_actief
  ON edi_handelspartner_config (transus_actief)
  WHERE transus_actief = TRUE;

COMMENT ON TABLE edi_handelspartner_config IS
  'Per debiteur de EDI-Transus-koppelingsinstellingen. transus_actief=false → debiteur '
  'wordt door de EDI-laag genegeerd (handmatige flow). Komt overeen met de toggles per partner '
  'in Transus Online → Handelspartners → Processen.';

-- updated_at-trigger
CREATE OR REPLACE FUNCTION set_edi_handelspartner_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_edi_handelspartner_updated_at ON edi_handelspartner_config;
CREATE TRIGGER trg_edi_handelspartner_updated_at
  BEFORE UPDATE ON edi_handelspartner_config
  FOR EACH ROW EXECUTE FUNCTION set_edi_handelspartner_updated_at();

-- RLS (fase 1: authenticated = volledige toegang, consistent met andere V1-tabellen)
ALTER TABLE edi_handelspartner_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS edi_handelspartner_select ON edi_handelspartner_config;
CREATE POLICY edi_handelspartner_select
  ON edi_handelspartner_config FOR SELECT
  TO authenticated USING (TRUE);

DROP POLICY IF EXISTS edi_handelspartner_insert ON edi_handelspartner_config;
CREATE POLICY edi_handelspartner_insert
  ON edi_handelspartner_config FOR INSERT
  TO authenticated WITH CHECK (TRUE);

DROP POLICY IF EXISTS edi_handelspartner_update ON edi_handelspartner_config;
CREATE POLICY edi_handelspartner_update
  ON edi_handelspartner_config FOR UPDATE
  TO authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS edi_handelspartner_delete ON edi_handelspartner_config;
CREATE POLICY edi_handelspartner_delete
  ON edi_handelspartner_config FOR DELETE
  TO authenticated USING (TRUE);

-- ============================================================================
-- 3. Drie-staps partij-keten op orders
--
-- EDI-orders hebben tot vier verschillende GLN's (BY, IV, DP, SN/UltimateConsignee).
-- Onze huidige snapshots dekken alleen factuuradres (`fact_*`) en afleveradres (`afl_*`).
-- We voegen `bes_*` toe voor de besteller (NAD+BY) en GLN-velden bij elk van de drie partijen.
-- NULL voor handmatige + Lightspeed-orders (backwards compatible).
-- ============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS bes_naam       TEXT,
  ADD COLUMN IF NOT EXISTS bes_adres      TEXT,
  ADD COLUMN IF NOT EXISTS bes_postcode   TEXT,
  ADD COLUMN IF NOT EXISTS bes_plaats     TEXT,
  ADD COLUMN IF NOT EXISTS bes_land       TEXT,
  ADD COLUMN IF NOT EXISTS besteller_gln     TEXT,
  ADD COLUMN IF NOT EXISTS factuuradres_gln  TEXT,
  ADD COLUMN IF NOT EXISTS afleveradres_gln  TEXT;

COMMENT ON COLUMN orders.bes_naam IS
  'Besteller-snapshot (NAD+BY in EDIFACT). De partij die de order plaatst — '
  'kan een filiaal of online-afdeling zijn dat afwijkt van de gefactureerde (HQ) '
  'en het afleveradres (DP). NULL voor handmatige/Lightspeed-orders waar besteller = factuuradres.';

COMMENT ON COLUMN orders.besteller_gln IS
  'GLN van de besteller. Bron: NAD+BY-segment in inkomend EDIFACT-bericht.';

COMMENT ON COLUMN orders.factuuradres_gln IS
  'GLN van de gefactureerde. Bron: NAD+IV-segment.';

COMMENT ON COLUMN orders.afleveradres_gln IS
  'GLN van het afleveradres. Bron: NAD+DP-segment. Komt vaak overeen met '
  'afleveradressen.gln_afleveradres voor reguliere klanten, maar kan bij dropshipment '
  'naar een eindklant een ad-hoc GLN zijn.';
