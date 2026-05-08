-- Migratie 225: vervoerder-keuze — versimpel ladder (klant-fallback weg)
--
-- ADR-0008: vervoerder-keuze leeft per orderregel; ladder wordt
--   override → regel-evaluator → geen
-- Klant-fallback (kolom `edi_handelspartner_config.vervoerder_code`) is al
-- gemigreerd naar `vervoerder_selectie_regels` door mig 224 en kan nu uit alle
-- leeskanten weg. De kolom zelf blijft nog bestaan; dropt pas in mig 226.
--
-- Geraakte RPCs/views (CREATE OR REPLACE — geen schema-wijziging):
--   1. effectieve_vervoerder_per_orderregel (mig 221, behoud is_locked)
--      → klant_fallback_code-returnveld weg, klant-fallback-tak in IF/ELSIF weg,
--        v_klant_fallback-variabele weg, ehc.vervoerder_code-SELECT weg.
--      → strategie-naam bijgewerkt naar 'regels_v2_per_orderregel'.
--   2. selecteer_vervoerder_voor_zending (mig 210)
--      → leest GEEN ehc.vervoerder_code; geen wijziging nodig.
--   3. zending-trigger (mig 172)
--      → fn_zending_klaar_voor_verzending roept alleen enqueue_zending_naar_vervoerder
--        aan zonder zelf ehc.vervoerder_code te lezen → geen wijziging nodig.
--   4. vervoerder_stats view (mig 174)
--      → klanten-subquery telde via edi_handelspartner_config.vervoerder_code;
--        zendingen-subqueries joinden via ehc.vervoerder_code.
--        Vervangen: klanten = actieve verzendregels met conditie ? 'debiteur_nrs';
--        zendingen = directe JOIN op zendingen.vervoerder_code (mig 210-zendingen
--        schrijven vervoerder_code al naar de zending-rij na selector-aanroep).
--   5. enqueue_zending_naar_vervoerder (mig 205 las nog ehc.vervoerder_code,
--      maar mig 210 heeft die functie volledig vervangen door een regel-gebaseerde
--      versie die GEEN ehc.vervoerder_code meer leest) → geen wijziging nodig.

-- ============================================================================
-- 1. effectieve_vervoerder_per_orderregel
--    Basis: mig 221 (canonieke body — bevat is_locked).
--    Wijzigingen t.o.v. mig 221:
--      - RETURNS TABLE: klant_fallback_code TEXT verwijderd
--      - DECLARE: v_klant_fallback TEXT verwijderd
--      - SELECT ehc.vervoerder_code ... INTO v_klant_fallback verwijderd
--      - afhalen-return: klant_fallback-kolom verwijderd (was 5e NULL::TEXT)
--      - ELSIF v_klant_fallback IS NOT NULL tak volledig verwijderd
--      - Resterende RETURN QUERY SELECT's: klant_fallback-arg verwijderd
--      - strategie-naam: 'regels_v1_per_orderregel' → 'regels_v2_per_orderregel'
--      - COMMENT bijgewerkt
-- DROP+CREATE want return-shape wijzigt (klant_fallback_code veld verdwijnt).
-- ============================================================================
DROP FUNCTION IF EXISTS effectieve_vervoerder_per_orderregel(BIGINT);

