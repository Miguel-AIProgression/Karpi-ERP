-- Migratie 547: update_order_with_lines — herstel snijplan-cleanup bij DELETE van regelss
--
-- Aanleiding: een maatwerk-orderregel verwijderen (om 'm te vervangen door een
-- standaard-maat-regel) gooit:
--   "update or delete on table 'order_regels' violates foreign key constraint
--    'snijplannen_order_regel_id_fkey' on table 'snijplannen'"
--
-- Root cause: mig 527 (UPSERT-refactor) nam de snijplan-cleanup uit mig 317
-- niet mee. Stap 1 van de UPSERT (DELETE weggevallen regels) botst op de FK
-- zodra de weg te gooien orderregel een snijplan heeft.
--
-- Fix: vóór de DELETE, voor de specifieke regels die verdwijnen:
--   a) RAISE als er snijplannen zijn in latere status (Snijden/Gesneden/+) —
--      die zitten fysiek onder het mes, niet zomaar weg te gooien.
--   b) DELETE snijplannen in vroege status (Wacht/Gepland/Geannuleerd) —
--      die zijn nog niet in uitvoering, veilig te verwijderen bij een edit.
--
-- Niet gewijzigd: stap 2 (UPDATE in-place) en stap 3 (INSERT nieuw) zijn identiek
-- aan mig 527. Alleen het DECLARE + de guard/cleanup vóór stap 1 zijn nieuw.

CREATE OR REPLACE FUNCTION update_order_with_lines(p_order_id BIGINT, p_header JSONB, p_regels JSONB)
RETURNS VOID AS $$
DECLARE
    v_blokkerende_status TEXT;
    v_te_verwijderen_ids BIGINT[];
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
        END
    WHERE id = p_order_id;

    -- ── Bepaal welke regels verdwijnen ──────────────────────────────────────
    -- (de regels die in de DB bestaan maar NIET in p_regels voorkomen)
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

    -- ── Guard: blokkeer als snijplan al in uitvoering ───────────────────────
    IF array_length(v_te_verwijderen_ids, 1) > 0 THEN
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

        -- ── Cleanup snijplannen in vroege status ────────────────────────────
        DELETE FROM snijplannen
        WHERE order_regel_id = ANY(v_te_verwijderen_ids)
          AND status IN ('Wacht', 'Gepland', 'Geannuleerd');
    END IF;

    -- ── 1. DELETE regels die niet meer in p_regels staan ────────────────────
    DELETE FROM order_regels
    WHERE order_id = p_order_id
      AND id = ANY(v_te_verwijderen_ids);

    -- ── 2. UPDATE bestaande regels in-place ─────────────────────────────────
    -- verzendweek / verzendweek_bron: bewust NIET in SET — beheerd door
    -- set_regel_verzendweek (mig 334) en trg_snijplan_rol_toegewezen_auto_verzendweek.
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

    -- ── 3. INSERT nieuwe regels (geen id, of id bestaat niet in DB) ─────────
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_order_with_lines(BIGINT, JSONB, JSONB) IS
  'Update order header + UPSERT regels. Mig 547: herstel snijplan-cleanup bij DELETE '
  'van regels (mig 317-logica die in mig 527 ontbrak): vroege snijplannen (Wacht/Gepland/'
  'Geannuleerd) automatisch verwijderen, late snijplannen (Snijden/Gesneden/+) blokkeren. '
  'Eerder: mig 527 UPSERT, mig 406 klant_referentie, mig 407 verzendweek, '
  'mig 317 snijplan-guard (nu hersteld), mig 204 afhalen, mig 152 lever_modus.';

NOTIFY pgrst, 'reload schema';
