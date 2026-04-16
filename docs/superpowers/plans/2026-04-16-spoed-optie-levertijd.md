# Spoed-optie bij Levertijd-check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een gebruiker kan tijdens order-aanmaak de spoed-optie selecteren; als er deze of volgende week nog ≥ benodigde-snijtijd + 4 uur buffer beschikbaar is in de werkagenda, krijgt het stuk een spoed-leverdatum en wordt automatisch een SPOEDTOESLAG-orderregel toegevoegd.

**Architecture:** Edge function `check-levertijd` retourneert nu naast het reguliere `lever_datum` óók een optionele `spoed`-tak met `(beschikbaar: bool, snij_datum, lever_datum, week_vol_uren)`. Frontend toont een toggle in `<LevertijdSuggestie>`; bij activeren wordt de header-leverdatum overschreven en een SPOEDTOESLAG-regel toegevoegd via dezelfde flow als de bestaande VERZEND-shipping logica. Spoed-berekening hergebruikt `werkagenda.ts` (cumulatieve werkminuten over backlog) en checkt restruimte van deze + volgende ISO-week.

**Tech Stack:** Supabase Edge Functions (Deno), React/TS frontend, TanStack Query, app_config (JSONB).

---

## Context

De [bestaande check-levertijd feature](../../changelog.md) berekent een reguliere leverdatum op basis van de werkagenda + match-logica. Sales kan nu concrete data communiceren, maar wanneer de klant **eerder wil leveren** is er geen mechanisme: de berekende datum is altijd de "natuurlijke" datum uit de planning. De gebruiker wil:

1. Een spoed-optie altijd zichtbaar in `<LevertijdSuggestie>`
2. Spoed = check of er deze week of volgende week nog snijcapaciteit is — minimaal 4 uur buffer per week (= een week is "vol" als er <4u over is na alle bestaande planning)
3. Bij activering: nieuwe regel SPOEDTOESLAG met vast bedrag uit `app_config` toegevoegd aan order, leverdatum overschreven naar spoed-datum

**Buiten scope:** dynamische spoed-prijs op basis van urgentie, klant-specifieke spoed-tarieven, spoed-quota per dag.

---

## File Structure

### Nieuwe bestanden (allen <300 regels)

| Pad | Doel |
|---|---|
| `supabase/functions/_shared/spoed-check.ts` | Pure functie: gegeven werkagenda + nieuw stuk + cfg → `SpoedResultaat` (beschikbaar bool + snij/lever datum + week-restruimte) |
| `supabase/functions/_shared/spoed-check.test.ts` | Deno unit tests (≥8) |
| `supabase/migrations/082_app_config_spoed_velden.sql` | UPSERT `spoed_buffer_uren=4`, `spoed_toeslag_bedrag=50`, `spoed_product_id='SPOEDTOESLAG'` |

### Te wijzigen bestanden

| Pad | Wijziging |
|---|---|
| `supabase/functions/_shared/levertijd-types.ts` | Voeg `SpoedDetails` interface + `spoed?: SpoedDetails` op `CheckLevertijdResponse`. Uitbreiden `LevertijdConfig` met spoed-velden |
| `supabase/functions/check-levertijd/index.ts` | Roep `evalueerSpoed()` na `resolveScenario()` aan, verrijk response. Lees nieuwe config-velden |
| `frontend/src/lib/supabase/queries/levertijd.ts` | Sync `SpoedDetails` interface met types-file |
| `frontend/src/lib/constants/shipping.ts` | Hernoem naar `frontend/src/lib/constants/order-toeslagen.ts` (of voeg toe) — voeg `SPOED_PRODUCT_ID` + `SPOED_FALLBACK_BEDRAG` constanten toe |
| `frontend/src/components/orders/levertijd-suggestie.tsx` | Toggle "Met spoed leveren (€X)" als `data.spoed.beschikbaar`. Bij toggle aan: roep `onSpoedToggle(true, datum, week)` callback |
| `frontend/src/components/orders/order-form.tsx` | Voeg `spoedActief` state + `applySpoedToeslag()` helper (zelfde patroon als `applyShippingLogic`). Bij spoed aan: SPOEDTOESLAG-regel toevoegen + leverdatum overschrijven met spoed-datum |
| `frontend/src/lib/supabase/queries/order-config.ts` | Optioneel: voeg `spoed_*` velden toe aan `OrderConfig` als die in `order_config` komt — alternatief: nieuwe `fetchSpoedConfig` uit `productie_planning` |
| `docs/database-schema.md` | Sectie `app_config.productie_planning`: nieuwe velden `spoed_buffer_uren`, `spoed_toeslag_bedrag`, `spoed_product_id` |
| `docs/architectuur.md` | Sectie "Real-time levertijd-check" uitbreiden met spoed-tak + restruimte-formule |
| `docs/changelog.md` | Datum-entry |

