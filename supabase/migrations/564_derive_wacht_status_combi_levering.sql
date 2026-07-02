-- Migratie 564: derive_wacht_status — 5e parameter voor Combi-levering (ADR-0040)
--
-- Combi-levering krijgt de laagste prioriteit in de bestaande wacht-ladder,
-- ná de stock-/maatwerk-gates en vóór de promotie naar 'Klaar voor picken'.
-- Bewust GEEN toevoeging aan de no-touch-lijst (branch 1) — 'Wacht op
-- combi-levering' moet herhaaldelijk herevalueerbaar blijven: kan zowel
-- promoveren naar 'Klaar voor picken' (drempel gehaald + hele groep pickbaar)
-- als, symmetrisch aan het bestaande ADR-0027-claim-swap-precedent,
-- DEMOVEREN vanuit 'Klaar voor picken' als een sibling wegvalt en de groep
-- weer onder de drempel zakt. Dat is bewust gedrag, geen bug — hetzelfde
-- principe als een 'Klaar voor picken'-order die terugvalt naar 'Wacht op
-- voorraad' na een claim-swap.
--
-- Signatuurwijziging (4→5 args) vereist DROP + CREATE (mig 490-precedent:
-- CREATE OR REPLACE kan geen parameter toevoegen zonder expliciete DROP).

DROP FUNCTION IF EXISTS public.derive_wacht_status(order_status, boolean, boolean, boolean);

CREATE FUNCTION public.derive_wacht_status(
  p_huidig                   order_status,
  p_heeft_io_claim           boolean,
  p_heeft_tekort             boolean,
  p_heeft_maatwerk           boolean,
  p_wacht_op_combi_levering  boolean DEFAULT false
)
RETURNS order_status
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE
    -- 1) Eindstatussen + pickronde-fases + concept: door commands beheerd → no-op.
    WHEN p_huidig IN (
      'Concept',
      'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
      'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
      'In pickronde', 'Deels verzonden', 'Maatwerk afgerond'
    ) THEN NULL
    -- 2) Inkoop-claim bestaat al → wacht op de BINNENKOMST (mig 470)
    WHEN p_heeft_io_claim            THEN 'Wacht op voorraad'::order_status
    -- 3) Vaste-maten-tekort zonder IO-claim → er moet nog een inkooporder komen (mig 470)
    WHEN p_heeft_tekort              THEN 'Wacht op inkoop'::order_status
    -- 4) Maatwerk nog niet pickbaar
    WHEN p_heeft_maatwerk            THEN 'Wacht op maatwerk'::order_status
    -- 5) Alle stock-/productie-gates open, maar klant wacht op combi-levering (mig 564/ADR-0040)
    WHEN p_wacht_op_combi_levering   THEN 'Wacht op combi-levering'::order_status
    -- 6) Wacht-staat (of legacy 'Nieuw') zonder open blokkades → pickbaar
    WHEN p_huidig IN (
      'Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk',
      'Wacht op combi-levering', 'Nieuw'
    )                                THEN 'Klaar voor picken'::order_status
    -- 7) Anders: niets te doen (bv. al 'Klaar voor picken')
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.derive_wacht_status(order_status, boolean, boolean, boolean, boolean) IS
  'Mig 470: ''Wacht op inkoop'' = nog geen IO-claim, ''Wacht op voorraad'' = IO-claim '
  'bestaat al. Mig 540: ''Concept'' in de no-touch lijst. Mig 564 (ADR-0040): 5e '
  'parameter p_wacht_op_combi_levering — laagste-prioriteit wacht-reden, tussen de '
  'maatwerk-check en de promotie-naar-Klaar-voor-picken-tak; kan ook demoveren '
  'vanuit Klaar voor picken (symmetrisch aan ADR-0027). '
  'TS-spiegel: _shared/order-lifecycle/derive-status.ts (ADR-0033).';

-- Assertie: truthtable inclusief combi-levering (5-arg).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- huidig,                              io,    tekort, maatwerk, combi, verwacht (NULL = no-op)
      -- No-touch blijft no-touch, ook met combi=true:
      ('Verzonden'::order_status,             false, false, false, false, NULL::order_status),
      ('Verzonden'::order_status,             true,  true,  true,  true,  NULL::order_status),
      ('Concept'::order_status,               true,  false, false, true,  NULL::order_status),
      ('Geannuleerd'::order_status,           false, false, false, true,  NULL::order_status),
      ('Maatwerk afgerond'::order_status,     false, false, true,  true,  NULL::order_status),
      ('In pickronde'::order_status,          false, false, false, true,  NULL::order_status),
      ('Deels verzonden'::order_status,       false, false, false, true,  NULL::order_status),
      -- Prioriteit: io/tekort/maatwerk winnen altijd van combi:
      ('Nieuw'::order_status,                 true,  false, false, false, 'Wacht op voorraad'::order_status),
      ('Nieuw'::order_status,                 true,  false, false, true,  'Wacht op voorraad'::order_status),
      ('Nieuw'::order_status,                 false, true,  false, false, 'Wacht op inkoop'::order_status),
      ('Nieuw'::order_status,                 false, true,  false, true,  'Wacht op inkoop'::order_status),
      ('Nieuw'::order_status,                 false, false, true,  false, 'Wacht op maatwerk'::order_status),
      ('Nieuw'::order_status,                 false, false, true,  true,  'Wacht op maatwerk'::order_status),
      -- Nieuwe branch 5 — alleen combi open:
      ('Nieuw'::order_status,                 false, false, false, true,  'Wacht op combi-levering'::order_status),
      ('Nieuw'::order_status,                 false, false, false, false, 'Klaar voor picken'::order_status),
      -- Promotie vanuit elke wacht-status incl. de nieuwe:
      ('Wacht op inkoop'::order_status,       false, false, false, false, 'Klaar voor picken'::order_status),
      ('Wacht op voorraad'::order_status,     false, false, false, false, 'Klaar voor picken'::order_status),
      ('Wacht op maatwerk'::order_status,     false, false, false, false, 'Klaar voor picken'::order_status),
      ('Wacht op combi-levering'::order_status, false, false, false, false, 'Klaar voor picken'::order_status),
      -- Demotie: Klaar voor picken kan terugvallen naar combi-wacht (nieuw, bewust symmetrisch aan ADR-0027):
      ('Klaar voor picken'::order_status,     false, false, false, true,  'Wacht op combi-levering'::order_status),
      ('Klaar voor picken'::order_status,     false, false, false, false, NULL::order_status)
    ) AS t(huidig, io, tekort, maatwerk, combi, verwacht)
  LOOP
    IF derive_wacht_status(r.huidig, r.io, r.tekort, r.maatwerk, r.combi) IS DISTINCT FROM r.verwacht THEN
      RAISE EXCEPTION 'FAAL: derive_wacht_status(%, %, %, %, %) gaf % maar verwacht %',
        r.huidig, r.io, r.tekort, r.maatwerk, r.combi,
        derive_wacht_status(r.huidig, r.io, r.tekort, r.maatwerk, r.combi), r.verwacht;
    END IF;
  END LOOP;

  RAISE NOTICE 'Mig 564: alle asserties geslaagd — Combi-levering in de wacht-ladder (5-arg)';
END $$;

NOTIFY pgrst, 'reload schema';
