-- Migratie 248: start_pickronden — één RPC vervangt twee (ADR-0012)
--
-- Achtergrond
-- -----------
-- Tot vandaag (2026-05-11) bestonden twee aparte RPC's voor pickronde-start:
--   · `start_pickronden_voor_order(order_id, picker_id)` (mig 220) — solo-pad
--   · `start_pickronden_bundel(order_ids[], picker_id)` (mig 222) — bundel-pad
--
-- Symptoom dat de Module-incoherentie blootlegde: ZEND-2026-0010 (ORD-2046,
-- FLOORPASSION 3572AC Verhoek) en ZEND-2026-0006 (ORD-2042 Verhoek-deel,
-- zelfde klant/adres/week) zijn als twee losse zendingen ontstaan terwijl
-- ADR-0010 voorschrijft dat ze één bundel-zending hadden moeten vormen. De
-- solo-RPC weet niets van de 4D-sleutel uit mig 228, dus klikken op de
-- individuele "Verzendset"-knop start een aparte zending ook als er een open
-- bundel-kandidaat in `voorgestelde_zending_bundels` ligt.
--
-- Beslissing (ADR-0012, accepted 2026-05-11):
-- ----------------------------------------------
-- Eén RPC `start_pickronden(order_ids[], picker_id, force_solo_ids[])` met
-- 4D-uitbreiding **default-on** en `force_solo_ids` als opt-out. Solo- en
-- bundel-pad zijn vanaf nu twee deelgevallen van hetzelfde RPC-contract.
--
-- Gedrag in vier stappen
-- ----------------------
--   1. **Validatie**: picker valid; alle orders bestaan; geen eindstatus-zending
--      of lopende Picken-zending voor enige order in scope.
--   2. **4D-uitbreiding**: voor elke `oid` in `p_order_ids` die NIET in
--      `p_force_solo_ids` zit — zoek alle andere orders met dezelfde
--      `bundel_sleutel(debiteur, adres-norm, vervoerder, week)` in
--      `voorgestelde_zending_bundels` (die filtert orders met actieve zending
--      al weg). Voeg ze toe. Orders in `p_force_solo_ids` worden niet
--      uitgebreid en krijgen hun eigen zending(en).
--   3. **Groepering**: per (debiteur, adres-norm, effectieve vervoerder per
--      orderregel, verzendweek, solo_marker). De `solo_marker` is `order_id`
--      voor solo-orders en `NULL` voor bundel-orders — zo isoleren solo-orders
--      automatisch van bundel-genoten met dezelfde 4D-sleutel. Per groep: één
--      zending. Multi-vervoerder-orders splitsen vanzelf over meerdere groepen
--      (zoals mig 220 deed).
--   4. **Schrijven**: per groep één rij in `zendingen` (status='Picken'), één
--      rij per orderregel in `zending_regels`, één rij per order in
--      `zending_orders` (M2M, mig 222+242 canoniek), colli's via
--      `genereer_zending_colli`.
--
-- `start_pickronde(order_id, picker_id)` blijft als dunne wrapper die naar
-- `start_pickronden([order_id], picker_id)` delegeert; nodig voor de single-id-
-- caller in `frontend/src/modules/magazijn/queries/pickronde.ts`.
--
-- De oude RPC's `start_pickronden_voor_order` en `start_pickronden_bundel`
-- worden in mig 249 gedropt zodra de frontend over is op `start_pickronden`.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

