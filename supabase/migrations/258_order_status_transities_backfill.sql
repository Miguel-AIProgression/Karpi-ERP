-- Migratie 258: Order-lifecycle Module — fase-uitbreiding (ADR-0016)
--
-- Bouwt op mig 257 (ENUM-uitbreiding). Voegt twee nieuwe command-RPC's toe,
-- breidt `herbereken_wacht_status` uit met maatwerk-detectie, splitst de
-- eindlogica in `voltooi_pickronde`, hookt `start_pickronden` in op de
-- `markeer_pickronde_gestart`-transitie, en backfillt bestaande `'Nieuw'`-
-- orders volgens de classificatie in ADR-0016 §"Backfill".
--
-- Schrijfpad-invariant (ADR-0006) blijft intact: alles loopt via
-- `_apply_transitie`. Factuur-trigger `enqueue_factuur_voor_event` (mig 223)
-- filtert strict op `event_type='pickronde_voltooid'`, dus de nieuwe types
-- `pickronde_gestart` / `deels_verzonden` / `backfill_fase_normalisatie`
-- triggeren géén factuur — verificatie staat in §6.
--
-- Idempotent: CREATE OR REPLACE FUNCTION; backfill via WHERE-guards op huidige
-- status zodat een tweede run niets meer doet.