### Hergebruik (NIET wijzigen)

- `supabase/functions/_shared/werkagenda.ts` — `berekenSnijAgenda`, `volgendeWerkminuut`, `STANDAARD_WERKTIJDEN`
- `frontend/src/components/orders/order-form.tsx` `applyShippingLogic()` — patroon kopiëren voor spoed-toeslag
- `producten`-tabel — voorwaarde: artikel `SPOEDTOESLAG` moet bestaan met basis-prijs (val terug op `SPOED_FALLBACK_BEDRAG` indien niet)

---

## Algoritme

### Spoed-evaluatie (`spoed-check.ts`)

**Input:**
- `werkagenda: Map<rolId, RolAgendaSlot>` — bestaande backlog (al berekend in main flow)
- `nieuwStukDuurMinuten: number` — wisseltijd + 1 × snijtijd (gemiddeld voor schatting)
- `cfg: { spoed_buffer_uren, capaciteit_per_week, ... }`
- `vandaag: Date`

**Output:** `SpoedResultaat`
```ts
{
  beschikbaar: boolean
  scenario: 'spoed_deze_week' | 'spoed_volgende_week' | 'spoed_geen_plek'
  snij_datum: string | null    // YYYY-MM-DD waarop spoed-stuk wordt gesneden
  lever_datum: string | null   // snij_datum + logistieke_buffer_dagen
  week_restruimte_minuten: { deze: number; volgende: number }
}
```

**Algoritme:**
1. Bepaal eind van bestaande backlog uit `werkagenda` = `max(slot.eind)` over alle slots, of `vandaag` als leeg.
2. Voor "deze week" en "volgende week":
   - Bereken totaal werkminuten in die ISO-week (vrijdag 17:00 − maandag 08:00 met pauze = 5 × 510 = 2550 min).
   - Bereken hoeveel werkminuten al beslagen door backlog die in/over deze week valt → `bezet_minuten`.
   - `restruimte_minuten = 2550 - bezet_minuten - (spoed_buffer_uren × 60)`.
   - Als `restruimte_minuten ≥ nieuwStukDuurMinuten`: pas mogelijk in deze week.
3. Kies vroegste week waar het past:
   - **Deze week** (mits niet al voorbij vrijdag): snij_datum = einde laatste backlog-blok of `volgendeWerkminuut(vandaag)`, +nieuwStukDuur in werkminuten.
   - **Volgende week**: snij_datum = volgende-week-maandag 08:00 + (verschoven blok).
4. `lever_datum = snij_datum + logistieke_buffer_dagen` (zelfde als reguliere flow).
5. Als beide weken vol: `beschikbaar=false`, scenario=`spoed_geen_plek`.

### Frontend toggle-logica (`levertijd-suggestie.tsx`)

- Render altijd een sectie "Spoed-optie" als `data.spoed` bestaat.
- Als `data.spoed.beschikbaar=true`:
  - Toggle (checkbox) "🚀 Spoed leveren — leverdatum {spoed.lever_datum} (+€{toeslag})"
  - Bij `onChange(true)`: callback `onSpoedToggle(spoed.lever_datum, spoed.week)`
- Als `false`: toon disabled "Spoed niet mogelijk — beide weken zijn vol"

### Order-form spoed-toeslag (`order-form.tsx`)

Patroon **identiek aan `applyShippingLogic`**:
```ts
function applySpoedToeslag(currentRegels, spoedActief, spoedConfig): OrderRegelFormData[] {
  const heeftSpoedRegel = currentRegels.some(r => r.artikelnr === SPOED_PRODUCT_ID)
  if (spoedActief && !heeftSpoedRegel) {
    const spoedLine: OrderRegelFormData = {
      artikelnr: SPOED_PRODUCT_ID,
      omschrijving: 'Spoedtoeslag',
      orderaantal: 1,
      te_leveren: 1,
      prijs: spoedConfig.spoed_toeslag_bedrag,
      korting_pct: 0,
      bedrag: spoedConfig.spoed_toeslag_bedrag,
    }
    return [...currentRegels, spoedLine]
  }
  if (!spoedActief && heeftSpoedRegel) {
    return currentRegels.filter(r => r.artikelnr !== SPOED_PRODUCT_ID)
  }
  return currentRegels
}
```

Bij toggle: ook `setHeader({ afleverdatum: spoed_lever_datum, week: ... })` en `setAfleverdatumOverridden(true)`.

---

## Tasks

### Task 1: Database — config velden

