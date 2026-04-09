-- Migration 047: Reststuk override bij voltooi_snijplan_rol
-- Voegt p_override_rest_lengte parameter toe zodat de gebruiker de restlengte kan aanpassen
-- NULL = auto-berekenen (bestaand gedrag), 0 = geen reststuk, >0 = override lengte

CREATE OR REPLACE FUNCTION voltooi_snijplan_rol(
  p_rol_id BIGINT,
  p_gesneden_door TEXT DEFAULT NULL,
  p_override_rest_lengte INTEGER DEFAULT NULL
)
RETURNS TABLE(reststuk_id BIGINT, reststuk_rolnummer TEXT, reststuk_lengte_cm INTEGER) AS $$
DECLARE
  v_rol RECORD;
  v_gebruikte_lengte NUMERIC;
  v_rest_lengte INTEGER;
  v_reststuk_id BIGINT;
  v_reststuk_nr TEXT;
BEGIN
  -- Haal rol op
  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id; END IF;

  -- Markeer alle geplande snijplannen op deze rol als gesneden
  UPDATE snijplannen
  SET status = 'Gesneden',
      gesneden_datum = CURRENT_DATE,
      gesneden_op = NOW(),
      gesneden_door = p_gesneden_door
  WHERE rol_id = p_rol_id
    AND status IN ('Gepland', 'In productie');

  -- Bereken gebruikte lengte
  SELECT COALESCE(MAX(positie_y_cm + CASE WHEN geroteerd THEN lengte_cm ELSE breedte_cm END), 0)
  INTO v_gebruikte_lengte
  FROM snijplannen WHERE rol_id = p_rol_id AND status = 'Gesneden';

  -- Bepaal restlengte: override of auto-berekend
  IF p_override_rest_lengte IS NOT NULL THEN
    v_rest_lengte := GREATEST(0, p_override_rest_lengte);
  ELSE
    v_rest_lengte := GREATEST(0, v_rol.lengte_cm - CEIL(v_gebruikte_lengte));
  END IF;

  -- Update rol status
  UPDATE rollen SET status = 'gesneden' WHERE id = p_rol_id;

  -- Maak reststuk als er genoeg over is (>50cm) en override niet 0
  IF v_rest_lengte > 50 THEN
    v_reststuk_nr := v_rol.rolnummer || '-R';
    INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, kleur_code, lengte_cm, breedte_cm,
                        oppervlak_m2, status, oorsprong_rol_id, reststuk_datum)
    VALUES (v_reststuk_nr, v_rol.artikelnr, v_rol.kwaliteit_code, v_rol.kleur_code,
            v_rest_lengte, v_rol.breedte_cm,
            ROUND(v_rest_lengte * v_rol.breedte_cm / 10000.0, 2),
            'reststuk', p_rol_id, CURRENT_DATE)
    RETURNING id INTO v_reststuk_id;

    RETURN QUERY SELECT v_reststuk_id, v_reststuk_nr, v_rest_lengte;
  ELSE
    RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, NULL::INTEGER;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
