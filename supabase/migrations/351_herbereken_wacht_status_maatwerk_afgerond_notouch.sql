-- Migratie 351: 'Maatwerk afgerond' in de no-touch-lijst van herbereken_wacht_status
-- (NB: op 2026-06-10 toegepast als "mig 350", vóór hernummering wegens
--  collisie met 346_derive_wacht_status_single_source op main.)
--
-- PROBLEEM (bevinding B13, gevonden in code-review van mig 347-350): de
-- terminale status 'Maatwerk afgerond' (mig 327/330, productie-only orders)
-- ontbrak in de no-touch-lijst van herbereken_wacht_status (mig 275 — ouder
-- dan mig 327, dus de waarde bestond toen nog niet). Regressie-pad: elke
-- order_regels-touch op een afgeronde productie-only order (trigger mig 146
-- → herwaardeer_order_status → herbereken_wacht_status) vindt maatwerk-regels
-- zonder snijplan 'Ingepakt' — productie-only eindigt bewust op
-- confectie_afgerond_op, niet op 'Ingepakt' — en zet de order terug naar
-- 'Wacht op maatwerk'. De order verdwijnt daarmee uit zijn terminale staat
-- en komt nooit meer terug (voltooi_confectie wordt niet opnieuw aangeroepen).
--
-- FIX: body byte-voor-byte mig 275 r214-293, met 'Maatwerk afgerond'
-- toegevoegd aan de eindstatus-guard.
--
-- LET OP: het parallelle "order-status single-source"-werk (mig 346 op main)
-- delegeert herbereken_wacht_status aan de pure derive_wacht_status — die de
-- B13-guard NIET had. Deze migratie (toegepast ná hun 346) herstelde tijdelijk
-- de inline vorm; mig 352 verenigt beide: delegatie hersteld mét 'Maatwerk
-- afgerond' in de pure functie. Eindtoestand = mig 352.
--
-- Follow-up (B14, bewust niet hier): sync_order_afleverdatum_met_claims
-- (mig 298) mist 'Maatwerk afgerond' eveneens in zijn eindstatus-lijst;
-- laag risico (maatwerk reserveert niet op IO in V1) — meenemen bij de
-- eerstvolgende herdefinitie van die functie.
--
-- Idempotent via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION herbereken_wacht_status(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig         order_status;
  v_heeft_io_claim BOOLEAN;
  v_heeft_tekort   BOOLEAN;
  v_heeft_maatwerk BOOLEAN;
  v_doel           order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;

  -- Eindstatussen + pickronde-fases worden door commands beheerd
  -- (markeer_verzonden, markeer_geannuleerd, markeer_pickronde_gestart,
  -- markeer_deels_verzonden, voltooi_confectie-na-stap). Recompute raakt ze
  -- niet aan. Legacy productie-statussen blijven ook ongemoeid voor
  -- pragmatisch pad (mig 218). Mig 351: + 'Maatwerk afgerond' (terminaal,
  -- productie-only — ontbrak omdat mig 275 ouder is dan mig 327).
  IF v_huidig IN (
    'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
    'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
    'In pickronde', 'Deels verzonden', 'Maatwerk afgerond'
  ) THEN
    RETURN;
  END IF;

  -- 1) Inkoop-claim
  SELECT EXISTS (
    SELECT 1 FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    WHERE oreg.order_id = p_order_id
      AND r.bron = 'inkooporder_regel'
      AND r.status = 'actief'
  ) INTO v_heeft_io_claim;

  -- 2) Voorraad-tekort (alleen vaste-maten, geen admin-pseudo's)
  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = false
      AND oreg.artikelnr IS NOT NULL
      AND NOT is_admin_pseudo(oreg.artikelnr)
      AND oreg.te_leveren > COALESCE((
        SELECT SUM(aantal) FROM order_reserveringen r
        WHERE r.order_regel_id = oreg.id AND r.status = 'actief'
      ), 0)
  ) INTO v_heeft_tekort;

  -- 3) Maatwerk-regel zonder ingepakt snijplan = nog niet pickbaar.
  --    Pickbaar = snijplan.status='Ingepakt' (magazijnier kan meenemen).
  --    Geen snijplan + maatwerk → ook 'Wacht op maatwerk' (productie moet
  --    nog inplannen).
  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = true
      AND NOT EXISTS (
        SELECT 1 FROM snijplannen sp
        WHERE sp.order_regel_id = oreg.id
          AND sp.status = 'Ingepakt'
      )
  ) INTO v_heeft_maatwerk;

  IF v_heeft_io_claim THEN
    v_doel := 'Wacht op inkoop';
  ELSIF v_heeft_tekort THEN
    v_doel := 'Wacht op voorraad';
  ELSIF v_heeft_maatwerk THEN
    v_doel := 'Wacht op maatwerk';
  ELSIF v_huidig IN ('Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk', 'Nieuw') THEN
    v_doel := 'Klaar voor picken';
  ELSE
    RETURN; -- niets te doen (huidig is bv. al 'Klaar voor picken')
  END IF;

  PERFORM _apply_transitie(
    p_order_id   := p_order_id,
    p_event_type := 'wacht_status_herberekend',
    p_status_na  := v_doel
  );
END;
$$;

GRANT EXECUTE ON FUNCTION herbereken_wacht_status(BIGINT) TO authenticated;

COMMENT ON FUNCTION herbereken_wacht_status IS
  'Mig 218 + 258 (ADR-0016) + 272/273 (ADR-0018) + 275 + 351: leest claim-state + '
  'snijplannen + admin-pseudo-flag, kiest Wacht op inkoop / Wacht op voorraad / '
  'Wacht op maatwerk / Klaar voor picken, schrijft via _apply_transitie. '
  'Eindstatussen (incl. Maatwerk afgerond, mig 351) + pickronde-fases '
  '(In pickronde, Deels verzonden) en legacy productie-statussen worden niet '
  'aangeraakt. Admin-pseudo-orderregels (is_admin_pseudo) tellen NIET mee voor '
  'tekort-detectie.';

-- Zelf-test: de no-touch-lijst bevat de terminale productie-only-status, en
-- SECURITY DEFINER (218_z) is niet weggevallen door de CREATE OR REPLACE...
-- LET OP: CREATE OR REPLACE reset functie-attributen — daarom hieronder
-- expliciet opnieuw zetten (zelfde les als 218_z).
ALTER FUNCTION herbereken_wacht_status(BIGINT) SECURITY DEFINER;
ALTER FUNCTION herbereken_wacht_status(BIGINT) SET search_path = public;

DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('herbereken_wacht_status(BIGINT)'::regprocedure);
BEGIN
  IF v_def NOT LIKE '%''Maatwerk afgerond''%' THEN
    RAISE EXCEPTION 'Mig 351: no-touch-lijst mist Maatwerk afgerond';
  END IF;
  IF v_def NOT LIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION 'Mig 351: SECURITY DEFINER ontbreekt (218_z-attribuut weggevallen)';
  END IF;
  RAISE NOTICE 'Mig 351: alle asserties geslaagd — Maatwerk afgerond is no-touch';
END $$;

NOTIFY pgrst, 'reload schema';
