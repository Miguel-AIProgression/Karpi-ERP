-- Migration 070: converteer status 'Gepland' naar 'Snijden' op snijplannen.
--
-- Context: migratie 051/052 voegde Wacht/Gepland/In productie samen onder
-- 'Snijden'. De RPC `snijplanning_groepen_gefilterd` telt items als
-- 'gepland' wanneer status='Snijden' EN rol_id IS NOT NULL. De RPC
-- `keur_snijvoorstel_goed` (van vóór 051/052) zet echter nog status='Gepland'
-- na goedkeuring van een snijvoorstel, waardoor die items onzichtbaar worden
-- in de UI.
--
-- Fix:
--   1. Eenmalige backfill van bestaande 'Gepland' rijen naar 'Snijden'.
--   2. Trigger-functie uit migratie 069 uitbreiden zodat ze ook 'Gepland'
--      harmoniseert, en ook op UPDATE reageert (keur_snijvoorstel_goed doet
--      een UPDATE op snijplannen).

UPDATE snijplannen SET status = 'Snijden' WHERE status = 'Gepland';

CREATE OR REPLACE FUNCTION snijplan_wacht_naar_snijden()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('Wacht', 'Gepland') THEN
    NEW.status := 'Snijden';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snijplan_wacht_naar_snijden ON snijplannen;

CREATE TRIGGER trg_snijplan_wacht_naar_snijden
BEFORE INSERT OR UPDATE OF status ON snijplannen
FOR EACH ROW
EXECUTE FUNCTION snijplan_wacht_naar_snijden();

COMMENT ON FUNCTION snijplan_wacht_naar_snijden IS
  'Harmoniseert legacy statussen Wacht/Gepland naar Snijden (zie migratie 070).';
