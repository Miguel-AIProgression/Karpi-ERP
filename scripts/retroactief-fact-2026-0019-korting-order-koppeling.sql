-- Retroactief: koppel BUNDELKORTING + DREMPELKORTING factuur-regels van
-- FACT-2026-0019 aan de juiste order (consistent met mig 268).
--
-- Voor: BUNDELKORTING + DREMPELKORTING beide op v_order_ids[1] (= 2057),
--       order_nr en uw_referentie leeg → PDF toont "Ons Ordernummer :" leeg.
-- Na:   DREMPELKORTING op 2057, BUNDELKORTING op 2058, beide met order_nr
--       en uw_referentie ingevuld → PDF groepeert onder juiste order.
--
-- VOORWAARDE: factuur is nog Concept (anders niet aanraken).
-- Run met BEGIN/COMMIT; controleer SELECT-output vóór COMMIT.

BEGIN;

DO $$
DECLARE
  v_factuur_id          BIGINT;
  v_factuur_status      TEXT;
  v_order_id_2057       BIGINT;
  v_order_id_2058       BIGINT;
  v_uw_ref_2057         TEXT;
  v_uw_ref_2058         TEXT;
BEGIN
  -- FOR UPDATE: voorkomt dat status-flip naar 'Verstuurd' tussen check en
  -- UPDATE plaatsvindt. Concept-guard moet hard zijn.
  SELECT id, status INTO v_factuur_id, v_factuur_status
    FROM facturen WHERE factuur_nr = 'FACT-2026-0019' FOR UPDATE;

  IF v_factuur_id IS NULL THEN
    RAISE EXCEPTION 'FACT-2026-0019 niet gevonden';
  END IF;

  IF v_factuur_status <> 'Concept' THEN
    RAISE EXCEPTION 'FACT-2026-0019 status=% (mag alleen Concept zijn)',
      v_factuur_status;
  END IF;

  SELECT id, klant_referentie INTO v_order_id_2057, v_uw_ref_2057
    FROM orders WHERE order_nr = 'ORD-2026-2057';
  SELECT id, klant_referentie INTO v_order_id_2058, v_uw_ref_2058
    FROM orders WHERE order_nr = 'ORD-2026-2058';

  IF v_order_id_2057 IS NULL OR v_order_id_2058 IS NULL THEN
    RAISE EXCEPTION 'Een of beide orders niet gevonden';
  END IF;

  -- DREMPELKORTING op order 2057
  UPDATE factuur_regels
     SET order_id      = v_order_id_2057,
         order_nr      = 'ORD-2026-2057',
         uw_referentie = v_uw_ref_2057
   WHERE factuur_id = v_factuur_id
     AND artikelnr  = 'DREMPELKORTING';
  RAISE NOTICE 'DREMPELKORTING regel(s) gekoppeld aan ORD-2026-2057';

  -- BUNDELKORTING op order 2058
  UPDATE factuur_regels
     SET order_id      = v_order_id_2058,
         order_nr      = 'ORD-2026-2058',
         uw_referentie = v_uw_ref_2058
   WHERE factuur_id = v_factuur_id
     AND artikelnr  = 'BUNDELKORTING';
  RAISE NOTICE 'BUNDELKORTING regel(s) gekoppeld aan ORD-2026-2058';
END $$;

-- Verificeer
SELECT regelnummer, artikelnr, order_nr, uw_referentie, bedrag
  FROM factuur_regels
 WHERE factuur_id = (SELECT id FROM facturen WHERE factuur_nr='FACT-2026-0019')
 ORDER BY regelnummer;

COMMIT;
