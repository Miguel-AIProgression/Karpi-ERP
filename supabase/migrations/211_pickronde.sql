-- Migratie 211: Pickronde — pick-uitkomst per colli + status-default 'Picken'
--
-- Achtergrond: zie ADR-0003. create_zending_voor_order zette zendingen direct
-- op 'Klaar voor verzending', wat de HST-dispatch-trigger te vroeg activeerde.
-- Deze migratie:
--   1. Voegt enum `pick_uitkomst` + 3 kolommen toe aan zending_colli
--   2. Wijzigt create_zending_voor_order zodat zending in 'Picken' start
--   3. Introduceert drie RPCs: start_pickronde, markeer_colli_niet_gevonden,
--      voltooi_pickronde
--
-- Bestaande zendingen (status NIET 'Picken') zijn niet retroactief gemigreerd
-- — die hebben al geen Pickronde-flow nodig.
--
-- Idempotent.

DO $$ BEGIN
  CREATE TYPE pick_uitkomst AS ENUM ('open', 'gepickt', 'niet_gevonden');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE zending_colli
  ADD COLUMN IF NOT EXISTS pick_uitkomst pick_uitkomst NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS pick_opmerking TEXT,
  ADD COLUMN IF NOT EXISTS gepickt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_zending_colli_pick_uitkomst
  ON zending_colli (zending_id, pick_uitkomst);

COMMENT ON COLUMN zending_colli.pick_uitkomst IS
  'Per-colli uitkomst tijdens Pickronde. Default ''open''. Bij voltooi_pickronde '
  'worden alle ''open''-rijen automatisch op ''gepickt'' gezet (vinkjes-default-aan).';
COMMENT ON COLUMN zending_colli.pick_opmerking IS
  'Operator-notitie bij niet_gevonden (waarom kon dit niet gevonden worden).';
COMMENT ON COLUMN zending_colli.gepickt_at IS
  'Moment van voltooi_pickronde. NULL zolang colli niet gepickt is.';

