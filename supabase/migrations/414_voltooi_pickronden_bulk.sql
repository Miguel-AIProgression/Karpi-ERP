-- 414_voltooi_pickronden_bulk.sql
-- (Hernummerd van 412 → 414 wegens collisie met 412_deelzending_vroegst_leverbaar
--  van een parallelle sessie; de functie was als 412 al op de live DB gedraaid —
--  het nummer is puur repo-administratie, de DB-staat is ongewijzigd correct.)
-- Bulk-variant van voltooi_pickronde (mig 258): rondt meerdere lopende pickrondes
-- (zendingen status 'Picken') in één call af. Aanleiding (17-06-2026): sinds we
-- vanaf Pick & Ship meerdere pickrondes tegelijk kunnen STARTEN (mig 248), wil de
-- operator de al-gepickte rondes ook in bulk op 'compleet' kunnen zetten — zonder
-- per zending de printset-pagina te openen en zonder opnieuw labels te printen.
--
-- Ontwerp: GEEN gedupliceerde voltooi-logica. Per zending roepen we de bestaande
-- voltooi_pickronde(zending_id, picker_id) aan — die is bundel-aware (leest de
-- betrokken orders uit zending_orders M2M, mig 222/242), zet de zending op
-- 'Klaar voor verzending' en flipt de order(s) via de factuur-keten naar
-- Verzonden / Deels verzonden (mig 258). Picker blijft optioneel (mig 394).
--
-- Robuustheid: elke zending krijgt een eigen BEGIN/EXCEPTION-block (impliciet
-- savepoint). Een zending met een openstaand pick-probleem (niet_gevonden colli →
-- voltooi_pickronde RAISE't 'restrict_violation') of een al-voltooide/verdwenen
-- zending (status <> 'Picken') laat de hele batch NIET falen: die rij komt terug
-- met ok=FALSE + reden, de overige zendingen worden gewoon afgerond. Zo kan de
-- operator een hele selectie indrukken en achteraf zien welke nog aandacht nodig
-- hebben. Terugdraaien = DROP FUNCTION (geen schema-wijziging, leunt volledig op
-- voltooi_pickronde).

CREATE OR REPLACE FUNCTION voltooi_pickronden(
  p_zending_ids BIGINT[],
  p_picker_id   BIGINT DEFAULT NULL
) RETURNS TABLE (
  zending_id BIGINT,
  zending_nr TEXT,
  ok         BOOLEAN,
  reden      TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
  v_nr TEXT;
BEGIN
  -- Picker éénmaal hard valideren (mig 394: NULL toegestaan = niet vastgelegd).
  -- Een niet-bestaande/inactieve picker is een caller-fout, geen per-zending-
  -- conditie — zonder deze pre-check zou élke zending in z'n eigen block falen
  -- met dezelfde melding (alle rijen ok=FALSE), wat de echte oorzaak verbergt.
  PERFORM _valideer_picker(p_picker_id);

  IF p_zending_ids IS NULL OR array_length(p_zending_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- DISTINCT: een bundel-zending hoort bij meerdere orders; de UI selecteert op
  -- order-niveau en kan dezelfde zending dus dubbel meesturen. Eén voltooiing
  -- per fysieke zending.
  FOR v_id IN SELECT DISTINCT u FROM unnest(p_zending_ids) AS u LOOP
    SELECT z.zending_nr INTO v_nr FROM zendingen z WHERE z.id = v_id;

    BEGIN
      PERFORM voltooi_pickronde(v_id, p_picker_id);
      zending_id := v_id;
      zending_nr := v_nr;
      ok         := TRUE;
      reden      := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      zending_id := v_id;
      zending_nr := v_nr;
      ok         := FALSE;
      reden      := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION voltooi_pickronden(BIGINT[], BIGINT) TO authenticated;

COMMENT ON FUNCTION voltooi_pickronden(BIGINT[], BIGINT) IS
  'Mig 414 (gedraaid als 412): bulk-afronden van meerdere pickrondes. Roept per (DISTINCT) zending '
  'voltooi_pickronde (mig 258, bundel-aware) aan met een savepoint per zending '
  'zodat een pick-probleem of al-voltooide zending de batch niet laat falen. '
  'Returnt per zending {zending_id, zending_nr, ok, reden}. Picker optioneel (mig 394).';

NOTIFY pgrst, 'reload schema';
