# Maatwerk-Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verhuis de maatwerk-flow uit `components/orders/`, `lib/supabase/queries/op-maat.ts`, `lib/utils/maatwerk-*.ts` en `pages/instellingen/{vormen,afwerkingen}.tsx` naar één deep verticale Module onder `frontend/src/modules/maatwerk/` met hooks-import-seam vanuit Orders.

**Architecture:** Hooks-import-seam (geen slot-pattern). Order-form blijft host; `op-maat.ts` (761 regels, 39 exports) splitst in vier files (`queries/maatwerk-runtime.ts` + `queries/maatwerk-instellingen.ts` + `lib/prijs.ts` + `lib/oppervlak.ts`). Pure formules `berekenPrijsOppervlakM2` / `berekenOmtrekMeter` / `berekenMaatwerkPrijs` blijven client-side TS — geen DB-roundtrip nodig (formule gebruikt geen snij-marge, dus mig 233 raakt niets aan dit pad). Geen schema-wijziging, geen edge-function-wijziging.

**Tech Stack:** React 18 + TypeScript 5 + Vite 5 + TanStack Query 5 + Tailwind/shadcn/ui + React Router 6 + Vitest + Supabase (PostgreSQL).

**Refereert aan:** [ADR-0009](../../adr/0009-maatwerk-als-deep-module.md), [ADR-0001](../../adr/0001-order-voorstel-en-planning-als-twee-modules.md) (slot-vs-hooks-precedent), [ADR-0007](../../adr/0007-facturatie-als-deep-module.md) (smal frontend-scope-precedent).

---

## File Structure

### Te creëren: `frontend/src/modules/maatwerk/`

```
modules/maatwerk/
├── index.ts                                  ← barrel; alleen hooks/components/types/pages publiek
├── queries/
│   ├── maatwerk-runtime.ts                   ← runtime-lookups (kwaliteiten, kleuren, m²-prijs, band, levertijd-hint)
│   ├── maatwerk-instellingen.ts              ← admin-CRUD-mutations (vormen, afwerkingen, defaults)
│   └── __tests__/
│       └── maatwerk-runtime.test.ts          ← was lib/supabase/queries/__tests__/op-maat.test.ts
├── hooks/
│   ├── use-maatwerk-opties.ts                ← kwaliteiten + kleuren + vormen + afwerkingen
│   ├── use-kwaliteit-m2-prijs.ts
│   ├── use-standaard-band-kleur.ts
│   ├── use-standaard-afwerking.ts
│   ├── use-maatwerk-levertijd-hint.ts
│   └── use-maatwerk-instellingen.ts          ← was hooks/use-vormen.ts + hooks/use-afwerkingen.ts
├── components/
│   ├── maatwerk-selector.tsx                 ← was components/orders/op-maat-selector.tsx
│   ├── maatwerk-levertijd-hint.tsx           ← was components/orders/maatwerk-levertijd-hint.tsx
│   ├── kwaliteit-first-selector.tsx          ← was components/orders/kwaliteit-first-selector.tsx
│   ├── kwaliteit-kleur-selector.tsx          ← was components/orders/kwaliteit-kleur-selector.tsx
│   ├── vorm-afmeting-selector.tsx            ← was components/orders/vorm-afmeting-selector.tsx
│   ├── vorm-form-dialog.tsx                  ← was components/instellingen/vorm-form-dialog.tsx
│   ├── afwerking-form-dialog.tsx             ← was components/instellingen/afwerking-form-dialog.tsx
│   ├── afwerking-kleur-koppelingen.tsx       ← was components/instellingen/afwerking-kleur-koppelingen.tsx
│   └── afwerking-kleuren-submenu.tsx         ← was components/instellingen/afwerking-kleuren-submenu.tsx (consumeert sibling, alleen door afwerkingen-page gebruikt)
├── pages/
│   ├── vormen-instellingen.tsx               ← was pages/instellingen/vormen.tsx
│   └── afwerkingen-instellingen.tsx          ← was pages/instellingen/afwerkingen.tsx
└── lib/
    ├── prijs.ts                              ← was lib/utils/maatwerk-prijs.ts (formule ongewijzigd)
    ├── oppervlak.ts                          ← extract uit prijs.ts: berekenPrijsOppervlakM2 + berekenOmtrekMeter
    └── leverdatum.ts                         ← was lib/utils/maatwerk-leverdatum.ts
```

### Te wijzigen (consumers)

- `frontend/src/components/orders/order-form.tsx` — import `berekenMaatwerkAfleverdatumViaSeam` via `@/modules/maatwerk`
- `frontend/src/components/orders/order-line-editor.tsx` — import `berekenPrijsOppervlakM2` via `@/modules/maatwerk`
- `frontend/src/pages/producten/kwaliteit-kleuren-uitvouw.tsx`, `kwaliteiten-grouped-view.tsx`, `product-create.tsx` — imports verschuiven van `@/lib/supabase/queries/op-maat` naar `@/modules/maatwerk`
- `frontend/src/router.tsx:31-32, 129-130` — page-imports en route-entries verschuiven naar Module

### Te verwijderen (na migratie)

