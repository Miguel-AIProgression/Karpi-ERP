-- Migratie 293: rol_verwijderen — handmatige rol-verwijdering met guard
--
-- Toegestaan: status='beschikbaar', of los reststuk (rol_type='reststuk' en
-- status NOT IN gereserveerd/in_snijplan/verkocht/gesneden). Geweigerd als de
-- rol aan een snijplan hangt. Auditregel WORDT EERST geschreven (rol_id blijft
-- als getal bewaard, geen FK) zodat de audit de verwijdering overleeft.

CREATE OR REPLACE FUNCTION rol_verwijderen(
  p_rol_id     BIGINT,
  p_reden      TEXT,
  p_medewerker TEXT DEFAULT NULL
) RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol rollen%ROWTYPE;
BEGIN
  IF p_reden IS NULL OR TRIM(p_reden) = '' THEN
    RAISE EXCEPTION 'Reden is verplicht bij een handmatige rol-correctie.';
  END IF;

  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rol % niet gevonden.', p_rol_id;
  END IF;

  IF NOT (
        v_rol.status = 'beschikbaar'
     OR (v_rol.rol_type = 'reststuk'
         AND v_rol.status NOT IN
             ('gereserveerd','in_snijplan','verkocht','gesneden'))
  ) THEN
    RAISE EXCEPTION
      'Rol % kan niet verwijderd worden: status is %.',
      v_rol.rolnummer, v_rol.status;
  END IF;

  IF EXISTS (SELECT 1 FROM snijplannen WHERE rol_id = p_rol_id) THEN
    RAISE EXCEPTION
      'Rol % kan niet verwijderd worden: zit in een snijplan.',
      v_rol.rolnummer;
  END IF;

  INSERT INTO rol_mutaties (
    rol_id, rolnummer, artikelnr, actie, oppervlak_delta_m2,
    oud_json, nieuw_json, reden, medewerker
  ) VALUES (
    p_rol_id, v_rol.rolnummer, v_rol.artikelnr, 'verwijderen',
    -COALESCE(v_rol.oppervlak_m2, 0),
    jsonb_build_object('lengte_cm', v_rol.lengte_cm, 'breedte_cm', v_rol.breedte_cm,
      'oppervlak_m2', v_rol.oppervlak_m2, 'status', v_rol.status,
      'rol_type', v_rol.rol_type, 'locatie_id', v_rol.locatie_id,
      'in_magazijn_sinds', v_rol.in_magazijn_sinds),
    NULL, TRIM(p_reden), p_medewerker
  );

  BEGIN
    DELETE FROM rollen WHERE id = p_rol_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION
      'Rol % kan niet hard verwijderd worden: er zijn historische '
      'voorraad-mutaties of koppelingen aan deze rol.', v_rol.rolnummer;
  END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rol_verwijderen(BIGINT,TEXT,TEXT) IS
  'Handmatige rol-verwijdering met guard (alleen beschikbaar of los reststuk, '
  'niet in snijplan). Auditregel vooraf in rol_mutaties (overleeft DELETE). '
  'Geen producten.voorraad-mutatie. Mig 293.';

GRANT EXECUTE ON FUNCTION rol_verwijderen(BIGINT,TEXT,TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 293 toegepast: rol_verwijderen aangemaakt.';
END $$;
