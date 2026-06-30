-- Migratie 540: concept-intake-gate Fase A — lekken dichten
--
-- 'Concept' bestaat al in order_status (mig 308) maar werd behandeld als
-- een normaal actieve status. Vier functies lieten Concept-orders door:
--
--   Lek 1 — derive_wacht_status(): 'Concept' stond niet in de no-touch WHEN-lijst.
--            Bij io_claim=true viel het door naar branch 2 → 'Wacht op voorraad'
--            (geverifieerd via golden fixture case 11). Fix: 'Concept' toegevoegd.
--
--   Lek 2 — herallocateer_orderregel(): de Verzonden/Geannuleerd-guard liet
--            Concept-orders door → voorraadreclames werden aangemaakt.
--            Fix: RETURN-guard vóór de allocatie-logica.
--
--   Lek 3 — auto_maak_snijplan() (AFTER INSERT trigger): geen order-status-check
--            → maatwerk-snijplannen werden direct bij INSERT aangemaakt.
--            Fix: SELECT order.status; RETURN NEW als 'Concept'.
--
--   Lek 3b — auto_sync_snijplan_maten() (AFTER UPDATE trigger): de self-healing
--            fallback (v_aantal_bestaand = 0 + maten gevuld) kon snijplannen
--            aanmaken als maten werden bijgewerkt op een Concept-order.
--            Fix: zelfde Concept-guard als auto_maak_snijplan.
--
--   Lek 4 — actieve_snijgroepen() (cron sweep): WHERE filterde alleen
--            Verzonden/Geannuleerd → Concept-stukken kwamen in de herplan-sweep.
--            Fix: 'Concept' toegevoegd aan de NOT IN-lijst.
--
-- TS-spiegel (derive-status.ts) en golden fixture worden in hetzelfde commit
-- bijgewerkt (ADR-0033-verplichting). Fase B (bevestig_concept_order RPC) in mig 541.

------------------------------------------------------------------------
-- 1. derive_wacht_status — 'Concept' aan no-touch lijst toevoegen
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_wacht_status(
  p_huidig          order_status,
  p_heeft_io_claim  boolean,
  p_heeft_tekort    boolean,
  p_heeft_maatwerk  boolean
)
RETURNS order_status
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE
    -- 1) Eindstatussen + pickronde-fases + concept: door commands beheerd → no-op.
    --    'Concept' staat hier: bevestig_concept_order (mig 541) is de enige
    --    legitieme uitweg; herbereken_wacht_status mag de status NIET overschrijven.
    WHEN p_huidig IN (
      'Concept',
      'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
      'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
      'In pickronde', 'Deels verzonden', 'Maatwerk afgerond'
    ) THEN NULL
    -- 2) Inkoop-claim bestaat al → wacht op de BINNENKOMST (mig 470)
    WHEN p_heeft_io_claim   THEN 'Wacht op voorraad'::order_status
    -- 3) Vaste-maten-tekort zonder IO-claim → er moet nog een inkooporder komen (mig 470)
    WHEN p_heeft_tekort     THEN 'Wacht op inkoop'::order_status
    -- 4) Maatwerk nog niet pickbaar
    WHEN p_heeft_maatwerk   THEN 'Wacht op maatwerk'::order_status
    -- 5) Wacht-staat (of legacy 'Nieuw') zonder open blokkades → pickbaar
    WHEN p_huidig IN ('Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk', 'Nieuw')
                            THEN 'Klaar voor picken'::order_status
    -- 6) Anders: niets te doen (bv. al 'Klaar voor picken')
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.derive_wacht_status(order_status, boolean, boolean, boolean) IS
  'Mig 470: ''Wacht op inkoop'' = nog geen IO-claim, ''Wacht op voorraad'' = IO-claim '
  'bestaat al. Mig 540: ''Concept'' toegevoegd aan no-touch lijst — '
  'bevestig_concept_order (mig 541) is de enige legitieme uitweg. '
  'TS-spiegel: _shared/order-lifecycle/derive-status.ts (ADR-0033).';

-- Assertie: verify dat Concept nu NULL retourneert voor alle inputs
DO $$
DECLARE
  v_uit order_status;
