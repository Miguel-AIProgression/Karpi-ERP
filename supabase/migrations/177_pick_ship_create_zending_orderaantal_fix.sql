-- Migratie 177: definitieve create_zending_voor_order voor Pick & Ship verzendset
--
-- Migratie 176_zending_vervoerder_auto_selectie overschreef de RPC opnieuw met
-- `order_regels.aantal`. Die kolom bestaat niet; RugFlow gebruikt `orderaantal`.
-- Deze migratie houdt de zendingniveau-vervoerderselectie intact en vult tegelijk
-- zending_regels.aantal, aantal_colli en totaal_gewicht_kg voor stickers/pakbon.

CREATE OR REPLACE FUNCTION create_zending_voor_order(
  p_order_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
  v_zending_id       BIGINT;
  v_zending_status   zending_status;
  v_zending_nr       TEXT;
  v_order            orders%ROWTYPE;
  v_aantal_colli     INTEGER;
  v_totaal_gewicht   NUMERIC;
BEGIN
  SELECT id, status
    INTO v_zending_id, v_zending_status
    FROM zendingen
   WHERE order_id = p_order_id
     AND status NOT IN ('Afgeleverd')
   ORDER BY id DESC
   LIMIT 1;

  IF v_zending_id IS NOT NULL THEN
    UPDATE zendingen z
       SET aantal_colli = COALESCE(z.aantal_colli, totals.aantal_colli),
           totaal_gewicht_kg = COALESCE(z.totaal_gewicht_kg, totals.totaal_gewicht)
      FROM (
        SELECT
          NULLIF(COALESCE(SUM(GREATEST(COALESCE(ore.orderaantal, 0), 0)), 0)::INTEGER, 0) AS aantal_colli,
          NULLIF(
            COALESCE(
              SUM(COALESCE(ore.gewicht_kg, 0) * GREATEST(COALESCE(ore.orderaantal, 0), 0)),
              0
            ),
            0
          ) AS totaal_gewicht
          FROM order_regels ore
         WHERE ore.order_id = p_order_id
           AND COALESCE(ore.orderaantal, 0) > 0
      ) totals
     WHERE z.id = v_zending_id;

    IF v_zending_status = 'Klaar voor verzending' THEN
      PERFORM enqueue_zending_naar_vervoerder(v_zending_id);
    END IF;
    RETURN v_zending_id;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  SELECT
    COALESCE(SUM(GREATEST(COALESCE(ore.orderaantal, 0), 0)), 0)::INTEGER,
    COALESCE(
      SUM(COALESCE(ore.gewicht_kg, 0) * GREATEST(COALESCE(ore.orderaantal, 0), 0)),
      0
    )
    INTO v_aantal_colli, v_totaal_gewicht
    FROM order_regels ore
   WHERE ore.order_id = p_order_id
     AND COALESCE(ore.orderaantal, 0) > 0;

  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr, order_id, status,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    verzenddatum, aantal_colli, totaal_gewicht_kg
  ) VALUES (
    v_zending_nr, p_order_id, 'Klaar voor verzending',
    v_order.afl_naam, v_order.afl_adres, v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
    CURRENT_DATE, NULLIF(v_aantal_colli, 0), NULLIF(v_totaal_gewicht, 0)
  )
  RETURNING id INTO v_zending_id;

  INSERT INTO zending_regels (zending_id, order_regel_id, artikelnr, aantal)
  SELECT
    v_zending_id,
    ore.id,
    ore.artikelnr,
    GREATEST(COALESCE(ore.orderaantal, 1), 1)
    FROM order_regels ore
   WHERE ore.order_id = p_order_id
     AND COALESCE(ore.orderaantal, 0) > 0;

  RETURN v_zending_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_zending_voor_order(BIGINT) TO authenticated;

COMMENT ON FUNCTION create_zending_voor_order IS
  'Maakt of hergebruikt één zending voor een order. Migratie 177 gebruikt '
  '`order_regels.orderaantal`, vult zending_regels.aantal + colli/gewicht, en '
  'behoudt de zendingniveau-vervoerderselectie via enqueue_zending_naar_vervoerder.';
