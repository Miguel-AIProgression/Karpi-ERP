-- Migration 129: Maak legacy NOT-NULL kolommen op inkooporder_regels NULLable
--
-- De tabel inkooporder_regels bestond al als stub met kolommen (aantal,
-- inkoopprijs, ontvangen) uit het oude docs-schema. Die zijn nu vervangen
-- door besteld_m, inkoopprijs_eur, geleverd_m. Om imports te laten slagen
-- maken we de legacy kolommen NULLable (kunnen later geheel weg).
--
-- Idempotent: DROP NOT NULL is no-op als al NULLable.

DO $$ BEGIN
  ALTER TABLE inkooporder_regels ALTER COLUMN aantal DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE inkooporder_regels ALTER COLUMN inkoopprijs DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE inkooporder_regels ALTER COLUMN ontvangen DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;
