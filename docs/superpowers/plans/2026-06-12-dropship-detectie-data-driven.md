# Dropship-detectie data-driven (producten.is_dropship) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TS-dropship-detectie laten lezen op `producten.is_dropship` (mig 370) i.p.v. hardcoded `DROPSHIP-KLEIN`/`DROPSHIP-GROOT`, zodat een nieuw dropship-artikel een pure data-wijziging is (ADR-0018-patroon, exact zoals `admin-pseudo.ts`).

**Architecture:** De DB is al data-driven (mig 370: `producten.is_dropship` + `is_dropship_order()` + e-mail-guard in `fn_zending_fill_email`). Alleen de TS-kant hinkt achter: `isDropshipRegel`/`detecteerDropshipKeuze` matchen op twee hardcoded artikelnr's. We splitsen **detecteren** (flag-based, dual-shape zoals `isAdminPseudo`: top-level `is_dropship` óf `producten.is_dropship` uit de join) van **toevoegen/keuze-UI** (constants blijven — de `DropshipmentSelector` kent alleen klein/groot, en `applyDropshipmentLogic` moet weten wélk artikel + prijs hij toevoegt, zoals `SHIPPING_PRODUCT_ID`). Géén DB-migratie nodig; `frontend`-only.

**Tech Stack:** React/TypeScript, Vitest, Supabase PostgREST (join `producten(...)`).

**Bevestigde probleem-analyse (2026-06-12):**
- [`dropshipment-regel.ts:16-25`](../../../frontend/src/lib/orders/dropshipment-regel.ts) — detectie hardcoded op `DROPSHIP_KLEIN_ID`/`DROPSHIP_GROOT_ID`. Een derde dropship-artikel (`UPDATE producten SET is_dropship=TRUE`) werkt server-side (e-mail-guard mig 370) maar is onzichtbaar voor de form-validatie, het order-detail-probleem-banner en de afl_email-default-logica — exact de pre-ADR-0018-bug-klasse (mig 263→269).
- `fetchOrderRegels` ([`orders.ts:453`](../../../frontend/src/lib/supabase/queries/orders.ts)) joint `producten` al voor `is_pseudo` — `is_dropship` toevoegen is één select-uitbreiding.
- **Bijvangst-gap:** de edit-flow-mapping ([`order-edit.tsx:122-153`](../../../frontend/src/pages/orders/order-edit.tsx)) draagt `is_pseudo` (en straks `is_dropship`) níét over naar form-data. Detectie werkt daar nu alleen omdat hij toevallig op `artikelnr` matcht. Beide vlaggen worden in de mapping opgenomen.
- `DROPSHIP_IDS` (dropshipment-regel.ts:11) is een ongebruikte export → verwijderen.
- Edge functions bevatten géén hardcoded dropship-ID's; server-side is niets nodig.

**Begrippen-scheiding (leidend voor het hele plan):**
| Concern | Mechanisme | Blijft / wordt |
|---|---|---|
| Detecteren: "is dit een dropship-regel/-order?" | `isDropshipRegel` / `heeftDropshipRegel` op `is_dropship`-vlag | **wordt flag-based** |
| Keuze-UI: "welke selector-stand (nee/klein/groot)?" | `detecteerDropshipKeuze` op artikelnr | blijft constants (selector kent alleen die twee) |
| Toevoegen: kostenregel construeren | `applyDropshipmentLogic` + constants (id, prijs, omschrijving) | blijft constants, regel krijgt `is_dropship: true` mee |

---

## File Structure

