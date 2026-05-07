-- Migratie 217: Pickronde krijgt Picker, voltooi sluit factuur-keten
--
-- Achtergrond: ADR-0005. voltooi_pickronde flipte alleen zending-status
-- naar 'Klaar voor verzending'; orders.status='Verzonden' werd nergens
-- gezet, dus mig-118-factuur-trigger vuurde nooit. Plus: ADR-0004 heeft
-- de Medewerker-tabel geintroduceerd (mig 216) en de Pickronde-RPCs
-- moeten de Picker als verplichte parameter accepteren — anders blijft
-- de "wie heeft gepickt"-audit-trail leeg.
--
-- Wijzigingen:
--   1. orders.verzonden_at TIMESTAMPTZ (audit, set door voltooi_pickronde)
--   2. zendingen.picker_id BIGINT REFERENCES medewerkers(id)
--   3. zending_colli.gepickt_door_id BIGINT REFERENCES medewerkers(id)
--   4. start_pickronde(p_order_id, p_picker_id) — picker verplicht
--   5. markeer_colli_niet_gevonden(... p_picker_id) — picker verplicht
--   6. voltooi_pickronde(p_zending_id, p_picker_id) — picker verplicht
--      + factuur-keten sluitstuk: bij laatste open zending van order
--        flip orders.status='Verzonden' + verzonden_at=now()
--   7. create_zending_voor_order alias accepteert ook p_picker_id
--
-- Idempotent: kolommen via ADD COLUMN IF NOT EXISTS, RPCs via
-- CREATE OR REPLACE op nieuwe signatuur. Oude 1-arg/3-arg signaturen
-- worden expliciet gedropt.

------------------------------------------------------------------------
-- 1. Schema-additions
------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS verzonden_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.verzonden_at IS
  'Mig 217 (ADR-0005): moment waarop voltooi_pickronde de order op '
  'status=Verzonden zette (= laatste open zending werd Klaar voor '
  'verzending). Triggert factuur-queue (mig 118).';

ALTER TABLE zendingen
  ADD COLUMN IF NOT EXISTS picker_id BIGINT
    REFERENCES medewerkers(id) ON DELETE SET NULL;

COMMENT ON COLUMN zendingen.picker_id IS
  'Mig 217: Medewerker met rol picker die deze Pickronde startte/voltooide.';

CREATE INDEX IF NOT EXISTS zendingen_picker_id_idx ON zendingen(picker_id);

ALTER TABLE zending_colli
  ADD COLUMN IF NOT EXISTS gepickt_door_id BIGINT
    REFERENCES medewerkers(id) ON DELETE SET NULL;

COMMENT ON COLUMN zending_colli.gepickt_door_id IS
  'Mig 217: Medewerker die deze colli markeerde (gepickt of niet_gevonden). '
  'Per-colli audit-trail; kan afwijken van zendingen.picker_id bij '
  'shift-overgang tijdens een Pickronde.';

CREATE INDEX IF NOT EXISTS orders_verzonden_at_idx ON orders(verzonden_at);

------------------------------------------------------------------------
-- 2. Drop oude 1-arg/3-arg signaturen (worden vervangen door 2-arg/4-arg)
------------------------------------------------------------------------
DROP FUNCTION IF EXISTS create_zending_voor_order(BIGINT);
DROP FUNCTION IF EXISTS start_pickronde(BIGINT);
DROP FUNCTION IF EXISTS voltooi_pickronde(BIGINT);
DROP FUNCTION IF EXISTS markeer_colli_niet_gevonden(BIGINT, TEXT, TEXT);

------------------------------------------------------------------------
-- 3. Helper: valideer dat picker_id een actieve picker-medewerker is
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _valideer_picker(p_picker_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF p_picker_id IS NULL THEN
    RAISE EXCEPTION 'Picker is verplicht (p_picker_id mag niet NULL zijn)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM medewerkers
     WHERE id = p_picker_id
       AND 'picker' = ANY(rollen)
       AND actief
  ) THEN
    RAISE EXCEPTION 'Medewerker % is geen actieve picker', p_picker_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END;
$$;

