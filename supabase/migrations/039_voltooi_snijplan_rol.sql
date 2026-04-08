-- Migration 039: Reststuk classificatie + voltooi_snijplan_rol functie
--
-- 1. Fix bestaande rollen: alles kleiner dan standaard volle maat → reststuk
-- 2. Functie voltooi_snijplan_rol: na het fysiek snijden van een rol

-- ============================================================================
-- 1. Classificeer bestaande rollen als reststuk waar nodig
-- ============================================================================
-- Volle rollen bij Karpi zijn 1500x400 of 3000x400 (of groter).
-- Alles kleiner dan 1500cm lengte bij breedte 400 is een reststuk.
-- Rollen met lengte=0 of onbekende afmetingen worden overgeslagen.

UPDATE rollen
SET status = 'reststuk'
WHERE status = 'beschikbaar'
  AND breedte_cm = 400
  AND lengte_cm > 0
  AND lengte_cm < 1500;

-- Smallere rollen (breedte < 400) met lengte < 1500 ook markeren
UPDATE rollen
SET status = 'reststuk'
WHERE status = 'beschikbaar'
  AND breedte_cm < 400
  AND breedte_cm > 0
  AND lengte_cm > 0
  AND lengte_cm < 1500;

-- ============================================================================
-- 2. Functie: voltooi_snijplan_rol
-- ============================================================================

CREATE OR REPLACE FUNCTION voltooi_snijplan_rol(
  p_rol_id BIGINT,
  p_gesneden_door TEXT DEFAULT NULL
)
RETURNS TABLE(reststuk_id BIGINT, reststuk_rolnummer TEXT, reststuk_lengte_cm INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_rol RECORD;
  v_gebruikte_lengte NUMERIC;
  v_rest_lengte INTEGER;
  v_nieuw_rolnummer TEXT;
  v_reststuk_id BIGINT;
  v_min_reststuk_cm INTEGER := 50; -- minimale lengte om reststuk aan te maken
BEGIN
  -- 1. Lock en haal rol op
  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id;
  END IF;

  IF v_rol.status <> 'in_snijplan' THEN
    RAISE EXCEPTION 'Rol % heeft status "%" — kan alleen "in_snijplan" rollen voltooien', p_rol_id, v_rol.status;
  END IF;

  -- 2. Bereken gebruikte lengte op basis van geplaatste snijplannen
  SELECT COALESCE(MAX(positie_y_cm + breedte_cm), 0)
  INTO v_gebruikte_lengte
  FROM snijvoorstel_plaatsingen
  WHERE rol_id = p_rol_id
    AND voorstel_id IN (SELECT id FROM snijvoorstellen WHERE status = 'goedgekeurd');

  -- Fallback: bereken uit snijplannen direct
  IF v_gebruikte_lengte = 0 THEN
    SELECT COALESCE(MAX(positie_y_cm +
      CASE WHEN geroteerd THEN lengte_cm ELSE breedte_cm END
    ), 0)
    INTO v_gebruikte_lengte
    FROM snijplannen
    WHERE rol_id = p_rol_id
      AND status = 'Gepland';
  END IF;

  v_rest_lengte := GREATEST(0, v_rol.lengte_cm - CEIL(v_gebruikte_lengte));

  -- 3. Markeer alle geplande snijplannen op deze rol als 'Gesneden'
  UPDATE snijplannen
  SET status = 'Gesneden',
      gesneden_datum = CURRENT_DATE,
      gesneden_op = NOW(),
      gesneden_door = p_gesneden_door
  WHERE rol_id = p_rol_id
    AND status = 'Gepland';

  -- 4. Maak reststuk aan als er genoeg over is
  IF v_rest_lengte >= v_min_reststuk_cm THEN
    -- Genereer rolnummer voor reststuk
    v_nieuw_rolnummer := v_rol.rolnummer || '-REST';

    INSERT INTO rollen (
      rolnummer, artikelnr, karpi_code, omschrijving,
      lengte_cm, breedte_cm, oppervlak_m2,
      kwaliteit_code, kleur_code, zoeksleutel,
      status, oorsprong_rol_id, reststuk_datum
    ) VALUES (
      v_nieuw_rolnummer,
      v_rol.artikelnr,
      v_rol.karpi_code,
      v_rol.omschrijving,
      v_rest_lengte,
      v_rol.breedte_cm,
      ROUND((v_rest_lengte * v_rol.breedte_cm)::NUMERIC / 10000, 2),
      v_rol.kwaliteit_code,
      v_rol.kleur_code,
      v_rol.zoeksleutel,
      'reststuk',
      p_rol_id,
      NOW()
    )
    RETURNING id INTO v_reststuk_id;

    -- 5. Originele rol markeren als gesneden (volledig verwerkt)
    UPDATE rollen
    SET status = 'gesneden',
        lengte_cm = CEIL(v_gebruikte_lengte)
    WHERE id = p_rol_id;

    RETURN QUERY SELECT v_reststuk_id, v_nieuw_rolnummer, v_rest_lengte;
  ELSE
    -- Geen bruikbaar reststuk — rol volledig verwerkt
    UPDATE rollen
    SET status = 'gesneden'
    WHERE id = p_rol_id;

    RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, NULL::INTEGER;
  END IF;
END;
$$;