| Bestand | Actie | Verantwoordelijkheid |
|---|---|---|
| `frontend/src/lib/orders/dropshipment-regel.ts` | Modify | flag-based `isDropshipRegel` + nieuw `heeftDropshipRegel`; `applyDropshipmentLogic` stempelt `is_dropship: true`; dode `DROPSHIP_IDS` weg |
| `frontend/src/lib/orders/__tests__/dropshipment-regel.test.ts` | Create | unit-tests (spiegelt `admin-pseudo.test.ts`), incl. derde-artikel-case |
| `frontend/src/lib/supabase/queries/order-mutations.ts` | Modify | `OrderRegelFormData.is_dropship?: boolean` (display-only, zoals `is_pseudo`) |
| `frontend/src/lib/supabase/queries/orders.ts` | Modify | `OrderRegel.is_dropship` + select/mapping in `fetchOrderRegels` |
| `frontend/src/pages/orders/order-edit.tsx` | Modify | mapping draagt `is_pseudo` + `is_dropship` over naar form-data |
| `frontend/src/pages/orders/order-detail.tsx` | Modify | banner-conditie via `heeftDropshipRegel` |
| `frontend/src/components/orders/order-form.tsx` | Modify | `isDropshipOrder`-memo vervangt `dropshipKeuze !== 'nee'` op 3 detectie-plekken |
| `CLAUDE.md` + `docs/changelog.md` | Modify | levende docs bijwerken |

---

### Task 0: Branch aanmaken

Substantieel werk (meerdere bestanden) → eigen branch, niet op `main` (CLAUDE.md git-workflow). Bij parallelle sessies: eigen worktree (memory `feedback_worktree_vanaf_start`).

- [ ] **Step 1: Branch**

```powershell
git checkout -b refactor/dropship-detectie-data-driven
```

---

### Task 1: Form-data-veld `is_dropship` (typefundament)

`applyDropshipmentLogic` gaat `is_dropship: true` op de geconstrueerde regel zetten — dat veld moet eerst bestaan op `OrderRegelFormData`, anders compileert Task 2 niet.

**Files:**
- Modify: `frontend/src/lib/supabase/queries/order-mutations.ts:109` (direct na `is_pseudo?: boolean`)

- [ ] **Step 1: Veld toevoegen**

In `order-mutations.ts`, direct ná regel 109 (`is_pseudo?: boolean`), binnen dezelfde interface:

```typescript
  /**
   * Display-only: dropshipment-vlag van het gekoppelde product (mig 370,
   * ADR-0018-patroon). Gevuld door `applyDropshipmentLogic` (create) of de
   * order-edit-mapping (edit) uit `producten.is_dropship`. Gebruikt door
   * `isDropshipRegel`/`heeftDropshipRegel` voor de e-mail-validatie en
   * afl_email-defaults. Wordt niet gepersisteerd; de DB leest het via JOIN
   * (`is_dropship_order()`).
   */
  is_dropship?: boolean
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend; npm run typecheck`
Expected: PASS (alleen een optioneel veld toegevoegd)

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/lib/supabase/queries/order-mutations.ts
git commit -m "refactor(orders): is_dropship display-only veld op OrderRegelFormData (mig 370 / ADR-0018)"
```

---

### Task 2: Flag-based detectie in `dropshipment-regel.ts` (TDD)

**Files:**
- Test: `frontend/src/lib/orders/__tests__/dropshipment-regel.test.ts` (nieuw)
- Modify: `frontend/src/lib/orders/dropshipment-regel.ts` (volledige herschrijving, zie Step 3)

- [ ] **Step 1: Schrijf de failende tests**

Maak `frontend/src/lib/orders/__tests__/dropshipment-regel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  isDropshipRegel,
  heeftDropshipRegel,
  detecteerDropshipKeuze,
  applyDropshipmentLogic,
} from '../dropshipment-regel'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

