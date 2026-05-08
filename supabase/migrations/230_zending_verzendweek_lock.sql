-- Migratie 230: zendingen krijgen verzendweek-snapshot + lock op bundel-sleutel
--
-- Mig 222 bundelt orders bij pickronde-start op (debiteur + adres + vervoerder).
-- Voor week-aware bundeling (zie mig 228, 229) hebben we ook de **verzendweek**
-- als 4e dimensie nodig — als snapshot op `zendingen` zodat de wekelijkse
-- factuur-keten (mig 231-232) per week kan filteren zonder rond-rekenen via
-- `orders.afleverdatum`.
--
-- Tegelijk lossen we een latente bug op: als de afleverdatum, het
-- afleveradres of de debiteur van een order verandert NÁ pickronde-start, dan
-- klopt de zending-snapshot niet meer met de werkelijkheid (pakbon-adres ≠
-- order-adres) en zou de factuur-keten een verkeerde verzendweek toekennen.
-- Een nieuwe trigger blokkeert die mutaties zodra een actieve bundel-zending
-- bestaat.
--
-- Wijzigingen
-- -----------
-- 1. Kolom `zendingen.verzendweek TEXT` + index + backfill via M2M
-- 2. RPC `start_pickronden_bundel` validateert + schrijft week-snapshot
-- 3. RPC `start_pickronden_voor_order` schrijft week-snapshot (single-order pad)
-- 4. Trigger `trg_lock_zending_bundel_sleutel`: blokkeer
--    afleverdatum/afl_*/debiteur_nr-mutaties als order in actieve bundel zit
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP+CREATE TRIGGER.

------------------------------------------------------------------------
-- 1. zendingen.verzendweek + backfill
------------------------------------------------------------------------
ALTER TABLE zendingen
  ADD COLUMN IF NOT EXISTS verzendweek TEXT;

CREATE INDEX IF NOT EXISTS idx_zendingen_verzendweek
  ON zendingen(verzendweek)
  WHERE verzendweek IS NOT NULL;

-- Backfill: voor elke bestaande zending de verzendweek afleiden uit de eerste
-- gekoppelde order (M2M-eerste, of legacy zendingen.order_id). Eindstatus-
-- zendingen krijgen ook een week zodat de factuur-keten consistent is.
UPDATE zendingen z
   SET verzendweek = (
     SELECT verzendweek_voor_datum(o.afleverdatum)
       FROM zending_orders zo
       JOIN orders o ON o.id = zo.order_id
      WHERE zo.zending_id = z.id
        AND o.afleverdatum IS NOT NULL
      ORDER BY zo.order_id
      LIMIT 1
   )
 WHERE z.verzendweek IS NULL;

-- Fallback voor zendingen zonder M2M-rij (zou niet mogen na mig 222-backfill,
-- maar defensief).
UPDATE zendingen z
   SET verzendweek = verzendweek_voor_datum(o.afleverdatum)
  FROM orders o
 WHERE z.verzendweek IS NULL
   AND z.order_id = o.id
   AND o.afleverdatum IS NOT NULL;

COMMENT ON COLUMN zendingen.verzendweek IS
  'Mig 230: ISO-week-snapshot (YYYY-Www) van afleverdatum bij pickronde-start. '
  'Bron voor wekelijkse verzamelfactuur-aggregatie (mig 232). Onveranderlijk '
  'na pickronde-start dankzij trg_lock_zending_bundel_sleutel.';

