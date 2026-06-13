-- mig 323: Shopify polling-sync (vervangt afhankelijkheid van fragiele webhook)
--
-- Aanleiding: orders #5562-#5577 (23 mei - 4 juni 2026) zijn nooit ingeladen.
-- Onderzoek wees uit dat de `orders/create`-webhook al sinds 15 mei niet meer
-- vuurt (0 invocations) — vermoedelijk verloren bij een shop-domeinwissel
-- (karpi-group.myshopify.com → karpi.myshopify.com) of credential-rotatie.
-- Twee eerdere fixes (mig/commits 6c6bc8a, b86badd) verbeterden matching-logica
-- in sync-shopify-order, maar die code draaide niet — de webhook kwam niet binnen.
--
-- Nieuwe aanpak: een geplande poll (elke 10 min) die de Shopify Admin API
-- bevraagt op orders sinds een watermark. Zelf-helend (gemiste runs worden
-- door de volgende run ingehaald) en met een audit-tabel zodat falen zichtbaar
-- is in RugFlow zelf — analoog aan `edi_berichten` (zie ADR rond EDI-koppeling).

CREATE TABLE shopify_sync_runs (
  id               BIGSERIAL PRIMARY KEY,
  gestart_op       TIMESTAMPTZ NOT NULL DEFAULT now(),
  afgerond_op      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'lopend' CHECK (status IN ('lopend', 'ok', 'fout')),
  shop_domain      TEXT,
  opgehaald        INTEGER NOT NULL DEFAULT 0,
  aangemaakt       INTEGER NOT NULL DEFAULT 0,
  overgeslagen     INTEGER NOT NULL DEFAULT 0,
  fouten           INTEGER NOT NULL DEFAULT 0,
  watermark_voor   TIMESTAMPTZ,
  watermark_na     TIMESTAMPTZ,
  details          JSONB,
  foutmelding      TEXT
);

COMMENT ON TABLE shopify_sync_runs IS
  'Audit-trail van de geplande Shopify-orderpoll (sync-shopify-orders-poll). '
  'Eén rij per run; details bevat per-order resultaat. Voedt monitoring-banner in RugFlow.';

CREATE INDEX idx_shopify_sync_runs_gestart_op ON shopify_sync_runs (gestart_op DESC);

-- ── Watermark ─────────────────────────────────────────────────────────────────
-- Laatst-succesvol-verwerkte Shopify `updated_at`. Volgende run haalt orders
-- op met updated_at > watermark. Start-watermark: 1 mei 2026 (ruim vóór de
-- ontbrekende orders #5562, voor backfill van de hele gap in één keer).
CREATE TABLE shopify_sync_watermark (
  id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  watermark    TIMESTAMPTZ NOT NULL DEFAULT '2026-05-01T00:00:00Z',
  bijgewerkt_op TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO shopify_sync_watermark (id, watermark) VALUES (1, '2026-05-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE shopify_sync_watermark IS
  'Eén-rij-tabel met de laatst verwerkte Shopify order updated_at. '
  'Wordt door sync-shopify-orders-poll na elke succesvolle run vooruitgeschoven.';

-- ── Cron: elke 10 minuten ─────────────────────────────────────────────────────
-- Let op: gebruikt vault.decrypted_secrets (cron_token) + hardcoded project-URL —
-- NIET current_setting('app.supabase_url'/'app.cron_token'), die GUC's bestaan
-- niet op dit project (de bestaande 'poll-email-orders'-cron faalt hierdoor
-- iedere run met "unrecognized configuration parameter app.supabase_url").
-- Dit is het patroon van de wél-werkende crons (transus-poll, hst-send).
SELECT cron.schedule(
  'sync-shopify-orders-poll',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/sync-shopify-orders-poll',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-token',  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_token')
    ),
    body    := '{}'::jsonb
  );
  $$
);
