-- Migratie 237: confectie_status_counts RPC
--
-- Vervangt de client-side COUNT(*) GROUP BY status in
-- frontend/src/lib/supabase/queries/confectie.ts (fetchConfectieStatusCounts)
-- die alle rijen uit `confectie_overzicht` ophaalde puur om in JS een Map
-- aan te leggen. Volgt 1-op-1 het patroon van `snijplanning_status_counts_gefilterd`
-- (uit verwijderde mig 045) zodat alle status-tellers eenzelfde shape hebben.

CREATE OR REPLACE FUNCTION confectie_status_counts()
RETURNS TABLE (
  status TEXT,
  aantal BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    co.status::TEXT,
    COUNT(*) AS aantal
  FROM confectie_overzicht co
  GROUP BY co.status
  HAVING COUNT(*) > 0
  ORDER BY co.status;
$$;

COMMENT ON FUNCTION confectie_status_counts() IS
  'Aantal confectie-orders per status uit view confectie_overzicht. Vervangt '
  'client-side aggregatie in fetchConfectieStatusCounts. Mig 237.';
