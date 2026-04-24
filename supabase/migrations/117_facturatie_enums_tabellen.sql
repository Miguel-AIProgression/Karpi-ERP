-- Migration 117: Facturatie — enums + tabellen + factuurvoorkeur + btw_percentage
-- Zie plan: docs/superpowers/plans/2026-04-22-facturatie-module.md
--
-- Idempotent: veilig om meerdere keren te runnen. Enums in DO-blocks (Postgres heeft
-- geen CREATE TYPE IF NOT EXISTS). Tabellen + kolommen + indexen met IF NOT EXISTS.
-- Trigger via DROP IF EXISTS + CREATE.

DO $$ BEGIN
  CREATE TYPE factuur_status AS ENUM (
    'Concept', 'Verstuurd', 'Betaald', 'Herinnering', 'Aanmaning', 'Gecrediteerd'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE factuurvoorkeur AS ENUM ('per_zending', 'wekelijks');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS factuurvoorkeur factuurvoorkeur NOT NULL DEFAULT 'per_zending',
  ADD COLUMN IF NOT EXISTS btw_percentage NUMERIC(5,2) NOT NULL DEFAULT 21.00;

-- CHECK los toevoegen (idempotent via exception handler)
DO $$ BEGIN
  ALTER TABLE debiteuren
    ADD CONSTRAINT debiteuren_btw_percentage_range
    CHECK (btw_percentage >= 0 AND btw_percentage <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN debiteuren.factuurvoorkeur IS
  'Bepaalt of elke verzonden order direct gefactureerd wordt (per_zending) of '
  'als wekelijkse verzamelfactuur op maandag voor de week ervoor (wekelijks).';

COMMENT ON COLUMN debiteuren.btw_percentage IS
  'BTW-percentage dat op facturen wordt toegepast. Default 21.00 (NL binnenlands). '
  'Zet op 0.00 voor intracommunautaire leveringen (EU met geldig btw_nummer → verlegging) '
  'of export (niet-EU). V1: handmatige keuze per klant, geen auto-afleiding uit land.';

CREATE TABLE IF NOT EXISTS facturen (
  id BIGSERIAL PRIMARY KEY,
  factuur_nr TEXT UNIQUE NOT NULL,
  debiteur_nr INTEGER NOT NULL REFERENCES debiteuren(debiteur_nr),
  factuurdatum DATE NOT NULL DEFAULT CURRENT_DATE,
  vervaldatum DATE NOT NULL,
  status factuur_status NOT NULL DEFAULT 'Concept',
  subtotaal NUMERIC(12,2) NOT NULL DEFAULT 0,
  btw_percentage NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  btw_bedrag NUMERIC(12,2) NOT NULL DEFAULT 0,
  totaal NUMERIC(12,2) NOT NULL DEFAULT 0,
  fact_naam TEXT,
  fact_adres TEXT,
  fact_postcode TEXT,
  fact_plaats TEXT,
  fact_land TEXT,
  btw_nummer TEXT,
  opmerkingen TEXT,
  pdf_storage_path TEXT,
  verstuurd_op TIMESTAMPTZ,
  verstuurd_naar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facturen_debiteur ON facturen(debiteur_nr, factuurdatum DESC);
CREATE INDEX IF NOT EXISTS idx_facturen_status ON facturen(status) WHERE status IN ('Concept', 'Verstuurd');

CREATE TABLE IF NOT EXISTS factuur_regels (
  id BIGSERIAL PRIMARY KEY,
  factuur_id BIGINT NOT NULL REFERENCES facturen(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  order_regel_id BIGINT NOT NULL REFERENCES order_regels(id),
  regelnummer INTEGER NOT NULL,
  artikelnr TEXT,
  omschrijving TEXT,
  omschrijving_2 TEXT,
  uw_referentie TEXT,
  order_nr TEXT,
  aantal INTEGER NOT NULL,
  prijs NUMERIC(10,2) NOT NULL,
  korting_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  bedrag NUMERIC(12,2) NOT NULL,
  btw_percentage NUMERIC(5,2) NOT NULL DEFAULT 21.00
);

CREATE INDEX IF NOT EXISTS idx_factuur_regels_factuur ON factuur_regels(factuur_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_factuur_regels_order_regel ON factuur_regels(order_regel_id);
-- Hard-enforce: één order-regel wordt maximaal één keer gefactureerd.

-- Trigger: updated_at bijhouden
CREATE OR REPLACE FUNCTION set_facturen_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_facturen_updated_at ON facturen;
CREATE TRIGGER trg_facturen_updated_at
  BEFORE UPDATE ON facturen
  FOR EACH ROW EXECUTE FUNCTION set_facturen_updated_at();
