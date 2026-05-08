-- Migratie 234: bundel-factuur fundament — additief
--
-- ADR-0010: factuur volgt bundel-zending, factuurvoorkeur vervalt.
-- Deze migratie is **additief** — alle nieuwe objecten leven naast de
-- oude. Mig 235 drukt de cutover-knop, mig 237 ruimt de oude weg.
--
-- Bevat in volgorde:
--   1. verzendkosten_voor_bundel(deb, subtotaal, is_afhalen) — resolver
--   2. View voorgestelde_zending_bundels (mig 229) consumeert resolver
--   3. factuur_queue.zending_id-kolom (FK → zendingen)
--   4. genereer_factuur_voor_bundel(p_zending_id) — nieuwe factuur-RPC
--   5. claim_factuur_queue_items uitgebreid met zending_id + verzendweek
--
-- Idempotent: CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS / DROP IF EXISTS.

------------------------------------------------------------------------
-- 1. verzendkosten_voor_bundel — drempel-resolver
------------------------------------------------------------------------
-- Concentreert de 4-paden-toets die vóór ADR-0010 op vier plekken leefde:
-- view 229 (CASE-ladder), mig 232 (IF/ELSIF), order-form (TS), drempel-
-- progressbar (TS-label). Eén bron-van-waarheid voor SQL-consumers.
--
-- Returnt een 1-rij tabel met (te_betalen, status, reden):
--   · gratis_afhalen        — order met afhalen=TRUE; verzendkosten = €0
--   · gratis_klantafspraak  — debiteuren.gratis_verzending = TRUE
--   · gratis_drempel        — bundel_subtotaal ≥ debiteuren.verzend_drempel
--   · betaald               — anders, te_betalen = debiteuren.verzendkosten
--
-- Stable + parallel safe: leest debiteuren maar muteert niets.

CREATE OR REPLACE FUNCTION verzendkosten_voor_bundel(
  p_debiteur_nr     INTEGER,
  p_bundel_subtotaal NUMERIC,
  p_is_afhalen      BOOLEAN
) RETURNS TABLE (
  te_betalen NUMERIC(8,2),
  status     TEXT,
  reden      TEXT
)
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
DECLARE
  v_d debiteuren%ROWTYPE;
BEGIN
  IF p_debiteur_nr IS NULL THEN
    RAISE EXCEPTION 'p_debiteur_nr is verplicht';
  END IF;

  SELECT * INTO v_d FROM debiteuren WHERE debiteur_nr = p_debiteur_nr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debiteur % bestaat niet', p_debiteur_nr;
  END IF;

  IF COALESCE(p_is_afhalen, FALSE) THEN
    RETURN QUERY SELECT 0::NUMERIC(8,2), 'gratis_afhalen'::TEXT,
      'Afhalen — geen verzendkosten'::TEXT;
    RETURN;
  END IF;

  IF v_d.gratis_verzending THEN
    RETURN QUERY SELECT 0::NUMERIC(8,2), 'gratis_klantafspraak'::TEXT,
      'Gratis volgens klantafspraak'::TEXT;
    RETURN;
  END IF;

  IF v_d.verzend_drempel IS NOT NULL
     AND COALESCE(p_bundel_subtotaal, 0) >= v_d.verzend_drempel THEN
    RETURN QUERY SELECT 0::NUMERIC(8,2), 'gratis_drempel'::TEXT,
      format('Gratis vanaf €%s', to_char(v_d.verzend_drempel, 'FM999999.00'))::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    COALESCE(v_d.verzendkosten, 0)::NUMERIC(8,2),
    'betaald'::TEXT,
    'Standaard verzendkosten'::TEXT;
END;
$$;

COMMENT ON FUNCTION verzendkosten_voor_bundel(INTEGER, NUMERIC, BOOLEAN) IS
  'Mig 234 (ADR-0010): drempel-resolver voor bundel-verzendkosten. '
  'Concentreert de 4-paden-toets (afhalen / klant-gratis / drempel / '
  'betaald) die vóór ADR-0010 op view 229, mig 232, order-form en '
  'drempel-progressbar verspreid leefde. Returnt (te_betalen, status, reden).';

GRANT EXECUTE ON FUNCTION verzendkosten_voor_bundel(INTEGER, NUMERIC, BOOLEAN)
  TO authenticated, service_role;

