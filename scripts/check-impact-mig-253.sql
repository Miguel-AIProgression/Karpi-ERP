-- Impact-check vóór mig 253: welke recente orderregels gebruiken nu een
-- m²-fallback (route 2/3/4) waar het product zelf NIET maatwerk is én een
-- eigen `producten.verkoopprijs > 0` heeft? Voor die regels gaat mig 253 de
-- prijs flippen naar de eigen verkoopprijs.
--
-- Run dit BEFORE mig 253 toe te passen. Twee output-blokken:
--   1. Per artikel: aantal regels + huidige vs. eigen prijs + verschil
--   2. Top-bron-verdeling (sanity check: hoeveel orderregels lopen nu via
--      welke route?)
--
-- Geen schrijfwerk, alleen SELECT — veilig op productie.

------------------------------------------------------------------------
-- Blok 1: per artikel verschil tussen huidige fallback en eigen prijs
------------------------------------------------------------------------
WITH recente_artikelen AS (
  SELECT DISTINCT
         orr.artikelnr,
         d.prijslijst_nr,
         p.verkoopprijs AS eigen_verkoopprijs,
         p.omschrijving,
         p.karpi_code
    FROM order_regels orr
    JOIN orders     o ON o.id = orr.order_id
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
    JOIN producten  p ON p.artikelnr = orr.artikelnr
   WHERE o.aangemaakt_op >= now() - interval '90 days'
     AND p.verkoopprijs IS NOT NULL
     AND p.verkoopprijs > 0
     AND p.lengte_cm   IS NOT NULL
     AND p.breedte_cm  IS NOT NULL
     -- niet-maatwerk producten (zelfde patroon als route 3 in mig 191):
     AND upper(coalesce(p.omschrijving,'')) NOT LIKE '%MAATWERK%'
     AND upper(coalesce(p.karpi_code,''))   NOT LIKE '%MAATWERK%'
),
met_resolver AS (
  SELECT ra.*,
         bereken_orderregel_prijs(ra.artikelnr, ra.prijslijst_nr) AS resultaat
    FROM recente_artikelen ra
),
verschillen AS (
  SELECT
    artikelnr,
    omschrijving,
    prijslijst_nr,
    eigen_verkoopprijs,
    (resultaat ->> 'prijs')::numeric AS huidige_prijs,
    resultaat ->> 'bron'             AS huidige_bron,
    round(eigen_verkoopprijs - (resultaat ->> 'prijs')::numeric, 2)
                                     AS verschil_eigen_min_huidig
  FROM met_resolver
  WHERE resultaat ->> 'bron' IN ('prijslijst_m2','maatwerk_artikel_m2','kwaliteit_m2')
)
SELECT
  artikelnr,
  omschrijving,
  prijslijst_nr,
  eigen_verkoopprijs,
  huidige_prijs,
  huidige_bron,
  verschil_eigen_min_huidig,
  CASE
    WHEN verschil_eigen_min_huidig > 0  THEN 'klant betaalt MEER na mig 253'
    WHEN verschil_eigen_min_huidig < 0  THEN 'klant betaalt MINDER na mig 253'
    ELSE                                     'gelijk'
  END AS richting,
  (SELECT count(*) FROM order_regels orr2
    JOIN orders o2 ON o2.id = orr2.order_id
   WHERE orr2.artikelnr = verschillen.artikelnr
     AND o2.aangemaakt_op >= now() - interval '90 days'
  ) AS regels_laatste_90d
FROM verschillen
ORDER BY ABS(verschil_eigen_min_huidig) DESC, regels_laatste_90d DESC
LIMIT 100;

------------------------------------------------------------------------
-- Blok 2: hoeveel unieke artikelen lopen per huidige bron-route (90d)?
------------------------------------------------------------------------
WITH unieke AS (
  SELECT DISTINCT orr.artikelnr, d.prijslijst_nr
    FROM order_regels orr
    JOIN orders     o ON o.id = orr.order_id
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.aangemaakt_op >= now() - interval '90 days'
)
SELECT
  (bereken_orderregel_prijs(u.artikelnr, u.prijslijst_nr) ->> 'bron') AS bron,
  count(*) AS unieke_artikel_x_prijslijst
FROM unieke u
GROUP BY 1
ORDER BY 2 DESC;
