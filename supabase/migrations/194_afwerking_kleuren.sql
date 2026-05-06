-- ============================================================================
-- Migratie 194 — Afwerking-kleuren centraliseren
-- ============================================================================
-- Doel:
--  1. Master-tabel afwerking_kleuren (per afwerking eigen lijst van labels).
--  2. FK in maatwerk_band_defaults (default-bandkleur per kwaliteit+kleur).
--  3. FK in order_regels (strict-FK opslag bij order-creatie).
--  4. Auto-seed: Piero-rijen onder SB, op basis van bestaande maatwerk_band_defaults.
--  5. Backfill: maatwerk_band_defaults.afwerking_kleur_id voor matchende rijen.
--
-- Niet droppen:
--  - maatwerk_band_defaults.{band_merk,band_kleur,band_omschrijving} — fallback voor
--    niet-gemigreerde rijen (DA12/RM12/PE21) tot user ze handmatig invult.
--  - order_regels.maatwerk_band_kleur (TEXT) — historische snapshot per orderbon.
-- ============================================================================

-- 1) Master-tabel
CREATE TABLE IF NOT EXISTS afwerking_kleuren (
  id              BIGSERIAL PRIMARY KEY,
  afwerking_code  TEXT NOT NULL REFERENCES afwerking_types(code) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  volgorde        INTEGER NOT NULL DEFAULT 0,
  actief          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT afwerking_kleuren_uk UNIQUE (afwerking_code, label)
);

CREATE INDEX IF NOT EXISTS afwerking_kleuren_afwerking_idx
  ON afwerking_kleuren (afwerking_code, volgorde, label);

COMMENT ON TABLE afwerking_kleuren IS
  'Master-lijst van afwerking-labels (bv. "Piero Taupe 431"). Per afwerking eigen scope. Voedt order-form bandkleur-dropdown.';

-- 2) FK op maatwerk_band_defaults
ALTER TABLE maatwerk_band_defaults
  ADD COLUMN IF NOT EXISTS afwerking_kleur_id BIGINT
    REFERENCES afwerking_kleuren(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS maatwerk_band_defaults_kleur_id_idx
  ON maatwerk_band_defaults (afwerking_kleur_id);

-- band_kleur was NOT NULL — voortaan optioneel zodat FK-only rijen kunnen bestaan
ALTER TABLE maatwerk_band_defaults ALTER COLUMN band_kleur DROP NOT NULL;

-- 3) FK op order_regels (strict-FK voor nieuwe orders; legacy TEXT blijft als snapshot)
ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS maatwerk_band_kleur_id BIGINT
    REFERENCES afwerking_kleuren(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS order_regels_band_kleur_id_idx
  ON order_regels (maatwerk_band_kleur_id);

-- 4) Auto-seed onder SB voor Piero-rijen
--    Criterium: band_kleur is puur numeriek of Pantone-vorm (1234 of 11-4800).
--    Sluit DA12/RM12/PE21 uit (die bevatten letters).
INSERT INTO afwerking_kleuren (afwerking_code, label, volgorde)
SELECT
  'SB',
  'Piero ' || initcap(band_omschrijving) || ' ' || band_kleur,
  ROW_NUMBER() OVER (ORDER BY band_kleur, band_omschrijving) * 10
FROM (
  SELECT DISTINCT band_omschrijving, band_kleur
  FROM maatwerk_band_defaults
  WHERE band_kleur ~ '^[0-9]+(-[0-9]+)?$'
    AND band_omschrijving IS NOT NULL
    AND length(trim(band_omschrijving)) > 0
) src
ON CONFLICT (afwerking_code, label) DO NOTHING;

-- 5) Backfill afwerking_kleur_id op maatwerk_band_defaults voor diezelfde rijen
UPDATE maatwerk_band_defaults d
SET afwerking_kleur_id = ak.id
FROM afwerking_kleuren ak
WHERE ak.afwerking_code = 'SB'
  AND ak.label = 'Piero ' || initcap(d.band_omschrijving) || ' ' || d.band_kleur
  AND d.band_kleur ~ '^[0-9]+(-[0-9]+)?$'
  AND d.band_omschrijving IS NOT NULL
  AND d.afwerking_kleur_id IS NULL;

-- 6) Update RPC's create_order_with_lines + update_order_with_lines met maatwerk_band_kleur_id

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
        afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
        lever_modus,
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
        p_order->>'afl_naam', p_order->>'afl_naam_2',
        p_order->>'afl_adres', p_order->>'afl_postcode',
        p_order->>'afl_plaats', p_order->>'afl_land',
        NULLIF(p_order->>'lever_modus', ''),
        'Nieuw'
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

CREATE OR REPLACE FUNCTION update_order_with_lines(p_order_id BIGINT, p_header JSONB, p_regels JSONB)
RETURNS VOID AS $$
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

COMMENT ON FUNCTION create_order_with_lines(JSONB, JSONB) IS
  'Maakt order + regels atomair. Sinds mig 152: lever_modus. Sinds mig 194: maatwerk_band_kleur_id.';
COMMENT ON FUNCTION update_order_with_lines(BIGINT, JSONB, JSONB) IS
  'Update order header + replace regels atomair. Sinds mig 152: lever_modus. Sinds mig 194: maatwerk_band_kleur_id.';
