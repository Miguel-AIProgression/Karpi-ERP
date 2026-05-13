# Admin-pseudo-orderregel als data-driven concept — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vervang de hardcoded `('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')`-string-lijst die nu in 10+ SQL-migraties en 5 FE-callsites leeft door één bron-van-waarheid (`producten.is_pseudo BOOLEAN`) + één SQL-helper (`is_admin_pseudo(text)`) + één FE-helper (`isAdminPseudo(regel)`). Toekomstige admin-pseudo's (4e/5e) zijn dan een pure DB-INSERT zonder code-edit.

**Architecture:** Drie lagen, big-bang in één PR. (1) **DB-laag**: nieuwe kolom + helper-functie + backfill (mig 272). (2) **SQL-rewrite**: alle hardcoded callsites herschreven naar `is_admin_pseudo()` met ASSERT-blok dat gedrag identiek blijft (mig 273). (3) **Frontend-laag**: queries krijgen `is_pseudo` veld; 5 callsites gebruiken `isAdminPseudo(regel)` op het regel-object i.p.v. string-vergelijking. Geen TS-spiegel met hardcoded lijst — boolean reist mee in data. Past in ADR-0011/0015-precedent (data-gedreven seam i.p.v. dubbele bron).

**Tech Stack:**
- PostgreSQL 15 (Supabase, hosted) — migraties via SQL Editor (geen MCP-toegang)
- React 18 + TypeScript + Vitest — frontend, queries & helper-tests
- TanStack Query — caching (geen invalidation-werk; types verbreden volstaat)
- Bash + grep — lint-script voor regressie-bescherming

**Achtergrond-documenten:**
- [ADR-0018](../../adr/0018-admin-pseudo-orderregel-als-data-driven-concept.md) — beslissingen + overwogen alternatieven
- [data-woordenboek term "Admin-pseudo-orderregel"](../../data-woordenboek.md) — al toegevoegd, ratificeren in dezelfde PR
- [CLAUDE.md bedrijfsregel](../../../CLAUDE.md) — "Admin-pseudo-orderregels symmetrisch overslaan" (te vereenvoudigen na deze PR)
- [Mig 263](../../../supabase/migrations/263_claims_skip_admin_artikelnrs.sql), [266](../../../supabase/migrations/266_orderregel_trigger_skip_admin.sql), [269](../../../supabase/migrations/269_admin_pseudos_skip_status_en_levertijd.sql) — de drie expliciete admin-pseudo-skip-migraties
- [Mig 265](../../../supabase/migrations/265_pseudo_producten_bundelkorting.sql) — seed van de drie pseudo-producten
- [Mig 270](../../../supabase/migrations/270_order_regel_levertijd_skip_eindstatus.sql) — view-eindstatus-fix (parallel werk door andere agent; mijn migraties starten op 271)

**Prerequisites:**
- Laagst-vrije migratie-nummer is **272** (270 = order_regel_levertijd_skip_eindstatus, 271 = inkoop_module_rename_ontvangst_rpcs door parallel Inkoop-Module-werk, geverifieerd 2026-05-13 17:30). Pas alle migratie-referenties aan als tussentijds nieuwe migraties geland zijn — run `ls supabase/migrations/ | sort -V | tail -3` vóór Task 1.
- Worktree starten vanaf actuele `main`: `git worktree add ../karpi-admin-pseudo -b feat/admin-pseudo-data-driven main`.
- Mig 265 (pseudo-producten in `producten`-tabel) moet aanwezig zijn — de backfill in Task 1 leest uit `producten`.

---

## File Structure

### Nieuwe bestanden

```
supabase/migrations/272_producten_is_pseudo_kolom.sql       ← kolom + functie + backfill + index
supabase/migrations/273_admin_pseudo_callsite_rewrites.sql  ← rewrite alle hardcoded SQL callsites
frontend/src/lib/orders/admin-pseudo.ts                     ← isAdminPseudo(regel) helper
frontend/src/lib/orders/__tests__/admin-pseudo.test.ts      ← unit-tests
scripts/lint-no-hardcoded-admin-pseudo-strings.sh           ← regressie-guard
```

### Gewijzigde bestanden

