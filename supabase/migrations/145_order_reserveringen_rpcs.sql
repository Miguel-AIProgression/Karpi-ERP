-- Migratie 145: RPC's voor inkoop-reserveringen
--
-- Centrale seam: herallocateer_orderregel(p_order_regel_id)
-- Idempotent. Roept zichzelf aan vanuit triggers en handmatig.
--
-- Strategie:
--   1. Sluit out: maatwerk-regels (is_maatwerk=true) en regels zonder artikelnr
--   2. Bepaal benodigd_aantal = te_leveren
--   3. Release alle bestaande actieve claims voor deze regel
--   4. Alloceer voorraad eerst (min van benodigd, beschikbaar=voorraad - andere voorraadclaims)
--   5. Resterend: alloceer over openstaande IO-regels (artikelnr-match, eenheid='stuks',
--      io.status IN ('Besteld','Deels ontvangen')) op verwacht_datum ASC
--   6. Update orders.status (Wacht op inkoop / Wacht op voorraad / Nieuw)

CREATE OR REPLACE FUNCTION iso_week_plus(p_datum DATE, p_weken INTEGER)
RETURNS TEXT AS $$
DECLARE
  v_doel DATE;
BEGIN
  IF p_datum IS NULL THEN RETURN NULL; END IF;
  v_doel := p_datum + (COALESCE(p_weken, 0) * 7);
  RETURN to_char(v_doel, 'IYYY-"W"IW');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION iso_week_plus IS
  'Returnt ISO-week-string (YYYY-Www) van p_datum + p_weken. NULL-safe.';

-- ============================================================================
-- Helper: voorraad beschikbaar voor allocatie aan deze orderregel
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

  SELECT COALESCE(SUM(r.aantal), 0)
  INTO v_voorraad_geclaimd
  FROM order_reserveringen r
  JOIN order_regels oreg ON oreg.id = r.order_regel_id
  WHERE oreg.artikelnr = p_artikelnr
    AND r.bron = 'voorraad'
    AND r.status = 'actief'
    AND r.order_regel_id <> p_excl_order_regel_id;

  RETURN GREATEST(0, COALESCE(v_voorraad, 0) - v_voorraad_geclaimd);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Helper: ruimte beschikbaar op een IO-regel (FLOOR(te_leveren_m) − reeds geclaimd)
--    Alleen voor eenheid='stuks' (V1-scope).
-- ============================================================================
CREATE OR REPLACE FUNCTION io_regel_ruimte(p_io_regel_id BIGINT)
RETURNS INTEGER AS $$
DECLARE
  v_te_leveren NUMERIC;
  v_eenheid TEXT;
  v_geclaimd INTEGER;
BEGIN
  SELECT te_leveren_m, eenheid INTO v_te_leveren, v_eenheid
  FROM inkooporder_regels WHERE id = p_io_regel_id;

  IF v_eenheid IS DISTINCT FROM 'stuks' THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(aantal), 0) INTO v_geclaimd
  FROM order_reserveringen
  WHERE inkooporder_regel_id = p_io_regel_id
    AND bron = 'inkooporder_regel'
    AND status = 'actief';

  RETURN GREATEST(0, FLOOR(COALESCE(v_te_leveren, 0))::INTEGER - v_geclaimd);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Helper: orderstatus na claim-wissel herwaarderen
-- ============================================================================
CREATE OR REPLACE FUNCTION herwaardeer_order_status(p_order_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_huidige order_status;
  v_heeft_io_claim BOOLEAN;
  v_heeft_tekort BOOLEAN;
BEGIN
  SELECT status INTO v_huidige FROM orders WHERE id = p_order_id;

  -- Eindstatussen / actieve productie/picking niet aanraken
  IF v_huidige IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending',
                   'In productie', 'In snijplan', 'Deels gereed',
                   'Wacht op picken') THEN
    RETURN;
  END IF;

  -- Heeft de order ≥1 actieve IO-claim?
  SELECT EXISTS (
    SELECT 1 FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    WHERE oreg.order_id = p_order_id
      AND r.bron = 'inkooporder_regel'
      AND r.status = 'actief'
  ) INTO v_heeft_io_claim;

  -- Heeft de order regels met onvoldoende dekking (rest-saldo > 0)?
  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = false
      AND oreg.artikelnr IS NOT NULL
      AND oreg.te_leveren > COALESCE((
        SELECT SUM(aantal) FROM order_reserveringen r
        WHERE r.order_regel_id = oreg.id AND r.status = 'actief'
      ), 0)
  ) INTO v_heeft_tekort;

  IF v_heeft_io_claim THEN
    UPDATE orders SET status = 'Wacht op inkoop'
     WHERE id = p_order_id AND status <> 'Wacht op inkoop';
  ELSIF v_heeft_tekort THEN
    UPDATE orders SET status = 'Wacht op voorraad'
     WHERE id = p_order_id AND status <> 'Wacht op voorraad';
  ELSE
    -- Volledig gedekt op voorraad → 'Nieuw' tenzij al een verdere status
    UPDATE orders SET status = 'Nieuw'
     WHERE id = p_order_id AND status IN ('Wacht op inkoop', 'Wacht op voorraad');
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herwaardeer_order_status IS
  'Herwaardeer orders.status op basis van claim-staat: Wacht op inkoop > Wacht op voorraad > Nieuw. '
  'Eindstatussen en actieve productie/picking blijven ongewijzigd. Migratie 145.';