- `frontend/src/lib/supabase/queries/op-maat.ts` (761 regels)
- `frontend/src/lib/supabase/queries/__tests__/op-maat.test.ts`
- `frontend/src/lib/utils/maatwerk-prijs.ts`
- `frontend/src/lib/utils/maatwerk-leverdatum.ts`
- `frontend/src/components/orders/op-maat-selector.tsx`
- `frontend/src/components/orders/maatwerk-levertijd-hint.tsx`
- `frontend/src/components/orders/kwaliteit-first-selector.tsx`
- `frontend/src/components/orders/kwaliteit-kleur-selector.tsx`
- `frontend/src/components/orders/vorm-afmeting-selector.tsx`
- `frontend/src/components/instellingen/vorm-form-dialog.tsx`
- `frontend/src/components/instellingen/afwerking-form-dialog.tsx`
- `frontend/src/components/instellingen/afwerking-kleur-koppelingen.tsx`
- `frontend/src/components/instellingen/afwerking-kleuren-submenu.tsx`
- `frontend/src/pages/instellingen/vormen.tsx`
- `frontend/src/pages/instellingen/afwerkingen.tsx`
- `frontend/src/hooks/use-vormen.ts`
- `frontend/src/hooks/use-afwerkingen.ts`

---

## Verificatiecommando's (gebruikt door alle taken)

- **Typecheck:** `cd frontend; npx tsc --noEmit`
- **Tests:** `cd frontend; npx vitest run` (gericht: `npx vitest run path/to/file.test.ts`)
- **Lint:** `cd frontend; npx eslint src --max-warnings 0`
- **Dev-server smoke:** `cd frontend; npm run dev` — open `/orders/nieuw`, klik "Op maat"-toggle, vul lengte/breedte/kwaliteit/kleur, verifieer prijs-berekening en levertijd-hint

---

## Task 1: Setup module-folder + lege barrel

**Files:**
- Create: `frontend/src/modules/maatwerk/index.ts`

**Doel:** Folder-skelet + lege barrel zodat volgende taken iets om in te schrijven hebben. Geen code-verhuizing nog.

- [ ] **Step 1: Maak module-folder + barrel met TODO-comment**

```ts
// frontend/src/modules/maatwerk/index.ts
// Maatwerk-Module barrel — zie ADR-0009.
// Exports volgen tijdens migratie; geen export uit deze stub.
export {}
```

- [ ] **Step 2: Verifieer typecheck blijft groen**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS (geen import op `@/modules/maatwerk` is nog).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/maatwerk/index.ts
git commit -m "chore(maatwerk): module-folder + lege barrel (ADR-0009 stap 1/10)"
```

---

## Task 2: Verhuis pure formules — `lib/prijs.ts` + `lib/oppervlak.ts`

**Files:**
- Create: `frontend/src/modules/maatwerk/lib/prijs.ts`
- Create: `frontend/src/modules/maatwerk/lib/oppervlak.ts`
- Modify: `frontend/src/modules/maatwerk/index.ts`

**Doel:** Pure TS-functies uit `lib/utils/maatwerk-prijs.ts` (57 regels) splitsen op concern: oppervlak/omtrek vs prijs-formule. Formule blijft 1-op-1 gelijk; geen snij-marge-import (mig 233-update raakt dit pad niet — formule gebruikt geen marge).

- [ ] **Step 1: Maak `lib/oppervlak.ts` met `berekenPrijsOppervlakM2` + `berekenOmtrekMeter`**

```ts
// frontend/src/modules/maatwerk/lib/oppervlak.ts

/**
 * Bereken het PRIJS-oppervlak in m² (= materiaalverbruik).
 * Rond = diameter² (omsluitend vierkant, industrie-standaard).
 */
export function berekenPrijsOppervlakM2(
  vorm: string,
  lengteCm?: number,
  breedteCm?: number,
  diameterCm?: number,
): number {
  if (vorm === 'rond' && diameterCm) {
    return (diameterCm * diameterCm) / 10000
  }
  if (lengteCm && breedteCm) {
    return (lengteCm * breedteCm) / 10000
  }
  return 0
}

/**
 * Bereken de omtrek in strekkende meters voor afwerking-tarief (mig 193).
 */
export function berekenOmtrekMeter(
  vorm: string,
  lengteCm?: number,
  breedteCm?: number,
  diameterCm?: number,
): number {
  if (vorm === 'rond' && diameterCm) {
    return (Math.PI * diameterCm) / 100
  }
  if (lengteCm && breedteCm) {
    return (2 * (lengteCm + breedteCm)) / 100
  }
  return 0
}
```

- [ ] **Step 2: Maak `lib/prijs.ts` met `berekenMaatwerkPrijs`**

```ts
// frontend/src/modules/maatwerk/lib/prijs.ts

/**
 * Bereken totaalprijs voor een maatwerk-orderregel.
 * Formule: oppervlak × m²-prijs + vormtoeslag + afwerkingprijs − korting%.
 * Snij-marge is GEEN onderdeel van de prijs (zie ADR-0009 cross-cuts).
 */
