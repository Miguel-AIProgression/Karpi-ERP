-- Migratie 292: rol_handmatig_bewerken — afmetingen/locatie/status corrigeren
--
-- Weigert wijziging op rollen die aan een snijplan/claim hangen
-- (status gereserveerd/in_snijplan/verkocht/gesneden) en weigert status-doel
-- gereserveerd/in_snijplan. Geen producten.voorraad-mutatie. Audit in rol_mutaties.

CREATE OR REPLACE FUNCTION rol_handmatig_bewerken(
  p_rol_id     BIGINT,
  p_lengte_cm  INTEGER,
  p_breedte_cm INTEGER,
  p_locatie_id BIGINT,
  p_status     TEXT,
  p_reden      TEXT,
  p_medewerker TEXT DEFAULT NULL
) RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol     rollen%ROWTYPE;
  v_opp_na  NUMERIC;
  v_delta   NUMERIC;
BEGIN
  IF p_reden IS NULL OR TRIM(p_reden) = '' THEN
    RAISE EXCEPTION 'Reden is verplicht bij een handmatige rol-correctie.';
  END IF;
  IF p_lengte_cm IS NULL OR p_lengte_cm <= 0
     OR p_breedte_cm IS NULL OR p_breedte_cm <= 0 THEN
    RAISE EXCEPTION 'Ongeldige afmetingen: % x %', p_lengte_cm, p_breedte_cm;
  END IF;
  IF p_status IN ('gereserveerd','in_snijplan') THEN
    RAISE EXCEPTION 'Status % mag niet handmatig gezet worden (claim-integriteit).',
      p_status;
  END IF;

  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rol % niet gevonden.', p_rol_id;
  END IF;

  IF v_rol.status IN ('gereserveerd','in_snijplan','verkocht','gesneden') THEN
    RAISE EXCEPTION
      'Rol % kan niet bewerkt worden: status is % (hangt aan snijplan/claim).',
      v_rol.rolnummer, v_rol.status;
  END IF;

  IF p_locatie_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM magazijn_locaties WHERE id = p_locatie_id) THEN
    RAISE EXCEPTION 'Onbekende locatie-id: %', p_locatie_id;
  END IF;

  v_opp_na := ROUND((p_lengte_cm * p_breedte_cm) / 10000.0, 2);
  v_delta  := v_opp_na - COALESCE(v_rol.oppervlak_m2, 0);

  UPDATE rollen
  SET lengte_cm   = p_lengte_cm,
      breedte_cm  = p_breedte_cm,
      oppervlak_m2 = v_opp_na,
      locatie_id  = p_locatie_id,
      status      = p_status
  WHERE id = p_rol_id;

  INSERT INTO rol_mutaties (
    rol_id, rolnummer, artikelnr, actie, oppervlak_delta_m2,
    oud_json, nieuw_json, reden, medewerker
  ) VALUES (
    p_rol_id, v_rol.rolnummer, v_rol.artikelnr, 'bewerken', v_delta,
    jsonb_build_object('lengte_cm', v_rol.lengte_cm, 'breedte_cm', v_rol.breedte_cm,
      'oppervlak_m2', v_rol.oppervlak_m2, 'status', v_rol.status,
      'locatie_id', v_rol.locatie_id),
    jsonb_build_object('lengte_cm', p_lengte_cm, 'breedte_cm', p_breedte_cm,
      'oppervlak_m2', v_opp_na, 'status', p_status, 'locatie_id', p_locatie_id),
    TRIM(p_reden), p_medewerker
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rol_handmatig_bewerken(BIGINT,INTEGER,INTEGER,BIGINT,TEXT,TEXT,TEXT) IS
  'Handmatige rol-correctie: afmetingen/locatie/status. Weigert mutatie op '
  'rollen die aan snijplan/claim hangen. Geen producten.voorraad-mutatie. '
  'Audit in rol_mutaties. Mig 292.';

GRANT EXECUTE ON FUNCTION rol_handmatig_bewerken(BIGINT,INTEGER,INTEGER,BIGINT,TEXT,TEXT,TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 292 toegepast: rol_handmatig_bewerken aangemaakt.';
END $$;
