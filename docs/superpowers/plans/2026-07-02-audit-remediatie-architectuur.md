# Audit-remediatie architectuur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De geverifieerde bugs en de goedkoopste structurele verdwaal-risico's uit de architectuur-audit van 2026-07-02 wegnemen, zonder gedragswijziging voor de gebruiker (behalve waar het gedrag zelf de bug is).

**Architecture:** Zeven fases, elk onafhankelijk shipbaar: (0) verse werkomgeving, (1) bugfixes, (2) dode-code-sweep, (3) docs-die-liegen corrigeren, (4) schema-snapshot als canonieke RPC-bron, (5) contract-tests + shim-herstel, (6) kleine consolidaties. Grote refactors (gate-registry, CLAUDE.md-ontvlechting) zijn bewust uitgesteld naar eigen plannen — zie de slotsectie.

**Tech Stack:** React/TypeScript/Vitest (frontend), Supabase (PostgreSQL-migraties via MCP `execute_sql`/`apply_migration`, edge functions Deno), supabase CLI (gelinkt, project-ref `wqzeevfobwauxkalagtn`).

**Besluiten grill-sessie 2026-07-02 (Miguel):**
- **Task 1.5 (B6):** akkoord in principe; HARDE STOP na het impact-rapport — `apply_migration` pas na expliciete go op het aantal flippende orders.
- **Task 2.5 (DROP dode RPC's):** akkoord, alle drie, mits de drievoudige verificatie-poort leeg is.
- **Task 0.2 (worktrees):** akkoord met automatisch opruimen van aantoonbaar gemergde worktrees; niet-gemergde/locked blijven staan.
- **Scope-knip:** gate-registry en CLAUDE.md-ontvlechting zijn bevestigd als aparte vervolgplannen.

**KRITIEKE CONTEXT voor de uitvoerder:**
1. Dit plan is geschreven vanuit een checkout die 217 commits achter `origin/main` liep. Alle code-fragmenten hieronder zijn geverifieerd tegen `origin/main` (2026-07-02, hoogste migratie 555) — maar regelnummers verschuiven; anker altijd op symboolnamen, niet op regelnummers.
2. Migratienummers: hoogste op main is `555`. Nieuwe migraties beginnen bij `556`. **Her-verifieer het nummer vlak vóór merge** (memory: parallelle sessies veroorzaken collisies).
3. Migraties draai je op de live DB via Supabase MCP `apply_migration` (niet `db push`). Elke migratie eerst in een **rolled-back transactie** testen via `execute_sql` (`BEGIN; ...; ROLLBACK;`) waar dat kan.
4. Frontend-check: `npm run typecheck` is op dit project `tsc -b`-gebaseerd; kale `tsc --noEmit -p .` is een no-op. Gebruik `npm run typecheck` en `npm run build` vóór push.
5. Testcommando frontend: `cd frontend && npx vitest run <pad>` voor gericht, `npx vitest run` voor alles. Edge: `cd supabase/functions && deno test --allow-read <pad>`.

---

## Fase 0 — Werkomgeving

### Task 0.1: Verse worktree van origin/main

**Files:** geen (git-operaties)

- [ ] **Step 1: Fetch + worktree aanmaken**

```bash
cd "/c/Users/migue/Documents/Karpi ERP"
git fetch origin
git worktree add .worktrees/audit-remediatie -b fix/audit-remediatie origin/main
```

Expected: worktree op `.worktrees/audit-remediatie`, branch `fix/audit-remediatie` op de stand van origin/main.

- [ ] **Step 2: Plan-bestand meenemen en committen**

```bash
cp "docs/superpowers/plans/2026-07-02-audit-remediatie-architectuur.md" ".worktrees/audit-remediatie/docs/superpowers/plans/"
cd .worktrees/audit-remediatie
git add docs/superpowers/plans/2026-07-02-audit-remediatie-architectuur.md
git commit -m "docs: plan audit-remediatie architectuur (2026-07-02)"
```

- [ ] **Step 3: Baseline-verificatie**

```bash
cd frontend && npm install && npm run typecheck && npx vitest run
```

Expected: typecheck groen, alle bestaande tests groen (baseline vóór enige wijziging). Zo niet: STOP en rapporteer — main zelf is dan al rood.

**Alle volgende taken werken in `.worktrees/audit-remediatie`.**

### Task 0.2: Stale gemergde worktrees opruimen

**Files:** geen (git-operaties)

- [ ] **Step 1: Inventariseer**

```bash
git worktree list
```

- [ ] **Step 2: Per worktree (behalve de hoofd-tree en `.worktrees/audit-remediatie`): alleen verwijderen als gemerged**

```bash
# per kandidaat-branch <B> met worktree-pad <P>:
git merge-base --is-ancestor <B> origin/main && echo GEMERGED || echo NIET-GEMERGED
# alleen bij GEMERGED:
git worktree remove <P> --force
git branch -d <B>
```

**NOOIT verwijderen:** niet-gemergde branches (o.a. `feat/snijplan-order-terugkoppel`, `feat/hst-lange-colli-pakkettypes`, `feat/shopify-polling-sync` — die dragen ongemerged werk), locked worktrees, de actieve working dir. Bij twijfel: laten staan en rapporteren.

- [ ] **Step 3: Prune + rapporteer**

```bash
git worktree prune && git worktree list
```

Rapporteer welke zijn opgeruimd en welke bewust blijven staan.

---

## Fase 1 — Bugfixes (elk een eigen commit)

### Task 1.1: B1 — BevestigingBadge kent `edi_bevestigd_op` niet

**Files:**
- Modify: `frontend/src/components/orders/orders-table.tsx` (functie `BevestigingBadge` + call-site)
- Test: `frontend/src/components/orders/__tests__/bevestiging-badge.test.tsx` (nieuw)

**Context:** het orderoverzicht toont "Geen OB" voor EDI-orders die via ORDRSP bevestigd zijn, omdat de lokale badge alleen `bevestigd_at` checkt. De gedeelde helper `isOrderBevestigd` (`frontend/src/lib/orders/bevestiging-kanaal.ts`) bestaat precies hiervoor en wordt in `order-header.tsx` al correct gebruikt.

- [ ] **Step 1: Verifieer dat de overzicht-query de benodigde velden levert**

```bash
grep -n "edi_bevestigd_op\|bron_systeem" frontend/src/lib/supabase/queries/orders.ts | head
```

Expected: beide kolommen komen voor in de select van `fetchOrders`/`orders_list` (ze voeden de "Te bevestigen"-chip al). Zo niet: voeg ze toe aan de select-kolomlijst.

- [ ] **Step 2: Schrijf de failing test**

Maak `frontend/src/components/orders/__tests__/bevestiging-badge.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BevestigingBadge } from '../orders-table'

describe('BevestigingBadge', () => {
  it('toont OB voor een EDI-order die via ORDRSP bevestigd is (edi_bevestigd_op gezet, bevestigd_at leeg)', () => {
    render(
      <BevestigingBadge
        order={{
          bron_systeem: 'edi',
          bevestigd_at: null,
          edi_bevestigd_op: '2026-06-30T10:00:00Z',
          status: 'Klaar voor picken',
        }}
      />,
    )
    expect(screen.getByText(/OB/)).toBeInTheDocument()
    expect(screen.queryByText(/Geen OB/)).toBeNull()
  })

  it('toont Geen OB voor een onbevestigde e-mail-order', () => {
    render(
      <BevestigingBadge
        order={{ bron_systeem: null, bevestigd_at: null, edi_bevestigd_op: null, status: 'Klaar voor picken' }}
      />,
    )
    expect(screen.getByText(/Geen OB/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test — verwacht FAIL**

```bash
cd frontend && npx vitest run src/components/orders/__tests__/bevestiging-badge.test.tsx
```

Expected: FAIL — `BevestigingBadge` wordt niet geëxporteerd / accepteert geen `order`-prop.

- [ ] **Step 4: Implementeer**

In `orders-table.tsx`: importeer bovenaan `import { isOrderBevestigd } from '@/lib/orders/bevestiging-kanaal'` en vervang de bestaande `BevestigingBadge`-functie (nu: `function BevestigingBadge({ bevestigd_at, status }: ...)`) door:

```tsx
export function BevestigingBadge({ order }: {
  order: {
    bron_systeem?: string | null
    bevestigd_at?: string | null
    edi_bevestigd_op?: string | null
    status: string
  }
}) {
  // Eén bevestigd-predicaat voor header én overzicht (bevestiging-kanaal.ts) —
  // een EDI-order is bevestigd via edi_bevestigd_op, niet bevestigd_at.
  if (isOrderBevestigd(order)) {
    const bevestigdOp = order.bron_systeem === 'edi'
      ? (order.edi_bevestigd_op ?? order.bevestigd_at)
      : order.bevestigd_at
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-[10px] font-medium"
        title={`Orderbevestiging verzonden op ${formatDate(bevestigdOp!)}`}
      >
        <CheckCircle size={10} />
        OB {formatDate(bevestigdOp!)}
      </span>
    )
  }
  if (FINALE_STATUSSEN.has(order.status)) return null
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 text-[10px] font-medium"
      title="Nog geen orderbevestiging verstuurd"
    >
      <Mail size={10} />
      Geen OB
    </span>
  )
}
```

Pas de call-site aan (nu `<BevestigingBadge bevestigd_at={order.bevestigd_at} status={order.status} />`):

```tsx
<BevestigingBadge order={order} />
```

- [ ] **Step 5: Run test — verwacht PASS + typecheck**

```bash
cd frontend && npx vitest run src/components/orders/__tests__/bevestiging-badge.test.tsx && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/orders/orders-table.tsx frontend/src/components/orders/__tests__/bevestiging-badge.test.tsx
git commit -m "fix(orders): BevestigingBadge gebruikt isOrderBevestigd — EDI-bevestiging (ORDRSP) toonde 'Geen OB'"
```

### Task 1.2: B2 — claim-status `'verzonden'` (mig 468) ontbreekt in de frontend-claims-laag

**Files:**
- Modify: `frontend/src/modules/reserveringen/queries/reserveringen.ts`

**Context:** mig 468 introduceerde claim-status `'verzonden'` zodat een al-verzonden regel in een `Deels verzonden`-order als gedekt blijft tellen. De frontend haalt claims op met `.eq('status', 'actief')` en telt dan te weinig dekking → valse "Wacht op nieuwe inkoop"-badge op order-detail. `order-regels-table.tsx` hoeft NIET te wijzigen: `totaalGeclaimd = claims.reduce(...)` klopt vanzelf zodra de verzonden claims meekomen.

- [ ] **Step 1: Inventariseer alle status-filters in het bestand**

```bash
grep -n "\.eq('status', 'actief')" frontend/src/modules/reserveringen/queries/reserveringen.ts
```

Expected: 3 hits — in `fetchClaimsVoorOrder`, `fetchClaimsVoorOrderRegel` en `fetchClaimsVoorIORegel`. Check ook repo-breed:

```bash
grep -rn "\.eq('status', 'actief')" frontend/src --include="*.ts" | grep -i "reserv\|claim"
```

- [ ] **Step 2: Wijzig type + de twee order-gerichte filters**

In `reserveringen.ts`:

```ts
// was: export type ClaimStatus = 'actief' | 'geleverd' | 'released'
export type ClaimStatus = 'actief' | 'verzonden' | 'geleverd' | 'released'
```

In `fetchClaimsVoorOrder` én `fetchClaimsVoorOrderRegel` (NIET in `fetchClaimsVoorIORegel` — de inkoop-view toont wat nog open staat):

```ts
// was: .eq('status', 'actief')
// mig 468: een claim van een al-verzonden deelzending telt als dekking —
// anders toont order-detail een vals 'Wacht op nieuwe inkoop' op
// Deels-verzonden-orders.
.in('status', ['actief', 'verzonden'])
```

- [ ] **Step 3: Typecheck + bestaande tests**

```bash
cd frontend && npm run typecheck && npx vitest run src/modules/reserveringen 2>/dev/null; npx vitest run src/components/orders
```

Expected: groen (er zijn geen query-laag-tests; typecheck vangt de type-uitbreiding).

- [ ] **Step 4: Live verificatie (read-only, via Supabase MCP `execute_sql`)**

```sql
-- Vind een Deels-verzonden-order met een 'verzonden'-claim:
SELECT o.order_nr, r.status, COUNT(*)
FROM order_reserveringen r
JOIN order_regels orr ON orr.id = r.order_regel_id
JOIN orders o ON o.id = orr.order_id
WHERE o.status = 'Deels verzonden' AND r.status = 'verzonden'
GROUP BY o.order_nr, r.status LIMIT 5;
```

Open één van die orders in de UI (lokaal draaiend) en controleer dat de "Wacht op nieuwe inkoop"-subrij verdwenen is voor het al-verzonden deel.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/reserveringen/queries/reserveringen.ts
git commit -m "fix(reserveringen): claim-status 'verzonden' (mig 468) telt mee als dekking — vals 'Wacht op nieuwe inkoop' op Deels-verzonden-orders"
```

