CREATE OR REPLACE FUNCTION public.derive_wacht_status(p_huidig order_status, p_heeft_io_claim boolean, p_heeft_tekort boolean, p_heeft_maatwerk boolean, p_wacht_op_combi_levering boolean DEFAULT false)
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
    -- 5) Alle stock-/productie-gates open, maar klant wacht op combi-levering (mig 558/ADR-0040)
    WHEN p_wacht_op_combi_levering   THEN 'Wacht op combi-levering'::order_status
    -- 6) Wacht-staat (of legacy 'Nieuw') zonder open blokkades → pickbaar
    WHEN p_huidig IN (
      'Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk',
      'Wacht op combi-levering', 'Nieuw'
    )                                THEN 'Klaar voor picken'::order_status
    -- 7) Anders: niets te doen (bv. al 'Klaar voor picken')
    ELSE NULL
  END;
$function$

