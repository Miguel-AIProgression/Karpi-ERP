-- Migratie 534: wekelijkse factuur op basis van daadwerkelijke verzenddatum (gereed_op)
--
-- Probleem: genereer_factuur_voor_week en enqueue_wekelijkse_verzamelfacturen
-- filterten op verzendweek_voor_datum(orders.afleverdatum) = de GEPLANDE leverdatum.
-- Een order met afleverdatum in week 25 die pas in week 26 verzonden wordt, belandt
-- zo in de week-25-factuur — terwijl hij feitelijk in week 26 is uitgegaan.
--
-- Oplossing: gebruik zendingen.gereed_op (gezet door fn_zending_set_gereed_op bij
-- status → 'Klaar voor verzending', mig 432) als bron-van-waarheid voor "wanneer
-- is deze order daadwerkelijk verzonden". Fallback op zendingen.verzenddatum voor
-- zendingen van vóór mig 432 (zonder gereed_op).
--
-- Gewijzigd:
-- 1. genereer_factuur_voor_week: orders-WHERE-clause via gereed_op subquery.
-- 2. VERZEND-regels loop: zendingen-filter via gereed_op i.p.v. verzendweek snapshot.
-- 3. enqueue_wekelijkse_verzamelfacturen: zelfde omschakeling zodat de cron precies
--    dezelfde orders pikt als de RPC daarna factureert.
--
-- Superset van mig 530 (laatste definitie van genereer_factuur_voor_week) en
-- mig 231 (laatste definitie van enqueue_wekelijkse_verzamelfacturen).
-- Handtekeningen ongewijzigd — geen aanpassingen nodig in factuur-verzenden/index.ts.

