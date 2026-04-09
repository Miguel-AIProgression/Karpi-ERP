-- Migration 046: RLS voor snijplan_groep_locks
-- Volgt projectconventie: alle tabellen hebben RLS enabled, fase 1 = authenticated volledige toegang

ALTER TABLE snijplan_groep_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access"
  ON snijplan_groep_locks
  FOR ALL
  USING (auth.role() = 'authenticated');
