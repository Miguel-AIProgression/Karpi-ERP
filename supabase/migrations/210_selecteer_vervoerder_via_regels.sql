-- Migratie 210: selecteer_vervoerder_voor_zending op basis van regels
--
-- Achtergrond
-- -----------
-- Mig 176 koos "exact 1 actieve vervoerder = die wordt het". Dat brak zodra DPD
-- (mig 207) erbij kwam. Mig 208 introduceerde `vervoerder_selectie_regels`.
-- Deze migratie:
--   • Vervangt de selector-RPC door een regel-evaluator (eerste match wint)
--   • Breidt de switch-RPC `enqueue_zending_naar_vervoerder` uit met `type='print'`
--     (geen dispatch — alleen sticker-PDF in de UI)
--
-- Algoritme selector
-- ------------------
-- 1. Haal zending-attributes op: land, kleinste_zijde_cm (MAX over regels),
--    totaal_gewicht_kg, debiteur_nr, inkoopgroep_code.
-- 2. Loop door alle actieve regels van actieve vervoerders, prio ASC, id ASC.
-- 3. Voor elke regel: evalueer alle conditie-sleutels (AND-conjunctie).
--    - Onbekende sleutels → genegeerd (forward-compat).
--    - Lege conditie ({}) → altijd-match (fallback-regel).
-- 4. Eerste regel die matcht: gekozen + service_code.
-- 5. Geen match → return NULL met audit-uitleg.
--
-- Idempotent.

