# Factuur volgt bundel-zending — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voer ADR-0010 uit — `factuurvoorkeur='per_zending'` droppen en factuur-aggregatie verschuiven van `(debiteur, week)` naar bundel-zending (4-dim sleutel).

**Architecture:** Drie migraties in oplopende volgnummers vormen samen een veilige rollout: 234 is **additief** (nieuwe RPCs naast oude — productie blijft draaien), 235 is **cutover** (cron herschreven, trigger gedropt, kolom gedropt), 237 is **cleanup** (oude RPCs definitief weg). Tussen 234 en 235 deployt de edge function en frontend zodat callers klaar zijn voor de nieuwe RPC vóór de cutover. De `verzendkosten_voor_bundel`-resolver concentreert de 4-paden-drempel-toets (afhalen / klant-gratis / drempel-gehaald / normaal) op één plek; mig 232's view en de nieuwe factuur-RPC consumeren beide deze functie.

**Tech Stack:**
- PostgreSQL 15 (Supabase, hosted) — migraties via SQL Editor (geen MCP-toegang, zie `reference_karpi_supabase_mcp.md`)
- Deno + Supabase Edge Functions — `factuur-verzenden`
- React 18 + TypeScript + Vitest — frontend & tests
- pg_cron — `facturatie-wekelijks` job (maandag 05:00 UTC)

**Achtergrond-documenten:**
- [ADR-0010](../../adr/0010-factuur-volgt-bundel-zending.md) — beslissing + alternatieven
- [data-woordenboek.md](../../data-woordenboek.md) — termen *Bundel-factuur*, *Verzendkosten-resolver*
- [architectuur.md → Facturatie-flow](../../architectuur.md) — herschreven flow-diagram
- [mig 228 `bundel_sleutel`](../../../supabase/migrations/228_bundel_sleutel_helper.sql) — bundel-identiteit
- [mig 229 `voorgestelde_zending_bundels`](../../../supabase/migrations/229_voorgestelde_zending_bundels_view.sql) — view met huidige drempel-CASE
- [mig 232 `genereer_factuur_voor_week`](../../../supabase/migrations/232_genereer_factuur_voor_week.sql) — vandaag's wekelijkse RPC

---

## File Structure

**Nieuwe bestanden:**

| Pad | Verantwoordelijkheid |
|---|---|
| `supabase/migrations/234_verzendkosten_resolver_en_factuur_bundel_rpc.sql` | Additief: `verzendkosten_voor_bundel`, `genereer_factuur_voor_bundel`, `factuur_queue.zending_id`-kolom, view 229 herschrijft naar resolver |
| `supabase/migrations/235_cutover_drop_per_zending.sql` | Cutover: cron herschreven naar bundel-driven enqueue, trigger gedropt, `debiteuren.factuurvoorkeur` gedropt |
| `supabase/migrations/240_cleanup_oude_factuur_rpcs.sql` | Cleanup: drop `genereer_factuur_voor_week` + `genereer_factuur(BIGINT[])` + `factuur_queue.type`-kolom |
| `frontend/src/modules/facturatie/__tests__/factuur-bundel.sql.fixture.md` | Documentatie + handmatige verificatie-queries voor de SQL-migraties (geen runner — SQL Editor copy-paste) |

**Te wijzigen bestanden:**

| Pad | Wat verandert |
|---|---|
| `supabase/functions/factuur-verzenden/index.ts` | Switcht van `genereer_factuur` / `genereer_factuur_voor_week` naar `genereer_factuur_voor_bundel(zending_id)`; legacy-fallback voor oude queue-rijen tot na mig 240 |
| `frontend/src/modules/facturatie/queries/klant-factuur-instellingen.ts` | `factuurvoorkeur`-veld + `FactuurVoorkeur`-type weg uit interface en SELECT |
| `frontend/src/modules/facturatie/index.ts` | Barrel: `FactuurVoorkeur` export weg |
| `frontend/src/components/klanten/klant-facturering-tab.tsx` | Radio-button-blok "Factuurvoorkeur" weg |
| `frontend/src/modules/facturatie/__tests__/klant-factuur-instellingen.contract.test.ts` | Update: factuurvoorkeur uit fixture en assertions weg |

---

## Task 1: Migratie 234 — Verzendkosten-resolver SQL-functie

**Files:**
- Create: `supabase/migrations/234_verzendkosten_resolver_en_factuur_bundel_rpc.sql`

- [ ] **Step 1.1: Maak nieuw migratie-bestand met header**

```sql
-- Migratie 234: bundel-factuur fundament — additief
--
-- ADR-0010: factuur volgt bundel-zending, factuurvoorkeur vervalt.
-- Deze migratie is **additief** — alle nieuwe objecten leven naast de
-- oude. Mig 235 drukt de cutover-knop, mig 240 ruimt de oude weg.
--
-- Bevat in volgorde:
--   1. verzendkosten_voor_bundel(deb, subtotaal, is_afhalen) — resolver
--   2. View voorgestelde_zending_bundels (mig 229) consumeert resolver
--   3. factuur_queue.zending_id-kolom (FK → zendingen)
--   4. genereer_factuur_voor_bundel(p_zending_id) — nieuwe factuur-RPC
--
-- Idempotent: CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS / DROP IF EXISTS.
```