describe('isDropshipRegel (flag-based, mig 370 / ADR-0018)', () => {
  it('true voor form-data shape met is_dropship=true top-level', () => {
    expect(isDropshipRegel({ is_dropship: true })).toBe(true)
  })

  it('true voor query-shape met producten.is_dropship=true (join)', () => {
    expect(isDropshipRegel({ producten: { is_dropship: true } })).toBe(true)
  })

  it('herkent een derde dropship-artikel — artikelnr is irrelevant', () => {
    // Pre-fix matchte detectie op DROPSHIP-KLEIN/-GROOT; een nieuw artikel
    // met alleen de DB-vlag moet nu ook gezien worden (kern van dit plan).
    expect(
      isDropshipRegel({ artikelnr: 'DROPSHIP-SPOED', is_dropship: true } as OrderRegelFormData),
    ).toBe(true)
  })

  it('false voor regel zonder vlag (gewoon artikel)', () => {
    expect(isDropshipRegel({ artikelnr: 'ABC123' } as OrderRegelFormData)).toBe(false)
    expect(isDropshipRegel({ producten: { is_dropship: false } })).toBe(false)
    expect(isDropshipRegel({ producten: null })).toBe(false)
  })

  it('false voor null/undefined regel', () => {
    expect(isDropshipRegel(null)).toBe(false)
    expect(isDropshipRegel(undefined)).toBe(false)
  })

  it('false als is_dropship null is (pre-mig-370 rijen)', () => {
    expect(isDropshipRegel({ producten: { is_dropship: null } })).toBe(false)
  })
})

describe('heeftDropshipRegel (TS-spiegel van SQL is_dropship_order)', () => {
  it('true zodra één regel de vlag draagt', () => {
    expect(
      heeftDropshipRegel([{ artikelnr: 'ABC123' } as OrderRegelFormData, { is_dropship: true }]),
    ).toBe(true)
  })

  it('false voor lege lijst en lijst zonder vlag', () => {
    expect(heeftDropshipRegel([])).toBe(false)
    expect(heeftDropshipRegel([{ artikelnr: 'ABC123' } as OrderRegelFormData])).toBe(false)
  })
})

describe('detecteerDropshipKeuze (selector-state, bewust artikelnr-based)', () => {
  it("herkent 'klein' en 'groot' op artikelnr", () => {
    expect(detecteerDropshipKeuze([{ artikelnr: 'DROPSHIP-KLEIN' }])).toBe('klein')
    expect(detecteerDropshipKeuze([{ artikelnr: 'DROPSHIP-GROOT' }])).toBe('groot')
  })

  it("geeft 'nee' zonder dropship-regels", () => {
    expect(detecteerDropshipKeuze([{ artikelnr: 'ABC123' }])).toBe('nee')
    expect(detecteerDropshipKeuze([])).toBe('nee')
  })

  it("derde dropship-artikel → 'nee' (selector kent alleen klein/groot; detectie loopt via heeftDropshipRegel)", () => {
    expect(detecteerDropshipKeuze([{ artikelnr: 'DROPSHIP-SPOED' }])).toBe('nee')
  })
})

