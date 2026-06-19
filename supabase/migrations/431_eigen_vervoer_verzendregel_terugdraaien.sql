-- ============================================================================
-- 431: Terugdraaien mig 430 — eigen vervoer behoudt de VERZEND-kostenregel
--
-- CORRECTIE (Miguel, 19-06): mig 430 was gebaseerd op een verkeerd begrip.
-- "Eigen vervoer" (vervoerder type='eigen', mig 424) betekent NIET "afhalen /
-- geen kosten" — het betekent dat Karpi de order WEL bezorgt, met de eigen bus.
-- Daar moeten juist WÉL bezorgkosten voor gerekend worden. De automatische
-- VERZEND-kostenregel moet dus blijven staan (en op de factuur komen), precies
-- zoals bij elke andere bezorg-vervoerder.
--
-- Mig 430 deed het tegenovergestelde (VERZEND verwijderen bij eigen vervoer) en
-- draaide bovendien een backfill die bestaande VERZEND-regels al wiste. Deze
-- migratie herstelt de RPC naar de mig 227-vorm; het DATA-herstel van de door
-- de backfill verwijderde VERZEND-regels gebeurt gericht/handmatig (zie het
-- begeleidende plan — niet automatisch, om geen VERZEND toe te voegen aan orders
-- die er bewust geen hadden).
--
-- Body = exact de mig 227-versie van set_orderregel_vervoerder_override_voor_order;
-- het mig-430-cleanup-blok (DELETE VERZEND bij type='eigen') is verwijderd.
-- ============================================================================

CREATE OR REPLACE FUNCTION set_orderregel_vervoerder_override_voor_order(
  p_order_id        BIGINT,
  p_vervoerder_code TEXT
)
RETURNS TABLE (
  orderregel_id BIGINT,
  resultaat     TEXT,  -- 'gezet' | 'geblokkeerd_door_zending' | 'overgeslagen_afhalen'
  reden         TEXT
) AS $$
DECLARE
  v_afhalen      BOOLEAN;
  v_regel        RECORD;
BEGIN
  -- Validatie: order bestaat.
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  -- Validatie: vervoerder bestaat (als niet-NULL).
  IF p_vervoerder_code IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM vervoerders WHERE code = p_vervoerder_code) THEN
    RAISE EXCEPTION 'Vervoerder % bestaat niet', p_vervoerder_code;
  END IF;

  -- Afhalen-orders: geen vervoerder zetten — retourneer één informatierij.
  SELECT o.afhalen INTO v_afhalen FROM orders o WHERE o.id = p_order_id;
  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN QUERY SELECT
      NULL::BIGINT,
      'overgeslagen_afhalen'::TEXT,
      'Order is afhalen — geen vervoerder zetten'::TEXT;
    RETURN;
  END IF;

  -- Per-regel: probeer override te zetten.
  -- De lock-trigger uit mig 219 (trg_lock_orderregel_vervoerder) blokkeert
  -- UPDATE als de regel al in een open zending zit via een restrict_violation.
  -- We vangen die exception per-regel op zodat geblokkeerde regels als typed
  -- resultaat terugkomen in plaats van de hele transactie te falen.
  FOR v_regel IN
    SELECT id FROM order_regels
     WHERE order_id = p_order_id
       AND COALESCE(orderaantal, 0) > 0
       AND COALESCE(artikelnr, '') <> 'VERZEND'
     ORDER BY id
  LOOP
    BEGIN
      UPDATE order_regels
         SET vervoerder_code = p_vervoerder_code
       WHERE id = v_regel.id;
      orderregel_id := v_regel.id;
      resultaat     := 'gezet';
      reden         := NULL;
      RETURN NEXT;
    EXCEPTION
      WHEN restrict_violation THEN
        orderregel_id := v_regel.id;
        resultaat     := 'geblokkeerd_door_zending';
        reden         := SQLERRM;
        RETURN NEXT;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT) TO authenticated;

COMMENT ON FUNCTION set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT) IS
  'Mig 227 (ADR-0008), mig-430-cleanup teruggedraaid in mig 431: bulk-override '
  'van vervoerder voor alle regels van een order in één transactie. Respecteert '
  'lock-trigger uit mig 219 (geblokkeerde regels → '
  'resultaat=''geblokkeerd_door_zending'', geen exception). NULL als '
  'p_vervoerder_code wist de override. Afhalen-orders: één rij '
  'resultaat=''overgeslagen_afhalen''. Eigen vervoer (type=''eigen'') behoudt de '
  'VERZEND-kostenregel — Karpi bezorgt zelf en rekent wél bezorgkosten.';

NOTIFY pgrst, 'reload schema';
