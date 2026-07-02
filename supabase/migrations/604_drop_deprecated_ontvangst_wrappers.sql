-- Migratie 604: DROP deprecated ontvangst-wrappers (mig 271, deadline 2026-07-13)
--
-- boek_ontvangst / boek_voorraad_ontvangst waren thin wrappers rond
-- boek_inkooporder_ontvangst_rollen / _stuks. De laatste caller (frontend
-- use-boek-ontvangst) is omgezet (Task 1 van dit plan).
-- ⚠ APPLY-VOORWAARDE: pas draaien NA merge naar main + Vercel-deploy — de
-- oude live frontend roept de wrappers anders nog aan.

DROP FUNCTION IF EXISTS boek_ontvangst(BIGINT, JSONB, TEXT);
DROP FUNCTION IF EXISTS boek_voorraad_ontvangst(BIGINT, INTEGER, TEXT);

NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'Migratie 604 toegepast: deprecated ontvangst-wrappers verwijderd.';
END $$;
