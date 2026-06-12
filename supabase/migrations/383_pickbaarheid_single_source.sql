-- Migratie 383: pickbaarheid single-source (consolidatie-review 2026-06-12)
--
-- Probleem: de pickbaarheids-afleiding leefde op drie plekken — de view
-- orderregel_pickbaarheid (regel-niveau, mig 170/288), fetchPickShipOrders
-- (order-niveau-predicaat + VERZEND-skip ×3 in TS) en isPickbaar() in
-- start-pickrondes-button (order-niveau nóg eens). Business-rule-wijzigingen
-- moesten op meerdere plekken landen (zie de mig 309/310→316 gate-omkering)
-- en de TS-laag introduceerde eigen bugs (1000-rows-cap, juni 2026).
--
-- Deel 1 — orderregel_pickbaarheid v4 (CREATE OR REPLACE):
--   a. Generieke admin-pseudo-skip (ADR-0018): WHERE NOT is_admin_pseudo(...).
--      Vervangt de VERZEND-specifieke .neq()-skip in TS én fixt een latente
--      bug: DROPSHIP-KLEIN/-GROOT-kostenregels (mig 353, is_pseudo=TRUE)
--      krijgen geen voorraad-claims (allocator skipt pseudo, mig 273) en
--      stonden dus als is_pickbaar=false / wacht_op='inkoop' in de view,
--      waardoor dropship-orders nooit "alles pickbaar" werden.
--   b. Nieuwe kolom gewicht_kg (achteraan — OR REPLACE eist bestaande
--      kolommen op hun plek): maakt de aparte gewicht-query in TS overbodig.
--   Verder identiek aan mig 288 (incl. de 'Snijden'-rang-fix).
--
-- Deel 2 — nieuwe view order_pickbaarheid: het order-niveau-predicaat als
--   data. pick_ship_zichtbaar = (alle regels pickbaar) OR (klant staat
--   deelleveringen toe AND >= 1 regel pickbaar). Orders zonder (niet-pseudo)
--   regels hebben geen rij — afwezigheid = niets te picken. De dag-order-
--   horizon (ADR 0014) blijft bewust client-side: die hangt af van 'vandaag'.

CREATE OR REPLACE VIEW orderregel_pickbaarheid AS
WITH maatwerk_aggr AS (
  SELECT
    sp.order_regel_id,
    COUNT(*)                                          AS totaal_stuks,
    COUNT(*) FILTER (WHERE sp.status = 'Ingepakt')    AS pickbaar_stuks,
    MIN(sp.locatie) FILTER (WHERE sp.status = 'Ingepakt') AS locatie,
    MIN(
      CASE sp.status
        WHEN 'Wacht'        THEN 1
        WHEN 'Gepland'      THEN 2
        WHEN 'Snijden'      THEN 2
        WHEN 'Gesneden'     THEN 3
        WHEN 'In confectie' THEN 4
        WHEN 'In productie' THEN 5
        WHEN 'Gereed'       THEN 6
        WHEN 'Ingepakt'     THEN 7
        ELSE NULL
      END
    ) AS slechtste_rang
  FROM snijplannen sp
  WHERE sp.status <> 'Geannuleerd'
  GROUP BY sp.order_regel_id
),
voorraad_claim AS (
  SELECT
    rsv.order_regel_id,
    COUNT(*) AS aantal_actief
  FROM order_reserveringen rsv
  WHERE rsv.bron = 'voorraad' AND rsv.status = 'actief'
  GROUP BY rsv.order_regel_id
),
rol_locatie_per_artikel AS (
  SELECT DISTINCT ON (r.artikelnr)
    r.artikelnr,
    ml.code AS code
  FROM rollen r
  JOIN magazijn_locaties ml ON ml.id = r.locatie_id
  WHERE r.status = 'beschikbaar' AND r.locatie_id IS NOT NULL
  ORDER BY r.artikelnr, r.id ASC
)
SELECT
  oreg.id            AS order_regel_id,
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
    WHEN oreg.is_maatwerk THEN
      COALESCE(ma.pickbaar_stuks = ma.totaal_stuks AND ma.totaal_stuks > 0, false)
    ELSE
      COALESCE(vc.aantal_actief > 0, false)
  END AS is_pickbaar,
  CASE
    WHEN oreg.is_maatwerk         THEN 'snijplan'
    WHEN rl.code IS NOT NULL      THEN 'rol'
    WHEN p.locatie IS NOT NULL    THEN 'producten_default'
    ELSE NULL
  END AS bron,
  CASE
    WHEN oreg.is_maatwerk THEN ma.locatie
    ELSE COALESCE(rl.code, p.locatie)
  END AS fysieke_locatie,
  CASE
    WHEN oreg.is_maatwerk THEN
      CASE
        WHEN ma.totaal_stuks IS NULL OR ma.slechtste_rang IS NULL THEN 'snijden'
        WHEN ma.slechtste_rang <= 2 THEN 'snijden'
        WHEN ma.slechtste_rang <= 4 THEN 'confectie'
        WHEN ma.slechtste_rang <= 6 THEN 'inpak'
        ELSE NULL
      END
    ELSE
      CASE WHEN COALESCE(vc.aantal_actief, 0) = 0 THEN 'inkoop' ELSE NULL END
  END AS wacht_op,
  oreg.gewicht_kg
