-- =====================================================================
-- OPSCHOON-SCRIPT: test-transacties verwijderen vóór live-gang
-- Datum: 2026-05-31
-- Doel : alle test-orders + afgeleide transactieketen wissen, zodat er
--        vanaf morgen echte orders ingevoerd kunnen worden.
--
-- BLIJFT STAAN (stamdata): debiteuren, afleveradressen, prijslijsten,
--   producten, kwaliteiten, collecties, rollen (voorraad — alleen
--   workflow-status wordt gereset), leveranciers, inkooporders +
--   inkooporder_regels (echte data uit oud systeem), vervoerders +
--   selectie-regels, klanteigen_namen, klant_artikelnummers, medewerkers,
--   maatwerk-config, app_config, edi_handelspartner_config.
--
-- WORDT GEWIST (transactioneel, door testen ontstaan):
--   orders + order_regels + order_reserveringen + order_events +
--   order_documenten, facturen + factuur_regels + factuur_queue,
--   snijplannen + snijvoorstellen + snijvoorstel_plaatsingen +
--   snijplan_groep_locks, confectie_orders, zendingen + zending_regels +
--   zending_orders + zending_colli + hst_transportorders, scan_events.
--
-- NIET AANGERAAKT (bewuste keuze 2026-05-31): samples, edi_berichten
--   (alleen FK-link naar gewiste orders/facturen wordt op NULL gezet),
--   activiteiten_log, voorraad_mutaties, rol_mutaties, storage-buckets.
--
-- UITVOEREN: Supabase Studio → SQL Editor (als service-role/postgres).
--   Draait als ÉÉN transactie — alles-of-niets. Idempotent: opnieuw
--   draaien is veilig (telt dan 0 rijen om te wissen).
-- =====================================================================


-- ---------------------------------------------------------------------
-- STAP 0 — VOORBEELD: tel eerst wat er gewist gaat worden (los uitvoeren
--          vóór de transactie, ter controle). Mag je overslaan.
-- ---------------------------------------------------------------------
-- SELECT 'orders'                  AS tabel, count(*) FROM orders
-- UNION ALL SELECT 'order_regels',         count(*) FROM order_regels
-- UNION ALL SELECT 'order_reserveringen',  count(*) FROM order_reserveringen
-- UNION ALL SELECT 'order_events',         count(*) FROM order_events
-- UNION ALL SELECT 'order_documenten',     count(*) FROM order_documenten
-- UNION ALL SELECT 'facturen',             count(*) FROM facturen
-- UNION ALL SELECT 'factuur_regels',       count(*) FROM factuur_regels
-- UNION ALL SELECT 'factuur_queue',        count(*) FROM factuur_queue
-- UNION ALL SELECT 'snijplannen',          count(*) FROM snijplannen
-- UNION ALL SELECT 'snijvoorstellen',      count(*) FROM snijvoorstellen
-- UNION ALL SELECT 'snijvoorstel_plaatsingen', count(*) FROM snijvoorstel_plaatsingen
-- UNION ALL SELECT 'confectie_orders',     count(*) FROM confectie_orders
-- UNION ALL SELECT 'zendingen',            count(*) FROM zendingen
-- UNION ALL SELECT 'zending_regels',       count(*) FROM zending_regels
-- UNION ALL SELECT 'zending_orders',       count(*) FROM zending_orders
-- UNION ALL SELECT 'zending_colli',        count(*) FROM zending_colli
-- UNION ALL SELECT 'hst_transportorders',  count(*) FROM hst_transportorders
-- UNION ALL SELECT 'scan_events',          count(*) FROM scan_events
-- UNION ALL SELECT 'rollen (niet-beschikbaar)', count(*) FROM rollen
--            WHERE status NOT IN ('beschikbaar','reststuk') OR snijden_gestart_op IS NOT NULL;


BEGIN;

-- ---------------------------------------------------------------------
-- STAP 1 — Churn-triggers tijdelijk uit op de order-keten.
--   Voorkomt dat herallocateer_orderregel / update_order_totalen /
--   herbereken_product_reservering per gewiste rij gaan vuren.
--   FK-cascade en FK-bescherming (RI) blijven gewoon actief — dat zijn
--   systeem-triggers, geen USER-triggers.
-- ---------------------------------------------------------------------
ALTER TABLE order_regels        DISABLE TRIGGER USER;
ALTER TABLE order_reserveringen DISABLE TRIGGER USER;
ALTER TABLE orders              DISABLE TRIGGER USER;


