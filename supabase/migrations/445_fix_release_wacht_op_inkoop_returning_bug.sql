-- Migratie 445: fix RETURNING-bug in release_wacht_op_inkoop_stukken (mig 438)
--
-- Bug gevonden tijdens handmatige test (CISC kleur 48, 2026-06-19): de oude
-- body deed `RETURNING sn.verwacht_inkooporder_regel_id` in dezelfde UPDATE
-- die die kolom net op NULL zette — Postgres' RETURNING geeft de NIEUWE
-- (dus altijd NULL) waarde terug, niet de oude. Gevolg: `v_affected_regels`
-- was altijd leeg, dus `inkooporder_regels.snijplan_gebruikte_lengte_cm`
-- werd NOOIT teruggezet naar 0 bij een release — een orphaned, te-hoog
-- "gebruikt"-getal bleef achter op de inkooporder_regel.
--
-- Fix: de affected regel_id's eerst ophalen via een losse SELECT-CTE (ziet
-- per definitie de pre-update staat), pas dáárna de UPDATE uitvoeren.

CREATE OR REPLACE FUNCTION release_wacht_op_inkoop_stukken(
  p_kwaliteit_code TEXT,
  p_kleur_code TEXT
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_released         INTEGER  := 0;
  v_affected_regels   BIGINT[] := ARRAY[]::BIGINT[];
  v_kleur_varianten   TEXT[];
BEGIN
  v_kleur_varianten := ARRAY[
    p_kleur_code,
    p_kleur_code || '.0',
    regexp_replace(p_kleur_code, '\.0$', '')
  ];

  WITH te_clearen AS (
    SELECT sn.id AS snijplan_id, sn.verwacht_inkooporder_regel_id AS regel_id
      FROM snijplannen sn
      JOIN order_regels orr ON orr.id = sn.order_regel_id
     WHERE sn.status                  = 'Wacht op inkoop'
       AND orr.maatwerk_kwaliteit_code = p_kwaliteit_code
       AND orr.maatwerk_kleur_code     = ANY(v_kleur_varianten)
  ),
  cleared AS (
    UPDATE snijplannen sn
       SET status = 'Wacht',
           verwacht_inkooporder_regel_id = NULL
     WHERE sn.id IN (SELECT snijplan_id FROM te_clearen)
    RETURNING sn.id
  )
  SELECT (SELECT COUNT(*) FROM cleared)::INTEGER,
         COALESCE(
           (SELECT ARRAY_AGG(DISTINCT regel_id) FROM te_clearen WHERE regel_id IS NOT NULL),
           ARRAY[]::BIGINT[]
         )
    INTO v_released, v_affected_regels;

  -- Exacte-kwaliteit-matching (zie plan-scope): een inkooporder_regel wordt
  -- in v1 maar door één (kwaliteit,kleur)-groep geclaimd, dus hier veilig op
  -- 0 terugzetten i.p.v. aftrekken.
  IF COALESCE(array_length(v_affected_regels, 1), 0) > 0 THEN
    UPDATE inkooporder_regels
       SET snijplan_gebruikte_lengte_cm = 0
     WHERE id = ANY(v_affected_regels);
  END IF;

  RETURN v_released;
END;
$$;

COMMENT ON FUNCTION release_wacht_op_inkoop_stukken(TEXT, TEXT) IS
  'Mig 438/445: spiegelt release_gepland_stukken (mig 133) voor de '
  '"Wacht op inkoop"-claim — zet stukken terug naar Wacht (trigger '
  'snijplan_wacht_naar_snijden normaliseert dit verder naar Gepland) zodat '
  'auto-plan-groep ze opnieuw vanaf nul kan inplannen. Mig 445 fixte een '
  'RETURNING-bug die snijplan_gebruikte_lengte_cm nooit terugzette naar 0.';
