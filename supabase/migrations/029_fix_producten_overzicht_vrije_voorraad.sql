-- 029_fix_producten_overzicht_vrije_voorraad.sql
--
-- Probleem: producten_overzicht view berekende vrije_voorraad als
--   voorraad - backorder + besteld_inkoop
-- maar miste de aftrek van gereserveerd. Dit werd niet aangepast
-- toen het reserveringssysteem (migratie 020) werd toegevoegd.
--
-- Fix: gebruik p.vrije_voorraad rechtstreeks uit de producten tabel.
-- De producten tabel wordt correct bijgehouden door de trigger
-- herbereken_product_reservering() met formule:
--   vrije_voorraad = voorraad - gereserveerd - backorder + besteld_inkoop

CREATE OR REPLACE VIEW public.producten_overzicht AS
SELECT
  p.artikelnr,
  p.karpi_code,
  p.omschrijving,
  p.kwaliteit_code,
  p.kleur_code,
  p.zoeksleutel,
  p.voorraad,
  p.backorder,
  p.gereserveerd,
  p.besteld_inkoop,
  p.vrije_voorraad,
  p.verkoopprijs,
  p.inkoopprijs,
  p.actief,
  p.product_type,
  p.locatie,
  p.gewicht_kg,
  COALESCE(r.aantal_rollen, 0)       AS aantal_rollen,
  COALESCE(r.totaal_oppervlak_m2, 0) AS totaal_oppervlak_m2,
  COALESCE(r.totaal_waarde_rollen, 0) AS totaal_waarde_rollen
FROM producten p
LEFT JOIN (
  SELECT
    artikelnr,
    COUNT(*)            AS aantal_rollen,
    SUM(oppervlak_m2)   AS totaal_oppervlak_m2,
    SUM(waarde)         AS totaal_waarde_rollen
  FROM rollen
  WHERE status != 'verkocht'
  GROUP BY artikelnr
) r ON r.artikelnr = p.artikelnr;
