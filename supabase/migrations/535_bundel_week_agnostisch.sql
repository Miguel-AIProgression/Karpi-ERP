-- Migratie 535: bundeling op adres+vervoerder zonder week-dimensie
--
-- Achtergrond
-- -----------
-- De 4D-bundelsleutel (debiteur × adres × vervoerder × verzendweek) hield
-- orders voor hetzelfde afleveradres/vervoerder gescheiden als zij in
-- verschillende verzendweken vallen. In de praktijk: een ZITMAXX-bundle met
-- 6 orders (Wk 26+27, door mig-403-clamp al samengevoegd) + 2 orders (Wk 28,
-- toekomstige week → niet geclampt) = 2 losse BUNDEL-kaarten voor exact
-- hetzelfde afleveradres en dezelfde vervoerder.
--
-- Gebruikerseis: "als de order pickbaar is en dezelfde vervoerder heeft en
-- hetzelfde afleveradres, wil ik dat die gebundeld worden."
-- De verzendweek is daarin géén relevant onderscheid — Pick & Ship filtert al
-- op pickbaarheid en operationeel is het altijd efficiënter om alles naar
-- hetzelfde adres in één rit mee te sturen.
--
-- Wijzigingen
-- -----------
-- 1. `voorgestelde_zending_bundels` (mig 229/403): verwijder jaar_week uit
--    de GROUP BY. Sleutel gebruikt altijd verzendweek_voor_datum(CURRENT_DATE)
--    (zelfde waarde voor alle bundles → één bundel per adres+vervoerder).
--    jaar_week in de output-rij = CURRENT_DATE-week (stabiele waarde voor
--    de UI-sectie-routing in wk_1-modus).
--
-- 2. `start_pickronden` (mig 403/466/477/479): verwijder jaar_week uit de
--    per_regel-GROUP BY. Alle pickbare orders naar hetzelfde adres+vervoerder
--    gaan in één zending, ongeacht hun afleverdatum-week.
--
-- Niet gewijzigd:
-- - `bundel_sleutel()` SQL-functie (neemt jaar_week als param — we geven
--   altijd CURRENT_DATE-week mee, geen interface-wijziging nodig)
-- - `start_pickronden_bundel` (dode code vanuit de frontend per CLAUDE.md,
--   ADR-0016; de week-validatie daar is irrelevant voor het actieve pad)
-- - Golden-fixture `bundel-sleutel.golden.json` + contract-test (testen de
--   pure functie met vaste inputs — die functie verandert niet)
-- - Normalisatie `_normaliseer_afleveradres` (spaties + UPPER al afgedekt)
--
-- Idempotent: CREATE OR REPLACE VIEW + FUNCTION.

------------------------------------------------------------------------
-- 1. voorgestelde_zending_bundels — week-agnostisch
--    Basis: mig 403. Wijziging: jaar_week altijd = CURRENT_DATE-week,
--    verwijderd uit GROUP BY van gegroepeerd.
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
    -- Mig 535: altijd de huidige week — week is geen bundel-dimensie meer.
    -- (Mig 403 gebruikte GREATEST(week_order, week_nu) — clampt alleen
    -- verlopen weken; toekomstige weken bleven apart. Nu altijd gelijk.)
    verzendweek_voor_datum(CURRENT_DATE)                                AS jaar_week,
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
      -- Mig 535: vaste huidige week — direct de constante meegeven i.p.v.
      -- pr.jaar_week (die niet in GROUP BY staat).
      verzendweek_voor_datum(CURRENT_DATE)
    )                                                      AS sleutel,
    pr.debiteur_nr,
    pr.adres_norm,
    pr.vervoerder_code,
    verzendweek_voor_datum(CURRENT_DATE)                   AS jaar_week,
    MIN(pr.afl_naam)                                       AS afl_naam,
    MIN(pr.afl_postcode)                                   AS afl_postcode,
    MIN(pr.afl_plaats)                                     AS afl_plaats,
    array_agg(DISTINCT pr.order_id ORDER BY pr.order_id)   AS order_ids,
    COUNT(DISTINCT pr.order_id)::INTEGER                   AS aantal_orders,
    COALESCE(SUM(COALESCE(pr.bedrag, 0)), 0)::NUMERIC(12,2) AS bundel_subtotaal_excl,
    BOOL_OR(pr.bron = 'afhalen')                            AS is_afhalen
    FROM per_regel pr
   -- Mig 535: jaar_week bewust NIET in GROUP BY — alle orders naar hetzelfde
   -- adres+vervoerder bundelen ongeacht hun afleverdatum-week.
   GROUP BY pr.debiteur_nr, pr.adres_norm, pr.vervoerder_code
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
  'Mig 535 (update van mig 403): week verwijderd als bundel-dimensie. '
  'Alle pickbare orders naar hetzelfde adres+vervoerder bundelen in één '
  'zending, ongeacht afleverdatum-week. jaar_week in output = huidige '
  'verzendweek (CURRENT_DATE) — constante waarde, enkel voor UI-compatibiliteit. '
  'Sleutel-formaat ongewijzigd (D|V|W|A), W-component is altijd huidige week.';

------------------------------------------------------------------------
-- 2. start_pickronden — week-agnostisch
--    Basis: mig 479 (meest recente versie). Wijziging: jaar_week verwijderd
--    uit per_regel-CTE en GROUP BY.
------------------------------------------------------------------------
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

  -- Pickbaarheid-guard (mig 466)
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

  -- Hoofdgroepering — zending-aanmaak per (debiteur × adres × vervoerder × solo_marker)
  --
  -- Mig 535: jaar_week verwijderd uit GROUP BY. Alle pickbare orders naar
  -- hetzelfde adres+vervoerder gaan in één zending, ongeacht afleverdatum-week.
  -- (Mig 403 gebruikte GREATEST-clamp; mig 535 verwijdert week helemaal.)
  --
  -- Mig 477/479: WHERE NOT pv.is_locked AND orp.is_pickbaar sluit al-gereserveerde
  -- en nog-niet-pickbare regels uit.
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
      pr.solo_marker,
      MIN(pr.service_code)                                          AS service_code,
      array_agg(DISTINCT pr.order_id)                               AS order_ids,
      array_agg(pr.orderregel_id ORDER BY pr.orderregel_id)         AS orderregel_ids,
      COUNT(*)::INTEGER                                             AS aantal_regels,
      COUNT(DISTINCT pr.order_id)::INTEGER                          AS aantal_orders
      FROM per_regel pr
     GROUP BY pr.debiteur_nr, pr.adres_norm, pr.vervoerder_code, pr.solo_marker
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
  'Mig 535 (update van mig 479): jaar_week verwijderd uit GROUP BY. Alle '
  'pickbare orders naar hetzelfde adres+vervoerder gaan in één zending, '
  'ongeacht hun afleverdatum-week. Alle andere guards ongewijzigd (mig '
  '373/395/396/466/477/479).';

NOTIFY pgrst, 'reload schema';
