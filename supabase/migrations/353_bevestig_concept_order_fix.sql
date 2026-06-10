-- Migratie 353: bevestig_concept_order — kapotte event-INSERT gefixt, via _apply_transitie
--
-- PROBLEEM (bevinding B3, docs/order-lifecycle.md §11C — bij nadere inspectie
-- een ECHTE BUG, niet alleen opruimwerk): de mig 308-versie deed
--   INSERT INTO order_events (order_id, event_type, actor, metadata) ...
-- maar order_events (mig 218) heeft GEEN kolom `actor` (wel
-- actor_medewerker_id / actor_auth_user_id) en `status_na` is NOT NULL en
-- ontbrak. De INSERT crasht dus op "column actor does not exist" zodra een
-- operator een Concept-order (e-mail-kanaal) bevestigt — de hele transactie
-- (incl. de status-flip) rolt terug. De flow is in de UI bedraad
-- (modules/orders-lifecycle, use-bevestig-concept-order) maar kennelijk nog
-- nooit succesvol in productie gebruikt.
--
-- FIX: de directe status-UPDATE + handmatige event-INSERT vervangen door één
-- _apply_transitie-aanroep (ADR-0006, het ene schrijfpad): zet de status,
-- logt het event met correcte kolommen (status_voor='Concept',
-- status_na='Klaar voor picken') en is SECURITY DEFINER (218_z) zodat de
-- order_events-RLS geen rol speelt. Event-type blijft 'aangemaakt' — een
-- Concept-order krijgt bij creatie bewust géén event (mig 308), dus de
-- bevestiging is het "order wordt echt"-moment, conform de mig 308-intentie.
-- Guards (FOR UPDATE, Concept-check) en de herbereken-keten ongewijzigd.
--
-- Idempotent via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION bevestig_concept_order(p_order_id BIGINT)
RETURNS TABLE(order_nr TEXT, status order_status)
LANGUAGE plpgsql
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % niet gevonden', p_order_id;
  END IF;

  IF v_order.status <> 'Concept' THEN
    RAISE EXCEPTION 'Order % heeft status %, verwacht Concept', p_order_id, v_order.status;
  END IF;

  -- Status + event atomair via het ene schrijfpad (was: directe UPDATE +
  -- event-INSERT op niet-bestaande kolom `actor`, mig 308).
  PERFORM _apply_transitie(
    p_order_id   := p_order_id,
    p_event_type := 'aangemaakt',
    p_status_na  := 'Klaar voor picken',
    p_metadata   := jsonb_build_object(
      'bron', 'bevestig_concept_order',
      'vorige_status', 'Concept'
    )
  );

  -- Reserveringen en wacht-status herberekenen
  PERFORM herbereken_wacht_status(p_order_id);

  RETURN QUERY SELECT v_order.order_nr, 'Klaar voor picken'::order_status;
END;
$$;

GRANT EXECUTE ON FUNCTION bevestig_concept_order(BIGINT) TO authenticated, service_role;

COMMENT ON FUNCTION bevestig_concept_order IS
  'Promoveert een Concept-order naar Klaar voor picken via _apply_transitie '
  '(mig 353; de mig 308-versie crashte op een event-INSERT met niet-bestaande '
  'kolom actor). Triggert daarna herbereken_wacht_status zodat reserveringen '
  'en wacht-op-inkoop/-voorraad-status direct actief worden.';

-- Zelf-test: geen handmatige event-INSERT of directe status-UPDATE meer;
-- delegatie aan _apply_transitie aanwezig.
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('bevestig_concept_order(BIGINT)'::regprocedure);
BEGIN
  IF v_def ~* 'INSERT\s+INTO\s+order_events' THEN
    RAISE EXCEPTION 'Mig 353: bevestig_concept_order bevat nog een handmatige order_events-INSERT';
  END IF;
  IF v_def ~* 'UPDATE\s+orders\s+SET' THEN
    RAISE EXCEPTION 'Mig 353: bevestig_concept_order bevat nog een directe status-UPDATE';
  END IF;
  IF v_def NOT LIKE '%_apply_transitie%' THEN
    RAISE EXCEPTION 'Mig 353: bevestig_concept_order delegeert niet aan _apply_transitie';
  END IF;
  RAISE NOTICE 'Mig 353: alle asserties geslaagd — Concept-bevestiging loopt via _apply_transitie';
END $$;

NOTIFY pgrst, 'reload schema';
