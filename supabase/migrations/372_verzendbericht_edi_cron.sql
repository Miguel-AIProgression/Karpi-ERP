-- Migratie 372: cron-sweep voor uitgaande EDI-verzendberichten (DESADV)
-- Plan: docs/superpowers/plans/2026-06-11-universele-communicatie-knoppen.md (slice 4)
--
-- Elke 15 minuten: bouw-verzendbericht-edi sweep't verzonden EDI-orders van
-- partners met verzend_uit && transus_actief en zet ontbrekende verzendberichten
-- op de wachtrij. transus-send (mig 305) verstuurt ze daarna.
--
-- ⚠️ NIET TOEPASSEN vóór format-validatie in Transus' Testen-tab (Task 12
-- stap 5) — tot die tijd gooit de builder bewust een fout en zou elke sweep
-- error-results loggen.
--
-- Patroon: gelijk aan mig 305 (transus-poll/transus-send).
-- Project-ref 'wqzeevfobwauxkalagtn' is ingevuld.
-- Vault-secret 'cron_token' is aangemaakt in mig 305 / mig 173.
-- Check: SELECT name FROM vault.decrypted_secrets WHERE name='cron_token';
--
-- Idempotent: eerst bestaande job unschedulen, dan opnieuw schedulen.

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('verzendbericht-edi-sweep');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

SELECT cron.schedule(
  'verzendbericht-edi-sweep',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/bouw-verzendbericht-edi?token='
           || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_token'),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