export function berekenMaatwerkPrijs(params: {
  oppervlakM2: number
  m2Prijs: number
  vormToeslag: number
  afwerkingPrijs: number
  korting_pct: number
}): number {
  const { oppervlakM2, m2Prijs, vormToeslag, afwerkingPrijs, korting_pct } = params
  const basis = oppervlakM2 * m2Prijs
  const subtotaal = basis + vormToeslag + afwerkingPrijs
  const netto = subtotaal * (1 - korting_pct / 100)
  return Math.round(netto * 100) / 100
}
```

- [ ] **Step 3: Update barrel om beide te exporteren**

```ts
// frontend/src/modules/maatwerk/index.ts
export { berekenPrijsOppervlakM2, berekenOmtrekMeter } from './lib/oppervlak'
export { berekenMaatwerkPrijs } from './lib/prijs'
```

- [ ] **Step 4: Verifieer typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS — oude `lib/utils/maatwerk-prijs.ts` bestaat nog, dus consumers blijven werken; nieuwe paden zijn alleen toegevoegd.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/maatwerk
git commit -m "refactor(maatwerk): kopieer prijs-/oppervlak-formules naar Module (stap 2/10)"
```

---

## Task 3: Verhuis `lib/leverdatum.ts`

**Files:**
- Create: `frontend/src/modules/maatwerk/lib/leverdatum.ts`
- Modify: `frontend/src/modules/maatwerk/index.ts`

**Doel:** `lib/utils/maatwerk-leverdatum.ts` (67 regels, 1 export) verhuist 1-op-1. Roept Planning's `checkLevertijd`-seam aan — die import blijft ongewijzigd.

- [ ] **Step 1: Kopieer file-inhoud van `lib/utils/maatwerk-leverdatum.ts` naar `modules/maatwerk/lib/leverdatum.ts`**

Bron: zie [`frontend/src/lib/utils/maatwerk-leverdatum.ts`](../../../frontend/src/lib/utils/maatwerk-leverdatum.ts:1-67). Imports blijven:

```ts
import { checkLevertijd } from '@/lib/supabase/queries/levertijd'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
```

Export-naam blijft `berekenMaatwerkAfleverdatumViaSeam`.

- [ ] **Step 2: Update barrel**

```ts
// In frontend/src/modules/maatwerk/index.ts toevoegen:
export { berekenMaatwerkAfleverdatumViaSeam } from './lib/leverdatum'
```

- [ ] **Step 3: Verifieer typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/maatwerk
git commit -m "refactor(maatwerk): kopieer leverdatum-helper naar Module (stap 3/10)"
```

---

## Task 4: Splits `op-maat.ts` in `queries/maatwerk-runtime.ts`

**Files:**
- Create: `frontend/src/modules/maatwerk/queries/maatwerk-runtime.ts`
- Modify: `frontend/src/modules/maatwerk/index.ts`

**Doel:** Runtime-lookups uit `op-maat.ts` (761 regels, 39 exports) extracten. Admin-CRUD blijft voor Task 5. Pure copy + types/interfaces meenemen — geen logica-wijziging.

**Te extracten naar `maatwerk-runtime.ts` (alle exports die runtime-flow voeden):**
- Types: `MaatwerkVormRow`, `AfwerkingTypeRow`, `BandLabelKoppeling`, `BandDefault`, `BandDefaultRow`, `KwaliteitOptie`, `KleurOptie`, `StandaardMaat`, `MaatwerkLevertijdHintResult`
- Reads: `fetchVormen`, `fetchAfwerkingTypes`, `fetchTypeBewerkingen`, `fetchStandaardAfwerking`, `fetchAfwerkingVoorKleur`, `fetchAlleStandaardAfwerkingen`, `fetchMaatwerkKwaliteiten`, `fetchMaatwerkKleurenVoorKwaliteit`, `fetchMaatwerkKleurOptiesVoorKwaliteit`, `fetchMaatwerkKwaliteitOpties`, `fetchKoppelingenVoorKleurLabel`, `fetchKwaliteiten`, `fetchMaatwerkArtikelNr`, `fetchStandaardBandKleur`, `fetchBandDefaultsVoorKwaliteit`, `fetchKwaliteitM2Prijs`, `searchKwaliteitenViaProducten`, `fetchKleurenVoorKwaliteit`, `fetchStandaardMatenVoorKwaliteit`, `fetchMaatwerkLevertijdHint`

**Te laten in `op-maat.ts` voorlopig** (Task 5 verhuist deze naar `maatwerk-instellingen.ts`):
- `fetchAlleVormen`, `upsertVorm`, `deleteVorm`
- `fetchAlleAfwerkingTypes`, `upsertAfwerkingType`, `deleteAfwerkingType`
- `setStandaardAfwerking`, `setAfwerkingVoorKleur`, `clearStandaardAfwerking`, `setBandKleurDefault`

- [ ] **Step 1: Maak `maatwerk-runtime.ts` als kopie van runtime-exports**

Header-comment + imports:

```ts
// frontend/src/modules/maatwerk/queries/maatwerk-runtime.ts
//
// Runtime-lookups voor de Maatwerk-Module. Admin-CRUD-mutaties leven in
// `./maatwerk-instellingen.ts`. Zie ADR-0009.

