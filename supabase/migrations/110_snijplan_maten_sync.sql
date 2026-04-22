-- Migration 110: snijplan-maten synchroniseren met order_regel-maten
--
-- CONTEXT
-- `auto_maak_snijplan()` (AFTER INSERT op order_regels) gebruikte tot nu toe
-- `COALESCE(NEW.maatwerk_lengte_cm, 100)::INTEGER` als default. Voor webshop-
-- orders waar parseMaatwerkDims() de afmetingen niet uit de producttitel kon
-- halen, werd het snijplan daardoor 100×100 aangemaakt. De afmetingen werden
-- later handmatig op order_regel ingevuld, maar er was geen UPDATE-trigger
-- die het gekoppelde snijplan meebewerkte — de planning bleef werken met 100×100.
-- Gevolg: verkeerde rol-toewijzingen (stuk past niet op toegewezen rol).
--
-- FIXES
--   1. auto_maak_snijplan(): verwijder hardcoded 100-default. Maak alleen
--      een snijplan aan als maten ingevuld zijn. (snijplannen.lengte_cm en
--      breedte_cm zijn NOT NULL, dus NULL-snijplannen bestaan niet.)
--
--   2. auto_sync_snijplan_maten() (NIEUW): AFTER UPDATE trigger op
--      order_regels. Synchroniseert snijplan-maten wanneer maatwerk_lengte_cm
--      of maatwerk_breedte_cm wijzigt. Maakt alsnog een snijplan aan als dat
--      bij insert werd overgeslagen (maten waren NULL).
--
--      Veiligheidsslot: als snijplan al een rol heeft (rol_id IS NOT NULL) of
--      verder is in productie (status niet in Wacht/Gepland/Snijden) wordt
--      het NIET bijgewerkt — een RAISE WARNING wijst op handmatige actie
--      (release + hersnijden via auto-plan).

CREATE OR REPLACE FUNCTION auto_maak_snijplan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_maatwerk IS TRUE
     AND NEW.maatwerk_lengte_cm  IS NOT NULL
     AND NEW.maatwerk_breedte_cm IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM snijplannen WHERE order_regel_id = NEW.id)
  THEN
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
      'Auto-aangemaakt'
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_maak_snijplan() IS
  'AFTER INSERT op order_regels: maakt snijplan met werkelijke maten. Geen 100-default meer — als maten NULL zijn wordt snijplan overgeslagen en later via auto_sync_snijplan_maten alsnog aangemaakt zodra de maten bekend worden.';


CREATE OR REPLACE FUNCTION auto_sync_snijplan_maten()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_snijplan_id     BIGINT;
  v_snijplan_rol    BIGINT;
  v_snijplan_status snijplan_status;
BEGIN
  IF NEW.is_maatwerk IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.maatwerk_lengte_cm  IS NOT DISTINCT FROM OLD.maatwerk_lengte_cm
     AND NEW.maatwerk_breedte_cm IS NOT DISTINCT FROM OLD.maatwerk_breedte_cm
  THEN
    RETURN NEW;
  END IF;

  SELECT id, rol_id, status
    INTO v_snijplan_id, v_snijplan_rol, v_snijplan_status
    FROM snijplannen
   WHERE order_regel_id = NEW.id
   LIMIT 1;

  IF NOT FOUND THEN
    IF NEW.maatwerk_lengte_cm IS NOT NULL AND NEW.maatwerk_breedte_cm IS NOT NULL THEN
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
        'Auto-aangemaakt (na update)'
      );
    END IF;
    RETURN NEW;
  END IF;

  IF v_snijplan_rol IS NOT NULL
     OR v_snijplan_status NOT IN (
       'Wacht'::snijplan_status,
       'Gepland'::snijplan_status,
       'Snijden'::snijplan_status
     )
  THEN
    RAISE WARNING
      'Snijplan % voor order_regel % NIET bijgewerkt (% → %×%): rol=% status=%. Release + hersnijden nodig.',
      v_snijplan_id, NEW.id,
      OLD.maatwerk_lengte_cm || 'x' || OLD.maatwerk_breedte_cm,
      NEW.maatwerk_lengte_cm, NEW.maatwerk_breedte_cm,
      v_snijplan_rol, v_snijplan_status;
    RETURN NEW;
  END IF;

  IF NEW.maatwerk_lengte_cm IS NULL OR NEW.maatwerk_breedte_cm IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE snijplannen
     SET lengte_cm  = NEW.maatwerk_lengte_cm::INTEGER,
         breedte_cm = NEW.maatwerk_breedte_cm::INTEGER
   WHERE id = v_snijplan_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_sync_snijplan_maten() IS
  'AFTER UPDATE op order_regels: synchroniseert snijplan.lengte_cm/breedte_cm met gewijzigde maatwerk-maten. Maakt snijplan alsnog aan als het bij INSERT ontbrak. Skipt update als rol toegewezen of status voorbij Snijden — WARNING naar logs voor handmatige actie.';

DROP TRIGGER IF EXISTS trg_auto_sync_snijplan_maten ON order_regels;
CREATE TRIGGER trg_auto_sync_snijplan_maten
AFTER UPDATE OF maatwerk_lengte_cm, maatwerk_breedte_cm, is_maatwerk ON order_regels
FOR EACH ROW
EXECUTE FUNCTION auto_sync_snijplan_maten();
