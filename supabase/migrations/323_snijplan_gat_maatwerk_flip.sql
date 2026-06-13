-- Migratie 323: dicht het snijplan-gat bij is_maatwerk-flip / late maat-invul
--
-- AANLEIDING (diagnose 2026-06-07)
-- Klacht: ~100 orders in het systeem maar 0 in de snijplanning. Diagnose wees
-- uit dat dit grotendeels CORRECT is (vrijwel alles is voorraad/vaste-maat),
-- met één echte afwijking: ORD-2026-0098 (bron shopify) had een maatwerk-regel
-- (is_maatwerk=TRUE, 230×160) ZONDER snijplan, terwijl de tabel `snijplannen`
-- volledig leeg was.
--
-- ROOT CAUSE — gat tussen INSERT- en UPDATE-trigger (mig 274):
--   * auto_maak_snijplan (AFTER INSERT) maakt alleen snijplannen als
--     is_maatwerk=TRUE ÉN beide maten al gevuld zijn OP HET INSERT-MOMENT.
--   * auto_sync_snijplan_maten (AFTER UPDATE) had een vroege guard:
--         IF NEW.maatwerk_lengte_cm IS NOT DISTINCT FROM OLD.maatwerk_lengte_cm
--            AND NEW.maatwerk_breedte_cm IS NOT DISTINCT FROM OLD.maatwerk_breedte_cm
--         THEN RETURN NEW;   -- maten niet veranderd → stop
--     Die guard staat VÓÓR de "geen-snijplannen"-fallback. Gevolg: als een regel
--     binnenkomt met is_maatwerk=TRUE maar maten NULL (Shopify dimensie-parsing
--     faalde → geen herkende property), en de maten/flag in losse stappen worden
--     bijgewerkt waarbij de maten in de laatste update niet (meer) wijzigen, dan
--     maakt GEEN van beide triggers ooit een snijplan. De regel valt tussen wal
--     en schip → nooit snijdbaar, nooit pickbaar.
--
-- FIX
--   Herorden auto_sync_snijplan_maten: de "geen-snijplannen"-fallback komt nu
--   VÓÓR de maat-veranderd-guard. Daarmee wordt elke UPDATE op een maatwerk-
--   regel die maten heeft maar (nog) geen snijplannen, self-healing: hij maakt
--   de ontbrekende snijplannen alsnog aan (N = orderaantal). Bestaan er al
--   snijplannen, dan valt hij terug op de ongewijzigde sync-bij-maatverandering
--   logica. Idempotent t.o.v. al-aanwezige snijplannen.
--
--   Plus een backfill voor de bestaande achterstand (incl. ORD-2026-0098).
--
-- Idempotent: CREATE OR REPLACE FUNCTION + backfill met "skip als al snijplannen".

-- ---------------------------------------------------------------------------
-- 1. auto_sync_snijplan_maten: fallback vóór de maat-veranderd-guard
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

  v_aantal_target := GREATEST(COALESCE(NEW.orderaantal, 1), 1);

  SELECT COUNT(*) INTO v_aantal_bestaand
    FROM snijplannen WHERE order_regel_id = NEW.id;

  -- Self-healing fallback (mig 323): nog GEEN snijplannen en beide maten gevuld
  -- → maak ze alsnog aan, ongeacht of de maten in déze update zijn veranderd.
  -- Dit dicht het gat waarbij is_maatwerk pas ná de insert TRUE werd, of de
  -- maten pas later (in losse stappen) zijn ingevuld. Staat bewust VÓÓR de
  -- maat-veranderd-guard zodat ook een flip-zonder-maatverandering hier landt.
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

  -- Er bestaan al snijplannen: alleen iets doen als de maten daadwerkelijk
  -- wijzigen (sync naar bestaande rijen).
  IF NEW.maatwerk_lengte_cm IS NOT DISTINCT FROM OLD.maatwerk_lengte_cm
     AND NEW.maatwerk_breedte_cm IS NOT DISTINCT FROM OLD.maatwerk_breedte_cm
  THEN
    RETURN NEW;
  END IF;

  -- Maten naar NULL gezet: niets te syncen (regel verliest maatwerk-maten;
  -- bestaande snijplannen blijven staan tot ze handmatig worden opgeruimd).
  IF NEW.maatwerk_lengte_cm IS NULL OR NEW.maatwerk_breedte_cm IS NULL THEN
    RETURN NEW;
  END IF;

  -- Sync: update álle snijplannen die nog veilig zijn (geen rol, status in
  -- Wacht/Gepland/Snijden). Snijplannen met rol_id of voorbij Snijden krijgen
  -- een WARNING; daar is een handmatige release-en-hersnijden-flow voor nodig.
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
  'AFTER UPDATE op order_regels: synct maatwerk-maten naar álle snijplannen van '
  'de regel (ADR-0019). Mig 323: self-healing fallback (geen snijplannen + maten '
  'gevuld → alsnog aanmaken) staat nu VÓÓR de maat-veranderd-guard, zodat een '
  'is_maatwerk-flip of late maat-invul ná de insert niet meer tussen wal en schip '
  'valt. Snijplannen met rol of voorbij Snijden worden geskipt + WARNING gelogd.';

-- ---------------------------------------------------------------------------
-- 2. Backfill: vul ontbrekende snijplannen aan voor alle maatwerk-regels met
--    maten in non-eindstatus orders (incl. ORD-2026-0098).
-- ---------------------------------------------------------------------------
-- Per regel loopen zodat volgend_nummer('SNIJ') per rij wordt geëvalueerd
-- (anders krijgen alle nieuwe rijen hetzelfde nummer → unique-constraint).

DO $$
DECLARE
  r          RECORD;
  v_te_maken INTEGER;
  i          INTEGER;
  v_totaal   INTEGER := 0;
BEGIN
  FOR r IN
    SELECT oreg.id            AS regel_id,
           GREATEST(COALESCE(oreg.orderaantal, 1), 1) AS orderaantal,
           oreg.maatwerk_lengte_cm,
           oreg.maatwerk_breedte_cm,
           COUNT(s.id)::INTEGER AS aantal_snijplannen
      FROM order_regels oreg
      JOIN orders o ON o.id = oreg.order_id
      LEFT JOIN snijplannen s ON s.order_regel_id = oreg.id
     WHERE oreg.is_maatwerk = TRUE
       AND oreg.maatwerk_lengte_cm IS NOT NULL
       AND oreg.maatwerk_breedte_cm IS NOT NULL
       AND o.status NOT IN ('Verzonden'::order_status,
                            'Geannuleerd'::order_status)
     GROUP BY oreg.id, oreg.orderaantal,
              oreg.maatwerk_lengte_cm, oreg.maatwerk_breedte_cm
    HAVING COUNT(s.id) < GREATEST(COALESCE(oreg.orderaantal, 1), 1)
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
        'Backfill mig 323 — snijplan-gat (is_maatwerk-flip/late maat-invul) (' ||
          (r.aantal_snijplannen + i) || '/' || r.orderaantal || ')'
      );
    END LOOP;
    v_totaal := v_totaal + v_te_maken;
  END LOOP;

  RAISE NOTICE 'Mig 323 backfill: % snijplannen aangevuld over maatwerk-regels zonder (volledig) snijplan.', v_totaal;
END;
$$;

NOTIFY pgrst, 'reload schema';
