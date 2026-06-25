-- Migratie 511: backorder_per_artikel — vorm + leverancier
--
-- Voegt twee kolommen toe:
--   maatwerk_vorm_code  → voor sortering (NULL = rechthoekig, anders rond/ovaal/…)
--   leverancier_naam    → naam van de leverancier via producten.leverancier_id

DROP VIEW IF EXISTS backorder_per_artikel;

CREATE VIEW backorder_per_artikel AS
SELECT
  p.artikelnr,
  p.karpi_code,
  p.kwaliteit_code,
  p.kleur_code,
  p.omschrijving,
  p.lengte_cm,
  p.breedte_cm,
  p.maatwerk_vorm_code,
  p.voorraad,
  p.vrije_voorraad,
  p.besteld_inkoop,
  p.backorder                                                              AS totaal_backorder,
  COALESCE(SUM(orr.te_leveren) FILTER (
    WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
  ), 0)::integer                                                           AS totaal_te_leveren,
  COALESCE(COUNT(DISTINCT o.id) FILTER (
    WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
  ), 0)::integer                                                           AS aantal_orders,
  l.naam                                                                   AS leverancier_naam
FROM producten p
LEFT JOIN order_regels orr ON orr.artikelnr = p.artikelnr
LEFT JOIN orders o          ON o.id = orr.order_id
LEFT JOIN leveranciers l    ON l.id = p.leverancier_id
WHERE p.backorder > 0
  AND COALESCE(p.is_pseudo, FALSE) = FALSE
  AND COALESCE(p.product_type, 'overig') != 'rol'
GROUP BY
  p.artikelnr, p.karpi_code, p.kwaliteit_code, p.kleur_code,
  p.omschrijving, p.lengte_cm, p.breedte_cm, p.maatwerk_vorm_code,
  p.voorraad, p.vrije_voorraad, p.besteld_inkoop, p.backorder,
  l.naam;

COMMENT ON VIEW backorder_per_artikel IS
  'Backorders per product-afmeting (vaste maten + stalen, geen rol-artikelen). '
  'Bevat maatwerk_vorm_code (NULL = rechthoekig) voor sortering en '
  'leverancier_naam voor weergave. Voedt /backorders (mig 511).';

NOTIFY pgrst, 'reload schema';