-- ---------------------------------------------------------------------
-- STAP 2 — edi_berichten: FK-links naar gewiste orders/facturen losmaken.
--   De berichten zelf blijven staan (bewuste keuze). order_id/factuur_id
--   hebben GEEN ON DELETE-regel, dus zonder dit zou de order/factuur-delete
--   met een foreign_key_violation falen. Fase 1 EDI is log-only, dus in de
--   praktijk meestal 0 rijen geraakt.
-- ---------------------------------------------------------------------
UPDATE edi_berichten SET order_id   = NULL WHERE order_id   IS NOT NULL;
UPDATE edi_berichten SET factuur_id = NULL WHERE factuur_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- STAP 3 — Logistiek / zendingen (kind → ouder).
--   zendingen.order_id en zending_orders.order_id zijn ON DELETE RESTRICT,
--   dus zendingen moeten vóór de orders weg.
-- ---------------------------------------------------------------------
DELETE FROM hst_transportorders;
DELETE FROM zending_colli;
DELETE FROM zending_regels;
DELETE FROM zending_orders;
DELETE FROM zendingen;


-- ---------------------------------------------------------------------
-- STAP 4 — Facturatie.
--   factuur_queue eerst (verwijst naar facturen én order_events, geen cascade).
-- ---------------------------------------------------------------------
DELETE FROM factuur_queue;
DELETE FROM factuur_regels;   -- cascade via facturen, expliciet voor de duidelijkheid
DELETE FROM facturen;


-- ---------------------------------------------------------------------
-- STAP 5 — Productie: confectie → snijvoorstellen → snijplannen.
--   snijplannen.order_regel_id is RESTRICT → snijplannen vóór order_regels.
--   confectie_orders en snijvoorstel_plaatsingen verwijzen naar snijplannen
--   → die eerst.
-- ---------------------------------------------------------------------
DELETE FROM confectie_orders;
DELETE FROM snijvoorstel_plaatsingen;
DELETE FROM snijvoorstellen;
DELETE FROM snijplannen;
DELETE FROM snijplan_groep_locks;
DELETE FROM scan_events;


-- ---------------------------------------------------------------------
-- STAP 6 — Orders (kind → ouder).
--   order_reserveringen / order_documenten / order_events / order_regels
--   cascaden via orders, maar we wissen expliciet en in volgorde.
-- ---------------------------------------------------------------------
DELETE FROM order_reserveringen;
DELETE FROM order_documenten;   -- DB-rijen; bestanden in bucket order-documenten blijven (bewuste keuze)
DELETE FROM order_events;
DELETE FROM order_regels;
DELETE FROM orders;


-- ---------------------------------------------------------------------
-- STAP 7 — Triggers weer aan.
-- ---------------------------------------------------------------------
ALTER TABLE order_regels        ENABLE TRIGGER USER;
ALTER TABLE order_reserveringen ENABLE TRIGGER USER;
ALTER TABLE orders              ENABLE TRIGGER USER;


-- ---------------------------------------------------------------------
-- STAP 8 — Rollen-voorraad terugzetten naar schone werkstaat.
--   Test-orders/snijplannen hebben rollen op gereserveerd/in_snijplan/
--   gesneden/verkocht gezet en snijden_* gevuld. Reset naar beschikbaar
--   (reststuk-type → reststuk). Afmetingen blijven ongemoeid.
-- ---------------------------------------------------------------------
UPDATE rollen
SET status = CASE WHEN rol_type = 'reststuk' THEN 'reststuk' ELSE 'beschikbaar' END,
    snijden_gestart_op   = NULL,
    snijden_voltooid_op  = NULL,
    snijden_gestart_door = NULL
WHERE status IN ('gereserveerd', 'in_snijplan', 'gesneden', 'verkocht')
   OR snijden_gestart_op   IS NOT NULL
   OR snijden_voltooid_op  IS NOT NULL
   OR snijden_gestart_door IS NOT NULL;


