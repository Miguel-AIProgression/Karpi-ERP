-- Retroactief script bij migratie 269.
--
-- Doel: orders die ten onrechte op 'Wacht op voorraad' of 'Wacht op inkoop'
-- staan door de VERZEND-pseudo-orderregel terugzetten naar de juiste status.
-- Pas dit script uit ná `269_admin_pseudos_skip_status_en_levertijd.sql`.
--
-- `herbereken_wacht_status` is idempotent en respecteert eindstatussen +
-- actieve productie/picking-statussen, dus een brede sweep is veilig.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Schatting vooraf: hoeveel orders staan mogelijk verkeerd?
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_voor_voorraad INTEGER;
  v_voor_inkoop   INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_voor_voorraad FROM orders WHERE status = 'Wacht op voorraad';
  SELECT COUNT(*) INTO v_voor_inkoop   FROM orders WHERE status = 'Wacht op inkoop';
  RAISE NOTICE 'Vóór herbereken — Wacht op voorraad: %, Wacht op inkoop: %', v_voor_voorraad, v_voor_inkoop;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Herbereken alle orders die NIET in een eind- of actieve-flow-status staan.
--    De RPC schrijft alleen als de berekende status verschilt van de huidige
--    (no-op via _apply_transitie), dus order_events groeit niet zinloos.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_order_id BIGINT;
  v_count    INTEGER := 0;
BEGIN
  FOR v_order_id IN
    SELECT id FROM orders
     WHERE status NOT IN (
       'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
       'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken'
     )
  LOOP
    PERFORM herbereken_wacht_status(v_order_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Herbereken_wacht_status aangeroepen voor % orders.', v_count;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Schatting achteraf: hoeveel orders zijn er nog Wacht op X?
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_na_voorraad INTEGER;
  v_na_inkoop   INTEGER;
  v_na_nieuw    INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_na_voorraad FROM orders WHERE status = 'Wacht op voorraad';
  SELECT COUNT(*) INTO v_na_inkoop   FROM orders WHERE status = 'Wacht op inkoop';
  SELECT COUNT(*) INTO v_na_nieuw    FROM orders WHERE status = 'Nieuw';
  RAISE NOTICE 'Ná herbereken — Wacht op voorraad: %, Wacht op inkoop: %, Nieuw: %',
    v_na_voorraad, v_na_inkoop, v_na_nieuw;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Specifiek voor ORD-2026-2063 (gemeld op 2026-05-13):
--    verwacht na fix: status='Nieuw', regel 1 levertijd_status='voorraad',
--    regel 2 (VERZEND) komt niet meer in de levertijd-view voor.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT o.order_nr, o.status AS order_status
  FROM orders o
 WHERE o.order_nr = 'ORD-2026-2063';

SELECT orr.regelnummer, orr.artikelnr, orr.te_leveren, lt.levertijd_status
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  LEFT JOIN order_regel_levertijd lt ON lt.order_regel_id = orr.id
 WHERE o.order_nr = 'ORD-2026-2063'
 ORDER BY orr.regelnummer;

COMMIT;