**Files:**
- Create: `supabase/migrations/082_app_config_spoed_velden.sql`

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migration 082: voeg spoed-toeslag velden toe aan app_config.productie_planning.
UPDATE app_config
SET waarde = waarde
  || jsonb_build_object(
       'spoed_buffer_uren', COALESCE(waarde->'spoed_buffer_uren', '4'::jsonb),
       'spoed_toeslag_bedrag', COALESCE(waarde->'spoed_toeslag_bedrag', '50'::jsonb),
       'spoed_product_id', COALESCE(waarde->'spoed_product_id', '"SPOEDTOESLAG"'::jsonb)
     )
WHERE sleutel = 'productie_planning';
```

- [ ] **Step 2: Verifieer migratie via dry-run query**

Run de UPDATE als SELECT om te zien of velden correct worden samengesteld.

- [ ] **Step 3: Apply via Supabase Studio**

Open SQL editor in dashboard en run de migratie. Verifieer met:
```sql
SELECT waarde->'spoed_buffer_uren', waarde->'spoed_toeslag_bedrag', waarde->'spoed_product_id'
FROM app_config WHERE sleutel='productie_planning';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/082_app_config_spoed_velden.sql
git commit -m "feat(db): voeg spoed-toeslag velden toe aan app_config"
```

---

### Task 2: Types uitbreiden

**Files:**
- Modify: `supabase/functions/_shared/levertijd-types.ts`

- [ ] **Step 1: Voeg interfaces toe**

Aan eind van bestand (na `BacklogResult`):
```ts
export interface SpoedDetails {
  beschikbaar: boolean
  scenario: 'spoed_deze_week' | 'spoed_volgende_week' | 'spoed_geen_plek'
  snij_datum: string | null
  lever_datum: string | null
  week: number | null
  jaar: number | null
  week_restruimte_uren: { deze: number; volgende: number }
  toeslag_bedrag: number
}
```

Update `LevertijdConfig`:
```ts
export interface LevertijdConfig {
  // ...bestaand...
  spoed_buffer_uren: number
  spoed_toeslag_bedrag: number
  spoed_product_id: string
}
```

Update `CheckLevertijdResponse`:
```ts
export interface CheckLevertijdResponse {
  // ...bestaand...
  spoed?: SpoedDetails
}
```

- [ ] **Step 2: Type-check**

```bash
npx deno check supabase/functions/_shared/levertijd-types.ts
```
Expected: geen errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/levertijd-types.ts
git commit -m "feat(types): voeg SpoedDetails toe aan check-levertijd contract"
```

---

### Task 3: Spoed-check pure logica + tests

**Files:**
- Create: `supabase/functions/_shared/spoed-check.ts`
- Create: `supabase/functions/_shared/spoed-check.test.ts`

- [ ] **Step 1: Schrijf failing test stub**

`spoed-check.test.ts`:
```ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { evalueerSpoed } from './spoed-check.ts'
import type { LevertijdConfig } from './levertijd-types.ts'
import type { RolAgendaSlot } from './werkagenda.ts'

function defaultConfig(overrides: Partial<LevertijdConfig> = {}): LevertijdConfig {
  return {
    logistieke_buffer_dagen: 2, backlog_minimum_m2: 12, capaciteit_per_week: 450,
    capaciteit_marge_pct: 0, wisseltijd_minuten: 15, snijtijd_minuten: 5,
    maatwerk_weken: 4, spoed_buffer_uren: 4, spoed_toeslag_bedrag: 50,
    spoed_product_id: 'SPOEDTOESLAG',
    ...overrides,
  }
}

const VANDAAG = new Date('2026-04-16T08:00:00Z')  // donderdag

Deno.test('evalueerSpoed: lege werkagenda → spoed deze week beschikbaar', () => {
  const result = evalueerSpoed(new Map(), 30, defaultConfig(), VANDAAG)
  assertEquals(result.beschikbaar, true)
  assertEquals(result.scenario, 'spoed_deze_week')
  assert(result.snij_datum !== null)
})
```

- [ ] **Step 2: Run test → FAIL**

```bash
npx deno test supabase/functions/_shared/spoed-check.test.ts --no-check
```
Expected: FAIL met "Cannot find module './spoed-check.ts'".

- [ ] **Step 3: Implementeer minimaal**

