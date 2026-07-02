-- Migratie 555: bundel-expansie in start_pickronden negeert niet-pickbare hitchhikers
--
-- Bug (gemeld door gebruiker, ZITMAXX-bundel 2461EX TER AAR)
-- ------------------------------------------------------------
-- Pick & Ship toonde een BUNDEL-kaart met 8 pickbare ZITMAXX-orders (adres
-- 2461EX TER AAR, vervoerder hst_api). "Bundel printen" op die 8 faalde met:
--   "Order(s) ORD-2026-0137 zijn nog niet pickbaar (voorraad/maatwerk niet
--    gereed) en kunnen geen pickronde starten." (22023)
-- — terwijl ORD-2026-0137 nergens in de getoonde lijst van 8 stond.
--
-- Root cause (geverifieerd op live data)
-- ---------------------------------------
-- ORD-2026-0137 hoort bij dezelfde debiteur (ZITMAXX) en hetzelfde adres als
-- de zichtbare 8, maar staat op status 'Wacht op inkoop'
-- (order_pickbaarheid.pick_ship_zichtbaar = false) — terecht onzichtbaar in
-- Pick & Ship (fetchPickShipOrders filtert daar al op).
--
-- `start_pickronden`'s 'uitgebreid'-CTE breidt de door de operator
-- geselecteerde orders echter blind uit met ALLE order_ids uit
-- `voorgestelde_zending_bundels` die hetzelfde adres/vervoerder/week delen —
-- die view checkt bewust geen pickbaarheid (is een pure bundel-preview, mig
-- 229/403/535/536). ORD-2026-0137 werd zo, ongevraagd en onzichtbaar voor de
-- operator, aan v_alle_orders toegevoegd. De pickbaarheid-guard (mig 466)
-- controleert vervolgens ALLE orders in v_alle_orders in één keer en gooit
-- bij de eerste niet-pickbare hit een exception voor de HELE aanroep — ook
-- voor de 8 orders die wél klaar waren en die de operator wél had geselecteerd.
--
-- Fix
-- ---
-- De 'uitgebreid'-CTE neemt een bundel-order alleen over als die zelf ook
-- `pick_ship_zichtbaar` is (join op order_pickbaarheid). Een niet-klare
-- hitchhiker wordt zo stilzwijgend NIET aan de zending toegevoegd — hij blijft
-- gewoon liggen tot hij zelf pickbaar is (of via een latere, eigen pickronde).
-- De pickbaarheid-guard (mig 466) blijft ongewijzigd als defense-in-depth:
-- die triggert nu alleen nog als een EXPLICIET geselecteerde of force-solo
-- order zelf niet pickbaar blijkt (bv. stale frontend-cache) — in dat geval
-- is de foutmelding ook weer zinvol, want de genoemde order(s) zijn dan altijd
-- orders die de operator ook echt bedoelde te starten.
--
-- Verder ongewijzigd t.o.v. mig 536: 1-week-vooruit-clamp, alle guards,
-- Gepland-zending-promotie (mig 477), is_locked/is_pickbaar regel-filter
-- (mig 477/479).

