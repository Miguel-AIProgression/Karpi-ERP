-- Migratie 264: orderregel-spiegel gespreid over bundle-orders
--
-- ⚠️ VERVANGEN DOOR MIG 268 — niet opnieuw runnen op een DB waar mig 268
-- al toegepast is. Mig 264 plaatste BUNDELKORTING-factuurregel op order[1]
-- terwijl de orderregel-mirror BUNDEL op order[2..N] zette (inconsistent),
-- en miste `order_nr` + `uw_referentie` op de korting-factuurregels.
-- Mig 268 herstelt symmetrie en vult de order-koppeling.
--
-- Mig 262 hield de orderregel-mirror uit (recursie-bug). Mig 263 fixte
-- de claim-keten. Mig 264 herintroduceert de orderregel-mirror, maar nu
-- gespreid: 1e order krijgt DREMPELKORTING (alleen scenario A), overige
-- orders krijgen BUNDELKORTING van −verzendkosten. Resultaat: som van
-- orderregels per order = som van factuur-regels per order.
--
-- Idempotent CREATE OR REPLACE.
-- VOORWAARDE: mig 262 + mig 263 + pseudo-producten BUNDELKORTING/DREMPELKORTING.

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

  -- Mig 262: VERZEND wel mee laten tellen voor te-factureren; alleen
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

  -- Mig 262 V2: VERZEND wel mee kopiëren (1 per order in bundel).
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

  -- Mig 262 V2: totaal-niveau correctieregels (BUNDELKORTING + DREMPELKORTING)
  -- op de factuur. Mig 264: óók als orderregels, gespreid over bundle-orders
  -- (zie tweede DECLARE-blok hieronder).
  DECLARE
    v_aantal_verzend_regels      INTEGER;
    v_verzendkosten_per_order    NUMERIC(8,2);
    v_bundel_korting_factuur     NUMERIC(12,2);
    v_drempel_korting_factuur    NUMERIC(12,2);
    v_korting_regelnr            INTEGER;
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

    -- Mig 264: orderregel-spiegel met spreiding over bundle-orders.
    -- Eerste order krijgt DREMPELKORTING (alleen bij gratis_drempel).
    -- Overige orders krijgen elk een BUNDELKORTING van −verzendkosten
    -- (neutraliseert hun eigen VERZEND-orderregel).
    --
    -- VOORWAARDE: mig 263 (claim-keten slaat admin-orderregels over) —
    -- anders crash op stack-depth.
    DECLARE
      v_order_idx                 INTEGER;
      v_admin_regelnr             INTEGER;
      v_target_order_id           BIGINT;
    BEGIN
      IF v_verzendkosten_per_order > 0 AND v_aantal_verzend_regels > 1 THEN
        FOR v_order_idx IN 1..array_length(v_order_ids, 1) LOOP
          v_target_order_id := v_order_ids[v_order_idx];

          IF v_order_idx = 1 AND v_vk.status = 'gratis_drempel' THEN
            -- DREMPELKORTING op eerste order (drempel-cadeau)
            SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_admin_regelnr
              FROM order_regels WHERE order_id = v_target_order_id;
            INSERT INTO order_regels (
              order_id, regelnummer, artikelnr, omschrijving,
              orderaantal, te_leveren, gefactureerd,
              prijs, korting_pct, bedrag, gewicht_kg
            ) VALUES (
              v_target_order_id, v_admin_regelnr, 'DREMPELKORTING',
              format('Drempelkorting verzending — vanaf €%s',
                to_char(v_debiteur.verzend_drempel, 'FM999999.00')),
              1, 0, 1,
              -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, 0
            );
          ELSIF v_order_idx > 1 THEN
            -- BUNDELKORTING op overige orders (neutraliseert eigen VERZEND)
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
          END IF;
          -- v_order_idx = 1 en NIET gratis_drempel: eerste order krijgt
          -- géén korting (hij betaalt de "winnende" verzending).
        END LOOP;
      END IF;
    END;
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
  'Mig 264: V2-layout op factuur (N× VERZEND + BUNDELKORTING + DREMPELKORTING) '
  'én orderregel-spiegel gespreid over bundle-orders (1e=DREMPELKORTING bij '
  'gratis_drempel, overige=BUNDELKORTING). Vereist mig 263 voor recursie-fix.';

NOTIFY pgrst, 'reload schema';

-- Verificatie (run in SQL Editor na deploy):
--
-- 1. Functie-body bevat WEL INSERT INTO order_regels voor BUNDELKORTING/DREMPELKORTING:
--    SELECT pg_get_functiondef('genereer_factuur_voor_bundel(BIGINT)'::regprocedure)
--           ~ 'INSERT INTO order_regels.*BUNDELKORTING' AS heeft_orderregel_mirror;
--    -- Verwacht: true
--
-- 2. Nieuwe bundel-factuur op een gratis_drempel-debiteur: som van orderregels
--    per order = som van factuur-regels per order (per order_id-groep matchen).
