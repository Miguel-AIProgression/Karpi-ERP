-- Migratie 353: DROPSHIP-KLEIN en DROPSHIP-GROOT pseudo-producten
--
-- Dropshipments = Karpi levert direct bij de eindklant (afwijkend afleveradres).
-- De operator voegt handmatig de juiste dropshipment-kostenregel toe aan de order.
--
-- Twee varianten op basis van tapijt-breedte:
--   DROPSHIP-KLEIN  → tapijt t/m 200 cm   = € 27,50
--   DROPSHIP-GROOT  → tapijt vanaf 200 cm  = € 47,50
--
-- Beide zijn admin-pseudo (is_pseudo=TRUE): geen voorraad, geen allocatie,
-- geen snijplanning, niet pickbaar — puur een kostenregel op de factuur.
-- Gedrag identiek aan VERZEND/BUNDELKORTING (mig 265, mig 272).
--
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING + UPDATE alleen bij is_pseudo=FALSE.

INSERT INTO producten (artikelnr, omschrijving, product_type, actief)
VALUES
  ('DROPSHIP-KLEIN', 'Dropshipment (tapijt t/m 200 cm)',   'overig', true),
  ('DROPSHIP-GROOT', 'Dropshipment (tapijt vanaf 200 cm)', 'overig', true)
ON CONFLICT (artikelnr) DO NOTHING;

UPDATE producten
   SET verkoopprijs = 27.50
 WHERE artikelnr = 'DROPSHIP-KLEIN'
   AND (verkoopprijs IS NULL OR verkoopprijs <> 27.50);

UPDATE producten
   SET verkoopprijs = 47.50
 WHERE artikelnr = 'DROPSHIP-GROOT'
   AND (verkoopprijs IS NULL OR verkoopprijs <> 47.50);

UPDATE producten
   SET is_pseudo = TRUE
 WHERE artikelnr IN ('DROPSHIP-KLEIN', 'DROPSHIP-GROOT')
   AND is_pseudo IS DISTINCT FROM TRUE;

DO $$
DECLARE
  v_klein NUMERIC;
  v_groot NUMERIC;
BEGIN
  SELECT verkoopprijs INTO v_klein FROM producten WHERE artikelnr = 'DROPSHIP-KLEIN';
  SELECT verkoopprijs INTO v_groot FROM producten WHERE artikelnr = 'DROPSHIP-GROOT';
  RAISE NOTICE 'Mig 353: DROPSHIP-KLEIN=€%, DROPSHIP-GROOT=€% (is_pseudo=TRUE).', v_klein, v_groot;
END $$;
