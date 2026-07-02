# Fase 1 — Order-commit-pipeline (TS-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De create-flow-orkestratie uit `saveMutation.mutationFn` (order-form.tsx) extraheren naar pure functie `bouwOrderCommit(input) → OrderCommitPlan` in `frontend/src/lib/orders/order-commit.ts`, met golden fixtures die het HUIDIGE gedrag eerst vastpinnen (characterization, RED → GREEN → rewire).

**Architecture:** "Order-commit" (CONTEXT.md-term) wordt een pure, deterministische planningsfunctie: dekking → split-keuze → verzend-toewijzing → lever_modus → lijst van aan te maken orders. Alle I/O (seam-datum via `check-levertijd`, `createOrder`-RPC, claims, autoplan) blijft in de form; de pure functie krijgt de seam-datum als input. Bestaande pure bouwstenen worden hergebruikt: `wijsVerzendNaarDuurste` + `splitRegelOpDekking` (`split-order.ts`, al getest), `berekenRegelDekking` (`dekking-preview.ts`), `verzendWeekVoor` (`verzendweek.ts`). RPC-laag (`order-mutations.ts`) en edit-flow blijven byte-voor-byte ongemoeid.

**Tech Stack:** React/TypeScript (Vite), Vitest, TanStack Query. Geen SQL, geen migraties, geen edge functions in deze fase.

---

## Kritische randvoorwaarden (eigenaar-besluiten — NIET heronderhandelen)

1. **Gedragsbehoud is heilig.** De fixtures pinnen het huidige gedrag inclusief vastgestelde eigenaardigheden:
   - Sub-orders van een IO-tekort-split krijgen `lever_modus: 'in_een_keer'` (terwijl de operator 'deelleveringen' koos).
   - Verzend-tie (gelijke totalen) gaat naar deel A.
   - De IO-split raakt `afleverdatum`/`week` van de sub-orders NIET aan (beide houden de header-waarden).
   - Een spoed-regel (`SPOEDTOESLAG`, aangemaakt door `applySpoedToeslag` zónder `is_pseudo`-vlag) telt in `berekenRegelDekking` als IO-tekort (te_leveren 1, vrije_voorraad undefined → ioTekort 1) en verhuist bij een IO-split volledig naar het IO-deel. Niet fixen — pinnen.
   - De VERZEND-regel uit `applyShippingLogic` draagt wél `is_pseudo: true` en telt dus NIET als IO-tekort.
2. **Geen gedragsverbeteringen meenemen** (form-idempotency, uniform `'aangemaakt'`-event) — Fase 2-beslispunten.
3. **De drie open bevindingen uit testorder ORD-2026-0118** (dubbele Selections-regels, € 0,00-prijzen, ontbrekende snijplannen) zijn aparte fixes — niet laten meeliften.
4. **Merge naar `main` alleen op expliciet commando van Miguel.**

### Fixture-correctie-regel (belangrijk voor de uitvoerder)

De verwachte outputs in de fixtures zijn met de hand afgeleid uit de huidige code in `order-form.tsx` (create-flow, regels 424–510 vóór deze refactor). Als een test faalt terwijl je implementatie de oude code regel-voor-regel spiegelt: verifieer eerst de afleiding tegen de oude code (en `verzendWeekVoor` voor weeknummers) vóór je de implementatie "fixt". Een fixture mag alleen gecorrigeerd worden als de handafleiding aantoonbaar fout was — documenteer dat dan in de commit-message. Nooit de implementatie van de oude code laten afwijken om een fixture te halen.

---

## File Structure

