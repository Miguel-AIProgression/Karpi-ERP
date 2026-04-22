-- Migration 111: auto-plan triggers uitbreiden
--
-- CONTEXT
-- Migratie 100 koppelde auto-plan-groep aan INSERT op `rollen`. Dat dekt het
-- opboeken van nieuwe voorraad, maar NIET:
--   a. Nieuwe snijplannen die binnenkomen (webshop-import of handmatig) —
--      die staan in "Tekort" tot iemand handmatig auto-plan draait.
--   b. Bestaande rollen die van een niet-plannbare status (bv. In productie,
--      Gereserveerd) terug naar 'beschikbaar' of 'reststuk' gaan — dat is
--      effectief ook "nieuwe voorraad".
--
-- Beide paden leiden tot `tekortReden.kind = 'voldoende'` in de UI (sky-blauw):
-- "zou plannbaar moeten zijn, draai auto-plan opnieuw". Deze migratie sluit
-- beide gaten zodat auto-plan automatisch draait.
--
-- Patroon identiek aan migratie 100 (statement-level, pg_net, non-blocking,
-- edge function heeft eigen advisory lock).

-- ---------------------------------------------------------------------------
-- Nieuw snijplan zonder rol → auto-plan voor (kwaliteit, kleur)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trigger_auto_plan_voor_nieuwe_snijplannen()
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
    RAISE WARNING 'Auto-plan trigger (snijplannen): edge_url/auth_header ontbreken — skip.';
    RETURN NULL;
  END IF;

  FOR v_groep IN
    SELECT DISTINCT orr.maatwerk_kwaliteit_code AS kwaliteit_code,
                    orr.maatwerk_kleur_code     AS kleur_code
      FROM nieuwe_snijplannen ns
      JOIN order_regels orr ON orr.id = ns.order_regel_id
     WHERE ns.rol_id IS NULL
       AND orr.maatwerk_kwaliteit_code IS NOT NULL
       AND orr.maatwerk_kleur_code     IS NOT NULL
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
      RAISE WARNING 'Auto-plan trigger (snijplannen) faalde voor %/%: %',
        v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION trigger_auto_plan_voor_nieuwe_snijplannen() IS
  'Statement-level AFTER INSERT trigger op snijplannen: start auto-plan-groep per unieke (kwaliteit,kleur) uit de gekoppelde order_regels. Non-blocking via pg_net.';

DROP TRIGGER IF EXISTS snijplannen_auto_plan_na_insert ON snijplannen;

CREATE TRIGGER snijplannen_auto_plan_na_insert
AFTER INSERT ON snijplannen
REFERENCING NEW TABLE AS nieuwe_snijplannen
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_auto_plan_voor_nieuwe_snijplannen();


-- ---------------------------------------------------------------------------
-- Rol-status transitie naar beschikbaar/reststuk → auto-plan
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trigger_auto_plan_voor_rol_status_update()
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
    RETURN NULL;
  END IF;

  FOR v_groep IN
    SELECT DISTINCT nr.kwaliteit_code, nr.kleur_code
      FROM nieuwe_rollen  nr
      JOIN oude_rollen    oldr ON oldr.id = nr.id
     WHERE nr.status   IN ('beschikbaar', 'reststuk')
       AND oldr.status NOT IN ('beschikbaar', 'reststuk')
       AND nr.kwaliteit_code IS NOT NULL
       AND nr.kleur_code     IS NOT NULL
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
      RAISE WARNING 'Auto-plan trigger (rol status) faalde voor %/%: %',
        v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION trigger_auto_plan_voor_rol_status_update() IS
  'Statement-level AFTER UPDATE OF status trigger op rollen: start auto-plan-groep wanneer een rol transiteert naar beschikbaar/reststuk (voorraad komt terug). Non-blocking via pg_net.';

DROP TRIGGER IF EXISTS rollen_auto_plan_na_status_update ON rollen;

-- Let op: PG staat geen kolomlijst (`OF status`) toe bij transition tables.
-- De functie filtert zelf op status-transitie (oldr.status → nr.status), dus
-- de trigger mag op elke UPDATE vuren — extra rijen worden binnen de functie
-- weggefilterd met verwaarloosbare kosten.
CREATE TRIGGER rollen_auto_plan_na_status_update
AFTER UPDATE ON rollen
REFERENCING NEW TABLE AS nieuwe_rollen
            OLD TABLE AS oude_rollen
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_auto_plan_voor_rol_status_update();
