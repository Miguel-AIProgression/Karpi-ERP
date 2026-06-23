-- Migratie 470: betekenis van order_status 'Wacht op inkoop' / 'Wacht op voorraad' omdraaien
--
-- Achtergrond
-- -----------
-- Gebruiker beschreef de gewenste order-workflow en verwachtte:
--   'Wacht op inkoop'   = er is nog GEEN inkooporder, er moet één aangemaakt worden
--   'Wacht op voorraad' = er IS al een inkooporder-claim, wacht alleen op binnenkomst
--
-- De live `derive_wacht_status()` (mig 346/352, single source of truth) deed
-- precies het omgekeerde:
--   heeft_io_claim (= er IS al een IO-claim)      -> 'Wacht op inkoop'
--   heeft_tekort zonder IO-claim (= GEEN IO nog)  -> 'Wacht op voorraad'
--
-- Deze migratie draait de twee return-waarden om, draait de enige andere
-- live plek die hier specifiek op filtert (`trg_io_regel_insert_swap_evaluate`,
-- mig 297) in lockstep mee, en backfilt bestaande orders zodat de zichtbare
-- status ook voor reeds bestaande orders meteen de nieuwe betekenis draagt.
--
-- NIET aangeraakt (bewust): de `snijplan_status`-enum heeft toevallig ook een
-- waarde 'Wacht op inkoop' (mig 437-445) — dat is een volledig los enum-type
-- voor een ander concept (snijplan-niveau IO-koppeling, zie mig 437-445) en
-- blijft ongewijzigd. Mig 145/153's directe `UPDATE orders SET status = ...`
-- in oudere `herwaardeer_order_status`-versies zijn dode code — die functie
-- is sindsdien herschreven om te delegeren naar `herbereken_wacht_status()` →
-- `derive_wacht_status()` (geverifieerd via live pg_get_functiondef).

