-- Migration 100: Automatische snijplanning bij nieuwe rollen --
-- Doel: wanneer rollen worden toegevoegd (opboeken/import), triggert de database
--   per unieke (kwaliteit_code, kleur_code) automatisch de auto-plan-groep edge
--   function. Zo hoeft de gebruiker niet meer handmatig te optimaliseren nadat
--   er nieuwe voorraad is binnengekomen.
--
-- Gedrag:
--   - FOR EACH STATEMENT: bij bulk-insert krijgen we 1 trigger-call per
--     (kwaliteit, kleur)-groep, niet per rij.
--   - Alleen statussen die bruikbaar zijn voor planning ('beschikbaar', 'reststuk').
--   - Check app_config.snijplanning.auto_planning.enabled — als uitgeschakeld: skip.
--   - Endpoint + auth-header worden gelezen uit app_config.snijplanning.auto_planning,
--     sleutels "edge_url" en "auth_header". Zo hoeven er géén secrets in de repo.
--   - Non-blocking: via pg_net.http_post (fire-and-forget HTTP).
--   - Edge function auto-plan-groep heeft zelf advisory lock, dus concurrent calls
--     worden veilig afgehandeld ("skipped" als al bezig).
--
-- Vereist: pg_net (al actief, zie migratie 053).
-- Na deze migratie één keer uitvoeren (met échte waarden):
--   UPDATE app_config
--      SET waarde = jsonb_set(
--                     jsonb_set(COALESCE(waarde, '{}'::jsonb),
--                               '{edge_url}', to_jsonb('https://<ref>.supabase.co/functions/v1/auto-plan-groep'::text)),
--                     '{auth_header}', to_jsonb('Bearer <publishable-key>'::text))
--    WHERE sleutel = 'snijplanning.auto_planning';

CREATE OR REPLACE FUNCTION trigger_auto_plan_voor_nieuwe_rollen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cfg   JSONB;
  v_url   TEXT;
  v_auth  TEXT;
  v_groep RECORD;
BEGIN
  SELECT waarde INTO v_cfg
    FROM app_config
   WHERE sleutel = 'snijplanning.auto_planning';

  IF v_cfg IS NULL OR COALESCE((v_cfg->>'enabled')::boolean, false) = false THEN
    RETURN NULL;
  END IF;

  v_url  := v_cfg->>'edge_url';
  v_auth := v_cfg->>'auth_header';

  IF v_url IS NULL OR v_auth IS NULL THEN
    RAISE WARNING 'Auto-plan trigger: edge_url/auth_header ontbreken in app_config.snijplanning.auto_planning — skip.';
    RETURN NULL;
  END IF;

  FOR v_groep IN
    SELECT DISTINCT kwaliteit_code, kleur_code
      FROM nieuwe_rollen
     WHERE status IN ('beschikbaar', 'reststuk')
       AND kwaliteit_code IS NOT NULL
       AND kleur_code    IS NOT NULL
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', v_auth
                   ),
        body    := jsonb_build_object(
                     'kwaliteit_code', v_groep.kwaliteit_code,
                     'kleur_code',     v_groep.kleur_code
                   )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Auto-plan trigger faalde voor %/%: %',
        v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION trigger_auto_plan_voor_nieuwe_rollen() IS
  'Statement-level AFTER INSERT trigger op rollen: start auto-plan-groep per unieke (kwaliteit,kleur) via pg_net. Leest endpoint/auth uit app_config.snijplanning.auto_planning (velden edge_url + auth_header). Non-blocking.';

DROP TRIGGER IF EXISTS rollen_auto_plan_na_insert ON rollen;

CREATE TRIGGER rollen_auto_plan_na_insert
AFTER INSERT ON rollen
REFERENCING NEW TABLE AS nieuwe_rollen
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_auto_plan_voor_nieuwe_rollen();
