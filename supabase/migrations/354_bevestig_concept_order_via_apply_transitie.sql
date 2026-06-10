-- Migratie 354: bevestig_concept_order schrijft via _apply_transitie (bevinding B3)
--
-- Probleem: de mig 308-versie doet een directe status-UPDATE op orders +
-- handmatige order_events-INSERT (zonder status_voor/status_na) — buiten het
-- ADR-0006-schrijfpad om. De lint-whitelist (mig 308 als bevroren history)
-- markeerde dit als "follow-up open"; dit is die follow-up.
--
-- Gedrag identiek: zelfde Concept-guard, zelfde doelstatus, zelfde
-- herbereken_wacht_status-vervolgaanroep. Verschil: het event krijgt nu
-- status_voor='Concept'/status_na='Klaar voor picken' (was NULL/NULL) en
-- current_user staat in metadata.actor i.p.v. de actor-kolom.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

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

  -- ADR-0006: enige schrijfpad naar orders.status. Schrijft ook het
  -- order_events-rij (event_type 'aangemaakt', zoals de mig 308-versie).
  PERFORM _apply_transitie(
    p_order_id   := p_order_id,
    p_event_type := 'aangemaakt',
    p_status_na  := 'Klaar voor picken',
    p_metadata   := jsonb_build_object(
      'bron', 'bevestig_concept_order',
      'vorige_status', 'Concept',
      'actor', current_user::text
    )
  );

  -- Reserveringen en wacht-status herberekenen
  PERFORM herbereken_wacht_status(p_order_id);

  RETURN QUERY SELECT v_order.order_nr, 'Klaar voor picken'::order_status;
END;
$$;

GRANT EXECUTE ON FUNCTION bevestig_concept_order(BIGINT) TO authenticated, service_role;

ALTER FUNCTION bevestig_concept_order(BIGINT) SET search_path = public;

COMMENT ON FUNCTION bevestig_concept_order IS
  'Mig 308+354: promoveert een Concept-order naar Klaar voor picken via '
  '_apply_transitie (ADR-0006, bevinding B3 gesloten). Triggert daarna '
  'herbereken_wacht_status zodat reserveringen en wacht-status direct actief worden.';

-- Zelf-test: de body bevat geen directe UPDATE meer en delegeert aan _apply_transitie.
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('bevestig_concept_order(bigint)'::regprocedure);
BEGIN
  IF v_def LIKE '%UPDATE orders%' THEN
    RAISE EXCEPTION 'Mig 354: bevestig_concept_order bevat nog een directe UPDATE orders';
  END IF;
  IF v_def NOT LIKE '%_apply_transitie(%' THEN
    RAISE EXCEPTION 'Mig 354: bevestig_concept_order delegeert niet aan _apply_transitie';
  END IF;
  RAISE NOTICE 'Mig 354: bevestig_concept_order schrijft via _apply_transitie';
END $$;

NOTIFY pgrst, 'reload schema';
