-- Migratie 169: zendingen + zending_regels
--
-- Eerste werkelijke materialisatie van de zendingen-tabel (stond al in
-- docs/database-schema.md beschreven, was nog nooit aangemaakt). Bron-van-waarheid
-- voor de logistieke flow: één rij per fysieke zending naar een afleveradres.
-- Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md
--
-- Idempotent.

-- ============================================================================
-- Status-enum
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE zending_status AS ENUM (
    'Gepland',
    'Picken',
    'Ingepakt',
    'Klaar voor verzending',
    'Onderweg',
    'Afgeleverd'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Hoofd-tabel
-- ============================================================================
CREATE TABLE IF NOT EXISTS zendingen (
  id                 BIGSERIAL PRIMARY KEY,
  zending_nr         TEXT NOT NULL UNIQUE,            -- ZEND-2026-0001
  order_id           BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  status             zending_status NOT NULL DEFAULT 'Gepland',
  verzenddatum       DATE,
  track_trace        TEXT,                            -- HST-tracking-nummer of EDI-equivalent
  -- Adres-snapshot (kopie van orders.afl_*; voor de eventuele uitzondering dat
  -- één order naar verschillende adressen splitst in V2)
  afl_naam           TEXT,
  afl_adres          TEXT,
  afl_postcode       TEXT,
  afl_plaats         TEXT,
  afl_land           TEXT,
  -- Pakket-info (handmatig in V1, later via Pick & Ship)
  totaal_gewicht_kg  NUMERIC,
  aantal_colli       INTEGER,
  opmerkingen        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zendingen_order ON zendingen (order_id);
CREATE INDEX IF NOT EXISTS idx_zendingen_status ON zendingen (status);

-- ============================================================================
-- Regels-tabel
-- ============================================================================
CREATE TABLE IF NOT EXISTS zending_regels (
  id              BIGSERIAL PRIMARY KEY,
  zending_id      BIGINT NOT NULL REFERENCES zendingen(id) ON DELETE CASCADE,
  order_regel_id  BIGINT REFERENCES order_regels(id) ON DELETE SET NULL,
  artikelnr       TEXT REFERENCES producten(artikelnr),
  rol_id          BIGINT REFERENCES rollen(id),
  aantal          INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zending_regels_zending ON zending_regels (zending_id);

-- ============================================================================
-- updated_at-trigger op zendingen
-- ============================================================================
CREATE OR REPLACE FUNCTION set_zendingen_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_zendingen_updated_at ON zendingen;
CREATE TRIGGER trg_zendingen_updated_at
  BEFORE UPDATE ON zendingen
  FOR EACH ROW EXECUTE FUNCTION set_zendingen_updated_at();

-- Geen nummering-seed nodig: volgend_nummer('ZEND') lazy-creëert de sequence
-- `zend_2026_seq` bij eerste aanroep — zie migratie 116.

-- ============================================================================
-- RLS (consistent met andere V1-tabellen)
-- ============================================================================
ALTER TABLE zendingen ENABLE ROW LEVEL SECURITY;
ALTER TABLE zending_regels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zendingen_all ON zendingen;
CREATE POLICY zendingen_all ON zendingen FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS zending_regels_all ON zending_regels;
CREATE POLICY zending_regels_all ON zending_regels FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