describe('applyDropshipmentLogic', () => {
  const tapijt: OrderRegelFormData = {
    artikelnr: 'ABC123',
    omschrijving: 'Tapijt 200x300',
    orderaantal: 1,
    te_leveren: 1,
    prijs: 100,
    korting_pct: 0,
    bedrag: 100,
  }

  it("voegt bij 'klein' een regel toe met is_dropship=true én is_pseudo=true", () => {
    const result = applyDropshipmentLogic([tapijt], 'klein')
    const dropship = result.find((r) => r.artikelnr === 'DROPSHIP-KLEIN')
    expect(dropship).toBeDefined()
    expect(dropship!.is_dropship).toBe(true)
    expect(dropship!.is_pseudo).toBe(true)
    expect(dropship!.prijs).toBe(35.0)
  })

  it("'groot' vervangt een bestaande klein-regel (flag-based verwijdering)", () => {
    const metKlein = applyDropshipmentLogic([tapijt], 'klein')
    const result = applyDropshipmentLogic(metKlein, 'groot')
    expect(result.some((r) => r.artikelnr === 'DROPSHIP-KLEIN')).toBe(false)
    const groot = result.find((r) => r.artikelnr === 'DROPSHIP-GROOT')
    expect(groot).toBeDefined()
    expect(groot!.prijs).toBe(47.5)
  })

  it("'nee' verwijdert flag-based — ook een derde dropship-artikel zonder hardcoded id", () => {
    const derde: OrderRegelFormData = {
      artikelnr: 'DROPSHIP-SPOED',
      omschrijving: 'Dropshipment spoed',
      orderaantal: 1,
      te_leveren: 1,
      prijs: 60,
      korting_pct: 0,
      bedrag: 60,
      is_pseudo: true,
      is_dropship: true,
    }
    const result = applyDropshipmentLogic([tapijt, derde], 'nee')
    expect(result).toEqual([tapijt])
  })

  it("'nee' laat gewone regels ongemoeid", () => {
    expect(applyDropshipmentLogic([tapijt], 'nee')).toEqual([tapijt])
  })
})
```

- [ ] **Step 2: Run tests — verwacht FAIL**

Run: `cd frontend; npm run test:run -- dropshipment-regel`
Expected: FAIL — `heeftDropshipRegel` bestaat niet; `isDropshipRegel({ is_dropship: true })` is false (matcht nog op artikelnr); geconstrueerde regel mist `is_dropship`.

- [ ] **Step 3: Herschrijf `dropshipment-regel.ts`**

Vervang de volledige inhoud van `frontend/src/lib/orders/dropshipment-regel.ts` door:

```typescript
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'
import {
  DROPSHIP_KLEIN_ID,
  DROPSHIP_GROOT_ID,
  DROPSHIP_KLEIN_PRIJS,
  DROPSHIP_GROOT_PRIJS,
  type DropshipmentKeuze,
} from '@/lib/constants/dropshipment'

/**
 * Detectie: is deze regel een dropshipment-kostenregel?
 *
 * Bron-van-waarheid: `producten.is_dropship BOOLEAN` (mig 370) — zelfde
 * ADR-0018-patroon als `isAdminPseudo` (admin-pseudo.ts). Nieuw dropship-
 * artikel = `UPDATE producten SET is_dropship=TRUE`, geen code-edit.
 *
 * Twee shapes worden geaccepteerd:
 * 1. Query-resultaten met `producten ( is_dropship )`-join (OrderRegel-mapping).
 * 2. Form-data met `is_dropship` top-level — gestempeld door
 *    `applyDropshipmentLogic` (create) of de order-edit-mapping (edit).
 *
 * LET OP: voor het *toevoegen* van de kostenregel blijven de constants in
 * `constants/dropshipment.ts` de bron (welk artikel, welke prijs) — net als
 * `SHIPPING_PRODUCT_ID` bij verzendregels. Toevoegen ≠ detecteren.
 */
export interface RegelMetDropshipFlag {
  is_dropship?: boolean | null
  producten?: { is_dropship?: boolean | null } | null
}

export function isDropshipRegel(
  regel: RegelMetDropshipFlag | null | undefined,
): boolean {
  if (!regel) return false
  return regel.is_dropship === true || regel.producten?.is_dropship === true
}

/** TS-spiegel van SQL `is_dropship_order(order_id)` (mig 370). */
export function heeftDropshipRegel(regels: RegelMetDropshipFlag[]): boolean {
  return regels.some(isDropshipRegel)
}

/**
 * Detecteert welke selector-stand actief is in de regellijst — bewust
 * artikelnr-gebaseerd: dit voedt uitsluitend de `DropshipmentSelector`-toggle,
 * die alleen de twee bekende keuzes kent. Voor "is dit een dropship-order?"
 * (validatie, banners, e-mail-guard) → `heeftDropshipRegel` (flag-based,
 * ziet óók toekomstige dropship-artikelen).
 */