------------------------------------------------------------------------
-- 2. start_pickronden_bundel uitbreiden — week-validatie + snapshot
------------------------------------------------------------------------
-- Volledige body opnieuw, gebaseerd op mig 222. Wijzigingen:
--   · Extra DECLARE: v_aantal_weken, v_jaar_week
--   · Extra validatie: alle orders moeten dezelfde verzendweek hebben
--   · INSERT INTO zendingen krijgt verzendweek-kolom met v_jaar_week-waarde
CREATE OR REPLACE FUNCTION start_pickronden_bundel(
  p_order_ids BIGINT[],
  p_picker_id BIGINT
) RETURNS TABLE (
  zending_id      BIGINT,
  zending_nr      TEXT,
  vervoerder_code TEXT,
  aantal_regels   INTEGER,
  aantal_orders   INTEGER,
  is_nieuw        BOOLEAN
)
LANGUAGE plpgsql AS $$
DECLARE
  v_aantal_orders     INTEGER;
  v_aantal_debs       INTEGER;
  v_aantal_adressen   INTEGER;
  v_aantal_weken      INTEGER;
  v_jaar_week         TEXT;
  v_eerste_order      orders%ROWTYPE;
  v_eindzending_nr    TEXT;
  v_eindzending_order BIGINT;
  v_picken_order      BIGINT;
  v_groep             RECORD;
  v_zending_id        BIGINT;
  v_zending_nr        TEXT;
  v_is_nieuw          BOOLEAN;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  v_aantal_orders := COALESCE(array_length(p_order_ids, 1), 0);
  IF v_aantal_orders = 0 THEN
    RAISE EXCEPTION 'Geen orders meegegeven aan start_pickronden_bundel'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Single-order pad delegeert naar mig 220 (die ook de week-snapshot zet
  -- sinds onderstaande wijziging in dezelfde migratie).
  IF v_aantal_orders = 1 THEN
    RETURN QUERY
    SELECT spv.zending_id, spv.zending_nr, spv.vervoerder_code,
           spv.aantal_regels, 1::INTEGER AS aantal_orders, spv.is_nieuw
      FROM start_pickronden_voor_order(p_order_ids[1], p_picker_id) spv;
    RETURN;
  END IF;

  -- Validatie: zelfde debiteur over alle orders.
  SELECT COUNT(DISTINCT o.debiteur_nr) INTO v_aantal_debs
    FROM orders o WHERE o.id = ANY(p_order_ids);
  IF v_aantal_debs <> 1 THEN
    RAISE EXCEPTION 'Bundel-pickronde mag alleen orders van dezelfde debiteur bevatten (gevonden: % verschillende)', v_aantal_debs
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Validatie: identiek genormaliseerd afleveradres over alle orders.
  SELECT COUNT(DISTINCT _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land))
    INTO v_aantal_adressen
    FROM orders o WHERE o.id = ANY(p_order_ids);
  IF v_aantal_adressen <> 1 THEN
    RAISE EXCEPTION 'Bundel-pickronde vereist identiek afleveradres over alle orders (gevonden: % varianten)', v_aantal_adressen
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Mig 230 — Validatie: zelfde verzendweek over alle orders.
  -- Orders zonder afleverdatum mogen niet in een bundel (verzendweek is NULL),
  -- want de wekelijkse factuur-keten kan ze dan niet correct toewijzen.
  SELECT COUNT(DISTINCT verzendweek_voor_datum(o.afleverdatum)),
         MIN(verzendweek_voor_datum(o.afleverdatum))
    INTO v_aantal_weken, v_jaar_week
    FROM orders o WHERE o.id = ANY(p_order_ids);
  IF v_aantal_weken <> 1 OR v_jaar_week IS NULL THEN
    RAISE EXCEPTION 'Bundel-pickronde vereist identieke verzendweek over alle orders (gevonden: % varianten, week=%)',
      v_aantal_weken, COALESCE(v_jaar_week, '<geen>')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Validatie: geen van de orders heeft al een eindstatus-zending.
  SELECT z.zending_nr, z.order_id
    INTO v_eindzending_nr, v_eindzending_order
    FROM zendingen z
   WHERE z.order_id = ANY(p_order_ids)
     AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
   ORDER BY z.id DESC LIMIT 1;
  IF v_eindzending_nr IS NOT NULL THEN
    RAISE EXCEPTION
      'Order % heeft al zending % in eindstatus. Annuleer of voltooi die eerst voor je een bundel-pickronde start.',
      v_eindzending_order, v_eindzending_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Validatie: geen van de orders heeft al een lopende Picken-zending.
  SELECT z.order_id INTO v_picken_order
    FROM zendingen z
   WHERE z.order_id = ANY(p_order_ids)
     AND z.status = 'Picken'
   LIMIT 1;
  IF v_picken_order IS NOT NULL THEN
    RAISE EXCEPTION
      'Order % heeft al een lopende pickronde. Voltooi of annuleer die eerst.',
      v_picken_order
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_eerste_order FROM orders WHERE id = p_order_ids[1];
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_ids[1];
  END IF;

  FOR v_groep IN
    WITH per_regel AS (
      SELECT pv.orderregel_id,
             pv.effectief_code   AS vervoerder_code,
             pv.effectief_service AS service_code,
             ore.order_id
        FROM unnest(p_order_ids) AS oid
        CROSS JOIN LATERAL effectieve_vervoerder_per_orderregel(oid) pv
        JOIN order_regels ore ON ore.id = pv.orderregel_id
    )
    SELECT
      pr.vervoerder_code,
      MIN(pr.service_code)                                    AS service_code,
      array_agg(pr.orderregel_id ORDER BY pr.orderregel_id)   AS orderregel_ids,
      COUNT(*)::INTEGER                                       AS aantal_regels,
      array_agg(DISTINCT pr.order_id)                         AS order_ids,
      COUNT(DISTINCT pr.order_id)::INTEGER                    AS aantal_orders
    FROM per_regel pr
    GROUP BY pr.vervoerder_code
    ORDER BY pr.vervoerder_code NULLS FIRST
  LOOP
    v_is_nieuw   := TRUE;
    v_zending_nr := volgend_nummer('ZEND');

    INSERT INTO zendingen (
      zending_nr, order_id, status, picker_id, vervoerder_code, service_code,
      afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
      verzenddatum, verzendweek, aantal_colli, totaal_gewicht_kg
    ) VALUES (
      v_zending_nr, v_eerste_order.id, 'Picken', p_picker_id,
      v_groep.vervoerder_code, v_groep.service_code,
      v_eerste_order.afl_naam, v_eerste_order.afl_adres, v_eerste_order.afl_postcode,
      v_eerste_order.afl_plaats, v_eerste_order.afl_land,
      CURRENT_DATE, v_jaar_week,
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

    INSERT INTO zending_orders (zending_id, order_id)
    SELECT v_zending_id, ord_id FROM unnest(v_groep.order_ids) AS ord_id
    ON CONFLICT DO NOTHING;

    INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
    SELECT v_zending_id, ore.id, ore.orderaantal
      FROM order_regels ore
     WHERE ore.id = ANY(v_groep.orderregel_ids)
       AND COALESCE(ore.orderaantal, 0) > 0;

    PERFORM genereer_zending_colli(v_zending_id);

    RETURN QUERY SELECT
      v_zending_id, v_zending_nr,
      v_groep.vervoerder_code,
      v_groep.aantal_regels,
      v_groep.aantal_orders,
      v_is_nieuw;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION start_pickronden_bundel(BIGINT[], BIGINT) TO authenticated;

COMMENT ON FUNCTION start_pickronden_bundel(BIGINT[], BIGINT) IS
  'Mig 230 (week-aware): bundel-pickronde over meerdere orders. Vereist '
  'identieke debiteur, afleveradres én verzendweek (mig 230). Per groep van '
  'effectieve vervoerder ontstaat 1 zending — gekoppeld aan alle betrokken '
  'orders via zending_orders M2M. Schrijft `verzendweek` als snapshot op '
  '`zendingen` zodat de wekelijkse verzamelfactuur (mig 232) per week kan '
  'aggregeren.';

------------------------------------------------------------------------
-- 3. start_pickronden_voor_order — week-snapshot ook in single-order pad
------------------------------------------------------------------------
-- We patchen de bestaande RPC niet via DROP+CREATE want de signature
-- verandert niet; we doen alleen een targeted UPDATE op zendingen.verzendweek
-- net na de INSERT via een tweede statement. Dat vereist een wrapper.
--
-- Eenvoudiger: laat start_pickronden_voor_order ongemoeid (mig 220 schrijft
-- nu nog geen verzendweek), maar voeg een AFTER-trigger toe op zendingen
-- die de verzendweek vult uit de eerste gekoppelde order. Dat dekt OOK
-- legacy-paden die niet via deze twee RPCs lopen (bv. create_zending_voor_order
-- in mig 206).
CREATE OR REPLACE FUNCTION trg_zending_set_verzendweek()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_week TEXT;
BEGIN
  -- Alleen vullen als nog niet handmatig gezet (start_pickronden_bundel zet hem
  -- al expliciet uit v_jaar_week — dan is NEW.verzendweek niet NULL).
  IF NEW.verzendweek IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Probeer eerste order via M2M; valt terug op zendingen.order_id voor
  -- legacy-paden (zending_orders is pas in mig 222 gekomen).
  SELECT verzendweek_voor_datum(o.afleverdatum)
    INTO v_week
    FROM zending_orders zo
    JOIN orders o ON o.id = zo.order_id
   WHERE zo.zending_id = NEW.id
     AND o.afleverdatum IS NOT NULL
   ORDER BY zo.order_id
   LIMIT 1;

  IF v_week IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT verzendweek_voor_datum(o.afleverdatum)
      INTO v_week
      FROM orders o
     WHERE o.id = NEW.order_id
       AND o.afleverdatum IS NOT NULL;
  END IF;

  NEW.verzendweek := v_week;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_zending_set_verzendweek_b_ins ON zendingen;
CREATE TRIGGER trg_zending_set_verzendweek_b_ins
  BEFORE INSERT ON zendingen
  FOR EACH ROW
  EXECUTE FUNCTION trg_zending_set_verzendweek();

COMMENT ON FUNCTION trg_zending_set_verzendweek IS
  'Mig 230: vult zendingen.verzendweek bij INSERT als hij nog NULL is. '
  'start_pickronden_bundel zet hem al expliciet; deze trigger dekt single-'
  'order paden (start_pickronden_voor_order, create_zending_voor_order).';

------------------------------------------------------------------------
-- 4. Lock op bundel-sleutel-mutatie zodra actieve zending bestaat
------------------------------------------------------------------------
-- Wijziging van afleverdatum/afl_*/debiteur_nr verandert de bundel-sleutel.
-- Voor orders zonder zending mag dat (view herevalueert vanzelf). Voor orders
-- in een actieve bundel-zending (Klaar voor verzending+) zou het de pakbon-
-- snapshot van de werkelijkheid laten divergeren én de wekelijkse
-- factuur-keten een verkeerde week toekennen — dus blokkeren.
--
-- We laten Picken-zendingen er bewust uit: tijdens picken kan de operator nog
-- bewust splitsen (pickronde annuleren + opnieuw starten). Pas vanaf 'Klaar
-- voor verzending' is de pakbon naar buiten en zijn bundel-mutaties
-- destructief.
CREATE OR REPLACE FUNCTION trg_lock_zending_bundel_sleutel()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM zending_orders zo
      JOIN zendingen z ON z.id = zo.zending_id
     WHERE zo.order_id = NEW.id
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
  ) OR EXISTS (
    -- Defensief: legacy zendingen zonder M2M-rij (zou niet mogen na mig 222
    -- backfill, maar als ze toch ontstaan moeten ze hier ook locken).
    SELECT 1
      FROM zendingen z
     WHERE z.order_id = NEW.id
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
  ) THEN
    RAISE EXCEPTION
      'Order % is gelocked: actieve bundel-zending bestaat al — wijziging van afleverdatum/afleveradres/debiteur niet toegestaan',
      NEW.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lock_zending_bundel_sleutel_b_upd ON orders;
