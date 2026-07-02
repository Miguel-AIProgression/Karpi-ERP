-- GEGENEREERD: alle public-views van de live DB (audit-remediatie Task 4.1).

CREATE OR REPLACE VIEW alle_externe_berichten AS
 SELECT 'externe_payloads'::text AS audit_tabel,
    ep.id,
    ep.kanaal,
    ep.richting,
    NULL::text AS berichttype,
    ep.bron,
    ep.externe_id,
    ep.status,
    ep.order_id,
    NULL::integer AS debiteur_nr,
    ep.payload_raw,
    ep.payload_json,
    ep.fout,
    ep.ontvangen_op AS aangemaakt_op,
    ep.verwerkt_op AS afgerond_op
   FROM externe_payloads ep
UNION ALL
 SELECT 'edi_berichten'::text AS audit_tabel,
    eb.id,
    'edi'::text AS kanaal,
        CASE eb.richting
            WHEN 'uit'::text THEN 'out'::text
            ELSE eb.richting
        END AS richting,
    eb.berichttype,
    NULL::text AS bron,
    eb.transactie_id AS externe_id,
    (eb.status)::text AS status,
    eb.order_id,
    eb.debiteur_nr,
    eb.payload_raw,
    eb.payload_parsed AS payload_json,
    eb.error_msg AS fout,
    eb.created_at AS aangemaakt_op,
    eb.sent_at AS afgerond_op
   FROM edi_berichten eb;

CREATE OR REPLACE VIEW backorder_per_artikel AS
 WITH open_te_leveren AS (
         SELECT orr.artikelnr,
            (sum(orr.te_leveren))::integer AS totaal_te_leveren,
            (count(DISTINCT o.id))::integer AS aantal_orders
           FROM (order_regels orr
             JOIN orders o ON ((o.id = orr.order_id)))
          WHERE ((orr.te_leveren > 0) AND (o.status <> ALL (ARRAY['Verzonden'::order_status, 'Geannuleerd'::order_status])))
          GROUP BY orr.artikelnr
        )
 SELECT p.artikelnr,
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
    p.backorder AS totaal_backorder,
    COALESCE(otl.totaal_te_leveren, 0) AS totaal_te_leveren,
    COALESCE(otl.aantal_orders, 0) AS aantal_orders,
    COALESCE(lk.naam, lp.naam) AS leverancier_naam
   FROM ((((producten p
     LEFT JOIN open_te_leveren otl ON ((otl.artikelnr = p.artikelnr)))
     LEFT JOIN kwaliteiten kw ON ((kw.code = p.kwaliteit_code)))
     LEFT JOIN leveranciers lk ON ((lk.id = kw.leverancier_id)))
     LEFT JOIN leveranciers lp ON ((lp.id = p.leverancier_id)))
  WHERE (((p.backorder > 0) OR ((p.vrije_voorraad <= 0) AND (otl.artikelnr IS NOT NULL))) AND (COALESCE(p.is_pseudo, false) = false) AND (COALESCE(p.product_type, 'overig'::text) <> 'rol'::text));

CREATE OR REPLACE VIEW betaalcondities_met_aantal_klanten AS
 SELECT bc.code,
    bc.naam,
    bc.dagen,
    bc.omschrijving,
    bc.actief,
    bc.created_at,
    bc.updated_at,
    COALESCE(c.aantal, 0) AS aantal_klanten
   FROM (betaalcondities bc
     LEFT JOIN ( SELECT TRIM(BOTH FROM split_part(debiteuren.betaalconditie, '-'::text, 1)) AS code,
            (count(*))::integer AS aantal
           FROM debiteuren
          WHERE ((debiteuren.betaalconditie IS NOT NULL) AND (debiteuren.betaalconditie ~ '^\s*\d+\s*-'::text))
          GROUP BY (TRIM(BOTH FROM split_part(debiteuren.betaalconditie, '-'::text, 1)))) c ON ((c.code = bc.code)));

CREATE OR REPLACE VIEW cbs_intrastat_export AS
 SELECT fr.id AS factuur_regel_id,
    f.id AS factuur_id,
    f.factuur_nr,
    f.factuurdatum,
    TRIM(BOTH FROM f.btw_nummer) AS partner_id,
    normaliseer_land(f.fact_land) AS land_bestemming,
    'NL'::text AS land_oorsprong,
    '11'::text AS transactie,
    '3'::text AS vervoerswijze,
    ''::text AS leveringsvoorwaarden,
    kw.goederencode,
    (round(COALESCE(orr.gewicht_kg, (0)::numeric)))::integer AS netto_gewicht_kg,
    0 AS bijzondere_maatstaf,
    (round(fr.bedrag))::integer AS factuurwaarde,
    'EUR'::text AS factuurvaluta,
    f.factuur_nr AS eigen_administratienummer
   FROM ((((factuur_regels fr
     JOIN facturen f ON ((f.id = fr.factuur_id)))
     LEFT JOIN order_regels orr ON ((orr.id = fr.order_regel_id)))
     LEFT JOIN producten p ON ((p.artikelnr = fr.artikelnr)))
     LEFT JOIN kwaliteiten kw ON ((kw.code = COALESCE(orr.maatwerk_kwaliteit_code, p.kwaliteit_code))))
  WHERE ((f.btw_verlegd = true) AND (NOT is_admin_pseudo(fr.artikelnr)));

CREATE OR REPLACE VIEW combi_levering_status AS
 WITH leden AS (
         SELECT o.id AS order_id,
            o.debiteur_nr,
            _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land) AS adres_norm,
            COALESCE(op.alle_regels_pickbaar, false) AS alle_regels_pickbaar,
            combi_levering_orderregel_subtotaal(o.id) AS subtotaal
           FROM ((orders o
             JOIN debiteuren d_1 ON ((d_1.debiteur_nr = o.debiteur_nr)))
             LEFT JOIN order_pickbaarheid op ON ((op.order_id = o.id)))
          WHERE ((o.status <> ALL (ARRAY['Verzonden'::order_status, 'Geannuleerd'::order_status, 'In pickronde'::order_status, 'Deels verzonden'::order_status, 'Concept'::order_status])) AND (o.combi_levering_override = false) AND (COALESCE(o.alleen_productie, false) = false) AND (d_1.combi_levering = true) AND (NOT is_dropship_order(o.id)))
        ), groep AS (
         SELECT leden.debiteur_nr,
            leden.adres_norm,
            sum(leden.subtotaal) AS groep_subtotaal,
            bool_and(leden.alle_regels_pickbaar) AS alle_leden_pickbaar,
            array_agg(leden.order_id ORDER BY leden.order_id) AS order_ids,
            (count(*))::integer AS aantal_orders
           FROM leden
          GROUP BY leden.debiteur_nr, leden.adres_norm
        )
 SELECT l.order_id,
    g.groep_subtotaal,
    d.verzend_drempel,
    d.gratis_verzending,
    g.alle_leden_pickbaar,
    ((NOT d.gratis_verzending) AND ((g.groep_subtotaal < COALESCE(d.verzend_drempel, (500)::numeric)) OR (NOT g.alle_leden_pickbaar))) AS wacht_op_combi_levering,
    g.aantal_orders,
    g.order_ids
   FROM ((leden l
     JOIN groep g ON (((g.debiteur_nr = l.debiteur_nr) AND (g.adres_norm = l.adres_norm))))
     JOIN debiteuren d ON ((d.debiteur_nr = l.debiteur_nr)));

CREATE OR REPLACE VIEW confectie_overzicht AS
 SELECT co.id,
    co.confectie_nr,
    co.scancode,
    co.type_bewerking,
    co.instructies,
    co.status,
    co.gereed_datum,
    co.gestart_op,
    co.gereed_op,
    co.medewerker,
    sp.snijplan_nr,
    sp.scancode AS snijplan_scancode,
    sp.gesneden_datum,
    oreg.maatwerk_afwerking,
    oreg.maatwerk_band_kleur,
    oreg.maatwerk_lengte_cm,
    oreg.maatwerk_breedte_cm,
    oreg.maatwerk_vorm,
    oreg.artikelnr,
    oreg.omschrijving AS product_omschrijving,
    r.kwaliteit_code,
    r.kleur_code,
    r.rolnummer,
    o.order_nr,
    o.debiteur_nr,
    d.naam AS klant_naam
   FROM (((((confectie_orders co
     LEFT JOIN snijplannen sp ON ((sp.id = co.snijplan_id)))
     LEFT JOIN order_regels oreg ON ((oreg.id = co.order_regel_id)))
     LEFT JOIN rollen r ON ((r.id = sp.rol_id)))
     LEFT JOIN orders o ON ((o.id = oreg.order_id)))
     LEFT JOIN debiteuren d ON ((d.debiteur_nr = o.debiteur_nr)));

