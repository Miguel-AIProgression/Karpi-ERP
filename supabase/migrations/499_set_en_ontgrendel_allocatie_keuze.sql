-- Mig 499: set_allocatie_keuze + ontgrendel_allocatie_keuze + eenmalige
-- backfill van bestaande automatische alias/inkoop-claims.
--
-- set_allocatie_keuze vervangt voor de UITGEBREIDE keuze (3 optietypes, mig
-- 498) de smalle set_uitwisselbaar_claims (mig 154) — die laatste blijft
-- vooralsnog bestaan (geen aanroepers meer na de frontend-ombouw, opruiming
-- volgt in een latere migratie zodra dat bevestigd is) maar wordt door geen
-- enkele nieuwe call-site meer gebruikt.

CREATE OR REPLACE FUNCTION set_allocatie_keuze(p_order_regel_id BIGINT, p_keuzes JSONB)
RETURNS VOID
LANGUAGE plpgsql
AS $function$
DECLARE
  v_keuze JSONB;
  v_bron TEXT;
  v_artikelnr TEXT;
  v_io_regel_id BIGINT;
  v_aantal INTEGER;
  v_orderregel_artikelnr TEXT;
  v_order_id BIGINT;
  v_io_ruimte INTEGER;
BEGIN
  SELECT artikelnr, order_id INTO v_orderregel_artikelnr, v_order_id
    FROM order_regels WHERE id = p_order_regel_id;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Orderregel % niet gevonden', p_order_regel_id;
  END IF;

  -- Release alle actieve claims voor deze regel (handmatig én niet-handmatig)
  -- — mirrort set_uitwisselbaar_claims (mig 154/403), nu ook bron='inkooporder_regel'.
  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief';

  IF p_keuzes IS NOT NULL THEN
    FOR v_keuze IN SELECT * FROM jsonb_array_elements(p_keuzes) LOOP
      v_bron := v_keuze->>'bron';
      v_aantal := (v_keuze->>'aantal')::INTEGER;
      IF v_aantal IS NULL OR v_aantal <= 0 THEN CONTINUE; END IF;

      IF v_bron = 'voorraad' THEN
        v_artikelnr := v_keuze->>'artikelnr';
        IF v_artikelnr IS NULL OR v_artikelnr = v_orderregel_artikelnr THEN CONTINUE; END IF;
        INSERT INTO order_reserveringen
          (order_regel_id, bron, aantal, fysiek_artikelnr, is_handmatig)
        VALUES
          (p_order_regel_id, 'voorraad', v_aantal, v_artikelnr, true);

      ELSIF v_bron = 'inkooporder_regel' THEN
        v_io_regel_id := (v_keuze->>'inkooporder_regel_id')::BIGINT;
        v_artikelnr := v_keuze->>'artikelnr';
        IF v_io_regel_id IS NULL THEN CONTINUE; END IF;
        -- Capaciteit-guard: claim nooit meer dan er werkelijk vrij is op de
        -- IO-regel (mirrort allocator stap 2's io_regel_ruimte-gebruik).
        v_io_ruimte := io_regel_ruimte(v_io_regel_id);
        IF v_aantal > v_io_ruimte THEN
          RAISE EXCEPTION
            'Gekozen aantal (%) overschrijdt de beschikbare ruimte (%) op inkooporder_regel %',
            v_aantal, v_io_ruimte, v_io_regel_id;
        END IF;
        INSERT INTO order_reserveringen
          (order_regel_id, bron, inkooporder_regel_id, aantal, fysiek_artikelnr, is_handmatig)
        VALUES
          (p_order_regel_id, 'inkooporder_regel', v_io_regel_id, v_aantal,
           COALESCE(v_artikelnr, v_orderregel_artikelnr), true);
      END IF;
    END LOOP;
  END IF;

  -- Restant na de bevestigde keuze mag verder automatisch cascaderen (eigen
  -- voorraad + eigen IO) — zelfde semantiek als vandaag al bij
  -- set_uitwisselbaar_claims, nu expliciet via de _auto-vorm.
  PERFORM herallocateer_orderregel_auto(p_order_regel_id);
END;
$function$;

-- Ontgrendelen: release de handmatige keuze, val terug op de korte vorm
-- (alleen eigen voorraad) — bewust NIET _auto, anders triggert ontgrendelen
-- meteen weer een nieuwe automatische alias/IO-claim. Mirrort
-- ontgrendel_handmatige_toewijzing (mig 453, snijplanning).
CREATE OR REPLACE FUNCTION ontgrendel_allocatie_keuze(p_order_regel_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $function$
DECLARE
  v_order_id BIGINT;
BEGIN
  SELECT order_id INTO v_order_id FROM order_regels WHERE id = p_order_regel_id;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Orderregel % niet gevonden', p_order_regel_id;
  END IF;

  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND is_handmatig = true;

  PERFORM herallocateer_orderregel(p_order_regel_id);
END;
$function$;

-- Eenmalige backfill: bestaande automatische (niet-handmatige) alias-
-- voorraad- en inkooporder-claims vrijgeven, zodat die regels terugvallen op
-- "tekort, keuze nodig" i.p.v. een stille substitutie te houden. Orders die
-- al 'In pickronde' (of verder) staan blijven ONAANGEROERD — die claims zijn
-- al fysiek in uitvoering.
DO $backfill$
DECLARE
  v_order_id BIGINT;
BEGIN
  FOR v_order_id IN
    SELECT DISTINCT o.id
      FROM orders o
      JOIN order_regels oreg ON oreg.order_id = o.id
      JOIN order_reserveringen r ON r.order_regel_id = oreg.id
     WHERE r.status = 'actief'
       AND COALESCE(r.is_handmatig, false) = false
       AND (
         r.bron = 'inkooporder_regel'
         OR (r.bron = 'voorraad' AND r.fysiek_artikelnr <> oreg.artikelnr)
       )
       AND o.status NOT IN ('In pickronde', 'Deels verzonden', 'Verzonden', 'Geannuleerd')
  LOOP
    UPDATE order_reserveringen r
       SET status = 'released', updated_at = now()
      FROM order_regels oreg
     WHERE r.order_regel_id = oreg.id
       AND oreg.order_id = v_order_id
       AND r.status = 'actief'
       AND COALESCE(r.is_handmatig, false) = false
       AND (
         r.bron = 'inkooporder_regel'
         OR (r.bron = 'voorraad' AND r.fysiek_artikelnr <> oreg.artikelnr)
       );

    PERFORM herwaardeer_order_status(v_order_id);
  END LOOP;
END;
$backfill$;
