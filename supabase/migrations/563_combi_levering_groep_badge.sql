-- Migratie 563: Combi-levering-groep zichtbaar op orders-overview + order-detail
--
-- Gebruikerseis (02-07-2026): orders die samen op de vrachtvrije-drempel wachten
-- (of 'm net gehaald hebben) moeten ook op het orders-overzicht en de order-
-- pagina zelf zichtbaar zijn als bundel — niet alleen in Pick & Ship. Bewust
-- ALLEEN voor Combi-levering (verzendkosten-drempel), niet voor de fysieke
-- zending-bundel (mig 222/orders_list.bundel_zending_nr — dat is een apart,
-- al bestaand concept met eigen badge in orders-table.tsx).
--
-- combi_levering_status (mig 551) had per order alleen een boolean/subtotaal,
-- geen groepsgrootte of -leden. Voegt twee kolommen toe aan het EIND van de
-- view (CREATE OR REPLACE VIEW-veilig — bestaande kolommen/volgorde ongewijzigd).

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
 WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
   AND o.combi_levering_override = FALSE
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
      (d.verzend_drempel IS NOT NULL AND g.groep_subtotaal < d.verzend_drempel)
      OR NOT g.alle_leden_pickbaar
    )
  ) AS wacht_op_combi_levering,
  g.aantal_orders,
  g.order_ids
FROM leden l
JOIN groep g ON g.debiteur_nr = l.debiteur_nr AND g.adres_norm = l.adres_norm
JOIN debiteuren d ON d.debiteur_nr = l.debiteur_nr;

COMMENT ON VIEW combi_levering_status IS
  'Mig 551/563 (ADR-0039/0040): per order, alleen voor klanten met '
  'combi_levering=TRUE en niet-overruled/niet-dropshipment orders: '
  'wacht_op_combi_levering=TRUE zolang de (debiteur x adres-norm)-groep de '
  'vrachtvrije-drempel niet haalt. aantal_orders/order_ids (mig 563) = '
  'groepsgrootte + leden, voedt de Combi-levering-badge op orders-overview/ '
  'order-detail (visuele koppeling, ongeacht wacht-status). Orders die niet in '
  'deze view voorkomen zijn nooit deelnemer — consumenten gebruiken LEFT JOIN.';

-- orders_list: sibling-order-nrs erbij zodra de groep >=2 leden heeft (een
-- solo-"groep" van 1 is geen bundel, geen badge nodig). jsonb i.p.v. een kaal
-- TEXT[] zodat de frontend meteen naar elke sibling-order kan linken.
CREATE OR REPLACE VIEW orders_list AS
WITH bundel_per_order AS (
  SELECT DISTINCT ON (zo.order_id)
    zo.order_id,
    z.id          AS zending_id,
    z.zending_nr  AS bundel_zending_nr,
    cnt.aantal_orders AS bundel_order_count
  FROM zending_orders zo
  JOIN zendingen z ON z.id = zo.zending_id
  JOIN LATERAL (
    SELECT count(*)::integer AS aantal_orders
    FROM zending_orders zo2
    WHERE zo2.zending_id = z.id
  ) cnt ON cnt.aantal_orders >= 2
  ORDER BY zo.order_id, (
    CASE z.status
      WHEN 'Picken'::zending_status               THEN 1
      WHEN 'Klaar voor verzending'::zending_status THEN 2
      WHEN 'Onderweg'::zending_status              THEN 3
      WHEN 'Afgeleverd'::zending_status            THEN 4
      ELSE 5
    END), z.id
),
combi_levering_per_order AS (
  SELECT
    cls.order_id,
    cls.aantal_orders           AS combi_levering_aantal_orders,
    cls.wacht_op_combi_levering,
    (
      SELECT jsonb_agg(jsonb_build_object('id', o2.id, 'order_nr', o2.order_nr) ORDER BY o2.order_nr)
        FROM unnest(cls.order_ids) AS oid2
        JOIN orders o2 ON o2.id = oid2
       WHERE oid2 <> cls.order_id
    ) AS combi_levering_andere_orders
  FROM combi_levering_status cls
  WHERE cls.aantal_orders >= 2
)
SELECT
  o.id,
  o.order_nr,
  o.oud_order_nr,
  o.debiteur_nr,
  o.klant_referentie,
  o.orderdatum,
  o.afleverdatum,
  o.status,
  o.aantal_regels,
  o.totaal_bedrag,
  o.totaal_gewicht,
  o.vertegenw_code,
  d.naam AS klant_naam,
  o.heeft_unmatched_regels,
  o.bron_systeem,
  o.bron_shop,
  o.lever_type,
  o.edi_bevestigd_op,
  o.edi_gewenste_afleverdatum,
  o.debiteur_zeker,
  o.debiteur_match_bron,
  b.zending_id          AS bundel_zending_id,
  b.bundel_zending_nr,
  b.bundel_order_count,
  o.levertijd_wijziging_te_bevestigen_sinds,
  o.bevestigd_at,
  o.afl_adres_incompleet_sinds,
  o.prijs_ontbreekt_sinds,
  o.express,
  o.manco_sinds,
  o.afl_land,
  o.afl_gln_ongekoppeld_sinds,
  o.afl_gln_gecontroleerd_op,
  -- Mig 563: Combi-levering-groep (financiële bundel, ADR-0039/0040 — los van
  -- de fysieke zending-bundel hierboven).
  cl.combi_levering_aantal_orders,
  cl.wacht_op_combi_levering,
  cl.combi_levering_andere_orders
FROM orders o
LEFT JOIN debiteuren d               ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN bundel_per_order b         ON b.order_id    = o.id
LEFT JOIN combi_levering_per_order cl ON cl.order_id   = o.id;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Sinds mig 544: afl_gln_ongekoppeld_sinds '
  '+ afl_gln_gecontroleerd_op. Sinds mig 563: combi_levering_aantal_orders/'
  'wacht_op_combi_levering/combi_levering_andere_orders (Combi-levering-badge).';

NOTIFY pgrst, 'reload schema';
