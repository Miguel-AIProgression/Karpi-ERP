# Snijplan-status enum-seam (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eén niet-gedrifte, compiler-afgedwongen snijplan-status-enum in TS die aantoonbaar gelijk is aan de DB-enum, met semantische status-groepen als gedeelde constanten i.p.v. losse magic-string-arrays, en een regressie-vangnet.

**Architecture:** De DB-enums `snijplan_status` en `confectie_status` zijn de bron-van-waarheid. We leggen hun waarden vast in een golden-snapshot-JSON. Drie ankers binden TS aan SQL: (1) een Vitest-contract-test toetst de TS-arrays tegen de snapshot, (2) een zelf-testende migratie toetst `enum_range()` tegen diezelfde waarden (draait in de handmatige SQL-deploy = de SQL-"CI"), (3) een bash-lint-script (model: `lint-no-hardcoded-admin-pseudo-strings.sh`) blokkeert nieuwe losse status-strings. Transitief: TS ≡ snapshot ≡ DB. Semantische groepen (`TE_SNIJDEN`, `ROL_FYSIEK_BEZET`, …) vervangen de herhaalde magic-string-arrays.

**Tech Stack:** React/TypeScript + Vitest (frontend), Deno (`supabase/functions/_shared/`), Supabase/PostgreSQL (migraties handmatig via SQL Editor — geen MCP/DB-toegang vanuit de agent), bash lint-scripts.

---

## Geverifieerde grond-waarheid (2026-06-09, live DB)

**`snijplan_status` enum (9 waarden, enum-volgorde):**
`Wacht, Gepland, In productie, Snijden, Gesneden, In confectie, Gereed, Ingepakt, Geannuleerd`

**`confectie_status` enum (5 waarden):**
`Wacht op materiaal, In productie, Kwaliteitscontrole, Gereed, Geannuleerd`

**Feitelijk gebruik:** `snijplannen` bevat alleen `Gepland` (1458 rijen); `confectie_orders` is leeg. De refactor is dus operationeel laag-risico (geen exotische live-statussen).

**Drift t.o.v. huidige TS (`frontend/src/lib/types/productie.ts`):**
- `SnijplanStatus` **mist `'Wacht'` en `'In productie'`** (beide zijn geldige DB-waarden).
- `ConfectieStatus` matcht de DB-enum exact — geen drift.
- `'In productie'`, `'Gereed'` en `'Geannuleerd'` komen in **beide** enums voor. Omdat elke call-site werkt op óf een `snijplannen`-rij óf een `confectie_orders`-rij, is de waardenruimte per tabel disjunct — de "ambiguïteit" is een **type-/kleurmap-risico**, geen runtime-bug. De seam (aparte getypeerde arrays + `Record<SnijplanStatus,…>`-kleurmaps die de compiler op volledigheid dwingt) voorkomt toekomstige kruisbesmetting; **geen blinde find-replace nodig.**

**Twee divergerende kleurmaps (te consolideren):**
- `frontend/src/lib/utils/constants.ts:34-42` `SNIJPLAN_STATUS_COLORS` (`Record<string,{bg,text}>`, mist `Wacht`+`In productie`).
- `frontend/src/components/rollen/rollen-groep-row.tsx:220-228` lokale `SNIJPLAN_STATUS_COLORS` (`Record<string,string>`, afwijkende kleuren voor `Gesneden`/`Gereed`, heeft wél `Wacht`+`In productie`, mist `Gepland` als blue i.p.v. slate).

**Hardcoded magic-string-arrays (te vervangen door semantische groepen):**
| Locatie | Array | Semantische groep |
|---|---|---|
| `_shared/db-helpers.ts:173` | `['Snijden','Gesneden']` | `ROL_FYSIEK_BEZET` |
| `modules/snijplanning/queries/snijplanning.ts:76,105` | `['Gepland','Snijden']` | `TE_SNIJDEN` |
| `modules/snijplanning/queries/snijvoorstel.ts:211` | `['Gepland','Snijden']` | `TE_SNIJDEN` |
| `components/snijplanning/rol-uitvoer-modal.tsx:298` | `['Gepland','Snijden']` | `TE_SNIJDEN` |
| `lib/supabase/queries/scanstation.ts:76` | `['Gesneden','In confectie','Gereed']` | `INPAK_KANDIDAAT` |
| `components/scanstation/scanned-item-card.tsx:13` | `['Gesneden','In confectie','Gereed']` | `INPAK_KANDIDAAT` |
| `pages/confectie/confectie-overview.tsx:33` | `['Gesneden','In confectie']` | `CONFECTIE_INSTROOM` |
| `pages/confectie/confectie-planning.tsx:64,91` | `['Gesneden','In confectie']` | `CONFECTIE_INSTROOM` |
| `components/confectie/week-lijst.tsx:38` | `['Gesneden','In confectie']` | `CONFECTIE_INSTROOM` |

