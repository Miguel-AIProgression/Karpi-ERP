-- Migratie 260: BUNDELKORTING-orderregel voor order/factuur consistentie
--
-- Probleem: orderregel-totalen tellen N× VERZEND (1 per order in bundel),
-- factuur telt 1× VERZEND (eventueel gecorrigeerd met BUNDELKORTING).
-- Discrepantie tussen orderomzet en factuuromzet → sales-rapportage liegt.
--
-- Voorbeeld (FACT-2026-0018, productie):
--   ORD-2026-2057: product € 351,60 + VERZEND € 35 = € 386,60
--   ORD-2026-2058: product € 376,32 + VERZEND € 35 = € 411,32
--   Som orders = € 797,92
--   Factuur (gebundeld, gratis_drempel) = € 727,92
--   Delta = € 70 = 2× VERZEND zonder tegenhanger.
--
-- Fix (aanpak L1): bij genereren van bundel-factuur óók een
-- BUNDELKORTING-orderregel aanmaken op de hoofdorder (v_order_ids[1]) met
-- bedrag dat de delta compenseert. Formule:
--   v_korting_bedrag = v_vk.te_betalen − SUM(VERZEND-orderregels in bundel)
--
-- Scenarios:
--   A (gratis_drempel):     v_vk.te_betalen = 0, korting = −SUM(VERZEND)
--   B (betaald):            v_vk.te_betalen = verzendkosten, korting = −(SUM-verzendkosten)
--   gratis_klantafspraak:   v_vk.te_betalen = 0, korting = −SUM(VERZEND)
--   gratis_afhalen:         v_vk.te_betalen = 0, SUM = 0, korting = 0 → skip
--   single-order:           SUM = 1× verzendkosten = v_vk.te_betalen, korting = 0 → skip
--
-- Plus: product-regel-filter uitgebreid naar NOT IN ('VERZEND','BUNDELKORTING')
-- zodat we niet onze eigen orderregels naar de factuur kopiëren bij herfacturatie.
--
-- Idempotent via CREATE OR REPLACE.
-- VOORWAARDE: mig 256 toegepast.
--
-- NB. Slot-nummer: oorspronkelijk gepland als mig 258, maar slot 257 (WIP
-- ADR-0016 ENUM-uitbreiding) reserveert slot 258 voor de bijbehorende
-- RPC-migratie. Daarom uitgegeven aan slot 260.

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
  v_volgnr               INTEGER;
  v_bundel_subtotaal     NUMERIC(12,2);
  v_is_afhalen           BOOLEAN;
  v_vk                   RECORD;
  v_verzend_omschrijving TEXT;
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
  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND COALESCE(orr.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING');

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

  -- Product-regels (filter uitgebreid: VERZEND én BUNDELKORTING uitgesloten,
  -- zodat we niet onze eigen orderregels naar de factuur kopiëren bij
  -- herfacturatie — mig 260).
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
    AND COALESCE(orr.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING')
  ORDER BY orr.order_id, orr.regelnummer;

  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND COALESCE(artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING');

  -- Verzendkosten via resolver — single source of truth (mig 234).
  SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
    INTO v_bundel_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;

  SELECT BOOL_OR(COALESCE(o.afhalen, FALSE))
    INTO v_is_afhalen
    FROM orders o
   WHERE o.id = ANY(v_order_ids);

  SELECT * INTO v_vk
    FROM verzendkosten_voor_bundel(v_debiteur.debiteur_nr, v_bundel_subtotaal, v_is_afhalen);

  SELECT COALESCE(MAX(regelnummer), 0) INTO v_volgnr
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_volgnr := v_volgnr + 1;

  -- Rich-omschrijving consistent met mig 234.
  v_verzend_omschrijving := format('Verzendkosten week %s (%s, %s order%s) — %s',
    COALESCE(v_zending.verzendweek, 'onbekend'),
    CASE WHEN v_is_afhalen THEN 'AFHAAL' ELSE COALESCE(v_zending.vervoerder_code, 'GEEN') END,
    array_length(v_order_ids, 1),
    CASE WHEN array_length(v_order_ids, 1) = 1 THEN '' ELSE 's' END,
    v_vk.reden);

  IF v_vk.status = 'gratis_drempel' THEN
    -- 2-regel-vorm: volle verzendkosten + tegenboeking als BUNDELKORTING.
    -- Mig 256 (D2-keuze): klant ziet wat hij bespaart i.p.v. enkel een 0-regel.
    INSERT INTO factuur_regels (
      factuur_id, order_id, order_regel_id, regelnummer,
      artikelnr, omschrijving,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_factuur_id, v_order_ids[1], NULL, v_volgnr,
      'VERZEND', v_verzend_omschrijving,
      1, COALESCE(v_debiteur.verzendkosten, 0), 0, COALESCE(v_debiteur.verzendkosten, 0), v_btw_pct
    );

    v_volgnr := v_volgnr + 1;

    INSERT INTO factuur_regels (
      factuur_id, order_id, order_regel_id, regelnummer,
      artikelnr, omschrijving,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_factuur_id, v_order_ids[1], NULL, v_volgnr,
      'BUNDELKORTING',
      format('Bundelkorting verzending — %s', v_vk.reden),
      1, -COALESCE(v_debiteur.verzendkosten, 0), 0, -COALESCE(v_debiteur.verzendkosten, 0), v_btw_pct
    );
  ELSE
    -- 1-regel-vorm zoals mig 234 (betaald / gratis_afhalen / gratis_klantafspraak).
    INSERT INTO factuur_regels (
      factuur_id, order_id, order_regel_id, regelnummer,
      artikelnr, omschrijving,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_factuur_id, v_order_ids[1], NULL, v_volgnr,
      'VERZEND', v_verzend_omschrijving,
      1, v_vk.te_betalen, 0, v_vk.te_betalen, v_btw_pct
    );
  END IF;

  -- Eindtotalen.
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
   WHERE id = v_factuur_id;

  -- Mig 260: BUNDELKORTING-orderregel voor order/factuur consistentie.
  -- Compenseert het verschil tussen N× VERZEND-orderregel en effectieve
  -- factuur-VERZEND (= v_vk.te_betalen).
  DECLARE
    v_totaal_verzend_orderregels NUMERIC(12,2);
    v_korting_bedrag             NUMERIC(12,2);
    v_korting_regelnr            INTEGER;
  BEGIN
    SELECT COALESCE(SUM(bedrag), 0)
      INTO v_totaal_verzend_orderregels
      FROM order_regels
     WHERE order_id = ANY(v_order_ids)
       AND artikelnr = 'VERZEND'
       AND COALESCE(orderaantal, 0) > 0;

    v_korting_bedrag := v_vk.te_betalen - v_totaal_verzend_orderregels;

    IF v_korting_bedrag <> 0 THEN
      SELECT COALESCE(MAX(regelnummer), 0) + 1
        INTO v_korting_regelnr
        FROM order_regels
       WHERE order_id = v_order_ids[1];

      INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, omschrijving,
        orderaantal, te_leveren, gefactureerd,
        prijs, korting_pct, bedrag, gewicht_kg
      ) VALUES (
        v_order_ids[1], v_korting_regelnr, 'BUNDELKORTING',
        format('Bundelkorting verzending (bundel met %s orders)', array_length(v_order_ids, 1)),
        1, 0, 1,
        v_korting_bedrag, 0, v_korting_bedrag, 0
      );
    END IF;
  END;

  RETURN v_factuur_id;
END;
$$;

COMMENT ON FUNCTION genereer_factuur_voor_bundel(BIGINT) IS
  'Mig 260 (L1): produceert 2-regel-factuur bij gratis_drempel én '
  'BUNDELKORTING-orderregel op hoofdorder voor order/factuur consistentie. '
  'Filter product-regels uitgebreid naar NOT IN VERZEND/BUNDELKORTING.';

NOTIFY pgrst, 'reload schema';

-- Verificatie (run in SQL Editor na deploy):
--
-- 1. Maak een nieuwe bundel-factuur. Verifieer:
--    SELECT order_id, regelnummer, artikelnr, bedrag
--      FROM order_regels
--     WHERE order_id = (SELECT MIN(order_id) FROM zending_orders WHERE zending_id = <test_zending>);
--    -- Verwacht extra rij: BUNDELKORTING met negatief bedrag op hoofdorder
--
-- 2. Sum-controle:
--    SELECT
--      o.id AS order_id,
--      o.totaal_bedrag,
--      SUM(orr.bedrag) AS som_orderregels
--    FROM orders o
--    JOIN order_regels orr ON orr.order_id = o.id
--    WHERE o.id = ANY(<bundel-orders>)
--    GROUP BY o.id, o.totaal_bedrag;
--    -- Verwacht: som_orderregels per order matcht na fix met de factuur-totaal
--    -- (let op: totaal_bedrag op orders kan een afzonderlijk getriggerde cache zijn — focus op SUM)
