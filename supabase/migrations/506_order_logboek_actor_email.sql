-- Mig 506: actor-email (gedaan_door) toevoegen aan alle order_events.
--
-- Drie call-sites die order_events schrijven maar nog geen gedaan_door hadden:
--
--   1. _apply_transitie (centraal pad voor statuswijzigingen: annuleren,
--      bevestigen, verzenden, wacht-status herberekenen, enz.)
--      → voeg gedaan_door toe aan metadata als auth.uid() beschikbaar is.
--      Systeemtriggers (geen JWT) krijgen automatisch GEEN gedaan_door.
--
--   2. start_deelzending (deelzending aanmaken)
--      → voeg gedaan_door toe aan bestaand metadata-object.
--
--   3. markeer_prijs_geaccepteerd (prijs €0 bewust accepteren)
--      → voeg gedaan_door toe aan bestaand metadata-object.

-- ---------------------------------------------------------------------------
-- 1. _apply_transitie — centrale actor-email injectie voor alle transitie-events
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _apply_transitie(
  p_order_id             BIGINT,
  p_event_type           order_event_type,
  p_status_na            order_status,
  p_actor_medewerker_id  BIGINT  DEFAULT NULL,
  p_actor_auth_user_id   UUID    DEFAULT NULL,
  p_reden                TEXT    DEFAULT NULL,
  p_metadata             JSONB   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Mig 506: voeg gedaan_door toe aan metadata als er een gebruiker-sessie is.
  -- Systeemtriggers (geen JWT → auth.uid() = NULL) krijgen geen gedaan_door.
  INSERT INTO order_events (
    order_id, event_type, status_voor, status_na,
    actor_medewerker_id, actor_auth_user_id, reden, metadata
  ) VALUES (
    p_order_id, p_event_type, v_status_voor, p_status_na,
    p_actor_medewerker_id, p_actor_auth_user_id, p_reden,
    COALESCE(p_metadata, '{}'::jsonb) ||
      CASE
        WHEN auth.uid() IS NOT NULL
          THEN jsonb_build_object('gedaan_door', huidige_actor_email())
        ELSE '{}'::jsonb
      END
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. start_deelzending — gedaan_door toevoegen aan audit-event
--    (Volledige CREATE OR REPLACE — superset van mig 477/478.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION start_deelzending(
  p_order_id       BIGINT,
  p_regel_ids      BIGINT[],
  p_picker_id      BIGINT,
  p_override_reden TEXT DEFAULT NULL
)
RETURNS TABLE(zending_id BIGINT, zending_nr TEXT, vervoerder_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order        RECORD;
  v_zending_id   BIGINT;
  v_zending_nr   TEXT;
  v_vervoerder   TEXT;
  v_service      TEXT;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  -- Laad order + debiteuren-vlag in één query
  SELECT o.*, d.deelleveringen_toegestaan
    INTO v_order
    FROM orders o
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  -- (e) Eindstatus-guard
  IF v_order.status IN ('Verzonden', 'Geannuleerd') THEN
    RAISE EXCEPTION 'Order % heeft status % — geen deelzending mogelijk',
      p_order_id, v_order.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (d) Deelleveringen toegestaan? — overrulebaar met een verplichte reden.
  IF NOT COALESCE(v_order.deelleveringen_toegestaan, FALSE)
     AND v_order.lever_modus IS DISTINCT FROM 'deelleveringen'
     AND COALESCE(btrim(p_override_reden), '') = '' THEN
    RAISE EXCEPTION
      'Order %: deelleveringen niet toegestaan voor debiteur % '
      '(stel deelleveringen_toegestaan in op de klant of pas lever_modus aan, '
      'of geef een reden op om te overrulen)',
      p_order_id, v_order.debiteur_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (a) Alle regel_ids horen bij deze order?
  IF EXISTS (
    SELECT 1 FROM unnest(p_regel_ids) AS rid
     WHERE NOT EXISTS (
       SELECT 1 FROM order_regels
        WHERE id = rid AND order_id = p_order_id
     )
  ) THEN
    RAISE EXCEPTION 'Niet alle regel_ids horen bij order %', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (b) Alle regels pickbaar?
  IF EXISTS (
    SELECT 1 FROM unnest(p_regel_ids) AS rid
     WHERE NOT EXISTS (
       SELECT 1 FROM orderregel_pickbaarheid op
        WHERE op.order_regel_id = rid
          AND op.is_pickbaar = TRUE
     )
  ) THEN
    RAISE EXCEPTION
      'Niet alle geselecteerde regels zijn pickbaar. '
      'Controleer wacht_op per regel via orderregel_pickbaarheid.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (c) Geen regel al in actieve zending?
  IF EXISTS (
    SELECT 1
      FROM zending_regels zr
      JOIN zendingen z ON z.id = zr.zending_id
     WHERE zr.order_regel_id = ANY(p_regel_ids)
       AND z.status NOT IN ('Afgeleverd')
  ) THEN
    RAISE EXCEPTION
      'Een of meer geselecteerde regels zitten al in een actieve zending. '
      'Voltooi of annuleer die zending eerst.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Vervoerder bepalen
  SELECT evpo.effectief_code, evpo.effectief_service
    INTO v_vervoerder, v_service
    FROM effectieve_vervoerder_per_orderregel(p_order_id) evpo
   WHERE evpo.orderregel_id = ANY(p_regel_ids)
   ORDER BY evpo.orderregel_id ASC
   LIMIT 1;

  -- Maak de deelzending aan — mig 477: 'Gepland', nog niet 'Picken'.
  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr, order_id, status, picker_id,
    vervoerder_code, service_code,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    verzenddatum,
    is_deelzending
  ) VALUES (
    v_zending_nr, p_order_id, 'Gepland', p_picker_id,
    v_vervoerder, v_service,
    v_order.afl_naam, v_order.afl_adres,
    v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
    CURRENT_DATE,
    TRUE
  ) RETURNING id INTO v_zending_id;

  INSERT INTO zending_orders (zending_id, order_id)
  VALUES (v_zending_id, p_order_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
  SELECT v_zending_id, ore.id, ore.orderaantal
    FROM order_regels ore
   WHERE ore.id = ANY(p_regel_ids)
     AND COALESCE(ore.orderaantal, 0) > 0;

  PERFORM genereer_zending_colli(v_zending_id);

  -- Audit-event: deelzending AANGEMAAKT — mig 506: gedaan_door toegevoegd.
  INSERT INTO order_events (order_id, event_type, status_voor, status_na, actor_auth_user_id, metadata)
  SELECT
    p_order_id,
    'deelzending_gestart',
    v_order.status,
    v_order.status,
    auth.uid(),
    jsonb_build_object(
      'zending_id',   v_zending_id,
      'zending_nr',   v_zending_nr,
      'regel_ids',    p_regel_ids,
      'vervoerder',   v_vervoerder,
      'gedaan_door',  huidige_actor_email()
    ) || CASE
      WHEN COALESCE(btrim(p_override_reden), '') <> ''
        THEN jsonb_build_object('deelleveringen_override_reden', btrim(p_override_reden))
      ELSE '{}'::jsonb
    END;

  RETURN QUERY SELECT v_zending_id, v_zending_nr, v_vervoerder;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. markeer_prijs_geaccepteerd — gedaan_door toevoegen
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION markeer_prijs_geaccepteerd(p_order_id BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status order_status;
  v_sinds  TIMESTAMPTZ;
BEGIN
  SELECT status, prijs_ontbreekt_sinds
    INTO v_status, v_sinds
    FROM orders WHERE id = p_order_id;

  UPDATE orders
     SET prijs_ontbreekt_sinds = NULL
   WHERE id = p_order_id;

  INSERT INTO order_events (order_id, event_type, status_na, actor_auth_user_id, metadata)
  VALUES (
    p_order_id,
    'prijs_geaccepteerd',
    v_status,
    auth.uid(),
    jsonb_build_object(
      'geaccepteerd_sinds', v_sinds,
      'migratie',           393,
      'gedaan_door',        huidige_actor_email()
    )
  );
END;
$$;
