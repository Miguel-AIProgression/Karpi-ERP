-- 201_verzendkosten_per_klant.sql
--
-- Herstel van legacy migratie 032: kolommen `verzendkosten` en `verzend_drempel`
-- op `debiteuren` waren aanwezig in de codebase (frontend, order-mutations,
-- klant-detail) maar de oorspronkelijke migratie 032 is uit de repo verdwenen
-- en nooit op deze database toegepast. Symptoom in productie:
-- PostgREST PGRST204 "Could not find the 'verzendkosten' column" zodra je via
-- de UI verzendkosten of drempel probeert op te slaan.
--
-- Idempotent — gebruikt IF NOT EXISTS, dus veilig opnieuw toepasbaar.

ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS verzendkosten NUMERIC(6,2) DEFAULT 35.00,
  ADD COLUMN IF NOT EXISTS verzend_drempel NUMERIC(8,2) DEFAULT 500.00;

COMMENT ON COLUMN debiteuren.verzendkosten IS
  'Per-klant override op standaard verzendkosten (€). Default 35,00.';
COMMENT ON COLUMN debiteuren.verzend_drempel IS
  'Per-klant drempel waarboven verzending gratis is (€). Default 500,00.';

-- Forceer PostgREST om zijn schema-cache te verversen zodat de nieuwe kolommen
-- direct beschikbaar zijn voor REST/Supabase clients. Anders geeft de eerste
-- update na deploy nog steeds PGRST204 totdat de cache vanzelf vernieuwt.
NOTIFY pgrst, 'reload schema';
