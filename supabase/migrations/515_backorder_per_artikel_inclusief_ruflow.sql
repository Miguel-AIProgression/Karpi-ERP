-- mig 515: backorder_per_artikel toont nu ook RugFlow-orders met ongedekte vraag
--
-- Probleem: de view filterde alleen op p.backorder > 0 (legacy geïmporteerd veld).
-- Nieuwe RugFlow-orders hebben altijd order_regels.backorder = 0, waardoor artikelen
-- als LORENZO 339230034 (5 open orders, vrije_voorraad=0) volledig onzichtbaar waren
-- op de backorder-pagina ondanks een echte, ongedekte vraag.
--
-- Nieuwe logica: product is in backorder als:
--   (a) p.backorder > 0  — legacy geïmporteerde backorder
--   OF
--   (b) vrije_voorraad <= 0 EN er zijn open order_regels met te_leveren > 0
--       (proxy: voorraad is uitgeput én klant wacht op levering)

DROP VIEW IF EXISTS backorder_per_artikel;

CREATE VIEW backorder_per_artikel AS
WITH open_te_leveren AS (
  -- Open, nog-niet-geleverde vraag per artikelnr (niet Verzonden/Geannuleerd)
  SELECT
    orr.artikelnr,
    SUM(orr.te_leveren)::integer        AS totaal_te_leveren,
    COUNT(DISTINCT o.id)::integer       AS aantal_orders
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.te_leveren > 0
    AND o.status NOT IN ('Verzonden', 'Geannuleerd')
  GROUP BY orr.artikelnr
)
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
  p.backorder                                       AS totaal_backorder,
  COALESCE(otl.totaal_te_leveren, 0)::integer      AS totaal_te_leveren,
  COALESCE(otl.aantal_orders,     0)::integer      AS aantal_orders,
  COALESCE(lk.naam, lp.naam)                       AS leverancier_naam
FROM producten p
LEFT JOIN open_te_leveren otl ON otl.artikelnr = p.artikelnr
LEFT JOIN kwaliteiten kw      ON kw.code = p.kwaliteit_code
LEFT JOIN leveranciers lk     ON lk.id = kw.leverancier_id
LEFT JOIN leveranciers lp     ON lp.id = p.leverancier_id
WHERE (
    p.backorder > 0                                    -- (a) legacy backorder
    OR (
      p.vrije_voorraad <= 0                            -- (b) geen vrije voorraad
      AND otl.artikelnr IS NOT NULL                    --     EN open ongeleverde vraag
    )
  )
  AND COALESCE(p.is_pseudo, FALSE) = FALSE
  AND COALESCE(p.product_type, 'overig') <> 'rol';