| Bestand | Actie | Verantwoordelijkheid |
|---|---|---|
| `frontend/src/lib/orders/order-commit.ts` | **Nieuw** | Pure commit-planning: `bouwOrderCommit`, `isGemengdeSplit`, types `OrderCommitInput`/`OrderCommitOrder`/`OrderCommitPlan` |
| `frontend/src/lib/orders/__tests__/order-commit.fixtures.ts` | **Nieuw** | Golden fixtures (7 scenario's) — TS-modules conform repo-precedent (`modules/reserveringen/lib/fixtures.ts`), niet JSON (geen `resolveJsonModule`-afhankelijkheid) |
| `frontend/src/lib/orders/__tests__/order-commit.test.ts` | **Nieuw** | Golden-fixture-loop + `isGemengdeSplit`-cases + geen-mutatie-garantie |
| `frontend/src/components/orders/order-form.tsx` | **Wijzigen** (alleen create-branch van `mutationFn`, regels ~424–510, + imports) | Vertaalt plan → side-effects (`createOrder`, `persistUitwisselbaarKeuzes`, `triggerAutoplanForMaatwerk`); seam-datum ophalen blijft hier |
| `docs/changelog.md` | **Wijzigen** | Entry voor de extractie |

**Niet aanraken:** `order-mutations.ts`, `split-order.ts`, `dekking-preview.ts`, `leverdatum.ts` (maatwerk-seam), de hele edit-branch van `mutationFn`, `onSuccess`/`onError`.

---

## Task 0: Worktree + baseline

**Files:** geen (omgeving).

- [ ] **Step 0.1: Worktree aanmaken** (vanuit de hoofd-repo `c:\Users\migue\Documents\Karpi ERP`):

```powershell
git worktree add ../karpi-order-commit -b refactor/order-commit-pipeline main
```

Expected: `Preparing worktree (new branch 'refactor/order-commit-pipeline')`. Werk vanaf nu UITSLUITEND in `C:\Users\migue\Documents\karpi-order-commit` (hoofd-tree wordt gedeeld door parallelle sessies — collisie-incident 8 juni). Let op: dit planbestand en `CONTEXT.md` zijn untracked in de hoofd-tree en bestaan dus NIET in de worktree — lees ze via hun absolute pad in de hoofd-tree.

- [ ] **Step 0.2: Dependencies installeren** (worktree heeft geen `node_modules`):

```powershell
cd C:\Users\migue\Documents\karpi-order-commit\frontend
npm install
```

- [ ] **Step 0.3: Baseline verifiëren**:

```powershell
npx vitest run src/lib/orders/__tests__/split-order.test.ts
npm run typecheck
```

Expected: split-order 8/8 PASS; typecheck schoon. (Bekende pre-existing failure elders: `magazijn-pickbaarheid.contract.test.ts` 7/7 — niet draaien, niet fixen.) Faalt typecheck op main-code: STOP en meld — niet zelf main-problemen fixen op deze branch.

---

## Task 1: Golden fixtures + failing test (RED)

**Files:**
- Create: `frontend/src/lib/orders/__tests__/order-commit.fixtures.ts`
- Create: `frontend/src/lib/orders/__tests__/order-commit.test.ts`

- [ ] **Step 1.1: Schrijf het fixtures-bestand** — exact deze inhoud:

```typescript
// Golden fixtures voor bouwOrderCommit — pinnen het HUIDIGE gedrag van de
// create-flow in saveMutation.mutationFn (order-form.tsx) vóór de extractie.
// Eigenaardigheden zijn bewust vastgelegd (gedragsbehoud, zie detailplan
// 2026-06-10-fase1-order-commit-pipeline-detailplan.md):
//   - IO-tekort-split: sub-orders krijgen lever_modus 'in_een_keer' en
//     behouden de oorspronkelijke afleverdatum/week uit de header.
//   - Verzend-tie (gelijke totalen) gaat naar deel A.
//   - Spoed-regel (geen is_pseudo-vlag) telt als IO-tekort en verhuist bij
//     een IO-split volledig naar het IO-deel.
import type { OrderFormData, OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import type { OrderCommitInput, OrderCommitPlan } from '../order-commit'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'
import { SPOED_PRODUCT_ID } from '@/lib/constants/spoed'

export interface OrderCommitGolden {
  naam: string
  toelichting: string
  input: OrderCommitInput
  verwacht: OrderCommitPlan
}

const DEBITEUR_NR = 100001

const HEADER: Partial<OrderFormData> = {
  klant_referentie: 'TEST-REF',
  afleverdatum: '2026-06-19', // ISO-week 25
  week: '25',
  fact_naam: 'Testklant BV',
  afl_naam: 'Testklant BV',
  afl_plaats: 'Utrecht',
  lever_type: 'week',
}

/** Spiegelt orderData in de huidige mutationFn (zonder lever_modus-override). */
const ORDER_DATA: OrderFormData = { ...HEADER, afhalen: false, debiteur_nr: DEBITEUR_NR }

const GEMENGD_INFO = {
  standaardDatum: '2026-06-12', // ISO-week 24
  maatwerkDatum: '2026-07-10',
  langsteDatum: '2026-07-10',
  heeftGemengd: true,
}

const STANDAARD_INFO = {
  standaardDatum: '2026-06-12',
  maatwerkDatum: null,
  langsteDatum: '2026-06-12',
  heeftGemengd: false,
}

// — regels —
const STANDAARD_300: OrderRegelFormData = {
  artikelnr: '10001', omschrijving: 'Karpet 160x230',
  orderaantal: 2, te_leveren: 2, prijs: 150, korting_pct: 0, bedrag: 300,
  vrije_voorraad: 10,
}
const MAATWERK_500: OrderRegelFormData = {
  artikelnr: 'MW-VLOER', omschrijving: 'Maatwerk vloerkleed',
  orderaantal: 1, te_leveren: 1, prijs: 500, korting_pct: 0, bedrag: 500,
  is_maatwerk: true, maatwerk_kwaliteit_code: 'VERR', maatwerk_kleur_code: '130',
  maatwerk_lengte_cm: 300, maatwerk_breedte_cm: 200,
}
// Zoals applyShippingLogic hem aanmaakt — mét is_pseudo (telt dus niet als IO-tekort).
const VERZEND_15: OrderRegelFormData = {
  artikelnr: SHIPPING_PRODUCT_ID, omschrijving: 'Verzendkosten',
  orderaantal: 1, te_leveren: 1, prijs: 15, korting_pct: 0, bedrag: 15,
  is_pseudo: true,
}
// Zoals applySpoedToeslag hem aanmaakt — ZONDER is_pseudo (telt als IO-tekort).
const SPOED_50: OrderRegelFormData = {
  artikelnr: SPOED_PRODUCT_ID, omschrijving: 'Spoedtoeslag',
  orderaantal: 1, te_leveren: 1, prijs: 50, korting_pct: 0, bedrag: 50,
}
const TEKORT_REGEL: OrderRegelFormData = {
  artikelnr: '20001', omschrijving: 'Karpet A',
  orderaantal: 10, te_leveren: 10, prijs: 100, korting_pct: 0, bedrag: 1000,
  vrije_voorraad: 4,
  uitwisselbaar_keuzes: [{ artikelnr: '20002', aantal: 2 }],
}
const GEDEKTE_REGEL: OrderRegelFormData = {
  artikelnr: '20003', omschrijving: 'Karpet B',
  orderaantal: 2, te_leveren: 2, prijs: 50, korting_pct: 0, bedrag: 100,
  vrije_voorraad: 5,
}
const PSEUDO_REGEL: OrderRegelFormData = {
  artikelnr: 'KORTING1', omschrijving: 'Administratieve korting',
  orderaantal: 3, te_leveren: 3, korting_pct: 0, bedrag: 0,
  is_pseudo: true,
}
const TEKORT_KLEIN: OrderRegelFormData = {
  artikelnr: '30001', omschrijving: 'Karpet C',
  orderaantal: 5, te_leveren: 5, prijs: 100, korting_pct: 0, bedrag: 500,
  vrije_voorraad: 2,
}
const GEDEKTE_400: OrderRegelFormData = {
  artikelnr: '40001', omschrijving: 'Karpet D',
  orderaantal: 4, te_leveren: 4, prijs: 100, korting_pct: 0, bedrag: 400,
  vrije_voorraad: 4,
}

export const ORDER_COMMIT_GOLDENS: OrderCommitGolden[] = [
  {
    naam: 'a-gemengde-split-verzend-naar-duurste',
    toelichting:
      'deelleveringen AAN + gemengd → 2 orders; standaard-order krijgt standaardDatum (wk 24), ' +
      'maatwerk-order krijgt seam-datum (wk 29); verzend naar duurste deel (maatwerk, 500 > 300); ' +
      'autoplan alleen op maatwerk-deel.',
    input: {
      regels: [STANDAARD_300, MAATWERK_500, VERZEND_15],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: true,
      afleverdatumInfo: GEMENGD_INFO,
      echteMaatwerkDatum: '2026-07-17', // ISO-week 29
    },
    verwacht: {
      gesplitst: true,
      orders: [
        {
          header: { ...ORDER_DATA, afleverdatum: '2026-06-12', week: '24' },
          regels: [STANDAARD_300],
          triggerAutoplan: false,
        },
        {
          header: { ...ORDER_DATA, afleverdatum: '2026-07-17', week: '29' },
          regels: [MAATWERK_500, VERZEND_15],
          triggerAutoplan: true,
        },
      ],
    },
  },
  {
    naam: 'b-io-tekort-split-met-override-modus',
    toelichting:
      'overrideLeverModus=deelleveringen + IO-tekort → 2 orders met lever_modus in_een_keer; ' +
      'tekort-regel splitst 6/4 met proportionele bedragen; gedekte + maatwerk-regels blijven direct; ' +
      'verzend naar duurste deel (direct, 1200 > 400); afleverdatum/week ongewijzigd uit header; ' +
      'deelleveringen-checkbox UIT + heeftGemengd=true pint dat gemengd alléén niet splitst.',
    input: {
      regels: [TEKORT_REGEL, GEDEKTE_REGEL, MAATWERK_500, VERZEND_15],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: false,
      overrideLeverModus: 'deelleveringen',
      afleverdatumInfo: { ...GEMENGD_INFO },
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: true,
      orders: [
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [
            { ...TEKORT_REGEL, orderaantal: 6, te_leveren: 6, bedrag: 600 },
            GEDEKTE_REGEL,
            MAATWERK_500,
            VERZEND_15,
          ],
          triggerAutoplan: true,
        },
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [
            { ...TEKORT_REGEL, orderaantal: 4, te_leveren: 4, uitwisselbaar_keuzes: [], bedrag: 400 },
          ],
          triggerAutoplan: false,
        },
      ],
    },
  },
  {
    naam: 'c-geen-split',
    toelichting: 'geen modus, geen gemengd, alles gedekt → 1 order, regels ongewijzigd incl. verzend.',
    input: {
      regels: [STANDAARD_300, VERZEND_15],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: false,
      afleverdatumInfo: STANDAARD_INFO,
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: false,
      orders: [
        { header: ORDER_DATA, regels: [STANDAARD_300, VERZEND_15], triggerAutoplan: true },
      ],
    },
  },
  {
    naam: 'd-verzend-tie-naar-deel-a-en-seam-fallback',
    toelichting:
      'gemengde split met gelijke totalen (250 == 250) → verzend naar deel A (standaard); ' +
      'echteMaatwerkDatum null → maatwerk-order valt terug op header-afleverdatum/week.',
    input: {
      regels: [
        { ...STANDAARD_300, prijs: 125, bedrag: 250 },
        { ...MAATWERK_500, prijs: 250, bedrag: 250 },
        { ...VERZEND_15, prijs: 10, bedrag: 10 },
      ],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: true,
      afleverdatumInfo: GEMENGD_INFO,
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: true,
      orders: [
        {
          header: { ...ORDER_DATA, afleverdatum: '2026-06-12', week: '24' },
          regels: [
            { ...STANDAARD_300, prijs: 125, bedrag: 250 },
            { ...VERZEND_15, prijs: 10, bedrag: 10 },
          ],
          triggerAutoplan: false,
        },
        {
          header: { ...ORDER_DATA },
          regels: [{ ...MAATWERK_500, prijs: 250, bedrag: 250 }],
          triggerAutoplan: true,
        },
      ],
    },
  },
  {
    naam: 'e-admin-pseudo-blijft-direct-header-modus',
    toelichting:
      'lever_modus uit header (geen override) + IO-tekort → split; admin-pseudo-regel heeft ' +
      'dekking 0/0/0 (geskipt) en blijft ongewijzigd in het directe deel; geen verzendregel.',
    input: {
      regels: [PSEUDO_REGEL, TEKORT_KLEIN],
      header: { ...HEADER, lever_modus: 'deelleveringen' },
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: false,
      afleverdatumInfo: STANDAARD_INFO,
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: true,
      orders: [
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [PSEUDO_REGEL, { ...TEKORT_KLEIN, orderaantal: 2, te_leveren: 2, bedrag: 200 }],
          triggerAutoplan: true,
        },
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [
            { ...TEKORT_KLEIN, orderaantal: 3, te_leveren: 3, uitwisselbaar_keuzes: [], bedrag: 300 },
          ],
          triggerAutoplan: false,
        },
      ],
    },
  },
  {
    naam: 'f-spoed-zonder-modus-geen-split',
    toelichting:
      'spoed-regel geeft ioTekort 1 (geen is_pseudo-vlag), maar zonder lever_modus volgt ' +
      'gewoon 1 order met alle regels — eigenaardigheid bewust gepind.',
    input: {
      regels: [GEDEKTE_REGEL, SPOED_50],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: false,
      afleverdatumInfo: STANDAARD_INFO,
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: false,
      orders: [
        { header: ORDER_DATA, regels: [GEDEKTE_REGEL, SPOED_50], triggerAutoplan: true },
      ],
    },
  },
  {
    naam: 'g-spoed-eigenaardigheid-verhuist-naar-io-deel',
    toelichting:
      'EIGENAARDIGHEID (gepind, niet fixen): bij modus deelleveringen triggert de spoed-regel ' +
      'zelf de IO-split (ioTekort 1 door ontbrekende is_pseudo-vlag) en verhuist hij volledig ' +
      'naar het IO-deel, met geleegde uitwisselbaar_keuzes.',
    input: {
      regels: [GEDEKTE_400, SPOED_50],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: false,
      overrideLeverModus: 'deelleveringen',
      afleverdatumInfo: STANDAARD_INFO,
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: true,
      orders: [
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [GEDEKTE_400],
          triggerAutoplan: true,
        },
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [{ ...SPOED_50, uitwisselbaar_keuzes: [] }],
          triggerAutoplan: false,
        },
      ],
    },
  },
]
```

- [ ] **Step 1.2: Schrijf het testbestand** — exact deze inhoud:

```typescript
import { describe, it, expect } from 'vitest'
import { bouwOrderCommit, isGemengdeSplit } from '../order-commit'
import { ORDER_COMMIT_GOLDENS } from './order-commit.fixtures'

describe('bouwOrderCommit — golden fixtures (gedragsbehoud create-flow)', () => {
  for (const golden of ORDER_COMMIT_GOLDENS) {
    it(golden.naam, () => {
      // toEqual (niet toStrictEqual): de oude code zet bewust `id: undefined`
      // op IO-regels uit een gemengde dekking-split; fixtures laten die key weg.
      expect(bouwOrderCommit(golden.input)).toEqual(golden.verwacht)
    })
  }
})

describe('isGemengdeSplit', () => {
  it('alleen true als deelleveringen-checkbox AAN én order gemengd is', () => {
    expect(isGemengdeSplit(true, true)).toBe(true)
    expect(isGemengdeSplit(true, false)).toBe(false)
    expect(isGemengdeSplit(false, true)).toBe(false)
    expect(isGemengdeSplit(false, false)).toBe(false)
  })
})

describe('bouwOrderCommit — structuurgaranties', () => {
  it('muteert de input niet (pure functie)', () => {
    const golden = ORDER_COMMIT_GOLDENS[1] // IO-split: het meest mutatie-gevoelige pad
    const kopie = structuredClone(golden.input)
    bouwOrderCommit(golden.input)
    expect(golden.input).toEqual(kopie)
  })

  it('gesplitst=true impliceert exact 2 orders, gesplitst=false exact 1', () => {
    for (const golden of ORDER_COMMIT_GOLDENS) {
      const plan = bouwOrderCommit(golden.input)
      expect(plan.orders).toHaveLength(plan.gesplitst ? 2 : 1)
    }
  })
})
```

- [ ] **Step 1.3: Run de test om RED te verifiëren**:

```powershell
npx vitest run src/lib/orders/__tests__/order-commit.test.ts
```

Expected: FAIL — `Failed to resolve import "../order-commit"` (module bestaat nog niet).

- [ ] **Step 1.4: Commit** (vanuit de worktree-root):

```powershell
cd C:\Users\migue\Documents\karpi-order-commit
git add frontend/src/lib/orders/__tests__/order-commit.fixtures.ts frontend/src/lib/orders/__tests__/order-commit.test.ts
git commit -m @'
test(orders): golden fixtures pinnen create-flow-gedrag voor order-commit-extractie

RED-fase: 7 characterization-scenario's afgeleid uit saveMutation.mutationFn
(gemengde split, IO-split, tie-naar-A, admin-pseudo, spoed-eigenaardigheid).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

## Task 2: `bouwOrderCommit` implementeren (GREEN)

**Files:**
- Create: `frontend/src/lib/orders/order-commit.ts`

- [ ] **Step 2.1: Schrijf de module** — exact deze inhoud. Elke regel spiegelt de oude create-flow (order-form.tsx regels 424–510); de inline-comments markeren de herkomst:

```typescript
// Pure orkestratie van de handmatige order-aanmaak ("Order-commit", zie
// CONTEXT.md): dekking → split-keuze → verzend-toewijzing → lever_modus →
// lijst van aan te maken orders. Geëxtraheerd uit saveMutation.mutationFn
// (order-form.tsx) met strikt gedragsbehoud — golden fixtures in
// __tests__/order-commit.fixtures.ts pinnen het gedrag, inclusief bewuste
// eigenaardigheden (IO-sub-orders krijgen 'in_een_keer'; verzend-tie → deel A).
// Geen React, geen I/O: de maatwerk-seam-datum (check-levertijd) komt als
// input mee, de caller voert het plan uit (createOrder per order).
import type { OrderFormData, OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import type { LeverModus } from '@/modules/reserveringen'
import type { AfleverdatumResult } from '@/lib/utils/afleverdatum'
import { berekenRegelDekking } from '@/modules/reserveringen/lib/dekking-preview'
import { wijsVerzendNaarDuurste, splitRegelOpDekking } from './split-order'
import { verzendWeekVoor } from './verzendweek'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'

export interface OrderCommitInput {
  regels: OrderRegelFormData[]
  header: Partial<OrderFormData>
  debiteurNr: number
  afhalen: boolean
  /** Stand van de "Deelleveringen"-checkbox (gemengde standaard/maatwerk-split). */
  deelleveringen: boolean
  /** Keuze uit de LeverModusDialog; wint van header.lever_modus. */
  overrideLeverModus?: LeverModus
  afleverdatumInfo: AfleverdatumResult
  /**
   * Vooraf door de caller bepaald via berekenMaatwerkAfleverdatumViaSeam
   * (issue #33) — alléén relevant (en alléén op te halen) wanneer
   * isGemengdeSplit(...) true is. null = terugvallen op header-afleverdatum.
   */
  echteMaatwerkDatum: string | null
}

export interface OrderCommitOrder {
  header: OrderFormData
  regels: OrderRegelFormData[]
  /** Moet de caller ná createOrder triggerAutoplanForMaatwerk op deze regels aanroepen? */
  triggerAutoplan: boolean
}

export interface OrderCommitPlan {
  /** 1 order (geen split) of 2 ([standaard/direct, maatwerk/IO] — die volgorde). */
  orders: OrderCommitOrder[]
  gesplitst: boolean
}

/**
 * Enige bron-van-waarheid voor de gemengde-split-beslissing — de caller
 * gebruikt dit óók om te bepalen of de maatwerk-seam-datum opgehaald moet
 * worden (I/O die buiten deze pure module blijft).
 */
export function isGemengdeSplit(deelleveringen: boolean, heeftGemengd: boolean): boolean {
  return deelleveringen && heeftGemengd
}

function getISOWeek(dateStr: string): number {
  return verzendWeekVoor(dateStr)?.week ?? 0
}

export function bouwOrderCommit(input: OrderCommitInput): OrderCommitPlan {
  const {
    regels, header, debiteurNr, afhalen, deelleveringen,
    overrideLeverModus, afleverdatumInfo, echteMaatwerkDatum,
  } = input

  const headerWithModus: Partial<OrderFormData> = overrideLeverModus
    ? { ...header, lever_modus: overrideLeverModus, afhalen }
    : { ...header, afhalen }
  const orderData: OrderFormData = { ...headerWithModus, debiteur_nr: debiteurNr }

  // Split-order flow: deelleveringen AAN + gemengde order (standaard + maatwerk)
  if (isGemengdeSplit(deelleveringen, afleverdatumInfo.heeftGemengd)) {
    const shippingRegel = regels.find(r => r.artikelnr === SHIPPING_PRODUCT_ID)
    const standaardRegels = regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID && !r.is_maatwerk)
    const maatwerkRegels = regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID && r.is_maatwerk)

    const standaardOrder: OrderFormData = {
      ...orderData,
      afleverdatum: afleverdatumInfo.standaardDatum ?? orderData.afleverdatum,
      week: afleverdatumInfo.standaardDatum
        ? String(getISOWeek(afleverdatumInfo.standaardDatum))
        : orderData.week,
    }
    const maatwerkOrder: OrderFormData = {
      ...orderData,
      afleverdatum: echteMaatwerkDatum ?? orderData.afleverdatum,
      week: echteMaatwerkDatum ? String(getISOWeek(echteMaatwerkDatum)) : orderData.week,
    }

    // Issue #33: verzendkosten naar de duurste sub-order (tie → deel A).
    const { deelA, deelB } = wijsVerzendNaarDuurste(standaardRegels, maatwerkRegels, shippingRegel)

    return {
      gesplitst: true,
      orders: [
        { header: standaardOrder, regels: deelA, triggerAutoplan: false },
        { header: maatwerkOrder, regels: deelB, triggerAutoplan: true },
      ],
    }
  }

  // IO-split flow: lever_modus=deelleveringen + ≥1 regel met IO-tekort.
  const effectieveModus = overrideLeverModus ?? headerWithModus.lever_modus
  const heeftIoTekort = regels.some(r => berekenRegelDekking(r).ioTekort > 0)

  if (effectieveModus === 'deelleveringen' && heeftIoTekort) {
    const directeRegels: OrderRegelFormData[] = []
    const ioRegels: OrderRegelFormData[] = []
    let shippingRegel: OrderRegelFormData | null = null

    for (const r of regels) {
      if (r.artikelnr === SHIPPING_PRODUCT_ID) {
        shippingRegel = r // pas later toewijzen aan duurste deel (issue #33)
        continue
      }
      const { directeRegel, ioRegel } = splitRegelOpDekking(r, berekenRegelDekking(r))
      if (directeRegel) directeRegels.push(directeRegel)
      if (ioRegel) ioRegels.push(ioRegel)
    }

    const verdeeld = wijsVerzendNaarDuurste(directeRegels, ioRegels, shippingRegel)

    // Sub-orders bewust op 'in_een_keer' — bestaand gedrag, gepind in fixtures.
    // De IO-order hangt aan de IO-leverdatum (mig 153 zet afleverdatum vooruit).
    return {
      gesplitst: true,
      orders: [
        { header: { ...orderData, lever_modus: 'in_een_keer' }, regels: verdeeld.deelA, triggerAutoplan: true },
        { header: { ...orderData, lever_modus: 'in_een_keer' }, regels: verdeeld.deelB, triggerAutoplan: false },
      ],
    }
  }

  return {
    gesplitst: false,
    orders: [{ header: orderData, regels, triggerAutoplan: true }],
  }
}
```

- [ ] **Step 2.2: Run de tests**:

```powershell
npx vitest run src/lib/orders/__tests__/order-commit.test.ts
```

Expected: PASS, 10 tests (7 goldens + 1 isGemengdeSplit + 2 structuurgaranties). Bij een fixture-mismatch: zie "Fixture-correctie-regel" bovenaan dit plan.

- [ ] **Step 2.3: Typecheck**:

```powershell
npm run typecheck
```

Expected: schoon.

- [ ] **Step 2.4: Commit**:

```powershell
cd C:\Users\migue\Documents\karpi-order-commit
git add frontend/src/lib/orders/order-commit.ts
git commit -m @'
feat(orders): pure bouwOrderCommit — create-flow-orkestratie als Order-commit-plan