CREATE OR REPLACE FUNCTION effectieve_vervoerder_per_orderregel(p_order_id BIGINT)
RETURNS TABLE (
  orderregel_id        BIGINT,
  override_code        TEXT,
  evaluator_code       TEXT,
  evaluator_service    TEXT,
  effectief_code       TEXT,
  effectief_service    TEXT,
  bron                 TEXT,
  is_locked            BOOLEAN,
  uitleg               JSONB
) AS $$
DECLARE
  v_afhalen          BOOLEAN;
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

  SELECT o.afhalen
    INTO v_afhalen
    FROM orders o WHERE o.id = p_order_id;

  -- Afhalen-orders: geen vervoerder, ongeacht override of evaluator.
  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN QUERY
    SELECT
      ore.id,
      ore.vervoerder_code,
      NULL::TEXT, NULL::TEXT,
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
    -- Lock-status: regel zit al in een zending (RESTRICT-trigger blokkeert update).
    SELECT EXISTS (
      SELECT 1 FROM zending_regels zr WHERE zr.order_regel_id = v_regel.id
    ) INTO v_is_locked;

    SELECT * INTO v_attr
      FROM evalueer_orderregel_attributes(v_regel.id);

    v_eval_code := NULL;
    v_eval_service := NULL;
    v_eval_uitleg := jsonb_build_object(
      'strategie',         'regels_v2_per_orderregel',
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

    -- Effectieve keuze + bron-bepaling — klant-fallback-tak is verwijderd (ADR-0008).
    -- Ladder: override → regel-evaluator → geen.
    IF v_regel.vervoerder_code IS NOT NULL THEN
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_regel.vervoerder_code, NULL::TEXT,
        'override'::TEXT,
        v_is_locked,
        v_eval_uitleg || jsonb_build_object('bron', 'override');
    ELSIF v_eval_code IS NOT NULL THEN
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_eval_code, v_eval_service,
        'regel'::TEXT,
        v_is_locked,
        v_eval_uitleg || jsonb_build_object('bron', 'regel');
    ELSE
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
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
  'Mig 225 (ADR-0008): per-orderregel-resolver. Ladder: override > regel > geen. '
  'Klant-fallback bestaat niet meer als aparte ladder-bron — bestaande klant-keuzes '
  'leven sinds mig 224 als verzendregels met conditie {debiteur_nrs: [X]} en prio '
  '9000. `is_locked` (TRUE = er bestaat al een zending_regel voor deze orderregel, '
  'dus de lock-trigger weigert UPDATE op vervoerder_code). STABLE: cachebaar via '
  'TanStack Query.';

-- ============================================================================
-- 2. selecteer_vervoerder_voor_zending (mig 210)
-- ============================================================================
-- Mig 210 leest GEEN edi_handelspartner_config.vervoerder_code — de functie
-- evalueert direct de vervoerder_selectie_regels via matcht_regel(). Er is geen
-- klant-fallback-tak aanwezig. → Geen wijziging nodig in deze migratie.

-- ============================================================================
-- 3. zending-trigger uit mig 172
-- ============================================================================
-- fn_zending_klaar_voor_verzending (mig 172) roept alleen
-- enqueue_zending_naar_vervoerder(NEW.id) aan zonder zelf
-- edi_handelspartner_config.vervoerder_code te lezen. De verouderde versie van
-- enqueue_zending_naar_vervoerder (mig 172 + 205) las wél ehc.vervoerder_code,
-- maar is volledig vervangen door de regel-gebaseerde versie in mig 210 die geen
-- ehc-leeskant meer heeft. → Geen wijziging nodig in deze migratie.

-- ============================================================================
-- 4. vervoerder_stats view (mig 174) — strip ehc.vervoerder_code-joins
--    Wijzigingen t.o.v. mig 174:
--      - klanten-subquery: was JOIN edi_handelspartner_config WHERE vervoerder_code IS NOT NULL
--        → nu: tel actieve vervoerder_selectie_regels met conditie ? 'debiteur_nrs'
--          (deze dekken de gemigreerde klant-defaults én handmatig gemaakte klant-regels).
--      - zendingen_totaal-subquery: was JOIN edi_handelspartner_config ehc … GROUP BY ehc.vervoerder_code
--        → nu: GROUP BY zendingen.vervoerder_code rechtstreeks (mig 210 schrijft
--          vervoerder_code al naar de zending na selector-aanroep).
--      - zendingen_maand-subquery: zelfde aanpassing als zendingen_totaal.
-- ============================================================================
CREATE OR REPLACE VIEW vervoerder_stats AS
SELECT
  v.code,
  v.display_naam,
  v.type,
  v.actief,
  COALESCE(klanten.aantal, 0)            AS aantal_klanten,
  COALESCE(zendingen_totaal.aantal, 0)   AS aantal_zendingen_totaal,
  COALESCE(zendingen_maand.aantal, 0)    AS aantal_zendingen_deze_maand,
  COALESCE(hst_succes.aantal, 0)         AS hst_aantal_verstuurd,
  COALESCE(hst_fout.aantal, 0)           AS hst_aantal_fout
FROM vervoerders v
LEFT JOIN (
  -- Tel actieve verzendregels die voor specifieke debiteuren gelden (conditie ? 'debiteur_nrs').
  -- Dit dekt de auto-gemigreerde klant-defaults (mig 224) en handmatig aangemaakte klant-regels.
  -- Noot: een regel kan meerdere debiteur_nrs bevatten; we tellen het aantal regels, niet debiteuren.
  SELECT vervoerder_code, COUNT(*)::INT AS aantal
    FROM vervoerder_selectie_regels
   WHERE actief = TRUE
     AND conditie ? 'debiteur_nrs'
   GROUP BY vervoerder_code
) klanten ON klanten.vervoerder_code = v.code
LEFT JOIN (
  -- Tel zendingen per vervoerder via de zending zelf (mig 210 schrijft vervoerder_code
  -- op de zending na selector-aanroep; bij handmatige override staat het er ook op).
  SELECT vervoerder_code, COUNT(id)::INT AS aantal
    FROM zendingen
   WHERE vervoerder_code IS NOT NULL
   GROUP BY vervoerder_code
) zendingen_totaal ON zendingen_totaal.vervoerder_code = v.code
LEFT JOIN (
  SELECT vervoerder_code, COUNT(id)::INT AS aantal
    FROM zendingen
   WHERE vervoerder_code IS NOT NULL
     AND created_at >= date_trunc('month', now())
   GROUP BY vervoerder_code
) zendingen_maand ON zendingen_maand.vervoerder_code = v.code
LEFT JOIN (
  SELECT 'hst_api'::TEXT AS code, COUNT(*)::INT AS aantal
    FROM hst_transportorders WHERE status = 'Verstuurd'
) hst_succes ON hst_succes.code = v.code
LEFT JOIN (
  SELECT 'hst_api'::TEXT AS code, COUNT(*)::INT AS aantal
    FROM hst_transportorders WHERE status = 'Fout'
) hst_fout ON hst_fout.code = v.code;

COMMENT ON VIEW vervoerder_stats IS
  'Mig 225 (ADR-0008): per-vervoerder dashboard. aantal_klanten telt nu actieve '
  'verzendregels met conditie ? ''debiteur_nrs'' i.p.v. edi_handelspartner_config. '
  'zendingen_totaal/maand tellen via zendingen.vervoerder_code i.p.v. ehc-join. '
  'hst_aantal_* alleen niet-NULL voor hst_api.';

GRANT SELECT ON vervoerder_stats TO authenticated;

-- ============================================================================
-- 5. afhaal-skip uit mig 205 (enqueue_zending_naar_vervoerder)
-- ============================================================================
-- Mig 205 las edi_handelspartner_config.vervoerder_code na de afhalen-check,
-- maar mig 210 heeft enqueue_zending_naar_vervoerder volledig vervangen door
-- een regel-gebaseerde versie (selecteer_vervoerder_voor_zending) die geen
-- ehc.vervoerder_code meer leest. De huidige productie-versie van de functie
-- (mig 210) bevat geen klant-fallback-leeskant. → Geen wijziging nodig.

NOTIFY pgrst, 'reload schema';
