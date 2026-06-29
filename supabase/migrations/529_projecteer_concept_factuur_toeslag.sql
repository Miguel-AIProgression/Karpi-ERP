-- Migratie 529: klant-toeslag in projecteer_concept_factuur
--
-- Breidt projecteer_concept_factuur (mig 428, gefixt mig 449) uit:
--
-- 1. TOESLAG-orderregel wordt UITGESLOTEN van factuur_regels (zoals BUNDELKORTING/
--    DREMPELKORTING) — de TOESLAG is bedoeld als preview-regel op de order, maar op
--    de factuur wordt hij NIET als factuur_regel opgenomen. In plaats daarvan wordt
--    hij berekend via de debiteur-instellingen en als snapshot opgeslagen in
--    facturen.toeslag_bedrag + facturen.toeslag_omschrijving (Optie II: eigen
--    totaal-sectie op de PDF, niet in de regelentabel).
--
-- 2. Toeslag-berekening:
--    - Geldig als: debiteur.toeslag_actief=TRUE AND
--                  CURRENT_DATE BETWEEN toeslag_begindatum AND toeslag_einddatum
--    - Grondslag: SUM(factuur_regels excl. VERZEND/BUNDELKORTING/DREMPELKORTING)
--      d.w.z. puur de product-regels (niet de verzendkosten). Dit hergebruikt
--      v_bundel_subtotaal dat al berekend werd voor de drempel-check.
--    - toeslag_bedrag = ROUND(grondslag × toeslag_procent / 100, 2)
--    - toeslag_omschrijving = toeslagtekst met {percentage} vervangen door het
--      geformatteerde percentage (NL-notatie: punt → komma, geen trailing nullen).
--
-- 3. Totaal-formule (wijzigt voor debiteuren met toeslag):
--    - HUIDIG:  btw_bedrag = ROUND(subtotaal × btw_pct / 100, 2)
--               totaal = subtotaal + btw_bedrag
--    - NIEUW:   btw_bedrag = ROUND((subtotaal + toeslag_bedrag) × btw_pct / 100, 2)
--               totaal = subtotaal + toeslag_bedrag + btw_bedrag
--    Voor debiteuren zonder toeslag: toeslag_bedrag=0 → exact gelijk aan oud gedrag.
--    Voor DE verlegd-klanten (btw_pct=0): btw_bedrag=0, totaal=subtotaal+toeslag_bedrag.
--
-- Gedragsneutraal voor alle bestaande debiteuren zonder toeslag_actief=TRUE.

