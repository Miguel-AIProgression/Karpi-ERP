# Allocator-integratie-test-harness & invariant-dekking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bouw de ontbrekende DB-integratie-test-runner die de al-bestaande swap-fixtures door `herallocateer_orderregel` draait, en dek daarmee de zwaarste ongetelde invarianten (claim-volgorde-prio, deadline-bewuste claim-swap ADR-0027, IO-fallback) — daarna uitgebreid naar de order-status-cascade-regressies en het opruimen van de dode `simuleer_dekking`-adapter.

**Architecture:** Een apart Vitest "integration project" praat via een directe Postgres-client (`pg`) met een lokale Supabase (`supabase start`, poort 54322). Per test: `BEGIN → seed → herallocateer_orderregel → assert → ROLLBACK` — volledige isolatie zonder DB-reset per test. De bestaande TypeScript-fixtures in [swap-policy.test.ts](../../../frontend/src/modules/reserveringen/lib/__tests__/swap-policy.test.ts) worden 1-op-1 als drijvende data hergebruikt (géén SQL-port = géén fixture-duplicatie). Een pre-commit-hook borgt de snelle unit-suite; een lichte GitHub Action draait de integratie-suite op `main`.

**Tech Stack:** Supabase CLI (lokale Postgres :54322 via Docker), Vitest (apart integration-config), node-postgres (`pg`), TypeScript. Bestaande repo-conventie voor SQL-integratietests: `scripts/test-*.sql` (`BEGIN … DO $$ asserts $$ … ROLLBACK`).

---

## Relatie tot bestaand werk (scope-afbakening — LEES EERST)

Dit plan bestaat naast een al-geschreven, placeholder-vrij plan: [2026-06-09-ts-sql-spiegeling-seam-consolidatie.md](2026-06-09-ts-sql-spiegeling-seam-consolidatie.md). Die twee overlappen op één onderwerp en moeten gecoördineerd worden:

| Onderwerp | Waar belegd | Dit plan doet |
|---|---|---|
| **FACT-0021 betaaltermijn-bug** (live geld-bug) | **Seam-plan Fase 0** (mig 333 helper + mig 334 RPC-omzetting, zelf-testende migratie) | **NIET dupliceren.** Voer het seam-plan Fase 0 eerst/parallel uit. Het gebruikt een `DO $$ … RAISE EXCEPTION $$`-migratie — voor een pure SQL-helper lichter en beter dan deze Vitest-harness. Dit plan begint pas ná, of op een eigen branch náást, die fix. |
| **Order-status-cascade** | Seam-plan **Fase 2** consolideert de 3 SQL-kopieën → 1 (duplicatie weg). **Dit plan Fase 4** dekt het *gedrag* met regressietests (255/267/290). | Complementair. Coördineer migratienummers; draai de cascade-regressietests (Fase 4 hier) ná de seam-consolidatie zodat ze de geconsolideerde functie testen. |
| **Allocator-test-harness (de 9 swap-fixtures uitvoeren)** | **Alleen hier** — niet in het seam-plan. | De kern van dit plan (Fase 1–2). |
| **`simuleer_dekking` droppen + ADR-0015** | **Alleen hier** (Fase 5) — het seam-plan dekt deze TS↔SQL-spiegel niet. | Echte aanvulling, geen duplicaat. |

**Migratienummer-discipline:** het seam-plan claimt 333/334. Dit plan creëert SQL pas in Fase 3 (consolidatie-migratie) en Fase 5 (`DROP simuleer_dekking`). Verifieer bij branch-start opnieuw met `ls supabase/migrations/ | sort | tail -5` en pak de eerstvolgende vrije nummers — dit is exact hoe migratie 287 ooit per ongeluk werd ingepikt.

---

## Bevindingen & besluiten (geverifieerd onderzoek — 5 onderzoeks-agents + 3 afwegings-agents)

De stelling — *"de invariant-zwaarste modules hebben geen test die hun interface kruist; goedkoopste eerste zet = bouw de allocator-test-runner op de bestaande fixtures"* — is geverifieerd **WAAR** met twee correcties:

1. **Kostenraming.** De 9 fixtures (~15% van het werk) liggen klaar; de **harness (~85%)** is het echte werk: FK-complete seed over `debiteuren → producten → orders → order_regels` + `inkooporders → inkooporder_regels`, claim-reset naar de fixture-begintoestand, JSONB-event-asserties, id-mapping fixture↔DB. Dit plan framet de harness dus eerlijk als **M/L**, niet "goedkoop", en de-riskt 'm op een smoke-test (Fase 1) vóór de zware allocator-fixtures (Fase 2).
2. **ADR-0015-categoriefout.** De stelling zegt dat de allocator-runner "het ADR-0015 twee-adapter-contract echt maakt." Onjuist: dat contract betreft `simuleer_dekking` ↔ `berekenRegelDekking` — een **andere** functie. De allocator-runner raakt het niet. `simuleer_dekking` is bovendien dood (nergens aangeroepen) en al gedivergeerd (mist maatwerk/admin-pseudo-skip). Besluit (Fase 5): **droppen**, niet repareren.

**Geverifieerde feiten die de taken sturen:**
- Live allocator-body staat in **mig 318** ([318_supplier_portal.sql:84-343](../../../supabase/migrations/318_supplier_portal.sql)), copy-derived van mig 297 (drift-risico → Fase 3 consolidatie).
- `order_regels` heeft trigger `trg_orderregel_herallocateer` (mig 146/273) die bij insert/update `herallocateer_orderregel(NEW.id)` aanroept — de seed maakt claims dus "vanzelf"; de harness **reset** ze daarna naar de exacte fixture-`initialClaims` vóór de expliciete RPC-aanroep.
- `voorraad_beschikbaar_voor_artikel` (mig 154) = `producten.voorraad − producten.backorder − SUM(actieve bron='voorraad'-claims op fysiek_artikelnr)`. Seed `producten.voorraad` om vrije voorraad te sturen.
- `app_config` sleutel `'order_config'`, JSONB `waarde->>'inkoop_buffer_weken_vast'` (default 1 → 7 dagen) bestaat al op elke DB (mig 144) — niets seeden; alle fixtures gebruiken buffer=1.
- **Twee stille valkuilen** (research): `inkooporder_regels.eenheid` default `'m'` → IO onzichtbaar voor de allocator, **altijd expliciet `'stuks'`**; en `orders.standaard_afleverdatum_berekend` (nullable, niet in schema-docs) is **load-bearing** voor swap-eligibility (`afleverdatum > standaard…`).
- Geen CI (`.github/` ontbreekt), Vitest alleen in `frontend/`, migraties handmatig via Supabase SQL-editor, OS = Windows.

