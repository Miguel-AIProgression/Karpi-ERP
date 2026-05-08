-- Migratie 220: start_pickronden_voor_order — splits per effectieve vervoerder
--
-- Achtergrond
-- -----------
-- Mig 219 introduceerde `order_regels.vervoerder_code` (per-regel override) +
-- de resolver `effectieve_vervoerder_per_orderregel`. Deze migratie sluit de
-- keten: bij start van een Pickronde maakt de order-flow nu N zendingen aan,
-- één per unieke effectieve vervoerder. De bestaande `start_pickronde` (mig
-- 218) blijft een dunne wrapper voor backward compat — hij returnt het
-- ID van de eerste zending in de set.
--
-- Datamodel-effect
-- ----------------
-- • Eén pickronde-trigger op de UI = N zendingen in DB als regels uiteenlopen
-- • Elke zending heeft `vervoerder_code` direct ingevuld bij INSERT (geen
--   afhankelijkheid meer van `selecteer_vervoerder_voor_zending` voor de
--   primaire keuze; die selector blijft nuttig voor zendingen die handmatig
--   zonder vervoerder worden aangemaakt)
-- • `zending_regels` bevat per zending alléén de regels van die groep
-- • Idempotent: bij her-aanroep worden bestaande Picken-zendingen per groep
--   hergebruikt (matched on vervoerder_code), geen duplicaten
--
-- Service-code keuze
-- ------------------
-- Binnen één groep neemt de eerste matchende regel zijn service_code mee.
-- Als regels binnen dezelfde vervoerder verschillende services produceren
-- (bv. HST KLEIN vs HST GROOT) komt dat in V1 niet terug in zending-splits —
-- alleen vervoerder-niveau splitst. Service-niveau verfijning is V2.
--
-- Idempotent.

