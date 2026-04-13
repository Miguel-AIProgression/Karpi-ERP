-- Migration 052: Migreer data naar 'Snijden' status + update DB-functies
-- Vereist dat 051 al is uitgevoerd (enum waarde moet bestaan).

-- 1. Migreer alle bestaande orders naar 'Snijden'
UPDATE snijplannen
SET status = 'Snijden'
WHERE status IN ('Wacht', 'Gepland', 'In productie');

-- 2. Update voltooi_snijplan_rol: gebruik nieuwe status
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
  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id; END IF;

  -- Markeer alle snijplannen op deze rol als Gesneden
  UPDATE snijplannen
  SET status = 'Gesneden',
      gesneden_datum = CURRENT_DATE,
      gesneden_op = NOW(),
      gesneden_door = p_gesneden_door
  WHERE rol_id = p_rol_id
    AND status = 'Snijden';

  SELECT COALESCE(MAX(positie_y_cm + CASE WHEN geroteerd THEN lengte_cm ELSE breedte_cm END), 0)
  INTO v_gebruikte_lengte
  FROM snijplannen WHERE rol_id = p_rol_id AND status = 'Gesneden';

  IF p_override_rest_lengte IS NOT NULL THEN
    v_rest_lengte := GREATEST(0, p_override_rest_lengte);
  ELSE
    v_rest_lengte := GREATEST(0, v_rol.lengte_cm - CEIL(v_gebruikte_lengte));
  END IF;

  UPDATE rollen SET status = 'gesneden' WHERE id = p_rol_id;

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

-- 3. Update snijplanning_groepen_gefilterd RPC
--    totaal_wacht/totaal_gepland/totaal_in_productie → totaal_snijden + totaal_snijden_gepland
CREATE OR REPLACE FUNCTION snijplanning_groepen_gefilterd(p_tot_datum DATE DEFAULT NULL)
RETURNS TABLE (
  kwaliteit_code TEXT,
  kleur_code TEXT,
  totaal_stukken INTEGER,
  totaal_orders INTEGER,
  totaal_m2 FLOAT,
  totaal_gesneden INTEGER,
  vroegste_afleverdatum DATE,
  totaal_snijden INTEGER,
  totaal_snijden_gepland INTEGER,
  totaal_status_gesneden INTEGER,
  totaal_in_confectie INTEGER,
  totaal_gereed INTEGER
) LANGUAGE sql STABLE AS $$
  SELECT
    so.kwaliteit_code,
    so.kleur_code,
    COUNT(*)::INTEGER AS totaal_stukken,
    COUNT(DISTINCT so.order_id)::INTEGER AS totaal_orders,
    ROUND(SUM(so.snij_lengte_cm::NUMERIC * so.snij_breedte_cm::NUMERIC / 10000), 1)::FLOAT AS totaal_m2,
    COUNT(*) FILTER (WHERE so.status IN ('Gesneden', 'In confectie', 'Ingepakt', 'Gereed'))::INTEGER AS totaal_gesneden,
    MIN(so.afleverdatum) FILTER (WHERE so.status = 'Snijden') AS vroegste_afleverdatum,
    COUNT(*) FILTER (WHERE so.status = 'Snijden')::INTEGER AS totaal_snijden,
    COUNT(*) FILTER (WHERE so.status = 'Snijden' AND so.rol_id IS NOT NULL)::INTEGER AS totaal_snijden_gepland,
    COUNT(*) FILTER (WHERE so.status = 'Gesneden')::INTEGER AS totaal_status_gesneden,
    COUNT(*) FILTER (WHERE so.status = 'In confectie')::INTEGER AS totaal_in_confectie,
    COUNT(*) FILTER (WHERE so.status IN ('Gereed', 'Ingepakt'))::INTEGER AS totaal_gereed
  FROM snijplanning_overzicht so
  WHERE so.kwaliteit_code IS NOT NULL
    AND (p_tot_datum IS NULL OR so.afleverdatum IS NULL OR so.afleverdatum <= p_tot_datum)
  GROUP BY so.kwaliteit_code, so.kleur_code
  ORDER BY so.kwaliteit_code, so.kleur_code;
$$;

-- 4. Status counts RPC blijft ongewijzigd (groepeert automatisch op status waarde)
