-- Migratie 226: hotfix — registreer pg_cron-job `facturatie-queue-drain`
--
-- Diagnose 2026-05-08: factuur_queue had 7 rijen op `pending` met `attempts=0`
-- en `processed_at=NULL` ondanks dat trigger `trg_enqueue_factuur_op_event`
-- (mig 223) correct vuurt. Oorzaak: in `cron.job_run_details` staat alléén
-- `facturatie-queue-recovery` te runnen; de drain-job ontbreekt. Mig 122
-- introduceerde de drain met letterlijk `<PROJECT_REF>` als placeholder die
-- vóór apply handmatig vervangen moest worden — bij apply op productie is dat
-- niet gebeurd, dus de scheduled command (of de hele job) is nooit
-- functioneel geweest.
--
-- Deze migratie zet de job vast met de juiste URL. Project-ref komt uit
-- `frontend/.env` (`VITE_SUPABASE_URL=https://wqzeevfobwauxkalagtn.supabase.co`).
-- Service-role-key in `vault.decrypted_secrets.service_role_key` is al aanwezig.
--
-- Idempotent: eerst unschedule (no-op als hij niet bestaat), dan re-schedule.
-- Raakt `facturatie-queue-recovery` en `facturatie-wekelijks` niet — die
-- staan los en lopen. De recovery-job zet stuck `processing` items terug
-- naar `pending`; dat is een ander pad.

DO $$ BEGIN
  PERFORM cron.unschedule('facturatie-queue-drain');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'facturatie-queue-drain',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/factuur-verzenden',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