---

## File Structure

**Nieuw:**
- `frontend/src/lib/types/__tests__/status-enums.golden.json` — golden snapshot van beide DB-enums (bron-van-waarheid voor de TS-contracttest).
- `frontend/src/lib/types/__tests__/status-enums.contract.test.ts` — Vitest contracttest TS-arrays ≡ snapshot.
- `frontend/src/lib/utils/snijplan-status.ts` — frontend single-source: enum-arrays, afgeleide types, semantische groepen, badge-helper.
- `supabase/functions/_shared/snijplan-status.ts` — Deno-spiegel van de semantische groepen (zelfde waarden; Deno↔Vite delen nog geen module — dat is Fase 3-shim-werk).
- `supabase/functions/_shared/snijplan-status.test.ts` — Deno-test: groepen zijn deelverzamelingen van de enum-waarden.
- `supabase/migrations/342_assert_status_enum_snapshot.sql` — zelf-testende migratie: `enum_range()` ≡ snapshot.
- `scripts/lint-no-hardcoded-snijplan-status.sh` — regressie-vangnet tegen losse status-strings.

**Gewijzigd:**
- `frontend/src/lib/types/productie.ts` — `SnijplanStatus`/`ConfectieStatus` afleiden uit de arrays in `snijplan-status.ts` (re-export voor backward-compat).
- `frontend/src/lib/utils/constants.ts` — kleurmaps `Record<SnijplanStatus,…>`/`Record<ConfectieStatus,…>` (compiler dwingt volledigheid) + `snijplanBadgeClass()`-helper.
- `frontend/src/components/rollen/rollen-groep-row.tsx` — lokale map weg, helper importeren.
- de 9 consument-bestanden uit de tabel hierboven — magic-string-arrays vervangen door de geïmporteerde groep-constante.

> **Migratienummer:** hoogste op `origin/main` = **341** (Fase 0). Dit plan claimt **342**. Verifieer bij implementatie-start opnieuw (`git ls-tree -r --name-only origin/main -- supabase/migrations/ | tail`) en bump bij collisie.

---

## Task 1: Golden snapshot + frontend single-source enum

Leg de DB-enums vast als data en laat de TS-arrays daaruit volgen. TDD: de contracttest faalt eerst omdat `snijplan-status.ts` nog niet bestaat.

**Files:**
- Create: `frontend/src/lib/types/__tests__/status-enums.golden.json`
- Create: `frontend/src/lib/utils/snijplan-status.ts`
- Create: `frontend/src/lib/types/__tests__/status-enums.contract.test.ts`

- [ ] **Step 1: Schrijf de golden snapshot (de DB-grond-waarheid)**

Maak `frontend/src/lib/types/__tests__/status-enums.golden.json`:

```json
{
  "_bron": "live DB enum_range() — 2026-06-09; regenereer via supabase/migrations/342_assert_status_enum_snapshot.sql-query",
  "snijplan_status": [
    "Wacht",
    "Gepland",
    "In productie",
    "Snijden",
    "Gesneden",
    "In confectie",
    "Gereed",
    "Ingepakt",
    "Geannuleerd"
  ],
  "confectie_status": [
    "Wacht op materiaal",
    "In productie",
    "Kwaliteitscontrole",
    "Gereed",
    "Geannuleerd"
  ]
}
```

- [ ] **Step 2: Schrijf de falende contracttest (RED)**

Maak `frontend/src/lib/types/__tests__/status-enums.contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import golden from './status-enums.golden.json'
import {
  SNIJPLAN_STATUSSEN,
  CONFECTIE_STATUSSEN,
} from '@/lib/utils/snijplan-status'

const asSet = (xs: readonly string[]) => new Set(xs)

describe('status-enum contract: TS ≡ DB-snapshot', () => {
  it('SNIJPLAN_STATUSSEN dekt exact snijplan_status', () => {
    expect(asSet(SNIJPLAN_STATUSSEN)).toEqual(asSet(golden.snijplan_status))
  })

  it('CONFECTIE_STATUSSEN dekt exact confectie_status', () => {
    expect(asSet(CONFECTIE_STATUSSEN)).toEqual(asSet(golden.confectie_status))
  })

  it('geen dubbele waarden binnen een enum-array', () => {
    expect(SNIJPLAN_STATUSSEN.length).toBe(asSet(SNIJPLAN_STATUSSEN).size)
    expect(CONFECTIE_STATUSSEN.length).toBe(asSet(CONFECTIE_STATUSSEN).size)
  })
})
```

