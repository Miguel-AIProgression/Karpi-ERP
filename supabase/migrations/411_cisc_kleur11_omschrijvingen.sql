-- Mig 411: Leesbare omschrijvingen voor CISC kleur 11 artikelen
--
-- Probleem: meerdere CISCO artikelen hebben de ruwe karpi_code als omschrijving
-- (import-artefact). Hierdoor zijn bijv. de organische en rechthoekige 200x290
-- niet te onderscheiden in de order-form dropdown.
--
-- Fix: omschrijvingen aanpassen naar het bestaande patroon:
--   Rechthoek: "CISCO Kleur 11 CA: {l}x{b} cm"
--   Organisch:  "CISCO 11 CA: {l}x{b} cm ORGANISCH"
--   (Patroon van 771110033 "CISCO 11 CA: 240x340 cm ORGANISCH" gevolgd)
--
-- Maatwerk-artikel 771119998 ongewijzigd (aparte flow).

-- Rechthoekige vaste maten
UPDATE producten SET omschrijving = 'CISCO Kleur 11 CA: 80x150 cm'  WHERE artikelnr = '771110007';
UPDATE producten SET omschrijving = 'CISCO Kleur 11 CA: 130x190 cm' WHERE artikelnr = '771110008';
UPDATE producten SET omschrijving = 'CISCO Kleur 11 CA: 160x230 cm' WHERE artikelnr = '771110005';
UPDATE producten SET omschrijving = 'CISCO Kleur 11 CA: 200x290 cm' WHERE artikelnr = '771110006';
UPDATE producten SET omschrijving = 'CISCO Kleur 11 CA: 240x330 cm' WHERE artikelnr = '771110009';

-- Organische vormen (maatwerk_vorm_code = 'organisch_a')
UPDATE producten SET omschrijving = 'CISCO 11 CA: 160x230 cm ORGANISCH' WHERE artikelnr = '771110031';
UPDATE producten SET omschrijving = 'CISCO 11 CA: 200x290 cm ORGANISCH' WHERE artikelnr = '771110032';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Mig 411: CISC kleur 11 omschrijvingen bijgewerkt.';
  RAISE NOTICE '  Rechthoek: 771110005/006/007/008/009 → "CISCO Kleur 11 CA: LxB cm"';
  RAISE NOTICE '  Organisch:  771110031/032 → "CISCO 11 CA: LxB cm ORGANISCH"';
END $$;
