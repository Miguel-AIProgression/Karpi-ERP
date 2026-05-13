-- Migratie 259: orders_list view — bundel-kolommen voor accordion-UI (ADR-0016)
--
-- Voegt drie kolommen toe aan de orders_list view zodat de frontend
-- orders-tabel een accordion kan renderen waarbij orders die in dezelfde
-- zending zaten visueel als groep verschijnen. De gebruiker ziet dan dat
-- ORD-2026-2057 en ORD-2026-2058 (zelfde FACT-2026-0017, zelfde zending)
-- een bundel vormen i.p.v. losse rijen met identieke factuur-nummering.
--
-- Bundel-detectie loopt via zending_orders M2M (mig 222 canoniek). Een order
-- "hoort bij een bundel" als er een zending bestaat die ≥2 orders koppelt.
-- Voor solo-orders blijven de kolommen NULL.
--
-- Voorgestelde (nog niet gestarte) bundels uit voorgestelde_zending_bundels
-- worden bewust NIET meegenomen — die hebben hun eigen surface in Pick & Ship.
-- Bundel-zichtbaarheid in het orders-overzicht begint vanaf pickronde-start.
--
-- Patroon volgt mig 244 §6: DROP VIEW IF EXISTS + CREATE VIEW. View is dun
-- (geen materialized state); herbouw bij elke verandering aan de kolomlijst.
--
-- Idempotent.

DROP VIEW IF EXISTS orders_list;

CREATE VIEW orders_list AS
WITH bundel_per_order AS (
  -- Per order de "primaire" bundel-zending: die met ≥2 orders, voorrang aan
  -- meest-gevorderde status (Picken/Klaar voor verzending eerst, dan
  -- Onderweg/Afgeleverd, dan oudste id). Bij multi-bundel-orders (zou zeldzaam
  -- moeten zijn — multi-vervoerder bundel) wint de eerste op zending_nr.
  SELECT DISTINCT ON (zo.order_id)
    zo.order_id,
    z.id          AS zending_id,
    z.zending_nr  AS bundel_zending_nr,
    aantal_orders AS bundel_order_count
  FROM zending_orders zo
  JOIN zendingen z ON z.id = zo.zending_id
  JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS aantal_orders
      FROM zending_orders zo2
     WHERE zo2.zending_id = z.id
  ) cnt ON cnt.aantal_orders >= 2
  ORDER BY
    zo.order_id,
    -- Status-prioriteit: actief eerst, dan voltooid
    CASE z.status
      WHEN 'Picken'                  THEN 1
      WHEN 'Klaar voor verzending'   THEN 2
      WHEN 'Onderweg'                THEN 3
      WHEN 'Afgeleverd'              THEN 4
      ELSE 5
    END,
    z.id
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
  -- Mig 259: bundel-info — NULL voor solo-orders
  b.zending_id          AS bundel_zending_id,
  b.bundel_zending_nr,
  b.bundel_order_count
FROM orders o
LEFT JOIN debiteuren d         ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN bundel_per_order b   ON b.order_id    = o.id;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Joint klant_naam uit debiteuren. '
  'Sinds mig 244: lever_type voor dag-order-badge. Sinds mig 259 (ADR-0016): '
  'bundel_zending_nr + bundel_order_count zodat de UI orders die in dezelfde '
  'zending zaten als één accordion-groep kan renderen. NULL voor solo-orders.';

NOTIFY pgrst, 'reload schema';