------------------------------------------------------------------------
-- 1. Hoofd-RPC: start_pickronden_voor_order
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION start_pickronden_voor_order(
  p_order_id  BIGINT,
  p_picker_id BIGINT
) RETURNS TABLE (
  zending_id      BIGINT,
  zending_nr      TEXT,
  vervoerder_code TEXT,
  aantal_regels   INTEGER,
  is_nieuw        BOOLEAN
)
LANGUAGE plpgsql AS $$
DECLARE
  v_order       orders%ROWTYPE;
  v_groep       RECORD;
  v_zending_id  BIGINT;
  v_zending_nr  TEXT;
  v_eindstatus  TEXT;
  v_is_nieuw    BOOLEAN;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  -- Eindstatus-guard (uit mig 218): geen nieuwe pickronde als er al een
  -- zending van deze order in eindstatus zit. Operator moet eerst opruimen.
  SELECT z.zending_nr INTO v_eindstatus
    FROM zendingen z
   WHERE z.order_id = p_order_id
     AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
   ORDER BY z.id DESC LIMIT 1;

  IF v_eindstatus IS NOT NULL THEN
    RAISE EXCEPTION
      'Order % heeft al zending % in eindstatus. Annuleer of voltooi die eerst in /logistiek voor je een nieuwe pickronde start.',
      p_order_id, v_eindstatus
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Voor elke unieke effectieve vervoerder: 1 zending. NULLs vooraan zodat
  -- afhalen-/geen-vervoerder-groepen voorspelbaar terugkomen.
  FOR v_groep IN
    WITH per_regel AS (
      SELECT * FROM effectieve_vervoerder_per_orderregel(p_order_id)
    )
    SELECT
      pr.effectief_code  AS vervoerder_code,
      MIN(pr.effectief_service) AS service_code,
      array_agg(pr.orderregel_id ORDER BY pr.orderregel_id) AS orderregel_ids,
      COUNT(*)::INTEGER AS aantal_regels
    FROM per_regel pr
    GROUP BY pr.effectief_code
    ORDER BY pr.effectief_code NULLS FIRST
  LOOP
    -- Bestaande Picken-zending voor deze (order, vervoerder)? Hergebruiken.
    SELECT z.id, z.zending_nr INTO v_zending_id, v_zending_nr
      FROM zendingen z
     WHERE z.order_id = p_order_id
       AND z.status = 'Picken'
       AND z.vervoerder_code IS NOT DISTINCT FROM v_groep.vervoerder_code
     ORDER BY z.id DESC LIMIT 1;

    IF v_zending_id IS NOT NULL THEN
      v_is_nieuw := FALSE;
      UPDATE zendingen
         SET picker_id = p_picker_id
       WHERE id = v_zending_id;
      PERFORM genereer_zending_colli(v_zending_id);
    ELSE
      v_is_nieuw := TRUE;
      v_zending_nr := volgend_nummer('ZEND');

      INSERT INTO zendingen (
        zending_nr, order_id, status, picker_id, vervoerder_code, service_code,
        afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
        verzenddatum, aantal_colli, totaal_gewicht_kg
      ) VALUES (
        v_zending_nr, p_order_id, 'Picken', p_picker_id,
        v_groep.vervoerder_code, v_groep.service_code,
        v_order.afl_naam, v_order.afl_adres, v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
        CURRENT_DATE,
        (SELECT COALESCE(SUM(COALESCE(ore.orderaantal, 0)), 0)::INTEGER
           FROM order_regels ore
          WHERE ore.id = ANY(v_groep.orderregel_ids)),
        (SELECT NULLIF(
                  ROUND(COALESCE(SUM(COALESCE(ore.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0), 2),
                  0
                )
           FROM order_regels ore
          WHERE ore.id = ANY(v_groep.orderregel_ids))
      ) RETURNING id INTO v_zending_id;

      INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
      SELECT v_zending_id, ore.id, ore.orderaantal
        FROM order_regels ore
       WHERE ore.id = ANY(v_groep.orderregel_ids)
         AND COALESCE(ore.orderaantal, 0) > 0;

      PERFORM genereer_zending_colli(v_zending_id);
    END IF;

    RETURN QUERY SELECT
      v_zending_id, v_zending_nr,
      v_groep.vervoerder_code,
      v_groep.aantal_regels,
      v_is_nieuw;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION start_pickronden_voor_order(BIGINT, BIGINT) TO authenticated;

COMMENT ON FUNCTION start_pickronden_voor_order(BIGINT, BIGINT) IS
  'Mig 220: start een Pickronde voor een order en maakt N zendingen aan — '
  '1 per unieke effectieve vervoerder uit effectieve_vervoerder_per_orderregel. '
  'Returnt rij per zending met (id, nr, vervoerder, aantal_regels, is_nieuw). '
  'Idempotent: bestaande Picken-zendingen per (order,vervoerder) worden hergebruikt. '
  'Eindstatus-guard uit mig 218 blijft van kracht.';

------------------------------------------------------------------------
-- 2. start_pickronde — wrapper-pad voor backward compat
--
-- Verandert van een single-zending-implementatie naar een dunne wrapper over
-- start_pickronden_voor_order. Returnt het zending_id van de **eerste** groep
-- (alfabetisch op vervoerder_code, NULL eerst). Bestaande callers krijgen
-- hetzelfde gedrag voor single-vervoerder-orders. Bij multi-vervoerder zien
-- ze maar 1 van N zendingen — UI moet dan migreren naar
-- start_pickronden_voor_order voor volledige info.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION start_pickronde(
  p_order_id  BIGINT,
  p_picker_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_eerste_id BIGINT;
BEGIN
  SELECT zending_id INTO v_eerste_id
    FROM start_pickronden_voor_order(p_order_id, p_picker_id)
   ORDER BY zending_id ASC
   LIMIT 1;

  IF v_eerste_id IS NULL THEN
    RAISE EXCEPTION 'Order % heeft geen pickbare regels (geen zending aangemaakt)', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN v_eerste_id;
END;
$$;

GRANT EXECUTE ON FUNCTION start_pickronde(BIGINT, BIGINT) TO authenticated;

COMMENT ON FUNCTION start_pickronde(BIGINT, BIGINT) IS
  'Mig 220: thin wrapper over start_pickronden_voor_order. Returnt het '
  'zending_id van de eerste groep (laagste id). Voor multi-vervoerder-orders '
  'mist de caller de overige zendingen — gebruik start_pickronden_voor_order '
  'om alle resultaten te zien. Behouden voor backward compat met UI/tests.';

NOTIFY pgrst, 'reload schema';
