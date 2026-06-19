-- ============================================================================
-- 430: Eigen vervoer — verwijder automatische VERZEND-kostenregel
--
-- WENS (Miguel, 19-06): zodra een order op "eigen vervoer" (vervoerder type
-- 'eigen', mig 424) wordt gezet, moet een eventuele automatische
-- VERZEND-kostenregel uit de order worden gehaald én niet meer op de factuur
-- terugkomen. Karpi of een derde rijdt zelf — er zijn geen externe
-- verzendkosten om door te belasten.
--
-- WAAR: het zetten van de vervoerder op order-niveau loopt via precies één
-- entry-point — `set_orderregel_vervoerder_override_voor_order` (mig 227,
-- ADR-0008), aangeroepen door de inline-pill in Pick & Ship / order-detail.
-- Dat is hét moment "order op eigen vervoer gezet".
--
-- SINGLE SOURCE: de factuur (`projecteer_concept_factuur` / `finaliseer_concept_factuur`,
-- mig 428) neemt de VERZEND-orderregel rechtstreeks uit `order_regels` over —
-- ze genereren niet zelf een verzendregel. VERZEND fysiek uit `order_regels`
-- verwijderen dekt daarom beide eisen in één klap: weg uit de order én weg van
-- de factuur. Geen edit nodig in de (kritische, net-live) concept-factuur-RPC's.
--
-- DISCRIMINATOR = `vervoerders.type = 'eigen'`, niet de exacte code
-- 'eigen_vervoer' — consistent met mig 429, zodat een toekomstige tweede
-- eigen-vervoer-vervoerder automatisch meedoet.
--
-- GUARD: alleen niet-gefactureerde VERZEND-regels (`gefactureerd = 0`) — een
-- al (deels) gefactureerde regel hoort bij een bestaande factuur en blijft
-- ongemoeid.
--
-- Body = exacte mig 227-versie; ALLEEN het cleanup-blok ná de FOR-loop is nieuw.
-- Een CREATE OR REPLACE moet de complete 227-body bevatten, anders verdwijnen
-- de validaties, de afhalen-skip en de lock-trigger-respecterende loop.
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
  v_is_eigen     BOOLEAN;
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

  -- Mig 430: eigen vervoer → automatische VERZEND-kostenregel verwijderen.
  -- Karpi/derde rijdt zelf, er zijn geen externe verzendkosten. De factuur
  -- leest order_regels, dus dit houdt VERZEND ook van de factuur af.
  SELECT EXISTS (
    SELECT 1 FROM vervoerders
     WHERE code = p_vervoerder_code AND type = 'eigen'
  ) INTO v_is_eigen;

  IF COALESCE(v_is_eigen, FALSE) THEN
    DELETE FROM order_regels
     WHERE order_id = p_order_id
       AND artikelnr = 'VERZEND'
       AND COALESCE(gefactureerd, 0) = 0;
  END IF;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT) TO authenticated;

COMMENT ON FUNCTION set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT) IS
  'Mig 227 (ADR-0008) + mig 430: bulk-override van vervoerder voor alle regels '
  'van een order in één transactie. Respecteert lock-trigger uit mig 219 '
  '(geblokkeerde regels → resultaat=''geblokkeerd_door_zending'', geen exception). '
  'NULL als p_vervoerder_code wist de override. Afhalen-orders: één rij '
  'resultaat=''overgeslagen_afhalen''. Mig 430: bij een type=''eigen''-vervoerder '
  'wordt de niet-gefactureerde VERZEND-kostenregel verwijderd (geen externe '
  'verzendkosten → niet op order, niet op factuur).';

-- ============================================================================
-- Backfill: orders die NU al op een eigen-vervoer-vervoerder staan en nog een
-- niet-gefactureerde VERZEND-regel dragen → die regel alsnog verwijderen.
-- Een order staat op eigen vervoer als ≥1 niet-VERZEND-regel een vervoerder
-- van type 'eigen' als override heeft.
-- ============================================================================
DELETE FROM order_regels orr
 WHERE orr.artikelnr = 'VERZEND'
   AND COALESCE(orr.gefactureerd, 0) = 0
   AND EXISTS (
     SELECT 1
       FROM order_regels x
       JOIN vervoerders v ON v.code = x.vervoerder_code
      WHERE x.order_id = orr.order_id
        AND v.type = 'eigen'
   );

NOTIFY pgrst, 'reload schema';
