-- Regressiecheck regel-mutatie-RPC's (rolled-back; veilig op live DB).
-- Draai: supabase db query --linked -f scripts/tests/inkoop/test_regel_mutaties.sql
BEGIN;

DO $$
DECLARE
  v_lev_id BIGINT;
  v_io RECORD;
  v_regel_m BIGINT;
  v_regel_stuks BIGINT;
  v_nieuwe_regel BIGINT;
  v_claim RECORD;
BEGIN
  INSERT INTO leveranciers (naam) VALUES ('TEST regel_mutaties') RETURNING id INTO v_lev_id;
  SELECT * INTO v_io FROM create_inkooporder(
    jsonb_build_object('leverancier_id', v_lev_id),
    jsonb_build_array(
      jsonb_build_object('karpi_code', 'TEST-RM-ROL', 'besteld_m', 50, 'eenheid', 'm'),
      jsonb_build_object('karpi_code', 'TEST-RM-VAST', 'besteld_m', 10, 'eenheid', 'stuks')
    )
  );
  SELECT id INTO v_regel_m     FROM inkooporder_regels WHERE inkooporder_id = v_io.inkooporder_id AND regelnummer = 1;
  SELECT id INTO v_regel_stuks FROM inkooporder_regels WHERE inkooporder_id = v_io.inkooporder_id AND regelnummer = 2;

  -- 1. Regel toevoegen → regelnummer = MAX+1
  v_nieuwe_regel := voeg_inkooporder_regel_toe(
    v_io.inkooporder_id,
    jsonb_build_object('karpi_code', 'TEST-RM-EXTRA', 'besteld_m', 5, 'eenheid', 'stuks')
  );
  ASSERT (SELECT regelnummer FROM inkooporder_regels WHERE id = v_nieuwe_regel) = 3, 'regelnummer niet MAX+1';

  -- 2. Prijs wijzigen — vrij
  PERFORM wijzig_inkooporder_regel(v_regel_m, NULL, 12.34, FALSE);
  ASSERT (SELECT inkoopprijs_eur FROM inkooporder_regels WHERE id = v_regel_m) = 12.34, 'prijs niet gewijzigd';

  -- 3. Besteld verhogen — vrij, te_leveren schuift mee
  PERFORM wijzig_inkooporder_regel(v_regel_m, 60, NULL, FALSE);
  ASSERT (SELECT te_leveren_m FROM inkooporder_regels WHERE id = v_regel_m) = 60, 'te_leveren niet meegeschoven';

  -- 4. Verlagen onder geleverd → weigeren
  UPDATE inkooporder_regels SET geleverd_m = 20, te_leveren_m = 40 WHERE id = v_regel_m;
  BEGIN
    PERFORM wijzig_inkooporder_regel(v_regel_m, 10, NULL, TRUE);
    RAISE EXCEPTION 'TEST FAILED: verlagen onder geleverd geaccepteerd';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
  END;

  -- 5. Claim-vloer m-regel: snijplan-claim (kolom gezet = claim aanwezig)
  UPDATE inkooporder_regels SET snijplan_gebruikte_lengte_cm = 800 WHERE id = v_regel_m;
  BEGIN
    PERFORM wijzig_inkooporder_regel(v_regel_m, 30, NULL, FALSE);
    RAISE EXCEPTION 'TEST FAILED: verlagen met snijplan-claim zonder vrijgeven geaccepteerd';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
    ASSERT SQLERRM LIKE 'Claim-vloer:%', format('verkeerde melding: %s', SQLERRM);
  END;
  -- ... mét vrijgeven: kolom terug naar 0 (snijplannen-UPDATE is no-op zonder rijen)
  PERFORM wijzig_inkooporder_regel(v_regel_m, 30, NULL, TRUE);
  ASSERT (SELECT snijplan_gebruikte_lengte_cm FROM inkooporder_regels WHERE id = v_regel_m) = 0, 'snijplan-cm niet teruggezet';
  ASSERT (SELECT besteld_m FROM inkooporder_regels WHERE id = v_regel_m) = 30, 'besteld niet verlaagd';

  -- 6. Claim-vloer stuks-regel met échte live claim (indien aanwezig)
  SELECT ors.inkooporder_regel_id AS regel_id, ir.besteld_m, ir.geleverd_m,
         (SELECT COALESCE(SUM(o2.aantal),0) FROM order_reserveringen o2
           WHERE o2.inkooporder_regel_id = ors.inkooporder_regel_id
             AND o2.bron='inkooporder_regel' AND o2.status='actief') AS geclaimd
    INTO v_claim
    FROM order_reserveringen ors
    JOIN inkooporder_regels ir ON ir.id = ors.inkooporder_regel_id
   WHERE ors.bron = 'inkooporder_regel' AND ors.status = 'actief' AND ir.eenheid = 'stuks'
   LIMIT 1;
  IF v_claim.regel_id IS NOT NULL THEN
    BEGIN
      PERFORM wijzig_inkooporder_regel(v_claim.regel_id, v_claim.geleverd_m, NULL, FALSE);
      RAISE EXCEPTION 'TEST FAILED: verlagen onder stuks-claim zonder vrijgeven geaccepteerd';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
      ASSERT SQLERRM LIKE 'Claim-vloer:%', format('verkeerde melding: %s', SQLERRM);
    END;
    -- mét vrijgeven: claims op deze regel zijn daarna ≤ nieuwe ruimte
    PERFORM wijzig_inkooporder_regel(v_claim.regel_id, v_claim.geleverd_m, NULL, TRUE);
    ASSERT (SELECT COALESCE(SUM(aantal),0) FROM order_reserveringen
             WHERE inkooporder_regel_id = v_claim.regel_id
               AND bron='inkooporder_regel' AND status='actief') = 0,
           'claims niet vrijgegeven na p_vrijgeven=TRUE';
  ELSE
    RAISE NOTICE 'SKIP: geen live actieve stuks-IO-claim gevonden — stap 6 overgeslagen';
  END IF;

  -- 7. Regel annuleren: besteld := geleverd, order-status herberekend
  PERFORM annuleer_inkooporder_regel(v_regel_stuks, FALSE);
  ASSERT (SELECT te_leveren_m FROM inkooporder_regels WHERE id = v_regel_stuks) = 0, 'annuleren zette te_leveren niet op 0';

  -- 8. Verwijderen: geleverd>0 weigeren; verse regel wél; laatste regel weigeren
  BEGIN
    PERFORM verwijder_inkooporder_regel(v_regel_m, TRUE);
    RAISE EXCEPTION 'TEST FAILED: verwijderen met geleverd>0 geaccepteerd';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
  END;
  PERFORM verwijder_inkooporder_regel(v_nieuwe_regel, FALSE);
  ASSERT NOT EXISTS (SELECT 1 FROM inkooporder_regels WHERE id = v_nieuwe_regel), 'regel niet verwijderd';

  -- 9. Status-herberekening: alle regels dicht → Ontvangen
  PERFORM annuleer_inkooporder_regel(v_regel_m, TRUE);
  ASSERT (SELECT status FROM inkooporders WHERE id = v_io.inkooporder_id) = 'Ontvangen',
         format('orderstatus niet Ontvangen maar %s', (SELECT status FROM inkooporders WHERE id = v_io.inkooporder_id));

  RAISE NOTICE 'test_regel_mutaties: ALLE ASSERTS GESLAAGD';
END $$;

ROLLBACK;