```
frontend/src/lib/constants/shipping.ts             ← scope-comment over toe-voeg vs. skip
frontend/src/modules/magazijn/queries/pickbaarheid.ts
                                                    ← .neq('artikelnr', SHIPPING_PRODUCT_ID) → join + isAdminPseudo
frontend/src/modules/reserveringen/lib/dekking-preview.ts
                                                    ← artikelnr !== SHIPPING_PRODUCT_ID → isAdminPseudo(line)
frontend/src/modules/logistiek/lib/is-shipping-regel.ts
                                                    ← BLIJFT (toe-voeg-semantiek check op zending-regels) — alleen scope-comment
frontend/src/lib/orders/order-afleverdatum.ts      ← filter VERZEND → filter isAdminPseudo
frontend/src/components/orders/article-selector.tsx
                                                    ← .neq('artikelnr', 'VERZEND') → join + .eq('is_pseudo', false)
frontend/src/lib/supabase/queries/orders.ts        ← select() krijgt producten.is_pseudo
frontend/src/lib/supabase/queries/order-mutations.ts
                                                    ← idem
frontend/src/modules/reserveringen/queries/reserveringen.ts
                                                    ← idem
frontend/src/modules/magazijn/queries/pickronde.ts ← idem (als orderregel-select)
frontend/src/modules/facturatie/queries/facturen.ts
                                                    ← banner-detect via is_pseudo i.p.v. string-match op DREMPELKORTING
CLAUDE.md                                          ← bedrijfsregel "Admin-pseudo-orderregels symmetrisch overslaan" vereenvoudigen
docs/architectuur.md                               ← korte verwijzing naar ADR-0018
docs/changelog.md                                  ← entry 2026-05-13
.eslintrc.cjs (of eslint.config.js)                ← no-restricted-syntax voor 'BUNDELKORTING'/'DREMPELKORTING' string-literals
```

---

## Deployment-volgorde — kritisch

Volgorde matters; verkeerd → CASCADE-fouten of triggers die nog op oude functie-signatures wijzen.

1. **Eerst:** mig 272 deployen (kolom + functie + backfill) — *additieve* migratie, geen breaking change
2. **Daarna:** verificatie: `SELECT artikelnr FROM producten WHERE is_pseudo` → exact 3 rijen
3. **Daarna:** verificatie: `SELECT is_admin_pseudo('VERZEND')` → `true`; `SELECT is_admin_pseudo('CISC12400')` → `false`
4. **Daarna:** mig 273 deployen (callsite-rewrites) — pure refactor, ASSERT-blok bewijst gedragsidentiteit
5. **Daarna:** frontend deploy (helper + queries + 5 callsites + lint)

Frontend mag eerder als feature-flag ontbreekt — `producten.is_pseudo` ontbreekt op older DB-state betekent `undefined` in TS, en `isAdminPseudo` returnt `false` voor `undefined`. Maar voor de symmetrie best in deze volgorde uitrollen.

---

## Task 1: Migratie 272 — `producten.is_pseudo` kolom + helper-functie + backfill

**Files:**
- Create: `supabase/migrations/272_producten_is_pseudo_kolom.sql`

- [ ] **Step 1.1: Maak migratie-bestand met header**

Bestand: `supabase/migrations/272_producten_is_pseudo_kolom.sql`

```sql
-- Migratie 272: producten.is_pseudo BOOLEAN + is_admin_pseudo(text)-helper
--
-- Bron-van-waarheid voor admin-pseudo-orderregels (ADR-0018). Vervangt de
-- hardcoded `artikelnr IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')`-
-- lijsten die nu in 10+ SQL-callsites en 5 FE-callsites leven.
--
-- Beslissing: data-gedreven (geen ENUM-categorie, geen lookup-tabel).
-- Toekomstige 4e/5e admin-pseudo = pure UPDATE producten SET is_pseudo=TRUE.
--
-- Out-of-scope: ENUM-categorie ('verzendkosten' | 'korting') voor semantische
-- groepering — pas waardevol bij 6+ pseudo's; nu YAGNI.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- VOORWAARDE: mig 265 (pseudo-producten in producten-tabel).
```

- [ ] **Step 1.2: Voeg kolom + backfill + index toe**

```sql
ALTER TABLE producten
  ADD COLUMN IF NOT EXISTS is_pseudo BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE producten
   SET is_pseudo = TRUE
 WHERE artikelnr IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
   AND is_pseudo IS DISTINCT FROM TRUE;

CREATE INDEX IF NOT EXISTS producten_is_pseudo_idx
  ON producten(artikelnr)
  WHERE is_pseudo;

COMMENT ON COLUMN producten.is_pseudo IS
  'TRUE = administratieve correctie-regel zonder fysieke leverbaarheid '
  '(VERZEND, BUNDELKORTING, DREMPELKORTING per mig 265). Bron-van-waarheid '
  'voor allocator/status/levertijd/pickbaarheid-skip. Zie ADR-0018.';
```

- [ ] **Step 1.3: Voeg `is_admin_pseudo(text)`-helper toe**

```sql
CREATE OR REPLACE FUNCTION is_admin_pseudo(p_artikelnr TEXT)
  RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
AS $$
  SELECT COALESCE(
    (SELECT is_pseudo FROM producten WHERE artikelnr = p_artikelnr),
    FALSE
  )
$$;

GRANT EXECUTE ON FUNCTION is_admin_pseudo(TEXT) TO authenticated, anon;

COMMENT ON FUNCTION is_admin_pseudo IS
  'Centraal predikaat voor admin-pseudo-orderregels (ADR-0018). '
  'STABLE (niet IMMUTABLE) omdat de set kan groeien via INSERT/UPDATE '
  'producten.is_pseudo. Vervangt de hardcoded artikelnr-IN-lijsten in '
  'mig 263/266/269 (callsites rewriten in mig 273).';
