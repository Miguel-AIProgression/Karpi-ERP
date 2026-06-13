-- Migratie 328: kopieer snijden_uit_standaardmaat-vlag naar snijplannen bij auto-aanmaken
--
-- CONTEXT
-- Mig 327 voegde kolom snijden_uit_standaardmaat BOOLEAN NOT NULL DEFAULT false toe
-- aan zowel order_regels als snijplannen. Deze migratie zorgt dat de twee trigger-
-- functies die automatisch snijplannen aanmaken, die vlag nu meenemen van de
-- order_regel naar het snijplan.
--
-- BESTANDEN AANGEPAST
--   1. auto_maak_snijplan()       — AFTER INSERT op order_regels (basis: mig 274)
--   2. auto_sync_snijplan_maten() — AFTER UPDATE op order_regels (basis: mig 323)
--
-- COÖRDINATIE-NOOT (mig 323 vs mig 328)
-- Mig 323 heeft auto_sync_snijplan_maten herschreven met een self-healing fallback
-- (geen snijplannen + maten gevuld → alsnog aanmaken), maar bevat nog niet de
-- standaardmaat-vlag (die bestond toen nog niet — die is uit mig 327).
-- Mig 328 draait ná 323 en vervangt de functie-definitie van auto_sync_snijplan_maten
-- naar de eindstaat: mét self-healing fallback (mig 323) én mét standaardmaat-vlag.
-- BASIS voor auto_sync_snijplan_maten: body uit mig 323 + standaardmaat-vlag in de
-- self-healing fallback-INSERT. De rest (maat-sync-UPDATE, guards, WARNING) ongewijzigd.
-- De backfill-DO-block uit mig 323 wordt hier NIET herhaald — die is data-fix van
-- die migratie en hoeft slechts één keer te draaien.
--
-- STRIKT ADDITIEF
-- Voor gewone regels (snijden_uit_standaardmaat = false) is het gedrag byte-voor-byte
-- identiek aan de vorige versie — de vlag is DEFAULT false, dus nieuwe regels zonder
-- expliciete waarde schrijven false naar het snijplan, precies zoals voorheen.
-- Idempotent: CREATE OR REPLACE FUNCTION.

-- ---------------------------------------------------------------------------
-- 1. auto_maak_snijplan: AFTER INSERT op order_regels (basis: mig 274 + vlag)
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

  IF EXISTS (SELECT 1 FROM snijplannen WHERE order_regel_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_aantal := GREATEST(COALESCE(NEW.orderaantal, 1), 1);

  FOR i IN 1..v_aantal LOOP
    INSERT INTO snijplannen (
      snijplan_nr, order_regel_id,
      lengte_cm, breedte_cm,
      status, opmerkingen,
      snijden_uit_standaardmaat
    )
    VALUES (
      volgend_nummer('SNIJ'),
      NEW.id,
      NEW.maatwerk_lengte_cm::INTEGER,
      NEW.maatwerk_breedte_cm::INTEGER,
      'Wacht'::snijplan_status,
      CASE WHEN v_aantal > 1
           THEN 'Auto-aangemaakt (' || i || '/' || v_aantal || ')'
           ELSE 'Auto-aangemaakt'
      END,
      COALESCE(NEW.snijden_uit_standaardmaat, false)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_maak_snijplan() IS
  'AFTER INSERT op order_regels: maakt per maatwerk-stuk een snijplan-rij aan '
  '(ADR-0019, mig 274). Mig 328: kopieert nu ook snijden_uit_standaardmaat van '
  'de order_regel naar elk snijplan (COALESCE naar false voor gewone regels).';

-- ---------------------------------------------------------------------------
-- 2. auto_sync_snijplan_maten: AFTER UPDATE op order_regels
--    BASIS: body uit mig 323 (self-healing fallback) + standaardmaat-vlag
--    in de fallback-INSERT. De rest (maat-sync-UPDATE, guards, WARNING) ongewijzigd.
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
  -- Mig 328: kopieert tevens snijden_uit_standaardmaat naar elk nieuw snijplan.
  IF v_aantal_bestaand = 0 THEN
    IF NEW.maatwerk_lengte_cm IS NOT NULL AND NEW.maatwerk_breedte_cm IS NOT NULL THEN
      FOR i IN 1..v_aantal_target LOOP
        INSERT INTO snijplannen (
          snijplan_nr, order_regel_id,
          lengte_cm, breedte_cm,
          status, opmerkingen,
          snijden_uit_standaardmaat
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
          END,
          COALESCE(NEW.snijden_uit_standaardmaat, false)
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
  'gevuld → alsnog aanmaken) staat VÓÓR de maat-veranderd-guard, zodat een '
  'is_maatwerk-flip of late maat-invul ná de insert niet meer tussen wal en schip '
  'valt. Mig 328: fallback-INSERT kopieert nu ook snijden_uit_standaardmaat '
  '(COALESCE naar false). Snijplannen met rol of voorbij Snijden worden geskipt '
  '+ WARNING gelogd bij maat-sync.';

NOTIFY pgrst, 'reload schema';
