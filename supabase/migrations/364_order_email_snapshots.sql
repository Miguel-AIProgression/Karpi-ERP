-- Migratie 364: email-snapshots op orders (fact_email) en afleveradressen.email
--
-- orders.fact_email  — per-order snapshot van het factuur-e-mailadres.
--                      Gevuld bij aanmaken vanuit debiteuren.email_factuur
--                      (fallback: email_overig). Bewerkbaar per order.
-- afleveradressen.email — standaard afleveradres-email, wordt als default
--                         afl_email in nieuwe orders gebruikt.
--
-- Beide RPCs (create/update_order_with_lines) uitgebreid met fact_email + afl_email.
-- orders.afl_email bestond al (mig 084) maar werd nooit gevuld via de RPC's.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fact_email TEXT;

COMMENT ON COLUMN orders.fact_email IS
  'Per-order snapshot van het factuur-e-mailadres (mig 364). '
  'Initieel gevuld vanuit debiteuren.email_factuur (of email_overig als fallback).';

ALTER TABLE afleveradressen
  ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN afleveradressen.email IS
  'E-mailadres voor dit afleveradres (mig 364). '
  'Wordt als default afl_email in nieuwe orders gebruikt.';

-- ── create_order_with_lines ──────────────────────────────────────────────────
-- Voeg fact_email + afl_email toe aan de INSERT.
-- Volledige herdefiniëring (OR REPLACE) — body identiek aan mig 275 op de
-- twee extra kolommen na.

CREATE OR REPLACE FUNCTION create_order_with_lines(p_order JSONB, p_regels JSONB)
RETURNS JSONB AS $$
DECLARE
    v_order_nr TEXT;
    v_order_id BIGINT;
BEGIN
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
        (p_order->>'debiteur_nr')::INTEGER,
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
        COALESCE((p_order->>'afhalen')::BOOLEAN, false),
        COALESCE(NULLIF(p_order->>'lever_type', ''), 'week')::lever_type,
        'Klaar voor picken'
    ) RETURNING id INTO v_order_id;

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

    RETURN jsonb_build_object('id', v_order_id, 'order_nr', v_order_nr);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_order_with_lines IS
  'Mig 364: voegt fact_email + afl_email toe aan INSERT. '
  'Eerder: mig 275 status=''Klaar voor picken'', mig 245 lever_type, mig 204 afhalen.';

-- ── update_order_with_lines ──────────────────────────────────────────────────
-- Voeg fact_email + afl_email toe aan de UPDATE SET.
-- Volledige herdefiniëring — body identiek aan mig 333.

CREATE OR REPLACE FUNCTION update_order_with_lines(p_order_id BIGINT, p_header JSONB, p_regels JSONB)
RETURNS VOID AS $$
DECLARE
  v_blokkerende_status TEXT;
BEGIN
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

    DELETE FROM snijvoorstel_plaatsingen
    WHERE snijplan_id IN (
        SELECT sp.id FROM snijplannen sp
        JOIN order_regels or2 ON or2.id = sp.order_regel_id
        WHERE or2.order_id = p_order_id
          AND sp.status IN ('Wacht', 'Gepland')
    );

    DELETE FROM snijvoorstellen
    WHERE id NOT IN (SELECT DISTINCT voorstel_id FROM snijvoorstel_plaatsingen)
      AND status IN ('concept');

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
  'Mig 364: voegt fact_email + afl_email toe aan UPDATE SET. '
  'Eerder: mig 333 snijvoorstel_plaatsingen-cleanup, mig 317 snijplan-cleanup, '
  'mig 245 lever_type, mig 204 afhalen.';

NOTIFY pgrst, 'reload schema';
