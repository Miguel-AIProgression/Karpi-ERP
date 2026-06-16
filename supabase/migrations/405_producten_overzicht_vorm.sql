-- Mig 405: voeg maatwerk_vorm_code toe aan producten_overzicht
-- Maakt filtering op vorm (rond/ovaal/organisch/pebble/rechthoek) mogelijk in de frontend.

CREATE OR REPLACE VIEW producten_overzicht AS
 SELECT p.artikelnr,
    p.karpi_code,
    p.ean_code,
    p.omschrijving,
    p.vervolgomschrijving,
    p.voorraad,
    p.backorder,
    p.gereserveerd,
    p.besteld_inkoop,
    p.vrije_voorraad,
    p.kwaliteit_code,
    p.kleur_code,
    p.zoeksleutel,
    p.inkoopprijs,
    p.verkoopprijs,
    p.gewicht_kg,
    p.actief,
    p.created_at,
    p.updated_at,
    p.product_type,
    p.locatie,
    COALESCE(r.aantal_rollen, 0) AS aantal_rollen,
    COALESCE(r.totaal_oppervlak_m2, 0::numeric) AS totaal_oppervlak_m2,
    COALESCE(r.totaal_waarde_rollen, 0::numeric) AS totaal_waarde_rollen,
    p.maatwerk_vorm_code
   FROM producten p
     LEFT JOIN ( SELECT rollen.artikelnr,
            count(*)::integer AS aantal_rollen,
            sum(rollen.oppervlak_m2) AS totaal_oppervlak_m2,
            sum(rollen.waarde) AS totaal_waarde_rollen
           FROM rollen
          GROUP BY rollen.artikelnr) r ON r.artikelnr = p.artikelnr;
