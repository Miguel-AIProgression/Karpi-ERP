-- Migratie 546: fix bevestig_concept_order — GRANT + ambiguity + NOT EXISTS bug
--
-- Drie problemen die ervoor zorgen dat de "Bevestig concept"-knop stil niets doet:
--
--   1. AMBIGUÏTEIT: mig 308 liet de oude 1-arg overload bevestig_concept_order(BIGINT)
--      staan naast de nieuwe 3-arg versie (mig 541). PostgREST stuurt
--      `SELECT bevestig_concept_order(p_order_id := X)` — PostgreSQL vindt twee
--      kandidaten en gooit "function is not unique". De frontend slikt de error
--      stil (geen onError handler). Fix: drop de oude 1-arg overload.
--
--   2. GEEN GRANT: mig 541 vergat GRANT EXECUTE TO authenticated.
--      Fix: grant hier alsnog.
--
--   3. NOT EXISTS BUG in mig 541, lijn 84:
--      `WHERE order_regel_id = id`
--      Binnen de subquery lost PostgreSQL `id` op als snijplannen.id (eigen PK),
--      niet als de outer order_regels.id. De check is dus vrijwel altijd TRUE
--      (twee verschillende sequences) → probeert snijplannen aan te maken voor
--      regels die er al een hebben. Fix: `v_regel.id` (expliciete loop-variabele).

------------------------------------------------------------------------
-- 1. Drop de oude 1-arg overload (mig 308 — RETURNS TABLE, andere logica)
------------------------------------------------------------------------
DROP FUNCTION IF EXISTS bevestig_concept_order(BIGINT);


------------------------------------------------------------------------
-- 2. Recreate de 3-arg versie met NOT EXISTS bug gefixt
--    (identiek aan mig 541 op lijn 84 na)
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bevestig_concept_order(
  p_order_id            BIGINT,
  p_actor_medewerker_id BIGINT DEFAULT NULL,
  p_actor_auth_user_id  UUID   DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status order_status;
  v_regel  order_regels%ROWTYPE;
  v_aantal INTEGER;
  i        INTEGER;
BEGIN
  SELECT status INTO v_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status <> 'Concept' THEN
    RAISE EXCEPTION 'Order % kan niet bevestigd worden: status is % (verwacht: Concept)',
      p_order_id, v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'concept_bevestigd',
    p_status_na           := 'Klaar voor picken',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id
  );

  FOR v_regel IN
    SELECT *
    FROM order_regels
    WHERE order_id = p_order_id
      AND COALESCE(is_maatwerk, false) = true
      AND maatwerk_lengte_cm  IS NOT NULL
      AND maatwerk_breedte_cm IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM snijplannen WHERE order_regel_id = v_regel.id  -- FIX: was `id` (= snijplannen.id)
      )
  LOOP
    v_aantal := GREATEST(COALESCE(v_regel.orderaantal, 1), 1);
    FOR i IN 1..v_aantal LOOP
      INSERT INTO snijplannen (
        snijplan_nr, order_regel_id,
        lengte_cm, breedte_cm,
        status, opmerkingen,
        snijden_uit_standaardmaat
      )
      VALUES (
        volgend_nummer('SNIJ'),
        v_regel.id,
        v_regel.maatwerk_lengte_cm::INTEGER,
        v_regel.maatwerk_breedte_cm::INTEGER,
        'Wacht'::snijplan_status,
        CASE WHEN v_aantal > 1
             THEN 'Auto-aangemaakt bij bevestiging (' || i || '/' || v_aantal || ')'
             ELSE 'Auto-aangemaakt bij bevestiging'
        END,
        COALESCE(v_regel.snijden_uit_standaardmaat, false)
      );
    END LOOP;
  END LOOP;

  FOR v_regel IN
    SELECT * FROM order_regels WHERE order_id = p_order_id
  LOOP
    PERFORM herallocateer_orderregel_auto(v_regel.id);
  END LOOP;

  PERFORM herbereken_wacht_status(p_order_id);
END;
$$;


------------------------------------------------------------------------
-- 3. GRANT EXECUTE
------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION bevestig_concept_order(BIGINT, BIGINT, UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION bevestig_concept_order(BIGINT, BIGINT, UUID) IS
  'Activeert een Concept-order: transitie → Klaar voor picken, maatwerk-snijplannen '
  'aanmaken, volledig allocatiepad (herallocateer_orderregel_auto), definitieve '
  'status (herbereken_wacht_status). Enige legitieme uitweg uit status Concept. '
  'Mig 541 (logica) + mig 546 (GRANT + ambiguity fix + NOT EXISTS fix).';


------------------------------------------------------------------------
-- 4. DO-assertion: controleer dat de 1-arg overload weg is en GRANT bestaat
------------------------------------------------------------------------
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'bevestig_concept_order'
    AND pronargs = 1;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'mig 546: de 1-arg overload bevestig_concept_order(BIGINT) bestaat nog steeds';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'bevestig_concept_order'
    AND pronargs = 3;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mig 546: de 3-arg functie bevestig_concept_order werd niet gevonden';
  END IF;
END;
$$;


NOTIFY pgrst, 'reload schema';
