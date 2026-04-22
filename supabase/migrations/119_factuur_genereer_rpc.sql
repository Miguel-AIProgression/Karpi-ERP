-- Migration 119: RPC genereer_factuur
-- Atomair: maakt factuur + regels aan voor gegeven order_ids. Vereist dat alle orders
-- dezelfde debiteur hebben. Retourneert factuur_id.
-- Gebruik: edge function factuur-verzenden + wekelijkse cron roepen deze aan.

CREATE OR REPLACE FUNCTION genereer_factuur(p_order_ids BIGINT[])
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_factuur_id BIGINT;
  v_factuur_nr TEXT;
  v_debiteur_nr INTEGER;
  v_debiteur debiteuren%ROWTYPE;
  v_subtotaal NUMERIC(12,2);
  v_btw_pct NUMERIC(5,2);  -- gelezen uit debiteuren.btw_percentage (default 21.00)
  v_btw_bedrag NUMERIC(12,2);
  v_totaal NUMERIC(12,2);
  v_betaaltermijn_dagen INTEGER := 30;  -- default, overschreven door debiteuren.betaalconditie indien numeriek
BEGIN
  IF array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_order_ids mag niet leeg zijn';
  END IF;

  -- Verifieer: één debiteur voor alle orders
  SELECT DISTINCT debiteur_nr INTO v_debiteur_nr
    FROM orders WHERE id = ANY(p_order_ids);
  IF v_debiteur_nr IS NULL THEN
    RAISE EXCEPTION 'Geen orders gevonden voor ids %', p_order_ids;
  END IF;
  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(p_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Orders behoren niet tot dezelfde debiteur';
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = v_debiteur_nr;

  -- BTW-percentage uit klantprofiel (21% NL, 0% EU-intracom/export, enz.)
  v_btw_pct := COALESCE(v_debiteur.btw_percentage, 21.00);

  -- Probeer betaaltermijn uit betaalconditie te halen (bv. "30 dagen" → 30)
  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer
  ) VALUES (
    v_factuur_nr, v_debiteur_nr, CURRENT_DATE, CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer
  ) RETURNING id INTO v_factuur_id;

  -- Factuur-regels: kopieer alle order_regels waarvoor nog niet gefactureerd
  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.uw_referentie, o.order_nr,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(p_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
  ORDER BY orr.order_id, orr.regelnummer;

  -- Markeer order_regels als gefactureerd
  UPDATE order_regels
    SET gefactureerd = orderaantal
  WHERE order_id = ANY(p_order_ids);

  -- Totalen berekenen + schrijven
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
    SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
  WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$$;

COMMENT ON FUNCTION genereer_factuur IS
  'Atomair: maakt factuur + regels aan voor een of meerdere order_ids van dezelfde debiteur. '
  'Markeert order_regels.gefactureerd = orderaantal. Retourneert factuur_id. '
  'Geen PDF/email — dat doet edge function factuur-verzenden.';
