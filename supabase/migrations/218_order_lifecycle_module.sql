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

-- 3. Interne helper — atomair: UPDATE orders + INSERT order_events
CREATE OR REPLACE FUNCTION _apply_transitie(
  p_order_id            BIGINT,
  p_event_type          order_event_type,
  p_status_na           order_status,
  p_actor_medewerker_id BIGINT DEFAULT NULL,
  p_actor_auth_user_id  UUID   DEFAULT NULL,
  p_reden               TEXT   DEFAULT NULL,
  p_metadata            JSONB  DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_status_voor order_status;
  v_zet_verzonden_at BOOLEAN;
BEGIN
  SELECT status INTO v_status_voor FROM orders WHERE id = p_order_id;
  IF v_status_voor IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- No-op als status al gelijk is (idempotent).
  IF v_status_voor = p_status_na THEN
    RETURN;
  END IF;

  v_zet_verzonden_at := (p_status_na = 'Verzonden');

  UPDATE orders
     SET status = p_status_na,
         verzonden_at = CASE
           WHEN v_zet_verzonden_at AND verzonden_at IS NULL THEN now()
           ELSE verzonden_at
         END
   WHERE id = p_order_id;

  INSERT INTO order_events (
    order_id, event_type, status_voor, status_na,
    actor_medewerker_id, actor_auth_user_id, reden, metadata
  ) VALUES (
    p_order_id, p_event_type, v_status_voor, p_status_na,
    p_actor_medewerker_id, p_actor_auth_user_id, p_reden, p_metadata
  );
END;
$$;

COMMENT ON FUNCTION _apply_transitie IS
  'Mig 218: interne helper — enige plek in de codebase die UPDATE orders SET status doet. '
  'Atomair: status + verzonden_at (bij Verzonden) + INSERT order_events. '
  'Idempotent: no-op als status al gelijk is. Niet rechtstreeks aanroepen — gebruik '
  'markeer_verzonden / markeer_geannuleerd / herbereken_wacht_status.';

-- 4. Command — markeer_verzonden
CREATE OR REPLACE FUNCTION markeer_verzonden(
  p_order_id            BIGINT,
  p_actor_medewerker_id BIGINT DEFAULT NULL,
  p_actor_auth_user_id  UUID   DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_huidig = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Geannuleerde order % kan niet op Verzonden worden gezet', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'pickronde_voltooid',
    p_status_na           := 'Verzonden',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION markeer_verzonden(BIGINT, BIGINT, UUID) TO authenticated;

COMMENT ON FUNCTION markeer_verzonden IS
  'Mig 218 (ADR-0006): zet orders.status=Verzonden + verzonden_at=now() + audit-event. '
  'Caller: voltooi_pickronde (mig 217 update) of frontend handmatig. '
  'Idempotent. Faalt op geannuleerde orders.';
