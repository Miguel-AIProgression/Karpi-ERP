-- Migratie 205: afhalen skipt vervoerder-dispatch
--
-- Vervolg op mig 204 (orders.afhalen-vlag). De zending-creatie zelf blijft
-- ongewijzigd — een afhaalorder krijgt nog steeds een rij in `zendingen` met
-- status 'Klaar voor verzending' zodat de gebruikelijke statusovergang
-- (pakbon, magazijn-uitboeking) doorloopt. Wat NIET meer mag gebeuren is dat
-- de switch-RPC `enqueue_zending_naar_vervoerder` de zending naar een
-- vervoerder (HST/EDI) dispatched — afhalen heeft geen vervoerder, dus geen
-- transportorder en geen verzendstickers.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION enqueue_zending_naar_vervoerder(
  p_zending_id BIGINT
) RETURNS TEXT AS $$
DECLARE
  v_order_id        BIGINT;
  v_debiteur_nr     INTEGER;
  v_vervoerder_code TEXT;
  v_actief          BOOLEAN;
  v_is_test         BOOLEAN := FALSE;
  v_afhalen         BOOLEAN;
BEGIN
  -- Zending → order → debiteur + afhalen-vlag
  SELECT z.order_id, o.debiteur_nr, o.afhalen
    INTO v_order_id, v_debiteur_nr, v_afhalen
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;
  IF v_debiteur_nr IS NULL THEN RETURN 'no_debiteur'; END IF;

  -- Mig 205: afhalen-orders krijgen geen vervoerder, dus geen dispatch.
  -- De zending-rij blijft staan voor pakbon / status-overgang naar Verzonden.
  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN 'afhalen_geen_vervoerder';
  END IF;

  SELECT vervoerder_code INTO v_vervoerder_code
    FROM edi_handelspartner_config
   WHERE debiteur_nr = v_debiteur_nr;
  IF v_vervoerder_code IS NULL THEN RETURN 'no_vervoerder_gekozen'; END IF;

  SELECT actief INTO v_actief FROM vervoerders WHERE code = v_vervoerder_code;
  IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

  CASE v_vervoerder_code
    WHEN 'hst_api' THEN
      PERFORM enqueue_hst_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
      RETURN 'enqueued_hst';
    ELSE
      RAISE NOTICE 'Vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
  'SWITCH-POINT: dispatcht een zending naar de adapter-RPC van de gekoppelde '
  'vervoerder. Sinds mig 205: orders met afhalen=true skippen de dispatch en '
  'returnen ''afhalen_geen_vervoerder''. Geen transportorder/verzendstickers '
  'voor zelf-afhalen — wel de zending-rij voor pakbon/status-overgang.';

NOTIFY pgrst, 'reload schema';