- [ ] **Step 3: Draai de test → faalt (module bestaat niet)**

Run: `cd frontend && npx vitest run src/lib/types/__tests__/status-enums.contract.test.ts`
Expected: FAIL — `Cannot find module '@/lib/utils/snijplan-status'`.

- [ ] **Step 4: Schrijf de single-source-module (GREEN)**

Maak `frontend/src/lib/utils/snijplan-status.ts`:

```ts
// Single source of truth voor snijplan-/confectie-status (spiegelt DB-enums).
// Toets-anker: status-enums.contract.test.ts (TS ≡ snapshot) +
// supabase/migrations/342 (snapshot ≡ DB). Wijzig je een DB-enum, werk dan
// status-enums.golden.json + deze arrays + mig 342 samen bij.

export const SNIJPLAN_STATUSSEN = [
  'Wacht',
  'Gepland',
  'In productie',
  'Snijden',
  'Gesneden',
  'In confectie',
  'Gereed',
  'Ingepakt',
  'Geannuleerd',
] as const
export type SnijplanStatus = (typeof SNIJPLAN_STATUSSEN)[number]

export const CONFECTIE_STATUSSEN = [
  'Wacht op materiaal',
  'In productie',
  'Kwaliteitscontrole',
  'Gereed',
  'Geannuleerd',
] as const
export type ConfectieStatus = (typeof CONFECTIE_STATUSSEN)[number]

// === Semantische groepen (vervangen losse magic-string-arrays) ===

/** Snijplannen die nog gesneden moeten worden — voedt de snijplanning-pool. */
export const TE_SNIJDEN = ['Gepland', 'Snijden'] as const satisfies readonly SnijplanStatus[]

/** Rol fysiek bevroren: operator is bezig of klaar — niet opnieuw packen. */
export const ROL_FYSIEK_BEZET = ['Snijden', 'Gesneden'] as const satisfies readonly SnijplanStatus[]

/** Stukken die ingepakt mogen/kunnen worden (na snijden, door confectie heen). */
export const INPAK_KANDIDAAT = ['Gesneden', 'In confectie', 'Gereed'] as const satisfies readonly SnijplanStatus[]

/** Stukken die de confectie-pijplijn instromen. */
export const CONFECTIE_INSTROOM = ['Gesneden', 'In confectie'] as const satisfies readonly SnijplanStatus[]

export const isSnijplanStatus = (s: string): s is SnijplanStatus =>
  (SNIJPLAN_STATUSSEN as readonly string[]).includes(s)
```

- [ ] **Step 5: Draai de test → slaagt (GREEN)**

Run: `cd frontend && npx vitest run src/lib/types/__tests__/status-enums.contract.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types/__tests__/status-enums.golden.json \
        frontend/src/lib/types/__tests__/status-enums.contract.test.ts \
        frontend/src/lib/utils/snijplan-status.ts
git commit -m "feat(productie): single-source snijplan-/confectie-status + contracttest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `productie.ts` afleiden uit de single-source (drift dichten)

`SnijplanStatus` krijgt nu `'Wacht'`+`'In productie'` doordat het uit de array volgt. Bestaande imports van `SnijplanStatus`/`ConfectieStatus` uit `@/lib/types/productie` blijven werken via re-export.

**Files:**
- Modify: `frontend/src/lib/types/productie.ts:5-19`

- [ ] **Step 1: Vervang de twee handgeschreven types door re-exports**

Vervang in `frontend/src/lib/types/productie.ts` het blok r5-19:

```ts
export type SnijplanStatus =
  | 'Gepland'
  | 'Snijden'
  | 'Gesneden'
  | 'In confectie'
  | 'Gereed'
  | 'Ingepakt'
  | 'Geannuleerd'

export type ConfectieStatus =
  | 'Wacht op materiaal'
  | 'In productie'
  | 'Kwaliteitscontrole'
  | 'Gereed'
  | 'Geannuleerd'
