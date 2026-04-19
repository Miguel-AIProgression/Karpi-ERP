-- Cron job: haal elke 2 minuten betaalde Lightspeed orders op via bestaande function.
-- Roept sync-webshop-order aan met ?mode=import (geen webhook, maar pull via API).
-- Vereist: pg_cron + pg_net extensies (standaard actief op Supabase).

select cron.schedule(
  'import-lightspeed-orders',
  '*/2 * * * *',
  $$
  select net.http_post(
    url     := 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/sync-webshop-order?mode=import',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer sb_publishable_ZlFLMUNPwVy__jVb4Hoevg_FOvUIoVI"}'::jsonb,
    body    := '{}'::jsonb
  ) as request_id;
  $$
);
