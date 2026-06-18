-- Migratie 422: update_order_with_lines — herstel UPSERT-patroon + snijplan-guard
--
-- Probleem (bug 2026-06-18, gemeld op order ORD-2026-0623, regel 6222
-- "Vernon 17 - Shadow Taupe rond"): bij het opslaan van een orderwijziging
-- gooit de RPC een FK-violation (snijplannen_order_regel_id_fkey) zodra ook
-- maar één orderregel een gekoppeld snijplan heeft — ongeacht de status, en
-- ongeacht of die specifieke regel überhaupt gewijzigd wordt.
--
-- Root cause: een dubbele regressie.
--   1. Mig 212 verving de oorspronkelijke "DELETE alle regels + re-INSERT"
--      door een UPSERT-patroon (match op meegestuurde `id`), juist om FK-
--      violaties op zending_regels/factuur_regels/snijplannen te voorkomen
--      en de audit-trail (id-stabiliteit) te bewaren.
--   2. Mig 317 (snijplan-cleanup) herschreef de functie vanaf een ouder
--      full-delete-insert-snapshot — het UPSERT-patroon verdween, vervangen
--      door een guard die ALLE vroege-status snijplannen op de hele order
--      opruimt vóór een blinde DELETE+INSERT. Mig 333/364 bouwden daarop voort.
--   3. Mig 406 (klant_referentie per regel) herschreef de functie wéér vanaf
--      een nóg ouder snapshot (vóór mig 317) — nu verdween ook de snijplan-
--      guard/cleanup zelf, plus afhalen/lever_type/fact_email/afl_email/
--      maatwerk_band_kleur_id. Mig 407 voegde alleen een verzendweek-patch
--      toe op die geregresseerde body — vandaar de huidige, harde FK-fout.
--
-- Fix: UPSERT-patroon (mig 212) herstellen als basis. Orderregels die de
-- gebruiker niet verwijdert behouden hun `id`, dus hun snijplan-koppeling
-- blijft gewoon intact — er is dan helemaal geen cleanup nodig. Alleen
-- regels die de gebruiker daadwerkelijk *verwijdert* kunnen nog een FK-
-- conflict geven; daarvoor blijft een guard bestaan, met de drempel die al
-- elders in de codebase geldt (frontend `order-lock.ts`: STAGE-map zet
-- Snijden=0/Gesneden=1, dus bewerkbaar tot en met 'Snijden', geblokkeerd
-- vanaf 'Gesneden'). Dat is bewust soepeler dan mig 317's oude drempel
-- (die blokkeerde al bij 'Snijden') — sluit aan op de bedrijfsregel die de
-- gebruiker bevestigde: een maatwerk-regel is wijzigbaar tot 'Gesneden'.
--
-- Verzendweek (mig 407): met UPSERT is de aparte bewaar/herstel-stap niet
-- meer nodig — `verzendweek` staat niet in de UPDATE SET-lijst van bestaande
-- regels, dus blijft gewoon ongewijzigd staan.
--
-- Hersteld t.o.v. de huidige live (mig 407) body: afhalen (204), lever_type
-- (245), fact_email/afl_email (364), maatwerk_band_kleur_id (194).
-- Behouden: klant_referentie per regel (406), verzendweek-behoud (407, nu
-- impliciet via UPSERT i.p.v. een JSONB-snapshot-hack).

CREATE OR REPLACE FUNCTION update_order_with_lines(p_order_id BIGINT, p_header JSONB, p_regels JSONB)
RETURNS VOID AS $$
DECLARE
  v_input_ids BIGINT[];
  v_blokkerende_status TEXT;
