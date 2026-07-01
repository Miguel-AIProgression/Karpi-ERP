-- Migratie 548: manco-regel blijft in orderregel_pickbaarheid (is_pickbaar=false)
-- i.p.v. volledig uitgesloten — fix voor "achterstallige order onvindbaar in
-- Pick & Ship, alleen via zoeken" (Miguel, 2026-07-01, ORD-2026-0382).
--
-- Bug
-- ---
-- Mig 518 sloot een orderregel met een open manco (`pick_backorder_sinds NOT
-- NULL`) volledig uit `orderregel_pickbaarheid` (WHERE ... AND
-- pick_backorder_sinds IS NULL). Voor een order waarvan ALLE (niet-pseudo)
-- regels manco zijn — bv. een 1-regelige order — betekent dat: NUL rijen in
-- `orderregel_pickbaarheid` voor die order. `order_pickbaarheid` (mig
-- 386/476/479/521) is een GROUP BY bovenop die view — zonder brondata geen
-- groep, dus ook GEEN RIJ voor die order. Mig 521's eigen "actieve zending
-- altijd zichtbaar"-override (`OR EXISTS(...status IN (Gepland,Picken))`)
-- kán daardoor nooit uitgevoerd worden voor zo'n order — de override zit IN
-- de rij die nooit ontstaat. Gevolg in `fetchPickShipOrders`
-- (frontend/src/modules/magazijn/queries/pickbaarheid.ts): `orderPickbaarheid
-- .get(order_id)` is `undefined` → order hard uitgesloten, ongeacht een
-- lopende pickronde — zowel gestart (In pickronde) als niet-gestart.
--
-- Gevonden via ORD-2026-0382: 1 regel, manco tijdens een eerdere pickronde,
-- een nieuwe (deel)zending in status 'Picken' liep nog — de order was
-- volledig onvindbaar in Pick & Ship (ook niet onder "Afronden").
--
-- Fix
-- ---
-- De regel blijft voortaan gewoon in `orderregel_pickbaarheid` staan (rij niet
-- meer uitgesloten), maar met `is_pickbaar = false` (nieuwe eerste CASE-tak) —
-- functioneel hetzelfde resultaat voor `start_pickronden`'s
-- `AND orp.is_pickbaar`-filter (een manco-regel werd en wordt nooit in een
-- nieuwe zending meegenomen), maar `order_pickbaarheid` krijgt nu altijd een
-- rij zolang de order ≥1 niet-pseudo regel heeft — mig 521's manco-guard ÉN
-- actieve-zending-override werken daardoor weer zoals bedoeld, ook als alle
-- regels manco zijn. `wacht_op` krijgt een eigen `'manco'`-waarde zodat de
-- regel-detailrij op Pick & Ship niet langer een kaal "—" toont.
--
-- `order_pickbaarheid` zelf (mig 521) hoeft niet te wijzigen — leest gewoon de
-- (nu completere) rijen uit deze view. Verder byte-identiek aan mig 518.

CREATE OR REPLACE VIEW orderregel_pickbaarheid AS
WITH maatwerk_aggr AS (
  SELECT sp.order_regel_id,
    count(*) AS totaal_stuks,
    count(*) FILTER (WHERE sp.status = 'Ingepakt'::snijplan_status) AS pickbaar_stuks,
    min(sp.locatie) FILTER (WHERE sp.status = 'Ingepakt'::snijplan_status) AS locatie,
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
  WHERE sp.status <> 'Geannuleerd'::snijplan_status
  GROUP BY sp.order_regel_id
), voorraad_claim AS (
  SELECT rsv.order_regel_id,
    SUM(rsv.aantal) AS totaal_geclaimd
   FROM order_reserveringen rsv
  WHERE rsv.bron = 'voorraad'::text AND rsv.status = 'actief'::text
  GROUP BY rsv.order_regel_id
), rol_locatie_per_artikel AS (
  SELECT DISTINCT ON (r.artikelnr) r.artikelnr,
    ml.code
   FROM rollen r
     JOIN magazijn_locaties ml ON ml.id = r.locatie_id
  WHERE r.status = 'beschikbaar'::text AND r.locatie_id IS NOT NULL
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
        WHEN oreg.pick_backorder_sinds IS NOT NULL THEN false
        WHEN oreg.is_maatwerk THEN COALESCE(ma.pickbaar_stuks = ma.totaal_stuks AND ma.totaal_stuks > 0, false)
        ELSE COALESCE(vc.totaal_geclaimd >= oreg.te_leveren, false)
    END AS is_pickbaar,
    CASE
        WHEN oreg.is_maatwerk THEN 'snijplan'::text
        WHEN rl.code IS NOT NULL THEN 'rol'::text
        WHEN p.locatie IS NOT NULL THEN 'producten_default'::text
        ELSE NULL::text
    END AS bron,
    CASE
        WHEN oreg.is_maatwerk THEN ma.locatie
        ELSE COALESCE(rl.code, p.locatie)
    END AS fysieke_locatie,
    CASE
        WHEN oreg.pick_backorder_sinds IS NOT NULL THEN 'manco'::text
        WHEN oreg.is_maatwerk THEN
        CASE
            WHEN ma.totaal_stuks IS NULL OR ma.slechtste_rang IS NULL THEN 'snijden'::text
            WHEN ma.slechtste_rang <= 2 THEN 'snijden'::text
            WHEN ma.slechtste_rang <= 4 THEN 'confectie'::text
            WHEN ma.slechtste_rang <= 6 THEN 'inpak'::text
            ELSE NULL::text
        END
        ELSE
        CASE
            WHEN COALESCE(vc.totaal_geclaimd, 0) < COALESCE(oreg.te_leveren, 0) THEN 'inkoop'::text
            ELSE NULL::text
        END
    END AS wacht_op,
  oreg.gewicht_kg
 FROM order_regels oreg
   JOIN orders o ON o.id = oreg.order_id
   LEFT JOIN producten p ON p.artikelnr = oreg.artikelnr
   LEFT JOIN maatwerk_aggr ma ON ma.order_regel_id = oreg.id
   LEFT JOIN voorraad_claim vc ON vc.order_regel_id = oreg.id
   LEFT JOIN rol_locatie_per_artikel rl ON rl.artikelnr = oreg.artikelnr
WHERE (o.status <> ALL (ARRAY['Verzonden'::order_status, 'Geannuleerd'::order_status]))
  AND NOT is_admin_pseudo(oreg.artikelnr);

COMMENT ON VIEW orderregel_pickbaarheid IS
  'Per orderregel: is_pickbaar, fysieke_locatie, bron, wacht_op, gewicht_kg. '
  'Mig 386: single source + admin-pseudo. Mig 498: voorraad-claim op SUM(aantal). '
  'Mig 518: introduceerde manco (pick_backorder_sinds), sloot de rij toen '
  'volledig uit. Mig 548: rij blijft bestaan, is_pickbaar=false + '
  'wacht_op=''manco'' — anders verliest order_pickbaarheid (mig 521) zijn '
  'enige rij zodra ALLE regels van een order manco zijn, en werkt de '
  'actieve-zending-override daar niet meer (ORD-2026-0382).';

NOTIFY pgrst, 'reload schema';
