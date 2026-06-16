-- Migratie 403: achterstallige orders bundelen met lopende-week-orders
--
-- Achtergrond
-- -----------
-- De 4D-bundelsleutel (debiteur × adres × vervoerder × verzendweek) zorgde
-- ervoor dat orders uit een VERLOPEN verzendweek NOOIT konden bundelen met
-- orders van de actuele pick-week, ook al zijn ze achterstallig en gaan ze
-- naar hetzelfde adres met dezelfde vervoerder.
--
-- Operationeel probleem (ontdekt 2026-06-16): ORD-2026-0108 (verzendweek 23)
-- en ORD-2026-0123/0377 (verzendweek 25) gaan naar Rugsman BV, 2830 Willebroek
-- via HST. Ze vormen nu drie losse zendingen terwijl de magazijnier ze in
-- dezelfde pick-run meeneemt.
--
-- Oplossing: clamp de jaar_week van orders waarvan de verzendweek AL IS
-- VERSTREKEN naar de huidige verzendweek (= CURRENT_DATE). Toekomstige weken
-- blijven ongewijzigd. Effect: alle achterstallige orders + actuele-week-orders
-- naar hetzelfde adres krijgen dezelfde bundelsleutel → één zending.
--
-- Wijzigingen
-- -----------
-- 1. `voorgestelde_zending_bundels` — view die de preview in Pick & Ship voedt.
--    Clampt jaar_week van verlopen orders naar current week zodat de UI een
--    gezamenlijke bundel toont vóór pickronde-start.
--
-- 2. `start_pickronden` — de RPC die de daadwerkelijke zending aanmaakt.
--    Zelfde clamp in de per_regel CTE zodat de GROUP BY achterstallige + actuele
--    orders naar hetzelfde adres in ÉÉN zending plaatst.
--    Basis = mig 395 (inclusief geen-vervoerder-guard van mig 373,
--    _valideer_intake_gates van mig 395/396 en markeer_pickronde_gestart-loop
--    van ADR-0016). Enige wijziging t.o.v. mig 395: GREATEST-clamp op jaar_week.
--
-- De functies `bundel_sleutel` en `verzendweek_voor_datum` blijven ongewijzigd
-- (geen impact op de golden-fixture-contracttest in mig 385).
--
-- Idempotent: CREATE OR REPLACE voor view en functie.

------------------------------------------------------------------------
-- 1. voorgestelde_zending_bundels — clamp verlopen week naar huidig
------------------------------------------------------------------------
CREATE OR REPLACE VIEW voorgestelde_zending_bundels AS
WITH open_orders AS (
  SELECT
    o.id              AS order_id,
    o.debiteur_nr,
    o.afleverdatum,
    o.afl_naam,
    o.afl_adres,
    o.afl_postcode,
    o.afl_plaats,
    o.afl_land,
    _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land) AS adres_norm,
    -- Clamp: orders uit verlopen verzendweken krijgen de huidige week als
    -- bundelsleutel-week, zodat ze bundelen met de actuele pick-week-orders
    -- naar hetzelfde adres. Toekomstige weken zijn ongewijzigd.
    GREATEST(
      verzendweek_voor_datum(o.afleverdatum),
      verzendweek_voor_datum(CURRENT_DATE)
    )                                                                   AS jaar_week,
    o.afhalen
    FROM orders o
   WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
     AND o.afleverdatum IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM zending_orders zo
         JOIN zendingen z ON z.id = zo.zending_id
        WHERE zo.order_id = o.id
          AND z.status IN ('Picken', 'Klaar voor verzending', 'Onderweg', 'Afgeleverd')
     )
),
per_regel AS (
  SELECT
    oo.order_id,
    oo.debiteur_nr,
    oo.adres_norm,
    oo.afl_naam,
    oo.afl_postcode,
    oo.afl_plaats,
    oo.jaar_week,
    CASE
      WHEN COALESCE(oo.afhalen, FALSE) THEN 'AFHAAL'
      ELSE COALESCE(pv.effectief_code, 'GEEN')
    END AS vervoerder_code,
    pv.bron,
    ore.bedrag,
    ore.orderaantal,
    ore.artikelnr
    FROM open_orders oo
    CROSS JOIN LATERAL effectieve_vervoerder_per_orderregel(oo.order_id) pv
    JOIN order_regels ore ON ore.id = pv.orderregel_id
   WHERE COALESCE(ore.artikelnr, '') <> 'VERZEND'
     AND COALESCE(ore.orderaantal, 0) > 0
),
gegroepeerd AS (
  SELECT
    bundel_sleutel(
      pr.debiteur_nr,
      pr.adres_norm,
      pr.vervoerder_code,
      pr.jaar_week
    )                                                      AS sleutel,
    pr.debiteur_nr,
    pr.adres_norm,
    pr.vervoerder_code,
    pr.jaar_week,
    MIN(pr.afl_naam)                                       AS afl_naam,
    MIN(pr.afl_postcode)                                   AS afl_postcode,
    MIN(pr.afl_plaats)                                     AS afl_plaats,
    array_agg(DISTINCT pr.order_id ORDER BY pr.order_id)   AS order_ids,
    COUNT(DISTINCT pr.order_id)::INTEGER                   AS aantal_orders,
    COALESCE(SUM(COALESCE(pr.bedrag, 0)), 0)::NUMERIC(12,2) AS bundel_subtotaal_excl,
    BOOL_OR(pr.bron = 'afhalen')                            AS is_afhalen
    FROM per_regel pr
   GROUP BY pr.debiteur_nr, pr.adres_norm, pr.vervoerder_code, pr.jaar_week
)
SELECT
  g.sleutel,
  g.debiteur_nr,
  d.naam                                                   AS debiteur_naam,
  g.adres_norm,
  g.afl_naam,
  g.afl_postcode,
  g.afl_plaats,
  g.vervoerder_code,
  g.is_afhalen,
  g.jaar_week,
  g.order_ids,
  g.aantal_orders,
  g.bundel_subtotaal_excl,
  d.verzendkosten                                          AS klant_verzendkosten,
  d.verzend_drempel                                        AS klant_drempel,
  d.gratis_verzending,
  (
    g.is_afhalen
    OR d.gratis_verzending
    OR (d.verzend_drempel IS NOT NULL
        AND g.bundel_subtotaal_excl >= d.verzend_drempel)
  )                                                        AS drempel_gehaald,
  CASE
    WHEN g.is_afhalen THEN 0
    WHEN d.gratis_verzending THEN 0
    WHEN d.verzend_drempel IS NOT NULL
         AND g.bundel_subtotaal_excl >= d.verzend_drempel THEN 0
    ELSE COALESCE(d.verzendkosten, 0)
  END::NUMERIC(8,2)                                        AS te_betalen_verzendkosten,
  CASE
    WHEN g.is_afhalen OR d.gratis_verzending THEN 0
    WHEN g.aantal_orders < 2 THEN 0
    WHEN d.verzend_drempel IS NOT NULL
         AND g.bundel_subtotaal_excl >= d.verzend_drempel THEN
      g.aantal_orders * COALESCE(d.verzendkosten, 0)
    ELSE
      (g.aantal_orders - 1) * COALESCE(d.verzendkosten, 0)
  END::NUMERIC(10,2)                                       AS bundel_besparing
