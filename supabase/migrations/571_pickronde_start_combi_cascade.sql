-- Migratie 571: markeer_pickronde_gestart herevalueert nu ook de Combi-
-- levering-siblings (ADR-0040, audit-blocker 02-07). Tot nu toe bleven
-- achterblijvers van een deels gestarte groep stale op 'Klaar voor picken'
-- (zichtbaar in Pick & Ship, zonder VERZEND-regel) totdat de gestarte order
-- 'Verzonden' werd. Body = mig 258 + PERFORM herbereken_wacht_status ná de
-- transitie: voor de eigen order een no-op ('In pickronde' is no-touch), de
-- groep-cascade (mig 565, default TRUE) demoveert de siblings direct terug
-- naar 'Wacht op combi-levering' als de rest-groep onder de drempel zakt.
-- Niet-combi-klanten: sibling-query matcht niets (d2.combi_levering=TRUE).
--
-- Pre-flight (02-07): live body op prod is functioneel identiek aan de
-- mig 258-body die deze migratie als basis neemt — enige verschil zijn
-- inline commentaarregels (triviale formattering, geen logica/guards/
-- signatuur-afwijking). herbereken_wacht_status(bigint, boolean DEFAULT
-- true) bevestigd (mig 565) — de aanroep zonder 2e argument cascadet dus
-- standaard.

CREATE OR REPLACE FUNCTION markeer_pickronde_gestart(
  p_order_id            BIGINT,
  p_actor_medewerker_id BIGINT DEFAULT NULL,
  p_actor_auth_user_id  UUID   DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_huidig IN ('Verzonden', 'Geannuleerd') THEN
    RAISE EXCEPTION 'Order % staat op % — kan geen pickronde meer starten', p_order_id, v_huidig
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_huidig IN ('In pickronde', 'Deels verzonden') THEN
    RETURN;
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'pickronde_gestart',
    p_status_na           := 'In pickronde',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id
  );

  -- Mig 571 (ADR-0040): eigen order = no-op (no-touch), maar de groep-cascade
  -- herevalueert de Combi-levering-siblings die zonder deze order mogelijk
  -- weer onder de vrachtvrije-drempel zakken.
  PERFORM herbereken_wacht_status(p_order_id);
END;
$$;

COMMENT ON FUNCTION markeer_pickronde_gestart IS
  'Mig 258 (ADR-0016): zet orders.status=''In pickronde'' + audit-event. '
  'Idempotent: no-op op In pickronde/Deels verzonden; faalt op Verzonden/'
  'Geannuleerd. Mig 571 (ADR-0040): herevalueert na de transitie de Combi-'
  'levering-siblings via de herbereken_wacht_status-groep-cascade (mig 565).';

NOTIFY pgrst, 'reload schema';