GREEN-fase: spiegelt saveMutation.mutationFn create-branch 1-op-1; hergebruikt
wijsVerzendNaarDuurste, splitRegelOpDekking en berekenRegelDekking. Golden
fixtures 7/7 groen.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

## Task 3: order-form herbedraden naar het plan

**Files:**
- Modify: `frontend/src/components/orders/order-form.tsx` (imports + create-branch van `mutationFn`, regels ~424–510; edit-branch en alles daarbuiten ONGEMOEID)

- [ ] **Step 3.1: Imports aanpassen.** Verwijder regel 33:

```typescript
import { wijsVerzendNaarDuurste, splitRegelOpDekking } from '@/lib/orders/split-order'
```

en voeg op die plek toe:

```typescript
import { bouwOrderCommit, isGemengdeSplit } from '@/lib/orders/order-commit'
```

(`berekenRegelDekking` op regel 10 blijft — die voedt nog `tekortRegels`; `berekenMaatwerkAfleverdatumViaSeam` op regel 22 blijft ook.)

- [ ] **Step 3.2: Vervang de create-branch.** In `saveMutation.mutationFn`: vervang het volledige blok `if (mode === 'create') { … }` (van regel 424 `// Split-order flow: …` tot en met regel 510 `return { split: false as const, ...single }` plus de sluitaccolade van de if) door:

