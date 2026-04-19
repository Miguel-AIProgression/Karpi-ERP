-- Migration 090: voltooi_snijplan_rol ondersteunt aangebroken-rol teruggave.
--
-- Vervolg op 086/087 (kwaliteiten.standaard_breedte_cm) en 088 (grondstof-
-- kosten per snijplan). Bij het afsluiten van een rol blijft soms een
-- end-of-roll strip met volle breedte over (bv. OASI 11: 320 × 4110 cm na
-- wat kleine stukken). Tot nu toe werd dat een nieuwe reststuk-rol
-- "OASI 11-R3" terwijl het fysiek de originele rol is met een verkorte
-- lengte. De juiste classificatie is "aangebroken rol".
--
-- Deze migratie voegt een optionele parameter p_aangebroken_lengte toe.
-- Als gezet (≥100 cm): originele rol behoudt rolnummer, krijgt nieuwe
-- lengte_cm, status blijft 'beschikbaar' (i.p.v. 'gesneden'). rol_type
-- wordt auto herberekend door bereken_rol_type() — breedte = standaard +
-- oorsprong = NULL → aangebroken wordt gezet via trigger. Voorraadmutatie
-- 'aangebroken' wordt gelogd. snijden_gestart_op/voltooid_op/door worden
-- gereset zodat de volgende snijcyclus schoon begint.
--
-- Grondstofkosten-toerekening (088): het aangebroken deel wordt afgetrokken
-- van v_afval_m2 zodat de resterende afval correct naar gesneden stukken
-- wordt doorverdeeld.
--
-- BELANGRIJK: de FE stuurt p_aangebroken_lengte ALLEEN als rol.rol_type
-- bij start IN ('volle_rol','aangebroken') was. Voor echte reststuk-
-- rollen blijft het oude end-of-roll-als-reststuk-gedrag gelden.
--
-- Let op: een nieuwe parameter betekent in Postgres een nieuwe functie-
-- signatuur (overload). Daarom droppen we eerst expliciet de 5-arg versie
-- uit migratie 088 voordat de 6-arg versie wordt aangemaakt; anders
-- bestaan er twee overloads met identieke naam en wordt COMMENT ON
-- FUNCTION ambigu.

DROP FUNCTION IF EXISTS voltooi_snijplan_rol(BIGINT, TEXT, INTEGER, JSONB, BIGINT[]);

