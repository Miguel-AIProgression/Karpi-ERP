-- Migration 074: update_order_with_lines doet nu een merge i.p.v. delete+insert.
--
-- Context: de originele RPC (zie plan 2026-04-09) verwijderde álle order_regels
-- voor een order en voegde ze opnieuw toe. Dat faalt zodra een regel al
-- gekoppeld is aan een snijplan (`snijplannen.order_regel_id` → order_regels.id),
-- want die FK heeft geen ON DELETE. Resultaat: "update or delete on table
-- order_regels violates foreign key constraint snijplannen_order_regel_id_fkey".
--
-- Fix: merge-strategie op basis van regel-id.
--   * regels met id → UPDATE (id blijft stabiel, snijplan-koppeling blijft intact)
--   * regels zonder id → INSERT (nieuw aangemaakt in de UI)
--   * bestaande regels die niet meer in de payload staan → DELETE
--     (faalt terecht als er nog een snijplan aan hangt — UI moet dat voorkomen)

CREATE OR REPLACE FUNCTION update_order_with_lines(
  p_order_id BIGINT,
  p_header JSONB,
  p_regels JSONB
)
RETURNS VOID AS $$
DECLARE
  r JSONB;
  v_keep_ids BIGINT[];
BEGIN
  UPDATE orders SET
    klant_referentie = p_header->>'klant_referentie',
    afleverdatum = NULLIF(p_header->>'afleverdatum','')::DATE,
    week = p_header->>'week',
    vertegenw_code = p_header->>'vertegenw_code',
    betaler = NULLIF(p_header->>'betaler','')::INTEGER,
    inkooporganisatie = p_header->>'inkooporganisatie',
    fact_naam = p_header->>'fact_naam',
    fact_adres = p_header->>'fact_adres',
    fact_postcode = p_header->>'fact_postcode',
    fact_plaats = p_header->>'fact_plaats',
    fact_land = p_header->>'fact_land',
    afl_naam = p_header->>'afl_naam',
    afl_naam_2 = p_header->>'afl_naam_2',
    afl_adres = p_header->>'afl_adres',
    afl_postcode = p_header->>'afl_postcode',
    afl_plaats = p_header->>'afl_plaats',
    afl_land = p_header->>'afl_land'
  WHERE id = p_order_id;

  SELECT COALESCE(array_agg((elem->>'id')::BIGINT), ARRAY[]::BIGINT[])
    INTO v_keep_ids
    FROM jsonb_array_elements(p_regels) elem
   WHERE elem->>'id' IS NOT NULL;

  DELETE FROM order_regels
   WHERE order_id = p_order_id
     AND NOT (id = ANY(v_keep_ids));

  FOR r IN SELECT * FROM jsonb_array_elements(p_regels)
  LOOP
    IF r->>'id' IS NOT NULL THEN
      UPDATE order_regels SET
        regelnummer = (r->>'regelnummer')::INTEGER,
        artikelnr = r->>'artikelnr',
        karpi_code = r->>'karpi_code',
        omschrijving = r->>'omschrijving',
        omschrijving_2 = r->>'omschrijving_2',
        orderaantal = (r->>'orderaantal')::INTEGER,
        te_leveren = (r->>'te_leveren')::INTEGER,
        prijs = NULLIF(r->>'prijs','')::NUMERIC,
        korting_pct = COALESCE((r->>'korting_pct')::NUMERIC, 0),
        bedrag = NULLIF(r->>'bedrag','')::NUMERIC,
        gewicht_kg = NULLIF(r->>'gewicht_kg','')::NUMERIC,
        fysiek_artikelnr = r->>'fysiek_artikelnr',
        omstickeren = COALESCE((r->>'omstickeren')::BOOLEAN, false),
        is_maatwerk = COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        maatwerk_vorm = r->>'maatwerk_vorm',
        maatwerk_lengte_cm = NULLIF(r->>'maatwerk_lengte_cm','')::INTEGER,
        maatwerk_breedte_cm = NULLIF(r->>'maatwerk_breedte_cm','')::INTEGER,
        maatwerk_afwerking = r->>'maatwerk_afwerking',
        maatwerk_band_kleur = r->>'maatwerk_band_kleur',
        maatwerk_instructies = r->>'maatwerk_instructies',
        maatwerk_m2_prijs = NULLIF(r->>'maatwerk_m2_prijs','')::NUMERIC,
        maatwerk_kostprijs_m2 = NULLIF(r->>'maatwerk_kostprijs_m2','')::NUMERIC,
        maatwerk_oppervlak_m2 = NULLIF(r->>'maatwerk_oppervlak_m2','')::NUMERIC,
        maatwerk_vorm_toeslag = NULLIF(r->>'maatwerk_vorm_toeslag','')::NUMERIC,
        maatwerk_afwerking_prijs = NULLIF(r->>'maatwerk_afwerking_prijs','')::NUMERIC,
        maatwerk_diameter_cm = NULLIF(r->>'maatwerk_diameter_cm','')::INTEGER,
        maatwerk_kwaliteit_code = r->>'maatwerk_kwaliteit_code',
        maatwerk_kleur_code = r->>'maatwerk_kleur_code'
      WHERE id = (r->>'id')::BIGINT AND order_id = p_order_id;
    ELSE
      INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code
      ) VALUES (
        p_order_id,
        (r->>'regelnummer')::INTEGER,
        r->>'artikelnr',
        r->>'karpi_code',
        r->>'omschrijving',
        r->>'omschrijving_2',
        (r->>'orderaantal')::INTEGER,
        (r->>'te_leveren')::INTEGER,
        NULLIF(r->>'prijs','')::NUMERIC,
        COALESCE((r->>'korting_pct')::NUMERIC, 0),
        NULLIF(r->>'bedrag','')::NUMERIC,
        NULLIF(r->>'gewicht_kg','')::NUMERIC,
        r->>'fysiek_artikelnr',
        COALESCE((r->>'omstickeren')::BOOLEAN, false),
        COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        r->>'maatwerk_vorm',
        NULLIF(r->>'maatwerk_lengte_cm','')::INTEGER,
        NULLIF(r->>'maatwerk_breedte_cm','')::INTEGER,
        r->>'maatwerk_afwerking',
        r->>'maatwerk_band_kleur',
        r->>'maatwerk_instructies',
        NULLIF(r->>'maatwerk_m2_prijs','')::NUMERIC,
        NULLIF(r->>'maatwerk_kostprijs_m2','')::NUMERIC,
        NULLIF(r->>'maatwerk_oppervlak_m2','')::NUMERIC,
        NULLIF(r->>'maatwerk_vorm_toeslag','')::NUMERIC,
        NULLIF(r->>'maatwerk_afwerking_prijs','')::NUMERIC,
        NULLIF(r->>'maatwerk_diameter_cm','')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code'
      );
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_order_with_lines IS
  'Merge-update van order header + regels. Matcht bestaande regels op id zodat snijplan-koppelingen intact blijven (migratie 074).';
