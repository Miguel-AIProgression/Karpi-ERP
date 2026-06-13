-- Migratie 352: derive_wacht_status + delegatie — 'Maatwerk afgerond' in de guard
--
-- SAMENLOOP VAN TWEE SPOREN (beide 2026-06-10):
--   * mig 346 (order-status single-source) verhuisde de ladder naar de pure
--     functie derive_wacht_status en liet herbereken_wacht_status delegeren —
--     maar de guard-lijst was de mig 275-vorm ZONDER 'Maatwerk afgerond'
--     (mig 327). De truthtable pinde alleen de all-false-combinatie; met
--     p_heeft_maatwerk=true — per definitie waar voor een afgeronde
--     productie-only order (snijplannen eindigen op confectie_afgerond_op,
--     niet 'Ingepakt') — vuurde tak 4 en regresseerde de terminale status
--     naar 'Wacht op maatwerk' (bevinding B13).
--   * mig 351 (lifecycle-hardening, toegepast als "350") fixte B13 in de
--     inline vorm en overschreef daarmee — indien mig 346 al was toegepast —
--     de delegatie in de DB.
--
-- DEZE MIGRATIE IS DE GELDENDE EINDVORM en is zelf-voldoende (werkt ongeacht
-- of mig 346 wel/niet is toegepast):
--   1. derive_wacht_status mét 'Maatwerk afgerond' in de no-touch-tak;
--   2. herbereken_wacht_status delegeert (mig 346-vorm);
--   3. SECURITY DEFINER + search_path her-gepind (218_z-les: CREATE OR
--      REPLACE reset functie-attributen);
--   4. truthtable uitgebreid met de échte B13-cases.
-- TS-spiegel (_shared/order-lifecycle/derive-status.ts) en golden-fixture
-- zijn in dezelfde commit bijgewerkt.
--
-- Idempotent: CREATE OR REPLACE + ALTER.

-- 1) Pure beslissingsfunctie. NULL = "niet wijzigen".
CREATE OR REPLACE FUNCTION derive_wacht_status(
  p_huidig         order_status,
  p_heeft_io_claim BOOLEAN,
  p_heeft_tekort   BOOLEAN,
  p_heeft_maatwerk BOOLEAN
) RETURNS order_status
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    -- 1) Eindstatussen + pickronde-fases: door commands/legacy beheerd -> no-op.
    --    Mig 352: + 'Maatwerk afgerond' (terminaal, productie-only, mig 327) —
    --    ontbrak in mig 346; zonder deze waarde wint tak 4 bij afgeronde
    --    productie-only orders (B13-regressie).
    WHEN p_huidig IN (
      'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
      'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
      'In pickronde', 'Deels verzonden', 'Maatwerk afgerond'
    ) THEN NULL
    -- 2) Inkoop-claim
    WHEN p_heeft_io_claim   THEN 'Wacht op inkoop'::order_status
    -- 3) Vaste-maten-tekort
    WHEN p_heeft_tekort     THEN 'Wacht op voorraad'::order_status
    -- 4) Maatwerk nog niet pickbaar
    WHEN p_heeft_maatwerk   THEN 'Wacht op maatwerk'::order_status
    -- 5) Wacht-staat (of legacy 'Nieuw') zonder open blokkades -> pickbaar
    WHEN p_huidig IN ('Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk', 'Nieuw')
                            THEN 'Klaar voor picken'::order_status
    -- 6) anders: niets te doen (bv. al 'Klaar voor picken')
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION derive_wacht_status(order_status, BOOLEAN, BOOLEAN, BOOLEAN) IS
  'Mig 346 + 352 (ADR-0006): pure order-status-ladder. NULL = niet wijzigen. '
  'Single-source van de beslissing; mig 352 voegt ''Maatwerk afgerond'' toe aan '
  'de eindstatus-tak (B13). Gespiegeld in _shared/order-lifecycle/derive-status.ts.';

GRANT EXECUTE ON FUNCTION derive_wacht_status(order_status, BOOLEAN, BOOLEAN, BOOLEAN)
  TO authenticated, service_role;

-- 2) Runtime: verzamel state, delegeer beslissing (mig 346-vorm, ongewijzigd).
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

  -- Beslissing via single-source. NULL = niet wijzigen.
  v_doel := derive_wacht_status(v_huidig, v_heeft_io_claim, v_heeft_tekort, v_heeft_maatwerk);

  IF v_doel IS NOT NULL THEN
    PERFORM _apply_transitie(
      p_order_id   := p_order_id,
      p_event_type := 'wacht_status_herberekend',
      p_status_na  := v_doel
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION herbereken_wacht_status(BIGINT) TO authenticated;

-- 3) 218_z-les: CREATE OR REPLACE reset SECURITY DEFINER/search_path — her-pinnen.
ALTER FUNCTION herbereken_wacht_status(BIGINT) SECURITY DEFINER;
ALTER FUNCTION herbereken_wacht_status(BIGINT) SET search_path = public;

