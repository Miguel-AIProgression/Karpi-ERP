-- Migratie 172: switch-RPC + zending-trigger + create_zending_voor_order
-- Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md
--
-- Idempotent.

-- ============================================================================
-- create_zending_voor_order: maakt 1 zending + zending_regels aan voor 1 order.
-- Wordt aangeroepen vanuit "Zending aanmaken"-knop op order-detail.
-- Idempotent: als er al een actieve zending voor de order bestaat, returnt die.
-- ============================================================================
CREATE OR REPLACE FUNCTION create_zending_voor_order(
  p_order_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
  v_zending_id BIGINT;
  v_zending_nr TEXT;
  v_order      orders%ROWTYPE;
BEGIN
  SELECT id INTO v_zending_id FROM zendingen
   WHERE order_id = p_order_id
     AND status NOT IN ('Afgeleverd')
   ORDER BY id DESC LIMIT 1;
  IF v_zending_id IS NOT NULL THEN
    RETURN v_zending_id;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr, order_id, status,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    verzenddatum
  ) VALUES (
    v_zending_nr, p_order_id, 'Klaar voor verzending',
    v_order.afl_naam, v_order.afl_adres, v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
    CURRENT_DATE
  )
  RETURNING id INTO v_zending_id;

  INSERT INTO zending_regels (zending_id, order_regel_id, artikelnr, aantal)
  SELECT v_zending_id, ore.id, ore.artikelnr, ore.aantal
    FROM order_regels ore
   WHERE ore.order_id = p_order_id
     AND ore.aantal > 0;

  RETURN v_zending_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_zending_voor_order(BIGINT) TO authenticated;

COMMENT ON FUNCTION create_zending_voor_order IS
  'Maakt één zending + zending_regels voor één order. Idempotent. Status direct op '
  '"Klaar voor verzending" zodat trg_zending_klaar_voor_verzending meteen vuurt.';

-- ============================================================================
-- enqueue_zending_naar_vervoerder: SINGLE SWITCH-POINT.
-- Enige plek waar op vervoerder_code wordt gedispatched. Alle andere code
-- (trigger, edge function, frontend) is vervoerder-blind óf vervoerder-specifiek.
-- ============================================================================
CREATE OR REPLACE FUNCTION enqueue_zending_naar_vervoerder(
  p_zending_id BIGINT
) RETURNS TEXT AS $$
DECLARE
  v_order_id        BIGINT;
  v_debiteur_nr     INTEGER;
  v_vervoerder_code TEXT;
  v_actief          BOOLEAN;
  v_is_test         BOOLEAN := FALSE;
BEGIN
  -- Zending → order → debiteur → vervoerder_code
  SELECT z.order_id, o.debiteur_nr
    INTO v_order_id, v_debiteur_nr
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;
  IF v_debiteur_nr IS NULL THEN RETURN 'no_debiteur'; END IF;

  SELECT vervoerder_code INTO v_vervoerder_code
    FROM edi_handelspartner_config
   WHERE debiteur_nr = v_debiteur_nr;
  IF v_vervoerder_code IS NULL THEN RETURN 'no_vervoerder_gekozen'; END IF;

  SELECT actief INTO v_actief FROM vervoerders WHERE code = v_vervoerder_code;
  IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

  -- DISPATCH naar adapter-RPC. Dit is de enige plaats waar deze switch leeft.
  -- Toekomstige vervoerder = nieuwe WHEN-tak hier.
  CASE v_vervoerder_code
    WHEN 'hst_api' THEN
      PERFORM enqueue_hst_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
      RETURN 'enqueued_hst';

    -- WHEN 'edi_partner_a' THEN
    --   PERFORM enqueue_edi_verzendbericht(...);
    --   RETURN 'enqueued_edi';
    --
    -- (komt in plan voor Rhenus/Verhoek; nu alleen HST geactiveerd)

    ELSE
      RAISE NOTICE 'Vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_zending_naar_vervoerder(BIGINT) TO authenticated;

COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
  'SWITCH-POINT: dispatcht een zending naar de adapter-RPC van de gekoppelde '
  'vervoerder. Enige plek in de codebase waar op vervoerder_code wordt geswitcht. '
  'Returnt een textuele status (enqueued_hst, no_vervoerder_gekozen, etc.) — '
  'niet voor controle-flow gebruikt door callers, alleen voor logging/debugging. '
  'Bij toekomstige vervoerder: voeg WHEN-tak toe.';

-- ============================================================================
-- Trigger op zendingen: alleen op transitie naar 'Klaar voor verzending'.
-- Trigger weet niets over HST of EDI. Roept alleen de switch-RPC aan.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_zending_klaar_voor_verzending() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status <> 'Klaar voor verzending' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'Klaar voor verzending' THEN RETURN NEW; END IF;

  PERFORM enqueue_zending_naar_vervoerder(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_zending_klaar_voor_verzending ON zendingen;
CREATE TRIGGER trg_zending_klaar_voor_verzending
  AFTER INSERT OR UPDATE OF status ON zendingen
  FOR EACH ROW EXECUTE FUNCTION fn_zending_klaar_voor_verzending();
