-- Verificatie na toepassen mig 274
--
-- Verwachte uitkomst:
--   §1  ORD-2026-2067 BILA 14-regel heeft 5 snijplannen (1 origineel + 4 backfill)
--   §2  4 nieuwe rijen in 'Wacht'-status met opmerking 'Backfill mig 274 …'
--   §3  het oorspronkelijke snijplan op rol I3900BIL14I is onaangeroerd
--   §4  systemische check: geen maatwerk-regels met aantal_snijplannen < orderaantal
--       meer in non-eindstatus orders

-- 1) Tel snijplannen per regel voor deze order
SELECT r.id AS regel_id, r.regelnummer, r.artikelnr, r.orderaantal,
       COUNT(s.id) AS aantal_snijplannen,
       ARRAY_AGG(s.snijplan_nr ORDER BY s.id)             AS snijplan_nrs,
       ARRAY_AGG(s.status::TEXT ORDER BY s.id)            AS statussen,
       ARRAY_AGG(COALESCE(s.rol_id::TEXT, '—') ORDER BY s.id) AS rol_ids
  FROM order_regels r
  LEFT JOIN snijplannen s ON s.order_regel_id = r.id
 WHERE r.order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2067')
   AND r.is_maatwerk = TRUE
 GROUP BY r.id, r.regelnummer, r.artikelnr, r.orderaantal
 ORDER BY r.regelnummer;

-- 2) De 4 nieuwe backfill-rijen — toon details
SELECT s.id, s.snijplan_nr, s.order_regel_id, s.status,
       s.lengte_cm, s.breedte_cm, s.rol_id, s.opmerkingen,
       s.created_at
  FROM snijplannen s
  JOIN order_regels r ON r.id = s.order_regel_id
 WHERE r.order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2067')
   AND s.opmerkingen LIKE 'Backfill mig 274%'
 ORDER BY s.id;

-- 3) Originele snijplan op rol I3900BIL14I onaangeroerd?
SELECT s.id, s.snijplan_nr, s.status, s.rol_id, s.positie_x_cm, s.positie_y_cm,
       s.opmerkingen, ro.rolnummer
  FROM snijplannen s
  JOIN rollen ro ON ro.id = s.rol_id
  JOIN order_regels r ON r.id = s.order_regel_id
 WHERE r.order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2067')
   AND ro.rolnummer = 'I3900BIL14I';

-- 4) Systemische check: zijn er nog maatwerk-regels onder-geplant?
--    Verwachte uitkomst: 0 rijen (alle non-eind-orders zijn nu aangevuld).
SELECT o.order_nr, o.status AS order_status,
       r.id AS regel_id, r.orderaantal,
       COUNT(s.id) AS aantal_snijplannen,
       r.orderaantal - COUNT(s.id) AS missend
  FROM orders o
  JOIN order_regels r ON r.order_id = o.id
  LEFT JOIN snijplannen s ON s.order_regel_id = r.id
 WHERE r.is_maatwerk = TRUE
   AND r.orderaantal > 1
   AND o.status NOT IN ('Verzonden', 'Geannuleerd')
 GROUP BY o.order_nr, o.status, r.id, r.orderaantal
HAVING COUNT(s.id) < r.orderaantal
 ORDER BY o.order_nr DESC;
