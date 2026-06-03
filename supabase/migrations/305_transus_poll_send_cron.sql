-- Migratie 305: pg_cron schedules voor de Transus EDI edge functions
-- Plan: docs/superpowers/plans/2026-04-29-edi-transus-koppeling.md (Step 7/8)
--
-- Zet twee jobs op die elke minuut draaien:
--   * transus-poll  — leegt de M10110-inbox, parseert orders, maakt ze aan (mig
--                     156-159 + poll order-creatie), bevestigt via M10300.
--   * transus-send  — claimt `Wachtrij`-rijen uit edi_berichten en verstuurt de
--                     reeds gebouwde payload via M10100.
--
-- Beide edge functions lezen de cron-token uit de URL-query (?token=...), NIET
-- uit een Authorization-header (anders dan hst-send, mig 173). De cron-call zet
-- de token daarom in de URL.
--
-- Vereist: extensions pg_cron + pg_net + supabase_vault
-- Check: SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net','supabase_vault');
--
-- Project-ref 'wqzeevfobwauxkalagtn' is al ingevuld in de URLs hieronder.
--
-- ⚠️  VOOR APPLY:
--    1. Zorg dat de CRON_TOKEN in Supabase Vault staat onder naam 'cron_token'
--       (kan al bestaan door mig 173). Dezelfde token moet als CRON_TOKEN-secret
--       op de edge functions gezet zijn:
--         SELECT name FROM vault.decrypted_secrets WHERE name='cron_token';
--       Zo niet, eenmalig:
--         SELECT vault.create_secret('<token>', 'cron_token',
--           'Voor pg_cron -> edge functions transus-poll / transus-send / hst-send');
--
-- ⚠️  CUTOVER: schedule deze jobs PAS NADAT Windows Connect op MITS-CA-01-009 is
--    gedeactiveerd. API en Windows Connect mogen niet parallel dezelfde queue
--    consumeren. Tot dat moment kun je deze migratie wel toepassen maar de jobs
--    direct unschedulen, of de migratie pas op het cutover-moment draaien.
--
-- Idempotent: eerst bestaande jobs unschedulen, dan opnieuw schedulen.

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('transus-poll-elke-minuut');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM cron.unschedule('transus-send-elke-minuut');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- Inkomend: elke minuut de M10110-inbox leegtrekken.
SELECT cron.schedule(
  'transus-poll-elke-minuut',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/transus-poll?token='
           || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_token'),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- Uitgaand: elke minuut de Wachtrij draineren via M10100.
SELECT cron.schedule(
  'transus-send-elke-minuut',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/transus-send?token='
           || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_token'),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

COMMENT ON EXTENSION pg_cron IS
  'pg_cron — gebruikt door o.a. transus-poll/transus-send-elke-minuut (mig 305), '
  'hst-send-elke-minuut (mig 173), facturatie-queue-drain (mig 122), '
  'import-lightspeed-orders (mig 053).';