`spoed-check.ts`:
```ts
import type { LevertijdConfig, SpoedDetails } from './levertijd-types.ts'
import {
  type RolAgendaSlot, type Werktijden, STANDAARD_WERKTIJDEN,
  volgendeWerkminuut, plusWerkminuten,
} from './werkagenda.ts'

const MIN_PER_WEEKDAG = 510  // 09:00-17:00 minus 30min pauze

function isoWeekStart(d: Date): Date {
  // Maandag van de ISO-week waarin d valt (UTC, 00:00)
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = out.getUTCDay() || 7  // 1..7 (ma=1..zo=7)
  out.setUTCDate(out.getUTCDate() - (dow - 1))
  return out
}

function plusWeken(d: Date, n: number): Date {
  const out = new Date(d.getTime())
  out.setUTCDate(out.getUTCDate() + n * 7)
  return out
}

function bezetMinutenInWeek(
  agenda: Map<number, RolAgendaSlot>,
  weekStart: Date, weekEinde: Date,
): number {
  let totaal = 0
  for (const slot of agenda.values()) {
    const start = slot.start.getTime()
    const eind = slot.eind.getTime()
    const ws = weekStart.getTime()
    const we = weekEinde.getTime()
    if (eind <= ws || start >= we) continue
    const overlapStart = Math.max(start, ws)
    const overlapEind = Math.min(eind, we)
    totaal += Math.floor((overlapEind - overlapStart) / 60_000)
  }
  return totaal
}

export function evalueerSpoed(
  werkagenda: Map<number, RolAgendaSlot>,
  nieuwStukDuurMinuten: number,
  cfg: LevertijdConfig,
  vandaag: Date,
  werktijden: Werktijden = STANDAARD_WERKTIJDEN,
): SpoedDetails {
  const buffer = cfg.spoed_buffer_uren * 60
  const dezeWeek = isoWeekStart(vandaag)
  const volgendeWeek = plusWeken(dezeWeek, 1)
  const eindDezeWeek = plusWeken(dezeWeek, 1)
  const eindVolgendeWeek = plusWeken(dezeWeek, 2)

  const bezetDeze = bezetMinutenInWeek(werkagenda, dezeWeek, eindDezeWeek)
  const bezetVolgende = bezetMinutenInWeek(werkagenda, volgendeWeek, eindVolgendeWeek)
  const restDeze = MIN_PER_WEEKDAG * werktijden.werkdagen.length - bezetDeze - buffer
  const restVolgende = MIN_PER_WEEKDAG * werktijden.werkdagen.length - bezetVolgende - buffer

  const restruimte = {
    deze: Math.round((Math.max(0, restDeze) / 60) * 10) / 10,
    volgende: Math.round((Math.max(0, restVolgende) / 60) * 10) / 10,
  }

  // Bepaal start van het spoed-blok = einde laatste backlog binnen de gekozen week
  function plaatsInWeek(weekStart: Date, weekEinde: Date): { snij: Date; eind: Date } | null {
    // Eerste werkminuut na bestaande backlog (die binnen of vóór deze week eindigt)
    let cursor = volgendeWerkminuut(vandaag, werktijden)
    for (const slot of werkagenda.values()) {
      if (slot.eind > cursor) cursor = slot.eind
    }
    if (cursor >= weekEinde) return null  // backlog loopt voorbij deze week
    if (cursor < weekStart) cursor = volgendeWerkminuut(weekStart, werktijden)
    const snij = volgendeWerkminuut(cursor, werktijden)
    const eind = plusWerkminuten(snij, nieuwStukDuurMinuten, werktijden)
    if (eind > weekEinde) return null   // past niet meer in deze week
    return { snij, eind }
  }

  let scenario: SpoedDetails['scenario'] = 'spoed_geen_plek'
  let snij_datum: string | null = null
  let lever_datum: string | null = null
  let week: number | null = null
  let jaar: number | null = null

  if (restDeze >= nieuwStukDuurMinuten) {
    const slot = plaatsInWeek(dezeWeek, eindDezeWeek)
    if (slot) {
      scenario = 'spoed_deze_week'
      snij_datum = slot.eind.toISOString().slice(0, 10)
    }
  }
  if (!snij_datum && restVolgende >= nieuwStukDuurMinuten) {
    const slot = plaatsInWeek(volgendeWeek, eindVolgendeWeek)
    if (slot) {
      scenario = 'spoed_volgende_week'
      snij_datum = slot.eind.toISOString().slice(0, 10)
    }
  }

  if (snij_datum) {
    const lever = new Date(`${snij_datum}T00:00:00Z`)
    lever.setUTCDate(lever.getUTCDate() + cfg.logistieke_buffer_dagen)
    lever_datum = lever.toISOString().slice(0, 10)
    // ISO-week van lever_datum
    const tmp = new Date(lever)
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7))
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
    week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
    jaar = tmp.getUTCFullYear()
  }

  return {
    beschikbaar: snij_datum !== null,
    scenario,
    snij_datum,
    lever_datum,
    week,
    jaar,
    week_restruimte_uren: restruimte,
    toeslag_bedrag: cfg.spoed_toeslag_bedrag,
  }
}
```

- [ ] **Step 4: Run test → PASS**