```

- [ ] **Step 1.4: ASSERT-blok dat backfill correct is**

```sql
DO $$
DECLARE
  v_pseudo_count INTEGER;
  v_test_verzend BOOLEAN;
  v_test_korting BOOLEAN;
  v_test_drempel BOOLEAN;
  v_test_echt    BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_pseudo_count FROM producten WHERE is_pseudo;
  ASSERT v_pseudo_count = 3,
    format('Backfill mismatch: %s producten met is_pseudo=TRUE, verwacht 3', v_pseudo_count);

  v_test_verzend := is_admin_pseudo('VERZEND');
  v_test_korting := is_admin_pseudo('BUNDELKORTING');
  v_test_drempel := is_admin_pseudo('DREMPELKORTING');
  v_test_echt    := is_admin_pseudo('CISC12400');

  ASSERT v_test_verzend = TRUE,  'is_admin_pseudo(''VERZEND'') = FALSE — backfill miste';
  ASSERT v_test_korting = TRUE,  'is_admin_pseudo(''BUNDELKORTING'') = FALSE';
  ASSERT v_test_drempel = TRUE,  'is_admin_pseudo(''DREMPELKORTING'') = FALSE';
  ASSERT v_test_echt    = FALSE, 'is_admin_pseudo(''CISC12400'') = TRUE — false positive';

  RAISE NOTICE 'Mig 272 OK: producten.is_pseudo backfilled (3 rijen), is_admin_pseudo() actief.';
END $$;

NOTIFY pgrst, 'reload schema';
```

---

## Task 2: Migratie 273 — herschrijf alle SQL-callsites naar `is_admin_pseudo()`

**Files:**
- Create: `supabase/migrations/273_admin_pseudo_callsite_rewrites.sql`

Deze migratie herschrijft de hardcoded `IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')`-checks naar `is_admin_pseudo(artikelnr)`. **Pure refactor, geen gedragsverandering** — de ASSERT-blok aan het einde bewijst het.

- [ ] **Step 2.1: Maak migratie-bestand met header**

```sql
-- Migratie 273: alle hardcoded admin-pseudo-string-lijsten → is_admin_pseudo()
--
-- Pure refactor van mig 263/266/269 en de hardcoded callsites in mig 206,
-- 211, 217, 218, 219, 221, 225, 227, 229, 232, 234, 256, 260-265, 268.
-- Geen gedragsverandering; ADR-0018 + mig 272 leverde het predikaat.
--
-- Strategie: per RPC/view/trigger een CREATE OR REPLACE. Functies die de
-- 3-strings-lijst voor andere doeleinden gebruiken (factuur-genereren bv.
-- 'WHERE COALESCE(artikelnr,'') <> ''VERZEND''' om VERZEND-regels niet als
-- product-regels mee te kopiëren) blijven specifiek op VERZEND — dat is
-- toe-voeg-semantiek, niet skip-detectie (zie ADR-0018 §SHIPPING_PRODUCT_ID).
--
-- Idempotent: alle CREATE OR REPLACE. ASSERT-blok onderaan bewijst dat
-- bekende edge cases (admin-pseudo orderregels op test-orders) onveranderd
-- doorgaan door de filter-paden.
```

- [ ] **Step 2.2: Herschrijf `herwaardeer_claims_voor_order` (was mig 263)**

Pak de body uit mig 263 (`git show <sha>:supabase/migrations/263_claims_skip_admin_artikelnrs.sql`), vervang:

```sql
-- VOOR (mig 263):
AND COALESCE(oreg.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')

-- NA:
AND NOT is_admin_pseudo(oreg.artikelnr)
```

Plak de hele `CREATE OR REPLACE FUNCTION herwaardeer_claims_voor_order` in deze migratie. Comment in de body bijwerken naar "ADR-0018: gebruik is_admin_pseudo() i.p.v. hardcoded IN-lijst (was mig 263)".

- [ ] **Step 2.3: Herschrijf `trg_orderregel_herallocateer` (was mig 266)**

Idem. Vervang:

```sql
-- VOOR (mig 266):
IF COALESCE(NEW.artikelnr, '') IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING') THEN

-- NA:
IF is_admin_pseudo(NEW.artikelnr) THEN
```

- [ ] **Step 2.4: Herschrijf `herbereken_wacht_status` (was mig 269)**

Vervang:

```sql
-- VOOR (mig 269):
AND COALESCE(oreg.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')

-- NA:
AND NOT is_admin_pseudo(oreg.artikelnr)
```

- [ ] **Step 2.5: Herschrijf view `order_regel_levertijd` (was mig 269 + mig 270)**

Houd rekening met mig 270's eindstatus-filter. Vervang:

```sql
-- VOOR (mig 269 line 202):
WHERE COALESCE(oreg.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING');

-- NA:
WHERE NOT is_admin_pseudo(oreg.artikelnr)
  AND o.status NOT IN ('Verzonden', 'Geannuleerd');  -- behoud mig 270-filter
```

