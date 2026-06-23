-- Migratie 481: een nieuwe order kan alleen handmatig aangemaakt worden voor
-- een debiteur die aan een prijslijst gekoppeld is.
--
-- Achtergrond
-- -----------
-- Debiteur HEADLAM B.V. (#500001) had nooit een `prijslijst_nr` gekoppeld —
-- pas vandaag rechtgezet. Daardoor stonden 12 openstaande orders op een
-- afwijkende (te lage) prijs, gecorrigeerd in een losse datacorrectie (zie
-- changelog.md). Gebruikerseis: voorkom dit structureel — een debiteur zonder
-- prijslijst-koppeling kan helemaal geen nieuwe order meer krijgen totdat de
-- koppeling gelegd is.
--
-- Scope — uitsluitend de HANDMATIGE creatie-RPC
-- -----------------------------------------------
-- `create_order_with_lines` is de ENIGE RPC achter de order-aanmaak-UI
-- (frontend/src/lib/supabase/queries/order-mutations.ts → createOrder()) —
-- geverifieerd: precies 1 call-site in de hele frontend. Bewust NIET
-- toegepast op `create_edi_order`/`create_webshop_order`: die hebben al een
-- intentionele, bestaande fallback op `producten.verkoopprijs` wanneer er
-- geen prijslijst is (mig 166) — een geautomatiseerd inkomend kanaal mag niet
-- zomaar stil blijven liggen omdat een prijslijst-koppeling ontbreekt; de
-- bestaande prijs-ontbreekt-gate (mig 396) vangt een eventueel verkeerde
-- prijs daar al op voor handmatige nacontrole. Alleen de mens die in de UI
-- bewust een debiteur kiest en op "Order aanmaken" klikt, wordt hier
-- tegengehouden — exact het scenario van de aanleiding.
-- Alleen CREATIE, geen EDIT: bewerken van een bestaande order blijft
-- mogelijk, ook als de prijslijst-koppeling er later om wat voor reden ook
-- niet meer is — anders zou je een al-bestaande order niet eens meer kunnen
-- corrigeren.
--
-- Blast-radius gecheckt vóór deze migratie: van de 138 actieve debiteuren
-- zonder prijslijst kwamen de laatste 14 dagen alleen orders binnen via
-- `bron_systeem IS NULL` (handmatig) en `'oud_systeem'` (legacy import) —
-- nul via EDI/Shopify/webshop. Deze guard raakt dus geen actieve
-- geautomatiseerde intake.

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
        COALESCE(NULLIF(p_order->>'lever_type', ''), 'week')::lever_type,
        'Nieuw'
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

NOTIFY pgrst, 'reload schema';
