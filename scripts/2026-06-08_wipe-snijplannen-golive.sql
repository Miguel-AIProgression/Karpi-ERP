-- ============================================================================
-- GO-LIVE EENMALIG (2026-06-08): productie-keten wissen + rollen vrijgeven.
--   Onderdeel van de Basta voorraad-import (rollen-nulstand). Wist ALLE
--   snijplannen + afhankelijke tabellen en zet betrokken rollen terug op
--   'beschikbaar'/'reststuk'. De maatwerk-route herbouwt snijplannen daarna.
--
--   Delete-volgorde gespiegeld van supabase/scripts/2026-05-31_cleanup_testdata.sql:109-114
--   (snijplannen.order_regel_id én .rol_id zijn ON DELETE RESTRICT; kind-tabellen
--   confectie_orders / snijvoorstel_plaatsingen dus EERST). Orders/facturen/
--   zendingen blijven ongemoeid.
--
--   Een directe DELETE FROM snijplannen triggert de rol-vrijgave (mig 290) NIET
--   (die hangt aan order_events) -> rollen worden hier EXPLICIET gereset.
--
--   Draai bij voorkeur in psql; controleer de NA-tellingen vóór COMMIT.
-- ============================================================================

-- COUNT VOOR
SELECT 'VOOR' AS fase, tabel, aantal FROM (
  SELECT 'snijplannen' AS tabel, COUNT(*) AS aantal FROM snijplannen
  UNION ALL SELECT 'confectie_orders', COUNT(*) FROM confectie_orders
  UNION ALL SELECT 'snijvoorstel_plaatsingen', COUNT(*) FROM snijvoorstel_plaatsingen
  UNION ALL SELECT 'snijvoorstellen', COUNT(*) FROM snijvoorstellen
  UNION ALL SELECT 'snijplan_groep_locks', COUNT(*) FROM snijplan_groep_locks
  UNION ALL SELECT 'scan_events', COUNT(*) FROM scan_events
  UNION ALL SELECT 'rollen_bezet',
       COUNT(*) FROM rollen
       WHERE status IN ('in_snijplan','gesneden','gereserveerd')
          OR snijden_gestart_op IS NOT NULL
) t ORDER BY tabel;

BEGIN;

-- 1. Productie-keten (kind -> ouder)
DELETE FROM confectie_orders;
DELETE FROM snijvoorstel_plaatsingen;
DELETE FROM snijvoorstellen;
DELETE FROM snijplannen;
DELETE FROM snijplan_groep_locks;
DELETE FROM scan_events;

-- 2. Rollen expliciet vrijgeven
UPDATE rollen
SET status = CASE WHEN rol_type = 'reststuk' THEN 'reststuk' ELSE 'beschikbaar' END,
    snijden_gestart_op   = NULL,
    snijden_voltooid_op  = NULL,
    snijden_gestart_door = NULL
WHERE status IN ('in_snijplan','gesneden','gereserveerd')
   OR snijden_gestart_op IS NOT NULL;

-- COUNT NA (binnen de transactie — alles 0 verwacht)
SELECT 'NA' AS fase, tabel, aantal FROM (
  SELECT 'snijplannen' AS tabel, COUNT(*) AS aantal FROM snijplannen
  UNION ALL SELECT 'confectie_orders', COUNT(*) FROM confectie_orders
  UNION ALL SELECT 'snijvoorstel_plaatsingen', COUNT(*) FROM snijvoorstel_plaatsingen
  UNION ALL SELECT 'snijvoorstellen', COUNT(*) FROM snijvoorstellen
  UNION ALL SELECT 'snijplan_groep_locks', COUNT(*) FROM snijplan_groep_locks
  UNION ALL SELECT 'scan_events', COUNT(*) FROM scan_events
  UNION ALL SELECT 'rollen_bezet',
       COUNT(*) FROM rollen
       WHERE status IN ('in_snijplan','gesneden','gereserveerd')
          OR snijden_gestart_op IS NOT NULL
) t ORDER BY tabel;

COMMIT;
-- Tellingen NIET 0 of onverwacht? Vervang COMMIT door ROLLBACK en onderzoek.