BEGIN
  -- Concept + io_claim: vorige gedrag gaf 'Wacht op voorraad', nu NULL
  v_uit := derive_wacht_status('Concept'::order_status, true, false, false);
  IF v_uit IS NOT NULL THEN
    RAISE EXCEPTION 'Lek 1 niet gedicht: Concept + io_claim gaf % i.p.v. NULL', v_uit;
  END IF;

  v_uit := derive_wacht_status('Concept'::order_status, false, true, false);
  IF v_uit IS NOT NULL THEN
    RAISE EXCEPTION 'Lek 1 niet gedicht: Concept + tekort gaf % i.p.v. NULL', v_uit;
  END IF;

  v_uit := derive_wacht_status('Concept'::order_status, false, false, true);
  IF v_uit IS NOT NULL THEN
    RAISE EXCEPTION 'Lek 1 niet gedicht: Concept + maatwerk gaf % i.p.v. NULL', v_uit;
  END IF;

  v_uit := derive_wacht_status('Concept'::order_status, false, false, false);
  IF v_uit IS NOT NULL THEN
    RAISE EXCEPTION 'Lek 1 niet gedicht: Concept + leeg gaf % i.p.v. NULL', v_uit;
  END IF;

  RAISE NOTICE 'Mig 540: derive_wacht_status Concept-guard correct (4 cases NULL).';
END $$;


