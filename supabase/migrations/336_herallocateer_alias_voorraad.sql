-- Mig 336: herallocateer_orderregel — alias voorraad vóór IO
--
-- Probleem: allocator sloeg bij eigen-voorraad-tekort direct over naar IO-claims,
-- ook als er uitwisselbaar alias-voorraad beschikbaar was.
-- Resultaat: orderregel toonde "Op inkooporder INK-xxxx wk yy" terwijl omstickering
-- van een alias product directe levering had kunnen opleveren.
--
-- Oplossing: nieuw stap 1.5 in herallocateer_orderregel:
--   1.  Eigen voorraad (ongewijzigd)
--   1.5 Alias voorraad (zelfde collectie + kleur_code, andere kwaliteit)  ← nieuw
--   2.  IO eigen artikel (ongewijzigd)
--
-- Alias-claims zijn is_handmatig=FALSE zodat ze bij herberekening netjes gereleased
-- en opnieuw bepaald worden — consistent met het overige auto-allocatie gedrag.
-- fysiek_artikelnr = alias_artikelnr zodat alias-voorraad correct gereserveerd wordt.
--
-- Handmatige (is_handmatig=TRUE) uitwisselbaar-claims blijven voorrang houden:
-- die zijn al afgetrokken van v_resterend vóórdat stap 1.5 loopt.

CREATE OR REPLACE FUNCTION herallocateer_orderregel(p_order_regel_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_artikelnr         TEXT;
  v_kleur_code        TEXT;
  v_collectie_id      INTEGER;
  v_breedte_cm        INTEGER;
  v_lengte_cm         INTEGER;
  v_te_leveren        INTEGER;
  v_is_maatwerk       BOOLEAN;
  v_order_id          BIGINT;
  v_order_status      order_status;
  v_voorraad_beschikbaar INTEGER;
  v_op_voorraad       INTEGER;
  v_resterend         INTEGER;
  v_handmatig_totaal  INTEGER;
  v_alias             RECORD;
  v_alias_beschikbaar INTEGER;
  v_alias_alloc       INTEGER;
  v_io                RECORD;
  v_io_ruimte         INTEGER;
  v_alloc             INTEGER;
BEGIN
  SELECT artikelnr, te_leveren, is_maatwerk, order_id
    INTO v_artikelnr, v_te_leveren, v_is_maatwerk, v_order_id
  FROM order_regels WHERE id = p_order_regel_id;

  IF v_order_id IS NULL THEN RETURN; END IF;

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

  -- Lock + release alleen NIET-handmatige claims
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

  -- Stap 1: eigen voorraad
  v_voorraad_beschikbaar := voorraad_beschikbaar_voor_artikel(v_artikelnr, p_order_regel_id);
  v_op_voorraad := LEAST(v_resterend, v_voorraad_beschikbaar);

  IF v_op_voorraad > 0 THEN
    INSERT INTO order_reserveringen (order_regel_id, bron, aantal, fysiek_artikelnr)
    VALUES (p_order_regel_id, 'voorraad', v_op_voorraad, v_artikelnr);
  END IF;

  v_resterend := v_resterend - v_op_voorraad;

  -- Stap 1.5: alias voorraad (zelfde collectie + kleur_code, andere kwaliteit)
  -- Alleen als er nog tekort is EN het eigen artikel in een collectie zit.
  IF v_resterend > 0 THEN
    -- Haal collectie_id + kleur_code + maat van het eigen artikel op
    SELECT p.kleur_code, k.collectie_id, p.breedte_cm, p.lengte_cm
      INTO v_kleur_code, v_collectie_id, v_breedte_cm, v_lengte_cm
    FROM producten p
    LEFT JOIN kwaliteiten k ON k.code = p.kwaliteit_code
    WHERE p.artikelnr = v_artikelnr;

    IF v_collectie_id IS NOT NULL AND v_kleur_code IS NOT NULL THEN
      -- Loop over alias-producten: zelfde collectie + kleur + maat, vrije_voorraad > 0
      -- Sorteren op vrije_voorraad DESC zodat grootste voorraad eerst wordt aangesproken
      FOR v_alias IN
        SELECT p.artikelnr
          FROM producten p
          JOIN kwaliteiten k ON k.code = p.kwaliteit_code
         WHERE k.collectie_id = v_collectie_id
           AND p.kleur_code    = v_kleur_code
           AND p.breedte_cm    = v_breedte_cm
           AND p.lengte_cm     = v_lengte_cm
           AND p.artikelnr    <> v_artikelnr
           AND p.actief        = true
           AND p.vrije_voorraad > 0
         ORDER BY p.vrije_voorraad DESC, p.artikelnr ASC
      LOOP
        EXIT WHEN v_resterend <= 0;
        v_alias_beschikbaar := voorraad_beschikbaar_voor_artikel(v_alias.artikelnr, p_order_regel_id);
        v_alias_alloc := LEAST(v_resterend, v_alias_beschikbaar);
        IF v_alias_alloc > 0 THEN
          INSERT INTO order_reserveringen (order_regel_id, bron, aantal, fysiek_artikelnr, is_handmatig)
          VALUES (p_order_regel_id, 'voorraad', v_alias_alloc, v_alias.artikelnr, false);
          v_resterend := v_resterend - v_alias_alloc;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Stap 2: IO-claims eigen artikel op oudste verwacht_datum eerst
  IF v_resterend > 0 THEN
    FOR v_io IN
      SELECT ir.id, io.verwacht_datum
        FROM inkooporder_regels ir
        JOIN inkooporders io ON io.id = ir.inkooporder_id
       WHERE ir.artikelnr = v_artikelnr
         AND ir.eenheid   = 'stuks'
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
  'Idempotent: release niet-handmatige claims + alloceer opnieuw: '
  '(1) eigen voorraad → (1.5) alias voorraad (zelfde collectie+kleur, mig 336) → (2) eigen IO. '
  'Handmatige uitwisselbaar-claims (is_handmatig=true) blijven staan. '
  'Sluit maatwerk-regels uit. Migraties 145, 154, 336.';
