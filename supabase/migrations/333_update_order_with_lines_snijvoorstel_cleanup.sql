-- Migratie 333: update_order_with_lines — verwijder snijvoorstel_plaatsingen vóór snijplannen
--
-- Bug: mig 317 verwijdert snijplannen in status 'Wacht'/'Gepland' bij een order-edit,
-- maar vergat snijvoorstel_plaatsingen (FK snijvoorstel_plaatsingen_snijplan_id_fkey)
-- eerst op te ruimen → PostgreSQL blokkeerde de delete met een FK-violation.
--
-- Fix: voeg twee DELETE-stappen toe vóór de snijplannen-delete:
--   1. snijvoorstel_plaatsingen die naar die snijplannen verwijzen
--   2. orphaned snijvoorstellen die daarna geen plaatsingen meer hebben
--      (niet strikt noodzakelijk, maar voorkomt ruis in de voorstellen-tabel)

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

    -- Ruim snijvoorstel_plaatsingen op die verwijzen naar de te-verwijderen snijplannen
    -- (FK snijvoorstel_plaatsingen_snijplan_id_fkey blokkeert anders de delete hieronder)
    DELETE FROM snijvoorstel_plaatsingen
    WHERE snijplan_id IN (
        SELECT sp.id FROM snijplannen sp
        JOIN order_regels or2 ON or2.id = sp.order_regel_id
        WHERE or2.order_id = p_order_id
          AND sp.status IN ('Wacht', 'Gepland')
    );

    -- Ruim orphaned snijvoorstellen op (geen plaatsingen meer)
    DELETE FROM snijvoorstellen
    WHERE id NOT IN (SELECT DISTINCT voorstel_id FROM snijvoorstel_plaatsingen)
      AND status IN ('concept');

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
  'Update order header + replace regels atomair. Mig 333: verwijdert snijvoorstel_plaatsingen '
  '+ orphaned concept-snijvoorstellen vóór snijplannen-delete (fix FK-violation). '
  'Mig 317: verwijdert snijplannen in vroege status (Wacht/Gepland) automatisch bij opslaan; '
  'blokkeert bij Snijden/Gesneden/+. Eerder: mig 152 lever_modus, mig 194 maatwerk_band_kleur_id, '
  'mig 204 afhalen, mig 245 lever_type.';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 333 toegepast: update_order_with_lines verwijdert nu snijvoorstel_plaatsingen vóór snijplannen (fix FK-violation).';
END $$;