------------------------------------------------------------------------
-- 2. herallocateer_orderregel — Concept-guard vóór allocatie
--    BASIS: volledige body uit mig 497 (Stap 1 only), één guard toegevoegd.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION herallocateer_orderregel(p_order_regel_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $function$
DECLARE
  v_artikelnr            TEXT;
  v_te_leveren           INTEGER;
  v_is_maatwerk          BOOLEAN;
  v_order_id             BIGINT;
  v_order_status         order_status;
  v_voorraad_beschikbaar INTEGER;
  v_op_voorraad          INTEGER;
  v_resterend            INTEGER;
  v_handmatig_totaal     INTEGER;
  v_stuks_artikelnr      TEXT;
  v_stuks_per_doos       INTEGER;
BEGIN
  SELECT artikelnr, te_leveren, is_maatwerk, order_id
    INTO v_artikelnr, v_te_leveren, v_is_maatwerk, v_order_id
  FROM order_regels WHERE id = p_order_regel_id;

  IF v_order_id IS NULL THEN RETURN; END IF;

  IF v_artikelnr IS NULL OR COALESCE(v_is_maatwerk, false) = true OR COALESCE(v_te_leveren, 0) <= 0 THEN
    UPDATE order_reserveringen
       SET status = 'released', updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  SELECT status INTO v_order_status FROM orders WHERE id = v_order_id;

  -- Eindstatus-guards: verzonden/geannuleerd → claims afsluiten
  IF v_order_status IN ('Verzonden', 'Geannuleerd') THEN
    UPDATE order_reserveringen
       SET status = CASE WHEN v_order_status = 'Verzonden' THEN 'verzonden' ELSE 'released' END,
           updated_at = now()
     WHERE order_regel_id = p_order_regel_id AND status = 'actief';
    PERFORM herwaardeer_order_status(v_order_id);
    RETURN;
  END IF;

  -- Concept-guard: geen allocatie zolang de order niet bevestigd is.
  -- bevestig_concept_order (mig 541) roept na statuswijziging expliciet
  -- herallocateer_orderregel_auto aan voor alle regels.
  IF v_order_status = 'Concept' THEN
    RETURN;
  END IF;

  -- Doos→stuks vertaling (mig 408)
  SELECT stuks_artikelnr, stuks_per_doos
    INTO v_stuks_artikelnr, v_stuks_per_doos
  FROM producten WHERE artikelnr = v_artikelnr;

  IF v_stuks_artikelnr IS NOT NULL THEN
    v_artikelnr  := v_stuks_artikelnr;
    v_te_leveren := v_te_leveren * v_stuks_per_doos;
  END IF;

  -- Lock + release alleen NIET-handmatige claims
  PERFORM 1 FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false
   FOR UPDATE;

  UPDATE order_reserveringen
     SET status = 'released', updated_at = now()
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = false;

  SELECT COALESCE(SUM(aantal), 0)
    INTO v_handmatig_totaal
   FROM order_reserveringen
   WHERE order_regel_id = p_order_regel_id
     AND status = 'actief'
     AND COALESCE(is_handmatig, false) = true;

  v_resterend := GREATEST(0, v_te_leveren - v_handmatig_totaal);

  -- Stap 1: eigen voorraad — enige automatische stap in de korte vorm.
  v_voorraad_beschikbaar := voorraad_beschikbaar_voor_artikel(v_artikelnr, p_order_regel_id);
  v_op_voorraad := LEAST(v_resterend, v_voorraad_beschikbaar);

  IF v_op_voorraad > 0 THEN
    INSERT INTO order_reserveringen (order_regel_id, bron, aantal, fysiek_artikelnr)
    VALUES (p_order_regel_id, 'voorraad', v_op_voorraad, v_artikelnr);
  END IF;

  -- Resterend tekort blijft open — geen Stap 1.5/2 in deze korte vorm.

  PERFORM herwaardeer_order_status(v_order_id);
END;
$function$;


------------------------------------------------------------------------
-- 3. auto_maak_snijplan — Concept-guard vóór snijplan-aanmaak
--    BASIS: volledige body uit mig 328, Concept-check toegevoegd.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_maak_snijplan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_aantal       INTEGER;
  i              INTEGER;
  v_order_status order_status;
BEGIN
  IF NEW.is_maatwerk IS NOT TRUE
     OR NEW.maatwerk_lengte_cm  IS NULL
     OR NEW.maatwerk_breedte_cm IS NULL
  THEN
    RETURN NEW;
  END IF;

  -- Concept-guard: snijplannen worden pas aangemaakt bij bevestiging
  -- (bevestig_concept_order, mig 541 — maakt ze in een loop zelf aan).
  SELECT status INTO v_order_status FROM orders WHERE id = NEW.order_id;
  IF v_order_status = 'Concept' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM snijplannen WHERE order_regel_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_aantal := GREATEST(COALESCE(NEW.orderaantal, 1), 1);

  FOR i IN 1..v_aantal LOOP
    INSERT INTO snijplannen (
      snijplan_nr, order_regel_id,
      lengte_cm, breedte_cm,
      status, opmerkingen,
      snijden_uit_standaardmaat
    )
    VALUES (
      volgend_nummer('SNIJ'),
      NEW.id,
      NEW.maatwerk_lengte_cm::INTEGER,
      NEW.maatwerk_breedte_cm::INTEGER,
      'Wacht'::snijplan_status,
      CASE WHEN v_aantal > 1
           THEN 'Auto-aangemaakt (' || i || '/' || v_aantal || ')'
           ELSE 'Auto-aangemaakt'
      END,
      COALESCE(NEW.snijden_uit_standaardmaat, false)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_maak_snijplan() IS
  'AFTER INSERT op order_regels: maakt per maatwerk-stuk een snijplan-rij aan '
  '(ADR-0019, mig 274). Mig 328: kopieert snijden_uit_standaardmaat. '
  'Mig 540: Concept-guard — slaat snijplan-aanmaak over voor Concept-orders; '
  'bevestig_concept_order (mig 541) doet dat bij bevestiging.';


------------------------------------------------------------------------
-- 4. auto_sync_snijplan_maten — Concept-guard in self-healing fallback
--    BASIS: volledige body uit mig 328, Concept-check na is_maatwerk-guard.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_sync_snijplan_maten()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_aantal_bestaand INTEGER;
  v_aantal_target   INTEGER;
  v_geblokkeerd     INTEGER;
  i                 INTEGER;
  v_order_status    order_status;
BEGIN
  IF NEW.is_maatwerk IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Concept-guard: zelfde principe als auto_maak_snijplan.
  -- De self-healing fallback (v_aantal_bestaand = 0) mag ook voor Concept
  -- geen snijplannen aanmaken.
  SELECT status INTO v_order_status FROM orders WHERE id = NEW.order_id;
  IF v_order_status = 'Concept' THEN
    RETURN NEW;
  END IF;

  v_aantal_target := GREATEST(COALESCE(NEW.orderaantal, 1), 1);

  SELECT COUNT(*) INTO v_aantal_bestaand
    FROM snijplannen WHERE order_regel_id = NEW.id;

  -- Self-healing fallback (mig 323): nog GEEN snijplannen en beide maten gevuld
  -- → maak ze alsnog aan, ongeacht of de maten in déze update zijn veranderd.
  -- Mig 328: kopieert tevens snijden_uit_standaardmaat naar elk nieuw snijplan.
  IF v_aantal_bestaand = 0 THEN
    IF NEW.maatwerk_lengte_cm IS NOT NULL AND NEW.maatwerk_breedte_cm IS NOT NULL THEN
      FOR i IN 1..v_aantal_target LOOP
        INSERT INTO snijplannen (
          snijplan_nr, order_regel_id,
          lengte_cm, breedte_cm,
          status, opmerkingen,
          snijden_uit_standaardmaat
        )
        VALUES (
          volgend_nummer('SNIJ'),
          NEW.id,
          NEW.maatwerk_lengte_cm::INTEGER,
          NEW.maatwerk_breedte_cm::INTEGER,
          'Wacht'::snijplan_status,
          CASE WHEN v_aantal_target > 1
               THEN 'Auto-aangemaakt na update (' || i || '/' || v_aantal_target || ')'
               ELSE 'Auto-aangemaakt na update'
          END,
          COALESCE(NEW.snijden_uit_standaardmaat, false)
        );
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;

  -- Er bestaan al snijplannen: alleen iets doen als de maten daadwerkelijk wijzigen.
  IF NEW.maatwerk_lengte_cm IS NOT DISTINCT FROM OLD.maatwerk_lengte_cm
     AND NEW.maatwerk_breedte_cm IS NOT DISTINCT FROM OLD.maatwerk_breedte_cm
  THEN
    RETURN NEW;
  END IF;

  -- Maten naar NULL gezet: niets te syncen.
  IF NEW.maatwerk_lengte_cm IS NULL OR NEW.maatwerk_breedte_cm IS NULL THEN
    RETURN NEW;
  END IF;

  -- Sync: update alle snijplannen die nog veilig zijn (geen rol, status in
  -- Wacht/Gepland/Snijden). Snijplannen met rol of voorbij Snijden: WARNING.
  SELECT COUNT(*) INTO v_geblokkeerd
    FROM snijplannen
   WHERE order_regel_id = NEW.id
     AND (rol_id IS NOT NULL
          OR status NOT IN ('Wacht'::snijplan_status,
                            'Gepland'::snijplan_status,
                            'Snijden'::snijplan_status));

  IF v_geblokkeerd > 0 THEN
    RAISE WARNING
      'Snijplannen voor order_regel % gedeeltelijk NIET bijgewerkt: % stuks '
      'hebben rol of voorbij Snijden. Release + hersnijden nodig.',
      NEW.id, v_geblokkeerd;
  END IF;

  UPDATE snijplannen
     SET lengte_cm  = NEW.maatwerk_lengte_cm::INTEGER,
         breedte_cm = NEW.maatwerk_breedte_cm::INTEGER
   WHERE order_regel_id = NEW.id
     AND rol_id IS NULL
     AND status IN ('Wacht'::snijplan_status,
                    'Gepland'::snijplan_status,
                    'Snijden'::snijplan_status);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_sync_snijplan_maten() IS
  'AFTER UPDATE op order_regels: synct maatwerk-maten naar álle snijplannen '
  '(ADR-0019, mig 323 self-healing + mig 328 standaardmaat-vlag). '
  'Mig 540: Concept-guard — ook de self-healing fallback slaat Concept-orders over.';


------------------------------------------------------------------------
-- 5. actieve_snijgroepen — Concept uitsluiten uit herplan-sweep
--    BASIS: body uit mig 533, 'Concept' toegevoegd aan NOT IN.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION actieve_snijgroepen()
RETURNS TABLE(kwaliteit_code TEXT, kleur_code TEXT)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT
    sp.kwaliteit_code,
    sp.kleur_code
  FROM snijplanning_overzicht sp
  WHERE sp.order_status NOT IN ('Verzonden', 'Geannuleerd', 'Concept')
    AND sp.status IN ('Gepland', 'Wacht', 'Wacht op inkoop', 'Snijden')
    AND sp.snijden_uit_standaardmaat = FALSE
    AND sp.kwaliteit_code IS NOT NULL
    AND sp.kleur_code IS NOT NULL
  ORDER BY sp.kwaliteit_code, sp.kleur_code
$$;

COMMENT ON FUNCTION actieve_snijgroepen() IS
  'Actieve (kwaliteit, kleur)-groepen voor de herplan-sweep (mig 533). '
  'Mig 540: Concept-orders expliciet uitgesloten — snijplannen voor Concept '
  'mogen niet herplanned worden vóór bevestiging.';


NOTIFY pgrst, 'reload schema';
