# Order-intake consolidatie (gefaseerd) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De divergentie en testbaarheids-schuld in de order-intake wegnemen via vijf laag-risico verticale slices — zónder de insert-RPC's of de module-structuur om te gooien.

**Architecture:** Gerichte seam-extractie in plaats van een grote refactor. We fixen eerst de enige levende bug (Lightspeed gewicht-conversie), maken de documentatie eerlijk over ADR-0001, centraliseren de drie intake-aandachts-predicaten, halen de geld-rekenende split-logica uit `order-form.tsx` naar pure geteste functies, en introduceren één gedeeld `IntakeRegel`-type dat de drie Deno-webhook-kanalen dedupliceert. De drie insert-RPC's, het EDI-SQL-pad en de `modules/orders/`-mapverhuizing blijven bewust ongemoeid (zie "Bewust buiten scope").

**Tech Stack:** TypeScript, React 19 + TanStack Query + Vitest (frontend); Deno + `std@0.168.0/testing/asserts.ts` (edge functions); Supabase/PostgREST. Frontend-tests via `npx vitest run`; edge-tests via `deno test`.

---

## Context & verifieerde bevindingen

Dit plan volgt op een onderzoek (5 agents) + afweging (3 agents) naar de stelling "order-intake is de ontbrekende deep module". Geverifieerde feiten met `file:line`:

