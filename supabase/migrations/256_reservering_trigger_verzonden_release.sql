-- Migratie 256: Reservering-trigger reageert ook op 'pickronde_voltooid' (ADR-0015 review-fix)
--
-- Mig 255 luisterde alleen op 'geannuleerd'. Effect: na verzending bleven
-- claims `status='actief'`. herbereken_product_reservering (mig 154 r.234-235)
-- sluit Verzonden orders uit dus de gereserveerd-cache klopte, MAAR
-- voorraad_beschikbaar_voor_artikel (mig 154 r.99) telt alle actieve claims
-- zonder Verzonden-filter — vrije voorraad werd ten onrechte te laag na
-- verzendingen.
--
-- Oude `trg_order_status_herallocateer` op orders.status-UPDATE (mig 146)
-- vuurde wél bij Verzonden-transities en releasete claims via
-- herallocateer_orderregel (mig 154 r.143-149: IF v_order_status IN
-- ('Verzonden','Geannuleerd') THEN release ALLE claims). Mig 255 verloor
-- die dekking.
--
-- Fix: trigger-WHEN-conditie en defensive check in handler uitbreiden naar
-- ('geannuleerd', 'pickronde_voltooid'). UPDATE-statement zelf is al correct
-- (release alles op de order, inclusief handmatige — bij terminal status
-- horen alle claims weg).
--
-- Plus eenmalige back-fill voor reeds-Verzonden orders met actieve claims —
-- niet automatisch opgelost door de trigger (vuurt alleen op nieuwe events).

-- ============================================================================
-- 1. Handler-functie uitbreiden naar beide terminal-events
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_order_events_reservering_release()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Defensive: zelfde set als trigger-WHEN.
  IF NEW.event_type NOT IN ('geannuleerd', 'pickronde_voltooid') THEN
    RETURN NEW;
  END IF;

  UPDATE order_reserveringen
     SET status = 'released'
   WHERE status = 'actief'
     AND order_regel_id IN (
       SELECT id FROM order_regels WHERE order_id = NEW.order_id
     );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_order_events_reservering_release() IS
  'Mig 255+256 (ADR-0015): Reservering-Module event-listener. Releaset alle actieve '
  'claims (bron=voorraad én bron=inkooporder_regel, inclusief handmatige) van '
  'orderregels van een order wanneer een terminal event in order_events verschijnt '
  '(geannuleerd of pickronde_voltooid=Verzonden). Symmetrisch met '
  'enqueue_factuur_voor_event (mig 223, Facturatie-Module).';

-- ============================================================================
-- 2. Trigger-WHEN herdefinieren
-- ============================================================================

DROP TRIGGER IF EXISTS trg_order_events_reservering_release ON order_events;
CREATE TRIGGER trg_order_events_reservering_release
  AFTER INSERT ON order_events
  FOR EACH ROW
  WHEN (NEW.event_type IN ('geannuleerd', 'pickronde_voltooid'))
  EXECUTE FUNCTION trg_order_events_reservering_release();

COMMENT ON TRIGGER trg_order_events_reservering_release ON order_events IS
  'Mig 255+256 (ADR-0015 stap 7): vuurt op terminale order-events. Vervangt het '
  'gedrag van de oude mig 146-trigger trg_order_status_herallocateer die bij '
  'Verzonden- én Geannuleerd-status claims releasete.';

-- ============================================================================
-- 3. Eenmalige back-fill: Verzonden orders met nog-actieve claims
-- ============================================================================
--
-- Nodig omdat mig 255 sinds toepassing een venster opende waarin verzonden
-- orders' claims actief bleven. herbereken_product_reservering daarna roepen
-- is niet nodig: die cache sluit Verzonden orders al uit, dus
-- producten.gereserveerd is sowieso correct. Het echte effect is dat
-- voorraad_beschikbaar_voor_artikel (live-read, geen cache) nu weer correcte
-- vrije voorraad teruggeeft voor nieuwe allocaties.

DO $$
DECLARE
  v_voor INTEGER;
  v_na   INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_voor
    FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    JOIN orders o ON o.id = oreg.order_id
   WHERE r.status = 'actief'
     AND o.status = 'Verzonden';

  IF v_voor > 0 THEN
    UPDATE order_reserveringen r
       SET status = 'released'
      FROM order_regels oreg
      JOIN orders o ON o.id = oreg.order_id
     WHERE r.order_regel_id = oreg.id
       AND r.status = 'actief'
       AND o.status = 'Verzonden';

    GET DIAGNOSTICS v_na = ROW_COUNT;
    RAISE NOTICE 'Mig 256 back-fill: % actieve claim(s) van Verzonden orders gereleased (was: %).', v_na, v_voor;
  ELSE
    RAISE NOTICE 'Mig 256 back-fill: 0 actieve claims op Verzonden orders — OK.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
