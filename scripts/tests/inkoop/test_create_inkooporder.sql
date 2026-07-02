-- Regressiecheck create_inkooporder (rolled-back; veilig op live DB).
-- Draai: supabase db query --linked -f scripts/tests/inkoop/test_create_inkooporder.sql
BEGIN;

DO $$
DECLARE
  v_lev_id BIGINT;
  v_result RECORD;
  v_regels INTEGER;
BEGIN
  INSERT INTO leveranciers (naam) VALUES ('TEST create_inkooporder') RETURNING id INTO v_lev_id;

  -- Happy path: header + 2 regels (m + stuks) in één call
  SELECT * INTO v_result FROM create_inkooporder(
    jsonb_build_object('leverancier_id', v_lev_id, 'besteldatum', CURRENT_DATE::TEXT, 'opmerkingen', 'test'),
    jsonb_build_array(
      jsonb_build_object('karpi_code', 'TEST-CI-ROL', 'artikel_omschrijving', 'testrol', 'besteld_m', 50, 'inkoopprijs_eur', 9.5, 'eenheid', 'm'),
      jsonb_build_object('karpi_code', 'TEST-CI-VAST', 'besteld_m', 10, 'eenheid', 'stuks')
    )
  );
  ASSERT v_result.inkooporder_nr LIKE 'INK-%', 'inkooporder_nr niet toegekend';

  SELECT COUNT(*) INTO v_regels FROM inkooporder_regels WHERE inkooporder_id = v_result.inkooporder_id;
  ASSERT v_regels = 2, format('verwachtte 2 regels, kreeg %s', v_regels);
  ASSERT (SELECT status FROM inkooporders WHERE id = v_result.inkooporder_id) = 'Besteld', 'status niet Besteld';
  ASSERT (SELECT eenheid FROM inkooporder_regels WHERE inkooporder_id = v_result.inkooporder_id AND regelnummer = 2) = 'stuks', 'eenheid stuks niet doorgekomen';
  ASSERT (SELECT te_leveren_m FROM inkooporder_regels WHERE inkooporder_id = v_result.inkooporder_id AND regelnummer = 1) = 50, 'te_leveren_m niet gelijk aan besteld_m';

  -- Guard: 0 regels moet weigeren (transactie-atomair: géén order achterlaten)
  BEGIN
    PERFORM create_inkooporder(jsonb_build_object('leverancier_id', v_lev_id), '[]'::jsonb);
    RAISE EXCEPTION 'TEST FAILED: 0 regels werd geaccepteerd';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
  END;

  -- Guard: ongeldig artikelnr moet heldere melding geven
  BEGIN
    PERFORM create_inkooporder(
      jsonb_build_object('leverancier_id', v_lev_id),
      jsonb_build_array(jsonb_build_object('artikelnr', 'BESTAAT-NIET-XX', 'besteld_m', 1))
    );
    RAISE EXCEPTION 'TEST FAILED: onbekend artikelnr werd geaccepteerd';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'test_create_inkooporder: ALLE ASSERTS GESLAAGD';
END $$;

ROLLBACK;