------------------------------------------------------------------------
-- 1. derive_wacht_status: branches 2 en 3 omdraaien
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_wacht_status(p_huidig order_status, p_heeft_io_claim boolean, p_heeft_tekort boolean, p_heeft_maatwerk boolean)
 RETURNS order_status
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE
    -- 1) Eindstatussen + pickronde-fases: door commands/legacy beheerd -> no-op.
    WHEN p_huidig IN (
      'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
      'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
      'In pickronde', 'Deels verzonden', 'Maatwerk afgerond'
    ) THEN NULL
    -- 2) Inkoop-claim bestaat al -> wacht op de BINNENKOMST (mig 470: was 'Wacht op inkoop')
    WHEN p_heeft_io_claim   THEN 'Wacht op voorraad'::order_status
    -- 3) Vaste-maten-tekort zonder IO-claim -> er moet nog een inkooporder komen (mig 470: was 'Wacht op voorraad')
    WHEN p_heeft_tekort     THEN 'Wacht op inkoop'::order_status
    -- 4) Maatwerk nog niet pickbaar
    WHEN p_heeft_maatwerk   THEN 'Wacht op maatwerk'::order_status
    -- 5) Wacht-staat (of legacy 'Nieuw') zonder open blokkades -> pickbaar
    WHEN p_huidig IN ('Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk', 'Nieuw')
                            THEN 'Klaar voor picken'::order_status
    -- 6) anders: niets te doen (bv. al 'Klaar voor picken')
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.derive_wacht_status(order_status, boolean, boolean, boolean) IS
  'Mig 470: ''Wacht op inkoop'' = nog geen IO-claim (moet besteld worden), '
  '''Wacht op voorraad'' = IO-claim bestaat al, wacht op levering. Omgedraaid '
  't.o.v. mig 346/352. Single source of truth — TS-spiegel in '
  '_shared/order-lifecycle/derive-status.ts moet in lockstep meebewegen '
  '(golden-fixture-contracttest, ADR-0033).';

------------------------------------------------------------------------
-- 2. trg_io_regel_insert_swap_evaluate: filter-string meedraaien
------------------------------------------------------------------------
-- Doel ongewijzigd: bij een nieuwe IO-regel alleen orderregels heralloceren
-- die nog GEEN IO-claim hebben (anders cascade-swap-risico, ADR-0027 V1).
-- Na de flip is dat de status 'Wacht op inkoop' (was 'Wacht op voorraad').
CREATE OR REPLACE FUNCTION public.trg_io_regel_insert_swap_evaluate()
RETURNS TRIGGER AS $$
DECLARE
  v_regel_id BIGINT;
BEGIN
  IF NEW.eenheid IS DISTINCT FROM 'stuks' THEN
    RETURN NEW;
  END IF;

  -- A5 fix (ADR-0027 V1 = expliciet GEEN cascade):
  --   Heralloceer alleen orderregels met daadwerkelijk dekking-tekort. Beperk
  --   tot status 'Wacht op inkoop' (mig 470: geen IO-claim, wel voorraad-
  --   tekort). Orders in 'Wacht op voorraad' hebben al een IO-claim —
  --   herevaluatie daar zou een keten van re-allocaties triggeren die
  --   feitelijk cascade-swap creëert, wat in V1 expliciet uitgesloten is.
  --   Verder: alleen regels met effectief tekort (te_leveren > SUM(actieve
  --   claims)) — anders is herallocatie idempotent maar zinloos extra werk.
  FOR v_regel_id IN
    SELECT oreg.id
      FROM order_regels oreg
      JOIN orders o ON o.id = oreg.order_id
     WHERE oreg.artikelnr = NEW.artikelnr
       AND COALESCE(oreg.is_maatwerk, false) = false
       AND COALESCE(oreg.te_leveren, 0) > 0
       AND o.status = 'Wacht op inkoop'
       AND COALESCE(oreg.te_leveren, 0) > COALESCE((
         SELECT SUM(r.aantal)
           FROM order_reserveringen r
          WHERE r.order_regel_id = oreg.id
            AND r.status = 'actief'
       ), 0)
     ORDER BY oreg.id  -- consistente volgorde → reproduceerbare uitkomst
  LOOP
    PERFORM herallocateer_orderregel(v_regel_id);
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';

------------------------------------------------------------------------
-- 3. Backfill: bestaande orders krijgen de omgewisselde status
------------------------------------------------------------------------
-- Eén atomaire UPDATE met CASE — veilig voor een 2-waarden-swap (geen
-- tussentijdse overlap zoals bij twee losse sequentiële UPDATEs).
UPDATE orders
SET status = CASE status
  WHEN 'Wacht op inkoop'::order_status   THEN 'Wacht op voorraad'::order_status
  WHEN 'Wacht op voorraad'::order_status THEN 'Wacht op inkoop'::order_status
END
WHERE status IN ('Wacht op inkoop', 'Wacht op voorraad');

------------------------------------------------------------------------
-- 4. Zelf-test (mirrort mig 352's DO-assertie, met omgedraaide verwachtingen)
------------------------------------------------------------------------
DO $$
DECLARE
  v_case RECORD;
  v_uit  order_status;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('Nieuw'::order_status,            false, false, false, 'Klaar voor picken'::order_status),
      ('Nieuw'::order_status,            false, false, true,  'Wacht op maatwerk'::order_status),
      ('Nieuw'::order_status,            true,  false, false, 'Wacht op voorraad'::order_status),
      ('Nieuw'::order_status,            false, true,  false, 'Wacht op inkoop'::order_status),
      ('Nieuw'::order_status,            true,  true,  true,  'Wacht op voorraad'::order_status),
      ('Nieuw'::order_status,            false, true,  true,  'Wacht op inkoop'::order_status),
      ('Wacht op maatwerk'::order_status,false, false, false, 'Klaar voor picken'::order_status),
      ('Wacht op voorraad'::order_status,false, false, false, 'Klaar voor picken'::order_status),
      ('Wacht op inkoop'::order_status,  true,  false, false, 'Wacht op voorraad'::order_status),
      ('Klaar voor picken'::order_status,false, false, false, NULL),
      ('Concept'::order_status,          true,  false, false, 'Wacht op voorraad'::order_status),
      ('Maatwerk afgerond'::order_status,false, false, false, NULL),
      ('Maatwerk afgerond'::order_status,false, false, true,  NULL),
      ('Maatwerk afgerond'::order_status,true,  true,  true,  NULL),
      ('Verzonden'::order_status,        true,  true,  true,  NULL),
      ('In productie'::order_status,     true,  true,  false, NULL),
      ('Klaar voor verzending'::order_status, false, true, false, NULL),
      ('In snijplan'::order_status,      false, true,  false, NULL),
      ('Deels gereed'::order_status,     true,  false, false, NULL),
      ('Wacht op picken'::order_status,  false, false, true,  NULL),
      ('Deels verzonden'::order_status,  true,  true,  true,  NULL),
      ('In pickronde'::order_status,     true,  false, false, NULL),
      ('Geannuleerd'::order_status,      false, false, false, NULL)
    ) AS t(huidig, io, tekort, maatwerk, verwacht)
  LOOP
    v_uit := derive_wacht_status(v_case.huidig, v_case.io, v_case.tekort, v_case.maatwerk);
    IF v_uit IS DISTINCT FROM v_case.verwacht THEN
      RAISE EXCEPTION 'derive_wacht_status(%, io=%, tekort=%, mw=%) gaf % i.p.v. %',
        v_case.huidig, v_case.io, v_case.tekort, v_case.maatwerk, v_uit, v_case.verwacht;
    END IF;
  END LOOP;
  RAISE NOTICE 'Migratie 470: alle 23 derive_wacht_status-cases (geflipte betekenis) geslaagd.';
END $$;

NOTIFY pgrst, 'reload schema';