COMMENT ON FUNCTION herbereken_wacht_status IS
  'Mig 218+258+272/273+275+346+351+352: verzamelt claim-/snijplan-state en '
  'delegeert de statuskeuze aan derive_wacht_status() (single-source, incl. '
  '''Maatwerk afgerond''-guard sinds mig 352). Schrijft via _apply_transitie. '
  'SECURITY DEFINER her-gepind (218_z).';

-- 4) Assertie: truthtable van mig 346 + de B13-cases.
DO $$
DECLARE
  r RECORD;
  v_def TEXT;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- huidig,               io,    tekort, maatwerk, verwacht (NULL = no-op)
      ('Nieuw'::order_status,            false, false, false, 'Klaar voor picken'::order_status),
      ('Nieuw'::order_status,            false, false, true,  'Wacht op maatwerk'::order_status),
      ('Nieuw'::order_status,            true,  false, false, 'Wacht op inkoop'::order_status),
      ('Nieuw'::order_status,            false, true,  false, 'Wacht op voorraad'::order_status),
      ('Nieuw'::order_status,            true,  true,  true,  'Wacht op inkoop'::order_status),
      ('Nieuw'::order_status,            false, true,  true,  'Wacht op voorraad'::order_status),
      ('Wacht op maatwerk'::order_status,false, false, false, 'Klaar voor picken'::order_status),
      ('Wacht op voorraad'::order_status,false, false, false, 'Klaar voor picken'::order_status),
      ('Wacht op inkoop'::order_status,  true,  false, false, 'Wacht op inkoop'::order_status),
      ('Klaar voor picken'::order_status,false, false, false, NULL::order_status),
      ('Concept'::order_status,          true,  false, false, 'Wacht op inkoop'::order_status),
      -- B13 (mig 351/352): afgeronde productie-only order heeft per definitie
      -- maatwerk=true — mág niet terugvallen naar 'Wacht op maatwerk'.
      ('Maatwerk afgerond'::order_status,false, false, true,  NULL::order_status),
      ('Maatwerk afgerond'::order_status,true,  true,  true,  NULL::order_status),
      ('Maatwerk afgerond'::order_status,false, false, false, NULL::order_status),
      ('Verzonden'::order_status,        true,  true,  true,  NULL::order_status),
      ('In productie'::order_status,     true,  true,  false, NULL::order_status),
      ('Klaar voor verzending'::order_status, false, true, false, NULL::order_status),
      ('In snijplan'::order_status,      false, true,  false, NULL::order_status),
      ('Deels gereed'::order_status,     true,  false, false, NULL::order_status),
      ('Wacht op picken'::order_status,  false, false, true,  NULL::order_status),
      ('Deels verzonden'::order_status,  true,  true,  true,  NULL::order_status),
      ('In pickronde'::order_status,     true,  false, false, NULL::order_status),
      ('Geannuleerd'::order_status,      false, false, false, NULL::order_status)
    ) AS t(huidig, io, tekort, maatwerk, verwacht)
  LOOP
    IF derive_wacht_status(r.huidig, r.io, r.tekort, r.maatwerk) IS DISTINCT FROM r.verwacht THEN
      RAISE EXCEPTION 'FAAL: derive_wacht_status(%, %, %, %) gaf % maar verwacht %',
        r.huidig, r.io, r.tekort, r.maatwerk,
        derive_wacht_status(r.huidig, r.io, r.tekort, r.maatwerk), r.verwacht;
    END IF;
  END LOOP;

  -- Delegatie + DEFINER-pin aanwezig?
  v_def := pg_get_functiondef('herbereken_wacht_status(BIGINT)'::regprocedure);
  IF v_def NOT LIKE '%derive_wacht_status(%' THEN
    RAISE EXCEPTION 'Mig 352: herbereken_wacht_status delegeert niet aan derive_wacht_status';
  END IF;
  IF v_def NOT LIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION 'Mig 352: SECURITY DEFINER ontbreekt op herbereken_wacht_status';
  END IF;
  RAISE NOTICE 'Mig 352: alle asserties geslaagd — single-source hersteld, Maatwerk afgerond in de guard';
END $$;

NOTIFY pgrst, 'reload schema';