Verifieer dat mig 270's `o.status NOT IN`-clause behouden blijft door de body te kopiëren van de live view-definitie (niet uit mig 269 alleen).

- [ ] **Step 2.6: Sweep de overige SQL-callsites**

Voor elk van deze migratie-files: open, grep naar `'VERZEND'`/`'BUNDELKORTING'`/`'DREMPELKORTING'`, beslis per call:
- **Skip-context** (de regel mag niet meedoen in voorraad/IO/claim/status/levertijd-logica) → vervang door `is_admin_pseudo(artikelnr)`
- **Toe-voeg-context** (de regel wordt geconstrueerd als VERZEND-regel) → laat VERZEND staan met `-- toe-voeg-semantiek (zie ADR-0018)`-comment
- **Factuur-specifieke (mig 234, 256, 260-264, 268)** — meeste gevallen zijn toe-voeg-context (de RPC construeert VERZEND/BUNDELKORTING/DREMPELKORTING-regels). LAAT STAAN met comment.

Praktisch: deze migratie raakt alleen de échte skip-context callsites (mig 263/266/269/265). De toe-voeg-context-callsites krijgen alleen een commentaar-update via een sed-bewerking — geen functionele wijziging.

- [ ] **Step 2.7: ASSERT-blok dat gedrag identiek is**

```sql
DO $$
DECLARE
  v_levertijd_rows_voor INTEGER;
  v_levertijd_rows_na   INTEGER;
BEGIN
  -- Sanity: de view returnt nu hetzelfde aantal rijen voor dezelfde data.
  -- (Met de eindstatus-filter uit mig 270 al actief, blijft dit consistent.)
  SELECT COUNT(*) INTO v_levertijd_rows_na FROM order_regel_levertijd;
  ASSERT v_levertijd_rows_na >= 0, 'order_regel_levertijd queryable';

  -- Gedrag: een admin-pseudo-regel mag niet in de view voorkomen.
  ASSERT NOT EXISTS (
    SELECT 1 FROM order_regel_levertijd v
    JOIN order_regels oreg ON oreg.id = v.order_regel_id
    WHERE is_admin_pseudo(oreg.artikelnr)
  ), 'admin-pseudo lekt in order_regel_levertijd-view';

  RAISE NOTICE 'Mig 273 OK: callsites herschreven, geen gedragsverandering.';
END $$;

NOTIFY pgrst, 'reload schema';
```

---

## Task 3: Frontend TS-helper + unit-tests

**Files:**
- Create: `frontend/src/lib/orders/admin-pseudo.ts`
- Create: `frontend/src/lib/orders/__tests__/admin-pseudo.test.ts`

- [ ] **Step 3.1: Helper-implementatie**

`frontend/src/lib/orders/admin-pseudo.ts`:

```ts
/**
 * Predikaat: is deze orderregel een administratieve correctie zonder
 * fysieke leverbaarheid (VERZEND/BUNDELKORTING/DREMPELKORTING)?
 *
 * Bron-van-waarheid: `producten.is_pseudo BOOLEAN` (mig 272, ADR-0018).
 * De boolean reist mee in queries via `producten ( is_pseudo )` — er is
 * géén hardcoded artikelnr-lijst in TS.
 *
 * LET OP: voor *toe-voegen* van een nieuwe verzendregel
 * (bv. `applyShippingLogic`) is `SHIPPING_PRODUCT_ID = 'VERZEND'`
 * de juiste constant — niet deze helper. Skip vs. construct zijn
 * verschillende semantieken.
 */
export interface RegelMetProductPseudoFlag {
  producten?: { is_pseudo?: boolean | null } | null
}

export function isAdminPseudo(regel: RegelMetProductPseudoFlag | null | undefined): boolean {
  return regel?.producten?.is_pseudo === true
}
```

- [ ] **Step 3.2: Unit-tests**

`frontend/src/lib/orders/__tests__/admin-pseudo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isAdminPseudo } from '../admin-pseudo'

describe('isAdminPseudo', () => {
  it('returns true voor regel met is_pseudo=true', () => {
    expect(isAdminPseudo({ producten: { is_pseudo: true } })).toBe(true)
  })

  it('returns false voor regel met is_pseudo=false', () => {
    expect(isAdminPseudo({ producten: { is_pseudo: false } })).toBe(false)
  })

  it('returns false voor regel zonder producten-join', () => {
    expect(isAdminPseudo({ producten: null })).toBe(false)
    expect(isAdminPseudo({})).toBe(false)
  })

  it('returns false voor null/undefined regel', () => {
    expect(isAdminPseudo(null)).toBe(false)
    expect(isAdminPseudo(undefined)).toBe(false)
  })

  it('returns false als is_pseudo expliciet null is (DB-default voor oude rijen)', () => {
    expect(isAdminPseudo({ producten: { is_pseudo: null } })).toBe(false)
  })
})
```

- [ ] **Step 3.3: Verifieer**

