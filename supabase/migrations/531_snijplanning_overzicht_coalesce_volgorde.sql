-- Migratie 531: fix COALESCE-volgorde in snijplanning_overzicht
--
-- Probleem
-- --------
-- Voor ongeplaatste stukken (rol_id IS NULL) gebruikte de view:
--   COALESCE(r.kwaliteit_code, p.kwaliteit_code, oreg.maatwerk_kwaliteit_code)
-- = product-kwaliteit heeft voorrang boven maatwerk_kwaliteit_code.
--
-- Dit veroorzaakte een structureel probleem bij uitwisselbare kwaliteitsgroepen:
--   1. Klant bestelt kwaliteit A (maatwerk_kwaliteit_code = A).
--   2. Stuk wordt ingepland op rol van kwaliteit B (uitwisselbaar paar A↔B).
--   3. Wanneer groep B draait via auto-plan-groep, wordt het stuk vrijgegeven
--      (release_gepland_stukken filtert op maatwerk_kwaliteit_code = B) ✓
--   4. Na vrijgave: geen rol meer → view toont p.kwaliteit_code = A (het product).
--   5. fetchStukken('B') zoekt op kwaliteit_code = B → vindt het stuk NIET.
--   6. Stuk is wees: status='Gepland', rol_id=NULL, positie=NULL — onzichtbaar
--      voor groep B maar ook onzichtbaar voor groep A (die het stuk niet kan
--      vrijgeven want mw_kw='B' ≠ 'A').
--
-- Fix
-- ---
-- Verander de COALESCE-volgorde zodat maatwerk_kwaliteit_code voorrang krijgt
-- boven het productkwaliteit bij ongeplaatste stukken:
--   COALESCE(r.kwaliteit_code, oreg.maatwerk_kwaliteit_code, p.kwaliteit_code)
--
-- Gevolg:
--   - Geplaatst op rol: r.kwaliteit_code is non-NULL → gedrag ongewijzigd ✓
--   - Niet op rol, maatwerk_kwaliteit_code ingesteld: toont mw_kw → correct
--     groepsidentiteit voor fetchStukken en release ✓
--   - Niet op rol, maatwerk_kwaliteit_code NULL: valt terug op p.kwaliteit_code
--     → ongewijzigd gedrag voor legacy/NULL-gevallen ✓
--
-- Doorwerking
-- -----------
-- confectie_planning_overzicht leest van deze view → ook correct (maatwerk kw
-- is de juiste identiteit ook voor confectie-lanes).
-- Alle consumers van kwaliteit_code (werklijst, haalbaarheid, packer-fetchStukken)
-- profiteren automatisch.

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
    oreg.verzendweek_bron
   FROM snijplannen sp
     JOIN order_regels oreg ON oreg.id = sp.order_regel_id
     JOIN orders o ON o.id = oreg.order_id
     JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
     LEFT JOIN producten p ON p.artikelnr = oreg.artikelnr
     LEFT JOIN rollen r ON r.id = sp.rol_id
     LEFT JOIN kwaliteiten k ON k.code = COALESCE(r.kwaliteit_code, oreg.maatwerk_kwaliteit_code, p.kwaliteit_code)
  WHERE o.status <> 'Geannuleerd'::order_status;
