-- Migratie 218: Order-lifecycle Module (ADR-0006)
--
-- Introduceert order_events (typed audit-log van orders.status-overgangen) +
-- drie RPCs (markeer_verzonden, markeer_geannuleerd, herbereken_wacht_status)
-- die als enige orders.status muteren via _apply_transitie.
--
-- Sluit het patroon dat ADR-0005 doorpunt'te: orders.status had geen eigenaar.
-- Met deze migratie is er één schrijfpad; alle bestaande writers (mig 144/153,
-- mig 217 voltooi_pickronde, frontend annulerings-UI) gaan via deze RPCs.
--
-- Idempotent: enum via DO-block, tabel via CREATE TABLE IF NOT EXISTS,
-- RPCs via CREATE OR REPLACE.

-- 1. Enum order_event_type
DO $$ BEGIN
  CREATE TYPE order_event_type AS ENUM (
    'aangemaakt',
    'pickronde_voltooid',
    'wacht_status_herberekend',
    'geannuleerd'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Tabel order_events (append-only)
CREATE TABLE IF NOT EXISTS order_events (
  id                    BIGSERIAL PRIMARY KEY,
  order_id              BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type            order_event_type NOT NULL,
  status_voor           order_status,
  status_na             order_status NOT NULL,
  actor_medewerker_id   BIGINT REFERENCES medewerkers(id) ON DELETE SET NULL,
  actor_auth_user_id    UUID   REFERENCES auth.users(id)   ON DELETE SET NULL,
  reden                 TEXT,
  metadata              JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT order_events_actor_xor CHECK (
    NOT (actor_medewerker_id IS NOT NULL AND actor_auth_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS order_events_order_idx
  ON order_events(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS order_events_type_idx
  ON order_events(event_type, created_at DESC);

COMMENT ON TABLE order_events IS
  'Mig 218 (ADR-0006): typed audit-log van orders.status-overgangen. '
  'Bron-van-waarheid voor wie/wanneer/waarom een transitie deed. '
  'Geschreven door _apply_transitie binnen Order-lifecycle Module.';