- [ ] **Step 1.2: Schrijf `verzendkosten_voor_bundel` als pure SQL-functie**

```sql
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
```

- [ ] **Step 1.3: Verificatie-query (manual SQL Editor) — 4 paden**

Voeg onderaan de migratie als comment:

```sql
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
```

- [ ] **Step 1.4: Commit**

```bash
git add supabase/migrations/234_verzendkosten_resolver_en_factuur_bundel_rpc.sql
git commit -m "feat(facturatie): verzendkosten_voor_bundel resolver — ADR-0010 mig 234 step 1"
```

---

## Task 2: Migratie 234 — View 229 consumeert de resolver

**Files:**
- Modify: `supabase/migrations/234_verzendkosten_resolver_en_factuur_bundel_rpc.sql` (vervolg)

- [ ] **Step 2.1: Voeg view-herschrijving toe aan mig 234**

De huidige view-CASE in mig 229 (lines 138-169) wordt vervangen door een `LATERAL` join op `verzendkosten_voor_bundel`. De `bundel_besparing`-tak blijft inline (gebruikt subtle scenario-logica die niet bij de resolver past).

```sql
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
```

- [ ] **Step 2.2: Verificatie — view-output identiek aan vóór mig 234**

```sql
-- Verificatie: vergelijk een open bundel vóór en na de migratie.
-- Snapshot vóór (in een aparte sessie vóór deploy):
--   CREATE TEMP TABLE bundel_snapshot AS SELECT * FROM voorgestelde_zending_bundels;
-- Na deploy:
--   SELECT * FROM voorgestelde_zending_bundels v
--   FULL OUTER JOIN bundel_snapshot s USING (sleutel)
--    WHERE v.te_betalen_verzendkosten IS DISTINCT FROM s.te_betalen_verzendkosten
--       OR v.drempel_gehaald            IS DISTINCT FROM s.drempel_gehaald;
-- Verwacht: 0 rijen (output identiek).
```

- [ ] **Step 2.3: Commit**

```bash
git add supabase/migrations/234_verzendkosten_resolver_en_factuur_bundel_rpc.sql
git commit -m "refactor(facturatie): view 229 consumeert verzendkosten_voor_bundel — ADR-0010 mig 234 step 2"
```

---

## Task 3: Migratie 234 — `factuur_queue.zending_id`-kolom

**Files:**
- Modify: `supabase/migrations/234_verzendkosten_resolver_en_factuur_bundel_rpc.sql` (vervolg)

- [ ] **Step 3.1: Voeg `zending_id`-kolom + FK + index toe**

```sql
------------------------------------------------------------------------
-- 3. factuur_queue.zending_id-kolom (FK → zendingen)
------------------------------------------------------------------------
-- Bron-FK voor de bundel-driven enqueue (mig 235 cron). Nullable in
-- mig 234 zodat bestaande queue-rijen blijven werken — mig 240 maakt
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
  'mig 240 oude (debiteur, week)-rijen drained heeft.';
```

- [ ] **Step 3.2: Verificatie — kolom + index aanwezig**

```sql
-- Verificatie:
--   \d+ factuur_queue
--   -- Verwacht: kolom zending_id, index idx_factuur_queue_zending
```

- [ ] **Step 3.3: Commit**

```bash
git add supabase/migrations/234_verzendkosten_resolver_en_factuur_bundel_rpc.sql
git commit -m "feat(facturatie): factuur_queue.zending_id kolom — ADR-0010 mig 234 step 3"
```

---

## Task 4: Migratie 234 — `genereer_factuur_voor_bundel` RPC

**Files:**
- Modify: `supabase/migrations/234_verzendkosten_resolver_en_factuur_bundel_rpc.sql` (vervolg)

- [ ] **Step 4.1: Schrijf `genereer_factuur_voor_bundel`**

Volgt mig 232's pattern: header-INSERT met defaults, product-regels via SELECT-shape, no-op-guard, eindtotalen-update. Verschil: leest `zending_orders` voor de set orders en heeft slechts één VERZEND-regel via de resolver.

