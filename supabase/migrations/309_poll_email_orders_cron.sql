-- Migratie 309: cron-job voor poll-email-orders (elke 5 minuten)
SELECT cron.schedule(
  'poll-email-orders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/poll-email-orders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-token',  current_setting('app.cron_token', true)
    ),
    body    := '{}'::jsonb
  );
  $$
);