```

door:

```ts
// Status-types komen uit de single-source (gespiegeld aan de DB-enums).
// Zie frontend/src/lib/utils/snijplan-status.ts + de contracttest.
export type { SnijplanStatus, ConfectieStatus } from '@/lib/utils/snijplan-status'
```

- [ ] **Step 2: Typecheck het hele project (vangt nieuwe non-exhaustiveness)**

Run: `cd frontend && npm run typecheck`
Expected: mogelijk nieuwe fouten in `constants.ts` (kleurmaps niet meer volledig) — die lost Task 3 op. Noteer welke bestanden klagen; als alleen `constants.ts` klaagt, ga door. Klaagt iets anders over de twee nieuwe waarden, los het in dat bestand op met een expliciete case (geen `// @ts-ignore`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types/productie.ts
git commit -m "refactor(productie): SnijplanStatus/ConfectieStatus uit single-source (drift dicht)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Kleurmaps consolideren (compiler-afgedwongen volledigheid)

Eén map per enum, getypeerd als `Record<SnijplanStatus,…>` zodat de compiler `Wacht`+`In productie` afdwingt. De divergerende map in `rollen-groep-row.tsx` verdwijnt; die component krijgt een helper die een gecombineerde className-string teruggeeft.

**Files:**
- Modify: `frontend/src/lib/utils/constants.ts:34-51`
- Modify: `frontend/src/components/rollen/rollen-groep-row.tsx:220-228,168,304`

- [ ] **Step 1: Maak de snijplan-kleurmap exhaustief + voeg badge-helper toe**

Vervang in `frontend/src/lib/utils/constants.ts` het blok r33-51 door (let op de import bovenaan het bestand toevoegen):

```ts
import type { SnijplanStatus, ConfectieStatus } from '@/lib/utils/snijplan-status'

/** Snijplan status → badge color mapping (compiler dwingt alle 9 af) */
export const SNIJPLAN_STATUS_COLORS: Record<SnijplanStatus, { bg: string; text: string }> = {
  'Wacht': { bg: 'bg-slate-100', text: 'text-slate-600' },
  'Gepland': { bg: 'bg-slate-100', text: 'text-slate-700' },
  'In productie': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'Snijden': { bg: 'bg-blue-100', text: 'text-blue-700' },
  'Gesneden': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'In confectie': { bg: 'bg-purple-100', text: 'text-purple-700' },
  'Gereed': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Ingepakt': { bg: 'bg-teal-100', text: 'text-teal-700' },
  'Geannuleerd': { bg: 'bg-gray-100', text: 'text-gray-500' },
}

/** Gecombineerde tailwind-className voor een snijplan-status-badge. */
export function snijplanBadgeClass(status: string): string {
  const c = (SNIJPLAN_STATUS_COLORS as Record<string, { bg: string; text: string }>)[status]
  return c ? `${c.bg} ${c.text}` : 'bg-gray-100 text-gray-600'
}

/** Confectie status → badge color mapping (compiler dwingt alle 5 af) */
export const CONFECTIE_STATUS_COLORS: Record<ConfectieStatus, { bg: string; text: string }> = {
  'Wacht op materiaal': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'In productie': { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  'Kwaliteitscontrole': { bg: 'bg-purple-100', text: 'text-purple-700' },
  'Gereed': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Geannuleerd': { bg: 'bg-gray-100', text: 'text-gray-500' },
}
```

- [ ] **Step 2: Verwijder de divergerende map in `rollen-groep-row.tsx`**

Verwijder het blok r220-228 (`const SNIJPLAN_STATUS_COLORS: Record<string, string> = { … }`) volledig. Voeg bovenaan het bestand bij de bestaande imports toe:

```ts
import { snijplanBadgeClass } from '@/lib/utils/constants'
```

Vervang op r168 en r304 de twee gebruiken:

```tsx
<span className={cn('px-1.5 py-0.5 rounded-full', SNIJPLAN_STATUS_COLORS[o.status] ?? 'bg-gray-100 text-gray-600')}>
```
en
```tsx
<span className={cn('px-1.5 py-0.5 rounded-full', SNIJPLAN_STATUS_COLORS[s.status] ?? 'bg-gray-100 text-gray-600')}>
```
door respectievelijk:
```tsx
<span className={cn('px-1.5 py-0.5 rounded-full', snijplanBadgeClass(o.status))}>
```
```tsx
<span className={cn('px-1.5 py-0.5 rounded-full', snijplanBadgeClass(s.status))}>
```

- [ ] **Step 3: Typecheck (de kleurmaps moeten nu compileren)**

Run: `cd frontend && npm run typecheck`
Expected: PASS — geen non-exhaustiveness meer op `SNIJPLAN_STATUS_COLORS`.

- [ ] **Step 4: Draai de bestaande tests + contracttest**