```sql
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

  -- Afhalen-state vandaag: vervoerder_code IS NULL op de zending
  -- (mig 205 afhalen_skip_vervoerder zorgt dat afhalen-orders geen
  -- zending krijgen, maar defensief afdekken).
  v_is_afhalen := (v_zending.vervoerder_code IS NULL);

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
    format('Verzendkosten week %s — %s',
      COALESCE(v_zending.verzendweek, 'onbekend'), v_vk.reden),
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
  'Vervangt genereer_factuur_voor_week (mig 232) — die wordt gedropt in mig 240.';

GRANT EXECUTE ON FUNCTION genereer_factuur_voor_bundel(BIGINT)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 4.2: Verificatie — RPC returnt valid factuur_id voor test-bundel**

```sql
-- Pak een Klaar-voor-verzending bundel-zending uit dev/staging:
--   SELECT id, zending_nr, vervoerder_code, verzendweek FROM zendingen
--    WHERE status='Klaar voor verzending'
--      AND id IN (SELECT zending_id FROM zending_orders)
--    LIMIT 1;
--
--   SELECT genereer_factuur_voor_bundel(<id>);
--   -- Verwacht: BIGINT factuur_id terug
--
--   SELECT * FROM factuur_regels WHERE factuur_id = <id>;
--   -- Verwacht: N product-regels + 1 VERZEND-regel met juiste te_betalen
```

- [ ] **Step 4.3: Commit**

```bash
git add supabase/migrations/234_verzendkosten_resolver_en_factuur_bundel_rpc.sql
git commit -m "feat(facturatie): genereer_factuur_voor_bundel RPC — ADR-0010 mig 234 step 4"
```

---

## Task 5: Edge function — accept zending_id-pad met legacy-fallback

**Files:**
- Modify: `supabase/functions/factuur-verzenden/index.ts:25-31` (QueueItem-interface)
- Modify: `supabase/functions/factuur-verzenden/index.ts:181-209` (RPC-dispatch)

- [ ] **Step 5.1: Update `QueueItem`-interface met `zending_id`-veld**

In [factuur-verzenden/index.ts:25-31](../../../supabase/functions/factuur-verzenden/index.ts#L25-L31):

```typescript
interface QueueItem {
  id: number
  debiteur_nr: number
  order_ids: number[]
  type: 'per_zending' | 'wekelijks'  // legacy — mig 240 dropt dit veld
  attempts: number
  zending_id: number | null  // mig 234 (ADR-0010): nieuwe bron
  verzendweek: string | null  // mig 231: gevuld voor wekelijks-pad
}
```

- [ ] **Step 5.2: Update `claim_factuur_queue_items`-RPC of voeg `verzendweek` + `zending_id`-fetch toe**

`claim_factuur_queue_items` (mig 227) returnt `(id, debiteur_nr, order_ids, type, attempts)` — geen `zending_id` of `verzendweek`. Twee opties:
- **Optie A:** Update mig 227's RPC-signature in een hotfix in mig 234 om `zending_id` mee te geven.
- **Optie B:** Edge function fetcht `zending_id` apart na claim (extra round-trip per item).

Kies **Optie A** — voeg in mig 234 als laatste step toe:

```sql
-- Mig 234 step 5: claim_factuur_queue_items returnt nu ook zending_id +
-- verzendweek zodat de drain in één call alle data heeft.
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
```

- [ ] **Step 5.3: Vervang RPC-dispatch in edge function**

In [factuur-verzenden/index.ts:181-209](../../../supabase/functions/factuur-verzenden/index.ts#L181-L209):

```typescript
      // ADR-0010 mig 234: 3-paden-dispatch met legacy-fallback.
      //   1. NIEUW: item.zending_id gevuld → genereer_factuur_voor_bundel
      //   2. LEGACY wekelijks: zending_id NULL maar type='wekelijks' →
      //      genereer_factuur_voor_week (drained voor mig 240)
      //   3. LEGACY per_zending: zending_id NULL en type='per_zending' →
      //      genereer_factuur (drained voor mig 240)
      let factuurId: number
      if (item.zending_id != null) {
        const { data, error } = await supabase.rpc('genereer_factuur_voor_bundel', {
          p_zending_id: item.zending_id,
        })
        if (error) throw new Error(`RPC genereer_factuur_voor_bundel: ${error.message}`)
        factuurId = data as number
      } else if (item.type === 'wekelijks') {
        if (!item.verzendweek) throw new Error(`Queue-rij ${item.id} type=wekelijks zonder verzendweek én zonder zending_id`)
        const { data, error } = await supabase.rpc('genereer_factuur_voor_week', {
          p_debiteur_nr: item.debiteur_nr,
          p_jaar_week: item.verzendweek,
        })
        if (error) throw new Error(`RPC genereer_factuur_voor_week (legacy): ${error.message}`)
        factuurId = data as number
      } else {
        const { data, error } = await supabase.rpc('genereer_factuur', {
          p_order_ids: item.order_ids,
        })
        if (error) throw new Error(`RPC genereer_factuur (legacy): ${error.message}`)
        factuurId = data as number
      }
      if (!factuurId) throw new Error('genereer_factuur* returned null')
```

- [ ] **Step 5.4: Deploy edge function**

```bash
npx supabase functions deploy factuur-verzenden --project-ref wqzeevfobwauxkalagtn
```

- [ ] **Step 5.5: Verificatie — handmatig drain triggeren met test-queue-rij**

```bash
# Maak in SQL Editor een test queue-rij met een echte bundel-zending_id:
#   INSERT INTO factuur_queue (debiteur_nr, order_ids, type, zending_id)
#   SELECT debiteur_nr, ARRAY[<order_id>], 'wekelijks', <zending_id>
#     FROM zendingen WHERE id = <zending_id>;
#
# Trigger de drain:
curl -X POST https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/factuur-verzenden \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"