import { supabase } from '@/lib/supabase/client'
import { fetchVoorraadpositie } from '@/modules/voorraadpositie'
```

Daarna 1-op-1 kopie van de hierboven genoemde types + read-functies uit [`frontend/src/lib/supabase/queries/op-maat.ts`](../../../frontend/src/lib/supabase/queries/op-maat.ts). Inhoud niet aanpassen.

- [ ] **Step 2: Update barrel**

```ts
// In frontend/src/modules/maatwerk/index.ts toevoegen:
export {
  fetchVormen,
  fetchAfwerkingTypes,
  fetchTypeBewerkingen,
  fetchStandaardAfwerking,
  fetchAfwerkingVoorKleur,
  fetchAlleStandaardAfwerkingen,
  fetchMaatwerkKwaliteiten,
  fetchMaatwerkKleurenVoorKwaliteit,
  fetchMaatwerkKleurOptiesVoorKwaliteit,
  fetchMaatwerkKwaliteitOpties,
  fetchKoppelingenVoorKleurLabel,
  fetchKwaliteiten,
  fetchMaatwerkArtikelNr,
  fetchStandaardBandKleur,
  fetchBandDefaultsVoorKwaliteit,
  fetchKwaliteitM2Prijs,
  searchKwaliteitenViaProducten,
  fetchKleurenVoorKwaliteit,
  fetchStandaardMatenVoorKwaliteit,
  fetchMaatwerkLevertijdHint,
} from './queries/maatwerk-runtime'

export type {
  MaatwerkVormRow,
  AfwerkingTypeRow,
  BandLabelKoppeling,
  BandDefault,
  BandDefaultRow,
  KwaliteitOptie,
  KleurOptie,
  StandaardMaat,
  MaatwerkLevertijdHintResult,
} from './queries/maatwerk-runtime'
```

- [ ] **Step 3: Diff-verify dat function-bodies byte-identiek zijn**

```bash
cd frontend
# Voor elke function uit de Task-4-lijst, vergelijk function-body in nieuwe file
# tegen oude file. Voorbeeld voor één:
diff <(grep -A 20 "export async function fetchVormen" src/lib/supabase/queries/op-maat.ts) \
     <(grep -A 20 "export async function fetchVormen" src/modules/maatwerk/queries/maatwerk-runtime.ts)
```

Expected: geen verschillen behalve eventuele import-paden bovenaan. Als verschillen → herstel de copy-fout vóór commit.

- [ ] **Step 4: Verifieer typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS — beide bronnen bestaan parallel; consumers blijven oude pad gebruiken.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/maatwerk
git commit -m "refactor(maatwerk): runtime-queries naar Module (stap 4/10)"
```

---

## Task 5: Splits admin-CRUD in `queries/maatwerk-instellingen.ts`

**Files:**
- Create: `frontend/src/modules/maatwerk/queries/maatwerk-instellingen.ts`
- Modify: `frontend/src/modules/maatwerk/index.ts`

**Doel:** Admin-CRUD-mutations uit `op-maat.ts` extracten. Types `MaatwerkVormRow` / `AfwerkingTypeRow` worden geherexporteerd uit runtime-bestand (geen duplicate types).

**Te extracten:**
- `fetchAlleVormen`, `upsertVorm`, `deleteVorm`
- `fetchAlleAfwerkingTypes`, `upsertAfwerkingType`, `deleteAfwerkingType`
- `setStandaardAfwerking`, `setAfwerkingVoorKleur`, `clearStandaardAfwerking`, `setBandKleurDefault`

- [ ] **Step 1: Maak `maatwerk-instellingen.ts`**

```ts
// frontend/src/modules/maatwerk/queries/maatwerk-instellingen.ts
//
// Admin-CRUD-mutaties voor de Maatwerk-Module. Reads die door de runtime-flow
// worden gebruikt staan in `./maatwerk-runtime.ts`. Zie ADR-0009.

import { supabase } from '@/lib/supabase/client'
import type { MaatwerkVormRow, AfwerkingTypeRow } from './maatwerk-runtime'

// ... 1-op-1 kopie van de 10 admin-functies uit op-maat.ts
```

- [ ] **Step 2: Update barrel**

```ts
// In frontend/src/modules/maatwerk/index.ts toevoegen:
export {
  fetchAlleVormen,
  upsertVorm,
  deleteVorm,
  fetchAlleAfwerkingTypes,
  upsertAfwerkingType,
  deleteAfwerkingType,
  setStandaardAfwerking,
  setAfwerkingVoorKleur,
  clearStandaardAfwerking,
  setBandKleurDefault,
} from './queries/maatwerk-instellingen'
```