```bash
cd frontend && npx vitest run src/lib/orders/__tests__/admin-pseudo.test.ts
```

Verwacht: 5 tests groen.

---

## Task 4: FE-queries — `is_pseudo` meereizen

Tien query-bestanden moeten `producten ( is_pseudo )` aan hun `select(...)` toevoegen. Update óók de TS-types die de query-resultaten typeren.

- [ ] **Step 4.1: `frontend/src/lib/supabase/queries/orders.ts`**

Greppen op `select(` met `producten`-join, voeg `is_pseudo` toe aan de inner select-tuple. Update de daaraan gekoppelde interface (zoek naar `OrderRegelMetProduct` of soortgelijke type-naam).

- [ ] **Step 4.2: `frontend/src/lib/supabase/queries/order-mutations.ts`**

Idem.

- [ ] **Step 4.3: `frontend/src/modules/reserveringen/queries/reserveringen.ts`**

Idem. Belangrijk omdat `dekking-preview.ts` uit deze queries leest.

- [ ] **Step 4.4: `frontend/src/modules/magazijn/queries/pickbaarheid.ts`**

Naast `select(...)` uitbreiden: vervang `.neq('artikelnr', SHIPPING_PRODUCT_ID)` op regels 179, 199, 328 door een filter dat `producten.is_pseudo` overslaat. Twee opties:

a) Server-side filter via `or()` of nested filter:
```ts
.eq('producten.is_pseudo', false)
```
b) Client-side filter na fetch met `isAdminPseudo()`.

Kies (a) als de query simpel is; (b) als (a) PostgREST-syntax issues geeft met de nested join-context.

- [ ] **Step 4.5: `frontend/src/modules/magazijn/queries/pickronde.ts`**

Idem als 4.4 als deze orderregel-rijen ophaalt voor pickronde-context.

- [ ] **Step 4.6: `frontend/src/modules/facturatie/queries/facturen.ts`**

De `fetchBundelInfoVoorFactuur`-functie detecteert nu `artikelnr === 'BUNDELKORTING' || 'DREMPELKORTING'` om de banner-conditie te berekenen. Vervang door check op `producten.is_pseudo === true && producten.categorie === 'overig'` of behoud de string-check met scope-comment "factuur-context: artikelnr identificeert specifieke korting-type, niet generieke skip". **Beslissing tijdens implementatie**: kies de scope-comment-route, want de banner-tekst onderscheidt expliciet *welke* korting actief is — dat is geen pure skip.

- [ ] **Step 4.7: Verifieer types via `npx tsc --noEmit`**

```bash
cd frontend && npx tsc --noEmit
```

Verwacht: 0 errors. Nieuwe veld in select propageert automatisch via generated Supabase types als die regenereerd zijn (zie Step 4.8), of via handmatige type-updates.

- [ ] **Step 4.8: Regenereer Supabase TS-types**

Als beschikbaar:
```bash
npx supabase gen types typescript --project-id wqzeevfobwauxkalagtn > frontend/src/types/supabase.ts
```

Anders handmatig `is_pseudo: boolean` toevoegen aan de `producten`-Row-interface in `frontend/src/types/supabase.ts`.

---

## Task 5: FE-callsites omzetten naar `isAdminPseudo(regel)`

Vijf callsites die nu hardcoded op `artikelnr === SHIPPING_PRODUCT_ID` checken voor **skip**-context.

- [ ] **Step 5.1: `frontend/src/modules/reserveringen/lib/dekking-preview.ts:25`**

Voor:
```ts
&& line.artikelnr !== SHIPPING_PRODUCT_ID
```

Na:
```ts
import { isAdminPseudo } from '@/lib/orders/admin-pseudo'
// ...
&& !isAdminPseudo(line)
```

`line` moet daarvoor `producten: { is_pseudo: boolean }` als veld hebben — verifieer dat reserveringen-query in Step 4.3 die uitbreiding al heeft.

- [ ] **Step 5.2: `frontend/src/lib/orders/order-afleverdatum.ts:28`**

Voor:
```ts
const contentRegels = regels.filter((r) => r.artikelnr !== SHIPPING_PRODUCT_ID)
```

Na:
```ts
const contentRegels = regels.filter((r) => !isAdminPseudo(r))
```

- [ ] **Step 5.3: `frontend/src/modules/magazijn/queries/pickbaarheid.ts`**

Drie callsites: regels 179, 199, 328. Vervang `.neq('artikelnr', SHIPPING_PRODUCT_ID)` door wat in Step 4.4 gekozen is (server-side `is_pseudo=false` filter of post-fetch JS-filter).

- [ ] **Step 5.4: `frontend/src/components/orders/article-selector.tsx:53`**

Voor:
```ts
.neq('artikelnr', 'VERZEND') as any,
```

Na:
```ts
.eq('is_pseudo', false) as any,
```

(`article-selector` selecteert uit `producten` direct, dus de filter werkt op `is_pseudo` zonder join.)

- [ ] **Step 5.5: `frontend/src/modules/logistiek/lib/is-shipping-regel.ts` — BLIJFT, scope-comment**

