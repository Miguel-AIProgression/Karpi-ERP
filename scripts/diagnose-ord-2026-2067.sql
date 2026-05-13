-- Diagnose ORD-2026-2067: snij-modal toont 1 stuk te snijden voor maatwerk-
-- regel met orderaantal=5.
--
-- Hypothese: `auto_maak_snijplan()` (mig 110) maakt 1 snijplan per order_regel
-- aan, ongeacht orderaantal. Voor maatwerk-regel met aantal=5 ontstaat dus
-- 1 snijplan-rij i.p.v. 5. Optimalisatie + snij-modal kennen alleen 1 stuk.
--
-- Verwachte uitkomst (als hypothese klopt):
--   §1  order_regel met is_maatwerk=true, orderaantal=5
--   §2  exact 1 snijplan-rij voor deze regel (i.p.v. 5)
--   §3  op rol I3900BIL14I staat 1 snijplan met die regel-koppeling
--   §4  controle: zijn er andere orders met is_maatwerk=true en
--       orderaantal>1 waar hetzelfde gebeurt? (systemische check)

-- 1) Order + alle regels
SELECT o.id AS order_id, o.order_nr, o.status,
       r.id AS regel_id, r.regelnummer, r.artikelnr, r.omschrijving,
       r.is_maatwerk, r.orderaantal, r.te_leveren,
       r.maatwerk_breedte_cm, r.maatwerk_lengte_cm, r.maatwerk_vorm
  FROM orders o
  JOIN order_regels r ON r.order_id = o.id
 WHERE o.order_nr = 'ORD-2026-2067'
 ORDER BY r.regelnummer;

-- 2) Hoeveel snijplan-rijen bestaan er per maatwerk-regel?
SELECT r.id AS regel_id, r.orderaantal,
       COUNT(s.id) AS aantal_snijplannen,
       ARRAY_AGG(s.snijplan_nr ORDER BY s.id) AS snijplan_nrs,
       ARRAY_AGG(s.status::TEXT ORDER BY s.id) AS statussen,
       ARRAY_AGG(s.rol_id ORDER BY s.id) AS rol_ids
  FROM order_regels r
  LEFT JOIN snijplannen s ON s.order_regel_id = r.id
 WHERE r.order_id = (SELECT id FROM orders WHERE order_nr = 'ORD-2026-2067')
   AND r.is_maatwerk = TRUE
 GROUP BY r.id, r.orderaantal
 ORDER BY r.regelnummer;

-- 3) Welke snijplannen staan er op rol I3900BIL14I?
SELECT s.id, s.snijplan_nr, s.status, s.order_regel_id, s.lengte_cm, s.breedte_cm,
       s.positie_x_cm, s.positie_y_cm, s.geroteerd,
       r.orderaantal AS regel_orderaantal,
       r.maatwerk_breedte_cm AS regel_breedte, r.maatwerk_lengte_cm AS regel_lengte,
       o.order_nr
  FROM snijplannen s
  JOIN rollen ro ON ro.id = s.rol_id
  LEFT JOIN order_regels r ON r.id = s.order_regel_id
  LEFT JOIN orders o ON o.id = r.order_id
 WHERE ro.rolnummer = 'I3900BIL14I'
 ORDER BY s.positie_y_cm, s.positie_x_cm;

-- 4) Systemische check: alle maatwerk-regels met orderaantal>1 en hun
--    snijplan-aantallen. Als bug systemisch is: aantal_snijplannen < orderaantal.
SELECT o.order_nr, o.status AS order_status,
       r.id AS regel_id, r.orderaantal, r.is_maatwerk,
       COUNT(s.id) AS aantal_snijplannen,
       r.orderaantal - COUNT(s.id) AS missend
  FROM orders o
  JOIN order_regels r ON r.order_id = o.id
  LEFT JOIN snijplannen s ON s.order_regel_id = r.id
 WHERE r.is_maatwerk = TRUE
   AND r.orderaantal > 1
   AND o.status NOT IN ('Geannuleerd')
 GROUP BY o.order_nr, o.status, r.id, r.orderaantal, r.is_maatwerk
HAVING COUNT(s.id) < r.orderaantal
 ORDER BY o.order_nr DESC
 LIMIT 50;
