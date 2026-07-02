-- ============================================================================
-- Mig 585: herstel verloren header-kolommen in update_order_with_lines
-- ============================================================================
-- Probleem: de herschrijving in mig 527 (upsert-variant) verloor vier
-- toewijzingen uit de header-UPDATE die mig 505 nog had:
--   afhalen, lever_type, fact_email, afl_email
-- Latere herdefinities (547, 548, 572) bouwden op de kapotte body voort.
--
-- Gevolg in productie: "klant haalt zelf op" aanvinken bij het BEWERKEN van
-- een order deed niets — de frontend wiste de afl_*-velden, maar
-- orders.afhalen bleef false. Daardoor sloeg fn_orders_afl_adres_gate aan
-- (rode banner "Afleveradres onvolledig", order geblokkeerd voor Pick & Ship)
-- en werkte de mig-537-bypass op trg_lock_zending_bundel_sleutel nooit.
-- Het aanmaakpad (create_order_with_lines) had dit probleem niet.
--
-- Fix: zelfde body als het schema-snapshot (post-572), met de vier
-- toewijzingen terug — sleutel-aanwezigheids-CASE zodat callers die de
-- sleutel niet meesturen niets overschrijven (NULL-pad-neutraal).
-- Plus een herbruikbare contract-assert die borgt dat de functie álle
-- header-sleutels leest die frontend/src/lib/supabase/queries/
-- order-mutations.ts meestuurt (de "JSONB-RPC sleutel-drop"-valkuil).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_order_with_lines(p_order_id bigint, p_header jsonb, p_regels jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_blokkerende_status TEXT;
    v_te_verwijderen_ids BIGINT[];
    v_snijplan_ids       BIGINT[];
    v_oud_debiteur_nr    INTEGER;
    v_oud_adres_norm     TEXT;
BEGIN
    -- Mig 566: snapshot vóór de header-UPDATE hieronder afl_*/debiteur_nr
    -- overschrijft — nodig om na afloop te detecteren of de order naar een
    -- andere Combi-levering-groep is verhuisd.
    SELECT o.debiteur_nr,
           _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land)
      INTO v_oud_debiteur_nr, v_oud_adres_norm
      FROM orders o WHERE o.id = p_order_id;

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
        fact_email = NULLIF(p_header->>'fact_email', ''),
        afl_naam = p_header->>'afl_naam', afl_naam_2 = p_header->>'afl_naam_2',
        afl_adres = p_header->>'afl_adres', afl_postcode = p_header->>'afl_postcode',
        afl_plaats = p_header->>'afl_plaats', afl_land = p_header->>'afl_land',
        afl_email = NULLIF(p_header->>'afl_email', ''),
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

    -- Mig 566: élke edit (ook prijs-only/regel-delete) herevalueert de
    -- eigen status + de (nieuwe) groep (herbereken_wacht_status cascadet
    -- standaard, mig 559)...
    PERFORM herbereken_wacht_status(p_order_id);
    -- ...en bij een groeps-verhuizing ook de achtergelaten oude groep, die
    -- de normale cascade niet meer bereikt (de order zelf zit er niet meer in).
    IF v_oud_debiteur_nr IS DISTINCT FROM (SELECT debiteur_nr FROM orders WHERE id = p_order_id)
       OR v_oud_adres_norm IS DISTINCT FROM (
         SELECT _normaliseer_afleveradres(afl_adres, afl_postcode, afl_land)
           FROM orders WHERE id = p_order_id)
    THEN
        PERFORM herbereken_combi_groep(v_oud_debiteur_nr, v_oud_adres_norm);
    END IF;
END;
$function$;


-- ============================================================================
-- Contract-assert: update_order_with_lines leest álle header-sleutels die de
-- frontend meestuurt (order-mutations.ts). Wie de functie herdefinieert móet
-- deze assert opnieuw laten slagen (aanroepen in de nieuwe migratie).
-- debiteur_nr wordt bewust meegestuurd maar NIET geüpdatet (klant wisselen op
-- een bestaande order is geen ondersteunde flow) en staat dus niet in de lijst.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assert_update_order_header_contract()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_def TEXT;
  v_sleutel TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'update_order_with_lines';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'contract: update_order_with_lines bestaat niet';
  END IF;

  FOREACH v_sleutel IN ARRAY ARRAY[
    'klant_referentie', 'afleverdatum', 'week', 'vertegenw_code', 'betaler',
    'inkooporganisatie',
    'fact_naam', 'fact_adres', 'fact_postcode', 'fact_plaats', 'fact_land',
    'fact_email',
    'afl_naam', 'afl_naam_2', 'afl_adres', 'afl_postcode', 'afl_plaats',
    'afl_land', 'afl_email',
    'lever_modus', 'afhalen', 'lever_type', 'combi_levering_override'
  ] LOOP
    IF position('''' || v_sleutel || '''' IN v_def) = 0 THEN
      RAISE EXCEPTION
        'contract: update_order_with_lines leest header-sleutel ''%'' niet meer — frontend stuurt die wél (order-mutations.ts). Zie mig 585 (sleutel-drop-regressie mig 527).',
        v_sleutel;
    END IF;
  END LOOP;
END;
$function$;

SELECT assert_update_order_header_contract();
