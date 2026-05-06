-- Migratie 196: RLS-policies op vertegenwoordiger_werkdagen
--
-- Probleem: mig 195 maakte de tabel aan zonder RLS-policies. Op dit project
-- staat RLS by default aan op nieuwe tabellen, dus alle non-superuser
-- INSERT/UPDATE/DELETE wordt geblokkeerd. De UI-toggle in de werkdagen-tab
-- doet niets omdat de upsert/delete silent geweigerd wordt.
--
-- Fix: zelfde patroon als andere V1-tabellen — `_all`-policy voor de
-- `authenticated`-rol (USING true / WITH CHECK true). Idempotent.

ALTER TABLE vertegenwoordiger_werkdagen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vertegenwoordiger_werkdagen_all ON vertegenwoordiger_werkdagen;
CREATE POLICY vertegenwoordiger_werkdagen_all
  ON vertegenwoordiger_werkdagen
  FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);
