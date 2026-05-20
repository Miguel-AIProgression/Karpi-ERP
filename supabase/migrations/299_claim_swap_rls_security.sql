-- Migratie 299: RLS-policy op order_events + SECURITY DEFINER op claim-swap
-- RPC's (review-fix mig 297/298, ADR-0027)
--
-- Problemen die de code-review (2026-05-20) blootlegde:
--
-- A1 — SELECT-policy ontbreekt op order_events:
--   Mig 218 zette RLS aan op order_events, maar er bestaat alleen een
--   INSERT-pad via SECURITY DEFINER (mig 218_z _apply_transitie). Er is
--   géén SELECT-policy voor authenticated. Gevolg: vanuit de frontend
--   leveren SELECT-queries op order_events stilletjes 0 rijen (PostgREST
--   error-loos). De rode "Deadline-conflict"-chip in orders-overview en de
--   <OrderEventsTijdlijn> op order-detail zijn daardoor onzichtbaar — geen
--   user-zichtbare error, alleen graceful degradation tot "feature werkt
--   niet". Fix: SELECT-policy toevoegen consistent met mig 155.
--
-- A2 — Claim-swap RPC's zijn niet SECURITY DEFINER:
--   `herallocateer_orderregel` (uitgebreid in mig 297),
--   `sync_order_afleverdatum_met_claims` (uitgebreid in mig 298) en de
--   nieuwe trigger-functie `trg_io_regel_insert_swap_evaluate` (mig 297)
--   INSERT-en op `order_events`. Omdat order_events alleen via
--   SECURITY DEFINER door _apply_transitie wordt gevuld (mig 218_z), zou
--   een directe INSERT vanuit de claim-swap-RPC's onder een non-superuser
--   sessie falen met "new row violates row-level security policy for
--   table order_events" (42501). Patroon identiek aan mig 218_z whack-a-
--   mole: blanket SECURITY DEFINER + SET search_path = public op de
--   schrijvende RPC-keten.
--
-- Idempotent: CREATE POLICY/DROP POLICY/ALTER FUNCTION zijn herhaalbaar.

-- ============================================================================
-- A1 — SELECT-policy op order_events voor authenticated
-- ============================================================================
-- Werkt symmetrisch met andere V1-RLS-tabellen (mig 155 voor
-- order_reserveringen). Geen INSERT-policy hier — INSERTs blijven uitsluitend
-- via SECURITY DEFINER-RPC's lopen (single-writer-discipline van ADR-0006).

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_events_select ON order_events;
CREATE POLICY order_events_select
  ON order_events FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY order_events_select ON order_events IS
  'Mig 299 / ADR-0027: lees-policy voor authenticated. INSERTs blijven '
  'uitsluitend via SECURITY DEFINER-RPCs (_apply_transitie + claim-swap-RPCs '
  'in mig 218_z, 297, 298, 299) — single-writer-discipline van ADR-0006.';

-- ============================================================================
-- A2 — SECURITY DEFINER op de claim-swap-RPC-keten
-- ============================================================================
-- ALTER FUNCTION ... SECURITY DEFINER + SET search_path = public.
-- Volgt het mig 218_z-patroon. NB: deze ALTERs draaien NA de CREATE OR REPLACE
-- in mig 297/298 (alfabetisch + numeriek gegarandeerd door bestandsnaam-prefix
-- 299 > 297/298) zodat CREATE OR REPLACE de DEFINER niet later overschrijft.

ALTER FUNCTION herallocateer_orderregel(BIGINT) SECURITY DEFINER;
ALTER FUNCTION herallocateer_orderregel(BIGINT) SET search_path = public;

ALTER FUNCTION sync_order_afleverdatum_met_claims(BIGINT) SECURITY DEFINER;
ALTER FUNCTION sync_order_afleverdatum_met_claims(BIGINT) SET search_path = public;

ALTER FUNCTION trg_io_regel_insert_swap_evaluate() SECURITY DEFINER;
ALTER FUNCTION trg_io_regel_insert_swap_evaluate() SET search_path = public;

-- ============================================================================
-- Audit-comment
-- ============================================================================
COMMENT ON FUNCTION herallocateer_orderregel(BIGINT) IS
  'Mig 154 base + mig 297 swap-fase (ADR-0027) + mig 299 SECURITY DEFINER. '
  'Idempotent: release niet-handmatige claims, alloceer opnieuw '
  '(voorraad eigen artikel → swap-fase ADR-0027 → IO eigen artikel). '
  'Handmatige uitwisselbaar-claims (is_handmatig=true) blijven staan en zijn '
  'NOOIT swap-bron (mig 297 A3-fix). Sluit maatwerk-regels uit. '
  'SECURITY DEFINER omdat de swap-fase order_events insert-t — single-writer-'
  'discipline van ADR-0006.';

COMMENT ON FUNCTION sync_order_afleverdatum_met_claims(BIGINT) IS
  'Mig 153 base + mig 298 deadline-conflict-emit (ADR-0027 Ingreep 5) + '
  'mig 299 SECURITY DEFINER. Synchroniseert orders.afleverdatum naar de '
  'laatste IO-claim-leverdatum + buffer; emit deadline_conflict_na_swap-event '
  'als afleverdatum > standaard_afleverdatum_berekend EN er een eerder '
  'claim_geswapt_weg-event op de order bestaat (dedup 24u).';

COMMENT ON FUNCTION trg_io_regel_insert_swap_evaluate() IS
  'Mig 297 (ADR-0027) + mig 299 SECURITY DEFINER. Bij INSERT van een IO-regel '
  '(eenheid=stuks) heralloceer orderregels in status Wacht op voorraad voor '
  'hetzelfde artikelnr — een nieuwe IO kan nu een swap-doelwit zijn voor een '
  'order met afleverdatum > standaard, zodat een urgenter order alsnog '
  'voorraad krijgt. V1: geen cascade (alleen Wacht op voorraad, niet Wacht '
  'op inkoop) — zie A5-fix in mig 297.';
