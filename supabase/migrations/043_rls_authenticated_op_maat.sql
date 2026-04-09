-- Migration 043: Voeg authenticated RLS policies toe voor op-maat tabellen
-- Root cause: migratie 041 had alleen anon policies, maar ingelogde gebruikers
-- draaien als 'authenticated' role → 0 resultaten op alle nieuwe tabellen.

CREATE POLICY "Authenticated full access" ON maatwerk_vormen
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated full access" ON afwerking_types
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated full access" ON kwaliteit_standaard_afwerking
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated full access" ON maatwerk_m2_prijzen
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