- [ ] **Step 3: Verifieer typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/maatwerk
git commit -m "refactor(maatwerk): admin-CRUD-queries naar Module (stap 5/10)"
```

---

## Task 6: Verhuis `op-maat.test.ts`

**Files:**
- Create: `frontend/src/modules/maatwerk/queries/__tests__/maatwerk-runtime.test.ts`
- Modify: `frontend/src/lib/supabase/queries/__tests__/op-maat.test.ts` (verwijderen aan einde van Task 9, niet hier)

**Doel:** Bestaande tests verhuizen voordat oude file weggaat. Tests moeten lopen tegen de nieuwe `@/modules/maatwerk`-import zodat we Task 9 (verwijdering) kunnen doen zonder coverage-verlies.

- [ ] **Step 1: Kopieer testfile naar nieuwe locatie**

Lees [`frontend/src/lib/supabase/queries/__tests__/op-maat.test.ts`](../../../frontend/src/lib/supabase/queries/__tests__/op-maat.test.ts) volledig.

- [ ] **Step 2: Pas imports aan in nieuwe testfile**

Vervang `from '@/lib/supabase/queries/op-maat'` → `from '@/modules/maatwerk'`. Mock-paden voor `@/lib/supabase/client` en `@/modules/voorraadpositie` blijven gelijk.

- [ ] **Step 3: Run nieuwe testfile**

```bash
cd frontend && npx vitest run src/modules/maatwerk/queries/__tests__/maatwerk-runtime.test.ts
```

Expected: PASS (3 tests groen, conform invarianten in commentaar van originele file).

- [ ] **Step 4: Run beide testfiles parallel om te verifiëren dat ze geen state-leak hebben**

```bash
cd frontend && npx vitest run src/lib/supabase/queries/__tests__/op-maat.test.ts src/modules/maatwerk/queries/__tests__/maatwerk-runtime.test.ts
```

Expected: PASS (6 tests groen — 3 van elke file).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/maatwerk/queries/__tests__/maatwerk-runtime.test.ts
git commit -m "test(maatwerk): verhuis levertijd-hint-tests naar Module (stap 6/10)"
```

---

## Task 7: Verhuis runtime-components

**Files:**
- Create (5 files): zie File Structure boven (`maatwerk-selector`, `maatwerk-levertijd-hint`, `kwaliteit-first-selector`, `kwaliteit-kleur-selector`, `vorm-afmeting-selector`)
- Modify: `frontend/src/modules/maatwerk/index.ts`

**Doel:** Components 1-op-1 verhuizen, alleen interne imports omdraaien naar `@/modules/maatwerk` (van `@/lib/supabase/queries/op-maat` en `@/lib/utils/maatwerk-prijs`). Externe imports (`@/components/ui/*`, `@/lib/supabase/client`, etc.) blijven gelijk.

- [ ] **Step 1: Verhuis `op-maat-selector.tsx` → `components/maatwerk-selector.tsx`**

Lees [`frontend/src/components/orders/op-maat-selector.tsx`](../../../frontend/src/components/orders/op-maat-selector.tsx). Kopieer naar `frontend/src/modules/maatwerk/components/maatwerk-selector.tsx`. Twee verplichte aanpassingen:

1. **Hernoem named export** `export function OpMaatSelector` → `export function MaatwerkSelector`. Hernoem ook `OpMaatSelectorProps` → `MaatwerkSelectorProps`. (Task 9 Stap 1 update consumer + JSX-tag.)
2. **Wijzig imports:**

```ts
// Was:
import { ... } from '@/lib/supabase/queries/op-maat'
import { berekenPrijsOppervlakM2, berekenMaatwerkPrijs, berekenOmtrekMeter } from '@/lib/utils/maatwerk-prijs'

// Wordt:
import { ... } from '@/modules/maatwerk'
import { berekenPrijsOppervlakM2, berekenMaatwerkPrijs, berekenOmtrekMeter } from '@/modules/maatwerk'
```

- [ ] **Step 2: Verhuis 4 overige components**

Pas dezelfde patroon toe op:
- `maatwerk-levertijd-hint.tsx` (geen rename)
- `kwaliteit-first-selector.tsx` (geen rename)
- `kwaliteit-kleur-selector.tsx` (geen rename)
- `vorm-afmeting-selector.tsx` (geen rename)

- [ ] **Step 3: Update barrel**

```ts
// In frontend/src/modules/maatwerk/index.ts toevoegen:
export { MaatwerkSelector } from './components/maatwerk-selector'
export { MaatwerkLevertijdHint } from './components/maatwerk-levertijd-hint'
export { KwaliteitFirstSelector } from './components/kwaliteit-first-selector'
export { KwaliteitKleurSelector } from './components/kwaliteit-kleur-selector'
export { VormAfmetingSelector } from './components/vorm-afmeting-selector'
```

(Pas namen aan op werkelijke export-namen die je tegenkomt bij verhuizen.)

