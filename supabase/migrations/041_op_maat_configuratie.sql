-- Migration 041: Op Maat configuratie
-- Nieuwe tabellen, kolommen, functies, constraints, RLS

-- ============================================================
-- 1. Maatwerk Vormen
-- ============================================================
CREATE TABLE maatwerk_vormen (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  naam TEXT NOT NULL,
  afmeting_type TEXT NOT NULL DEFAULT 'lengte_breedte'
    CHECK (afmeting_type IN ('lengte_breedte', 'diameter')),
  toeslag NUMERIC(10,2) NOT NULL DEFAULT 0,
  actief BOOLEAN NOT NULL DEFAULT true,
  volgorde INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO maatwerk_vormen (code, naam, afmeting_type, toeslag, volgorde) VALUES
  ('rechthoek',      'Rechthoek',              'lengte_breedte', 0,     1),
  ('rond',           'Rond',                   'diameter',       0,     2),
  ('ovaal',          'Ovaal',                  'lengte_breedte', 0,     3),
  ('organisch_a',    'Organisch A',            'lengte_breedte', 20.00, 4),
  ('organisch_b_sp', 'Organisch B gespiegeld', 'lengte_breedte', 20.00, 5);

-- ============================================================
-- 2. Afwerking Types (vervangt hardcoded CHECK constraint)
-- ============================================================
CREATE TABLE afwerking_types (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  naam TEXT NOT NULL,
  prijs NUMERIC(10,2) NOT NULL DEFAULT 0,
  heeft_band_kleur BOOLEAN NOT NULL DEFAULT false,
  actief BOOLEAN NOT NULL DEFAULT true,
  volgorde INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO afwerking_types (code, naam, prijs, heeft_band_kleur, volgorde) VALUES
  ('B',  'Breedband',        0, true,  1),
  ('FE', 'Feston',           0, false, 2),
  ('LO', 'Locken',           0, false, 3),
  ('ON', 'Onafgewerkt',      0, false, 4),
  ('SB', 'Smalband',         0, true,  5),
  ('SF', 'Smalfeston',       0, false, 6),
  ('VO', 'Volume afwerking', 0, false, 7),
  ('ZO', 'Zonder afwerking', 0, false, 8);

-- ============================================================
-- 3. Standaard afwerking per kwaliteit
-- ============================================================
CREATE TABLE kwaliteit_standaard_afwerking (
  kwaliteit_code TEXT NOT NULL REFERENCES kwaliteiten(code) ON DELETE CASCADE,
  afwerking_code TEXT NOT NULL REFERENCES afwerking_types(code) ON DELETE CASCADE,
  PRIMARY KEY (kwaliteit_code)
);

CREATE INDEX idx_ksa_afwerking ON kwaliteit_standaard_afwerking(afwerking_code);

-- ============================================================
-- 4. Instelbare m2-prijzen per kwaliteit/kleur
-- ============================================================
CREATE TABLE maatwerk_m2_prijzen (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kwaliteit_code TEXT NOT NULL REFERENCES kwaliteiten(code) ON DELETE CASCADE,
  kleur_code TEXT NOT NULL,
  verkoopprijs_m2 NUMERIC(10,2) NOT NULL,
  kostprijs_m2 NUMERIC(10,2),
  gewicht_per_m2_kg NUMERIC(8,3),
  max_breedte_cm INTEGER,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (kwaliteit_code, kleur_code)
);

-- Seed met bestaande vvp_m2 uit rollen (als startwaarden)
INSERT INTO maatwerk_m2_prijzen (kwaliteit_code, kleur_code, verkoopprijs_m2, kostprijs_m2, gewicht_per_m2_kg, max_breedte_cm)
SELECT
  r.kwaliteit_code,
  r.kleur_code,
  ROUND(AVG(r.vvp_m2)::NUMERIC, 2),
  ROUND(AVG(p.inkoopprijs / NULLIF(r.oppervlak_m2, 0))::NUMERIC, 2),
  ROUND(AVG(p.gewicht_kg / NULLIF(r.oppervlak_m2, 0))::NUMERIC, 3),
  MAX(r.breedte_cm)
FROM rollen r
JOIN producten p ON p.artikelnr = r.artikelnr
WHERE r.kwaliteit_code IS NOT NULL
  AND r.kleur_code IS NOT NULL
  AND r.vvp_m2 > 0
  AND r.status IN ('beschikbaar', 'gereserveerd')
GROUP BY r.kwaliteit_code, r.kleur_code;

-- ============================================================
-- 5. Extra kolommen op order_regels
-- ============================================================
ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS maatwerk_m2_prijs NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS maatwerk_kostprijs_m2 NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS maatwerk_oppervlak_m2 NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS maatwerk_vorm_toeslag NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maatwerk_afwerking_prijs NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maatwerk_diameter_cm INTEGER,
  ADD COLUMN IF NOT EXISTS maatwerk_kwaliteit_code TEXT,
  ADD COLUMN IF NOT EXISTS maatwerk_kleur_code TEXT;

-- ============================================================
-- 6. DROP oude CHECK constraint, voeg FK constraints toe
-- ============================================================
ALTER TABLE order_regels DROP CONSTRAINT IF EXISTS order_regels_maatwerk_afwerking_check;

ALTER TABLE order_regels
  ADD CONSTRAINT fk_order_regels_afwerking
  FOREIGN KEY (maatwerk_afwerking) REFERENCES afwerking_types(code)
  ON DELETE RESTRICT;

ALTER TABLE order_regels
  ADD CONSTRAINT fk_order_regels_vorm
  FOREIGN KEY (maatwerk_vorm) REFERENCES maatwerk_vormen(code)
  ON DELETE RESTRICT;

-- ============================================================
-- 7. DB-functie: kleuren voor kwaliteit
-- ============================================================
CREATE OR REPLACE FUNCTION kleuren_voor_kwaliteit(p_kwaliteit TEXT)
RETURNS TABLE(
  kleur_code TEXT,
  omschrijving TEXT,
  verkoopprijs_m2 NUMERIC,
  kostprijs_m2 NUMERIC,
  gewicht_per_m2_kg NUMERIC,
  max_breedte_cm INTEGER
) AS $$
  SELECT
    mp.kleur_code,
    MIN(p.omschrijving),
    mp.verkoopprijs_m2,
    mp.kostprijs_m2,
    mp.gewicht_per_m2_kg,
    mp.max_breedte_cm
  FROM maatwerk_m2_prijzen mp
  JOIN producten p ON p.kwaliteit_code = mp.kwaliteit_code
    AND p.kleur_code = mp.kleur_code AND p.actief = true
  WHERE mp.kwaliteit_code = p_kwaliteit
  GROUP BY mp.kleur_code, mp.verkoopprijs_m2, mp.kostprijs_m2,
           mp.gewicht_per_m2_kg, mp.max_breedte_cm
  ORDER BY mp.kleur_code;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- 8. RLS policies (V1: volledige toegang, consistent met bestaand beleid)
-- ============================================================
ALTER TABLE maatwerk_vormen ENABLE ROW LEVEL SECURITY;
ALTER TABLE afwerking_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE kwaliteit_standaard_afwerking ENABLE ROW LEVEL SECURITY;
ALTER TABLE maatwerk_m2_prijzen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon full access" ON maatwerk_vormen FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access" ON afwerking_types FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access" ON kwaliteit_standaard_afwerking FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access" ON maatwerk_m2_prijzen FOR ALL TO anon USING (true) WITH CHECK (true);