```typescript
      if (mode === 'create') {
        // Order-commit (CONTEXT.md): pure planning van de create-flow.
        // Enige I/O vóór het plan is de maatwerk-seam-datum (issue #33) —
        // alleen opgehaald wanneer de gemengde split daadwerkelijk speelt,
        // exact zoals de oude inline-branch deed.
        const echteMaatwerkDatum = isGemengdeSplit(deelleveringen, afleverdatumInfo.heeftGemengd)
          ? await berekenMaatwerkAfleverdatumViaSeam({
              maatwerkRegels: regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID && r.is_maatwerk),
              debiteurNr: client.debiteur_nr,
              fallbackDatum: afleverdatumInfo.maatwerkDatum,
              gewensteLeverdatum: header.afleverdatum ?? null,
            })
          : null

        const plan = bouwOrderCommit({
          regels,
          header,
          debiteurNr: client.debiteur_nr,
          afhalen,
          deelleveringen,
          overrideLeverModus,
          afleverdatumInfo,
          echteMaatwerkDatum,
        })

        // Side-effects in dezelfde volgorde als vóór de extractie:
        // alle orders aanmaken → claims persisteren → autoplan.
        const created: Awaited<ReturnType<typeof createOrder>>[] = []
        for (const o of plan.orders) {
          created.push(await createOrder(o.header, o.regels, snapshotCtx))
        }
        for (let i = 0; i < plan.orders.length; i++) {
          await persistUitwisselbaarKeuzes(created[i].id, plan.orders[i].regels)
        }
        for (let i = 0; i < plan.orders.length; i++) {
          if (plan.orders[i].triggerAutoplan) {
            await triggerAutoplanForMaatwerk(plan.orders[i].regels)
          }
        }

        return plan.gesplitst
          ? { split: true as const, standaard: created[0], maatwerk: created[1] }
          : { split: false as const, ...created[0] }
      } else {
```

