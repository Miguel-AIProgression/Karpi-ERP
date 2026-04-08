-- Migration 038: Afwerkingscodes uitbreiden
-- Vervang oude afwerking waarden (geen/overlocked/band/blindzoom)
-- door Karpi-standaard afwerkingscodes: B, FE, LO, ON, SB, SF, VO, ZO

-- 1. Migreer bestaande waarden naar nieuwe codes
UPDATE order_regels SET maatwerk_afwerking = CASE
  WHEN maatwerk_afwerking = 'overlocked' THEN 'LO'
  WHEN maatwerk_afwerking = 'band' THEN 'B'
  WHEN maatwerk_afwerking = 'blindzoom' THEN 'ZO'
  WHEN maatwerk_afwerking = 'geen' THEN NULL
  ELSE maatwerk_afwerking
END
WHERE maatwerk_afwerking IS NOT NULL;

-- 2. Drop oude CHECK constraint en maak nieuwe aan
ALTER TABLE order_regels DROP CONSTRAINT IF EXISTS order_regels_maatwerk_afwerking_check;

ALTER TABLE order_regels ADD CONSTRAINT order_regels_maatwerk_afwerking_check
  CHECK (maatwerk_afwerking IN ('B', 'FE', 'LO', 'ON', 'SB', 'SF', 'VO', 'ZO'));

-- 3. Kolom maatwerk_band_kleur hernoemen is niet nodig;
--    B (Breedband) en SB (Smalband) gebruiken deze kolom ook.

-- 4. Update RPC's: create_order_with_lines en update_order_with_lines
--    moeten maatwerk velden uit de p_regels JSON extracten.
--    BELANGRIJK: Pas onderstaande aan op basis van je huidige RPC-definitie.
--    De INSERT INTO order_regels ... moet deze kolommen bevatten:
--
--    is_maatwerk             := COALESCE((regel->>'is_maatwerk')::BOOLEAN, false),
--    maatwerk_vorm           := regel->>'maatwerk_vorm',
--    maatwerk_lengte_cm      := (regel->>'maatwerk_lengte_cm')::NUMERIC,
--    maatwerk_breedte_cm     := (regel->>'maatwerk_breedte_cm')::NUMERIC,
--    maatwerk_afwerking      := regel->>'maatwerk_afwerking',
--    maatwerk_band_kleur     := regel->>'maatwerk_band_kleur',
--    maatwerk_instructies    := regel->>'maatwerk_instructies'
--
--    Voeg deze toe aan zowel de INSERT in create_order_with_lines
--    als de INSERT in update_order_with_lines (na het DELETE van oude regels).