-- ============================================================================
-- Centrale RPC: herallocateer_orderregel
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
  v_io RECORD;
  v_io_ruimte INTEGER;
  v_alloc INTEGER;
BEGIN
  -- Lees orderregel
  SELECT artikelnr, te_leveren, is_maatwerk, order_id
    INTO v_artikelnr, v_te_leveren, v_is_maatwerk, v_order_id
  FROM order_regels WHERE id = p_order_regel_id;

  IF v_order_id IS NULL THEN
    -- Regel bestaat niet (kan na DELETE-cascade gebeuren)
    RETURN;
  END IF;

  IF v_artikelnr IS NULL OR COALESCE(v_is_maatwerk, false) = true OR COALESCE(v_te_leveren, 0) <= 0 THEN
    -- Maatwerk of zonder artikelnr: release alle claims, doe verder niets
    UPDATE order_reserveringen
       SET status = 'released', updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  -- Lees order-status; alloceer alleen voor open orders
  SELECT status INTO v_order_status FROM orders WHERE id = v_order_id;
  IF v_order_status IN ('Verzonden', 'Geannuleerd') THEN
    UPDATE order_reserveringen
       SET status = 'released', updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  -- Lock orderregel-claims atomair
  PERFORM 1 FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id AND status = 'actief'
   FOR UPDATE;

  -- Release alle bestaande actieve claims (we beginnen schoon)
  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id AND status = 'actief';

  -- 1) Voorraad-claim
  v_voorraad_beschikbaar := voorraad_beschikbaar_voor_artikel(v_artikelnr, p_order_regel_id);
  v_op_voorraad := LEAST(v_te_leveren, v_voorraad_beschikbaar);

  IF v_op_voorraad > 0 THEN
    INSERT INTO order_reserveringen (order_regel_id, bron, aantal)
    VALUES (p_order_regel_id, 'voorraad', v_op_voorraad);
  END IF;

  v_resterend := v_te_leveren - v_op_voorraad;

  -- 2) IO-claims op oudste verwacht_datum eerst
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
        INSERT INTO order_reserveringen (order_regel_id, bron, inkooporder_regel_id, aantal)
        VALUES (p_order_regel_id, 'inkooporder_regel', v_io.id, v_alloc);
        v_resterend := v_resterend - v_alloc;
      END IF;
    END LOOP;
  END IF;

  -- v_resterend > 0 betekent: tekort niet volledig gedekt → "Wacht op nieuwe inkoop"
  -- Geen extra rij; herwaardeer_order_status leest dat aan rest-saldo af.

  PERFORM herwaardeer_order_status(v_order_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herallocateer_orderregel IS
  'Idempotent: release alle actieve claims voor orderregel + alloceer opnieuw '
  '(voorraad-eerst, dan oudste IO). Sluit maatwerk-regels uit. Migratie 145.';

-- ============================================================================
-- Helper: release alle claims voor een IO-regel (annulering / vertraging)
-- ============================================================================
CREATE OR REPLACE FUNCTION release_claims_voor_io_regel(p_io_regel_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_orderregel_id BIGINT;
BEGIN
  FOR v_orderregel_id IN
    SELECT DISTINCT order_regel_id FROM order_reserveringen
     WHERE inkooporder_regel_id = p_io_regel_id
       AND bron = 'inkooporder_regel'
       AND status = 'actief'
  LOOP
    PERFORM herallocateer_orderregel(v_orderregel_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION release_claims_voor_io_regel IS
  'Bij IO-regel annulering of -wijziging: alle orderregels met claim op deze IO '
  'worden opnieuw gealloceerd (kunnen "Wacht op nieuwe inkoop" worden). Migratie 145.';
