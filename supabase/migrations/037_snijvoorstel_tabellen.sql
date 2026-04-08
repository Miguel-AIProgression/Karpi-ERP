-- Migration 037: Snijvoorstel tabellen voor snijoptimalisatie
-- Voorstellen groeperen meerdere snijplannen per kwaliteit+kleur,
-- waarna de optimizer de beste rol-toewijzingen berekent.
-- Na goedkeuring worden rollen en snijplannen atomisch bijgewerkt.

-- 1. Tabel: snijvoorstellen
CREATE TABLE snijvoorstellen (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voorstel_nr TEXT UNIQUE NOT NULL,
  kwaliteit_code TEXT NOT NULL REFERENCES kwaliteiten(code),
  kleur_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'concept'
    CHECK (status IN ('concept', 'goedgekeurd', 'verworpen')),
  totaal_stukken INTEGER NOT NULL DEFAULT 0,
  totaal_rollen INTEGER NOT NULL DEFAULT 0,
  totaal_m2_gebruikt NUMERIC(10,2) DEFAULT 0,
  totaal_m2_afval NUMERIC(10,2) DEFAULT 0,
  afval_percentage NUMERIC(5,2) DEFAULT 0,
  aangemaakt_door TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabel: snijvoorstel_plaatsingen
CREATE TABLE snijvoorstel_plaatsingen (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voorstel_id BIGINT NOT NULL REFERENCES snijvoorstellen(id) ON DELETE CASCADE,
  snijplan_id BIGINT NOT NULL REFERENCES snijplannen(id),
  rol_id BIGINT NOT NULL REFERENCES rollen(id),
  positie_x_cm NUMERIC NOT NULL DEFAULT 0,
  positie_y_cm NUMERIC NOT NULL DEFAULT 0,
  geroteerd BOOLEAN NOT NULL DEFAULT false,
  lengte_cm INTEGER NOT NULL,
  breedte_cm INTEGER NOT NULL
);

-- 3. Nieuwe kolom op snijplannen voor rotatie
ALTER TABLE snijplannen ADD COLUMN IF NOT EXISTS geroteerd BOOLEAN NOT NULL DEFAULT false;

-- 4. Nummering voor snijvoorstellen
INSERT INTO nummering (type, jaar, laatste_nummer)
VALUES ('SNIJV', 2026, 0)
ON CONFLICT DO NOTHING;

-- 5. Indexes
CREATE INDEX idx_snijvoorstellen_kwaliteit_kleur ON snijvoorstellen(kwaliteit_code, kleur_code);
CREATE INDEX idx_snijvoorstellen_status ON snijvoorstellen(status);
CREATE INDEX idx_svp_voorstel ON snijvoorstel_plaatsingen(voorstel_id);
CREATE INDEX idx_svp_snijplan ON snijvoorstel_plaatsingen(snijplan_id);
CREATE INDEX idx_svp_rol ON snijvoorstel_plaatsingen(rol_id);

-- 6. Trigger voor updated_at
CREATE TRIGGER trg_snijvoorstellen_updated
  BEFORE UPDATE ON snijvoorstellen
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 7. Row Level Security
ALTER TABLE snijvoorstellen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated full access" ON snijvoorstellen
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE snijvoorstel_plaatsingen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated full access" ON snijvoorstel_plaatsingen
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 8. Functie: keur_snijvoorstel_goed
--    Keurt een concept-voorstel goed en wijst rollen + posities toe aan snijplannen.
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

  -- 2. Controleer dat alle snijplannen nog status 'Wacht' hebben
  SELECT COUNT(*) INTO v_invalid_plannen
  FROM snijvoorstel_plaatsingen sp
  JOIN snijplannen sn ON sn.id = sp.snijplan_id
  WHERE sp.voorstel_id = p_voorstel_id
    AND sn.status <> 'Wacht';

  IF v_invalid_plannen > 0 THEN
    RAISE EXCEPTION 'Niet alle snijplannen hebben status "Wacht" — % plan(nen) gewijzigd sinds voorstel', v_invalid_plannen;
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

  -- 5. Update snijplannen met rol-toewijzing en positie
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
        status = 'Gepland'
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

-- 9. Functie: verwerp_snijvoorstel
--    Verwerpt een concept-voorstel zonder wijzigingen aan rollen of plannen.
CREATE OR REPLACE FUNCTION verwerp_snijvoorstel(p_voorstel_id BIGINT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM snijvoorstellen
  WHERE id = p_voorstel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snijvoorstel % niet gevonden', p_voorstel_id;
  END IF;

  IF v_status <> 'concept' THEN
    RAISE EXCEPTION 'Alleen concept-voorstellen kunnen verworpen worden (huidige status: %)', v_status;
  END IF;

  UPDATE snijvoorstellen
  SET status = 'verworpen'
  WHERE id = p_voorstel_id;
END;
$$;
