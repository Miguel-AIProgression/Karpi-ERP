-- Migration 245: order-RPC's lezen lever_type uit payload
--
-- Vervolg op mig 244 (lever_type ENUM + kolommen): de twee order-creatie/-mutatie
-- RPC's `create_order_with_lines` (laatst herzien in mig 204) en
-- `update_order_with_lines` (laatst herzien in mig 212) moeten het nieuwe veld
-- accepteren. Default 'week' blijft via de kolom-DEFAULT, dus oude callers
-- (EDI-import, Floorpassion-webshop fase 1) blijven werken zonder wijziging.
--
-- Pattern volgt mig 204 (`afhalen`) en mig 152 (`lever_modus`):
--   - create: NULLIF op string-cast, COALESCE met 'week' default
--   - update: CASE WHEN p_header ? 'lever_type' — alleen wijzigen als key meegestuurd
--
-- De rest van de body is 1-op-1 gekopieerd uit mig 204 (create) en mig 212 (update).
-- Verifieer bij toekomstige wijziging dat beide RPC's nog steeds in sync zijn met
-- de orders-kolommen.

------------------------------------------------------------------------
-- 1. create_order_with_lines — lever_type meenemen
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_order_with_lines(p_order JSONB, p_regels JSONB)
RETURNS JSONB AS $$
DECLARE
    v_order_nr TEXT;
    v_order_id BIGINT;
