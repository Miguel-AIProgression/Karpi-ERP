CREATE OR REPLACE FUNCTION public.verzendweek_voor_datum(p_datum date)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- to_char IYYY = ISO-jaar (waar week 1 hoort), IW = ISO-weeknummer
  -- (1..53). NULL-input → NULL output zodat aanroepers expliciet kunnen
  -- filteren op orders zonder afleverdatum.
  SELECT CASE
    WHEN p_datum IS NULL THEN NULL
    ELSE to_char(p_datum, 'IYYY') || '-W' || to_char(p_datum, 'IW')
  END;
$function$

