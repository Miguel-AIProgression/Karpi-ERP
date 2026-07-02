-- Migratie 564: herstel combi_levering_status — mig 563 herbouwde de view
-- vanaf de pre-555/556-body en liet daarmee twee al-gefixte bugs terugkeren:
--   (1) 'In pickronde'/'Deels verzonden' telden weer mee in het groep-subtotaal
--       (mig 555-fix weg) — een achterblijver toonde "drempel gehaald" terwijl
--       zijn maat al vertrokken was;
--   (2) NULL verzend_drempel gold weer als "geen drempel = altijd gehaald"
--       (mig 556-fix weg) — feature stil buiten werking voor die klanten.
-- Deze body = mig 556-semantiek + de mig 563-kolommen (aantal_orders/order_ids).
-- Nieuw t.o.v. 556 (audit 02-07): 'Concept' en alleen_productie uitgesloten —
-- een onbevestigde Concept-order (mig 540-542) mag het groepssubtotaal niet
-- vullen en de groep niet blokkeren; Basta-orders (ADR-0029) hebben geen
-- RugFlow-prijzen en verzenden buiten RugFlow om.

CREATE OR REPLACE VIEW combi_levering_status AS
WITH leden AS (
  SELECT
    o.id                                                               AS order_id,
    o.debiteur_nr,
    _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land) AS adres_norm,
    COALESCE(op.alle_regels_pickbaar, FALSE)                          AS alle_regels_pickbaar,
    combi_levering_orderregel_subtotaal(o.id)                         AS subtotaal
  FROM orders o
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  LEFT JOIN order_pickbaarheid op ON op.order_id = o.id
 WHERE o.status NOT IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden', 'Concept')
   AND o.combi_levering_override = FALSE
   AND COALESCE(o.alleen_productie, FALSE) = FALSE
   AND d.combi_levering = TRUE
   AND NOT is_dropship_order(o.id)
),
groep AS (
  SELECT
    debiteur_nr,
    adres_norm,
    SUM(subtotaal)                        AS groep_subtotaal,
    bool_and(alle_regels_pickbaar)        AS alle_leden_pickbaar,
    array_agg(order_id ORDER BY order_id) AS order_ids,
    count(*)::INTEGER                     AS aantal_orders
  FROM leden
  GROUP BY debiteur_nr, adres_norm
)
SELECT
  l.order_id,
  g.groep_subtotaal,
  d.verzend_drempel,
  d.gratis_verzending,
  g.alle_leden_pickbaar,
  (
    NOT d.gratis_verzending
    AND (
      g.groep_subtotaal < COALESCE(d.verzend_drempel, 500)
      OR NOT g.alle_leden_pickbaar
    )
  ) AS wacht_op_combi_levering,
  g.aantal_orders,
  g.order_ids
FROM leden l
JOIN groep g ON g.debiteur_nr = l.debiteur_nr AND g.adres_norm = l.adres_norm
JOIN debiteuren d ON d.debiteur_nr = l.debiteur_nr;

COMMENT ON VIEW combi_levering_status IS
  'Mig 551/555/556/563/564 (ADR-0039/0040): per order, alleen voor klanten met '
  'combi_levering=TRUE en niet-overruled/niet-dropshipment/nog-niet-gestarte, '
  'bevestigde (non-Concept), niet-alleen_productie orders: '
  'wacht_op_combi_levering=TRUE zolang de (debiteur x adres-norm)-groep de '
  'vrachtvrije-drempel (NULL -> 500, = frontend SHIPPING_THRESHOLD) niet haalt, '
  'OF de drempel haalt maar niet alle leden pickbaar zijn. '
  'aantal_orders/order_ids (mig 563) voeden de groeps-badge. '
  'Mig 564: herstel van de mig 563-regressie (555/556-fixes terug) + Concept/'
  'alleen_productie-uitsluiting.';

NOTIFY pgrst, 'reload schema';
