-- 030_producten_overzicht_lengte.sql
--
-- Voeg totaal_lengte_m toe aan producten_overzicht view.
-- Berekening: SUM(lengte_cm) / 100 per product (over alle niet-verkochte rollen).

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
  COALESCE(r.aantal_rollen, 0)                          AS aantal_rollen,
  COALESCE(r.totaal_oppervlak_m2, 0)                    AS totaal_oppervlak_m2,
  COALESCE(r.totaal_waarde_rollen, 0)                   AS totaal_waarde_rollen,
  ROUND(COALESCE(r.totaal_lengte_cm, 0) / 100.0, 2)    AS totaal_lengte_m
FROM producten p
LEFT JOIN (
  SELECT
    artikelnr,
    COUNT(*)            AS aantal_rollen,
    SUM(oppervlak_m2)   AS totaal_oppervlak_m2,
    SUM(waarde)         AS totaal_waarde_rollen,
    SUM(lengte_cm)      AS totaal_lengte_cm
  FROM rollen
  WHERE status != 'verkocht'
  GROUP BY artikelnr
) r ON r.artikelnr = p.artikelnr;
