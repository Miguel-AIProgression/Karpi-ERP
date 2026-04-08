-- Migration 035: Uitgebreide maatwerk detectie
-- Fix: detecteer ook artikelnummers met "MAATWERK" erin (bijv. GALA53MAATWERK)
-- en parse afmetingen uit de omschrijving

-- 1. Mark order_regels als maatwerk waar artikelnr 'MAATWERK' bevat
UPDATE order_regels
SET is_maatwerk = true
WHERE (
  artikelnr ILIKE '%MAATWERK%'
  OR artikelnr ILIKE '%BREED%'
)
AND is_maatwerk = false;

-- 2. Parse afmetingen uit omschrijving voor maatwerk items
-- Patronen: "ca: 160cm RND" → rond, Ø160
--           "200x290" → rechthoek 200x290
--           "XX160230" → 160x230
--           "Ø200" → rond, Ø200

-- 2a. Rond met "RND" in omschrijving + getal voor cm
-- Pattern: "NNNcm RND" of "XXNNNRND"
UPDATE order_regels
SET
  maatwerk_vorm = 'rond',
  maatwerk_lengte_cm = parsed.diameter,
  maatwerk_breedte_cm = parsed.diameter
FROM (
  SELECT
    oreg.id,
    -- Try to extract number before 'cm' or 'RND'
    COALESCE(
      -- Pattern: "ca: 160cm" or "ca:160cm"
      (regexp_match(oreg.omschrijving, '(?:ca[:\s]*\s*)(\d+)\s*cm', 'i'))[1]::NUMERIC,
      -- Pattern: "XX160RND" (digits before RND)
      (regexp_match(oreg.omschrijving, '(\d{2,4})RND', 'i'))[1]::NUMERIC,
      -- Pattern: "Ø200" or "ø200"
      (regexp_match(oreg.omschrijving, '[Øø](\d+)', 'i'))[1]::NUMERIC
    ) as diameter
  FROM order_regels oreg
  WHERE oreg.is_maatwerk = true
    AND oreg.maatwerk_vorm IS NULL
    AND (oreg.omschrijving ILIKE '%RND%' OR oreg.omschrijving ILIKE '%ROND%' OR oreg.omschrijving ILIKE '%Ø%')
) parsed
WHERE order_regels.id = parsed.id
  AND parsed.diameter IS NOT NULL;

-- 2b. Rechthoek met NxN patroon
-- Pattern: "200x290", "200X290", "XX160230" (XX + breedte + lengte)
UPDATE order_regels
SET
  maatwerk_vorm = 'rechthoek',
  maatwerk_breedte_cm = parsed.breedte,
  maatwerk_lengte_cm = parsed.lengte
FROM (
  SELECT
    oreg.id,
    COALESCE(
      -- Pattern: "NNNxNNN" or "NNNxNNN"
      (regexp_match(oreg.omschrijving, '(\d{2,4})\s*[xX×]\s*(\d{2,4})'))[1]::NUMERIC,
      -- Pattern in karpi_code: "XX" + 3-digit breedte + 3-digit lengte
      (regexp_match(COALESCE(oreg.karpi_code, oreg.artikelnr), 'XX(\d{3})(\d{3})'))[1]::NUMERIC
    ) as breedte,
    COALESCE(
      (regexp_match(oreg.omschrijving, '(\d{2,4})\s*[xX×]\s*(\d{2,4})'))[2]::NUMERIC,
      (regexp_match(COALESCE(oreg.karpi_code, oreg.artikelnr), 'XX(\d{3})(\d{3})'))[2]::NUMERIC
    ) as lengte
  FROM order_regels oreg
  WHERE oreg.is_maatwerk = true
    AND oreg.maatwerk_vorm IS NULL
    AND oreg.omschrijving !~* 'RND|ROND|Ø'
) parsed
WHERE order_regels.id = parsed.id
  AND parsed.breedte IS NOT NULL
  AND parsed.lengte IS NOT NULL;

-- 3. Auto-create snijplannen voor nieuw gedetecteerde maatwerk items
INSERT INTO snijplannen (snijplan_nr, order_regel_id, lengte_cm, breedte_cm, status, opmerkingen)
SELECT
  volgend_nummer('SNIJ'),
  oreg.id,
  COALESCE(oreg.maatwerk_lengte_cm, 100)::INTEGER,
  COALESCE(oreg.maatwerk_breedte_cm, 100)::INTEGER,
  'Wacht'::snijplan_status,
  'Auto-aangemaakt: ' || oreg.artikelnr
FROM order_regels oreg
LEFT JOIN snijplannen sp ON sp.order_regel_id = oreg.id
WHERE oreg.is_maatwerk = true
  AND sp.id IS NULL;

-- 4. Update bestaande snijplannen met nu-bekende afmetingen
UPDATE snijplannen sp
SET
  lengte_cm = COALESCE(oreg.maatwerk_lengte_cm, sp.lengte_cm)::INTEGER,
  breedte_cm = COALESCE(oreg.maatwerk_breedte_cm, sp.breedte_cm)::INTEGER
FROM order_regels oreg
WHERE sp.order_regel_id = oreg.id
  AND oreg.maatwerk_lengte_cm IS NOT NULL
  AND (sp.lengte_cm = 100 OR sp.breedte_cm = 100);  -- only update defaults

-- 5. Update auto-detectie trigger om ook MAATWERK artikelnrs te herkennen
CREATE OR REPLACE FUNCTION auto_markeer_maatwerk()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if product is rol type OR artikelnr contains MAATWERK/BREED
  IF EXISTS (
    SELECT 1 FROM producten
    WHERE artikelnr = NEW.artikelnr
      AND product_type = 'rol'
  ) OR NEW.artikelnr ILIKE '%MAATWERK%' OR NEW.artikelnr ILIKE '%BREED%' THEN
    NEW.is_maatwerk := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
