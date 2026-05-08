-- Migratie 218: SECURITY DEFINER op de hele Order-lifecycle Module-keten
--
-- Bug op 08-05 (derde 42501-runde): na de zending_status-fix en de
-- enqueue_factuur-fix gooit voltooi_pickronde nu
--   `new row violates row-level security policy for table "order_events"` (42501).
--
-- Patroon: elke schrijver in de keten valt op een eigen RLS-tabel zonder
-- INSERT-policy voor authenticated. Eerder gefixet: factuur_queue (via
-- 218_enqueue_factuur_security_definer.sql). Nu: order_events (geschreven
-- door _apply_transitie). Volgende potentiële traps in dezelfde keten zijn
-- alle tabellen die door triggers op orders.status worden geraakt.
--
-- Genoeg whack-a-mole. Blanket-fix: SECURITY DEFINER + SET search_path = public
-- op alle ADR-0006-Module-functies plus voltooi_pickronde. Reden:
--   * Deze functies zijn de enige schrijvers van orders.status / order_events
--     en zijn gevalideerd in inputs (geen vrije query op user-input).
--   * Triggers die door deze functies geraakt worden, erven de
--     SECURITY-context — dus ook trg_enqueue_factuur draait voortaan als
--     owner ongeacht of mig 118 zelf SECURITY DEFINER is.
--   * Zelfde aanpak als mig 155 op set_uitwisselbaar_claims.
--
-- BELANGRIJK — bestandsnaamgeving:
-- Dit bestand begint met `218_z_` zodat het alfabetisch NA
-- `218_voltooi_pickronde_zending_status_fix.sql` (begint met `218_v...`)
-- wordt uitgevoerd. Reden: die fix-migratie doet `CREATE OR REPLACE FUNCTION
-- voltooi_pickronde`, en CREATE OR REPLACE reset functie-attributen
-- (SECURITY DEFINER, SET clauses, volatility) naar de default INVOKER. Als
-- onze ALTER vóór de CREATE OR REPLACE liep, zou die laatste de SECURITY
-- DEFINER er weer afhalen. ALTER FUNCTION na CREATE OR REPLACE plakt de
-- SECURITY DEFINER definitief op de actuele definitie.
--
-- Idempotent: ALTER FUNCTION is idempotent.

-- ============================================================================
-- _apply_transitie — schrijft order_events + UPDATE orders
-- ============================================================================
ALTER FUNCTION _apply_transitie(
  BIGINT, order_event_type, order_status, BIGINT, UUID, TEXT, JSONB
) SECURITY DEFINER;
ALTER FUNCTION _apply_transitie(
  BIGINT, order_event_type, order_status, BIGINT, UUID, TEXT, JSONB
) SET search_path = public;

-- ============================================================================
-- markeer_verzonden / markeer_geannuleerd — entry-points van de Module
-- ============================================================================
ALTER FUNCTION markeer_verzonden(BIGINT, BIGINT, UUID) SECURITY DEFINER;
ALTER FUNCTION markeer_verzonden(BIGINT, BIGINT, UUID) SET search_path = public;

ALTER FUNCTION markeer_geannuleerd(BIGINT, TEXT, BIGINT, UUID) SECURITY DEFINER;
ALTER FUNCTION markeer_geannuleerd(BIGINT, TEXT, BIGINT, UUID) SET search_path = public;

-- ============================================================================
-- herbereken_wacht_status / herwaardeer_order_status — recompute-paden
-- ============================================================================
ALTER FUNCTION herbereken_wacht_status(BIGINT) SECURITY DEFINER;
ALTER FUNCTION herbereken_wacht_status(BIGINT) SET search_path = public;

ALTER FUNCTION herwaardeer_order_status(BIGINT) SECURITY DEFINER;
ALTER FUNCTION herwaardeer_order_status(BIGINT) SET search_path = public;

-- ============================================================================
-- voltooi_pickronde — frontend-entry, kop van de keten
-- ============================================================================
ALTER FUNCTION voltooi_pickronde(BIGINT, BIGINT) SECURITY DEFINER;
ALTER FUNCTION voltooi_pickronde(BIGINT, BIGINT) SET search_path = public;

COMMENT ON FUNCTION _apply_transitie(
  BIGINT, order_event_type, order_status, BIGINT, UUID, TEXT, JSONB
) IS
  'Mig 218 (ADR-0006 + RLS-fix): interne helper, enige UPDATE orders SET status. '
  'Atomair: status + verzonden_at (bij Verzonden) + INSERT order_events. '
  'SECURITY DEFINER zodat order_events-INSERT lukt vanuit authenticated-context '
  '(order_events heeft RLS aan zonder INSERT-policy voor authenticated). '
  'Idempotent: no-op als status al gelijk is.';

NOTIFY pgrst, 'reload schema';