BEGIN
    v_order_nr := volgend_nummer('ORD');

    INSERT INTO orders (
        order_nr, debiteur_nr, orderdatum, afleverdatum, klant_referentie,
        week, vertegenw_code, betaler, inkooporganisatie,
        fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
        afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
        lever_modus,
        afhalen,
        lever_type,
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
        NULLIF(p_order->>'lever_modus', ''),
        COALESCE((p_order->>'afhalen')::BOOLEAN, false),
        COALESCE(NULLIF(p_order->>'lever_type', ''), 'week')::lever_type,
        'Nieuw'
    ) RETURNING id INTO v_order_id;

    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_band_kleur_id, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code
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
        COALESCE((r->>'omstickeren')::BOOLEAN, false),
        COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        r->>'maatwerk_vorm',
        (r->>'maatwerk_lengte_cm')::INTEGER,
        (r->>'maatwerk_breedte_cm')::INTEGER,
        r->>'maatwerk_afwerking',
        r->>'maatwerk_band_kleur',
        NULLIF(r->>'maatwerk_band_kleur_id', '')::BIGINT,
        r->>'maatwerk_instructies',
        (r->>'maatwerk_m2_prijs')::NUMERIC,
        (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        (r->>'maatwerk_diameter_cm')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code'
    FROM jsonb_array_elements(p_regels) AS r;

    RETURN jsonb_build_object('id', v_order_id, 'order_nr', v_order_nr);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

------------------------------------------------------------------------
-- 2. update_order_with_lines — lever_type alleen aanpassen als key meegestuurd
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_order_with_lines(p_order_id BIGINT, p_header JSONB, p_regels JSONB)
RETURNS VOID AS $$
DECLARE
    v_input_ids BIGINT[];
BEGIN
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
        afl_plaats = p_header->>'afl_plaats', afl_land = p_header->>'afl_land',
        lever_modus = CASE
          WHEN p_header ? 'lever_modus'
            THEN NULLIF(p_header->>'lever_modus', '')
          ELSE lever_modus
        END,
        afhalen = CASE
          WHEN p_header ? 'afhalen'
            THEN COALESCE((p_header->>'afhalen')::BOOLEAN, false)
          ELSE afhalen
        END,
        lever_type = CASE
          WHEN p_header ? 'lever_type'
            THEN COALESCE(NULLIF(p_header->>'lever_type', ''), 'week')::lever_type
          ELSE lever_type
        END
    WHERE id = p_order_id;

    -- Verzamel input-id's (regels die de frontend wil behouden)
    SELECT COALESCE(
      ARRAY_AGG(NULLIF(r->>'id', '')::BIGINT) FILTER (WHERE NULLIF(r->>'id', '') IS NOT NULL),
      ARRAY[]::BIGINT[]
    )
    INTO v_input_ids
    FROM jsonb_array_elements(p_regels) AS r;

    -- 1. DELETE regels die niet meer in de input staan
    DELETE FROM order_regels
    WHERE order_id = p_order_id
      AND id <> ALL(v_input_ids);

    -- 2. UPDATE bestaande regels — match op order_id + id
    UPDATE order_regels o SET
        regelnummer = (r->>'regelnummer')::INTEGER,
        artikelnr = r->>'artikelnr',
        karpi_code = r->>'karpi_code',
        omschrijving = r->>'omschrijving',
        omschrijving_2 = r->>'omschrijving_2',
        orderaantal = (r->>'orderaantal')::INTEGER,
        te_leveren = (r->>'te_leveren')::INTEGER,
        prijs = (r->>'prijs')::NUMERIC,
        korting_pct = COALESCE((r->>'korting_pct')::NUMERIC, 0),
        bedrag = (r->>'bedrag')::NUMERIC,
        gewicht_kg = (r->>'gewicht_kg')::NUMERIC,
        fysiek_artikelnr = r->>'fysiek_artikelnr',
        omstickeren = COALESCE((r->>'omstickeren')::BOOLEAN, false),
        is_maatwerk = COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        maatwerk_vorm = r->>'maatwerk_vorm',
        maatwerk_lengte_cm = (r->>'maatwerk_lengte_cm')::INTEGER,
        maatwerk_breedte_cm = (r->>'maatwerk_breedte_cm')::INTEGER,
        maatwerk_afwerking = r->>'maatwerk_afwerking',
        maatwerk_band_kleur = r->>'maatwerk_band_kleur',
        maatwerk_band_kleur_id = NULLIF(r->>'maatwerk_band_kleur_id', '')::BIGINT,
        maatwerk_instructies = r->>'maatwerk_instructies',
        maatwerk_m2_prijs = (r->>'maatwerk_m2_prijs')::NUMERIC,
        maatwerk_kostprijs_m2 = (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        maatwerk_oppervlak_m2 = (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        maatwerk_vorm_toeslag = (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        maatwerk_afwerking_prijs = (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        maatwerk_diameter_cm = (r->>'maatwerk_diameter_cm')::INTEGER,
        maatwerk_kwaliteit_code = r->>'maatwerk_kwaliteit_code',
        maatwerk_kleur_code = r->>'maatwerk_kleur_code'
    FROM jsonb_array_elements(p_regels) AS r
    WHERE o.order_id = p_order_id
      AND o.id = NULLIF(r->>'id', '')::BIGINT;

    -- 3. INSERT nieuwe regels (geen id in input)
    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_band_kleur_id, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code
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
        COALESCE((r->>'omstickeren')::BOOLEAN, false),
        COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        r->>'maatwerk_vorm',
        (r->>'maatwerk_lengte_cm')::INTEGER,
        (r->>'maatwerk_breedte_cm')::INTEGER,
        r->>'maatwerk_afwerking',
        r->>'maatwerk_band_kleur',
        NULLIF(r->>'maatwerk_band_kleur_id', '')::BIGINT,
        r->>'maatwerk_instructies',
        (r->>'maatwerk_m2_prijs')::NUMERIC,
        (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        (r->>'maatwerk_diameter_cm')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code'
    FROM jsonb_array_elements(p_regels) AS r
    WHERE NULLIF(r->>'id', '') IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_order_with_lines(JSONB, JSONB) IS
  'Maakt order + regels atomair. Sinds mig 152: lever_modus. Sinds mig 194: maatwerk_band_kleur_id. '
  'Sinds mig 204: afhalen. Sinds mig 245: lever_type (default "week").';
COMMENT ON FUNCTION update_order_with_lines(BIGINT, JSONB, JSONB) IS
  'Update order header + UPSERT regels (mig 212). Sinds mig 245: lever_type (alleen aanpassen als key in p_header staat).';

NOTIFY pgrst, 'reload schema';