- **Lightspeed gewicht-bug (LEVEND):** [`sync-webshop-order/index.ts:70`](../../../supabase/functions/sync-webshop-order/index.ts#L70) deelt `row.weight` door `1_000_000` ("micro-kg", voorbeeld `4210000 → 4.21 kg`); [`import-lightspeed-orders/index.ts:46`](../../../supabase/functions/import-lightspeed-orders/index.ts#L46) deelt hetzelfde veld door `1_000` ("grams"). Beide consumeren dezelfde Lightspeed-bron → één is fout met factor 1000.
- **ADR-0001 niet uitgevoerd:** [`docs/adr/0001-...md`](../../adr/0001-order-voorstel-en-planning-als-twee-modules.md) (status `accepted`) belooft `modules/orders/`; de map bestaat niet. [`docs/architectuur.md:29`](../../architectuur.md#L29) beweert onterecht *"daarop volgden `modules/orders/` (bezit het Order-voorstel)"*.
- **Drie intake-predicaten gedupliceerd:** `'Te koppelen'`, `'Te bevestigen'` (EDI-leverweek), `'Debiteur te bevestigen'` staan als losse inline filterstrings verspreid; `'Debiteur te bevestigen'` heeft 0 helpers en 3 kopieën; `'Te bevestigen'` heeft een helper (`isLeverweekTeBevestigen`) die `fetchOrders`/`fetchStatusCounts` negeren.
- **order-form.tsx (1068 r.):** `saveMutation.mutationFn` ([regels 407-547](../../../frontend/src/components/orders/order-form.tsx#L407-L547)) bevat ~70-80% pure geld-rekenende business-logica (split-flows + verzend-toewijzing, 2× gedupliceerd) verweven met React-state; geen test importeert `OrderForm`.
- **Geen gedeeld intake-type:** drie `buildRegels` emitteren `regels: unknown[]`; `sync-webshop-order` mist het `maatwerk_vorm`-veld dat `import-lightspeed-orders` wél zet.

### Scope-beslissingen (door de eigenaar bevestigd, 2026-06-09)

1. **Scope = gefaseerd t/m gedeeld type** (slices 0-4). De gedeelde SQL-insert-kern is een apart vervolgbeslispunt, niet nu.
2. **ADR-0001 = documenteren als niet-uitgevoerd** (geen mapverhuizing).
3. **EDI-SQL-pad blijft bewust apart** (alleen de 3 Deno-webhooks consolideren).

### Bewust buiten scope (niet doen in dit plan)

- De drie insert-RPC's (`create_webshop_order` / `create_edi_order` / `create_order_with_lines`) samenvoegen of een gedeelde `_insert_order_regel`-SQL-kern bouwen — **vervolgbeslispunt**, zie slot van dit document.
- `frontend/src/modules/orders/` fysiek aanmaken en order-code verhuizen.
- EDI-regelbouw uit SQL naar een Deno-adapter tillen.
- `order-form.tsx` migreren naar `react-hook-form`.
- De EDI `debiteur_zeker`-gap dichten (los te fixen; staat als V2 in CLAUDE.md).
- De `gramsToMicroKg`-shim in Shopify herschrijven (zelf gemarkeerd als non-kritisch; raken we alleen aan in slice 4 voor het gedeelde type, niet de conversie-semantiek).

### Branch-strategie

Per CLAUDE.md krijgen substantiële wijzigingen een eigen branch en mergen pas op commando. Gezien parallelle sessies in dezelfde working tree (collisie-incident 8 juni): **werk dit plan in een eigen worktree/branch** `refactor/order-intake-consolidatie`. Slices 0-3 zijn onafhankelijk en mogen los naar `main` gemerged worden zodra getest; slice 4 leunt op slice 0. Commit na elke stap. Draai `npm run typecheck` (vanuit `frontend/`) vóór elke merge (PD-branches-incident 9 juni).

### Globale verificatie-commando's

- Frontend typecheck: vanuit `frontend/` → `npm run typecheck` → verwacht: geen output, exit 0.
- Frontend tests (één bestand): vanuit `frontend/` → `npx vitest run <relatief-pad>`.
- Edge tests (één bestand): vanuit repo-root → `deno test <pad>` (voeg `--allow-net` toe als de `std`-import nog niet gecached is).
- **Bekende pre-existing failure:** `frontend/src/.../magazijn-pickbaarheid.contract.test.ts` faalt 7/7 op `main` (mockt `zendingen` i.p.v. `zending_orders`) — níet door dit plan veroorzaakt, niet als blocker tellen.

---

## File Structure

**Nieuw:**
- `supabase/functions/_shared/order-intake/gewicht.ts` — pure gewicht-normalisatie voor Lightspeed (slice 0).
- `supabase/functions/_shared/order-intake/gewicht.test.ts` — Deno-test (slice 0).
- `supabase/functions/_shared/order-intake/types.ts` — gedeeld `IntakeRegel`-type (slice 4).
- `supabase/functions/_shared/order-intake/lightspeed-regels.ts` — gededupliceerde `buildLightspeedRegels` + pure `toIntakeRegel` (slice 4).
- `supabase/functions/_shared/order-intake/lightspeed-regels.test.ts` — Deno-test (slice 4).
- `frontend/src/lib/orders/intake-predicaten.ts` — `isDebiteurTeBevestigen` + `filterDebiteurTeBevestigen` (slice 2).
- `frontend/src/lib/orders/__tests__/intake-predicaten.test.ts` — vitest (slice 2).
- `frontend/src/lib/orders/split-order.ts` — pure `wijsVerzendNaarDuurste` + `splitRegelOpDekking` (slice 3).
- `frontend/src/lib/orders/__tests__/split-order.test.ts` — vitest (slice 3).

**Gewijzigd:**
- `supabase/functions/sync-webshop-order/index.ts` — gebruikt gedeelde gewicht-helper (slice 0) + `buildLightspeedRegels` (slice 4).
- `supabase/functions/import-lightspeed-orders/index.ts` — idem (slice 0 + 4).
- `supabase/functions/sync-shopify-order/index.ts` — `buildRegels` emit `IntakeRegel[]` (slice 4).
- `docs/architectuur.md` — corrigeer regel 29 (slice 1).
- `docs/adr/0001-order-voorstel-en-planning-als-twee-modules.md` — status-note (slice 1).
- `docs/changelog.md` — per slice.
- `frontend/src/lib/orders/edi-leverweek.ts` — `filterLeverweekTeBevestigen` toevoegen (slice 2).
- `frontend/src/lib/supabase/queries/orders.ts` — drie predicaat-branches gebruiken helpers (slice 2).
- `frontend/src/pages/orders/order-detail.tsx` — `isDebiteurTeBevestigen` gebruiken (slice 2).
- `frontend/src/modules/edi/queries/edi.ts` + `frontend/src/modules/edi/pages/berichten-overzicht.tsx` — gedeelde `isTeKoppelen`/`filterTeKoppelen` (slice 2).
- `frontend/src/components/orders/order-form.tsx` — `mutationFn` gebruikt de geëxtraheerde pure helpers (slice 3).

---

## Slice 0 — Lightspeed gewicht-bug fix

**Doel:** Eén gedeelde, geteste gewicht-normalisatie voor beide Lightspeed-paden; de factor-1000-tegenstrijdigheid verdwijnt.

**Beslissing over de juiste schaal:** de `sync-webshop-order`-conversie (`/1_000_000`, micro-kg) is vrijwel zeker correct: het commentaar geeft een concreet, plausibel voorbeeld (`4210000 → 4.21 kg` — een tapijtrol van 4,21 kg). Onder de "grams"-aanname (`/1_000`) zou `4210000` neerkomen op 4210 kg, fysiek absurd. We standaardiseren daarom op **micro-kg (`/1_000_000`)** en passen `import-lightspeed-orders` aan. **Verificatieplicht (stap hieronder):** bevestig dit tegen één echte Lightspeed order-row (`weight` vs. het werkelijke productgewicht) voordat je commit; valt het tegen verwachting uit, dan is alleen de deler in `gewicht.ts` één regel.

### Task 0.1: Pure gedeelde gewicht-helper (TDD)

**Files:**
- Create: `supabase/functions/_shared/order-intake/gewicht.ts`
- Test: `supabase/functions/_shared/order-intake/gewicht.test.ts`

- [ ] **Step 1: Schrijf de falende test**

`supabase/functions/_shared/order-intake/gewicht.test.ts`:
```ts
// Deno unit tests voor de gedeelde Lightspeed-gewicht-normalisatie.
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { kgVanLightspeedGewicht } from './gewicht.ts'

Deno.test('kgVanLightspeedGewicht: micro-kg → kg met 2 decimalen', () => {
  // 4210000 micro-kg = 4.21 kg (zie sync-webshop-order:66-72 voorbeeld)
  assertEquals(kgVanLightspeedGewicht(4210000), 4.21)
  assertEquals(kgVanLightspeedGewicht(1000000), 1)
  assertEquals(kgVanLightspeedGewicht(1500000), 1.5)
})

Deno.test('kgVanLightspeedGewicht: null/NaN/negatief → null', () => {
  assertEquals(kgVanLightspeedGewicht(undefined), null)
  assertEquals(kgVanLightspeedGewicht(Number.NaN), null)
  assertEquals(kgVanLightspeedGewicht(-5), null)
})

Deno.test('kgVanLightspeedGewicht: absurd hoog → null (begrenzing NUMERIC(8,2))', () => {
  assertEquals(kgVanLightspeedGewicht(1_000_000 * 1_000_000), null)
})
```

- [ ] **Step 2: Run de test, verifieer dat hij faalt**

Run: `deno test supabase/functions/_shared/order-intake/gewicht.test.ts`
Expected: FAIL — module `./gewicht.ts` bestaat niet (module not found).

- [ ] **Step 3: Schrijf de minimale implementatie**

`supabase/functions/_shared/order-intake/gewicht.ts`:
```ts
// Gedeelde gewicht-normalisatie voor de Lightspeed-intake-paden
// (sync-webshop-order webhook + import-lightspeed-orders cron-poll).
//
// Lightspeed eCom levert het regelgewicht als integer in MICRO-kg
// (schaalfactor 1e6): 4210000 → 4.21 kg. Vóór deze helper deelde de
// webhook door 1e6 en de cron-poll door 1e3 — een factor-1000-bug op
// identieke brondata. Eén bron van waarheid lost dat op.
//
// Begrensd op NUMERIC(8,2) (order_regels.gewicht_kg): absurd hoge of
// negatieve waarden → null (medewerker vult dan handmatig aan).
export function kgVanLightspeedGewicht(raw: number | undefined | null): number | null {
  if (raw == null || Number.isNaN(raw)) return null
  const kg = raw / 1_000_000
  if (kg >= 1_000_000 || kg < 0) return null
  return Math.round(kg * 100) / 100
}
```

- [ ] **Step 4: Run de test, verifieer dat hij slaagt**

Run: `deno test supabase/functions/_shared/order-intake/gewicht.test.ts`
Expected: PASS — 3 tests ok.

- [ ] **Step 5: Verifieer de schaal tegen echte data (geen code-stap)**

Bekijk één echte Lightspeed order-row: open de Lightspeed eCom API-docs voor het `weight`-veld op order products, óf inspecteer een recente payload. Bevestig dat `weight / 1_000_000` het werkelijke productgewicht in kg benadert. Documenteer de uitkomst in de commit-message. Klopt het niet, pas alleen de deler in `gewicht.ts` aan en herhaal stap 4.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/order-intake/gewicht.ts supabase/functions/_shared/order-intake/gewicht.test.ts
git commit -m "feat(intake): gedeelde Lightspeed-gewicht-normalisatie (micro-kg)"
```

### Task 0.2: Beide Lightspeed-edge-functions gebruiken de helper

**Files:**
- Modify: `supabase/functions/sync-webshop-order/index.ts:66-73` (verwijder lokale `normalizeGewicht`), `:127` (call-site)
- Modify: `supabase/functions/import-lightspeed-orders/index.ts:44-49` (verwijder lokale `normalizeGewicht`), `:109` (call-site)

- [ ] **Step 1: Importeer de helper in `sync-webshop-order`**

In `supabase/functions/sync-webshop-order/index.ts`, voeg toe bij de imports (na regel 32, `haalKlantPrijs`-import):
```ts
import { kgVanLightspeedGewicht } from '../_shared/order-intake/gewicht.ts'
```

- [ ] **Step 2: Verwijder de lokale functie en herbedraad de call**

Verwijder in `sync-webshop-order/index.ts` de lokale functie (regels 66-73):
```ts
// Lightspeed levert gewicht in micro-kg (int, schaalfactor 1e6).
// 4210000 → 4.21 kg. Conversie naar kg + begrenzing op NUMERIC(8,2).
function normalizeGewicht(raw: number | undefined): number | null {
  if (raw == null || Number.isNaN(raw)) return null
  const kg = raw / 1_000_000
  if (kg >= 1_000_000 || kg < 0) return null
  return Math.round(kg * 100) / 100
}
```
Vervang op de call-site (regel 127) `gewicht_kg: normalizeGewicht(row.weight),` door:
```ts
      gewicht_kg: kgVanLightspeedGewicht(row.weight),
```

- [ ] **Step 3: Idem voor `import-lightspeed-orders` — dit fixt de bug**

In `supabase/functions/import-lightspeed-orders/index.ts`, voeg toe bij de imports (na regel 28, `haalKlantPrijs`-import):
```ts
import { kgVanLightspeedGewicht } from '../_shared/order-intake/gewicht.ts'
```
Verwijder de lokale functie (regels 44-49):
```ts
function normalizeGewicht(raw: number | undefined): number | null {
  if (raw == null || Number.isNaN(raw)) return null
  const kg = raw / 1_000  // Lightspeed weight is in grams
  if (kg >= 1_000_000 || kg < 0) return null
  return Math.round(kg * 100) / 100
}
```
Vervang op de call-site (regel 109) `gewicht_kg: normalizeGewicht(row.weight),` door:
```ts
      gewicht_kg: kgVanLightspeedGewicht(row.weight),
```

- [ ] **Step 4: Verifieer dat beide functies type-checken**

Run: `deno check supabase/functions/sync-webshop-order/index.ts supabase/functions/import-lightspeed-orders/index.ts`
Expected: geen type-fouten (exit 0). De `normalizeGewicht`-referenties bestaan niet meer en de import resolvet.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/sync-webshop-order/index.ts supabase/functions/import-lightspeed-orders/index.ts
git commit -m "fix(intake): unificeer Lightspeed-gewicht-conversie (was 1000x verschil tussen webhook en cron)"
```

> **Docs:** voeg na deze slice een `changelog.md`-regel toe (datum 2026-06-09): "fix: Lightspeed gewicht-conversie geünificeerd op micro-kg; import-lightspeed-orders deelde foutief door 1.000 → factor-1000 te laag gewicht."

---

## Slice 1 — Documentatie ADR-0001 eerlijk maken

**Doel:** De doc-leugen wegnemen dat `modules/orders/` bestaat, en ADR-0001 markeren als niet-uitgevoerd. Nul code-diff.

### Task 1.1: Corrigeer `architectuur.md:29`

**Files:**
- Modify: `docs/architectuur.md:29`

- [ ] **Step 1: Vervang de onjuiste claim**

In [`docs/architectuur.md:29`](../../architectuur.md#L29) staat in de module-grafiek-paragraaf de zinsnede:
```
Eerste twee modules in dit patroon waren `modules/edi/` en `modules/logistiek/`; daarop volgden `modules/orders/` (bezit het Order-voorstel). De oude `modules/planning/`-belofte uit deze paragraaf is per [ADR-0013](adr/0013-snijplanning-module-en-cache-invalidation-seam.md) ingetrokken:
```
Vervang die twee zinnen door:
```
Eerste twee modules in dit patroon waren `modules/edi/` en `modules/logistiek/`. De in [ADR-0001](adr/0001-order-voorstel-en-planning-als-twee-modules.md) beloofde `modules/orders/`-map is **nog niet gebouwd**: de order-intake/-voorstel-code leeft bewust verspreid over `components/orders/`, `lib/orders/`, `lib/supabase/queries/orders.ts` en `modules/orders-lifecycle/` (zie ADR-0001-note). De oude `modules/planning/`-belofte uit deze paragraaf is per [ADR-0013](adr/0013-snijplanning-module-en-cache-invalidation-seam.md) ingetrokken:
```

- [ ] **Step 2: Verifieer dat er geen andere "modules/orders/ bestaat"-claims staan**

Run: `grep -rn "modules/orders/" docs/architectuur.md`
Expected: alle resterende treffers verwijzen naar de toekomst/belofte, niet naar bestaande code. Lees elke treffer en corrigeer indien een ervan "bestaat"/"bezit" in de tegenwoordige tijd suggereert.

- [ ] **Step 3: Commit**

```bash
git add docs/architectuur.md
git commit -m "docs(architectuur): corrigeer onjuiste claim dat modules/orders/ bestaat"
```

### Task 1.2: ADR-0001 status-note

**Files:**
- Modify: `docs/adr/0001-order-voorstel-en-planning-als-twee-modules.md`

- [ ] **Step 1: Voeg een implementatie-status-note toe**

Voeg in `docs/adr/0001-order-voorstel-en-planning-als-twee-modules.md` direct ná de `## Beslissing`-sectie (vóór `## Overwogen alternatieven`, dus vóór regel 23) deze nieuwe sectie in:
```markdown
## Implementatie-status (bijgewerkt 2026-06-09)

**Niet uitgevoerd.** Noch `modules/orders/` noch `modules/planning/` is gebouwd; de
edge functions `orders-bouw-voorstel`/`planning-simuleer-levertijd` en de RPC
`bouw_order_voorstel` bestaan niet. De `modules/planning/`-helft is formeel
ingetrokken door [ADR-0013](0013-snijplanning-module-en-cache-invalidation-seam.md).
De `modules/orders/`-helft blijft een open belofte, maar is **bewust niet
ingepland**: de order-intake/-voorstel-code werkt verspreid over
`components/orders/`, `lib/orders/`, `lib/supabase/queries/orders.ts` en
`modules/orders-lifecycle/`. Een mapverhuizing levert geen functionele waarde en
vereist eerst de in "Consequenties" genoemde regressie-fixtureset (~20 order-cases),
die niet bestaat. Latere ADR's (0006/0009/0011/0018) die "zodra ADR-0001 uitgevoerd
is" noemen, moeten gelezen worden als "tot nader order: directe import uit
`lib/`/`components/`".
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0001-order-voorstel-en-planning-als-twee-modules.md
git commit -m "docs(adr-0001): markeer als niet-uitgevoerd; documenteer bewust-verspreide order-structuur"
```

> **Docs:** `changelog.md`-regel (2026-06-09): "docs: architectuur.md + ADR-0001 in lijn gebracht met de realiteit (modules/orders/ bestaat niet)."

---

## Slice 2 — Intake-predicaten centraliseren

**Doel:** De drie intake-aandachts-predicaten krijgen elk één bron van waarheid (pure JS-predicaat + PostgREST-filterhelper), zodat de inline-kopieën en "werk op N plekken bij"-comments verdwijnen. Geen gedragsverandering — de chips/banners tonen exact dezelfde counts.

### Task 2.1: `Debiteur te bevestigen` (3 kopieën → 1 helper)

**Files:**
- Create: `frontend/src/lib/orders/intake-predicaten.ts`
- Test: `frontend/src/lib/orders/__tests__/intake-predicaten.test.ts`
- Modify: `frontend/src/lib/supabase/queries/orders.ts:191-194` en `:337-341`
- Modify: `frontend/src/pages/orders/order-detail.tsx:121-123`

- [ ] **Step 1: Schrijf de falende test**

`frontend/src/lib/orders/__tests__/intake-predicaten.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isDebiteurTeBevestigen, filterDebiteurTeBevestigen } from '../intake-predicaten'

describe('isDebiteurTeBevestigen', () => {
  it('true bij onzekere match die geen env_fallback is', () => {
    expect(isDebiteurTeBevestigen({ debiteur_zeker: false, debiteur_match_bron: 'naam_fuzzy', status: 'Klaar voor picken' })).toBe(true)
  })
  it('true bij onzekere match zonder vastgelegde bron (NULL-safe)', () => {
    expect(isDebiteurTeBevestigen({ debiteur_zeker: false, debiteur_match_bron: null, status: 'Klaar voor picken' })).toBe(true)
  })
  it('false bij env_fallback (verzameldebiteur = verwachte eindbestemming)', () => {
    expect(isDebiteurTeBevestigen({ debiteur_zeker: false, debiteur_match_bron: 'env_fallback', status: 'Klaar voor picken' })).toBe(false)
  })
  it('false bij zekere match', () => {
    expect(isDebiteurTeBevestigen({ debiteur_zeker: true, debiteur_match_bron: null, status: 'Klaar voor picken' })).toBe(false)
  })
  it('false bij geannuleerde order', () => {
    expect(isDebiteurTeBevestigen({ debiteur_zeker: false, debiteur_match_bron: 'naam_fuzzy', status: 'Geannuleerd' })).toBe(false)
  })
})

describe('filterDebiteurTeBevestigen', () => {
  it('past exact de drie PostgREST-filters toe', () => {
    const calls: { op: string; args: unknown[] }[] = []
    const q = {
      eq(c: string, v: unknown) { calls.push({ op: 'eq', args: [c, v] }); return this },
      or(f: string) { calls.push({ op: 'or', args: [f] }); return this },
      neq(c: string, v: unknown) { calls.push({ op: 'neq', args: [c, v] }); return this },
    }
    filterDebiteurTeBevestigen(q)
    expect(calls).toEqual([
      { op: 'eq', args: ['debiteur_zeker', false] },
      { op: 'or', args: ['debiteur_match_bron.is.null,debiteur_match_bron.neq.env_fallback'] },
      { op: 'neq', args: ['status', 'Geannuleerd'] },
    ])
  })
})
```

- [ ] **Step 2: Run de test, verifieer dat hij faalt**

Run (vanuit `frontend/`): `npx vitest run src/lib/orders/__tests__/intake-predicaten.test.ts`
Expected: FAIL — kan `../intake-predicaten` niet resolven.

- [ ] **Step 3: Schrijf de implementatie**

`frontend/src/lib/orders/intake-predicaten.ts`:
```ts
// Bron van waarheid voor het 'Debiteur te bevestigen'-predicaat (mig 322):
// orders met een onzekere fuzzy debiteur-match die nog bevestigd moet worden.
// env_fallback (verzameldebiteur) is bewust GEEN fout en valt af. NULL-safe:
// alleen expliciet env_fallback wordt uitgesloten — een onzekere order zonder
// vastgelegde bron telt mee, anders valt hij stil uit beeld.
//
// Twee adapters die exact dezelfde voorwaarde uitdrukken:
//   - isDebiteurTeBevestigen(order): pure JS-check (order-detail, client-side).
//   - filterDebiteurTeBevestigen(query): PostgREST-filterketen (fetchOrders + count).
// Wijzig de definitie HIER; beide callers volgen automatisch.

export interface DebiteurBevestigVelden {
  debiteur_zeker?: boolean | null
  debiteur_match_bron?: string | null
  status?: string | null
}

export function isDebiteurTeBevestigen(order: DebiteurBevestigVelden): boolean {
  return (
    order.debiteur_zeker === false &&
    order.debiteur_match_bron !== 'env_fallback' &&
    order.status !== 'Geannuleerd'
  )
}

/** Minimaal structureel contract van de PostgREST-filterbuilder dat we hier gebruiken. */
interface PostgrestEqOrNeq<Q> {
  eq(column: string, value: unknown): Q
  or(filter: string): Q
  neq(column: string, value: unknown): Q
}

/** Past de drie 'Debiteur te bevestigen'-filters toe op een query-builder. */
export function filterDebiteurTeBevestigen<Q extends PostgrestEqOrNeq<Q>>(query: Q): Q {
  return query
    .eq('debiteur_zeker', false)
    .or('debiteur_match_bron.is.null,debiteur_match_bron.neq.env_fallback')
    .neq('status', 'Geannuleerd')
}
```

- [ ] **Step 4: Run de test, verifieer dat hij slaagt**

Run (vanuit `frontend/`): `npx vitest run src/lib/orders/__tests__/intake-predicaten.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Vervang de kopie in `fetchOrders` (orders.ts:191-194)**

Voeg bovenaan `frontend/src/lib/supabase/queries/orders.ts` bij de imports toe:
```ts
import { filterDebiteurTeBevestigen } from '@/lib/orders/intake-predicaten'
```
Vervang in de `'Debiteur te bevestigen'`-branch (regels 191-194):
```ts
    query = query
      .eq('debiteur_zeker', false)
      .or('debiteur_match_bron.is.null,debiteur_match_bron.neq.env_fallback')
      .neq('status', 'Geannuleerd')
```
door:
```ts
    query = filterDebiteurTeBevestigen(query)
```

- [ ] **Step 6: Vervang de kopie in `countTeBevestigenDebiteurOrders` (orders.ts:333-341)**

Vervang de body van `countTeBevestigenDebiteurOrders` (regels 334-341):
```ts
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('debiteur_zeker', false)
    // NULL-safe: alleen expliciet env_fallback valt af; een onzekere order
    // zonder vastgelegde bron telt mee (zie fetchOrders-branch + order-detail).
    .or('debiteur_match_bron.is.null,debiteur_match_bron.neq.env_fallback')
    .neq('status', 'Geannuleerd')
```
door:
```ts
  const { count, error } = await filterDebiteurTeBevestigen(
    supabase.from('orders').select('id', { count: 'exact', head: true }),
  )
```

- [ ] **Step 7: Vervang de JS-conditie op order-detail (order-detail.tsx:121-123)**

Voeg in `frontend/src/pages/orders/order-detail.tsx` bij de imports toe:
```ts
import { isDebiteurTeBevestigen } from '@/lib/orders/intake-predicaten'
```
Vervang de inline-conditie (regels 121-123):
```tsx
      {order.debiteur_zeker === false &&
        order.debiteur_match_bron !== 'env_fallback' &&
        order.status !== 'Geannuleerd' && (
```
door:
```tsx
      {isDebiteurTeBevestigen(order) && (
```

- [ ] **Step 8: Typecheck + commit**

Run (vanuit `frontend/`): `npm run typecheck`
Expected: geen fouten.
```bash
git add frontend/src/lib/orders/intake-predicaten.ts frontend/src/lib/orders/__tests__/intake-predicaten.test.ts frontend/src/lib/supabase/queries/orders.ts frontend/src/pages/orders/order-detail.tsx
git commit -m "refactor(orders): centraliseer 'Debiteur te bevestigen'-predicaat (3 kopieen -> 1 helper)"
```

### Task 2.2: `Te bevestigen` (EDI-leverweek) — gebruik de bestaande helper-seam in de queries

**Files:**
- Modify: `frontend/src/lib/orders/edi-leverweek.ts` (filterhelper toevoegen)
- Modify: `frontend/src/lib/supabase/queries/orders.ts:179-182` en `:293-298`
- Test: `frontend/src/lib/orders/__tests__/edi-leverweek.test.ts` (uitbreiden)

- [ ] **Step 1: Breid de test uit met de filterhelper**

Voeg onderaan `frontend/src/lib/orders/__tests__/edi-leverweek.test.ts` toe (en voeg `filterLeverweekTeBevestigen` toe aan de import op regel 2):
```ts
describe('filterLeverweekTeBevestigen', () => {
  it('past de drie PostgREST-filters toe', () => {
    const calls: { op: string; args: unknown[] }[] = []
    const q = {
      eq(c: string, v: unknown) { calls.push({ op: 'eq', args: [c, v] }); return this },
      is(c: string, v: unknown) { calls.push({ op: 'is', args: [c, v] }); return this },
      neq(c: string, v: unknown) { calls.push({ op: 'neq', args: [c, v] }); return this },
    }
    filterLeverweekTeBevestigen(q)
    expect(calls).toEqual([
      { op: 'eq', args: ['bron_systeem', 'edi'] },
      { op: 'is', args: ['edi_bevestigd_op', null] },
      { op: 'neq', args: ['status', 'Geannuleerd'] },
    ])
  })
})
```

- [ ] **Step 2: Run de test, verifieer dat hij faalt**

Run (vanuit `frontend/`): `npx vitest run src/lib/orders/__tests__/edi-leverweek.test.ts`
Expected: FAIL — `filterLeverweekTeBevestigen` is geen export.

- [ ] **Step 3: Voeg de filterhelper toe aan `edi-leverweek.ts`**

Voeg in `frontend/src/lib/orders/edi-leverweek.ts` ná `isLeverweekTeBevestigen` (na regel 18) toe:
```ts
/** Minimaal structureel contract van de PostgREST-filterbuilder. */
interface PostgrestEqIsNeq<Q> {
  eq(column: string, value: unknown): Q
  is(column: string, value: unknown): Q
  neq(column: string, value: unknown): Q
}

/**
 * Query-tegenhanger van `isLeverweekTeBevestigen`: filtert orders op de
 * EDI-leverweek-bevestiging-gate (mig 158/309). Geannuleerde orders uitgesloten
 * (annuleren vereist geen bevestiging). Wijzig de definitie hier; fetchOrders en
 * fetchStatusCounts volgen automatisch.
 */
export function filterLeverweekTeBevestigen<Q extends PostgrestEqIsNeq<Q>>(query: Q): Q {
  return query
    .eq('bron_systeem', 'edi')
    .is('edi_bevestigd_op', null)
    .neq('status', 'Geannuleerd')
}
```

- [ ] **Step 4: Run de test, verifieer dat hij slaagt**

Run (vanuit `frontend/`): `npx vitest run src/lib/orders/__tests__/edi-leverweek.test.ts`
Expected: PASS — bestaande tests + de nieuwe `filterLeverweekTeBevestigen`-test.

- [ ] **Step 5: Gebruik de helper in `fetchOrders` (orders.ts:179-182)**

Voeg in `frontend/src/lib/supabase/queries/orders.ts` bij de imports toe:
```ts
import { filterLeverweekTeBevestigen } from '@/lib/orders/edi-leverweek'
```
Vervang in de `'Te bevestigen'`-branch (regels 179-182):
```ts
    query = query
      .eq('bron_systeem', 'edi')
      .is('edi_bevestigd_op', null)
      .neq('status', 'Geannuleerd')
```
door:
```ts
    query = filterLeverweekTeBevestigen(query)
```

- [ ] **Step 6: Gebruik de helper in `fetchStatusCounts` (orders.ts:293-298)**

Vervang in `fetchStatusCounts` de derde Promise (regels 293-298):
```ts
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('bron_systeem', 'edi')
      .is('edi_bevestigd_op', null)
      .neq('status', 'Geannuleerd'),
```
door:
```ts
    filterLeverweekTeBevestigen(
      supabase.from('orders').select('id', { count: 'exact', head: true }),
    ),
```

- [ ] **Step 7: Typecheck + commit**

Run (vanuit `frontend/`): `npm run typecheck`
Expected: geen fouten.
```bash
git add frontend/src/lib/orders/edi-leverweek.ts frontend/src/lib/orders/__tests__/edi-leverweek.test.ts frontend/src/lib/supabase/queries/orders.ts
git commit -m "refactor(orders): fetchOrders/fetchStatusCounts gebruiken de EDI-leverweek-filter-seam"
```

### Task 2.3: `Te koppelen` — één gedeelde definitie voor EDI-module

**Files:**
- Create: `frontend/src/modules/edi/lib/te-koppelen.ts`
- Modify: `frontend/src/modules/edi/queries/edi.ts:117-126`
- Modify: `frontend/src/modules/edi/pages/berichten-overzicht.tsx:299-306`
- Test: `frontend/src/modules/edi/lib/__tests__/te-koppelen.test.ts`

- [ ] **Step 1: Schrijf de falende test**

`frontend/src/modules/edi/lib/__tests__/te-koppelen.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isTeKoppelen } from '../te-koppelen'

describe('isTeKoppelen', () => {
  it('true voor een inkomende order zonder gekoppelde order', () => {
    expect(isTeKoppelen({ richting: 'in', berichttype: 'order', order_id: null })).toBe(true)
  })
  it('false zodra er een order gekoppeld is', () => {
    expect(isTeKoppelen({ richting: 'in', berichttype: 'order', order_id: 42 })).toBe(false)
  })
  it('false voor uitgaande berichten of niet-orders', () => {
    expect(isTeKoppelen({ richting: 'out', berichttype: 'order', order_id: null })).toBe(false)
    expect(isTeKoppelen({ richting: 'in', berichttype: 'invoice', order_id: null })).toBe(false)
  })
})
```

- [ ] **Step 2: Run de test, verifieer dat hij faalt**

Run (vanuit `frontend/`): `npx vitest run src/modules/edi/lib/__tests__/te-koppelen.test.ts`
Expected: FAIL — module bestaat niet.

- [ ] **Step 3: Schrijf de implementatie**

`frontend/src/modules/edi/lib/te-koppelen.ts`:
```ts
// Bron van waarheid voor het 'Te koppelen'-predicaat (mig 306/307): een
// inkomend EDI-order-bericht dat (nog) geen order werd. Filtert op order_id
// IS NULL, NIET op status — de poll laat de status soms op 'Verwerkt' staan
// terwijl order-creatie faalde (geen GLN-match).

export interface TeKoppelenVelden {
  richting: string
  berichttype: string
  order_id: number | null
}

export function isTeKoppelen(b: TeKoppelenVelden): boolean {
  return b.richting === 'in' && b.berichttype === 'order' && b.order_id == null
}

/** Minimaal structureel contract van de PostgREST-filterbuilder. */
interface PostgrestEqIs<Q> {
  eq(column: string, value: unknown): Q
  is(column: string, value: unknown): Q
}

/** Query-tegenhanger van isTeKoppelen. */
export function filterTeKoppelen<Q extends PostgrestEqIs<Q>>(query: Q): Q {
  return query.eq('richting', 'in').eq('berichttype', 'order').is('order_id', null)
}
```

- [ ] **Step 4: Run de test, verifieer dat hij slaagt**

Run (vanuit `frontend/`): `npx vitest run src/modules/edi/lib/__tests__/te-koppelen.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Gebruik `filterTeKoppelen` in edi.ts**

Voeg in `frontend/src/modules/edi/queries/edi.ts` bij de imports toe:
```ts
import { filterTeKoppelen } from '@/modules/edi/lib/te-koppelen'
```
Vervang in `countTeKoppelenEdiOrders` (regels 118-123):
```ts
  const { count, error } = await supabase
    .from('edi_berichten')
    .select('id', { count: 'exact', head: true })
    .eq('richting', 'in')
    .eq('berichttype', 'order')
    .is('order_id', null)
```
door:
```ts
  const { count, error } = await filterTeKoppelen(
    supabase.from('edi_berichten').select('id', { count: 'exact', head: true }),
  )
```

- [ ] **Step 6: Gebruik de gedeelde `isTeKoppelen` in berichten-overzicht.tsx**

In `frontend/src/modules/edi/pages/berichten-overzicht.tsx`: verwijder de lokale functie-definitie (regels 299-306, het JSDoc-blok + `function isTeKoppelen(...) {...}`) en voeg bij de imports toe:
```ts
import { isTeKoppelen } from '@/modules/edi/lib/te-koppelen'
```
> Let op: de lokale `isTeKoppelen` accepteerde getypeerde `EdiRichting`/`EdiBerichtType`. De gedeelde versie accepteert `string` voor `richting`/`berichttype` — structureel compatibel bij aanroep. Verifieer met typecheck in stap 7.

- [ ] **Step 7: Typecheck + commit**

Run (vanuit `frontend/`): `npm run typecheck`
Expected: geen fouten.
```bash
git add frontend/src/modules/edi/lib/te-koppelen.ts frontend/src/modules/edi/lib/__tests__/te-koppelen.test.ts frontend/src/modules/edi/queries/edi.ts frontend/src/modules/edi/pages/berichten-overzicht.tsx
git commit -m "refactor(edi): centraliseer 'Te koppelen'-predicaat (isTeKoppelen + filterTeKoppelen)"
```

### Task 2.4: CLAUDE.md "werk op N plekken bij"-instructies bijwerken

**Files:**
- Modify: `CLAUDE.md` (regels rond 74/77 — de "Eén bron-van-waarheid"-comments)

- [ ] **Step 1: Werk de bullets bij**

In `CLAUDE.md`, in de EDI-mig-306/307-bullet (rond regel 74), vervang de zinsnede die zegt *"Eén bron-van-waarheid voor de telling: pas de definitie aan op één plek (`countTeKoppelenEdiOrders` + `isTeKoppelen`)"* door:
```
Eén bron-van-waarheid: `frontend/src/modules/edi/lib/te-koppelen.ts` (`isTeKoppelen` + `filterTeKoppelen`); `countTeKoppelenEdiOrders` en de berichten-overzicht-filter consumeren die.
```
In de mig-322-bullet (rond regel 77), vervang *"één bron-van-waarheid: `countTeBevestigenDebiteurOrders` + de `'Debiteur te bevestigen'`-branch in `fetchOrders` + de JS-conditie op order-detail"* door:
```
één bron-van-waarheid: `frontend/src/lib/orders/intake-predicaten.ts` (`isDebiteurTeBevestigen` + `filterDebiteurTeBevestigen`); fetchOrders, countTeBevestigenDebiteurOrders en order-detail consumeren die. De EDI-leverweek-gate idem via `filterLeverweekTeBevestigen` in `edi-leverweek.ts`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md docs/changelog.md
git commit -m "docs: intake-predicaten verwijzen naar centrale helpers i.p.v. 'werk op N plekken bij'"
```

> **Docs:** `changelog.md`-regel (2026-06-09): "refactor: drie intake-predicaten (Te koppelen / Te bevestigen / Debiteur te bevestigen) gecentraliseerd in pure helpers + filterhelpers; inline-kopieën verwijderd."

---

## Slice 3 — order-form split-logica extraheren + testen

**Doel:** De geld-rekenende split- en verzend-toewijzing-logica uit `saveMutation.mutationFn` halen naar pure, geteste functies in `lib/orders/split-order.ts`. `order-form.tsx` wordt kleiner en de berekeningen worden voor het eerst los testbaar. **Gedrag-behoud is kritisch** — de tests pinnen het huidige gedrag vast vóór de extractie.

### Task 3.1: Pure `wijsVerzendNaarDuurste` (de gedupliceerde verzend-toewijzing)

**Files:**
- Create: `frontend/src/lib/orders/split-order.ts`
- Test: `frontend/src/lib/orders/__tests__/split-order.test.ts`

- [ ] **Step 1: Schrijf de falende test**

`frontend/src/lib/orders/__tests__/split-order.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { wijsVerzendNaarDuurste } from '../split-order'

type R = { artikelnr: string; bedrag: number | null }

describe('wijsVerzendNaarDuurste', () => {
  const shipping: R = { artikelnr: 'VERZEND', bedrag: 10 }

  it('voegt verzend toe aan deelB als deelB duurder is', () => {
    const a: R[] = [{ artikelnr: 'A', bedrag: 100 }]
    const b: R[] = [{ artikelnr: 'B', bedrag: 200 }]
    const r = wijsVerzendNaarDuurste(a, b, shipping)
    expect(r.deelA).toEqual(a)
    expect(r.deelB).toEqual([...b, shipping])
  })

  it('voegt verzend toe aan deelA bij gelijke totalen (tie → deelA)', () => {
    const a: R[] = [{ artikelnr: 'A', bedrag: 100 }]
    const b: R[] = [{ artikelnr: 'B', bedrag: 100 }]
    const r = wijsVerzendNaarDuurste(a, b, shipping)
    expect(r.deelA).toEqual([...a, shipping])
    expect(r.deelB).toEqual(b)
  })

  it('laat beide delen ongemoeid als er geen verzendregel is', () => {
    const a: R[] = [{ artikelnr: 'A', bedrag: 100 }]
    const b: R[] = [{ artikelnr: 'B', bedrag: 200 }]
    const r = wijsVerzendNaarDuurste(a, b, null)
    expect(r.deelA).toEqual(a)
    expect(r.deelB).toEqual(b)
  })

  it('behandelt null-bedragen als 0', () => {
    const a: R[] = [{ artikelnr: 'A', bedrag: null }]
    const b: R[] = [{ artikelnr: 'B', bedrag: null }]
    const r = wijsVerzendNaarDuurste(a, b, shipping)
    expect(r.deelA).toEqual([...a, shipping]) // tie (0 == 0) → deelA
  })
})
```

- [ ] **Step 2: Run de test, verifieer dat hij faalt**

Run (vanuit `frontend/`): `npx vitest run src/lib/orders/__tests__/split-order.test.ts`
Expected: FAIL — `../split-order` bestaat niet.

- [ ] **Step 3: Schrijf de implementatie**

`frontend/src/lib/orders/split-order.ts`:
```ts
// Pure split-/toewijzing-helpers voor de handmatige order-commit (order-form).
// Geëxtraheerd uit saveMutation.mutationFn zodat de geld-rekenende logica
// los testbaar is. Geen React, geen I/O.

/** Minimaal contract: alles wat een 'bedrag' draagt kan toegewezen worden. */
interface MetBedrag {
  bedrag?: number | null
}

function totaal(regels: { bedrag?: number | null }[]): number {
  return regels.reduce((s, r) => s + (r.bedrag ?? 0), 0)
}

/**
 * Wijst de verzendregel toe aan de DUURSTE van twee sub-orders (issue #33).
 * Bij gelijke totalen gaat de verzendregel naar deelA (= standaard/directe deel),
 * consistent met het oorspronkelijke `totaalX > totaalY`-gedrag in order-form.
 * Pure functie: retourneert nieuwe arrays, muteert niets.
 */
export function wijsVerzendNaarDuurste<T extends MetBedrag>(
  deelA: T[],
  deelB: T[],
  shipping: T | null | undefined,
): { deelA: T[]; deelB: T[] } {
  if (!shipping) return { deelA, deelB }
  return totaal(deelB) > totaal(deelA)
    ? { deelA, deelB: [...deelB, shipping] }
    : { deelA: [...deelA, shipping], deelB }
}
```

- [ ] **Step 4: Run de test, verifieer dat hij slaagt**

Run (vanuit `frontend/`): `npx vitest run src/lib/orders/__tests__/split-order.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/orders/split-order.ts frontend/src/lib/orders/__tests__/split-order.test.ts
git commit -m "feat(orders): pure wijsVerzendNaarDuurste-helper + tests"
```

### Task 3.2: Pure `splitRegelOpDekking` (per-regel directe/IO-splitsing + bedrag-herberekening)

**Files:**
- Modify: `frontend/src/lib/orders/split-order.ts`
- Modify: `frontend/src/lib/orders/__tests__/split-order.test.ts`

- [ ] **Step 1: Breid de test uit**

Voeg toe aan `frontend/src/lib/orders/__tests__/split-order.test.ts` (en voeg `splitRegelOpDekking` toe aan de import):
```ts
describe('splitRegelOpDekking', () => {
  const basis = { artikelnr: 'A', prijs: 100, korting_pct: 0, orderaantal: 10, te_leveren: 10, bedrag: 1000 }

  it('volledig gedekt (ioTekort 0) → alleen directeRegel, ongewijzigd', () => {
    const r = splitRegelOpDekking(basis, { direct: 7, uitwisselbaar: 3, ioTekort: 0 })
    expect(r.directeRegel).toEqual(basis)
    expect(r.ioRegel).toBeNull()
  })

  it('volledig op IO (directDeel 0) → alleen ioRegel, keuzes geleegd', () => {
    const r = splitRegelOpDekking({ ...basis, uitwisselbaar_keuzes: [{ artikelnr: 'X', aantal: 1 }] }, { direct: 0, uitwisselbaar: 0, ioTekort: 10 })
    expect(r.directeRegel).toBeNull()
    expect(r.ioRegel?.orderaantal).toBe(10)
    expect(r.ioRegel?.uitwisselbaar_keuzes).toEqual([])
  })

  it('gemengd → splitst aantallen en herberekent bedrag proportioneel', () => {
    // direct=6 (4 voorraad + 2 uitwissel), ioTekort=4, prijs 100, 0% korting
    const r = splitRegelOpDekking(basis, { direct: 4, uitwisselbaar: 2, ioTekort: 4 })
    expect(r.directeRegel?.orderaantal).toBe(6)
    expect(r.directeRegel?.te_leveren).toBe(6)
    expect(r.directeRegel?.bedrag).toBe(600)
    expect(r.ioRegel?.orderaantal).toBe(4)
    expect(r.ioRegel?.bedrag).toBe(400)
    expect(r.ioRegel?.id).toBeUndefined()
  })

  it('past korting toe in de bedrag-herberekening', () => {
    const r = splitRegelOpDekking({ ...basis, korting_pct: 10 }, { direct: 5, uitwisselbaar: 0, ioTekort: 5 })
    expect(r.directeRegel?.bedrag).toBe(450) // 100 * 5 * 0.9
    expect(r.ioRegel?.bedrag).toBe(450)
  })
})
```

- [ ] **Step 2: Run de test, verifieer dat hij faalt**

Run (vanuit `frontend/`): `npx vitest run src/lib/orders/__tests__/split-order.test.ts`
Expected: FAIL — `splitRegelOpDekking` is geen export.

- [ ] **Step 3: Implementeer `splitRegelOpDekking`**

Voeg toe aan `frontend/src/lib/orders/split-order.ts` (bovenaan de import van het regel-type, onder de bestaande imports — voeg deze import toe als eerste regel):
```ts
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
```
En onderaan het bestand:
```ts
/** Dekkings-uitsplitsing van één regel (spiegelt berekenRegelDekking-output). */
export interface RegelDekking {
  direct: number
  uitwisselbaar: number
  ioTekort: number
}

/**
 * Splitst één orderregel in een direct-leverbaar deel en een IO-deel op basis
 * van de dekking. Herberekent `bedrag` proportioneel (prijs × aantal × (1−korting),
 * afgerond op centen). Het IO-deel krijgt `id: undefined` (nieuwe regel) en lege
 * uitwisselbaar-keuzes. Geëxtraheerd uit order-form mutationFn (regels 487-513).
 */
export function splitRegelOpDekking(
  regel: OrderRegelFormData,
  dekking: RegelDekking,
): { directeRegel: OrderRegelFormData | null; ioRegel: OrderRegelFormData | null } {
  const directDeel = dekking.direct + dekking.uitwisselbaar

  if (dekking.ioTekort === 0) {
    return { directeRegel: regel, ioRegel: null }
  }
  if (directDeel === 0) {
    return { directeRegel: null, ioRegel: { ...regel, uitwisselbaar_keuzes: [] } }
  }

  const prijs = regel.prijs ?? 0
  const korting = (regel.korting_pct ?? 0) / 100
  const bedragVoor = (aantal: number) => Math.round(prijs * aantal * (1 - korting) * 100) / 100

  return {
    directeRegel: {
      ...regel,
      orderaantal: directDeel,
      te_leveren: directDeel,
      bedrag: bedragVoor(directDeel),
    },
    ioRegel: {
      ...regel,
      id: undefined,
      orderaantal: dekking.ioTekort,
      te_leveren: dekking.ioTekort,
      uitwisselbaar_keuzes: [],
      bedrag: bedragVoor(dekking.ioTekort),
    },
  }
}
```

- [ ] **Step 4: Run de test, verifieer dat hij slaagt**

Run (vanuit `frontend/`): `npx vitest run src/lib/orders/__tests__/split-order.test.ts`
Expected: PASS — alle tests (3.1 + 3.2).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/orders/split-order.ts frontend/src/lib/orders/__tests__/split-order.test.ts
git commit -m "feat(orders): pure splitRegelOpDekking-helper + tests"
```

### Task 3.3: `order-form.tsx` gebruikt de pure helpers

**Files:**
- Modify: `frontend/src/components/orders/order-form.tsx` (imports + regels 451-461 en 482-522)

- [ ] **Step 1: Importeer de helpers**

Voeg in `frontend/src/components/orders/order-form.tsx` bij de imports toe:
```ts
import { wijsVerzendNaarDuurste, splitRegelOpDekking } from '@/lib/orders/split-order'
```

- [ ] **Step 2: Vervang de maatwerk-split verzend-toewijzing (regels 451-461)**

Vervang in de maatwerk-split-flow:
```ts
          // Issue #33: verzendkosten naar de duurste sub-order (eerder altijd
          // standaard-deel — onlogisch als maatwerk-deel waardevoller is).
          const totaalStandaard = standaardRegels.reduce((s, r) => s + (r.bedrag ?? 0), 0)
          const totaalMaatwerk = maatwerkRegels.reduce((s, r) => s + (r.bedrag ?? 0), 0)
          const verzendNaarMaatwerk = totaalMaatwerk > totaalStandaard
          const regelsA = !verzendNaarMaatwerk && shippingRegel
            ? [...standaardRegels, shippingRegel]
            : standaardRegels
          const regelsB = verzendNaarMaatwerk && shippingRegel
            ? [...maatwerkRegels, shippingRegel]
            : maatwerkRegels
```
door:
```ts
          // Issue #33: verzendkosten naar de duurste sub-order (pure helper).
          const { deelA: regelsA, deelB: regelsB } = wijsVerzendNaarDuurste(
            standaardRegels,
            maatwerkRegels,
            shippingRegel,
          )
```

- [ ] **Step 3: Vervang de IO-split per-regel-lus (regels 482-514)**

Vervang in de IO-split-flow de for-lus:
```ts
          for (const r of regels) {
            if (r.artikelnr === SHIPPING_PRODUCT_ID) {
              shippingRegel = r  // pas later toewijzen aan duurste deel (issue #33)
              continue
            }
            const d = berekenRegelDekking(r)
            const directDeel = d.direct + d.uitwisselbaar

            if (d.ioTekort === 0) {
              directeRegels.push(r)
            } else if (directDeel === 0) {
              // Volledig op IO
              ioRegels.push({ ...r, uitwisselbaar_keuzes: [] })
            } else {
              // Per-regel splitsing
              const prijs = r.prijs ?? 0
              const korting = (r.korting_pct ?? 0) / 100
              directeRegels.push({
                ...r,
                orderaantal: directDeel,
                te_leveren: directDeel,
                bedrag: Math.round(prijs * directDeel * (1 - korting) * 100) / 100,
              })
              ioRegels.push({
                ...r,
                id: undefined,
                orderaantal: d.ioTekort,
                te_leveren: d.ioTekort,
                uitwisselbaar_keuzes: [],
                bedrag: Math.round(prijs * d.ioTekort * (1 - korting) * 100) / 100,
              })
            }
          }
```
door:
```ts
          for (const r of regels) {
            if (r.artikelnr === SHIPPING_PRODUCT_ID) {
              shippingRegel = r  // pas later toewijzen aan duurste deel (issue #33)
              continue
            }
            const { directeRegel, ioRegel } = splitRegelOpDekking(r, berekenRegelDekking(r))
            if (directeRegel) directeRegels.push(directeRegel)
            if (ioRegel) ioRegels.push(ioRegel)
          }
```

- [ ] **Step 4: Vervang de IO-split verzend-toewijzing (regels 516-522)**

Vervang:
```ts
          // Issue #33: verzendkosten naar duurste sub-order (i.p.v. altijd directe).
          if (shippingRegel) {
            const totaalDirect = directeRegels.reduce((s, r) => s + (r.bedrag ?? 0), 0)
            const totaalIo = ioRegels.reduce((s, r) => s + (r.bedrag ?? 0), 0)
            if (totaalIo > totaalDirect) ioRegels.push(shippingRegel)
            else directeRegels.push(shippingRegel)
          }
```
door:
```ts
          // Issue #33: verzendkosten naar duurste sub-order (pure helper).
          const verdeeld = wijsVerzendNaarDuurste(directeRegels, ioRegels, shippingRegel)
          directeRegels.length = 0
          directeRegels.push(...verdeeld.deelA)
          ioRegels.length = 0
          ioRegels.push(...verdeeld.deelB)
```
> Let op: `directeRegels`/`ioRegels` zijn `const` arrays die later nog aan `createOrder` worden doorgegeven; we muteren ze in-place (`.length = 0` + `push`) i.p.v. herbinden, zodat de bestaande regels 524-533 ongewijzigd blijven werken.

- [ ] **Step 5: Typecheck**

Run (vanuit `frontend/`): `npm run typecheck`
Expected: geen fouten. Controleer dat `berekenRegelDekking` nog geïmporteerd is (wordt nog gebruikt op regel 475 voor `heeftIoTekort` én nu in de lus).

- [ ] **Step 6: Verifieer de bestaande test-suite (regressie)**

Run (vanuit `frontend/`): `npm run test:run`
Expected: dezelfde testresultaten als vóór deze slice (afgezien van de nieuwe `split-order`/predicaat-tests die nu slagen). De bekende pre-existing failure `magazijn-pickbaarheid.contract.test.ts` blijft falen — niet door deze wijziging.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/orders/order-form.tsx
git commit -m "refactor(orders): order-form gebruikt pure split-helpers; geld-logica nu los getest"
```

> **Docs:** `changelog.md`-regel (2026-06-09): "refactor: split-/verzend-toewijzing-logica uit order-form.tsx geëxtraheerd naar geteste pure helpers in lib/orders/split-order.ts." `architectuur.md`: noem de nieuwe `split-order.ts`-seam naast `verzend-regel.ts` en `dekking-preview.ts`.

---

## Slice 4 — Gedeeld `IntakeRegel`-type + Lightspeed-buildRegels dedup

**Doel:** Eén `IntakeRegel`-type voor de drie Deno-webhook-kanalen (vervangt `regels: unknown[]`), en één `buildLightspeedRegels` die de twee near-duplicate Lightspeed-paden vervangt — inclusief consistente `maatwerk_vorm` en gedeelde omschrijving-opbouw. Leunt op slice 0 (`gewicht.ts`). EDI blijft buiten scope.

### Task 4.1: Het gedeelde `IntakeRegel`-type

**Files:**
- Create: `supabase/functions/_shared/order-intake/types.ts`

- [ ] **Step 1: Schrijf het type**

`supabase/functions/_shared/order-intake/types.ts`:
```ts
// Gedeelde intake-regel-shape voor de Deno-webhook-kanalen (Shopify, Lightspeed
// webhook, Lightspeed cron). Vervangt het ad-hoc `regels: unknown[]` per kanaal.
// Komt 1-op-1 overeen met de kolommen die create_webshop_order(p_regels) verwacht.
// EDI bouwt zijn regels in SQL (create_edi_order) en valt bewust buiten dit type.
export interface IntakeRegel {
  artikelnr: string | null
  omschrijving: string
  omschrijving_2: string | null
  orderaantal: number
  te_leveren: number
  prijs: number | null
  korting_pct: number
  bedrag: number | null
  gewicht_kg: number | null
  is_maatwerk: boolean
  maatwerk_kwaliteit_code: string | null
  maatwerk_kleur_code: string | null
  maatwerk_vorm: string | null
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
}
```

- [ ] **Step 2: Type-check + commit**

Run: `deno check supabase/functions/_shared/order-intake/types.ts`
Expected: geen fouten.
```bash
git add supabase/functions/_shared/order-intake/types.ts
git commit -m "feat(intake): gedeeld IntakeRegel-type voor de Deno-webhook-kanalen"
```

### Task 4.2: Pure `toIntakeRegel` + gededupliceerde `buildLightspeedRegels` (TDD)

**Files:**
- Create: `supabase/functions/_shared/order-intake/lightspeed-regels.ts`
- Test: `supabase/functions/_shared/order-intake/lightspeed-regels.test.ts`

- [ ] **Step 1: Schrijf de falende test voor de pure mapper**

`supabase/functions/_shared/order-intake/lightspeed-regels.test.ts`:
```ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { toIntakeRegel } from './lightspeed-regels.ts'

Deno.test('toIntakeRegel: standaard artikel', () => {
  const r = toIntakeRegel({
    omschrijving: 'Tapijt Blauw',
    omschrijving_2: '200x300',
    aantal: 2,
    prijs: 50,
    gewicht_kg: 4.21,
    match: { artikelnr: 'ART-1', matchedOn: 'artikelnr', is_maatwerk: false },
    dims: null,
  })
  assertEquals(r.artikelnr, 'ART-1')
  assertEquals(r.orderaantal, 2)
  assertEquals(r.te_leveren, 2)
  assertEquals(r.bedrag, 100) // 50 * 2
  assertEquals(r.gewicht_kg, 4.21)
  assertEquals(r.is_maatwerk, false)
  assertEquals(r.maatwerk_vorm, null)
})

Deno.test('toIntakeRegel: maatwerk met vorm + dims', () => {
  const r = toIntakeRegel({
    omschrijving: 'Op maat',
    omschrijving_2: null,
    aantal: 1,
    prijs: null,
    gewicht_kg: null,
    match: { artikelnr: null, matchedOn: 'maatwerk', is_maatwerk: true, maatwerk_kwaliteit_code: 'KW', maatwerk_kleur_code: 'KL', maatwerk_vorm: 'ovaal' },
    dims: { lengte: 140, breedte: 200 },
  })
  assertEquals(r.is_maatwerk, true)
  assertEquals(r.maatwerk_vorm, 'ovaal')
  assertEquals(r.maatwerk_lengte_cm, 140)
  assertEquals(r.maatwerk_breedte_cm, 200)
  assertEquals(r.prijs, null)
  assertEquals(r.bedrag, null) // prijs null → bedrag null
})
```

- [ ] **Step 2: Run de test, verifieer dat hij faalt**

Run: `deno test supabase/functions/_shared/order-intake/lightspeed-regels.test.ts`
Expected: FAIL — module/`toIntakeRegel` bestaat niet.

- [ ] **Step 3: Implementeer de pure mapper + de I/O-orchestrator**

`supabase/functions/_shared/order-intake/lightspeed-regels.ts`:
```ts
// Gededupliceerde Lightspeed-regelbouw voor BEIDE Lightspeed-intake-paden
// (sync-webshop-order webhook + import-lightspeed-orders cron-poll). Vóór deze
// module hadden beide een eigen buildRegels die uiteenliepen op gewicht-conversie
// (factor 1000, nu opgelost in slice 0), maatwerk_vorm (alleen de cron zette het)
// en omschrijving-opbouw. Eén bron van waarheid.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  parseMaatwerkDims,
  type LightspeedOrderRow,
} from '../../_shared/lightspeed-client.ts'
import { matchProduct, buildOmschrijving, type ProductMatch } from '../../_shared/product-matcher.ts'
import { haalKlantPrijs } from '../../_shared/klant-prijs.ts'
import { kgVanLightspeedGewicht } from './gewicht.ts'
import type { IntakeRegel } from './types.ts'

/** Pure assemblage van één IntakeRegel uit reeds-bepaalde match + prijs + dims. */
export function toIntakeRegel(input: {
  omschrijving: string
  omschrijving_2: string | null
  aantal: number
  prijs: number | null
  gewicht_kg: number | null
  match: ProductMatch
  dims: { lengte: number; breedte: number } | null
}): IntakeRegel {
  const { match, aantal, prijs } = input
  const bedrag = prijs != null ? Math.round(prijs * aantal * 100) / 100 : null
  return {
    artikelnr: match.artikelnr,
    omschrijving: input.omschrijving,
    omschrijving_2: input.omschrijving_2,
    orderaantal: aantal,
    te_leveren: aantal,
    prijs,
    korting_pct: 0,
    bedrag,
    gewicht_kg: input.gewicht_kg,
    is_maatwerk: match.is_maatwerk ?? false,
    maatwerk_kwaliteit_code: match.maatwerk_kwaliteit_code ?? null,
    maatwerk_kleur_code: match.maatwerk_kleur_code ?? null,
    maatwerk_vorm: match.maatwerk_vorm ?? null,
    maatwerk_lengte_cm: input.dims?.lengte ?? null,
    maatwerk_breedte_cm: input.dims?.breedte ?? null,
  }
}

/** Bouwt de IntakeRegels voor een Lightspeed-order (beide paden delen dit). */
export async function buildLightspeedRegels(
  supabase: SupabaseClient,
  rows: LightspeedOrderRow[],
  debiteurNr: number,
): Promise<{ regels: IntakeRegel[]; matched: number; unmatched: number }> {
  const regels: IntakeRegel[] = []
  let matched = 0
  let unmatched = 0

  for (const row of rows) {
    const match = await matchProduct(supabase, row, debiteurNr)
    // Staaltjes (Gratis Muster) worden niet ingeladen — Karpi factureert ze niet.
    if (match.unmatchedReden === 'muster') continue

    if (match.artikelnr || match.is_maatwerk) matched++
    else unmatched++

    const dims = match.is_maatwerk ? parseMaatwerkDims(row) : null
    const aantal = row.quantityOrdered ?? 1
    const klantPrijs = await haalKlantPrijs(supabase, debiteurNr, match.artikelnr, {
      is_maatwerk: match.is_maatwerk,
      lengte_cm: dims?.lengte ?? null,
      breedte_cm: dims?.breedte ?? null,
    })

    regels.push(
      toIntakeRegel({
        omschrijving: buildOmschrijving(row, match),
        omschrijving_2: row.variantTitle ?? null,
        aantal,
        prijs: klantPrijs.prijs,
        gewicht_kg: kgVanLightspeedGewicht(row.weight),
        match,
        dims: dims ?? null,
      }),
    )
  }

  return { regels, matched, unmatched }
}
```
> Let op: `buildOmschrijving` (uit `product-matcher.ts`) levert al de `[UNMATCHED]`-prefix-logica die `import-lightspeed-orders` voorheen inline herbouwde — door deze gedeelde helper te gebruiken verdwijnt die duplicatie automatisch. Verifieer dat `parseMaatwerkDims` het shape `{ lengte, breedte }` retourneert (zie `lightspeed-client.ts`); zo niet, pas de veldnamen in `dims` aan.

- [ ] **Step 4: Run de test, verifieer dat hij slaagt**

Run: `deno test supabase/functions/_shared/order-intake/lightspeed-regels.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/order-intake/lightspeed-regels.ts supabase/functions/_shared/order-intake/lightspeed-regels.test.ts
git commit -m "feat(intake): gededupliceerde buildLightspeedRegels + pure toIntakeRegel"
```

### Task 4.3: Beide Lightspeed-functies gebruiken `buildLightspeedRegels`

**Files:**
- Modify: `supabase/functions/sync-webshop-order/index.ts` (verwijder lokale `buildRegels`, regels 75-137; herbedraad call regel 210)
- Modify: `supabase/functions/import-lightspeed-orders/index.ts` (verwijder lokale `buildRegels`, regels 56-120; herbedraad call regel 153)

- [ ] **Step 1: `sync-webshop-order` — vervang import + verwijder lokale buildRegels**

In `supabase/functions/sync-webshop-order/index.ts`: vervang de regel-0-import `import { kgVanLightspeedGewicht } from '../_shared/order-intake/gewicht.ts'` (toegevoegd in slice 0) door:
```ts
import { buildLightspeedRegels } from '../_shared/order-intake/lightspeed-regels.ts'
```
Verwijder de imports die nu alleen door de lokale `buildRegels` gebruikt werden — controleer per import of hij elders nog gebruikt wordt; `matchProduct`, `buildOmschrijving`, `haalKlantPrijs`, `parseMaatwerkDims` en `kgVanLightspeedGewicht` verhuizen naar de gedeelde module. Verwijder de volledige lokale `buildRegels`-functie (regels 75-137). Verwijder ook de nu-ongebruikte `normalizeGewicht`-restanten als die er nog staan.

- [ ] **Step 2: `sync-webshop-order` — herbedraad de call-site (regel 210)**

Vervang:
```ts
    const { regels, matched, unmatched } = await buildRegels(supabase, rows, debiteurNr)
```
door:
```ts
    const { regels, matched, unmatched } = await buildLightspeedRegels(supabase, rows, debiteurNr)
```

- [ ] **Step 3: `import-lightspeed-orders` — idem**

In `supabase/functions/import-lightspeed-orders/index.ts`: vervang de slice-0-import `import { kgVanLightspeedGewicht } from '../_shared/order-intake/gewicht.ts'` door:
```ts
import { buildLightspeedRegels } from '../_shared/order-intake/lightspeed-regels.ts'
```
Verwijder de nu-ongebruikte imports (`matchProduct`, `haalKlantPrijs`, `parseMaatwerkDims` indien nergens anders gebruikt) en de volledige lokale `buildRegels` (regels 56-120). Vervang de call-site (regel 153):
```ts
        const { regels, matched, unmatched } = await buildRegels(supabase, rows, debiteurNr)
```
door:
```ts
        const { regels, matched, unmatched } = await buildLightspeedRegels(supabase, rows, debiteurNr)
```

- [ ] **Step 4: Type-check beide functies**

Run: `deno check supabase/functions/sync-webshop-order/index.ts supabase/functions/import-lightspeed-orders/index.ts`
Expected: geen fouten en geen "unused import"-meldingen. Los eventuele ongebruikte-import-fouten op door die imports te verwijderen.

- [ ] **Step 5: Run de gedeelde test opnieuw (regressie)**

Run: `deno test supabase/functions/_shared/order-intake/`
Expected: PASS — `gewicht.test.ts` + `lightspeed-regels.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/sync-webshop-order/index.ts supabase/functions/import-lightspeed-orders/index.ts
git commit -m "refactor(intake): beide Lightspeed-paden delen buildLightspeedRegels (dedup + maatwerk_vorm-fix)"
```

### Task 4.4: Shopify `buildRegels` emit `IntakeRegel[]`

**Files:**
- Modify: `supabase/functions/sync-shopify-order/index.ts:111-217` (return-type + VERZEND-regel velden)

- [ ] **Step 1: Type de Shopify `buildRegels`-output**

In `supabase/functions/sync-shopify-order/index.ts`, voeg bij de imports toe:
```ts
import type { IntakeRegel } from '../_shared/order-intake/types.ts'
```
Wijzig de signatuur van `buildRegels` (regel 111-115) van:
```ts
async function buildRegels(
  supabase: ReturnType<typeof createClient>,
  order: ShopifyOrderWebhook,
  debiteurNr: number,
): Promise<{ regels: unknown[]; matched: number; unmatched: number }> {
  const regels: unknown[] = []
```
naar:
```ts
async function buildRegels(
  supabase: ReturnType<typeof createClient>,
  order: ShopifyOrderWebhook,
  debiteurNr: number,
): Promise<{ regels: IntakeRegel[]; matched: number; unmatched: number }> {
  const regels: IntakeRegel[] = []
```

- [ ] **Step 2: Voeg het ontbrekende `maatwerk_vorm`-veld toe aan beide push-objecten**

Het `IntakeRegel`-type vereist `maatwerk_vorm`. In het artikel-regel-object (regels 175-190) ontbreekt dat veld; voeg het toe ná `maatwerk_kleur_code` (regel 187):
```ts
      maatwerk_vorm: match.maatwerk_vorm ?? null,
```
In het VERZEND-regel-object (regels 197-212) ontbreekt het ook; voeg ná `maatwerk_kleur_code: null,` (regel 209) toe:
```ts
        maatwerk_vorm: null,
```

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/sync-shopify-order/index.ts`
Expected: geen fouten. Als TypeScript een veld-mismatch meldt, betekent dat een echte shape-afwijking — los op door het object aan `IntakeRegel` te conformeren (geen velden weglaten of toevoegen buiten het type).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/sync-shopify-order/index.ts
git commit -m "refactor(intake): Shopify buildRegels emit IntakeRegel[] (incl. maatwerk_vorm)"
```

> **Docs:** `changelog.md`-regel (2026-06-09): "refactor: gedeeld IntakeRegel-type + gededupliceerde Lightspeed-regelbouw; sync-webshop-order kreeg het eerder ontbrekende maatwerk_vorm-veld." `architectuur.md`: documenteer de nieuwe `_shared/order-intake/`-seam (gewicht + types + lightspeed-regels) en noteer expliciet dat EDI bewust buiten valt.

---

## Vervolgbeslispunt (NIET in dit plan) — gedeelde SQL-insert-kern

Na slices 0-4 resteert de divergentie in de **insert-RPC-bodies** zelf (`create_webshop_order` mig 322, `create_edi_order` mig 312, `create_order_with_lines` mig 275): elk heeft een eigen `INSERT INTO orders/order_regels`-kolomlijst, en de mig-275-`'Nieuw'`-drift (gemaskeerd door de gedeelde `trg_orderregel_herallocateer`-trigger) leeft nog. Een vervolgslice zou de drie bodies laten convergeren op één SQL-helper `_insert_order_regel(...)`. Dat raakt het bedrijfskritische geld-pad, vereist DB-migraties + idempotentie-tests + een verplichte reviewer-agent, en hangt af van een regressie-fixtureset die nog niet bestaat (ADR-0001 §Consequenties). **Beslis dit apart** zodra slices 0-4 het fundament en de tests hebben gelegd.

---

## Self-Review

**1. Spec-dekking (de 5 verifieerde problemen → taken):**
- Lightspeed gewicht-bug → Slice 0 (Task 0.1-0.2). ✓
- ADR-0001 niet-uitgevoerd / doc-leugen → Slice 1 (Task 1.1-1.2). ✓
- Drie predicaten gedupliceerd → Slice 2 (Task 2.1 Debiteur, 2.2 Leverweek, 2.3 Te koppelen, 2.4 CLAUDE.md). ✓
- order-form.tsx geld-logica onverwoven/ongetest → Slice 3 (Task 3.1-3.3). ✓
- Geen gedeeld intake-type + Lightspeed-duplicatie + ontbrekend `maatwerk_vorm` → Slice 4 (Task 4.1-4.4). ✓
- Bewust buiten scope (RPC-kern, mapverhuizing, EDI-consolidatie) → expliciet gemarkeerd + vervolgbeslispunt. ✓

**2. Placeholder-scan:** geen "TBD"/"implementeer later"/"voeg validatie toe"-stappen; elke code-stap toont volledige code; elke test-stap toont het verwachte resultaat. De enige niet-code-stappen (0.1-stap 5 schaal-verificatie; 1.1-stap 2 grep-controle) zijn bewuste verificatie-acties, geen placeholders.

**3. Type-consistentie:** `kgVanLightspeedGewicht` (slice 0) wordt identiek aangeroepen in slice 0 én geïmporteerd in `lightspeed-regels.ts` (slice 4). `IntakeRegel` (4.1) wordt gebruikt door `toIntakeRegel`/`buildLightspeedRegels` (4.2) en Shopify (4.4) — alle vijftien velden consistent. `splitRegelOpDekking`/`wijsVerzendNaarDuurste` (3.1-3.2) hebben exact de signaturen die `order-form.tsx` (3.3) aanroept. `filterDebiteurTeBevestigen`/`isDebiteurTeBevestigen` (2.1), `filterLeverweekTeBevestigen` (2.2) en `isTeKoppelen`/`filterTeKoppelen` (2.3) matchen hun call-sites. `RegelDekking` (3.2) spiegelt de `berekenRegelDekking`-output `{ direct, uitwisselbaar, ioTekort }`.

**Openstaande verificaties voor de uitvoerder (geen plan-gaten, wel runtime-checks):**
- Slice 0/0.1-stap 5: bevestig de micro-kg-schaal tegen echte Lightspeed-data.
- Slice 4/4.2: bevestig dat `parseMaatwerkDims` `{ lengte, breedte }` retourneert (anders veldnamen in `dims` aanpassen).
- Slice 4/4.3: ruim ongebruikte imports op die TypeScript na de extractie meldt.
