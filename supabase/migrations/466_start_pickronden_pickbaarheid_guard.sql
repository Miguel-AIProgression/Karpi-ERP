-- Migratie 466: pickbaarheid-guard in start_pickronden.
--
-- Incident 2026-06-22 (ORD-2026-0159 / ZEND-2026-0127): een maatwerk-order
-- waarvan het snijplan-stuk nog op status 'Gepland' stond (nooit gesneden,
-- laat staan ingepakt) is alsnog meegegaan in een verzonden zending. Oorzaak:
-- start_pickronden breidt de geselecteerde orders uit met alles wat via
-- voorgestelde_zending_bundels op hetzelfde adres/vervoerder/week bundelt
-- ('uitgebreid'-CTE), maar checkt op geen moment of die orders (zelf
-- geselecteerd of via bundeling toegevoegd) ook daadwerkelijk pickbaar zijn.
-- Alleen de Pick & Ship-lijst (fetchPickShipOrders) filtert op
-- order_pickbaarheid.pick_ship_zichtbaar — de RPC zelf vertrouwde blind op de
-- meegegeven order_ids én op de bundel-uitbreiding. Een order die toevallig
-- op hetzelfde adres viel als een (terecht of onterecht) pickbare order kon
-- zo meeliften, los van zijn eigen status.
--
-- Fix: dezelfde pick_ship_zichtbaar-voorwaarde als de lijst wordt nu ook
-- binnen start_pickronden afgedwongen, vóór de zending-aanmaak, over de hele
-- (eventueel bundel-uitgebreide) order-set. Geen rij in order_pickbaarheid
-- (bv. een order zonder niet-pseudo-regels) telt als niet-zichtbaar — zelfde
-- semantiek als de lijst.