- [ ] **Step 4: Verifieer typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS — oude components in `components/orders/` bestaan nog, dus consumers blijven werken.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/maatwerk
git commit -m "refactor(maatwerk): verhuis 5 runtime-components naar Module (stap 7/10)"
```

---

## Task 8: Verhuis admin-components + pages + admin-hooks

**Files:**
- Create (3 components): `vorm-form-dialog.tsx`, `afwerking-form-dialog.tsx`, `afwerking-kleur-koppelingen.tsx`
- Create (2 pages): `vormen-instellingen.tsx`, `afwerkingen-instellingen.tsx`
- Create: `frontend/src/modules/maatwerk/hooks/use-maatwerk-instellingen.ts` (combineert `use-vormen` + `use-afwerkingen`)
- Modify: `frontend/src/modules/maatwerk/index.ts`

**Doel:** Admin-tak van de Module. Hooks `use-vormen.ts` en `use-afwerkingen.ts` combineren tot één hook-file met meerdere named exports.

- [ ] **Step 1: Verhuis 4 admin-components**

Lees uit `frontend/src/components/instellingen/`:
- `vorm-form-dialog.tsx`
- `afwerking-form-dialog.tsx`
- `afwerking-kleur-koppelingen.tsx`
- `afwerking-kleuren-submenu.tsx` — consumeert sibling `./afwerking-kleur-koppelingen` via relative pad. Wordt alleen gebruikt door `pages/instellingen/afwerkingen.tsx:6`. Hoort dus volledig bij Maatwerk-Module.

Kopieer naar `frontend/src/modules/maatwerk/components/`. Update imports:
- `@/lib/supabase/queries/op-maat` → `@/modules/maatwerk`
- `@/lib/supabase/queries/afwerking-kleuren` blijft (separate query-file, geen Module-eigendom voor V1)
- Relative-import `./afwerking-kleur-koppelingen` blijft relatief — werkt automatisch na verhuizing (sibling staat nu naast).

- [ ] **Step 2: Maak `hooks/use-maatwerk-instellingen.ts`**

Combineer inhoud van `frontend/src/hooks/use-vormen.ts` (3 exports) en `frontend/src/hooks/use-afwerkingen.ts` (4 exports). Update imports naar `../queries/maatwerk-instellingen` (intern, niet via barrel — anders circulaire afhankelijkheid).

**Werkelijke exports die behouden moeten blijven (7 totaal):**
- Uit `use-vormen.ts`: `useAlleVormen`, `useUpsertVorm`, `useDeleteVorm`
- Uit `use-afwerkingen.ts`: `useAlleAfwerkingen`, `useTypeBewerkingen`, `useUpsertAfwerking`, `useDeleteAfwerking`

```ts
// frontend/src/modules/maatwerk/hooks/use-maatwerk-instellingen.ts
//
// Admin-mutations + reads voor vormen + afwerkingen. Wraps queries/maatwerk-instellingen.ts.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchAlleVormen,
  upsertVorm,
  deleteVorm,
  fetchAlleAfwerkingTypes,
  upsertAfwerkingType,
  deleteAfwerkingType,
} from '../queries/maatwerk-instellingen'
import { fetchTypeBewerkingen } from '../queries/maatwerk-runtime'

// 1-op-1 kopie van alle 7 hook-functies. Behoud de exact-namen.
```

- [ ] **Step 3: Verhuis pages**

Lees [`frontend/src/pages/instellingen/vormen.tsx`](../../../frontend/src/pages/instellingen/vormen.tsx) en [`frontend/src/pages/instellingen/afwerkingen.tsx`](../../../frontend/src/pages/instellingen/afwerkingen.tsx). Kopieer naar `frontend/src/modules/maatwerk/pages/`. Update imports:

- `@/components/instellingen/vorm-form-dialog` → `../components/vorm-form-dialog`
- `@/lib/supabase/queries/op-maat` → `@/modules/maatwerk`
- `@/hooks/use-vormen` / `@/hooks/use-afwerkingen` → `../hooks/use-maatwerk-instellingen`

- [ ] **Step 4: Update barrel**

```ts
// In frontend/src/modules/maatwerk/index.ts toevoegen:
export {
  useAlleVormen,
  useUpsertVorm,
  useDeleteVorm,
  useAlleAfwerkingen,
  useTypeBewerkingen,
  useUpsertAfwerking,
  useDeleteAfwerking,
} from './hooks/use-maatwerk-instellingen'
export { VormenInstellingenPage } from './pages/vormen-instellingen'
export { AfwerkingenInstellingenPage } from './pages/afwerkingen-instellingen'
```

- [ ] **Step 5: Verifieer typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/maatwerk
git commit -m "refactor(maatwerk): verhuis admin-components + pages + hooks naar Module (stap 8/10)"
```

---

## Task 9: Update consumers — switch naar `@/modules/maatwerk`

**Files:**
- Modify: `frontend/src/components/orders/order-form.tsx`
- Modify: `frontend/src/components/orders/order-line-editor.tsx`
- Modify: `frontend/src/pages/producten/kwaliteit-kleuren-uitvouw.tsx`
- Modify: `frontend/src/pages/producten/kwaliteiten-grouped-view.tsx`
- Modify: `frontend/src/pages/producten/product-create.tsx`
- Modify: `frontend/src/router.tsx` (regels 31-32, 129-130)

**Doel:** Alle consumers wijzigen van oude paden naar `@/modules/maatwerk`. Geen runtime-gedrag-wijziging — typecheck en bestaande tests moeten blijven passen.

- [ ] **Step 1: Update `order-form.tsx`**

In [`frontend/src/components/orders/order-form.tsx`](../../../frontend/src/components/orders/order-form.tsx):

Regel 17:
```ts
// Was:
import { berekenMaatwerkAfleverdatumViaSeam } from '@/lib/utils/maatwerk-leverdatum'
// Wordt:
import { berekenMaatwerkAfleverdatumViaSeam } from '@/modules/maatwerk'
```

**Imports + JSX-tag-updates:**
- `OpMaatSelector` is in Task 7 hernoemd naar `MaatwerkSelector`. Update zowel de import (`@/modules/maatwerk`) als alle JSX-instances `<OpMaatSelector ... />` → `<MaatwerkSelector ... />` in deze file.
- `MaatwerkLevertijdHint` import-pad updaten (geen rename): `./maatwerk-levertijd-hint` of `@/components/orders/maatwerk-levertijd-hint` → `@/modules/maatwerk`.

- [ ] **Step 2: Update `order-line-editor.tsx`**

