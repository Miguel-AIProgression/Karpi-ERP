-- =====================================================================
-- MIGRATIE 020: Automatische voorraadreservering bij orders
-- =====================================================================
-- Doel: producten.gereserveerd en vrije_voorraad automatisch bijwerken
--        zodat ze exact overeenkomen met alle actieve order_regels.
--
-- Logica:
--   gereserveerd   = SUM(te_leveren) van alle order_regels waar:
--                    - artikelnr IS NOT NULL
--                    - order.status NOT IN ('Verzonden', 'Geannuleerd')
--   vrije_voorraad = voorraad - gereserveerd - backorder + besteld_inkoop
--
-- Triggers:
--   1. order_regels INSERT/UPDATE/DELETE → herbereken voor betreffende artikelnr(s)
--   2. orders.status wijziging          → herbereken voor alle artikelnrs in die order
--
-- ENUM DEPENDENCY: Statusfilter gebruikt exclusielijst ('Verzonden', 'Geannuleerd').
-- Bij toevoegen van nieuwe eindstatussen aan order_status enum → deze functie updaten.
-- =====================================================================

-- =============================================================
-- FUNCTIE: Herbereken reservering voor één product
-- =============================================================
CREATE OR REPLACE FUNCTION herbereken_product_reservering(p_artikelnr TEXT)
RETURNS VOID AS $$
DECLARE
    v_gereserveerd INTEGER;
BEGIN
    -- Lock producten-rij om race conditions te voorkomen
    PERFORM 1 FROM producten WHERE artikelnr = p_artikelnr FOR UPDATE;

    SELECT COALESCE(SUM(or2.te_leveren), 0)
    INTO v_gereserveerd
    FROM order_regels or2
    JOIN orders o ON o.id = or2.order_id
    WHERE or2.artikelnr = p_artikelnr
      AND o.status NOT IN ('Verzonden', 'Geannuleerd');

    UPDATE producten
    SET gereserveerd = v_gereserveerd,
        vrije_voorraad = voorraad - v_gereserveerd - backorder + besteld_inkoop
    WHERE artikelnr = p_artikelnr;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- TRIGGER FUNCTIE: Bij wijziging order_regels
-- =============================================================
CREATE OR REPLACE FUNCTION update_reservering_bij_orderregel()
RETURNS TRIGGER AS $$
BEGIN
    -- Bij DELETE of UPDATE: herbereken voor het OUDE artikelnr
    IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.artikelnr IS NOT NULL THEN
        PERFORM herbereken_product_reservering(OLD.artikelnr);
    END IF;

    -- Bij INSERT of UPDATE: herbereken voor het NIEUWE artikelnr
    -- (skip als zelfde artikelnr — al herberekend hierboven)
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.artikelnr IS NOT NULL THEN
        IF TG_OP = 'INSERT' OR OLD.artikelnr IS DISTINCT FROM NEW.artikelnr THEN
            PERFORM herbereken_product_reservering(NEW.artikelnr);
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- TRIGGER FUNCTIE: Bij statuswijziging van een order
-- =============================================================
CREATE OR REPLACE FUNCTION update_reservering_bij_order_status()
RETURNS TRIGGER AS $$
DECLARE
    v_artikelnr TEXT;
BEGIN
    -- Herbereken voor ALLE producten in deze order
    FOR v_artikelnr IN
        SELECT DISTINCT artikelnr
        FROM order_regels
        WHERE order_id = NEW.id
          AND artikelnr IS NOT NULL
    LOOP
        PERFORM herbereken_product_reservering(v_artikelnr);
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- TRIGGERS AANMAKEN
-- =============================================================

-- Trigger op order_regels (na INSERT/UPDATE/DELETE)
DROP TRIGGER IF EXISTS trg_reservering_orderregel ON order_regels;
CREATE TRIGGER trg_reservering_orderregel
    AFTER INSERT OR UPDATE OR DELETE ON order_regels
    FOR EACH ROW
    EXECUTE FUNCTION update_reservering_bij_orderregel();

-- Trigger op orders (alleen bij statuswijziging)
DROP TRIGGER IF EXISTS trg_reservering_order_status ON orders;
CREATE TRIGGER trg_reservering_order_status
    AFTER UPDATE ON orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION update_reservering_bij_order_status();