CREATE OR REPLACE VIEW confectie_planning_forward AS
 SELECT sp.id AS snijplan_id,
    sp.snijplan_nr,
    sp.scancode,
    sp.status AS snijplan_status,
    sp.id AS confectie_id,
    sp.snijplan_nr AS confectie_nr,
    sp.status,
    at.type_bewerking,
    sp.order_regel_id,
    orr.order_id,
    o.order_nr,
    d.naam AS klant_naam,
    orr.maatwerk_afwerking,
    orr.maatwerk_band_kleur,
    orr.maatwerk_instructies,
    orr.maatwerk_vorm,
    orr.maatwerk_vorm AS vorm,
    COALESCE((sp.lengte_cm)::numeric, orr.maatwerk_lengte_cm) AS lengte_cm,
    COALESCE((sp.breedte_cm)::numeric, orr.maatwerk_breedte_cm) AS breedte_cm,
    COALESCE((sp.lengte_cm)::numeric, orr.maatwerk_lengte_cm) AS snij_lengte_cm,
    COALESCE((sp.breedte_cm)::numeric, orr.maatwerk_breedte_cm) AS snij_breedte_cm,
        CASE
            WHEN (lower(COALESCE(orr.maatwerk_vorm, ''::text)) = ANY (ARRAY['rond'::text, 'ovaal'::text])) THEN ((pi() * (GREATEST(COALESCE((sp.lengte_cm)::numeric, orr.maatwerk_lengte_cm, (0)::numeric), COALESCE((sp.breedte_cm)::numeric, orr.maatwerk_breedte_cm, (0)::numeric)))::double precision))::numeric
            ELSE ((2)::numeric * (COALESCE((sp.lengte_cm)::numeric, orr.maatwerk_lengte_cm, (0)::numeric) + COALESCE((sp.breedte_cm)::numeric, orr.maatwerk_breedte_cm, (0)::numeric)))
        END AS strekkende_meter_cm,
    r.id AS rol_id,
    r.rolnummer,
    COALESCE(r.kwaliteit_code, p.kwaliteit_code, orr.maatwerk_kwaliteit_code) AS kwaliteit_code,
    COALESCE(r.kleur_code, p.kleur_code, orr.maatwerk_kleur_code) AS kleur_code,
    COALESCE(sp.afleverdatum, o.afleverdatum) AS afleverdatum,
    sp.confectie_afgerond_op,
    sp.ingepakt_op,
    sp.locatie,
        CASE
            WHEN ((sp.status = 'Gesneden'::snijplan_status) AND (r.snijden_voltooid_op IS NOT NULL)) THEN (r.snijden_voltooid_op + ((confectie_buffer_minuten() || ' minutes'::text))::interval)
            ELSE NULL::timestamp with time zone
        END AS confectie_klaar_op,
        CASE
            WHEN (sp.status = ANY (ARRAY['Gesneden'::snijplan_status, 'In confectie'::snijplan_status])) THEN CURRENT_DATE
            WHEN (sp.status = 'Snijden'::snijplan_status) THEN CURRENT_DATE
            WHEN (sp.gesneden_datum IS NOT NULL) THEN sp.gesneden_datum
            WHEN (COALESCE(sp.afleverdatum, o.afleverdatum) IS NOT NULL) THEN ((COALESCE(sp.afleverdatum, o.afleverdatum) - '2 days'::interval))::date
            ELSE CURRENT_DATE
        END AS confectie_startdatum,
    sp.opmerkingen
   FROM ((((((snijplannen sp
     LEFT JOIN order_regels orr ON ((orr.id = sp.order_regel_id)))
     LEFT JOIN orders o ON ((o.id = orr.order_id)))
     LEFT JOIN debiteuren d ON ((d.debiteur_nr = o.debiteur_nr)))
     LEFT JOIN rollen r ON ((r.id = sp.rol_id)))
     LEFT JOIN producten p ON ((p.artikelnr = orr.artikelnr)))
     LEFT JOIN afwerking_types at ON ((at.code = orr.maatwerk_afwerking)))
  WHERE ((sp.status = ANY (ARRAY['Gepland'::snijplan_status, 'Wacht'::snijplan_status, 'Snijden'::snijplan_status, 'Gesneden'::snijplan_status, 'In confectie'::snijplan_status, 'Ingepakt'::snijplan_status])) AND (sp.rol_id IS NOT NULL) AND (NOT ((sp.status = 'Gesneden'::snijplan_status) AND (r.snijden_voltooid_op IS NOT NULL) AND ((r.snijden_voltooid_op + ((confectie_buffer_minuten() || ' minutes'::text))::interval) > now()))));

CREATE OR REPLACE VIEW confectie_planning_overzicht AS
 SELECT id AS confectie_id,
    snijplan_nr AS confectie_nr,
    scancode,
    (status)::text AS status,
    confectie_bewerking_voor_afwerking(maatwerk_afwerking) AS type_bewerking,
    order_regel_id,
    order_id,
    order_nr,
    klant_naam,
    afleverdatum,
    kwaliteit_code,
    kleur_code,
    rol_id,
    rolnummer,
    snij_lengte_cm AS lengte_cm,
    snij_breedte_cm AS breedte_cm,
    maatwerk_vorm AS vorm,
    GREATEST(COALESCE(snij_lengte_cm, 0), COALESCE(snij_breedte_cm, 0)) AS strekkende_meter_cm
   FROM snijplanning_overzicht so
  WHERE (status = ANY (ARRAY['Gesneden'::snijplan_status, 'In confectie'::snijplan_status]));

CREATE OR REPLACE VIEW dashboard_stats AS
 SELECT ( SELECT count(*) AS count
           FROM producten
          WHERE (producten.actief = true)) AS aantal_producten,
    ( SELECT count(*) AS count
           FROM rollen
          WHERE (rollen.status = 'beschikbaar'::text)) AS beschikbare_rollen,
    ( SELECT COALESCE(sum(rollen.waarde), (0)::numeric) AS "coalesce"
           FROM rollen) AS voorraadwaarde_inkoop,
    ( SELECT (COALESCE(sum(o.totaal_bedrag), (0)::numeric) - COALESCE(( SELECT sum(orl.bedrag) AS sum
                   FROM (order_regels orl
                     JOIN orders o2 ON ((o2.id = orl.order_id)))
                  WHERE ((orl.artikelnr = 'VERZEND'::text) AND (o2.status <> 'Geannuleerd'::order_status))), (0)::numeric))
           FROM orders o
          WHERE (o.status <> 'Geannuleerd'::order_status)) AS voorraadwaarde_verkoop,
        CASE
            WHEN (( SELECT sum((rollen.oppervlak_m2 * rollen.vvp_m2)) AS sum
               FROM rollen
              WHERE (rollen.status = 'beschikbaar'::text)) > (0)::numeric) THEN round((((1)::numeric - (( SELECT sum(rollen.waarde) AS sum
               FROM rollen
              WHERE (rollen.status = 'beschikbaar'::text)) / ( SELECT sum((rollen.oppervlak_m2 * rollen.vvp_m2)) AS sum
               FROM rollen
              WHERE (rollen.status = 'beschikbaar'::text)))) * (100)::numeric), 1)
            ELSE (0)::numeric
        END AS gemiddelde_marge_pct,
    ( SELECT count(*) AS count
           FROM orders
          WHERE (orders.status <> ALL (ARRAY['Verzonden'::order_status, 'Geannuleerd'::order_status]))) AS open_orders,
    ( SELECT count(*) AS count
           FROM orders
          WHERE (orders.status = 'Actie vereist'::order_status)) AS actie_vereist_orders,
    ( SELECT count(*) AS count
           FROM debiteuren
          WHERE (debiteuren.status = 'Actief'::text)) AS actieve_klanten,
    ( SELECT count(*) AS count
           FROM snijplannen
          WHERE (snijplannen.status = ANY (ARRAY['Gepland'::snijplan_status, 'In productie'::snijplan_status]))) AS in_productie,
    ( SELECT count(*) AS count
           FROM collecties
          WHERE (collecties.actief = true)) AS actieve_collecties;

CREATE OR REPLACE VIEW edi_orders_afleveradres_ongekoppeld AS
 SELECT id AS order_id,
    order_nr,
    debiteur_nr,
    afl_naam,
    afl_plaats,
    afleveradres_gln,
    status,
    orderdatum
   FROM orders o
  WHERE ((afl_gln_ongekoppeld_sinds IS NOT NULL) AND (afl_gln_gecontroleerd_op IS NULL) AND (status <> ALL (ARRAY['Verzonden'::order_status, 'Geannuleerd'::order_status, 'Concept'::order_status])));

CREATE OR REPLACE VIEW hst_verzend_monitor AS
 SELECT (count(*) FILTER (WHERE ((status = 'Verstuurd'::verzend_status) AND ((sent_at)::date = CURRENT_DATE))))::integer AS verstuurd_vandaag,
    (count(*) FILTER (WHERE (status = 'Fout'::verzend_status)))::integer AS fout_open,
    (count(*) FILTER (WHERE (status = 'Wachtrij'::verzend_status)))::integer AS wachtrij,
    (count(*) FILTER (WHERE (status = 'Bezig'::verzend_status)))::integer AS bezig,
    (COALESCE((EXTRACT(epoch FROM (now() - min(created_at) FILTER (WHERE (status = 'Wachtrij'::verzend_status)))) / (60)::numeric), (0)::numeric))::integer AS oudste_wachtrij_minuten,
    (COALESCE((EXTRACT(epoch FROM (now() - min(updated_at) FILTER (WHERE (status = 'Bezig'::verzend_status)))) / (60)::numeric), (0)::numeric))::integer AS oudste_bezig_minuten
   FROM verzend_wachtrij
  WHERE (vervoerder_code = 'hst_api'::text);