FROM order_regels oreg
JOIN orders o            ON o.id = oreg.order_id
LEFT JOIN producten p    ON p.artikelnr = oreg.artikelnr
LEFT JOIN maatwerk_aggr ma   ON ma.order_regel_id = oreg.id
LEFT JOIN voorraad_claim vc  ON vc.order_regel_id = oreg.id
LEFT JOIN rol_locatie_per_artikel rl ON rl.artikelnr = oreg.artikelnr
WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
  AND NOT is_admin_pseudo(oreg.artikelnr);

COMMENT ON VIEW orderregel_pickbaarheid IS
  'Per orderregel: is_pickbaar, fysieke_locatie, bron (snijplan|rol|producten_default), '
  'wacht_op (snijden|confectie|inpak|inkoop|null), gewicht_kg. Verenigt maatwerk- en '
  'standaard-paden. Mig 170; mig 288: ''Snijden''-rang; mig 383: admin-pseudo-regels '
  '(ADR-0018, o.a. VERZEND en DROPSHIP-*) uitgesloten + gewicht_kg toegevoegd — '
  'single source voor Pick & Ship, de TS-laag leidt niets meer af.';

CREATE VIEW order_pickbaarheid AS
SELECT
  op.order_id,
  COUNT(*)::int                                        AS totaal_regels,
  (COUNT(*) FILTER (WHERE op.is_pickbaar))::int        AS pickbare_regels,
  COUNT(*) FILTER (WHERE op.is_pickbaar) = COUNT(*)    AS alle_regels_pickbaar,
  COUNT(*) FILTER (WHERE op.is_pickbaar) > 0           AS heeft_pickbare_regel,
  COALESCE(d.deelleveringen_toegestaan, FALSE)         AS deelleveringen_toegestaan,
  (
    COUNT(*) FILTER (WHERE op.is_pickbaar) = COUNT(*)
    OR (
      COALESCE(d.deelleveringen_toegestaan, FALSE)
      AND COUNT(*) FILTER (WHERE op.is_pickbaar) > 0
    )
  ) AS pick_ship_zichtbaar
FROM orderregel_pickbaarheid op
JOIN orders o        ON o.id = op.order_id
LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
GROUP BY op.order_id, d.deelleveringen_toegestaan;

COMMENT ON VIEW order_pickbaarheid IS
  'Order-niveau-pickbaarheid (mig 383), aggregaat over orderregel_pickbaarheid. '
  'pick_ship_zichtbaar = alle regels pickbaar OF (deelleveringen toegestaan EN '
  '>=1 pickbaar). Geen rij = geen (niet-pseudo) regels = niets te picken. '
  'Single source voor het Pick & Ship-orderfilter en de pick-start-knop; '
  'alleen de dag-order-horizon (ADR 0014) blijft client-side.';

NOTIFY pgrst, 'reload schema';
