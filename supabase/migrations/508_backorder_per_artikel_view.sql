-- Migratie 508: view backorder_per_artikel
-- Aggregeert openstaande backorders per product (afmeting), zodat de
-- Producten-pagina in één oogopslag toont hoeveel stuks per maat er op
-- klanten wachten (orderaantal − te_leveren = backorder).
--
-- Gefilterd op: backorder > 0 AND order niet Verzonden/Geannuleerd.
-- Admin-pseudo-artikelen (is_pseudo=TRUE) worden uitgesloten — die hebben
-- geen fysieke leverbaarheid en tellen niet als backorder.

CREATE OR REPLACE VIEW backorder_per_artikel AS
SELECT
  orr.artikelnr,
  p.karpi_code,
  p.kwaliteit_code,
  p.kleur_code,
  p.omschrijving,
  p.lengte_cm,
  p.breedte_cm,
  p.vrije_voorraad,
  p.besteld_inkoop,
  SUM(orr.backorder)::integer   AS totaal_backorder,
  SUM(orr.te_leveren)::integer  AS totaal_te_leveren,
  COUNT(DISTINCT o.id)::integer AS aantal_orders
FROM order_regels orr
JOIN orders o ON o.id = orr.order_id
JOIN producten p ON p.artikelnr = orr.artikelnr
WHERE orr.backorder > 0
  AND o.status NOT IN ('Verzonden', 'Geannuleerd')
  AND orr.artikelnr IS NOT NULL
  AND COALESCE(p.is_pseudo, FALSE) = FALSE
GROUP BY
  orr.artikelnr,
  p.karpi_code,
  p.kwaliteit_code,
  p.kleur_code,
  p.omschrijving,
  p.lengte_cm,
  p.breedte_cm,
  p.vrije_voorraad,
  p.besteld_inkoop;

COMMENT ON VIEW backorder_per_artikel IS
  'Backorders per product-afmeting: SUM(order_regels.backorder) over open orders '
  '(exclusief Verzonden/Geannuleerd). Admin-pseudo-artikelen uitgesloten. '
  'Voedt de Backorders-tab op de Producten-pagina (mig 508).';

NOTIFY pgrst, 'reload schema';