-- ============================================================================
-- 1. Helper: evalueer_zending_attributes
-- ============================================================================
CREATE OR REPLACE FUNCTION evalueer_zending_attributes(p_zending_id BIGINT)
RETURNS TABLE (
  afl_land           TEXT,
  kleinste_zijde_cm  INTEGER,
  totaal_gewicht_kg  NUMERIC,
  debiteur_nr        INTEGER,
  inkoopgroep_code   TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    z.afl_land,
    -- Grootste kleinste-zijde over alle orderregels in de zending.
    -- Maatwerk: LEAST(maatwerk_lengte, maatwerk_breedte).
    -- Vast:     LEAST(producten.lengte_cm, producten.breedte_cm).
    (
      SELECT MAX(LEAST(
        COALESCE(ore.maatwerk_lengte_cm, p.lengte_cm),
        COALESCE(ore.maatwerk_breedte_cm, p.breedte_cm)
      ))::INTEGER
        FROM zending_regels zr
        LEFT JOIN order_regels ore ON ore.id = zr.order_regel_id
        LEFT JOIN producten p     ON p.artikelnr = zr.artikelnr
       WHERE zr.zending_id = z.id
    ) AS kleinste_zijde_cm,
    z.totaal_gewicht_kg,
    o.debiteur_nr,
    d.inkoopgroep_code
  FROM zendingen z
  JOIN orders o     ON o.id = z.order_id
  LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  WHERE z.id = p_zending_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION evalueer_zending_attributes(BIGINT) TO authenticated;

COMMENT ON FUNCTION evalueer_zending_attributes(BIGINT) IS
  'Bouwt de attributen-set voor de regel-evaluator. Voegt nieuwe attributen toe '
  'door extra kolommen in de TABLE-signatuur — selector leest pas wat in JSONB-conditie '
  'staat, dus tussenin staat geen breaking change.';

-- ============================================================================
-- 2. Helper: matcht_regel (AND-evaluatie van alle bekende sleutels)
-- ============================================================================
CREATE OR REPLACE FUNCTION matcht_regel(
  p_conditie       JSONB,
  p_land           TEXT,
  p_kleinste_zijde INTEGER,
  p_gewicht_kg     NUMERIC,
  p_debiteur_nr    INTEGER,
  p_inkoopgroep    TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_landen      TEXT[];
  v_min         INTEGER;
  v_max         INTEGER;
  v_g_max       NUMERIC;
  v_g_min       NUMERIC;
  v_debs        INTEGER[];
  v_groepen     TEXT[];
BEGIN
  -- Lege conditie → fallback-regel, altijd match
  IF p_conditie IS NULL OR p_conditie = '{}'::JSONB THEN
    RETURN TRUE;
  END IF;

  -- land: TEXT[] of single string
  IF p_conditie ? 'land' THEN
    SELECT array_agg(value::TEXT) INTO v_landen
      FROM jsonb_array_elements_text(p_conditie->'land') AS value;
    IF p_land IS NULL OR NOT (p_land = ANY(v_landen)) THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- kleinste_zijde_cm_min: zending kleinste-zijde >= waarde
  IF p_conditie ? 'kleinste_zijde_cm_min' THEN
    v_min := (p_conditie->>'kleinste_zijde_cm_min')::INTEGER;
    IF p_kleinste_zijde IS NULL OR p_kleinste_zijde < v_min THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- kleinste_zijde_cm_max: zending kleinste-zijde <= waarde
  IF p_conditie ? 'kleinste_zijde_cm_max' THEN
    v_max := (p_conditie->>'kleinste_zijde_cm_max')::INTEGER;
    IF p_kleinste_zijde IS NULL OR p_kleinste_zijde > v_max THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- gewicht_kg_max
  IF p_conditie ? 'gewicht_kg_max' THEN
    v_g_max := (p_conditie->>'gewicht_kg_max')::NUMERIC;
    IF p_gewicht_kg IS NULL OR p_gewicht_kg > v_g_max THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- gewicht_kg_min
  IF p_conditie ? 'gewicht_kg_min' THEN
    v_g_min := (p_conditie->>'gewicht_kg_min')::NUMERIC;
    IF p_gewicht_kg IS NULL OR p_gewicht_kg < v_g_min THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- debiteur_nrs: zending.debiteur in lijst
  IF p_conditie ? 'debiteur_nrs' THEN
    SELECT array_agg((value::TEXT)::INTEGER) INTO v_debs
      FROM jsonb_array_elements_text(p_conditie->'debiteur_nrs') AS value;
    IF p_debiteur_nr IS NULL OR NOT (p_debiteur_nr = ANY(v_debs)) THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- inkoopgroep_codes: debiteur.inkoopgroep in lijst
  IF p_conditie ? 'inkoopgroep_codes' THEN
    SELECT array_agg(value::TEXT) INTO v_groepen
      FROM jsonb_array_elements_text(p_conditie->'inkoopgroep_codes') AS value;
    IF p_inkoopgroep IS NULL OR NOT (p_inkoopgroep = ANY(v_groepen)) THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- Onbekende sleutels: negeren (forward-compat).
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION matcht_regel IS
  'AND-evaluatie van een conditie-JSONB tegen zending-attributen. Nieuwe sleutels '
  'toevoegen = nieuwe IF-blok hier. Onbekende sleutels worden genegeerd voor '
  'forward-compat (kan ook een lege rij zijn voor toekomstige features).';

-- ============================================================================
-- 3. Selector: evalueer regels in prio-volgorde
-- ============================================================================
-- Oude signatuur (mig 176) returnde alleen (gekozen_vervoerder_code, keuze_uitleg).
-- Nieuwe variant voegt gekozen_service_code toe — dat verandert de TABLE-shape, en
-- Postgres weigert dat via CREATE OR REPLACE. Daarom eerst expliciet droppen.
DROP FUNCTION IF EXISTS selecteer_vervoerder_voor_zending(BIGINT);

CREATE OR REPLACE FUNCTION selecteer_vervoerder_voor_zending(p_zending_id BIGINT)
RETURNS TABLE (
  gekozen_vervoerder_code TEXT,
  gekozen_service_code    TEXT,
  keuze_uitleg            JSONB
) AS $$
DECLARE
  v_attr   RECORD;
  v_regel  RECORD;
  v_eval   JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM zendingen WHERE id = p_zending_id) THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  SELECT * INTO v_attr FROM evalueer_zending_attributes(p_zending_id);

  v_eval := jsonb_build_object(
    'strategie',          'regels_v1',
    'land',               v_attr.afl_land,
    'kleinste_zijde_cm',  v_attr.kleinste_zijde_cm,
    'totaal_gewicht_kg',  v_attr.totaal_gewicht_kg,
    'debiteur_nr',        v_attr.debiteur_nr,
    'inkoopgroep',        v_attr.inkoopgroep_code
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
         v_attr.afl_land,
         v_attr.kleinste_zijde_cm,
         v_attr.totaal_gewicht_kg,
         v_attr.debiteur_nr,
         v_attr.inkoopgroep_code
       )
    THEN
      RETURN QUERY SELECT
        v_regel.vervoerder_code,
        v_regel.service_code,
        v_eval || jsonb_build_object(
          'match_regel_id',     v_regel.id,
          'match_prio',         v_regel.prio,
          'match_conditie',     v_regel.conditie,
          'match_notitie',      v_regel.notitie
        );
      RETURN;
    END IF;
  END LOOP;

  RETURN QUERY SELECT
    NULL::TEXT,
    NULL::TEXT,
    v_eval || jsonb_build_object('reden', 'geen_matchende_regel');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION selecteer_vervoerder_voor_zending(BIGINT) TO authenticated;

COMMENT ON FUNCTION selecteer_vervoerder_voor_zending IS
  'Regel-gebaseerde vervoerderselector. Eerste matchende regel (prio ASC) wint. '
  'Returnt ook gekozen_service_code (NULL = vervoerder-default) en een audit-JSONB '
  'die in zendingen.vervoerder_selectie_uitleg geschreven kan worden.';

-- ============================================================================
-- 4. Zending-tabel: kolom voor gekozen service-code
-- ============================================================================
ALTER TABLE zendingen
  ADD COLUMN IF NOT EXISTS service_code TEXT;

COMMENT ON COLUMN zendingen.service_code IS
  'Service-variant binnen vervoerder, gekozen door selecteer_vervoerder_voor_zending. '
  'Bv. ''internationaal'' bij DPD. NULL = vervoerder-default.';

-- ============================================================================
-- 5. Switch-RPC: regel-keuze + type='print' tak
-- ============================================================================
CREATE OR REPLACE FUNCTION enqueue_zending_naar_vervoerder(
  p_zending_id BIGINT
) RETURNS TEXT AS $$
DECLARE
  v_order_id        BIGINT;
  v_debiteur_nr     INTEGER;
  v_vervoerder_code TEXT;
  v_service_code    TEXT;
  v_keuze_uitleg    JSONB;
  v_actief          BOOLEAN;
  v_type            TEXT;
  v_is_test         BOOLEAN := FALSE;
  v_afhalen         BOOLEAN;
BEGIN
  -- Zending → order → debiteur + afhalen-vlag
  SELECT z.order_id, o.debiteur_nr, o.afhalen, z.vervoerder_code, z.service_code
    INTO v_order_id, v_debiteur_nr, v_afhalen, v_vervoerder_code, v_service_code
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;
  IF v_debiteur_nr IS NULL THEN RETURN 'no_debiteur'; END IF;

  -- Mig 205: afhalen-orders krijgen geen vervoerder, dus geen dispatch.
  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN 'afhalen_geen_vervoerder';
  END IF;

  -- Geen vervoerder gekozen → vraag selector
  IF v_vervoerder_code IS NULL THEN
    SELECT s.gekozen_vervoerder_code, s.gekozen_service_code, s.keuze_uitleg
      INTO v_vervoerder_code, v_service_code, v_keuze_uitleg
      FROM selecteer_vervoerder_voor_zending(p_zending_id) s;

    UPDATE zendingen
       SET vervoerder_code              = v_vervoerder_code,
           service_code                 = v_service_code,
           vervoerder_selectie_uitleg   = v_keuze_uitleg
     WHERE id = p_zending_id;

    IF v_vervoerder_code IS NULL THEN
      RETURN COALESCE(v_keuze_uitleg->>'reden', 'no_vervoerder_gekozen');
    END IF;
  END IF;

  -- Vervoerder actief?
  SELECT actief, type INTO v_actief, v_type
    FROM vervoerders WHERE code = v_vervoerder_code;
  IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

  -- Dispatch op type
  CASE v_type
    WHEN 'api' THEN
      CASE v_vervoerder_code
        WHEN 'hst_api' THEN
          PERFORM enqueue_hst_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_hst';
        ELSE
          RAISE NOTICE 'API-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
          RETURN 'no_adapter_voor_' || v_vervoerder_code;
      END CASE;

    WHEN 'edi' THEN
      -- EDI-adapter komt later (Rhenus/Verhoek). Voor nu loggen we alleen.
      RAISE NOTICE 'EDI-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;

    WHEN 'print' THEN
      -- Geen externe dispatch — sticker wordt in de UI gerenderd. Stickers
      -- zelf worden gegenereerd via genereer_zending_colli + verzendsticker-component.
      -- We zorgen alleen dat de colli-rijen klaarstaan.
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_print';

    ELSE
      RAISE NOTICE 'Onbekend vervoerder-type %', v_type;
      RETURN 'onbekend_type_' || v_type;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_zending_naar_vervoerder(BIGINT) TO authenticated;

COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
  'SWITCH-POINT: dispatcht een zending naar de adapter van de gekozen vervoerder. '
  'Sinds mig 210: kiest via selecteer_vervoerder_voor_zending() (regel-evaluator), '
  'ondersteunt type=''print'' (DPD/local-label, geen externe dispatch — colli-rijen '
  'worden aangemaakt). afhalen=true skipt zoals in mig 205.';

NOTIFY pgrst, 'reload schema';