CREATE OR REPLACE FUNCTION public.projecteer_concept_factuur(
  p_zending_id BIGINT,
  p_factuur_id BIGINT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_factuur_id            BIGINT;
  v_factuur_nr            TEXT;
  v_zending               zendingen%ROWTYPE;
  v_debiteur              debiteuren%ROWTYPE;
  v_btw_pct               NUMERIC(5,2);
  v_betaaltermijn_dagen   INTEGER := 30;
  v_aantal_te_factureren  INTEGER;
  v_order_ids             BIGINT[];
  v_subtotaal             NUMERIC(12,2);
  v_btw_bedrag            NUMERIC(12,2);
  v_totaal                NUMERIC(12,2);
  v_bundel_subtotaal      NUMERIC(12,2);
  v_is_afhalen            BOOLEAN;
  v_vk                    RECORD;
  -- Toeslag (mig 529)
  v_toeslag_bedrag        NUMERIC(12,2) := 0;
  v_toeslag_omschrijving  TEXT          := NULL;
  v_toeslag_actief        BOOLEAN       := FALSE;
BEGIN
  IF p_zending_id IS NULL THEN
    RAISE EXCEPTION 'p_zending_id is verplicht';
  END IF;

  SELECT * INTO v_zending FROM zendingen WHERE id = p_zending_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  SELECT array_agg(zo.order_id ORDER BY zo.order_id)
    INTO v_order_ids
    FROM zending_orders zo
   WHERE zo.zending_id = p_zending_id;

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Zending % heeft geen gekoppelde orders', p_zending_id;
  END IF;

  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(v_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Bundel-zending % kruist debiteur-grens (orders %)',
      p_zending_id, v_order_ids;
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren
   WHERE debiteur_nr = (SELECT DISTINCT debiteur_nr FROM orders WHERE id = ANY(v_order_ids));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Geen debiteur voor orders %', v_order_ids;
  END IF;

  -- Effectief BTW-tarief via de gedeelde seam (verlegd → 0%).
  v_btw_pct := effectief_btw_pct(v_debiteur.btw_verlegd_intracom, v_debiteur.btw_percentage);
  v_betaaltermijn_dagen := betaaltermijn_dagen(v_debiteur.betaalconditie);

  -- Toeslag-activatie: geldig als ingesteld EN factuurdatum (= CURRENT_DATE) binnen periode.
  v_toeslag_actief := COALESCE(v_debiteur.toeslag_actief, FALSE)
    AND v_debiteur.toeslag_procent IS NOT NULL
    AND CURRENT_DATE BETWEEN COALESCE(v_debiteur.toeslag_begindatum, 'infinity'::date)
                         AND COALESCE(v_debiteur.toeslag_einddatum, '-infinity'::date);

  -- No-op-guard: faal vroeg als alle regels al gefactureerd zijn.
  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Zending % heeft geen te-factureren regels', p_zending_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Header: nieuw Concept of hergebruik (verse rebuild op bestaande factuur_id).
  IF p_factuur_id IS NULL THEN
    v_factuur_nr := volgend_nummer('FACT');
    INSERT INTO facturen (
      factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
      subtotaal, btw_percentage, btw_bedrag, totaal,
      fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
      btw_verlegd,
      toeslag_bedrag, toeslag_omschrijving
    ) VALUES (
      v_factuur_nr, v_debiteur.debiteur_nr, CURRENT_DATE,
      CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
      0, v_btw_pct, 0, 0,
      COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
      COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
      COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
      COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
      v_debiteur.land,
      v_debiteur.btw_nummer,
      COALESCE(v_debiteur.btw_verlegd_intracom, FALSE),
      0, NULL
    ) RETURNING id INTO v_factuur_id;
  ELSE
    v_factuur_id := p_factuur_id;
    DELETE FROM factuur_regels WHERE factuur_id = v_factuur_id;
    UPDATE facturen SET
      btw_percentage       = v_btw_pct,
      btw_verlegd          = COALESCE(v_debiteur.btw_verlegd_intracom, FALSE),
      vervaldatum          = factuurdatum + v_betaaltermijn_dagen,
      fact_naam            = COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
      fact_adres           = COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
      fact_postcode        = COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
      fact_plaats          = COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
      fact_land            = v_debiteur.land,
      btw_nummer           = v_debiteur.btw_nummer,
      toeslag_bedrag       = 0,
      toeslag_omschrijving = NULL
     WHERE id = v_factuur_id;
  END IF;

  -- Product- + VERZEND-orderregels (1 factuur-regel per order × regel).
  -- Uitgesloten: BUNDELKORTING, DREMPELKORTING (korting-factuurregels → hieronder),
  --              TOESLAG (pseudo-orderregel → eigen totaal-sectie op factuur, mig 529).
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
    AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING', 'TOESLAG')
  ORDER BY orr.order_id, orr.regelnummer;

  -- Product-subtotaal (excl. VERZEND) = grondslag voor toeslag + drempel-check.
  -- Hergebruikt het al benodigde v_bundel_subtotaal.
  SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
    INTO v_bundel_subtotaal
    FROM factuur_regels
   WHERE factuur_id = v_factuur_id
     AND COALESCE(artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING');

  SELECT BOOL_OR(COALESCE(o.afhalen, FALSE))
    INTO v_is_afhalen
    FROM orders o
   WHERE o.id = ANY(v_order_ids);

  SELECT * INTO v_vk
    FROM verzendkosten_voor_bundel(v_debiteur.debiteur_nr, v_bundel_subtotaal, v_is_afhalen);

  -- Korting-FACTUURregels (DREMPELKORTING/BUNDELKORTING) — ongewijzigd t.o.v. mig 449.
  DECLARE
    v_aantal_verzend_regels   INTEGER;
    v_verzendkosten_per_order NUMERIC(8,2);
    v_korting_regelnr         INTEGER;
    v_order_idx               INTEGER;
    v_target_order_id         BIGINT;
    v_target_order_nr         TEXT;
    v_target_uw_referentie    TEXT;
  BEGIN
    SELECT COUNT(*), COALESCE(MIN(bedrag), 0)
      INTO v_aantal_verzend_regels, v_verzendkosten_per_order
      FROM factuur_regels
     WHERE factuur_id = v_factuur_id AND artikelnr = 'VERZEND';

    SELECT COALESCE(MAX(regelnummer), 0) INTO v_korting_regelnr
      FROM factuur_regels WHERE factuur_id = v_factuur_id;

    -- 1) DREMPELKORTING op order[1]
    IF v_vk.status = 'gratis_drempel' AND v_aantal_verzend_regels > 0 THEN
      SELECT order_nr, klant_referentie
        INTO v_target_order_nr, v_target_uw_referentie
        FROM orders WHERE id = v_order_ids[1];

      v_korting_regelnr := v_korting_regelnr + 1;
      INSERT INTO factuur_regels (
        factuur_id, order_id, order_regel_id, regelnummer,
        artikelnr, omschrijving,
        uw_referentie, order_nr,
        aantal, prijs, korting_pct, bedrag, btw_percentage
      ) VALUES (
        v_factuur_id, v_order_ids[1], NULL, v_korting_regelnr,
        'DREMPELKORTING',
        format('Drempelkorting verzending — vanaf €%s',
          to_char(v_debiteur.verzend_drempel, 'FM999999.00')),
        v_target_uw_referentie, v_target_order_nr,
        1, -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, v_btw_pct
      );
    END IF;

    -- 2) BUNDELKORTING per order[2..N]
    IF v_verzendkosten_per_order > 0 AND v_aantal_verzend_regels > 1 THEN
      FOR v_order_idx IN 2..array_length(v_order_ids, 1) LOOP
        v_target_order_id := v_order_ids[v_order_idx];

        SELECT order_nr, klant_referentie
          INTO v_target_order_nr, v_target_uw_referentie
          FROM orders WHERE id = v_target_order_id;

        v_korting_regelnr := v_korting_regelnr + 1;
        INSERT INTO factuur_regels (
          factuur_id, order_id, order_regel_id, regelnummer,
          artikelnr, omschrijving,
          uw_referentie, order_nr,
          aantal, prijs, korting_pct, bedrag, btw_percentage
        ) VALUES (
          v_factuur_id, v_target_order_id, NULL, v_korting_regelnr,
          'BUNDELKORTING',
          format('Bundelkorting verzending (gebundeld %s orders)',
            v_aantal_verzend_regels),
          v_target_uw_referentie, v_target_order_nr,
          1, -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, v_btw_pct
        );
      END LOOP;
    END IF;
  END;

  -- Toeslag-berekening (mig 529): grondslag = v_bundel_subtotaal (product excl. VERZEND).
  IF v_toeslag_actief THEN
    v_toeslag_bedrag := ROUND(v_bundel_subtotaal * v_debiteur.toeslag_procent / 100, 2);
    -- {percentage} vervangen door NL-geformatteerd getal (punt → komma, geen trailing nullen).
    v_toeslag_omschrijving := REPLACE(
      v_debiteur.toeslag_omschrijving,
      '{percentage}',
      REPLACE(
        REGEXP_REPLACE(v_debiteur.toeslag_procent::TEXT, '\.?0+$', ''),
        '.', ','
      )
    );
  END IF;

  -- Eindtotalen (mig 529: BTW over subtotaal + toeslag; gedragsneutraal als toeslag=0).
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

COMMENT ON FUNCTION public.projecteer_concept_factuur(bigint, bigint) IS
  'Mig 428, gefixt mig 449, toeslag mig 529: projecteert een concept-factuur voor '
  'een zending. Herhaalbaar, geen side-effects. Sluit TOESLAG-orderregel uit van '
  'factuur_regels en berekent toeslag_bedrag apart op basis van debiteur-instellingen '
  'en CURRENT_DATE (factuurdatum). Totaal = subtotaal + toeslag_bedrag + btw_bedrag.';
