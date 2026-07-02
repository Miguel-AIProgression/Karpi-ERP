-- Mig 575: orders_list toont de wacht-reden achter Combi-levering
--
-- Aanleiding: de bestaande badge (CombiLeveringBadge, mig 569) toont alleen
-- DAT een order op Combi-levering wacht (status 'Wacht op combi-levering' +
-- badge "Combi-levering (N)"), niet WAAROM. combi_levering_status kent twee
-- onafhankelijke blokkades — (a) groep-subtotaal onder de vrachtvrije-drempel
-- en (b) niet alle leden van de groep zijn pickbaar (bv. een maatwerk-stuk
-- van een groepsgenoot staat nog in productie) — en de werkvloer kon dat
-- verschil nergens zien. Concreet gemeld: groepen ver boven de drempel
-- (€300+) werden als "gelockt"/kapot ervaren, terwijl ze gewoon op een
-- maatwerk-groepsgenoot wachtten.
--
-- Additief: drie kolommen aan het einde van orders_list (CREATE OR REPLACE
-- VIEW staat alleen toevoegen aan het eind toe, geen her-ordening) uit
-- dezelfde combi_levering_status-join die combi_levering_aantal_orders al
-- voedt (combi_levering_per_order CTE, mig 569/570).
--
-- Drempel-keuze: combi_levering_groep_subtotaal wordt RAUW (NULLABLE)
-- doorgegeven, zoals combi_levering_status.verzend_drempel zelf — de
-- COALESCE(..., 500)-fallback (zie combi_levering_status z'n eigen
-- wacht_op_combi_levering-berekening) wordt in de frontend toegepast
-- (combiWachtReden-helper), niet hier, zodat een toekomstige wijziging van
-- de fallback-waarde op één plek blijft.

CREATE OR REPLACE VIEW orders_list AS
WITH bundel_per_order AS (
    SELECT DISTINCT ON (zo.order_id) zo.order_id,
        z.id AS zending_id,
        z.zending_nr AS bundel_zending_nr,
        cnt.aantal_orders AS bundel_order_count
       FROM zending_orders zo
         JOIN zendingen z ON z.id = zo.zending_id
         JOIN LATERAL ( SELECT count(*)::integer AS aantal_orders
               FROM zending_orders zo2
              WHERE zo2.zending_id = z.id) cnt ON cnt.aantal_orders >= 2
      ORDER BY zo.order_id, (
            CASE z.status
                WHEN 'Picken'::zending_status THEN 1
                WHEN 'Klaar voor verzending'::zending_status THEN 2
                WHEN 'Onderweg'::zending_status THEN 3
                WHEN 'Afgeleverd'::zending_status THEN 4
                ELSE 5
            END), z.id
), combi_levering_per_order AS (
     SELECT cls.order_id,
        cls.aantal_orders AS combi_levering_aantal_orders,
        cls.wacht_op_combi_levering,
        ( SELECT jsonb_agg(jsonb_build_object('id', o2.id, 'order_nr', o2.order_nr) ORDER BY o2.order_nr) AS jsonb_agg
               FROM unnest(cls.order_ids) oid2(oid2)
                 JOIN orders o2 ON o2.id = oid2.oid2
              WHERE oid2.oid2 <> cls.order_id) AS combi_levering_andere_orders,
        cls.groep_subtotaal AS combi_levering_groep_subtotaal,
        cls.verzend_drempel AS combi_levering_drempel,
        cls.alle_leden_pickbaar AS combi_levering_alle_leden_pickbaar
       FROM combi_levering_status cls
      WHERE cls.aantal_orders >= 2
    )
 SELECT o.id,
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
    b.zending_id AS bundel_zending_id,
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
    cl.combi_levering_aantal_orders,
    cl.wacht_op_combi_levering,
    cl.combi_levering_andere_orders,
    cl.combi_levering_groep_subtotaal,
    cl.combi_levering_drempel,
    cl.combi_levering_alle_leden_pickbaar
   FROM orders o
     LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
     LEFT JOIN bundel_per_order b ON b.order_id = o.id
     LEFT JOIN combi_levering_per_order cl ON cl.order_id = o.id;

COMMENT ON VIEW orders_list IS 'Order-overzicht voor frontend OrdersTable. Sinds mig 544: afl_gln_ongekoppeld_sinds + afl_gln_gecontroleerd_op. Sinds mig 569: combi_levering_aantal_orders/wacht_op_combi_levering/combi_levering_andere_orders (Combi-levering-badge). Sinds mig 575: combi_levering_groep_subtotaal/combi_levering_drempel/combi_levering_alle_leden_pickbaar (wacht-reden zichtbaar op de badge, i.p.v. alleen dat de order wacht).';

NOTIFY pgrst, 'reload schema';