CREATE OR REPLACE VIEW inkoopgroepen_met_aantal_leden AS
 SELECT ig.code,
    ig.naam,
    ig.omschrijving,
    ig.actief,
    ig.created_at,
    ig.updated_at,
    COALESCE(c.aantal, 0) AS aantal_leden
   FROM (inkoopgroepen ig
     LEFT JOIN ( SELECT debiteuren.inkoopgroep_code,
            (count(*))::integer AS aantal
           FROM debiteuren
          WHERE (debiteuren.inkoopgroep_code IS NOT NULL)
          GROUP BY debiteuren.inkoopgroep_code) c ON ((c.inkoopgroep_code = ig.code)));

CREATE OR REPLACE VIEW inkooporder_regel_claim_zicht AS
 SELECT ir.id AS inkooporder_regel_id,
    ir.inkooporder_id,
    ir.artikelnr,
    ir.te_leveren_m,
    ir.eenheid,
    COALESCE(sum(r.aantal) FILTER (WHERE (r.status = 'actief'::text)), (0)::bigint) AS aantal_geclaimd,
    GREATEST((0)::bigint, ((floor(COALESCE(ir.te_leveren_m, (0)::numeric)))::integer - COALESCE(sum(r.aantal) FILTER (WHERE (r.status = 'actief'::text)), (0)::bigint))) AS aantal_vrij,
    count(DISTINCT r.order_regel_id) FILTER (WHERE (r.status = 'actief'::text)) AS aantal_orderregels
   FROM (inkooporder_regels ir
     LEFT JOIN order_reserveringen r ON (((r.inkooporder_regel_id = ir.id) AND (r.bron = 'inkooporder_regel'::text))))
  GROUP BY ir.id;

CREATE OR REPLACE VIEW inkooporders_overzicht AS
 SELECT o.id,
    o.inkooporder_nr,
    o.oud_inkooporder_nr,
    o.status,
    o.besteldatum,
    o.leverweek,
    o.verwacht_datum,
    o.bron,
    o.leverancier_id,
    l.naam AS leverancier_naam,
    l.woonplaats AS leverancier_woonplaats,
    count(r.id) AS aantal_regels,
    COALESCE(sum(r.besteld_m), (0)::numeric) AS totaal_besteld_m,
    COALESCE(sum(r.geleverd_m), (0)::numeric) AS totaal_geleverd_m,
    COALESCE(sum(r.te_leveren_m), (0)::numeric) AS totaal_te_leveren_m
   FROM ((inkooporders o
     LEFT JOIN leveranciers l ON ((l.id = o.leverancier_id)))
     LEFT JOIN inkooporder_regels r ON ((r.inkooporder_id = o.id)))
  GROUP BY o.id, l.naam, l.woonplaats;

CREATE OR REPLACE VIEW klant_omzet_ytd AS
 WITH totalen AS (
         SELECT COALESCE(sum(orders.totaal_bedrag), (0)::numeric) AS totaal_omzet_ytd,
            GREATEST(EXTRACT(month FROM CURRENT_DATE), (1)::numeric) AS maanden_ytd
           FROM orders
          WHERE ((orders.orderdatum >= date_trunc('year'::text, (CURRENT_DATE)::timestamp with time zone)) AND (orders.status <> 'Geannuleerd'::order_status))
        )
 SELECT d.debiteur_nr,
    d.naam,
    d.status,
    d.tier,
    d.logo_path,
    d.vertegenw_code,
    v.naam AS vertegenwoordiger_naam,
    d.email_factuur,
    d.telefoon,
    d.plaats,
    COALESCE(sum(o.totaal_bedrag), (0)::numeric) AS omzet_ytd,
    count(DISTINCT o.id) AS aantal_orders_ytd,
        CASE
            WHEN (t.totaal_omzet_ytd > (0)::numeric) THEN round(((COALESCE(sum(o.totaal_bedrag), (0)::numeric) / t.totaal_omzet_ytd) * (100)::numeric), 1)
            ELSE (0)::numeric
        END AS pct_van_totaal,
    round((COALESCE(sum(o.totaal_bedrag), (0)::numeric) / t.maanden_ytd), 2) AS gem_per_maand,
    d.prijslijst_nr
   FROM (((debiteuren d
     CROSS JOIN totalen t)
     LEFT JOIN orders o ON (((o.debiteur_nr = d.debiteur_nr) AND (o.orderdatum >= date_trunc('year'::text, (CURRENT_DATE)::timestamp with time zone)) AND (o.status <> 'Geannuleerd'::order_status))))
     LEFT JOIN medewerkers v ON ((v.code = d.vertegenw_code)))
  GROUP BY d.debiteur_nr, d.naam, d.status, d.tier, d.logo_path, d.vertegenw_code, v.naam, d.email_factuur, d.telefoon, d.plaats, d.prijslijst_nr, t.totaal_omzet_ytd, t.maanden_ytd;

CREATE OR REPLACE VIEW kwaliteit_kleur_uitwisselbaar AS
 SELECT a.kwaliteit_code AS input_kwaliteit_code,
    a.kleur_code AS input_kleur_code,
    b.kwaliteit_code AS uitwissel_kwaliteit_code,
    b.kleur_code AS uitwissel_kleur_code,
    a.basis_code,
    a.variant_nr
   FROM (kwaliteit_kleur_uitwisselgroepen a
     JOIN kwaliteit_kleur_uitwisselgroepen b ON (((a.basis_code = b.basis_code) AND (a.variant_nr = b.variant_nr))));

CREATE OR REPLACE VIEW leveranciers_overzicht AS
 SELECT l.id,
    l.leverancier_nr,
    l.naam,
    l.woonplaats,
    l.actief,
    count(DISTINCT o.id) FILTER (WHERE (o.status = ANY (ARRAY['Concept'::inkooporder_status, 'Besteld'::inkooporder_status, 'Deels ontvangen'::inkooporder_status]))) AS openstaande_orders,
    COALESCE(sum(r.te_leveren_m), (0)::numeric) AS openstaande_meters,
    min(o.verwacht_datum) FILTER (WHERE ((o.status = ANY (ARRAY['Concept'::inkooporder_status, 'Besteld'::inkooporder_status, 'Deels ontvangen'::inkooporder_status])) AND (r.te_leveren_m > (0)::numeric))) AS eerstvolgende_levering
   FROM ((leveranciers l
     LEFT JOIN inkooporders o ON ((o.leverancier_id = l.id)))
     LEFT JOIN inkooporder_regels r ON ((r.inkooporder_id = o.id)))
  GROUP BY l.id, l.leverancier_nr, l.naam, l.woonplaats, l.actief;

CREATE OR REPLACE VIEW openstaande_inkooporder_regels AS
 SELECT r.id AS regel_id,
    r.inkooporder_id,
    o.inkooporder_nr,
    o.oud_inkooporder_nr,
    o.status AS order_status,
    o.besteldatum,
    o.leverweek,
    COALESCE(r.verwacht_datum, o.verwacht_datum) AS verwacht_datum,
    l.id AS leverancier_id,
    l.leverancier_nr,
    l.naam AS leverancier_naam,
    l.woonplaats AS leverancier_woonplaats,
    r.regelnummer,
    r.artikelnr,
    r.artikel_omschrijving,
    r.karpi_code,
    p.kwaliteit_code,
    p.kleur_code,
    p.omschrijving AS product_omschrijving,
    r.inkoopprijs_eur,
    r.besteld_m,
    r.geleverd_m,
    r.te_leveren_m,
    r.status_excel,
    r.eta_bijgewerkt_door,
    r.eta_bijgewerkt_op,
    r.leverancier_notitie,
    r.verwacht_datum AS regel_verwacht_datum,
    o.verwacht_datum AS order_verwacht_datum,
    r.eenheid,
    r.snijplan_gebruikte_lengte_cm
   FROM (((inkooporder_regels r
     JOIN inkooporders o ON ((o.id = r.inkooporder_id)))
     LEFT JOIN leveranciers l ON ((l.id = o.leverancier_id)))
     LEFT JOIN producten p ON ((p.artikelnr = r.artikelnr)))
  WHERE ((r.te_leveren_m > (0)::numeric) AND (o.status = ANY (ARRAY['Concept'::inkooporder_status, 'Besteld'::inkooporder_status, 'Deels ontvangen'::inkooporder_status])));