CREATE OR REPLACE FUNCTION voltooi_snijplan_rol(
  p_rol_id BIGINT,
  p_gesneden_door TEXT DEFAULT NULL,
  p_override_rest_lengte INTEGER DEFAULT NULL,
  p_reststukken JSONB DEFAULT NULL,
  p_snijplan_ids BIGINT[] DEFAULT NULL,
  p_aangebroken_lengte INTEGER DEFAULT NULL
)
RETURNS TABLE(reststuk_id BIGINT, reststuk_rolnummer TEXT, reststuk_lengte_cm INTEGER) AS $$
DECLARE
  v_rol RECORD;
  v_gebruikte_lengte NUMERIC;
  v_rest_lengte INTEGER;
  v_reststuk_id BIGINT;
  v_reststuk_nr TEXT;
  v_idx INTEGER;
  v_created INTEGER;
  v_rect JSONB;
  v_rect_breedte INTEGER;
  v_rect_lengte INTEGER;
  v_afgevinkt_count INTEGER;
  v_prijs_per_m2 NUMERIC;
  v_gesneden_m2 NUMERIC;
  v_reststuk_m2 NUMERIC;
  v_afval_m2 NUMERIC;
  v_aangebroken_m2 NUMERIC;
  v_aangebroken BOOLEAN := (p_aangebroken_lengte IS NOT NULL AND p_aangebroken_lengte >= 100);
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _reststuk_out (
    reststuk_id BIGINT, reststuk_rolnummer TEXT, reststuk_lengte_cm INTEGER
  ) ON COMMIT DROP;
  DELETE FROM _reststuk_out;

  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id; END IF;

  -- ---------------------------------------------------------------------
  -- 1. Snijplan-status updates (identiek aan 088)
  -- ---------------------------------------------------------------------
  IF p_snijplan_ids IS NULL THEN
    UPDATE snijplannen
    SET status = 'Gesneden',
        gesneden_datum = CURRENT_DATE,
        gesneden_op = NOW(),
        gesneden_door = p_gesneden_door
    WHERE rol_id = p_rol_id
      AND status = 'Snijden';
  ELSE
    UPDATE snijplannen
    SET status = 'Gesneden',
        gesneden_datum = CURRENT_DATE,
        gesneden_op = NOW(),
        gesneden_door = p_gesneden_door
    WHERE rol_id = p_rol_id
      AND status = 'Snijden'
      AND id = ANY(p_snijplan_ids);

    UPDATE snijplannen
    SET status = 'Wacht',
        rol_id = NULL,
        positie_x_cm = NULL,
        positie_y_cm = NULL,
        geroteerd = FALSE
    WHERE rol_id = p_rol_id
      AND status = 'Snijden'
      AND NOT (id = ANY(p_snijplan_ids));

    SELECT COUNT(*) INTO v_afgevinkt_count
    FROM snijplannen
    WHERE rol_id = p_rol_id
      AND status = 'Gesneden'
      AND gesneden_op >= NOW() - INTERVAL '1 second'
      AND id = ANY(p_snijplan_ids);
  END IF;

  -- ---------------------------------------------------------------------
  -- 2. Rol-status: aangebroken (verkort) of gesneden (oud gedrag)
  -- ---------------------------------------------------------------------
  IF v_aangebroken THEN
    INSERT INTO voorraad_mutaties (rol_id, type, lengte_voor_cm, lengte_na_cm, reden, medewerker)
    VALUES (p_rol_id, 'aangebroken', v_rol.lengte_cm, p_aangebroken_lengte,
            'Rol aangebroken na snijden (volle breedte overgebleven)', p_gesneden_door);

    UPDATE rollen
    SET lengte_cm = p_aangebroken_lengte,
        oppervlak_m2 = ROUND(p_aangebroken_lengte * breedte_cm / 10000.0, 2),
        waarde = CASE
          WHEN v_rol.waarde IS NOT NULL AND v_rol.oppervlak_m2 > 0
          THEN ROUND((p_aangebroken_lengte * v_rol.breedte_cm / 10000.0)
                     * (v_rol.waarde / v_rol.oppervlak_m2), 2)
          ELSE waarde
        END,
        status = 'beschikbaar',
        snijden_gestart_op = NULL,
        snijden_voltooid_op = NULL,
        snijden_gestart_door = NULL
    WHERE id = p_rol_id;
  ELSE
    IF p_snijplan_ids IS NULL
       OR (array_length(p_snijplan_ids, 1) IS NOT NULL AND array_length(p_snijplan_ids, 1) > 0) THEN
      UPDATE rollen
      SET status = 'gesneden',
          snijden_voltooid_op = NOW()
      WHERE id = p_rol_id;
    ELSE
      UPDATE rollen
      SET snijden_voltooid_op = NOW()
      WHERE id = p_rol_id;
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- 3. Reststukken JSONB-flow (identiek aan 088 incl. waarde-toerekening)
  -- ---------------------------------------------------------------------
  IF p_reststukken IS NOT NULL AND jsonb_array_length(p_reststukken) > 0 THEN
    v_idx := 0;
    v_created := 0;
    FOR v_rect IN SELECT * FROM jsonb_array_elements(p_reststukken)
    LOOP
      v_idx := v_idx + 1;
      v_rect_breedte := (v_rect->>'breedte_cm')::INTEGER;
      v_rect_lengte := (v_rect->>'lengte_cm')::INTEGER;

      IF LEAST(v_rect_breedte, v_rect_lengte) < 70
         OR GREATEST(v_rect_breedte, v_rect_lengte) < 140 THEN
        CONTINUE;
      END IF;

      v_reststuk_nr := v_rol.rolnummer || '-R' || v_idx::TEXT;

      INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, kleur_code,
                          lengte_cm, breedte_cm, oppervlak_m2, status,
                          oorsprong_rol_id, reststuk_datum, waarde)
      VALUES (v_reststuk_nr, v_rol.artikelnr, v_rol.kwaliteit_code, v_rol.kleur_code,
              v_rect_lengte, v_rect_breedte,
              ROUND(v_rect_lengte * v_rect_breedte / 10000.0, 2),
              'beschikbaar', p_rol_id, CURRENT_DATE,
              CASE WHEN v_rol.waarde IS NOT NULL AND v_rol.oppervlak_m2 > 0
                   THEN ROUND((v_rect_lengte * v_rect_breedte / 10000.0)
                              * (v_rol.waarde / v_rol.oppervlak_m2), 2)
                   ELSE NULL END)
      RETURNING id INTO v_reststuk_id;

      INSERT INTO _reststuk_out VALUES (v_reststuk_id, v_reststuk_nr, v_rect_lengte);
      v_created := v_created + 1;
    END LOOP;

    IF v_created = 0 THEN
      INSERT INTO _reststuk_out VALUES (NULL, NULL, NULL);
    END IF;
  ELSIF v_aangebroken THEN
    -- Aangebroken zonder extra reststukken: geen aparte reststuk-rol.
    INSERT INTO _reststuk_out VALUES (NULL, NULL, NULL);
  ELSE
    -- -------------------------------------------------------------------
    -- 3b. Fallback (oud gedrag): 1 end-of-roll reststuk via positie-calc.
    -- -------------------------------------------------------------------
    SELECT COALESCE(MAX(positie_y_cm + CASE WHEN geroteerd THEN lengte_cm ELSE breedte_cm END), 0)
    INTO v_gebruikte_lengte
    FROM snijplannen WHERE rol_id = p_rol_id AND status = 'Gesneden';

    IF p_override_rest_lengte IS NOT NULL THEN
      v_rest_lengte := GREATEST(0, p_override_rest_lengte);
    ELSE
      v_rest_lengte := GREATEST(0, v_rol.lengte_cm - CEIL(v_gebruikte_lengte));
    END IF;

    IF v_rest_lengte >= 100 THEN
      v_reststuk_nr := v_rol.rolnummer || '-R';
      INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, kleur_code, lengte_cm, breedte_cm,
                          oppervlak_m2, status, oorsprong_rol_id, reststuk_datum, waarde)
      VALUES (v_reststuk_nr, v_rol.artikelnr, v_rol.kwaliteit_code, v_rol.kleur_code,
              v_rest_lengte, v_rol.breedte_cm,
              ROUND(v_rest_lengte * v_rol.breedte_cm / 10000.0, 2),
              'beschikbaar', p_rol_id, CURRENT_DATE,
              CASE WHEN v_rol.waarde IS NOT NULL AND v_rol.oppervlak_m2 > 0
                   THEN ROUND((v_rest_lengte * v_rol.breedte_cm / 10000.0)
                              * (v_rol.waarde / v_rol.oppervlak_m2), 2)
                   ELSE NULL END)
      RETURNING id INTO v_reststuk_id;

      INSERT INTO _reststuk_out VALUES (v_reststuk_id, v_reststuk_nr, v_rest_lengte);
    ELSE
      INSERT INTO _reststuk_out VALUES (NULL, NULL, NULL);
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- 4. Kostentoerekening per zojuist afgevinkt snijplan (088).
  -- Bij aangebroken: trek aangebroken_m² af van afval_m² zodat de gesneden
  -- stukken niet ten onrechte de hele overgebleven lengte betalen.
  -- ---------------------------------------------------------------------
  IF v_rol.oppervlak_m2 IS NOT NULL AND v_rol.oppervlak_m2 > 0
     AND v_rol.waarde IS NOT NULL THEN

    v_prijs_per_m2 := v_rol.waarde / v_rol.oppervlak_m2;

    SELECT COALESCE(SUM(lengte_cm * breedte_cm / 10000.0), 0)
    INTO v_gesneden_m2
    FROM snijplannen
    WHERE rol_id = p_rol_id
      AND status = 'Gesneden'
      AND gesneden_op >= NOW() - INTERVAL '5 seconds';

    SELECT COALESCE(SUM(oppervlak_m2), 0)
    INTO v_reststuk_m2
    FROM rollen
    WHERE oorsprong_rol_id = p_rol_id
      AND reststuk_datum = CURRENT_DATE;

    v_aangebroken_m2 := CASE
      WHEN v_aangebroken
      THEN ROUND(p_aangebroken_lengte * v_rol.breedte_cm / 10000.0, 2)
      ELSE 0
    END;

    v_afval_m2 := GREATEST(0,
      v_rol.oppervlak_m2 - v_gesneden_m2 - v_reststuk_m2 - v_aangebroken_m2
    );

    IF v_gesneden_m2 > 0 THEN
      UPDATE snijplannen sp
      SET grondstofkosten_m2 = ROUND(
            (sp.lengte_cm * sp.breedte_cm / 10000.0)
            + v_afval_m2 * ((sp.lengte_cm * sp.breedte_cm / 10000.0) / v_gesneden_m2),
            4),
          inkoopprijs_m2 = v_prijs_per_m2,
          grondstofkosten = ROUND(
            ((sp.lengte_cm * sp.breedte_cm / 10000.0)
             + v_afval_m2 * ((sp.lengte_cm * sp.breedte_cm / 10000.0) / v_gesneden_m2))
            * v_prijs_per_m2,
            2)
      WHERE sp.rol_id = p_rol_id
        AND sp.status = 'Gesneden'
        AND sp.gesneden_op >= NOW() - INTERVAL '5 seconds';
    END IF;
  END IF;

  RETURN QUERY SELECT * FROM _reststuk_out;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION voltooi_snijplan_rol(BIGINT, TEXT, INTEGER, JSONB, BIGINT[], INTEGER) IS
  'Voltooit een rol: snijplannen → Gesneden (of terug naar Wacht bij partial), maakt reststuk-rollen (p_reststukken), rekent grondstofkosten toe (088), en optioneel (p_aangebroken_lengte ≥100) verkort de originele rol naar een aangebroken rol i.p.v. status=gesneden. Zie migratie 090.';