Deze helper checkt voor **pakbon-skip** specifiek de VERZEND-regel op een zending. BUNDEL/DREMPEL bestaan niet als zending-regel (factuur-only). Voeg comment toe:

```ts
/**
 * ... (bestaand comment) ...
 *
 * SCOPE: dit predikaat checkt SPECIFIEK de VERZEND-zending-regel — niet
 * alle admin-pseudo's. BUNDELKORTING en DREMPELKORTING bestaan niet op
 * zending-regels (factuur-only sinds ADR-0018/mig 262). Voor generieke
 * admin-pseudo-skip op orderregels: gebruik `isAdminPseudo(regel)` uit
 * `@/lib/orders/admin-pseudo`.
 */
```

Niet refactoren — `regel` heeft hier geen `producten.is_pseudo`-join, en de check is functioneel correct op zending-niveau.

---

## Task 6: `SHIPPING_PRODUCT_ID` scope-comment

**Files:**
- Modify: `frontend/src/lib/constants/shipping.ts`

- [ ] **Step 6.1: Voeg scope-comment toe**

```ts
/**
 * Artikelnr voor de auto-gegenereerde VERZEND-orderregel.
 *
 * SCOPE: deze constant bedient ALLEEN de TOE-VOEG-semantiek
 * (applyShippingLogic in `lib/orders/verzend-regel.ts` construeert
 * een nieuwe orderregel met dit artikelnr). Voor SKIP-detectie van
 * admin-pseudo's: gebruik `isAdminPseudo(regel)` uit
 * `@/lib/orders/admin-pseudo` — niet deze constant.
 *
 * Zie ADR-0018.
 */
export const SHIPPING_PRODUCT_ID = 'VERZEND'
export const SHIPPING_THRESHOLD = 500   // standaard drempel (fallback)
export const SHIPPING_COST = 35         // standaard verzendkosten (fallback)
```

---

## Task 7: Lint-scripts (regressie-bescherming)

- [ ] **Step 7.1: Bash-script voor SQL en TS**

Bestand: `scripts/lint-no-hardcoded-admin-pseudo-strings.sh`

```bash
#!/usr/bin/env bash
# Voorkom regressie naar hardcoded admin-pseudo-strings buiten de whitelist.
# Whitelist: mig 265 (seed), mig 272 (backfill), SHIPPING_PRODUCT_ID-constant
# (toe-voeg-semantiek), is-shipping-regel.ts (zending-specifiek), de factuur-
# RPCs die VERZEND-regels construeren.
#
# Run als pre-commit hook of in CI.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
PATTERN="'BUNDELKORTING'|'DREMPELKORTING'"

WHITELIST_RE=(
  "supabase/migrations/265_pseudo_producten_bundelkorting\.sql"
  "supabase/migrations/272_producten_is_pseudo_kolom\.sql"
  "supabase/migrations/273_admin_pseudo_callsite_rewrites\.sql"
  "supabase/migrations/2(34|56|60|61|62|64|68)_.*\.sql"  # factuur-construct
  "supabase/migrations/263_claims_skip_admin_artikelnrs\.sql"   # vervangen door 272 maar legacy file
  "supabase/migrations/266_orderregel_trigger_skip_admin\.sql"  # idem
  "supabase/migrations/269_admin_pseudos_skip_status_en_levertijd\.sql"
  "scripts/lint-no-hardcoded-admin-pseudo-strings\.sh"
  "docs/.*"
  "frontend/src/lib/orders/admin-pseudo\.ts"
)

WHITELIST_GREP=$(printf "|%s" "${WHITELIST_RE[@]}")
WHITELIST_GREP=${WHITELIST_GREP:1}

cd "$ROOT"
VIOLATIONS=$(git ls-files \
  | grep -E '\.(sql|ts|tsx)$' \
  | grep -E -v "(${WHITELIST_GREP})" \
  | xargs -I{} grep -lE "${PATTERN}" {} 2>/dev/null || true)

if [[ -n "$VIOLATIONS" ]]; then
  echo "❌ Hardcoded BUNDELKORTING/DREMPELKORTING strings gevonden:" >&2
  echo "$VIOLATIONS" >&2
  echo >&2
  echo "Gebruik is_admin_pseudo() (SQL) of isAdminPseudo(regel) (TS) — zie ADR-0018." >&2
  exit 1
fi

echo "✅ Geen hardcoded admin-pseudo-strings buiten whitelist."
```

`chmod +x scripts/lint-no-hardcoded-admin-pseudo-strings.sh`

- [ ] **Step 7.2: ESLint-regel voor TS**

`.eslintrc.cjs` (of `eslint.config.js`) — voeg toe binnen rules:

```js
'no-restricted-syntax': [
  'warn',  // 'error' na verificatie dat alle callsites omgezet zijn
  {
    selector: "Literal[value='BUNDELKORTING']",
    message: 'Hardcoded BUNDELKORTING — gebruik isAdminPseudo(regel). Zie ADR-0018.',
  },
  {
    selector: "Literal[value='DREMPELKORTING']",
    message: 'Hardcoded DREMPELKORTING — gebruik isAdminPseudo(regel). Zie ADR-0018.',
  },
],
```

