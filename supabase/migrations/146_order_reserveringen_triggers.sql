-- Migratie 146: triggers — order_regels mutatie, orders status, claim-tabel sync
--
-- Drie trigger-velden:
--   A. order_regels INSERT/UPDATE/DELETE → herallocateer
--   B. orders UPDATE status → herwaardeer
--   C. order_reserveringen INSERT/UPDATE/DELETE → herbereken_product_reservering
--
-- Bestaande triggers uit eerdere migraties (update_reservering_bij_*) worden
-- vervangen door C, want bron-van-waarheid wordt nu order_reserveringen ipv te_leveren.

-- ============================================================================
-- A. Trigger op order_regels: bij INSERT/UPDATE → herallocateer
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_orderregel_herallocateer()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Alle claims worden vanzelf cascade-deleted door FK ON DELETE CASCADE.
    -- Producten.gereserveerd resync gebeurt via trigger C.
    RETURN OLD;
  END IF;

  -- Trigger op zowel artikelnr- als te_leveren-wijziging
  IF TG_OP = 'INSERT' OR
     OLD.artikelnr IS DISTINCT FROM NEW.artikelnr OR
     OLD.te_leveren IS DISTINCT FROM NEW.te_leveren OR
     OLD.is_maatwerk IS DISTINCT FROM NEW.is_maatwerk THEN
    PERFORM herallocateer_orderregel(NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservering_orderregel ON order_regels;  -- legacy
DROP TRIGGER IF EXISTS update_reservering_bij_order_regel ON order_regels;  -- legacy alt naam
DROP TRIGGER IF EXISTS trg_orderregel_herallocateer ON order_regels;
CREATE TRIGGER trg_orderregel_herallocateer
  AFTER INSERT OR UPDATE OR DELETE ON order_regels
  FOR EACH ROW EXECUTE FUNCTION trg_orderregel_herallocateer();

-- ============================================================================
-- B. Trigger op orders: bij statuswissel → her-alloceer per regel
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_order_status_herallocateer()
RETURNS TRIGGER AS $$
DECLARE
  v_regel_id BIGINT;
BEGIN
  -- Alleen reageren als status van/naar Geannuleerd/Verzonden gaat
  IF (OLD.status NOT IN ('Geannuleerd','Verzonden') AND NEW.status IN ('Geannuleerd','Verzonden')) OR
     (OLD.status IN ('Geannuleerd','Verzonden') AND NEW.status NOT IN ('Geannuleerd','Verzonden')) THEN
    FOR v_regel_id IN
      SELECT id FROM order_regels WHERE order_id = NEW.id
    LOOP
      PERFORM herallocateer_orderregel(v_regel_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservering_order_status ON orders;  -- legacy
DROP TRIGGER IF EXISTS update_reservering_bij_order_status ON orders;  -- legacy alt naam
DROP TRIGGER IF EXISTS trg_order_status_herallocateer ON orders;
CREATE TRIGGER trg_order_status_herallocateer
  AFTER UPDATE ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_order_status_herallocateer();

-- ============================================================================
-- C. Trigger op order_reserveringen: synchroniseer producten.gereserveerd
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_reservering_sync_producten()
RETURNS TRIGGER AS $$
DECLARE
  v_artikelnr_new TEXT;
  v_artikelnr_old TEXT;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT artikelnr INTO v_artikelnr_new FROM order_regels WHERE id = NEW.order_regel_id;
    IF v_artikelnr_new IS NOT NULL THEN
      PERFORM herbereken_product_reservering(v_artikelnr_new);
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT artikelnr INTO v_artikelnr_old FROM order_regels WHERE id = OLD.order_regel_id;
    IF v_artikelnr_old IS NOT NULL AND v_artikelnr_old IS DISTINCT FROM v_artikelnr_new THEN
      PERFORM herbereken_product_reservering(v_artikelnr_old);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservering_sync_producten ON order_reserveringen;
CREATE TRIGGER trg_reservering_sync_producten
  AFTER INSERT OR UPDATE OR DELETE ON order_reserveringen
  FOR EACH ROW EXECUTE FUNCTION trg_reservering_sync_producten();
