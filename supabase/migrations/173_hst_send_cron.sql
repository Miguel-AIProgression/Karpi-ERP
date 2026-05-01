-- Migratie 173: pg_cron schedule voor de hst-send edge function
-- Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md (Task 2.5)
--
-- Vereist: extensions pg_cron + pg_net + supabase_vault
-- Check: SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net','supabase_vault');
--
-- ⚠️  VOOR APPLY:
--    1. Vervang <PROJECT_REF> hieronder door de Supabase project-ref
--       (bv. 'wqzeevfobwauxkalagtn').
--
--    2. Sla de CRON_TOKEN op in Supabase Vault (EENMALIG, kan al bestaan voor
--       andere edge-function-cron-jobs):
--
--         SELECT vault.create_secret(
--           '<cron-token-uit-edge-function-secrets>',
--           'cron_token',
--           'Voor pg_cron → edge functions hst-send / transus-send / etc.'
--         );
--
--       Of update bestaande:
--         SELECT name FROM vault.decrypted_secrets WHERE name='cron_token';
--
-- Idempotent: eerst bestaande job unschedulen, dan opnieuw schedulen.

-- Unschedule bestaande job (no-op als hij niet bestaat)
DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('hst-send-elke-minuut');
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- job bestond niet, geen probleem
  END;
END $$;

-- Elke minuut: edge function hst-send aanroepen om wachtrij-rijen in
-- hst_transportorders te verwerken. Vergelijkbaar met facturatie-queue-drain
-- (mig 122) — Bearer-token in header. Edge function checkt token en
-- claimed/verwerkt tot MAX_PER_RUN rijen per invocatie.
SELECT cron.schedule(
  'hst-send-elke-minuut',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/hst-send',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_token'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

COMMENT ON EXTENSION pg_cron IS
  'pg_cron — gebruikt door o.a. hst-send-elke-minuut (mig 173), '
  'facturatie-queue-drain (mig 122), import-lightspeed-orders (mig 053).';
