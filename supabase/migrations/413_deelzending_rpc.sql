-- Migratie 413: handmatige deelzending per orderregel
--
-- Maakt het mogelijk om een DEEL van de regels van een order eerder te
-- verzenden als de klant dat wenst. De operator selecteert in het order-detail
-- welke regels hij nu wil verzenden; het systeem maakt een zending aan voor
-- alleen die regels en de rest blijft in de order staan.
--
-- Wijzigingen:
--   1. start_deelzending(order_id, regel_ids[], picker_id) — nieuw RPC
--   2. start_pickronden_voor_order — skip regels die al in een actieve
--      zending zitten (deelzending-bewust)
--   3. voltooi_pickronde — check op niet-gezende regels voor de
--      Verzonden / Deels verzonden splitsing
--
-- Idempotent.

-- ============================================================================
-- 1. start_deelzending
--
-- Maakt een pickronde + zending aan voor een SUBSET van orderregels.
-- De caller (order-detail UI) heeft al geverifieerd dat de regels pickbaar zijn.
--
-- Validaties:
--   a. Alle regel_ids horen bij p_order_id
--   b. Alle regels zijn pickbaar (wacht_op IS NULL via orderregel_pickbaarheid)
--   c. Geen van de regels zit al in een actieve zending (status ≠ Afgeleverd)
--   d. Order heeft deelleveringen toegestaan (debiteuren.deelleveringen_toegestaan)
--      OF lever_modus = 'deelleveringen'
--   e. Order staat niet in eindstatus (Verzonden / Geannuleerd)
-- ============================================================================
CREATE OR REPLACE FUNCTION start_deelzending(
  p_order_id    BIGINT,
  p_regel_ids   BIGINT[],
  p_picker_id   BIGINT
)
RETURNS TABLE(
  zending_id      BIGINT,
  zending_nr      TEXT,
  vervoerder_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order        RECORD;
  v_zending_id   BIGINT;
  v_zending_nr   TEXT;
  v_vervoerder   TEXT;
  v_service      TEXT;
  v_buffer       INTEGER;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  -- Laad order + debiteuren-vlag in één query
  SELECT o.*, d.deelleveringen_toegestaan
    INTO v_order
    FROM orders o
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  -- (e) Eindstatus-guard
  IF v_order.status IN ('Verzonden', 'Geannuleerd') THEN
    RAISE EXCEPTION 'Order % heeft status % — geen deelzending mogelijk',
      p_order_id, v_order.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (d) Deelleveringen toegestaan?
  IF NOT COALESCE(v_order.deelleveringen_toegestaan, FALSE)
     AND v_order.lever_modus IS DISTINCT FROM 'deelleveringen' THEN
    RAISE EXCEPTION
      'Order %: deelleveringen niet toegestaan voor debiteur % '
      '(stel deelleveringen_toegestaan in op de klant of pas lever_modus aan)',
      p_order_id, v_order.debiteur_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (a) Alle regel_ids horen bij deze order?
  IF EXISTS (
    SELECT 1 FROM unnest(p_regel_ids) AS rid
     WHERE NOT EXISTS (
       SELECT 1 FROM order_regels
        WHERE id = rid AND order_id = p_order_id
     )
  ) THEN
    RAISE EXCEPTION 'Niet alle regel_ids horen bij order %', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (b) Alle regels pickbaar?
  IF EXISTS (
    SELECT 1 FROM unnest(p_regel_ids) AS rid
     WHERE NOT EXISTS (
       SELECT 1 FROM orderregel_pickbaarheid op
        WHERE op.order_regel_id = rid
          AND op.is_pickbaar = TRUE
     )
  ) THEN
    RAISE EXCEPTION
      'Niet alle geselecteerde regels zijn pickbaar. '
      'Controleer wacht_op per regel via orderregel_pickbaarheid.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (c) Geen regel al in actieve zending?
  IF EXISTS (
    SELECT 1
      FROM zending_regels zr
      JOIN zendingen z ON z.id = zr.zending_id
     WHERE zr.order_regel_id = ANY(p_regel_ids)
       AND z.status NOT IN ('Afgeleverd')
  ) THEN
    RAISE EXCEPTION
      'Een of meer geselecteerde regels zitten al in een actieve zending. '
      'Voltooi of annuleer die zending eerst.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Vervoerder bepalen: gebruik de eerste effectieve vervoerder van de selectie
  -- (zelfde ladder als start_pickronden_voor_order)
  SELECT evpo.effectief_code, evpo.effectief_service
    INTO v_vervoerder, v_service
    FROM effectieve_vervoerder_per_orderregel(p_order_id) evpo
   WHERE evpo.orderregel_id = ANY(p_regel_ids)
   ORDER BY evpo.orderregel_id ASC
   LIMIT 1;

  -- Maak de deelzending aan
  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr, order_id, status, picker_id,
    vervoerder_code, service_code,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    verzenddatum,
    is_deelzending
  ) VALUES (
    v_zending_nr, p_order_id, 'Picken', p_picker_id,
    v_vervoerder, v_service,
    v_order.afl_naam, v_order.afl_adres,
    v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
    CURRENT_DATE,
    TRUE
  ) RETURNING id INTO v_zending_id;

  -- M2M koppeling (mig 222 canoniek patroon)
  INSERT INTO zending_orders (zending_id, order_id)
  VALUES (v_zending_id, p_order_id)
  ON CONFLICT DO NOTHING;

  -- Alleen geselecteerde regels aan zending koppelen
  INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
  SELECT v_zending_id, ore.id, ore.orderaantal
    FROM order_regels ore
   WHERE ore.id = ANY(p_regel_ids)
     AND COALESCE(ore.orderaantal, 0) > 0;

  -- Colli genereren
  PERFORM genereer_zending_colli(v_zending_id);

  -- Order → 'In pickronde' (no-op als al op die status of Deels verzonden)
  PERFORM markeer_pickronde_gestart(
    p_order_id            := p_order_id,
    p_actor_medewerker_id := p_picker_id
  );

  -- Audit-event voor de deelzending-start
  INSERT INTO order_events (order_id, event_type, status_voor, status_na, payload)
  SELECT
    p_order_id,
    'deelzending_gestart',
    v_order.status,
    'In pickronde',
    jsonb_build_object(
      'zending_id',   v_zending_id,
      'zending_nr',   v_zending_nr,
      'regel_ids',    p_regel_ids,
      'vervoerder',   v_vervoerder
    );

  RETURN QUERY SELECT v_zending_id, v_zending_nr, v_vervoerder;
