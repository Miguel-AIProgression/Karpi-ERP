-- Migratie 155: RLS-policies op order_reserveringen + SECURITY DEFINER op RPC
--
-- Probleem (gevonden 2026-04-29):
--   Order aanmaken faalt met "new row violates row-level security policy for
--   table order_reserveringen" zodra een handmatige uitwisselbaar-claim wordt
--   weggeschreven via de RPC. RLS staat aan op de tabel (fase 1: alle tabellen
--   RLS enabled) maar er waren géén policies — dus alle non-superuser INSERTs
--   worden geblokkeerd.
--
-- Fix:
--   1. Volledige RLS-policies (SELECT/INSERT/UPDATE/DELETE) voor `authenticated`
--      role — consistent met andere V1-tabellen.
--   2. RPC `set_uitwisselbaar_claims` op SECURITY DEFINER zodat hij ook werkt
--      als de aanroepende user lokaal geen INSERT-rechten heeft. Functie blijft
--      veilig: geen vrije query op user-input, alleen INSERT van een specifieke
--      shape per orderregel.
--
-- Idempotent.

-- ============================================================================
-- RLS policies voor order_reserveringen (mig 144 zette RLS aan zonder policies)
-- ============================================================================
ALTER TABLE order_reserveringen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_reserveringen_select ON order_reserveringen;
CREATE POLICY order_reserveringen_select
  ON order_reserveringen FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS order_reserveringen_insert ON order_reserveringen;
CREATE POLICY order_reserveringen_insert
  ON order_reserveringen FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS order_reserveringen_update ON order_reserveringen;
CREATE POLICY order_reserveringen_update
  ON order_reserveringen FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS order_reserveringen_delete ON order_reserveringen;
CREATE POLICY order_reserveringen_delete
  ON order_reserveringen FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================================
-- SECURITY DEFINER op set_uitwisselbaar_claims
-- (RPC schrijft INSERT op order_reserveringen via de allocator-keten)
-- ============================================================================
ALTER FUNCTION set_uitwisselbaar_claims(BIGINT, JSONB) SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_uitwisselbaar_claims(BIGINT, JSONB) TO authenticated;

COMMENT ON FUNCTION set_uitwisselbaar_claims IS
  'Vervangt handmatige uitwisselbaar-claims voor een orderregel met de in p_keuzes '
  'opgegeven [{artikelnr, aantal}]-lijst. Roept herallocateer_orderregel aan voor '
  'het resterende deel. SECURITY DEFINER (mig 155). Migratie 154.';
