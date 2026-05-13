-- Migration 274: snijplan-rij = 1 fysiek maatwerk-stuk, niet 1 orderregel
--
-- CONTEXT
-- `auto_maak_snijplan()` (mig 110) maakte 1 snijplan-rij aan ongeacht
-- `order_regels.orderaantal`. Voor maatwerk-orderregel met orderaantal=N werd
-- dus 1 snijplan gemaakt i.p.v. N. De optimalisatie kende alleen 1 stuk.
-- Reproductie: ORD-2026-2067 / regel BILA 14 200×230 aantal=5 / rol I3900BIL14I.
--
-- Zie ADR-0019 voor afwegingen. Beslissing: één snijplan-rij = één fysiek
-- stuk; trigger expandeert orderaantal naar N rijen, ieder met eigen
-- snijplan_nr (= eigen sticker).
--
-- WIJZIGINGEN
--   1. auto_maak_snijplan(): FOR-loop over orderaantal; volgend_nummer('SNIJ')
--      per iteratie zodat snijplan_nr uniek blijft. Opmerking '(i/N)' voor
--      traceability.
--
--   2. auto_sync_snijplan_maten(): sync álle snijplannen van de regel (geen
--      LIMIT 1). Veiligheidsslot blijft per snijplan: stuks met rol_id of
--      voorbij Snijden worden geskipt en uit een WARNING gemeld. INSERT-
--      fallback expandeert ook naar orderaantal.
--
--   3. Backfill: voor maatwerk-regels in non-eindstatus orders waar
--      COUNT(snijplannen) < orderaantal: vul aan met 'Wacht'-rijen met
--      dezelfde maten. Eindstatus (Verzonden, Geannuleerd) overslaan.
--
-- BEKENDE BEPERKING (uit ADR-0019)
-- UPDATE-trigger luistert NIET op orderaantal-mutaties. orderaantal 5→7 of
-- 5→3 na insert wordt niet gesynced — handmatige release+hersnijden nodig.

-- ---------------------------------------------------------------------------
-- 1. auto_maak_snijplan: expandeer naar orderaantal
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auto_maak_snijplan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_aantal INTEGER;
  i        INTEGER;