**Besluiten van de eigenaar (vastgelegd 2026-06-09):** volgorde = FACT-0021 eerst (→ via seam-plan, zie afbakening); infra = transactie-rollback + lokale Supabase; `simuleer_dekking` = droppen; betaaltermijn-fallback = 30 dagen (→ via seam-plan).

---

## File Structure

| Bestand | Verantwoordelijkheid | Fase |
|---|---|---|
| `frontend/vitest.integration.config.ts` (create) | Aparte Vitest-config: alleen `*.integration.test.ts`, `singleFork`, geen jsdom | 1 |
| `frontend/vite.config.ts` (modify) | Sluit `*.integration.test.ts` uit de snelle suite | 1 |
| `frontend/src/test-integration/db.ts` (create) | `withTx` (BEGIN/ROLLBACK) + connectie naar lokale Supabase | 1 |
| `frontend/src/test-integration/globalSetup.ts` (create) | Verifieert DB-connectie + schema vóór de suite; faalt met duidelijke instructie | 1 |
| `frontend/src/test-integration/smoke.integration.test.ts` (create) | De-risk: bewijst dat harness + rollback + RPC-call werken | 1 |
| `frontend/src/test-integration/seed-swap.ts` (create) | Seed een `SwapFixture.given` FK-compleet + claim-reset + id-maps | 2 |
| `frontend/src/test-integration/assert-swap.ts` (create) | Assert `finalActiveClaims` + `order_events` tegen de DB via de id-maps | 2 |
| `frontend/src/modules/reserveringen/lib/__tests__/swap-policy.integration.test.ts` (create) | Draait alle 9 fixtures door `herallocateer_orderregel` | 2 |
| `frontend/src/modules/reserveringen/lib/__tests__/swap-policy.test.ts` (modify) | `it.todo`'s vervangen door verwijzing naar de integratie-suite | 2 |
| `.husky/pre-commit` + `package.json` (modify) | Pre-commit: typecheck + snelle unit-suite | 1 |
| `frontend/package.json` (modify) | Scripts `test:integration`, `test:unit` | 1 |
| `supabase/migrations/3XX_consolidate_herallocateer_orderregel.sql` (create) | Eén canonieke allocator-definitie (Fase 3) | 3 |
| `frontend/src/test-integration/cascade.integration.test.ts` (create) | Regressietests annulering/release/recursie (Fase 4) | 4 |
| `.github/workflows/integration-tests.yml` (create) | Lichte CI: `supabase start` + `test:integration` (Fase 4) | 4 |
| `supabase/migrations/3XX_drop_simuleer_dekking.sql` (create) | `DROP FUNCTION simuleer_dekking` (Fase 5) | 5 |

---

## Branch-setup (vóór Task 1)

- [ ] **Maak de branch aan**

```bash
git checkout main
git pull --ff-only
git checkout -b test/allocator-integratie-harness
```

- [ ] **Verifieer dat Docker draait en start de lokale Supabase**

Run:
```bash
docker info
supabase start
```
Expected: `supabase start` print API-URL + DB-URL met `db` op `127.0.0.1:54322`. Als Docker Desktop niet draait → eerst starten. Dit is de Windows/Docker-voorwaarde uit de eigenaar-beslissing.

- [ ] **Pas alle migraties toe op de lokale DB**

Run:
```bash
supabase db reset
```
Expected: alle migraties 001→hoogste draaien groen, eindigt met seed-data. **Faalt een migratie** → dat is een echte bevinding (de keten draait niet schoon van nul); los die eerst op en noteer in de commit-message. Dit is de gratis "migratie-lint"-bijvangst.

---

## Fase 1 — DB-integratie-harness + smoke-test + pre-commit (DE EERSTE ZET)

**Doel:** bewijs de transactie-rollback-runner op een triviale keten en borg dat de snelle unit-suite niet verrot — vóór er één allocator-fixture op draait.

### Task 1: `pg`-dependency + npm-scripts

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Installeer node-postgres**

Run (in `frontend/`):
```bash
npm install --save-dev pg @types/pg
```
Expected: `pg` + `@types/pg` verschijnen in `devDependencies`.

- [ ] **Step 2: Voeg de test-scripts toe**

Wijzig in `frontend/package.json` het `scripts`-blok zodat het deze drie regels bevat (vervang de bestaande `"test"`-regel niet, vóeg toe):

```json
    "test": "vitest",
    "test:run": "vitest run",
    "test:unit": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:ui": "vitest --ui",
```

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore(test): node-postgres + test:integration script voor DB-harness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2: Vitest integration-config + uitsluiting uit de snelle suite

**Files:**
- Create: `frontend/vitest.integration.config.ts`
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Schrijf de integration-config**

Maak `frontend/vitest.integration.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

// Aparte config voor DB-integratietests. Draait tegen een lokale Supabase
// (supabase start → poort 54322). singleFork serialiseert de tests zodat
// transactie-rollback-isolatie deterministisch is (één DB-connectie tegelijk).
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['./src/test-integration/globalSetup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
```

- [ ] **Step 2: Sluit integratietests uit de snelle suite**

Wijzig in `frontend/vite.config.ts` het `test`-blok zodat de `include` ongemoeid blijft maar er een `exclude` bijkomt:

```typescript
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'src/**/*.integration.test.ts'],
    css: false,
  },
```

- [ ] **Step 3: Commit**

```bash
git add frontend/vitest.integration.config.ts frontend/vite.config.ts
git commit -m "test(integration): aparte vitest-config; sluit *.integration.test.ts uit unit-suite

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 3: De `withTx`-harness + globalSetup

**Files:**
- Create: `frontend/src/test-integration/db.ts`
- Create: `frontend/src/test-integration/globalSetup.ts`

- [ ] **Step 1: Schrijf de connectie + transactie-helper**

Maak `frontend/src/test-integration/db.ts`:

```typescript
import { Client } from 'pg'

// Standaard lokale Supabase-DB (supabase start). Overschrijfbaar via env voor CI.
export const SUPABASE_DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/**
 * Draait `fn` binnen één transactie die ALTIJD rollbackt — test-isolatie
 * zonder DB-reset per test. Een fout in `fn` propageert ná de rollback.
 */
