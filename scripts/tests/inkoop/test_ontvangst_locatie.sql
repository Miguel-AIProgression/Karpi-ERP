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
  v_io_kc RECORD;
  v_regel_kc BIGINT;
BEGIN
  -- Scenario 1-4 draaien op een regel MET artikelnr; scenario 5 dekt het
  -- karpi_code-only pad (artikelnr NULL — sinds mig 601/de nieuwe UI een
  -- normaal pad) dat vóór mig 603 crashte op
  -- "record v_product is not assigned yet".
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

  -- 5. Karpi_code-only regel (artikelnr NULL, geen producten-rij): een rol
  --    vereist altijd een artikel (rollen.artikelnr NOT NULL + FK) — ontvangst
  --    moet dus falen met de DUIDELIJKE guard-melding uit mig 603, niet met
  --    de oude crash "record v_product is not assigned yet" of een rauwe
  --    NOT NULL-constraint-violation.
  SELECT * INTO v_io_kc FROM create_inkooporder(
    jsonb_build_object('leverancier_id', v_lev_id),
    jsonb_build_array(jsonb_build_object('karpi_code', 'TEST-OL-KC', 'besteld_m', 50, 'eenheid', 'm'))
  );
  SELECT id INTO v_regel_kc FROM inkooporder_regels WHERE inkooporder_id = v_io_kc.inkooporder_id;
  BEGIN
    PERFORM boek_inkooporder_ontvangst_rollen(
      v_regel_kc,
      jsonb_build_array(jsonb_build_object('lengte_cm', 1000, 'breedte_cm', 400)),
      'test'
    );
    RAISE EXCEPTION 'TEST FAILED: karpi_code-only ontvangst werd geaccepteerd (rollen.artikelnr is NOT NULL — hoe?)';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
    ASSERT SQLERRM LIKE 'Regel % heeft geen gekoppeld artikel%',
           format('verwachtte de duidelijke artikel-guard-melding, kreeg: %s', SQLERRM);
  END;

  RAISE NOTICE 'test_ontvangst_locatie: ALLE ASSERTS GESLAAGD';
END $$;

ROLLBACK;
