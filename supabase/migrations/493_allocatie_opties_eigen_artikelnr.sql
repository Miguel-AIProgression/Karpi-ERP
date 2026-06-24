-- Mig 493: allocatie_opties_voor_artikel krijgt een extra kolom
-- `eigen_artikelnr` (constante waarde over alle rijen) zodat de frontend
-- zonder eigen doos→stuks-herleiding kan groeperen in de 3 optie-soorten:
-- "eigen artikel wacht op inkoop" = rijen waar artikelnr = eigen_artikelnr,
-- de rest (voorraad + equivalent-IO) is per definitie nooit gelijk
-- (allocatie_opties_voor_artikel filtert al op artikelnr <> v_eigen_artikelnr
-- voor die twee groepen). Voorkomt dat de frontend de doos→stuks-vertaling
-- (mig 408) zou moeten dupliceren om "is dit mijn eigen artikel?" te bepalen.
--
-- RETURNS TABLE-kolomwijziging → DROP + CREATE (CREATE OR REPLACE kan de
-- return-rijtype-samenstelling niet wijzigen).

DROP FUNCTION IF EXISTS allocatie_opties_voor_artikel(TEXT);

CREATE FUNCTION allocatie_opties_voor_artikel(p_artikelnr TEXT)
RETURNS TABLE(
  bron TEXT,
  artikelnr TEXT,
  omschrijving TEXT,
  inkooporder_regel_id BIGINT,
  vrij_aantal INTEGER,
  verwacht_datum DATE,
  eigen_artikelnr TEXT
)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_eigen_artikelnr    TEXT;
  v_stuks_artikelnr    TEXT;
  v_kleur_code         TEXT;
  v_collectie_id       BIGINT;
  v_breedte_cm         INTEGER;
  v_lengte_cm          INTEGER;
  v_maatwerk_vorm_code TEXT;
BEGIN
  SELECT p0.stuks_artikelnr INTO v_stuks_artikelnr
    FROM producten p0 WHERE p0.artikelnr = p_artikelnr;
  v_eigen_artikelnr := COALESCE(v_stuks_artikelnr, p_artikelnr);

  -- Optie 2: eigen artikel, open inkoop met ETA.
  RETURN QUERY
  SELECT 'inkooporder_regel'::TEXT, v_eigen_artikelnr, p.omschrijving,
         ir.id, io_regel_ruimte(ir.id), io.verwacht_datum, v_eigen_artikelnr
    FROM inkooporder_regels ir
    JOIN inkooporders io ON io.id = ir.inkooporder_id
    JOIN producten p ON p.artikelnr = ir.artikelnr
   WHERE ir.artikelnr = v_eigen_artikelnr
     AND ir.eenheid = 'stuks'
     AND io.status IN ('Besteld', 'Deels ontvangen')
     AND io_regel_ruimte(ir.id) > 0
   ORDER BY io.verwacht_datum NULLS LAST;

  SELECT p.kleur_code, k.collectie_id, p.breedte_cm, p.lengte_cm, p.maatwerk_vorm_code
    INTO v_kleur_code, v_collectie_id, v_breedte_cm, v_lengte_cm, v_maatwerk_vorm_code
    FROM producten p
    LEFT JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE p.artikelnr = v_eigen_artikelnr;

  IF v_collectie_id IS NULL OR v_kleur_code IS NULL THEN
    RETURN;
  END IF;

  -- Optie 1: equivalent, nu op voorraad.
  RETURN QUERY
  SELECT 'voorraad'::TEXT, p.artikelnr, p.omschrijving,
         NULL::BIGINT, p.vrije_voorraad, NULL::DATE, v_eigen_artikelnr
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE k.collectie_id = v_collectie_id
     AND p.kleur_code    = v_kleur_code
     AND p.breedte_cm    = v_breedte_cm
     AND p.lengte_cm     = v_lengte_cm
     AND p.artikelnr    <> v_eigen_artikelnr
     AND p.actief        = true
     AND p.vrije_voorraad > 0
     AND p.maatwerk_vorm_code IS NOT DISTINCT FROM v_maatwerk_vorm_code
   ORDER BY p.vrije_voorraad DESC;

  -- Optie 3: equivalent, wacht op zíjn eigen inkoop met ETA.
  RETURN QUERY
  SELECT 'inkooporder_regel'::TEXT, p.artikelnr, p.omschrijving,
         ir.id, io_regel_ruimte(ir.id), io.verwacht_datum, v_eigen_artikelnr
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
    JOIN inkooporder_regels ir ON ir.artikelnr = p.artikelnr
    JOIN inkooporders io ON io.id = ir.inkooporder_id
   WHERE k.collectie_id = v_collectie_id
     AND p.kleur_code    = v_kleur_code
     AND p.breedte_cm    = v_breedte_cm
     AND p.lengte_cm     = v_lengte_cm
     AND p.artikelnr    <> v_eigen_artikelnr
     AND p.actief        = true
     AND p.maatwerk_vorm_code IS NOT DISTINCT FROM v_maatwerk_vorm_code
     AND ir.eenheid      = 'stuks'
     AND io.status IN ('Besteld', 'Deels ontvangen')
     AND io_regel_ruimte(ir.id) > 0
   ORDER BY io.verwacht_datum NULLS LAST;
END;
$function$;
