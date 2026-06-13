-- Migratie 376: pg_cron schedule voor de verhoek-send edge function
-- Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md
-- Spiegelt mig 173 (hst-send). Vault-secret 'cron_token' bestaat al.
--
-- Idempotent.

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('verhoek-send-elke-minuut');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

SELECT cron.schedule(
  'verhoek-send-elke-minuut',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/verhoek-send',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_token'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