# Verwacht: factuur_queue.status='done', facturen-rij aangemaakt met juiste regels.
```

- [ ] **Step 5.6: Commit**

```bash
git add supabase/functions/factuur-verzenden/index.ts supabase/migrations/234_verzendkosten_resolver_en_factuur_bundel_rpc.sql
git commit -m "feat(facturatie): edge function consumeert genereer_factuur_voor_bundel — ADR-0010 mig 234 step 5"
```

---

## Task 6: Frontend — Drop `factuurvoorkeur` uit queries en types

**Files:**
- Modify: `frontend/src/modules/facturatie/queries/klant-factuur-instellingen.ts`
- Modify: `frontend/src/modules/facturatie/index.ts`

- [ ] **Step 6.1: Update test om verwacht gedrag te beschrijven**

In `frontend/src/modules/facturatie/__tests__/klant-factuur-instellingen.contract.test.ts`:

```typescript
// Vervang de bestaande test-body — factuurvoorkeur wordt niet meer geselecteerd.
describe('fetchKlantFactuurInstellingen', () => {
  it('selecteert btw_percentage + email_factuur uit debiteuren op debiteur_nr', async () => {
    nextResponse = {
      data: { btw_percentage: 21, email_factuur: 'a@b.nl' },
      error: null,
    }
    const r = await fetchKlantFactuurInstellingen(123)
    expect(supabaseCalls[0]).toMatchObject({
      op: 'select',
      table: 'debiteuren',
      cols: 'btw_percentage, email_factuur',
      col: 'debiteur_nr',
      val: 123,
    })
    expect(r).toEqual({ btw_percentage: 21, email_factuur: 'a@b.nl' })
  })
})

describe('updateKlantFactuurInstellingen', () => {
  it('update alleen de twee facturatie-velden', async () => {
    await updateKlantFactuurInstellingen(123, { btw_percentage: 0 })
    expect(supabaseCalls[0]).toMatchObject({
      op: 'update',
      table: 'debiteuren',
      patch: { btw_percentage: 0 },
      col: 'debiteur_nr',
      val: 123,
    })
  })
})
```

- [ ] **Step 6.2: Run test om te zien dat 'ie faalt**

```bash
cd frontend && npx vitest run src/modules/facturatie/__tests__/klant-factuur-instellingen.contract.test.ts
```

Verwacht: FAIL — `factuurvoorkeur` zit nog in SELECT-cols.

- [ ] **Step 6.3: Update `klant-factuur-instellingen.ts`**

```typescript
import { supabase } from '@/lib/supabase/client'

export interface KlantFactuurInstellingen {
  btw_percentage: number
  email_factuur: string | null
}

export async function fetchKlantFactuurInstellingen(
  debiteur_nr: number,
): Promise<KlantFactuurInstellingen | null> {
  const { data, error } = await supabase
    .from('debiteuren')
    .select('btw_percentage, email_factuur')
    .eq('debiteur_nr', debiteur_nr)
    .single()
  if (error) throw new Error(error.message)
  return data as KlantFactuurInstellingen | null
}

