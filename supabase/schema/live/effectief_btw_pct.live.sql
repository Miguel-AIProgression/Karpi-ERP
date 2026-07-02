CREATE OR REPLACE FUNCTION public.effectief_btw_pct(p_verlegd boolean, p_btw_percentage numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN COALESCE(p_verlegd, FALSE) THEN 0::NUMERIC(5,2)
              ELSE COALESCE(p_btw_percentage, 21.00) END;
$function$