Run: `cd frontend && npx vitest run src/lib/`
Expected: PASS (incl. de Task 1-contracttest).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/utils/constants.ts frontend/src/components/rollen/rollen-groep-row.tsx
git commit -m "refactor(productie): één snijplan-kleurmap (compiler-exhaustief) + badge-helper; divergerende kopie weg

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Semantische groepen i.p.v. magic-string-arrays (frontend)

Vervang de 8 frontend-arrays uit de tabel door de geïmporteerde constanten. Geen gedragsverandering — puur naamgeving + single-source. Behoud `as const`/`readonly`-compat: de Supabase `.in(...)`-calls accepteren `readonly string[]`; cast indien de client-typing een mutable array eist met `[...GROEP]`.

**Files (elk een aparte step + sub-commit aan het eind):**
- Modify: `frontend/src/modules/snijplanning/queries/snijplanning.ts:76,105`
- Modify: `frontend/src/modules/snijplanning/queries/snijvoorstel.ts:211`
- Modify: `frontend/src/components/snijplanning/rol-uitvoer-modal.tsx:298`
- Modify: `frontend/src/lib/supabase/queries/scanstation.ts:76`
- Modify: `frontend/src/components/scanstation/scanned-item-card.tsx:13`
- Modify: `frontend/src/pages/confectie/confectie-overview.tsx:33`
- Modify: `frontend/src/pages/confectie/confectie-planning.tsx:64,91`
- Modify: `frontend/src/components/confectie/week-lijst.tsx:38`

- [ ] **Step 1: `TE_SNIJDEN`-call-sites**

In `snijplanning.ts`, `snijvoorstel.ts`, `rol-uitvoer-modal.tsx`: voeg import toe
```ts
import { TE_SNIJDEN } from '@/lib/utils/snijplan-status'
```
en vervang elke `.in('status', ['Gepland', 'Snijden'])` door `.in('status', [...TE_SNIJDEN])`. Voor niet-Supabase-vergelijkingen (`['Gepland','Snijden'].includes(x)`) gebruik `TE_SNIJDEN.includes(x as SnijplanStatus)`.

- [ ] **Step 2: `INPAK_KANDIDAAT`-call-sites**

In `scanstation.ts` en `scanned-item-card.tsx`: import `INPAK_KANDIDAAT` uit `@/lib/utils/snijplan-status`, vervang `['Gesneden', 'In confectie', 'Gereed']` door `[...INPAK_KANDIDAAT]` (Supabase) of `INPAK_KANDIDAAT.includes(...)` (lokale check). Verwijder de lokale `INPAK_READY_STATUSES`-const in `scanned-item-card.tsx:13` en gebruik `INPAK_KANDIDAAT`.

- [ ] **Step 3: `CONFECTIE_INSTROOM`-call-sites**

In `confectie-overview.tsx`, `confectie-planning.tsx`, `week-lijst.tsx`: import `CONFECTIE_INSTROOM`, vervang `['Gesneden', 'In confectie']` (en de lokale `KLAAR_STATUSSEN`-const in `confectie-overview.tsx:33`) door `CONFECTIE_INSTROOM`.

- [ ] **Step 4: Typecheck + tests**

Run: `cd frontend && npm run typecheck && npx vitest run`
Expected: PASS. Los typefouten op door `[...GROEP]` (mutable kopie) of een correcte `includes`-cast — nooit met `any`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/snijplanning/queries/snijplanning.ts \
        frontend/src/modules/snijplanning/queries/snijvoorstel.ts \
        frontend/src/components/snijplanning/rol-uitvoer-modal.tsx \
        frontend/src/lib/supabase/queries/scanstation.ts \
        frontend/src/components/scanstation/scanned-item-card.tsx \
        frontend/src/pages/confectie/confectie-overview.tsx \
        frontend/src/pages/confectie/confectie-planning.tsx \
        frontend/src/components/confectie/week-lijst.tsx
git commit -m "refactor(productie): semantische status-groepen i.p.v. magic-string-arrays (frontend)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Gedeelde status-groepen in `_shared/` (Deno) + db-helpers omzetten

`_shared/` (Deno) en `frontend/` (Vite) delen nog geen module — dat is Fase 3-shim-werk. Voor nu een dunne Deno-spiegel met dezelfde waarden, gebonden door een Deno-test die de groepen tegen de enum-waarden toetst.

**Files:**
- Create: `supabase/functions/_shared/snijplan-status.ts`
- Create: `supabase/functions/_shared/snijplan-status.test.ts`
- Modify: `supabase/functions/_shared/db-helpers.ts:173`

