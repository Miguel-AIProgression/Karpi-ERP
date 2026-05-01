-- Migratie 176: automatische vervoerderselectie op zendingniveau + printset-data
--
-- Vervoerderkeuze hoort niet op de klantkaart. De zending krijgt de gekozen
-- vervoerder, bepaald door een centrale selector. V1 is bewust simpel:
-- precies 1 actieve vervoerder => kies die. Bij 0 of meerdere actieve
-- vervoerders wordt geen keuze gemaakt totdat criteria/tarieven ingericht zijn.
-- Deze migratie scherpt ook create_zending_voor_order aan voor Pick & Ship:
-- order_regels.orderaantal is de bron voor zending_regels.aantal, colli en gewicht.
--
-- Idempotent.

-- ============================================================================
-- Zending bewaart de gekozen vervoerder + uitleg
-- ============================================================================
ALTER TABLE zendingen
  ADD COLUMN IF NOT EXISTS vervoerder_code TEXT REFERENCES vervoerders(code),
  ADD COLUMN IF NOT EXISTS vervoerder_selectie_uitleg JSONB;

CREATE INDEX IF NOT EXISTS idx_zendingen_vervoerder
  ON zendingen (vervoerder_code)
  WHERE vervoerder_code IS NOT NULL;

COMMENT ON COLUMN zendingen.vervoerder_code IS
  'Gekozen vervoerder voor deze zending. Wordt bepaald door selecteer_vervoerder_voor_zending(); '
  'niet meer hard ingesteld per klant.';

COMMENT ON COLUMN zendingen.vervoerder_selectie_uitleg IS
  'Audit-uitleg van de vervoerderselector. V1: enige actieve vervoerder; later criteria/tarieven.';