BEGIN
    -- Verzamel de id's die de frontend meestuurt — dat is de "houden"-set.
    SELECT COALESCE(
      ARRAY_AGG(NULLIF(r->>'id', '')::BIGINT) FILTER (WHERE NULLIF(r->>'id', '') IS NOT NULL),
      ARRAY[]::BIGINT[]
    )
    INTO v_input_ids
    FROM jsonb_array_elements(p_regels) AS r;

    -- Guard: een regel die verwijderd wordt mag geen snijplan hebben dat al
    -- gesneden is (of verder) — bewerkbaar/verwijderbaar tot en met 'Snijden'.
    SELECT sp.status INTO v_blokkerende_status
    FROM snijplannen sp
    JOIN order_regels or2 ON or2.id = sp.order_regel_id
    WHERE or2.order_id = p_order_id
      AND or2.id <> ALL(v_input_ids)
      AND sp.status IN ('Gesneden', 'In confectie', 'Gereed', 'Ingepakt')
    LIMIT 1;

    IF v_blokkerende_status IS NOT NULL THEN
        RAISE EXCEPTION
          'Orderregel kan niet verwijderd worden: snijplan is al gesneden (status: %). Annuleer het snijplan eerst.',
          v_blokkerende_status;
    END IF;

    -- Ruim snijvoorstel_plaatsingen + snijplannen in vroege status op voor
    -- regels die straks verwijderd worden (anders blokkeert de FK de DELETE
    -- hieronder). Regels die blijven bestaan worden hier niet geraakt.
    DELETE FROM snijvoorstel_plaatsingen
    WHERE snijplan_id IN (
        SELECT sp.id FROM snijplannen sp
        JOIN order_regels or2 ON or2.id = sp.order_regel_id
        WHERE or2.order_id = p_order_id
          AND or2.id <> ALL(v_input_ids)
          AND sp.status IN ('Wacht', 'Gepland', 'In productie', 'Snijden')
    );

    DELETE FROM snijplannen
    WHERE order_regel_id IN (
        SELECT id FROM order_regels
        WHERE order_id = p_order_id AND id <> ALL(v_input_ids)
    )
    AND status IN ('Wacht', 'Gepland', 'In productie', 'Snijden');

    -- Orphaned concept-snijvoorstellen opruimen (mig 333-gedrag).
    DELETE FROM snijvoorstellen
    WHERE id NOT IN (SELECT DISTINCT voorstel_id FROM snijvoorstel_plaatsingen)
      AND status IN ('concept');

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
        END
    WHERE id = p_order_id;

    -- 1. DELETE regels die niet meer in de input staan.
    DELETE FROM order_regels
    WHERE order_id = p_order_id
      AND id <> ALL(v_input_ids);

    -- 2. UPDATE bestaande regels — match op order_id + id, kolommen 1-op-1
    --    uit de JSON-input.
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
        maatwerk_kleur_code = r->>'maatwerk_kleur_code',
        klant_referentie = NULLIF(r->>'klant_referentie', '')
    FROM jsonb_array_elements(p_regels) AS r
    WHERE o.order_id = p_order_id
      AND o.id = NULLIF(r->>'id', '')::BIGINT;

    -- 3. INSERT nieuwe regels (geen id in input).
    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_band_kleur_id, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code,
        klant_referentie
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
        r->>'maatwerk_kleur_code',
        NULLIF(r->>'klant_referentie', '')
    FROM jsonb_array_elements(p_regels) AS r
    WHERE NULLIF(r->>'id', '') IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_order_with_lines(BIGINT, JSONB, JSONB) IS
  'Mig 422: herstelt het UPSERT-patroon (mig 212, verloren via mig 317->406) zodat '
  'ongewijzigde regels hun id en snijplan-koppeling behouden. Snijplan-guard alleen nog '
  'voor regels die daadwerkelijk verwijderd worden, drempel verschoven naar Gesneden+ '
  '(was Snijden+) conform frontend order-lock.ts. Herstelt afhalen (204), lever_type (245), '
  'fact_email/afl_email (364), maatwerk_band_kleur_id (194) die mig 406 liet vallen. '
  'Verzendweek (407) blijft nu impliciet behouden (niet in de UPDATE SET-lijst) — de losse '
  'bewaar/herstel-stap is niet meer nodig.';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 422 toegepast: update_order_with_lines herstelt UPSERT + snijplan-guard (drempel Gesneden+).';
END $$;
