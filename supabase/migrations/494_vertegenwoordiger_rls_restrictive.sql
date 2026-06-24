-- Migratie 492: rep-policies van PERMISSIVE naar RESTRICTIVE
--
-- Aanleiding (live bevinding 2026-06-24): de 5 doeltabellen dragen al twee
-- blanket-policies "Anon full access" / "Authenticated full access" — beide
-- PERMISSIVE, FOR ALL, USING(true) (advisor-appeasement, writes via SECURITY
-- DEFINER-RPC's). PERMISSIVE policies worden met OR gecombineerd, dus de rep-
-- policies uit mig 490 (óók PERMISSIVE) deden niets: `eigen_klant OR true` = true.
-- Guido zag daardoor alles, ook al gaf is_externe_vertegenwoordiger() TRUE terug.
--
-- Fix: dezelfde policies herdefiniëren AS RESTRICTIVE. Restrictive policies worden
-- met AND op de permissive laag gelegd → effectief `true AND (eigen_klant)` voor de
-- rep, en `true AND (NOT rep = true)` = ongewijzigd voor al het personeel.
-- Permissive↔restrictive kan niet via ALTER POLICY → DROP + CREATE.
-- RLS staat al aan (mig 490); de blanket-policies blijven onaangeroerd.

-- debiteuren ----------------------------------------------------------------
DROP POLICY IF EXISTS debiteuren_rep_select ON debiteuren;
CREATE POLICY debiteuren_rep_select ON debiteuren
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT is_externe_vertegenwoordiger()
         OR vertegenw_code = huidige_vertegenw_code());

DROP POLICY IF EXISTS debiteuren_rep_insert ON debiteuren;
CREATE POLICY debiteuren_rep_insert ON debiteuren
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS debiteuren_rep_update ON debiteuren;
CREATE POLICY debiteuren_rep_update ON debiteuren
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT is_externe_vertegenwoordiger())
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS debiteuren_rep_delete ON debiteuren;
CREATE POLICY debiteuren_rep_delete ON debiteuren
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT is_externe_vertegenwoordiger());

-- orders --------------------------------------------------------------------
DROP POLICY IF EXISTS orders_rep_select ON orders;
CREATE POLICY orders_rep_select ON orders
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT is_externe_vertegenwoordiger()
         OR EXISTS (
           SELECT 1 FROM debiteuren d
           WHERE d.debiteur_nr = orders.debiteur_nr
             AND d.vertegenw_code = huidige_vertegenw_code()
         ));

DROP POLICY IF EXISTS orders_rep_insert ON orders;
CREATE POLICY orders_rep_insert ON orders
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS orders_rep_update ON orders;
CREATE POLICY orders_rep_update ON orders
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT is_externe_vertegenwoordiger())
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS orders_rep_delete ON orders;
CREATE POLICY orders_rep_delete ON orders
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT is_externe_vertegenwoordiger());

-- order_regels --------------------------------------------------------------
DROP POLICY IF EXISTS order_regels_rep_select ON order_regels;
CREATE POLICY order_regels_rep_select ON order_regels
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT is_externe_vertegenwoordiger()
         OR EXISTS (
           SELECT 1 FROM orders o
           JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
           WHERE o.id = order_regels.order_id
             AND d.vertegenw_code = huidige_vertegenw_code()
         ));

DROP POLICY IF EXISTS order_regels_rep_insert ON order_regels;
CREATE POLICY order_regels_rep_insert ON order_regels
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS order_regels_rep_update ON order_regels;
CREATE POLICY order_regels_rep_update ON order_regels
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT is_externe_vertegenwoordiger())
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS order_regels_rep_delete ON order_regels;
CREATE POLICY order_regels_rep_delete ON order_regels
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT is_externe_vertegenwoordiger());

-- facturen ------------------------------------------------------------------
DROP POLICY IF EXISTS facturen_rep_select ON facturen;
CREATE POLICY facturen_rep_select ON facturen
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT is_externe_vertegenwoordiger()
         OR EXISTS (
           SELECT 1 FROM debiteuren d
           WHERE d.debiteur_nr = facturen.debiteur_nr
             AND d.vertegenw_code = huidige_vertegenw_code()
         ));

DROP POLICY IF EXISTS facturen_rep_insert ON facturen;
CREATE POLICY facturen_rep_insert ON facturen
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS facturen_rep_update ON facturen;
CREATE POLICY facturen_rep_update ON facturen
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT is_externe_vertegenwoordiger())
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS facturen_rep_delete ON facturen;
CREATE POLICY facturen_rep_delete ON facturen
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT is_externe_vertegenwoordiger());

-- factuur_regels ------------------------------------------------------------
DROP POLICY IF EXISTS factuur_regels_rep_select ON factuur_regels;
CREATE POLICY factuur_regels_rep_select ON factuur_regels
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT is_externe_vertegenwoordiger()
         OR EXISTS (
           SELECT 1 FROM facturen f
           JOIN debiteuren d ON d.debiteur_nr = f.debiteur_nr
           WHERE f.id = factuur_regels.factuur_id
             AND d.vertegenw_code = huidige_vertegenw_code()
         ));

DROP POLICY IF EXISTS factuur_regels_rep_insert ON factuur_regels;
CREATE POLICY factuur_regels_rep_insert ON factuur_regels
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS factuur_regels_rep_update ON factuur_regels;
CREATE POLICY factuur_regels_rep_update ON factuur_regels
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT is_externe_vertegenwoordiger())
  WITH CHECK (NOT is_externe_vertegenwoordiger());

DROP POLICY IF EXISTS factuur_regels_rep_delete ON factuur_regels;
CREATE POLICY factuur_regels_rep_delete ON factuur_regels
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT is_externe_vertegenwoordiger());

NOTIFY pgrst, 'reload schema';