------------------------------------------------------------------------
-- 1. Command — markeer_pickronde_gestart
------------------------------------------------------------------------
-- Wordt geroepen vanuit start_pickronden (zie §4) per betrokken order zodra
-- een zending in status 'Picken' aangemaakt is. Idempotent: no-op als de
-- order al in 'In pickronde' of 'Deels verzonden' staat. Faalt op
-- eindstatussen — caller moet ze er eerst uit halen.
CREATE OR REPLACE FUNCTION markeer_pickronde_gestart(
  p_order_id            BIGINT,
  p_actor_medewerker_id BIGINT DEFAULT NULL,
  p_actor_auth_user_id  UUID   DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Eindstatus-bescherming: pickronde mag niet ineens uit Verzonden of
  -- Geannuleerd komen. start_pickronden checkt dit al in zijn eigen
  -- guards, dit is defense-in-depth.
  IF v_huidig IN ('Verzonden', 'Geannuleerd') THEN
    RAISE EXCEPTION 'Order % staat op % — kan geen pickronde meer starten', p_order_id, v_huidig
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- No-op als al 'In pickronde' of 'Deels verzonden'. _apply_transitie zou
  -- dit ook silent-skippen bij gelijke status; voor 'Deels verzonden' is
  -- expliciet skippen correcter dan terug naar 'In pickronde' flippen.
  IF v_huidig IN ('In pickronde', 'Deels verzonden') THEN
    RETURN;
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'pickronde_gestart',
    p_status_na           := 'In pickronde',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION markeer_pickronde_gestart(BIGINT, BIGINT, UUID) TO authenticated;

COMMENT ON FUNCTION markeer_pickronde_gestart IS
  'Mig 258 (ADR-0016): zet orders.status=''In pickronde'' + audit-event. '
  'Caller: start_pickronden (mig 248, geüpdatet in deze mig). Idempotent: '
  'no-op op In pickronde / Deels verzonden. Faalt op Verzonden / Geannuleerd.';

------------------------------------------------------------------------
-- 2. Command — markeer_deels_verzonden
------------------------------------------------------------------------
-- Wordt geroepen vanuit voltooi_pickronde wanneer een zending wordt voltooid
-- maar de order nog open zendingen heeft. Idempotent.
CREATE OR REPLACE FUNCTION markeer_deels_verzonden(
  p_order_id            BIGINT,
  p_actor_medewerker_id BIGINT DEFAULT NULL,
  p_actor_auth_user_id  UUID   DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_huidig IN ('Verzonden', 'Geannuleerd') THEN
    RAISE EXCEPTION 'Order % staat op % — kan niet meer op Deels verzonden', p_order_id, v_huidig
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_huidig = 'Deels verzonden' THEN
    RETURN;
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'deels_verzonden',
    p_status_na           := 'Deels verzonden',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION markeer_deels_verzonden(BIGINT, BIGINT, UUID) TO authenticated;

COMMENT ON FUNCTION markeer_deels_verzonden IS
  'Mig 258 (ADR-0016): zet orders.status=''Deels verzonden'' + audit-event. '
  'Caller: voltooi_pickronde wanneer de voltooide zending niet de laatste '
  'open zending voor de order is. Idempotent. Faalt op Verzonden / Geannuleerd.';

------------------------------------------------------------------------
-- 3. Update — herbereken_wacht_status met maatwerk-detectie
------------------------------------------------------------------------
-- Volgorde (eerste match wint, eindstatussen + actieve pickronde niet aanraken):
--   1. v_huidig ∈ eindstatussen / 'In pickronde' / 'Deels verzonden' → no-op
--   2. ≥1 actieve IO-claim → 'Wacht op inkoop'         (blocking)
--   3. ≥1 regel met tekort → 'Wacht op voorraad'       (blocking)
--   4. ≥1 maatwerk-regel zonder snijplan in 'Ingepakt' → 'Wacht op maatwerk'
--   5. v_huidig ∈ ('Wacht op X', 'Nieuw') → 'Klaar voor picken'
--   6. anders → no-op
CREATE OR REPLACE FUNCTION herbereken_wacht_status(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig            order_status;
  v_heeft_io_claim    BOOLEAN;
  v_heeft_tekort      BOOLEAN;
  v_heeft_maatwerk    BOOLEAN;
  v_doel              order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;

  -- Eindstatussen + pickronde-fases worden door commands (markeer_verzonden,
  -- markeer_geannuleerd, markeer_pickronde_gestart, markeer_deels_verzonden)
  -- beheerd; recompute raakt ze niet aan. Legacy productie-statussen (mig
  -- 218 pragmatisch pad) blijven ook ongemoeid zolang ze in de praktijk
  -- voorkomen.
  IF v_huidig IN (
    'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
    'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
    'In pickronde', 'Deels verzonden'
  ) THEN
    RETURN;
  END IF;

  -- 1) Inkoop-claim
  SELECT EXISTS (
    SELECT 1 FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    WHERE oreg.order_id = p_order_id
      AND r.bron = 'inkooporder_regel'
      AND r.status = 'actief'
  ) INTO v_heeft_io_claim;

  -- 2) Voorraad-tekort (alleen vaste-maten; maatwerk wordt apart afgehandeld)
  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = false
      AND oreg.artikelnr IS NOT NULL
      AND oreg.te_leveren > COALESCE((
        SELECT SUM(aantal) FROM order_reserveringen r
        WHERE r.order_regel_id = oreg.id AND r.status = 'actief'
      ), 0)
  ) INTO v_heeft_tekort;

  -- 3) Maatwerk-regel zonder ingepakt snijplan = nog niet pickbaar.
  --    Pickbaar = snijplan.status='Ingepakt' (magazijnier kan het meenemen).
  --    Geen snijplan + maatwerk → ook 'Wacht op maatwerk' (productie moet
  --    nog inplannen).
  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = true
      AND NOT EXISTS (
        SELECT 1 FROM snijplannen sp
        WHERE sp.order_regel_id = oreg.id
          AND sp.status = 'Ingepakt'
      )
  ) INTO v_heeft_maatwerk;

  IF v_heeft_io_claim THEN
    v_doel := 'Wacht op inkoop';
  ELSIF v_heeft_tekort THEN
    v_doel := 'Wacht op voorraad';
  ELSIF v_heeft_maatwerk THEN
    v_doel := 'Wacht op maatwerk';
  ELSIF v_huidig IN ('Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk', 'Nieuw') THEN
    v_doel := 'Klaar voor picken';
  ELSE
    RETURN; -- niets te doen (huidig is bv. 'Klaar voor picken' en niets verandert)
  END IF;

  PERFORM _apply_transitie(
    p_order_id   := p_order_id,
    p_event_type := 'wacht_status_herberekend',
    p_status_na  := v_doel
  );
