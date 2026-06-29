-- Migratie 530: klant-toeslag in genereer_factuur_voor_week
--
-- Spiegelt mig 529 (projecteer_concept_factuur) voor het wekelijkse factuurpad:
--
-- 1. TOESLAG-orderregel uitgesloten van factuur_regels INSERT én van de
--    no-op-guard (zelfde patroon als VERZEND — pseudo, apart behandeld).
--    TOESLAG wordt ook uitgesloten van de gefactureerd-UPDATE zodat het
--    de no-op-guard bij volgende aanroepen niet laat hangen.
--
-- 2. Toeslag-berekening na de VERZEND-loop:
--    grondslag = SUM(factuur_regels excl. VERZEND) = product-subtotaal.
--    Geldig als CURRENT_DATE BETWEEN toeslag_begindatum AND toeslag_einddatum.
--
-- 3. Totaal-formule: btw over (subtotaal + toeslag_bedrag); totaal = subtotaal +
--    toeslag_bedrag + btw_bedrag. Gedragsneutraal voor debiteuren zonder toeslag.
--
-- 4. facturen-INSERT bevat toeslag_bedrag/toeslag_omschrijving (kolommen uit mig 528).
--
-- Superset van mig 518 (laatste definitie van deze functie).

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
  SELECT array_agg(o.id ORDER BY o.id)
    INTO v_order_ids
    FROM orders o
   WHERE o.debiteur_nr = p_debiteur_nr
     AND o.status = 'Verzonden'
     AND verzendweek_voor_datum(o.afleverdatum) = p_jaar_week
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
  SELECT COALESCE(MAX(regelnummer), 0) INTO v_volgnr
    FROM factuur_regels WHERE factuur_id = v_factuur_id;

  FOR v_zending IN
    SELECT z.id, z.zending_nr, z.vervoerder_code, z.afl_naam, z.afl_plaats
      FROM zendingen z
     WHERE z.verzendweek = p_jaar_week
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
  'regeling-bewust mig 456, toeslag mig 530 — snapshot, GEEN blokkade hier (zie mig '
  '456-correctie, factuur-verzenden/index.ts blokkeert het versturen). Actief voor '
  'factuurvoorkeur=wekelijks-debiteuren.';