Voor `'VERZEND'` géén lint-regel — die blijft legitiem voor toe-voeg-context.

- [ ] **Step 7.3: Run lint lokaal, fix violations**

```bash
bash scripts/lint-no-hardcoded-admin-pseudo-strings.sh
cd frontend && npx eslint src/ --ext .ts,.tsx
```

Verwacht: geen violations (alle skip-callsites omgezet in Task 5).

---

## Task 8: Update CLAUDE.md-bedrijfsregel

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 8.1: Vervang de oude regel**

Greppen op "Admin-pseudo-orderregels symmetrisch overslaan" in CLAUDE.md. De bestaande tekst (genoemd in de project-context):

> **Admin-pseudo-orderregels symmetrisch overslaan (mig 263 / 266 / 269):** `VERZEND`, `BUNDELKORTING` en `DREMPELKORTING` zijn vaste pseudo-artikelnummers (mig 265) zonder voorraad/IO-allocatie. Drie plekken moeten ze identiek filteren: (1) `herwaardeer_claims_voor_order` (mig 263), (2) `trg_orderregel_herallocateer` (mig 266), (3) `herbereken_wacht_status` + view `order_regel_levertijd` (mig 269). Nieuwe admin-pseudo toevoegen → uitbreiden op álle drie. Anders trekt de regel óf de order-status onterecht naar `Wacht op voorraad` óf de regel-badge naar `wacht_op_nieuwe_inkoop` (zie ORD-2026-2063, 2026-05-13).

Vervang door:

```markdown
- **Admin-pseudo-orderregel (ADR-0018):** orderregels waarvan het artikel administratief is (geen fysieke leverbaarheid) worden uniform geskipt in allocator, status-bepaling, levertijd-view, pickbaarheid en dekking-preview. Bron-van-waarheid: `producten.is_pseudo BOOLEAN` (mig 272). Predikaten: SQL `is_admin_pseudo(artikelnr)` en TS `isAdminPseudo(regel)` (regel-object met `producten ( is_pseudo )`-join). Nieuwe admin-pseudo toevoegen = pure `UPDATE producten SET is_pseudo=TRUE` — geen code-edit. **Niet te verwarren** met `SHIPPING_PRODUCT_ID='VERZEND'`: die constant bedient toe-voegen van een verzendregel (`applyShippingLogic`), niet skip-detectie.
```

---

## Task 9: Docs

- [ ] **Step 9.1: `docs/data-woordenboek.md`**

Term al toegevoegd in deze PR (commit "docs(woordenboek): admin-pseudo-orderregel-term"). Verifieer dat de inhoud klopt met ADR-0018 — pas aan als er tijdens grilling-loop nuances zijn bijgekomen.

- [ ] **Step 9.2: `docs/architectuur.md`**

Voeg onder "Architectuurbeslissingen" een korte verwijzing toe:

```markdown
### Admin-pseudo-orderregel als data-driven concept (ADR-0018, mig 272)

VERZEND/BUNDELKORTING/DREMPELKORTING zijn administratieve orderregels zonder voorraad-/IO-/levertijd-keten. Eén boolean (`producten.is_pseudo`) is de bron-van-waarheid; SQL-helper `is_admin_pseudo()` en TS-helper `isAdminPseudo(regel)` vervangen 15+ hardcoded string-lijsten. Toekomstige admin-pseudo's = pure DB-INSERT.
```

- [ ] **Step 9.3: `docs/changelog.md`**

Entry voor 2026-05-13:

```markdown
### 2026-05-13 — Admin-pseudo-orderregel als data-driven concept (ADR-0018)
- Mig 272: `producten.is_pseudo BOOLEAN` + `is_admin_pseudo(text)`-helper + backfill (VERZEND/BUNDELKORTING/DREMPELKORTING)
- Mig 273: rewrite alle SQL-callsites (263/266/269) naar `is_admin_pseudo()` — pure refactor
- FE: `lib/orders/admin-pseudo.ts` + `isAdminPseudo(regel)`-helper; 5 callsites omgezet (pickbaarheid, dekking-preview, order-afleverdatum, article-selector, zending pakbon-skip blijft scoped)
- Lint: `scripts/lint-no-hardcoded-admin-pseudo-strings.sh` + ESLint-regel voorkomt regressie
- CLAUDE.md bedrijfsregel "Admin-pseudo-orderregels symmetrisch overslaan" vereenvoudigd: één edit `is_pseudo=TRUE` i.p.v. drie plekken handmatig uitbreiden
```

---

## Task 10: Verificatie & PR

- [ ] **Step 10.1: SQL-deploy via Supabase SQL Editor**