### Task 1.3: B3 — VORMTOESLAG-companion raakt zijn maatwerk-parent kwijt bij order-splits

**Files:**
- Modify: `frontend/src/lib/orders/order-commit.ts` (gemengde-split-filter + IO-split-loop in `bouwOrderCommit`)
- Test: `frontend/src/lib/orders/__tests__/order-commit.test.ts` (of waar de bestaande `bouwOrderCommit`-tests staan — check met `git grep -l "bouwOrderCommit" frontend/src | grep test`)

**Context:** de companion-regel (artikelnr `VORMTOESLAG`, mig 465) heeft `is_maatwerk=false` en is via array-positie aan zijn maatwerk-parent gekoppeld ("direct ná de parent", zie `vorm-toeslag-regel.ts`). De gemengde split filtert puur op `is_maatwerk` → companion belandt op de standaard-suborder, parent op de maatwerk-suborder. De IO-split-loop stuurt de companion (geen `vrije_voorraad`) bovendien naar het IO-deel.

- [ ] **Step 1: Schrijf de failing tests**

Voeg toe aan het bestaande `bouwOrderCommit`-testbestand (gebruik de bestaande fixture-helpers uit `order-commit.fixtures.ts` — namen daar checken; hieronder de vorm):

```ts
import { isVormToeslagRegel } from '../vorm-toeslag-regel'

describe('VORMTOESLAG-companion volgt zijn maatwerk-parent (mig 465, array-positie-convention)', () => {
  it('gemengde split: companion op de maatwerk-suborder, direct ná de parent', () => {
    const regels = [
      maakMaatwerkRegel({ maatwerk_vorm_toeslag: 75 }),
      maakRegel({ artikelnr: 'VORMTOESLAG', is_maatwerk: false, is_pseudo: true, prijs: 75 }),
      maakVoorraadRegel({ artikelnr: '900000005', vrije_voorraad: 10 }),
    ]
    const plan = bouwOrderCommit(maakGemengdeSplitInput(regels))
    expect(plan.gesplitst).toBe(true)
    const [standaard, maatwerk] = plan.orders
    expect(standaard.regels.some(isVormToeslagRegel)).toBe(false)
    const parentIdx = maatwerk.regels.findIndex(r => r.is_maatwerk)
    expect(isVormToeslagRegel(maatwerk.regels[parentIdx + 1])).toBe(true)
  })

  it('IO-split: companion blijft bij het deel waar zijn parent landt, en wordt zelf nooit op dekking gesplitst', () => {
    const regels = [
      maakMaatwerkRegel({ maatwerk_vorm_toeslag: 75 }),
      maakRegel({ artikelnr: 'VORMTOESLAG', is_maatwerk: false, is_pseudo: true, prijs: 75 }),
      maakIoTekortRegel({ artikelnr: '900000006' }), // forceert de IO-split-tak
    ]
    const plan = bouwOrderCommit(maakIoSplitInput(regels))
    expect(plan.gesplitst).toBe(true)
    for (const order of plan.orders) {
      const companions = order.regels.filter(isVormToeslagRegel)
      for (const c of companions) {
        const i = order.regels.indexOf(c)
        expect(order.regels[i - 1]?.is_maatwerk).toBe(true)
      }
    }
    // companion precies één keer in het hele plan:
    const totaal = plan.orders.flatMap(o => o.regels).filter(isVormToeslagRegel)
    expect(totaal).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run — verwacht FAIL**

```bash
cd frontend && npx vitest run src/lib/orders/__tests__/order-commit.test.ts
```

Expected: beide nieuwe tests rood (companion op verkeerde suborder resp. in het IO-deel).

- [ ] **Step 3: Implementeer — gemengde split**

In `bouwOrderCommit`, vervang:

```ts
const standaardRegels = regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID && !r.is_maatwerk)
const maatwerkRegels = regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID && r.is_maatwerk)
```

door (importeer `isVormToeslagRegel` uit `./vorm-toeslag-regel`):

```ts
// VORMTOESLAG-companion (mig 465) is is_maatwerk=false maar hoort via de
// array-positie-convention direct ná zijn maatwerk-parent — bij de split
// volgt hij daarom de bucket van de regel vóór hem, niet zijn eigen vlag.
const overige = regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID)
const standaardRegels: OrderRegelFormData[] = []
const maatwerkRegels: OrderRegelFormData[] = []
for (let i = 0; i < overige.length; i++) {
  const r = overige[i]
  const naarMaatwerk = isVormToeslagRegel(r)
    ? overige[i - 1]?.is_maatwerk === true
    : r.is_maatwerk === true
  ;(naarMaatwerk ? maatwerkRegels : standaardRegels).push(r)
}
```

- [ ] **Step 4: Implementeer — IO-split-loop**

In dezelfde functie, in de `for (const r of regels)`-loop van de IO-split-tak: zet vóór de loop `let laatsteBucket: OrderRegelFormData[] | null = null`, verander de loop naar index-vorm en voeg direct na de SHIPPING-check toe:

```ts
if (isVormToeslagRegel(r)) {
  // Companion volgt zijn parent (maatwerk splitst nooit op IO-dekking) en
  // wordt zelf nooit door splitRegelOpDekking gehaald — een pseudo-regel
  // zonder vrije_voorraad zou anders een vals IO-deel krijgen.
  ;(laatsteBucket ?? directeRegels).push(r)
  continue
}
const { directeRegel, ioRegel } = splitRegelOpDekking(r, berekenRegelDekking(r))
if (directeRegel) directeRegels.push(directeRegel)
if (ioRegel) ioRegels.push(ioRegel)
laatsteBucket = ioRegel && !directeRegel ? ioRegels : directeRegels
```

- [ ] **Step 5: Run alle order-commit/split-tests — verwacht PASS, inclusief bestaande golden fixtures ongewijzigd**

```bash
cd frontend && npx vitest run src/lib/orders && npm run typecheck
```

Expected: groen. De bestaande fixtures pinnen het oude gedrag voor orders zónder companion — die mogen niet wijzigen.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/orders/order-commit.ts frontend/src/lib/orders/__tests__/order-commit.test.ts
git commit -m "fix(orders): VORMTOESLAG-companion volgt zijn maatwerk-parent bij gemengde/IO-split (mig 465 array-positie-convention)"
```