-- ============================================================================
-- Selector: centrale uitbreidplek voor voorwaarden/tarieven
-- ============================================================================
CREATE OR REPLACE FUNCTION selecteer_vervoerder_voor_zending(
  p_zending_id BIGINT
) RETURNS TABLE (
  gekozen_vervoerder_code TEXT,
  keuze_uitleg JSONB
) AS $$
DECLARE
  v_actief_count INTEGER;
  v_code         TEXT;
  v_display_naam TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM zendingen WHERE id = p_zending_id) THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_actief_count
    FROM vervoerders
   WHERE actief = TRUE;

  IF v_actief_count = 0 THEN
    RETURN QUERY SELECT
      NULL::TEXT,
      jsonb_build_object(
        'strategie', 'actieve_vervoerder_v1',
        'reden', 'geen_actieve_vervoerder'
      );
    RETURN;
  END IF;

  IF v_actief_count > 1 THEN
    RETURN QUERY SELECT
      NULL::TEXT,
      jsonb_build_object(
        'strategie', 'actieve_vervoerder_v1',
        'reden', 'meerdere_actieve_vervoerders_geen_criteria',
        'actieve_vervoerders', v_actief_count,
        'volgende_stap', 'richt voorwaarden/tarieven in en breid deze selector uit'
      );
    RETURN;
  END IF;

  SELECT code, display_naam
    INTO v_code, v_display_naam
    FROM vervoerders
   WHERE actief = TRUE
   ORDER BY code
   LIMIT 1;

  RETURN QUERY SELECT
    v_code,
    jsonb_build_object(
      'strategie', 'enige_actieve_vervoerder',
      'actieve_vervoerders', 1,
      'vervoerder', v_display_naam,
      'volgende_stap', 'later uitbreiden met voorwaarden/tarieven per zending'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION selecteer_vervoerder_voor_zending(BIGINT) TO authenticated;

COMMENT ON FUNCTION selecteer_vervoerder_voor_zending IS
  'Centrale vervoerderselector. V1 kiest alleen als precies 1 vervoerder actief is; '
  'later uitbreiden met voorwaarden, zones en tarieven.';

-- ============================================================================
-- Switch-RPC leest de zendingkeuze of vraagt de selector om een keuze
-- ============================================================================
CREATE OR REPLACE FUNCTION enqueue_zending_naar_vervoerder(
  p_zending_id BIGINT
) RETURNS TEXT AS $$
DECLARE
  v_order_id        BIGINT;
  v_debiteur_nr     INTEGER;
  v_vervoerder_code TEXT;
  v_keuze_uitleg    JSONB;
  v_actief          BOOLEAN;
  v_is_test         BOOLEAN := FALSE;
BEGIN
  SELECT z.order_id, o.debiteur_nr, z.vervoerder_code
    INTO v_order_id, v_debiteur_nr, v_vervoerder_code
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;
  IF v_debiteur_nr IS NULL THEN RETURN 'no_debiteur'; END IF;

  IF v_vervoerder_code IS NULL THEN
    SELECT s.gekozen_vervoerder_code, s.keuze_uitleg
      INTO v_vervoerder_code, v_keuze_uitleg
      FROM selecteer_vervoerder_voor_zending(p_zending_id) s;

    UPDATE zendingen
       SET vervoerder_code = v_vervoerder_code,
           vervoerder_selectie_uitleg = v_keuze_uitleg
     WHERE id = p_zending_id;

    IF v_vervoerder_code IS NULL THEN
      RETURN COALESCE(v_keuze_uitleg->>'reden', 'no_vervoerder_gekozen');
    END IF;
  END IF;

  SELECT actief INTO v_actief FROM vervoerders WHERE code = v_vervoerder_code;
  IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

  -- DISPATCH naar adapter-RPC. Dit blijft de enige plaats waar deze switch leeft.
  CASE v_vervoerder_code
    WHEN 'hst_api' THEN
      PERFORM enqueue_hst_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
      RETURN 'enqueued_hst';

    -- WHEN 'edi_partner_a' THEN
    --   PERFORM enqueue_edi_verzendbericht(...);
    --   RETURN 'enqueued_edi';
    --
    -- Rhenus/Verhoek volgen zodra hun voorwaarden/tarieven en adapter klaar zijn.

    ELSE
      RAISE NOTICE 'Vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_zending_naar_vervoerder(BIGINT) TO authenticated;

COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
  'SWITCH-POINT: dispatcht een zending naar de adapter-RPC van de gekozen vervoerder. '
  'Leest zendingen.vervoerder_code of vraagt selecteer_vervoerder_voor_zending() om '
  'een keuze. Bij toekomstige vervoerder: voeg WHEN-tak toe.';

-- ============================================================================
-- create_zending_voor_order: bestaande zending opnieuw enqueuen als dat nog kan
-- ============================================================================
CREATE OR REPLACE FUNCTION create_zending_voor_order(
  p_order_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
  v_zending_id     BIGINT;
  v_zending_status zending_status;
  v_zending_nr     TEXT;
  v_order          orders%ROWTYPE;
BEGIN
  SELECT id, status INTO v_zending_id, v_zending_status FROM zendingen
   WHERE order_id = p_order_id
     AND status NOT IN ('Afgeleverd')
   ORDER BY id DESC LIMIT 1;
  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen
       SET aantal_colli = COALESCE(aantal_colli, (
             SELECT COALESCE(SUM(COALESCE(ore.orderaantal, 0)), 0)::INTEGER
               FROM order_regels ore
              WHERE ore.order_id = p_order_id
           )),
           totaal_gewicht_kg = COALESCE(totaal_gewicht_kg, (
             SELECT NULLIF(
               ROUND(
                 COALESCE(SUM(COALESCE(ore.gewicht_kg, p.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0),
                 2
               ),
               0
             )
               FROM order_regels ore
               LEFT JOIN producten p ON p.artikelnr = ore.artikelnr
              WHERE ore.order_id = p_order_id
           ))
     WHERE id = v_zending_id;

    IF v_zending_status = 'Klaar voor verzending' THEN
      PERFORM enqueue_zending_naar_vervoerder(v_zending_id);
    END IF;
    RETURN v_zending_id;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr, order_id, status,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    verzenddatum, aantal_colli, totaal_gewicht_kg
  ) VALUES (
    v_zending_nr, p_order_id, 'Klaar voor verzending',
    v_order.afl_naam, v_order.afl_adres, v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
    CURRENT_DATE,
    (
      SELECT COALESCE(SUM(COALESCE(ore.orderaantal, 0)), 0)::INTEGER
        FROM order_regels ore
       WHERE ore.order_id = p_order_id
    ),
    (
      SELECT NULLIF(
        ROUND(
          COALESCE(SUM(COALESCE(ore.gewicht_kg, p.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0),
          2
        ),
        0
      )
        FROM order_regels ore
        LEFT JOIN producten p ON p.artikelnr = ore.artikelnr
       WHERE ore.order_id = p_order_id
    )
  )
  RETURNING id INTO v_zending_id;

  INSERT INTO zending_regels (zending_id, order_regel_id, artikelnr, aantal)
  SELECT v_zending_id, ore.id, ore.artikelnr, COALESCE(ore.orderaantal, 0)
    FROM order_regels ore
   WHERE ore.order_id = p_order_id
     AND COALESCE(ore.orderaantal, 0) > 0;

  RETURN v_zending_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_zending_voor_order(BIGINT) TO authenticated;

-- ============================================================================
-- Stats voortaan op zending.vervoerder_code, niet op klantconfig
-- ============================================================================
CREATE OR REPLACE VIEW vervoerder_stats AS
SELECT
  v.code,
  v.display_naam,
  v.type,
  v.actief,
  COALESCE(klanten.aantal, 0)            AS aantal_klanten,
  COALESCE(zendingen_totaal.aantal, 0)   AS aantal_zendingen_totaal,
  COALESCE(zendingen_maand.aantal, 0)    AS aantal_zendingen_deze_maand,
  COALESCE(hst_succes.aantal, 0)         AS hst_aantal_verstuurd,
  COALESCE(hst_fout.aantal, 0)           AS hst_aantal_fout
FROM vervoerders v
LEFT JOIN (
  SELECT z.vervoerder_code, COUNT(DISTINCT o.debiteur_nr)::INT AS aantal
    FROM zendingen z
    JOIN orders o ON o.id = z.order_id
   WHERE z.vervoerder_code IS NOT NULL
   GROUP BY z.vervoerder_code
) klanten ON klanten.vervoerder_code = v.code
LEFT JOIN (
  SELECT vervoerder_code, COUNT(id)::INT AS aantal
    FROM zendingen
   WHERE vervoerder_code IS NOT NULL
   GROUP BY vervoerder_code
) zendingen_totaal ON zendingen_totaal.vervoerder_code = v.code
LEFT JOIN (
  SELECT vervoerder_code, COUNT(id)::INT AS aantal
    FROM zendingen
   WHERE vervoerder_code IS NOT NULL
     AND created_at >= date_trunc('month', now())
   GROUP BY vervoerder_code
) zendingen_maand ON zendingen_maand.vervoerder_code = v.code
LEFT JOIN (
  SELECT 'hst_api'::TEXT AS code, COUNT(*)::INT AS aantal
    FROM hst_transportorders WHERE status = 'Verstuurd'
) hst_succes ON hst_succes.code = v.code
LEFT JOIN (
  SELECT 'hst_api'::TEXT AS code, COUNT(*)::INT AS aantal
    FROM hst_transportorders WHERE status = 'Fout'
) hst_fout ON hst_fout.code = v.code;

COMMENT ON VIEW vervoerder_stats IS
  'Per-vervoerder dashboard op basis van zendingen.vervoerder_code: aantal klanten, '
  'zendingen, success/fail-counts. Klantkaart bevat geen harde vervoerderkeuze meer.';

GRANT SELECT ON vervoerder_stats TO authenticated;
