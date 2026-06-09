-- Mig 335: voeg bevestigd_at toe aan orders_list view
-- Zodat het orders-overzicht kan tonen of een orderbevestiging is verstuurd.

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
  -- Mig 309: EDI-leverweek-bevestiging
  o.edi_bevestigd_op,
  o.edi_gewenste_afleverdatum,
  -- Mig 322: debiteur-match-zekerheid
  o.debiteur_zeker,
  o.debiteur_match_bron,
  -- Mig 259: bundel-info — NULL voor solo-orders
  b.zending_id          AS bundel_zending_id,
  b.bundel_zending_nr,
  b.bundel_order_count,
  -- Mig 326: levertijd-signalering
  o.levertijd_wijziging_te_bevestigen_sinds,
  -- Mig 335: orderbevestiging-status voor overzichtstabel
  o.bevestigd_at
FROM orders o
LEFT JOIN debiteuren d         ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN bundel_per_order b   ON b.order_id    = o.id;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Joint klant_naam uit debiteuren. '
  'Sinds mig 244: lever_type. Sinds mig 259: bundel-info. Sinds mig 309: '
  'edi_bevestigd_op + edi_gewenste_afleverdatum. Sinds mig 322: debiteur_zeker '
  '+ debiteur_match_bron. Sinds mig 326: levertijd_wijziging_te_bevestigen_sinds. '
  'Sinds mig 335: bevestigd_at voor bevestigingsstatus in overzicht.';

NOTIFY pgrst, 'reload schema';
