-- Migration 318: Supplier ETA Portal
--
-- 1. leveranciers.portal_token     — unieke UUID per leverancier voor publieke link
-- 2. inkooporder_regels.verwacht_datum   — per-regel ETA (overschrijft order-niveau datum)
-- 3. inkooporder_regels.eta_bijgewerkt_door — 'karpi' of 'leverancier'
-- 4. inkooporder_regels.eta_bijgewerkt_op  — timestamp van laatste ETA-wijziging
-- 5. inkooporder_regels.leverancier_notitie — vrij tekstveld voor leverancier
-- 6. openstaande_inkooporder_regels view: COALESCE(r.verwacht_datum, o.verwacht_datum)
-- 7. herallocateer_orderregel: idem COALESCE voor IO-volgorde
-- 8. RPC update_regel_eta — updatepunt voor zowel intern als supplier-portal edge-fn

-- ── 1. portal_token op leveranciers ─────────────────────────────────────────

ALTER TABLE leveranciers
  ADD COLUMN IF NOT EXISTS portal_token UUID DEFAULT gen_random_uuid() UNIQUE;

-- Backfill bestaande leveranciers die NULL zouden kunnen hebben (defensief)
UPDATE leveranciers SET portal_token = gen_random_uuid() WHERE portal_token IS NULL;

-- ── 2-5. ETA-velden op inkooporder_regels ────────────────────────────────────

ALTER TABLE inkooporder_regels
  ADD COLUMN IF NOT EXISTS verwacht_datum      DATE,
  ADD COLUMN IF NOT EXISTS eta_bijgewerkt_door TEXT CHECK (eta_bijgewerkt_door IN ('karpi', 'leverancier')),
  ADD COLUMN IF NOT EXISTS eta_bijgewerkt_op   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS leverancier_notitie TEXT;

-- Pre-fill verwacht_datum vanuit parent inkooporder zodat bestaande data consistent is
UPDATE inkooporder_regels r
SET verwacht_datum = o.verwacht_datum
FROM inkooporders o
WHERE r.inkooporder_id = o.id
  AND o.verwacht_datum IS NOT NULL
  AND r.verwacht_datum IS NULL;

-- ── 6. openstaande_inkooporder_regels: per-regel datum heeft prioriteit ──────
-- Bestaande kolommen NIET verplaatsen — PostgreSQL CREATE OR REPLACE VIEW staat
-- dit niet toe. Nieuwe kolommen worden achteraan toegevoegd.

CREATE OR REPLACE VIEW openstaande_inkooporder_regels AS
SELECT
  r.id AS regel_id,
  r.inkooporder_id,
  o.inkooporder_nr,
  o.oud_inkooporder_nr,
  o.status AS order_status,
  o.besteldatum,
  o.leverweek,
  COALESCE(r.verwacht_datum, o.verwacht_datum) AS verwacht_datum,  -- per-regel ETA heeft prioriteit
  l.id AS leverancier_id,
  l.leverancier_nr,
  l.naam AS leverancier_naam,
  l.woonplaats AS leverancier_woonplaats,
  r.regelnummer,
  r.artikelnr,
  r.artikel_omschrijving,
  r.karpi_code,
  p.kwaliteit_code,
  p.kleur_code,
  p.omschrijving AS product_omschrijving,
  r.inkoopprijs_eur,
  r.besteld_m,
  r.geleverd_m,
  r.te_leveren_m,
  r.status_excel,
  -- Nieuwe kolommen achteraan (mig 318)
  r.eta_bijgewerkt_door,
  r.eta_bijgewerkt_op,
  r.leverancier_notitie,
  r.verwacht_datum       AS regel_verwacht_datum,  -- alleen de regel-eigen datum (NULL = volgt order)
  o.verwacht_datum       AS order_verwacht_datum   -- de order-niveau datum
FROM inkooporder_regels r
JOIN inkooporders o ON o.id = r.inkooporder_id
LEFT JOIN leveranciers l ON l.id = o.leverancier_id
LEFT JOIN producten p ON p.artikelnr = r.artikelnr
WHERE r.te_leveren_m > 0
  AND o.status IN ('Concept', 'Besteld', 'Deels ontvangen');

-- ── 7. herallocateer_orderregel: COALESCE voor IO-volgorde ───────────────────
-- Exacte kopie van mig 297 met één wijziging: STAP 3 + swap-fase gebruiken
-- nu COALESCE(ir.verwacht_datum, io.verwacht_datum) zodat per-regel ETA
-- (ingesteld via leverancier-portal of intern) de allocatievolgorde bepaalt.

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
  v_buffer_dagen INTEGER;
  v_swap_kandidaat RECORD;
  v_swap_io RECORD;
  v_swap_io_id BIGINT;
  v_swap_io_verwacht DATE;
  v_swap_aantal INTEGER;
  v_a_claim_resterend INTEGER;