END;
$$;

GRANT EXECUTE ON FUNCTION start_deelzending(BIGINT, BIGINT[], BIGINT) TO authenticated;

COMMENT ON FUNCTION start_deelzending(BIGINT, BIGINT[], BIGINT) IS
  'Mig 413: start een handmatige deelzending voor een SUBSET van orderregels. '
  'Maakt pickronde (status Picken) + zending aan voor alleen p_regel_ids. '
  'Overige regels blijven in de order en verschijnen later in Pick & Ship. '
  'Vereist deelleveringen_toegestaan=TRUE of lever_modus=''deelleveringen''. '
  'Triggers: order → In pickronde; deelzending-audit in order_events.';

-- ============================================================================
-- 2. Kolom is_deelzending op zendingen (als nog niet bestaat)
-- ============================================================================
ALTER TABLE zendingen
  ADD COLUMN IF NOT EXISTS is_deelzending BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN zendingen.is_deelzending IS
  'TRUE = deelzending (alleen subset van orderregels). Zet start_deelzending. '
  'Mig 413.';

-- ============================================================================
-- 3. start_pickronden_voor_order — deelzending-bewust
--
-- Twee aanpassingen:
--   a. Eindstatus-guard: softened — blokkeert alleen als ER GEEN pickbare
--      regels meer zijn die NIET al in een actieve/voltooide zending zitten.
--      Voorheen blokkeerde elke zending in eindstatus (ook deelzendingen).
--   b. Regelfilter: skip regels die al in een actieve (niet-Afgeleverd)
--      zending zitten om dubbel picken te voorkomen.
-- ============================================================================
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
  v_is_nieuw    BOOLEAN;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  -- Eindstatus-guard (softened voor deelzendingen, mig 413):
  -- Blokkeer alleen als ALLE pickbare regels al in een eindstatus-zending zitten
  -- zodat er feitelijk niets meer te picken valt. Een deelzending in eindstatus
  -- moet de rest van de order NIET blokkeren.
  IF NOT EXISTS (
    SELECT 1
      FROM orderregel_pickbaarheid op
     WHERE op.order_id = p_order_id
       AND op.is_pickbaar = TRUE
       AND NOT EXISTS (
         SELECT 1 FROM zending_regels zr
           JOIN zendingen z ON z.id = zr.zending_id
          WHERE zr.order_regel_id = op.order_regel_id
            AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
       )
  ) THEN
    RAISE EXCEPTION
      'Order % heeft geen pickbare regels meer buiten voltooide zendingen.',
      p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Per effectieve vervoerder: 1 zending.
  -- Skip regels die al in een ACTIEVE (nog niet Afgeleverd) zending zitten —
  -- dit voorkomt dubbel picken na een deelzending.
  FOR v_groep IN
    WITH per_regel AS (
      SELECT evpo.*
        FROM effectieve_vervoerder_per_orderregel(p_order_id) evpo
       WHERE NOT EXISTS (
         -- Regel zit al in een actieve zending (ook eindstatus-zending)
         SELECT 1 FROM zending_regels zr
           JOIN zendingen z ON z.id = zr.zending_id
          WHERE zr.order_regel_id = evpo.orderregel_id
            AND z.status NOT IN ('Afgeleverd')
       )
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
    -- Geen regels in deze groep (alle gefilterd)? Skip.
    IF v_groep.aantal_regels = 0 THEN CONTINUE; END IF;

    -- Bestaande Picken-zending voor deze (order, vervoerder)? Hergebruiken.
    SELECT z.id, z.zending_nr INTO v_zending_id, v_zending_nr
      FROM zendingen z
     WHERE z.order_id = p_order_id
       AND z.status = 'Picken'
       AND z.vervoerder_code IS NOT DISTINCT FROM v_groep.vervoerder_code
       AND (z.is_deelzending = FALSE OR z.is_deelzending IS NULL)
     ORDER BY z.id DESC LIMIT 1;

    IF v_zending_id IS NOT NULL THEN
      v_is_nieuw := FALSE;
      UPDATE zendingen SET picker_id = p_picker_id WHERE id = v_zending_id;
      PERFORM genereer_zending_colli(v_zending_id);
    ELSE
      v_is_nieuw := TRUE;
      v_zending_nr := volgend_nummer('ZEND');

      INSERT INTO zendingen (
        zending_nr, order_id, status, picker_id, vervoerder_code, service_code,
        afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
        verzenddatum, aantal_colli, totaal_gewicht_kg,
        is_deelzending
      ) VALUES (
        v_zending_nr, p_order_id, 'Picken', p_picker_id,
        v_groep.vervoerder_code, v_groep.service_code,
        v_order.afl_naam, v_order.afl_adres,
        v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
        CURRENT_DATE,
        (SELECT COALESCE(SUM(COALESCE(ore.orderaantal, 0)), 0)::INTEGER
           FROM order_regels ore WHERE ore.id = ANY(v_groep.orderregel_ids)),
        (SELECT NULLIF(
                  ROUND(COALESCE(SUM(COALESCE(ore.gewicht_kg, 0)
                                   * COALESCE(ore.orderaantal, 0)), 0), 2), 0)
           FROM order_regels ore WHERE ore.id = ANY(v_groep.orderregel_ids)),
        FALSE
      ) RETURNING id INTO v_zending_id;

      INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
      SELECT v_zending_id, ore.id, ore.orderaantal
        FROM order_regels ore
       WHERE ore.id = ANY(v_groep.orderregel_ids)
         AND COALESCE(ore.orderaantal, 0) > 0;

      PERFORM genereer_zending_colli(v_zending_id);
    END IF;

    -- Zending ook in M2M-tabel (mig 222 canoniek)
    INSERT INTO zending_orders (zending_id, order_id)
    VALUES (v_zending_id, p_order_id)
    ON CONFLICT DO NOTHING;

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
  'Mig 413 (was 220): start een Pickronde voor een order — 1 zending per '
  'unieke effectieve vervoerder. Deelzending-bewust: skip regels al in actieve '
  'zending; eindstatus-guard softened (blokkeert alleen als NIETS meer te '
  'picken valt). Idempotent: bestaande niet-deelzending Picken-zendingen hergebruikt.';

-- ============================================================================
-- 4. voltooi_pickronde — check niet-gezende regels (deelzending-fix)
--
-- Eerder: `v_open_zendingen = 0` → altijd markeer_verzonden.
-- Nu: `v_open_zendingen = 0` én er zijn NIET-gezende regels → Deels verzonden.
-- Reden: na een deelzending voor 2 van 3 regels heeft de order slechts 1
-- zending; die zending voltooien mag niet de order als "Verzonden" markeren
-- terwijl de derde regel nog nooit gepickt is.
-- ============================================================================
CREATE OR REPLACE FUNCTION voltooi_pickronde(
  p_zending_id BIGINT,
  p_picker_id  BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_huidig             zending_status;
  v_aantal_niet_gev    INTEGER;
  v_order_id           BIGINT;
  v_open_zendingen     INTEGER;
  v_verzonden_zend     INTEGER;
  v_onverzonde_regels  INTEGER;
  v_bundel_orders      BIGINT[];
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  SELECT status INTO v_huidig FROM zendingen WHERE id = p_zending_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;
  IF v_huidig <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde voor zending % is niet actief (status=%)',
      p_zending_id, v_huidig;
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

  -- Bron-orders via M2M (mig 222 canoniek)
  SELECT array_agg(order_id) INTO v_bundel_orders
    FROM zending_orders WHERE zending_id = p_zending_id;

  IF v_bundel_orders IS NULL THEN
    SELECT ARRAY[order_id] INTO v_bundel_orders
      FROM zendingen WHERE id = p_zending_id;
  END IF;

  FOREACH v_order_id IN ARRAY v_bundel_orders LOOP
    -- Open zendingen (Gepland of Picken) voor deze order
    SELECT COUNT(*) INTO v_open_zendingen
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order_id
           )
       AND z.status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    -- Voltooide zendingen (nu inclusief de net-voltooide)
    SELECT COUNT(*) INTO v_verzonden_zend
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order_id
           )
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    IF EXISTS (
      SELECT 1 FROM orders
       WHERE id = v_order_id AND status IN ('Verzonden', 'Geannuleerd')
    ) THEN CONTINUE; END IF;

    IF v_open_zendingen = 0 THEN
      -- Deelzending-fix (mig 413): tel niet-gezende niet-pseudo regels.
      -- Als er nog regels zijn zonder enige zending → niet alles verzonden.
      SELECT COUNT(*) INTO v_onverzonde_regels
        FROM order_regels ore
       WHERE ore.order_id = v_order_id
         AND NOT is_admin_pseudo(ore.artikelnr)
         AND NOT EXISTS (
           SELECT 1 FROM zending_regels zr
            WHERE zr.order_regel_id = ore.id
         );

      IF v_onverzonde_regels > 0 THEN
        -- Nog ongepickte regels aanwezig → Deels verzonden
        PERFORM markeer_deels_verzonden(
          p_order_id            := v_order_id,
          p_actor_medewerker_id := p_picker_id
        );
      ELSE
        -- Alle regels zijn in (voltooide of actieve) zendingen → Verzonden
        PERFORM markeer_verzonden(
          p_order_id            := v_order_id,
          p_actor_medewerker_id := p_picker_id
        );
      END IF;

    ELSIF v_verzonden_zend >= 1 THEN
      -- Niet-laatste zending én ≥1 zending al voltooid → Deels verzonden
      PERFORM markeer_deels_verzonden(
        p_order_id            := v_order_id,
        p_actor_medewerker_id := p_picker_id
      );
    END IF;
  END LOOP;

  RETURN p_zending_id;
END;
$$;

GRANT EXECUTE ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) TO authenticated;

COMMENT ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) IS
  'Mig 413 (was 258/ADR-0016): bundel-aware voltooien + deelzending-fix. '
  'Bij v_open_zendingen=0: tel niet-gezende regels — als > 0 → Deels verzonden '
  '(deelzending-case), anders → Verzonden. Ander pad: niet-laatste zending met '
  '≥1 voltooide → Deels verzonden. Mig 258-contract ongewijzigd voor normale orders.';

-- ============================================================================
-- 5. order_events: deelzending_gestart type
-- ============================================================================
DO $$ BEGIN
  ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'deelzending_gestart'
    AFTER 'deels_verzonden';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
