-- Migratie 567: start_deelzending blokkeert nu ook een order die op
-- 'Wacht op combi-levering' staat (ADR-0040/Anker 4, audit-blocker 02-07).
--
-- Probleem: start_deelzending's eindstatus-guard toetste alleen op
-- 'Verzonden'/'Geannuleerd'. Een Combi-levering-wachtende order viel daar
-- doorheen: de RPC maakte gewoon een 'Gepland'-zending aan (mig 477), die de
-- order via de actieve-zending-OR-tak in order_pickbaarheid (mig 476) weer
-- zichtbaar maakte in Pick & Ship en dus alsnog gepickt/verzonden kon
-- worden — een stille bypass van de vrachtvrije-drempeltoets: geen
-- drempeltoets, geen VERZEND-regel, geen reden-audit, geen sibling-herwaar-
-- dering (mig 561). De bedoelde route voor "toch nu al verzenden" is de
-- order-niveau combi_levering_override ("Toch verzenden met verzendkosten",
-- mig 553), die de status, de VERZEND-regel én de siblings netjes
-- herwaardeert.
--
-- Fix: één extra guard direct ná de bestaande eindstatus-guard (e), vóór de
-- deelleveringen-toegestaan-check (d) — een deelzending-poging op een
-- wachtende order faalt nu hard met een duidelijke verwijzing naar de
-- override-route, in plaats van stilletjes te slagen.
--
-- Pre-flight (02-07): live body hieronder 1-op-1 overgenomen uit
-- pg_get_functiondef (signature/DECLARE/queries ongewijzigd); enige
-- toevoeging is de nieuwe IF-guard. Geen wijziging aan p_override_reden-
-- gedrag: die overrulet nog altijd alleen de deelleveringen_toegestaan-check
-- (d), niet de nieuwe Combi-levering-guard — de combi-override is een apart,
-- expliciet mechanisme (mig 553), geen vrije-tekst-override op deze RPC.

CREATE OR REPLACE FUNCTION public.start_deelzending(p_order_id bigint, p_regel_ids bigint[], p_picker_id bigint, p_override_reden text DEFAULT NULL::text)
 RETURNS TABLE(zending_id bigint, zending_nr text, vervoerder_code text)
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

  -- Mig 567 (ADR-0040/Anker 4): een Combi-levering-wachtende order mag niet
  -- via een deelzending stilletjes ontsnappen — de bedoelde route is de
  -- order-override ("Toch verzenden met verzendkosten"), die de status, de
  -- VERZEND-regel én de siblings netjes herwaardeert (mig 561).
  IF v_order.status = 'Wacht op combi-levering' THEN
    RAISE EXCEPTION 'Order % wacht op Combi-levering (vrachtvrije drempel nog niet gehaald). Zet eerst "Toch verzenden met verzendkosten" (combi-levering-override) aan op de order voordat je een deelzending start.', v_order.order_nr
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
$function$
;

COMMENT ON FUNCTION public.start_deelzending(bigint, bigint[], bigint, text) IS
  'Start een deelzending voor een subset orderregels (mig 413, override-reden '
  'mig 473). Guards: (e) eindstatus, (d) deelleveringen-toestemming '
  '(overrulebaar met reden), (a) regels horen bij order, (b) alle regels '
  'pickbaar, (c) geen regel al in actieve zending. Mig 567 (ADR-0040/Anker 4): '
  'extra guard direct na (e) — een order op ''Wacht op combi-levering'' mag '
  'niet via een deelzending ontsnappen aan de vrachtvrije-drempeltoets; '
  'gebruik de combi-levering-override (mig 553) op de order in plaats daarvan.';

NOTIFY pgrst, 'reload schema';
