-- Migratie 151: backfill order_reserveringen voor bestaande open orders
--
-- Voor elke order_regel met artikelnr, niet-maatwerk, te_leveren > 0,
-- en order.status NOT IN ('Verzonden','Geannuleerd'):
-- roep herallocateer_orderregel(id) aan zodat claims netjes worden ingericht.
-- Idempotent: herallocateer_orderregel doet release + nieuw alloceren.

DO $$
DECLARE
  v_id BIGINT;
  v_count INTEGER := 0;
BEGIN
  FOR v_id IN
    SELECT oreg.id
    FROM order_regels oreg
    JOIN orders o ON o.id = oreg.order_id
    WHERE oreg.artikelnr IS NOT NULL
      AND COALESCE(oreg.is_maatwerk, false) = false
      AND COALESCE(oreg.te_leveren, 0) > 0
      AND o.status NOT IN ('Verzonden', 'Geannuleerd')
  LOOP
    PERFORM herallocateer_orderregel(v_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Backfill: % orderregels gealloceerd', v_count;
END $$;