BEGIN
  -- Lees orderregel
  SELECT artikelnr, te_leveren, is_maatwerk, order_id
    INTO v_artikelnr, v_te_leveren, v_is_maatwerk, v_order_id
  FROM order_regels WHERE id = p_order_regel_id;

  IF v_order_id IS NULL THEN
    RETURN;
  END IF;

  IF v_artikelnr IS NULL OR COALESCE(v_is_maatwerk, false) = true OR COALESCE(v_te_leveren, 0) <= 0 THEN
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

  -- LOCK-VOLGORDE STAP 1: target-orderregel-claims eerst
  PERFORM 1 FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false
   FOR UPDATE;

  -- Release niet-handmatige claims voor de target-orderregel
  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false;

  -- Handmatige claims blijven staan en tellen mee in resterend te dekken
  SELECT COALESCE(SUM(aantal), 0)
    INTO v_handmatig_totaal
   FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = true;

  v_resterend := GREATEST(0, v_te_leveren - v_handmatig_totaal);

  -- ===========================================================================
  -- STAP 1: Voorraad eigen artikel
  -- ===========================================================================
  v_voorraad_beschikbaar := voorraad_beschikbaar_voor_artikel(v_artikelnr, p_order_regel_id);
  v_op_voorraad := LEAST(v_resterend, v_voorraad_beschikbaar);

  IF v_op_voorraad > 0 THEN
    INSERT INTO order_reserveringen (order_regel_id, bron, aantal, fysiek_artikelnr)
    VALUES (p_order_regel_id, 'voorraad', v_op_voorraad, v_artikelnr);
  END IF;

  v_resterend := v_resterend - v_op_voorraad;

  -- ===========================================================================
  -- STAP 2: Swap-fase (ADR-0027)
  -- ===========================================================================
  IF v_resterend > 0 THEN
    SELECT COALESCE((waarde->>'inkoop_buffer_weken_vast')::INTEGER, 1) * 7
      INTO v_buffer_dagen
    FROM app_config WHERE sleutel = 'order_config';
    v_buffer_dagen := COALESCE(v_buffer_dagen, 7);

    LOOP
      EXIT WHEN v_resterend <= 0;

      v_swap_kandidaat := NULL;
      SELECT r.id           AS claim_id,
             r.order_regel_id AS a_orderregel_id,
             r.aantal       AS claim_aantal,
             oreg.order_id  AS a_order_id,
             o.afleverdatum AS a_afleverdatum
        INTO v_swap_kandidaat
        FROM order_reserveringen r
        JOIN order_regels oreg ON oreg.id = r.order_regel_id
        JOIN orders o          ON o.id = oreg.order_id
       WHERE r.bron = 'voorraad'
         AND r.status = 'actief'
         AND r.fysiek_artikelnr = v_artikelnr
         AND r.order_regel_id <> p_order_regel_id
         AND COALESCE(r.is_handmatig, false) = false
         AND o.status NOT IN ('Verzonden', 'Geannuleerd')
         AND o.afleverdatum IS NOT NULL
         AND o.standaard_afleverdatum_berekend IS NOT NULL
         AND o.afleverdatum > o.standaard_afleverdatum_berekend
         AND NOT EXISTS (
           SELECT 1 FROM order_reserveringen r2
            WHERE r2.order_regel_id = r.order_regel_id
              AND r2.status = 'actief'
              AND r2.bron = 'inkooporder_regel'
         )
       ORDER BY o.afleverdatum DESC, oreg.id ASC
       LIMIT 1;

      EXIT WHEN NOT FOUND;

      -- Zoek laatst-passende IO voor A — gebruik per-regel ETA (mig 318)
      v_swap_io_id := NULL;
      v_swap_io_verwacht := NULL;
      FOR v_swap_io IN
        SELECT ir.id AS ir_id,
               COALESCE(ir.verwacht_datum, io.verwacht_datum) AS verwacht_datum
          FROM inkooporder_regels ir
          JOIN inkooporders io ON io.id = ir.inkooporder_id
         WHERE ir.artikelnr = v_artikelnr
           AND ir.eenheid = 'stuks'
           AND io.status IN ('Besteld', 'Deels ontvangen')
           AND COALESCE(ir.verwacht_datum, io.verwacht_datum) IS NOT NULL
           AND (COALESCE(ir.verwacht_datum, io.verwacht_datum) + v_buffer_dagen) <= v_swap_kandidaat.a_afleverdatum
         ORDER BY COALESCE(ir.verwacht_datum, io.verwacht_datum) DESC, ir.id ASC
      LOOP
        IF io_regel_ruimte(v_swap_io.ir_id) > 0 THEN
          v_swap_io_id := v_swap_io.ir_id;
          v_swap_io_verwacht := v_swap_io.verwacht_datum;
          EXIT;
        END IF;
      END LOOP;

      EXIT WHEN v_swap_io_id IS NULL;

      -- LOCK-VOLGORDE STAP 2: swap-bron-claim FOR UPDATE
      SELECT aantal INTO v_a_claim_resterend
        FROM order_reserveringen
       WHERE id = v_swap_kandidaat.claim_id
         AND status = 'actief'
       FOR UPDATE;

      IF v_a_claim_resterend IS NULL OR v_a_claim_resterend <= 0 THEN
        CONTINUE;
      END IF;

      v_swap_aantal := LEAST(
        v_a_claim_resterend,
        v_resterend,
        io_regel_ruimte(v_swap_io_id)
      );

      EXIT WHEN v_swap_aantal <= 0;

      IF v_swap_aantal >= v_a_claim_resterend THEN
        UPDATE order_reserveringen
           SET status = 'released', updated_at = now()
         WHERE id = v_swap_kandidaat.claim_id;
      ELSE
        UPDATE order_reserveringen
           SET aantal = aantal - v_swap_aantal, updated_at = now()
         WHERE id = v_swap_kandidaat.claim_id;
      END IF;

      INSERT INTO order_reserveringen
        (order_regel_id, bron, inkooporder_regel_id, aantal, fysiek_artikelnr)
      VALUES
        (v_swap_kandidaat.a_orderregel_id, 'inkooporder_regel', v_swap_io_id, v_swap_aantal, v_artikelnr);

      INSERT INTO order_reserveringen
        (order_regel_id, bron, aantal, fysiek_artikelnr)
      VALUES
        (p_order_regel_id, 'voorraad', v_swap_aantal, v_artikelnr);

      INSERT INTO order_events (order_id, event_type, status_na, metadata)
      VALUES (
        v_swap_kandidaat.a_order_id,
        'claim_geswapt_weg',
        (SELECT status FROM orders WHERE id = v_swap_kandidaat.a_order_id),
        jsonb_build_object(
          'naar_order_id', v_order_id,
          'orderregel_id', v_swap_kandidaat.a_orderregel_id,
          'aantal', v_swap_aantal,
          'oude_bron', 'voorraad',
          'nieuwe_bron', 'inkooporder_regel',
          'io_regel_id', v_swap_io_id,
          'io_verwacht_datum', v_swap_io_verwacht,
          'fysiek_artikelnr', v_artikelnr,
          'adr', '0027',
          'migratie', 318
        )
      );

      INSERT INTO order_events (order_id, event_type, status_na, metadata)
      VALUES (
        v_order_id,
        'claim_geswapt_naar',
        (SELECT status FROM orders WHERE id = v_order_id),
        jsonb_build_object(
          'van_order_id', v_swap_kandidaat.a_order_id,
          'orderregel_id', p_order_regel_id,
          'aantal', v_swap_aantal,
          'bron', 'voorraad',
          'fysiek_artikelnr', v_artikelnr,
          'adr', '0027',
          'migratie', 318
        )
      );

      PERFORM herwaardeer_order_status(v_swap_kandidaat.a_order_id);

      v_resterend := v_resterend - v_swap_aantal;
    END LOOP;
  END IF;

  -- ===========================================================================
  -- STAP 3: IO-claims — oudste per-regel ETA eerst (mig 318: COALESCE)
  -- ===========================================================================
  IF v_resterend > 0 THEN
    FOR v_io IN
      SELECT ir.id,
             COALESCE(ir.verwacht_datum, io.verwacht_datum) AS verwacht_datum
        FROM inkooporder_regels ir
        JOIN inkooporders io ON io.id = ir.inkooporder_id
       WHERE ir.artikelnr = v_artikelnr
         AND ir.eenheid = 'stuks'
         AND io.status IN ('Besteld', 'Deels ontvangen')
       ORDER BY COALESCE(ir.verwacht_datum, io.verwacht_datum) NULLS LAST, ir.id ASC
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
  '(voorraad eigen artikel → swap-fase ADR-0027 → IO eigen artikel). '
  'Handmatige uitwisselbaar-claims (is_handmatig=true) blijven staan en tellen mee. '
  'Mig 318: IO-volgorde gebruikt COALESCE(ir.verwacht_datum, io.verwacht_datum) '
  'zodat per-regel ETA (leverancier-portal) de allocatievolgorde bepaalt. '
  'Swap-fase: idem COALESCE zodat ook de swap-IO-selectie per-regel ETA respecteert.';

-- ── 8. RPC update_regel_eta ──────────────────────────────────────────────────
-- Gebruikt door zowel de interne Karpi-view als de supplier-portal edge function.
-- p_door: 'karpi' of 'leverancier'
-- Valideert dat de regel bij de opgegeven leverancier hoort (via p_leverancier_id of p_portal_token).

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

  UPDATE inkooporder_regels
  SET
    verwacht_datum      = p_verwacht_datum,
    eta_bijgewerkt_door = p_door,
    eta_bijgewerkt_op   = NOW(),
    leverancier_notitie = COALESCE(p_notitie, leverancier_notitie)
  WHERE id = p_regel_id;

  -- Herbereken allocaties voor orders die op deze IO-regel wachten
  -- zodat de nieuwe ETA-datum direct in de order-status reflecteert.
  PERFORM herallocateer_orderregel(or2.id)
    FROM order_reserveringen orr
    JOIN order_regels or2 ON or2.id = orr.order_regel_id
   WHERE orr.inkooporder_regel_id = p_regel_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_regel_eta IS
  'Update ETA op inkooporder_regel en herbereken afhankelijke order-allocaties. '
  'Valideert token/leverancier-eigenaarschap. Mig 318.';

NOTIFY pgrst, 'reload schema';
