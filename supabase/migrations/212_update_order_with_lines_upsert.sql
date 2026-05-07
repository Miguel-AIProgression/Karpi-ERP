-- Migratie 212: update_order_with_lines — UPSERT i.p.v. delete-and-recreate
--
-- Probleem: de bestaande RPC (laatst herzien in mig 204) doet eerst
-- `DELETE FROM order_regels WHERE order_id = p_order_id` en daarna een
-- volledige re-INSERT. Dat faalt zodra een `zending_regels`-, `factuur_regels`-
-- of `snijplannen`-rij naar één van die order_regels wijst met een FK die
-- geen ON DELETE SET NULL/CASCADE heeft (of waarvan de referentie-kolom
-- NOT NULL is). Concrete melding gezien op productie:
--   "update or delete on table order_regels violates foreign key constraint
--    zending_regels_order_regel_id_fkey on table zending_regels"
--
-- Naast de directe fout breekt re-creating-by-id ook de zending-↔ orderregel-
-- audittrail: een net-re-inserted regel krijgt een nieuwe `id`, dus zelfs bij
-- ON DELETE SET NULL verlies je stilletjes de koppeling van zending_regels
-- naar de orderregel. Niet wenselijk.
--
-- Oplossing: behandel `p_regels` als de gewenste eindstaat en match per
-- regel-id:
--   1. regels die *niet* meer in de input staan → DELETE
--      (zending/factuur-FKs vallen dan onder hun eigen ON DELETE-policy of
--       blokkeren — beide correct gedrag)
--   2. regels met een meegestuurde `id` die ook in de DB bestaan → UPDATE
--      (id blijft hetzelfde, zending/factuur-koppelingen blijven intact)
--   3. regels zonder `id` (of met id die niet bestaat) → INSERT
--
-- Header-only wijzigingen (zoals het instellen van een andere verzendweek
-- op een al-verzonden / al-deels-gefactureerde order) raken stap 1/3 dus
-- niet meer; alleen stap 2 voert no-op-UPDATEs uit.

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
        END
    WHERE id = p_order_id;

    -- Verzamel de id's die de frontend meestuurt — dat is de "houden"-set.
    SELECT COALESCE(
      ARRAY_AGG(NULLIF(r->>'id', '')::BIGINT) FILTER (WHERE NULLIF(r->>'id', '') IS NOT NULL),
      ARRAY[]::BIGINT[]
    )
    INTO v_input_ids
    FROM jsonb_array_elements(p_regels) AS r;

    -- 1. DELETE regels die niet meer in de input staan.
    --    FK-policies op zending_regels / factuur_regels / snijplannen bepalen
    --    of dit slaagt; verwijderen van een regel waar al iets aan hangt blijft
    --    een legitieme fout (de gebruiker probeert dan iets onmogelijks).
    DELETE FROM order_regels
    WHERE order_id = p_order_id
      AND id <> ALL(v_input_ids);

    -- 2. UPDATE bestaande regels — match op order_id + id, kolommen 1-op-1
    --    uit de JSON-input. Volgorde van set-list spiegelt de INSERT eronder
    --    om diff-review makkelijk te houden.
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

COMMENT ON FUNCTION update_order_with_lines(BIGINT, JSONB, JSONB) IS
  'Update order header + UPSERT regels (mig 212): bestaande id''s behouden, '
  'verdwenen regels DELETE, nieuwe regels INSERT. Voorheen delete-and-recreate '
  'wat FK-conflicten gaf met zending_regels/factuur_regels en de audit-trail '
  'tussen zending en orderregel verbrak.';

NOTIFY pgrst, 'reload schema';
