-- Migratie 551: voeg o.orderdatum toe aan snijplanning_overzicht
--
-- Nodig voor de planning-tab: toont de besteldatum per orderregel naast
-- de afleverdatum en verzendweek, zodat de snijder de orderleeftijd kan zien.

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
    sp.lengte_cm::numeric + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm, sp.lengte_cm, sp.breedte_cm, k.standaard_breedte_cm) AS placed_lengte_cm,
    sp.breedte_cm::numeric + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm, sp.lengte_cm, sp.breedte_cm, k.standaard_breedte_cm) AS placed_breedte_cm,
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
   FROM snijplannen sp
     JOIN order_regels oreg ON oreg.id = sp.order_regel_id
     JOIN orders o ON o.id = oreg.order_id
     JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
     LEFT JOIN producten p ON p.artikelnr = oreg.artikelnr
     LEFT JOIN rollen r ON r.id = sp.rol_id
     LEFT JOIN kwaliteiten k ON k.code = COALESCE(r.kwaliteit_code, oreg.maatwerk_kwaliteit_code, p.kwaliteit_code)
  WHERE o.status <> 'Geannuleerd'::order_status;
