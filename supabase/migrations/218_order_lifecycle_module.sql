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

-- 5. Command — markeer_geannuleerd
CREATE OR REPLACE FUNCTION markeer_geannuleerd(
  p_order_id            BIGINT,
  p_reden               TEXT,
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
  IF v_huidig = 'Verzonden' THEN
    RAISE EXCEPTION 'Verzonden order % kan niet meer worden geannuleerd', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'geannuleerd',
    p_status_na           := 'Geannuleerd',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id,
    p_reden               := p_reden
  );
END;
$$;

GRANT EXECUTE ON FUNCTION markeer_geannuleerd(BIGINT, TEXT, BIGINT, UUID) TO authenticated;

COMMENT ON FUNCTION markeer_geannuleerd IS
  'Mig 218 (ADR-0006): zet orders.status=Geannuleerd + audit-event. '
  'Reden verplicht voor audit-trail. Faalt op reeds verzonden orders.';

-- 6. Recompute — herbereken_wacht_status
-- Bevat alleen de status-keuze. De claim-checks + afleverdatum-sync
-- blijven in herwaardeer_order_status (mig 153, geüpdatet in Task 1.8).
CREATE OR REPLACE FUNCTION herbereken_wacht_status(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig order_status;
  v_heeft_io_claim BOOLEAN;
  v_heeft_tekort BOOLEAN;
  v_doel order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;

  -- Eindstatussen + actieve productie/picking niet aanraken (compatibel met mig 153).
  -- Bij pad-strict (Task 1.10): de laatste 5 leden zijn dood — CHECK garandeert
  -- dat ze niet bestaan op orders. Bij pad-pragmatisch: ze tolereren legacy data.
  -- Defensief consistent in beide paden; opruimen volgt in vervolg-iteratie als
  -- pad-strict gekozen is (zie Task 1.11 sentinel-cleanup-scope).
  IF v_huidig IN (
    'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
    'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken'
  ) THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    WHERE oreg.order_id = p_order_id
      AND r.bron = 'inkooporder_regel'
      AND r.status = 'actief'
  ) INTO v_heeft_io_claim;

  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = false
      AND oreg.artikelnr IS NOT NULL
      AND oreg.te_leveren > COALESCE((
        SELECT SUM(aantal) FROM order_reserveringen r
        WHERE r.order_regel_id = oreg.id AND r.status = 'actief'
      ), 0)
  ) INTO v_heeft_tekort;

  IF v_heeft_io_claim THEN
    v_doel := 'Wacht op inkoop';
  ELSIF v_heeft_tekort THEN
    v_doel := 'Wacht op voorraad';
  ELSIF v_huidig IN ('Wacht op inkoop', 'Wacht op voorraad') THEN
    v_doel := 'Nieuw';
  ELSE
    RETURN; -- niets te doen
  END IF;

  PERFORM _apply_transitie(
    p_order_id   := p_order_id,
    p_event_type := 'wacht_status_herberekend',
    p_status_na  := v_doel
  );
END;
$$;

GRANT EXECUTE ON FUNCTION herbereken_wacht_status(BIGINT) TO authenticated;

COMMENT ON FUNCTION herbereken_wacht_status IS
  'Mig 218 (ADR-0006): leest claim-state, kiest Wacht op X / Nieuw, schrijft via _apply_transitie. '
  'Eindstatussen + actieve productie/picking-statussen worden niet aangeraakt. '
  'Wordt aangeroepen door herwaardeer_order_status (mig 153) en kan ook handmatig.';

-- 7. Backfill: één synthetisch event per bestaande order
-- 'aangemaakt' op orders.orderdatum (DATE → cast naar timestamptz), plus
-- 'pickronde_voltooid' als verzonden_at gevuld. Idempotent: NOT EXISTS-guard.
--
-- Noot: orders heeft geen aangemaakt_op-kolom — orderdatum is de beste
-- proxy voor ontstaan-moment. Voor strikte audit-rapportage zijn historische
-- timestamps benaderend; nieuwe events na mig 218 hebben created_at = now().
INSERT INTO order_events (order_id, event_type, status_voor, status_na, created_at, metadata)
SELECT
  o.id,
  'aangemaakt'::order_event_type,
  NULL,
  o.status,
  COALESCE(o.orderdatum::timestamptz, now()),
  jsonb_build_object('backfill', true)
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM order_events oe
  WHERE oe.order_id = o.id AND oe.event_type = 'aangemaakt'
);

