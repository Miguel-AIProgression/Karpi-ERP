-- Migratie 516: Manco-afhandeling — niet-gevonden colli blokkeert de zending niet
-- meer, gaat naar een Pick-backorder ("Manco"), met NL/DE-splitsing in de
-- binnendienst-resolutie en een permanente order-markering.
--
-- Bouwt voort op het plan-doc 2026-06-22 (pick-backorder) + de bijgestelde
-- beslissingen 2026-06-26 (zie docs/superpowers/plans/2026-06-26-manco-nl-de-binnendienst.md):
--   * niet-gevonden = BEVRIEZEN (claim blijft gereserveerd, geen voorraad-afboeking);
--   * de regel blijft als MANCO op de zending (aantal verlaagd, manco_aantal+1) →
--     pakbon toont geleverd 0;
--   * de binnendienst doet later de ENIGE voorraad-correctie + NL/DE-resolutie.
--
-- Re-afgeleid op de HUIDIGE live bodies (origin/main, mig 515):
--   * voltooi_pickronde  → base mig 413 (onveranderd) + manco-aftakking;
--   * orderregel_pickbaarheid → base mig 498 (SUM-fix) + gate-exclusie;
--   * orders_list        → base mig 451 (express) + manco_sinds;
--   * markeer_colli_niet_gevonden → base mig 217, vereenvoudigd (modus weg).
--
-- Patroon nullable-timestamp-gate (mig 326/395/396). Idempotent waar mogelijk.

-- ============================================================================
-- 0. Nieuwe order_event_type-waarden (vóór de functies; literals resolven pas bij
--    uitvoering van de plpgsql-body, dus veilig binnen één migratie — mig 398-patroon)
-- ============================================================================
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'manco_gedetecteerd';
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'manco_terug_naar_pickship';
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'manco_niet_leverbaar';
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'manco_voorraad_gecorrigeerd';

-- ============================================================================
-- 1. Gate-kolommen
-- ============================================================================
ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS pick_backorder_sinds          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pick_backorder_reden          TEXT,
  ADD COLUMN IF NOT EXISTS pick_backorder_geannuleerd_op TIMESTAMPTZ;

COMMENT ON COLUMN order_regels.pick_backorder_sinds IS
  'Mig 516: gezet door voltooi_pickronde als de colli van deze regel niet gevonden '
  'werd. NOT NULL = open manco op de Manco-werklijst + uitgesloten uit pickbaarheid. '
  'manco_terug_naar_pickship/manco_niet_leverbaar (NL) wissen dit weer.';
COMMENT ON COLUMN order_regels.pick_backorder_reden IS
  'Mig 516: operator-opmerking bij niet-gevonden (uit zending_colli.pick_opmerking).';
COMMENT ON COLUMN order_regels.pick_backorder_geannuleerd_op IS
  'Mig 516: gezet door manco_niet_leverbaar (DE/buitenland). NOT NULL = regel '
  'definitief niet geleverd op deze order; telt niet mee voor de order-status.';

CREATE INDEX IF NOT EXISTS idx_order_regels_pick_backorder
  ON order_regels (pick_backorder_sinds)
  WHERE pick_backorder_sinds IS NOT NULL AND pick_backorder_geannuleerd_op IS NULL;

-- Permanente order-markering "had een mankement" (historisch, nooit gewist).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS manco_sinds TIMESTAMPTZ;
COMMENT ON COLUMN orders.manco_sinds IS
  'Mig 516: eenmalig gezet bij de eerste manco-detectie op deze order; nooit '
  'gewist (ook na Verzonden zichtbaar). Voedt de status-overstijgende Manco-tab.';

-- Manco-aantal op de zending_regel zodat de pakbon de regel kan tonen met
-- geleverd 0 i.p.v. de regel te verwijderen.
ALTER TABLE zending_regels
  ADD COLUMN IF NOT EXISTS manco_aantal INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN zending_regels.manco_aantal IS
  'Mig 516: aantal stuks van deze regel dat tijdens de pickronde niet gevonden is. '
  '>0 = pakbon toont "MANCO" + geleverd = aantal (kan 0 zijn). De colli is verwijderd '
  '(niets fysiek verzonden); aantal is met manco_aantal verlaagd.';