Regel 5:
```ts
// Was:
import { berekenPrijsOppervlakM2 } from '@/lib/utils/maatwerk-prijs'
// Wordt:
import { berekenPrijsOppervlakM2 } from '@/modules/maatwerk'
```

Eventuele imports voor `KwaliteitFirstSelector` / `KwaliteitKleurSelector` / `VormAfmetingSelector`: switch naar `@/modules/maatwerk`.

- [ ] **Step 3: Update 3 producten-pages**

In `kwaliteit-kleuren-uitvouw.tsx`, `kwaliteiten-grouped-view.tsx`, `product-create.tsx`:

```ts
// Was:
import { ... } from '@/lib/supabase/queries/op-maat'
// Wordt:
import { ... } from '@/modules/maatwerk'
```

- [ ] **Step 4: Update `router.tsx`**

Regels 31-32 en 129-130:

```ts
// Was:
import { VormenInstellingenPage } from '@/pages/instellingen/vormen'
import { AfwerkingenInstellingenPage } from '@/pages/instellingen/afwerkingen'
// ...
{ path: 'instellingen/vormen', element: <VormenInstellingenPage /> },
{ path: 'instellingen/afwerkingen', element: <AfwerkingenInstellingenPage /> },

// Wordt:
import { VormenInstellingenPage, AfwerkingenInstellingenPage } from '@/modules/maatwerk'
// ...
{ path: 'instellingen/vormen', element: <VormenInstellingenPage /> },
{ path: 'instellingen/afwerkingen', element: <AfwerkingenInstellingenPage /> },
```

(Routes-paden zelf blijven gelijk — geen breaking change voor bookmarks.)

- [ ] **Step 5: Zoek-en-verifieer overige consumers**

```bash
cd frontend && grep -rn "from '@/lib/supabase/queries/op-maat'\|from '@/lib/utils/maatwerk-prijs'\|from '@/lib/utils/maatwerk-leverdatum'\|from '@/components/orders/op-maat-selector'\|from '@/components/orders/maatwerk-levertijd-hint'\|from '@/components/orders/kwaliteit-first-selector'\|from '@/components/orders/kwaliteit-kleur-selector'\|from '@/components/orders/vorm-afmeting-selector'\|from '@/components/instellingen/vorm-form-dialog'\|from '@/components/instellingen/afwerking-form-dialog'\|from '@/components/instellingen/afwerking-kleur-koppelingen'\|from '@/components/instellingen/afwerking-kleuren-submenu'\|from '@/hooks/use-vormen'\|from '@/hooks/use-afwerkingen'" src
```

Expected: 0 hits. Als hits → update die imports analoog.

- [ ] **Step 6: Verifieer typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Run alle tests**

```bash
cd frontend && npx vitest run
```

Expected: alle bestaande tests groen. Geen regressie.

- [ ] **Step 8: Run dev-server smoke test**

```bash
cd frontend && npm run dev
```

Open browser:
1. `/orders/nieuw` — zet "Op maat"-toggle aan, kies kwaliteit/kleur, vul afmeting, verifieer dat prijs verschijnt en `<MaatwerkLevertijdHint>` rendert.
2. `/instellingen/vormen` — verifieer dat lijst laadt + dialog opent.
3. `/instellingen/afwerkingen` — idem.
4. `/producten/[id]` — verifieer dat kwaliteit-kleuren-uitvouw werkt.

- [ ] **Step 9: Commit**

```bash
git add frontend/src
git commit -m "refactor(maatwerk): switch consumers naar @/modules/maatwerk (stap 9/10)"
```

---

## Task 10: Verwijder oude files + ESLint-regressie-regel

**Files:**
- Delete (17 files): zie "Te verwijderen" in File Structure
- Modify: `frontend/eslint.config.js` (flat config — `.eslintrc.cjs` bestaat niet in dit project)

**Doel:** Eindfase: oude files weg, regressie-regel actief. Vóór deze stap moet alle code via `@/modules/maatwerk` lopen (Task 9 garandeert dat).

- [ ] **Step 1: Verifieer dat geen consumer meer naar oude paden importeert**

```bash
cd frontend && grep -rn "from '@/lib/supabase/queries/op-maat'\|from '@/lib/utils/maatwerk-prijs'\|from '@/lib/utils/maatwerk-leverdatum'\|from '@/components/orders/op-maat-selector'\|from '@/components/orders/maatwerk-levertijd-hint'\|from '@/components/orders/kwaliteit-first-selector'\|from '@/components/orders/kwaliteit-kleur-selector'\|from '@/components/orders/vorm-afmeting-selector'\|from '@/components/instellingen/vorm-form-dialog'\|from '@/components/instellingen/afwerking-form-dialog'\|from '@/components/instellingen/afwerking-kleur-koppelingen'\|from '@/pages/instellingen/vormen'\|from '@/pages/instellingen/afwerkingen'\|from '@/hooks/use-vormen'\|from '@/hooks/use-afwerkingen'" src
```

Expected: 0 hits. Als hits → STOP, fix in Task 9.

- [ ] **Step 2: Verwijder 17 files**

