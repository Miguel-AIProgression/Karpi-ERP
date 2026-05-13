-- Diagnose ORD-2026-2057: Verzonden-order toont regel-badge "Wacht op inkoop"
-- + sub-rij "Wacht op nieuwe inkoop 5". Hypothese: claims zijn correct
-- `released`, maar view + buildSubRows weegt order-status niet mee.
--
-- Verwachte uitkomst (als hypothese klopt):
--   §1  status = 'Verzonden', verzonden_at gevuld
--   §2  regel te_leveren=5, geen openstaande claims op actief
--   §3  0 rijen met status='actief'; ≥1 rij met status='released'
--   §4  1 rij in order_regel_levertijd met levertijd_status='wacht_op_nieuwe_inkoop'
--       en aantal_voorraad=0, aantal_io=0, aantal_tekort=te_leveren
--   §5  ≥1 order_events-rij met event_type='pickronde_voltooid'

-- 1) Order header
SELECT id, order_nr, status, verzonden_at, lever_modus, lever_type,
       orderdatum, afleverdatum
  FROM orders WHERE order_nr = 'ORD-2026-2057';

-- 2) Orderregels
SELECT id, regelnummer, artikelnr, fysiek_artikelnr, te_leveren, backorder,
       is_maatwerk
  FROM order_regels
 WHERE order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2057')
 ORDER BY regelnummer;

-- 3) ALLE claims op deze order (alle statussen, niet alleen actief)
SELECT r.id AS claim_id, r.order_regel_id, r.bron, r.aantal, r.status,
       r.is_handmatig, r.fysiek_artikelnr,
       ir.artikelnr AS io_artikelnr, io.inkooporder_nr, io.verwacht_datum
  FROM order_reserveringen r
  JOIN order_regels oreg ON oreg.id = r.order_regel_id
  LEFT JOIN inkooporder_regels ir ON ir.id = r.inkooporder_regel_id
  LEFT JOIN inkooporders io ON io.id = ir.inkooporder_id
 WHERE oreg.order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2057')
 ORDER BY r.order_regel_id, r.status, r.id;

-- 4) Wat berekent de view (mig 269) voor deze order?
SELECT order_regel_id, te_leveren, aantal_voorraad, aantal_io, aantal_tekort,
       levertijd_status, eerste_io_nr, verwachte_leverweek
  FROM order_regel_levertijd
 WHERE order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2057');

-- 5) Order-events: kreeg deze order een 'pickronde_voltooid'?
SELECT id, event_type, status_voor, status_na, created_at
  FROM order_events
 WHERE order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2057')
 ORDER BY created_at;

-- 6) Bredere check: zijn er meer Verzonden/Geannuleerd-orders met dezelfde
--    misleidende view-output? Zo ja, dan is dit een systemisch defect.
SELECT o.order_nr, o.status, olt.order_regel_id, olt.levertijd_status,
       olt.te_leveren, olt.aantal_tekort
  FROM order_regel_levertijd olt
  JOIN orders o ON o.id = olt.order_id
 WHERE o.status IN ('Verzonden', 'Geannuleerd')
   AND olt.levertijd_status IN ('wacht_op_nieuwe_inkoop', 'op_inkoop')
 ORDER BY o.order_nr
 LIMIT 50;
