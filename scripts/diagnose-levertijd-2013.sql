-- Diagnose voor ORD-2026-2013: waarom toont levertijd wk 21 + afleverdatum 18-05
-- terwijl IO INK-2026-8176 op wk 22 stond?

-- 1) Order header
SELECT id, order_nr, status, lever_modus, orderdatum, afleverdatum, week,
       to_char(afleverdatum, 'IYYY-"W"IW') AS afleverdatum_iso_week
  FROM orders WHERE order_nr = 'ORD-2026-2013';

-- 2) Orderregels
SELECT id, regelnummer, artikelnr, fysiek_artikelnr, te_leveren, is_maatwerk
  FROM order_regels
 WHERE order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2013')
 ORDER BY regelnummer;

-- 3) Actieve claims op deze order + IO-data
SELECT r.id AS claim_id, r.bron, r.aantal, r.is_handmatig,
       r.fysiek_artikelnr, r.status,
       ir.artikelnr AS io_artikelnr, io.inkooporder_nr, io.status AS io_status,
       io.verwacht_datum,
       to_char(io.verwacht_datum, 'IYYY-"W"IW') AS io_iso_week,
       to_char(io.verwacht_datum + 7, 'IYYY-"W"IW') AS io_plus_buffer_iso_week,
       (io.verwacht_datum + 7) AS io_plus_buffer_datum
  FROM order_reserveringen r
  JOIN order_regels oreg ON oreg.id = r.order_regel_id
  LEFT JOIN inkooporder_regels ir ON ir.id = r.inkooporder_regel_id
  LEFT JOIN inkooporders io ON io.id = ir.inkooporder_id
 WHERE oreg.order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2013')
   AND r.status = 'actief'
 ORDER BY r.id;

-- 4) Wat berekent de view voor deze order?
SELECT *
  FROM order_regel_levertijd
 WHERE order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2013');

-- 5) Wat zegt bereken_late_claim_afleverdatum?
SELECT bereken_late_claim_afleverdatum(
  (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2013')
) AS verwachte_afleverdatum,
to_char(bereken_late_claim_afleverdatum(
  (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2013')
), 'IYYY-"W"IW') AS verwachte_afleverdatum_iso_week;

-- 6) ALLE IO-regels voor CISCO 11 200x290 (artikelnr 771110006), om te zien
--    of er meerdere openstaande IO's zijn met verschillende leverdata
SELECT ir.id, io.inkooporder_nr, io.status, io.verwacht_datum,
       to_char(io.verwacht_datum, 'IYYY-"W"IW') AS iso_week,
       ir.eenheid, ir.te_leveren_m,
       (SELECT COALESCE(SUM(aantal), 0) FROM order_reserveringen
         WHERE inkooporder_regel_id = ir.id AND status = 'actief') AS geclaimd
  FROM inkooporder_regels ir
  JOIN inkooporders io ON io.id = ir.inkooporder_id
 WHERE ir.artikelnr = '771110006'
   AND io.status IN ('Besteld', 'Deels ontvangen')
 ORDER BY io.verwacht_datum NULLS LAST;
