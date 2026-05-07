-- Migratie 206: VERZEND-regel buiten zending houden
--
-- Probleem: `create_zending_voor_order` (mig 186) sommeert/insert élke
-- order_regel met orderaantal > 0. Bij orders met automatische verzendkosten
-- bevat dat ook de pseudo-regel met `artikelnr = 'VERZEND'` (zie
-- `frontend/src/lib/constants/shipping.ts`). Gevolg vóór deze migratie:
--   - de VERZEND-regel verschijnt op pakbon/colli-stickers (een sticker met
--     "verzendkosten" als regel),
--   - `zendingen.aantal_colli` is 1 te hoog,
--   - de gewicht-sommatie is correct (ore.gewicht_kg=0 voor VERZEND), maar
--     beweegt nu wel mee met de filter zodat de logica consistent blijft.
--
-- Fix: alle drie de SUMs en de zending_regels-INSERT voegen
-- `AND COALESCE(ore.artikelnr, '') <> 'VERZEND'` toe. De pakbon-component
-- doet nu nog een extra UI-side filter (defensief), maar de bron-van-waarheid
-- is voortaan deze RPC.
--
-- Bestaande zendingen worden niet retroactief opgeschoond — die zijn al
-- verzonden of klaar voor verzending; magazijn negeert ze al via de
-- pakbon-filter.
--
-- Idempotent: CREATE OR REPLACE.

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
                AND COALESCE(ore.artikelnr, '') <> 'VERZEND'
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
                AND COALESCE(ore.artikelnr, '') <> 'VERZEND'
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
         AND COALESCE(ore.artikelnr, '') <> 'VERZEND'
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
         AND COALESCE(ore.artikelnr, '') <> 'VERZEND'
    )
  ) RETURNING id INTO v_zending_id;

  -- Maak zending_regels (1 per fysieke order_regel met orderaantal > 0).
  -- VERZEND blijft buiten de zending: het is een factuurregel, geen pakbon-/colli-regel.
  INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
  SELECT v_zending_id, ore.id, ore.orderaantal
    FROM order_regels ore
   WHERE ore.order_id = p_order_id
     AND COALESCE(ore.orderaantal, 0) > 0
     AND COALESCE(ore.artikelnr, '') <> 'VERZEND';

  PERFORM enqueue_zending_naar_vervoerder(v_zending_id);
  RETURN v_zending_id;
END;
$$;

COMMENT ON FUNCTION create_zending_voor_order IS
  'Sinds mig 206: VERZEND-orderregels worden uitgesloten van zending_regels, '
  'aantal_colli en totaal_gewicht_kg. Verzendkosten zijn een factuurregel, geen '
  'fysiek collo. Gewicht-fallback op p.gewicht_kg verwijderd in mig 186.';

NOTIFY pgrst, 'reload schema';