```bash
cd frontend
rm src/lib/supabase/queries/op-maat.ts
rm src/lib/supabase/queries/__tests__/op-maat.test.ts
rm src/lib/utils/maatwerk-prijs.ts
rm src/lib/utils/maatwerk-leverdatum.ts
rm src/components/orders/op-maat-selector.tsx
rm src/components/orders/maatwerk-levertijd-hint.tsx
rm src/components/orders/kwaliteit-first-selector.tsx
rm src/components/orders/kwaliteit-kleur-selector.tsx
rm src/components/orders/vorm-afmeting-selector.tsx
rm src/components/instellingen/vorm-form-dialog.tsx
rm src/components/instellingen/afwerking-form-dialog.tsx
rm src/components/instellingen/afwerking-kleur-koppelingen.tsx
rm src/components/instellingen/afwerking-kleuren-submenu.tsx
rm src/pages/instellingen/vormen.tsx
rm src/pages/instellingen/afwerkingen.tsx
rm src/hooks/use-vormen.ts
rm src/hooks/use-afwerkingen.ts
```

- [ ] **Step 3: Verifieer typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run alle tests**

```bash
cd frontend && npx vitest run
```

Expected: PASS (testfile in `modules/maatwerk/queries/__tests__/maatwerk-runtime.test.ts` neemt het over).

- [ ] **Step 5: Voeg ESLint-regressie-regel toe (flat config)**

Open `frontend/eslint.config.js`. Lees eerst de bestaande structuur — flat config is een array van config-objecten. Voeg de regel toe in de bestaande config-object dat over `src/**`-bestanden gaat (of in een nieuw object):

```js
// frontend/eslint.config.js — voeg toe in het rules-blok van de TS-config:
rules: {
  // ... bestaande regels ...
  'no-restricted-imports': ['error', {
    paths: [
      { name: '@/lib/supabase/queries/op-maat', message: 'Gebruik @/modules/maatwerk (ADR-0009).' },
      { name: '@/lib/utils/maatwerk-prijs', message: 'Gebruik @/modules/maatwerk (ADR-0009).' },
      { name: '@/lib/utils/maatwerk-leverdatum', message: 'Gebruik @/modules/maatwerk (ADR-0009).' },
    ],
  }],
},
```

Als de bestaande config al een `no-restricted-imports`-regel heeft: combineer de `paths`-arrays. Bewaar bestaande regels.

- [ ] **Step 6: Run lint om regel te verifiëren**

```bash
cd frontend && npx eslint src --max-warnings 0
```

Expected: PASS.

- [ ] **Step 7: Final dev-server smoke test**

Herhaal de smoke test uit Task 9 stap 8: order-form maatwerk-flow, instellingen-vormen, instellingen-afwerkingen, producten-detail. Verifieer dat alles werkt na verwijdering van oude files.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(maatwerk): verwijder oude files + ESLint regressie-regel (stap 10/10)"
```

- [ ] **Step 9: Update changelog-entry van 2026-05-08**

In [`docs/changelog.md`](../../changelog.md): de bestaande "Maatwerk-Module — ADR-0009 (architectuur-beslissing, geen code-verhuizing)"-entry bijwerken naar "Maatwerk-Module — ADR-0009 + uitvoering" met een korte noot dat de migratie nu echt heeft plaatsgevonden + commit-range.

```bash
git add docs/changelog.md
git commit -m "docs(maatwerk): changelog-entry uitvoering ADR-0009"
```

---

## Verificatie-checklist (vóór finishing-a-development-branch)

- [ ] `npx tsc --noEmit` groen
- [ ] `npx vitest run` groen (incl. nieuwe `maatwerk-runtime.test.ts`)
- [ ] `npx eslint src --max-warnings 0` groen
- [ ] Dev-server smoke test geslaagd: maatwerk-orderregel + instellingen-vormen + instellingen-afwerkingen + producten-detail
- [ ] `grep -rn "from '@/lib/supabase/queries/op-maat'" src` levert 0 hits
- [ ] Geen regressie in `op-maat.test.ts`-coverage (drie invarianten gedekt door nieuwe testfile)
- [ ] CLAUDE.md "Maatwerk levertijd-indicator"-bullet vermeldt nog steeds correcte hint-bron
- [ ] [`docs/architectuur.md`](../../architectuur.md) Maatwerk-Module-sectie reflecteert eindstaat
- [ ] [`docs/data-woordenboek.md`](../../data-woordenboek.md) sectie `## Maatwerk` actueel
- [ ] [`docs/adr/0009-maatwerk-als-deep-module.md`](../../adr/0009-maatwerk-als-deep-module.md) onveranderd (status blijft `accepted`)

---

## Niet in scope (V2-backlog)

- Regel-row-splitsing (`<MaatwerkRegelRow>` + `<StandaardRegelRow>`) in order-form. Vereist refactor van form-state-management.
- Eigen tabel `maatwerk_instellingen` voor centralisatie van vorm-toeslag-bedrag, BTW-per-land, prijs-staffels.
- Snij-marge-cross-cut formaliseren met TS↔SQL-contract-test (parallel aan zending-bundel-sleutel uit mig 228).
- Producten-Module en Klanten-Module — kandidaten #2 en #3 uit architectuur-review 2026-05-08, apart traject.
- DB-roundtrip voor maatwerk-prijs-formule mocht ooit een snij-marge-component nodig zijn (huidig: client-side TS volstaat).
