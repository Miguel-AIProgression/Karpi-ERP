-- Migratie 218: start_pickronde hergebruikt alleen lopende Picken-zendingen
--
-- Probleem op staging (07-05): bulk-Verzendset klikte op 2 orders waarvoor
-- al een eerdere zending bestond in status 'Klaar voor verzending' (uit een
-- pre-mig-217 test-sessie). Mijn mig-217-`start_pickronde` pakte die zending
-- op (filter `status NOT IN ('Afgeleverd')` was te losjes), update'te alleen
-- picker_id en RETURN'de — status bleef 'Klaar voor verzending'. Resultaat:
-- pick-card toonde geen "In pickronde"-staat omdat actieve_pickronde-query
-- alleen Picken-zendingen pakt.
--
-- Fix: hergebruiken alleen toegestaan voor zendingen in 'Picken'-status
-- (echte lopende pickronde). Bij eindstatus ('Klaar voor verzending',
-- 'Onderweg', 'Afgeleverd') een duidelijke fout. Bij 'Geannuleerd' /
-- 'Gepland' / 'Ingepakt' (niet in V1-flow): nieuwe zending aanmaken.
--
-- Idempotent: CREATE OR REPLACE op exact dezelfde signatuur als mig 217.

CREATE OR REPLACE FUNCTION start_pickronde(
  p_order_id  BIGINT,
  p_picker_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_zending_id     BIGINT;
  v_zending_status zending_status;
  v_zending_nr     TEXT;
  v_order          orders%ROWTYPE;
  v_eindstatus_zending TEXT;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  -- Eerst: bestaande Picken-zending? Hergebruiken.
  SELECT id, status INTO v_zending_id, v_zending_status FROM zendingen
   WHERE order_id = p_order_id
     AND status = 'Picken'
   ORDER BY id DESC LIMIT 1;

  IF v_zending_id IS NOT NULL THEN
    PERFORM genereer_zending_colli(v_zending_id);
    UPDATE zendingen
       SET aantal_colli = COALESCE(aantal_colli, (
             SELECT COALESCE(SUM(COALESCE(ore.orderaantal, 0)), 0)::INTEGER
               FROM order_regels ore
              WHERE ore.order_id = p_order_id
                AND COALESCE(ore.artikelnr, '') <> 'VERZEND'
           )),
           totaal_gewicht_kg = COALESCE(totaal_gewicht_kg, (
             SELECT NULLIF(
               ROUND(COALESCE(SUM(COALESCE(ore.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0), 2),
               0
             )
               FROM order_regels ore
              WHERE ore.order_id = p_order_id
                AND COALESCE(ore.artikelnr, '') <> 'VERZEND'
           )),
           picker_id = p_picker_id
     WHERE id = v_zending_id;
    RETURN v_zending_id;
  END IF;

  -- Eindstatus-zending bestaat al? Weiger expliciet.
  -- (Anders zou een nieuwe Picken-zending naast de oude komen, met dubbele
  -- colli's en mogelijk dubbele HST-dispatch.)
  SELECT zending_nr INTO v_eindstatus_zending
    FROM zendingen
   WHERE order_id = p_order_id
     AND status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
   ORDER BY id DESC LIMIT 1;

  IF v_eindstatus_zending IS NOT NULL THEN
    RAISE EXCEPTION
      'Order % heeft al zending % in eindstatus. Annuleer of voltooi die eerst in /logistiek voor je een nieuwe pickronde start.',
      p_order_id, v_eindstatus_zending
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Nieuwe zending aanmaken (eerste pickronde voor deze order, of vorige geannuleerd).
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr, order_id, status, picker_id,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    verzenddatum, aantal_colli, totaal_gewicht_kg
  ) VALUES (
    v_zending_nr, p_order_id, 'Picken', p_picker_id,
    v_order.afl_naam, v_order.afl_adres, v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
    CURRENT_DATE,
    (SELECT COALESCE(SUM(COALESCE(ore.orderaantal, 0)), 0)::INTEGER
       FROM order_regels ore
      WHERE ore.order_id = p_order_id AND COALESCE(ore.artikelnr, '') <> 'VERZEND'),
    (SELECT NULLIF(ROUND(COALESCE(SUM(COALESCE(ore.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0), 2), 0)
       FROM order_regels ore
      WHERE ore.order_id = p_order_id AND COALESCE(ore.artikelnr, '') <> 'VERZEND')
  ) RETURNING id INTO v_zending_id;

  INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
  SELECT v_zending_id, ore.id, ore.orderaantal
    FROM order_regels ore
   WHERE ore.order_id = p_order_id
     AND COALESCE(ore.orderaantal, 0) > 0
     AND COALESCE(ore.artikelnr, '') <> 'VERZEND';

  PERFORM genereer_zending_colli(v_zending_id);
  RETURN v_zending_id;
END;
$$;

GRANT EXECUTE ON FUNCTION start_pickronde(BIGINT, BIGINT) TO authenticated;

COMMENT ON FUNCTION start_pickronde(BIGINT, BIGINT) IS
  'Mig 218: hergebruikt alleen Picken-zendingen (lopende pickronde). Bij '
  'eindstatus-zending (Klaar voor verzending/Onderweg/Afgeleverd) een fout — '
  'operator moet eerst die zending afronden of annuleren. Voorkomt stille '
  'status-mismatch waar pick-card geen "in pickronde"-staat kreeg.';

NOTIFY pgrst, 'reload schema';