CREATE OR REPLACE VIEW order_pickbaarheid AS
 SELECT op.order_id,
    (count(*))::integer AS totaal_regels,
    (count(*) FILTER (WHERE op.is_pickbaar))::integer AS pickbare_regels,
    (count(*) FILTER (WHERE op.is_pickbaar) = count(*)) AS alle_regels_pickbaar,
    (count(*) FILTER (WHERE op.is_pickbaar) > 0) AS heeft_pickbare_regel,
    COALESCE(d.deelleveringen_toegestaan, false) AS deelleveringen_toegestaan,
    ((((count(*) FILTER (WHERE op.is_pickbaar) = count(*)) OR (COALESCE(d.deelleveringen_toegestaan, false) AND (count(*) FILTER (WHERE op.is_pickbaar) > 0))) AND (NOT (EXISTS ( SELECT 1
           FROM order_regels orm
          WHERE ((orm.order_id = op.order_id) AND (orm.pick_backorder_sinds IS NOT NULL) AND (orm.pick_backorder_geannuleerd_op IS NULL))))) AND bool_and((o.status <> 'Wacht op combi-levering'::order_status))) OR (EXISTS ( SELECT 1
           FROM (zending_orders zo
             JOIN zendingen z ON ((z.id = zo.zending_id)))
          WHERE ((zo.order_id = op.order_id) AND (z.status = ANY (ARRAY['Gepland'::zending_status, 'Picken'::zending_status])))))) AS pick_ship_zichtbaar,
    (EXISTS ( SELECT 1
           FROM (zending_orders zo
             JOIN zendingen z ON ((z.id = zo.zending_id)))
          WHERE ((zo.order_id = op.order_id) AND (z.status = 'Gepland'::zending_status)))) AS heeft_gepland_zending
   FROM ((orderregel_pickbaarheid op
     JOIN orders o ON ((o.id = op.order_id)))
     LEFT JOIN debiteuren d ON ((d.debiteur_nr = o.debiteur_nr)))
  GROUP BY op.order_id, d.deelleveringen_toegestaan;

CREATE OR REPLACE VIEW order_regel_levertijd AS
 WITH config AS (
         SELECT COALESCE(((app_config.waarde ->> 'inkoop_buffer_weken_vast'::text))::integer, 1) AS buffer_vast
           FROM app_config
          WHERE (app_config.sleutel = 'order_config'::text)
        ), io_per_claim AS (
         SELECT r.order_regel_id,
            io.id AS inkooporder_id,
            io.inkooporder_nr,
            io.verwacht_datum,
            r.aantal
           FROM ((order_reserveringen r
             JOIN inkooporder_regels ir ON ((ir.id = r.inkooporder_regel_id)))
             JOIN inkooporders io ON ((io.id = ir.inkooporder_id)))
          WHERE ((r.status = 'actief'::text) AND (r.bron = 'inkooporder_regel'::text))
        ), claim_per_regel AS (
         SELECT r.order_regel_id,
            sum(
                CASE
                    WHEN (r.bron = 'voorraad'::text) THEN r.aantal
                    ELSE 0
                END) AS aantal_voorraad,
            sum(
                CASE
                    WHEN (r.bron = 'inkooporder_regel'::text) THEN r.aantal
                    ELSE 0
                END) AS aantal_io
           FROM order_reserveringen r
          WHERE (r.status = 'actief'::text)
          GROUP BY r.order_regel_id
        ), io_aggregaten AS (
         SELECT io_per_claim.order_regel_id,
            min(io_per_claim.verwacht_datum) AS eerste_io_datum,
            max(io_per_claim.verwacht_datum) AS laatste_io_datum,
            (array_agg(io_per_claim.inkooporder_nr ORDER BY io_per_claim.verwacht_datum, io_per_claim.inkooporder_id))[1] AS eerste_io_nr,
            (array_agg(io_per_claim.inkooporder_nr ORDER BY io_per_claim.verwacht_datum DESC NULLS LAST, io_per_claim.inkooporder_id DESC))[1] AS laatste_io_nr,
            count(DISTINCT io_per_claim.inkooporder_id) AS aantal_io_orders
           FROM io_per_claim
          GROUP BY io_per_claim.order_regel_id
        )
 SELECT oreg.id AS order_regel_id,
    oreg.order_id,
    oreg.te_leveren,
    COALESCE(oreg.is_maatwerk, false) AS is_maatwerk,
    o.lever_modus,
    COALESCE(c.aantal_voorraad, (0)::bigint) AS aantal_voorraad,
    COALESCE(c.aantal_io, (0)::bigint) AS aantal_io,
    GREATEST((0)::bigint, ((oreg.te_leveren - COALESCE(c.aantal_voorraad, (0)::bigint)) - COALESCE(c.aantal_io, (0)::bigint))) AS aantal_tekort,
    ia.eerste_io_datum,
    ia.laatste_io_datum,
    ia.eerste_io_nr,
    ia.laatste_io_nr,
    COALESCE(ia.aantal_io_orders, (0)::bigint) AS aantal_io_orders,
        CASE
            WHEN COALESCE(oreg.is_maatwerk, false) THEN NULL::text
            WHEN (GREATEST((0)::bigint, ((oreg.te_leveren - COALESCE(c.aantal_voorraad, (0)::bigint)) - COALESCE(c.aantal_io, (0)::bigint))) > 0) THEN NULL::text
            WHEN (COALESCE(c.aantal_io, (0)::bigint) = 0) THEN 'voorraad'::text
            WHEN (o.lever_modus = 'in_een_keer'::text) THEN iso_week_plus(ia.laatste_io_datum, ( SELECT config.buffer_vast
               FROM config))
            ELSE iso_week_plus(ia.eerste_io_datum, ( SELECT config.buffer_vast
               FROM config))
        END AS verwachte_leverweek,
        CASE
            WHEN COALESCE(oreg.is_maatwerk, false) THEN 'maatwerk'::text
            WHEN (GREATEST((0)::bigint, ((oreg.te_leveren - COALESCE(c.aantal_voorraad, (0)::bigint)) - COALESCE(c.aantal_io, (0)::bigint))) > 0) THEN 'wacht_op_nieuwe_inkoop'::text
            WHEN (COALESCE(c.aantal_io, (0)::bigint) > 0) THEN 'op_inkoop'::text
            ELSE 'voorraad'::text
        END AS levertijd_status
   FROM (((order_regels oreg
     JOIN orders o ON ((o.id = oreg.order_id)))
     LEFT JOIN claim_per_regel c ON ((c.order_regel_id = oreg.id)))
     LEFT JOIN io_aggregaten ia ON ((ia.order_regel_id = oreg.id)))
  WHERE ((NOT is_admin_pseudo(oreg.artikelnr)) AND (o.status <> ALL (ARRAY['Verzonden'::order_status, 'Geannuleerd'::order_status])));

CREATE OR REPLACE VIEW orderregel_pickbaarheid AS
 WITH maatwerk_aggr AS (
         SELECT sp.order_regel_id,
            count(*) AS totaal_stuks,
            count(*) FILTER (WHERE (sp.status = 'Ingepakt'::snijplan_status)) AS pickbaar_stuks,
            min(sp.locatie) FILTER (WHERE (sp.status = 'Ingepakt'::snijplan_status)) AS locatie,
            min(
                CASE sp.status
                    WHEN 'Wacht'::snijplan_status THEN 1
                    WHEN 'Gepland'::snijplan_status THEN 2
                    WHEN 'Snijden'::snijplan_status THEN 2
                    WHEN 'Gesneden'::snijplan_status THEN 3
                    WHEN 'In confectie'::snijplan_status THEN 4
                    WHEN 'In productie'::snijplan_status THEN 5
                    WHEN 'Gereed'::snijplan_status THEN 6
                    WHEN 'Ingepakt'::snijplan_status THEN 7
                    ELSE NULL::integer
                END) AS slechtste_rang
           FROM snijplannen sp
          WHERE (sp.status <> 'Geannuleerd'::snijplan_status)
          GROUP BY sp.order_regel_id
        ), voorraad_claim AS (
         SELECT rsv.order_regel_id,
            sum(rsv.aantal) AS totaal_geclaimd
           FROM order_reserveringen rsv
          WHERE ((rsv.bron = 'voorraad'::text) AND (rsv.status = 'actief'::text))
          GROUP BY rsv.order_regel_id
        ), rol_locatie_per_artikel AS (
         SELECT DISTINCT ON (r.artikelnr) r.artikelnr,
            ml.code
           FROM (rollen r
             JOIN magazijn_locaties ml ON ((ml.id = r.locatie_id)))
          WHERE ((r.status = 'beschikbaar'::text) AND (r.locatie_id IS NOT NULL))
          ORDER BY r.artikelnr, r.id
        )
 SELECT oreg.id AS order_regel_id,
    oreg.order_id,
    oreg.regelnummer,
    oreg.artikelnr,
    oreg.is_maatwerk,
    oreg.orderaantal,
    oreg.maatwerk_lengte_cm,
    oreg.maatwerk_breedte_cm,
    oreg.omschrijving,
    oreg.maatwerk_kwaliteit_code,
    oreg.maatwerk_kleur_code,
    ma.totaal_stuks,
    ma.pickbaar_stuks,
        CASE
            WHEN (oreg.pick_backorder_sinds IS NOT NULL) THEN false
            WHEN oreg.is_maatwerk THEN COALESCE(((ma.pickbaar_stuks = ma.totaal_stuks) AND (ma.totaal_stuks > 0)), false)
            ELSE COALESCE((vc.totaal_geclaimd >= oreg.te_leveren), false)
        END AS is_pickbaar,
        CASE
            WHEN oreg.is_maatwerk THEN 'snijplan'::text
            WHEN (rl.code IS NOT NULL) THEN 'rol'::text
            WHEN (p.locatie IS NOT NULL) THEN 'producten_default'::text
            ELSE NULL::text
        END AS bron,
        CASE
            WHEN oreg.is_maatwerk THEN ma.locatie
            ELSE COALESCE(rl.code, p.locatie)
        END AS fysieke_locatie,
        CASE
            WHEN (oreg.pick_backorder_sinds IS NOT NULL) THEN 'manco'::text
            WHEN oreg.is_maatwerk THEN
            CASE
                WHEN ((ma.totaal_stuks IS NULL) OR (ma.slechtste_rang IS NULL)) THEN 'snijden'::text
                WHEN (ma.slechtste_rang <= 2) THEN 'snijden'::text
                WHEN (ma.slechtste_rang <= 4) THEN 'confectie'::text
                WHEN (ma.slechtste_rang <= 6) THEN 'inpak'::text
                ELSE NULL::text
            END
            ELSE
            CASE
                WHEN (COALESCE(vc.totaal_geclaimd, (0)::bigint) < COALESCE(oreg.te_leveren, 0)) THEN 'inkoop'::text
                ELSE NULL::text
            END
        END AS wacht_op,
    oreg.gewicht_kg
   FROM (((((order_regels oreg
     JOIN orders o ON ((o.id = oreg.order_id)))
     LEFT JOIN producten p ON ((p.artikelnr = oreg.artikelnr)))
     LEFT JOIN maatwerk_aggr ma ON ((ma.order_regel_id = oreg.id)))
     LEFT JOIN voorraad_claim vc ON ((vc.order_regel_id = oreg.id)))
     LEFT JOIN rol_locatie_per_artikel rl ON ((rl.artikelnr = oreg.artikelnr)))
  WHERE ((o.status <> ALL (ARRAY['Verzonden'::order_status, 'Geannuleerd'::order_status, 'Concept'::order_status])) AND (NOT is_admin_pseudo(oreg.artikelnr)));

