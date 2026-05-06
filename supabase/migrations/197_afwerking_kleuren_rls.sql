-- Migratie 197: RLS-policies op afwerking_kleuren + maatwerk_band_defaults
--
-- Probleem: mig 194 maakte/breidde deze tabellen uit zonder RLS-policies.
-- Op dit project staat RLS by default aan, dus authenticated INSERT/UPDATE
-- wordt geblokkeerd. De UI in /producten kreeg de melding
--   "new row violates row-level security policy for table maatwerk_band_defaults"
-- bij het zetten van een bandkleur-default voor een kleur die nog geen rij had.
--
-- Fix: zelfde patroon als mig 196 (vertegenwoordiger_werkdagen_rls) — `_all`-
-- policy voor de `authenticated`-rol (USING true / WITH CHECK true). Idempotent.
-- Ook kwaliteit_standaard_afwerking meegenomen — die wordt nu vanuit de UI
-- bewerkt via de afwerking-editor in de kwaliteit-rij.

ALTER TABLE afwerking_kleuren ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS afwerking_kleuren_all ON afwerking_kleuren;
CREATE POLICY afwerking_kleuren_all
  ON afwerking_kleuren
  FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

ALTER TABLE maatwerk_band_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maatwerk_band_defaults_all ON maatwerk_band_defaults;
CREATE POLICY maatwerk_band_defaults_all
  ON maatwerk_band_defaults
  FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

ALTER TABLE kwaliteit_standaard_afwerking ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kwaliteit_standaard_afwerking_all ON kwaliteit_standaard_afwerking;
CREATE POLICY kwaliteit_standaard_afwerking_all
  ON kwaliteit_standaard_afwerking
  FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);
