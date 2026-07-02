-- Migratie 577: drop dode RPC's (architectuur-audit 2026-07-02, Task 2.5).
-- Verificatie vooraf (orchestrator, via supabase db query --linked):
-- geen SQL-callers (pg_proc.prosrc-scan; enige hit = een comment in
-- trg_zending_set_verzendweek), geen cron-jobs, geen frontend/edge-callers
-- (alleen stale comments — zie de begeleidende frontend-commit).
-- start_pickronde + create_zending_voor_order vormden een dode keten
-- (mig 249 hield start_pickronde "voor de useStartPickronde-export", die is
-- in deze branch verwijderd). Live pad = start_pickronden (mig 248+).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('start_pickronden_voor_order','start_pickronden_bundel',
                        'genereer_factuur_voor_bundel','start_pickronde',
                        'create_zending_voor_order')
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;