-- ---------------------------------------------------------------------
-- STAP 9 — Afgeleide voorraad op producten herberekenen.
--   Alle order_reserveringen zijn weg → gereserveerd = 0 voor alles.
--   Dit is exact wat herbereken_product_reservering() met 0 claims oplevert:
--   gereserveerd = 0, vrije_voorraad = voorraad − gereserveerd − backorder.
--   besteld_inkoop blijft ongemoeid (inkooporders blijven bestaan).
-- ---------------------------------------------------------------------
UPDATE producten
SET gereserveerd  = 0,
    vrije_voorraad = voorraad - COALESCE(backorder, 0)
WHERE gereserveerd <> 0
   OR vrije_voorraad IS DISTINCT FROM (voorraad - COALESCE(backorder, 0));


-- ---------------------------------------------------------------------
-- STAP 10 — Nummerreeksen resetten zodat echte data bij 0001 begint.
--   ORD/SNIJ/SNIJV draaien op sequences; FACT/ZEND/SAMP op de
--   nummering-tabel-fallback. R (rolnummers) en SSCC blijven ongemoeid.
-- ---------------------------------------------------------------------
DO $$
BEGIN
    -- is_called=false → eerstvolgende nextval() geeft exact 1 (→ ...-0001)
    PERFORM setval('ord_2026_seq',   1, false);
    PERFORM setval('snij_2026_seq',  1, false);
    PERFORM setval('snijv_2026_seq', 1, false);
EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'Een van de *_2026_seq sequences bestaat niet (anders jaar?) — overgeslagen.';
END $$;

-- Fallback-types in de nummering-tabel: rij verwijderen → eerste volgend_nummer
-- her-initialiseert op 1.
DELETE FROM nummering
WHERE jaar = EXTRACT(YEAR FROM CURRENT_DATE)::int
  AND type IN ('FACT', 'ZEND', 'SAMP');


COMMIT;


-- ---------------------------------------------------------------------
-- STAP 11 — VERIFICATIE (los uitvoeren na COMMIT). Alles 0 verwacht;
--           rollen_niet_schoon hoort 0 te zijn.
-- ---------------------------------------------------------------------
-- SELECT 'orders' AS tabel, count(*) FROM orders
-- UNION ALL SELECT 'order_regels',        count(*) FROM order_regels
-- UNION ALL SELECT 'order_reserveringen', count(*) FROM order_reserveringen
-- UNION ALL SELECT 'facturen',            count(*) FROM facturen
-- UNION ALL SELECT 'factuur_queue',       count(*) FROM factuur_queue
-- UNION ALL SELECT 'snijplannen',         count(*) FROM snijplannen
-- UNION ALL SELECT 'snijvoorstellen',     count(*) FROM snijvoorstellen
-- UNION ALL SELECT 'confectie_orders',    count(*) FROM confectie_orders
-- UNION ALL SELECT 'zendingen',           count(*) FROM zendingen
-- UNION ALL SELECT 'hst_transportorders', count(*) FROM hst_transportorders
-- UNION ALL SELECT 'rollen_niet_schoon',  count(*) FROM rollen
--            WHERE status NOT IN ('beschikbaar','reststuk') OR snijden_gestart_op IS NOT NULL
-- UNION ALL SELECT 'producten_gereserveerd_rest', count(*) FROM producten WHERE gereserveerd <> 0;


-- =====================================================================
-- OPTIONEEL / HANDMATIG — test-snijresten opruimen
-- ---------------------------------------------------------------------
-- Als er tijdens het testen ÉCHT gesneden is (snijplan → 'Gesneden'),
-- zijn er reststuk-rollen aangemaakt (oorsprong_rol_id IS NOT NULL) en is
-- de moederrol fysiek ingekort. Dat inkorten kan dit script NIET
-- terugdraaien (geen lengte-snapshot). Bekijk eerst of dit speelt:
--
--   SELECT count(*) AS test_reststukken
--   FROM rollen WHERE oorsprong_rol_id IS NOT NULL;
--
-- Is dit > 0 en wil je echt schoon beginnen op rolniveau, dan is een
-- verse voorraad-herimport betrouwbaarder dan losse deletes (vanwege de
-- ingekorte moederrollen + voorraad_mutaties-FK). Overleg dit eerst —
-- bewust NIET automatisch in dit script opgenomen.
-- =====================================================================