FROM gegroepeerd g
JOIN debiteuren d ON d.debiteur_nr = g.debiteur_nr;

COMMENT ON VIEW voorgestelde_zending_bundels IS
  'Mig 403 (update van mig 229): achterstallige orders (verlopen verzendweek) '
  'worden nu naar de huidige week geclampt zodat ze kunnen bundelen met '
  'lopende-week-orders naar hetzelfde adres (GREATEST-clamp op jaar_week). '
  'Toekomstige weken ongewijzigd. De 4D-bundelsleutel blijft '
  '(debiteur × adres-norm × effectieve vervoerder × (clamped) verzendweek).';

------------------------------------------------------------------------
-- 2. start_pickronden — dezelfde GREATEST-clamp in de groepering
--
-- Basis: mig 395 (inclusief geen-vervoerder-guard van mig 373,
-- _valideer_intake_gates van mig 395/396 en markeer_pickronde_gestart-loop
-- van ADR-0016). Enige wijziging t.o.v. mig 395: GREATEST-clamp op jaar_week
-- in de per_regel CTE.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION start_pickronden(
  p_order_ids       BIGINT[],
  p_picker_id       BIGINT,
  p_force_solo_ids  BIGINT[] DEFAULT '{}'::BIGINT[]
) RETURNS TABLE (
  zending_id      BIGINT,
  zending_nr      TEXT,
  vervoerder_code TEXT,
  aantal_regels   INTEGER,
  aantal_orders   INTEGER,
  is_nieuw        BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_input_count       INTEGER;
  v_force_solo        BIGINT[];
  v_alle_orders       BIGINT[];
  v_eindstatus_nr     TEXT;
  v_eindstatus_order  BIGINT;
  v_picken_order      BIGINT;
  v_geen_verv_nr      TEXT;
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
$$;

GRANT EXECUTE ON FUNCTION start_pickronden(BIGINT[], BIGINT, BIGINT[]) TO authenticated;

COMMENT ON FUNCTION start_pickronden(BIGINT[], BIGINT, BIGINT[]) IS
  'Mig 403 (update van mig 395): achterstallige orders worden geclampt naar de '
  'huidige verzendweek bij de GROUP BY, zodat ze in één zending landen met '
  'lopende-week-orders naar hetzelfde adres/vervoerder (GREATEST-clamp op '
  'verzendweek_voor_datum). Alle overige guards ongewijzigd t.o.v. mig 395: '
  'geen-vervoerder-guard (mig 373), _valideer_intake_gates (mig 395/396), '
  'markeer_pickronde_gestart-loop (ADR-0016).';

NOTIFY pgrst, 'reload schema';
