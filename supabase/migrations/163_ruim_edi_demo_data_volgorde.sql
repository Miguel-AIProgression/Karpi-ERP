-- Migratie 163: ruim_edi_demo_data — verwijder volgorde omdraaien
--
-- Probleem (gevonden 2026-04-30 bij eerste cleanup-test):
--   `ruim_edi_demo_data()` probeert eerst orders te verwijderen, maar edi_berichten
--   met richting='uit' hebben een FK `edi_berichten.order_id → orders(id)` met
--   default NO ACTION. Daardoor geeft de DELETE op orders een FK-violation als
--   er nog uitgaande berichten openstaan voor die order (bv. orderbev op de
--   wachtrij). De foutmelding "[object Object]" in de UI verbergt dit, maar
--   de PostgrestError bevat 23503 (foreign_key_violation).
--
-- Fix:
--   Volgorde omdraaien — eerst alle is_test=true edi_berichten verwijderen,
--   dán pas de DEMO-/UPLOAD-orders. order_regels en order_reserveringen
--   cascaden mee bij order-delete via bestaande FK-rules.
--
-- Idempotent. Behoudt de output-signatuur uit migratie 160/161.

CREATE OR REPLACE FUNCTION ruim_edi_demo_data() RETURNS TABLE(
  verwijderde_orders     INTEGER,
  verwijderde_berichten  INTEGER
) AS $$
DECLARE
  v_orders    INTEGER := 0;
  v_berichten INTEGER := 0;
BEGIN
  -- 1. Eerst alle test-EDI-berichten verwijderen. Hiermee worden ook de
  --    uitgaande orderbev-rijen weggehaald die naar de demo-orders verwijzen
  --    (FK edi_berichten.order_id → orders.id).
  WITH del AS (
    DELETE FROM edi_berichten
     WHERE is_test = TRUE
    RETURNING id
  )
  SELECT COUNT(*) INTO v_berichten FROM del;

  -- 2. Daarna de orders die via demo of upload zijn aangemaakt.
  --    CASCADE ruimt order_regels + order_reserveringen mee.
  WITH del AS (
    DELETE FROM orders
     WHERE bron_systeem = 'edi'
       AND (bron_order_id LIKE 'DEMO-%' OR bron_order_id LIKE 'UPLOAD-%')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_orders FROM del;

  RETURN QUERY SELECT v_orders, v_berichten;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION ruim_edi_demo_data() IS
  'Verwijdert alle test-data van de EDI-flow (demo-berichten + handmatige uploads). '
  'Volgorde: eerst edi_berichten (zodat FKs op orders vrijkomen), dan de orders zelf. '
  'Returnt het aantal verwijderde rijen per tabel. Migratie 160 → 161 → 163.';
