-- Migration 053: Confectie-planning module
-- 1) Tabel `confectie_werktijden` (config per type_bewerking) + trigger + seed
-- 2) View `confectie_planning_overzicht` voor de planningsweergave
-- 3) RLS conform projectconventie (authenticated = volledige toegang)
--
-- Spec: specs/10-confectie-planning.md

-- ============================================================
-- 1) Tabel confectie_werktijden
-- ============================================================

CREATE TABLE IF NOT EXISTS confectie_werktijden (
  type_bewerking      TEXT          PRIMARY KEY,
  minuten_per_meter   NUMERIC(6,2)  NOT NULL,
  wisseltijd_minuten  INTEGER       NOT NULL DEFAULT 5,
  actief              BOOLEAN       NOT NULL DEFAULT true,
  bijgewerkt_op       TIMESTAMPTZ   DEFAULT NOW()
);

COMMENT ON TABLE confectie_werktijden IS
  'Configuratie per type_bewerking voor confectie-planning: minuten per strekkende meter en wisseltijd.';

-- Trigger-functie voor bijgewerkt_op (geen generieke equivalent in de codebase;
-- bestaande update_updated_at() werkt op kolom updated_at).
CREATE OR REPLACE FUNCTION set_bijgewerkt_op()
RETURNS TRIGGER AS $$
BEGIN
  NEW.bijgewerkt_op = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_confectie_werktijden_bijgewerkt_op ON confectie_werktijden;
CREATE TRIGGER trg_confectie_werktijden_bijgewerkt_op
  BEFORE UPDATE ON confectie_werktijden
  FOR EACH ROW
  EXECUTE FUNCTION set_bijgewerkt_op();

-- Seed defaults uit spec
INSERT INTO confectie_werktijden (type_bewerking, minuten_per_meter, wisseltijd_minuten, actief) VALUES
  ('breedband',         3, 5, true),
  ('smalband',          2, 5, true),
  ('feston',            6, 5, true),
  ('smalfeston',        5, 5, true),
  ('locken',            1, 3, true),
  ('volume afwerking',  4, 5, true),
  ('stickeren',         0, 0, false)
ON CONFLICT (type_bewerking) DO NOTHING;

-- RLS
ALTER TABLE confectie_werktijden ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_full_access" ON confectie_werktijden;
CREATE POLICY "authenticated_full_access"
  ON confectie_werktijden
  FOR ALL
  USING (auth.role() = 'authenticated');

-- ============================================================
-- 2) View confectie_planning_overzicht
-- ============================================================
-- Per confectie-order de planningsrelevante velden, gejoind met
-- order_regels (maatwerk-specs + kwaliteit/kleur), orders en debiteuren.
-- Alleen status 'Wacht op materiaal' en 'In productie' worden ingepland.
-- (Spec noemt 'In confectie' maar dat is een snijplan_status; voor confectie_status
--  is het equivalent 'In productie' — zie enum-definitie in docs/database-schema.md.)

DROP VIEW IF EXISTS confectie_planning_overzicht CASCADE;

CREATE VIEW confectie_planning_overzicht AS
SELECT
  co.id                                  AS confectie_id,
  co.confectie_nr,
  co.scancode,
  co.status,
  co.type_bewerking,
  -- Order-regel + order
  ore.id                                 AS order_regel_id,
  o.order_nr,
  d.naam                                 AS klant_naam,
  o.afleverdatum,
  -- Kwaliteit/kleur (zelfde COALESCE-cascade als snijplanning_overzicht)
  COALESCE(r.kwaliteit_code, p.kwaliteit_code, ore.maatwerk_kwaliteit_code) AS kwaliteit_code,
  COALESCE(r.kleur_code,    p.kleur_code,    ore.maatwerk_kleur_code)      AS kleur_code,
  -- Maatwerk afmetingen + vorm
  ore.maatwerk_lengte_cm                 AS lengte_cm,
  ore.maatwerk_breedte_cm                AS breedte_cm,
  ore.maatwerk_vorm                      AS vorm,
  -- Strekkende meter in cm = langste zijde (frontend doet π-correctie voor rond/ovaal)
  GREATEST(
    COALESCE(ore.maatwerk_lengte_cm, 0),
    COALESCE(ore.maatwerk_breedte_cm, 0)
  )                                      AS strekkende_meter_cm
FROM confectie_orders co
JOIN order_regels ore ON ore.id = co.order_regel_id
JOIN orders o         ON o.id = ore.order_id
JOIN debiteuren d     ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN producten p ON p.artikelnr = ore.artikelnr
LEFT JOIN rollen r    ON r.id = co.rol_id
WHERE co.status IN ('Wacht op materiaal', 'In productie');

COMMENT ON VIEW confectie_planning_overzicht IS
  'Planningsweergave voor confectie-orders: alleen status Wacht op materiaal / In productie, met klant/order/maat/leverdatum.';
