-- Migration 068: admin RPC om orders + order_regels te trunceren (testdata-refresh).
-- CASCADE verwijdert ook snijplannen, kleuren, confectie_planning, rol-koppelingen.
-- Alleen bedoeld voor testomgevingen.

CREATE OR REPLACE FUNCTION admin_truncate_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  TRUNCATE TABLE orders, order_regels RESTART IDENTITY CASCADE;
END;
$$;

COMMENT ON FUNCTION admin_truncate_orders IS
  'Leegt orders + order_regels (CASCADE). Alleen voor testdata-refresh.';
