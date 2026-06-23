-- Migratie 479: een order met een 'Gepland'-deelzending moet écht startbaar
-- zijn via Pick & Ship, niet alleen zichtbaar.
--
-- Achtergrond
-- -----------
-- Mig 476 maakte `pick_ship_zichtbaar` ook TRUE bij een actieve (Gepland/
-- Picken) zending, zodat de order in de Pick & Ship-lijst blijft staan. Mig
-- 477 liet `start_pickronden` een bestaande 'Gepland'-zending promoveren.
-- Maar bij het testen (order met 1 pickbare + 1 niet-pickbare regel, klant
-- zonder standaard deelleveringen) bleek de order-kaart nog steeds
-- "Niets pickbaar" / disabled te tonen: de FRONTEND-knop (`StartPickrondesButton`)
-- gate't op `bepaalStartbaarheid()` (`startbaarheid.ts`), en die zet
-- `niet_pickbaar` zodra `!alle_regels_pickbaar` — volledig los van of er al
-- een Gepland-zending klaarstaat om te promoveren. Mig 477's serverlogica was
-- dus voor dit scenario onbereikbaar: de knop die 'm zou aanroepen was disabled.
--
-- Een tweede, onafhankelijke gap kwam aan het licht bij het narekenen: de
-- regel-selectie-CTE in `start_pickronden` (ook ná mig 477) filtert wél op
-- `is_locked` maar NIET op `is_pickbaar` — `effectieve_vervoerder_per_orderregel`
-- geeft alle order_regels terug, pickbaar of niet. Zou de frontend-knop zomaar
-- ingeschakeld worden voor zo'n order, dan zou de niet-pickbare regel alsnog
-- in een NIEUWE zending belanden (een label/colli voor voorraad die er niet is).
--
-- Wijziging 1 — `order_pickbaarheid`: nieuwe kolom `heeft_gepland_zending`
-- ----------------------------------------------------------------------
-- Losse EXISTS-check (alleen 'Gepland', niet 'Picken' — dat laatste heeft al
-- `in_pickronde` als eigen signaal). Voedt de frontend-startbaarheid hieronder.
-- `pick_ship_zichtbaar` blijft ongewijzigd (dekt Gepland+Picken samen, mig 476).
--
-- Wijziging 2 — `start_pickronden`: regel-selectie sluit niet-pickbare regels uit
-- ---------------------------------------------------------------------------
-- `per_regel`-CTE krijgt een join naar `orderregel_pickbaarheid` en filtert
-- `AND orp.is_pickbaar` naast de bestaande `WHERE NOT pv.is_locked` (mig 477).
-- Voor een normale order (alle_regels_pickbaar=true) is dit een no-op — elke
-- regel is per definitie al pickbaar. Voor een order met een Gepland-
-- deelzending + een nog-niet-klare regel: alleen de Gepland-zending wordt
-- gepromoveerd, de niet-pickbare regel blijft ongemoeid liggen voor een latere
-- (deel)zending — geen zending/label voor voorraad die er niet is.
--
-- Frontend (zelfde commit, geen apart migratienummer): `startbaarheid.ts`
-- krijgt `heeft_gepland_zending` als extra input; de `niet_pickbaar`-tak wordt
-- alleen genomen als er ZOWEL niet alle regels pickbaar zijn ALS er geen
-- Gepland-zending is om te promoveren.

CREATE OR REPLACE VIEW order_pickbaarheid AS
SELECT
  op.order_id,
  count(*)::integer AS totaal_regels,
  count(*) FILTER (WHERE op.is_pickbaar)::integer AS pickbare_regels,
  count(*) FILTER (WHERE op.is_pickbaar) = count(*) AS alle_regels_pickbaar,
  count(*) FILTER (WHERE op.is_pickbaar) > 0 AS heeft_pickbare_regel,
  COALESCE(d.deelleveringen_toegestaan, false) AS deelleveringen_toegestaan,
  (count(*) FILTER (WHERE op.is_pickbaar) = count(*))
    OR (COALESCE(d.deelleveringen_toegestaan, false) AND count(*) FILTER (WHERE op.is_pickbaar) > 0)
    OR EXISTS (
         SELECT 1
           FROM zending_orders zo
           JOIN zendingen z ON z.id = zo.zending_id
          WHERE zo.order_id = op.order_id
            AND z.status IN ('Gepland', 'Picken')
       )
    AS pick_ship_zichtbaar,
  EXISTS (
    SELECT 1
      FROM zending_orders zo
      JOIN zendingen z ON z.id = zo.zending_id
     WHERE zo.order_id = op.order_id
       AND z.status = 'Gepland'
  ) AS heeft_gepland_zending
FROM orderregel_pickbaarheid op
JOIN orders o ON o.id = op.order_id
LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
GROUP BY op.order_id, d.deelleveringen_toegestaan;

-- ---------------------------------------------------------------------------

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

  -- Mig 477: promoot bestaande 'Gepland'-deelzendingen (start_deelzending,
  -- mig 473/477) van orders in scope naar 'Picken' i.p.v. hun regels opnieuw
  -- te zenden — de is_locked/is_pickbaar-filter in de hoofdgroepering
  -- hieronder sluit die regels daar uit. Geleverd in de resultatenset
  -- (is_nieuw=FALSE) zodat de bestaande frontend-navigatie naar de printset-
  -- pagina (labels printen) ze gewoon meeneemt, ongeacht of er ook nieuwe
  -- zendingen bijkomen.
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

  -- Hoofdgroepering — zending-aanmaak per (debiteur × adres × vervoerder × week × solo_marker)
  --
  -- Mig 403: GREATEST-clamp op jaar_week zodat achterstallige orders (verlopen
  -- verzendweek) in dezelfde GROUP-BY-groep landen als lopende-week-orders naar
  -- hetzelfde adres. Toekomstige weken zijn ongewijzigd.
  --
  -- Mig 477/479: `WHERE NOT pv.is_locked AND orp.is_pickbaar` sluit regels uit
  -- die al in ENIGE zending zitten (inclusief de net hierboven gepromoveerde)
  -- ÉN regels die nog niet pickbaar zijn (voorraad/maatwerk niet gereed) —
  -- anders zou een niet-klare regel alsnog in een nieuwe zending belanden
  -- zodra de order via een Gepland-deelzending toch al 'pick_ship_zichtbaar'
  -- is geworden.
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

NOTIFY pgrst, 'reload schema';
