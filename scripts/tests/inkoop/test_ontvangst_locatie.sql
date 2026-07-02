-- Regressiecheck ontvangst met locatie + 110%-grens (rolled-back).
-- Draai: supabase db query --linked -f scripts/tests/inkoop/test_ontvangst_locatie.sql
BEGIN;

DO $$
DECLARE
  v_lev_id BIGINT;
  v_io RECORD;
  v_regel BIGINT;
  v_rol RECORD;
  v_locatie_id BIGINT;
  v_artikelnr TEXT := 'TEST-OL-ART';
BEGIN
  -- NB: create_inkooporder staat een regel met alleen karpi_code (geen artikelnr)
  -- toe, maar boek_inkooporder_ontvangst_rollen faalt dan op een pre-existing,
  -- aan deze migratie ongerelateerde bug (RECORD v_product wordt nooit
  -- toegewezen als artikelnr NULL is → "record v_product is not assigned yet").
  -- Dat is losstaand van locatie/over-levering (Task 7's scope) — de test
  -- gebruikt daarom een echt artikelnr zodat de nieuwe logica getest wordt.
  INSERT INTO producten (artikelnr, karpi_code, omschrijving)
  VALUES (v_artikelnr, 'TEST-OL-ROL', 'TEST product ontvangst_locatie');

  INSERT INTO leveranciers (naam) VALUES ('TEST ontvangst_locatie') RETURNING id INTO v_lev_id;
  SELECT * INTO v_io FROM create_inkooporder(
    jsonb_build_object('leverancier_id', v_lev_id),
    jsonb_build_array(jsonb_build_object('artikelnr', v_artikelnr, 'besteld_m', 100, 'eenheid', 'm'))
  );
  SELECT id INTO v_regel FROM inkooporder_regels WHERE inkooporder_id = v_io.inkooporder_id;

  -- 1. Ontvangst mét locatie → rollen.locatie_id gevuld
  SELECT * INTO v_rol FROM boek_inkooporder_ontvangst_rollen(
    v_regel,
    jsonb_build_array(jsonb_build_object('lengte_cm', 2000, 'breedte_cm', 400, 'locatie', 'test.z9')),
    'test'
  ) LIMIT 1;
  SELECT locatie_id INTO v_locatie_id FROM rollen WHERE id = v_rol.rol_id;
  ASSERT v_locatie_id IS NOT NULL, 'locatie_id niet gevuld';
  ASSERT (SELECT code FROM magazijn_locaties WHERE id = v_locatie_id) = 'TEST.Z9',
         'locatie-code niet ge-uppercased/gekoppeld';

  -- 2. Ontvangst zónder locatie blijft werken (locatie_id NULL)
  SELECT * INTO v_rol FROM boek_inkooporder_ontvangst_rollen(
    v_regel,
    jsonb_build_array(jsonb_build_object('lengte_cm', 500, 'breedte_cm', 400)),
    'test'
  ) LIMIT 1;
  ASSERT (SELECT locatie_id FROM rollen WHERE id = v_rol.rol_id) IS NULL, 'locatie_id moest NULL blijven';

  -- 3. Over-levering >110% zonder vlag → weigeren (100 m² besteld, 80+20=100 al geboekt;
  --    nog eens 20 m² erbij = 120 > 110)
  BEGIN
    PERFORM boek_inkooporder_ontvangst_rollen(
      v_regel,
      jsonb_build_array(jsonb_build_object('lengte_cm', 500, 'breedte_cm', 400)),
      'test'
    );
    RAISE EXCEPTION 'TEST FAILED: over-levering >110%% werd geaccepteerd';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
    ASSERT SQLERRM LIKE 'Over-levering:%', format('verkeerde melding: %s', SQLERRM);
  END;

  -- 4. Zelfde boeking mét vlag → geaccepteerd
  PERFORM boek_inkooporder_ontvangst_rollen(
    v_regel,
    jsonb_build_array(jsonb_build_object('lengte_cm', 500, 'breedte_cm', 400)),
    'test',
    TRUE
  );
  ASSERT (SELECT geleverd_m FROM inkooporder_regels WHERE id = v_regel) = 120, 'geleverd_m niet 120 na bevestigde over-levering';

  RAISE NOTICE 'test_ontvangst_locatie: ALLE ASSERTS GESLAAGD';
END $$;

ROLLBACK;
