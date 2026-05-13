-- Verifieer mig 265 + 266 + 267 + re-deploy 264 + retroactief-script.
-- Run in SQL Editor, blok-voor-blok. Stop bij eerste FAIL.

-- =========================================================================
-- 0. herwaardeer_order_status zonder claim-loop (mig 267)
-- =========================================================================
SELECT pg_get_functiondef('herwaardeer_order_status(BIGINT)'::regprocedure) ~
       'herwaardeer_claims_voor_order' AS heeft_claim_loop_in_wrapper;
-- Verwacht: false (mig 267 verwijderde de claim-loop uit de wrapper).

-- =========================================================================
-- 1. Pseudo-producten aanwezig (mig 265)
-- =========================================================================
SELECT artikelnr,
       CASE WHEN artikelnr IS NULL THEN 'FAIL — ontbreekt' ELSE 'OK' END AS status
  FROM (VALUES ('VERZEND'), ('BUNDELKORTING'), ('DREMPELKORTING')) AS v(needed)
  LEFT JOIN producten p ON p.artikelnr = v.needed;
-- Verwacht: 3 rijen, allemaal 'OK'.

-- =========================================================================
-- 2. Trigger A skipt admin-artikelnrs (mig 266)
-- =========================================================================
SELECT pg_get_functiondef('trg_orderregel_herallocateer()'::regprocedure) ~
       'BUNDELKORTING' AS heeft_admin_filter;
-- Verwacht: true.

-- =========================================================================
-- 3. Claim-loop skipt admin-artikelnrs (mig 263 — al live)
-- =========================================================================
SELECT pg_get_functiondef('herwaardeer_claims_voor_order(BIGINT)'::regprocedure) ~
       'BUNDELKORTING' AS heeft_admin_filter;
-- Verwacht: true.

-- =========================================================================
-- 4. genereer_factuur_voor_bundel heeft orderregel-mirror (mig 264/268)
-- =========================================================================
-- POSIX `~` met `.` matcht geen newlines; pg_get_functiondef levert de body
-- als één multi-line string. Gebruik strpos om dat te omzeilen.
SELECT
  strpos(pg_get_functiondef('genereer_factuur_voor_bundel(BIGINT)'::regprocedure),
         'INSERT INTO order_regels') > 0 AS heeft_orderregel_insert,
  strpos(pg_get_functiondef('genereer_factuur_voor_bundel(BIGINT)'::regprocedure),
         'BUNDELKORTING') > 0 AS noemt_bundelkorting,
  strpos(pg_get_functiondef('genereer_factuur_voor_bundel(BIGINT)'::regprocedure),
         'DREMPELKORTING') > 0 AS noemt_drempelkorting;
-- Verwacht: alle drie true.

-- =========================================================================
-- 5. Smoke-test: INSERT/DELETE admin-orderregel op een test-order crasht NIET
-- =========================================================================
-- LET OP: voer dit alleen uit op een test-order zonder echte verzending /
-- factuur. Zoek of maak een dummy-order eerst. Voorbeeld met SAVEPOINT zodat
-- alles rolt terug:
--
-- BEGIN;
-- SAVEPOINT s;
-- DO $$
-- DECLARE v_test_order_id BIGINT := (SELECT id FROM orders WHERE order_nr='ORD-2026-2057');
--         v_regelnr INTEGER;
-- BEGIN
--   SELECT COALESCE(MAX(regelnummer),0)+1 INTO v_regelnr
--     FROM order_regels WHERE order_id = v_test_order_id;
--   INSERT INTO order_regels (
--     order_id, regelnummer, artikelnr, omschrijving,
--     orderaantal, te_leveren, gefactureerd, prijs, bedrag, gewicht_kg
--   ) VALUES (
--     v_test_order_id, v_regelnr, 'BUNDELKORTING',
--     'Smoke-test mig 266 — ROLLBACK volgt', 1, 0, 1, -35, -35, 0
--   );
--   RAISE NOTICE 'INSERT geslaagd zonder stack-depth-error.';
-- END $$;
-- ROLLBACK TO SAVEPOINT s;
-- ROLLBACK;
-- Verwacht: NOTICE 'INSERT geslaagd zonder stack-depth-error.' (geen exception).

-- =========================================================================
-- 6. Som-check na retroactief-script (FACT-2026-0019)
-- =========================================================================
-- Vergelijk per order: som van orderregels-bedrag vs factuur-totaal toegerekend.
SELECT o.order_nr,
       SUM(orr.bedrag) AS som_orderregels,
       (SELECT SUM(fr.bedrag)
          FROM factuur_regels fr
         WHERE fr.order_id = o.id
           AND fr.factuur_id = (SELECT id FROM facturen WHERE factuur_nr='FACT-2026-0019')
       ) AS som_factuurregels
  FROM orders o
  JOIN order_regels orr ON orr.order_id = o.id
 WHERE o.order_nr IN ('ORD-2026-2057', 'ORD-2026-2058')
 GROUP BY o.order_nr
 ORDER BY o.order_nr;
-- Verwacht: som_orderregels = som_factuurregels per order.