export function detecteerDropshipKeuze(
  regels: { artikelnr?: string | null }[],
): DropshipmentKeuze {
  if (regels.some((r) => r.artikelnr === DROPSHIP_KLEIN_ID)) return 'klein'
  if (regels.some((r) => r.artikelnr === DROPSHIP_GROOT_ID)) return 'groot'
  return 'nee'
}

/**
 * Past de dropshipment-regel aan op basis van de keuze:
 * - 'nee'   → verwijder alle dropship-regels (flag-based)
 * - 'klein' → verwijder VERZEND + andere dropship-regels, voeg dropship-klein toe
 * - 'groot' → verwijder VERZEND + andere dropship-regels, voeg dropship-groot toe
 *
 * Pure functie — geen side effects.
 */
export function applyDropshipmentLogic(
  regels: OrderRegelFormData[],
  keuze: DropshipmentKeuze,
): OrderRegelFormData[] {
  const zonder = regels.filter((r) => !isDropshipRegel(r) && r.artikelnr !== SHIPPING_PRODUCT_ID)

  if (keuze === 'nee') {
    return regels.filter((r) => !isDropshipRegel(r))
  }

  const artikelnr = keuze === 'klein' ? DROPSHIP_KLEIN_ID : DROPSHIP_GROOT_ID
  const prijs = keuze === 'klein' ? DROPSHIP_KLEIN_PRIJS : DROPSHIP_GROOT_PRIJS
  const omschrijving =
    keuze === 'klein' ? 'Dropshipment (tapijt t/m 200 cm)' : 'Dropshipment (tapijt vanaf 200 cm)'

  const dropshipRegel: OrderRegelFormData = {
    artikelnr,
    omschrijving,
    orderaantal: 1,
    te_leveren: 1,
    prijs,
    korting_pct: 0,
    bedrag: prijs,
    is_pseudo: true,
    is_dropship: true,
  }

  return [...zonder, dropshipRegel]
}
```

Let op: de ongebruikte export `DROPSHIP_IDS` en het type `MetArtikelnr` zijn hiermee verwijderd (geen enkele consumer — geverifieerd via grep 2026-06-12).

- [ ] **Step 4: Run tests — verwacht PASS**

Run: `cd frontend; npm run test:run -- dropshipment-regel`
Expected: PASS (alle ~14 tests groen)

- [ ] **Step 5: Typecheck (consumers compileren nog?)**

Run: `cd frontend; npm run typecheck`
Expected: PASS — `order-form.tsx` en `order-detail.tsx` importeren alleen `applyDropshipmentLogic`/`detecteerDropshipKeuze`, beide signatures ongewijzigd op naam-niveau.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/lib/orders/dropshipment-regel.ts frontend/src/lib/orders/__tests__/dropshipment-regel.test.ts
git commit -m "refactor(orders): dropship-detectie flag-based via producten.is_dropship (ADR-0018-patroon)"
```

---

### Task 3: Query-laag — vlag mee-joinen en mappen

**Files:**
- Modify: `frontend/src/lib/supabase/queries/orders.ts:128` (interface), `:453` (select), `:471-501` (mapping)
- Modify: `frontend/src/pages/orders/order-edit.tsx:122-153` (form-data-mapping)

- [ ] **Step 1: `OrderRegel.is_dropship` toevoegen**

In `orders.ts`, direct ná regel 128 (`is_pseudo?: boolean`):

```typescript
  /** Dropshipment-vlag (mig 370 / ADR-0018) — gemapt uit producten.is_dropship via join. */
  is_dropship?: boolean
```

- [ ] **Step 2: Select uitbreiden in `fetchOrderRegels`**

In `orders.ts:453`: vervang in de select-string het join-fragment

```
producten!order_regels_artikelnr_fkey(kwaliteit_code, kleur_code, is_pseudo, karpi_code)
```

door

```
producten!order_regels_artikelnr_fkey(kwaliteit_code, kleur_code, is_pseudo, is_dropship, karpi_code)
```

- [ ] **Step 3: Mapping uitbreiden in `toRegel`**

