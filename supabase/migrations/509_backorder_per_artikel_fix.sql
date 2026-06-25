-- Migratie 509: herstel backorder_per_artikel view (bug mig 508)
--
-- In mig 508 was de bron order_regels.backorder — deze kolom is in de
-- praktijk altijd 0 (de allocator schrijft 0 zodra er een IO-claim is).
-- De echte bron-van-waarheid is producten.backorder, gezet door
-- herbereken_product_reservering (mig 149).
--
-- producten.backorder = stuks die GEEN IO-dekking hebben en dus besteld
-- moeten worden. 115 artikelen · 706 stuks per 24-06-2026.

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
  p.voorraad,
  p.vrije_voorraad,
  p.besteld_inkoop,
  p.backorder                                                              AS totaal_backorder,
  COALESCE(SUM(orr.te_leveren) FILTER (
    WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
  ), 0)::integer                                                           AS totaal_te_leveren,
  COALESCE(COUNT(DISTINCT o.id) FILTER (
    WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
  ), 0)::integer                                                           AS aantal_orders
FROM producten p
LEFT JOIN order_regels orr ON orr.artikelnr = p.artikelnr
LEFT JOIN orders o ON o.id = orr.order_id
WHERE p.backorder > 0
  AND COALESCE(p.is_pseudo, FALSE) = FALSE
GROUP BY
  p.artikelnr, p.karpi_code, p.kwaliteit_code, p.kleur_code,
  p.omschrijving, p.lengte_cm, p.breedte_cm, p.voorraad, p.vrije_voorraad,
  p.besteld_inkoop, p.backorder;

COMMENT ON VIEW backorder_per_artikel IS
  'Backorders per product-afmeting: producten.backorder (= stuks zonder IO-dekking) '
  'als primaire bron. Bevat ook totaal_te_leveren (open orders) en aantal_orders '
  'voor context. Voedt de Backorders-pagina (/backorders) en de Inkoop-tab.';

NOTIFY pgrst, 'reload schema';
