-- Migratie 451: orders_list toont express (Fase 2-vervolg op mig 450)
--
-- orders.express (mig 450) bestaat al en wordt door snijplanning_overzicht al
-- getoond. orders-overzicht (frontend OrdersTable, query fetchOrders) leest
-- echter uit de view `orders_list`, niet rechtstreeks uit `orders` — zonder
-- deze kolom toont de UI geen Express-badge. Additief, zelfde patroon als
-- mig 396 (volledige mig-396-body + 1 kolom aan het einde).

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
  -- Mig 451: express-vlag (mig 450) voor de Express-badge op orders-overzicht
  o.express
FROM orders o
LEFT JOIN debiteuren d         ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN bundel_per_order b   ON b.order_id    = o.id;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Joint klant_naam uit debiteuren. '
  'Sinds mig 244: lever_type. Sinds mig 259: bundel-info. Sinds mig 309: '
  'edi_bevestigd_op + edi_gewenste_afleverdatum. Sinds mig 322: debiteur_zeker '
  '+ debiteur_match_bron. Sinds mig 326: levertijd_wijziging_te_bevestigen_sinds. '
  'Sinds mig 335: bevestigd_at. Sinds mig 395: afl_adres_incompleet_sinds. '
  'Sinds mig 396: prijs_ontbreekt_sinds. Sinds mig 451: express.';

NOTIFY pgrst, 'reload schema';