In `orders.ts:471`, vervang de product-cast:

```typescript
    const product = row.producten as { kwaliteit_code: string; kleur_code: string | null; is_pseudo: boolean | null; is_dropship: boolean | null; karpi_code: string | null } | null
```

En direct onder regel 474 (`const isPseudo = product?.is_pseudo === true`):

```typescript
    const isDropship = product?.is_dropship === true
```

En in het return-object, direct ná regel 501 (`is_pseudo: isPseudo, ...`):

```typescript
      is_dropship: isDropship,  // mig 370 / ADR-0018: dropship-vlag uit producten.is_dropship
```

- [ ] **Step 4: Edit-flow-mapping — vlaggen overdragen naar form-data**

In `order-edit.tsx`, binnen de `regelData`-mapping (regel 122-153), direct ná `gewicht_kg: r.gewicht_kg ?? undefined,`:

```typescript
    // Display-only product-vlaggen (ADR-0018-patroon) — zonder deze ziet
    // flag-based detectie (isDropshipRegel/isAdminPseudo) geladen regels
    // niet in de bewerk-flow. is_pseudo was een pre-existing gap (form-form
    // regel 636 leest r.is_pseudo dat hier nooit gevuld werd).
    is_pseudo: r.is_pseudo,
    is_dropship: r.is_dropship,
```

- [ ] **Step 5: Typecheck + bestaande tests**

Run: `cd frontend; npm run typecheck; npm run test:run -- dropshipment-regel`
Expected: beide PASS

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/lib/supabase/queries/orders.ts frontend/src/pages/orders/order-edit.tsx
git commit -m "refactor(orders): is_dropship mee-joinen in fetchOrderRegels + vlaggen overdragen in edit-mapping"
```

---

### Task 4: Consumers omzetten naar flag-based detectie

**Files:**
- Modify: `frontend/src/pages/orders/order-detail.tsx:25`, `:153`
- Modify: `frontend/src/components/orders/order-form.tsx:37`, `:89` (nieuw memo), `:254`, `:318`, `:497-507`

- [ ] **Step 1: order-detail.tsx**

Regel 25, vervang:

```typescript
import { detecteerDropshipKeuze } from '@/lib/orders/dropshipment-regel'
```

door:

```typescript
import { heeftDropshipRegel } from '@/lib/orders/dropshipment-regel'
```

Regel 153, vervang:

```typescript
          detecteerDropshipKeuze(regels ?? []) !== 'nee'
```

door:

```typescript
          heeftDropshipRegel(regels ?? [])
```

(`regels` is hier `OrderRegel[]` uit `fetchOrderRegels` — draagt sinds Task 3 `is_dropship` top-level.)

- [ ] **Step 2: order-form.tsx — import + `isDropshipOrder`-memo**

Regel 37, vervang:

```typescript
import { applyDropshipmentLogic, detecteerDropshipKeuze } from '@/lib/orders/dropshipment-regel'
```

door:

```typescript
import { applyDropshipmentLogic, detecteerDropshipKeuze, heeftDropshipRegel } from '@/lib/orders/dropshipment-regel'
```

Direct ná de `dropshipKeuze`-state (regel 87-89) toevoegen:

```typescript
  // Dropship-detectie is flag-based (producten.is_dropship, mig 370) zodat
  // ook een dropship-artikel buiten de selector-keuzes (klein/groot) de
  // e-mail-validatie en afl_email-defaults activeert. dropshipKeuze blijft
  // puur selector-state. Beide bronnen samen: de selector-toggle muteert
  // keuze + regels in dezelfde handler, dus ze lopen nooit uiteen.
  const isDropshipOrder = useMemo(
    () => dropshipKeuze !== 'nee' || heeftDropshipRegel(regels),
    [dropshipKeuze, regels],
  )