CREATE OR REPLACE FUNCTION public.start_pickronden(p_order_ids bigint[], p_picker_id bigint, p_force_solo_ids bigint[] DEFAULT '{}'::bigint[])
 RETURNS TABLE(zending_id bigint, zending_nr text, vervoerder_code text, aantal_regels integer, aantal_orders integer, is_nieuw boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_input_count       INTEGER;
  v_force_solo        BIGINT[];
  v_alle_orders       BIGINT[];
  v_eindstatus_nr     TEXT;
  v_eindstatus_order  BIGINT;
  v_picken_order      BIGINT;
  v_geen_verv_nr      TEXT;
  v_niet_pickbaar_nrs TEXT[];
  v_groep             RECORD;
  v_eerste_order      orders%ROWTYPE;
  v_zending_id        BIGINT;
  v_zending_nr        TEXT;
  v_order_id          BIGINT;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  v_input_count := COALESCE(array_length(p_order_ids, 1), 0);
  IF v_input_count = 0 THEN
    RAISE EXCEPTION 'Geen orders meegegeven aan start_pickronden'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_force_solo := COALESCE(
    (SELECT array_agg(DISTINCT fid)
       FROM unnest(COALESCE(p_force_solo_ids, '{}'::BIGINT[])) AS fid
      WHERE fid = ANY(p_order_ids)),
    '{}'::BIGINT[]
  );

  WITH bundel_eligible AS (
    SELECT DISTINCT oid
      FROM unnest(p_order_ids) AS oid
     WHERE oid <> ALL(v_force_solo)
  ),
  uitgebreid AS (
    SELECT oid FROM bundel_eligible
    UNION
    SELECT pid AS oid
      FROM voorgestelde_zending_bundels b
      CROSS JOIN LATERAL unnest(b.order_ids) AS pid
     WHERE b.aantal_orders >= 2
       AND b.order_ids && (SELECT array_agg(oid) FROM bundel_eligible)
       AND pid <> ALL(v_force_solo)
  )
  SELECT array_agg(DISTINCT all_oid) INTO v_alle_orders
    FROM (
      SELECT oid AS all_oid FROM uitgebreid
      UNION
      SELECT fid AS all_oid FROM unnest(v_force_solo) AS fid
    ) merged;

  IF v_alle_orders IS NULL OR array_length(v_alle_orders, 1) = 0 THEN
    RAISE EXCEPTION 'start_pickronden: geen orders in scope na uitbreiding'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Eindstatus-zending guard
  SELECT z.zending_nr, z.order_id
    INTO v_eindstatus_nr, v_eindstatus_order
    FROM zendingen z
    JOIN zending_orders zo ON zo.zending_id = z.id
   WHERE zo.order_id = ANY(v_alle_orders)
     AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
   ORDER BY z.id DESC
   LIMIT 1;

  IF v_eindstatus_nr IS NOT NULL THEN
    RAISE EXCEPTION
      'Order % heeft al zending % in eindstatus. Annuleer of voltooi die eerst in /logistiek voor je een pickronde start.',
      v_eindstatus_order, v_eindstatus_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Lopende-Picken guard
  SELECT zo.order_id INTO v_picken_order
    FROM zendingen z
    JOIN zending_orders zo ON zo.zending_id = z.id
   WHERE zo.order_id = ANY(v_alle_orders)
     AND z.status = 'Picken'
   LIMIT 1;

  IF v_picken_order IS NOT NULL THEN
    RAISE EXCEPTION
      'Order % heeft al een lopende pickronde. Voltooi of annuleer die eerst.',
      v_picken_order
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Geen-vervoerder guard (mig 373): niet-afhaal-order met >=1 regel zonder
  -- effectieve vervoerder (bron='geen') mag geen pickronde starten.
  SELECT o.order_nr INTO v_geen_verv_nr
    FROM unnest(v_alle_orders) AS oid
    JOIN orders o ON o.id = oid
   WHERE COALESCE(o.afhalen, FALSE) = FALSE
     AND EXISTS (
       SELECT 1
         FROM effectieve_vervoerder_per_orderregel(oid) e
        WHERE e.bron = 'geen'
     )
   LIMIT 1;

  IF v_geen_verv_nr IS NOT NULL THEN
    RAISE EXCEPTION
      'Geen vervoerder mogelijk voor order % — activeer de vervoerder voor dit afleverland (Logistiek > Vervoerders) of kies handmatig een vervoerder op de order.',
      v_geen_verv_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Intake-gate-poort (mig 395/396): afleveradres- en prijs-gate.
  PERFORM _valideer_intake_gates(v_alle_orders);

  -- Pickbaarheid-guard (mig 466): elke order in scope — zelf geselecteerd of
  -- via adres-bundeling toegevoegd in de 'uitgebreid'-CTE hierboven — moet
  -- voldoen aan dezelfde pick_ship_zichtbaar-voorwaarde als de Pick & Ship-
  -- lijst (order_pickbaarheid, mig 386). Zonder deze guard kan een nog-niet-
  -- klare order (bv. maatwerk dat nog niet 'Ingepakt' is) ongemerkt meeliften
  -- in dezelfde zending als een wél-klare order op hetzelfde adres.
  SELECT array_agg(o.order_nr ORDER BY o.order_nr)
    INTO v_niet_pickbaar_nrs
    FROM unnest(v_alle_orders) AS oid
    JOIN orders o ON o.id = oid
    LEFT JOIN order_pickbaarheid op ON op.order_id = oid
   WHERE NOT COALESCE(op.pick_ship_zichtbaar, FALSE);

  IF v_niet_pickbaar_nrs IS NOT NULL THEN
    RAISE EXCEPTION
      'Order(s) % zijn nog niet pickbaar (voorraad/maatwerk niet gereed) en kunnen geen pickronde starten.',
      array_to_string(v_niet_pickbaar_nrs, ', ')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Hoofdgroepering — zending-aanmaak per (debiteur × adres × vervoerder × week × solo_marker)
  --
  -- Mig 403: GREATEST-clamp op jaar_week zodat achterstallige orders (verlopen
  -- verzendweek) in dezelfde GROUP-BY-groep landen als lopende-week-orders naar
  -- hetzelfde adres. Toekomstige weken zijn ongewijzigd.
  FOR v_groep IN
    WITH per_regel AS (
      SELECT
        pv.orderregel_id,
        pv.effectief_code                              AS vervoerder_code,
        pv.effectief_service                           AS service_code,
        ore.order_id,
        o.debiteur_nr,
        _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land)
                                                       AS adres_norm,
        -- Clamp: verlopen verzendweek → huidige week zodat cross-week
        -- bundeling werkt. GREATEST is safe op 'YYYY-Www'-strings door de
        -- zero-padded ISO-weeknotatie.
        GREATEST(
          verzendweek_voor_datum(o.afleverdatum),
          verzendweek_voor_datum(CURRENT_DATE)
        )                                              AS jaar_week,
        CASE
          WHEN ore.order_id = ANY(v_force_solo) THEN ore.order_id
          ELSE NULL
        END                                            AS solo_marker
        FROM unnest(v_alle_orders) AS oid
        CROSS JOIN LATERAL effectieve_vervoerder_per_orderregel(oid) pv
        JOIN order_regels ore ON ore.id = pv.orderregel_id
        JOIN orders o ON o.id = oid
    )
    SELECT
      pr.debiteur_nr,
      pr.adres_norm,
      pr.vervoerder_code,
      pr.jaar_week,
      pr.solo_marker,
      MIN(pr.service_code)                                          AS service_code,
      array_agg(DISTINCT pr.order_id)                               AS order_ids,
      array_agg(pr.orderregel_id ORDER BY pr.orderregel_id)         AS orderregel_ids,
      COUNT(*)::INTEGER                                             AS aantal_regels,
      COUNT(DISTINCT pr.order_id)::INTEGER                          AS aantal_orders
      FROM per_regel pr
     GROUP BY pr.debiteur_nr, pr.adres_norm, pr.vervoerder_code, pr.jaar_week, pr.solo_marker
     ORDER BY pr.debiteur_nr, pr.adres_norm, pr.vervoerder_code NULLS FIRST
  LOOP
    SELECT * INTO v_eerste_order FROM orders WHERE id = v_groep.order_ids[1];

    v_zending_nr := volgend_nummer('ZEND');

    INSERT INTO zendingen (
      zending_nr, order_id, status, picker_id, vervoerder_code, service_code,
      afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
      verzenddatum, aantal_colli, totaal_gewicht_kg
    ) VALUES (
      v_zending_nr, v_eerste_order.id, 'Picken', p_picker_id,
      v_groep.vervoerder_code, v_groep.service_code,
      v_eerste_order.afl_naam, v_eerste_order.afl_adres, v_eerste_order.afl_postcode,
      v_eerste_order.afl_plaats, v_eerste_order.afl_land,
      CURRENT_DATE,
      (SELECT COALESCE(SUM(COALESCE(ore.orderaantal, 0)), 0)::INTEGER
         FROM order_regels ore
        WHERE ore.id = ANY(v_groep.orderregel_ids)),
      (SELECT NULLIF(
                ROUND(COALESCE(SUM(COALESCE(ore.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0), 2),
                0
              )
         FROM order_regels ore
        WHERE ore.id = ANY(v_groep.orderregel_ids))
    ) RETURNING id INTO v_zending_id;

    INSERT INTO zending_orders (zending_id, order_id)
    SELECT v_zending_id, ord_id FROM unnest(v_groep.order_ids) AS ord_id
    ON CONFLICT DO NOTHING;

    INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
    SELECT v_zending_id, ore.id, ore.orderaantal
      FROM order_regels ore
     WHERE ore.id = ANY(v_groep.orderregel_ids)
       AND COALESCE(ore.orderaantal, 0) > 0;

    PERFORM genereer_zending_colli(v_zending_id);

    RETURN QUERY SELECT
      v_zending_id, v_zending_nr,
      v_groep.vervoerder_code,
      v_groep.aantal_regels,
      v_groep.aantal_orders,
      TRUE AS is_nieuw;
  END LOOP;

  -- ADR-0016: na zending-aanmaak status per order flippen naar 'In pickronde'.
  FOREACH v_order_id IN ARRAY v_alle_orders LOOP
    PERFORM markeer_pickronde_gestart(
      p_order_id            := v_order_id,
      p_actor_medewerker_id := p_picker_id
    );
  END LOOP;
END;
$function$;