-- Verificatie (run in SQL Editor na deploy):
--   -- Pad 1: afhalen
--   SELECT * FROM verzendkosten_voor_bundel(100000, 100, TRUE);
--   -- Verwacht: (0, 'gratis_afhalen', 'Afhalen — geen verzendkosten')
--
--   -- Pad 2: klant met gratis_verzending=TRUE (UPDATE eerst voor test)
--   SELECT * FROM verzendkosten_voor_bundel(<deb_met_gratis>, 100, FALSE);
--   -- Verwacht: (0, 'gratis_klantafspraak', ...)
--
--   -- Pad 3: bundel boven drempel
--   SELECT * FROM verzendkosten_voor_bundel(<deb_met_drempel_500>, 600, FALSE);
--   -- Verwacht: (0, 'gratis_drempel', 'Gratis vanaf €500.00')
--
--   -- Pad 4: standaard
--   SELECT * FROM verzendkosten_voor_bundel(<deb_zonder_gratis>, 100, FALSE);
--   -- Verwacht: (verzendkosten van klant, 'betaald', 'Standaard verzendkosten')

------------------------------------------------------------------------
-- 2. View 229 herschrijft naar resolver-consumer
------------------------------------------------------------------------
-- Vervangt de CASE-takken voor `te_betalen_verzendkosten` en
-- `drempel_gehaald` door een LATERAL JOIN op verzendkosten_voor_bundel.
-- `bundel_besparing` blijft inline — die berekent een hypothese over
-- "wat had de klant zonder bundel betaald?" en past niet binnen de
-- resolver-API.

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
    MIN(pr.afl_naam)                                       AS afl_naam,
    MIN(pr.afl_postcode)                                   AS afl_postcode,
    MIN(pr.afl_plaats)                                     AS afl_plaats,
    array_agg(DISTINCT pr.order_id ORDER BY pr.order_id)   AS order_ids,
    COUNT(DISTINCT pr.order_id)::INTEGER                   AS aantal_orders,
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
  -- Drempel-toets via resolver — single source of truth (ADR-0010).
  (vk.status <> 'betaald')                                 AS drempel_gehaald,
  vk.te_betalen                                            AS te_betalen_verzendkosten,
  -- Besparing blijft inline: scenario-vergelijking met solo-wereld.
  CASE
    WHEN g.is_afhalen OR d.gratis_verzending THEN 0
    WHEN g.aantal_orders < 2 THEN 0
    WHEN d.verzend_drempel IS NOT NULL
         AND g.bundel_subtotaal_excl >= d.verzend_drempel THEN
      g.aantal_orders * COALESCE(d.verzendkosten, 0)
    ELSE
      (g.aantal_orders - 1) * COALESCE(d.verzendkosten, 0)
  END::NUMERIC(10,2)                                       AS bundel_besparing
FROM gegroepeerd g
JOIN debiteuren d ON d.debiteur_nr = g.debiteur_nr
CROSS JOIN LATERAL verzendkosten_voor_bundel(g.debiteur_nr, g.bundel_subtotaal_excl, g.is_afhalen) vk;

COMMENT ON VIEW voorgestelde_zending_bundels IS
  'Mig 234 (ADR-0010, herschreven): consumeert verzendkosten_voor_bundel '
  'als single source of truth voor de drempel-toets. Bundel_besparing '
  'blijft inline. Aggregatie blijft 4-dim: (debiteur × adres × vervoerder × week).';

------------------------------------------------------------------------
-- 3. factuur_queue.zending_id-kolom (FK → zendingen)
------------------------------------------------------------------------
-- Bron-FK voor de bundel-driven enqueue (mig 235 cron). Nullable in
-- mig 234 zodat bestaande queue-rijen blijven werken — mig 237 maakt
-- 'm NOT NULL nadat oude rijen gedraind zijn.
ALTER TABLE factuur_queue
  ADD COLUMN IF NOT EXISTS zending_id BIGINT REFERENCES zendingen(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_factuur_queue_zending
  ON factuur_queue(zending_id)
  WHERE zending_id IS NOT NULL;

COMMENT ON COLUMN factuur_queue.zending_id IS
  'Mig 234 (ADR-0010): FK naar de bundel-zending die deze factuur '
  'representeert. Bron-van-waarheid voor de set order_ids — mig 235 '
  'cron leest zending_orders M2M voor de orderregels. Nullable totdat '
  'mig 237 oude (debiteur, week)-rijen drained heeft.';
