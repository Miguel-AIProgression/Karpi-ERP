-- Migration 033: Productie functies en views

-- 1. beste_rol_voor_snijplan: find optimal roll for cutting
-- Priority: reststukken first, then aangebroken, then volle rollen
CREATE OR REPLACE FUNCTION beste_rol_voor_snijplan(
  p_kwaliteit_code TEXT,
  p_kleur_code TEXT,
  p_lengte_cm NUMERIC,
  p_breedte_cm NUMERIC
)
RETURNS TABLE (
  rol_id BIGINT,
  rolnummer TEXT,
  lengte_cm INTEGER,
  breedte_cm INTEGER,
  status TEXT,
  verspilling_m2 NUMERIC,
  prioriteit_score INTEGER  -- lower = better
) AS $$
SELECT
  r.id,
  r.rolnummer,
  r.lengte_cm,
  r.breedte_cm,
  r.status,
  ROUND((r.lengte_cm::NUMERIC * r.breedte_cm::NUMERIC - p_lengte_cm * p_breedte_cm) / 10000.0, 2) AS verspilling_m2,
  CASE
    WHEN r.status = 'reststuk' THEN 1    -- reststukken first (hergebruik)
    WHEN r.oorsprong_rol_id IS NOT NULL THEN 2  -- aangebroken rollen
    ELSE 3                                 -- volle rollen
  END AS prioriteit_score
FROM rollen r
WHERE r.kwaliteit_code = p_kwaliteit_code
  AND r.kleur_code = p_kleur_code
  AND r.status IN ('beschikbaar', 'reststuk')
  AND r.lengte_cm >= p_lengte_cm
  AND r.breedte_cm >= p_breedte_cm
ORDER BY prioriteit_score ASC, verspilling_m2 ASC
LIMIT 5;
$$ LANGUAGE sql STABLE;

-- 2. maak_reststuk: create remnant roll record after cutting
CREATE OR REPLACE FUNCTION maak_reststuk(
  p_rol_id BIGINT,
  p_lengte_cm INTEGER,
  p_breedte_cm INTEGER
)
RETURNS BIGINT AS $$
DECLARE
  v_rol rollen%ROWTYPE;
  v_reststuk_id BIGINT;
  v_reststuk_nr TEXT;
BEGIN
  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id;

  IF v_rol.id IS NULL THEN
    RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id;
  END IF;

  v_reststuk_nr := volgend_nummer('REST');

  INSERT INTO rollen (
    rolnummer, artikelnr, karpi_code, omschrijving,
    lengte_cm, breedte_cm, oppervlak_m2,
    vvp_m2, waarde,
    kwaliteit_code, kleur_code, zoeksleutel,
    status, locatie_id, oorsprong_rol_id, reststuk_datum
  )
  VALUES (
    v_reststuk_nr,
    v_rol.artikelnr, v_rol.karpi_code,
    'Reststuk van ' || v_rol.rolnummer,
    p_lengte_cm, p_breedte_cm,
    ROUND(p_lengte_cm::NUMERIC * p_breedte_cm::NUMERIC / 10000, 2),
    v_rol.vvp_m2,
    ROUND(p_lengte_cm::NUMERIC * p_breedte_cm::NUMERIC / 10000 * COALESCE(v_rol.vvp_m2, 0), 2),
    v_rol.kwaliteit_code, v_rol.kleur_code, v_rol.zoeksleutel,
    'reststuk', v_rol.locatie_id, p_rol_id, now()
  )
  RETURNING id INTO v_reststuk_id;

  -- Log the mutation
  INSERT INTO voorraad_mutaties (rol_id, type, lengte_cm, breedte_cm, referentie_id, referentie_type, notitie)
  VALUES (v_reststuk_id, 'reststuk', p_lengte_cm, p_breedte_cm, p_rol_id, 'rol', 'Reststuk aangemaakt van rol ' || v_rol.rolnummer);

  RETURN v_reststuk_id;
END;
$$ LANGUAGE plpgsql;

