-- Voeg prijslijst_nr toe aan klant_omzet_ytd zodat de frontend direct kan
-- filteren zonder een aparte ID-prefetch die de URL-lengte limiet overschrijdt.
-- Nieuwe kolom moet achteraan staan (CREATE OR REPLACE vereiste).
CREATE OR REPLACE VIEW klant_omzet_ytd AS
WITH totalen AS (
  SELECT
    COALESCE(sum(orders.totaal_bedrag), 0::numeric) AS totaal_omzet_ytd,
    GREATEST(EXTRACT(month FROM CURRENT_DATE), 1::numeric) AS maanden_ytd
  FROM orders
  WHERE orderdatum >= date_trunc('year', CURRENT_DATE::timestamp with time zone)
    AND status <> 'Geannuleerd'::order_status
)
SELECT
  d.debiteur_nr,
  d.naam,
  d.status,
  d.tier,
  d.logo_path,
  d.vertegenw_code,
  v.naam AS vertegenwoordiger_naam,
  d.email_factuur,
  d.telefoon,
  d.plaats,
  COALESCE(sum(o.totaal_bedrag), 0::numeric) AS omzet_ytd,
  count(DISTINCT o.id) AS aantal_orders_ytd,
  CASE
    WHEN t.totaal_omzet_ytd > 0 THEN
      round((COALESCE(sum(o.totaal_bedrag), 0::numeric) / t.totaal_omzet_ytd) * 100::numeric, 1)
    ELSE 0::numeric
  END AS pct_van_totaal,
  round(COALESCE(sum(o.totaal_bedrag), 0::numeric) / t.maanden_ytd, 2) AS gem_per_maand,
  d.prijslijst_nr
FROM debiteuren d
CROSS JOIN totalen t
LEFT JOIN orders o ON o.debiteur_nr = d.debiteur_nr
  AND o.orderdatum >= date_trunc('year', CURRENT_DATE::timestamp with time zone)
  AND o.status <> 'Geannuleerd'::order_status
LEFT JOIN medewerkers v ON v.code = d.vertegenw_code
GROUP BY
  d.debiteur_nr, d.naam, d.status, d.tier, d.logo_path, d.vertegenw_code,
  v.naam, d.email_factuur, d.telefoon, d.plaats, d.prijslijst_nr,
  t.totaal_omzet_ytd, t.maanden_ytd;
