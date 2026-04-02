-- Migratie 016: View die producten verrijkt met rollentelling
-- Voor rolproducten willen we het aantal rollen en totale m2/waarde zien

CREATE OR REPLACE VIEW producten_overzicht AS
SELECT
  p.*,
  COALESCE(r.aantal_rollen, 0)::INTEGER AS aantal_rollen,
  COALESCE(r.totaal_oppervlak_m2, 0) AS totaal_oppervlak_m2,
  COALESCE(r.totaal_waarde, 0) AS totaal_waarde_rollen
FROM producten p
LEFT JOIN (
  SELECT
    artikelnr,
    COUNT(*)::INTEGER AS aantal_rollen,
    SUM(oppervlak_m2) AS totaal_oppervlak_m2,
    SUM(waarde) AS totaal_waarde
  FROM rollen
  WHERE status = 'beschikbaar'
  GROUP BY artikelnr
) r ON r.artikelnr = p.artikelnr;
