-- Migratie 186 — Cutover + cleanup voor gewicht-per-kwaliteit feature.
--
-- ⚠️  PAS UITVOEREN NA:
--   1. Migratie 184 + 185 toegepast
--   2. Excel-import gerund: `python import/import_kwaliteit_gewichten.py`
--      (zodat kwaliteiten.gewicht_per_m2_kg gevuld is met de definitieve data)
--
-- Deze migratie:
--   1. Hereken alle order_regels.gewicht_kg van open orders eenmalig (hard reset)
--   2. Vereenvoudig create_zending_voor_order — geen p.gewicht_kg-fallback meer
--   3. Drop maatwerk_m2_prijzen.gewicht_per_m2_kg (legacy-bron, nu vervangen)
--
-- Issue: #43. Plan: docs/superpowers/plans/2026-05-06-gewicht-per-kwaliteit.md

BEGIN;

------------------------------------------------------------------------
-- 1. Hard reset: hereken open order_regels van actieve orders.
--    Bestaande orders zijn weggooi-data (cf. plan §10) — actuele orderlijst
--    komt later via aparte import.
------------------------------------------------------------------------

UPDATE order_regels ore
SET gewicht_kg = bereken_orderregel_gewicht_kg(ore.id)
FROM orders o
WHERE ore.order_id = o.id
  AND o.status NOT IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending');

------------------------------------------------------------------------
-- 2. Vereenvoudig create_zending_voor_order: orderregel-cache is nu
--    altijd verse waarde dankzij triggers. Fallback op p.gewicht_kg
--    overbodig — laten we de zending-RPC schoner maken.
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_zending_voor_order(p_order_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql AS $$
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
                 COALESCE(SUM(COALESCE(ore.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0),
                 2
               ),
               0
             )
               FROM order_regels ore
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
          COALESCE(SUM(COALESCE(ore.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0),
          2
        ),
        0
      )
        FROM order_regels ore
       WHERE ore.order_id = p_order_id
    )
  ) RETURNING id INTO v_zending_id;

  -- Maak zending_regels (1 per order_regel met orderaantal > 0)
  INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
  SELECT v_zending_id, ore.id, ore.orderaantal
    FROM order_regels ore
   WHERE ore.order_id = p_order_id
     AND COALESCE(ore.orderaantal, 0) > 0;

  PERFORM enqueue_zending_naar_vervoerder(v_zending_id);
  RETURN v_zending_id;
END;
$$;

COMMENT ON FUNCTION create_zending_voor_order IS
  'Sinds mig 186: gewicht-fallback op p.gewicht_kg verwijderd. ore.gewicht_kg is '
  'voortaan altijd vers via gewicht-resolver-triggers (mig 185). Voor mig 176/177.';

------------------------------------------------------------------------
-- 3. Drop legacy gewicht-kolom op maatwerk_m2_prijzen.
--    kleuren_voor_kwaliteit (mig 185) leest gewicht nu uit kwaliteiten.
------------------------------------------------------------------------

ALTER TABLE maatwerk_m2_prijzen DROP COLUMN IF EXISTS gewicht_per_m2_kg;

COMMIT;