END;
$$;

GRANT EXECUTE ON FUNCTION herbereken_wacht_status(BIGINT) TO authenticated;

COMMENT ON FUNCTION herbereken_wacht_status IS
  'Mig 258 (ADR-0016): leest claim-state + snijplannen, kiest Wacht op inkoop / '
  'Wacht op voorraad / Wacht op maatwerk / Klaar voor picken, schrijft via '
  '_apply_transitie. Eindstatussen + pickronde-fases worden niet aangeraakt.';

------------------------------------------------------------------------
-- 4. Update — start_pickronden roept markeer_pickronde_gestart aan
------------------------------------------------------------------------
-- Volledige body van mig 248 met één toevoeging: na de zending-loop wordt
-- markeer_pickronde_gestart aangeroepen voor élke order in v_alle_orders.
-- Idempotent op order-niveau: een order die al 'In pickronde' staat krijgt
-- geen tweede transitie (zie §1 no-op).
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
  v_order_id          BIGINT;
  v_resultaten        RECORD;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  v_input_count := COALESCE(array_length(p_order_ids, 1), 0);
  IF v_input_count = 0 THEN
    RAISE EXCEPTION 'Geen orders meegegeven aan start_pickronden'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_force_solo := COALESCE(
    (SELECT array_agg(DISTINCT fid)
       FROM unnest(COALESCE(p_force_solo_ids, '{}'::BIGINT[])) AS fid
      WHERE fid = ANY(p_order_ids)),
    '{}'::BIGINT[]
  );

  WITH bundel_eligible AS (
    SELECT DISTINCT oid
      FROM unnest(p_order_ids) AS oid
     WHERE oid <> ALL(v_force_solo)
  ),
  uitgebreid AS (
    SELECT oid FROM bundel_eligible
    UNION
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
    RAISE EXCEPTION 'start_pickronden: geen orders in scope na uitbreiding'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Eindstatus-zending guard
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

  -- Lopende-Picken guard
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

  -- Hoofdgroepering — zending-aanmaak per (debiteur × adres × vervoerder × week × solo_marker)
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
    SELECT * INTO v_eerste_order FROM orders WHERE id = v_groep.order_ids[1];

    v_zending_nr := volgend_nummer('ZEND');

    INSERT INTO zendingen (
      zending_nr, order_id, status, picker_id, vervoerder_code, service_code,
      afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
      verzenddatum, aantal_colli, totaal_gewicht_kg
    ) VALUES (
      v_zending_nr, v_eerste_order.id, 'Picken', p_picker_id,
      v_groep.vervoerder_code, v_groep.service_code,
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
      TRUE AS is_nieuw;
  END LOOP;

  -- ADR-0016: na zending-aanmaak status per order flippen naar 'In pickronde'.
  -- Idempotent — orders die al 'In pickronde' / 'Deels verzonden' staan
  -- worden silent-skipped door markeer_pickronde_gestart.
  FOREACH v_order_id IN ARRAY v_alle_orders LOOP
    PERFORM markeer_pickronde_gestart(
      p_order_id            := v_order_id,
      p_actor_medewerker_id := p_picker_id
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION start_pickronden(BIGINT[], BIGINT, BIGINT[]) TO authenticated;

COMMENT ON FUNCTION start_pickronden(BIGINT[], BIGINT, BIGINT[]) IS
  'Mig 258 (ADR-0016): canonieke RPC voor pickronde-start, geüpdatet om '
  'orders.status naar ''In pickronde'' te flippen via markeer_pickronde_gestart '
  'na zending-aanmaak. Overige semantiek (4D-uitbreiding, groepering, '
  'zending-aanmaak) identiek aan mig 248.';

------------------------------------------------------------------------
-- 5. Update — voltooi_pickronde split tussen Verzonden en Deels verzonden
------------------------------------------------------------------------
-- Volledige body van mig 222 met één wijziging: in de FOREACH-loop kiezen we
-- per order tussen markeer_verzonden (laatste open zending) en
-- markeer_deels_verzonden (er zijn nog open zendingen).
CREATE OR REPLACE FUNCTION voltooi_pickronde(
  p_zending_id BIGINT,
  p_picker_id  BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_huidig          zending_status;
  v_aantal_niet_gev INTEGER;
  v_order_id        BIGINT;
  v_open_zendingen  INTEGER;
  v_verzonden_zend  INTEGER;
  v_bundel_orders   BIGINT[];
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  SELECT status INTO v_huidig FROM zendingen WHERE id = p_zending_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;
  IF v_huidig <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde voor zending % is niet actief (status=%)', p_zending_id, v_huidig;
  END IF;

  SELECT COUNT(*) INTO v_aantal_niet_gev
    FROM zending_colli
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'niet_gevonden';
  IF v_aantal_niet_gev > 0 THEN
    RAISE EXCEPTION 'Pickronde heeft % openstaand(e) pick-probleem(en) — los op of splits eerst',
      v_aantal_niet_gev USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE zending_colli
     SET pick_uitkomst   = 'gepickt',
         gepickt_at      = now(),
         gepickt_door_id = p_picker_id
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'open';

  UPDATE zendingen
     SET status    = 'Klaar voor verzending',
         picker_id = COALESCE(picker_id, p_picker_id)
   WHERE id = p_zending_id;

  -- Bron-orders ophalen via M2M (mig 222 canoniek)
  SELECT array_agg(order_id) INTO v_bundel_orders
    FROM zending_orders WHERE zending_id = p_zending_id;

  IF v_bundel_orders IS NULL THEN
    SELECT ARRAY[order_id] INTO v_bundel_orders
      FROM zendingen WHERE id = p_zending_id;
  END IF;

  FOREACH v_order_id IN ARRAY v_bundel_orders LOOP
    -- Tel open zendingen via beide koppelingen (M2M + legacy order_id)
    SELECT COUNT(*) INTO v_open_zendingen
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order_id
           )
       AND z.status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    -- Tel reeds-verzonden zendingen (in eindstatus) voor deze order
    SELECT COUNT(*) INTO v_verzonden_zend
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order_id
           )
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    IF NOT EXISTS (
      SELECT 1 FROM orders
       WHERE id = v_order_id
         AND status IN ('Verzonden', 'Geannuleerd')
    ) THEN
      IF v_open_zendingen = 0 THEN
        -- Laatste open zending → Verzonden (triggert factuur-keten)
        PERFORM markeer_verzonden(
          p_order_id            := v_order_id,
          p_actor_medewerker_id := p_picker_id
        );
      ELSIF v_verzonden_zend >= 1 THEN
        -- Niet-laatste zending én ≥1 zending al verzonden → Deels verzonden
        PERFORM markeer_deels_verzonden(
          p_order_id            := v_order_id,
          p_actor_medewerker_id := p_picker_id
        );
      END IF;
      -- Edge case: deze zending is nu de eerste 'Klaar voor verzending', maar
      -- v_open_zendingen telde 'Klaar voor verzending' al niet meer mee als
      -- open. Dus als v_open_zendingen > 0 én v_verzonden_zend == 1 (alleen
      -- deze net-voltooide zending), dan zijn er nog 'Picken'-zendingen.
      -- Order blijft op 'In pickronde' — geen transitie nodig. Dat klopt:
      -- markeer_deels_verzonden vereist ≥1 echte open zending én ≥1
      -- voltooide; pas wanneer de eerste niet-laatste echt de status
      -- doorzet wordt 'Deels verzonden' geschreven.
    END IF;
  END LOOP;

  RETURN p_zending_id;
END;
$$;

GRANT EXECUTE ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) TO authenticated;

COMMENT ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) IS
  'Mig 258 (ADR-0016): bundel-aware voltooien + Deels verzonden support. '
  'Per order in zending_orders M2M: laatste open zending → markeer_verzonden, '
  'niet-laatste mét ≥1 al-verzonden zending → markeer_deels_verzonden, '
  'overige → geen transitie (order blijft op In pickronde).';

