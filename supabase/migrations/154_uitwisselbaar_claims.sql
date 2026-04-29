-- Migratie 154: per-claim uitwisselbaar — multi-source allocatie binnen één orderregel
--
-- Use-case: 1 orderregel CISCO 200×290 aantal=9 wil 2× CISCO voorraad + 5×
-- VELVET TOUCH (omgestickerd) + 2× CISCO inkoop. Eén orderregel met meerdere
-- voorraad-bronnen, factuur en order-display blijven 1× "CISCO 9 stuks".
--
-- Schema-uitbreiding:
--   - `fysiek_artikelnr TEXT` op order_reserveringen — wat fysiek wordt
--     afgenomen (NULL = same als orderregel.artikelnr; trigger vult automatisch).
--   - `is_handmatig BOOLEAN` — true = door gebruiker gekozen uitwisselbaar
--     allocatie, allocator respecteert deze (geen release).
--
-- Allocator-update:
--   `herallocateer_orderregel` releaset alleen NIET-handmatige claims.
--   Resterend te dekken = te_leveren - SUM(handmatige claims).
--   Daarna: voorraad eigen artikel + IO eigen artikel zoals voorheen.
--
-- Voorraad-impact:
--   `herbereken_product_reservering` telt nu op `fysiek_artikelnr` ipv
--   orderregel.artikelnr. Een handmatige VELVET-claim onder een CISCO-regel
--   reserveert dus VELVET-voorraad correct.
--
-- Idempotent.

-- ============================================================================
-- 1. Schema-uitbreiding
-- ============================================================================
ALTER TABLE order_reserveringen
  ADD COLUMN IF NOT EXISTS fysiek_artikelnr TEXT,
  ADD COLUMN IF NOT EXISTS is_handmatig BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN order_reserveringen.fysiek_artikelnr IS
  'Wat fysiek wordt afgenomen uit voorraad. NULL → same als order_regels.artikelnr (trigger vult). '
  'Bij uitwisselbaar/omstickeren-claim wijst naar het uitwisselbaar artikel. Migratie 154.';

COMMENT ON COLUMN order_reserveringen.is_handmatig IS
  'true = gebruiker-gekozen claim (uitwisselbaar) die allocator niet automatisch mag releasen. '
  'Migratie 154.';

-- ============================================================================
-- 2. BEFORE INSERT/UPDATE trigger: vul fysiek_artikelnr default uit orderregel
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_default_fysiek_artikelnr()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.fysiek_artikelnr IS NULL THEN
    SELECT artikelnr INTO NEW.fysiek_artikelnr
    FROM order_regels WHERE id = NEW.order_regel_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_default_fysiek_artikelnr ON order_reserveringen;
CREATE TRIGGER trg_default_fysiek_artikelnr
  BEFORE INSERT OR UPDATE ON order_reserveringen
  FOR EACH ROW EXECUTE FUNCTION trg_default_fysiek_artikelnr();

-- ============================================================================
-- 3. Backfill bestaande rijen: fysiek_artikelnr = orderregel.artikelnr
-- ============================================================================
UPDATE order_reserveringen r
   SET fysiek_artikelnr = oreg.artikelnr
  FROM order_regels oreg
 WHERE r.order_regel_id = oreg.id
   AND r.fysiek_artikelnr IS NULL;

-- ============================================================================
-- 4. Index-update: één actieve voorraad-claim per (orderregel, fysiek_artikelnr)
-- ============================================================================
DROP INDEX IF EXISTS idx_order_reserveringen_voorraad_uniek;
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_reserveringen_voorraad_uniek
  ON order_reserveringen(order_regel_id, fysiek_artikelnr)
  WHERE bron = 'voorraad' AND status = 'actief';

-- ============================================================================
-- 5. voorraad_beschikbaar_voor_artikel: gebruik fysiek_artikelnr
-- ============================================================================
CREATE OR REPLACE FUNCTION voorraad_beschikbaar_voor_artikel(
  p_artikelnr TEXT,
  p_excl_order_regel_id BIGINT
)
RETURNS INTEGER AS $$
DECLARE
  v_voorraad INTEGER;
  v_voorraad_geclaimd INTEGER;
BEGIN
  SELECT COALESCE(voorraad, 0) - COALESCE(backorder, 0)
  INTO v_voorraad
  FROM producten WHERE artikelnr = p_artikelnr;

  -- Tel ALLE actieve voorraad-claims op dit fysiek_artikelnr (zelf + andere regels),
  -- exclusief de orderregel die nu gealloceerd wordt
  SELECT COALESCE(SUM(r.aantal), 0)
  INTO v_voorraad_geclaimd
  FROM order_reserveringen r
  WHERE r.fysiek_artikelnr = p_artikelnr
    AND r.bron = 'voorraad'
    AND r.status = 'actief'
    AND r.order_regel_id <> p_excl_order_regel_id;

  RETURN GREATEST(0, COALESCE(v_voorraad, 0) - v_voorraad_geclaimd);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 6. herallocateer_orderregel: respecteer handmatige claims
