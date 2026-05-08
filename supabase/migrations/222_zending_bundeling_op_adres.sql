-- Migratie 222: Zending-bundeling op afleveradres + vervoerder
--
-- Achtergrond
-- -----------
-- Mig 220 (`start_pickronden_voor_order`) splitst regels van één order over N
-- zendingen op basis van per-regel-vervoerder. Mig 222 sluit het andere uiteinde:
-- meerdere ordens met identiek afleveradres + dezelfde effectieve vervoerder
-- worden samengevoegd in één bundel-zending (= één pakbon, één SSCC-set, één
-- transportorder). Concreet voor B2B-klanten met centraal magazijn (bv.
-- inkoopgroep BEGROS): waar tot nu toe N losse pakbonnen kwamen, ontstaat nu
-- 1 bundel-pakbon.
--
-- Bundel-grenzen (gehandhaafd in deze RPC + voorgesorteerd in frontend):
--   - Dezelfde debiteur_nr over alle orders (klant-grens)
--   - Identiek genormaliseerd afleveradres+land (postcode|adres|land)
--   - Vervoerder per regel komt uit `effectieve_vervoerder_per_orderregel`
--     (mig 219); regels van alle orders worden gegroepeerd op die uitkomst.
--     Per groep ontstaat 1 zending — orders met regels naar 2 vervoerders
--     komen dus in 2 verschillende bundel-zendingen.
--
-- Wijzigingen
-- -----------
--   1. Tabel `zending_orders` (M2M zending↔order) + backfill 1-op-1
--   2. Helper `_normaliseer_afleveradres(adres, postcode, land)`
--   3. RPC `start_pickronden_bundel(order_ids[], picker_id)` — multi-order
--   4. RPC `voltooi_pickronde` — bundel-aware factuur-keten sluitstuk
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, INSERT … ON CONFLICT, CREATE OR REPLACE.

------------------------------------------------------------------------
-- 1. Schema: zending_orders M2M-tabel
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zending_orders (
  zending_id BIGINT NOT NULL REFERENCES zendingen(id) ON DELETE CASCADE,
  order_id   BIGINT NOT NULL REFERENCES orders(id)    ON DELETE RESTRICT,
  PRIMARY KEY (zending_id, order_id)
);

CREATE INDEX IF NOT EXISTS zending_orders_order_id_idx ON zending_orders(order_id);

COMMENT ON TABLE zending_orders IS
  'Mig 222: M2M tussen zendingen en orders. Voor 1-op-1 zendingen 1 rij; voor '
  'bundel-zendingen N rijen. zendingen.order_id blijft als "primaire/eerste" '
  'order voor backwards-compat queries; deze tabel is de authoritatieve bron '
  'voor de volledige order-set van een zending bij bundeling.';

-- Backfill bestaande 1-op-1 koppelingen.
INSERT INTO zending_orders (zending_id, order_id)
SELECT id, order_id
  FROM zendingen
 WHERE order_id IS NOT NULL
ON CONFLICT DO NOTHING;

