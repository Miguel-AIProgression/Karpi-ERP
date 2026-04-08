-- Migration 031: Snijplannen uitbreiding + confectie scan tracking

-- 1. Extend snijplan_status enum with new values
ALTER TYPE snijplan_status ADD VALUE IF NOT EXISTS 'Wacht' BEFORE 'Gepland';
ALTER TYPE snijplan_status ADD VALUE IF NOT EXISTS 'Gesneden' AFTER 'In productie';
ALTER TYPE snijplan_status ADD VALUE IF NOT EXISTS 'In confectie' AFTER 'Gesneden';
ALTER TYPE snijplan_status ADD VALUE IF NOT EXISTS 'Ingepakt' AFTER 'Gereed';

-- 2. Scancode generator function
CREATE OR REPLACE FUNCTION genereer_scancode()
RETURNS TEXT AS $$
  SELECT 'KC-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
$$ LANGUAGE sql;

-- 3. Extend snijplannen with production details
ALTER TABLE snijplannen
  ADD COLUMN IF NOT EXISTS scancode TEXT UNIQUE DEFAULT genereer_scancode(),
  ADD COLUMN IF NOT EXISTS prioriteit SMALLINT DEFAULT 5 CHECK (prioriteit BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS planning_week SMALLINT,
  ADD COLUMN IF NOT EXISTS planning_jaar SMALLINT,
  ADD COLUMN IF NOT EXISTS afleverdatum DATE,
  ADD COLUMN IF NOT EXISTS positie_x_cm NUMERIC,
  ADD COLUMN IF NOT EXISTS positie_y_cm NUMERIC,
  ADD COLUMN IF NOT EXISTS reststuk_rol_id BIGINT REFERENCES rollen(id),
  ADD COLUMN IF NOT EXISTS gesneden_op TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gesneden_door TEXT;

-- 4. Extend confectie_orders with scan tracking
ALTER TABLE confectie_orders
  ADD COLUMN IF NOT EXISTS scancode TEXT UNIQUE DEFAULT genereer_scancode(),
  ADD COLUMN IF NOT EXISTS gestart_op TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gereed_op TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS medewerker TEXT;

-- 5. Add nummering types for SCAN and REST
INSERT INTO nummering (type, jaar, laatste_nummer) VALUES ('SCAN', 2026, 0) ON CONFLICT DO NOTHING;
INSERT INTO nummering (type, jaar, laatste_nummer) VALUES ('REST', 2026, 0) ON CONFLICT DO NOTHING;

-- 6. Indexes for production planning
CREATE INDEX IF NOT EXISTS idx_snijplannen_planning ON snijplannen(planning_jaar, planning_week);
CREATE INDEX IF NOT EXISTS idx_snijplannen_scancode ON snijplannen(scancode);
CREATE INDEX IF NOT EXISTS idx_snijplannen_status ON snijplannen(status);
CREATE INDEX IF NOT EXISTS idx_snijplannen_rol ON snijplannen(rol_id);
CREATE INDEX IF NOT EXISTS idx_confectie_scancode ON confectie_orders(scancode);
CREATE INDEX IF NOT EXISTS idx_confectie_snijplan ON confectie_orders(snijplan_id);