CREATE OR REPLACE VIEW orders_list AS
 WITH bundel_per_order AS (
         SELECT DISTINCT ON (zo.order_id) zo.order_id,
            z.id AS zending_id,
            z.zending_nr AS bundel_zending_nr,
            cnt.aantal_orders AS bundel_order_count
           FROM ((zending_orders zo
             JOIN zendingen z ON ((z.id = zo.zending_id)))
             JOIN LATERAL ( SELECT (count(*))::integer AS aantal_orders
                   FROM zending_orders zo2
                  WHERE (zo2.zending_id = z.id)) cnt ON ((cnt.aantal_orders >= 2)))
          ORDER BY zo.order_id,
                CASE z.status
                    WHEN 'Picken'::zending_status THEN 1
                    WHEN 'Klaar voor verzending'::zending_status THEN 2
                    WHEN 'Onderweg'::zending_status THEN 3
                    WHEN 'Afgeleverd'::zending_status THEN 4
                    ELSE 5
                END, z.id
        ), combi_levering_per_order AS (
         SELECT cls.order_id,
            cls.aantal_orders AS combi_levering_aantal_orders,
            cls.wacht_op_combi_levering,
            ( SELECT jsonb_agg(jsonb_build_object('id', o2.id, 'order_nr', o2.order_nr) ORDER BY o2.order_nr) AS jsonb_agg
                   FROM (unnest(cls.order_ids) oid2(oid2)
                     JOIN orders o2 ON ((o2.id = oid2.oid2)))
                  WHERE (oid2.oid2 <> cls.order_id)) AS combi_levering_andere_orders,
            cls.groep_subtotaal AS combi_levering_groep_subtotaal,
            cls.verzend_drempel AS combi_levering_drempel,
            cls.alle_leden_pickbaar AS combi_levering_alle_leden_pickbaar
           FROM combi_levering_status cls
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
        CASE
            WHEN (cl.combi_levering_aantal_orders >= 2) THEN cl.combi_levering_aantal_orders
            ELSE NULL::integer
        END AS combi_levering_aantal_orders,
        CASE
            WHEN (cl.combi_levering_aantal_orders >= 2) THEN cl.wacht_op_combi_levering
            ELSE NULL::boolean
        END AS wacht_op_combi_levering,
        CASE
            WHEN (cl.combi_levering_aantal_orders >= 2) THEN cl.combi_levering_andere_orders
            ELSE NULL::jsonb
        END AS combi_levering_andere_orders,
    cl.combi_levering_groep_subtotaal,
    cl.combi_levering_drempel,
    cl.combi_levering_alle_leden_pickbaar
   FROM (((orders o
     LEFT JOIN debiteuren d ON ((d.debiteur_nr = o.debiteur_nr)))
     LEFT JOIN bundel_per_order b ON ((b.order_id = o.id)))
     LEFT JOIN combi_levering_per_order cl ON ((cl.order_id = o.id)));

CREATE OR REPLACE VIEW orders_status_telling AS
 SELECT status,
    count(*) AS aantal
   FROM orders
  GROUP BY status;

CREATE OR REPLACE VIEW orders_zonder_vervoerder AS
 SELECT DISTINCT id AS order_id,
    order_nr,
    debiteur_nr,
    afl_land,
    afl_plaats,
    (status)::text AS status,
    normaliseer_land(afl_land) AS afl_land_norm
   FROM orders o
  WHERE ((COALESCE(afhalen, false) = false) AND (NOT alleen_productie) AND (status <> ALL (ARRAY['Geannuleerd'::order_status, 'Verzonden'::order_status, 'Concept'::order_status])) AND (EXISTS ( SELECT 1
           FROM effectieve_vervoerder_per_orderregel(o.id) e(orderregel_id, override_code, evaluator_code, evaluator_service, effectief_code, effectief_service, bron, is_locked, uitleg)
          WHERE (e.bron = 'geen'::text))));

CREATE OR REPLACE VIEW producten_overzicht AS
 SELECT p.artikelnr,
    p.karpi_code,
    p.ean_code,
    p.omschrijving,
    p.vervolgomschrijving,
    p.voorraad,
    p.backorder,
    p.gereserveerd,
    p.besteld_inkoop,
    p.vrije_voorraad,
    p.kwaliteit_code,
    p.kleur_code,
    p.zoeksleutel,
    p.inkoopprijs,
    p.verkoopprijs,
    p.gewicht_kg,
    p.actief,
    p.created_at,
    p.updated_at,
    p.product_type,
    p.locatie,
    COALESCE(r.aantal_rollen, 0) AS aantal_rollen,
    COALESCE(r.totaal_oppervlak_m2, (0)::numeric) AS totaal_oppervlak_m2,
    COALESCE(r.totaal_waarde_rollen, (0)::numeric) AS totaal_waarde_rollen,
    p.maatwerk_vorm_code,
    p.lengte_cm,
    p.breedte_cm
   FROM (producten p
     LEFT JOIN ( SELECT rollen.artikelnr,
            (count(*))::integer AS aantal_rollen,
            sum(rollen.oppervlak_m2) AS totaal_oppervlak_m2,
            sum(rollen.waarde) AS totaal_waarde_rollen
           FROM rollen
          GROUP BY rollen.artikelnr) r ON ((r.artikelnr = p.artikelnr)));

CREATE OR REPLACE VIEW productie_dashboard AS
 SELECT ( SELECT count(*) AS count
           FROM snijplannen
          WHERE (snijplannen.status = 'Wacht'::snijplan_status)) AS snijplannen_wacht,
    ( SELECT count(*) AS count
           FROM snijplannen
          WHERE (snijplannen.status = 'Gepland'::snijplan_status)) AS snijplannen_gepland,
    ( SELECT count(*) AS count
           FROM snijplannen
          WHERE (snijplannen.status = 'In productie'::snijplan_status)) AS snijplannen_in_productie,
    ( SELECT count(*) AS count
           FROM snijplannen
          WHERE (snijplannen.status = 'Gesneden'::snijplan_status)) AS snijplannen_gesneden,
    ( SELECT count(*) AS count
           FROM confectie_orders
          WHERE (confectie_orders.status = 'Wacht op materiaal'::confectie_status)) AS confectie_wacht,
    ( SELECT count(*) AS count
           FROM confectie_orders
          WHERE (confectie_orders.status = 'In productie'::confectie_status)) AS confectie_actief,
    ( SELECT count(*) AS count
           FROM confectie_orders
          WHERE (confectie_orders.status = 'Gereed'::confectie_status)) AS confectie_gereed,
    ( SELECT count(*) AS count
           FROM rollen
          WHERE (rollen.status = 'beschikbaar'::text)) AS beschikbare_rollen,
    ( SELECT count(*) AS count
           FROM rollen
          WHERE (rollen.status = 'reststuk'::text)) AS reststukken;

CREATE OR REPLACE VIEW recente_orders AS
 SELECT o.id,
    o.order_nr,
    o.oud_order_nr,
    o.orderdatum,
    o.status,
    o.totaal_bedrag,
    o.aantal_regels,
    o.klant_referentie,
    d.debiteur_nr,
    d.naam AS klant_naam
   FROM (orders o
     JOIN debiteuren d ON ((d.debiteur_nr = o.debiteur_nr)))
  ORDER BY o.orderdatum DESC
 LIMIT 50;

CREATE OR REPLACE VIEW rhenus_verzend_monitor AS
 SELECT (count(*) FILTER (WHERE ((status = 'Verstuurd'::verzend_status) AND ((sent_at)::date = CURRENT_DATE))))::integer AS verstuurd_vandaag,
    (count(*) FILTER (WHERE (status = 'Fout'::verzend_status)))::integer AS fout_open,
    (count(*) FILTER (WHERE (status = 'Wachtrij'::verzend_status)))::integer AS wachtrij,
    (count(*) FILTER (WHERE (status = 'Bezig'::verzend_status)))::integer AS bezig,
    (COALESCE((EXTRACT(epoch FROM (now() - min(created_at) FILTER (WHERE (status = 'Wachtrij'::verzend_status)))) / (60)::numeric), (0)::numeric))::integer AS oudste_wachtrij_minuten,
    (COALESCE((EXTRACT(epoch FROM (now() - min(updated_at) FILTER (WHERE (status = 'Bezig'::verzend_status)))) / (60)::numeric), (0)::numeric))::integer AS oudste_bezig_minuten
   FROM verzend_wachtrij
  WHERE (vervoerder_code = 'rhenus_sftp'::text);

CREATE OR REPLACE VIEW rollen_overzicht AS
 SELECT r.kwaliteit_code,
    r.kleur_code,
    r.zoeksleutel,
    min(r.omschrijving) AS omschrijving,
    k.omschrijving AS kwaliteit_naam,
    c.naam AS collectie_naam,
    count(*) AS aantal_rollen,
    sum(r.oppervlak_m2) AS totaal_oppervlak,
    sum(r.waarde) AS totaal_waarde,
    avg(r.vvp_m2) AS gem_vvp_m2
   FROM ((rollen r
     LEFT JOIN kwaliteiten k ON ((k.code = r.kwaliteit_code)))
     LEFT JOIN collecties c ON ((c.id = k.collectie_id)))
  WHERE (r.status = 'beschikbaar'::text)
  GROUP BY r.kwaliteit_code, r.kleur_code, r.zoeksleutel, k.omschrijving, c.naam;

CREATE OR REPLACE VIEW roltekort_per_artikel AS
 WITH tekort_stukken AS (
         SELECT orr.maatwerk_kwaliteit_code AS kwaliteit_code,
            orr.maatwerk_kleur_code AS kleur_code,
            count(sp.id) AS aantal_stukken,
            round((sum(((sp.lengte_cm)::numeric * (sp.breedte_cm)::numeric)) / 10000.0), 2) AS benodigde_m2,
            count(DISTINCT o.id) AS aantal_orders
           FROM ((snijplannen sp
             JOIN order_regels orr ON ((orr.id = sp.order_regel_id)))
             JOIN orders o ON ((o.id = orr.order_id)))
          WHERE ((sp.rol_id IS NULL) AND (sp.verwacht_inkooporder_regel_id IS NULL) AND (sp.status <> ALL (ARRAY['Gesneden'::snijplan_status, 'Geannuleerd'::snijplan_status])) AND (o.status <> ALL (ARRAY['Verzonden'::order_status, 'Geannuleerd'::order_status])) AND (orr.maatwerk_kwaliteit_code IS NOT NULL))
          GROUP BY orr.maatwerk_kwaliteit_code, orr.maatwerk_kleur_code
        ), artikel_per_groep AS (
         SELECT DISTINCT ON (p.kwaliteit_code, p.kleur_code) p.kwaliteit_code,
            p.kleur_code,
            p.artikelnr,
            p.karpi_code,
            p.omschrijving
           FROM producten p
          WHERE ((p.product_type = 'rol'::text) AND (p.kwaliteit_code IS NOT NULL) AND (p.kleur_code IS NOT NULL))
          ORDER BY p.kwaliteit_code, p.kleur_code, p.artikelnr
        )
 SELECT ts.kwaliteit_code,
    ts.kleur_code,
    ap.artikelnr,
    ap.karpi_code,
    ap.omschrijving,
    k.standaard_breedte_cm,
    (ts.aantal_stukken)::integer AS aantal_stukken,
    ts.benodigde_m2,
        CASE
            WHEN (k.standaard_breedte_cm IS NOT NULL) THEN round((ts.benodigde_m2 / ((k.standaard_breedte_cm)::numeric / 100.0)), 1)
            ELSE NULL::numeric
        END AS benodigde_meters,
    (ts.aantal_orders)::integer AS aantal_orders
   FROM ((tekort_stukken ts
     JOIN kwaliteiten k ON ((k.code = ts.kwaliteit_code)))
     LEFT JOIN artikel_per_groep ap ON (((ap.kwaliteit_code = ts.kwaliteit_code) AND (ap.kleur_code = ts.kleur_code))))
  ORDER BY ts.benodigde_m2 DESC;

CREATE OR REPLACE VIEW snijplan_sticker_data AS
 WITH base AS (
         SELECT sp.id AS snijplan_id,
            sp.snijplan_nr,
            sp.scancode,
            sp.status,
            o.id AS order_id,
            o.order_nr,
            o.afleverdatum,
            o.debiteur_nr,
            d.naam AS klant_naam,
            oreg.id AS order_regel_id,
            oreg.maatwerk_lengte_cm AS bestelde_lengte_cm,
            oreg.maatwerk_breedte_cm AS bestelde_breedte_cm,
            sp.lengte_cm AS snij_lengte_cm,
            sp.breedte_cm AS snij_breedte_cm,
            COALESCE(oreg.maatwerk_kwaliteit_code, r.kwaliteit_code, p.kwaliteit_code) AS kwaliteit_code,
            COALESCE(oreg.maatwerk_kleur_code, r.kleur_code, p.kleur_code) AS kleur_code
           FROM (((((snijplannen sp
             JOIN order_regels oreg ON ((oreg.id = sp.order_regel_id)))
             JOIN orders o ON ((o.id = oreg.order_id)))
             JOIN debiteuren d ON ((d.debiteur_nr = o.debiteur_nr)))
             LEFT JOIN producten p ON ((p.artikelnr = oreg.artikelnr)))
             LEFT JOIN rollen r ON ((r.id = sp.rol_id)))
        )
 SELECT b.snijplan_id,
    b.snijplan_nr,
    b.scancode,
    b.status,
    b.order_id,
    b.order_nr,
    b.order_regel_id,
    b.debiteur_nr,
    b.klant_naam,
    b.kwaliteit_code,
    b.kleur_code,
    COALESCE(b.bestelde_lengte_cm, (b.snij_lengte_cm)::numeric) AS lengte_cm,
    COALESCE(b.bestelde_breedte_cm, (b.snij_breedte_cm)::numeric) AS breedte_cm,
    COALESCE(resolve_klanteigen_naam(b.debiteur_nr, b.kwaliteit_code, b.kleur_code), k.omschrijving, b.kwaliteit_code) AS kwaliteit_naam,
    k.poolmateriaal,
    sticker_ean_voor_kw_kl(b.kwaliteit_code, b.kleur_code) AS ean_code,
    verzendweek_voor_datum(b.afleverdatum) AS verzendweek_iso
   FROM (base b
     LEFT JOIN kwaliteiten k ON ((k.code = b.kwaliteit_code)));

CREATE OR REPLACE VIEW snijplanning_overzicht AS
 SELECT sp.id,
    sp.snijplan_nr,
    sp.scancode,
    sp.status,
    sp.rol_id,
    sp.lengte_cm AS snij_lengte_cm,
    sp.breedte_cm AS snij_breedte_cm,
    sp.prioriteit,
    sp.planning_week,
    sp.planning_jaar,
    o.afleverdatum,
    sp.positie_x_cm,
    sp.positie_y_cm,
    sp.geroteerd,
    sp.gesneden_datum,
    sp.gesneden_op,
    sp.gesneden_door,
    r.rolnummer,
    r.breedte_cm AS rol_breedte_cm,
    r.lengte_cm AS rol_lengte_cm,
    r.oppervlak_m2 AS rol_oppervlak_m2,
    r.status AS rol_status,
    p.locatie,
    COALESCE(r.kwaliteit_code, oreg.maatwerk_kwaliteit_code, p.kwaliteit_code) AS kwaliteit_code,
    COALESCE(r.kleur_code, oreg.maatwerk_kleur_code, p.kleur_code) AS kleur_code,
    oreg.artikelnr,
    p.omschrijving AS product_omschrijving,
    p.karpi_code,
    oreg.maatwerk_vorm,
    oreg.maatwerk_lengte_cm,
    oreg.maatwerk_breedte_cm,
    oreg.maatwerk_afwerking,
    oreg.maatwerk_band_kleur,
    oreg.maatwerk_instructies,
    oreg.orderaantal,
    oreg.id AS order_regel_id,
    o.id AS order_id,
    o.order_nr,
    o.debiteur_nr,
    d.naam AS klant_naam,
    stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm, sp.lengte_cm, sp.breedte_cm, k.standaard_breedte_cm) AS marge_cm,
    sp.locatie AS snijplan_locatie,
    ((sp.lengte_cm)::numeric + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm, sp.lengte_cm, sp.breedte_cm, k.standaard_breedte_cm)) AS placed_lengte_cm,
    ((sp.breedte_cm)::numeric + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm, sp.lengte_cm, sp.breedte_cm, k.standaard_breedte_cm)) AS placed_breedte_cm,
    o.alleen_productie,
    o.oud_order_nr,
    oreg.snijden_uit_standaardmaat,
    o.lever_type,
    sp.verwacht_inkooporder_regel_id,
    o.express,
    sp.is_handmatig_toegewezen,
    o.status AS order_status,
    oreg.verzendweek,
    oreg.verzendweek_bron,
    o.orderdatum
   FROM ((((((snijplannen sp
     JOIN order_regels oreg ON ((oreg.id = sp.order_regel_id)))
     JOIN orders o ON ((o.id = oreg.order_id)))
     JOIN debiteuren d ON ((d.debiteur_nr = o.debiteur_nr)))
     LEFT JOIN producten p ON ((p.artikelnr = oreg.artikelnr)))
     LEFT JOIN rollen r ON ((r.id = sp.rol_id)))
     LEFT JOIN kwaliteiten k ON ((k.code = COALESCE(r.kwaliteit_code, oreg.maatwerk_kwaliteit_code, p.kwaliteit_code))))
  WHERE (o.status <> 'Geannuleerd'::order_status);

