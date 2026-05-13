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
  -- Expliciete cast naar NUMERIC(8,2) behoudt de typmod uit mig 229. Zonder
  -- cast verliest de LATERAL-functie-return zijn precisie/scale en faalt
  -- CREATE OR REPLACE VIEW met "cannot change data type of view column".
  vk.te_betalen::NUMERIC(8,2)                              AS te_betalen_verzendkosten,
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
  ADD COLUMN IF NOT EXISTS zending_id BIGINT REFERENCES zendingen(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_factuur_queue_zending
  ON factuur_queue(zending_id)
  WHERE zending_id IS NOT NULL;

COMMENT ON COLUMN factuur_queue.zending_id IS
  'Mig 234 (ADR-0010): FK naar de bundel-zending die deze factuur '
  'representeert. Bron-van-waarheid voor de set order_ids — mig 235 '
  'cron leest zending_orders M2M voor de orderregels. Nullable totdat '
  'mig 237 oude (debiteur, week)-rijen drained heeft.';

------------------------------------------------------------------------
-- 4. genereer_factuur_voor_bundel — bundel-driven factuur-RPC
------------------------------------------------------------------------
-- Vervangt mig 232 genereer_factuur_voor_week. Aggregatie-eenheid wijzigt
-- van (debiteur, week) naar bundel-zending (4-dim sleutel via mig 228).
-- Eén factuur per bundel; één VERZEND-regel via verzendkosten_voor_bundel.
--
-- Volgt mig 227 no-op-guard: faal vroeg als alle regels al gefactureerd
-- zijn — voorkomt lege headers bij dubbele drain-aanroep.

CREATE OR REPLACE FUNCTION genereer_factuur_voor_bundel(p_zending_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_factuur_id           BIGINT;
  v_factuur_nr           TEXT;
  v_zending              zendingen%ROWTYPE;
  v_debiteur             debiteuren%ROWTYPE;
  v_btw_pct              NUMERIC(5,2);
  v_betaaltermijn_dagen  INTEGER := 30;
  v_aantal_te_factureren INTEGER;
  v_order_ids            BIGINT[];
  v_subtotaal            NUMERIC(12,2);
  v_btw_bedrag           NUMERIC(12,2);
  v_totaal               NUMERIC(12,2);
  v_volgnr               INTEGER;
  v_bundel_subtotaal     NUMERIC(12,2);
  v_is_afhalen           BOOLEAN;
  v_vk                   RECORD;
BEGIN
  IF p_zending_id IS NULL THEN
    RAISE EXCEPTION 'p_zending_id is verplicht';
  END IF;

  SELECT * INTO v_zending FROM zendingen WHERE id = p_zending_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  -- Orders uit zending_orders M2M (mig 222). Bij 1-op-1-zendingen is de
  -- backfill al gevuld (zo zijn alle paden uniform).
  SELECT array_agg(zo.order_id ORDER BY zo.order_id)
    INTO v_order_ids
    FROM zending_orders zo
   WHERE zo.zending_id = p_zending_id;

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Zending % heeft geen gekoppelde orders', p_zending_id;
  END IF;

  -- Single-debiteur-invariant — bundel kruist nooit klant-grens (mig 222).
  -- Defensieve check vóór de scalar-subquery: faal met domein-specifieke
  -- melding i.p.v. generieke "more than one row returned"-PostgreSQL-fout
  -- als de invariant ooit doorbroken wordt. Volgt mig 227 idiom.
  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(v_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Bundel-zending % kruist debiteur-grens (orders %)',
      p_zending_id, v_order_ids;
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren
   WHERE debiteur_nr = (SELECT DISTINCT debiteur_nr FROM orders WHERE id = ANY(v_order_ids));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Geen debiteur voor orders %', v_order_ids;
  END IF;

  v_btw_pct := COALESCE(v_debiteur.btw_percentage, 21.00);
  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  -- Mig 227 no-op-guard.
  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND COALESCE(orr.artikelnr, '') <> 'VERZEND';

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Zending % heeft geen te-factureren regels', p_zending_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer
  ) VALUES (
    v_factuur_nr, v_debiteur.debiteur_nr, CURRENT_DATE,
    CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer
  ) RETURNING id INTO v_factuur_id;

  -- Product-regels: identiek aan mig 232 SELECT-shape.
  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.klant_referentie, o.order_nr,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(v_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
    AND COALESCE(orr.artikelnr, '') <> 'VERZEND'
  ORDER BY orr.order_id, orr.regelnummer;

  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND COALESCE(artikelnr, '') <> 'VERZEND';

  -- Eén VERZEND-regel: drempel-toets op het bundel-totaal via resolver.
  SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
    INTO v_bundel_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;

  -- Afhalen-state via canonical signal `orders.afhalen` (i.p.v. derived
  -- `vervoerder_code IS NULL` op de zending). Gebruikt BOOL_OR over de
  -- bundel-orders zodat één afhalen-order in de bundel de hele bundel
  -- afhalen maakt — consistent met mig 222 invariant dat afhalen-orders
  -- geen zending krijgen (mig 205), waardoor dit normaliter alleen TRUE
  -- is bij volledige afhalen-bundels.
  SELECT BOOL_OR(COALESCE(o.afhalen, FALSE))
    INTO v_is_afhalen
    FROM orders o
   WHERE o.id = ANY(v_order_ids);

  SELECT * INTO v_vk
    FROM verzendkosten_voor_bundel(v_debiteur.debiteur_nr, v_bundel_subtotaal, v_is_afhalen);

  SELECT COALESCE(MAX(regelnummer), 0) INTO v_volgnr
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_volgnr := v_volgnr + 1;

  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  ) VALUES (
    v_factuur_id,
    v_order_ids[1],                  -- bron-order voor EDI-context
    NULL,                            -- geen specifieke order_regel
    v_volgnr,
    'VERZEND',
    -- Rich omschrijving consistent met mig 232: week + vervoerder + N orders + reden.
    -- Vervoerder is 'AFHAAL' bij afhalen-bundels, anders de zending.vervoerder_code.
    format('Verzendkosten week %s (%s, %s order%s) — %s',
      COALESCE(v_zending.verzendweek, 'onbekend'),
      CASE WHEN v_is_afhalen THEN 'AFHAAL' ELSE COALESCE(v_zending.vervoerder_code, 'GEEN') END,
      array_length(v_order_ids, 1),
      CASE WHEN array_length(v_order_ids, 1) = 1 THEN '' ELSE 's' END,
      v_vk.reden),
    1, v_vk.te_betalen, 0, v_vk.te_betalen, v_btw_pct
  );

  -- Eindtotalen.
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$$;

COMMENT ON FUNCTION genereer_factuur_voor_bundel(BIGINT) IS
  'Mig 234 (ADR-0010): genereert factuur voor één bundel-zending. '
  'Aggregatie via zending_orders M2M (mig 222). Eén VERZEND-regel via '
  'verzendkosten_voor_bundel-resolver. Volgt mig 227 no-op-guard. '
  'Vervangt genereer_factuur_voor_week (mig 232) — die wordt gedropt in mig 237.';

GRANT EXECUTE ON FUNCTION genereer_factuur_voor_bundel(BIGINT)
  TO authenticated, service_role;

------------------------------------------------------------------------
-- 5. claim_factuur_queue_items — return-shape uitgebreid
------------------------------------------------------------------------
-- Mig 227's RPC returnt vandaag (id, debiteur_nr, order_ids, type, attempts).
-- Mig 234 voegt zending_id (kolom 3) en verzendweek (mig 231) toe zodat
-- de drain-edge-function in één call alle data heeft voor het 3-paden-
-- dispatch.

DROP FUNCTION IF EXISTS claim_factuur_queue_items(INTEGER);

CREATE OR REPLACE FUNCTION claim_factuur_queue_items(p_max_batch INTEGER DEFAULT 10)
RETURNS TABLE (
  id          BIGINT,
  debiteur_nr INTEGER,
  order_ids   BIGINT[],
  type        TEXT,
  attempts    INTEGER,
  zending_id  BIGINT,
  verzendweek TEXT
)
LANGUAGE sql
AS $$
  UPDATE factuur_queue q
     SET status = 'processing',
         processing_started_at = now()
   WHERE q.id IN (
     SELECT inner_q.id
       FROM factuur_queue inner_q
      WHERE inner_q.status = 'pending'
      ORDER BY inner_q.created_at ASC
      LIMIT p_max_batch
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.debiteur_nr, q.order_ids, q.type, q.attempts,
            q.zending_id, q.verzendweek;
$$;

GRANT EXECUTE ON FUNCTION claim_factuur_queue_items(INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION claim_factuur_queue_items(INTEGER) IS
  'Mig 234 (ADR-0010): claim met FOR UPDATE SKIP LOCKED. Return-shape '
  'uitgebreid met zending_id (mig 234) en verzendweek (mig 231) zodat '
  'de drain-edge-function 3-paden-dispatch zonder extra query kan doen.';

NOTIFY pgrst, 'reload schema';
