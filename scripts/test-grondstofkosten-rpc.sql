-- Smoke-test voor voltooi_snijplan_rol grondstofkosten-toerekening.
-- Run:  psql "$SUPABASE_DB_URL" -f scripts/test-grondstofkosten-rpc.sql
-- Slaagt: eindigt met 'ok | 1', rolt transactie terug (geen fixture-residu).

BEGIN;

-- Fixtures met gereserveerde test-id's (99xxx range)
INSERT INTO kwaliteiten (code, naam) VALUES ('TEST', 'Test kwaliteit')
  ON CONFLICT (code) DO NOTHING;

INSERT INTO producten (artikelnr, naam, kwaliteit_code)
VALUES ('TEST320', 'Test 320', 'TEST')
  ON CONFLICT (artikelnr) DO NOTHING;

INSERT INTO rollen (id, rolnummer, artikelnr, kwaliteit_code, kleur_code,
                    lengte_cm, breedte_cm, oppervlak_m2, status, waarde)
VALUES (999001, 'TEST-ROL-01', 'TEST320', 'TEST', '00',
        1000, 320, 32.00, 'in_snijplan', 640.00)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO klanten (debiteur_nr, naam) VALUES (99901, 'Test klant')
  ON CONFLICT (debiteur_nr) DO NOTHING;

INSERT INTO orders (id, ordernummer, debiteur_nr, status)
VALUES (999001, 'TEST-ORD-01', 99901, 'Concept')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO order_regels (id, order_id, regelnummer, artikelnr, aantal)
VALUES (999001, 999001, 1, 'TEST320', 1),
       (999002, 999001, 2, 'TEST320', 1),
       (999003, 999001, 3, 'TEST320', 1)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO snijplannen (id, snijplan_nr, order_regel_id, rol_id,
                          lengte_cm, breedte_cm, status,
                          positie_x_cm, positie_y_cm, geroteerd)
VALUES (999001, 'TEST-SNIJ-01', 999001, 999001, 270, 270, 'Snijden', 0, 0, FALSE),
       (999002, 'TEST-SNIJ-02', 999002, 999001, 380, 250, 'Snijden', 0, 270, FALSE),
       (999003, 'TEST-SNIJ-03', 999003, 999001, 350, 200, 'Snijden', 0, 650, FALSE)
  ON CONFLICT (id) DO NOTHING;

SELECT voltooi_snijplan_rol(
  p_rol_id          => 999001,
  p_gesneden_door   => 'test',
  p_reststukken     => '[{"breedte_cm": 70, "lengte_cm": 380}]'::JSONB,
  p_snijplan_ids    => ARRAY[999001::BIGINT, 999002, 999003]
);

DO $$
DECLARE
  v_k1 NUMERIC; v_k2 NUMERIC; v_k3 NUMERIC; v_rw NUMERIC;
BEGIN
  SELECT grondstofkosten INTO v_k1 FROM snijplannen WHERE id = 999001;
  SELECT grondstofkosten INTO v_k2 FROM snijplannen WHERE id = 999002;
  SELECT grondstofkosten INTO v_k3 FROM snijplannen WHERE id = 999003;
  SELECT waarde INTO v_rw FROM rollen
   WHERE oorsprong_rol_id = 999001 AND reststuk_datum = CURRENT_DATE LIMIT 1;

  IF v_k1 IS NULL OR ABS(v_k1 - 179.95) > 0.50 THEN
    RAISE EXCEPTION 'snijplan 1: verwacht ~179.95, kreeg %', v_k1; END IF;
  IF v_k2 IS NULL OR ABS(v_k2 - 234.47) > 0.50 THEN
    RAISE EXCEPTION 'snijplan 2: verwacht ~234.47, kreeg %', v_k2; END IF;
  IF v_k3 IS NULL OR ABS(v_k3 - 172.61) > 0.50 THEN
    RAISE EXCEPTION 'snijplan 3: verwacht ~172.61, kreeg %', v_k3; END IF;
  IF v_rw IS NULL OR ABS(v_rw - 53.20) > 0.50 THEN
    RAISE EXCEPTION 'reststuk waarde: verwacht ~53.20, kreeg %', v_rw; END IF;
END $$;

SELECT 1 AS ok;

ROLLBACK;