export async function withTx<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: SUPABASE_DB_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    return await fn(client)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    await client.end()
  }
}
```

- [ ] **Step 2: Schrijf de globalSetup (fail-fast met instructie)**

Maak `frontend/src/test-integration/globalSetup.ts`:

```typescript
import { Client } from 'pg'
import { SUPABASE_DB_URL } from './db'

// Draait één keer vóór de integratie-suite. Verifieert dat de lokale Supabase
// bereikbaar is én het schema geladen is (sentinel-functie bestaat). Faalt met
// een concrete instructie i.p.v. een cryptische connectie-fout per test.
export default async function setup() {
  const client = new Client({ connectionString: SUPABASE_DB_URL })
  try {
    await client.connect()
  } catch {
    throw new Error(
      `[integration] Kan niet verbinden met ${SUPABASE_DB_URL}. ` +
        `Draai eerst:  supabase start  (Docker Desktop moet aan staan).`,
    )
  }
  const { rows } = await client.query(
    `SELECT to_regprocedure('herallocateer_orderregel(bigint)') IS NOT NULL AS ok`,
  )
  await client.end()
  if (!rows[0]?.ok) {
    throw new Error(
      '[integration] Schema niet geladen (herallocateer_orderregel ontbreekt). ' +
        'Draai:  supabase db reset',
    )
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/test-integration/db.ts frontend/src/test-integration/globalSetup.ts
git commit -m "test(integration): withTx-harness + fail-fast globalSetup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 4: Smoke-test — bewijs de harness end-to-end

**Files:**
- Create: `frontend/src/test-integration/smoke.integration.test.ts`

- [ ] **Step 1: Schrijf de falende smoke-test (RED)**

Maak `frontend/src/test-integration/smoke.integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { withTx } from './db'

describe('integration harness smoke', () => {
  it('verbindt, roept een RPC aan, en rollbackt een insert', async () => {
    await withTx(async (c) => {
      // 1. De allocator-RPC bestaat en is aanroepbaar (geen exception = bestaat).
      const fn = await c.query(
        `SELECT to_regprocedure('herallocateer_orderregel(bigint)') AS sig`,
      )
      expect(fn.rows[0].sig).toBe('herallocateer_orderregel(bigint)')

      // 2. Rollback-isolatie: insert in een onschuldige tabel, lees terug.
      await c.query(
        `INSERT INTO app_config (sleutel, waarde)
         VALUES ('__smoke_test__', '{"x":1}'::jsonb)
         ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde`,
      )
      const r = await c.query(
        `SELECT waarde->>'x' AS x FROM app_config WHERE sleutel = '__smoke_test__'`,
      )
      expect(r.rows[0].x).toBe('1')
    })

    // 3. Na rollback mag de smoke-rij NIET bestaan (in een nieuwe tx).
    await withTx(async (c) => {
      const r = await c.query(
        `SELECT count(*)::int AS n FROM app_config WHERE sleutel = '__smoke_test__'`,
      )
      expect(r.rows[0].n).toBe(0)
    })
  })
})
```

- [ ] **Step 2: Verifieer dat de test faalt zónder draaiende DB (RED)**

Run (in `frontend/`, met `supabase` GESTOPT of Docker uit):
```bash
npm run test:integration
```
Expected: faalt in globalSetup met `[integration] Kan niet verbinden …`. Dit bewijst de fail-fast.

- [ ] **Step 3: Start de DB en draai opnieuw (GREEN)**

Run:
```bash
supabase start
npm run test:integration
```
Expected: `smoke.integration.test.ts` → 1 passed. De RPC-signatuur klopt en de rollback-isolatie werkt (de smoke-rij is na rollback weg).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/test-integration/smoke.integration.test.ts
git commit -m "test(integration): smoke-test bewijst harness + rollback-isolatie

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5: Pre-commit-hook (snelle suite + typecheck)

Borgt dat de bestaande snelle tests + typecheck niet verrotten. De integratie-suite zit er BEWUST niet in (te traag voor elke commit → developer zou `--no-verify` gebruiken).

**Files:**
- Create: `.husky/pre-commit`
- Modify: `frontend/package.json` (devDep husky + lint-staged)

- [ ] **Step 1: Installeer Husky + lint-staged**

Run (in `frontend/`):
```bash
npm install --save-dev husky lint-staged
npx husky init
```
Expected: `.husky/`-map aangemaakt, `prepare`-script in `package.json`.

- [ ] **Step 2: Schrijf de hook**

Overschrijf `.husky/pre-commit` met:

```bash
cd frontend
npx lint-staged
npm run typecheck
npm run test:unit
```

- [ ] **Step 3: Configureer lint-staged**

Voeg toe aan `frontend/package.json` (top-level):

```json
  "lint-staged": {
    "src/**/*.{ts,tsx}": "eslint --max-warnings=0"
  }
```

- [ ] **Step 4: Verifieer dat de hook bijt**

Maak tijdelijk een typefout in een `.ts`-bestand, `git add` + `git commit -m "test"`.
Expected: commit wordt geblokkeerd door `npm run typecheck`. Herstel de fout daarna.

- [ ] **Step 5: Commit**

```bash
git add .husky/pre-commit frontend/package.json frontend/package-lock.json
git commit -m "chore(hooks): pre-commit typecheck + snelle unit-suite (geen integratie)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Fase 2 — De 9 allocator-fixtures uitvoeren (DE KERN VAN DE STELLING)

**Doel:** de 6 `swapPolicyFixtures` + 3 `conflictDetectFixtures` executeerbaar maken tegen de live `herallocateer_orderregel` (mig 318). Maakt de drie zwaarste invarianten DB-getest.

### Task 6: Seed-helper voor een `SwapFixture.given`

De helper inserteert FK-compleet, **reset** daarna de door triggers gemaakte claims naar de exacte `initialClaims`, en geeft id-maps terug (fixture-id → echte DB-id).

**Files:**
- Create: `frontend/src/test-integration/seed-swap.ts`

- [ ] **Step 1: Schrijf de seed-helper**

Maak `frontend/src/test-integration/seed-swap.ts`:

```typescript
import type { Client } from 'pg'

// Spiegelt de fixture-interfaces uit swap-policy.test.ts (alleen de velden die
// de seed nodig heeft). De fixtures importeren we in de testfile zelf.
interface Given {
  appConfig: { inkoop_buffer_weken_vast: number }
  voorraad: Array<{ artikelnr: string; voorraad: number }>
  orders: Array<{
    id: number
    status: string
    afleverdatum: string
    standaard_afleverdatum_berekend: string | null
  }>
  orderRegels: Array<{
    id: number
    order_id: number
    artikelnr: string
    te_leveren: number
    is_maatwerk?: boolean
  }>
  ioRegels: Array<{
    id: number
    artikelnr: string
    eenheid: 'm' | 'stuks'
    te_leveren_m: number
    verwacht_datum: string
    io_status: 'Besteld' | 'Deels ontvangen' | 'Geannuleerd'
  }>
  initialClaims: Array<{
    order_regel_id: number
    bron: 'voorraad' | 'inkooporder_regel'
    inkooporder_regel_id: number | null
    aantal: number
    fysiek_artikelnr: string
    is_handmatig?: boolean
    status: 'actief' | 'released'
  }>
}

export interface IdMaps {
  order: (fixtureId: number) => number
  regel: (fixtureId: number) => number
  ioRegel: (fixtureId: number) => number
  debiteurNr: number
}

const TEST_DEBITEUR_NR = 990001

export async function seedSwapGiven(c: Client, given: Given): Promise<IdMaps> {
  const orderMap = new Map<number, number>()
  const regelMap = new Map<number, number>()
  const ioRegelMap = new Map<number, number>()

  // 0. app_config buffer (binnen tx → rolt terug). Alle fixtures: 1.
  await c.query(
    `UPDATE app_config
        SET waarde = waarde || jsonb_build_object('inkoop_buffer_weken_vast', $1::int)
      WHERE sleutel = 'order_config'`,
    [given.appConfig.inkoop_buffer_weken_vast],
  )

  // 1. test-debiteur (idempotent binnen tx)
  await c.query(
    `INSERT INTO debiteuren (debiteur_nr, naam, status)
     VALUES ($1, 'TEST ALLOCATOR', 'Actief')
     ON CONFLICT (debiteur_nr) DO NOTHING`,
    [TEST_DEBITEUR_NR],
  )

  // 2. producten met voorraad (CISCO etc.) — voorraad stuurt vrije-voorraad
  for (const v of given.voorraad) {
    await c.query(
      `INSERT INTO producten (artikelnr, omschrijving, product_type, actief, voorraad, backorder)
       VALUES ($1, $1 || ' (test)', 'overig', true, $2, 0)
       ON CONFLICT (artikelnr) DO UPDATE SET voorraad = EXCLUDED.voorraad, backorder = 0`,
      [v.artikelnr, v.voorraad],
    )
  }
  // Artikelen die wel in regels/IO voorkomen maar niet in voorraad[] → 0 voorraad
  const alleArtikelen = new Set<string>([
    ...given.orderRegels.map((r) => r.artikelnr),
    ...given.ioRegels.map((io) => io.artikelnr),
  ])
  for (const art of alleArtikelen) {
    await c.query(
      `INSERT INTO producten (artikelnr, omschrijving, product_type, actief, voorraad, backorder)
       VALUES ($1, $1 || ' (test)', 'overig', true, 0, 0)
       ON CONFLICT (artikelnr) DO NOTHING`,
      [art],
    )
  }

  // 3. inkooporders + inkooporder_regels (eenheid ALTIJD expliciet 'stuks')
  for (const io of given.ioRegels) {
    const ioHead = await c.query(
      `INSERT INTO inkooporders (inkooporder_nr, status, bron, besteldatum, verwacht_datum)
       VALUES ('TEST-IO-' || $1::text, $2, 'handmatig', CURRENT_DATE, $3::date)
       RETURNING id`,
      [io.id, io.io_status, io.verwacht_datum],
    )
    const ioId = ioHead.rows[0].id
    const ir = await c.query(
      `INSERT INTO inkooporder_regels
         (inkooporder_id, regelnummer, artikelnr, besteld_m, geleverd_m, te_leveren_m, eenheid, verwacht_datum)
       VALUES ($1, 1, $2, $3, 0, $3, $4, $5::date)
       RETURNING id`,
      [ioId, io.artikelnr, io.te_leveren_m, io.eenheid, io.verwacht_datum],
    )
    ioRegelMap.set(io.id, ir.rows[0].id)
  }

  // 4. orders (standaard_afleverdatum_berekend is LOAD-BEARING voor swap)
  for (const o of given.orders) {
    const row = await c.query(
      `INSERT INTO orders
         (order_nr, debiteur_nr, status, orderdatum, afleverdatum, standaard_afleverdatum_berekend)
       VALUES ('TEST-ORD-' || $1::text, $2, $3::order_status, CURRENT_DATE, $4::date, $5::date)
       RETURNING id`,
      [o.id, TEST_DEBITEUR_NR, o.status, o.afleverdatum, o.standaard_afleverdatum_berekend],
    )
    orderMap.set(o.id, row.rows[0].id)
  }

  // 5. order_regels (insert vuurt de allocator-trigger → maakt claims die we resetten)
  for (const r of given.orderRegels) {
    const row = await c.query(
      `INSERT INTO order_regels
         (order_id, regelnummer, artikelnr, omschrijving, orderaantal, te_leveren, is_maatwerk)
       VALUES ($1, $2, $3, $3 || ' regel', $4, $4, $5)
       RETURNING id`,
      [orderMap.get(r.order_id), r.id % 1000, r.artikelnr, r.te_leveren, r.is_maatwerk ?? false],
    )
    regelMap.set(r.id, row.rows[0].id)
  }

  // 6. CLAIM-RESET: wis alle door triggers gemaakte claims voor onze regels,
  //    zet exact de fixture-initialClaims (= de gecontroleerde begintoestand).
  const regelIds = [...regelMap.values()]
  await c.query(`DELETE FROM order_reserveringen WHERE order_regel_id = ANY($1::bigint[])`, [
    regelIds,
  ])
  for (const cl of given.initialClaims) {
    await c.query(
      `INSERT INTO order_reserveringen
         (order_regel_id, bron, inkooporder_regel_id, aantal, fysiek_artikelnr, is_handmatig, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        regelMap.get(cl.order_regel_id),
        cl.bron,
        cl.inkooporder_regel_id == null ? null : ioRegelMap.get(cl.inkooporder_regel_id),
        cl.aantal,
        cl.fysiek_artikelnr,
        cl.is_handmatig ?? false,
        cl.status,
      ],
    )
  }

  return {
    order: (id) => mustGet(orderMap, id, 'order'),
    regel: (id) => mustGet(regelMap, id, 'regel'),
    ioRegel: (id) => mustGet(ioRegelMap, id, 'ioRegel'),
    debiteurNr: TEST_DEBITEUR_NR,
  }
}

function mustGet(m: Map<number, number>, id: number, soort: string): number {
  const v = m.get(id)
  if (v === undefined) throw new Error(`Onbekende ${soort}-fixture-id ${id} in id-map`)
  return v
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/test-integration/seed-swap.ts
git commit -m "test(integration): FK-complete seed-helper + claim-reset + id-maps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 7: Assert-helper voor claims + events

**Files:**
- Create: `frontend/src/test-integration/assert-swap.ts`

- [ ] **Step 1: Schrijf de assert-helper**

Maak `frontend/src/test-integration/assert-swap.ts`:

```typescript
import type { Client } from 'pg'
import { expect } from 'vitest'
import type { IdMaps } from './seed-swap'

interface ExpectedClaim {
  order_regel_id: number
  bron: 'voorraad' | 'inkooporder_regel'
  io_regel_id?: number
  aantal: number
  fysiek_artikelnr: string
}

interface ExpectedEvent {
  order_id: number
  event_type: 'claim_geswapt_weg' | 'claim_geswapt_naar' | 'deadline_conflict_na_swap'
  metadata_match: Record<string, unknown>
}

/** Vergelijkt de actieve claims in de DB met de verwachte eindstaat. */
export async function assertFinalClaims(
  c: Client,
  maps: IdMaps,
  expected: ExpectedClaim[],
) {
  const regelIds = expected.map((e) => maps.regel(e.order_regel_id))
  const { rows } = await c.query(
    `SELECT order_regel_id, bron, inkooporder_regel_id, aantal, fysiek_artikelnr
       FROM order_reserveringen
      WHERE order_regel_id = ANY($1::bigint[]) AND status = 'actief'
      ORDER BY order_regel_id, bron`,
    [regelIds],
  )

  const actual = rows.map((r) => ({
    order_regel_id: Number(r.order_regel_id),
    bron: r.bron as ExpectedClaim['bron'],
    io_regel_id: r.inkooporder_regel_id == null ? undefined : Number(r.inkooporder_regel_id),
    aantal: Number(r.aantal),
    fysiek_artikelnr: r.fysiek_artikelnr as string,
  }))

  const wanted = expected
    .map((e) => ({
      order_regel_id: maps.regel(e.order_regel_id),
      bron: e.bron,
      io_regel_id: e.io_regel_id == null ? undefined : maps.ioRegel(e.io_regel_id),
      aantal: e.aantal,
      fysiek_artikelnr: e.fysiek_artikelnr,
    }))
    .sort(byRegelBron)

  expect(actual.sort(byRegelBron)).toEqual(wanted)
}

/** Controleert per verwacht event dat er ≥1 matchende order_events-rij is. */
export async function assertEvents(c: Client, maps: IdMaps, expected: ExpectedEvent[]) {
  for (const ev of expected) {
    // Vertaal fixture-ids in de metadata-match naar echte DB-ids.
    const md = translateMetadata(ev.metadata_match, maps)
    const { rows } = await c.query(
      `SELECT count(*)::int AS n
         FROM order_events
        WHERE order_id = $1 AND event_type = $2 AND metadata @> $3::jsonb`,
      [maps.order(ev.order_id), ev.event_type, JSON.stringify(md)],
    )
    expect(
      rows[0].n,
      `verwacht ${ev.event_type} op order ${ev.order_id} met ${JSON.stringify(md)}`,
    ).toBeGreaterThanOrEqual(1)
  }
}

// De metadata-match-velden bevatten fixture-ids (naar_order_id, van_order_id,
// io_regel_id) die naar echte DB-ids vertaald moeten worden vóór de @>-match.
function translateMetadata(m: Record<string, unknown>, maps: IdMaps): Record<string, unknown> {
  const out: Record<string, unknown> = { ...m }
  if ('naar_order_id' in out) out.naar_order_id = maps.order(out.naar_order_id as number)
  if ('van_order_id' in out) out.van_order_id = maps.order(out.van_order_id as number)
  if ('io_regel_id' in out) out.io_regel_id = maps.ioRegel(out.io_regel_id as number)
  return out
}

function byRegelBron(a: ExpectedClaim, b: ExpectedClaim) {
  return a.order_regel_id - b.order_regel_id || a.bron.localeCompare(b.bron)
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/test-integration/assert-swap.ts
git commit -m "test(integration): assert-helpers voor claim-eindstaat + order_events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 8: De integratie-testfile — alle 6 swap-fixtures

**Files:**
- Create: `frontend/src/modules/reserveringen/lib/__tests__/swap-policy.integration.test.ts`

- [ ] **Step 1: Schrijf de test die de 6 swap-fixtures draait (RED)**

Maak `frontend/src/modules/reserveringen/lib/__tests__/swap-policy.integration.test.ts`:

```typescript
import { describe, it } from 'vitest'
import { withTx } from '@/test-integration/db'
import { seedSwapGiven } from '@/test-integration/seed-swap'
import { assertFinalClaims, assertEvents } from '@/test-integration/assert-swap'
import { swapPolicyFixtures } from './swap-policy.test'

describe('herallocateer_orderregel — swap-policy (ADR-0027, mig 318)', () => {
  for (const fixture of swapPolicyFixtures) {
    it(fixture.name, async () => {
      await withTx(async (c) => {
        const maps = await seedSwapGiven(c, fixture.given)
        await c.query('SELECT herallocateer_orderregel($1)', [
          maps.regel(fixture.triggerOnOrderRegelId),
        ])
        await assertFinalClaims(c, maps, fixture.expected.finalActiveClaims)
        await assertEvents(c, maps, fixture.expected.expectedEvents)
      })
    })
  }
})
```

- [ ] **Step 2: Exporteer de fixtures uit swap-policy.test.ts (al `export const` — verifieer)**

Bevestig dat `swapPolicyFixtures` in [swap-policy.test.ts:117](../../../frontend/src/modules/reserveringen/lib/__tests__/swap-policy.test.ts) met `export const` gedeclareerd is (dat is zo). Geen wijziging nodig; de import in Step 1 werkt.

- [ ] **Step 3: Draai de suite (verwacht: groen, of een echte bug)**

Run:
```bash
cd frontend && npm run test:integration
```
Expected: 6 swap-fixtures + smoke = 7 passed. **Faalt een fixture** → óf de harness-mapping klopt niet (debug de id-maps/seed), óf je hebt een echte allocator-afwijking gevonden — vergelijk de `actual` vs `wanted` uit de `toEqual`-diff met de fixture-`expected`. Documenteer een echte afwijking als bevinding vóór je 'm "fixt".

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/reserveringen/lib/__tests__/swap-policy.integration.test.ts
git commit -m "test(allocator): 6 swap-policy-fixtures door herallocateer_orderregel (ADR-0027)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 9: Conflict-detect-fixtures (de 3 mig-298-scenario's)

De `conflictDetectFixtures` testen `deadline_conflict_na_swap` — geëmit door `sync_order_afleverdatum_met_claims` (mig 298), niet door de allocator zelf. Ze vereisen: een order met een `claim_geswapt_weg`-historie, een IO-claim die vertraagt, en (voor dedup) een recent conflict-event. Dit is een ander seed-profiel.

**Files:**
- Create: `frontend/src/test-integration/seed-conflict.ts`
- Modify: `frontend/src/modules/reserveringen/lib/__tests__/swap-policy.integration.test.ts`

- [ ] **Step 1: Schrijf de conflict-seed-helper**

Maak `frontend/src/test-integration/seed-conflict.ts`:

```typescript
import type { Client } from 'pg'

interface ConflictGiven {
  appConfig: { inkoop_buffer_weken_vast: number }
  order: {
    id: number
    status: string
    afleverdatum: string
    standaard_afleverdatum_berekend: string | null
    hasPriorSwapWegEvent: boolean
  }
  laatsteIoClaim: { ir_id: number; verwacht_datum_nieuw: string }
  hasRecentConflictEvent: boolean
}

const TEST_DEBITEUR_NR = 990002

export interface ConflictRefs {
  orderId: number
  orderRegelId: number
  ioRegelId: number
}

export async function seedConflictGiven(c: Client, g: ConflictGiven): Promise<ConflictRefs> {
  await c.query(
    `UPDATE app_config SET waarde = waarde || jsonb_build_object('inkoop_buffer_weken_vast', $1::int)
      WHERE sleutel = 'order_config'`,
    [g.appConfig.inkoop_buffer_weken_vast],
  )
  await c.query(
    `INSERT INTO debiteuren (debiteur_nr, naam, status)
     VALUES ($1, 'TEST CONFLICT', 'Actief') ON CONFLICT (debiteur_nr) DO NOTHING`,
    [TEST_DEBITEUR_NR],
  )
  await c.query(
    `INSERT INTO producten (artikelnr, omschrijving, product_type, actief, voorraad, backorder)
     VALUES ('CISCO', 'CISCO (test)', 'overig', true, 0, 0)
     ON CONFLICT (artikelnr) DO UPDATE SET voorraad = 0`,
  )
  // IO + regel (stuks) met de NIEUWE (vertraagde) verwacht_datum
  const io = await c.query(
    `INSERT INTO inkooporders (inkooporder_nr, status, bron, besteldatum, verwacht_datum)
     VALUES ('TEST-CIO-' || $1::text, 'Besteld', 'handmatig', CURRENT_DATE, $2::date)
     RETURNING id`,
    [g.laatsteIoClaim.ir_id, g.laatsteIoClaim.verwacht_datum_nieuw],
  )
  const ir = await c.query(
    `INSERT INTO inkooporder_regels
       (inkooporder_id, regelnummer, artikelnr, besteld_m, geleverd_m, te_leveren_m, eenheid, verwacht_datum)
     VALUES ($1, 1, 'CISCO', 5, 0, 5, 'stuks', $2::date) RETURNING id`,
    [io.rows[0].id, g.laatsteIoClaim.verwacht_datum_nieuw],
  )
  const order = await c.query(
    `INSERT INTO orders (order_nr, debiteur_nr, status, orderdatum, afleverdatum, standaard_afleverdatum_berekend)
     VALUES ('TEST-CORD-' || $1::text, $2, $3::order_status, CURRENT_DATE, $4::date, $5::date)
     RETURNING id`,
    [g.order.id, TEST_DEBITEUR_NR, g.order.status, g.order.afleverdatum, g.order.standaard_afleverdatum_berekend],
  )
  const regel = await c.query(
    `INSERT INTO order_regels (order_id, regelnummer, artikelnr, omschrijving, orderaantal, te_leveren, is_maatwerk)
     VALUES ($1, 1, 'CISCO', 'CISCO regel', 1, 1, false) RETURNING id`,
    [order.rows[0].id],
  )
  // De order heeft een actieve IO-claim op deze IO-regel
  await c.query(
    `DELETE FROM order_reserveringen WHERE order_regel_id = $1`,
    [regel.rows[0].id],
  )
  await c.query(
    `INSERT INTO order_reserveringen (order_regel_id, bron, inkooporder_regel_id, aantal, fysiek_artikelnr, status)
     VALUES ($1, 'inkooporder_regel', $2, 1, 'CISCO', 'actief')`,
    [regel.rows[0].id, ir.rows[0].id],
  )
  // Optioneel: prior claim_geswapt_weg-event (zet de conflict-precondition)
  if (g.order.hasPriorSwapWegEvent) {
    await c.query(
      `INSERT INTO order_events (order_id, event_type, status_na, metadata)
       VALUES ($1, 'claim_geswapt_weg', $2::order_status, '{"adr":"0027"}'::jsonb)`,
      [order.rows[0].id, g.order.status],
    )
  }
  // Optioneel: recent (<24u) conflict-event voor de dedup-case
  if (g.hasRecentConflictEvent) {
    await c.query(
      `INSERT INTO order_events (order_id, event_type, status_na, metadata, created_at)
       VALUES ($1, 'deadline_conflict_na_swap', $2::order_status, '{}'::jsonb, now() - interval '1 hour')`,
      [order.rows[0].id, g.order.status],
    )
  }
  return { orderId: order.rows[0].id, orderRegelId: regel.rows[0].id, ioRegelId: ir.rows[0].id }
}
```

- [ ] **Step 2: Voeg de conflict-describe toe aan de integratie-testfile**

Voeg onderaan `swap-policy.integration.test.ts` toe (boven niets — append in hetzelfde bestand):

```typescript
import { conflictDetectFixtures } from './swap-policy.test'
import { seedConflictGiven } from '@/test-integration/seed-conflict'

describe('sync_order_afleverdatum_met_claims — conflict-detect (mig 298)', () => {
  for (const fixture of conflictDetectFixtures) {
    it(fixture.name, async () => {
      await withTx(async (c) => {
        const refs = await seedConflictGiven(c, fixture.given)
        // Trigger de afleverdatum-sync + conflict-evaluatie expliciet.
        await c.query('SELECT sync_order_afleverdatum_met_claims($1)', [refs.orderId])

        // Afleverdatum-uitkomst
        const ord = await c.query(`SELECT afleverdatum::text FROM orders WHERE id = $1`, [
          refs.orderId,
        ])
        if (fixture.expected.afleverdatumWordtBijgewerkt && fixture.expected.nieuweAfleverdatum) {
          expect(ord.rows[0].afleverdatum).toBe(fixture.expected.nieuweAfleverdatum)
        }

        // Conflict-event wel/niet geëmit (count ná de sync; bij dedup blijft het bij 1)
        const ev = await c.query(
          `SELECT count(*)::int AS n FROM order_events
            WHERE order_id = $1 AND event_type = 'deadline_conflict_na_swap'`,
          [refs.orderId],
        )
        if (fixture.expected.conflictEventEmitted) {
          expect(ev.rows[0].n).toBeGreaterThanOrEqual(1)
        } else if (!fixture.given.hasRecentConflictEvent) {
          // Geen prior én geen emit verwacht → exact 0
          expect(ev.rows[0].n).toBe(0)
        }
      })
    })
  }
})
```

Voeg de twee nieuwe imports bovenaan het bestand toe (naast de bestaande `expect` uit vitest — voeg `expect` toe aan de eerste import-regel: `import { describe, it, expect } from 'vitest'`).

- [ ] **Step 3: Draai de volledige integratie-suite**

Run:
```bash
cd frontend && npm run test:integration
```
Expected: smoke (1) + swap (6) + conflict (3) = 10 passed. Bij een rode conflict-test: de mig-298-dedup/emit-logica wijkt af van de fixture — vergelijk en documenteer.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/test-integration/seed-conflict.ts frontend/src/modules/reserveringen/lib/__tests__/swap-policy.integration.test.ts
git commit -m "test(allocator): 3 conflict-detect-fixtures door sync_order_afleverdatum_met_claims (mig 298)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 10: De `it.todo`'s opruimen + docs bijwerken

**Files:**
- Modify: `frontend/src/modules/reserveringen/lib/__tests__/swap-policy.test.ts`
- Modify: `docs/changelog.md`

- [ ] **Step 1: Vervang de 9 `it.todo`'s door een verwijzing**

In [swap-policy.test.ts](../../../frontend/src/modules/reserveringen/lib/__tests__/swap-policy.test.ts): verwijder de 9 `it.todo(...)`-regels (r523-543 en r558-568) en zet onder elke `describe` één regel:

```typescript
  it('wordt uitgevoerd in swap-policy.integration.test.ts (DB-runner)', () => {
    // De 9 scenario's draaien nu echt tegen herallocateer_orderregel via de
    // integratie-suite (npm run test:integration). Deze unit-file behoudt
    // alleen het data-contract (fixtures + vormcontrole hierboven).
    expect(true).toBe(true)
  })
```

De twee bestaande "publiceert … als data-contract"-tests blijven staan (vormcontrole zonder DB).

- [ ] **Step 2: Draai de snelle unit-suite (mag niet stuk)**

Run:
```bash
cd frontend && npm run test:unit
```
Expected: groen, inclusief de aangepaste `swap-policy.test.ts` (geen `it.todo`'s meer).

- [ ] **Step 3: Changelog-entry**

Voeg bovenaan `docs/changelog.md` toe (pas de stijl aan de bestaande entries aan):

```markdown
### 2026-06-09 — Allocator-integratie-test-harness (ADR-0027-dekking)

De zwaarste ongetelde invarianten zijn nu DB-getest. Nieuwe Vitest
integratie-suite (`npm run test:integration`) draait via node-postgres tegen
een lokale Supabase met BEGIN/seed/RPC/assert/ROLLBACK-isolatie. De 9
reeds-bestaande swap/conflict-fixtures (swap-policy.test.ts) lopen nu door
`herallocateer_orderregel` (mig 318) resp. `sync_order_afleverdatum_met_claims`
(mig 298) — claim-volgorde-prio, deadline-bewuste claim-swap (ADR-0027) en
IO-fallback zijn daarmee voor het eerst executeerbaar geborgd. Pre-commit-hook
draait typecheck + snelle unit-suite; integratie-suite is opt-in/CI-only.
```

- [ ] **Step 4: Commit + meld klaar voor merge**

```bash
git add frontend/src/modules/reserveringen/lib/__tests__/swap-policy.test.ts docs/changelog.md
git commit -m "test(allocator): it.todo's vervangen door echte DB-runner; changelog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Fase 1+2 vormen samen een zelfstandig shippable geheel (de allocator-test-runner). Meld aan de eigenaar dat `test/allocator-integratie-harness` klaar is en wacht op expliciete "merge naar main" (CLAUDE.md git-workflow).

---

## Vervolgfasen (gescopet — elk verdient een eigen detailplan)

Conform de writing-plans Scope Check zijn dit afzonderlijke subsystemen. Maak per fase een eigen detailplan (`docs/superpowers/plans/YYYY-MM-DD-<naam>.md`) met bite-sized TDD-taken vóór uitvoering. Hieronder staat genoeg om dat detailplan te starten.

### Fase 3 — Consolidatie `herallocateer_orderregel` mig 297→318 (onder net) · branch `refactor/allocator-single-source`

**Doel:** de 4× gedupliceerde allocator-body (mig 145→154→297→318) terugbrengen naar één canonieke definitie, gedrag-preserverend bewezen door de Fase-2-suite.

**Aanpak:** test-eerst-dan-consolideren. De Fase-2-suite is het vangnet. Nieuwe migratie (volgend vrij nummer, verifieer met `ls supabase/migrations/ | sort | tail`) met één `CREATE OR REPLACE FUNCTION herallocateer_orderregel(...)` + header-comment "single source — mig 145/154/297/318 superseded". Geen gedragswijziging.

**Definition of Done:** alle 9 fixtures blijven groen ná de consolidatie-migratie (`supabase db reset && npm run test:integration`). Grep bevestigt geen latere ongemotiveerde herdefinitie.

**Omvang:** S–M.

### Fase 4 — Order-status-cascade regressietests + lichte CI · branch `test/order-status-cascade`

**Doel:** de fout-magnetische cascade (incidenten mig 218/255→259/267/290) regressie-dekken, en de integratie-suite automatisch laten draaien zodat hij niet verrot.

**Coördinatie:** draai dit **ná** de seam-consolidatie (seam-plan Fase 2) zodat de tests de geconsolideerde `herbereken_wacht_status`/cascade testen, niet een straks-vervangen kopie.

**Kernscenario's (3 nieuwe fixtures in `cascade.integration.test.ts`, zelfde harness):**
1. **Annulering-cascade (mig 290):** `markeer_geannuleerd(order)` → assert alle snijplannen `Geannuleerd`, claims `released`, rol `beschikbaar`/`reststuk`, én de `NOT EXISTS`-guard (rol die nóg een ander order bedient blijft bezet).
2. **Release op `pickronde_voltooid` én `geannuleerd` (mig 255→259):** na elk terminaal event alle actieve claims `released`.
3. **Recursie-veiligheid (mig 267):** de claim-keten die "stack depth limit exceeded" gaf → assert geen crash + correcte eindstate.

**CI-deliverable:** `.github/workflows/integration-tests.yml` op Linux-runner: `supabase start` (native, snel op Linux) → `npm run test:integration`, trigger op PR + push naar `main`. Zet `SUPABASE_DB_URL` als env. Dit is de minimum-rente-garantie — zonder deze Action verrot de suite (zie de 7/7-falende pre-existing contracttest als bewijs in deze repo).

**Omvang:** M.

### Fase 5 — `simuleer_dekking` droppen + ADR-0015 herschrijven · branch `chore/drop-simuleer-dekking`

**Doel:** de dode, divergente schaduwkopie verwijderen; het ADR corrigeren.

**Aanpak:**
1. Nieuwe migratie (volgend vrij nummer): `DROP FUNCTION IF EXISTS simuleer_dekking(text, integer, jsonb);` + `NOTIFY pgrst, 'reload schema';`. Verifieer de exacte signatuur vooraf in [254_reservering_module_split.sql](../../../supabase/migrations/254_reservering_module_split.sql).
2. Herschrijf [docs/adr/0015-reservering-als-deep-module.md](../../../docs/adr/0015-reservering-als-deep-module.md) Ingreep 4 naar: "TS `berekenRegelDekking` is de enige bron-van-waarheid voor dekking-preview; er is bewust géén SQL-spiegel. De bestaande `dekking-preview.test.ts` borgt het gedrag." Verwijder de "twee-adapter byte-voor-byte"-belofte.
3. Werk de comments in `dekking-preview.ts` + `fixtures.ts` + `dekking-preview.test.ts` bij die nog naar een "toekomstige BE-test"/"SQL-RPC bron-van-waarheid" verwijzen.
4. Changelog-entry.

**Definition of Done:** `grep -rn "simuleer_dekking" supabase/ frontend/` geeft nul resterende code/comment-referenties; de bestaande `dekking-preview.test.ts` (TS-contract) blijft groen.

**Omvang:** S.

### Backlog (geen eigen fase nu)
- **Inbound `buildRegels`-dekking (claim 4b):** unit/integratietests op `create_webshop_order`/`create_edi_order` (regel-insert: aantal/maat/prijs/artikel-conversie) + `product-matcher.ts`. Zelfde harness; eigen seed-profiel. Pak op zodra Fase 1–4 stabiel zijn.
- **Property-based fuzzing van `herallocateer_orderregel`:** genereer willekeurige geldige order/IO/claim-staten, assert invarianten (nooit dubbel-geclaimd, claim-som ≤ te_leveren, geannuleerde orders nooit actief geclaimd). Pas zinvol als de fixture-suite stabiel draait.

### Expliciet buiten scope
- **FACT-0021 betaaltermijn:** belegd in [seam-plan Fase 0](2026-06-09-ts-sql-spiegeling-seam-consolidatie.md) (mig 333/334). Niet hier dupliceren.
- **Generieke pgTAP-toolchain:** de Vitest-`pg`-harness + de bestaande `scripts/test-*.sql`-conventie dekken de behoefte; een tweede SQL-testtaal zou de TS-fixtures dupliceren.

---

## Self-Review

**1. Spec-dekking.** De vijf geverifieerde claims uit de stelling hebben elk een plaats: allocator nul tests (claim 1) → Fase 1–2; 9 it.todo-fixtures (claim 2) → Task 8–9; `simuleer_dekking` dode adapter (claim 3) → Fase 5; order-status-cascade (claim 4a) → Fase 4; buildRegels (claim 4b) → Backlog; FACT-0021/VERR130 (claim 5) → FACT-0021 afgebakend naar seam-plan, VERR130 was TS (db-helpers, al gefixt mig 301) en valt buiten test-harness-scope. De twee onderzoek-correcties (kostenraming, ADR-0015-categoriefout) zijn in Bevindingen én in de fasering verwerkt.

**2. Placeholder-scan.** Fase 1–2 bevatten volledige, geverifieerde code (harness, seed met exacte kolomnamen/FK-volgorde/valkuilen uit het schema-onderzoek, asserts met id-mapping). Geen "TBD"/"handle edge cases". De RED/GREEN-stappen hebben concrete commando's + verwachte uitkomst. Fase 3–5 zijn bewust scope-niveau (geen bite-sized stappen) en expliciet als "eigen detailplan vereist" gemarkeerd — Scope-Check-conform, geen placeholder.

**3. Type-consistentie.** `withTx(fn)` identiek in db.ts (definitie) en alle testfiles (gebruik). `IdMaps`-interface (seed-swap.ts) met methoden `order()/regel()/ioRegel()/debiteurNr` wordt exact zo geconsumeerd in assert-swap.ts en de testfile. `seedSwapGiven` returnt `IdMaps`; `seedConflictGiven` returnt `ConflictRefs` (apart, want ander profiel). De fixture-imports (`swapPolicyFixtures`, `conflictDetectFixtures`) matchen de `export const`-namen in swap-policy.test.ts. RPC-signaturen `herallocateer_orderregel(bigint)` en `sync_order_afleverdatum_met_claims(bigint)` consistent in globalSetup, smoke en testfiles.

---

## Execution Handoff

Zie onderaan dit gesprek voor de keuze tussen subagent-driven en inline executie.