- [ ] **Step 1: Maak de Deno-spiegel**

Maak `supabase/functions/_shared/snijplan-status.ts`:

```ts
// Deno-spiegel van frontend/src/lib/utils/snijplan-status.ts. Tot de Fase 3-
// shim Deno↔Vite koppelt, houden we beide handmatig synchroon; de waarden
// worden geankerd door supabase/migrations/342 (enum) en de Deno-test hiernaast.

export const SNIJPLAN_STATUSSEN = [
  'Wacht', 'Gepland', 'In productie', 'Snijden', 'Gesneden',
  'In confectie', 'Gereed', 'Ingepakt', 'Geannuleerd',
] as const
export type SnijplanStatus = (typeof SNIJPLAN_STATUSSEN)[number]

/** Rol fysiek bevroren: operator is bezig of klaar — niet opnieuw packen. */
export const ROL_FYSIEK_BEZET = ['Snijden', 'Gesneden'] as const satisfies readonly SnijplanStatus[]
```

- [ ] **Step 2: Schrijf de Deno-test (RED→GREEN)**

Maak `supabase/functions/_shared/snijplan-status.test.ts`:

```ts
import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { ROL_FYSIEK_BEZET, SNIJPLAN_STATUSSEN } from './snijplan-status.ts'

Deno.test('ROL_FYSIEK_BEZET is deelverzameling van de enum', () => {
  for (const s of ROL_FYSIEK_BEZET) {
    assert((SNIJPLAN_STATUSSEN as readonly string[]).includes(s))
  }
})
```

Run: `cd supabase/functions/_shared && deno test snijplan-status.test.ts`
Expected: PASS (1 test). (Draait de Deno-test-suite niet lokaal, sla deze run over en vertrouw op de typecheck — `satisfies` dwingt het al af.)

- [ ] **Step 3: Zet `db-helpers.ts` om**

Voeg bovenaan `supabase/functions/_shared/db-helpers.ts` toe:
```ts
import { ROL_FYSIEK_BEZET } from './snijplan-status.ts'
```
Vervang op r173:
```ts
    .in('status', ['Snijden', 'Gesneden'])
```
door:
```ts
    .in('status', [...ROL_FYSIEK_BEZET])
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/snijplan-status.ts \
        supabase/functions/_shared/snijplan-status.test.ts \
        supabase/functions/_shared/db-helpers.ts
git commit -m "refactor(productie): gedeelde ROL_FYSIEK_BEZET-groep in _shared, db-helpers omgezet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Zelf-testende migratie — DB-enum ≡ snapshot (SQL-anker)

Borgt dat de DB-enum niet stilletjes uiteenloopt met de TS-snapshot. Draait in de handmatige SQL-deploy (de SQL-"CI").

**Files:**
- Create: `supabase/migrations/342_assert_status_enum_snapshot.sql`

- [ ] **Step 1: Schrijf de assertie-migratie**

Maak `supabase/migrations/342_assert_status_enum_snapshot.sql`:

```sql
-- Migratie 342: borgt snijplan_status/confectie_status ≡ TS-golden-snapshot.
-- Geen schema-wijziging — puur een assertie die faalt als iemand de enum
-- wijzigt zonder status-enums.golden.json + snijplan-status.ts mee te nemen.
-- (Idempotent: alleen leesbewerkingen.)

DO $$
DECLARE
  v_snij  TEXT[] := ARRAY['Wacht','Gepland','In productie','Snijden','Gesneden','In confectie','Gereed','Ingepakt','Geannuleerd'];
  v_conf  TEXT[] := ARRAY['Wacht op materiaal','In productie','Kwaliteitscontrole','Gereed','Geannuleerd'];
  v_db    TEXT[];
BEGIN
  SELECT array_agg(e ORDER BY e) INTO v_db
    FROM unnest(enum_range(NULL::snijplan_status)::TEXT[]) e;
  IF v_db <> (SELECT array_agg(e ORDER BY e) FROM unnest(v_snij) e) THEN
    RAISE EXCEPTION 'snijplan_status enum ≠ snapshot. DB=%, snapshot=%', v_db, v_snij;
  END IF;

  SELECT array_agg(e ORDER BY e) INTO v_db
    FROM unnest(enum_range(NULL::confectie_status)::TEXT[]) e;
  IF v_db <> (SELECT array_agg(e ORDER BY e) FROM unnest(v_conf) e) THEN
    RAISE EXCEPTION 'confectie_status enum ≠ snapshot. DB=%, snapshot=%', v_db, v_conf;
  END IF;

  RAISE NOTICE 'Mig 342: status-enums matchen de TS-snapshot';
