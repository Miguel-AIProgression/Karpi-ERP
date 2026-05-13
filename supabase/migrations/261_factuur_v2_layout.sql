-- Migratie 261: factuur V2-layout — per-order bezorgkosten + totaal-correctieregels
--
-- User-keuze V2 (uit grill-sessie 2026-05-13): factuur toont
--   1. Product-regels per order (zoals voorheen)
--   2. VERZEND-regel per order (gekopieerd van orderregel; 1 per order in bundel)
--   3. 1× BUNDELKORTING regel (compenseert dubbele verzendkosten):
--        bedrag = −(N−1) × verzendkosten (alleen bij N > 1)
--   4. 1× DREMPELKORTING regel (alleen bij gratis_drempel-status):
--        bedrag = −1 × verzendkosten
--
-- Voor scenario B (betaald): alleen BUNDELKORTING, geen DREMPELKORTING.
-- Voor scenario A (gratis_drempel): beide, saldo verzending = € 0.
-- Voor scenario gratis_klantafspraak / gratis_afhalen: ongewijzigd-pad (te
-- complex om mee te nemen in deze stap; orderregels reflecteren de werkelijkheid
-- al — er zijn dan geen VERZEND-orderregels om te kopiëren).
--
-- Order-detail mirror: BUNDELKORTING en DREMPELKORTING ook als orderregels
-- op v_order_ids[1] (hoofdorder van de bundel). Vervangt mig 260's enkele
-- BUNDELKORTING-orderregel.
--
-- Filter voor product-copy uitgebreid: NOT IN ('BUNDELKORTING', 'DREMPELKORTING').
-- VERZEND wel meekopiëren (was uitgesloten in mig 260).
--
-- Idempotent via CREATE OR REPLACE.
-- VOORWAARDE: mig 256, mig 260 toegepast.

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
  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  -- Mig 261: VERZEND wel mee laten tellen voor te-factureren; alleen
  -- BUNDELKORTING/DREMPELKORTING uitsluiten (dat zijn onze eigen correcties).
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

  -- Mig 261 V2: VERZEND wel mee kopiëren (1 per order in bundel).
  -- Alleen BUNDELKORTING/DREMPELKORTING uitsluiten (onze eigen correcties).
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

  -- Verzendkosten-status nog steeds via resolver bepalen (mig 234) — we
  -- gebruiken alleen v_vk.status om te beslissen of DREMPELKORTING van
  -- toepassing is. De feitelijke per-order verzendkosten staan al op de
  -- factuur via de copy-stap hierboven.
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

  -- Mig 261 V2: totaal-niveau correctieregels (BUNDELKORTING + DREMPELKORTING)
  DECLARE
    v_aantal_verzend_regels      INTEGER;
    v_verzendkosten_per_order    NUMERIC(8,2);
    v_bundel_korting_factuur     NUMERIC(12,2);
    v_drempel_korting_factuur    NUMERIC(12,2);
    v_korting_regelnr            INTEGER;
    v_orderregel_regelnr         INTEGER;
  BEGIN
    SELECT COUNT(*), COALESCE(MIN(bedrag), 0)
      INTO v_aantal_verzend_regels, v_verzendkosten_per_order
      FROM factuur_regels
     WHERE factuur_id = v_factuur_id AND artikelnr = 'VERZEND';

    SELECT COALESCE(MAX(regelnummer), 0) INTO v_korting_regelnr
      FROM factuur_regels WHERE factuur_id = v_factuur_id;

    -- BUNDELKORTING factuur-regel (compenseert dubbele verzendkosten)
    IF v_aantal_verzend_regels > 1 THEN
      v_korting_regelnr := v_korting_regelnr + 1;
      v_bundel_korting_factuur := -(v_aantal_verzend_regels - 1) * v_verzendkosten_per_order;
      INSERT INTO factuur_regels (
        factuur_id, order_id, order_regel_id, regelnummer,
        artikelnr, omschrijving,
        aantal, prijs, korting_pct, bedrag, btw_percentage
      ) VALUES (
        v_factuur_id, v_order_ids[1], NULL, v_korting_regelnr,
        'BUNDELKORTING',
        format('Bundelkorting verzending (gebundeld %s orders)', v_aantal_verzend_regels),
        1, v_bundel_korting_factuur, 0, v_bundel_korting_factuur, v_btw_pct
      );
    ELSE
      v_bundel_korting_factuur := 0;
    END IF;

    -- DREMPELKORTING factuur-regel (drempel-cadeau)
    IF v_vk.status = 'gratis_drempel' AND v_aantal_verzend_regels > 0 THEN
      v_korting_regelnr := v_korting_regelnr + 1;
      v_drempel_korting_factuur := -v_verzendkosten_per_order;
      INSERT INTO factuur_regels (
        factuur_id, order_id, order_regel_id, regelnummer,
        artikelnr, omschrijving,
        aantal, prijs, korting_pct, bedrag, btw_percentage
      ) VALUES (
        v_factuur_id, v_order_ids[1], NULL, v_korting_regelnr,
        'DREMPELKORTING',
        format('Drempelkorting verzending — vanaf €%s', to_char(v_debiteur.verzend_drempel, 'FM999999.00')),
        1, v_drempel_korting_factuur, 0, v_drempel_korting_factuur, v_btw_pct
      );
    ELSE
      v_drempel_korting_factuur := 0;
    END IF;

    -- Order-regels spiegel: zelfde bedragen, op v_order_ids[1]
    -- (vervangt mig 260's enkele BUNDELKORTING-orderregel).
    IF v_bundel_korting_factuur <> 0 THEN
      SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_orderregel_regelnr
        FROM order_regels WHERE order_id = v_order_ids[1];
      INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, omschrijving,
        orderaantal, te_leveren, gefactureerd,
        prijs, korting_pct, bedrag, gewicht_kg
      ) VALUES (
        v_order_ids[1], v_orderregel_regelnr, 'BUNDELKORTING',
        format('Bundelkorting verzending (gebundeld %s orders)', v_aantal_verzend_regels),
        1, 0, 1,
        v_bundel_korting_factuur, 0, v_bundel_korting_factuur, 0
      );
    END IF;

    IF v_drempel_korting_factuur <> 0 THEN
      SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_orderregel_regelnr
        FROM order_regels WHERE order_id = v_order_ids[1];
      INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, omschrijving,
        orderaantal, te_leveren, gefactureerd,
        prijs, korting_pct, bedrag, gewicht_kg
      ) VALUES (
        v_order_ids[1], v_orderregel_regelnr, 'DREMPELKORTING',
        format('Drempelkorting verzending — vanaf €%s', to_char(v_debiteur.verzend_drempel, 'FM999999.00')),
        1, 0, 1,
        v_drempel_korting_factuur, 0, v_drempel_korting_factuur, 0
      );
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
  'Mig 261 (V2-layout): kopieert VERZEND-orderregels per order naar de factuur, '
  'en voegt op totaal-niveau BUNDELKORTING (−(N−1)×verzendkosten) en '
  'DREMPELKORTING (−1×verzendkosten alleen bij gratis_drempel) toe. Spiegelt '
  'beide ook als orderregels op de hoofdorder voor sales-rapportage.';