-- ============================================================================
CREATE OR REPLACE FUNCTION herallocateer_orderregel(p_order_regel_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_artikelnr TEXT;
  v_te_leveren INTEGER;
  v_is_maatwerk BOOLEAN;
  v_order_id BIGINT;
  v_order_status order_status;
  v_voorraad_beschikbaar INTEGER;
  v_op_voorraad INTEGER;
  v_resterend INTEGER;
  v_handmatig_totaal INTEGER;
  v_io RECORD;
  v_io_ruimte INTEGER;
  v_alloc INTEGER;
BEGIN
  SELECT artikelnr, te_leveren, is_maatwerk, order_id
    INTO v_artikelnr, v_te_leveren, v_is_maatwerk, v_order_id
  FROM order_regels WHERE id = p_order_regel_id;

  IF v_order_id IS NULL THEN
    RETURN;
  END IF;

  IF v_artikelnr IS NULL OR COALESCE(v_is_maatwerk, false) = true OR COALESCE(v_te_leveren, 0) <= 0 THEN
    -- Maatwerk of zonder artikelnr: release ALLE claims (incl. handmatige)
    UPDATE order_reserveringen
       SET status = 'released', updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  SELECT status INTO v_order_status FROM orders WHERE id = v_order_id;
  IF v_order_status IN ('Verzonden', 'Geannuleerd') THEN
    UPDATE order_reserveringen
       SET status = 'released', updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  -- Lock + release alleen NIET-handmatige claims (handmatige blijven staan)
  PERFORM 1 FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false
   FOR UPDATE;

  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false;

  -- Resterend te dekken na handmatige claims
  SELECT COALESCE(SUM(aantal), 0)
    INTO v_handmatig_totaal
   FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = true;

  v_resterend := GREATEST(0, v_te_leveren - v_handmatig_totaal);

  -- 1) Voorraad eigen artikel
  v_voorraad_beschikbaar := voorraad_beschikbaar_voor_artikel(v_artikelnr, p_order_regel_id);
  v_op_voorraad := LEAST(v_resterend, v_voorraad_beschikbaar);

  IF v_op_voorraad > 0 THEN
    INSERT INTO order_reserveringen (order_regel_id, bron, aantal, fysiek_artikelnr)
    VALUES (p_order_regel_id, 'voorraad', v_op_voorraad, v_artikelnr);
  END IF;

  v_resterend := v_resterend - v_op_voorraad;

  -- 2) IO-claims op oudste verwacht_datum eerst (eigen artikel)
  IF v_resterend > 0 THEN
    FOR v_io IN
      SELECT ir.id, io.verwacht_datum
        FROM inkooporder_regels ir
        JOIN inkooporders io ON io.id = ir.inkooporder_id
       WHERE ir.artikelnr = v_artikelnr
         AND ir.eenheid = 'stuks'
         AND io.status IN ('Besteld', 'Deels ontvangen')
       ORDER BY io.verwacht_datum NULLS LAST, ir.id ASC
    LOOP
      EXIT WHEN v_resterend <= 0;
      v_io_ruimte := io_regel_ruimte(v_io.id);
      v_alloc := LEAST(v_resterend, v_io_ruimte);
      IF v_alloc > 0 THEN
        INSERT INTO order_reserveringen (order_regel_id, bron, inkooporder_regel_id, aantal, fysiek_artikelnr)
        VALUES (p_order_regel_id, 'inkooporder_regel', v_io.id, v_alloc, v_artikelnr);
        v_resterend := v_resterend - v_alloc;
      END IF;
    END LOOP;
  END IF;

  PERFORM herwaardeer_order_status(v_order_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herallocateer_orderregel IS
  'Idempotent: release niet-handmatige claims + alloceer opnieuw '
  '(voorraad eigen artikel → IO eigen artikel). Handmatige uitwisselbaar-claims '
  '(is_handmatig=true) blijven staan en tellen mee in resterend te dekken. '
  'Sluit maatwerk-regels uit. Migratie 154 (was 145).';

-- ============================================================================
-- 7. herbereken_product_reservering: tel op fysiek_artikelnr
-- ============================================================================
CREATE OR REPLACE FUNCTION herbereken_product_reservering(p_artikelnr TEXT)
RETURNS VOID AS $$
DECLARE
  v_gereserveerd INTEGER;
BEGIN
  PERFORM 1 FROM producten WHERE artikelnr = p_artikelnr FOR UPDATE;

  SELECT COALESCE(SUM(r.aantal), 0)
  INTO v_gereserveerd
  FROM order_reserveringen r
  JOIN order_regels oreg ON oreg.id = r.order_regel_id
  JOIN orders o ON o.id = oreg.order_id
  WHERE r.fysiek_artikelnr = p_artikelnr   -- <-- per fysiek_artikelnr (mig 154)
    AND r.bron = 'voorraad'
    AND r.status = 'actief'
    AND o.status NOT IN ('Verzonden', 'Geannuleerd');

  UPDATE producten
  SET gereserveerd = v_gereserveerd,
      vrije_voorraad = COALESCE(voorraad, 0) - v_gereserveerd - COALESCE(backorder, 0)
  WHERE artikelnr = p_artikelnr;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herbereken_product_reservering IS
  'Migratie 154: gereserveerd = SUM order_reserveringen waar bron=voorraad EN '
  'fysiek_artikelnr=p_artikelnr (zo telt een uitwisselbaar-claim onder een '
  'andere orderregel óók mee voor het uitwisselbaar product). '
  'vrije_voorraad = voorraad − gereserveerd − backorder.';

-- ============================================================================
-- 8. trigger sync_producten: gebruik fysiek_artikelnr ipv orderregel.artikelnr
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_reservering_sync_producten()
RETURNS TRIGGER AS $$
DECLARE
  v_artikel_new TEXT;
  v_artikel_old TEXT;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    -- NEW.fysiek_artikelnr is gevuld door BEFORE-trigger trg_default_fysiek_artikelnr
    v_artikel_new := NEW.fysiek_artikelnr;
    IF v_artikel_new IS NOT NULL THEN
      PERFORM herbereken_product_reservering(v_artikel_new);
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_artikel_old := OLD.fysiek_artikelnr;
    IF v_artikel_old IS NOT NULL AND v_artikel_old IS DISTINCT FROM v_artikel_new THEN
      PERFORM herbereken_product_reservering(v_artikel_old);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 9. RPC: set_uitwisselbaar_claims — handmatige claims voor een orderregel
-- ============================================================================
CREATE OR REPLACE FUNCTION set_uitwisselbaar_claims(
  p_order_regel_id BIGINT,
  p_keuzes JSONB  -- [{"artikelnr": "...", "aantal": N}, ...]
)
RETURNS VOID AS $$
DECLARE
  v_keuze JSONB;
  v_artikelnr TEXT;
  v_aantal INTEGER;
  v_orderregel_artikelnr TEXT;
BEGIN
  SELECT artikelnr INTO v_orderregel_artikelnr
  FROM order_regels WHERE id = p_order_regel_id;

  -- Release alle bestaande HANDMATIGE claims voor deze orderregel
  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND is_handmatig = true;

  -- Maak nieuwe handmatige claims aan
  IF p_keuzes IS NOT NULL THEN
    FOR v_keuze IN SELECT * FROM jsonb_array_elements(p_keuzes) LOOP
      v_artikelnr := v_keuze->>'artikelnr';
      v_aantal := (v_keuze->>'aantal')::INTEGER;

      -- Skip eigen artikelnr (gebruik gewone allocator) en lege/0-aantallen
      IF v_artikelnr IS NULL OR v_aantal IS NULL OR v_aantal <= 0
         OR v_artikelnr = v_orderregel_artikelnr THEN
        CONTINUE;
      END IF;

      INSERT INTO order_reserveringen
        (order_regel_id, bron, aantal, fysiek_artikelnr, is_handmatig)
      VALUES
        (p_order_regel_id, 'voorraad', v_aantal, v_artikelnr, true);
    END LOOP;
  END IF;

  -- Triggert allocator voor het resterende
  PERFORM herallocateer_orderregel(p_order_regel_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_uitwisselbaar_claims IS
  'Vervangt de handmatige uitwisselbaar-claims voor een orderregel met de in '
  'p_keuzes opgegeven {artikelnr, aantal}-lijst. Roept daarna herallocateer_orderregel '
  'aan om voorraad eigen artikel + IO eigen artikel aan te vullen voor het '
  'resterende deel. Migratie 154.';

-- ============================================================================
-- 10. Recompute alle producten (fysiek_artikelnr-telling kan nieuwe waarden geven)
-- ============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT artikelnr FROM producten LOOP
    PERFORM herbereken_product_reservering(r.artikelnr);
  END LOOP;
END $$;
