-- Migratie 317: update_order_with_lines — ruim snijplannen op vóór regel-vervanging
--
-- Probleem: de RPC doet DELETE FROM order_regels (full replace). Als een orderregel
-- een snijplan heeft, gooit dat een FK-constraint fout — ook als de gebruiker alleen
-- een artikelnr of is_maatwerk-vlag wil corrigeren (bijv. maatwerk → standaard maat).
--
-- Oplossing:
--   1. Verwijder snijplannen in vroege status ('Wacht', 'Gepland') automatisch.
--      Dit zijn plannen die nog niet in uitvoering zijn — veilig om weg te gooien
--      bij een order-edit, conform de bedrijfsregel in ADR/mig 290.
--   2. Als er snijplannen bestaan met latere status ('Snijden', 'Gesneden', ...) geef
--      een duidelijke foutmelding zodat de operator weet wat te doen.
--
-- Geldt ook voor confectie (confectie_afgerond_op IS NOT NULL) als extra guard.

CREATE OR REPLACE FUNCTION update_order_with_lines(p_order_id BIGINT, p_header JSONB, p_regels JSONB)
RETURNS VOID AS $$
DECLARE
  v_blokkerende_status TEXT;
BEGIN
    -- Guard: zijn er snijplannen in uitvoering?
    SELECT sp.status INTO v_blokkerende_status
    FROM snijplannen sp
    JOIN order_regels or2 ON or2.id = sp.order_regel_id
    WHERE or2.order_id = p_order_id
      AND sp.status NOT IN ('Wacht', 'Gepland', 'Geannuleerd')
    LIMIT 1;

    IF v_blokkerende_status IS NOT NULL THEN
        RAISE EXCEPTION
          'Order heeft een snijplan in uitvoering (status: %). Annuleer het snijplan eerst.',
          v_blokkerende_status;
    END IF;

    -- Ruim snijplannen in vroege status op vóór de regel-vervanging
    DELETE FROM snijplannen
    WHERE order_regel_id IN (
        SELECT id FROM order_regels WHERE order_id = p_order_id
    )
    AND status IN ('Wacht', 'Gepland');

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
        END
    WHERE id = p_order_id;

    DELETE FROM order_regels WHERE order_id = p_order_id;

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
    FROM jsonb_array_elements(p_regels) AS r;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_order_with_lines(BIGINT, JSONB, JSONB) IS
  'Update order header + replace regels atomair. Mig 317: verwijdert snijplannen in '
  'vroege status (Wacht/Gepland) automatisch bij opslaan; blokkeert bij Snijden/Gesneden/+. '
  'Eerder: mig 152 lever_modus, mig 194 maatwerk_band_kleur_id, mig 204 afhalen, '
  'mig 245 lever_type.';

NOTIFY pgrst, 'reload schema';