END $$;
```

- [ ] **Step 2: Lever de migratie aan de gebruiker (handmatige deploy)**

De agent heeft geen DB-toegang. Vraag de gebruiker `342_assert_status_enum_snapshot.sql` in de SQL Editor te draaien.
Expected: `NOTICE: Mig 342: status-enums matchen de TS-snapshot`. Faalt het → de snapshot/arrays bijwerken naar de echte enum en de mismatch melden.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/342_assert_status_enum_snapshot.sql
git commit -m "test(productie): zelf-testende migratie status-enum ≡ TS-snapshot (mig 342)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Lint-vangnet tegen losse status-strings

Model: `scripts/lint-no-hardcoded-admin-pseudo-strings.sh`. Blokkeert nieuwe `.in('status', [...])`/literal-arrays met snijplan-statussen buiten de single-source.

**Files:**
- Create: `scripts/lint-no-hardcoded-snijplan-status.sh`

- [ ] **Step 1: Schrijf het lint-script**

Maak `scripts/lint-no-hardcoded-snijplan-status.sh`:

```bash
#!/usr/bin/env bash
# Voorkom regressie naar hardcoded snijplan-status-arrays buiten de single-source.
# Single-source: frontend/src/lib/utils/snijplan-status.ts + _shared/snijplan-status.ts.
# Patroon: een array-literal die ≥2 snijplan-statussen naast elkaar bevat.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
# Twee aaneengesloten quoted statussen in een array-context.
PATTERN="\\[[^]]*'(Gepland|Snijden|Gesneden|In confectie|Ingepakt)'[^]]*'(Gepland|Snijden|Gesneden|In confectie|Ingepakt)'"

WHITELIST_RE=(
  "frontend/src/lib/utils/snijplan-status\.ts"
  "supabase/functions/_shared/snijplan-status\.ts"
  "frontend/src/lib/utils/constants\.ts"
  "frontend/src/lib/types/__tests__/.*"
  "supabase/migrations/.*"
  "docs/.*"
  "scripts/lint-no-hardcoded-snijplan-status\.sh"
)
WHITELIST_GREP=$(printf "|%s" "${WHITELIST_RE[@]}"); WHITELIST_GREP=${WHITELIST_GREP:1}

cd "$ROOT"
VIOLATIONS=$(git ls-files \
  | grep -E '\.(ts|tsx)$' \
  | grep -E -v "(${WHITELIST_GREP})" \
  | xargs -I{} grep -lErn "${PATTERN}" {} 2>/dev/null || true)

if [[ -n "$VIOLATIONS" ]]; then
  echo "Hardcoded snijplan-status-array gevonden buiten de single-source:" >&2
  echo "$VIOLATIONS" >&2
  echo >&2
  echo "Gebruik TE_SNIJDEN/ROL_FYSIEK_BEZET/INPAK_KANDIDAAT/CONFECTIE_INSTROOM uit snijplan-status.ts." >&2
  exit 1
fi
echo "Geen hardcoded snijplan-status-arrays buiten de single-source."
```

- [ ] **Step 2: Maak uitvoerbaar + draai → moet schoon zijn (na Task 1-5)**

Run: `chmod +x scripts/lint-no-hardcoded-snijplan-status.sh && bash scripts/lint-no-hardcoded-snijplan-status.sh`
Expected: `Geen hardcoded snijplan-status-arrays buiten de single-source.` (Klaagt het nog over een bestand → die call-site is in Task 4/5 gemist; zet 'm alsnog om.)

- [ ] **Step 3: Commit**

```bash
git add scripts/lint-no-hardcoded-snijplan-status.sh
git commit -m "chore(productie): lint-vangnet tegen hardcoded snijplan-status-arrays

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Levende docs bijwerken

**Files:**
- Modify: `docs/changelog.md` (nieuwe entry bovenaan)
- Modify: `docs/data-woordenboek.md` (snijplan-status-begrip + semantische groepen)

- [ ] **Step 1: Changelog-entry**

Voeg bovenaan `docs/changelog.md` toe (level-2, conform stijl):