CREATE OR REPLACE VIEW uitwisselbaarheid_map1_diff AS
 WITH map1_paren AS (
         SELECT g1.kwaliteit_code AS input_kw,
            g1.kleur_code AS input_kl,
            g2.kwaliteit_code AS target_kw,
            g2.kleur_code AS target_kl,
            g1.basis_code,
            g1.variant_nr
           FROM (kwaliteit_kleur_uitwisselgroepen g1
             JOIN kwaliteit_kleur_uitwisselgroepen g2 ON (((g1.basis_code = g2.basis_code) AND (g1.variant_nr = g2.variant_nr) AND ((g1.kwaliteit_code <> g2.kwaliteit_code) OR (g1.kleur_code <> g2.kleur_code)))))
        )
 SELECT input_kw,
    input_kl,
    target_kw,
    target_kl,
    basis_code,
    variant_nr,
        CASE
            WHEN (NOT (EXISTS ( SELECT 1
               FROM kwaliteiten
              WHERE ((kwaliteiten.code = m.input_kw) AND (kwaliteiten.collectie_id IS NOT NULL))))) THEN 'input-kwaliteit zonder collectie_id'::text
            WHEN (NOT (EXISTS ( SELECT 1
               FROM kwaliteiten
              WHERE ((kwaliteiten.code = m.target_kw) AND (kwaliteiten.collectie_id IS NOT NULL))))) THEN 'target-kwaliteit zonder collectie_id'::text
            WHEN (NOT (EXISTS ( SELECT 1
               FROM (kwaliteiten k1
                 JOIN kwaliteiten k2 ON ((k1.collectie_id = k2.collectie_id)))
              WHERE ((k1.code = m.input_kw) AND (k2.code = m.target_kw))))) THEN 'kwaliteiten in andere collecties'::text
            WHEN (normaliseer_kleur_code(input_kl) <> normaliseer_kleur_code(target_kl)) THEN 'kleur-codes niet gelijk na normalisatie'::text
            ELSE 'onbekende reden — onderzoeken'::text
        END AS reden
   FROM map1_paren m
  WHERE (NOT (EXISTS ( SELECT 1
           FROM uitwisselbare_paren(m.input_kw, m.input_kl) up(target_kwaliteit_code, target_kleur_code, is_zelf)
          WHERE ((up.target_kwaliteit_code = m.target_kw) AND (up.target_kleur_code = normaliseer_kleur_code(m.target_kl))))));