------------------------------------------------------------------------
-- 2. Helper: genormaliseerde afleveradres-match-key
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _normaliseer_afleveradres(
  p_adres    TEXT,
  p_postcode TEXT,
  p_land     TEXT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT
       COALESCE(NULLIF(TRIM(UPPER(REGEXP_REPLACE(COALESCE(p_postcode, ''), '\s+', '', 'g'))), ''), '?')
    || '|'
    || COALESCE(NULLIF(TRIM(UPPER(REGEXP_REPLACE(COALESCE(p_adres,    ''), '\s+', ' ', 'g'))), ''), '?')
    || '|'
    || COALESCE(NULLIF(TRIM(UPPER(COALESCE(p_land, ''))), ''), '?');
$$;

COMMENT ON FUNCTION _normaliseer_afleveradres(TEXT, TEXT, TEXT) IS
  'Mig 222: produceert match-key voor afleveradres-vergelijking '
  '(postcode|adres|land, alles uppercase, postcode-spaties weg, adres-spaties '
  'genormaliseerd). De frontend dupliceert dezelfde logica voor consistentie '
  'in de UI-clustering vóór de RPC-aanroep.';

------------------------------------------------------------------------
-- 3. RPC: start_pickronden_bundel — multi-order × multi-vervoerder
------------------------------------------------------------------------
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

  -- Bij 1 order: delegeer naar mig 220 (bundel heeft geen toegevoegde waarde).
  -- We returnen dezelfde shape met aantal_orders=1 zodat de caller geen
  -- speciale code-pad nodig heeft.
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

  -- Eerste order = bron voor afleveradres-snapshot op zending. Adressen zijn
  -- al gevalideerd identiek; eerste is willekeurige keuze.
  SELECT * INTO v_eerste_order FROM orders WHERE id = p_order_ids[1];
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_ids[1];
  END IF;

  -- Verzamel alle (orderregel, effectieve_vervoerder)-paren over alle orders
  -- in de bundel, en groepeer op effectieve vervoerder-code. Per groep komt
  -- één bundel-zending. Service-code: eerste niet-NULL binnen de groep, zelfde
  -- conventie als mig 220.
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

    -- M2M-koppeling: alle betrokken orders in deze groep.
    INSERT INTO zending_orders (zending_id, order_id)
    SELECT v_zending_id, ord_id FROM unnest(v_groep.order_ids) AS ord_id
    ON CONFLICT DO NOTHING;

    -- Zending_regels: één rij per orderregel in de groep.
    INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
    SELECT v_zending_id, ore.id, ore.orderaantal
      FROM order_regels ore
     WHERE ore.id = ANY(v_groep.orderregel_ids)
       AND COALESCE(ore.orderaantal, 0) > 0;

    -- SSCC-colli's. HST-dispatch vuurt pas op voltooi_pickronde (status-flip).
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
  'Mig 222: start een bundel-pickronde over meerdere orders. Vereist dezelfde '
  'debiteur en identiek afleveradres. Groepeert regels (over alle orders) op '
  'effectieve vervoerder uit mig 219 en maakt 1 zending per vervoerder-groep, '
  'gekoppeld aan alle betrokken orders via zending_orders M2M. Bij 1 order '
  'delegeert naar start_pickronden_voor_order voor identiek gedrag.';

------------------------------------------------------------------------
-- 4. voltooi_pickronde — bundel-aware factuur-keten sluitstuk
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION voltooi_pickronde(
  p_zending_id BIGINT,
  p_picker_id  BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig          zending_status;
  v_aantal_niet_gev INTEGER;
  v_order_id        BIGINT;
  v_open_zendingen  INTEGER;
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

  -- Sluitstuk factuur-keten: voor élke order in deze (mogelijk gebundelde)
  -- zending kijken of het de laatste open zending is. Bron: zending_orders
  -- M2M (mig 222) — bevat zowel solo-1-op-1 als bundel-N-op-1 koppelingen.
  SELECT array_agg(order_id) INTO v_bundel_orders
    FROM zending_orders WHERE zending_id = p_zending_id;

  IF v_bundel_orders IS NULL THEN
    -- Defensief: M2M-rij ontbreekt (zou niet mogen na backfill); val terug
    -- op zendingen.order_id zodat solo-zendingen blijven werken.
    SELECT ARRAY[order_id] INTO v_bundel_orders
      FROM zendingen WHERE id = p_zending_id;
  END IF;

  FOREACH v_order_id IN ARRAY v_bundel_orders LOOP
    -- Tel open zendingen voor déze order via beide koppelingen (solo + bundel).
    SELECT COUNT(*) INTO v_open_zendingen
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order_id
           )
       AND z.status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    IF v_open_zendingen = 0 THEN
      IF NOT EXISTS (
        SELECT 1 FROM orders
         WHERE id = v_order_id
           AND status IN ('Verzonden', 'Geannuleerd')
      ) THEN
        PERFORM markeer_verzonden(
          p_order_id            := v_order_id,
          p_actor_medewerker_id := p_picker_id
        );
      END IF;
    END IF;
  END LOOP;

  RETURN p_zending_id;
END;
$$;

COMMENT ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) IS
  'Mig 222 (bundel-aware): voltooit Pickronde, delegeert order-status-write per '
  'order in de bundel naar markeer_verzonden. Open-zendingen-telling gebruikt '
  'zending_orders M2M, zodat zowel solo- als bundel-zendingen correct worden '
  'afgesloten in de factuur-keten.';

-- CREATE OR REPLACE FUNCTION reset SECURITY DEFINER + SET-clauses; mig 218_z…
-- maakte voltooi_pickronde DEFINER zodat de keten naar order_events kan
-- schrijven (RLS-tabel zonder INSERT-policy voor authenticated). Plak die
-- attributen weer terug — anders krijgt de eerstvolgende voltooi_pickronde-
-- aanroep opnieuw 42501 op order_events.
ALTER FUNCTION voltooi_pickronde(BIGINT, BIGINT) SECURITY DEFINER;
ALTER FUNCTION voltooi_pickronde(BIGINT, BIGINT) SET search_path = public;

NOTIFY pgrst, 'reload schema';
