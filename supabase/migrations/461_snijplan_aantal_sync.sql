-- Migratie 461: snijplan-aantal volgt orderaantal-wijzigingen
--
-- CONTEXT
-- auto_maak_snijplan() (mig 274) zet bij het INSERTen van een maatwerk-
-- orderregel correct N snijplan-rijen neer (N = orderaantal). Maar
-- auto_sync_snijplan_maten() (AFTER UPDATE, mig 323/328) reageerde alleen op
-- wijzigingen in maatwerk_lengte_cm/maatwerk_breedte_cm — een latere
-- aanpassing van orderaantal zelf (bv. 1 → 8 stuks op een bestaande regel)
-- werd nergens gesynct. Dit was al gedocumenteerd als "BEKENDE BEPERKING" in
-- mig 274, maar nooit gedicht.
--
-- Gevonden via ORD-2026-0660 / order_regel 6286: aangemaakt met orderaantal=1
-- (1 snijplan, opmerking "Auto-aangemaakt" zonder "(1/N)" — bevestigt dat
-- v_aantal=1 was op insert-moment), later verhoogd naar orderaantal=8 zonder
-- dat de overige 7 snijplannen ooit zijn aangemaakt. Het orderregel-label
-- "Gepland" was zo misleidend: maar 1 van de 8 stuks bestond fysiek in de
-- snijplanning.
--
-- WIJZIGING
-- auto_sync_snijplan_maten() krijgt een derde tak (naast de bestaande
-- self-healing-fallback en de maten-sync): bij orderaantal-wijziging op een
-- regel die al snijplannen heeft —
--   • verhoging: vul aan met nieuwe 'Wacht'-rijen tot het nieuwe aantal
--     (zelfde patroon als de bestaande aanmaak-paden).
--   • verlaging: annuleer (status → 'Geannuleerd') de minst-vergevorderde
--     overtollige rijen (rol_id IS NULL AND status = 'Wacht') tot het nieuwe
--     aantal. Onvoldoende veilig te annuleren rijen → WARNING, geen harde
--     fout (zelfde filosofie als de bestaande maten-sync-blokkade-melding).
--
-- BACKFILL
-- order_regel 6286 (ORD-2026-0660) krijgt de 7 ontbrekende snijplannen direct
-- aangemaakt — gericht, niet de hele tabel (er is nog minstens 1 andere regel
-- met hetzelfde patroon en een paar regels met 0 snijplannen door een andere
-- oorzaak; die worden bewust niet in deze migratie meegenomen).

CREATE OR REPLACE FUNCTION auto_sync_snijplan_maten()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_aantal_bestaand INTEGER;
  v_aantal_target   INTEGER;
  v_geblokkeerd     INTEGER;
  v_geannuleerd     INTEGER;
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

  -- NIEUW (mig 461): orderaantal gewijzigd op een regel die al snijplannen
  -- heeft — vóór de maten-guard, want een aantal-wijziging zonder maat-
  -- wijziging mag niet als "niets te doen" wegvallen.
  IF NEW.orderaantal IS DISTINCT FROM OLD.orderaantal THEN
    IF v_aantal_target > v_aantal_bestaand
       AND NEW.maatwerk_lengte_cm IS NOT NULL AND NEW.maatwerk_breedte_cm IS NOT NULL
    THEN
      FOR i IN (v_aantal_bestaand + 1)..v_aantal_target LOOP
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
          'Auto-aangemaakt na aantal-wijziging (' || i || '/' || v_aantal_target || ')',
          COALESCE(NEW.snijden_uit_standaardmaat, false)
        );
      END LOOP;
    ELSIF v_aantal_target < v_aantal_bestaand THEN
      WITH te_annuleren AS (
        SELECT id FROM snijplannen
         WHERE order_regel_id = NEW.id
           AND rol_id IS NULL
           AND status = 'Wacht'::snijplan_status
         ORDER BY id DESC
         LIMIT (v_aantal_bestaand - v_aantal_target)
      )
      UPDATE snijplannen SET status = 'Geannuleerd'::snijplan_status
       WHERE id IN (SELECT id FROM te_annuleren);
      GET DIAGNOSTICS v_geannuleerd = ROW_COUNT;

      IF v_geannuleerd < (v_aantal_bestaand - v_aantal_target) THEN
        RAISE WARNING
          'Order_regel % aantal verlaagd maar % snijplan(nen) konden niet automatisch '
          'geannuleerd worden (al gepland/gesneden). Handmatig opruimen nodig.',
          NEW.id, (v_aantal_bestaand - v_aantal_target - v_geannuleerd);
      END IF;
    END IF;
  END IF;

  -- Bestaand pad: alleen iets doen als de maten daadwerkelijk wijzigen.
  IF NEW.maatwerk_lengte_cm IS NOT DISTINCT FROM OLD.maatwerk_lengte_cm
     AND NEW.maatwerk_breedte_cm IS NOT DISTINCT FROM OLD.maatwerk_breedte_cm
  THEN
    RETURN NEW;
  END IF;

  -- Maten naar NULL gezet: niets te syncen.
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
  'AFTER UPDATE op order_regels: synct maatwerk-maten + orderaantal naar de '
  'snijplannen van de regel (ADR-0019, mig 274/323/328). Mig 461: een '
  'orderaantal-wijziging op een regel met bestaande snijplannen vult nu aan '
  '(verhoging) of annuleert overtollige niet-gestarte rijen (verlaging) — '
  'dit was tot nu toe de "bekende beperking" uit mig 274.';

-- ---------------------------------------------------------------------------
-- Backfill: alleen order_regel 6286 (ORD-2026-0660) — gericht, niet de hele tabel.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
  i INTEGER;
BEGIN
  SELECT orl.id, orl.orderaantal, orl.maatwerk_lengte_cm, orl.maatwerk_breedte_cm,
         orl.snijden_uit_standaardmaat, COUNT(sp.id)::INTEGER AS aantal_bestaand
    INTO r
    FROM order_regels orl
    LEFT JOIN snijplannen sp ON sp.order_regel_id = orl.id
   WHERE orl.id = 6286
   GROUP BY orl.id, orl.orderaantal, orl.maatwerk_lengte_cm, orl.maatwerk_breedte_cm,
            orl.snijden_uit_standaardmaat;

  IF r.aantal_bestaand < r.orderaantal THEN
    FOR i IN (r.aantal_bestaand + 1)..r.orderaantal LOOP
      INSERT INTO snijplannen (
        snijplan_nr, order_regel_id,
        lengte_cm, breedte_cm,
        status, opmerkingen,
        snijden_uit_standaardmaat
      )
      VALUES (
        volgend_nummer('SNIJ'),
        r.id,
        r.maatwerk_lengte_cm::INTEGER,
        r.maatwerk_breedte_cm::INTEGER,
        'Wacht'::snijplan_status,
        'Backfill mig 461 — aanvulling tot orderaantal (' || i || '/' || r.orderaantal || ')',
        COALESCE(r.snijden_uit_standaardmaat, false)
      );
    END LOOP;
    RAISE NOTICE 'Mig 461 backfill: % snijplannen aangevuld voor order_regel 6286 (ORD-2026-0660).', (r.orderaantal - r.aantal_bestaand);
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