```

(`regels`-state staat op regel 74, dus in scope; `useMemo` is al geïmporteerd in dit bestand — verifieer de React-import bovenaan, voeg `useMemo` toe als die ontbreekt.)

- [ ] **Step 3: order-form.tsx — drie detectie-plekken vervangen**

Plek 1 — `handleClientChange` (regel 254), vervang:

```typescript
        afl_email: dropshipKeuze !== 'nee'
          ? h.afl_email
          : (c.email_verzend || c.email_overig || undefined),
```

door:

```typescript
        afl_email: isDropshipOrder
          ? h.afl_email
          : (c.email_verzend || c.email_overig || undefined),
```

Plek 2 — `handleAddressSelect` (regel 317-320), vervang:

```typescript
      afl_email: addr.email ??
        (dropshipKeuze !== 'nee'
          ? h.afl_email
          : (client?.email_verzend ?? client?.email_overig ?? h.afl_email)),
```

door:

```typescript
      afl_email: addr.email ??
        (isDropshipOrder
          ? h.afl_email
          : (client?.email_verzend ?? client?.email_overig ?? h.afl_email)),
```

Plek 3 — e-mail-toets-memo (regel 497-507), vervang:

```typescript
  const dropshipEmailProbleem = useMemo(
    () =>
      dropshipKeuze === 'nee'
        ? null
        : dropshipAflEmailProbleem({
            aflEmail: header.afl_email,
            factEmail: header.fact_email,
            debiteurEmails: [client?.email_factuur, client?.email_overig, client?.email_verzend],
          }),
    [dropshipKeuze, header.afl_email, header.fact_email, client],
  )
```

door:

```typescript
  const dropshipEmailProbleem = useMemo(
    () =>
      !isDropshipOrder
        ? null
        : dropshipAflEmailProbleem({
            aflEmail: header.afl_email,
            factEmail: header.fact_email,
            debiteurEmails: [client?.email_factuur, client?.email_overig, client?.email_verzend],
          }),
    [isDropshipOrder, header.afl_email, header.fact_email, client],
  )
```

NIET vervangen (bewust keuze-gedreven, geen detectie):
- regel 88: `detecteerDropshipKeuze(initialData?.regels ?? [])` — initiële selector-stand
- regel 198/201/206: `keuze !== 'nee'` binnen `handleDropshipChange` — reageert op de zojuist gekozen waarde, niet op order-staat

- [ ] **Step 4: Typecheck + volledige testsuite**

Run: `cd frontend; npm run typecheck; npm run test:run`
Expected: typecheck PASS; testsuite groen op de pre-existing kender na (`magazijn-pickbaarheid.contract.test.ts` faalt 7/7 al op `main` — memory `reference_stale_pickbaarheid_contracttest`; géén nieuwe failures introduceren).

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/pages/orders/order-detail.tsx frontend/src/components/orders/order-form.tsx
git commit -m "refactor(orders): dropship-consumers op heeftDropshipRegel (flag) i.p.v. keuze-state"
```

---

### Task 5: Handmatige verificatie (smoke)

Geen geautomatiseerde E2E in deze repo — kort handmatig naloopje in de dev-server.

- [ ] **Step 1: Dev-server starten**

Run: `cd frontend; npm run dev`

- [ ] **Step 2: Scenario's**

1. **Create:** nieuwe order → DropshipmentSelector op 'klein' → dropship-regel verschijnt (€ 35,00), VERZEND verdwijnt; afl_email gelijk aan klant-e-mail → opslaan geblokkeerd met dropship-melding.
2. **Edit:** bestaande dropship-order openen → selector toont 'klein'/'groot' correct; selector naar 'nee' → dropship-regel weg, VERZEND-logica terug.
3. **Order-detail:** dropship-order met afl_email = factuur-e-mail → rose e-mail-probleem-hint zichtbaar op het adresblok.

- [ ] **Step 3: Derde-artikel-bewijs (optioneel maar overtuigend, alleen lezen + terugdraaien)**

In de Supabase SQL-editor (of lokaal):

