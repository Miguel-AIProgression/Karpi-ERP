-- Migratie 257: order_status ENUM-uitbreiding voor fase-zichtbaarheid (ADR-0016)
--
-- Achtergrond
-- -----------
-- ADR-0006 vestigde Order-lifecycle Module met 5 canonieke statussen. In de
-- praktijk blijkt `Nieuw` een vergaarbak: het verbergt vier operationeel zeer
-- verschillende toestanden (klaar voor picken / wacht op maatwerk / in
-- pickronde / deels verzonden). Zie ADR-0016 voor de volledige beslissing.
--
-- Deze migratie voegt vier nieuwe waarden toe aan `order_status` en twee aan
-- `order_event_type`. RPC's, derivatie en backfill staan in mig 258 — die
-- migratie kan deze waarden pas gebruiken nádat 257 is gecommit (Postgres
-- staat `ADD VALUE` + gebruik in dezelfde transactie niet toe).
--
-- Idempotent: `ADD VALUE IF NOT EXISTS` en DO-block voor event_type.
--
-- LET OP — geen DDL/DML in dezelfde transactie als de ADD VALUE-statements.
-- Daarom is deze migratie bewust kort en bevat alleen ENUM-mutaties.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'Klaar voor picken' AFTER 'Nieuw';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'Wacht op maatwerk' AFTER 'Wacht op inkoop';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'In pickronde' AFTER 'Wacht op maatwerk';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'Deels verzonden' AFTER 'In pickronde';

-- order_event_type uitbreiden — twee nieuwe transities + backfill-marker.
-- Patroon volgt mig 218 §1: DO-block met duplicate_object exception is niet
-- nodig omdat `ADD VALUE IF NOT EXISTS` zelf idempotent is sinds PG 9.6.
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'pickronde_gestart' AFTER 'aangemaakt';
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'deels_verzonden' AFTER 'pickronde_voltooid';
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'backfill_fase_normalisatie' AFTER 'geannuleerd';

NOTIFY pgrst, 'reload schema';