CREATE OR REPLACE VIEW verhoek_verzend_monitor AS
 SELECT (count(*) FILTER (WHERE ((status = 'Verstuurd'::verzend_status) AND ((sent_at)::date = CURRENT_DATE))))::integer AS verstuurd_vandaag,
    (count(*) FILTER (WHERE (status = 'Fout'::verzend_status)))::integer AS fout_open,
    (count(*) FILTER (WHERE (status = 'Wachtrij'::verzend_status)))::integer AS wachtrij,
    (count(*) FILTER (WHERE (status = 'Bezig'::verzend_status)))::integer AS bezig,
    (COALESCE((EXTRACT(epoch FROM (now() - min(created_at) FILTER (WHERE (status = 'Wachtrij'::verzend_status)))) / (60)::numeric), (0)::numeric))::integer AS oudste_wachtrij_minuten,
    (COALESCE((EXTRACT(epoch FROM (now() - min(updated_at) FILTER (WHERE (status = 'Bezig'::verzend_status)))) / (60)::numeric), (0)::numeric))::integer AS oudste_bezig_minuten
   FROM verzend_wachtrij
  WHERE (vervoerder_code = 'verhoek_sftp'::text);

CREATE OR REPLACE VIEW verkoopoverzicht_export AS
 SELECT f.id AS factuur_id,
    f.factuur_nr,
    f.factuurdatum,
    f.vervaldatum,
    f.status,
    f.subtotaal AS bedrag_ex,
    f.btw_bedrag,
    f.totaal,
    d.debiteur_nr,
    d.naam AS naam1,
        CASE
            WHEN (d.inkoopgroep_code IS NOT NULL) THEN ((('('::text || d.inkoopgroep_code) || COALESCE((' '::text || ig.naam), ''::text)) || ')'::text)
            ELSE ''::text
        END AS naam2,
    d.adres,
    d.postcode,
    d.plaats,
    d.land,
    ( SELECT string_agg(DISTINCT fr.order_nr, '; '::text ORDER BY fr.order_nr) AS string_agg
           FROM factuur_regels fr
          WHERE ((fr.factuur_id = f.id) AND (fr.order_nr IS NOT NULL) AND (COALESCE(fr.artikelnr, ''::text) <> ALL (ARRAY['VERZEND'::text, 'BUNDELKORTING'::text, 'DREMPELKORTING'::text])))) AS ordernummers,
    ( SELECT string_agg(DISTINCT fr.uw_referentie, '; '::text ORDER BY fr.uw_referentie) AS string_agg
           FROM factuur_regels fr
          WHERE ((fr.factuur_id = f.id) AND (fr.uw_referentie IS NOT NULL) AND (fr.uw_referentie <> ''::text) AND (COALESCE(fr.artikelnr, ''::text) <> ALL (ARRAY['VERZEND'::text, 'BUNDELKORTING'::text, 'DREMPELKORTING'::text])))) AS klant_refs,
    (f.credit_voor_factuur_id IS NOT NULL) AS is_creditnota
   FROM ((facturen f
     JOIN debiteuren d ON ((d.debiteur_nr = f.debiteur_nr)))
     LEFT JOIN inkoopgroepen ig ON ((ig.code = d.inkoopgroep_code)));

CREATE OR REPLACE VIEW vertegenwoordigers AS
 SELECT id,
    naam,
    code,
    email,
    telefoon,
    actief
   FROM medewerkers
  WHERE ('vertegenwoordiger'::medewerker_rol = ANY (rollen));

CREATE OR REPLACE VIEW vervoerder_stats AS
 SELECT v.code,
    v.display_naam,
    v.type,
    v.actief,
    COALESCE(klanten.aantal, 0) AS aantal_klanten,
    COALESCE(zendingen_totaal.aantal, 0) AS aantal_zendingen_totaal,
    COALESCE(zendingen_maand.aantal, 0) AS aantal_zendingen_deze_maand,
    COALESCE(hst_succes.aantal, 0) AS hst_aantal_verstuurd,
    COALESCE(hst_fout.aantal, 0) AS hst_aantal_fout
   FROM (((((vervoerders v
     LEFT JOIN ( SELECT vervoerder_selectie_regels.vervoerder_code,
            (count(DISTINCT debiteur_nr.value))::integer AS aantal
           FROM vervoerder_selectie_regels,
            LATERAL jsonb_array_elements_text((vervoerder_selectie_regels.conditie -> 'debiteur_nrs'::text)) debiteur_nr(value)
          WHERE ((vervoerder_selectie_regels.actief = true) AND (vervoerder_selectie_regels.conditie ? 'debiteur_nrs'::text))
          GROUP BY vervoerder_selectie_regels.vervoerder_code) klanten ON ((klanten.vervoerder_code = v.code)))
     LEFT JOIN ( SELECT zendingen.vervoerder_code,
            (count(zendingen.id))::integer AS aantal
           FROM zendingen
          WHERE (zendingen.vervoerder_code IS NOT NULL)
          GROUP BY zendingen.vervoerder_code) zendingen_totaal ON ((zendingen_totaal.vervoerder_code = v.code)))
     LEFT JOIN ( SELECT zendingen.vervoerder_code,
            (count(zendingen.id))::integer AS aantal
           FROM zendingen
          WHERE ((zendingen.vervoerder_code IS NOT NULL) AND (zendingen.created_at >= date_trunc('month'::text, now())))
          GROUP BY zendingen.vervoerder_code) zendingen_maand ON ((zendingen_maand.vervoerder_code = v.code)))
     LEFT JOIN ( SELECT 'hst_api'::text AS code,
            (count(*))::integer AS aantal
           FROM hst_transportorders
          WHERE (hst_transportorders.status = 'Verstuurd'::hst_transportorder_status)) hst_succes ON ((hst_succes.code = v.code)))
     LEFT JOIN ( SELECT 'hst_api'::text AS code,
            (count(*))::integer AS aantal
           FROM hst_transportorders
          WHERE (hst_transportorders.status = 'Fout'::hst_transportorder_status)) hst_fout ON ((hst_fout.code = v.code)));

