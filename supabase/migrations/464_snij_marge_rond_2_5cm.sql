-- Migratie 458: vorm-marge (rond/ovaal) van 5cm naar 2,5cm.
--
-- Gebruiker bevestigt: de snijspeling voor ronde/ovale vormen mag van 5cm naar
-- 2,5cm — de exacte-rolbreedte-uitzondering (mig 463) blijft staan, want zelfs
-- met 2,5cm marge zou een 400×400 rond stuk nog 402,5cm "vereisen" op een
-- 400cm-rol zonder die uitzondering. ZO-afwerking-marge (6cm) blijft ongewijzigd.
--
-- 2,5cm is geen heel getal — stuk_snij_marge_cm() gaat daarom van INTEGER naar
-- NUMERIC. Het returntype wijzigen kan niet via CREATE OR REPLACE ("cannot
-- change return type of existing function"), dus eerst droppen. Dat blijkt
-- een harde CASCADE-afhankelijkheid te raken: snijplanning_overzicht's
-- kolomtypes (marge_cm/placed_lengte_cm/placed_breedte_cm) staan vast op het
-- moment van view-aanmaak (pg_depend, deptype 'n' — een view-rewrite-rule is
-- WEL hard gebonden aan de functie, anders dan een functie-body die een
-- andere functie bij naam aanroept) en confectie_planning_overzicht erft
-- daar weer van. Beide views (precies deze twee — geverifieerd via pg_depend,
-- geen verdere keten) moeten dus na de DROP opnieuw aangemaakt worden. De
-- twee RPC's (snijplanning_tekort_analyse, kandidaat_rollen_voor_handmatige_
-- toewijzing) hebben dat probleem niet — hun RETURNS TABLE-kolommen zijn al
-- expliciet ::INTEGER-gecast resp. ongemoeid (rol-afmetingen), dus die hoeven
-- niet opnieuw aangemaakt te worden; uiteindelijke snij-instructies worden
-- toch al afgerond naar hele cm (derive.ts: Math.round(placed_x/y_cm)).

DROP FUNCTION IF EXISTS stuk_snij_marge_cm(TEXT, TEXT, INTEGER, INTEGER, INTEGER) CASCADE;

CREATE FUNCTION stuk_snij_marge_cm(
  afwerking TEXT,
  vorm TEXT,
  lengte_cm INTEGER DEFAULT NULL,
  breedte_cm INTEGER DEFAULT NULL,
  standaard_breedte_cm INTEGER DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT GREATEST(
    CASE WHEN afwerking = 'ZO' THEN 6 ELSE 0 END,
    CASE
      WHEN standaard_breedte_cm IS NOT NULL
       AND lengte_cm IS NOT NULL AND breedte_cm IS NOT NULL
       AND LEAST(lengte_cm, breedte_cm) = standaard_breedte_cm
        THEN 0
      WHEN lower(COALESCE(vorm, '')) IN (
        'rond', 'ovaal',
        'organisch_a', 'organisch_b_sp',
        'pebble', 'ellips', 'afgeronde_hoeken'
      ) THEN 2.5
      ELSE 0
    END
  );
$$;

COMMENT ON FUNCTION stuk_snij_marge_cm(TEXT, TEXT, INTEGER, INTEGER, INTEGER) IS
  'Mig 463/458: vorm-marge (2,5cm sinds mig 464, was 5cm) wordt 0 als de korte '
  'zijde van het stuk al exact de standaard rolbreedte is. ZO-afwerking-marge '
  '(6cm) blijft altijd ongewijzigd. NUMERIC sinds mig 464 (2,5 is geen heel getal).';

-- snijplanning_overzicht opnieuw aanmaken zodat marge_cm/placed_lengte_cm/
-- placed_breedte_cm NUMERIC worden (volledige bestaande body, mig 463).
CREATE OR REPLACE VIEW snijplanning_overzicht AS
SELECT
  sp.id,
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
  COALESCE(r.kwaliteit_code, p.kwaliteit_code, oreg.maatwerk_kwaliteit_code) AS kwaliteit_code,
  COALESCE(r.kleur_code, p.kleur_code, oreg.maatwerk_kleur_code) AS kleur_code,
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
  sp.lengte_cm + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm, sp.lengte_cm, sp.breedte_cm, k.standaard_breedte_cm) AS placed_lengte_cm,
  sp.breedte_cm + stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm, sp.lengte_cm, sp.breedte_cm, k.standaard_breedte_cm) AS placed_breedte_cm,
  o.alleen_productie,
  o.oud_order_nr,
  oreg.snijden_uit_standaardmaat,
  o.lever_type,
  sp.verwacht_inkooporder_regel_id,
  o.express,
  sp.is_handmatig_toegewezen
FROM snijplannen sp
  JOIN order_regels oreg ON oreg.id = sp.order_regel_id
  JOIN orders o ON o.id = oreg.order_id
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  LEFT JOIN producten p ON p.artikelnr = oreg.artikelnr
  LEFT JOIN rollen r ON r.id = sp.rol_id
  LEFT JOIN kwaliteiten k ON k.code = COALESCE(r.kwaliteit_code, p.kwaliteit_code, oreg.maatwerk_kwaliteit_code)
WHERE o.status <> 'Geannuleerd'::order_status;

-- confectie_planning_overzicht: meegevallen door de CASCADE, exact dezelfde
-- body als vóór deze migratie teruggezet (geen functionele wijziging — dit
-- gebruikt geen van de marge-kolommen, alleen snij_lengte_cm/snij_breedte_cm).
CREATE OR REPLACE VIEW confectie_planning_overzicht AS
SELECT id AS confectie_id,
    snijplan_nr AS confectie_nr,
    scancode,
    status::text AS status,
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
  WHERE status = ANY (ARRAY['Gesneden'::snijplan_status, 'In confectie'::snijplan_status]);

NOTIFY pgrst, 'reload schema';
