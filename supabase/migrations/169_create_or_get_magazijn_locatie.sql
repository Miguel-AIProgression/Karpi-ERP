-- Migration 169: RPC create_or_get_magazijn_locatie
--
-- Idempotente helper voor on-the-fly aanmaken van magazijn-locatie-rijen.
-- Gebruik: bij Pick & Ship LocatieEdit kan een gebruiker een nieuwe code intypen;
-- de RPC vindt of maakt 'm aan en geeft de id terug. Code wordt UPPER + TRIM.
-- In MVI-V2 ook gebruikt door boek_ontvangst om binnenkomende rollen te koppelen.

CREATE OR REPLACE FUNCTION create_or_get_magazijn_locatie(
  p_code TEXT,
  p_omschrijving TEXT DEFAULT NULL,
  p_type TEXT DEFAULT 'rek'
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_code TEXT;
  v_id BIGINT;
BEGIN
  v_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF v_code = '' THEN
    RAISE EXCEPTION 'Magazijnlocatie-code mag niet leeg zijn';
  END IF;

  SELECT id INTO v_id FROM magazijn_locaties WHERE code = v_code;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO magazijn_locaties (code, omschrijving, type, actief)
  VALUES (v_code, p_omschrijving, p_type, true)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION create_or_get_magazijn_locatie IS
  'Idempotent: vindt magazijn_locaties.id voor `code` (UPPER+TRIM) of maakt rij aan. '
  'Migratie 169.';