INSERT INTO order_events (order_id, event_type, status_voor, status_na, created_at, metadata)
SELECT
  o.id,
  'pickronde_voltooid'::order_event_type,
  NULL,
  'Verzonden'::order_status,
  o.verzonden_at,
  jsonb_build_object('backfill', true)
FROM orders o
WHERE o.verzonden_at IS NOT NULL
  AND o.status = 'Verzonden'
  AND NOT EXISTS (
    SELECT 1 FROM order_events oe
    WHERE oe.order_id = o.id AND oe.event_type = 'pickronde_voltooid'
  );

-- 8. Herdefinitie voltooi_pickronde — order-status-write delegeren aan markeer_verzonden
CREATE OR REPLACE FUNCTION voltooi_pickronde(
  p_zending_id BIGINT,
  p_picker_id  BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig             zending_status;
  v_aantal_niet_gev    INTEGER;
  v_order_id           BIGINT;
  v_open_zendingen     INTEGER;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  SELECT status, order_id INTO v_huidig, v_order_id
    FROM zendingen WHERE id = p_zending_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;
  IF v_huidig <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde voor zending % is niet actief (status=%)', p_zending_id, v_huidig;
  END IF;

  SELECT COUNT(*) INTO v_aantal_niet_gev
    FROM zending_colli
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'niet_gevonden';
  IF v_aantal_niet_gev > 0 THEN
    RAISE EXCEPTION 'Pickronde heeft % openstaand(e) pick-probleem(en) — los op of splits eerst',
      v_aantal_niet_gev USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE zending_colli
     SET pick_uitkomst   = 'gepickt',
         gepickt_at      = now(),
         gepickt_door_id = p_picker_id
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'open';

  UPDATE zendingen
     SET status    = 'Klaar voor verzending',
         picker_id = COALESCE(picker_id, p_picker_id)
   WHERE id = p_zending_id;

  -- Sluitstuk factuur-keten: bij laatste open zending, delegeer naar Order-lifecycle
  SELECT COUNT(*) INTO v_open_zendingen
    FROM zendingen
   WHERE order_id = v_order_id
     AND status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd', 'Geannuleerd');

  IF v_open_zendingen = 0 THEN
    -- Skip voor reeds-Verzonden of Geannuleerde orders (markeer_verzonden zou
    -- exception gooien op Geannuleerd; mig 217 deed silent-skip via WHERE-clause).
    IF NOT EXISTS (
      SELECT 1 FROM orders
       WHERE id = v_order_id
         AND status IN ('Verzonden', 'Geannuleerd')
    ) THEN
      PERFORM markeer_verzonden(
        p_order_id            := v_order_id,
        p_actor_medewerker_id := p_picker_id
      );
      -- Tot mig 219: factuur-trigger trg_enqueue_factuur vuurt op de orders.status-UPDATE.
      -- Na mig 219: trg_enqueue_factuur is gedropt; trg_enqueue_factuur_op_event
      -- vuurt op de bijbehorende order_events-INSERT (gedaan door _apply_transitie).
    END IF;
  END IF;

  RETURN p_zending_id;
END;
$$;

COMMENT ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) IS
  'Mig 218 (ADR-0006): voltooit Pickronde, delegeert order-status-write aan markeer_verzonden. '
  'Vervangt mig 217-versie die orders direct UPDATE-de.';

-- 9. Herdefinitie herwaardeer_order_status — delegeert status-write aan Module
CREATE OR REPLACE FUNCTION herwaardeer_order_status(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  -- Module bepaalt status (Wacht op X / Nieuw / no-op bij eindstatus)
  PERFORM herbereken_wacht_status(p_order_id);

  -- Mig 153 verantwoordelijkheid behouden: afleverdatum vooruit syncen
  PERFORM sync_order_afleverdatum_met_claims(p_order_id);
END;
$$;

COMMENT ON FUNCTION herwaardeer_order_status IS
  'Mig 218 (ADR-0006): herwaardeert order — delegeert status-keuze aan Order-lifecycle Module '
  '(herbereken_wacht_status) en blijft afleverdatum-sync eigen (sync_order_afleverdatum_met_claims). '
  'Backwards-compat: alle bestaande callers (triggers, RPCs) blijven dezelfde signature aanroepen.';
