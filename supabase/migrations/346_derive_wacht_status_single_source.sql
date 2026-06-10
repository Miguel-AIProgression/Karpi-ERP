-- Migratie 346: order-status-ladder als single-source (ADR-0006)
--
-- Probleem: de beslissingslogica die orders.status kiest leeft inline in de
-- PL/pgSQL-runtime herbereken_wacht_status en is sinds mig 218 vijf keer
-- herschreven (218->258->269->273->275). Bij 269/273 vielen de ADR-0016-takken
-- (Wacht op maatwerk / Klaar voor picken-target) geruisloos weg -> orders
-- 2063-2067 bleven op de dode status 'Nieuw' (mig 275 r1-23). Geen test ving dit.
--
-- Fix: splits BESLISSING van DATA-VERZAMELING. derive_wacht_status() bevat alleen
-- de ladder (pure, IMMUTABLE, op primitieve inputs); herbereken_wacht_status
-- verzamelt de claim-/snijplan-state en delegeert. De ingebouwde DO-assertie
-- borgt de truthtable (incl. de regressie-cases). Gedrag identiek aan mig 275.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

-- 1) Pure beslissingsfunctie. NULL = "niet wijzigen" (reproduceert beide RETURNs
--    uit mig 275: de eindstatus-guard en de finale ELSE).
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
    WHEN p_huidig IN (
      'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
      'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
      'In pickronde', 'Deels verzonden'
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
  'Mig 346 (ADR-0006): pure order-status-ladder. NULL = niet wijzigen. '
  'Single-source van de beslissing die voorheen inline in herbereken_wacht_status '
  'stond (mig 275). Gespiegeld in _shared/order-lifecycle/derive-status.ts.';

GRANT EXECUTE ON FUNCTION derive_wacht_status(order_status, BOOLEAN, BOOLEAN, BOOLEAN)
  TO authenticated, service_role;

-- 2) Runtime: verzamel state, delegeer beslissing. Body identiek aan mig 275 r214-293
--    behalve dat de IF/ELSIF-ladder is vervangen door derive_wacht_status().
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

  -- Beslissing via single-source. NULL = niet wijzigen (zowel de eindstatus-guard
  -- als de "niets te doen"-tak uit mig 275 vallen hieronder).
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

COMMENT ON FUNCTION herbereken_wacht_status IS
  'Mig 218+258+272/273+275+346: verzamelt claim-/snijplan-state en delegeert de '
  'statuskeuze aan derive_wacht_status() (single-source). Schrijft via '
  '_apply_transitie. Gedrag identiek aan mig 275.';

-- 3) Assertie ("test"): de truthtable. Vóór CREATE faalt dit; erna moet het slagen.
--    Dezelfde combinaties staan in derive-status.golden.json (TS-spiegel).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- huidig,               io,    tekort, maatwerk, verwacht (NULL = no-op)
      ('Nieuw'::order_status,            false, false, false, 'Klaar voor picken'::order_status), -- regressie-case 2063-2067
      ('Nieuw'::order_status,            false, false, true,  'Wacht op maatwerk'::order_status), -- verloren ADR-0016-tak
      ('Nieuw'::order_status,            true,  false, false, 'Wacht op inkoop'::order_status),
      ('Nieuw'::order_status,            false, true,  false, 'Wacht op voorraad'::order_status),
      ('Nieuw'::order_status,            true,  true,  true,  'Wacht op inkoop'::order_status),   -- prioriteit io > tekort > maatwerk
      ('Wacht op maatwerk'::order_status,false, false, false, 'Klaar voor picken'::order_status), -- maatwerk opgelost
      ('Wacht op inkoop'::order_status,  true,  false, false, 'Wacht op inkoop'::order_status),   -- her-apply zelfde status
      ('Klaar voor picken'::order_status,false, false, false, NULL::order_status),                -- no-op
      ('Verzonden'::order_status,        true,  true,  true,  NULL::order_status),                -- eindstatus-guard wint
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
  RAISE NOTICE 'Mig 346: alle derive_wacht_status-asserties geslaagd';
END $$;

NOTIFY pgrst, 'reload schema';
