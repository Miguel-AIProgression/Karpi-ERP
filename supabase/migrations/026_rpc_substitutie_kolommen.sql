-- 026_rpc_substitutie_kolommen.sql
-- Update order RPCs om fysiek_artikelnr en omstickeren kolommen mee te nemen

-- 1. create_order_with_lines: voeg fysiek_artikelnr + omstickeren toe aan INSERT
CREATE OR REPLACE FUNCTION create_order_with_lines(p_order JSONB, p_regels JSONB)
RETURNS JSONB AS $$
DECLARE
    v_order_nr TEXT;
    v_order_id BIGINT;
BEGIN
    -- Generate order number
    v_order_nr := volgend_nummer('ORD');

    -- Insert order header
    INSERT INTO orders (
        order_nr, debiteur_nr, orderdatum, afleverdatum, klant_referentie,
        week, vertegenw_code, betaler, inkooporganisatie,
        fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
        afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
        status
    ) VALUES (
        v_order_nr,
        (p_order->>'debiteur_nr')::INTEGER,
        COALESCE((p_order->>'orderdatum')::DATE, CURRENT_DATE),
        (p_order->>'afleverdatum')::DATE,
        p_order->>'klant_referentie',
        p_order->>'week',
        p_order->>'vertegenw_code',
        (p_order->>'betaler')::INTEGER,
        p_order->>'inkooporganisatie',
        p_order->>'fact_naam', p_order->>'fact_adres',
        p_order->>'fact_postcode', p_order->>'fact_plaats', p_order->>'fact_land',
        p_order->>'afl_naam', p_order->>'afl_naam_2',
        p_order->>'afl_adres', p_order->>'afl_postcode',
        p_order->>'afl_plaats', p_order->>'afl_land',
        'Nieuw'
    ) RETURNING id INTO v_order_id;

    -- Insert order lines (incl. substitutie-kolommen)
    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren
    )
    SELECT
        v_order_id,
        (r->>'regelnummer')::INTEGER,
        r->>'artikelnr',
        r->>'karpi_code',
        r->>'omschrijving',
        r->>'omschrijving_2',
        (r->>'orderaantal')::INTEGER,
        (r->>'te_leveren')::INTEGER,
        (r->>'prijs')::NUMERIC,
        COALESCE((r->>'korting_pct')::NUMERIC, 0),
        (r->>'bedrag')::NUMERIC,
        (r->>'gewicht_kg')::NUMERIC,
        r->>'fysiek_artikelnr',
        COALESCE((r->>'omstickeren')::BOOLEAN, false)
    FROM jsonb_array_elements(p_regels) AS r;

    -- Return the created order
    RETURN jsonb_build_object('id', v_order_id, 'order_nr', v_order_nr);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. update_order_with_lines: voeg fysiek_artikelnr + omstickeren toe aan INSERT
CREATE OR REPLACE FUNCTION update_order_with_lines(p_order_id BIGINT, p_header JSONB, p_regels JSONB)
RETURNS VOID AS $$
BEGIN
    -- Update header
    UPDATE orders SET
        klant_referentie = p_header->>'klant_referentie',
        afleverdatum = (p_header->>'afleverdatum')::DATE,
        week = p_header->>'week',
        vertegenw_code = p_header->>'vertegenw_code',
        betaler = (p_header->>'betaler')::INTEGER,
        inkooporganisatie = p_header->>'inkooporganisatie',
        fact_naam = p_header->>'fact_naam', fact_adres = p_header->>'fact_adres',
        fact_postcode = p_header->>'fact_postcode', fact_plaats = p_header->>'fact_plaats',
        fact_land = p_header->>'fact_land',
        afl_naam = p_header->>'afl_naam', afl_naam_2 = p_header->>'afl_naam_2',
        afl_adres = p_header->>'afl_adres', afl_postcode = p_header->>'afl_postcode',
        afl_plaats = p_header->>'afl_plaats', afl_land = p_header->>'afl_land'
    WHERE id = p_order_id;

    -- Delete existing lines
    DELETE FROM order_regels WHERE order_id = p_order_id;

    -- Insert new lines (incl. substitutie-kolommen)
    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren
    )
    SELECT
        p_order_id,
        (r->>'regelnummer')::INTEGER,
        r->>'artikelnr',
        r->>'karpi_code',
        r->>'omschrijving',
        r->>'omschrijving_2',
        (r->>'orderaantal')::INTEGER,
        (r->>'te_leveren')::INTEGER,
        (r->>'prijs')::NUMERIC,
        COALESCE((r->>'korting_pct')::NUMERIC, 0),
        (r->>'bedrag')::NUMERIC,
        (r->>'gewicht_kg')::NUMERIC,
        r->>'fysiek_artikelnr',
        COALESCE((r->>'omstickeren')::BOOLEAN, false)
    FROM jsonb_array_elements(p_regels) AS r;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. delete_order: update om fysiek_artikelnr mee te nemen bij reservering-herberekening
CREATE OR REPLACE FUNCTION delete_order(p_order_id BIGINT)
RETURNS VOID AS $$
DECLARE
    v_artikelnr TEXT;
    v_status TEXT;
BEGIN
    -- Check dat de order bestaat en niet verzonden is
    SELECT status INTO v_status
    FROM orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % niet gevonden', p_order_id;
    END IF;

    IF v_status IN ('Verzonden') THEN
        RAISE EXCEPTION 'Order met status "%" kan niet verwijderd worden', v_status;
    END IF;

    -- Verzamel betrokken artikelnrs VOOR het verwijderen
    -- Inclusief fysiek_artikelnr voor substitutie-producten
    CREATE TEMP TABLE _tmp_affected_artikels ON COMMIT DROP AS
        SELECT DISTINCT COALESCE(fysiek_artikelnr, artikelnr) AS artikelnr
        FROM order_regels
        WHERE order_id = p_order_id
          AND artikelnr IS NOT NULL
        UNION
        SELECT DISTINCT artikelnr
        FROM order_regels
        WHERE order_id = p_order_id
          AND fysiek_artikelnr IS NOT NULL
          AND fysiek_artikelnr IS DISTINCT FROM artikelnr;

    -- Verwijder orderregels
    DELETE FROM order_regels WHERE order_id = p_order_id;

    -- Verwijder de order
    DELETE FROM orders WHERE id = p_order_id;

    -- Herbereken reservering voor alle betrokken producten
    FOR v_artikelnr IN SELECT artikelnr FROM _tmp_affected_artikels
    LOOP
        PERFORM herbereken_product_reservering(v_artikelnr);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