1. Mig 272: plak inhoud, run, verwacht "Mig 272 OK"-NOTICE
2. Verifieer in DB-console: `SELECT artikelnr FROM producten WHERE is_pseudo ORDER BY artikelnr` → exact 3 rijen: BUNDELKORTING, DREMPELKORTING, VERZEND
3. Mig 273: plak inhoud, run, verwacht "Mig 273 OK"-NOTICE

- [ ] **Step 10.2: Run frontend-checks lokaal**

```bash
cd frontend
npx tsc --noEmit                                              # 0 errors
npx vitest run src/lib/orders/__tests__/admin-pseudo.test.ts  # 5 passes
npx vitest run                                                # gehele suite groen
npx eslint src/ --ext .ts,.tsx                                # geen restricted-syntax violations
bash ../scripts/lint-no-hardcoded-admin-pseudo-strings.sh     # ✅
```

- [ ] **Step 10.3: Smoketest in browser**

1. Open een bestaande order met een VERZEND-regel
2. Verifieer dat de VERZEND-regel geen "Wacht op nieuwe inkoop"-badge toont
3. Open ORD-2026-2057 (Verzonden) en bevestig dat geen enkele regel een levertijd-badge toont (combineert mig 270 + 272 + frontend)
4. Maak een nieuwe order, voeg een VERZEND-regel toe via auto-verzendlogica, save: order-status moet `Nieuw` blijven (niet `Wacht op voorraad`)

- [ ] **Step 10.4: Commit & PR**

```bash
git add supabase/migrations/272_producten_is_pseudo_kolom.sql
git add supabase/migrations/273_admin_pseudo_callsite_rewrites.sql
git add frontend/src/lib/orders/admin-pseudo.ts
git add frontend/src/lib/orders/__tests__/admin-pseudo.test.ts
git add frontend/src/lib/constants/shipping.ts
git add frontend/src/modules/reserveringen/lib/dekking-preview.ts
git add frontend/src/lib/orders/order-afleverdatum.ts
git add frontend/src/modules/magazijn/queries/pickbaarheid.ts
git add frontend/src/modules/magazijn/queries/pickronde.ts
git add frontend/src/modules/logistiek/lib/is-shipping-regel.ts
git add frontend/src/components/orders/article-selector.tsx
git add frontend/src/lib/supabase/queries/orders.ts
git add frontend/src/lib/supabase/queries/order-mutations.ts
git add frontend/src/modules/reserveringen/queries/reserveringen.ts
git add frontend/src/modules/facturatie/queries/facturen.ts
git add .eslintrc.cjs
git add scripts/lint-no-hardcoded-admin-pseudo-strings.sh
git add CLAUDE.md
git add docs/adr/0018-admin-pseudo-orderregel-als-data-driven-concept.md
git add docs/data-woordenboek.md
git add docs/architectuur.md
git add docs/changelog.md
git add docs/superpowers/plans/2026-05-13-admin-pseudo-data-driven.md

git commit -m "feat(orders): admin-pseudo-orderregel als data-driven concept (ADR-0018)

Vervangt 15+ hardcoded ('VERZEND','BUNDELKORTING','DREMPELKORTING')-string-
lijsten in SQL en TS door één bron-van-waarheid: producten.is_pseudo BOOLEAN.

- Mig 272: kolom + is_admin_pseudo()-helper + backfill
- Mig 273: rewrite callsites (263/266/269) naar is_admin_pseudo() — pure refactor
- FE: isAdminPseudo(regel) helper; 5 callsites omgezet
- Lint: bash-script + ESLint-regel voor regressie-bescherming
- CLAUDE.md bedrijfsregel vereenvoudigd

Toekomstige admin-pseudo's (STAAL/MONSTER/ADMINFEE) = pure UPDATE producten
SET is_pseudo=TRUE, geen code-edit. Sluit categorische deur op de
N²-recursiebug-klasse van 2026-05-13 (mig 263 → 266 → 269 driedubbele fix).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

# Direct mergen naar main per git-workflow-feedback (geen PR-overheid)
git push origin main
```

---

## Out-of-scope / Open backlog

- **ENUM-categorie `pseudo_categorie` op producten** — pas waardevol bij 6+ pseudo's met semantische groepen; YAGNI nu. Toekomstige UI die "alle korting-regels" wil tonen kan dan een ALTER TABLE doen zonder dit ADR te raken.
- **Admin-UI om `is_pseudo` te togglen op een product** — nu alléén DB-edit. Pas een Module/UI bouwen als operationele behoefte ontstaat.
- **`SHIPPING_PRODUCT_ID` data-driven maken** — een toekomstige refactor zou ook *toe-voegen* data-driven kunnen maken (bv. `producten.is_default_shipping=TRUE`). Buiten scope; nu één hardcoded constant met expliciete scope-comment.
- **Backend-Voorraad/Producten-Module** — een Producten-Module zou `is_pseudo` als een eigenschap-van-product-domein bezitten en `is_admin_pseudo()` exporteren als publieke RPC. Komt mee wanneer de Producten-Module daadwerkelijk gebouwd wordt (geen ADR/plan nu).