-- ============================================================================
-- start_pickronde: vervangt de oude semantiek van create_zending_voor_order.
-- Maakt zending aan in status 'Picken' (niet meer 'Klaar voor verzending'),
-- genereert colli-rijen via genereer_zending_colli, returnt zending_id.
-- Idempotent: bestaande open zending voor de order wordt hergebruikt.
-- ============================================================================
CREATE OR REPLACE FUNCTION start_pickronde(p_order_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_zending_id     BIGINT;
  v_zending_status zending_status;
  v_zending_nr     TEXT;
  v_order          orders%ROWTYPE;
BEGIN
  SELECT id, status INTO v_zending_id, v_zending_status FROM zendingen
   WHERE order_id = p_order_id
     AND status NOT IN ('Afgeleverd')
   ORDER BY id DESC LIMIT 1;

  IF v_zending_id IS NOT NULL THEN
    -- Bestaande zending: zorg dat colli's bestaan en update aggregaten.
    PERFORM genereer_zending_colli(v_zending_id);

    UPDATE zendingen
       SET aantal_colli = COALESCE(aantal_colli, (
             SELECT COALESCE(SUM(COALESCE(ore.orderaantal, 0)), 0)::INTEGER
               FROM order_regels ore
              WHERE ore.order_id = p_order_id
                AND COALESCE(ore.artikelnr, '') <> 'VERZEND'
           )),
           totaal_gewicht_kg = COALESCE(totaal_gewicht_kg, (
             SELECT NULLIF(
               ROUND(COALESCE(SUM(COALESCE(ore.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0), 2),
               0
             )
               FROM order_regels ore
              WHERE ore.order_id = p_order_id
                AND COALESCE(ore.artikelnr, '') <> 'VERZEND'
           ))
     WHERE id = v_zending_id;

    -- Zending al doorgestroomd? Dan dispatch (mig 206-gedrag behouden).
    IF v_zending_status = 'Klaar voor verzending' THEN
      PERFORM enqueue_zending_naar_vervoerder(v_zending_id);
    END IF;
    RETURN v_zending_id;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr, order_id, status,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    verzenddatum, aantal_colli, totaal_gewicht_kg
  ) VALUES (
    v_zending_nr, p_order_id, 'Picken',  -- ← was 'Klaar voor verzending'
    v_order.afl_naam, v_order.afl_adres, v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
    CURRENT_DATE,
    (SELECT COALESCE(SUM(COALESCE(ore.orderaantal, 0)), 0)::INTEGER
       FROM order_regels ore
      WHERE ore.order_id = p_order_id AND COALESCE(ore.artikelnr, '') <> 'VERZEND'),
    (SELECT NULLIF(ROUND(COALESCE(SUM(COALESCE(ore.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0), 2), 0)
       FROM order_regels ore
      WHERE ore.order_id = p_order_id AND COALESCE(ore.artikelnr, '') <> 'VERZEND')
  ) RETURNING id INTO v_zending_id;

  INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
  SELECT v_zending_id, ore.id, ore.orderaantal
    FROM order_regels ore
   WHERE ore.order_id = p_order_id
     AND COALESCE(ore.orderaantal, 0) > 0
     AND COALESCE(ore.artikelnr, '') <> 'VERZEND';

  -- Genereer SSCC-colli's voor de zending. HST-dispatch vuurt NIET op 'Picken' —
  -- pas bij voltooi_pickronde flipt de status en wordt enqueue_… aangeroepen.
  PERFORM genereer_zending_colli(v_zending_id);
  RETURN v_zending_id;
END;
$$;

GRANT EXECUTE ON FUNCTION start_pickronde(BIGINT) TO authenticated;

COMMENT ON FUNCTION start_pickronde IS
  'Start een Pickronde voor een order: maakt zending in status ''Picken'' aan + '
  'genereert colli-rijen. Idempotent. Dispatch naar vervoerder vuurt PAS op '
  'voltooi_pickronde. Bestaande open zending wordt hergebruikt.';

-- Backwards-compat alias: bestaande callers (zending-aanmaken-knop op
-- order-detail) blijven werken. Verwijderen kan later in een aparte migratie.
CREATE OR REPLACE FUNCTION create_zending_voor_order(p_order_id BIGINT)
RETURNS BIGINT
LANGUAGE sql AS $$
  SELECT start_pickronde(p_order_id);
$$;

GRANT EXECUTE ON FUNCTION create_zending_voor_order(BIGINT) TO authenticated;

COMMENT ON FUNCTION create_zending_voor_order IS
  'Mig 211: alias voor start_pickronde. Behouden voor bestaande callers (zending-'
  'aanmaken-knop op order-detail). Nieuwe code roept start_pickronde direct aan.';

-- ============================================================================
-- markeer_colli_niet_gevonden: operator markeert één colli als niet vindbaar.
-- Twee modi:
--   'blokkeer' — colli krijgt pick_uitkomst='niet_gevonden'. Zending blijft in
--                'Picken'. Verschijnt op pick-problemen-werklijst voor chef.
--   'splits'   — colli wordt losgekoppeld (zending_regels-aantal verlaagd of
--                row verwijderd). Vereist orders.lever_modus = 'deelleveringen'.
--                Orderregel blijft open in de order voor latere Pickronde.
-- ============================================================================
CREATE OR REPLACE FUNCTION markeer_colli_niet_gevonden(
  p_zending_colli_id BIGINT,
  p_modus            TEXT,
  p_opmerking        TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_zending_id    BIGINT;
  v_order_id      BIGINT;
  v_lever_modus   TEXT;
  v_zending_st    zending_status;
  v_order_regel_id BIGINT;
BEGIN
  IF p_modus NOT IN ('blokkeer', 'splits') THEN
    RAISE EXCEPTION 'modus moet ''blokkeer'' of ''splits'' zijn (kreeg %)', p_modus;
  END IF;

  SELECT zc.zending_id, zc.order_regel_id, z.status, z.order_id
    INTO v_zending_id, v_order_regel_id, v_zending_st, v_order_id
    FROM zending_colli zc
    JOIN zendingen z ON z.id = zc.zending_id
   WHERE zc.id = p_zending_colli_id;

  IF v_zending_id IS NULL THEN
    RAISE EXCEPTION 'zending_colli % bestaat niet', p_zending_colli_id;
  END IF;

  IF v_zending_st <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde voor zending % is niet actief (status=%)', v_zending_id, v_zending_st;
  END IF;

  IF p_modus = 'blokkeer' THEN
    UPDATE zending_colli
       SET pick_uitkomst   = 'niet_gevonden',
           pick_opmerking  = p_opmerking,
           gepickt_at      = NULL
     WHERE id = p_zending_colli_id;
    RETURN;
  END IF;

  -- p_modus = 'splits': vereist deelleveringen.
  SELECT lever_modus INTO v_lever_modus FROM orders WHERE id = v_order_id;
  IF v_lever_modus IS DISTINCT FROM 'deelleveringen' THEN
    RAISE EXCEPTION 'Splitsen vereist order.lever_modus=''deelleveringen'' (was %)', v_lever_modus;
  END IF;

  -- Verlaag aantal op zending_regels; verwijder regel-rij als aantal=0.
  UPDATE zending_regels
     SET aantal = aantal - 1
   WHERE zending_id = v_zending_id
     AND order_regel_id = v_order_regel_id
     AND aantal > 0;

  DELETE FROM zending_regels
   WHERE zending_id = v_zending_id
     AND order_regel_id = v_order_regel_id
     AND COALESCE(aantal, 0) = 0;

  -- Verwijder de colli-rij zelf (CASCADE zorgt voor schoonmaken refs).
  DELETE FROM zending_colli WHERE id = p_zending_colli_id;

  -- Sync aantal_colli op zending.
  UPDATE zendingen
     SET aantal_colli = (SELECT COUNT(*) FROM zending_colli WHERE zending_id = v_zending_id)
   WHERE id = v_zending_id;

  -- NB: order_regels.te_leveren wordt NIET hier aangepast — dat veld leeft op
  -- de orderregel en wordt beheerd door de bestaande shipment-status-pipeline
  -- (eerstvolgende `start_pickronde` voor dezelfde order pakt het op).
  -- Indien op staging blijkt dat de orderregel niet automatisch terugkomt op
  -- de pick-card, voeg dan een herallocatie-call toe (volg-issue, niet V1).
END;
$$;

GRANT EXECUTE ON FUNCTION markeer_colli_niet_gevonden(BIGINT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION markeer_colli_niet_gevonden IS
  'Markeert één colli als niet gevonden tijdens Pickronde. modus=''blokkeer'' '
  'houdt zending in ''Picken''; ''splits'' verwijdert colli (vereist '
  'lever_modus=''deelleveringen''). Niet bruikbaar als pickronde voltooid is.';
