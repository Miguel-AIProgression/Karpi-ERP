-- Migratie 559 (hernummerd van 488): combi_levering_override door in create/update_order_with_lines
-- (ADR-0039). CREATE OR REPLACE bevat de VOLLEDIGE, actuele body van beide
-- functies (opgehaald via pg_get_functiondef op de live DB, 2026-07-01) plus
-- de twee toevoegingen: de INSERT-kolom/waarde in create_order_with_lines, en
-- de CASE-tak (mirrort lever_modus) in update_order_with_lines.

CREATE OR REPLACE FUNCTION public.create_order_with_lines(p_order jsonb, p_regels jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_order_nr      TEXT;
    v_order_id      BIGINT;
    v_debiteur_nr   INTEGER;
    v_prijslijst_nr TEXT;
BEGIN
    v_debiteur_nr := (p_order->>'debiteur_nr')::INTEGER;

    SELECT prijslijst_nr INTO v_prijslijst_nr
      FROM debiteuren
     WHERE debiteur_nr = v_debiteur_nr;

    IF v_prijslijst_nr IS NULL THEN
      RAISE EXCEPTION
        'Debiteur % heeft geen prijslijst gekoppeld — koppel eerst een prijslijst aan deze klant voordat je een order aanmaakt.',
        v_debiteur_nr
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_order_nr := volgend_nummer('ORD');

    INSERT INTO orders (
        order_nr, debiteur_nr, orderdatum, afleverdatum, klant_referentie,
        week, vertegenw_code, betaler, inkooporganisatie,
        fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
        fact_email,
        afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
        afl_email,
        lever_modus,
        afhalen,
        combi_levering_override,
        lever_type,
        status
    ) VALUES (
        v_order_nr,
        v_debiteur_nr,
        COALESCE((p_order->>'orderdatum')::DATE, CURRENT_DATE),
        (p_order->>'afleverdatum')::DATE,
        p_order->>'klant_referentie',
        p_order->>'week',
        p_order->>'vertegenw_code',
        (p_order->>'betaler')::INTEGER,
        p_order->>'inkooporganisatie',
        p_order->>'fact_naam', p_order->>'fact_adres',
        p_order->>'fact_postcode', p_order->>'fact_plaats', p_order->>'fact_land',
        NULLIF(p_order->>'fact_email', ''),
        p_order->>'afl_naam', p_order->>'afl_naam_2',
        p_order->>'afl_adres', p_order->>'afl_postcode',
        p_order->>'afl_plaats', p_order->>'afl_land',
        NULLIF(p_order->>'afl_email', ''),
        NULLIF(p_order->>'lever_modus', ''),
        COALESCE((p_order->>'afhalen')::BOOLEAN, FALSE),
        COALESCE((p_order->>'combi_levering_override')::BOOLEAN, FALSE),
        COALESCE(NULLIF(p_order->>'lever_type', ''), 'week')::lever_type,
        'Concept'  -- mig 542: alle handmatige orders beginnen in Concept
    ) RETURNING id INTO v_order_id;

    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code,
        klant_referentie
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
        r->>'maatwerk_instructies',
        (r->>'maatwerk_m2_prijs')::NUMERIC,
        (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        (r->>'maatwerk_diameter_cm')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code',
        NULLIF(r->>'klant_referentie', '')
    FROM jsonb_array_elements(p_regels) AS r;

    RETURN jsonb_build_object('id', v_order_id, 'order_nr', v_order_nr);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_order_with_lines(p_order_id bigint, p_header jsonb, p_regels jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_blokkerende_status TEXT;
    v_te_verwijderen_ids BIGINT[];
    v_snijplan_ids       BIGINT[];
BEGIN
    -- ── Header ──────────────────────────────────────────────────────────────
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
        combi_levering_override = CASE
          WHEN p_header ? 'combi_levering_override'
            THEN COALESCE((p_header->>'combi_levering_override')::BOOLEAN, false)
          ELSE combi_levering_override
        END
    WHERE id = p_order_id;

    -- ── Bepaal welke orderregels verdwijnen ──────────────────────────────────
    SELECT ARRAY(
        SELECT id FROM order_regels
        WHERE order_id = p_order_id
          AND id NOT IN (
              SELECT (r->>'id')::BIGINT
              FROM jsonb_array_elements(p_regels) r
              WHERE (r->>'id') IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM order_regels oreg2
                    WHERE oreg2.id = (r->>'id')::BIGINT
                      AND oreg2.order_id = p_order_id
                )
          )
    ) INTO v_te_verwijderen_ids;

    IF array_length(v_te_verwijderen_ids, 1) > 0 THEN

        -- ── Guard: blokkeer als snijplan al in uitvoering ──────────────────
        SELECT sp.status INTO v_blokkerende_status
        FROM snijplannen sp
        WHERE sp.order_regel_id = ANY(v_te_verwijderen_ids)
          AND sp.status NOT IN ('Wacht', 'Gepland', 'Geannuleerd')
        LIMIT 1;

        IF v_blokkerende_status IS NOT NULL THEN
            RAISE EXCEPTION
              'Orderregel heeft een snijplan in uitvoering (status: %). Annuleer het snijplan eerst.',
              v_blokkerende_status
              USING ERRCODE = 'foreign_key_violation';
        END IF;

        -- ── Verzamel te-verwijderen snijplan IDs (vroege status) ───────────
        SELECT ARRAY(
            SELECT id FROM snijplannen
            WHERE order_regel_id = ANY(v_te_verwijderen_ids)
              AND status IN ('Wacht', 'Gepland', 'Geannuleerd')
        ) INTO v_snijplan_ids;

        IF array_length(v_snijplan_ids, 1) > 0 THEN
            -- Eerst de tabellen die naar snijplannen verwijzen opruimen
            DELETE FROM snijvoorstel_plaatsingen
            WHERE snijplan_id = ANY(v_snijplan_ids);

            DELETE FROM confectie_orders
            WHERE snijplan_id = ANY(v_snijplan_ids);

            -- Dan de snijplannen zelf
            DELETE FROM snijplannen
            WHERE id = ANY(v_snijplan_ids);
        END IF;

    END IF;

    -- ── 1. DELETE orderregels die niet meer in p_regels staan ───────────────
    DELETE FROM order_regels
    WHERE order_id = p_order_id
      AND id = ANY(v_te_verwijderen_ids);

    -- ── 2. UPDATE bestaande regels in-place ─────────────────────────────────
    UPDATE order_regels SET
        regelnummer           = (r->>'regelnummer')::INTEGER,
        artikelnr             = r->>'artikelnr',
        karpi_code            = r->>'karpi_code',
        omschrijving          = r->>'omschrijving',
        omschrijving_2        = r->>'omschrijving_2',
        orderaantal           = (r->>'orderaantal')::INTEGER,
        te_leveren            = (r->>'te_leveren')::INTEGER,
        prijs                 = (r->>'prijs')::NUMERIC,
        korting_pct           = COALESCE((r->>'korting_pct')::NUMERIC, 0),
        bedrag                = (r->>'bedrag')::NUMERIC,
        gewicht_kg            = (r->>'gewicht_kg')::NUMERIC,
        fysiek_artikelnr      = r->>'fysiek_artikelnr',
        omstickeren           = COALESCE((r->>'omstickeren')::BOOLEAN, false),
        is_maatwerk           = COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        maatwerk_vorm         = r->>'maatwerk_vorm',
        maatwerk_lengte_cm    = (r->>'maatwerk_lengte_cm')::INTEGER,
        maatwerk_breedte_cm   = (r->>'maatwerk_breedte_cm')::INTEGER,
        maatwerk_afwerking    = r->>'maatwerk_afwerking',
        maatwerk_band_kleur   = r->>'maatwerk_band_kleur',
        maatwerk_instructies  = r->>'maatwerk_instructies',
        maatwerk_m2_prijs     = (r->>'maatwerk_m2_prijs')::NUMERIC,
        maatwerk_kostprijs_m2 = (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        maatwerk_oppervlak_m2 = (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        maatwerk_vorm_toeslag = (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        maatwerk_afwerking_prijs = (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        maatwerk_diameter_cm  = (r->>'maatwerk_diameter_cm')::INTEGER,
        maatwerk_kwaliteit_code = r->>'maatwerk_kwaliteit_code',
        maatwerk_kleur_code   = r->>'maatwerk_kleur_code',
        klant_referentie      = NULLIF(r->>'klant_referentie', ''),
        is_vrije_regel        = COALESCE((r->>'is_vrije_regel')::BOOLEAN, FALSE)
    FROM jsonb_array_elements(p_regels) AS r
    WHERE order_regels.order_id = p_order_id
      AND (r->>'id') IS NOT NULL
      AND order_regels.id = (r->>'id')::BIGINT;

    -- ── 3. INSERT nieuwe regels ──────────────────────────────────────────────
    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code,
        klant_referentie,
        is_vrije_regel
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
        r->>'maatwerk_instructies',
        (r->>'maatwerk_m2_prijs')::NUMERIC,
        (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        (r->>'maatwerk_diameter_cm')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code',
        NULLIF(r->>'klant_referentie', ''),
        COALESCE((r->>'is_vrije_regel')::BOOLEAN, FALSE)
    FROM jsonb_array_elements(p_regels) AS r
    WHERE (r->>'id') IS NULL
       OR NOT EXISTS (
           SELECT 1 FROM order_regels
           WHERE id = (r->>'id')::BIGINT AND order_id = p_order_id
       );
END;
$function$;

NOTIFY pgrst, 'reload schema';