### Task 1.4: B5 — PO-prefill zet het regel-input-contract (`metProductVelden`) niet

**Files:**
- Modify: `frontend/src/lib/orders/po-prefill.ts` (`mapMatchNaarPrefill`)
- Modify: `frontend/src/pages/orders/order-create.tsx` (enige caller)
- Test: `frontend/src/lib/orders/po-prefill.test.ts` (bestaand)

**Context:** gedocumenteerd open gat (TODO in de code): PO-voorgevulde regels missen `vrije_voorraad`/`besteld_inkoop`/`is_pseudo`/`is_dropship` → `berekenRegelDekking` ziet vals IO-tekort (zelfde klasse als ORD-2026-0614). `mapMatchNaarPrefill` blijft puur; de caller levert de product-velden aan.

- [ ] **Step 1: Schrijf de failing test**

In `po-prefill.test.ts`:

```ts
it('past metProductVelden toe op zeker-gematchte regels wanneer productVelden meegegeven zijn', () => {
  const match = maakMatch({
    regels: [{ zeker: true, artikelnr: '900000005', aantal: 2, ruwe_omschrijving: 'Antislip', prijs: null, korting_pct: null }],
  })
  const productVelden = new Map([
    ['900000005', { vrije_voorraad: 12, besteld_inkoop: 0, is_pseudo: false, is_dropship: false, voorraad: 12 }],
  ])
  const { regels } = mapMatchNaarPrefill(match, productVelden)
  expect(regels[0].vrije_voorraad).toBe(12)
  expect(regels[0].is_pseudo).toBe(false)
})
```

(Gebruik de bestaande test-fixture-helper voor `match`; naam checken in het testbestand.)

- [ ] **Step 2: Run — verwacht FAIL** (`mapMatchNaarPrefill` accepteert geen tweede argument)

- [ ] **Step 3: Implementeer in po-prefill.ts**

Importeer het contract:

```ts
import { metProductVelden, type RegelProductVelden } from './order-hydratie'
```

Geef `mapMatchNaarPrefill` een tweede optionele parameter `productVelden?: Map<string, RegelProductVelden>`. In de regel-map, waar een zeker-gematchte regel gebouwd wordt (`if (r.zeker && r.artikelnr)`), wikkel het resultaat:

```ts
const velden = productVelden?.get(r.artikelnr)
return velden ? metProductVelden(regel, velden) : regel
```

Vervang het TODO-commentaarblok ("deze adapter zet GEEN vrije_voorraad...") door:

```ts
// Regel-input-contract (RegelProductVelden): de caller levert per gematcht
// artikelnr de producten-velden aan (fetchProductVeldenVoorArtikelnrs) en
// mapMatchNaarPrefill past metProductVelden toe — zelfde contract als
// Order-hydratie en addArticle. Zonder map (bv. in tests) blijft de regel kaal.
```

- [ ] **Step 4: Voeg de fetch-helper toe en sluit de caller aan**

Check eerst of er al een geschikte helper bestaat:

```bash
git grep -n "in('artikelnr'" frontend/src/lib/supabase/queries/producten.ts
```

Zo niet, voeg toe aan `frontend/src/lib/supabase/queries/producten.ts`:

```ts
import type { RegelProductVelden } from '@/lib/orders/order-hydratie'

/** Product-velden voor het regel-input-contract (PO-prefill, ORD-2026-0614-klasse). */
export async function fetchProductVeldenVoorArtikelnrs(
  artikelnrs: string[],
): Promise<Map<string, RegelProductVelden>> {
  if (artikelnrs.length === 0) return new Map()
  const { data, error } = await supabase
    .from('producten')
    .select('artikelnr, voorraad, vrije_voorraad, besteld_inkoop, is_pseudo, is_dropship')
    .in('artikelnr', artikelnrs)
  if (error) throw error
  return new Map((data ?? []).map(p => [p.artikelnr, p]))
}
```

In `order-create.tsx`, op de plek waar `mapMatchNaarPrefill(match)` wordt aangeroepen: haal eerst de velden op voor de zeker-gematchte artikelnrs en geef ze mee:

```ts
const artikelnrs = match.regels.filter(r => r.zeker && r.artikelnr).map(r => r.artikelnr!)
const productVelden = await fetchProductVeldenVoorArtikelnrs(artikelnrs)
const prefill = mapMatchNaarPrefill(match, productVelden)
```

(Als de call-site niet async is: wikkel in de bestaande async flow van de PO-import-handler — de match komt daar al uit een awaited RPC.)

- [ ] **Step 5: Run tests + typecheck — verwacht PASS**

```bash
cd frontend && npx vitest run src/lib/orders/po-prefill.test.ts && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/orders/po-prefill.ts frontend/src/lib/orders/po-prefill.test.ts frontend/src/lib/supabase/queries/producten.ts frontend/src/pages/orders/order-create.tsx
git commit -m "fix(orders): PO-prefill zet het regel-input-contract (metProductVelden) — vals IO-tekort op voorradige PO-regels (ORD-2026-0614-klasse)"
```

### Task 1.5: B6 — dekkingsgat in `herbereken_wacht_status` ⚠️ BESLISPUNT

**Files:**
- Create: `supabase/migrations/556_wacht_status_io_dekking.sql` (nummer her-verifiëren!)

**Context:** branch 2 van de status-ladder (`'Wacht op voorraad'` = "IO-claim bestaat, wacht op levering", mig 470-semantiek) checkt alleen het *bestaan* van een actieve IO-claim, niet of die het tekort *dekt*. Een half-gedekte regel toont daardoor nooit "Wacht op inkoop" (= er moet nog besteld worden) voor het ongedekte deel.

**⚠️ BESLUIT (grill-sessie 2026-07-02): akkoord in principe, maar HARDE STOP na Step 4.** De uitvoerder mag Step 1-4 (body ophalen, migratie schrijven, rolled-back testen, impact tellen) volledig uitvoeren, maar mag `apply_migration` (Step 5) pas draaien nadat Miguel het gerapporteerde aantal flippende orders expliciet heeft goedgekeurd. Zonder die go: migratiebestand wél committen met een `-- NIET TOEGEPAST, wacht op go`-kopregel en in het eindrapport melden.

- [ ] **Step 1: Haal de actuele live body op**

Via Supabase MCP `execute_sql`:

```sql
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'herbereken_wacht_status';
```

**Werk vanaf DEZE output** — niet vanaf een migratiebestand (de mig-428-les).

- [ ] **Step 2: Schrijf de migratie**

Vervang in de opgehaalde body de `v_heeft_io_claim`-berekening (nu een kale `EXISTS` op `bron='inkooporder_regel' AND status='actief'`) door een dekkings-check per regel: de som van actieve IO-claims moet, samen met voorraad-/verzonden-claims, `te_leveren` dekken. Concreet patroon (inpassen in de bestaande CTE/loop-structuur van de opgehaalde body):

```sql
-- was: EXISTS(... r.bron='inkooporder_regel' AND r.status='actief' ...)
-- nu: de IO-claim moet het resterende tekort ook daadwerkelijk dekken —
-- anders is de juiste status 'Wacht op inkoop' (mig 470: er moet nog
-- besteld worden), niet 'Wacht op voorraad'.
v_io_dekt := NOT EXISTS (
  SELECT 1
  FROM order_regels oreg
  WHERE oreg.order_id = p_order_id
    AND NOT is_admin_pseudo(oreg.artikelnr)
    AND oreg.te_leveren > COALESCE((
      SELECT SUM(r.aantal) FROM order_reserveringen r
      WHERE r.order_regel_id = oreg.id
        AND r.status IN ('actief', 'verzonden')
    ), 0)
    AND EXISTS (
      SELECT 1 FROM order_reserveringen r2
      WHERE r2.order_regel_id = oreg.id
        AND r2.bron = 'inkooporder_regel' AND r2.status = 'actief'
    )
);
```

De volledige functie-body + `COMMENT ON FUNCTION` met verwijzing naar dit plan. Sluit af met dezelfde `GRANT`s als de live versie.

- [ ] **Step 3: Test in een rolled-back transactie**

Via `execute_sql`: `BEGIN;` → migratie-body → roep `herbereken_wacht_status(<order_id>)` aan voor (a) een order met volledig dekkende IO-claim (verwacht: status ongewijzigd `Wacht op voorraad`), (b) een order met half-dekkende IO-claim (verwacht: `Wacht op inkoop`) → `ROLLBACK;`. Rapporteer beide uitkomsten.

- [ ] **Step 4: Impact-telling vóór apply**

```sql
-- Hoeveel live orders zouden van status wisselen?
-- (zelfde predicaat als in de functie, geteld over orders in 'Wacht op voorraad')
```

Rapporteer het aantal aan Miguel vóór `apply_migration`.

- [ ] **Step 5: Apply + golden-fixtures check**