------------------------------------------------------------------------
-- 1. genereer_factuur_voor_week — week bepaald via zendingen.gereed_op
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.genereer_factuur_voor_week(
  p_debiteur_nr INTEGER,
  p_jaar_week   TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_factuur_id           BIGINT;
  v_factuur_nr           TEXT;
  v_debiteur             debiteuren%ROWTYPE;
  v_eerste_order         orders%ROWTYPE;
  v_btw_pct              NUMERIC(5,2);
  v_btw_regeling         RECORD;
  v_betaaltermijn_dagen  INTEGER := 30;
  v_aantal_te_factureren INTEGER;
  v_order_ids            BIGINT[];
  v_subtotaal            NUMERIC(12,2);
  v_btw_bedrag           NUMERIC(12,2);
  v_totaal               NUMERIC(12,2);
  v_volgnr               INTEGER;
  v_zending              RECORD;
  v_bundel_subtotaal     NUMERIC(12,2);
  v_aantal_orders_bundel INTEGER;
  v_te_betalen           NUMERIC(8,2);
  v_omschrijving         TEXT;
  -- Toeslag (mig 530)
  v_toeslag_bedrag       NUMERIC(12,2) := 0;
  v_toeslag_omschrijving TEXT          := NULL;
  v_toeslag_actief       BOOLEAN       := FALSE;
  v_product_subtotaal    NUMERIC(12,2);
BEGIN
  IF p_debiteur_nr IS NULL OR p_jaar_week IS NULL THEN
    RAISE EXCEPTION 'p_debiteur_nr en p_jaar_week zijn verplicht';
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = p_debiteur_nr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debiteur % bestaat niet', p_debiteur_nr;
  END IF;

  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  -- Toeslag-activatie (mig 530): geldig als CURRENT_DATE binnen periode.
  v_toeslag_actief := COALESCE(v_debiteur.toeslag_actief, FALSE)
    AND v_debiteur.toeslag_procent IS NOT NULL
    AND CURRENT_DATE BETWEEN COALESCE(v_debiteur.toeslag_begindatum, 'infinity'::date)
                         AND COALESCE(v_debiteur.toeslag_einddatum, '-infinity'::date);

  -- Verzamel orders van deze (debiteur, week) die nog niet gefactureerd zijn.
  -- mig 534: week bepaald op basis van daadwerkelijke verzenddatum (gereed_op van de
  -- laatste zending), niet meer op geplande afleverdatum.
  -- Fallback op verzenddatum voor zendingen van vóór mig 432 (zonder gereed_op).
  -- Orders zonder zending worden nooit op een wekelijkse factuur geplaatst.
  SELECT array_agg(o.id ORDER BY o.id)
    INTO v_order_ids
    FROM orders o
   WHERE o.debiteur_nr = p_debiteur_nr
     AND o.status = 'Verzonden'
     AND (
       SELECT verzendweek_voor_datum(
                COALESCE(MAX(z.gereed_op)::date, MAX(z.verzenddatum))
              )
         FROM zending_orders zo
         JOIN zendingen z ON z.id = zo.zending_id
        WHERE zo.order_id = o.id
     ) = p_jaar_week
     AND NOT EXISTS (
       SELECT 1 FROM factuur_regels fr WHERE fr.order_id = o.id
     );

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Geen te-factureren orders gevonden voor debiteur % week %',
      p_debiteur_nr, p_jaar_week
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Mig 456: BTW-regeling op basis van de eerste order in de week-batch.
  SELECT * INTO v_eerste_order FROM orders WHERE id = v_order_ids[1];

  SELECT * INTO v_btw_regeling
    FROM bepaal_btw_regeling(
      v_eerste_order.afl_land, v_debiteur.land, v_eerste_order.afhalen,
      v_debiteur.btw_verlegd_intracom, v_debiteur.btw_nummer, v_debiteur.btw_percentage
    );
  v_btw_pct := v_btw_regeling.effectief_pct;

  -- No-op guard: tel te-factureren product-regels.
  -- VERZEND + TOESLAG worden door dit pad apart behandeld → uitgesloten.
  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
     AND COALESCE(orr.artikelnr, '') NOT IN ('VERZEND', 'TOESLAG');

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Order(s) % zijn al volledig gefactureerd — geen regels te factureren', v_order_ids
      USING ERRCODE = 'no_data_found';
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
    btw_verlegd, btw_regeling, btw_controle_nodig_sinds,
    toeslag_bedrag, toeslag_omschrijving
  ) VALUES (
    v_factuur_nr, p_debiteur_nr, CURRENT_DATE, CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer,
    (v_btw_regeling.regeling = 'eu_b2b_icl'),
    v_btw_regeling.regeling,
    CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END,
    0, NULL
  ) RETURNING id INTO v_factuur_id;

  -- Product-regels (alle orderregels behalve VERZEND en TOESLAG).
  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.klant_referentie, o.order_nr,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(v_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
    AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
    AND COALESCE(orr.artikelnr, '') NOT IN ('VERZEND', 'TOESLAG')
  ORDER BY orr.order_id, orr.regelnummer;

  -- Side-effect: markeer product-regels als gefactureerd (excl. VERZEND en TOESLAG).
  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND pick_backorder_sinds IS NULL AND pick_backorder_geannuleerd_op IS NULL
     AND COALESCE(artikelnr, '') NOT IN ('VERZEND', 'TOESLAG');

  -- Verzend-regels: 1 per bundel-zending van deze (debiteur, week).
  -- mig 534: filter ook hier op gereed_op i.p.v. de verzendweek snapshot,
  -- zodat orders-selectie en VERZEND-toewijzing op dezelfde weekdefinitie zitten.
  SELECT COALESCE(MAX(regelnummer), 0) INTO v_volgnr
    FROM factuur_regels WHERE factuur_id = v_factuur_id;

  FOR v_zending IN
    SELECT z.id, z.zending_nr, z.vervoerder_code, z.afl_naam, z.afl_plaats
      FROM zendingen z
     WHERE verzendweek_voor_datum(COALESCE(z.gereed_op::date, z.verzenddatum)) = p_jaar_week
       AND EXISTS (
         SELECT 1 FROM zending_orders zo
          WHERE zo.zending_id = z.id
            AND zo.order_id = ANY(v_order_ids)
       )
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
     ORDER BY z.id
  LOOP
    SELECT COALESCE(SUM(fr.bedrag), 0)::NUMERIC(12,2),
           COUNT(DISTINCT fr.order_id)::INTEGER
      INTO v_bundel_subtotaal, v_aantal_orders_bundel
      FROM factuur_regels fr
     WHERE fr.factuur_id = v_factuur_id
       AND fr.order_id IN (
         SELECT zo.order_id FROM zending_orders zo
          WHERE zo.zending_id = v_zending.id
       );

    IF v_aantal_orders_bundel = 0 THEN
      CONTINUE;
    END IF;

    IF v_zending.vervoerder_code IS NULL THEN
      v_te_betalen := 0;
      v_omschrijving := 'Afhalen — geen verzendkosten';
    ELSIF v_debiteur.gratis_verzending THEN
      v_te_betalen := 0;
      v_omschrijving := format(
        'Verzendkosten %s (%s, %s order%s) — gratis volgens klantafspraak',
        p_jaar_week, v_zending.vervoerder_code,
        v_aantal_orders_bundel,
        CASE WHEN v_aantal_orders_bundel = 1 THEN '' ELSE 's' END
      );
    ELSIF v_debiteur.verzend_drempel IS NOT NULL
          AND v_bundel_subtotaal >= v_debiteur.verzend_drempel THEN
      v_te_betalen := 0;
      v_omschrijving := format(
        'Verzendkosten %s (%s, %s order%s) — gratis vanaf €%s',
        p_jaar_week, v_zending.vervoerder_code,
        v_aantal_orders_bundel,
        CASE WHEN v_aantal_orders_bundel = 1 THEN '' ELSE 's' END,
        to_char(v_debiteur.verzend_drempel, 'FM999999.00')
      );
    ELSE
      v_te_betalen := COALESCE(v_debiteur.verzendkosten, 0);
      v_omschrijving := format(
        'Verzendkosten %s (%s, %s order%s)',
        p_jaar_week, v_zending.vervoerder_code,
        v_aantal_orders_bundel,
        CASE WHEN v_aantal_orders_bundel = 1 THEN '' ELSE 's' END
      );
    END IF;

    v_volgnr := v_volgnr + 1;

    INSERT INTO factuur_regels (
      factuur_id, order_id, order_regel_id, regelnummer,
      artikelnr, omschrijving,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_factuur_id,
      (SELECT MIN(zo.order_id) FROM zending_orders zo WHERE zo.zending_id = v_zending.id),
      NULL,
      v_volgnr,
      'VERZEND',
      v_omschrijving,
      1, v_te_betalen, 0, v_te_betalen, v_btw_pct
    );
  END LOOP;

  -- Toeslag-berekening (mig 530): grondslag = product excl. VERZEND.
  IF v_toeslag_actief THEN
    SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
      INTO v_product_subtotaal
      FROM factuur_regels
     WHERE factuur_id = v_factuur_id
       AND COALESCE(artikelnr, '') <> 'VERZEND';

    v_toeslag_bedrag := ROUND(v_product_subtotaal * v_debiteur.toeslag_procent / 100, 2);
    v_toeslag_omschrijving := REPLACE(
      v_debiteur.toeslag_omschrijving,
      '{percentage}',
      REPLACE(
        REGEXP_REPLACE(v_debiteur.toeslag_procent::TEXT, '\.?0+$', ''),
        '.', ','
      )
    );
  END IF;

  -- Eindtotalen (mig 530: BTW over subtotaal + toeslag).
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;

  v_btw_bedrag := ROUND((v_subtotaal + v_toeslag_bedrag) * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_toeslag_bedrag + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal            = v_subtotaal,
         btw_bedrag           = v_btw_bedrag,
         totaal               = v_totaal,
         toeslag_bedrag       = v_toeslag_bedrag,
         toeslag_omschrijving = v_toeslag_omschrijving
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$$;

COMMENT ON FUNCTION public.genereer_factuur_voor_week(integer, text) IS
  'Legacy wekelijkse-verzamelfactuur-generatie (mig 117/122/231), BTW-fix mig 453, '
  'regeling-bewust mig 456, toeslag mig 530, gereed_op mig 534 — '
  'week bepaald via zendingen.gereed_op (daadwerkelijke verzenddatum), niet afleverdatum. '
  'Snapshot, GEEN blokkade hier (zie mig 456-correctie, factuur-verzenden/index.ts blokkeert '
  'het versturen). Actief voor factuurvoorkeur=wekelijks-debiteuren.';

------------------------------------------------------------------------
-- 2. enqueue_wekelijkse_verzamelfacturen — dezelfde weekdefinitie als de RPC
------------------------------------------------------------------------
-- Wijziging t.o.v. mig 231: verzendweek_voor_datum(o.afleverdatum) vervangen
-- door een subquery op zendingen.gereed_op. De cron en de RPC gebruiken nu
-- dezelfde bron-van-waarheid, zodat de queue precies de orders bevat die de RPC
-- daarna factureert.
CREATE OR REPLACE FUNCTION enqueue_wekelijkse_verzamelfacturen()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_doel_week TEXT := verzendweek_voor_datum((CURRENT_DATE - INTERVAL '7 days')::DATE);
BEGIN
  INSERT INTO factuur_queue (debiteur_nr, order_ids, type, verzendweek)
  SELECT
    o.debiteur_nr,
    array_agg(o.id ORDER BY o.id),
    'wekelijks',
    v_doel_week
  FROM orders o
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  WHERE d.factuurvoorkeur = 'wekelijks'
    AND o.status = 'Verzonden'
    -- mig 534: week op basis van daadwerkelijke verzenddatum (gereed_op).
    AND (
      SELECT verzendweek_voor_datum(
               COALESCE(MAX(z.gereed_op)::date, MAX(z.verzenddatum))
             )
        FROM zending_orders zo
        JOIN zendingen z ON z.id = zo.zending_id
       WHERE zo.order_id = o.id
    ) = v_doel_week
    AND NOT EXISTS (
      SELECT 1 FROM factuur_regels fr WHERE fr.order_id = o.id
    )
    -- Bescherm tegen dubbele cron-runs binnen dezelfde week.
    AND NOT EXISTS (
      SELECT 1 FROM factuur_queue fq
       WHERE fq.debiteur_nr = o.debiteur_nr
         AND fq.type = 'wekelijks'
         AND fq.verzendweek = v_doel_week
         AND fq.status IN ('pending', 'processing', 'done')
    )
  GROUP BY o.debiteur_nr
  HAVING COUNT(*) > 0;
END;
$$;

COMMENT ON FUNCTION enqueue_wekelijkse_verzamelfacturen IS
  'Mig 534 (gereed_op): plaatst per (klant, verzendweek) één queue-item met '
  'alle nog niet gefactureerde Verzonden orders van die week. Week bepaald via '
  'zendingen.gereed_op (daadwerkelijke verzenddatum), niet afleverdatum. '
  'Filtert op verzendweek = vorige ISO-week (cron draait maandagochtend voor week N-1). '
  'Idempotent: bestaande queue-rijen voor dezelfde (debiteur, week) blokkeren '
  'opnieuw enqueue. Aangeroepen door pg_cron-job ''facturatie-wekelijks''.';

NOTIFY pgrst, 'reload schema';
