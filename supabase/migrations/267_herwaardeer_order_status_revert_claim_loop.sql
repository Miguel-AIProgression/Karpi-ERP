-- Migratie 267: herwaardeer_order_status terug naar mig 218-gedrag
--
-- Probleem: bij INSERT van een product-orderregel (bv. via "Nieuwe order"-UI)
-- crasht het systeem op `stack depth limit exceeded`. Mig 266 ving alleen het
-- admin-INSERT-pad af; de cyclus voor gewone product-INSERTs blijft draaien:
--
--   INSERT order_regels (productregel R1)
--     → trigger A → herallocateer_orderregel(R1)
--         → (claim-werk) → PERFORM herwaardeer_order_status(O)
--             → PERFORM herwaardeer_claims_voor_order(O)
--                 → FOR R_i in regels: herallocateer_orderregel(R_i)
--                     → PERFORM herwaardeer_order_status(O)  ← RECURSIE
--
-- Root-cause: mig 254 voegde `PERFORM herwaardeer_claims_voor_order(p_order_id)`
-- toe aan de `herwaardeer_order_status`-wrapper (regels 298-305). Vóór mig 254
-- (mig 218-versie) deed de wrapper géén claim-loop — alleen status-bepaling
-- + afleverdatum-sync. Die mig-218-versie was veilig en convergent.
--
-- Fix: herstel de mig-218-versie. Beide huidige PERFORM-callers
-- (`herallocateer_orderregel` mig 154, `boek_io_ontvangst_claims` mig 254)
-- doen ZELF het claim-werk en roepen de wrapper aan voor status+afleverdatum.
-- Geen caller verwacht herallocatie van álle orderregels via de wrapper —
-- dat was de incidentele aanname van mig 254 die de cyclus creëerde.
--
-- `herwaardeer_claims_voor_order(BIGINT)` blijft beschikbaar als publieke RPC
-- voor expliciete aanroepers die wél een volledige loop willen.
--
-- Idempotent via CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION herwaardeer_order_status(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  -- Order-lifecycle (mig 218): bepaalt Wacht op X / Nieuw via _apply_transitie.
  PERFORM herbereken_wacht_status(p_order_id);

  -- Reservering (mig 153): schuift orders.afleverdatum vooruit naar laatste IO-claim.
  PERFORM sync_order_afleverdatum_met_claims(p_order_id);
END;
$$;

COMMENT ON FUNCTION herwaardeer_order_status(BIGINT) IS
  'Mig 267 (revert mig 254 toevoeging): thin wrapper voor de twee non-claim '
  'verantwoordelijkheden — herbereken_wacht_status (Order-lifecycle, mig 218) '
  'en sync_order_afleverdatum_met_claims (Levertijd, mig 153). De mig-254 '
  'toevoeging van PERFORM herwaardeer_claims_voor_order is verwijderd omdat '
  'die een cyclus met herallocateer_orderregel veroorzaakte (stack depth limit '
  'exceeded bij elke product-INSERT). Callers die expliciet ALLE orderregels '
  'willen her-alloceren roepen herwaardeer_claims_voor_order(BIGINT) zelf aan.';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Mig 267 toegepast: herwaardeer_order_status terug naar mig 218-vorm. ';
  RAISE NOTICE 'Trigger-cyclus via wrapper is verbroken; nieuwe orders aanmaken moet weer werken.';
END $$;
