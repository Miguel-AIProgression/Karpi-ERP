-- Migration 128: Fix unique indexes voor ON CONFLICT compat
--
-- Partial unique indexes (WITH WHERE clause) werken niet met PostgREST/supabase-py
-- upserts die ON CONFLICT (kolom) gebruiken. Postgres accepteert meerdere NULLs
-- in een gewone UNIQUE index, dus de partial filter was niet nodig.
--
-- Idempotent.

DROP INDEX IF EXISTS leveranciers_leverancier_nr_key;
CREATE UNIQUE INDEX IF NOT EXISTS leveranciers_leverancier_nr_key
  ON leveranciers(leverancier_nr);

DROP INDEX IF EXISTS inkooporders_inkooporder_nr_key;
CREATE UNIQUE INDEX IF NOT EXISTS inkooporders_inkooporder_nr_key
  ON inkooporders(inkooporder_nr);

DROP INDEX IF EXISTS inkooporders_oud_nr_key;
CREATE UNIQUE INDEX IF NOT EXISTS inkooporders_oud_nr_key
  ON inkooporders(oud_inkooporder_nr);
