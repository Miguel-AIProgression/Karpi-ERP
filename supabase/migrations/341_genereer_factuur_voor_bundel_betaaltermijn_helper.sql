-- Migratie 341: genereer_factuur_voor_bundel consumeert betaaltermijn_dagen
--
-- Vervangt het foute `regexp_match(betaalconditie, '^(\d+)')`-blok (dat de
-- code i.p.v. de termijn pakte) door een aanroep van de mig-340-helper.
-- Body verder identiek aan mig 268. Dit is de enige live factuur-RPC die de
-- bug nog droeg (genereer_factuur + genereer_factuur_voor_week zijn door
-- mig 240 gedropt).
--
-- NB migratienummer: plan 2026-06-09 claimde 333/334; origin/main loopt tot
-- 339, dus verschoven naar 340 (helper) + 341 (deze).
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION genereer_factuur_voor_bundel(p_zending_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_factuur_id           BIGINT;
  v_factuur_nr           TEXT;
  v_zending              zendingen%ROWTYPE;
  v_debiteur             debiteuren%ROWTYPE;
  v_btw_pct              NUMERIC(5,2);
  v_betaaltermijn_dagen  INTEGER := 30;
  v_aantal_te_factureren INTEGER;
  v_order_ids            BIGINT[];
  v_subtotaal            NUMERIC(12,2);
  v_btw_bedrag           NUMERIC(12,2);
  v_totaal               NUMERIC(12,2);
  v_bundel_subtotaal     NUMERIC(12,2);
  v_is_afhalen           BOOLEAN;
  v_vk                   RECORD;
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

  v_btw_pct := COALESCE(v_debiteur.btw_percentage, 21.00);
  v_betaaltermijn_dagen := betaaltermijn_dagen(v_debiteur.betaalconditie);

  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Zending % heeft geen te-factureren regels', p_zending_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer
  ) VALUES (
    v_factuur_nr, v_debiteur.debiteur_nr, CURRENT_DATE,
    CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer
  ) RETURNING id INTO v_factuur_id;

  -- Kopie van product- + VERZEND-orderregels (1 regel per order x regel).
  -- BUNDELKORTING/DREMPELKORTING uitsluiten — die voegen we als gespreide
  -- factuur-regels hieronder toe met expliciete order_id/order_nr.
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
    AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING')
  ORDER BY orr.order_id, orr.regelnummer;

  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND COALESCE(artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

  -- Verzendkosten-status (mig 234) — alleen v_vk.status nodig om te beslissen
  -- of DREMPELKORTING van toepassing is.
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

  -- Korting-factuur-regels gespreid per order, symmetrisch met orderregel-mirror.
  DECLARE
    v_aantal_verzend_regels   INTEGER;
    v_verzendkosten_per_order NUMERIC(8,2);
    v_korting_regelnr         INTEGER;
    v_order_idx               INTEGER;
    v_target_order_id         BIGINT;
    v_target_order_nr         TEXT;
    v_target_uw_referentie    TEXT;
    v_admin_regelnr           INTEGER;
  BEGIN
    SELECT COUNT(*), COALESCE(MIN(bedrag), 0)
      INTO v_aantal_verzend_regels, v_verzendkosten_per_order
      FROM factuur_regels
     WHERE factuur_id = v_factuur_id AND artikelnr = 'VERZEND';

    SELECT COALESCE(MAX(regelnummer), 0) INTO v_korting_regelnr
      FROM factuur_regels WHERE factuur_id = v_factuur_id;

    -- 1) DREMPELKORTING op order[1] (drempel-cadeau)
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

    -- 2) BUNDELKORTING per order[2..N] (één −verzendkosten-regel per order)
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

    -- 3a) DREMPELKORTING-orderregel op order[1] — óók bij N=1 + gratis_drempel
    -- (symmetrisch met factuur-conditie hierboven; vóór review-fix stond hier
    -- per ongeluk `v_aantal_verzend_regels > 1` waardoor single-order zending
    -- boven drempel wel een DREMPEL-factuurregel kreeg maar geen orderregel —
    -- discrepantie tussen factuur en orderregel-som).
    IF v_vk.status = 'gratis_drempel'
       AND v_aantal_verzend_regels > 0
       AND v_verzendkosten_per_order > 0 THEN
      SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_admin_regelnr
        FROM order_regels WHERE order_id = v_order_ids[1];
      INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, omschrijving,
        orderaantal, te_leveren, gefactureerd,
        prijs, korting_pct, bedrag, gewicht_kg
      ) VALUES (
        v_order_ids[1], v_admin_regelnr, 'DREMPELKORTING',
        format('Drempelkorting verzending — vanaf €%s',
          to_char(v_debiteur.verzend_drempel, 'FM999999.00')),
        1, 0, 1,
        -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, 0
      );
    END IF;

    -- 3b) BUNDELKORTING-orderregels op order[2..N] — alleen bij echte bundel.
    IF v_verzendkosten_per_order > 0 AND v_aantal_verzend_regels > 1 THEN
      FOR v_order_idx IN 2..array_length(v_order_ids, 1) LOOP
        v_target_order_id := v_order_ids[v_order_idx];

        SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_admin_regelnr
          FROM order_regels WHERE order_id = v_target_order_id;
        INSERT INTO order_regels (
          order_id, regelnummer, artikelnr, omschrijving,
          orderaantal, te_leveren, gefactureerd,
          prijs, korting_pct, bedrag, gewicht_kg
        ) VALUES (
          v_target_order_id, v_admin_regelnr, 'BUNDELKORTING',
          format('Bundelkorting verzending (gebundeld %s orders)',
            v_aantal_verzend_regels),
          1, 0, 1,
          -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, 0
        );
      END LOOP;
    END IF;
  END;

  -- Eindtotalen.
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$$;

COMMENT ON FUNCTION genereer_factuur_voor_bundel(BIGINT) IS
  'Mig 341: V2-layout + korting-factuur-regels gespreid per order (DREMPEL op '
  'order[1] bij gratis_drempel, BUNDEL per order[2..N]). Betaaltermijn nu via '
  'betaaltermijn_dagen()-helper (mig 340) i.p.v. foute ^(\d+)-regex. order_nr + '
  'uw_referentie expliciet ingevuld zodat PDF-template per order groepeert. '
  'Orderregel-mirror symmetrisch met factuur-regels — ook N=1 + gratis_drempel '
  'krijgt DREMPELKORTING op beide niveaus. Vereist mig 265+266+267.';

NOTIFY pgrst, 'reload schema';