```bash
npx deno test supabase/functions/_shared/spoed-check.test.ts --no-check
```
Expected: 1 passed.

- [ ] **Step 5: Voeg meer tests toe**

```ts
Deno.test('evalueerSpoed: backlog vult deze week vol → spoed volgende week', () => {
  // 5 dagen × 510 min = 2550 min beslagen door backlog deze week
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  fakeAgenda.set(1, {
    start: new Date('2026-04-13T08:00:00Z'),
    eind: new Date('2026-04-17T17:00:00Z'),
    klaarDatum: '2026-04-17',
  })
  const result = evalueerSpoed(fakeAgenda, 30, defaultConfig(), VANDAAG)
  assertEquals(result.scenario, 'spoed_volgende_week')
  assert(result.snij_datum !== null)
})

Deno.test('evalueerSpoed: backlog tot 5 uur in volgende week → past nog (4u buffer ok)', () => {
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  fakeAgenda.set(1, {
    start: new Date('2026-04-13T08:00:00Z'),
    eind: new Date('2026-04-22T13:00:00Z'),  // ma+di volgende week beslagen
    klaarDatum: '2026-04-22',
  })
  const result = evalueerSpoed(fakeAgenda, 30, defaultConfig({ spoed_buffer_uren: 4 }), VANDAAG)
  // Volgende week heeft nog 3 dagen × 8.5u = 25.5u min 4u buffer = 21.5u → past
  assertEquals(result.beschikbaar, true)
})

Deno.test('evalueerSpoed: beide weken vol → niet beschikbaar', () => {
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  fakeAgenda.set(1, {
    start: new Date('2026-04-13T08:00:00Z'),
    eind: new Date('2026-04-24T17:00:00Z'),  // hele 2 weken beslagen
    klaarDatum: '2026-04-24',
  })
  const result = evalueerSpoed(fakeAgenda, 30, defaultConfig(), VANDAAG)
  assertEquals(result.beschikbaar, false)
  assertEquals(result.scenario, 'spoed_geen_plek')
})

Deno.test('evalueerSpoed: nieuwStuk groter dan week-restruimte → niet beschikbaar deze week', () => {
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  fakeAgenda.set(1, {
    start: new Date('2026-04-13T08:00:00Z'),
    eind: new Date('2026-04-17T15:00:00Z'),  // bijna vol (1u over - 4u buffer = -3u)
    klaarDatum: '2026-04-17',
  })
  const result = evalueerSpoed(fakeAgenda, 120, defaultConfig(), VANDAAG)
  assertEquals(result.scenario, 'spoed_volgende_week')
})

Deno.test('evalueerSpoed: lever_datum = snij + logistieke_buffer', () => {
  const result = evalueerSpoed(new Map(), 30, defaultConfig({ logistieke_buffer_dagen: 3 }), VANDAAG)
  // snij_datum = vandaag (do 16-04), lever = +3 = zo 19-04
  const snij = new Date(`${result.snij_datum}T00:00:00Z`)
  const lever = new Date(`${result.lever_datum}T00:00:00Z`)
  assertEquals((lever.getTime() - snij.getTime()) / 86_400_000, 3)
})

Deno.test('evalueerSpoed: toeslag_bedrag uit cfg', () => {
  const result = evalueerSpoed(new Map(), 30, defaultConfig({ spoed_toeslag_bedrag: 75 }), VANDAAG)
  assertEquals(result.toeslag_bedrag, 75)
})

Deno.test('evalueerSpoed: week_restruimte_uren correct gerapporteerd', () => {
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  fakeAgenda.set(1, {
    start: new Date('2026-04-13T08:00:00Z'),
    eind: new Date('2026-04-15T17:00:00Z'),  // ma-wo (3 × 510 min = 1530 min beslag)
    klaarDatum: '2026-04-15',
  })
  const result = evalueerSpoed(fakeAgenda, 30, defaultConfig(), VANDAAG)
  // Deze week: 5×510 - 1530 - 240 = 2550-1530-240 = 780 min = 13.0 uur
  assertEquals(result.week_restruimte_uren.deze, 13)
})
```

- [ ] **Step 6: Run alle tests → 8/8 PASS**

