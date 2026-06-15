-- Migratie 402: cron-sweep voor de verzendbevestiging-mail met pakbon
--
-- Elke 15 minuten: stuur-verzendbevestiging sweep't verzonden orders en stuurt
-- voor elke zending zonder verzendbevestiging (zendingen.verzendbevestiging_
-- verstuurd_op IS NULL) een Karpi-mail met pakbon-PDF naar het afleveradres.
-- Idempotent op de gate-kolom (mig 401), dus dubbel-vuren is veilig.
--
-- ⚠️ DEPLOY-VOORWAARDE: mig 401 + de edge function stuur-verzendbevestiging
-- moeten live staan vóór deze cron actief wordt; secrets MS_GRAPH_* + FROM_EMAIL
-- + CRON_TOKEN zijn al aanwezig (gedeeld met factuur-verzenden / transus-send).
--
-- Patroon: gelijk aan mig 377 (verzendbericht-edi-sweep).
-- Project-ref 'wqzeevfobwauxkalagtn'. Vault-secret 'cron_token' (mig 173/305).

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('verzendbevestiging-sweep');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

SELECT cron.schedule(
  'verzendbevestiging-sweep',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/stuur-verzendbevestiging?token='
           || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_token'),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
