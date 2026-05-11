-- Migration 244: lever_type — onderscheid tussen levering per week en op specifieke datum
--
-- Context (ADR 0014): Karpi levert in ~90% per leverweek (B2B). Voor B2C-orders
-- (Floorpassion, particulier maatwerk) moet de leverdatum als specifieke dag
-- kunnen staan. Onder de motorkap werkt het systeem al op orders.afleverdatum
-- (DATE); deze migratie introduceert alleen het intentie-vlag dat door
-- frontend (toggle), Pick & Ship (pick-horizon), check-levertijd (snij-prioriteit)
-- en visuele badges geconsumeerd wordt.
--
-- Veranderingen:
--   1. ENUM lever_type ('week' | 'datum')
--   2. orders.lever_type (NOT NULL, default 'week') — per-order intentie
--   3. debiteuren.default_lever_type (NOT NULL, default 'week') — klant-default
--   4. app_config.productie_planning.dag_order_snij_buffer_werkdagen = 2 — kritieke
--      snij-deadline voor dag-orders (i.t.t. logistieke_buffer_dagen voor week-orders)
--   5. Helper-functie dag_order_snij_buffer_werkdagen() — leest uit app_config
--
-- Bestaande orders/debiteuren krijgen 'week' via DEFAULT — geen backfill nodig.
-- Bundel-sleutel, factuur-cron en IO-sync ongewijzigd: lever_type is leesbaar
-- voor consumers maar wijzigt geen bestaande regels.

-- 1) ENUM
CREATE TYPE lever_type AS ENUM ('week', 'datum');

COMMENT ON TYPE lever_type IS
  'Intentie van order-levering: "week" = ergens binnen de leverweek (B2B-default), '
  '"datum" = op de specifieke afleverdatum (B2C). Bepaalt Pick & Ship-horizon en snij-prioriteit.';

-- 2) Orders-kolom
ALTER TABLE orders
  ADD COLUMN lever_type lever_type NOT NULL DEFAULT 'week';

COMMENT ON COLUMN orders.lever_type IS
  'ADR 0014: "week" = standaard B2B-flow (verschijnt direct in Pick & Ship, snij-buffer = logistieke_buffer_dagen). '
  '"datum" = B2C-belofte op specifieke dag (verschijnt pas 1 werkdag vóór afleverdatum, snij-buffer = dag_order_snij_buffer_werkdagen).';

-- 3) Debiteuren-default
ALTER TABLE debiteuren
  ADD COLUMN default_lever_type lever_type NOT NULL DEFAULT 'week';

COMMENT ON COLUMN debiteuren.default_lever_type IS
  'Voorgevulde lever_type bij orderaanmaak. B2C-klanten kunnen standaard op "datum" staan; '
  'gebruiker kan per order overschrijven via toggle in order-form.';

-- 4) App-config seed (non-destructief: andere velden in productie_planning blijven)
UPDATE app_config
   SET waarde = waarde || jsonb_build_object('dag_order_snij_buffer_werkdagen', 2)
 WHERE sleutel = 'productie_planning'
   AND NOT (waarde ? 'dag_order_snij_buffer_werkdagen');

-- Fallback voor projecten waar productie_planning nog niet bestaat
INSERT INTO app_config (sleutel, waarde)
VALUES ('productie_planning', jsonb_build_object('dag_order_snij_buffer_werkdagen', 2))
ON CONFLICT (sleutel) DO NOTHING;

-- 5) Helper-functie (volgt confectie_buffer_minuten() pattern uit mig 103)
CREATE OR REPLACE FUNCTION dag_order_snij_buffer_werkdagen()
RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT (waarde ->> 'dag_order_snij_buffer_werkdagen')::integer
       FROM app_config
      WHERE sleutel = 'productie_planning'),
    2
  );
$$;

COMMENT ON FUNCTION dag_order_snij_buffer_werkdagen() IS
  'Aantal werkdagen vóór afleverdatum dat een dag-order (lever_type=datum) gesneden moet zijn. '
  'Default 2 — bron: app_config.productie_planning.dag_order_snij_buffer_werkdagen.';

-- 6) View orders_list herbouwen met lever_type — frontend OrdersTable rendert
--    bij 'datum' een dag-badge i.p.v. de Wk N · YYYY weergave. Bevroren
--    kolomlijst van mig 095 + 219 + 222 + lever_type — DROP-CREATE patroon.
DROP VIEW IF EXISTS orders_list;

CREATE VIEW orders_list AS
SELECT
  o.id,
  o.order_nr,
  o.oud_order_nr,
  o.debiteur_nr,
  o.klant_referentie,
  o.orderdatum,
  o.afleverdatum,
  o.status,
  o.aantal_regels,
  o.totaal_bedrag,
  o.totaal_gewicht,
  o.vertegenw_code,
  d.naam AS klant_naam,
  o.heeft_unmatched_regels,
  o.bron_systeem,
  o.bron_shop,
  o.lever_type
FROM orders o
LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Joint klant_naam uit debiteuren. Sinds mig 244: lever_type voor dag-order-badge i.p.v. verzendweek-label.';
