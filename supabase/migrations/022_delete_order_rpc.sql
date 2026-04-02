-- =====================================================================
-- MIGRATIE 022: RPC functie voor order verwijderen
-- =====================================================================
-- Verwijdert een order + regels atomisch en herberekent de
-- voorraadreservering voor alle betrokken producten.
-- =====================================================================

CREATE OR REPLACE FUNCTION delete_order(p_order_id BIGINT)
RETURNS VOID AS $$
DECLARE
    v_artikelnr TEXT;
    v_status TEXT;
BEGIN
    -- Check dat de order bestaat en niet verzonden/geannuleerd is
    SELECT status INTO v_status
    FROM orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % niet gevonden', p_order_id;
    END IF;

    IF v_status IN ('Verzonden') THEN
        RAISE EXCEPTION 'Order met status "%" kan niet verwijderd worden', v_status;
    END IF;

    -- Verzamel betrokken artikelnrs VOOR het verwijderen
    -- zodat we daarna de reserveringen kunnen herberekenen
    CREATE TEMP TABLE _tmp_affected_artikels ON COMMIT DROP AS
        SELECT DISTINCT artikelnr
        FROM order_regels
        WHERE order_id = p_order_id
          AND artikelnr IS NOT NULL;

    -- Verwijder orderregels
    DELETE FROM order_regels WHERE order_id = p_order_id;

    -- Verwijder de order
    DELETE FROM orders WHERE id = p_order_id;

    -- Herbereken reservering voor alle betrokken producten
    FOR v_artikelnr IN SELECT artikelnr FROM _tmp_affected_artikels
    LOOP
        UPDATE producten
        SET gereserveerd = (
                SELECT COALESCE(SUM(or2.te_leveren), 0)
                FROM order_regels or2
                JOIN orders o ON o.id = or2.order_id
                WHERE or2.artikelnr = v_artikelnr
                  AND o.status NOT IN ('Verzonden', 'Geannuleerd')
            ),
            vrije_voorraad = voorraad - (
                SELECT COALESCE(SUM(or2.te_leveren), 0)
                FROM order_regels or2
                JOIN orders o ON o.id = or2.order_id
                WHERE or2.artikelnr = v_artikelnr
                  AND o.status NOT IN ('Verzonden', 'Geannuleerd')
            ) - backorder + besteld_inkoop
        WHERE artikelnr = v_artikelnr;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
