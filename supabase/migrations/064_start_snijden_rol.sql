-- Migration 064: start_snijden_rol() — registreer begin van snijden op een rol
--
-- Achtergrond: de frontend roept deze functie aan zodra een medewerker
-- "Start met rol" klikt op de snijplanning. We loggen het starttijdstip en
-- de medewerker zodat voltooi_snijplan_rol later de totale snijduur kan
-- afleiden (voltooid_op - gestart_op).
--
-- Backwards compatible: idempotent — als snijden_gestart_op al gevuld is,
-- laten we de bestaande waarden ongewijzigd (geen overschrijven bij herklik).

CREATE OR REPLACE FUNCTION start_snijden_rol(
  p_rol_id BIGINT,
  p_gebruiker TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT TRUE INTO v_exists FROM rollen WHERE id = p_rol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id; END IF;

  UPDATE rollen
  SET snijden_gestart_op = NOW(),
      snijden_gestart_door = p_gebruiker
  WHERE id = p_rol_id
    AND snijden_gestart_op IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