BEGIN
  IF NEW.is_maatwerk IS NOT TRUE
     OR NEW.maatwerk_lengte_cm  IS NULL
     OR NEW.maatwerk_breedte_cm IS NULL
  THEN
    RETURN NEW;
  END IF;

  -- Idempotency: als er al snijplannen zijn voor deze regel (bv. door een
  -- vorige insert-poging of door auto_sync_snijplan_maten die alvast aanvulde),
  -- niet opnieuw inserten. We expanderen vanaf 0; al-aanwezige rijen blijven.
  IF EXISTS (SELECT 1 FROM snijplannen WHERE order_regel_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_aantal := GREATEST(COALESCE(NEW.orderaantal, 1), 1);

  FOR i IN 1..v_aantal LOOP
    INSERT INTO snijplannen (
      snijplan_nr, order_regel_id,
      lengte_cm, breedte_cm,
      status, opmerkingen
    )
    VALUES (
      volgend_nummer('SNIJ'),       -- per iteratie unieke nr
      NEW.id,
      NEW.maatwerk_lengte_cm::INTEGER,
      NEW.maatwerk_breedte_cm::INTEGER,
      'Wacht'::snijplan_status,
      CASE WHEN v_aantal > 1
           THEN 'Auto-aangemaakt (' || i || '/' || v_aantal || ')'
           ELSE 'Auto-aangemaakt'
      END
    );
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_maak_snijplan() IS
  'AFTER INSERT op order_regels: maakt N snijplan-rijen aan voor maatwerk, '
  'met N = orderaantal. Eén snijplan-rij = één fysiek stuk = één sticker '
  '(ADR-0019). Idempotent: skip als er al snijplannen voor de regel staan.';

-- ---------------------------------------------------------------------------
-- 2. auto_sync_snijplan_maten: sync álle snijplannen, expandeer als nodig
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auto_sync_snijplan_maten()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_aantal_bestaand INTEGER;
  v_aantal_target   INTEGER;
  v_geblokkeerd     INTEGER;
  i                 INTEGER;
BEGIN
  IF NEW.is_maatwerk IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.maatwerk_lengte_cm  IS NOT DISTINCT FROM OLD.maatwerk_lengte_cm
     AND NEW.maatwerk_breedte_cm IS NOT DISTINCT FROM OLD.maatwerk_breedte_cm
  THEN
    RETURN NEW;
  END IF;

  v_aantal_target := GREATEST(COALESCE(NEW.orderaantal, 1), 1);

  SELECT COUNT(*) INTO v_aantal_bestaand
    FROM snijplannen WHERE order_regel_id = NEW.id;

  -- Fallback: geen snijplannen — gedraag je als auto_maak_snijplan.
  IF v_aantal_bestaand = 0 THEN
    IF NEW.maatwerk_lengte_cm IS NOT NULL AND NEW.maatwerk_breedte_cm IS NOT NULL THEN
      FOR i IN 1..v_aantal_target LOOP
        INSERT INTO snijplannen (
          snijplan_nr, order_regel_id,
          lengte_cm, breedte_cm,
          status, opmerkingen
        )
        VALUES (
          volgend_nummer('SNIJ'),
          NEW.id,
          NEW.maatwerk_lengte_cm::INTEGER,
          NEW.maatwerk_breedte_cm::INTEGER,
          'Wacht'::snijplan_status,
          CASE WHEN v_aantal_target > 1
               THEN 'Auto-aangemaakt na update (' || i || '/' || v_aantal_target || ')'
               ELSE 'Auto-aangemaakt na update'
          END
        );
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;

  -- Sync: update álle snijplannen die nog veilig zijn (geen rol, status in
  -- Wacht/Gepland/Snijden). Snijplannen met rol_id of voorbij Snijden krijgen
  -- een WARNING; daar is een handmatige release-en-hersnijden-flow voor nodig.
  IF NEW.maatwerk_lengte_cm IS NULL OR NEW.maatwerk_breedte_cm IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_geblokkeerd
    FROM snijplannen
   WHERE order_regel_id = NEW.id
     AND (rol_id IS NOT NULL
          OR status NOT IN ('Wacht'::snijplan_status,
                            'Gepland'::snijplan_status,
                            'Snijden'::snijplan_status));

  IF v_geblokkeerd > 0 THEN
    RAISE WARNING
      'Snijplannen voor order_regel % gedeeltelijk NIET bijgewerkt: % stuks '
      'hebben rol of voorbij Snijden. Release + hersnijden nodig.',
      NEW.id, v_geblokkeerd;
  END IF;

  UPDATE snijplannen
     SET lengte_cm  = NEW.maatwerk_lengte_cm::INTEGER,
         breedte_cm = NEW.maatwerk_breedte_cm::INTEGER
   WHERE order_regel_id = NEW.id
     AND rol_id IS NULL
     AND status IN ('Wacht'::snijplan_status,
                    'Gepland'::snijplan_status,
                    'Snijden'::snijplan_status);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_sync_snijplan_maten() IS
  'AFTER UPDATE op order_regels: synct maatwerk-maten naar álle snijplannen '
  'van de regel (geen LIMIT 1 meer — ADR-0019). Snijplannen met rol of '
  'voorbij Snijden worden geskipt + WARNING gelogd.';

-- ---------------------------------------------------------------------------
-- 3. Backfill: vul ontbrekende snijplannen aan voor non-eindstatus orders
-- ---------------------------------------------------------------------------
-- We loopen per regel zodat volgend_nummer('SNIJ') per rij wordt geëvalueerd
-- (anders krijgen alle nieuwe rijen hetzelfde nummer en violeer je de unique-
-- constraint op snijplan_nr).

DO $$
DECLARE
  r            RECORD;
  v_te_maken   INTEGER;
  i            INTEGER;
  v_totaal     INTEGER := 0;
BEGIN
  FOR r IN
    SELECT oreg.id            AS regel_id,
           oreg.orderaantal,
           oreg.maatwerk_lengte_cm,
           oreg.maatwerk_breedte_cm,
           COUNT(s.id)::INTEGER AS aantal_snijplannen
      FROM order_regels oreg
      JOIN orders o ON o.id = oreg.order_id
      LEFT JOIN snijplannen s ON s.order_regel_id = oreg.id
     WHERE oreg.is_maatwerk = TRUE
       AND oreg.maatwerk_lengte_cm IS NOT NULL
       AND oreg.maatwerk_breedte_cm IS NOT NULL
       AND oreg.orderaantal > 1
       AND o.status NOT IN ('Verzonden'::order_status,
                            'Geannuleerd'::order_status)
     GROUP BY oreg.id, oreg.orderaantal,
              oreg.maatwerk_lengte_cm, oreg.maatwerk_breedte_cm
    HAVING COUNT(s.id) < oreg.orderaantal
  LOOP
    v_te_maken := r.orderaantal - r.aantal_snijplannen;
    FOR i IN 1..v_te_maken LOOP
      INSERT INTO snijplannen (
        snijplan_nr, order_regel_id,
        lengte_cm, breedte_cm,
        status, opmerkingen
      )
      VALUES (
        volgend_nummer('SNIJ'),
        r.regel_id,
        r.maatwerk_lengte_cm::INTEGER,
        r.maatwerk_breedte_cm::INTEGER,
        'Wacht'::snijplan_status,
        'Backfill mig 274 — aanvulling tot orderaantal (' ||
          (r.aantal_snijplannen + i) || '/' || r.orderaantal || ')'
      );
    END LOOP;
    v_totaal := v_totaal + v_te_maken;
  END LOOP;

  RAISE NOTICE 'Mig 274 backfill: % snijplannen aangevuld over alle maatwerk-regels met orderaantal>1.', v_totaal;
END;
$$;
