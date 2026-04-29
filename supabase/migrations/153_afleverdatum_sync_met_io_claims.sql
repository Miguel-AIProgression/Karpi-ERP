-- Migratie 153: server-side afleverdatum-sync met IO-claim-leverdatum
--
-- Probleem (gevonden 2026-04-29 bij ORD-2026-2004):
--   Order had levertijd-badge "2026-W27" (uit IO-claim) maar afleverdatum
--   stond op "04-05-2026" (5 werkdagen) — inconsistentie tussen wat de klant
--   beloofd wordt op header vs orderregel-niveau.
--
-- Oplossing:
--   Helper `bereken_late_claim_afleverdatum(order_id)` rekent uit:
--     "wat is de laatste IO-claim onder deze order, geconverteerd naar
--      werkbare afleverdatum (verwacht_datum + buffer dagen)?"
--   Hij respecteert orders.lever_modus:
--     - 'in_een_keer' / NULL → max claim-leverdatum wint (één zending)
--     - 'deelleveringen'    → ook max (de afleverdatum op order-header is
--                             altijd "wanneer is de hele order af"; per-regel
--                             leverweken zijn al per regel zichtbaar)
--
--   Daarna wordt deze functie aangeroepen vanuit `herwaardeer_order_status`,
--   die op zijn beurt door alle alloc-paden wordt getriggerd. Update de
--   afleverdatum alleen als de claim-datum LATER is dan de huidige
--   (we willen geen vroege afleverdatum overschrijven die bewust handmatig
--   is gezet).
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION bereken_late_claim_afleverdatum(p_order_id BIGINT)
RETURNS DATE AS $$
DECLARE
  v_buffer_dagen INTEGER;
  v_laatste_claim_datum DATE;
BEGIN
  SELECT COALESCE((waarde->>'inkoop_buffer_weken_vast')::INTEGER, 1) * 7
    INTO v_buffer_dagen
  FROM app_config WHERE sleutel = 'order_config';

  -- Laatste verwacht_datum over alle actieve IO-claims onder deze order
  SELECT MAX(io.verwacht_datum)
    INTO v_laatste_claim_datum
  FROM order_reserveringen r
  JOIN order_regels oreg ON oreg.id = r.order_regel_id
  JOIN inkooporder_regels ir ON ir.id = r.inkooporder_regel_id
  JOIN inkooporders io        ON io.id = ir.inkooporder_id
  WHERE oreg.order_id = p_order_id
    AND r.bron = 'inkooporder_regel'
    AND r.status = 'actief';

  IF v_laatste_claim_datum IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_laatste_claim_datum + COALESCE(v_buffer_dagen, 7);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION bereken_late_claim_afleverdatum IS
  'Returnt afleverdatum voor een order op basis van de laatste actieve IO-claim '
  '(verwacht_datum + inkoop_buffer_weken_vast*7 dagen) of NULL als er geen IO-claims zijn. Migratie 153.';

-- ============================================================================
-- Helper: schuif afleverdatum vooruit naar laatste claim als die later is
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_order_afleverdatum_met_claims(p_order_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_huidige DATE;
  v_status order_status;
  v_claim_datum DATE;
BEGIN
  SELECT afleverdatum, status INTO v_huidige, v_status
  FROM orders WHERE id = p_order_id;

  -- Eindstatussen niet aanraken
  IF v_status IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending') THEN
    RETURN;
  END IF;

  v_claim_datum := bereken_late_claim_afleverdatum(p_order_id);
  IF v_claim_datum IS NULL THEN
    RETURN;
  END IF;

  -- Schuif alleen vooruit (later), nooit terug naar eerdere datum
  IF v_huidige IS NULL OR v_claim_datum > v_huidige THEN
    UPDATE orders
       SET afleverdatum = v_claim_datum,
           week = to_char(v_claim_datum, 'IW')
     WHERE id = p_order_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_order_afleverdatum_met_claims IS
  'Update orders.afleverdatum + week naar de laatste IO-claim-leverdatum als '
  'die later is dan de huidige afleverdatum. Schuift alleen vooruit, nooit terug. '
  'Eindstatussen blijven ongewijzigd. Migratie 153.';

-- ============================================================================
-- Hook in herwaardeer_order_status zodat afleverdatum elke alloc-cyclus mee-update
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
    UPDATE orders SET status = 'Nieuw'
     WHERE id = p_order_id AND status IN ('Wacht op inkoop', 'Wacht op voorraad');
  END IF;

  -- Sync afleverdatum vooruit naar laatste IO-claim-leverdatum
  PERFORM sync_order_afleverdatum_met_claims(p_order_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herwaardeer_order_status IS
  'Herwaardeer orders.status op basis van claim-staat: Wacht op inkoop > Wacht op voorraad > Nieuw. '
  'Sinds migratie 153: synct ook orders.afleverdatum + week vooruit naar de laatste '
  'IO-claim-leverdatum (alleen schuiven vooruit, nooit terug). Eindstatussen blijven ongewijzigd.';

-- ============================================================================
-- Backfill: één-malige sync over alle bestaande open orders met IO-claims
-- ============================================================================
DO $$
DECLARE
  v_order_id BIGINT;
  v_count INTEGER := 0;
BEGIN
  FOR v_order_id IN
    SELECT DISTINCT oreg.order_id
    FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    JOIN orders o ON o.id = oreg.order_id
    WHERE r.bron = 'inkooporder_regel'
      AND r.status = 'actief'
      AND o.status NOT IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending')
  LOOP
    PERFORM sync_order_afleverdatum_met_claims(v_order_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Migratie 153: afleverdatum gesynct voor % orders met IO-claims', v_count;
END $$;