CREATE TRIGGER trg_lock_zending_bundel_sleutel_b_upd
  BEFORE UPDATE OF afleverdatum, afl_adres, afl_postcode, afl_land, afl_naam,
                   afl_plaats, debiteur_nr ON orders
  FOR EACH ROW
  WHEN (
    NEW.afleverdatum IS DISTINCT FROM OLD.afleverdatum
    OR NEW.afl_adres IS DISTINCT FROM OLD.afl_adres
    OR NEW.afl_postcode IS DISTINCT FROM OLD.afl_postcode
    OR NEW.afl_land IS DISTINCT FROM OLD.afl_land
    OR NEW.afl_naam IS DISTINCT FROM OLD.afl_naam
    OR NEW.afl_plaats IS DISTINCT FROM OLD.afl_plaats
    OR NEW.debiteur_nr IS DISTINCT FROM OLD.debiteur_nr
  )
  EXECUTE FUNCTION trg_lock_zending_bundel_sleutel();

COMMENT ON FUNCTION trg_lock_zending_bundel_sleutel IS
  'Mig 230: blokkeert mutatie van afleverdatum/afl_*/debiteur_nr op orders die '
  'in een actieve bundel-zending zitten (status Klaar voor verzending+). '
  'Voorkomt divergentie tussen pakbon-snapshot, wekelijkse factuur-week en '
  'werkelijke order-data.';

NOTIFY pgrst, 'reload schema';
