-- Migratie 489: externe vertegenwoordiger-rol — read-only, alleen eigen klanten via RLS
--
-- Aanleiding: login voor externe vertegenwoordiger (Guido Boecker). Wil read-only
-- inzicht in uitsluitend zíjn gekoppelde klanten + orders + facturen. Afgedwongen
-- in de DB (niet frontend-only) zodat élke query op élke pagina automatisch filtert.
--
-- Patroon: spiegelt is_bug_beheerder() (mig 342) — een SQL-helper die het JWT leest.
-- Hier op app_metadata (alleen service-role kan dat zetten → rep kan zijn scope niet
-- ophogen), gespiegeld in frontend/src/lib/auth/rol.ts.
--
-- Filtersleutel = de KLANT, niet de order. debiteuren.vertegenw_code is NOT NULL;
-- orders.vertegenw_code kan NULL zijn (webshop/Floorpassion). Orders worden dus via
-- hun debiteur gefilterd — dat matcht "zijn klanten" en sluit NULL-orders vanzelf uit.
--
-- BELANGRIJK — bestaande RLS-laag: orders/order_regels/debiteuren/facturen/factuur_regels
-- hadden RLS UIT. Alle andere RLS-tabellen in deze DB dragen een blanket
-- `USING(true) TO authenticated`-policy (advisor-appeasement; writes lopen via
-- SECURITY DEFINER-RPC's). We volgen dat: voor een NIET-rep is elke policy hieronder
-- `true` → gedrag volledig ongewijzigd. Alleen de externe rep wordt gefilterd/geblokt.

-- ---------------------------------------------------------------------------
-- 1. Helpers (single source of truth, gespiegeld in lib/auth/rol.ts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_externe_vertegenwoordiger()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'rol', '') = 'vertegenwoordiger_extern';
$$;

COMMENT ON FUNCTION is_externe_vertegenwoordiger() IS
  'Mig 489: TRUE als de ingelogde gebruiker de externe-vertegenwoordiger-rol heeft '
  '(app_metadata.rol). Gespiegeld in frontend/src/lib/auth/rol.ts.';

CREATE OR REPLACE FUNCTION huidige_vertegenw_code()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'vertegenw_code';
$$;

COMMENT ON FUNCTION huidige_vertegenw_code() IS
  'Mig 489: de medewerkers.code van de ingelogde externe vertegenwoordiger '
  '(app_metadata.vertegenw_code), of NULL.';

GRANT EXECUTE ON FUNCTION is_externe_vertegenwoordiger() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION huidige_vertegenw_code() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. RLS aanzetten + policies
--    SELECT: filtert alleen voor de rep; INSERT/UPDATE/DELETE: voor de rep geblokt.
--    Voor elke andere authenticated gebruiker is alles `true` (= huidig gedrag).
-- ---------------------------------------------------------------------------

-- debiteuren ----------------------------------------------------------------
ALTER TABLE debiteuren ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS debiteuren_rep_select ON debiteuren;
CREATE POLICY debiteuren_rep_select ON debiteuren
  FOR SELECT TO authenticated
  USING (NOT is_externe_vertegenwoordiger()
         OR vertegenw_code = huidige_vertegenw_code());

DROP POLICY IF EXISTS debiteuren_rep_insert ON debiteuren;
CREATE POLICY debiteuren_rep_insert ON debiteuren
  FOR INSERT TO authenticated
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS debiteuren_rep_update ON debiteuren;
CREATE POLICY debiteuren_rep_update ON debiteuren
  FOR UPDATE TO authenticated
  USING (NOT is_externe_vertegenwoordiger())
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS debiteuren_rep_delete ON debiteuren;
CREATE POLICY debiteuren_rep_delete ON debiteuren
  FOR DELETE TO authenticated
  USING (NOT is_externe_vertegenwoordiger());

-- orders --------------------------------------------------------------------
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_rep_select ON orders;
CREATE POLICY orders_rep_select ON orders
  FOR SELECT TO authenticated
  USING (NOT is_externe_vertegenwoordiger()
         OR EXISTS (
           SELECT 1 FROM debiteuren d
           WHERE d.debiteur_nr = orders.debiteur_nr
             AND d.vertegenw_code = huidige_vertegenw_code()
         ));

DROP POLICY IF EXISTS orders_rep_insert ON orders;
CREATE POLICY orders_rep_insert ON orders
  FOR INSERT TO authenticated
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS orders_rep_update ON orders;
CREATE POLICY orders_rep_update ON orders
  FOR UPDATE TO authenticated
  USING (NOT is_externe_vertegenwoordiger())
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS orders_rep_delete ON orders;
CREATE POLICY orders_rep_delete ON orders
  FOR DELETE TO authenticated
  USING (NOT is_externe_vertegenwoordiger());

-- order_regels --------------------------------------------------------------
ALTER TABLE order_regels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_regels_rep_select ON order_regels;
CREATE POLICY order_regels_rep_select ON order_regels
  FOR SELECT TO authenticated
  USING (NOT is_externe_vertegenwoordiger()
         OR EXISTS (
           SELECT 1 FROM orders o
           JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
           WHERE o.id = order_regels.order_id
             AND d.vertegenw_code = huidige_vertegenw_code()
         ));

DROP POLICY IF EXISTS order_regels_rep_insert ON order_regels;
CREATE POLICY order_regels_rep_insert ON order_regels
  FOR INSERT TO authenticated
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS order_regels_rep_update ON order_regels;
CREATE POLICY order_regels_rep_update ON order_regels
  FOR UPDATE TO authenticated
  USING (NOT is_externe_vertegenwoordiger())
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS order_regels_rep_delete ON order_regels;
CREATE POLICY order_regels_rep_delete ON order_regels
  FOR DELETE TO authenticated
  USING (NOT is_externe_vertegenwoordiger());

-- facturen ------------------------------------------------------------------
ALTER TABLE facturen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facturen_rep_select ON facturen;
CREATE POLICY facturen_rep_select ON facturen
  FOR SELECT TO authenticated
  USING (NOT is_externe_vertegenwoordiger()
         OR EXISTS (
           SELECT 1 FROM debiteuren d
           WHERE d.debiteur_nr = facturen.debiteur_nr
             AND d.vertegenw_code = huidige_vertegenw_code()
         ));

DROP POLICY IF EXISTS facturen_rep_insert ON facturen;
CREATE POLICY facturen_rep_insert ON facturen
  FOR INSERT TO authenticated
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS facturen_rep_update ON facturen;
CREATE POLICY facturen_rep_update ON facturen
  FOR UPDATE TO authenticated
  USING (NOT is_externe_vertegenwoordiger())
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS facturen_rep_delete ON facturen;
CREATE POLICY facturen_rep_delete ON facturen
  FOR DELETE TO authenticated
  USING (NOT is_externe_vertegenwoordiger());

-- factuur_regels ------------------------------------------------------------
ALTER TABLE factuur_regels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS factuur_regels_rep_select ON factuur_regels;
CREATE POLICY factuur_regels_rep_select ON factuur_regels
  FOR SELECT TO authenticated
  USING (NOT is_externe_vertegenwoordiger()
         OR EXISTS (
           SELECT 1 FROM facturen f
           JOIN debiteuren d ON d.debiteur_nr = f.debiteur_nr
           WHERE f.id = factuur_regels.factuur_id
             AND d.vertegenw_code = huidige_vertegenw_code()
         ));

DROP POLICY IF EXISTS factuur_regels_rep_insert ON factuur_regels;
CREATE POLICY factuur_regels_rep_insert ON factuur_regels
  FOR INSERT TO authenticated
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS factuur_regels_rep_update ON factuur_regels;
CREATE POLICY factuur_regels_rep_update ON factuur_regels
  FOR UPDATE TO authenticated
  USING (NOT is_externe_vertegenwoordiger())
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS factuur_regels_rep_delete ON factuur_regels;
CREATE POLICY factuur_regels_rep_delete ON factuur_regels
  FOR DELETE TO authenticated
  USING (NOT is_externe_vertegenwoordiger());

-- ---------------------------------------------------------------------------
-- 3. Views security_invoker = true
--    Zonder dit draait een view als owner (definer) en omzeilt de RLS op de
--    onderliggende tabellen → de rep zou via de view toch alles zien.
--    Alle onderliggende RLS-tabellen dragen een blanket-true authenticated-policy,
--    dus voor een niet-rep verandert het gedrag niet.
--    - orders_list  : Orders-overzicht (FROM orders LEFT JOIN debiteuren …)
--    - recente_orders: Dashboard-widget (orders + debiteuren) — alleen eigen orders
--    `IF EXISTS` omdat recente_orders alleen in de live DB bestaat (niet in migraties).
--    dashboard_stats (globale KPI's) bewust NIET geflipt — die aggregaat-view leeft
--    enkel live; de globale KPI-kaarten worden frontend-zijde voor de rep verborgen.
-- ---------------------------------------------------------------------------
ALTER VIEW IF EXISTS orders_list SET (security_invoker = true);
ALTER VIEW IF EXISTS recente_orders SET (security_invoker = true);

NOTIFY pgrst, 'reload schema';