-- ============================================================================
-- 2. voltooi_pickronde — niet-gevonden colli's → Manco i.p.v. blokkeren.
--    Base = mig 413 (origin/main onveranderd). Wijzigingen t.o.v. 413:
--      a) niet-gevonden-loop vóór de normale voltooiing: gate zetten, order-marker
--         zetten, audit, en de regel als MANCO op de zending houden (aantal-1,
--         manco_aantal+1) — NIET verwijderen — terwijl de colli wél verdwijnt.
--         De order_reserveringen-claim blijft ONGEMOEID (bevriezing).
--      b) lege zending (alle colli manco) → zending verwijderen (niets te verzenden).
--      c) onverzonden-telling: een gegate manco-regel én een regel zonder gepickte
--         (aantal>0) zending_regel tellen mee als onverzonden → order 'Deels verzonden'.
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
  v_order_id           BIGINT;
  v_open_zendingen     INTEGER;
  v_verzonden_zend     INTEGER;
  v_onverzonde_regels  INTEGER;
  v_bundel_orders      BIGINT[];
  v_resterend_colli    INTEGER;
  v_ng                 RECORD;
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

  -- (a) Niet-gevonden colli's → markeer orderregel als manco (gate), zet de
  -- permanente order-marker, log audit, en houd de regel als MANCO op de zending.
  FOR v_ng IN
    SELECT zc.id AS colli_id, zc.order_regel_id, zc.pick_opmerking
      FROM zending_colli zc
     WHERE zc.zending_id = p_zending_id
       AND zc.pick_uitkomst = 'niet_gevonden'
       AND zc.order_regel_id IS NOT NULL
  LOOP
    UPDATE order_regels
       SET pick_backorder_sinds = COALESCE(pick_backorder_sinds, now()),
           pick_backorder_reden = v_ng.pick_opmerking,
           pick_backorder_geannuleerd_op = NULL
     WHERE id = v_ng.order_regel_id;

    -- Permanente order-marker + audit (status_na = huidige order-status).
    UPDATE orders o
       SET manco_sinds = COALESCE(o.manco_sinds, now())
      FROM order_regels ore
     WHERE ore.id = v_ng.order_regel_id AND o.id = ore.order_id;

    INSERT INTO order_events (order_id, event_type, status_na, metadata)
    SELECT ore.order_id, 'manco_gedetecteerd', o.status,
           jsonb_build_object('order_regel_id', v_ng.order_regel_id,
                              'zending_id', p_zending_id,
                              'reden', v_ng.pick_opmerking, 'migratie', 516)
      FROM order_regels ore JOIN orders o ON o.id = ore.order_id
     WHERE ore.id = v_ng.order_regel_id;

    -- Houd de regel als MANCO op de zending (geleverd 0 op de pakbon); colli weg.
    UPDATE zending_regels
       SET aantal       = GREATEST(0, aantal - 1),
           manco_aantal = manco_aantal + 1
     WHERE zending_id = p_zending_id
       AND order_regel_id = v_ng.order_regel_id;
    DELETE FROM zending_colli WHERE id = v_ng.colli_id;
  END LOOP;

  UPDATE zendingen
     SET aantal_colli = (SELECT COUNT(*) FROM zending_colli
                          WHERE zending_id = p_zending_id AND is_bundel = FALSE)
   WHERE id = p_zending_id;

  -- Bron-orders via M2M (mig 222 canoniek), met legacy order_id-fallback.
  SELECT array_agg(order_id) INTO v_bundel_orders
    FROM zending_orders WHERE zending_id = p_zending_id;
  IF v_bundel_orders IS NULL THEN
    SELECT ARRAY[order_id] INTO v_bundel_orders FROM zendingen WHERE id = p_zending_id;
  END IF;

  -- (b) Lege zending (alle colli niet gevonden)? Niets te verzenden → verwijder de
  -- zending (zoals annuleer_pickronde, mig 398). De manco-regel(s) houden de order
  -- uit Pick & Ship tot ze op de Manco-werklijst beoordeeld zijn.
  SELECT COUNT(*) INTO v_resterend_colli
    FROM zending_colli WHERE zending_id = p_zending_id AND is_bundel = FALSE;

  IF v_resterend_colli = 0 THEN
    DELETE FROM zending_colli  WHERE zending_id = p_zending_id;
    DELETE FROM zending_regels WHERE zending_id = p_zending_id;
    DELETE FROM zending_orders WHERE zending_id = p_zending_id;
    DELETE FROM zendingen      WHERE id = p_zending_id;
    IF v_bundel_orders IS NOT NULL THEN
      FOREACH v_order_id IN ARRAY v_bundel_orders LOOP
        SELECT COUNT(*) INTO v_open_zendingen
          FROM zendingen z
         WHERE z.status IN ('Gepland', 'Picken')
           AND (z.order_id = v_order_id
                OR z.id IN (SELECT zo.zending_id FROM zending_orders zo
                             WHERE zo.order_id = v_order_id));
        IF v_open_zendingen = 0 AND EXISTS (
          SELECT 1 FROM orders WHERE id = v_order_id AND status = 'In pickronde'
        ) THEN
          PERFORM _apply_transitie(
            p_order_id            := v_order_id,
            p_event_type          := 'pickronde_teruggedraaid',
            p_status_na           := 'Klaar voor picken',
            p_actor_medewerker_id := p_picker_id,
            p_reden               := 'Alle colli niet gevonden — naar manco'
          );
        END IF;
        PERFORM herbereken_wacht_status(v_order_id);
      END LOOP;
    END IF;
    RETURN p_zending_id;
  END IF;

  -- Resterende colli: voltooi normaal (identiek aan mig 413 vanaf hier).
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

  FOREACH v_order_id IN ARRAY v_bundel_orders LOOP
    SELECT COUNT(*) INTO v_open_zendingen
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order_id
           )
       AND z.status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

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
      -- (c) Tel onverzonden, niet-pseudo, niet-geannuleerde regels. Een gegate
      -- manco-regel telt mee (gate gezet); een regel zonder gepickte (aantal>0)
      -- zending_regel ook → order blijft Deels verzonden.
      SELECT COUNT(*) INTO v_onverzonde_regels
        FROM order_regels ore
       WHERE ore.order_id = v_order_id
         AND NOT is_admin_pseudo(ore.artikelnr)
         AND ore.pick_backorder_geannuleerd_op IS NULL
         AND (
           ore.pick_backorder_sinds IS NOT NULL
           OR NOT EXISTS (
             SELECT 1 FROM zending_regels zr
              WHERE zr.order_regel_id = ore.id AND zr.aantal > 0
           )
         );

      IF v_onverzonde_regels > 0 THEN
        PERFORM markeer_deels_verzonden(
          p_order_id            := v_order_id,
          p_actor_medewerker_id := p_picker_id
        );
      ELSE
        PERFORM markeer_verzonden(
          p_order_id            := v_order_id,
          p_actor_medewerker_id := p_picker_id
        );
      END IF;

    ELSIF v_verzonden_zend >= 1 THEN
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
  'Mig 516 (base 413): niet-gevonden colli''s gaan naar Manco (order_regels.'
  'pick_backorder_sinds + orders.manco_sinds) i.p.v. te blokkeren. De regel blijft '
  'als MANCO op de zending (aantal-1/manco_aantal+1) → pakbon geleverd 0; de colli '
  'verdwijnt; de voorraad-claim blijft BEVROREN. Lege zending → verwijderd. '
  'Onverzonden-telling: gegate manco-regel + regel zonder aantal>0-regel tellen mee.';

-- ============================================================================
-- 3. orderregel_pickbaarheid — open manco-regels uitgesloten.
--    Volledige body identiek aan mig 498; enige wijziging = extra WHERE-conditie
--    oreg.pick_backorder_sinds IS NULL. order_pickbaarheid (mig 479) leest deze
--    view en hoeft niet gewijzigd: 0 pickbare regels → niet in Pick & Ship.
-- ============================================================================
CREATE OR REPLACE VIEW orderregel_pickbaarheid AS
WITH maatwerk_aggr AS (
  SELECT sp.order_regel_id,
    count(*) AS totaal_stuks,
    count(*) FILTER (WHERE sp.status = 'Ingepakt'::snijplan_status) AS pickbaar_stuks,
    min(sp.locatie) FILTER (WHERE sp.status = 'Ingepakt'::snijplan_status) AS locatie,
    min(
        CASE sp.status
            WHEN 'Wacht'::snijplan_status THEN 1
            WHEN 'Gepland'::snijplan_status THEN 2
            WHEN 'Snijden'::snijplan_status THEN 2
            WHEN 'Gesneden'::snijplan_status THEN 3
            WHEN 'In confectie'::snijplan_status THEN 4
            WHEN 'In productie'::snijplan_status THEN 5
            WHEN 'Gereed'::snijplan_status THEN 6
            WHEN 'Ingepakt'::snijplan_status THEN 7
            ELSE NULL::integer
        END) AS slechtste_rang
   FROM snijplannen sp
  WHERE sp.status <> 'Geannuleerd'::snijplan_status
  GROUP BY sp.order_regel_id
), voorraad_claim AS (
  SELECT rsv.order_regel_id,
    SUM(rsv.aantal) AS totaal_geclaimd
   FROM order_reserveringen rsv
  WHERE rsv.bron = 'voorraad'::text AND rsv.status = 'actief'::text
  GROUP BY rsv.order_regel_id
), rol_locatie_per_artikel AS (
  SELECT DISTINCT ON (r.artikelnr) r.artikelnr,
    ml.code
   FROM rollen r
     JOIN magazijn_locaties ml ON ml.id = r.locatie_id
  WHERE r.status = 'beschikbaar'::text AND r.locatie_id IS NOT NULL
  ORDER BY r.artikelnr, r.id
)
SELECT oreg.id AS order_regel_id,
  oreg.order_id,
  oreg.regelnummer,
  oreg.artikelnr,
  oreg.is_maatwerk,
  oreg.orderaantal,
  oreg.maatwerk_lengte_cm,
  oreg.maatwerk_breedte_cm,
  oreg.omschrijving,
  oreg.maatwerk_kwaliteit_code,
  oreg.maatwerk_kleur_code,
  ma.totaal_stuks,
  ma.pickbaar_stuks,
    CASE
        WHEN oreg.is_maatwerk THEN COALESCE(ma.pickbaar_stuks = ma.totaal_stuks AND ma.totaal_stuks > 0, false)
        ELSE COALESCE(vc.totaal_geclaimd >= oreg.te_leveren, false)
    END AS is_pickbaar,
    CASE
        WHEN oreg.is_maatwerk THEN 'snijplan'::text
        WHEN rl.code IS NOT NULL THEN 'rol'::text
        WHEN p.locatie IS NOT NULL THEN 'producten_default'::text
        ELSE NULL::text
    END AS bron,
    CASE
        WHEN oreg.is_maatwerk THEN ma.locatie
        ELSE COALESCE(rl.code, p.locatie)
    END AS fysieke_locatie,
    CASE
        WHEN oreg.is_maatwerk THEN
        CASE
            WHEN ma.totaal_stuks IS NULL OR ma.slechtste_rang IS NULL THEN 'snijden'::text
            WHEN ma.slechtste_rang <= 2 THEN 'snijden'::text
            WHEN ma.slechtste_rang <= 4 THEN 'confectie'::text
            WHEN ma.slechtste_rang <= 6 THEN 'inpak'::text
            ELSE NULL::text
        END
        ELSE
        CASE
            WHEN COALESCE(vc.totaal_geclaimd, 0) < COALESCE(oreg.te_leveren, 0) THEN 'inkoop'::text
            ELSE NULL::text
        END
    END AS wacht_op,
  oreg.gewicht_kg
 FROM order_regels oreg
   JOIN orders o ON o.id = oreg.order_id
   LEFT JOIN producten p ON p.artikelnr = oreg.artikelnr
   LEFT JOIN maatwerk_aggr ma ON ma.order_regel_id = oreg.id
   LEFT JOIN voorraad_claim vc ON vc.order_regel_id = oreg.id
   LEFT JOIN rol_locatie_per_artikel rl ON rl.artikelnr = oreg.artikelnr
