-- Migratie 144: order_reserveringen schema basis
--
-- Doel: harde koppeling orderregel ↔ voorraad/inkooporder-regel.
-- Eén tabel, één enum-waarde, één kolom op orders, twee config-keys.
--
-- Idempotent: alle creates met IF NOT EXISTS / DO-block.

-- ============================================================================
-- Nieuwe enum-waarde: Wacht op inkoop
-- ============================================================================
DO $$ BEGIN
  ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'Wacht op inkoop' AFTER 'Wacht op voorraad';
EXCEPTION WHEN others THEN NULL; END $$;

-- ============================================================================
-- Trigger-helper: zet updated_at bij UPDATE (gebruikt door order_reserveringen)
-- Idempotent — geen wijziging als hij al bestaat onder een andere naam.
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TABEL order_reserveringen
-- ============================================================================
CREATE TABLE IF NOT EXISTS order_reserveringen (
  id BIGSERIAL PRIMARY KEY,
  order_regel_id BIGINT NOT NULL REFERENCES order_regels(id) ON DELETE CASCADE,
  bron TEXT NOT NULL CHECK (bron IN ('voorraad', 'inkooporder_regel')),
  inkooporder_regel_id BIGINT REFERENCES inkooporder_regels(id) ON DELETE RESTRICT,
  aantal INTEGER NOT NULL CHECK (aantal > 0),
  claim_volgorde TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'actief' CHECK (status IN ('actief', 'geleverd', 'released')),
  geleverd_op TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (bron = 'voorraad' AND inkooporder_regel_id IS NULL)
    OR (bron = 'inkooporder_regel' AND inkooporder_regel_id IS NOT NULL)
  )
);

-- Eén actieve voorraadclaim per orderregel, één per (orderregel, IO-regel) combi
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_reserveringen_voorraad_uniek
  ON order_reserveringen(order_regel_id)
  WHERE bron = 'voorraad' AND status = 'actief';

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_reserveringen_io_uniek
  ON order_reserveringen(order_regel_id, inkooporder_regel_id)
  WHERE bron = 'inkooporder_regel' AND status = 'actief';

CREATE INDEX IF NOT EXISTS idx_order_reserveringen_orderregel
  ON order_reserveringen(order_regel_id) WHERE status = 'actief';

CREATE INDEX IF NOT EXISTS idx_order_reserveringen_io_regel
  ON order_reserveringen(inkooporder_regel_id) WHERE status = 'actief';

CREATE INDEX IF NOT EXISTS idx_order_reserveringen_claim_volgorde
  ON order_reserveringen(inkooporder_regel_id, claim_volgorde) WHERE status = 'actief';

DROP TRIGGER IF EXISTS trg_order_reserveringen_updated_at ON order_reserveringen;
CREATE TRIGGER trg_order_reserveringen_updated_at
  BEFORE UPDATE ON order_reserveringen
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMENT ON TABLE order_reserveringen IS
  'Harde koppeling orderregel ↔ voorraad/inkooporder-regel. '
  'bron=voorraad: directe voorraad-claim, één rij per orderregel. '
  'bron=inkooporder_regel: claim op openstaande IO-regel, kan over meerdere IOs splitsen. '
  'Migratie 144 (2026-04-29).';

-- ============================================================================
-- KOLOM orders.lever_modus
-- ============================================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS lever_modus TEXT
    CHECK (lever_modus IN ('deelleveringen', 'in_een_keer'));

COMMENT ON COLUMN orders.lever_modus IS
  'Per-order keuze hoe om te gaan met tekort: deelleveringen = stuur wat klaar is + zendingen voor later, '
  'in_een_keer = wacht tot alles binnen is en lever in 1 zending. '
  'Default bij INSERT: debiteuren.deelleveringen_toegestaan. NULL voor orders zonder tekort. Migratie 144.';

-- ============================================================================
-- app_config buffer-keys (idempotent merge)
-- ============================================================================
INSERT INTO app_config (sleutel, waarde) VALUES
  ('order_config', jsonb_build_object(
    'standaard_maat_werkdagen', 5,
    'maatwerk_weken', 4,
    'inkoop_buffer_weken_vast', 1,
    'inkoop_buffer_weken_maatwerk', 2
  ))
ON CONFLICT (sleutel) DO UPDATE SET
  waarde = app_config.waarde
    || jsonb_build_object(
      'inkoop_buffer_weken_vast',
      COALESCE((app_config.waarde->>'inkoop_buffer_weken_vast')::INTEGER, 1)
    )
    || jsonb_build_object(
      'inkoop_buffer_weken_maatwerk',
      COALESCE((app_config.waarde->>'inkoop_buffer_weken_maatwerk')::INTEGER, 2)
    );
