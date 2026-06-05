-- Migration 319: ETA-wijziging propageert naar order-afleverdatum
--
-- Twee problemen uit mig 318:
--
-- 1. bereken_late_claim_afleverdatum las MAX(io.verwacht_datum) — de
--    inkooporders-datum.  Met per-regel ETA (inkooporder_regels.verwacht_datum)
--    moet dit MAX(COALESCE(ir.verwacht_datum, io.verwacht_datum)).
--
-- 2. sync_order_afleverdatum_met_claims schuift alleen vooruit (nooit terug).
--    Bij een ETA-vervroeging (bijv. week 25→22 door leverancier) bewoog de
--    afleverdatum niet mee. Een expliciete ETA-update IS intentioneel —
--    we voegen een bidirectionele variant toe.
--
-- Aanpak:
--   a. bereken_late_claim_afleverdatum: gebruik per-regel ETA (COALESCE).
--   b. Nieuwe functie sync_order_afleverdatum_eta(order_id):
--      herberekent + past afleverdatum toe in beide richtingen.
--      Eindstatussen (Verzonden/Geannuleerd/Klaar voor verzending) overgeslagen.
--   c. update_regel_eta (mig 318): roep sync_order_afleverdatum_eta aan voor
--      alle direct getroffen orders (actieve IO-claim op de gewijzigde regel).

-- ── a. bereken_late_claim_afleverdatum: per-regel ETA ────────────────────────

CREATE OR REPLACE FUNCTION bereken_late_claim_afleverdatum(p_order_id BIGINT)
RETURNS DATE AS $$
DECLARE
  v_buffer_dagen INTEGER;
  v_laatste_claim_datum DATE;
BEGIN
  SELECT COALESCE((waarde->>'inkoop_buffer_weken_vast')::INTEGER, 1) * 7
    INTO v_buffer_dagen
  FROM app_config WHERE sleutel = 'order_config';

  -- Per-regel ETA heeft prioriteit boven order-niveau datum (mig 319)
  SELECT MAX(COALESCE(ir.verwacht_datum, io.verwacht_datum))
    INTO v_laatste_claim_datum
  FROM order_reserveringen r
  JOIN order_regels oreg       ON oreg.id = r.order_regel_id
  JOIN inkooporder_regels ir   ON ir.id   = r.inkooporder_regel_id
  JOIN inkooporders io         ON io.id   = ir.inkooporder_id
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
  'Berekent afleverdatum op basis van de laatste actieve IO-claim '
  '(MAX(COALESCE(ir.verwacht_datum, io.verwacht_datum)) + inkoop_buffer × 7 dgn). '
  'Mig 319: per-regel ETA heeft prioriteit.';

-- ── b. sync_order_afleverdatum_eta: bidirectioneel ───────────────────────────
-- Variant van sync_order_afleverdatum_met_claims die ook terugschuift.
-- Bedoeld voor expliciete ETA-updates (leverancier-portal + intern).

CREATE OR REPLACE FUNCTION sync_order_afleverdatum_eta(p_order_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_status order_status;
  v_claim_datum DATE;
BEGIN
  SELECT status INTO v_status FROM orders WHERE id = p_order_id;

  -- Eindstatussen niet aanraken
  IF v_status IN ('Verzonden', 'Geannuleerd', 'Klaar voor verzending') THEN
    RETURN;
  END IF;

  v_claim_datum := bereken_late_claim_afleverdatum(p_order_id);
  IF v_claim_datum IS NULL THEN
    RETURN;
  END IF;

  -- Bidirectioneel: update altijd naar de nieuwe berekende datum
  UPDATE orders
     SET afleverdatum = v_claim_datum,
         week = to_char(v_claim_datum, 'IW')
   WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_order_afleverdatum_eta IS
  'Bidirectionele variant van sync_order_afleverdatum_met_claims. '
  'Gebruikt bij expliciete ETA-updates via update_regel_eta zodat '
  'een vervroeging ook terug wordt doorgezet. Mig 319.';

-- ── c. update_regel_eta: aanroep sync_order_afleverdatum_eta ─────────────────
-- Herschrijft mig 318 update_regel_eta met de extra sync-stap.

CREATE OR REPLACE FUNCTION update_regel_eta(
  p_regel_id          BIGINT,
  p_verwacht_datum    DATE,
  p_door              TEXT,         -- 'karpi' | 'leverancier'
  p_leverancier_id    BIGINT DEFAULT NULL,
  p_portal_token      UUID   DEFAULT NULL,
  p_notitie           TEXT   DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_leverancier_id BIGINT;
  v_order_id       BIGINT;
BEGIN
  -- Resolve leverancier_id vanuit token als die wordt gebruikt
  IF p_portal_token IS NOT NULL THEN
    SELECT id INTO v_leverancier_id FROM leveranciers WHERE portal_token = p_portal_token;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ongeldig portal token';
    END IF;
  ELSE
    v_leverancier_id := p_leverancier_id;
  END IF;

  -- Verificeer dat de regel bij deze leverancier hoort
  IF v_leverancier_id IS NOT NULL THEN
    PERFORM 1
      FROM inkooporder_regels r
      JOIN inkooporders o ON o.id = r.inkooporder_id
     WHERE r.id = p_regel_id
       AND o.leverancier_id = v_leverancier_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Regel % hoort niet bij leverancier %', p_regel_id, v_leverancier_id;
    END IF;
  END IF;

  IF p_door NOT IN ('karpi', 'leverancier') THEN
    RAISE EXCEPTION 'p_door moet ''karpi'' of ''leverancier'' zijn';
  END IF;

  -- Update de ETA op de inkooporder_regel
  UPDATE inkooporder_regels
  SET
    verwacht_datum      = p_verwacht_datum,
    eta_bijgewerkt_door = p_door,
    eta_bijgewerkt_op   = NOW(),
    leverancier_notitie = COALESCE(p_notitie, leverancier_notitie)
  WHERE id = p_regel_id;

  -- Propageer naar alle orderregels met een actieve IO-claim op deze IO-regel:
  -- 1. Herbereken allocaties voor de betreffende orderregel
  -- 2. Sync afleverdatum bidirectioneel (ETA + buffer) naar de order
  FOR v_order_id IN
    SELECT DISTINCT oreg.order_id
      FROM order_reserveringen r
      JOIN order_regels oreg ON oreg.id = r.order_regel_id
     WHERE r.inkooporder_regel_id = p_regel_id
       AND r.status = 'actief'
       AND r.bron = 'inkooporder_regel'
  LOOP
    -- Alleen de orderregels heralloceren die deze IO-regel claimen
    PERFORM herallocateer_orderregel(r2.order_regel_id)
      FROM order_reserveringen r2
      JOIN order_regels oreg2 ON oreg2.id = r2.order_regel_id
     WHERE r2.inkooporder_regel_id = p_regel_id
       AND r2.status = 'actief'
       AND r2.bron = 'inkooporder_regel'
       AND oreg2.order_id = v_order_id;

    -- Bidirectionele datum-sync na allocatie
    PERFORM sync_order_afleverdatum_eta(v_order_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_regel_eta IS
  'Update ETA op inkooporder_regel (mig 318) en propageert naar afleverdatum '
  'van alle getroffen orders (bidirectioneel via sync_order_afleverdatum_eta, mig 319). '
  'Valideert token/leverancier-eigenaarschap.';

NOTIFY pgrst, 'reload schema';
