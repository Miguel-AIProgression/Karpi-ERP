-- Migratie 215: Medewerker als overkoepelend identity-concept
--
-- Achtergrond: ADR-0004. De methodiek-flow vereist dat we bij een Pickronde
-- een Picker selecteren. We konden een aparte `pickers`-tabel maken naast
-- `vertegenwoordigers`, maar elke nieuwe rol (magazijnchef, inkoper) zou
-- dan een eigen tabel worden. Beter: een `medewerkers`-tabel met rol-tags.
--
-- Migratie-strategie:
--   1. Maak enum `medewerker_rol`.
--   2. Hernoem tabel `vertegenwoordigers` -> `medewerkers`.
--   3. Voeg `id BIGSERIAL PRIMARY KEY` + `rollen medewerker_rol[]` toe.
--   4. Backfill bestaande rijen met rollen={'vertegenwoordiger'}.
--   5. Maak compat-view `vertegenwoordigers` voor bestaande callers.
--   6. Update `vertegenwoordiger_werkdagen` naar nieuwe FK indien nodig.
--
-- FKs op `klanten.vertegenw_code` en `orders.vertegenw_code` blijven
-- ongemoeid - `medewerkers.code` is nog steeds de target.

------------------------------------------------------------------------
-- 1. Enum medewerker_rol
------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medewerker_rol') THEN
    CREATE TYPE medewerker_rol AS ENUM ('vertegenwoordiger', 'picker');
  END IF;
END $$;

------------------------------------------------------------------------
-- 2. Hernoem tabel
------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'vertegenwoordigers')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'medewerkers')
  THEN
    ALTER TABLE vertegenwoordigers RENAME TO medewerkers;
  END IF;
END $$;

------------------------------------------------------------------------
-- 3. Voeg id + rollen toe
------------------------------------------------------------------------
ALTER TABLE medewerkers
  ADD COLUMN IF NOT EXISTS id BIGSERIAL,
  ADD COLUMN IF NOT EXISTS rollen medewerker_rol[] NOT NULL DEFAULT '{}';

-- id wordt nieuwe surrogate PK; code blijft UNIQUE als business-key.
DO $$
BEGIN
  -- Drop oude PK op code als die bestaat
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'medewerkers'::regclass
      AND contype = 'p'
      AND conname = 'vertegenwoordigers_pkey'
  ) THEN
    ALTER TABLE medewerkers DROP CONSTRAINT vertegenwoordigers_pkey;
  END IF;

  -- Zet id als PK
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'medewerkers'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE medewerkers ADD CONSTRAINT medewerkers_pkey PRIMARY KEY (id);
  END IF;

  -- Code blijft UNIQUE (NULLs toegestaan voor pickers)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'medewerkers'::regclass
      AND contype = 'u'
      AND conname = 'medewerkers_code_key'
  ) THEN
    ALTER TABLE medewerkers ADD CONSTRAINT medewerkers_code_key UNIQUE (code);
  END IF;
END $$;

-- Code mag voortaan NULL zijn (pickers hebben geen code)
ALTER TABLE medewerkers ALTER COLUMN code DROP NOT NULL;

------------------------------------------------------------------------
-- 4. Backfill rollen
------------------------------------------------------------------------
UPDATE medewerkers
SET rollen = ARRAY['vertegenwoordiger']::medewerker_rol[]
WHERE rollen = '{}' AND code IS NOT NULL;

------------------------------------------------------------------------
-- 5. Backwards-compat: view vertegenwoordigers
------------------------------------------------------------------------
-- Bestaande queries die `from('vertegenwoordigers')` deden blijven werken
-- via deze compat-view. Idempotent.
DROP VIEW IF EXISTS vertegenwoordigers CASCADE;

CREATE VIEW vertegenwoordigers AS
SELECT
  id,
  naam,
  code,
  email,
  telefoon,
  actief
FROM medewerkers
WHERE 'vertegenwoordiger' = ANY(rollen);

COMMENT ON VIEW vertegenwoordigers IS
  'Compat-view voor pre-mig-215 callers. Filtert medewerkers op rol '
  'vertegenwoordiger. Nieuwe code: gebruik direct medewerkers + rollen-filter.';

------------------------------------------------------------------------
-- 6. vertegenwoordiger_werkdagen — geen wijziging nodig
------------------------------------------------------------------------
-- Tabel verwijst via vertegenw_code naar medewerkers.code (nog steeds UNIQUE).
-- Geen FK-update nodig.

------------------------------------------------------------------------
-- 7. RLS / grants — overgenomen van vertegenwoordigers
------------------------------------------------------------------------
ALTER TABLE medewerkers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS medewerkers_read ON medewerkers;
CREATE POLICY medewerkers_read ON medewerkers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS medewerkers_write ON medewerkers;
CREATE POLICY medewerkers_write ON medewerkers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON medewerkers TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE medewerkers_id_seq TO authenticated;
GRANT SELECT ON vertegenwoordigers TO authenticated;

NOTIFY pgrst, 'reload schema';