CREATE OR REPLACE VIEW verzend_monitor AS
 SELECT vervoerder_code,
    (count(*) FILTER (WHERE ((status = 'Verstuurd'::verzend_status) AND ((sent_at)::date = CURRENT_DATE))))::integer AS verstuurd_vandaag,
    (count(*) FILTER (WHERE (status = 'Fout'::verzend_status)))::integer AS fout_open,
    (count(*) FILTER (WHERE (status = 'Wachtrij'::verzend_status)))::integer AS wachtrij,
    (count(*) FILTER (WHERE (status = 'Bezig'::verzend_status)))::integer AS bezig,
    (COALESCE((EXTRACT(epoch FROM (now() - min(created_at) FILTER (WHERE (status = 'Wachtrij'::verzend_status)))) / (60)::numeric), (0)::numeric))::integer AS oudste_wachtrij_minuten,
    (COALESCE((EXTRACT(epoch FROM (now() - min(updated_at) FILTER (WHERE (status = 'Bezig'::verzend_status)))) / (60)::numeric), (0)::numeric))::integer AS oudste_bezig_minuten
   FROM verzend_wachtrij
  GROUP BY vervoerder_code;

CREATE OR REPLACE VIEW voorgestelde_zending_bundels AS
 WITH open_orders AS (
         SELECT o.id AS order_id,
            o.debiteur_nr,
            o.afleverdatum,
            o.afl_naam,
            o.afl_adres,
            o.afl_postcode,
            o.afl_plaats,
            o.afl_land,
            _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land) AS adres_norm,
                CASE
                    WHEN (verzendweek_voor_datum(o.afleverdatum) <= verzendweek_voor_datum(((CURRENT_DATE + '7 days'::interval))::date)) THEN verzendweek_voor_datum(CURRENT_DATE)
                    ELSE verzendweek_voor_datum(o.afleverdatum)
                END AS jaar_week,
            o.afhalen
           FROM orders o
          WHERE ((o.status <> ALL (ARRAY['Verzonden'::order_status, 'Geannuleerd'::order_status])) AND (o.afleverdatum IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
                   FROM (zending_orders zo
                     JOIN zendingen z ON ((z.id = zo.zending_id)))
                  WHERE ((zo.order_id = o.id) AND (z.status = ANY (ARRAY['Picken'::zending_status, 'Klaar voor verzending'::zending_status, 'Onderweg'::zending_status, 'Afgeleverd'::zending_status])))))))
        ), per_regel AS (
         SELECT oo.order_id,
            oo.debiteur_nr,
            oo.adres_norm,
            oo.afl_naam,
            oo.afl_postcode,
            oo.afl_plaats,
            oo.jaar_week,
                CASE
                    WHEN COALESCE(oo.afhalen, false) THEN 'AFHAAL'::text
                    ELSE COALESCE(pv.effectief_code, 'GEEN'::text)
                END AS vervoerder_code,
            pv.bron,
            ore.bedrag,
            ore.orderaantal,
            ore.artikelnr
           FROM ((open_orders oo
             CROSS JOIN LATERAL effectieve_vervoerder_per_orderregel(oo.order_id) pv(orderregel_id, override_code, evaluator_code, evaluator_service, effectief_code, effectief_service, bron, is_locked, uitleg))
             JOIN order_regels ore ON ((ore.id = pv.orderregel_id)))
          WHERE ((COALESCE(ore.artikelnr, ''::text) <> 'VERZEND'::text) AND (COALESCE(ore.orderaantal, 0) > 0))
        ), gegroepeerd AS (
         SELECT bundel_sleutel(pr.debiteur_nr, pr.adres_norm, pr.vervoerder_code, pr.jaar_week) AS sleutel,
            pr.debiteur_nr,
            pr.adres_norm,
            pr.vervoerder_code,
            pr.jaar_week,
            min(pr.afl_naam) AS afl_naam,
            min(pr.afl_postcode) AS afl_postcode,
            min(pr.afl_plaats) AS afl_plaats,
            array_agg(DISTINCT pr.order_id ORDER BY pr.order_id) AS order_ids,
            (count(DISTINCT pr.order_id))::integer AS aantal_orders,
            (COALESCE(sum(COALESCE(pr.bedrag, (0)::numeric)), (0)::numeric))::numeric(12,2) AS bundel_subtotaal_excl,
            bool_or((pr.bron = 'afhalen'::text)) AS is_afhalen
           FROM per_regel pr
          GROUP BY pr.debiteur_nr, pr.adres_norm, pr.vervoerder_code, pr.jaar_week
        )
 SELECT g.sleutel,
    g.debiteur_nr,
    d.naam AS debiteur_naam,
    g.adres_norm,
    g.afl_naam,
    g.afl_postcode,
    g.afl_plaats,
    g.vervoerder_code,
    g.is_afhalen,
    g.jaar_week,
    g.order_ids,
    g.aantal_orders,
    g.bundel_subtotaal_excl,
    d.verzendkosten AS klant_verzendkosten,
    d.verzend_drempel AS klant_drempel,
    d.gratis_verzending,
    (g.is_afhalen OR d.gratis_verzending OR ((d.verzend_drempel IS NOT NULL) AND (g.bundel_subtotaal_excl >= d.verzend_drempel))) AS drempel_gehaald,
    (
        CASE
            WHEN g.is_afhalen THEN (0)::numeric
            WHEN d.gratis_verzending THEN (0)::numeric
            WHEN ((d.verzend_drempel IS NOT NULL) AND (g.bundel_subtotaal_excl >= d.verzend_drempel)) THEN (0)::numeric
            ELSE COALESCE(d.verzendkosten, (0)::numeric)
        END)::numeric(8,2) AS te_betalen_verzendkosten,
    (
        CASE
            WHEN (g.is_afhalen OR d.gratis_verzending) THEN (0)::numeric
            WHEN (g.aantal_orders < 2) THEN (0)::numeric
            WHEN ((d.verzend_drempel IS NOT NULL) AND (g.bundel_subtotaal_excl >= d.verzend_drempel)) THEN ((g.aantal_orders)::numeric * COALESCE(d.verzendkosten, (0)::numeric))
            ELSE (((g.aantal_orders - 1))::numeric * COALESCE(d.verzendkosten, (0)::numeric))
        END)::numeric(10,2) AS bundel_besparing
   FROM (gegroepeerd g
     JOIN debiteuren d ON ((d.debiteur_nr = g.debiteur_nr)));

CREATE OR REPLACE VIEW zending_regel_sticker_data AS
 WITH base AS (
         SELECT zr.id AS zending_regel_id,
            z.id AS zending_id,
            z.zending_nr,
            o.id AS order_id,
            o.order_nr,
            o.afleverdatum,
            o.debiteur_nr,
            d.naam AS klant_naam,
            d.tapijt_sticker_bij_standaard,
            oreg.id AS order_regel_id,
            p.lengte_cm,
            p.breedte_cm,
            p.kwaliteit_code,
            p.kleur_code,
            zr.aantal
           FROM (((((zending_regels zr
             JOIN order_regels oreg ON ((oreg.id = zr.order_regel_id)))
             JOIN zendingen z ON ((z.id = zr.zending_id)))
             JOIN orders o ON ((o.id = oreg.order_id)))
             JOIN debiteuren d ON ((d.debiteur_nr = o.debiteur_nr)))
             JOIN producten p ON ((p.artikelnr = oreg.artikelnr)))
          WHERE ((COALESCE(oreg.is_maatwerk, false) = false) AND (NOT is_admin_pseudo(oreg.artikelnr)) AND (p.kwaliteit_code IS NOT NULL) AND (p.kleur_code IS NOT NULL))
        )
 SELECT b.zending_regel_id,
    b.zending_id,
    b.zending_nr,
    b.order_id,
    b.order_nr,
    b.order_regel_id,
    b.debiteur_nr,
    b.klant_naam,
    b.tapijt_sticker_bij_standaard,
    b.kwaliteit_code,
    b.kleur_code,
    b.lengte_cm,
    b.breedte_cm,
    b.aantal,
    COALESCE(resolve_klanteigen_naam(b.debiteur_nr, b.kwaliteit_code, b.kleur_code), k.omschrijving, b.kwaliteit_code) AS kwaliteit_naam,
    k.poolmateriaal,
    sticker_ean_voor_kw_kl(b.kwaliteit_code, b.kleur_code) AS ean_code,
    verzendweek_voor_datum(b.afleverdatum) AS verzendweek_iso
   FROM (base b
     LEFT JOIN kwaliteiten k ON ((k.code = b.kwaliteit_code)));
