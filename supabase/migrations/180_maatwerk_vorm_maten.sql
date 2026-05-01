-- supabase/migrations/180_maatwerk_vorm_maten.sql
-- Vaste maat-suggesties per vorm. Per vorm 1-N rijen die als chips in de UI verschijnen.
-- Alleen lengte_breedte vormen krijgen seeds; rond/rechthoek blijven vrij invoerbaar.

CREATE TABLE IF NOT EXISTS maatwerk_vorm_maten (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vorm_code TEXT NOT NULL REFERENCES maatwerk_vormen(code) ON DELETE CASCADE,
  lengte_cm INTEGER,
  breedte_cm INTEGER,
  diameter_cm INTEGER,
  volgorde INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT maatwerk_vorm_maten_dimensies_check CHECK (
    -- Precies één: óf (lengte+breedte) óf (diameter). Geen ovale-diameter
    -- combinatie; als ovaal ooit twee diameters nodig heeft gebruiken we
    -- gewoon lengte/breedte met afmeting_type='lengte_breedte'.
    (lengte_cm IS NOT NULL AND breedte_cm IS NOT NULL AND diameter_cm IS NULL) OR
    (lengte_cm IS NULL AND breedte_cm IS NULL AND diameter_cm IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS maatwerk_vorm_maten_vorm_idx ON maatwerk_vorm_maten(vorm_code, volgorde);

ALTER TABLE maatwerk_vorm_maten ENABLE ROW LEVEL SECURITY;
CREATE POLICY maatwerk_vorm_maten_all ON maatwerk_vorm_maten FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE maatwerk_vorm_maten IS
  'Vaste maat-suggesties per vorm. UI toont deze als chips. Voor vormen met '
  'kan_afwijkende_maten=true mag de gebruiker er ook eigen waarden naast invullen.';

-- UNIQUE constraint voor idempotente seeds (ON CONFLICT DO NOTHING heeft een
-- unique key nodig). NULLs tellen niet mee in PG-uniqueness, dus we gebruiken
-- COALESCE op de drie dimensie-kolommen.
CREATE UNIQUE INDEX IF NOT EXISTS maatwerk_vorm_maten_uniek_idx
  ON maatwerk_vorm_maten (
    vorm_code,
    COALESCE(lengte_cm, 0),
    COALESCE(breedte_cm, 0),
    COALESCE(diameter_cm, 0)
  );

-- Standaard-set: 160x230, 200x290, 240x340, 300x400 voor alle 6 aparte vormen.
-- Rechthoek/rond blijven vrij invoerbaar (geen chips).
WITH lb_vormen AS (
  SELECT code FROM maatwerk_vormen
  WHERE code IN ('ovaal','organisch_a','organisch_b_sp','pebble','ellips','afgeronde_hoeken')
),
maten(lengte, breedte, volgorde) AS (
  VALUES (230, 160, 1), (290, 200, 2), (340, 240, 3), (400, 300, 4)
)
INSERT INTO maatwerk_vorm_maten (vorm_code, lengte_cm, breedte_cm, volgorde)
SELECT v.code, m.lengte, m.breedte, m.volgorde
FROM lb_vormen v CROSS JOIN maten m
ON CONFLICT DO NOTHING;

-- Geen diameter-seeds: cloud/rond worden niet via deze flow geleverd.