Na apply: draai de bestaande derive-status contract-test (`cd supabase/functions && deno test --allow-read _shared/order-lifecycle/`). De TS-spiegel `deriveWachtStatus` toetst de ladder-volgorde, niet de SQL-dekkingsberekening — controleer of `derive-status.ts` een spiegel-update nodig heeft (zo ja: zelfde wijziging + golden fixtures bijwerken in hetzelfde commit).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/556_wacht_status_io_dekking.sql
git commit -m "fix(allocatie): 'Wacht op voorraad' vereist dat de IO-claim het tekort dekt (mig 470-semantiek)"
```

---

## Fase 2 — Dode-code-sweep (elk een eigen commit; elke taak begint met een grep-bewijs)

### Task 2.1: `assignRolToSnijplan` + `useAssignRol` verwijderen (VERR130-risico)

**Files:**
- Modify: `frontend/src/modules/snijplanning/queries/snijplanning-mutations.ts` (verwijder `assignRolToSnijplan`)
- Modify: `frontend/src/modules/snijplanning/hooks/use-snijplanning.ts` (verwijder `useAssignRol`, regel ~318)
- Modify: `frontend/src/modules/snijplanning/index.ts` (verwijder de `useAssignRol`-export, regel ~45)

- [ ] **Step 1: Bewijs dat het dood is**

```bash
git grep -rn "useAssignRol\|assignRolToSnijplan" frontend/src | grep -v "use-snijplanning\|snijplanning-mutations\|modules/snijplanning/index"
```

Expected: 0 resultaten. Bij >0: STOP, rapporteer de caller.

- [ ] **Step 2: Verwijder de drie plekken.** Laat op de plek van `assignRolToSnijplan` één regel commentaar achter:

```ts
// assignRolToSnijplan is verwijderd (audit 2026-07-02): kale rol_id-UPDATE
// zonder positie-herberekening reproduceert het VERR130-overlap-incident.
// Rol toewijzen = RPC wijs_snijplan_handmatig_toe (mig 453) via de edge
// function wijs-snijplan-handmatig-toe.
```

- [ ] **Step 3: Typecheck + snijplanning-tests**

```bash
cd frontend && npm run typecheck && npx vitest run src/modules/snijplanning
```

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src/modules/snijplanning
git commit -m "chore(snijplanning): verwijder dode assignRolToSnijplan/useAssignRol (VERR130-incident-risico; live pad = wijs_snijplan_handmatig_toe)"
```

### Task 2.2: Dode magazijn-hook `useStartPickronde` + query-fn verwijderen

**Files:**
- Modify: `frontend/src/modules/magazijn/hooks/use-pickronde.ts` (verwijder `useStartPickronde`)
- Modify: `frontend/src/modules/magazijn/index.ts` (verwijder de export, regel ~21)
- Modify: `frontend/src/modules/magazijn/queries/pickronde.ts` (verwijder `startPickronde`)
- Modify: `frontend/src/modules/magazijn/__tests__/pickronde.contract.test.ts` (verwijder het `describe('startPickronde')`-blok)

**Context:** het live pad is `useStartPickrondes` (meervoud, `modules/logistiek/hooks/use-zendingen.ts` → RPC `start_pickronden`). De enkelvoud-hook is dood en bevat bovendien de no-op query-key `['zendingen']` (audit-bug B4 — verdwijnt mee).

- [ ] **Step 1: Bewijs dat het dood is**

```bash
git grep -rn "useStartPickronde\b" frontend/src | grep -v "use-pickronde\|magazijn/index"
git grep -rn "\bstartPickronde\b" frontend/src | grep -v "use-pickronde\|queries/pickronde\|contract.test"
```

Expected: beide 0 resultaten (let op de `\b` — `useStartPickrondes` mag NIET matchen). Bij >0: STOP.

- [ ] **Step 2: Verwijder de vier plekken; run tests + typecheck**

```bash
cd frontend && npm run typecheck && npx vitest run src/modules/magazijn
```

- [ ] **Step 3: Commit**

```bash
git add -A frontend/src/modules/magazijn
git commit -m "chore(magazijn): verwijder dode useStartPickronde/startPickronde (live pad = useStartPickrondes → start_pickronden)"
```

### Task 2.3: Dode `packAcrossRolls`-export uit `ffdh-packing.ts`

**Files:**
- Modify: `supabase/functions/_shared/ffdh-packing.ts` (verwijder de eigen `packAcrossRolls` + alleen-daardoor-gebruikte helpers)
- Modify: bijbehorende testfile (verwijder de `packAcrossRolls`-cases; check `supabase/functions/_shared/ffdh-packing.test.ts` of `__tests__/`)

**Context:** alle drie productie-callers (`auto-plan-groep`, `optimaliseer-snijplan`, `schat-benodigde-lengte`) importeren `packAcrossRolls` uit `guillotine-packing.ts`. De gelijknamige export in `ffdh-packing.ts` heeft 0 callers. De losse bouwstenen (`tryPlacePiece`, `reconstructShelves`, `sortPieces`) blijven WÉL — die gebruikt `wijs-snijplan-handmatig-toe` en `guillotine-packing` zelf.

- [ ] **Step 1: Bewijs**

```bash
git grep -rn "packAcrossRolls" supabase/functions frontend/src | grep -v "guillotine-packing"
```

Expected: alleen hits in `ffdh-packing.ts` zelf + zijn eigen test. Bij andere hits: STOP.

- [ ] **Step 2: Verwijder de functie + de test-cases ervoor.** Laat een verwijzend commentaar achter:

```ts
// packAcrossRolls leeft in guillotine-packing.ts (draait per rol zowel
// guillotine als FFDH en kiest de beste). De FFDH-bouwstenen hieronder
// (tryPlacePiece/reconstructShelves/sortPieces) blijven de gedeelde basis.
```

- [ ] **Step 3: Deno-tests draaien**

```bash
cd supabase/functions && deno test --allow-read _shared/
```

Expected: groen. Geen redeploy nodig (de live functies importeerden dit pad al niet).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared
git commit -m "chore(packing): verwijder dode packAcrossRolls uit ffdh-packing (live orchestrator = guillotine-packing)"
```

### Task 2.4: Dode shim `frontend/src/lib/orders/vervoerder-eisen.ts`

- [ ] **Step 1: Bewijs**

```bash
git grep -rn "orders/vervoerder-eisen" frontend/src
```

Expected: 0 hits buiten het bestand zelf. Let op: `@/lib/logistiek/...`-shims zijn ANDERE bestanden en blijven staan.

- [ ] **Step 2: Verwijder het bestand; typecheck; commit**

```bash
cd frontend && npm run typecheck
git rm frontend/src/lib/orders/vervoerder-eisen.ts
git commit -m "chore(orders): verwijder ongebruikte vervoerder-eisen-shim (verkeerd domein, 0 consumers)"
```

### Task 2.5: SQL — dode RPC's droppen ⚠️ met verificatie-poort

**Files:**
- Create: `supabase/migrations/557_drop_dode_rpcs.sql` (nummer her-verifiëren)

**Kandidaten:** `genereer_factuur_voor_bundel` (mig 453-commentaar: "bevestigd dode code"), `start_pickronden_voor_order`, `start_pickronden_bundel` (CLAUDE.md mig 477: "dode code vanuit de frontend").

- [ ] **Step 1: Verificatie-queries (via MCP `execute_sql`) — ALLE drie moeten leeg zijn**

```sql
-- 1. Geen andere SQL-functie/trigger roept ze aan:
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc ILIKE ANY (ARRAY['%start_pickronden_voor_order%','%start_pickronden_bundel%','%genereer_factuur_voor_bundel%'])
  AND p.proname NOT IN ('start_pickronden_voor_order','start_pickronden_bundel','genereer_factuur_voor_bundel');
-- 2. Geen cron-job:
SELECT jobname, command FROM cron.job
WHERE command ILIKE ANY (ARRAY['%start_pickronden_voor_order%','%start_pickronden_bundel%','%genereer_factuur_voor_bundel%']);
```

```bash
# 3. Geen edge-function-caller:
git grep -rn "start_pickronden_voor_order\|start_pickronden_bundel\|genereer_factuur_voor_bundel" supabase/functions frontend/src
```

Bij ENIGE hit: die functie uit de drop-lijst halen en rapporteren.

- [ ] **Step 2: Migratie schrijven**

```sql
-- Migratie 557: drop dode RPC's (architectuur-audit 2026-07-02).
-- Verificatie vooraf: geen SQL-callers (pg_proc.prosrc-scan), geen cron-jobs,
-- geen edge-function/frontend-callers. Zie docs/superpowers/plans/
-- 2026-07-02-audit-remediatie-architectuur.md Task 2.5.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('start_pickronden_voor_order','start_pickronden_bundel','genereer_factuur_voor_bundel')
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;
```

- [ ] **Step 3: Rolled-back proef, dan apply**

`BEGIN;` + migratie + `SELECT proname FROM pg_proc ... IN (...)` (verwacht 0 rijen) + `ROLLBACK;` — daarna `apply_migration`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/557_drop_dode_rpcs.sql
git commit -m "chore(db): drop dode RPC's start_pickronden_voor_order/_bundel en genereer_factuur_voor_bundel (audit 2026-07-02)"
```

---

## Fase 3 — Docs die liegen corrigeren

### Task 3.1: CONTEXT.md — twee onwaarheden

**Files:** Modify: `CONTEXT.md`

- [ ] **Step 1:** In de sectie **Order-aandacht-gate**: voeg direct na de kop toe:

```markdown
**Status: ONTWERP — nog niet gebouwd (audit 2026-07-02).** De registry
(`OrderAandachtGate[]`)/`AandachtBannerShell` hieronder beschrijft de
doelarchitectuur; de huidige code heeft de vijf gates nog als losse takken in
`fetchOrders`/`fetchStatusCounts` + vier losse banner-componenten. Zie het
uitgestelde plan in docs/superpowers/plans/2026-07-02-audit-remediatie-architectuur.md.
```

- [ ] **Step 2:** In de sectie **Verzend-wachtrij**: vervang de bijzin "— niet drie kopieën (de oude `hst_transportorders`/`verhoek_transportorders`/`rhenus_transportorders` blijven t/m de contract-drop nog als rollback-vangnet staan)" door:

