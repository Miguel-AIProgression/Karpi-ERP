-- Migratie 215: preview_vervoerder_voor_order
--
-- Probleem
-- --------
-- `selecteer_vervoerder_voor_zending` (mig 210) draait pas wanneer er een
-- zending bestaat — d.w.z. ná klikken op "Verzendset" in Pick & Ship. De
-- vervoerder-pill op de pickregel toont daardoor "Kies" of de klant-default,
-- niet wat de verzendregels zouden kiezen voor dit specifieke order. Dat is
-- verwarrend: de gebruiker stelt regels in en verwacht direct te zien welk
-- effect ze hebben.
--
-- Oplossing
-- ---------
-- Een preview-RPC die dezelfde logica draait als de selector, maar met
-- order-attributen in plaats van zending-attributen. Geen zending nodig — dus
-- te gebruiken voor pre-flight UI op de pickregel of orderpagina.
--
-- Symmetrie met `selecteer_vervoerder_voor_zending`:
--   - identieke return-shape (gekozen_vervoerder_code, gekozen_service_code, keuze_uitleg)
--   - identieke regel-loop en `matcht_regel`-aanroep
--   - identieke fallback-uitleg ('geen_matchende_regel', 'afhalen', etc.)
--
-- Verschil:
--   - attributen komen direct uit `orders` + aggregatie op `order_regels` i.p.v.
--     `zendingen` + `zending_regels`
--   - extra `'order_id'` veld in `keuze_uitleg` voor traceability
--
-- Idempotent.

CREATE OR REPLACE FUNCTION preview_vervoerder_voor_order(p_order_id BIGINT)
RETURNS TABLE (
  gekozen_vervoerder_code TEXT,
  gekozen_service_code    TEXT,
  keuze_uitleg            JSONB
) AS $$
DECLARE
  v_afl_land           TEXT;
  v_kleinste_zijde     INTEGER;
  v_gewicht_kg         NUMERIC;
  v_debiteur_nr        INTEGER;
  v_inkoopgroep_code   TEXT;
  v_afhalen            BOOLEAN;
  v_eval               JSONB;
  v_regel              RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  -- Order-niveau attributen.
  SELECT
    o.afl_land,
    o.afhalen,
    o.debiteur_nr,
    d.inkoopgroep_code
  INTO v_afl_land, v_afhalen, v_debiteur_nr, v_inkoopgroep_code
  FROM orders o
  LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  WHERE o.id = p_order_id;

  -- Mig 205-symmetrie: afhalen-orders krijgen geen vervoerder.
  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN QUERY SELECT
      NULL::TEXT,
      NULL::TEXT,
      jsonb_build_object(
        'strategie', 'regels_v1_preview',
        'order_id',  p_order_id,
        'reden',     'afhalen'
      );
    RETURN;
  END IF;

  -- kleinste_zijde_cm = MAX(LEAST(L,B)) over orderregels — identiek aan
  -- evalueer_zending_attributes maar dan op `order_regels` direct. Voor
  -- maatwerk gebruiken we `maatwerk_lengte_cm/breedte_cm`, anders de product-
  -- afmetingen.
  SELECT
    MAX(LEAST(
      COALESCE(ore.maatwerk_lengte_cm,  p.lengte_cm),
      COALESCE(ore.maatwerk_breedte_cm, p.breedte_cm)
    ))::INTEGER
  INTO v_kleinste_zijde
  FROM order_regels ore
  LEFT JOIN producten p ON p.artikelnr = ore.artikelnr
  WHERE ore.order_id = p_order_id
    AND COALESCE(ore.orderaantal, 0) > 0;

  -- totaal_gewicht_kg = SUM(gewicht_kg * orderaantal)
  SELECT
    SUM(COALESCE(ore.gewicht_kg, 0) * GREATEST(COALESCE(ore.orderaantal, 0), 0))
  INTO v_gewicht_kg
  FROM order_regels ore
  WHERE ore.order_id = p_order_id;

  v_eval := jsonb_build_object(
    'strategie',          'regels_v1_preview',
    'order_id',           p_order_id,
    'land',               v_afl_land,
    'kleinste_zijde_cm',  v_kleinste_zijde,
    'totaal_gewicht_kg',  v_gewicht_kg,
    'debiteur_nr',        v_debiteur_nr,
    'inkoopgroep',        v_inkoopgroep_code
  );

  FOR v_regel IN
    SELECT vsr.id, vsr.vervoerder_code, vsr.prio, vsr.conditie, vsr.service_code, vsr.notitie
      FROM vervoerder_selectie_regels vsr
      JOIN vervoerders v ON v.code = vsr.vervoerder_code
     WHERE vsr.actief = TRUE
       AND v.actief    = TRUE
     ORDER BY vsr.prio ASC, vsr.id ASC
  LOOP
    IF matcht_regel(
         v_regel.conditie,
         v_afl_land,
         v_kleinste_zijde,
         v_gewicht_kg,
         v_debiteur_nr,
         v_inkoopgroep_code
       )
    THEN
      RETURN QUERY SELECT
        v_regel.vervoerder_code,
        v_regel.service_code,
        v_eval || jsonb_build_object(
          'match_regel_id', v_regel.id,
          'match_prio',     v_regel.prio,
          'match_conditie', v_regel.conditie,
          'match_notitie',  v_regel.notitie
        );
      RETURN;
    END IF;
  END LOOP;

  RETURN QUERY SELECT
    NULL::TEXT,
    NULL::TEXT,
    v_eval || jsonb_build_object('reden', 'geen_matchende_regel');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION preview_vervoerder_voor_order(BIGINT) TO authenticated;

COMMENT ON FUNCTION preview_vervoerder_voor_order(BIGINT) IS
  'Preview welke vervoerder de selector zou kiezen voor een order — zonder '
  'zending aan te maken. Gebruikt voor pick&ship-pill, order-detail, '
  'audit-vooraf. Identieke regel-loop als selecteer_vervoerder_voor_zending '
  '(mig 210 + 214) maar attributen vanuit orders/order_regels. STABLE: zelfde '
  'output bij zelfde input binnen één query, dus cachebaar via TanStack Query.';

NOTIFY pgrst, 'reload schema';
