-- Migratie 249: drop oude pickronde-start RPC's (ADR-0012)
--
-- Mig 248 introduceerde `start_pickronden(order_ids[], picker_id, force_solo_ids[])`
-- als canonieke vervanger voor de twee oude entry-points:
--   · `start_pickronden_voor_order(BIGINT, BIGINT)` (mig 220)
--   · `start_pickronden_bundel(BIGINT[], BIGINT)`   (mig 222)
--
-- Frontend (zendingen.ts + BulkVerzendsetButton/VerzendsetButton) is in
-- dezelfde commit-keten gemigreerd naar `start_pickronden`. Deze migratie
-- droppt de oude functies om "twee paden voor één concept" definitief op te
-- ruimen — voorkomt dat toekomstige callers per ongeluk opnieuw de solo-RPC
-- aanroepen en daarmee de 4D-bundel-auto-uitbreiding omzeilen.
--
-- `start_pickronde(BIGINT, BIGINT)` blijft in mig 248 bestaan als dunne
-- wrapper voor single-id-callers (test-suites + `useStartPickronde`-export).
--
-- Idempotent: DROP FUNCTION IF EXISTS.

DROP FUNCTION IF EXISTS start_pickronden_voor_order(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS start_pickronden_bundel(BIGINT[], BIGINT);

NOTIFY pgrst, 'reload schema';
