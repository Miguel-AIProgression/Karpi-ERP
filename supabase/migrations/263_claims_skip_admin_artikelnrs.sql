-- Migratie 263: claim-keten slaat admin-orderregels over
--
-- Probleem: in mig 261 (later teruggerold door mig 262) crashte
-- INSERT INTO order_regels met artikelnr='BUNDELKORTING' op een
-- stack-depth-error. Oorzaak: herwaardeer_claims_voor_order loopt
-- ALLE orderregels, roept herallocateer_orderregel per regel, die
-- via herwaardeer_order_status weer herwaardeer_claims_voor_order
-- aanroept — oneindige recursie zodra admin-orderregels worden
-- toegevoegd waar de allocator niet op gerekend heeft.
--
-- Fix: filter VERZEND/BUNDELKORTING/DREMPELKORTING uit de loop.
-- Allocator-logica is alleen relevant voor product-regels met
-- werkelijk te-leveren-aantallen.
--
-- Idempotent via CREATE OR REPLACE.
-- VOORWAARDE: mig 254 toegepast.

CREATE OR REPLACE FUNCTION herwaardeer_claims_voor_order(p_order_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_regel_id BIGINT;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_regel_id IN
    SELECT id FROM order_regels
     WHERE order_id = p_order_id
       AND COALESCE(artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
  LOOP
    PERFORM herallocateer_orderregel(v_regel_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herwaardeer_claims_voor_order(BIGINT) IS
  'ADR-0015 / Mig 254 + Mig 263: Reservering-Module eigendom. Loopt orderregels '
  'van de order (excl. admin-artikelnrs VERZEND/BUNDELKORTING/DREMPELKORTING) en '
  'triggert per regel herallocateer_orderregel. Schrijft GEEN orders.status en GEEN '
  'orders.afleverdatum — callers chainen expliciet herbereken_wacht_status '
  '(Order-lifecycle, mig 218) en sync_order_afleverdatum_met_claims (Levertijd-TODO, mig 153). '
  'Het admin-filter (mig 263) is sinds mig 267 (wrapper-revert) strikt redundant — '
  'de cyclus die hier werd doorbroken bestaat niet meer. Filter blijft staan als '
  'defensieve guard mocht een latere caller herwaardeer_claims_voor_order weer '
  'vanuit een triggerketen aanroepen.';

NOTIFY pgrst, 'reload schema';
