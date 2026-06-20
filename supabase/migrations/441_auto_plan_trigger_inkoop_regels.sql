-- Migratie 441: auto-plan-groep her-triggeren op inkoop-wijzigingen
--
-- Spiegelt het bestaande pg_net-patroon op `rollen` (trigger_auto_plan_voor_
-- nieuwe_rollen / trigger_auto_plan_voor_rol_status_update, migraties 100/111):
-- nieuwe/gewijzigde rol-inkooporder_regels (eenheid='m') en geannuleerde
-- inkooporders moeten `auto-plan-groep` opnieuw aanroepen voor de betrokken
-- (kwaliteit, kleur), zodat de nieuwe "Wacht op inkoop"-claim (mig 437/438)
-- automatisch mee-herberekend wordt.
--
-- LET OP (bevestigd via live DB-inspectie): `app_config.snijplanning.
-- auto_planning` heeft vandaag wel `enabled:true` maar GEEN `edge_url`/
-- `auth_header` — exact dezelfde config die de bestaande rollen-triggers al
-- jaren laat no-oppen (RAISE WARNING + RETURN NULL). Dit is een al langer
-- bestaande, niet door deze migratie geïntroduceerde leemte. De triggers
-- hieronder activeren zichzelf zodra die config ooit gevuld wordt — tot dan
-- loopt de "Wacht op inkoop"-claim mee via de al wél actieve aanroep-paden
-- van `auto-plan-groep` (order-aanmaak, snijplan-aanmaak, de "Auto-plan
-- opnieuw draaien"-knop op de Tekort-tab).

CREATE OR REPLACE FUNCTION trigger_auto_plan_voor_nieuwe_inkoop_regels()
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
    RAISE WARNING 'Auto-plan trigger (nieuwe inkoop-regel): edge_url/auth_header ontbreken in app_config.snijplanning.auto_planning — skip.';
    RETURN NULL;
  END IF;

  FOR v_groep IN
    SELECT DISTINCT p.kwaliteit_code, p.kleur_code
      FROM nieuwe_io_regels nir
      JOIN producten p ON p.artikelnr = nir.artikelnr
     WHERE nir.eenheid = 'm'
       AND p.kwaliteit_code IS NOT NULL
       AND p.kleur_code     IS NOT NULL
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
      RAISE WARNING 'Auto-plan trigger (nieuwe inkoop-regel) faalde voor %/%: %',
        v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE TRIGGER inkooporder_regels_auto_plan_na_insert
  AFTER INSERT ON inkooporder_regels
  REFERENCING NEW TABLE AS nieuwe_io_regels
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_auto_plan_voor_nieuwe_inkoop_regels();

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_auto_plan_voor_inkoop_regel_update()
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
    SELECT DISTINCT p.kwaliteit_code, p.kleur_code
      FROM nieuwe_io_regels nir
      JOIN producten p ON p.artikelnr = nir.artikelnr
     WHERE nir.eenheid = 'm'
       AND p.kwaliteit_code IS NOT NULL
       AND p.kleur_code     IS NOT NULL
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
      RAISE WARNING 'Auto-plan trigger (inkoop-regel update) faalde voor %/%: %',
        v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$$;

-- Postgres staat geen REFERENCING-transition-tables toe in combinatie met een
-- kolomlijst (UPDATE OF ...) — vandaar AFTER UPDATE zonder kolomlijst, net als
-- de bestaande rollen_auto_plan_na_status_update-trigger (mig 111). De
-- her-planning is idempotent/goedkoop genoeg om ook op irrelevante kolom-
-- wijzigingen (bv. een notitie) te vuren.
CREATE TRIGGER inkooporder_regels_auto_plan_na_update
  AFTER UPDATE ON inkooporder_regels
  REFERENCING NEW TABLE AS nieuwe_io_regels
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_auto_plan_voor_inkoop_regel_update();

-- ---------------------------------------------------------------------------
-- inkooporders.status wijziging (o.a. annulering) — her-trigger alle
-- betrokken (kwaliteit, kleur)-groepen van de eenheid='m'-regels op die IO.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_auto_plan_voor_inkoop_status_wijziging()
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
    SELECT DISTINCT p.kwaliteit_code, p.kleur_code
      FROM nieuwe_inkooporders nio
      JOIN oude_inkooporders   oio ON oio.id = nio.id
      JOIN inkooporder_regels  ir  ON ir.inkooporder_id = nio.id
      JOIN producten           p   ON p.artikelnr       = ir.artikelnr
     WHERE nio.status IS DISTINCT FROM oio.status
       AND ir.eenheid = 'm'
       AND p.kwaliteit_code IS NOT NULL
       AND p.kleur_code     IS NOT NULL
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
      RAISE WARNING 'Auto-plan trigger (inkoop-status) faalde voor %/%: %',
        v_groep.kwaliteit_code, v_groep.kleur_code, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$$;

-- Zelfde Postgres-beperking als boven: geen kolomlijst samen met transition
-- tables. AFTER UPDATE zonder kolomlijst — de functie vergelijkt zelf
-- oud vs. nieuw (spiegelt rollen_auto_plan_na_status_update, mig 111).
CREATE TRIGGER inkooporders_auto_plan_na_status_update
  AFTER UPDATE ON inkooporders
  REFERENCING OLD TABLE AS oude_inkooporders NEW TABLE AS nieuwe_inkooporders
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_auto_plan_voor_inkoop_status_wijziging();

COMMENT ON FUNCTION trigger_auto_plan_voor_nieuwe_inkoop_regels() IS
  'Mig 441: her-trigger auto-plan-groep voor de (kwaliteit,kleur) van een '
  'nieuwe rol-inkooporder_regel (eenheid=''m''). Spiegelt trigger_auto_plan_'
  'voor_nieuwe_rollen (mig 100). Inert tot app_config.snijplanning.'
  'auto_planning.edge_url/auth_header gevuld zijn (bestaande, niet hier '
  'geïntroduceerde leemte).';