------------------------------------------------------------------------
-- 6. Verificatie factuur-trigger filter (defensief)
------------------------------------------------------------------------
-- enqueue_factuur_voor_event (mig 223) filtert al strict op
-- event_type='pickronde_voltooid' AND status_na='Verzonden'. Nieuwe types
-- (pickronde_gestart, deels_verzonden, backfill_fase_normalisatie) zijn dus
-- automatisch out-of-scope. Hieronder een DO-block die dit verifieert door
-- de trigger-procedure-body op te halen en op de filter-conditie te checken.
-- Faalt de migratie expliciet als de filter ontbreekt — dat voorkomt dat we
-- per ongeluk factuur enqueuen op pickronde_gestart events.
DO $$
DECLARE
  v_body TEXT;
BEGIN
  SELECT prosrc INTO v_body
    FROM pg_proc
   WHERE proname = 'enqueue_factuur_voor_event';

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'enqueue_factuur_voor_event ontbreekt — mig 223 niet gedraaid?';
  END IF;

  IF v_body NOT LIKE '%pickronde_voltooid%' THEN
    RAISE EXCEPTION 'enqueue_factuur_voor_event mist pickronde_voltooid-filter — mig 258 zou per ongeluk factuur kunnen enqueuen op nieuwe event_types';
  END IF;