```markdown
## 2026-06-09 — Snijplan-status enum-seam (Fase 1 TS↔SQL-consolidatie)

`SnijplanStatus` (TS) miste `'Wacht'`+`'In productie'` t.o.v. de DB-enum
`snijplan_status` en er bestonden twee divergerende `SNIJPLAN_STATUS_COLORS`-maps.
Geconsolideerd naar één single-source (`frontend/src/lib/utils/snijplan-status.ts`):
enum-arrays + afgeleide types + semantische groepen (`TE_SNIJDEN`, `ROL_FYSIEK_BEZET`,
`INPAK_KANDIDAAT`, `CONFECTIE_INSTROOM`). Drie ankers binden TS aan SQL: Vitest-
contracttest (TS ≡ golden snapshot), zelf-testende migratie 342 (snapshot ≡ DB-enum),
en lint-script tegen losse status-strings. Kleurmaps zijn nu `Record<SnijplanStatus,…>`
(compiler dwingt volledigheid); de divergerende kopie in `rollen-groep-row.tsx` is weg.
Geen gedragsverandering — `confectie_orders` is leeg en `snijplannen` staat volledig op
`Gepland`.
```

- [ ] **Step 2: Data-woordenboek**

Voeg in `docs/data-woordenboek.md` een begrip toe (pas aan de bestaande structuur aan): de 9 `snijplan_status`-waarden, de 5 `confectie_status`-waarden, en de vier semantische groepen met hun betekenis. Verwijs naar `snijplan-status.ts` als single-source en naar de [`reference_snijplan_status_snijden_trap`]-valkuil (`'Snijden'` als legacy enum-waarde).

- [ ] **Step 3: Commit**

```bash
git add docs/changelog.md docs/data-woordenboek.md
git commit -m "docs(productie): changelog + data-woordenboek na snijplan-status-seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Eindcontrole + meld klaar voor merge**

Run: `cd frontend && npm run typecheck && npx vitest run && cd .. && bash scripts/lint-no-hardcoded-snijplan-status.sh`
Expected: alles PASS/schoon. Meld dat `refactor/snijplan-status-enum` klaar is, vermeld dat migratie 342 nog door de gebruiker in de SQL Editor gedraaid moet worden, en wacht op expliciete "merge naar main".

---

## Self-Review

**1. Spec-dekking (vs hoofdplan Fase 1):**
- "één centrale niet-gedrifte enum gespiegeld aan de DB" → Task 1 (single-source) + Task 2 (drift dicht) + Task 6 (DB-anker). ✓
- "afgedwongen volledigheid" → Task 3 (`Record<SnijplanStatus,…>`). ✓
- "ESLint-vangnet tegen magic strings" → Task 7 (bash-lint conform repo-patroon i.p.v. ESLint-config — repo gebruikt geen ESLint-rules maar `scripts/lint-*.sh`). ✓
- "split SnijplanStatus van ConfectieStatus" → al gesplitst in `productie.ts`; beide nu uit single-source, beide enums geverifieerd. ✓
- "per `Gereed`/`Ingepakt`-call-site semantische keuze" → geverifieerd dat call-sites tabel-gescheiden zijn (snijplan vs confectie); risico is type/kleurmap, opgelost door de seam — gedocumenteerd in grond-waarheid-sectie. Geen blinde find-replace. ✓
- "semantische groepen `TE_SNIJDEN`/`ROL_FYSIEK_BEZET`/`PICKBAAR`" → `TE_SNIJDEN`/`ROL_FYSIEK_BEZET`/`INPAK_KANDIDAAT`/`CONFECTIE_INSTROOM` (de werkelijk-gebruikte sets; `PICKBAAR` bleek geen losse snijplan-status-array). ✓
- "spiegel naar `_shared/`" → Task 5 (Deno-spiegel + db-helpers); volledige Deno↔Vite-deling expliciet uitgesteld naar Fase 3-shim. ✓
- Gate (overlap `organische-vormen`) → geverifieerd: geen overlap met Fase 1-bestanden.

**2. Placeholder-scan:** alle code-steps bevatten volledige before/after-blokken met exacte paden/regels. Geen "TBD"/"handle edge cases". Task 4 noemt 8 concrete bestanden met regelnummers en de exacte vervanging per groep.

**3. Type-consistentie:** `SnijplanStatus`/`ConfectieStatus` afgeleid uit `SNIJPLAN_STATUSSEN`/`CONFECTIE_STATUSSEN` (Task 1) en overal zo geïmporteerd (Task 2/3). Groep-namen identiek in single-source (Task 1), frontend-call-sites (Task 4), `_shared` (Task 5) en lint-script (Task 7). `snijplanBadgeClass` gedefinieerd in Task 3, gebruikt in Task 3. Snapshot-arrays identiek in golden.json (Task 1), mig 342 (Task 6) en de Deno-spiegel (Task 5).
