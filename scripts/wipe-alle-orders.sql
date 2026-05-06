-- scripts/wipe-alle-orders.sql
--
-- DESTRUCTIEF: verwijdert ALLE orders + ALLE afhankelijke data (test/demo).
-- Bedoeld als eenmalige reset om handmatig orders 1-voor-1 opnieuw in te voeren.
--
-- Verwijdert ook volledig:
--   - alle EDI-berichten (audit-log van test-flows — geen waarde meer)
--   - alle facturen + factuur_regels
--   - alle zendingen + zending_regels + hst_transportorders
--   - alle snijplannen, snijvoorstellen, snijvoorstel_plaatsingen
--   - alle confectie_orders
--   - alle order_documenten + order_reserveringen
--
-- Behoudt: producten, rollen, debiteuren, kwaliteiten, inkooporders, magazijn-
-- locaties, EDI handelspartner-config, leveranciers, prijslijsten — alle
-- masterdata.
--
-- Uitvoering:
--   - Draai in Supabase SQL Editor of via psql tegen de Karpi-database.
--   - Hele script staat in één transactie. Bij fout → ROLLBACK, niets gewijzigd.
--   - Default = COMMIT. Vervang onderaan door ROLLBACK voor dry-run.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Counts VOORAF (snapshot van wat we gaan wegruimen).
-- ────────────────────────────────────────────────────────────────────────────
SELECT 'VOORAF' AS fase, tabel, aantal FROM (
  SELECT 'orders'                      AS tabel, COUNT(*) AS aantal FROM orders
  UNION ALL SELECT 'order_regels',                COUNT(*) FROM order_regels
  UNION ALL SELECT 'order_reserveringen',         COUNT(*) FROM order_reserveringen
  UNION ALL SELECT 'order_documenten',            COUNT(*) FROM order_documenten
  UNION ALL SELECT 'snijplannen',                 COUNT(*) FROM snijplannen
  UNION ALL SELECT 'snijvoorstel_plaatsingen',    COUNT(*) FROM snijvoorstel_plaatsingen
  UNION ALL SELECT 'snijvoorstellen',             COUNT(*) FROM snijvoorstellen
  UNION ALL SELECT 'confectie_orders',            COUNT(*) FROM confectie_orders
  UNION ALL SELECT 'zendingen',                   COUNT(*) FROM zendingen
  UNION ALL SELECT 'zending_regels',              COUNT(*) FROM zending_regels
  UNION ALL SELECT 'hst_transportorders',         COUNT(*) FROM hst_transportorders
  UNION ALL SELECT 'facturen',                    COUNT(*) FROM facturen
  UNION ALL SELECT 'factuur_regels',              COUNT(*) FROM factuur_regels
  UNION ALL SELECT 'edi_berichten',                COUNT(*) FROM edi_berichten
) t ORDER BY tabel;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. EDI-berichten volledig weg (test-flow data, geen waarde meer).
-- ────────────────────────────────────────────────────────────────────────────
DELETE FROM edi_berichten;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Facturatie kant verwijderen (geen CASCADE op orders).
--    factuur_regels CASCADE'n via facturen — maar hebben ook directe FKs naar
--    orders en order_regels, dus expliciet eerst legen is veiliger.
-- ────────────────────────────────────────────────────────────────────────────
DELETE FROM factuur_regels;
DELETE FROM facturen;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Zendingen verwijderen (FK naar orders is RESTRICT).
--    zending_regels en hst_transportorders cascaden mee.
-- ────────────────────────────────────────────────────────────────────────────
DELETE FROM zendingen;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Productie-keten verwijderen (FK naar order_regels is RESTRICT).
--    confectie_orders → snijplannen + order_regels
--    snijvoorstel_plaatsingen → snijplannen + snijvoorstellen + rollen
--    snijvoorstellen → kwaliteiten (geen FK naar order_regels, maar leeg-strijken
--                                    gezien ze zonder snijplannen waardeloos zijn)
-- ────────────────────────────────────────────────────────────────────────────
DELETE FROM confectie_orders;
DELETE FROM snijvoorstel_plaatsingen;
DELETE FROM snijvoorstellen;
DELETE FROM snijplannen;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Orders zelf verwijderen.
--    CASCADE ruimt automatisch op:
--      - order_regels (wat op zijn beurt order_reserveringen cascadeer't)
--      - order_documenten
--    Triggers herberekenen producten.gereserveerd / besteld_inkoop / etc.
-- ────────────────────────────────────────────────────────────────────────────
DELETE FROM orders;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Counts NA cleanup.
-- ────────────────────────────────────────────────────────────────────────────
SELECT 'NA' AS fase, tabel, aantal FROM (
  SELECT 'orders'                      AS tabel, COUNT(*) AS aantal FROM orders
  UNION ALL SELECT 'order_regels',                COUNT(*) FROM order_regels
  UNION ALL SELECT 'order_reserveringen',         COUNT(*) FROM order_reserveringen
  UNION ALL SELECT 'order_documenten',            COUNT(*) FROM order_documenten
  UNION ALL SELECT 'snijplannen',                 COUNT(*) FROM snijplannen
  UNION ALL SELECT 'snijvoorstel_plaatsingen',    COUNT(*) FROM snijvoorstel_plaatsingen
  UNION ALL SELECT 'snijvoorstellen',             COUNT(*) FROM snijvoorstellen
  UNION ALL SELECT 'confectie_orders',            COUNT(*) FROM confectie_orders
  UNION ALL SELECT 'zendingen',                   COUNT(*) FROM zendingen
  UNION ALL SELECT 'zending_regels',              COUNT(*) FROM zending_regels
  UNION ALL SELECT 'hst_transportorders',         COUNT(*) FROM hst_transportorders
  UNION ALL SELECT 'facturen',                    COUNT(*) FROM facturen
  UNION ALL SELECT 'factuur_regels',              COUNT(*) FROM factuur_regels
  UNION ALL SELECT 'edi_berichten',                COUNT(*) FROM edi_berichten
) t ORDER BY tabel;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. (Optioneel) Nummering resetten — UIT-gecommentarieerd standaard.
--    Zonder reset gaat de volgende order verder op het laatst-uitgegeven
--    nummer + 1 (bijv. ORD-2026-0142). Reageer in als je vanaf 0001 wil
--    beginnen.
-- ────────────────────────────────────────────────────────────────────────────
-- UPDATE nummering SET laatste_nummer = 0
--  WHERE jaar = EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
--    AND type IN ('ORD', 'FACT', 'ZEND', 'SNIJ');

-- Default: doorzetten. Vervang door ROLLBACK voor een dry-run.
COMMIT;
