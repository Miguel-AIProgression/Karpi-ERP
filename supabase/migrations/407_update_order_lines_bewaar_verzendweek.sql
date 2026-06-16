-- Migratie 407: bewaar verzendweek-overrides bij order bewerken
--
-- Probleem (bug 2026-06-16): update_order_with_lines (mig 406) doet
-- DELETE FROM order_regels + INSERT. De kolom `verzendweek` (mig 334)
-- stond niet in de INSERT-kolomlijst, waardoor een handmatig ingestelde
-- verzendweek per orderregel verloren ging zodra de order bewerkt werd.
--
-- Oplossing: bewaar de bestaande verzendweek-waarden per regelnummer
-- vóór de DELETE, herstel ze na de INSERT.
--
-- Aanpak: JSONB-map {regelnummer::TEXT → verzendweek} om de waarden
-- te bewaren over de DELETE heen; na INSERT één correlated UPDATE.

CREATE OR REPLACE FUNCTION update_order_with_lines(p_order_id BIGINT, p_header JSONB, p_regels JSONB)
RETURNS VOID AS $$
DECLARE
  v_verzendweken JSONB;
BEGIN
    -- Mig 407: bewaar bestaande verzendweek-overrides per regelnummer
    -- zodat ze na de DELETE+INSERT hersteld worden.
    SELECT jsonb_object_agg(regelnummer::TEXT, verzendweek)
      INTO v_verzendweken
      FROM order_regels
     WHERE order_id = p_order_id
       AND verzendweek IS NOT NULL;

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
        END
    WHERE id = p_order_id;

    DELETE FROM order_regels WHERE order_id = p_order_id;

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
        NULLIF(r->>'klant_referentie', '')
    FROM jsonb_array_elements(p_regels) AS r;

    -- Mig 407: herstel verzendweek-overrides per regelnummer
    IF v_verzendweken IS NOT NULL AND v_verzendweken <> 'null'::JSONB THEN
      UPDATE order_regels orr
         SET verzendweek = v_verzendweken->>(orr.regelnummer::TEXT)
       WHERE orr.order_id = p_order_id
         AND v_verzendweken ? (orr.regelnummer::TEXT);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_order_with_lines(BIGINT, JSONB, JSONB) IS
  'Mig 407: bewaart verzendweek-overrides per regelnummer over de DELETE+INSERT heen '
  '(was mig 406 klant_referentie per regel).';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 407 toegepast: update_order_with_lines bewaart verzendweek bij order bewerken.';
END $$;
