-- Mig 414: contour-producten corrigeren + spook-artikel deactiveren.
--
-- BEVINDINGEN (nav Basta-check 2026-06-17):
--
--   490680007  VERR68XX340240  "VERR68XX340240" (fout: karpi_code als omschrijving)
--              → bestaat in Basta, is de ECHTE contour 340x240
--              → omschrijving moet worden "VERNON Kleur 68 CA: 340x240 Contour"
--              → maatwerk_vorm_code moet 'contour' worden
--
--   490680003  VERR68XX240340  "VERNON 68 ca:240x340 cm CONTOUR"
--              → bestaat NIET in Basta (spook-artikel, auto-aangemaakt ergens)
--              → geen order_regels, geen prijslijst_regels, geen inkooporder_regels
--              → deactiveren (actief=false)
--
-- CONVENTIE (Marjolein, 2026-06-17): contour-vormen hebben altijd de LENGTE eerst
-- in de karpi_code (340x240 ipv 240x340) om ze te onderscheiden van de standaard
-- rechthoekige maat. Dit is bewust anders dan de normale BxL-volgorde.
--
-- GENERIEKE BACKFILL: alle producten met "Contour" in de omschrijving krijgen
-- maatwerk_vorm_code='contour' (mig 388 voegde de vorm toe maar backfillde niet).

------------------------------------------------------------------------
-- 1. Herstel 490680007: juiste omschrijving
------------------------------------------------------------------------
UPDATE producten
SET omschrijving = 'VERNON Kleur 68 CA: 340x240 Contour'
WHERE artikelnr = '490680007'
  AND omschrijving = 'VERR68XX340240';

------------------------------------------------------------------------
-- 2. Deactiveer spook-artikel 490680003
------------------------------------------------------------------------
UPDATE producten
SET actief = false
WHERE artikelnr = '490680003';

------------------------------------------------------------------------
-- 3. Backfill maatwerk_vorm_code='contour' voor alle producten
--    met "Contour" in de omschrijving (vast + staaltje)
------------------------------------------------------------------------
UPDATE producten
SET maatwerk_vorm_code = 'contour'
WHERE product_type IN ('vast', 'staaltje')
  AND maatwerk_vorm_code IS NULL
  AND upper(coalesce(omschrijving, '')) LIKE '%CONTOUR%';

------------------------------------------------------------------------
-- 4. Rapport
------------------------------------------------------------------------
DO $$
DECLARE
  v_contour    INTEGER;
  v_oms_null   INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_contour
  FROM producten WHERE maatwerk_vorm_code = 'contour';

  SELECT COUNT(*) INTO v_oms_null
  FROM producten
  WHERE product_type IN ('vast', 'staaltje') AND omschrijving IS NULL AND actief = true;

  RAISE NOTICE 'Mig 414: % producten maatwerk_vorm_code=''contour''', v_contour;
  RAISE NOTICE 'Mig 414: % actieve vast/staaltje met omschrijving=NULL (corrigeer via update_voorraad.py)', v_oms_null;
END $$;