```markdown
— niet drie kopieën (de oude `hst_transportorders`/`verhoek_transportorders`/
`rhenus_transportorders` zijn per mig 427 definitief gedropt; de "NIET
DRAAIEN"-banner in dat migratiebestand is historie, de drop is uitgevoerd)
```

- [ ] **Step 3: Commit**

```bash
git add CONTEXT.md
git commit -m "docs(context): corrigeer twee onwaarheden — gate-registry is ontwerp, transportorder-tabellen zijn gedropt"
```

### Task 3.2: order-lifecycle.md — ontbrekende derde cascade-listener + trigger-landschap

**Files:** Modify: `docs/order-lifecycle.md`

- [ ] **Step 1:** Voeg in de §5-listener-tabel de ontbrekende rij toe:

```markdown
| `trg_order_events_zending_release` | mig 480 | `geannuleerd` | Verwijdert per zending met status 'Gepland'/'Picken' de regels/colli van de geannuleerde order; bundel-bewust (zending blijft bestaan als een andere order 'm nog draagt, met herberekende aantallen). |
```

- [ ] **Step 2:** Voeg een nieuwe sectie toe (na de listener-tabel):

```markdown
## Trigger-landschap op order_regels

Een `UPDATE order_regels` kan tot vier triggers laten vuren (AFTER-triggers
vuren alfabetisch op triggernaam — let op: `trg_order_regels_…` sorteert vóór
`trg_orderregel_…`):

| Trigger | Mig | Vuurt op | Effect |
|---|---|---|---|
| `trg_lock_orderregel_vervoerder` | 219 | BEFORE UPDATE OF vervoerder_code | Blokkeert de update zelf (guard) |
| `trg_auto_sync_snijplan_maten` | 110/323 | AFTER UPDATE OF maatwerk_*_cm, is_maatwerk | Snijplan-maten sync; stille no-op + WARNING als het snijplan al een rol heeft |
| `trg_order_regels_prijs_gate` | 396 | AFTER I/D/U OF prijs, korting_pct, artikelnr | Zet/wist orders.prijs_ontbreekt_sinds |
| `trg_orderregel_herallocateer` | 146 | AFTER INSERT/UPDATE/DELETE (élke kolom) | herallocateer_orderregel → claims + herwaardeer_order_status |
```

- [ ] **Step 3:** Verifieer de tabel-inhoud tegen de live DB (MCP):

```sql
SELECT tgname, pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname = 'order_regels' AND NOT t.tgisinternal ORDER BY tgname;
```

Pas de tabel aan op wat er werkelijk staat (er kunnen sinds mig 484 triggers bijgekomen zijn).

- [ ] **Step 4: Commit**

```bash
git add docs/order-lifecycle.md
git commit -m "docs(order-lifecycle): derde annulerings-listener (mig 480) + trigger-landschap order_regels"
```

### Task 3.3: ADR-0031-addendum + `sftp-client.ts`-header (Verhoek-relay)

**Files:**
- Modify: `docs/adr/0031-verhoek-xml-sftp-adapter.md`
- Modify: `supabase/functions/_shared/sftp-client.ts` (header-commentaar)

- [ ] **Step 1:** Voeg onderaan ADR-0031 toe:

```markdown
## Addendum (2026-07-02): Vercel Node-relay i.p.v. directe SFTP

Deno-edge ondersteunt het door Verhoek vereiste aes256-ctr-cipher niet.
Het transport loopt daarom via een Vercel serverless function
(`frontend/api/verhoek-sftp.ts`, Node-runtime): `verhoek-send` (edge) →
HTTPS-relay (`VERHOEK_RELAY_URL`/`VERHOEK_RELAY_TOKEN` +
`VERCEL_PROTECTION_BYPASS`) → SFTP. `_shared/sftp-client.ts` wordt door
Verhoek NIET meer gebruikt (alleen nog Rhenus). Debugging van een
Verhoek-storing = Vercel-function-logs, niet edge-logs.
```

- [ ] **Step 2:** Corrigeer de eerste regel van `sftp-client.ts`: vervang "(verhoek-send, rhenus-send)" door "(rhenus-send; verhoek-send gebruikt sinds de relay-cutover `relay-client.ts` → `frontend/api/verhoek-sftp.ts`, zie ADR-0031-addendum)".

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0031-verhoek-xml-sftp-adapter.md supabase/functions/_shared/sftp-client.ts
git commit -m "docs(adr-0031): addendum Verhoek Vercel-relay; sftp-client-header klopte niet meer"
```

### Task 3.4: Deploy-fan-out-manifest voor `_shared`

**Files:** Create: `supabase/functions/DEPLOY.md`

- [ ] **Step 1:** Maak het bestand:

```markdown
# Deploy-fan-out: wie moet mee bij een _shared-wijziging?

Edge functions bundelen `_shared/` bij deploy. Wijzig je een gedeelde module,
herdeploy dan ÁLLE functies die hem importeren — anders draait een deel op de
oude versie (precies de divergentie die ADR-0036 code-side elimineerde).

Vind de consumers altijd vers met:

    git grep -l "_shared/<module>" supabase/functions --include=index.ts

Vaste fan-outs (2026-07-02 — her-verifieer met bovenstaande grep):

| Module | Herdeployen |
|---|---|
| `_shared/facturatie/*`, `_shared/btw.ts` | factuur-verzenden, bouw-factuur-edi, factuur-pdf, stuur-orderbevestiging |
| `_shared/pakbon/*` | factuur-verzenden (+ frontend leest via shims — Vercel deployt zelf) |
| `_shared/vervoerders/*`, `_shared/verzend-orchestrator.ts` | hst-send, rhenus-send, verhoek-send |
| `_shared/order-lifecycle/*` | alle functies die order-status schrijven (grep!) |
| `_shared/werkagenda.ts`, `_shared/snij-haalbaarheid.ts` | check-levertijd, auto-plan-groep |

