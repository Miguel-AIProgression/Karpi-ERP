-- Migratie 221: effectieve_vervoerder_per_orderregel returnt nu ook is_locked
--
-- Achtergrond
-- -----------
-- Mig 219 introduceerde de per-regel resolver + lock-trigger. De trigger
-- blokkeert UPDATE op `order_regels.vervoerder_code` zodra een zending_regel
-- naar de regel verwijst. De UI gebruikte tot nu toe `order.actieve_pickronde`
-- voor de visuele lock-staat — maar die flag dekt alleen `status='Picken'`,
-- waardoor zendingen in `Klaar voor verzending` / `Onderweg` / `Afgeleverd`
-- de pill niet locked toonden. De gebruiker kon dan klikken en kreeg pas in
-- de DB-error te zien dat het niet mocht.
--
-- Fix: laat de resolver-RPC zelf per regel rapporteren of er al een zending
-- aan vasthangt. Dan is de pill autonoom en consistent met de trigger.
--
-- Idempotent: DROP + CREATE (return-shape verandert).

DROP FUNCTION IF EXISTS effectieve_vervoerder_per_orderregel(BIGINT);

CREATE OR REPLACE FUNCTION effectieve_vervoerder_per_orderregel(p_order_id BIGINT)
RETURNS TABLE (
  orderregel_id        BIGINT,
  override_code        TEXT,
  evaluator_code       TEXT,
  evaluator_service    TEXT,
  klant_fallback_code  TEXT,
  effectief_code       TEXT,
  effectief_service    TEXT,
  bron                 TEXT,
  is_locked            BOOLEAN,
  uitleg               JSONB
) AS $$
DECLARE
  v_afhalen          BOOLEAN;
  v_klant_fallback   TEXT;
  v_debiteur_nr      INTEGER;
  v_regel            RECORD;
  v_attr             RECORD;
  v_match_regel      RECORD;
  v_eval_uitleg      JSONB;
  v_eval_code        TEXT;
  v_eval_service     TEXT;
  v_is_locked        BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  SELECT o.afhalen, o.debiteur_nr
    INTO v_afhalen, v_debiteur_nr
    FROM orders o WHERE o.id = p_order_id;

  SELECT ehc.vervoerder_code INTO v_klant_fallback
    FROM edi_handelspartner_config ehc
   WHERE ehc.debiteur_nr = v_debiteur_nr;

  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN QUERY
    SELECT
      ore.id,
      ore.vervoerder_code,
      NULL::TEXT, NULL::TEXT,
      v_klant_fallback,
      NULL::TEXT, NULL::TEXT,
      'afhalen'::TEXT,
      EXISTS (SELECT 1 FROM zending_regels zr WHERE zr.order_regel_id = ore.id),
      jsonb_build_object('reden', 'afhalen')
    FROM order_regels ore
    WHERE ore.order_id = p_order_id
      AND COALESCE(ore.orderaantal, 0) > 0
      AND COALESCE(ore.artikelnr, '') <> 'VERZEND';
    RETURN;
  END IF;

  FOR v_regel IN
    SELECT id, vervoerder_code
      FROM order_regels
     WHERE order_id = p_order_id
       AND COALESCE(orderaantal, 0) > 0
       AND COALESCE(artikelnr, '') <> 'VERZEND'
     ORDER BY id
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM zending_regels zr WHERE zr.order_regel_id = v_regel.id
    ) INTO v_is_locked;

    SELECT * INTO v_attr
      FROM evalueer_orderregel_attributes(v_regel.id);

    v_eval_code := NULL;
    v_eval_service := NULL;
    v_eval_uitleg := jsonb_build_object(
      'strategie',         'regels_v1_per_orderregel',
      'orderregel_id',     v_regel.id,
      'land',              v_attr.afl_land,
      'kleinste_zijde_cm', v_attr.kleinste_zijde_cm,
      'totaal_gewicht_kg', v_attr.totaal_gewicht_kg,
      'debiteur_nr',       v_attr.debiteur_nr,
      'inkoopgroep',       v_attr.inkoopgroep_code
    );

    FOR v_match_regel IN
      SELECT vsr.id, vsr.vervoerder_code, vsr.prio, vsr.conditie,
             vsr.service_code, vsr.notitie
        FROM vervoerder_selectie_regels vsr
        JOIN vervoerders v ON v.code = vsr.vervoerder_code
       WHERE vsr.actief = TRUE
         AND v.actief    = TRUE
       ORDER BY vsr.prio ASC, vsr.id ASC
    LOOP
      IF matcht_regel(
           v_match_regel.conditie,
           v_attr.afl_land,
           v_attr.kleinste_zijde_cm,
           v_attr.totaal_gewicht_kg,
           v_attr.debiteur_nr,
           v_attr.inkoopgroep_code
         )
      THEN
        v_eval_code := v_match_regel.vervoerder_code;
        v_eval_service := v_match_regel.service_code;
        v_eval_uitleg := v_eval_uitleg || jsonb_build_object(
          'match_regel_id', v_match_regel.id,
          'match_prio',     v_match_regel.prio,
          'match_conditie', v_match_regel.conditie,
          'match_notitie',  v_match_regel.notitie
        );
        EXIT;
      END IF;
    END LOOP;

    IF v_eval_code IS NULL THEN
      v_eval_uitleg := v_eval_uitleg || jsonb_build_object('reden', 'geen_matchende_regel');
    END IF;

    IF v_regel.vervoerder_code IS NOT NULL THEN
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_klant_fallback,
        v_regel.vervoerder_code, NULL::TEXT,
        'override'::TEXT,
        v_is_locked,
        v_eval_uitleg || jsonb_build_object('bron', 'override');
    ELSIF v_eval_code IS NOT NULL THEN
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_klant_fallback,
        v_eval_code, v_eval_service,
        'regel'::TEXT,
        v_is_locked,
        v_eval_uitleg || jsonb_build_object('bron', 'regel');
    ELSIF v_klant_fallback IS NOT NULL THEN
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_klant_fallback,
        v_klant_fallback, NULL::TEXT,
        'klant_fallback'::TEXT,
        v_is_locked,
        v_eval_uitleg || jsonb_build_object('bron', 'klant_fallback');
    ELSE
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_klant_fallback,
        NULL::TEXT, NULL::TEXT,
        'geen'::TEXT,
        v_is_locked,
        v_eval_uitleg || jsonb_build_object('bron', 'geen');
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION effectieve_vervoerder_per_orderregel(BIGINT) TO authenticated;

COMMENT ON FUNCTION effectieve_vervoerder_per_orderregel(BIGINT) IS
  'Mig 219 + 221: per-orderregel-resolver. Returnt voor elke regel: override, '
  'evaluator-keuze, klant-fallback, effectieve keuze + bron, en `is_locked` '
  '(TRUE = er bestaat al een zending_regel voor deze orderregel, dus de '
  'lock-trigger weigert UPDATE op vervoerder_code). Bron-precedentie: override '
  '> regel > klant_fallback > geen. Globaal-actief blijft een UI-fallback. '
  'STABLE: cachebaar via TanStack Query.';

NOTIFY pgrst, 'reload schema';
