-- Migratie 148: boek_voorraad_ontvangst consumeert claims
--
-- Bestaande gedrag (migratie 127):
--   - producten.voorraad += p_aantal
--   - inkooporder_regels.geleverd_m += p_aantal, te_leveren_m herberekend
--   - inkooporders.status update Deels ontvangen / Ontvangen
--
-- Nieuw: na voorraad-bump, claims op deze IO-regel in claim_volgorde-volgorde
-- consumeren tot p_aantal op is. Geconsumeerde claim → status='geleverd' en
-- nieuwe voorraad-claim aanmaken voor dezelfde orderregel met dat aantal.
-- Producten.gereserveerd resync gebeurt via trigger C (migratie 146) zodra de
-- nieuwe voorraad-claim wordt ingevoegd.
--
-- voorraad_mutaties INSERT laten we weg: rol_id is NOT NULL voor rollen-mutaties
-- en de bestaande boek_voorraad_ontvangst (mig 127) deed dit ook niet — geen
-- regression.

CREATE OR REPLACE FUNCTION boek_voorraad_ontvangst(
  p_regel_id BIGINT,
  p_aantal INTEGER,
  p_medewerker TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
  v_order inkooporders%ROWTYPE;
  v_open_regels INTEGER;
  v_resterend INTEGER := p_aantal;
  v_claim RECORD;
  v_consume INTEGER;
  v_bestaande_voorraadclaim BIGINT;
BEGIN
  IF p_aantal IS NULL OR p_aantal <= 0 THEN
    RAISE EXCEPTION 'Aantal moet > 0 zijn';
  END IF;

  SELECT * INTO v_regel FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;

  IF v_regel.eenheid <> 'stuks' THEN
    RAISE EXCEPTION 'Regel % heeft eenheid %. Voorraad-ontvangst is alleen voor eenheid ''stuks''. Gebruik boek_ontvangst voor rollen.',
      v_regel.regelnummer, v_regel.eenheid;
  END IF;

  SELECT * INTO v_order FROM inkooporders WHERE id = v_regel.inkooporder_id FOR UPDATE;
  IF v_order.status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Order % is geannuleerd, kan geen ontvangst boeken', v_order.inkooporder_nr;
  END IF;

  -- Voorraad ophogen op het product
  IF v_regel.artikelnr IS NOT NULL THEN
    UPDATE producten
    SET voorraad = COALESCE(voorraad, 0) + p_aantal
    WHERE artikelnr = v_regel.artikelnr;
  END IF;

  -- Regel bijwerken
  UPDATE inkooporder_regels
  SET geleverd_m = geleverd_m + p_aantal,
      te_leveren_m = GREATEST(besteld_m - (geleverd_m + p_aantal), 0)
  WHERE id = p_regel_id;

  -- Consumeer claims op deze IO-regel in claim_volgorde-volgorde
  FOR v_claim IN
    SELECT id, order_regel_id, aantal
      FROM order_reserveringen
     WHERE inkooporder_regel_id = p_regel_id
       AND bron = 'inkooporder_regel'
       AND status = 'actief'
     ORDER BY claim_volgorde ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_resterend <= 0;
    v_consume := LEAST(v_claim.aantal, v_resterend);

    IF v_consume = v_claim.aantal THEN
      UPDATE order_reserveringen
         SET status = 'geleverd', geleverd_op = now(), updated_at = now()
       WHERE id = v_claim.id;
    ELSE
      UPDATE order_reserveringen
         SET aantal = aantal - v_consume, updated_at = now()
       WHERE id = v_claim.id;
    END IF;

    -- Maak/upgrade voorraad-claim voor dezelfde orderregel
    SELECT id INTO v_bestaande_voorraadclaim
      FROM order_reserveringen
     WHERE order_regel_id = v_claim.order_regel_id
       AND bron = 'voorraad'
       AND status = 'actief'
     FOR UPDATE;

    IF v_bestaande_voorraadclaim IS NOT NULL THEN
      UPDATE order_reserveringen
         SET aantal = aantal + v_consume, updated_at = now()
       WHERE id = v_bestaande_voorraadclaim;
    ELSE
      INSERT INTO order_reserveringen (order_regel_id, bron, aantal)
      VALUES (v_claim.order_regel_id, 'voorraad', v_consume);
    END IF;

    v_resterend := v_resterend - v_consume;

    -- Order-status van de bijbehorende order opnieuw waarderen
    PERFORM herwaardeer_order_status(
      (SELECT order_id FROM order_regels WHERE id = v_claim.order_regel_id)
    );
  END LOOP;

  -- IO-status update: Deels ontvangen / Ontvangen
  SELECT COUNT(*) INTO v_open_regels
  FROM inkooporder_regels
  WHERE inkooporder_id = v_order.id AND te_leveren_m > 0;

  IF v_open_regels = 0 THEN
    UPDATE inkooporders SET status = 'Ontvangen' WHERE id = v_order.id;
  ELSE
    UPDATE inkooporders SET status = 'Deels ontvangen'
    WHERE id = v_order.id AND status IN ('Concept', 'Besteld');
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION boek_voorraad_ontvangst(BIGINT, INTEGER, TEXT) IS
  'Boekt ontvangst van een inkooporder-regel met eenheid=stuks (vaste producten): '
  'verhoogt producten.voorraad met p_aantal en werkt regel + order-status bij. '
  'Sinds migratie 148: consumeert IO-claims in claim_volgorde-volgorde en '
  'verschuift naar voorraad-claims op dezelfde orderregel. Migratie 148.';