```sql
-- tijdelijk testartikel
INSERT INTO producten (artikelnr, omschrijving, is_pseudo, is_dropship)
VALUES ('DROPSHIP-TEST', 'Dropshipment testartikel', TRUE, TRUE);
```

Voeg via SQL een orderregel met `DROPSHIP-TEST` aan een test-order toe → order-detail toont de e-mail-hint en de bewerk-flow activeert de e-mail-validatie zonder dat `DROPSHIP-TEST` ergens in TS-code voorkomt. Daarna opruimen:

```sql
DELETE FROM order_regels WHERE artikelnr = 'DROPSHIP-TEST';
DELETE FROM producten WHERE artikelnr = 'DROPSHIP-TEST';
```

---

### Task 6: Levende documentatie bijwerken

**Files:**
- Modify: `CLAUDE.md` (dropshipment-bullet)
- Modify: `docs/changelog.md`

- [ ] **Step 1: CLAUDE.md**

In de bullet **Dropshipment (mig 353/363/370)**: vervang het fragment

```
TS-spiegel `detecteerDropshipKeuze` ([`dropshipment-regel.ts`](frontend/src/lib/orders/dropshipment-regel.ts))
```

door:

```
TS-spiegel `heeftDropshipRegel`/`isDropshipRegel` (flag-based op `is_dropship` via query-join + form-data, dual-shape zoals `isAdminPseudo` — [`dropshipment-regel.ts`](frontend/src/lib/orders/dropshipment-regel.ts)); `detecteerDropshipKeuze` blijft artikelnr-based maar voedt uitsluitend de selector-toggle (keuze-UI ≠ detectie)
```

- [ ] **Step 2: changelog.md**

Nieuwe entry bovenaan (datum 2026-06-12, of de werkelijke uitvoerdatum):

```markdown
## 2026-06-12 — Dropship-detectie in TS data-driven (ADR-0018-patroon)

**Wat:** `isDropshipRegel`/`heeftDropshipRegel` lezen nu `producten.is_dropship`
(mig 370) via de query-join (`fetchOrderRegels`) en form-data, i.p.v. hardcoded
`DROPSHIP-KLEIN`/`DROPSHIP-GROOT` te matchen. `detecteerDropshipKeuze` blijft
artikelnr-based maar voedt uitsluitend de selector-toggle. De order-edit-mapping
draagt voortaan `is_pseudo` + `is_dropship` over naar form-data (pre-existing gap).
Ongebruikte export `DROPSHIP_IDS` verwijderd.

**Waarom:** een derde dropship-artikel werkte server-side wél (e-mail-guard
mig 370) maar was onzichtbaar voor form-validatie en order-detail-hint — exact
de pre-ADR-0018-bug-klasse (mig 263→269). Nu: nieuw dropship-artikel =
`UPDATE producten SET is_dropship=TRUE`, nul code-edits.
```

- [ ] **Step 3: Commit**

```powershell
git add CLAUDE.md docs/changelog.md
git commit -m "docs: dropship-detectie data-driven — CLAUDE.md + changelog"
```

---

## Afronding

Branch `refactor/dropship-detectie-data-driven` blijft staan tot Miguel "merge naar main" zegt (CLAUDE.md git-workflow). Vóór merge: `npm run typecheck` herhalen en migratienummer-collisies zijn hier niet aan de orde (geen migraties).

## Expliciet buiten scope (YAGNI)

- `omschrijving`/`prijs` van de kostenregel uit `producten` laten komen i.p.v. constants — toevoegen blijft bewust constants-gedreven; een derde artikel toevoegen aan de *selector* is een apart UI-besluit.
- De `DropshipmentSelector` uitbreiden naar dynamische keuzes uit `producten WHERE is_dropship` — pas relevant als er daadwerkelijk een derde dropship-tarief komt.
- Server-side wijzigingen — mig 370 dekt de DB-kant al volledig.