export async function updateKlantFactuurInstellingen(
  debiteur_nr: number,
  patch: Partial<KlantFactuurInstellingen>,
): Promise<void> {
  const { error } = await supabase
    .from('debiteuren')
    .update(patch)
    .eq('debiteur_nr', debiteur_nr)
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 6.4: Update barrel `frontend/src/modules/facturatie/index.ts`**

```typescript
// Vervang de exports van klant-factuur-instellingen (regels 24-29):
export {
  fetchKlantFactuurInstellingen,
  updateKlantFactuurInstellingen,
  type KlantFactuurInstellingen,
} from './queries/klant-factuur-instellingen'
// FactuurVoorkeur-type vervalt per ADR-0010.
```

- [ ] **Step 6.5: Run test om te zien dat 'ie passt**

```bash
cd frontend && npx vitest run src/modules/facturatie/__tests__/klant-factuur-instellingen.contract.test.ts
```

Verwacht: PASS.

- [ ] **Step 6.6: Run typecheck om consumers te vinden**

```bash
cd frontend && npx tsc --noEmit
```

Verwacht: errors in `klant-facturering-tab.tsx` (consumeert `factuurvoorkeur`) — die fixen we in Task 7.

- [ ] **Step 6.7: Commit**

```bash
git add frontend/src/modules/facturatie/queries/klant-factuur-instellingen.ts frontend/src/modules/facturatie/index.ts frontend/src/modules/facturatie/__tests__/klant-factuur-instellingen.contract.test.ts
git commit -m "refactor(facturatie): drop factuurvoorkeur uit klant-instellingen — ADR-0010"
```

---

## Task 7: Frontend — Drop radio-button uit `klant-facturering-tab`

**Files:**
- Modify: `frontend/src/components/klanten/klant-facturering-tab.tsx`

- [ ] **Step 7.1: Verwijder radio-button-blok + factuurvoorkeur-destructure**

Vervang de huidige body:

```typescript
import { useState } from 'react'
import {
  useKlantFactuurInstellingen,
  useUpdateKlantFactuurInstellingen,
} from '@/modules/facturatie'
import { FactuurLijst } from '@/modules/facturatie'

interface Props {
  debiteurNr: number
  btwNummer: string | null
}

export function KlantFactureringTab({ debiteurNr, btwNummer }: Props) {
  const { data: instellingen } = useKlantFactuurInstellingen(debiteurNr)
  const updateMut = useUpdateKlantFactuurInstellingen()

  const [editEmail, setEditEmail] = useState(false)

  const patch = (p: Parameters<typeof updateMut.mutate>[0]['patch']) =>
    updateMut.mutate({ debiteur_nr: debiteurNr, patch: p })

  if (!instellingen) return null

  const { email_factuur: emailFactuur, btw_percentage: btwPercentage } = instellingen
  const btwWaarschuwing = btwPercentage === 0 && !btwNummer

  return (
    <div className="space-y-6">
      {/* Factuurvoorkeur-sectie verwijderd per ADR-0010: factuur volgt
          voortaan altijd de bundel-zending in de wekelijkse cron. Geen
          klant-keuze meer. */}

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">E-mailadres factuur</h3>
        {/* (rest van de email-sectie ongewijzigd) */}
        ...
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">BTW-percentage</h3>
        {/* (BTW-sectie ongewijzigd) */}
        ...
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Facturen</h3>
        <FactuurLijst debiteurNr={debiteurNr} />
      </section>
    </div>
  )
}
```

(Behoud de email + BTW + facturenlijst-secties exact zoals ze waren — alleen de Factuurvoorkeur-sectie + de destructuring van `factuurvoorkeur` weg.)

- [ ] **Step 7.2: Run typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Verwacht: PASS.

- [ ] **Step 7.3: Run alle frontend-tests**

```bash
cd frontend && npx vitest run
```

Verwacht: PASS (185+ tests, geen regressies).

- [ ] **Step 7.4: Visuele check in dev-server**

```bash
cd frontend && npm run dev
# Open /klanten/<debiteur_nr> → tab "Facturering"
# Check: geen radio-buttons meer; e-mail + BTW + facturen-lijst zichtbaar
```

- [ ] **Step 7.5: Commit**

```bash
git add frontend/src/components/klanten/klant-facturering-tab.tsx
git commit -m "refactor(klanten): drop factuurvoorkeur radio-button — ADR-0010"
```

---

## Task 8: Frontend deploy + edge function verificatie

- [ ] **Step 8.1: Frontend build + deploy**

Volg Karpi's normale frontend-deploy-flow (Vite build + statische host).

- [ ] **Step 8.2: Wacht 24u voordat mig 235 wordt toegepast**

Dit is een operationele safeguard: bestaande factuur_queue-rijen (`type='wekelijks'`, `zending_id=NULL`) moeten eerst gedraind worden door de huidige cron + drain. Als mig 235 te vroeg loopt heeft de cron van komende maandag al een lege bron én is `factuurvoorkeur` al weg — onmogelijk om legacy-cron te draaien.

```sql
-- Verificatie vóór mig 235:
SELECT type, COUNT(*) FILTER (WHERE zending_id IS NULL) AS legacy_count,
       COUNT(*) FILTER (WHERE zending_id IS NOT NULL) AS nieuw_count
  FROM factuur_queue WHERE status IN ('pending', 'processing')
 GROUP BY type;
-- Verwacht na 24u: legacy_count = 0 voor type='wekelijks' én 'per_zending'.
```

---

## Task 9: Migratie 235 — Cutover

**Files:**
- Create: `supabase/migrations/235_cutover_drop_per_zending.sql`

- [ ] **Step 9.1: Schrijf cron-herziening (`enqueue_wekelijkse_verzamelfacturen`)**

```sql
-- Migratie 235: cutover — bundel-driven enqueue + drop per_zending-pad
--
-- ADR-0010: factuur volgt bundel-zending. Cron (mig 122/231) wordt
-- herschreven om per (debiteur, week) één queue-rij PER BUNDEL-ZENDING
-- te maken — i.p.v. één queue-rij voor alle orders van die week.
--
-- LET OP: de oude trigger heet sinds mig 223 niet meer trg_enqueue_factuur
-- ON orders, maar trg_enqueue_factuur_op_event ON order_events met
-- procedure enqueue_factuur_voor_event(). Dáár dropt deze migratie.
--
-- VOORWAARDE: factuur_queue mag geen pending/processing rijen meer hebben
-- met zending_id=NULL. Verifieer met de query in Task 8 step 8.2.
--
-- Idempotent: CREATE OR REPLACE / DROP IF EXISTS.

-- Hard guard tegen voortijdig draaien.
DO $$
DECLARE
  v_legacy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_legacy_count
    FROM factuur_queue
   WHERE status IN ('pending', 'processing')
     AND zending_id IS NULL;
  IF v_legacy_count > 0 THEN
    RAISE EXCEPTION 'Mig 235 cutover: % legacy queue-rijen zonder zending_id. Drain eerst.',
      v_legacy_count
      USING HINT = 'Wacht tot factuur-verzenden de oude rijen heeft afgewikkeld, of zet ze handmatig op failed.';
  END IF;
END;
$$;

------------------------------------------------------------------------
-- 1. enqueue_wekelijkse_verzamelfacturen — bundel-driven
------------------------------------------------------------------------
-- Per bundel-zending één queue-rij; aggregatie via zending_orders M2M
-- (mig 222 backfill vulde ook 1-op-1, dus alle paden uniform).
CREATE OR REPLACE FUNCTION enqueue_wekelijkse_verzamelfacturen()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_doel_week TEXT := verzendweek_voor_datum((CURRENT_DATE - INTERVAL '7 days')::DATE);
BEGIN
  INSERT INTO factuur_queue (debiteur_nr, order_ids, zending_id, verzendweek)
  SELECT
    o.debiteur_nr,
    array_agg(zo.order_id ORDER BY zo.order_id),
    z.id,
    z.verzendweek
  FROM zendingen z
  JOIN zending_orders zo ON zo.zending_id = z.id
  JOIN orders o          ON o.id = zo.order_id
  WHERE z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
    AND z.verzendweek = v_doel_week
    AND NOT EXISTS (
      SELECT 1 FROM factuur_queue fq
       WHERE fq.zending_id = z.id
         AND fq.status IN ('pending', 'processing', 'done')
    )
    -- Skip bundels waarvan ÉÉN van de orders al gefactureerd is. Dat
    -- voorkomt dat een handmatig pre-gefactureerde order stilletjes uit
    -- de array_agg verdwijnt en de bundel met partial set enqueue't.
    -- Strikter dan mig 231 (die filterde per-order); hier per-bundel.
    AND NOT EXISTS (
      SELECT 1 FROM zending_orders zo2
        JOIN factuur_regels fr ON fr.order_id = zo2.order_id
       WHERE zo2.zending_id = z.id
    )
  GROUP BY z.id, o.debiteur_nr, z.verzendweek;
END;
$$;

COMMENT ON FUNCTION enqueue_wekelijkse_verzamelfacturen IS
  'Mig 235 (ADR-0010): één queue-rij per bundel-zending van vorige week '
  'zonder factuur. Aggregatie via zending_orders M2M. Vervangt de '
  '(debiteur, week)-aggregatie van mig 231.';

------------------------------------------------------------------------
-- 2. Drop event-driven enqueue-trigger (mig 223 ADR-0007)
------------------------------------------------------------------------
-- Mig 223 verving mig 118's trigger op orders.status door deze event-
-- driven variant op order_events. Per_zending-pad vervalt nu volledig
-- (ADR-0010): geen trigger meer nodig, wekelijkse cron is de enige
-- enqueue-bron.
DROP TRIGGER  IF EXISTS trg_enqueue_factuur_op_event ON order_events;
DROP FUNCTION IF EXISTS enqueue_factuur_voor_event() CASCADE;

-- factuur_queue.bron_event_id (mig 223 audit-FK) blijft staan. Bestaande
-- rijen die ernaar verwijzen blijven valide; nieuwe rijen via cron vullen
-- 'm niet (NULL = "via wekelijkse cron, niet via event"). De FK is
-- daarmee informatief; cleanup-kandidaat voor een toekomstige opruim-mig.

------------------------------------------------------------------------
-- 3. Drop debiteuren.factuurvoorkeur-kolom + enum-type
------------------------------------------------------------------------
-- Frontend stopt al met lezen vóór deze migratie (Task 6/7). Edge
-- function gebruikt 'm niet meer (Task 5). Het enum-type heet
-- 'factuurvoorkeur' (mig 117), zonder _enum-suffix.
ALTER TABLE debiteuren DROP COLUMN IF EXISTS factuurvoorkeur;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'factuurvoorkeur') THEN
    DROP TYPE factuurvoorkeur;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 9.2: Verificatie-queries (post-deploy)**

```sql
-- 1. Trigger weg + functie weg:
--    SELECT tgname FROM pg_trigger WHERE tgname='trg_enqueue_factuur_op_event';
--    SELECT proname FROM pg_proc WHERE proname='enqueue_factuur_voor_event';
--    Verwacht: 0 rijen voor beide.
--
-- 2. Kolom + enum-type weg:
--    \d+ debiteuren | grep factuurvoorkeur
--    SELECT typname FROM pg_type WHERE typname='factuurvoorkeur';
--    Verwacht: kolom niet aanwezig, type niet aanwezig.
--
-- 3. Cron-output: simuleer wekelijkse run.
--    SELECT enqueue_wekelijkse_verzamelfacturen();
--    SELECT * FROM factuur_queue
--     WHERE created_at > now() - INTERVAL '5 minutes'
--     ORDER BY id DESC LIMIT 10;
--    Verwacht: rijen met zending_id gevuld, één per bundel-zending.
```

- [ ] **Step 9.3: Commit**

```bash
git add supabase/migrations/235_cutover_drop_per_zending.sql
git commit -m "feat(facturatie): cutover bundel-driven cron + drop factuurvoorkeur — ADR-0010 mig 235"
```

---

## Task 10: Migratie 240 — Cleanup oude RPCs

**Files:**
- Create: `supabase/migrations/240_cleanup_oude_factuur_rpcs.sql`

- [ ] **Step 10.1: Wacht tot alle queue-rijen via mig 234-pad zijn gedraind**

```sql
-- Verifieer: geen pending/processing rijen meer met zending_id=NULL
-- (legacy paths volledig gedraind).
SELECT COUNT(*) FROM factuur_queue
 WHERE zending_id IS NULL
   AND status IN ('pending', 'processing');
-- Verwacht: 0.
```

- [ ] **Step 10.2: Schrijf cleanup-migratie**

```sql
-- Migratie 240: cleanup — drop oude factuur-RPCs en factuur_queue.type
--
-- ADR-0010: na de cutover (mig 235) en drain van alle legacy queue-rijen
-- bestaan er geen callers meer voor genereer_factuur_voor_week (mig 232)
-- en genereer_factuur (mig 119/124/227). Drop ze. factuur_queue.type-
-- kolom verliest z'n functie en wordt ook gedropt.
--
-- factuur_queue.zending_id wordt NOT NULL gemaakt (alle nieuwe rijen
-- hebben hem; legacy is gedraind).
--
-- Idempotent: DROP IF EXISTS.

------------------------------------------------------------------------
-- 1. Drop oude factuur-RPCs
------------------------------------------------------------------------
DROP FUNCTION IF EXISTS genereer_factuur_voor_week(INTEGER, TEXT);
DROP FUNCTION IF EXISTS genereer_factuur(BIGINT[]);

------------------------------------------------------------------------
-- 2. factuur_queue.type-kolom dropt; zending_id wordt NOT NULL
------------------------------------------------------------------------
DROP INDEX  IF EXISTS idx_factuur_queue_wekelijks_week;
ALTER TABLE factuur_queue DROP COLUMN IF EXISTS type;
ALTER TABLE factuur_queue ALTER COLUMN zending_id SET NOT NULL;

------------------------------------------------------------------------
-- 3. claim_factuur_queue_items — type-veld weg uit return-shape
------------------------------------------------------------------------
DROP FUNCTION IF EXISTS claim_factuur_queue_items(INTEGER);

CREATE OR REPLACE FUNCTION claim_factuur_queue_items(p_max_batch INTEGER DEFAULT 10)
RETURNS TABLE (
  id          BIGINT,
  debiteur_nr INTEGER,
  order_ids   BIGINT[],
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
  RETURNING q.id, q.debiteur_nr, q.order_ids, q.attempts,
            q.zending_id, q.verzendweek;
$$;

GRANT EXECUTE ON FUNCTION claim_factuur_queue_items(INTEGER) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 10.3: Verificatie**

```sql
-- 1. Oude RPCs weg:
--    SELECT proname FROM pg_proc
--     WHERE proname IN ('genereer_factuur', 'genereer_factuur_voor_week');
--    Verwacht: 0 rijen.
--
-- 2. Type-kolom weg, zending_id NOT NULL:
--    \d+ factuur_queue
--    Verwacht: kolom 'type' weg, 'zending_id' NOT NULL.
```

- [ ] **Step 10.4: Commit**

```bash
git add supabase/migrations/240_cleanup_oude_factuur_rpcs.sql
git commit -m "chore(facturatie): drop oude factuur-RPCs + factuur_queue.type — ADR-0010 mig 240"
```

---

## Task 11: Edge function — verwijder legacy-fallback

**Files:**
- Modify: `supabase/functions/factuur-verzenden/index.ts`

- [ ] **Step 11.1: Verwijder de legacy-takken uit de RPC-dispatch**

Vervang de 3-paden-dispatch (Task 5 step 5.3) door:

```typescript
      // ADR-0010 mig 240: legacy paths gedropt. Alleen genereer_factuur_voor_bundel.
      const { data, error } = await supabase.rpc('genereer_factuur_voor_bundel', {
        p_zending_id: item.zending_id,
      })
      if (error) throw new Error(`RPC genereer_factuur_voor_bundel: ${error.message}`)
      const factuurId = data as number
      if (!factuurId) throw new Error('genereer_factuur_voor_bundel returned null')
```

- [ ] **Step 11.2: Verwijder `type` uit `QueueItem`-interface**

```typescript
interface QueueItem {
  id: number
  debiteur_nr: number
  order_ids: number[]
  attempts: number
  zending_id: number  // mig 240: NOT NULL
  verzendweek: string | null
}
```

- [ ] **Step 11.3: Deploy edge function**

```bash
npx supabase functions deploy factuur-verzenden --project-ref wqzeevfobwauxkalagtn
```

- [ ] **Step 11.4: Verificatie — handmatig drain**

Maak een test-queue-rij met geldig `zending_id`, trigger drain. Verwacht: factuur aangemaakt zonder errors.

- [ ] **Step 11.5: Commit**

```bash
git add supabase/functions/factuur-verzenden/index.ts
git commit -m "chore(facturatie): drop edge-fn legacy-fallback — ADR-0010 cleanup"
```

---

## Task 12: Documentatie & post-deploy verificatie

**Files:**
- Modify: `docs/database-schema.md` (factuur_queue + debiteuren entries)
- Modify: `docs/changelog.md` (nieuw item bij oplevering)

- [ ] **Step 12.1: Update `database-schema.md` factuur_queue-entry**

Verwijder `type`-kolom-doc; voeg `zending_id`-FK toe; verwijder `factuurvoorkeur`-vermeldingen.

```bash
grep -n "factuur_queue\|factuurvoorkeur" docs/database-schema.md
# Update gevonden secties — schrappen wat is gedropt, toevoegen zending_id-FK.
```

- [ ] **Step 12.2: Voeg changelog-entry toe (oplevering, niet ADR)**

Boven aan `docs/changelog.md`:

```markdown
## YYYY-MM-DD — ADR-0010 opgeleverd: bundel-driven facturatie live (mig 234-235-240)

Cutover voltooid. `factuurvoorkeur` is gedropt, `genereer_factuur_voor_bundel` is enige factuur-RPC, cron schrijft één queue-rij per bundel-zending. Edge function `factuur-verzenden` verwijderd legacy-fallback. Geen klant-actie vereist; bestaande facturen onveranderd.

**Verificatie post-deploy**:
- `factuur_queue` heeft `zending_id` NOT NULL en geen `type`-kolom.
- `genereer_factuur_voor_week` + `genereer_factuur(BIGINT[])` bestaan niet meer.
- `klant-facturering-tab` toont geen radio-button.
- Eerste maandag-cron na deploy creëert 1 queue-rij per bundel-zending van vorige week.
```

- [ ] **Step 12.3: Commit + push**

```bash
git add docs/database-schema.md docs/changelog.md
git commit -m "docs: ADR-0010 oplevering — schema + changelog"
git push origin <branch>
```

---

## End-to-End Verificatie (na alle migraties)

- [ ] **Maandag-cron runt correct** — eerste maandag na deploy: check `factuur_queue` op nieuwe rijen.

```sql
SELECT COUNT(*), MIN(zending_id), MAX(zending_id), MIN(created_at)
  FROM factuur_queue
 WHERE created_at > date_trunc('week', CURRENT_DATE)::TIMESTAMPTZ;
-- Verwacht: aantal = aantal bundel-zendingen vorige week, alle zending_id gevuld.
```

- [ ] **Drempel-toets klopt voor multi-order-bundel**

Dev-scenario: maak 2 orders zelfde klant + adres + week, totaal € boven drempel. Pickronde voltooien voor beide. Run cron handmatig:

```sql
SELECT enqueue_wekelijkse_verzamelfacturen();
```

Drain triggeren. Check factuur:
- 1 factuur per bundel-zending
- VERZEND-regel met `bedrag = 0`, `omschrijving = '… Gratis vanaf €500.00'`

- [ ] **Multi-vervoerder-split factureert separate**

Order met 2 vervoerders → 2 zendingen → 2 facturen na cron. Check verschillende factuur-nrs.

- [ ] **Geen regressie in EDI-INVOIC** — EDI-handelspartner krijgt geldige fixed-width INVOIC met juiste regelaantal.

---

## Rollback-plan

Geen automatic rollback. Bij prod-incident:

1. **Mig 235 net toegepast, blijkt fout** → schrijf `mig 241_revert_235.sql`:
   - `ALTER TABLE debiteuren ADD COLUMN factuurvoorkeur TEXT DEFAULT 'wekelijks';`
   - Restore `enqueue_factuur` + trigger uit mig 118 git history.
   - Restore `enqueue_wekelijkse_verzamelfacturen` body uit mig 231.
2. **Mig 240 net toegepast, blijkt fout** → schrijf `mig 242_revert_240.sql` met `genereer_factuur_voor_week` body uit mig 232 git history.
3. **Edge function regressie** → revert deploy via `git checkout <prev-sha> -- supabase/functions/factuur-verzenden && supabase functions deploy ...`.

`git show <sha>~1:<pad>` voor de body is documenteerd in `reference_karpi_legacy_migraties.md`.

---

## Niet in scope (ADR-0010 backlog)

- POD-callback voor `Afgeleverd`-event (V2)
- Credit-nota's bij niet-leverbare bundels (V2)
- Aparte tabel `klant_factuur_instellingen` (orthogonaal, ADR-0007 backlog)
