-- Migratie 563: Combi-levering herzien naar een echte order_status (ADR-0040,
-- supersedeert ADR-0039's Startbaarheid-gate-keuze) — stap 1: enum-waarde.
--
-- Aanleiding: de mig 556-562-implementatie maakte een combi-levering-
-- wachtende order gewoon zichtbaar in Pick & Ship (status 'Klaar voor picken')
-- en blokkeerde alleen het STARTEN van de pickronde via een frontend-only
-- Startbaarheid-laag. Bij het testen bleek dat niet de bedoeling: de order
-- moet helemaal niet in Pick & Ship verschijnen zolang de vrachtvrije-drempel
-- niet gehaald is — precies zoals 'Wacht op inkoop'/'Wacht op voorraad'/
-- 'Wacht op maatwerk' dat al doen voor hun eigen wacht-redenen.
--
-- BEWUST GEEN andere statements in dit bestand: PostgreSQL staat een nieuwe
-- enum-waarde niet toe in dezelfde transactie als waarin hij gebruikt wordt
-- (project-precedent: mig 437/438 splitsen hier al bewust om). Alle
-- vervolgstappen (derive_wacht_status, herbereken_wacht_status,
-- order_pickbaarheid, de combi-levering-triggers, het enum-snapshot) staan in
-- latere, losse migraties (564-568) die pas ná deze committen.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'Wacht op combi-levering' AFTER 'Wacht op maatwerk';
