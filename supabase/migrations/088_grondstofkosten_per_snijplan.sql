-- Migration 088: Grondstofkosten per snijplan bij rol-afsluiting
--
-- Context: voltooi_snijplan_rol (migratie 066) sluit een rol definitief af.
-- Op dat moment weten we hoeveel materiaal per stuk is verbruikt, hoeveel
-- als reststuk teruggaat naar voorraad, en hoeveel afval is. We leggen
-- per snijplan de toegerekende grondstofkosten vast (incl. proportioneel
-- afval-aandeel) voor latere winstmarge-berekening.
--
-- Tevens: nieuwe reststuk-rollen krijgen waarde toegekend
-- (oppervlak_m2 × bronrol-inkoopprijs_m2). Zonder dit tellen reststukken
-- niet mee in dashboard_stats.voorraadwaarde_inkoop.

ALTER TABLE snijplannen
  ADD COLUMN grondstofkosten     NUMERIC(12,2),
  ADD COLUMN grondstofkosten_m2  NUMERIC(10,4),
  ADD COLUMN inkoopprijs_m2      NUMERIC(10,2);

COMMENT ON COLUMN snijplannen.grondstofkosten IS
  'Toegerekende grondstofkosten in € voor dit gesneden stuk incl. proportioneel afval. Gezet bij voltooi_snijplan_rol. NULL als bronrol geen waarde/oppervlak had. Zie migratie 088.';
COMMENT ON COLUMN snijplannen.grondstofkosten_m2 IS
  'Aan dit stuk toegerekend materiaaloppervlak in m² = stuk_m² + aandeel × afval_m². Snapshot bij snijden.';
COMMENT ON COLUMN snijplannen.inkoopprijs_m2 IS
  'Inkoopprijs per m² van bronrol op moment van snijden. Snapshot: rol.waarde / rol.oppervlak_m2.';

-- ---------------------------------------------------------------------
-- voltooi_snijplan_rol: herschreven t.o.v. migratie 066
--
-- Wijzigingen:
--   1. Reststuk-INSERTs schrijven nu ook `waarde` op basis van bronrol-
--      inkoopprijs per m² (NULL-safe als bronrol geen waarde/oppervlak heeft).
--   2. Return-paden geconsolideerd via _reststuk_out TEMP TABLE, zodat na
--      reststuk-creatie nog het kostentoerekening-blok kan draaien.
--   3. Nieuw blok: bereken en sla grondstofkosten + grondstofkosten_m2 +
--      inkoopprijs_m2 op per zojuist afgevinkt snijplan, met proportioneel
--      afval-aandeel (afval = bronrol_m² - gesneden_m² - reststuk_m²).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION voltooi_snijplan_rol(
  p_rol_id BIGINT,
  p_gesneden_door TEXT DEFAULT NULL,
  p_override_rest_lengte INTEGER DEFAULT NULL,
  p_reststukken JSONB DEFAULT NULL,
  p_snijplan_ids BIGINT[] DEFAULT NULL
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
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _reststuk_out (
    reststuk_id BIGINT, reststuk_rolnummer TEXT, reststuk_lengte_cm INTEGER
  ) ON COMMIT DROP;
  DELETE FROM _reststuk_out;

  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id; END IF;

  IF p_snijplan_ids IS NULL THEN
    -- Volledige afronding (gedrag migratie 060): alle Snijden -> Gesneden
    UPDATE snijplannen
    SET status = 'Gesneden',
        gesneden_datum = CURRENT_DATE,
        gesneden_op = NOW(),
        gesneden_door = p_gesneden_door
    WHERE rol_id = p_rol_id
      AND status = 'Snijden';

    UPDATE rollen
    SET status = 'gesneden',
        snijden_voltooid_op = NOW()
    WHERE id = p_rol_id;
  ELSE
    -- Partial completion: alleen afgevinkte stukken -> Gesneden
    UPDATE snijplannen
    SET status = 'Gesneden',
        gesneden_datum = CURRENT_DATE,
        gesneden_op = NOW(),
        gesneden_door = p_gesneden_door
    WHERE rol_id = p_rol_id
      AND status = 'Snijden'
      AND id = ANY(p_snijplan_ids);

    -- Resterende Snijden-stukken op deze rol -> terug naar Wacht, losgekoppeld
    UPDATE snijplannen
    SET status = 'Wacht',
        rol_id = NULL,
        positie_x_cm = NULL,
        positie_y_cm = NULL,
        geroteerd = FALSE
    WHERE rol_id = p_rol_id
      AND status = 'Snijden'
      AND NOT (id = ANY(p_snijplan_ids));

    -- Aantal daadwerkelijk afgevinkte stukken bepalen
    SELECT COUNT(*) INTO v_afgevinkt_count
    FROM snijplannen
    WHERE rol_id = p_rol_id
      AND status = 'Gesneden'
      AND gesneden_op >= NOW() - INTERVAL '1 second'
      AND id = ANY(p_snijplan_ids);

    IF array_length(p_snijplan_ids, 1) IS NOT NULL AND array_length(p_snijplan_ids, 1) > 0 THEN
      UPDATE rollen
      SET status = 'gesneden',
          snijden_voltooid_op = NOW()
      WHERE id = p_rol_id;
    ELSE
      -- Edge case: lege array — rolstatus ongemoeid, wel voltooid_op
      UPDATE rollen
      SET snijden_voltooid_op = NOW()
      WHERE id = p_rol_id;
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- Nieuwe flow: expliciete lijst van reststuk-rechthoeken
  -- ---------------------------------------------------------------------
  IF p_reststukken IS NOT NULL AND jsonb_array_length(p_reststukken) > 0 THEN
    v_idx := 0;
    v_created := 0;
    FOR v_rect IN SELECT * FROM jsonb_array_elements(p_reststukken)
    LOOP
      v_idx := v_idx + 1;
      v_rect_breedte := (v_rect->>'breedte_cm')::INTEGER;
      v_rect_lengte := (v_rect->>'lengte_cm')::INTEGER;

      -- Harde drempel: min 70x140 cm (kleiner = afval)
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

    -- Als geen enkele rect kwalificeerde, geef een lege row terug (compat)
    IF v_created = 0 THEN
      INSERT INTO _reststuk_out VALUES (NULL, NULL, NULL);
    END IF;
  ELSE
    -- -------------------------------------------------------------------
    -- Fallback: oud gedrag (1 end-of-roll reststuk, threshold 100 cm)
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
  -- Kostentoerekening: per zojuist afgevinkt snijplan
  -- grondstofkosten_m2 = stuk_m² + afval_m² * (stuk_m² / gesneden_m²)
  -- grondstofkosten    = grondstofkosten_m2 * prijs_per_m2
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

    v_afval_m2 := GREATEST(0, v_rol.oppervlak_m2 - v_gesneden_m2 - v_reststuk_m2);

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