------------------------------------------------------------------------
-- 4. start_pickronde — picker verplicht
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION start_pickronde(
  p_order_id  BIGINT,
  p_picker_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_zending_id     BIGINT;
  v_zending_status zending_status;
  v_zending_nr     TEXT;
  v_order          orders%ROWTYPE;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  SELECT id, status INTO v_zending_id, v_zending_status FROM zendingen
   WHERE order_id = p_order_id
     AND status NOT IN ('Afgeleverd')
   ORDER BY id DESC LIMIT 1;

  IF v_zending_id IS NOT NULL THEN
    -- Bestaande zending hergebruiken: sync colli's, aggregaten, picker.
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
           )),
           -- Picker overschrijven: laatste claim wint (shift-overgang).
           picker_id = p_picker_id
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
    zending_nr, order_id, status, picker_id,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    verzenddatum, aantal_colli, totaal_gewicht_kg
  ) VALUES (
    v_zending_nr, p_order_id, 'Picken', p_picker_id,
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

  PERFORM genereer_zending_colli(v_zending_id);
  RETURN v_zending_id;
END;
$$;

GRANT EXECUTE ON FUNCTION start_pickronde(BIGINT, BIGINT) TO authenticated;

COMMENT ON FUNCTION start_pickronde(BIGINT, BIGINT) IS
  'Mig 217: Start een Pickronde voor een order met expliciete Picker. '
  'Maakt zending in status Picken aan, koppelt picker_id, genereert colli-rijen. '
  'Idempotent: bestaande open zending wordt hergebruikt en picker_id geupdate. '
  'Faalt als p_picker_id geen actieve picker-medewerker is.';

------------------------------------------------------------------------
-- 5. markeer_colli_niet_gevonden — picker verplicht
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION markeer_colli_niet_gevonden(
  p_zending_colli_id BIGINT,
  p_modus            TEXT,
  p_opmerking        TEXT,
  p_picker_id        BIGINT
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_zending_id     BIGINT;
  v_order_id       BIGINT;
  v_lever_modus    TEXT;
  v_zending_st     zending_status;
  v_order_regel_id BIGINT;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

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
           gepickt_at      = NULL,
           gepickt_door_id = p_picker_id
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

  -- Verwijder de colli-rij zelf.
  DELETE FROM zending_colli WHERE id = p_zending_colli_id;

  -- Sync aantal_colli op zending.
  UPDATE zendingen
     SET aantal_colli = (SELECT COUNT(*) FROM zending_colli WHERE zending_id = v_zending_id)
   WHERE id = v_zending_id;
END;
$$;

GRANT EXECUTE ON FUNCTION markeer_colli_niet_gevonden(BIGINT, TEXT, TEXT, BIGINT) TO authenticated;

COMMENT ON FUNCTION markeer_colli_niet_gevonden(BIGINT, TEXT, TEXT, BIGINT) IS
  'Mig 217: Markeert colli als niet_gevonden tijdens Pickronde. picker_id is '
  'verplicht voor audit. modus=blokkeer houdt zending in Picken; splits vereist '
  'lever_modus=deelleveringen. gepickt_door_id wordt gezet bij blokkeer.';

------------------------------------------------------------------------
-- 6. voltooi_pickronde — picker + factuur-keten sluitstuk
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION voltooi_pickronde(
  p_zending_id BIGINT,
  p_picker_id  BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig             zending_status;
  v_aantal_niet_gev    INTEGER;
  v_order_id           BIGINT;
  v_open_zendingen     INTEGER;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  SELECT status, order_id INTO v_huidig, v_order_id
    FROM zendingen WHERE id = p_zending_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;
  IF v_huidig <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde voor zending % is niet actief (status=%)', p_zending_id, v_huidig;
  END IF;

  -- Guard: openstaande pick-problemen blokkeren voltooiing.
  SELECT COUNT(*) INTO v_aantal_niet_gev
    FROM zending_colli
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'niet_gevonden';

  IF v_aantal_niet_gev > 0 THEN
    RAISE EXCEPTION 'Pickronde heeft % openstaand(e) pick-probleem(en) — los op of splits eerst',
      v_aantal_niet_gev
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Default-aan: open colli's worden gepickt + audit-actor wegschrijven.
  UPDATE zending_colli
     SET pick_uitkomst   = 'gepickt',
         gepickt_at      = now(),
         gepickt_door_id = p_picker_id
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'open';

  -- Status-flip: bestaande trg_zending_klaar_voor_verzending vuurt automatisch.
  UPDATE zendingen
     SET status    = 'Klaar voor verzending',
         picker_id = COALESCE(picker_id, p_picker_id)
   WHERE id = p_zending_id;

  -- Sluitstuk factuur-keten: orders.status='Verzonden' alleen als dit de
  -- LAATSTE open zending van de order is. Bij deelleveringen blijft de
  -- order op zijn huidige status tot ALLE zendingen Klaar voor verzending zijn.
  SELECT COUNT(*) INTO v_open_zendingen
    FROM zendingen
   WHERE order_id = v_order_id
     AND status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd', 'Geannuleerd');

  IF v_open_zendingen = 0 THEN
    UPDATE orders
       SET status        = 'Verzonden',
           verzonden_at  = now()
     WHERE id = v_order_id
       AND status NOT IN ('Verzonden', 'Geannuleerd');
    -- trg_enqueue_factuur (mig 118) vuurt automatisch op deze status-overgang.
  END IF;

  RETURN p_zending_id;
END;
$$;

GRANT EXECUTE ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) TO authenticated;

COMMENT ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) IS
  'Mig 217 (ADR-0005): sluit Pickronde af. Zet open colli op gepickt + '
  'gepickt_door_id, flipt zending naar Klaar voor verzending (HST-trigger '
  'vuurt). Sluitstuk: bij laatste open zending van order flipt orders.status '
  'naar Verzonden + verzonden_at=now() — factuur-trigger (mig 118) vuurt dan.';

------------------------------------------------------------------------
-- 7. create_zending_voor_order alias — nu met picker_id
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_zending_voor_order(
  p_order_id  BIGINT,
  p_picker_id BIGINT
) RETURNS BIGINT
LANGUAGE sql AS $$
  SELECT start_pickronde(p_order_id, p_picker_id);
$$;

GRANT EXECUTE ON FUNCTION create_zending_voor_order(BIGINT, BIGINT) TO authenticated;

COMMENT ON FUNCTION create_zending_voor_order(BIGINT, BIGINT) IS
  'Mig 217: alias voor start_pickronde met expliciete picker. Behouden voor '
  'bestaande callers (zending-aanmaken-knop op order-detail). De 1-arg variant '
  'is gedropt — frontend moet picker_id meegeven.';

NOTIFY pgrst, 'reload schema';
