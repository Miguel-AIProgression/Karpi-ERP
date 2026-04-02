-- Migratie 015: product_type kolom toevoegen + maatwerk placeholders verwijderen
-- Onderscheid tussen vaste maten (CA:NNNxNNN) en rolproducten (BREED)

-- Stap 1: Kolom toevoegen
ALTER TABLE producten ADD COLUMN IF NOT EXISTS product_type TEXT DEFAULT 'vast';

-- Stap 2: product_type afleiden uit omschrijving
-- Rolproducten: omschrijving bevat "BREED" (bijv. "400 BREED")
UPDATE producten
SET product_type = 'rol'
WHERE omschrijving ILIKE '%breed%'
   OR karpi_code ILIKE '%BREED%';

-- Vaste maten: omschrijving bevat "CA:" patroon (bijv. "CA:200x300")
UPDATE producten
SET product_type = 'vast'
WHERE omschrijving ILIKE '%CA:%'
  AND product_type != 'rol';

-- Producten die noch vast noch rol zijn → 'overig'
UPDATE producten
SET product_type = 'overig'
WHERE omschrijving NOT ILIKE '%CA:%'
  AND omschrijving NOT ILIKE '%breed%'
  AND karpi_code NOT ILIKE '%breed%';

-- Stap 3: Maatwerk placeholders verwijderen (karpi_code bevat MAATWERK)
-- Eerst ALLE tabellen met FK naar producten opruimen:

-- 3a: prijslijst_regels
DELETE FROM prijslijst_regels
WHERE artikelnr IN (SELECT artikelnr FROM producten WHERE karpi_code ILIKE '%MAATWERK%');

-- 3b: rollen
DELETE FROM rollen
WHERE artikelnr IN (SELECT artikelnr FROM producten WHERE karpi_code ILIKE '%MAATWERK%');

-- 3c: klant_artikelnummers
DELETE FROM klant_artikelnummers
WHERE artikelnr IN (SELECT artikelnr FROM producten WHERE karpi_code ILIKE '%MAATWERK%');

-- 3d: order_regels (nullable FK, zet op NULL)
UPDATE order_regels
SET artikelnr = NULL
WHERE artikelnr IN (SELECT artikelnr FROM producten WHERE karpi_code ILIKE '%MAATWERK%');

-- 3e: zending_regels
UPDATE zending_regels
SET artikelnr = NULL
WHERE artikelnr IN (SELECT artikelnr FROM producten WHERE karpi_code ILIKE '%MAATWERK%');

-- 3f: samples
DELETE FROM samples
WHERE artikelnr IN (SELECT artikelnr FROM producten WHERE karpi_code ILIKE '%MAATWERK%');

-- 3g: inkooporder_regels
DELETE FROM inkooporder_regels
WHERE artikelnr IN (SELECT artikelnr FROM producten WHERE karpi_code ILIKE '%MAATWERK%');

-- Nu de maatwerk placeholders verwijderen
DELETE FROM producten WHERE karpi_code ILIKE '%MAATWERK%';

-- Stap 4: Comment voor documentatie
COMMENT ON COLUMN producten.product_type IS 'vast = vaste afmeting (CA:NNNxNNN), rol = van rol gesneden (BREED), overig = niet geclassificeerd';