CREATE OR REPLACE FUNCTION public.start_pickronden(
  p_order_ids bigint[],
  p_picker_id bigint,
  p_force_solo_ids bigint[] DEFAULT '{}'::bigint[]
)
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
  v_promoted          RECORD;
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

  -- Mig 555: de bundel-expansie-tak neemt een order uit
  -- voorgestelde_zending_bundels alleen over als die zelf ook
  -- pick_ship_zichtbaar is — een niet-klare hitchhiker mag niet ongevraagd
  -- de hele start_pickronden-aanroep blokkeren (zie migratie-header).
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
      JOIN order_pickbaarheid opb ON opb.order_id = pid
     WHERE b.aantal_orders >= 2
       AND b.order_ids && (SELECT array_agg(oid) FROM bundel_eligible)
       AND pid <> ALL(v_force_solo)
       AND opb.pick_ship_zichtbaar
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

  -- Geen-vervoerder guard (mig 373)
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

  -- Intake-gate-poort (mig 395/396)
  PERFORM _valideer_intake_gates(v_alle_orders);

  -- Pickbaarheid-guard (mig 466) — sinds mig 555 vrijwel altijd een no-op
  -- voor bundel-hitchhikers (die worden nu al bij de uitbreiding uitgesloten).
  -- Blijft staan als defense-in-depth voor de EXPLICIET meegegeven orders
  -- (p_order_ids/p_force_solo_ids), bv. bij een stale frontend-selectie.
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

  -- Mig 477: promoot bestaande 'Gepland'-deelzendingen naar 'Picken'
  FOR v_promoted IN
    UPDATE zendingen z
       SET status    = 'Picken',
           picker_id = COALESCE(z.picker_id, p_picker_id)
      FROM zending_orders zo
     WHERE zo.zending_id = z.id
       AND zo.order_id = ANY(v_alle_orders)
       AND z.status = 'Gepland'
    RETURNING z.id AS zid, z.zending_nr AS znr, z.vervoerder_code AS vcode
  LOOP
    RETURN QUERY SELECT
      v_promoted.zid,
      v_promoted.znr,
      v_promoted.vcode,
      (SELECT COUNT(*)::INTEGER FROM zending_regels zr2 WHERE zr2.zending_id = v_promoted.zid),
      (SELECT COUNT(DISTINCT zo2.order_id)::INTEGER FROM zending_orders zo2 WHERE zo2.zending_id = v_promoted.zid),
      FALSE AS is_nieuw;
  END LOOP;

  -- Hoofdgroepering — zending-aanmaak per (debiteur × adres × vervoerder × jaar_week × solo_marker)
  --
  -- Mig 536: jaar_week terug in GROUP BY, maar met 1-week-vooruit-clamp:
  --   afleverdatum <= volgende week → huidige week; verder weg → eigen week.
  -- Concreet: Wk 26+27+28 → één zending; Wk 31 → eigen zending.
  --
  -- Mig 477/479: WHERE NOT pv.is_locked AND orp.is_pickbaar ongewijzigd.
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
        -- Mig 536 clamp: zelfde logica als de view
        CASE
          WHEN verzendweek_voor_datum(o.afleverdatum)
                 <= verzendweek_voor_datum((CURRENT_DATE + INTERVAL '7 days')::DATE)
          THEN verzendweek_voor_datum(CURRENT_DATE)
          ELSE verzendweek_voor_datum(o.afleverdatum)
        END                                            AS jaar_week,
        CASE
          WHEN ore.order_id = ANY(v_force_solo) THEN ore.order_id
          ELSE NULL
        END                                            AS solo_marker
        FROM unnest(v_alle_orders) AS oid
        CROSS JOIN LATERAL effectieve_vervoerder_per_orderregel(oid) pv
        JOIN order_regels ore ON ore.id = pv.orderregel_id
        JOIN orders o ON o.id = oid
        JOIN orderregel_pickbaarheid orp ON orp.order_regel_id = pv.orderregel_id
       WHERE NOT pv.is_locked
         AND orp.is_pickbaar
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

GRANT EXECUTE ON FUNCTION public.start_pickronden(BIGINT[], BIGINT, BIGINT[]) TO authenticated;

COMMENT ON FUNCTION public.start_pickronden(BIGINT[], BIGINT, BIGINT[]) IS
  'Mig 555 (update van mig 536): de adres-bundel-expansie (''uitgebreid''-CTE) '
  'neemt een order uit voorgestelde_zending_bundels alleen over als die zelf '
  'ook pick_ship_zichtbaar is — een niet-klare hitchhiker blokkeert niet meer '
  'de hele aanroep (was: mig 466''s pickbaarheid-guard faalde op ALLE orders '
  'in scope, dus ook op expliciet geselecteerde, wél-klare orders). Alle '
  'andere guards/gedrag ongewijzigd (mig 373/395/396/466/477/479/536).';

NOTIFY pgrst, 'reload schema';
