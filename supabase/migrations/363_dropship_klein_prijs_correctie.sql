-- Migratie 363: DROPSHIP-KLEIN prijs corrigeren van € 27,50 naar € 35,00
-- Foutje bij invoer (mig 353): prijs was € 27,50, moet € 35,00 zijn.
-- Grens blijft tot 200 cm; boven 200 cm blijft DROPSHIP-GROOT op € 47,50.

UPDATE producten
   SET verkoopprijs = 35.00,
       omschrijving = 'Dropshipment (tapijt tot 200 cm)'
 WHERE artikelnr = 'DROPSHIP-KLEIN'
   AND (verkoopprijs IS NULL OR verkoopprijs <> 35.00);

DO $$
DECLARE
  v_klein NUMERIC;
BEGIN
  SELECT verkoopprijs INTO v_klein FROM producten WHERE artikelnr = 'DROPSHIP-KLEIN';
  RAISE NOTICE 'Mig 363: DROPSHIP-KLEIN=€% (was €27,50).', v_klein;
END $$;