De `else`-tak (edit-flow, `updateOrderWithLines`) en de regels erboven (`headerWithModus`, `orderData`, `snapshotCtx` — de edit-tak gebruikt `orderData` nog) blijven exact staan.

- [ ] **Step 3.3: Volledige verificatie**:

```powershell
npx vitest run src/lib/orders
npm run typecheck
```

Expected: alle tests in `src/lib/orders` PASS (order-commit 10, split-order 8, plus bestaande verzendweek/admin-pseudo/edi-leverweek/intake-predicaten/po-prefill); typecheck schoon. Let op: TS mag NIET klagen over ongebruikte `wijsVerzendNaarDuurste`-imports (verwijderd in 3.1) en `orderData` moet nog gebruikt zijn (edit-tak).

- [ ] **Step 3.4: Commit**:

```powershell
cd C:\Users\migue\Documents\karpi-order-commit
git add frontend/src/components/orders/order-form.tsx
git commit -m @'
refactor(orders): create-flow van order-form loopt via bouwOrderCommit

Geen logica-wijziging — mutationFn vertaalt het OrderCommitPlan naar dezelfde
side-effect-volgorde (createOrder per order, claims, autoplan). Edit-flow
ongemoeid. Golden fixtures bewaken gedragsbehoud.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

## Task 4: Levende docs + afronding

**Files:**
- Modify: `docs/changelog.md` (in de worktree — bestand is getrackt en bestaat daar)

- [ ] **Step 4.1: Changelog-entry toevoegen** bovenaan (onder de eventuele kop, in de huidige stijl van het bestand):

```markdown
## 2026-06-10 — Order-commit-pipeline: create-flow als pure functie (Fase 1 order-intake-verdieping)