Deploy-commando per functie:
`supabase functions deploy <naam> --project-ref wqzeevfobwauxkalagtn`
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/DEPLOY.md
git commit -m "docs(functions): deploy-fan-out-manifest voor _shared-wijzigingen"
```

---

## Fase 4 — Schema-snapshot als canonieke RPC-bron

### Task 4.1: Dump-script + eerste snapshot

**Files:**
- Create: `scripts/dump-schema.ps1`
- Create: `supabase/schema/schema.sql` (gegenereerd)

- [ ] **Step 1: Script**

```powershell
# scripts/dump-schema.ps1
# Dumpt het live public-schema (functies, views, tabellen, triggers) naar
# supabase/schema/schema.sql — de canonieke "welke body is nú live"-bron.
# Draaien na elke toegepaste migratie; het resultaat mee-committen.
# Achtergrond: audit 2026-07-02 — de mig-428-BTW-regressie ontstond doordat
# een oude migratie-body als "actueel" werd hergebruikt.
supabase db dump --linked --schema public -f supabase/schema/schema.sql
if ($LASTEXITCODE -ne 0) { Write-Error "supabase db dump faalde (Docker nodig?)"; exit 1 }
Write-Host "OK: supabase/schema/schema.sql ververst — commit dit mee."
```

- [ ] **Step 2: Draai het script**

```powershell
powershell -File scripts/dump-schema.ps1
```

Expected: `supabase/schema/schema.sql` bevat o.a. `CREATE OR REPLACE FUNCTION public.genereer_zending_colli` en `herallocateer_orderregel`. Controleer:

```bash
grep -c "CREATE OR REPLACE FUNCTION\|CREATE FUNCTION" supabase/schema/schema.sql
```

Expected: ruim >100 functies.

**Fallback als `supabase db dump` faalt (bv. Docker ontbreekt):** genereer de functie-dump via Supabase MCP `execute_sql` en schrijf het resultaat met de Write-tool naar `supabase/schema/functies.sql`:

```sql
SELECT string_agg(pg_get_functiondef(p.oid), E'\n\n' ORDER BY p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f';
```

plus views:

```sql
SELECT string_agg(format('CREATE OR REPLACE VIEW %I AS%s%s;', viewname, E'\n', definition), E'\n\n' ORDER BY viewname)
FROM pg_views WHERE schemaname = 'public';
```

(Bij te grote output: pagineer per beginletter van `proname`.) Documenteer in het script-commentaar welke route gebruikt is.

- [ ] **Step 3: Commit**

```bash
git add scripts/dump-schema.ps1 supabase/schema/
git commit -m "feat(db): schema-snapshot als canonieke bron voor live functie-bodies (audit: mig-428-klasse voorkomen)"
```

### Task 4.2: order-lifecycle.md §3.3 vervangen door de snapshot-verwijzing

**Files:** Modify: `docs/order-lifecycle.md` (§3.3)

- [ ] **Step 1:** Vervang de volledige RPC→migratie-tabel in §3.3 door:

```markdown
### 3.3 Welke functie-body is actueel?

**Kijk NOOIT in `supabase/migrations/` voor de actuele body van een functie**
— dezelfde functie is daar tot 16× herdefinieerd en de bestandsnummers lopen
niet 1-op-1 met de toepassingsvolgorde (hernummeringen bij merges). De
canonieke bron is de gegenereerde snapshot:

    supabase/schema/schema.sql   (ververs met scripts/dump-schema.ps1)

Migratiebestanden zijn write-once-geschiedenis (het "waarom"); de snapshot is
de actuele staat (het "wat"). Wie een functie wijzigt: nieuwe migratie
schrijven **vanaf de snapshot-body**, applyen, snapshot verversen, beide
committen. (De oude handmatige tabel hier was zelf verouderd voor 7 van de
kern-RPC's — audit 2026-07-02.)
```

- [ ] **Step 2: Commit**

```bash
git add docs/order-lifecycle.md
git commit -m "docs(order-lifecycle): §3.3 wijst naar de schema-snapshot i.p.v. een handmatige (verouderde) migratie-index"
```

---

## Fase 5 — Contract-tests + shim-herstel

### Task 5.1: BTW golden-fixture-contract (SQL ↔ TS)

**Files:**
- Create: `frontend/src/lib/orders/__tests__/golden/btw-regeling.golden.json`
- Create: `frontend/src/lib/orders/__tests__/btw-regeling.contract.test.ts`
- Create: `supabase/migrations/558_btw_regeling_contract.sql` (nummer her-verifiëren)

- [ ] **Step 1: Vind of maak de frontend-toegang tot `bepaalBtwRegeling`**

```bash
git grep -rn "bepaalBtwRegeling" frontend/src | head -5
```

Bestaat er een shim (memory: `@/lib/orders/btw-shim`)? Zo niet, maak `frontend/src/lib/orders/btw-shim.ts`:

```ts
// Re-export-shim (ADR-0033): BTW-logica leeft éénmalig in _shared/btw.ts.
export * from '../../../../supabase/functions/_shared/btw'
```

- [ ] **Step 2: Lees de staart van `_shared/btw.ts`** (de `export_buiten_eu`-tak) en noteer de exacte `effectiefPct`/`controleNodig`/`controleReden`-waarden voor de export-case — de fixtures hieronder gaan uit van `effectiefPct: 0, controleNodig: true`; corrigeer indien anders.

- [ ] **Step 3: Golden fixtures**

`btw-regeling.golden.json`:

```json
{
  "_comment": "SQL bepaal_btw_regeling (mig 455) == TS bepaalBtwRegeling (_shared/btw.ts). Wijzig je één kant: golden bijwerken + nieuwe *_btw_regeling_contract*.sql die de assert opnieuw draait.",
  "cases": [
    { "naam": "leeg land = nl_binnenland (62% legacy)", "input": { "aflLandIso2": null, "debiteurLandIso2": null, "afhalen": false, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "nl_binnenland", "effectiefPct": 21, "controleNodig": false } },
    { "naam": "NL expliciet", "input": { "aflLandIso2": "NL", "debiteurLandIso2": "NL", "afhalen": false, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "nl_binnenland", "effectiefPct": 21, "controleNodig": false } },
    { "naam": "DE verlegd met btw-nr = ICL 0%", "input": { "aflLandIso2": "DE", "debiteurLandIso2": "DE", "afhalen": false, "verlegdVlag": true, "btwNummer": "DE123456789", "btwPercentage": 21 }, "verwacht": { "regeling": "eu_b2b_icl", "effectiefPct": 0, "controleNodig": false } },
    { "naam": "DE verlegd zonder btw-nr = ICL advisory", "input": { "aflLandIso2": "DE", "debiteurLandIso2": "DE", "afhalen": false, "verlegdVlag": true, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "eu_b2b_icl", "effectiefPct": 0, "controleNodig": true } },
    { "naam": "DE zonder verlegd-vlag = afwijking (hard block)", "input": { "aflLandIso2": "DE", "debiteurLandIso2": "DE", "afhalen": false, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "eu_b2b_binnenland_afwijking", "effectiefPct": 21, "controleNodig": true } },
    { "naam": "US = export buiten EU", "input": { "aflLandIso2": "US", "debiteurLandIso2": "US", "afhalen": false, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "export_buiten_eu", "effectiefPct": 0, "controleNodig": true } },
    { "naam": "GB = non-EU (Brexit)", "input": { "aflLandIso2": "GB", "debiteurLandIso2": "GB", "afhalen": false, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "export_buiten_eu", "effectiefPct": 0, "controleNodig": true } },
    { "naam": "afhalen: debiteurland wint van afl_land", "input": { "aflLandIso2": "BE", "debiteurLandIso2": "NL", "afhalen": true, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "nl_binnenland", "effectiefPct": 21, "controleNodig": false } },
    { "naam": "afl leeg, debiteur DE verlegd = ICL via fallback", "input": { "aflLandIso2": null, "debiteurLandIso2": "DE", "afhalen": false, "verlegdVlag": true, "btwNummer": "DE999999999", "btwPercentage": 21 }, "verwacht": { "regeling": "eu_b2b_icl", "effectiefPct": 0, "controleNodig": false } },
    { "naam": "verlegd wint van pct (effectief_btw_pct)", "input": { "aflLandIso2": "AT", "debiteurLandIso2": "AT", "afhalen": false, "verlegdVlag": true, "btwNummer": "ATU12345678", "btwPercentage": 9 }, "verwacht": { "regeling": "eu_b2b_icl", "effectiefPct": 0, "controleNodig": false } }
  ]
}
```

- [ ] **Step 4: TS-contracttest**

`btw-regeling.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import golden from './golden/btw-regeling.golden.json'
import { bepaalBtwRegeling } from '../btw-shim'

describe('btw-regeling golden contract (TS-kant)', () => {
  for (const c of golden.cases) {
    it(c.naam, () => {
      const r = bepaalBtwRegeling(c.input)
      expect(r.regeling).toBe(c.verwacht.regeling)
      expect(r.effectiefPct).toBe(c.verwacht.effectiefPct)
      expect(r.controleNodig).toBe(c.verwacht.controleNodig)
    })
  }
})
```

Run: `cd frontend && npx vitest run src/lib/orders/__tests__/btw-regeling.contract.test.ts` — bij een rode case: eerst vaststellen of de fixture of de verwachting fout is (TS-gedrag is hier de referentie bij het schrijven; een échte SQL↔TS-mismatch is een bevinding — rapporteer).

- [ ] **Step 5: SQL-assert-migratie**

Haal eerst de exacte signatuur op: `SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='bepaal_btw_regeling';` — en pas de parameter-volgorde hieronder daarop aan. `558_btw_regeling_contract.sql` (patroon = mig 385):

```sql
-- Migratie 558: btw-regeling-contract — SQL == TS via golden fixtures.
-- Conventie: wie bepaal_btw_regeling/effectief_btw_pct of de TS-spiegel
-- (_shared/btw.ts) wijzigt: golden bijwerken + nieuwe *_btw_regeling_contract*.sql.
CREATE OR REPLACE FUNCTION assert_btw_regeling_contract(fixtures JSONB)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c JSONB; r RECORD;
BEGIN
  FOR c IN SELECT jsonb_array_elements(fixtures->'cases') LOOP
    SELECT * INTO r FROM bepaal_btw_regeling(
      c->'input'->>'aflLandIso2',
      c->'input'->>'debiteurLandIso2',
      COALESCE((c->'input'->>'afhalen')::boolean, false),
      COALESCE((c->'input'->>'verlegdVlag')::boolean, false),
      c->'input'->>'btwNummer',
      (c->'input'->>'btwPercentage')::numeric
    );
    IF r.regeling::text IS DISTINCT FROM c->'verwacht'->>'regeling'
       OR r.effectief_pct IS DISTINCT FROM (c->'verwacht'->>'effectiefPct')::numeric
       OR r.controle_nodig IS DISTINCT FROM (c->'verwacht'->>'controleNodig')::boolean THEN
      RAISE EXCEPTION 'btw-contract-mismatch case %: SQL=(%,%,%) verwacht=(%)',
        c->>'naam', r.regeling, r.effectief_pct, r.controle_nodig, c->'verwacht';
    END IF;
  END LOOP;
END $$;

SELECT assert_btw_regeling_contract($fixtures$
<-- LETTERLIJKE kopie van btw-regeling.golden.json -->
$fixtures$::jsonb);
```

(Kolomnamen `regeling`/`effectief_pct`/`controle_nodig` aanpassen aan wat de functie werkelijk returnt — staat in de opgehaalde definitie.) Test rolled-back, apply, snapshot verversen (Task 4.1-script).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/orders/__tests__/golden/btw-regeling.golden.json frontend/src/lib/orders/__tests__/btw-regeling.contract.test.ts frontend/src/lib/orders/btw-shim.ts supabase/migrations/558_btw_regeling_contract.sql supabase/schema/
git commit -m "test(btw): golden-fixture-contract SQL==TS voor bepaal_btw_regeling (mig-428-regressieklasse)"
```

### Task 5.2: Verzendweek golden-fixture-contract (SQL ↔ TS)

**Files:**
- Create: `frontend/src/lib/orders/__tests__/golden/verzendweek.golden.json`
- Create: `frontend/src/lib/orders/__tests__/verzendweek.contract.test.ts`
- Create: `supabase/migrations/559_verzendweek_contract.sql` (nummer her-verifiëren)

- [ ] **Step 1: Golden fixtures** (ISO-week-randgevallen; SQL-formaat `YYYY-Www` = mig 228, TS-kant `verzendWeekSleutel`):

```json
{
  "_comment": "SQL verzendweek_voor_datum (mig 228) == TS verzendWeekSleutel (lib/orders/verzendweek.ts).",
  "cases": [
    { "datum": "2026-07-02", "verwacht": "2026-W27" },
    { "datum": "2026-01-01", "verwacht": "2026-W01" },
    { "datum": "2025-12-29", "verwacht": "2026-W01" },
    { "datum": "2026-12-31", "verwacht": "2026-W53" },
    { "datum": "2027-01-01", "verwacht": "2026-W53" },
    { "datum": "2027-01-04", "verwacht": "2027-W01" },
    { "datum": "2026-06-28", "verwacht": "2026-W26" },
    { "datum": "2026-06-29", "verwacht": "2026-W27" }
  ]
}
```

- [ ] **Step 2: TS-test**

```ts
import { describe, expect, it } from 'vitest'
import golden from './golden/verzendweek.golden.json'
import { verzendWeekSleutel } from '../verzendweek'

describe('verzendweek golden contract (TS-kant)', () => {
  for (const c of golden.cases) {
    it(`${c.datum} → ${c.verwacht}`, () => {
      expect(verzendWeekSleutel(c.datum)).toBe(c.verwacht)
    })
  }
})
```

Run + groen (dit zijn wiskundige ISO-week-feiten; een rode case = fixture-rekenfout, narekenen).

- [ ] **Step 3: SQL-assert-migratie** `559_verzendweek_contract.sql`:

```sql
CREATE OR REPLACE FUNCTION assert_verzendweek_contract(fixtures JSONB)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c JSONB; v TEXT;
BEGIN
  FOR c IN SELECT jsonb_array_elements(fixtures->'cases') LOOP
    v := verzendweek_voor_datum((c->>'datum')::date);
    IF v IS DISTINCT FROM c->>'verwacht' THEN
      RAISE EXCEPTION 'verzendweek-contract-mismatch %: SQL=% verwacht=%',
        c->>'datum', v, c->>'verwacht';
    END IF;
  END LOOP;
END $$;

SELECT assert_verzendweek_contract($fixtures$
<-- LETTERLIJKE kopie van verzendweek.golden.json -->
$fixtures$::jsonb);
```

Rolled-back test → apply → snapshot verversen.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/orders/__tests__/golden/verzendweek.golden.json frontend/src/lib/orders/__tests__/verzendweek.contract.test.ts supabase/migrations/559_verzendweek_contract.sql supabase/schema/
git commit -m "test(verzendweek): golden-fixture-contract SQL==TS voor verzendweek_voor_datum"
```

### Task 5.3: `compute-reststukken` frontend-kopie → echte shim

**Files:**
- Modify: `frontend/src/modules/snijplanning/lib/compute-reststukken.ts` (321 regels → shim)
- Test: bestaand `frontend/src/modules/snijplanning/lib/__tests__/compute-reststukken.test.ts`

- [ ] **Step 1: Vergelijk de publieke API's**

```bash
git grep -n "^export" frontend/src/modules/snijplanning/lib/compute-reststukken.ts supabase/functions/_shared/compute-reststukken.ts
```

Noteer verschillen (frontend gebruikt types uit `@/lib/types/productie`, edge definieert `ReststukRect` zelf + gebruikt `Placement` uit `ffdh-packing`).

- [ ] **Step 2: Vervang de frontend-implementatie door een shim**

```ts
// Re-export-shim (ADR-0033) — de implementatie leeft éénmalig in _shared.
// Was tot 2026-07-02 een handmatig gesynchroniseerde 321-regel-kopie
// (audit: gedeclareerd als "logica identiek", d.w.z. door mensen, niet door
// de compiler — precies het SSCC-incident-patroon dat ADR-0033 verbiedt).
export * from '../../../../../supabase/functions/_shared/compute-reststukken'
```

Als consumers types uit dit pad importeren die de edge-versie anders noemt: voeg expliciete type-aliassen toe aan de shim (bv. `export type { ReststukRect } from '...'`) tot `npm run typecheck` groen is. **Geen logica in de shim.**

- [ ] **Step 3: Run de bestaande frontend-test tegen de _shared-implementatie**

```bash
cd frontend && npx vitest run src/modules/snijplanning/lib/__tests__/compute-reststukken.test.ts && npm run typecheck
```

Expected: groen — de test karakteriseert nu de gedeelde implementatie. Bij een rode case: de twee kopieën waren al gedivergeerd — STOP en rapporteer welk gedrag verschilt (dat is dan een échte bevinding, niet fixen zonder overleg).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/snijplanning/lib/compute-reststukken.ts
git commit -m "refactor(snijplanning): compute-reststukken-kopie → echte ADR-0033-shim op _shared"
```

### Task 5.4: Reststuk-score naar één gedeelde module

**Files:**
- Create: `supabase/functions/_shared/reststuk-score.ts`
- Modify: `supabase/functions/_shared/guillotine-packing.ts` (importeer i.p.v. eigen kopie)
- Modify: `supabase/functions/_shared/compute-reststukken.ts` (idem)

- [ ] **Step 1: Lift de exacte body uit guillotine-packing** (`reststukScoreCm2`, ADR-0025: `oppervlak × √(kort/lang)`) naar het nieuwe bestand:

```ts
// ADR-0025: shape-bias in reststuk-scoring — score = oppervlak × √(kort/lang).
// Eén bron; guillotine-packing (packer-kost) en compute-reststukken (UI/rapport)
// importeren beide hierheen. (Was 3× hand-gekopieerd "in lockstep"; de
// frontend-kopie is sinds Task 5.3 een shim.)
export function reststukScoreCm2(breedteCm: number, lengteCm: number): number {
  // <-- exacte body uit guillotine-packing.ts hierheen verplaatsen -->
}
```

Verifieer eerst dat de twee _shared-implementaties byte-gelijk gedrag hebben (lees beide); zo niet: STOP en rapporteer.

- [ ] **Step 2: Vervang beide lokale implementaties door de import; run alle deno-tests**

```bash
cd supabase/functions && deno test --allow-read _shared/
```

- [ ] **Step 3: Herdeploy-check** — dit raakt `auto-plan-groep`/`optimaliseer-snijplan`/`schat-benodigde-lengte` (zie Task 3.4-manifest). Pure verplaatsing = geen gedragswijziging, maar de functies moeten wél mee bij de eerstvolgende deploy. Noteer in het eindrapport.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared
git commit -m "refactor(packing): reststuk-score (ADR-0025) naar één gedeelde module"
```

---

## Fase 6 — Kleine consolidaties

### Task 6.1: `VervoerderType` — één bron, gespiegeld aan de DB-CHECK

**Files:**
- Create: `supabase/functions/_shared/vervoerders/vervoerder-type.ts`
- Modify: `frontend/src/modules/logistiek/registry.ts` (importeer het type)
- Modify: `frontend/src/modules/logistiek/queries/vervoerders.ts` (idem — deze union mist nu `'sftp'` én `'eigen'`!)

- [ ] **Step 1: Nieuwe module**

```ts
// Spiegelt de DB-CHECK vervoerders_type_check (mig 424): 5 waarden.
// De drie oude, onderling verschillende VervoerderType-unions (registry.ts
// miste 'print'; queries/vervoerders.ts miste 'sftp' en 'eigen' — terwijl 2
// van de 3 live carriers sftp zijn) importeren nu allemaal hier.
export const VERVOERDER_TYPES = ['api', 'edi', 'print', 'sftp', 'eigen'] as const
export type VervoerderType = (typeof VERVOERDER_TYPES)[number]
```

- [ ] **Step 2: Frontend-shim** `frontend/src/lib/logistiek/vervoerder-type.ts`:

```ts
// Re-export-shim (ADR-0033).
export * from '../../../../supabase/functions/_shared/vervoerders/vervoerder-type'
```

- [ ] **Step 3:** Vervang in `registry.ts` en `queries/vervoerders.ts` de lokale `export type VervoerderType = ...` door `import { type VervoerderType } from '@/lib/logistiek/vervoerder-type'` + `export type { VervoerderType }` (back-compat voor bestaande importeurs). Typecheck:

```bash
cd frontend && npm run typecheck
```

Let op: als ergens code op de oude smalle union leunde (bv. een switch zonder `sftp`-case), maakt de bredere union dat nu zichtbaar — dat is de bedoeling; vul de ontbrekende cases aan met het gedrag dat `getVervoerderDef`/de DB al hadden.

- [ ] **Step 4:** ADR-0034-addendum (onderaan `docs/adr/0034-...md`):

```markdown
## Addendum (2026-07-02)

"Vierde vervoerder = één capability-rij + één format-adapter" was onvolledig:
óók bijwerken — (1) `frontend/src/modules/logistiek/registry.ts`
(UI-display-registry, niet auto-gesynchroniseerd), (2) een rij in de
`vervoerders`-tabel, (3) routering in `vervoerder_selectie_regels`. Het
`VervoerderType`-union leeft sinds deze datum op één plek:
`_shared/vervoerders/vervoerder-type.ts` (spiegelt de DB-CHECK, mig 424).
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/vervoerders/vervoerder-type.ts frontend/src/lib/logistiek/vervoerder-type.ts frontend/src/modules/logistiek/registry.ts frontend/src/modules/logistiek/queries/vervoerders.ts docs/adr/0034-vervoerder-capability-als-descriptor-registry.md
git commit -m "refactor(logistiek): één VervoerderType gespiegeld aan de DB-CHECK (drie onderling afwijkende unions geconsolideerd)"
```

### Task 6.2: Zending-status-predicaten (overladen `'Gepland'`-string)

**Files:**
- Create: `frontend/src/modules/logistiek/lib/zending-status.ts`
- Test: `frontend/src/modules/logistiek/lib/zending-status.test.ts`
- Modify: de kale `'Gepland'`/`'Picken'`-stringchecks in zending-context (grep-gedreven)

- [ ] **Step 1: Module + test**

```ts
// Zending-status-predicaten. 'Gepland' is een overladen string ('Gepland'
// bestaat óók als snijplan_status met een andere betekenis) — check zending-
// status daarom via deze helpers, nooit via een kale stringvergelijking.
// Semantiek sinds mig 477: 'Gepland' = deelzending aangemaakt maar pickronde
// nog niet gestart; 'Picken' = pickronde loopt.
export const ZENDING_LOPEND = ['Gepland', 'Picken'] as const

export function isZendingGepland(status: string | null | undefined): boolean {
  return status === 'Gepland'
}

export function isZendingLopend(status: string | null | undefined): boolean {
  return status === 'Gepland' || status === 'Picken'
}
```

```ts
import { describe, expect, it } from 'vitest'
import { isZendingGepland, isZendingLopend } from './zending-status'

describe('zending-status-predicaten (mig 477)', () => {
  it('Gepland = aangemaakt, nog niet gestart', () => {
    expect(isZendingGepland('Gepland')).toBe(true)
    expect(isZendingGepland('Picken')).toBe(false)
  })
  it('lopend = Gepland of Picken', () => {
    expect(isZendingLopend('Gepland')).toBe(true)
    expect(isZendingLopend('Picken')).toBe(true)
    expect(isZendingLopend('Klaar voor verzending')).toBe(false)
    expect(isZendingLopend(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Vervang de kale checks in zending-context**

```bash
git grep -rn "=== 'Gepland'\|'Gepland', 'Picken'\|'Gepland','Picken'" frontend/src/modules/logistiek frontend/src/modules/magazijn frontend/src/components/orders
```

Vervang per hit — ALLEEN waar het aantoonbaar om een zending-status gaat (variabele heet `zending.status`, komt uit `zendingen`/`order_pickbaarheid`) — door `isZendingGepland(...)`/`isZendingLopend(...)`. Snijplan-checks (`snijplan.status === 'Gepland'`) NIET aanraken. Verwachte plekken (van de audit; her-verifieer): `startbaarheid.ts`, `annuleer-pickronde-knop.tsx`, `zending-printset.tsx`, `deelzending-dialog.tsx`, `pick-ship-transform.ts`, `pickbaarheid.ts`.

- [ ] **Step 3: Tests + typecheck**

```bash
cd frontend && npx vitest run src/modules/logistiek src/modules/magazijn && npm run typecheck
```

Let op: `startbaarheid.test.ts` en de magazijn-contracttests zijn de karakterisering — die moeten byte-identiek groen blijven.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src/modules/logistiek frontend/src/modules/magazijn frontend/src/components/orders
git commit -m "refactor(logistiek): zending-status-predicaten — 'Gepland' niet meer als kale string (collision met snijplan_status)"
```

### Task 6.3: Drift-test op de gedupliceerde order-status-array

**Files:**
- Modify: `frontend/src/lib/supabase/queries/vertegenwoordigers.ts` (exporteer `ACTIVE_ORDER_STATUSES`)
- Create: `frontend/src/lib/supabase/queries/__tests__/vertegenwoordigers-statussen.test.ts`

**Context:** `ACTIVE_ORDER_STATUSES` is een hand-getypte kopie van "alle statussen behalve eindstatussen". Volledig herrouteren naar de canonieke bron is churn; een drift-test die de kopie aan de golden pint is het lazy-correcte vangnet.

- [ ] **Step 1:** Zet `export` voor `const ACTIVE_ORDER_STATUSES` in `vertegenwoordigers.ts`.

- [ ] **Step 2:** Check de golden-structuur:

```bash
head -30 frontend/src/lib/utils/__tests__/status-enums.golden.json
```

Noteer de sleutelnaam voor de order-status-lijst (bv. `order_status`).

- [ ] **Step 3: Test**

```ts
import { describe, expect, it } from 'vitest'
import golden from '@/lib/utils/__tests__/status-enums.golden.json'
import { ACTIVE_ORDER_STATUSES } from '../vertegenwoordigers'

// Drift-vangnet: de hand-getypte kopie in vertegenwoordigers.ts moet exact
// "alle order-statussen minus eindstatussen" blijven. Wijzigt de enum (nieuwe
// golden), dan wordt deze test rood i.p.v. dat de kopie stil achterblijft.
const EINDSTATUSSEN = ['Verzonden', 'Geannuleerd']

describe('ACTIVE_ORDER_STATUSES drift-vangnet', () => {
  it('is exact de golden order-status-enum minus eindstatussen', () => {
    const verwacht = (golden.order_status as string[]).filter(s => !EINDSTATUSSEN.includes(s))
    expect([...ACTIVE_ORDER_STATUSES].sort()).toEqual([...verwacht].sort())
  })
})
```

(Sleutelnaam uit Step 2 invullen. Als de golden méér statussen kent dan de kopie — bv. `'Maatwerk afgerond'` — is dat een ECHTE bevinding: vertegenwoordiger-telling mist die orders. Rapporteer en voeg de status toe aan de array in hetzelfde commit.)

- [ ] **Step 4: Run + commit**

```bash
cd frontend && npx vitest run src/lib/supabase/queries/__tests__/vertegenwoordigers-statussen.test.ts
git add frontend/src/lib/supabase/queries
git commit -m "test(orders): drift-vangnet op ACTIVE_ORDER_STATUSES tegen de golden status-enum"
```

### Task 6.4: Vindregel query-lagen documenteren

**Files:** Modify: `docs/architectuur.md`

- [ ] **Step 1:** Voeg een sectie toe:

```markdown
## Vindregel: waar leeft domein-logica in de frontend?

Twee query-lagen bestaan naast elkaar (historisch gegroeid):

- `frontend/src/lib/supabase/queries/` — de oudere centrale laag (orders,
  order-mutations, documenten, reserveringen, …)
- `frontend/src/modules/<domein>/queries/` — de per-module-laag (facturatie,
  logistiek, magazijn, snijplanning, reserveringen, orders-lifecycle, …)

**Regel bij zoeken: ALTIJD beide lagen grep'en** — bv. order-status-transities
(`markeer_verzonden`, `bevestig_concept_order`) staan in
`modules/orders-lifecycle/queries/transities.ts`, NIET in `order-mutations.ts`;
facturen staan uitsluitend in `modules/facturatie/queries/`. Nieuwe queries:
in de module-laag; de centrale laag alleen aanvullen als het bestand daar al
bestaat. Losse `.from('orders')`-calls buiten beide lagen (o.a.
`components/orders/deelzending-dialog.tsx` met inline RPC's) zijn bekende
uitzonderingen — niet als patroon kopiëren.
```

- [ ] **Step 2: Commit**

```bash
git add docs/architectuur.md
git commit -m "docs(architectuur): vindregel voor de twee query-lagen (audit: order-domein over 4 plekken versnipperd)"
```

---

## Afronding

### Task 7.1: Volledige verificatie + changelog + merge-voorbereiding

- [ ] **Step 1: Alles draaien**

```bash
cd frontend && npm run typecheck && npx vitest run && npm run build
cd ../supabase/functions && deno test --allow-read _shared/
```

Expected: alles groen.

- [ ] **Step 2: Changelog**

Voeg aan `docs/changelog.md` één datum-blok toe (2026-07-02, audit-remediatie) met per fase één regel wat + waarom. CLAUDE.md-bedrijfsregels NIET uitbreiden (het ontvlechtingsplan komt eraan; geen nieuwe mega-bullets toevoegen).

- [ ] **Step 3: Migratienummers her-verifiëren vlak vóór merge** (memory: collisie-risico)

```bash
git fetch origin && git ls-tree origin/main --name-only supabase/migrations | tail -3
```

Bij collisie: hernummeren (bestand + interne verwijzingen) vóór merge.

- [ ] **Step 4: Merge alleen op expliciet commando van Miguel** (CLAUDE.md-workflow: push branch, merge naar main pas op "merge maar"). Vergeet bij merge niet: Vercel deployt de frontend automatisch; edge functions die `_shared`-wijzigingen dragen handmatig herdeployen volgens `supabase/functions/DEPLOY.md` (Task 3.4) — voor dit plan: de drie packing-consumers (Task 5.4).

---

## Bewust uitgesteld (eigen plannen, niet in deze scope)

| Onderwerp | Waarom uitgesteld | Vervolg |
|---|---|---|
| **Order-aandacht-gate-registry** (audit-kandidaat 4) | `fetchOrders`/`fetchStatusCounts` zijn op main net herbouwd (filterbalk-herontwerp 28-06: status-dropdown + meldingenkaart); het registry-ontwerp uit CONTEXT.md moet eerst tegen díe nieuwe vorm herijkt worden | Eigen plan na re-audit van de filterbalk-code |
| **CLAUDE.md-ontvlechting** (kandidaat 10) | Puur editorial maar groot; raakt elke sessie — apart reviewen | Eigen plan: bullets → `docs/bedrijfsregels/` per domein + CLAUDE.md als index |
| **`'Wacht op inkoop'`/brand-types op order_status** (kandidaat 5, order-kant) | Grote sweep over 33 plekken; `OrderWachtStatus` is bewust nog geen literal-union (derive-status.ts) | Eigen plan; eerst de zending-kant (Task 6.2) laten landen |
| **factuur-verzenden/index.ts opsplitsen** (915 regels) | Hoog-risico-pad (geld); vereist karakterisatie-tests vooraf | Eigen plan met fake-supabase-recorder-patroon (zoals verwerk-row.test.ts) |
| **order-form.tsx (1142) / groep-accordion.tsx (807) opsplitsen** | Werkende god-components; opsplitsen zonder testdekking is risico zonder acute winst | Meeliften wanneer een feature de betreffende file toch openbreekt |
| **Rhenus-monitor batch-bewuste heuristiek** | Pas relevant zodra het Rhenus-monitorpaneel gebouwd wordt (mig 484-notitie) | Notitie staat in mig 484; meenemen in dat feature-plan |
| **transities.ts ↔ order-mutations.ts samenvoegen** | Vindregel-doc (Task 6.4) dekt het verdwaal-risico; verplaatsen is churn zonder gedragswinst | Heroverwegen bij de gate-registry-refactor |