```bash
npx deno test supabase/functions/_shared/spoed-check.test.ts --no-check
```
Expected: 8 passed.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/spoed-check.ts supabase/functions/_shared/spoed-check.test.ts
git commit -m "feat(spoed): pure spoed-evaluatie met week-restruimte + 4u buffer"
```

---

### Task 4: Edge function integreert spoed-check

**Files:**
- Modify: `supabase/functions/check-levertijd/index.ts`

- [ ] **Step 1: Lees nieuwe config-velden**

In `fetchConfig()`, na de bestaande field-mappings:
```ts
if (typeof w.spoed_buffer_uren === 'number') cfg.spoed_buffer_uren = w.spoed_buffer_uren
if (typeof w.spoed_toeslag_bedrag === 'number') cfg.spoed_toeslag_bedrag = w.spoed_toeslag_bedrag
if (typeof w.spoed_product_id === 'string') cfg.spoed_product_id = w.spoed_product_id
```

Default in `DEFAULT_CONFIG`:
```ts
spoed_buffer_uren: 4,
spoed_toeslag_bedrag: 50,
spoed_product_id: 'SPOEDTOESLAG',
```

- [ ] **Step 2: Roep evalueerSpoed aan**

Importeer:
```ts
import { evalueerSpoed } from '../_shared/spoed-check.ts'
```

Na `resolveScenario(...)` call (vlak voor `return jsonResponse(...)`):
```ts
const nieuwStukDuur = cfg.wisseltijd_minuten + cfg.snijtijd_minuten
response.spoed = evalueerSpoed(werkagenda, nieuwStukDuur, cfg, new Date())
```

- [ ] **Step 3: Type-check**

```bash
npx deno check supabase/functions/check-levertijd/index.ts
```
Expected: geen errors.

- [ ] **Step 4: Re-deploy**

```bash
npx supabase functions deploy check-levertijd --project-ref wqzeevfobwauxkalagtn --no-verify-jwt
```

- [ ] **Step 5: Smoke test**

```bash
curl -s -X POST "https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/check-levertijd" \
  -H "Authorization: Bearer sb_publishable_ZlFLMUNPwVy__jVb4Hoevg_FOvUIoVI" \
  -H "Content-Type: application/json" \
  -d '{"kwaliteit_code":"CISC","kleur_code":"11","lengte_cm":300,"breedte_cm":200}'
```
Expected: response bevat `spoed: { beschikbaar, scenario, snij_datum, lever_datum, ... }`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/check-levertijd/index.ts
git commit -m "feat(check-levertijd): voeg spoed-evaluatie toe aan response"
```

---

### Task 5: Frontend types + constanten

**Files:**
- Create: `frontend/src/lib/constants/spoed.ts`
- Modify: `frontend/src/lib/supabase/queries/levertijd.ts`

- [ ] **Step 1: Constants**

`frontend/src/lib/constants/spoed.ts`:
```ts
export const SPOED_PRODUCT_ID = 'SPOEDTOESLAG'
export const SPOED_FALLBACK_BEDRAG = 50
```

- [ ] **Step 2: Type sync in levertijd.ts**

Voeg toe aan bestaande types:
```ts
export interface SpoedDetails {
  beschikbaar: boolean
  scenario: 'spoed_deze_week' | 'spoed_volgende_week' | 'spoed_geen_plek'
  snij_datum: string | null
  lever_datum: string | null
  week: number | null
  jaar: number | null
  week_restruimte_uren: { deze: number; volgende: number }
  toeslag_bedrag: number
}
```

Update `CheckLevertijdResponse`:
```ts
spoed?: SpoedDetails
```

