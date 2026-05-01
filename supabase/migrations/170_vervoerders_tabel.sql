-- Migratie 170: vervoerders + per-debiteur vervoerderkeuze
-- Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md
--
-- Idempotent.

-- ============================================================================
-- Vervoerders-tabel
-- ============================================================================
CREATE TABLE IF NOT EXISTS vervoerders (
  code           TEXT PRIMARY KEY,                  -- 'hst_api', 'edi_partner_a', etc.
  display_naam   TEXT NOT NULL,                     -- 'HST', 'Rhenus', 'Verhoek'
  type           TEXT NOT NULL CHECK (type IN ('api', 'edi')),
  actief         BOOLEAN NOT NULL DEFAULT FALSE,    -- pas TRUE als koppeling werkt
  notities       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE vervoerders IS
  'Beschikbare vervoerders. code wordt als FK gebruikt op edi_handelspartner_config.vervoerder_code.';

-- ============================================================================
-- Zaai 3 rijen
-- ============================================================================
INSERT INTO vervoerders (code, display_naam, type, actief, notities) VALUES
  ('hst_api',        'HST',     'api', FALSE, 'REST API. Auth via Basic. Plan 2026-05-01.'),
  ('edi_partner_a',  'Rhenus',  'edi', FALSE, 'EDI — placeholder, plan volgt.'),
  ('edi_partner_b',  'Verhoek', 'edi', FALSE, 'EDI — placeholder, plan volgt.')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- updated_at-trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION set_vervoerders_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vervoerders_updated_at ON vervoerders;
CREATE TRIGGER trg_vervoerders_updated_at
  BEFORE UPDATE ON vervoerders
  FOR EACH ROW EXECUTE FUNCTION set_vervoerders_updated_at();

-- ============================================================================
-- Per-debiteur keuze: kolom op edi_handelspartner_config
-- ============================================================================
ALTER TABLE edi_handelspartner_config
  ADD COLUMN IF NOT EXISTS vervoerder_code TEXT REFERENCES vervoerders(code);

COMMENT ON COLUMN edi_handelspartner_config.vervoerder_code IS
  'Welke vervoerder gebruikt deze debiteur? NULL = nog niet gekozen / handmatige flow. '
  'Bij wisseling van waarde wordt geen automatische re-routing van openstaande zendingen '
  'gedaan — alleen nieuwe zendingen volgen de nieuwe waarde.';

CREATE INDEX IF NOT EXISTS idx_edi_handelspartner_vervoerder
  ON edi_handelspartner_config (vervoerder_code)
  WHERE vervoerder_code IS NOT NULL;

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE vervoerders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vervoerders_all ON vervoerders;
CREATE POLICY vervoerders_all ON vervoerders FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