WHERE (o.status <> ALL (ARRAY['Verzonden'::order_status, 'Geannuleerd'::order_status]))
  AND NOT is_admin_pseudo(oreg.artikelnr)
  AND oreg.pick_backorder_sinds IS NULL;  -- mig 516: open manco uit Pick & Ship

COMMENT ON VIEW orderregel_pickbaarheid IS
  'Per orderregel: is_pickbaar, fysieke_locatie, bron, wacht_op, gewicht_kg. '
  'Mig 386: single source + admin-pseudo. Mig 498: voorraad-claim op SUM(aantal). '
  'Mig 516: open manco-regels (pick_backorder_sinds NOT NULL) uitgesloten.';

-- ============================================================================
-- 4. orders_list — manco_sinds toegevoegd (base mig 451, volledige body + 1 kolom).
-- ============================================================================
CREATE OR REPLACE VIEW orders_list AS
WITH bundel_per_order AS (
  SELECT DISTINCT ON (zo.order_id)
    zo.order_id,
    z.id          AS zending_id,
    z.zending_nr  AS bundel_zending_nr,
    cnt.aantal_orders AS bundel_order_count
  FROM zending_orders zo
  JOIN zendingen z ON z.id = zo.zending_id
  JOIN LATERAL (
    SELECT count(*)::integer AS aantal_orders
    FROM zending_orders zo2
    WHERE zo2.zending_id = z.id
  ) cnt ON cnt.aantal_orders >= 2
  ORDER BY zo.order_id, (
    CASE z.status
      WHEN 'Picken'::zending_status               THEN 1
      WHEN 'Klaar voor verzending'::zending_status THEN 2
      WHEN 'Onderweg'::zending_status              THEN 3
      WHEN 'Afgeleverd'::zending_status            THEN 4
      ELSE 5
    END), z.id
)
SELECT
  o.id,
  o.order_nr,
  o.oud_order_nr,
  o.debiteur_nr,
  o.klant_referentie,
  o.orderdatum,
  o.afleverdatum,
  o.status,
  o.aantal_regels,
  o.totaal_bedrag,
  o.totaal_gewicht,
  o.vertegenw_code,
  d.naam AS klant_naam,
  o.heeft_unmatched_regels,
  o.bron_systeem,
  o.bron_shop,
  o.lever_type,
  o.edi_bevestigd_op,
  o.edi_gewenste_afleverdatum,
  o.debiteur_zeker,
  o.debiteur_match_bron,
  b.zending_id          AS bundel_zending_id,
  b.bundel_zending_nr,
  b.bundel_order_count,
  o.levertijd_wijziging_te_bevestigen_sinds,
  o.bevestigd_at,
  o.afl_adres_incompleet_sinds,
  o.prijs_ontbreekt_sinds,
  o.express,
  -- Mig 516: permanente manco-markering + afleverland voor de Manco-tab/NL-DE-badge
  o.manco_sinds,
  o.afl_land
FROM orders o
LEFT JOIN debiteuren d         ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN bundel_per_order b   ON b.order_id    = o.id;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Sinds mig 451: express. '
  'Sinds mig 516: manco_sinds (permanente Manco-markering) + afl_land.';