- [ ] **Step 3: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/constants/spoed.ts frontend/src/lib/supabase/queries/levertijd.ts
git commit -m "feat(frontend): SpoedDetails types + constanten"
```

---

### Task 6: LevertijdSuggestie component spoed-toggle

**Files:**
- Modify: `frontend/src/components/orders/levertijd-suggestie.tsx`

- [ ] **Step 1: Voeg props toe**

```ts
interface LevertijdSuggestieProps {
  // ...bestaand...
  spoedActief?: boolean
  onSpoedToggle?: (actief: boolean, leverDatum: string | null, week: number | null, toeslag: number) => void
}
```

- [ ] **Step 2: Render spoed-sectie binnen kaart**

Voeg toe vóór de slot `{data.scenario === 'spoed' && ...}` (oude spoed-banner):
```tsx
{data.spoed && (
  <SpoedToggle
    spoed={data.spoed}
    actief={spoedActief ?? false}
    onChange={(actief) => onSpoedToggle?.(
      actief,
      data.spoed!.lever_datum,
      data.spoed!.week,
      data.spoed!.toeslag_bedrag,
    )}
  />
)}
```

Voeg subcomponent toe:
```tsx
function SpoedToggle({ spoed, actief, onChange }: {
  spoed: NonNullable<CheckLevertijdResponse['spoed']>
  actief: boolean
  onChange: (a: boolean) => void
}) {
  if (!spoed.beschikbaar) {
    return (
      <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 text-xs text-slate-500">
        Spoed niet mogelijk — beide weken zijn vol (rest deze: {spoed.week_restruimte_uren.deze}u, volgende: {spoed.week_restruimte_uren.volgende}u).
      </div>
    )
  }
  return (
    <label className="flex items-start gap-2 px-3 py-2 bg-amber-50 border-t border-amber-100 cursor-pointer hover:bg-amber-100">
      <input
        type="checkbox"
        checked={actief}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-400/30"
      />
      <div className="text-xs">
        <div className="font-medium text-amber-900">
          🚀 Met spoed leveren — {formatDatumNL(spoed.lever_datum)} (+€{spoed.toeslag_bedrag})
        </div>
        <div className="text-amber-700 mt-0.5">
          Snijden in {spoed.scenario === 'spoed_deze_week' ? 'deze week' : 'volgende week'}.
          Voegt SPOEDTOESLAG-regel toe aan de order.
        </div>
      </div>
    </label>
  )
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/orders/levertijd-suggestie.tsx
git commit -m "feat(ui): spoed-toggle in LevertijdSuggestie"
```

---

### Task 7: order-form spoed-state + toeslag-regel

**Files:**
- Modify: `frontend/src/components/orders/order-form.tsx`

- [ ] **Step 1: Import + state**

Bovenaan:
```ts
import { SPOED_PRODUCT_ID, SPOED_FALLBACK_BEDRAG } from '@/lib/constants/spoed'
```

In `OrderForm` body (na `afleverdatumOverridden` state):
```ts
const [spoedActief, setSpoedActief] = useState<boolean>(
  () => mode === 'edit' && (initialData?.regels ?? []).some(r => r.artikelnr === SPOED_PRODUCT_ID)
)
```

- [ ] **Step 2: Helper applySpoedToeslag**

Naast `applyShippingLogic`:
```ts
function applySpoedToeslag(currentRegels: OrderRegelFormData[], actief: boolean, bedrag: number): OrderRegelFormData[] {
  const heeft = currentRegels.some(r => r.artikelnr === SPOED_PRODUCT_ID)
  if (actief && !heeft) {
    return [...currentRegels, {
      artikelnr: SPOED_PRODUCT_ID,
      omschrijving: 'Spoedtoeslag',
      orderaantal: 1,
      te_leveren: 1,
      prijs: bedrag,
      korting_pct: 0,
      bedrag,
    }]
  }
  if (!actief && heeft) {
    return currentRegels.filter(r => r.artikelnr !== SPOED_PRODUCT_ID)
  }
  return currentRegels
}
```

- [ ] **Step 3: Toggle-handler in LevertijdSuggestie**

Update de bestaande aanroep:
```tsx
<LevertijdSuggestie
  // ...bestaand...
  spoedActief={spoedActief}
  onSpoedToggle={(actief, leverDatum, week, toeslag) => {
    setSpoedActief(actief)
    setRegels((r) => applySpoedToeslag(r, actief, toeslag || SPOED_FALLBACK_BEDRAG))
    if (actief && leverDatum) {
      setAfleverdatumOverridden(true)
      setHeader((h) => ({ ...h, afleverdatum: leverDatum, week: week ? String(week) : h.week }))
    }
  }}
/>
```

- [ ] **Step 4: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 5: Manueel testen in browser**

1. Refresh `localhost:5174/orders/aanmaken`
2. Voeg maatwerk-regel toe (CISC 11 300×200)
3. Verifieer: spoed-toggle verschijnt onder de leverdatum-suggestie
4. Klik toggle aan → check of:
   - Leverdatum-veld verandert naar spoed-datum
   - Een nieuwe regel "Spoedtoeslag" verschijnt onderaan met €50
5. Klik toggle uit → regel + datum-override verdwijnen

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/orders/order-form.tsx
git commit -m "feat(orders): spoed-toggle voegt SPOEDTOESLAG-regel + datum-override toe"
```

---

### Task 8: Documentatie + changelog

**Files:**
- Modify: `docs/database-schema.md`, `docs/architectuur.md`, `docs/changelog.md`

- [ ] **Step 1: schema doc velden**

In `docs/database-schema.md` sectie `productie_planning`:
```
| spoed_buffer_uren | number | 4 | Per week minimum overgebleven uren om "vol" te markeren in spoed-check (migratie 082) |
| spoed_toeslag_bedrag | number | 50 | Vast bedrag dat als SPOEDTOESLAG-orderregel wordt toegevoegd bij spoed-optie (migratie 082) |
| spoed_product_id | string | "SPOEDTOESLAG" | Product-ID voor de spoed-orderregel (analoog aan VERZEND-shipping logica) |
```

- [ ] **Step 2: architectuur uitbreiden**

In `docs/architectuur.md`, sectie "Real-time levertijd-check":
> Daarnaast retourneert de edge function een `spoed`-tak: `evalueerSpoed()` checkt voor deze ISO-week en de volgende of er na de bestaande backlog nog ≥ benodigde-snijduur + `spoed_buffer_uren × 60` minuten beschikbaar zijn (over `werkdagen × 510` werkminuten/dag). Bij beschikbaar: spoed-leverdatum = einde-spoed-blok + `logistieke_buffer_dagen`. Frontend-toggle voegt automatisch een SPOEDTOESLAG-orderregel toe (zelfde patroon als VERZEND).

- [ ] **Step 3: changelog entry**

```markdown
### 2026-04-16 — Spoed-optie bij levertijd-check
- **Wat:** `check-levertijd` retourneert nu een `spoed`-tak met (beschikbaar, snij_datum, lever_datum, week_restruimte_uren, toeslag_bedrag) gebaseerd op restruimte deze + volgende ISO-week min 4u buffer. UI toont een toggle in `<LevertijdSuggestie>`; bij activeren wordt de leverdatum overschreven en automatisch een SPOEDTOESLAG-orderregel toegevoegd (€50 default uit `app_config`).
- **Waarom:** Sales kan klanten met urgente verzoeken bedienen mits er capaciteit is, met transparante prijs-impact en zonder de planner handmatig te benaderen.
- **Files:** [supabase/functions/_shared/spoed-check.ts](supabase/functions/_shared/spoed-check.ts), [supabase/migrations/082_app_config_spoed_velden.sql](supabase/migrations/082_app_config_spoed_velden.sql), [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts), [frontend/src/components/orders/levertijd-suggestie.tsx](frontend/src/components/orders/levertijd-suggestie.tsx), [frontend/src/components/orders/order-form.tsx](frontend/src/components/orders/order-form.tsx).
```

- [ ] **Step 4: Commit**

```bash
git add docs/database-schema.md docs/architectuur.md docs/changelog.md
git commit -m "docs: spoed-optie levertijd-check + app_config velden"
```

---

## Verificatie

**Unit tests (Deno):**
```bash
npx deno test supabase/functions/_shared/spoed-check.test.ts --no-check
```
Expected: 8/8 passed.

**Frontend type-check:**
```bash
cd frontend && npx tsc --noEmit
```
Expected: exit 0.

**End-to-end manueel:**

1. Apply migratie 082 via Supabase Studio SQL editor
2. Re-deploy edge function: `npx supabase functions deploy check-levertijd --project-ref wqzeevfobwauxkalagtn --no-verify-jwt`
3. Smoke test:
   ```bash
   curl -s -X POST "https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/check-levertijd" \
     -H "Authorization: Bearer sb_publishable_ZlFLMUNPwVy__jVb4Hoevg_FOvUIoVI" \
     -H "Content-Type: application/json" \
     -d '{"kwaliteit_code":"CISC","kleur_code":"11","lengte_cm":300,"breedte_cm":200}' | jq .spoed
   ```
   Verwacht: `{ beschikbaar, scenario, snij_datum, lever_datum, ... }` aanwezig.
4. Browser-test: open `/orders/aanmaken`, voeg maatwerk-regel toe, verifieer:
   - Spoed-toggle zichtbaar onder leverdatum-suggestie
   - Toggle aan → SPOEDTOESLAG-regel verschijnt + datum vooruit gezet
   - Toggle uit → regel + datum-override verdwijnen
5. Edge cases:
   - Lege backlog (testdata): spoed beschikbaar deze week
   - Volle 2 weken: toggle disabled met "beide weken vol" tekst

**Success criteria:**
- Spoed-toggle altijd zichtbaar (mits levertijd-check zelf werkt)
- Wanneer beschikbaar: aanmaken van order met spoed → SPOEDTOESLAG-regel zichtbaar in order-detail + leverdatum komt overeen met spoed-datum
- 4u buffer per week wordt gerespecteerd

---

## Critical Files (referentie)

- [supabase/functions/_shared/werkagenda.ts](supabase/functions/_shared/werkagenda.ts) — hergebruik `RolAgendaSlot`, `STANDAARD_WERKTIJDEN`, `volgendeWerkminuut`, `plusWerkminuten`
- [supabase/functions/_shared/levertijd-types.ts](supabase/functions/_shared/levertijd-types.ts) — uitbreiden met `SpoedDetails`
- [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts) — main edge function, integratiepunt
- [frontend/src/components/orders/order-form.tsx](frontend/src/components/orders/order-form.tsx) — spoed-state + toeslag-regel logica (patroon: `applyShippingLogic`)
- [frontend/src/lib/constants/shipping.ts](frontend/src/lib/constants/shipping.ts) — referentiepatroon voor product-id constanten
- [frontend/src/components/orders/levertijd-suggestie.tsx](frontend/src/components/orders/levertijd-suggestie.tsx) — toggle UI