------------------------------------------------------------------------
-- 1. Hoofd-RPC: start_pickronden
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION start_pickronden(
  p_order_ids       BIGINT[],
  p_picker_id       BIGINT,
  p_force_solo_ids  BIGINT[] DEFAULT '{}'::BIGINT[]
) RETURNS TABLE (
  zending_id      BIGINT,
  zending_nr      TEXT,
  vervoerder_code TEXT,
  aantal_regels   INTEGER,
  aantal_orders   INTEGER,
  is_nieuw        BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_input_count       INTEGER;
  v_force_solo        BIGINT[];
  v_alle_orders       BIGINT[];
  v_eindstatus_nr     TEXT;
  v_eindstatus_order  BIGINT;
  v_picken_order      BIGINT;
  v_groep             RECORD;
  v_eerste_order      orders%ROWTYPE;
  v_zending_id        BIGINT;
  v_zending_nr        TEXT;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  v_input_count := COALESCE(array_length(p_order_ids, 1), 0);
  IF v_input_count = 0 THEN
    RAISE EXCEPTION 'Geen orders meegegeven aan start_pickronden'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Normaliseer p_force_solo_ids: alleen orders die OOK in p_order_ids zaten
  -- mogen geforceerd solo worden. Een force_solo_id buiten p_order_ids is
  -- betekenisloos (we breiden hem niet alsnog uit; hij telt gewoon niet mee).
  v_force_solo := COALESCE(
    (SELECT array_agg(DISTINCT fid)
       FROM unnest(COALESCE(p_force_solo_ids, '{}'::BIGINT[])) AS fid
      WHERE fid = ANY(p_order_ids)),
    '{}'::BIGINT[]
  );

  ----------------------------------------------------------------------
  -- Stap 1: 4D-uitbreiding via voorgestelde_zending_bundels
  --
  -- Voor elke order in p_order_ids die NIET force_solo is — vind alle andere
  -- orders met dezelfde 4D-bundel-sleutel die ook NIET force_solo zijn. De
  -- view filtert orders met actieve zending al weg (mig 229 r57-63), dus
  -- "auto-uitbreiding" gebeurt alleen op echt-open orders.
  --
  -- Resultaat v_alle_orders = (input - geen) ∪ (4D-partners - force_solo).
  -- Force-solo-orders blijven in de set; ze krijgen alleen geen partners.
  ----------------------------------------------------------------------
  WITH bundel_eligible AS (
    SELECT DISTINCT oid
      FROM unnest(p_order_ids) AS oid
     WHERE oid <> ALL(v_force_solo)
  ),
  uitgebreid AS (
    -- Input-orders die mogen bundelen
    SELECT oid FROM bundel_eligible
    UNION
    -- 4D-partners uit de view (alleen voor bundel-eligible input-orders)
    SELECT pid AS oid
      FROM voorgestelde_zending_bundels b
      CROSS JOIN LATERAL unnest(b.order_ids) AS pid
     WHERE b.aantal_orders >= 2
       AND b.order_ids && (SELECT array_agg(oid) FROM bundel_eligible)
       AND pid <> ALL(v_force_solo)
  )
  SELECT array_agg(DISTINCT all_oid) INTO v_alle_orders
    FROM (
      SELECT oid AS all_oid FROM uitgebreid
      UNION
      SELECT fid AS all_oid FROM unnest(v_force_solo) AS fid
    ) merged;

  IF v_alle_orders IS NULL OR array_length(v_alle_orders, 1) = 0 THEN
    -- Defensief: zou niet mogen omdat input ≥1 order had.
    RAISE EXCEPTION 'start_pickronden: geen orders in scope na uitbreiding'
      USING ERRCODE = 'no_data_found';
  END IF;

  ----------------------------------------------------------------------
  -- Stap 2: Validatie — geen eindstatus, geen lopende Picken-zending
  ----------------------------------------------------------------------
  SELECT z.zending_nr, z.order_id
    INTO v_eindstatus_nr, v_eindstatus_order
    FROM zendingen z
    JOIN zending_orders zo ON zo.zending_id = z.id
   WHERE zo.order_id = ANY(v_alle_orders)
     AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
   ORDER BY z.id DESC
   LIMIT 1;

  IF v_eindstatus_nr IS NOT NULL THEN
    RAISE EXCEPTION
      'Order % heeft al zending % in eindstatus. Annuleer of voltooi die eerst in /logistiek voor je een pickronde start.',
      v_eindstatus_order, v_eindstatus_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT zo.order_id INTO v_picken_order
    FROM zendingen z
    JOIN zending_orders zo ON zo.zending_id = z.id
   WHERE zo.order_id = ANY(v_alle_orders)
     AND z.status = 'Picken'
   LIMIT 1;

  IF v_picken_order IS NOT NULL THEN
    RAISE EXCEPTION
      'Order % heeft al een lopende pickronde. Voltooi of annuleer die eerst.',
      v_picken_order
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  ----------------------------------------------------------------------
  -- Stap 3: Groepering per (debiteur, adres-norm, vervoerder, week, solo_marker)
  --
  -- solo_marker isoleert force-solo-orders van bundel-genoten met dezelfde
  -- 4D-sleutel. Bundle-orders krijgen solo_marker=NULL en clusteren op hun
  -- 4D-sleutel; solo-orders krijgen solo_marker=order_id zodat ze altijd
  -- alleen in hun eigen groep zitten.
  --
  -- Stap 4 (zending-schrijven) gebeurt binnen dezelfde loop.
  ----------------------------------------------------------------------
  FOR v_groep IN
    WITH per_regel AS (
      SELECT
        pv.orderregel_id,
        pv.effectief_code                              AS vervoerder_code,
        pv.effectief_service                           AS service_code,
        ore.order_id,
        o.debiteur_nr,
        _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land)
                                                       AS adres_norm,
        verzendweek_voor_datum(o.afleverdatum)         AS jaar_week,
        CASE
          WHEN ore.order_id = ANY(v_force_solo) THEN ore.order_id
          ELSE NULL
        END                                            AS solo_marker
        FROM unnest(v_alle_orders) AS oid
        CROSS JOIN LATERAL effectieve_vervoerder_per_orderregel(oid) pv
        JOIN order_regels ore ON ore.id = pv.orderregel_id
        JOIN orders o ON o.id = oid
    )
    SELECT
      pr.debiteur_nr,
      pr.adres_norm,
      pr.vervoerder_code,
      pr.jaar_week,
      pr.solo_marker,
      MIN(pr.service_code)                                          AS service_code,
      array_agg(DISTINCT pr.order_id)                               AS order_ids,
      array_agg(pr.orderregel_id ORDER BY pr.orderregel_id)         AS orderregel_ids,
      COUNT(*)::INTEGER                                             AS aantal_regels,
      COUNT(DISTINCT pr.order_id)::INTEGER                          AS aantal_orders
      FROM per_regel pr
     GROUP BY pr.debiteur_nr, pr.adres_norm, pr.vervoerder_code, pr.jaar_week, pr.solo_marker
     ORDER BY pr.debiteur_nr, pr.adres_norm, pr.vervoerder_code NULLS FIRST
  LOOP
    -- Snapshot-bron: eerste order in deze groep. Bij bundels delen alle orders
    -- per definitie hetzelfde adres (zelfde adres_norm in de sleutel), dus
    -- elke keuze is equivalent.
    SELECT * INTO v_eerste_order
      FROM orders
     WHERE id = v_groep.order_ids[1];

    v_zending_nr := volgend_nummer('ZEND');

    INSERT INTO zendingen (
      zending_nr, order_id, status, picker_id, vervoerder_code, service_code,
      afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
      verzenddatum, aantal_colli, totaal_gewicht_kg
    ) VALUES (
      v_zending_nr,
      v_eerste_order.id,
      'Picken',
      p_picker_id,
      v_groep.vervoerder_code,
      v_groep.service_code,
      v_eerste_order.afl_naam, v_eerste_order.afl_adres, v_eerste_order.afl_postcode,
      v_eerste_order.afl_plaats, v_eerste_order.afl_land,
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

    -- M2M: alle betrokken orders in deze groep. Voor solo-groepen is dat 1
    -- rij; voor bundel-groepen N. trg_zending_set_m2m (mig 242) plaatst óók
    -- nog een rij voor zendingen.order_id; ON CONFLICT DO NOTHING beschermt.
    INSERT INTO zending_orders (zending_id, order_id)
    SELECT v_zending_id, ord_id FROM unnest(v_groep.order_ids) AS ord_id
    ON CONFLICT DO NOTHING;

    -- Regel-membership: één rij per orderregel in de groep.
    INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
    SELECT v_zending_id, ore.id, ore.orderaantal
      FROM order_regels ore
     WHERE ore.id = ANY(v_groep.orderregel_ids)
       AND COALESCE(ore.orderaantal, 0) > 0;

    -- SSCC-colli's. HST-dispatch vuurt pas op voltooi_pickronde (status-flip).
    PERFORM genereer_zending_colli(v_zending_id);

    RETURN QUERY SELECT
      v_zending_id,
      v_zending_nr,
      v_groep.vervoerder_code,
      v_groep.aantal_regels,
      v_groep.aantal_orders,
      TRUE AS is_nieuw;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION start_pickronden(BIGINT[], BIGINT, BIGINT[]) TO authenticated;

COMMENT ON FUNCTION start_pickronden(BIGINT[], BIGINT, BIGINT[]) IS
  'Mig 248 (ADR-0012): canonieke RPC voor pickronde-start. Vervangt '
  'start_pickronden_voor_order (mig 220) en start_pickronden_bundel (mig 222). '
  '4D-uitbreiding default-on via voorgestelde_zending_bundels; p_force_solo_ids '
  'als opt-out-escape voor expliciet-solo-orders. Groepeert orderregels op '
  '(debiteur × adres-norm × effectieve vervoerder × verzendweek × solo_marker) '
  'en creëert per groep één zending met zending_orders M2M-rijen. Multi-'
  'vervoerder-orders splitsen automatisch over meerdere groepen.';

------------------------------------------------------------------------
-- 2. start_pickronde — dunne wrapper voor single-id-callers
--
-- Backwards-compat met `useStartPickronde` in
-- frontend/src/modules/magazijn/queries/pickronde.ts. Returns zending_id van
-- de eerste groep (laagste id) zodat oude UI-paden blijven werken tot ze
-- migreren naar start_pickronden.
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
    FROM start_pickronden(ARRAY[p_order_id], p_picker_id, '{}'::BIGINT[])
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
  'Mig 248 (ADR-0012): thin wrapper over start_pickronden voor single-id-callers. '
  'Geen 4D-uitbreiding tenzij de caller migreert naar start_pickronden — input '
  'wordt direct als single-order behandeld zonder bundel-partner-zoek. Voor '
  'auto-bundeling: gebruik start_pickronden([order_id], picker_id).';

NOTIFY pgrst, 'reload schema';
