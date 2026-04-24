-- Migration 125: Schema-drift fix voor facturen + factuur_regels
--
-- Probleem: bij een eerdere mislukte poging waren `facturen` + `factuur_regels` al
-- aangemaakt met een afwijkend (ouder) schema. Migratie 117 gebruikte
-- `CREATE TABLE IF NOT EXISTS`, dus die is overgeslagen en de kolommen uit ons
-- V1-design zijn nooit toegevoegd. Gevolg: `genereer_factuur` faalt op
-- "column btw_nummer does not exist" etc.
--
-- Deze migratie voegt de ontbrekende kolommen idempotent toe en dropt de
-- niet-gebruikte `facturen.order_id` (in ons design linkt een factuur via
-- `factuur_regels.order_id` aan meerdere orders, niet via een header-kolom).
--
-- Veilig: beide tabellen zijn leeg (geverifieerd via count=exact).

-- ==============================
--   facturen — ontbrekende kolommen
-- ==============================
ALTER TABLE facturen
  ADD COLUMN IF NOT EXISTS btw_nummer TEXT,
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS verstuurd_op TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verstuurd_naar TEXT;

-- Oude header-koppeling order_id hoort niet in ons design — verwijderen
ALTER TABLE facturen DROP COLUMN IF EXISTS order_id;

-- ==============================
--   factuur_regels — ontbrekende kolommen
-- ==============================
-- order_id moet NOT NULL zijn met FK, maar ADD COLUMN NOT NULL kan niet op niet-lege
-- tabel. Tabel is leeg, dus we kunnen de NOT NULL + FK direct meegeven.
ALTER TABLE factuur_regels
  ADD COLUMN IF NOT EXISTS order_id BIGINT,
  ADD COLUMN IF NOT EXISTS regelnummer INTEGER,
  ADD COLUMN IF NOT EXISTS artikelnr TEXT,
  ADD COLUMN IF NOT EXISTS omschrijving_2 TEXT,
  ADD COLUMN IF NOT EXISTS uw_referentie TEXT,
  ADD COLUMN IF NOT EXISTS order_nr TEXT;

-- NOT NULL enforcen (alleen als er geen nulls zijn; tabel is leeg dus ok)
DO $$ BEGIN
  ALTER TABLE factuur_regels ALTER COLUMN order_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE factuur_regels ALTER COLUMN regelnummer SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- FK op order_id toevoegen (idempotent)
DO $$ BEGIN
  ALTER TABLE factuur_regels
    ADD CONSTRAINT factuur_regels_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- factuur_regels_order_regel UNIQUE index (uit migratie 117) is mogelijk nog niet gezet
CREATE UNIQUE INDEX IF NOT EXISTS idx_factuur_regels_order_regel
  ON factuur_regels(order_regel_id);

CREATE INDEX IF NOT EXISTS idx_factuur_regels_factuur
  ON factuur_regels(factuur_id);

-- Indexen op facturen
CREATE INDEX IF NOT EXISTS idx_facturen_debiteur
  ON facturen(debiteur_nr, factuurdatum DESC);
CREATE INDEX IF NOT EXISTS idx_facturen_status
  ON facturen(status) WHERE status IN ('Concept', 'Verstuurd');
