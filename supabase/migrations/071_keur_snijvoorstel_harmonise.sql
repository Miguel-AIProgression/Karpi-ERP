-- Migration 071: update keur_snijvoorstel_goed guard voor geharmoniseerde status.
--
-- Context: migraties 051/052/069/070 hebben alle legacy statussen Wacht/Gepland
-- naar 'Snijden' geharmoniseerd. De guard in keur_snijvoorstel_goed (migratie 037)
-- vereiste echter `snijplannen.status = 'Wacht'`, wat na harmonisatie nooit meer
-- waar is. Gevolg: `auto-plan-groep` faalt met
--   "Niet alle snijplannen hebben status 'Wacht'"
-- waardoor geen enkele automatische planning meer slaagt.
--
-- Fix: de guard meet voortaan "nog-niet-toegewezen" als
--   status = 'Snijden' AND rol_id IS NULL
-- Dit is semantisch correct: we weigeren een voorstel goed te keuren als een
-- stuk inmiddels door een andere flow toegewezen is aan een rol, of al een
-- verdere workflow-status heeft (Gesneden/In confectie/Gereed).
--
-- Daarnaast zet stap 5 de status direct op 'Snijden' (in plaats van 'Gepland'),
-- zodat we niet leunen op de harmonisatietrigger.

CREATE OR REPLACE FUNCTION keur_snijvoorstel_goed(p_voorstel_id BIGINT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
  v_invalid_plannen INTEGER;
  v_invalid_rollen INTEGER;
  r RECORD;
BEGIN
  -- 1. Lock voorstel en controleer status
  SELECT status INTO v_status
  FROM snijvoorstellen
  WHERE id = p_voorstel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snijvoorstel % niet gevonden', p_voorstel_id;
  END IF;

  IF v_status <> 'concept' THEN
    RAISE EXCEPTION 'Snijvoorstel kan alleen goedgekeurd worden vanuit status "concept" (huidige status: %)', v_status;
  END IF;

  -- 2. Controleer dat alle snijplannen nog "onaangetast" zijn:
  --    status='Snijden' en nog zonder rol_id.
  SELECT COUNT(*) INTO v_invalid_plannen
  FROM snijvoorstel_plaatsingen sp
  JOIN snijplannen sn ON sn.id = sp.snijplan_id
  WHERE sp.voorstel_id = p_voorstel_id
    AND (sn.status <> 'Snijden' OR sn.rol_id IS NOT NULL);

  IF v_invalid_plannen > 0 THEN
    RAISE EXCEPTION 'Niet alle snijplannen zijn nog onaangetast — % plan(nen) gewijzigd sinds voorstel', v_invalid_plannen;
  END IF;

  -- 3. Controleer dat alle rollen nog beschikbaar of reststuk zijn
  SELECT COUNT(*) INTO v_invalid_rollen
  FROM snijvoorstel_plaatsingen sp
  JOIN rollen ro ON ro.id = sp.rol_id
  WHERE sp.voorstel_id = p_voorstel_id
    AND ro.status NOT IN ('beschikbaar', 'reststuk');

  IF v_invalid_rollen > 0 THEN
    RAISE EXCEPTION 'Niet alle rollen zijn beschikbaar — % rol(len) inmiddels gewijzigd', v_invalid_rollen;
  END IF;

  -- 4. Lock rollen voor update
  PERFORM ro.id
  FROM snijvoorstel_plaatsingen sp
  JOIN rollen ro ON ro.id = sp.rol_id
  WHERE sp.voorstel_id = p_voorstel_id
  FOR UPDATE OF ro;

  -- 5. Update snijplannen met rol-toewijzing en positie (status blijft 'Snijden')
  FOR r IN
    SELECT snijplan_id, rol_id, positie_x_cm, positie_y_cm, geroteerd
    FROM snijvoorstel_plaatsingen
    WHERE voorstel_id = p_voorstel_id
  LOOP
    UPDATE snijplannen
    SET rol_id = r.rol_id,
        positie_x_cm = r.positie_x_cm,
        positie_y_cm = r.positie_y_cm,
        geroteerd = r.geroteerd,
        status = 'Snijden'
    WHERE id = r.snijplan_id;
  END LOOP;

  -- 6. Update rollen status naar 'in_snijplan'
  UPDATE rollen
  SET status = 'in_snijplan'
  WHERE id IN (
    SELECT DISTINCT rol_id
    FROM snijvoorstel_plaatsingen
    WHERE voorstel_id = p_voorstel_id
  );

  -- 7. Markeer voorstel als goedgekeurd
  UPDATE snijvoorstellen
  SET status = 'goedgekeurd'
  WHERE id = p_voorstel_id;
END;
$$;

COMMENT ON FUNCTION keur_snijvoorstel_goed IS
  'Keurt concept-voorstel goed en wijst rollen toe. Guard controleert nog-niet-toegewezen (rol_id IS NULL AND status=Snijden). Zie migratie 071.';
