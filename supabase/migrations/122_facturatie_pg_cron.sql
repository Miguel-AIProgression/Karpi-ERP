-- Migration 122: pg_cron jobs voor facturatie
-- Vereist: extensions pg_cron + pg_net (check: SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net');)
--
-- ⚠️  VOOR APPLY: vervang <PROJECT_REF> hieronder door de werkelijke Supabase project-ref.
--     Ook vereist: ALTER DATABASE postgres SET "app.settings.service_role_key" = '<service-role-key>';
--     Zie: https://supabase.com/docs/guides/functions/schedule-functions

-- Drain elke minuut: roept edge function factuur-verzenden aan om pending-items af te handelen
SELECT cron.schedule(
  'facturatie-queue-drain',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/factuur-verzenden',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Recovery elke 5 minuten: zet stuck 'processing' items terug op 'pending'
SELECT cron.schedule(
  'facturatie-queue-recovery',
  '*/5 * * * *',
  $$SELECT recover_stuck_factuur_queue();$$
);

-- Wekelijkse verzamelfactuur: maandag 05:00 UTC (= winter 06:00 / zomer 07:00 NL-tijd).
-- Verzamelt alle nog niet gefactureerde 'Verzonden'-orders per debiteur met factuurvoorkeur='wekelijks'
-- en plaatst die als bulk-item in de queue. De drain pikt ze daarna op.
CREATE OR REPLACE FUNCTION enqueue_wekelijkse_verzamelfacturen() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO factuur_queue (debiteur_nr, order_ids, type)
  SELECT
    o.debiteur_nr,
    ARRAY_AGG(o.id ORDER BY o.id),
    'wekelijks'
  FROM orders o
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  WHERE d.factuurvoorkeur = 'wekelijks'
    AND o.status = 'Verzonden'
    AND o.id NOT IN (SELECT order_id FROM factuur_regels)
  GROUP BY o.debiteur_nr
  HAVING COUNT(*) > 0;
END;
$$;

COMMENT ON FUNCTION enqueue_wekelijkse_verzamelfacturen IS
  'Plaatst per klant met factuurvoorkeur=wekelijks één bulk-queue-item met alle '
  'nog niet gefactureerde verzonden orders. Aangeroepen door pg_cron maandag 05:00 UTC.';

SELECT cron.schedule(
  'facturatie-wekelijks',
  '0 5 * * 1',
  $$SELECT enqueue_wekelijkse_verzamelfacturen();$$
);
