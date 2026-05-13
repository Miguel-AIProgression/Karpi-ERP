-- Migratie 255: Reservering-Module luistert op order_events i.p.v. orders.status (ADR-0015, stap 7)
--
-- Vervangt mig 146-trigger trg_order_status_herallocateer (op orders UPDATE WHERE
-- status changed) door trg_order_events_reservering_release op order_events INSERT
-- met WHEN (NEW.event_type = 'geannuleerd'). Past in ADR-0006 + ADR-0015 event-
-- pattern: alle externe Modules (Facturatie via mig 223, nu ook Reservering)
-- luisteren op de typed event-stroom, niet op orders.status directly.
--
-- Effect: geen directe trigger meer op orders.status buiten Order-lifecycle's
-- eigen _apply_transitie (mig 218). Symmetrie met Facturatie-Module.
--
-- Naast trigger-swap dropt deze migratie ook de oude handler-functie
-- trg_order_status_herallocateer() — die wordt nergens anders aangeroepen
-- (grep in supabase/migrations/ alleen hits in mig 146 zelf).
--
-- Idempotent: DROP TRIGGER IF EXISTS, DROP FUNCTION IF EXISTS, CREATE OR REPLACE.

-- ============================================================================
-- 1. Drop oude trigger + handler-functie
-- ============================================================================

DROP TRIGGER IF EXISTS trg_order_status_herallocateer ON orders;

-- Handler-functie is alleen door bovenstaande trigger gebruikt — veilig droppen.
-- CASCADE voor de zekerheid (mocht een view/policy alsnog refereren).
DROP FUNCTION IF EXISTS trg_order_status_herallocateer() CASCADE;

-- ============================================================================
-- 2. Nieuwe handler-functie + trigger op order_events
-- ============================================================================
--
-- Bij INSERT van een 'geannuleerd'-event releaset deze handler alle actieve
-- claims (voorraad + IO) van de betrokken order. Sluit aan op het patroon van
-- enqueue_factuur_voor_event (mig 223): event-type-filter via WHEN-clause op
-- de trigger zelf, kleine SECURITY-loze functie omdat order_reserveringen
-- alleen door system-paths geschreven wordt en de aanroepende RPC
-- (markeer_geannuleerd) al authenticated draait.
--
-- Bewust géén PERFORM herallocateer_orderregel(...) per regel: bij annulering
-- hoef je niet te her-alloceren — alle claims gaan weg. herbereken_product_
-- reservering wordt automatisch getriggerd via trg_reservering_sync_producten
-- (mig 146) op de status-UPDATE naar 'released'.

CREATE OR REPLACE FUNCTION trg_order_events_reservering_release()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Alleen op 'geannuleerd' — defensief, ook al filtert de trigger-WHEN al.
  IF NEW.event_type <> 'geannuleerd' THEN
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
  'Mig 255 (ADR-0015): Reservering-Module event-listener. Releaset alle actieve '
  'claims (bron=voorraad én bron=inkooporder_regel) van orderregels van een order '
  'wanneer een ''geannuleerd''-event in order_events verschijnt. Symmetrisch met '
  'enqueue_factuur_voor_event (mig 223, Facturatie-Module).';

DROP TRIGGER IF EXISTS trg_order_events_reservering_release ON order_events;
CREATE TRIGGER trg_order_events_reservering_release
  AFTER INSERT ON order_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'geannuleerd')
  EXECUTE FUNCTION trg_order_events_reservering_release();

COMMENT ON TRIGGER trg_order_events_reservering_release ON order_events IS
  'Mig 255 (ADR-0015 stap 7): vervangt mig 146-trigger trg_order_status_herallocateer. '
  'Reservering luistert op order_events (typed audit-log uit ADR-0006) i.p.v. '
  'rechtstreeks op orders.status — analoog aan Facturatie-Module (mig 223).';

-- ============================================================================
-- 3. Sanity-check: rapporteer eventuele Geannuleerde orders met actieve claims
-- ============================================================================
--
-- Alleen RAISE NOTICE — geen automatische back-fill. Onder normale werking is
-- dit altijd 0 want de oude trigger (mig 146) deed dezelfde release via
-- herallocateer_orderregel. Notice helpt drift-detectie bij handmatige fixes
-- of historische edge-cases.

DO $$
DECLARE
  v_aantal INTEGER;
BEGIN
  SELECT COUNT(DISTINCT o.id) INTO v_aantal
    FROM orders o
    JOIN order_regels oreg ON oreg.order_id = o.id
    JOIN order_reserveringen r ON r.order_regel_id = oreg.id
   WHERE o.status = 'Geannuleerd'
     AND r.status = 'actief';

  IF v_aantal > 0 THEN
    RAISE NOTICE
      'Mig 255 sanity-check: % geannuleerde order(s) hebben nog actieve claims. '
      'Niet vanzelf opgelost door deze migratie (trigger vuurt alleen op nieuwe events). '
      'Overweeg handmatige release of een eenmalige back-fill in een vervolg-migratie.',
      v_aantal;
  ELSE
    RAISE NOTICE 'Mig 255 sanity-check: 0 geannuleerde orders met actieve claims — OK.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
