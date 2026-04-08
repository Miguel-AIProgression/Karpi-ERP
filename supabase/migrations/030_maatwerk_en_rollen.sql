-- Migration 030: Maatwerk velden op order_regels + reststuk tracking op rollen

-- 1. Maatwerk velden op order_regels (single source of truth)
ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS is_maatwerk BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maatwerk_vorm TEXT CHECK (maatwerk_vorm IN ('rechthoek', 'rond', 'ovaal')),
  ADD COLUMN IF NOT EXISTS maatwerk_lengte_cm NUMERIC,
  ADD COLUMN IF NOT EXISTS maatwerk_breedte_cm NUMERIC,
  ADD COLUMN IF NOT EXISTS maatwerk_afwerking TEXT CHECK (maatwerk_afwerking IN ('geen', 'overlocked', 'band', 'blindzoom')),
  ADD COLUMN IF NOT EXISTS maatwerk_band_kleur TEXT,
  ADD COLUMN IF NOT EXISTS maatwerk_instructies TEXT;

-- 2. Reststuk tracking op rollen
ALTER TABLE rollen
  ADD COLUMN IF NOT EXISTS oorsprong_rol_id BIGINT REFERENCES rollen(id),
  ADD COLUMN IF NOT EXISTS reststuk_datum TIMESTAMPTZ;

-- 3. Extend rollen.status CHECK constraint to include 'in_snijplan'
-- First check if there's an existing CHECK constraint and handle accordingly
-- Since rollen.status is TEXT without a named CHECK, we add one:
-- Note: if a CHECK already exists, this may need manual adjustment
DO $$
BEGIN
  -- Try to drop existing check constraint on status if it exists
  BEGIN
    ALTER TABLE rollen DROP CONSTRAINT IF EXISTS rollen_status_check;
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
END $$;

ALTER TABLE rollen ADD CONSTRAINT rollen_status_check
  CHECK (status IN ('beschikbaar', 'gereserveerd', 'verkocht', 'gesneden', 'reststuk', 'in_snijplan'));

-- 4. Index for reststuk lookups
CREATE INDEX IF NOT EXISTS idx_rollen_oorsprong ON rollen(oorsprong_rol_id) WHERE oorsprong_rol_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rollen_reststuk ON rollen(kwaliteit_code, kleur_code) WHERE status = 'reststuk';
CREATE INDEX IF NOT EXISTS idx_order_regels_maatwerk ON order_regels(is_maatwerk) WHERE is_maatwerk = true;