- **Wat:** de create-flow-orkestratie uit `saveMutation.mutationFn` (order-form.tsx) is geëxtraheerd naar pure functie `bouwOrderCommit(input) → OrderCommitPlan` in `frontend/src/lib/orders/order-commit.ts`. Golden fixtures (7 scenario's, `__tests__/order-commit.fixtures.ts`) pinnen het bestaande gedrag: gemengde standaard/maatwerk-split, IO-tekort-split (sub-orders 'in_een_keer'), verzend-naar-duurste met tie→deel A, admin-pseudo-skip, en de spoed-regel-eigenaardigheid (telt als IO-tekort, verhuist naar IO-deel).
- **Waarom:** plan 2026-06-10 order-intake-verdieping — de Order-commit (CONTEXT.md) testbaar maken als gedrags-anker vóór de Fase 2 Order-landing-kern (SQL). Strikt gedragsbehoud; verbeteringen (form-idempotency, uniform 'aangemaakt'-event) zijn expliciete Fase 2-beslispunten.
- **Niet gewijzigd:** RPC-laag (`create_order_with_lines`), edit-flow, `split-order.ts`-helpers.
```

- [ ] **Step 4.2: Commit**:

```powershell
cd C:\Users\migue\Documents\karpi-order-commit
git add docs/changelog.md
git commit -m @'
docs(changelog): order-commit-pipeline extractie (fase 1 order-intake-verdieping)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

- [ ] **Step 4.3: Eindverificatie** (laatste keer, volledige relevante scope):

```powershell
cd C:\Users\migue\Documents\karpi-order-commit\frontend
npx vitest run src/lib/orders src/modules/reserveringen
npm run typecheck
```

Expected: alles PASS (de reserveringen-suite bewaakt dat `berekenRegelDekking`-hergebruik niets brak); typecheck schoon.

- [ ] **Step 4.4: Rapporteer aan Miguel** — meld expliciet:
  1. Branch `refactor/order-commit-pipeline` staat klaar in worktree `C:\Users\migue\Documents\karpi-order-commit`; **niet gemerged** (wacht op commando).
  2. Handmatige smoke-test vóór merge (eigenaar, in de UI): 1 gemengde order (standaard + maatwerk, deelleveringen aan) aanmaken en controleren dat er 2 orders ontstaan met verzendkosten op het duurste deel.
  3. Na merge in de hoofd-tree: één regel aan `CONTEXT.md` (untracked, alleen hoofd-tree) toevoegen onder **Order-commit**: implementatie leeft nu in `frontend/src/lib/orders/order-commit.ts`.
  4. Code-review-stap: dispatch een code-reviewer-agent over de branch (projectgeheugen: reviewer ná implementatie).

---

## Bewust buiten scope (niet doen, ook niet "even meenemen")

- Form-idempotency / submit-token; uniform `'aangemaakt'`-event (Fase 2-beslispunten).
- De drie ORD-2026-0118-bevindingen (dubbele Selections-regels, € 0,00-prijzen, ontbrekende snijplannen).
- Edit-flow-split (`updateOrderWithLines`) — eigen beslispunt.
- De spoed-regel/`is_pseudo`-eigenaardigheid fixen (gepind als gedrag; eventueel later apart melden als bevinding).
- SQL-migraties, edge functions, `order-mutations.ts`.