-- ============================================================================
-- 5. markeer_colli_niet_gevonden — vereenvoudigd (base mig 217, modus weg).
--    Zet één colli op 'niet_gevonden' + opmerking. Afsplitsen naar manco gebeurt
--    bij voltooi_pickronde. Oude 3-arg (mig 211) en 4-arg (mig 217) gedropt.
-- ============================================================================
DROP FUNCTION IF EXISTS markeer_colli_niet_gevonden(BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS markeer_colli_niet_gevonden(BIGINT, TEXT, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION markeer_colli_niet_gevonden(
  p_zending_colli_id BIGINT,
  p_opmerking        TEXT DEFAULT NULL,
  p_picker_id        BIGINT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_zending_st zending_status;
BEGIN
  SELECT z.status INTO v_zending_st
    FROM zending_colli zc JOIN zendingen z ON z.id = zc.zending_id
   WHERE zc.id = p_zending_colli_id;
  IF v_zending_st IS NULL THEN
    RAISE EXCEPTION 'zending_colli % bestaat niet', p_zending_colli_id;
  END IF;
  IF v_zending_st <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde niet actief (status=%)', v_zending_st;
  END IF;

  UPDATE zending_colli
     SET pick_uitkomst   = 'niet_gevonden',
         pick_opmerking  = p_opmerking,
         gepickt_at      = NULL,
         gepickt_door_id = p_picker_id
   WHERE id = p_zending_colli_id;
END;
$$;
GRANT EXECUTE ON FUNCTION markeer_colli_niet_gevonden(BIGINT, TEXT, BIGINT) TO authenticated;

COMMENT ON FUNCTION markeer_colli_niet_gevonden(BIGINT, TEXT, BIGINT) IS
  'Mig 516 (base 217): vereenvoudigd. Zet één colli op ''niet_gevonden'' + '
  'opmerking + picker. Afsplitsen naar Manco gebeurt bij voltooi_pickronde.';

-- Herstel: zet een per ongeluk gemarkeerde colli terug naar 'open' (Toch gevonden).
CREATE OR REPLACE FUNCTION herstel_colli_pick(p_zending_colli_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_zending_st zending_status;
BEGIN
  SELECT z.status INTO v_zending_st
    FROM zending_colli zc JOIN zendingen z ON z.id = zc.zending_id
   WHERE zc.id = p_zending_colli_id;
  IF v_zending_st IS DISTINCT FROM 'Picken' THEN
    RAISE EXCEPTION 'Pickronde niet actief (status=%)', v_zending_st;
  END IF;
  UPDATE zending_colli
     SET pick_uitkomst  = 'open',
         pick_opmerking = NULL
   WHERE id = p_zending_colli_id AND pick_uitkomst = 'niet_gevonden';
END;
$$;
GRANT EXECUTE ON FUNCTION herstel_colli_pick(BIGINT) TO authenticated;

COMMENT ON FUNCTION herstel_colli_pick(BIGINT) IS
  'Mig 516: zet een op ''niet_gevonden'' gezette colli terug naar ''open'' '
  '(Toch gevonden). No-op als de colli al ''open'' is of de pickronde niet actief.';

-- ============================================================================
-- 6. Resolutie-RPC's (Manco-werklijst)
-- ============================================================================

-- Actie A — Weer beschikbaar → terug naar Pick & Ship. Gate weg, claim BLIJFT
-- staan (was bevroren) → regel direct weer pickbaar. [NL + DE]
CREATE OR REPLACE FUNCTION manco_terug_naar_pickship(p_order_regel_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order_id BIGINT; v_status order_status;
BEGIN
  SELECT ore.order_id, o.status INTO v_order_id, v_status
    FROM order_regels ore JOIN orders o ON o.id = ore.order_id
   WHERE ore.id = p_order_regel_id;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Orderregel % bestaat niet', p_order_regel_id USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE order_regels
     SET pick_backorder_sinds = NULL, pick_backorder_reden = NULL
   WHERE id = p_order_regel_id;

  INSERT INTO order_events (order_id, event_type, status_na, metadata)
  VALUES (v_order_id, 'manco_terug_naar_pickship', v_status,
          jsonb_build_object('order_regel_id', p_order_regel_id, 'migratie', 516));

  PERFORM herbereken_wacht_status(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION manco_terug_naar_pickship(BIGINT) TO authenticated;

COMMENT ON FUNCTION manco_terug_naar_pickship(BIGINT) IS
  'Mig 516: Manco-actie A. Wist de gate → regel terug in Pick & Ship (claim stond '
  'bevroren, dus direct pickbaar). Audit ''manco_terug_naar_pickship''.';

-- Actie B — Niet leverbaar uit voorraad. De ENIGE plek die de telling raakt
-- (optioneel: p_corrigeer_voorraad). Daarna land-afhankelijk:
--   NL  → wordt een normale backorder-tekortregel op deze order (gate weg, claim
--         vrij). herallocateer_orderregel is sinds mig 497 de KORTE vorm: alleen
--         een eigen-voorraad-claim als er nu voorraad is, GEEN automatische
--         inkoop-/alias-claim meer (bewust uitgezet — allocatie is nu een
--         handmatige binnendienst-keuze, mig 499/500). Resterend tekort blijft dus
--         open; de regel wordt weer pickbaar zodra er eigen voorraad voor het
--         artikel is en de reguliere allocatie 'm oppakt — net als elke andere
--         backorder. Order blijft 'Deels verzonden' (eindstatus-guard).
--   DE/overig → regel afgesloten (te_leveren=0, _geannuleerd_op); binnendienst
--         maakt evt. handmatig een nieuwe order.
CREATE OR REPLACE FUNCTION manco_niet_leverbaar(
  p_order_regel_id     BIGINT,
  p_corrigeer_voorraad BOOLEAN DEFAULT TRUE,
  p_reden              TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id          BIGINT;
  v_status            order_status;
  v_artikelnr         TEXT;
  v_is_maatwerk       BOOLEAN;
  v_afl_land          TEXT;
  v_deb_land          TEXT;
  v_land              TEXT;
  v_manco_qty         INTEGER;
  v_onverzonde_regels INTEGER;
  v_open_zendingen    INTEGER;
  v_verzonden_zend    INTEGER;
BEGIN
  SELECT ore.order_id, o.status, ore.artikelnr, ore.is_maatwerk, o.afl_land, d.land
    INTO v_order_id, v_status, v_artikelnr, v_is_maatwerk, v_afl_land, v_deb_land
    FROM order_regels ore
    JOIN orders o ON o.id = ore.order_id
    LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE ore.id = p_order_regel_id;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Orderregel % bestaat niet', p_order_regel_id USING ERRCODE = 'no_data_found';
  END IF;

  v_land := normaliseer_land(COALESCE(NULLIF(TRIM(v_afl_land), ''), v_deb_land));

  -- Manco-aantal uit de bevroren zending_regels (fallback 1).
  SELECT COALESCE(SUM(zr.manco_aantal), 0) INTO v_manco_qty
    FROM zending_regels zr WHERE zr.order_regel_id = p_order_regel_id;
  IF v_manco_qty <= 0 THEN v_manco_qty := 1; END IF;

  -- Voorraad-correctie (enige plek die producten.voorraad raakt). Alleen voor
  -- vaste-maat-artikelen met een echte voorraadtelling; maatwerk slaat dit over.
  IF p_corrigeer_voorraad AND v_artikelnr IS NOT NULL AND NOT COALESCE(v_is_maatwerk, false) THEN
    UPDATE producten
       SET voorraad = GREATEST(0, COALESCE(voorraad, 0) - v_manco_qty)
     WHERE artikelnr = v_artikelnr;
    PERFORM herbereken_product_reservering(v_artikelnr);
    INSERT INTO order_events (order_id, event_type, status_na, metadata)
    VALUES (v_order_id, 'manco_voorraad_gecorrigeerd', v_status,
            jsonb_build_object('order_regel_id', p_order_regel_id, 'artikelnr', v_artikelnr,
                               'aantal', v_manco_qty, 'migratie', 516));
  END IF;

  IF v_land = 'NL' THEN
    -- NL: wordt een normale backorder-tekortregel; claim vrij + herallocatie.
    -- herallocateer is sinds mig 497 de korte vorm (alleen eigen-voorraad-claim,
    -- geen auto-inkoop) — resterend tekort blijft open en wordt via de reguliere
    -- allocatie weer pickbaar zodra er eigen voorraad is. Order blijft 'Deels
    -- verzonden' (eindstatus-guard in derive_wacht_status, mig 346/351/352).
    UPDATE order_regels
       SET pick_backorder_sinds = NULL, pick_backorder_reden = NULL
     WHERE id = p_order_regel_id;
    PERFORM herallocateer_orderregel(p_order_regel_id);
    INSERT INTO order_events (order_id, event_type, status_na, metadata)
    VALUES (v_order_id, 'manco_niet_leverbaar', v_status,
            jsonb_build_object('order_regel_id', p_order_regel_id, 'land', 'NL',
                               'reden', p_reden, 'corrigeer_voorraad', p_corrigeer_voorraad,
                               'migratie', 516));
    RETURN;
  END IF;

  -- DE / buitenland: regel afsluiten op deze order.
  UPDATE order_regels
     SET te_leveren = 0, pick_backorder_geannuleerd_op = now()
   WHERE id = p_order_regel_id;
  PERFORM herallocateer_orderregel(p_order_regel_id);

  INSERT INTO order_events (order_id, event_type, status_na, metadata)
  VALUES (v_order_id, 'manco_niet_leverbaar', v_status,
          jsonb_build_object('order_regel_id', p_order_regel_id, 'land', v_land,
                             'reden', p_reden, 'corrigeer_voorraad', p_corrigeer_voorraad,
                             'migratie', 516));

  -- Order-status afleiden (spiegelt voltooi_pickronde/annuleer).
  IF NOT EXISTS (
    SELECT 1 FROM orders WHERE id = v_order_id AND status IN ('Verzonden', 'Geannuleerd')
  ) THEN
    SELECT COUNT(*) INTO v_open_zendingen
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order_id
           )
       AND z.status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    SELECT COUNT(*) INTO v_onverzonde_regels
      FROM order_regels ore
     WHERE ore.order_id = v_order_id
       AND NOT is_admin_pseudo(ore.artikelnr)
       AND ore.pick_backorder_geannuleerd_op IS NULL
       AND (
         ore.pick_backorder_sinds IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM zending_regels zr
            WHERE zr.order_regel_id = ore.id AND zr.aantal > 0
         )
       );

    IF v_open_zendingen = 0 AND v_onverzonde_regels = 0 THEN
      SELECT COUNT(*) INTO v_verzonden_zend
        FROM zendingen z
       WHERE z.id IN (
               SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
               UNION
               SELECT id FROM zendingen WHERE order_id = v_order_id
             )
         AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');
      IF v_verzonden_zend > 0 THEN
        PERFORM markeer_verzonden(v_order_id, NULL);
      ELSE
        PERFORM markeer_geannuleerd(
          p_order_id := v_order_id,
          p_reden    := COALESCE(p_reden, 'Manco — alle regels niet leverbaar')
        );
      END IF;
    ELSE
      PERFORM herbereken_wacht_status(v_order_id);
    END IF;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION manco_niet_leverbaar(BIGINT, BOOLEAN, TEXT) TO authenticated;

COMMENT ON FUNCTION manco_niet_leverbaar(BIGINT, BOOLEAN, TEXT) IS
  'Mig 516: Manco-actie B. Optionele voorraad-correctie (producten.voorraad − '
  'manco_aantal; enige telling-mutatie). NL → wordt een normale backorder-'
  'tekortregel (gate weg, herallocatie = korte vorm mig 497: alleen eigen '
  'voorraad, geen auto-inkoop). DE/overig → regel afgesloten '
  '(te_leveren=0, _geannuleerd_op) + order-status afgeleid. Land via '
  'normaliseer_land(afl_land→debiteur.land).';

-- ============================================================================
-- 7. Facturatie: manco-regels NIET factureren tot ze daadwerkelijk verstuurd zijn.
--    Een open manco (pick_backorder_sinds NOT NULL) of een afgesloten manco
--    (pick_backorder_geannuleerd_op NOT NULL) wordt uitgesloten uit elke
--    factuur-selectie + de gefactureerd-flip. Gevolg: de rest van de order wordt
--    gefactureerd, de manco-regel niet; wordt een NL-manco later alsnog verstuurd
--    (gate weg), dan valt hij weer in de selectie en wordt hij dán gefactureerd;
--    een DE-geannuleerde manco wordt nooit gefactureerd (was nooit geleverd).
--
--    Bodies BYTE-IDENTIEK overgenomen uit de huidige live versies (projecteer_
--    concept_factuur / genereer_factuur_voor_week / genereer_factuur = mig 456;
--    finaliseer_concept_factuur = mig 428), met UITSLUITEND de uitsluiting
--    `AND ... pick_backorder_sinds IS NULL AND ... pick_backorder_geannuleerd_op
--    IS NULL` toegevoegd op elke `gefactureerd < orderaantal`-selectie en flip.
--    (finaliseer delegeert de projectie aan projecteer; alleen zijn eigen flip is
--    aangepast.) Geen BTW-/regeling-logica gewijzigd.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.projecteer_concept_factuur(p_zending_id bigint, p_factuur_id bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id           BIGINT;
  v_factuur_nr           TEXT;
  v_zending              zendingen%ROWTYPE;
  v_debiteur             debiteuren%ROWTYPE;
  v_eerste_order         orders%ROWTYPE;
  v_btw_pct              NUMERIC(5,2);
  v_btw_regeling         RECORD;
  v_betaaltermijn_dagen  INTEGER := 30;
  v_aantal_te_factureren INTEGER;
  v_order_ids            BIGINT[];
  v_subtotaal            NUMERIC(12,2);
  v_btw_bedrag           NUMERIC(12,2);
  v_totaal               NUMERIC(12,2);
  v_bundel_subtotaal     NUMERIC(12,2);
  v_is_afhalen           BOOLEAN;
  v_vk                   RECORD;
BEGIN
  IF p_zending_id IS NULL THEN
    RAISE EXCEPTION 'p_zending_id is verplicht';
  END IF;

  SELECT * INTO v_zending FROM zendingen WHERE id = p_zending_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  SELECT array_agg(zo.order_id ORDER BY zo.order_id)
    INTO v_order_ids
    FROM zending_orders zo
   WHERE zo.zending_id = p_zending_id;

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Zending % heeft geen gekoppelde orders', p_zending_id;
  END IF;

  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(v_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Bundel-zending % kruist debiteur-grens (orders %)',
      p_zending_id, v_order_ids;
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren
   WHERE debiteur_nr = (SELECT DISTINCT debiteur_nr FROM orders WHERE id = ANY(v_order_ids));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Geen debiteur voor orders %', v_order_ids;
  END IF;

  -- Mig 456: eerste order van de bundel als representatief afleverland. Een
  -- bundel-zending wordt al gegroepeerd op genormaliseerd adres
  -- (start_pickronden), dus gemengd-land-binnen-1-bundel is een laag restrisico.
  SELECT * INTO v_eerste_order FROM orders WHERE id = v_order_ids[1];

  SELECT * INTO v_btw_regeling
    FROM bepaal_btw_regeling(
      v_eerste_order.afl_land,
      v_debiteur.land,
      v_eerste_order.afhalen,
      v_debiteur.btw_verlegd_intracom,
      v_debiteur.btw_nummer,
      v_debiteur.btw_percentage
    );

  v_btw_pct := v_btw_regeling.effectief_pct;
  v_betaaltermijn_dagen := betaaltermijn_dagen(v_debiteur.betaalconditie);

  -- Mig 456 (gecorrigeerd): GEEN blokkade hier — de factuur wordt altijd
  -- aangemaakt/bijgewerkt (zichtbaar als Concept met de "BTW controle
  -- nodig"-banner als v_btw_regeling.controle_nodig). De daadwerkelijke
  -- blokkade (vóór verzenden) zit in factuur-verzenden/index.ts.

  -- No-op-guard (mig 341): faal vroeg als alle regels al gefactureerd zijn.
  -- Bij projectie is de flip nog niet gedaan, dus dit telt de nog-open regels.
  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
     AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Zending % heeft geen te-factureren regels', p_zending_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Header: nieuw Concept of hergebruik (verse rebuild op bestaande factuur_id).
  IF p_factuur_id IS NULL THEN
    v_factuur_nr := volgend_nummer('FACT');
    INSERT INTO facturen (
      factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
      subtotaal, btw_percentage, btw_bedrag, totaal,
      fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
      btw_verlegd, btw_regeling, btw_controle_nodig_sinds
    ) VALUES (
      v_factuur_nr, v_debiteur.debiteur_nr, CURRENT_DATE,
      CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
      0, v_btw_pct, 0, 0,
      COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
      COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
      COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
      COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
      v_debiteur.land,
      v_debiteur.btw_nummer,
      (v_btw_regeling.regeling = 'eu_b2b_icl'),
      v_btw_regeling.regeling,
      CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END
    ) RETURNING id INTO v_factuur_id;
  ELSE
    v_factuur_id := p_factuur_id;
    -- Verse rebuild: wis de oude regels, herwaardeer de header-meta die in het
    -- venster gewijzigd kan zijn (btw/termijn/adres-snapshot). factuurdatum
    -- blijft de concept-datum.
    DELETE FROM factuur_regels WHERE factuur_id = v_factuur_id;
    UPDATE facturen SET
      btw_percentage = v_btw_pct,
      btw_verlegd    = (v_btw_regeling.regeling = 'eu_b2b_icl'),
      btw_regeling   = v_btw_regeling.regeling,
      btw_controle_nodig_sinds = CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END,
      vervaldatum    = factuurdatum + v_betaaltermijn_dagen,
      fact_naam      = COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
      fact_adres     = COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
      fact_postcode  = COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
      fact_plaats    = COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
      fact_land      = v_debiteur.land,
      btw_nummer     = v_debiteur.btw_nummer
     WHERE id = v_factuur_id;
  END IF;

  -- Product- + VERZEND-orderregels (1 factuur-regel per order x regel).
  -- BUNDELKORTING/DREMPELKORTING uitsluiten — die voegen we (als FACTUUR-regels)
  -- hieronder gespreid toe. GEEN flip van order_regels.gefactureerd (→ finaliseer).
  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.klant_referentie, o.order_nr,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(v_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
    AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
    AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING')
  ORDER BY orr.order_id, orr.regelnummer;

  -- Verzendkosten-status (mig 234) — bepaalt of DREMPELKORTING van toepassing is.
  SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
    INTO v_bundel_subtotaal
    FROM factuur_regels
   WHERE factuur_id = v_factuur_id
     AND COALESCE(artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING');

  SELECT BOOL_OR(COALESCE(o.afhalen, FALSE))
    INTO v_is_afhalen
    FROM orders o
   WHERE o.id = ANY(v_order_ids);

  SELECT * INTO v_vk
    FROM verzendkosten_voor_bundel(v_debiteur.debiteur_nr, v_bundel_subtotaal, v_is_afhalen);

  -- Korting-FACTUURregels gespreid per order (mig 341 deel 1+2). De ORDERregel-
  -- spiegeling (deel 3a/3b) verhuist naar finaliseer_concept_factuur.
  DECLARE
    v_aantal_verzend_regels   INTEGER;
    v_verzendkosten_per_order NUMERIC(8,2);
    v_korting_regelnr         INTEGER;
    v_order_idx               INTEGER;
    v_target_order_id         BIGINT;
    v_target_order_nr         TEXT;
    v_target_uw_referentie    TEXT;
  BEGIN
    SELECT COUNT(*), COALESCE(MIN(bedrag), 0)
      INTO v_aantal_verzend_regels, v_verzendkosten_per_order
      FROM factuur_regels
     WHERE factuur_id = v_factuur_id AND artikelnr = 'VERZEND';

    SELECT COALESCE(MAX(regelnummer), 0) INTO v_korting_regelnr
      FROM factuur_regels WHERE factuur_id = v_factuur_id;

    -- 1) DREMPELKORTING op order[1] (drempel-cadeau)
    IF v_vk.status = 'gratis_drempel' AND v_aantal_verzend_regels > 0 THEN
      SELECT order_nr, klant_referentie
        INTO v_target_order_nr, v_target_uw_referentie
        FROM orders WHERE id = v_order_ids[1];

      v_korting_regelnr := v_korting_regelnr + 1;
      INSERT INTO factuur_regels (
        factuur_id, order_id, order_regel_id, regelnummer,
        artikelnr, omschrijving,
        uw_referentie, order_nr,
        aantal, prijs, korting_pct, bedrag, btw_percentage
      ) VALUES (
        v_factuur_id, v_order_ids[1], NULL, v_korting_regelnr,
        'DREMPELKORTING',
        format('Drempelkorting verzending — vanaf €%s',
          to_char(v_debiteur.verzend_drempel, 'FM999999.00')),
        v_target_uw_referentie, v_target_order_nr,
        1, -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, v_btw_pct
      );
    END IF;

    -- 2) BUNDELKORTING per order[2..N] (één −verzendkosten-regel per order)
    IF v_verzendkosten_per_order > 0 AND v_aantal_verzend_regels > 1 THEN
      FOR v_order_idx IN 2..array_length(v_order_ids, 1) LOOP
        v_target_order_id := v_order_ids[v_order_idx];

        SELECT order_nr, klant_referentie
          INTO v_target_order_nr, v_target_uw_referentie
          FROM orders WHERE id = v_target_order_id;

        v_korting_regelnr := v_korting_regelnr + 1;
        INSERT INTO factuur_regels (
          factuur_id, order_id, order_regel_id, regelnummer,
          artikelnr, omschrijving,
          uw_referentie, order_nr,
          aantal, prijs, korting_pct, bedrag, btw_percentage
        ) VALUES (
          v_factuur_id, v_target_order_id, NULL, v_korting_regelnr,
          'BUNDELKORTING',
          format('Bundelkorting verzending (gebundeld %s orders)',
            v_aantal_verzend_regels),
          v_target_uw_referentie, v_target_order_nr,
          1, -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, v_btw_pct
        );
      END LOOP;
    END IF;
  END;

  -- Eindtotalen.
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$function$;

COMMENT ON FUNCTION public.projecteer_concept_factuur(bigint, bigint) IS
  'Mig 428, BTW-fix mig 449, regeling-bewust sinds mig 456: projecteert een '
  'concept-factuur (header + regels) voor een zending — herhaalbaar, geen '
  'side-effects. BTW-regeling via bepaal_btw_regeling (mig 455, afl_land-bewust) '
  'snapshot op btw_regeling/btw_controle_nodig_sinds — GEEN blokkade hier (zie '
  'mig 456-correctie); factuur-verzenden/index.ts blokkeert het versturen bij '
  'eu_b2b_binnenland_afwijking/export_buiten_eu, ná aanmaak, zodat de factuur '
  'zichtbaar blijft als Concept met de "BTW controle nodig"-banner.';

-- ============================================================================
-- 4. genereer_factuur_voor_week — zelfde patroon
-- ============================================================================

CREATE OR REPLACE FUNCTION public.genereer_factuur_voor_week(p_debiteur_nr integer, p_jaar_week text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id           BIGINT;
  v_factuur_nr           TEXT;
  v_debiteur             debiteuren%ROWTYPE;
  v_eerste_order         orders%ROWTYPE;
  v_btw_pct              NUMERIC(5,2);
  v_btw_regeling         RECORD;
  v_betaaltermijn_dagen  INTEGER := 30;
  v_aantal_te_factureren INTEGER;
  v_order_ids            BIGINT[];
  v_subtotaal            NUMERIC(12,2);
  v_btw_bedrag           NUMERIC(12,2);
  v_totaal               NUMERIC(12,2);
  v_volgnr               INTEGER;
  v_zending              RECORD;
  v_bundel_subtotaal     NUMERIC(12,2);
  v_aantal_orders_bundel INTEGER;
  v_te_betalen           NUMERIC(8,2);
  v_omschrijving         TEXT;
BEGIN
  IF p_debiteur_nr IS NULL OR p_jaar_week IS NULL THEN
    RAISE EXCEPTION 'p_debiteur_nr en p_jaar_week zijn verplicht';
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = p_debiteur_nr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debiteur % bestaat niet', p_debiteur_nr;
  END IF;

  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  -- Verzamel orders van deze (debiteur, week) die nog niet gefactureerd zijn.
  SELECT array_agg(o.id ORDER BY o.id)
    INTO v_order_ids
    FROM orders o
   WHERE o.debiteur_nr = p_debiteur_nr
     AND o.status = 'Verzonden'
     AND verzendweek_voor_datum(o.afleverdatum) = p_jaar_week
     AND NOT EXISTS (
       SELECT 1 FROM factuur_regels fr WHERE fr.order_id = o.id
     );

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Geen te-factureren orders gevonden voor debiteur % week %',
      p_debiteur_nr, p_jaar_week
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Mig 456: BTW-regeling op basis van de eerste order in de week-batch.
  SELECT * INTO v_eerste_order FROM orders WHERE id = v_order_ids[1];

  SELECT * INTO v_btw_regeling
    FROM bepaal_btw_regeling(
      v_eerste_order.afl_land, v_debiteur.land, v_eerste_order.afhalen,
      v_debiteur.btw_verlegd_intracom, v_debiteur.btw_nummer, v_debiteur.btw_percentage
    );
  v_btw_pct := v_btw_regeling.effectief_pct;

  -- Mig 456 (gecorrigeerd): geen blokkade hier — zie projecteer_concept_factuur.

  -- Mig 227-guard: tel daadwerkelijk te-factureren orderregels VÓÓR
  -- header-INSERT om lege facturen te voorkomen bij dubbele drain-aanroep.
  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
     AND COALESCE(orr.artikelnr, '') <> 'VERZEND';

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Order(s) % zijn al volledig gefactureerd — geen regels te factureren', v_order_ids
      USING ERRCODE = 'no_data_found';
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
    btw_verlegd, btw_regeling, btw_controle_nodig_sinds
  ) VALUES (
    v_factuur_nr, p_debiteur_nr, CURRENT_DATE, CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer,
    (v_btw_regeling.regeling = 'eu_b2b_icl'),
    v_btw_regeling.regeling,
    CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END
  ) RETURNING id INTO v_factuur_id;

  -- Product-regels (zelfde SELECT-shape als mig 227 genereer_factuur).
  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.klant_referentie, o.order_nr,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(v_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
    AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
    AND COALESCE(orr.artikelnr, '') <> 'VERZEND'
  ORDER BY orr.order_id, orr.regelnummer;

  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND pick_backorder_sinds IS NULL AND pick_backorder_geannuleerd_op IS NULL
     AND COALESCE(artikelnr, '') <> 'VERZEND';

  -- Verzending-regels: 1 per bundel-zending van deze (debiteur, week).
  SELECT COALESCE(MAX(regelnummer), 0) INTO v_volgnr
    FROM factuur_regels WHERE factuur_id = v_factuur_id;

  FOR v_zending IN
    SELECT z.id, z.zending_nr, z.vervoerder_code, z.afl_naam, z.afl_plaats
      FROM zendingen z
     WHERE z.verzendweek = p_jaar_week
       AND EXISTS (
         SELECT 1 FROM zending_orders zo
          WHERE zo.zending_id = z.id
            AND zo.order_id = ANY(v_order_ids)
       )
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
     ORDER BY z.id
  LOOP
    SELECT COALESCE(SUM(fr.bedrag), 0)::NUMERIC(12,2),
           COUNT(DISTINCT fr.order_id)::INTEGER
      INTO v_bundel_subtotaal, v_aantal_orders_bundel
      FROM factuur_regels fr
     WHERE fr.factuur_id = v_factuur_id
       AND fr.order_id IN (
         SELECT zo.order_id FROM zending_orders zo
          WHERE zo.zending_id = v_zending.id
       );

    IF v_aantal_orders_bundel = 0 THEN
      CONTINUE;
    END IF;

    IF v_zending.vervoerder_code IS NULL THEN
      v_te_betalen := 0;
      v_omschrijving := 'Afhalen — geen verzendkosten';
    ELSIF v_debiteur.gratis_verzending THEN
      v_te_betalen := 0;
      v_omschrijving := format(
        'Verzendkosten %s (%s, %s order%s) — gratis volgens klantafspraak',
        p_jaar_week, v_zending.vervoerder_code,
        v_aantal_orders_bundel,
        CASE WHEN v_aantal_orders_bundel = 1 THEN '' ELSE 's' END
      );
    ELSIF v_debiteur.verzend_drempel IS NOT NULL
          AND v_bundel_subtotaal >= v_debiteur.verzend_drempel THEN
      v_te_betalen := 0;
      v_omschrijving := format(
        'Verzendkosten %s (%s, %s order%s) — gratis vanaf €%s',
        p_jaar_week, v_zending.vervoerder_code,
        v_aantal_orders_bundel,
        CASE WHEN v_aantal_orders_bundel = 1 THEN '' ELSE 's' END,
        to_char(v_debiteur.verzend_drempel, 'FM999999.00')
      );
    ELSE
      v_te_betalen := COALESCE(v_debiteur.verzendkosten, 0);
      v_omschrijving := format(
        'Verzendkosten %s (%s, %s order%s)',
        p_jaar_week, v_zending.vervoerder_code,
        v_aantal_orders_bundel,
        CASE WHEN v_aantal_orders_bundel = 1 THEN '' ELSE 's' END
      );
    END IF;

    v_volgnr := v_volgnr + 1;

    INSERT INTO factuur_regels (
      factuur_id, order_id, order_regel_id, regelnummer,
      artikelnr, omschrijving,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_factuur_id,
      (SELECT MIN(zo.order_id) FROM zending_orders zo WHERE zo.zending_id = v_zending.id),
      NULL,
      v_volgnr,
      'VERZEND',
      v_omschrijving,
      1, v_te_betalen, 0, v_te_betalen, v_btw_pct
    );
  END LOOP;

  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$function$;

COMMENT ON FUNCTION public.genereer_factuur_voor_week(integer, text) IS
  'Legacy wekelijkse-verzamelfactuur-generatie (mig 117/122/231), BTW-fix mig '
  '453, regeling-bewust sinds mig 456 (bepaal_btw_regeling) — snapshot, GEEN '
  'blokkade hier (zie mig 456-correctie, factuur-verzenden/index.ts blokkeert '
  'het versturen). Nog actief voor factuurvoorkeur=wekelijks-debiteuren '
  '(momenteel 0).';

-- ============================================================================
-- 5. genereer_factuur — zelfde patroon
-- ============================================================================

CREATE OR REPLACE FUNCTION public.genereer_factuur(p_order_ids bigint[])
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id BIGINT;
  v_factuur_nr TEXT;
  v_debiteur_nr INTEGER;
  v_debiteur debiteuren%ROWTYPE;
  v_eerste_order orders%ROWTYPE;
  v_btw_regeling RECORD;
  v_subtotaal NUMERIC(12,2);
  v_btw_pct NUMERIC(5,2);
  v_btw_bedrag NUMERIC(12,2);
  v_totaal NUMERIC(12,2);
  v_betaaltermijn_dagen INTEGER := 30;
  v_aantal_te_factureren INTEGER;
BEGIN
  IF array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_order_ids mag niet leeg zijn';
  END IF;

  SELECT DISTINCT debiteur_nr INTO v_debiteur_nr
    FROM orders WHERE id = ANY(p_order_ids);
  IF v_debiteur_nr IS NULL THEN
    RAISE EXCEPTION 'Geen orders gevonden voor ids %', p_order_ids;
  END IF;
  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(p_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Orders behoren niet tot dezelfde debiteur';
  END IF;

  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(p_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL;
  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Order(s) % zijn al volledig gefactureerd — geen regels te factureren', p_order_ids
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = v_debiteur_nr;

  -- Mig 456: BTW-regeling op basis van de eerste order in de array.
  SELECT * INTO v_eerste_order FROM orders WHERE id = p_order_ids[1];

  SELECT * INTO v_btw_regeling
    FROM bepaal_btw_regeling(
      v_eerste_order.afl_land, v_debiteur.land, v_eerste_order.afhalen,
      v_debiteur.btw_verlegd_intracom, v_debiteur.btw_nummer, v_debiteur.btw_percentage
    );
  v_btw_pct := v_btw_regeling.effectief_pct;

  -- Mig 456 (gecorrigeerd): geen blokkade hier — zie projecteer_concept_factuur.

  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
    btw_verlegd, btw_regeling, btw_controle_nodig_sinds
  ) VALUES (
    v_factuur_nr, v_debiteur_nr, CURRENT_DATE, CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer,
    (v_btw_regeling.regeling = 'eu_b2b_icl'),
    v_btw_regeling.regeling,
    CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END
  ) RETURNING id INTO v_factuur_id;

  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.klant_referentie, o.order_nr,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(p_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
    AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
  ORDER BY orr.order_id, orr.regelnummer;

  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(p_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND pick_backorder_sinds IS NULL AND pick_backorder_geannuleerd_op IS NULL;
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$function$;

COMMENT ON FUNCTION public.genereer_factuur(bigint[]) IS
  'Legacy per_zending-factuur-generatie (mig 117/227), BTW-fix mig 453, '
  'regeling-bewust sinds mig 456. Fallback-tak in factuur-verzenden voor '
  'queue-rijen zonder zending_id (momenteel niet bereikbaar vanuit enige live '
  'enqueue-RPC).';

CREATE OR REPLACE FUNCTION finaliseer_concept_factuur(
  p_zending_id BIGINT,
  p_factuur_id BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_factuur_id BIGINT;
  v_order_ids  BIGINT[];
  v_admin_regelnr INTEGER;
  r RECORD;
BEGIN
  IF p_factuur_id IS NULL THEN
    RAISE EXCEPTION 'p_factuur_id is verplicht voor finalisatie';
  END IF;

  -- Verse rebuild op de bestaande concept-factuur.
  v_factuur_id := projecteer_concept_factuur(p_zending_id, p_factuur_id);

  SELECT array_agg(zo.order_id ORDER BY zo.order_id)
    INTO v_order_ids
    FROM zending_orders zo
   WHERE zo.zending_id = p_zending_id;

  -- Side-effect 1: flip gefactureerd (product + VERZEND; korting-orderregels
  -- bestaan hier nog niet en worden hieronder met gefactureerd=1 ingevoegd).
  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND pick_backorder_sinds IS NULL AND pick_backorder_geannuleerd_op IS NULL
     AND COALESCE(artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

  -- Side-effect 2: spiegel de korting-FACTUURregels naar korting-ORDERregels.
  -- bedrag <> 0 filtert het theoretische DREMPEL-bij-0-verzendkosten-geval
  -- (mig 341 deel 3a vereiste v_verzendkosten_per_order > 0).
  FOR r IN
    SELECT order_id, artikelnr, omschrijving, bedrag
      FROM factuur_regels
     WHERE factuur_id = v_factuur_id
       AND artikelnr IN ('DREMPELKORTING', 'BUNDELKORTING')
       AND bedrag <> 0
     ORDER BY regelnummer
  LOOP
    SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_admin_regelnr
      FROM order_regels WHERE order_id = r.order_id;
    INSERT INTO order_regels (
      order_id, regelnummer, artikelnr, omschrijving,
      orderaantal, te_leveren, gefactureerd,
      prijs, korting_pct, bedrag, gewicht_kg
    ) VALUES (
      r.order_id, v_admin_regelnr, r.artikelnr, r.omschrijving,
      1, 0, 1,
      r.bedrag, 0, r.bedrag, 0
    );
  END LOOP;

  RETURN v_factuur_id;
END;
$$;

COMMENT ON FUNCTION finaliseer_concept_factuur(BIGINT, BIGINT) IS
  'Mig 428: eenmalige finalisatie van een concept-factuur. Herprojecteert vers en '
  'past dán de side-effects toe: gefactureerd-flip + korting-orderregels (gespiegeld '
  'uit de korting-factuurregels). Aanroepen via de drain alleen als '
  'factuur_queue.gefinaliseerd_op NULL is (retry-veilig).';

GRANT EXECUTE ON FUNCTION finaliseer_concept_factuur(BIGINT, BIGINT)
  TO authenticated, service_role;

-- NB verwerk_concept_queue (mig 428) wordt bewust NIET hier herdefinieerd: die
-- roept projecteer_concept_factuur bij naam aan en erft de manco-uitsluiting
-- automatisch. (Dit comment-restant kwam mee uit de mig-456-extractie.)

NOTIFY pgrst, 'reload schema';
