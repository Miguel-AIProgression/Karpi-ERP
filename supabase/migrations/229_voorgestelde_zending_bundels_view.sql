-- Migratie 229: voorgestelde_zending_bundels — pure SQL-view
--
-- Bron-van-waarheid voor de **dynamische** bundel-preview vóór pickronde-start.
-- Geen state, geen triggers, geen materialized view: bij elke query opnieuw
-- afgeleid uit de actuele orders + `effectieve_vervoerder_per_orderregel`
-- (mig 225/227). Wijzigt afleverdatum/adres/vervoerder-override → andere
-- bundel-sleutel → orders verschuiven automatisch tussen bundel-rijen bij de
-- volgende fetch. Dit garandeert de eis "bundel mag niet vast worden
-- opgeslagen".
--
-- Wat zit erin
-- ------------
-- Per (debiteur × adres-norm × effectieve vervoerder × verzendweek):
--   · sleutel + dimensie-componenten (debiteur, adres, vervoerder, week)
--   · order_ids[] + aantal_orders
--   · bundel_subtotaal_excl (som order_regels.bedrag, excl. VERZEND-pseudo's)
--   · klant-config (verzendkosten, verzend_drempel, gratis_verzending)
--   · drempel_gehaald, te_betalen_verzendkosten, bundel_besparing
--
-- Wat zit er NIET in
-- ------------------
-- · Orders die al een actieve zending hebben (status >= 'Picken'). Die zijn
--   gematerialiseerd als zending_orders M2M (mig 222) en horen op een
--   andere UI-track (Pakbonnen / Onderweg).
-- · Orders zonder afleverdatum — die hebben geen verzendweek en horen niet
--   te bundelen.
-- · Eindstatus-orders (Verzonden / Geannuleerd).
--
-- Performance-noot
-- ----------------
-- `effectieve_vervoerder_per_orderregel` is een SETOF-functie per order; we
-- gebruiken `CROSS JOIN LATERAL` over open orders. Voor het verwachte volume
-- (100-500 open orders × ~5 regels = O(2500) regel-evaluaties) blijft dit
-- ruim onder 200ms. Wordt het volume materieel groter (>5k open orders), dan
-- is een materialized view + smart refresh een logische upgrade — maar niet
-- nu (geen MV-pattern aanwezig in deze codebase).
--
-- Idempotent: CREATE OR REPLACE VIEW.

CREATE OR REPLACE VIEW voorgestelde_zending_bundels AS
WITH open_orders AS (
  SELECT
    o.id              AS order_id,
    o.debiteur_nr,
    o.afleverdatum,
    o.afl_naam,
    o.afl_adres,
    o.afl_postcode,
    o.afl_plaats,
    o.afl_land,
    _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land) AS adres_norm,
    verzendweek_voor_datum(o.afleverdatum)                             AS jaar_week,
    o.afhalen
    FROM orders o
   WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
     AND o.afleverdatum IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM zending_orders zo
         JOIN zendingen z ON z.id = zo.zending_id
        WHERE zo.order_id = o.id
          AND z.status IN ('Picken', 'Klaar voor verzending', 'Onderweg', 'Afgeleverd')
     )
),
per_regel AS (
  SELECT
    oo.order_id,
    oo.debiteur_nr,
    oo.adres_norm,
    oo.afl_naam,
    oo.afl_postcode,
    oo.afl_plaats,
    oo.jaar_week,
    -- Afhalen-orders krijgen eigen "vervoerder-code" zodat ze niet samenvallen
    -- met andere "GEEN vervoerder"-cases. effectieve_vervoerder_per_orderregel
    -- returnt voor afhalen `bron='afhalen'` met effectief_code=NULL.
    CASE
      WHEN COALESCE(oo.afhalen, FALSE) THEN 'AFHAAL'
      ELSE COALESCE(pv.effectief_code, 'GEEN')
    END AS vervoerder_code,
    pv.bron,
    ore.bedrag,
    ore.orderaantal,
    ore.artikelnr
    FROM open_orders oo
    CROSS JOIN LATERAL effectieve_vervoerder_per_orderregel(oo.order_id) pv
    JOIN order_regels ore ON ore.id = pv.orderregel_id
   -- effectieve_vervoerder_per_orderregel filtert VERZEND-regels al weg, maar
   -- defensief opnieuw filteren maakt de view onafhankelijk van die belofte.
   WHERE COALESCE(ore.artikelnr, '') <> 'VERZEND'
     AND COALESCE(ore.orderaantal, 0) > 0
),
gegroepeerd AS (
  SELECT
    bundel_sleutel(
      pr.debiteur_nr,
      pr.adres_norm,
      pr.vervoerder_code,
      pr.jaar_week
    )                                                      AS sleutel,
    pr.debiteur_nr,
    pr.adres_norm,
    pr.vervoerder_code,
    pr.jaar_week,
    -- Snippets voor UI-tooltip — deterministisch via MIN over identieke groep.
    MIN(pr.afl_naam)                                       AS afl_naam,
    MIN(pr.afl_postcode)                                   AS afl_postcode,
    MIN(pr.afl_plaats)                                     AS afl_plaats,
    array_agg(DISTINCT pr.order_id ORDER BY pr.order_id)   AS order_ids,
    COUNT(DISTINCT pr.order_id)::INTEGER                   AS aantal_orders,
    -- Subtotaal in euro's, exclusief BTW. order_regels.bedrag is reeds
    -- prijs × aantal × (1 - korting%); zie genereer_factuur (mig 227).
    COALESCE(SUM(COALESCE(pr.bedrag, 0)), 0)::NUMERIC(12,2) AS bundel_subtotaal_excl,
    BOOL_OR(pr.bron = 'afhalen')                            AS is_afhalen
    FROM per_regel pr
   GROUP BY pr.debiteur_nr, pr.adres_norm, pr.vervoerder_code, pr.jaar_week
)
SELECT
  g.sleutel,
  g.debiteur_nr,
  d.naam                                                   AS debiteur_naam,
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
  d.verzendkosten                                          AS klant_verzendkosten,
  d.verzend_drempel                                        AS klant_drempel,
  d.gratis_verzending,
  -- Drempel-toets per bundel: gratis als klant.gratis_verzending=TRUE óf
  -- bundel-subtotaal ≥ klant.verzend_drempel. Afhalen-bundels betalen geen
  -- verzendkosten ongeacht drempel.
  (
    g.is_afhalen
    OR d.gratis_verzending
    OR (d.verzend_drempel IS NOT NULL
        AND g.bundel_subtotaal_excl >= d.verzend_drempel)
  )                                                        AS drempel_gehaald,
  CASE
    WHEN g.is_afhalen THEN 0
    WHEN d.gratis_verzending THEN 0
    WHEN d.verzend_drempel IS NOT NULL
         AND g.bundel_subtotaal_excl >= d.verzend_drempel THEN 0
    ELSE COALESCE(d.verzendkosten, 0)
  END::NUMERIC(8,2)                                        AS te_betalen_verzendkosten,
  -- Besparing = wat de klant vandaag bespaart door deze bundel t.o.v. de
  -- alternatieve wereld waarin elke order solo verstuurd zou worden. Twee
  -- scenario's geven besparing:
  --   1. Bundel haalt drempel terwijl niet elke solo-order dat zou doen
  --   2. Bundel = N orders × verzendkosten → ineens 1 × verzendkosten
  -- Voor de UI-pijl ("u bespaart €X door te bundelen") nemen we het maximum:
  -- het verschil met de pessimistische solo-wereld.
  CASE
    WHEN g.is_afhalen OR d.gratis_verzending THEN 0
    WHEN g.aantal_orders < 2 THEN 0
    WHEN d.verzend_drempel IS NOT NULL
         AND g.bundel_subtotaal_excl >= d.verzend_drempel THEN
      -- Bundel haalt drempel: alle solo-verzendkosten verdwijnen.
      g.aantal_orders * COALESCE(d.verzendkosten, 0)
    ELSE
      -- Bundel haalt drempel niet, maar (N-1) × verzendkosten wordt vermeden
      -- doordat alleen 1 transportbeweging plaatsvindt.
      (g.aantal_orders - 1) * COALESCE(d.verzendkosten, 0)
  END::NUMERIC(10,2)                                       AS bundel_besparing
FROM gegroepeerd g
JOIN debiteuren d ON d.debiteur_nr = g.debiteur_nr;

COMMENT ON VIEW voorgestelde_zending_bundels IS
  'Mig 229: dynamische preview-view voor zending-bundeling. Gegroepeerd op '
  '(debiteur × adres-norm × effectieve vervoerder × verzendweek) over alle '
  'open orders zonder actieve zending. Pure SQL — herevalueert per query. '
  'Drempel-toets (klant.verzend_drempel) en gratis-verzending (klant.'
  'gratis_verzending) zitten in de view zodat de UI zonder extra logica de '
  'progressbar en besparing-badge kan tonen. Bron voor '
  'frontend/src/modules/logistiek/queries/voorgestelde-bundels.ts.';

NOTIFY pgrst, 'reload schema';
