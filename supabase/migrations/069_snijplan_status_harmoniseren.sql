-- Migration 069: harmoniseer snijplan-status op 'Snijden'.
--
-- Historische situatie: trigger `auto_maak_snijplan` (van voor migratie 051/052)
-- zet nieuwe snijplannen op status='Wacht'. De RPC `snijplanning_groepen_gefilterd`
-- en de frontend-UI filteren echter op status='Snijden'. Gevolg: auto-aangemaakte
-- snijplannen waren onzichtbaar in de UI.
--
-- Fix: AFTER INSERT trigger die 'Wacht' → 'Snijden' converteert op snijplannen.
-- Daardoor blijft de bestaande trigger onveranderd, maar landt de rij op de
-- status die de rest van het systeem verwacht.

CREATE OR REPLACE FUNCTION snijplan_wacht_naar_snijden()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Wacht' THEN
    NEW.status := 'Snijden';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snijplan_wacht_naar_snijden ON snijplannen;

CREATE TRIGGER trg_snijplan_wacht_naar_snijden
BEFORE INSERT ON snijplannen
FOR EACH ROW
EXECUTE FUNCTION snijplan_wacht_naar_snijden();

COMMENT ON FUNCTION snijplan_wacht_naar_snijden IS
  'Harmoniseert legacy status Wacht naar Snijden bij insert (zie migratie 069).';
