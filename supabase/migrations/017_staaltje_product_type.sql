-- Migratie 017: Staaltjes herkennen op basis van oppervlakte < 1m²
-- Producten met vaste afmetingen (CA:NNNxNNN) kleiner dan 1m² worden 'staaltje'

-- Stap 1: product_type 'staaltje' toekennen aan kleine vaste maten
UPDATE producten
SET product_type = 'staaltje'
WHERE product_type = 'vast'
  AND omschrijving ~* 'CA:\s*(\d+)\s*[xX]\s*(\d+)'
  AND CAST((regexp_match(omschrijving, '(?i)CA:\s*(\d+)\s*[xX]\s*(\d+)'))[1] AS INTEGER)
    * CAST((regexp_match(omschrijving, '(?i)CA:\s*(\d+)\s*[xX]\s*(\d+)'))[2] AS INTEGER) < 10000;

-- Stap 2: Comment bijwerken
COMMENT ON COLUMN producten.product_type IS 'vast = vaste afmeting >= 1m², staaltje = vaste afmeting < 1m², rol = van rol gesneden (BREED), overig = niet geclassificeerd';
