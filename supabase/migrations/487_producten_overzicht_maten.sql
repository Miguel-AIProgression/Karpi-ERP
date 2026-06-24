-- Mig 487: producten_overzicht view uitgebreid met lengte_cm/breedte_cm
--
-- De productenlijst (frontend fetchProducten) sorteerde binnen een kleur-
-- groep puur alfabetisch op omschrijving-tekst, zonder begrip van vorm of
-- afmeting -- "OMBR ..." (nieuw artikel, geen "E") sorteerde daardoor
-- vóór alle bestaande "OMBRE ..." artikelen, en een 040x040 stond niet
-- vóór een 250x400. Frontend krijgt nu lengte_cm/breedte_cm aangeleverd
-- om zelf op vorm-groep + oppervlak te sorteren (kwaliteit-kleuren-uitvouw.tsx).
--
-- CREATE OR REPLACE VIEW staat alleen toe kolommen aan het EINDE toe te
-- voegen (geen herordening/verwijdering) -- daarom hier achteraan.

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
    p.maatwerk_vorm_code,
    p.lengte_cm,
    p.breedte_cm
   FROM producten p
     LEFT JOIN ( SELECT rollen.artikelnr,
            count(*)::integer AS aantal_rollen,
            sum(rollen.oppervlak_m2) AS totaal_oppervlak_m2,
            sum(rollen.waarde) AS totaal_waarde_rollen
           FROM rollen
          GROUP BY rollen.artikelnr) r ON r.artikelnr = p.artikelnr;