-- 3. snijplanning_overzicht view
-- Joins snijplannen with order_regels (maatwerk fields), orders, rollen, debiteuren
CREATE OR REPLACE VIEW snijplanning_overzicht AS
SELECT
  sp.id,
  sp.snijplan_nr,
  sp.scancode,
  sp.status,
  sp.lengte_cm AS snij_lengte_cm,
  sp.breedte_cm AS snij_breedte_cm,
  sp.prioriteit,
  sp.planning_week,
  sp.planning_jaar,
  sp.afleverdatum,
  sp.positie_x_cm,
  sp.positie_y_cm,
  sp.gesneden_datum,
  sp.gesneden_op,
  sp.gesneden_door,
  -- Rol info
  r.rolnummer,
  r.kwaliteit_code,
  r.kleur_code,
  r.lengte_cm AS rol_lengte_cm,
  r.breedte_cm AS rol_breedte_cm,
  r.oppervlak_m2 AS rol_oppervlak_m2,
  r.status AS rol_status,
  -- Maatwerk specs (from order_regels - single source of truth)
  oreg.maatwerk_vorm,
  oreg.maatwerk_lengte_cm,
  oreg.maatwerk_breedte_cm,
  oreg.maatwerk_afwerking,
  oreg.maatwerk_band_kleur,
  oreg.maatwerk_instructies,
  -- Order info
  oreg.id AS order_regel_id,
  oreg.artikelnr,
  oreg.omschrijving AS product_omschrijving,
  oreg.orderaantal,
  o.id AS order_id,
  o.order_nr,
  o.debiteur_nr,
  d.naam AS klant_naam
FROM snijplannen sp
LEFT JOIN rollen r ON r.id = sp.rol_id
LEFT JOIN order_regels oreg ON oreg.id = sp.order_regel_id
LEFT JOIN orders o ON o.id = oreg.order_id
LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr;

-- 4. confectie_overzicht view
CREATE OR REPLACE VIEW confectie_overzicht AS
SELECT
  co.id,
  co.confectie_nr,
  co.scancode,
  co.type_bewerking,
  co.instructies,
  co.status,
  co.gereed_datum,
  co.gestart_op,
  co.gereed_op,
  co.medewerker,
  -- From snijplan
  sp.snijplan_nr,
  sp.scancode AS snijplan_scancode,
  sp.gesneden_datum,
  -- From order_regels (maatwerk specs)
  oreg.maatwerk_afwerking,
  oreg.maatwerk_band_kleur,
  oreg.maatwerk_lengte_cm,
  oreg.maatwerk_breedte_cm,
  oreg.maatwerk_vorm,
  oreg.artikelnr,
  oreg.omschrijving AS product_omschrijving,
  -- Rol info
  r.kwaliteit_code,
  r.kleur_code,
  r.rolnummer,
  -- Order info
  o.order_nr,
  o.debiteur_nr,
  d.naam AS klant_naam
FROM confectie_orders co
LEFT JOIN snijplannen sp ON sp.id = co.snijplan_id
LEFT JOIN order_regels oreg ON oreg.id = co.order_regel_id
LEFT JOIN rollen r ON r.id = sp.rol_id
LEFT JOIN orders o ON o.id = oreg.order_id
LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr;

-- 5. productie_dashboard view
CREATE OR REPLACE VIEW productie_dashboard AS
SELECT
  (SELECT count(*) FROM snijplannen WHERE status = 'Wacht') AS snijplannen_wacht,
  (SELECT count(*) FROM snijplannen WHERE status = 'Gepland') AS snijplannen_gepland,
  (SELECT count(*) FROM snijplannen WHERE status = 'In productie') AS snijplannen_in_productie,
  (SELECT count(*) FROM snijplannen WHERE status = 'Gesneden') AS snijplannen_gesneden,
  (SELECT count(*) FROM confectie_orders WHERE status = 'Wacht op materiaal') AS confectie_wacht,
  (SELECT count(*) FROM confectie_orders WHERE status = 'In productie') AS confectie_actief,
  (SELECT count(*) FROM confectie_orders WHERE status = 'Gereed') AS confectie_gereed,
  (SELECT count(*) FROM rollen WHERE status = 'beschikbaar') AS beschikbare_rollen,
  (SELECT count(*) FROM rollen WHERE status = 'reststuk') AS reststukken;

-- 6. app_config singleton for production settings
CREATE TABLE IF NOT EXISTS app_config (
  id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sleutel TEXT NOT NULL UNIQUE,
  waarde  JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default production config
INSERT INTO app_config (sleutel, waarde) VALUES (
  'productie_planning',
  '{"planning_modus": "weken", "capaciteit_per_week": 450, "capaciteit_marge_pct": 10, "weken_vooruit": 4, "max_reststuk_verspilling_pct": 15}'::jsonb
) ON CONFLICT (sleutel) DO NOTHING;

-- RLS for app_config
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated full access" ON app_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Trigger for updated_at on app_config
CREATE TRIGGER app_config_updated_at
  BEFORE UPDATE ON app_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
