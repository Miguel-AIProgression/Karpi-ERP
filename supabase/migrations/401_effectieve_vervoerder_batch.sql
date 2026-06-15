-- Migratie 401: batch-resolver effectieve_vervoerder_voor_orders(BIGINT[])
--
-- Aanleiding (Pick & Ship laad-storm, 2026-06-15): na de Rhenus go-live
-- (06-14 country-routing-cutover) zijn ~171 DE-orders niet langer "geen
-- vervoerder" en stromen ze allemaal als pickbaar de week-secties in. Pick &
-- Ship rendert daardoor 266 order-cards, en elke card resolveert zijn vervoerder
-- via een eigen `effectieve_vervoerder_per_orderregel(order_id)`-call (N+1).
-- React Query dedupliceert per order_id, maar dat blijven N losse HTTP-calls;
-- zolang een card's call nog laadt staat de "Verzendset"-knop disabled
-- (vervoerderResolutieLaadt) en de vervoerder-pill leeg. De operator ziet
-- daardoor "geblokkeerde" grijze knoppen terwijl er server-side niets mis is.
--
-- Deze batch-RPC laat de frontend de resolutie voor álle zichtbare orders in
-- ÉÉN call ophalen. Implementatie = dunne LATERAL-wrapper over de bestaande
-- per-order-functie: GEEN duplicatie van de ladder-/matcher-logica (anders
-- drift t.o.v. effectieve_vervoerder_per_orderregel). De per-order-functie
-- gooit een EXCEPTION als de order niet bestaat — daarom een EXISTS-guard +
-- DISTINCT op de input zodat één onbekende/dubbele id de hele batch niet velt.
--
-- Return-shape = identiek aan effectieve_vervoerder_per_orderregel, met een
-- extra `order_id`-prefix-kolom zodat de frontend per order kan groeperen.

CREATE OR REPLACE FUNCTION effectieve_vervoerder_voor_orders(p_order_ids BIGINT[])
RETURNS TABLE (
  order_id             BIGINT,
  orderregel_id        BIGINT,
  override_code        TEXT,
  evaluator_code       TEXT,
  evaluator_service    TEXT,
  effectief_code       TEXT,
  effectief_service    TEXT,
  bron                 TEXT,
  is_locked            BOOLEAN,
  uitleg               JSONB
) AS $$
  SELECT
    ids.oid AS order_id,
    r.orderregel_id,
    r.override_code,
    r.evaluator_code,
    r.evaluator_service,
    r.effectief_code,
    r.effectief_service,
    r.bron,
    r.is_locked,
    r.uitleg
  FROM (
    SELECT DISTINCT u AS oid
      FROM unnest(COALESCE(p_order_ids, ARRAY[]::BIGINT[])) AS u
     WHERE EXISTS (SELECT 1 FROM orders o WHERE o.id = u)
  ) ids
  CROSS JOIN LATERAL effectieve_vervoerder_per_orderregel(ids.oid) AS r;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION effectieve_vervoerder_voor_orders(BIGINT[]) TO authenticated;

COMMENT ON FUNCTION effectieve_vervoerder_voor_orders(BIGINT[]) IS
  'Mig 401 (ADR-0008): batch-variant van effectieve_vervoerder_per_orderregel. '
  'Dunne LATERAL-wrapper (geen eigen ladder-logica) zodat Pick & Ship de '
  'vervoerder-resolutie voor alle zichtbare orders in één call kan ophalen i.p.v. '
  'N losse RPC-calls. EXISTS-guard + DISTINCT maken één onbekende/dubbele id '
  'onschadelijk. STABLE: cachebaar via TanStack Query.';

NOTIFY pgrst, 'reload schema';