END $$;

------------------------------------------------------------------------
-- 7. Backfill — classificeer bestaande 'Nieuw'-orders
------------------------------------------------------------------------
-- ADR-0016 §"Backfill" volgorde (eerste match wint):
--   1. ≥1 zending in ('Onderweg','Afgeleverd') én ≥1 open → 'Deels verzonden'
--   2. ≥1 zending in ('Picken','Klaar voor verzending')   → 'In pickronde'
--   3. ≥1 maatwerk-regel zonder snijplan in 'Ingepakt'    → 'Wacht op maatwerk'
--   4. Rest → 'Klaar voor picken'
--
-- Schrijft event_type='backfill_fase_normalisatie' voor audit. Idempotent
-- via WHERE-guard op huidige status.
DO $$
DECLARE
  v_order  RECORD;
  v_doel   order_status;
  v_open   INTEGER;
  v_eind   INTEGER;
BEGIN
  FOR v_order IN
    SELECT id FROM orders WHERE status = 'Nieuw'
  LOOP
    -- Tel open + eindstatus-zendingen via M2M (canoniek) + legacy order_id
    SELECT COUNT(*) INTO v_open
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order.id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order.id
           )
       AND z.status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    SELECT COUNT(*) INTO v_eind
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order.id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order.id
           )
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    IF v_eind >= 1 AND v_open >= 1 THEN
      v_doel := 'Deels verzonden';
    ELSIF v_open >= 1 THEN
      -- Open zending → in pickronde. (Eindstatus zonder open zou betekenen
      -- dat de order eigenlijk al Verzonden moet zijn; die laten we met rust
      -- — voltooi_pickronde had die status moeten flippen.)
      v_doel := 'In pickronde';
    ELSIF EXISTS (
      SELECT 1 FROM order_regels oreg
       WHERE oreg.order_id = v_order.id
         AND COALESCE(oreg.is_maatwerk, false) = true
         AND NOT EXISTS (
           SELECT 1 FROM snijplannen sp
            WHERE sp.order_regel_id = oreg.id
              AND sp.status = 'Ingepakt'
         )
    ) THEN
      v_doel := 'Wacht op maatwerk';
    ELSE
      v_doel := 'Klaar voor picken';
    END IF;

    PERFORM _apply_transitie(
      p_order_id   := v_order.id,
      p_event_type := 'backfill_fase_normalisatie',
      p_status_na  := v_doel,
      p_reden      := 'Mig 258 (ADR-0016): Nieuw → fase-uitsplitsing volgens claim/zending/maatwerk-state',
      p_metadata   := jsonb_build_object('backfill', true, 'open_zendingen', v_open, 'verzonden_zendingen', v_eind)
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
