-- Migratie 380: pg_cron schedule voor de rhenus-send edge function
-- Plan: docs/superpowers/plans/2026-06-12-rhenus-transporteur-gs1-xml-sftp.md
-- Spiegelt mig 376 (verhoek-send). Vault-secret 'cron_token' bestaat al.
-- Veilig om direct te draaien: de wachtrij blijft leeg zolang rhenus_sftp
-- actief=FALSE is, en zelfs gevuld is het dry-run (RHENUS_DRY_RUN default).
--
-- Idempotent.

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('rhenus-send-elke-minuut');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

SELECT cron.schedule(
  'rhenus-send-elke-minuut',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/rhenus-send',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_token'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
