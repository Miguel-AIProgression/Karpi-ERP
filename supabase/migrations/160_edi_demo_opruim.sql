-- Migratie 160: opruim-RPC voor EDI-demo-data
--
-- Bij ontwikkelen/testen van de EDI-flow ontstaan rijen met `is_test=true`.
-- Deze RPC ruimt ze op in de juiste volgorde:
--   1. order_reserveringen (CASCADE via order_regels)
--   2. order_regels van EDI-test-orders (CASCADE via orders)
--   3. orders met bron_systeem=edi en bron_order_id startend met 'DEMO-'
--   4. edi_berichten met is_test=true
--
-- Returnt aantal verwijderde rijen per tabel zodat de UI het kan tonen.

CREATE OR REPLACE FUNCTION ruim_edi_demo_data() RETURNS TABLE(
  verwijderde_orders     INTEGER,
  verwijderde_berichten  INTEGER
) AS $$
DECLARE
  v_orders   INTEGER := 0;
  v_berichten INTEGER := 0;
BEGIN
  -- 1. Verwijder demo-orders. CASCADE op order_regels en order_reserveringen
  --    via bestaande FK-CASCADE-rules.
  WITH del AS (
    DELETE FROM orders
     WHERE bron_systeem = 'edi'
       AND bron_order_id LIKE 'DEMO-%'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_orders FROM del;

  -- 2. Verwijder alle test-EDI-berichten (zowel inkomend als uitgaand)
  WITH del AS (
    DELETE FROM edi_berichten
     WHERE is_test = TRUE
    RETURNING id
  )
  SELECT COUNT(*) INTO v_berichten FROM del;

  RETURN QUERY SELECT v_orders, v_berichten;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION ruim_edi_demo_data() TO authenticated;

COMMENT ON FUNCTION ruim_edi_demo_data IS
  'Verwijdert alle demo-data van de EDI-flow (orders met DEMO- bron_order_id en '
  'edi_berichten met is_test=true). Returnt het aantal verwijderde rijen per tabel.';
