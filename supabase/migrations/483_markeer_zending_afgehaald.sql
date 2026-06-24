-- ============================================================================
-- 483: RPC markeer_zending_afgehaald — handmatig afhaal-zending afsluiten
--
-- Operator klikt "Markeer als afgehaald" op een afhaal-zending die op
-- 'Klaar voor verzending' staat zodra de klant het karpet heeft opgehaald.
-- Flipt alleen de ZENDING-status; de ORDER staat al op 'Verzonden' (gezet door
-- voltooi_pickronde, ongeacht vervoerder — zie mig 429-comment).
--
-- Guards:
--  - alleen status 'Klaar voor verzending' (idempotent: 2e klik = no-op)
--  - alleen echte afhaal-orders (orders.afhalen), zodat de RPC geen carrier-
--    zending per ongeluk kan afsluiten.
--
-- De status-flip wég van 'Klaar voor verzending' her-triggert niets:
-- fn_zending_klaar_voor_verzending short-circuit op
-- NEW.status <> 'Klaar voor verzending' (zelfde redenering als mig 429).
--
-- GEEN backfill: 'Afgehaald' betekent "klant heeft opgehaald" — bestaande
-- vastgelopen zendingen blanco doorzetten zou niet-opgehaalde zendingen ten
-- onrechte als afgehaald markeren. Operator klikt per zending.
-- ============================================================================

CREATE OR REPLACE FUNCTION markeer_zending_afgehaald(p_zending_id BIGINT)
RETURNS TEXT AS $$
DECLARE
  v_afhalen BOOLEAN;
  v_status  zending_status;
BEGIN
  SELECT o.afhalen, z.status
    INTO v_afhalen, v_status
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;

  IF v_status IS NULL THEN RETURN 'zending_niet_gevonden'; END IF;
  IF v_status <> 'Klaar voor verzending' THEN RETURN 'verkeerde_status'; END IF;
  IF NOT COALESCE(v_afhalen, FALSE) THEN RETURN 'geen_afhaal_order'; END IF;

  UPDATE zendingen
     SET status = 'Afgehaald'
   WHERE id = p_zending_id
     AND status = 'Klaar voor verzending';

  RETURN 'afgehaald';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_zending_afgehaald(BIGINT) TO authenticated;

COMMENT ON FUNCTION markeer_zending_afgehaald IS
  'Handmatig afhaal-zending (orders.afhalen) van Klaar voor verzending → '
  'Afgehaald. Order staat al op Verzonden. Idempotent; geen carrier-call.';