NOTIFY pgrst, 'reload schema';

-- Verificatie (run in SQL Editor na deploy):
--
-- 1. Maak een nieuwe bundel-factuur van 2 orders met gratis_drempel-status:
--    SELECT genereer_factuur_voor_bundel(<zending_id>);
--    SELECT regelnummer, order_id, artikelnr, bedrag
--      FROM factuur_regels
--     WHERE factuur_id = <nieuwe_factuur_id>
--    ORDER BY regelnummer;
--    -- Verwacht: 2× product, 2× VERZEND, 1× BUNDELKORTING (−verzendkosten),
--    --          1× DREMPELKORTING (−verzendkosten). Saldo verzending = 0.
--
-- 2. Spiegel op orderregels:
--    SELECT order_id, regelnummer, artikelnr, bedrag
--      FROM order_regels
--     WHERE order_id = (
--       SELECT MIN(order_id) FROM zending_orders WHERE zending_id = <zending_id>
--     )
--    ORDER BY regelnummer;
--    -- Verwacht extra rijen: BUNDELKORTING en DREMPELKORTING met negatief bedrag
--
-- 3. Single-order bundel (geen bundeling): BUNDELKORTING moet uitblijven,
--    DREMPELKORTING alleen aanwezig als gratis_drempel.
--
-- 4. Betaalde bundel (status='betaald'): BUNDELKORTING aanwezig, DREMPELKORTING NIET.
