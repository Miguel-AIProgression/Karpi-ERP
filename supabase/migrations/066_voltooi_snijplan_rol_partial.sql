-- Migration 065: voltooi_snijplan_rol ondersteunt partial completion
--
-- Achtergrond: tot nu toe sloot voltooi_snijplan_rol ALLE snijplannen op een
-- rol met status 'Snijden' in één keer af. In de praktijk komt het voor dat
-- een medewerker maar een deel van de geplande stukken daadwerkelijk snijdt
-- (bv. niet voldoende ruimte, of een stuk wordt verplaatst naar een andere
-- rol). Met de nieuwe p_snijplan_ids parameter kan de frontend expliciet
-- aangeven welke snijplannen zijn afgevinkt. De overige worden teruggezet
-- naar 'Wacht' (rol_id losgekoppeld) zodat ze opnieuw ingepland kunnen worden.
--
-- Tevens: registreer snijden_voltooid_op timestamp op de rol (zie migratie 063).
--
-- Backwards compatible: als p_snijplan_ids NULL is gedraagt de functie zich
-- exact als in migratie 060 — alle 'Snijden' snijplannen gaan naar 'Gesneden'.
--
-- Reststuk-logica (zowel JSONB flow als fallback) is letterlijk overgenomen
-- uit migratie 060.
--
-- Schema-aanname: snijplannen.rol_id, positie_x_cm, positie_y_cm en geroteerd
-- zijn NULLABLE. Dit blijkt uit docs/database-schema.md (geen NOT NULL vermeld)
-- en uit gebruik in de codebase: snijplannen worden aangemaakt zonder rol
-- (status 'Wacht') en later toegewezen via keur_snijvoorstel_goed. Mocht een
-- van deze kolommen toch NOT NULL blijken, dan faalt deze functie bij de
-- reset-UPDATE; voeg in dat geval een ALTER COLUMN ... DROP NOT NULL toe.

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
BEGIN
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
  -- (letterlijk overgenomen uit migratie 060)
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
                          oorsprong_rol_id, reststuk_datum)
      VALUES (v_reststuk_nr, v_rol.artikelnr, v_rol.kwaliteit_code, v_rol.kleur_code,
              v_rect_lengte, v_rect_breedte,
              ROUND(v_rect_lengte * v_rect_breedte / 10000.0, 2),
              'beschikbaar', p_rol_id, CURRENT_DATE)
      RETURNING id INTO v_reststuk_id;

      reststuk_id := v_reststuk_id;
      reststuk_rolnummer := v_reststuk_nr;
      reststuk_lengte_cm := v_rect_lengte;
      v_created := v_created + 1;
      RETURN NEXT;
    END LOOP;

    -- Als geen enkele rect kwalificeerde, geef een lege row terug (compat)
    IF v_created = 0 THEN
      reststuk_id := NULL;
      reststuk_rolnummer := NULL;
      reststuk_lengte_cm := NULL;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  -- ---------------------------------------------------------------------
  -- Fallback: oud gedrag (1 end-of-roll reststuk, threshold 100 cm)
  -- (letterlijk overgenomen uit migratie 060)
  -- ---------------------------------------------------------------------
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
                        oppervlak_m2, status, oorsprong_rol_id, reststuk_datum)
    VALUES (v_reststuk_nr, v_rol.artikelnr, v_rol.kwaliteit_code, v_rol.kleur_code,
            v_rest_lengte, v_rol.breedte_cm,
            ROUND(v_rest_lengte * v_rol.breedte_cm / 10000.0, 2),
            'beschikbaar', p_rol_id, CURRENT_DATE)
    RETURNING id INTO v_reststuk_id;

    reststuk_id := v_reststuk_id;
    reststuk_rolnummer := v_reststuk_nr;
    reststuk_lengte_cm := v_rest_lengte;
    RETURN NEXT;
  ELSE
    reststuk_id := NULL;
    reststuk_rolnummer := NULL;
    reststuk_lengte_cm := NULL;
    RETURN NEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
