# Werkagenda — één bron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De drie implementaties van werkdag-/werkagenda-rekenkunde terugbrengen naar één bezittende module (`supabase/functions/_shared/werkagenda.ts`) die frontend én edge direct importeren, met golden-fixture-borging in beide runtimes — en (fase 2) de werktijden-/feestdagen-configuratie van per-browser-localStorage naar `app_config` zodat een feestdag-wijziging maar één keer hoeft te landen.

**Architecture:** Het kernel-bestand in `_shared/` wordt de enige implementatie (rijke interface: `'HH:mm'`-strings + `vrij`-feestdagen, lokale-tijd-methodes — in de edge-runtime is TZ=UTC dus daar gedragsneutraal). De frontend importeert de kernel direct via een relatieve import (zelfde patroon als `derive-status`; `werkagenda.ts` is dependency-vrij dus Vite-importeerbaar, enkel `server.fs.allow` is nodig). Een golden-fixture-JSON wordt door een Deno-test én een Vitest-contracttest getoetst. De dode SQL-functies uit mig 279 (nul callers) worden gedropt.

**Tech Stack:** Supabase (PL/pgSQL-migraties handmatig via SQL Editor; edge function deploy via CLI `--project-ref wqzeevfobwauxkalagtn`), Deno edge functions, React/TypeScript + Vite/Vitest, TanStack Query.

---

## Bevindingen (geverifieerd onderzoek 2026-06-12)

De claim "drie implementaties van één kalender" **klopt — en is in de praktijk erger dan gesteld**:

| # | Bevinding | Detail |
|---|---|---|
| 1 | **SQL "ground-truth" (mig 279) is dode code** | `werkdag_offset_n`/`werkdag_plus_n`/`werkdag_min_n`/`werkagenda_kalender` hebben **nul callers** in views/RPC's (repo-grep: alleen mig 279 zelf + docs). Bevestigt de 5C-correctie uit plan 2026-06-09. Pinnen heeft geen zin — droppen wel. |
| 2 | **Interface-divergentie Deno↔frontend** | Deno (`_shared/werkagenda.ts`): numeriek `startUur/startMin`, UTC-methodes, **geen feestdagen**. Frontend (`bereken-agenda.ts`): `'HH:mm'`-strings, lokale tijd, **wél `vrij: FeestdagVrij[]`**. |
| 3 | **Feestdagen-divergentie is al LIVE, niet hypothetisch** | `productie-instellingen.tsx` heeft een `VrijeDagenConfig`-UI; de config staat in **localStorage** (`karpi.werkagenda.werktijden`, per browser!). Alleen `agenda-weergave.tsx` gebruikt 'm. `check-levertijd` (edge) rekent met hardcoded `STANDAARD_WERKTIJDEN`, en zelfs `pickbaarheid.ts` (zelfde frontend!) roept `werkdagMinN(afleverdatum, 1)` aan zónder de config. Een ingevoerde vrije dag bestaat dus alleen in de snijplanner-agenda van die ene browser. |
| 4 | **`teLaat`-semantiek wijkt ~24u af** | Frontend `berekenAgenda`: deadline = `leverdatum T23:59:59` − buffer (eind-van-dag, soepel). Deno `berekenSnijAgenda`: `T00:00:00Z` − buffer (strikt). De UI-agenda en check-levertijd geven dezelfde rol dus een andere te-laat-vlag. Strikt is semantisch correct ("minimum N kalenderdagen tússen snij-eind en lever"). |
| 5 | **Sortering wijkt af** | Frontend: leverdatum → kwaliteit → kleur → rolnummer, NULL-leverdatum = "vandaag". Deno: leverdatum → rolId, NULL achteraan. → andere sequentiële planning → andere `klaarDatum` per rol. |
| 6 | **Vierde mini-implementatie gevonden** | `_shared/levertijd-match.ts` heeft eigen `volgendeWerkdag`/`naarWerkdag` met hardcoded za/zo-logica (`getUTCDay() === 0 || 6`) — kent geen feestdagen en geen werkdagen-config. |
| 7 | **Oplossingsrichting is bewezen haalbaar** | `derive-status.test.ts` + `order-status.contract.test.ts` importeren al direct uit `supabase/functions/_shared/` (golden-fixture-patroon). De "niet Vite-importeerbaar"-kanttekening bij `vervoerder-eisen.ts` geldt voor modules mét Deno-imports; `werkagenda.ts` is dependency-vrij. |

## Besluiten

- **B1 — SQL droppen, niet pinnen.** Mig 383 dropt de vier mig-279-functies (met pre-flight-check op onverwachte callers). Her-introductie pas wanneer een echte SQL-caller bestaat; die moet dan `app_config 'werkagenda'` lezen.
- **B2 — Kernel = `_shared/werkagenda.ts` met de rijke frontend-interface.** `'HH:mm'` + `vrij`, lokale-tijd-methodes. Edge-runtime draait TZ=UTC → daar identiek aan het oude UTC-gedrag; in de browser betekent `08:00` Amsterdamse tijd (zoals nu).
- **B3 — Frontend importeert de kernel direct** (relatieve import + `server.fs.allow` in `vite.config.ts`). Géén mirror meer. Fallback (alleen als Vite-dev of build tóch weigert): mirror-kopie behouden en de golden-contracttest is dan de borging — maar dit is niet de verwachting.
- **B4 — `teLaat` unificeren op strikt** (Deno-semantiek, `T00:00:00` − buffer): dat matcht de documentatie ("minimum aantal kalenderdagen tussen snij-eind en leverdatum") en check-levertijd bewaakt de klant-belofte. **Gedragswijziging:** de UI-agenda toont rollen eerder als "te laat" (consistent met wat check-levertijd al vond). Terugdraaien = één regel in `berekenSnijAgenda`/`berekenAgenda`.
- **B5 — Fase 2: configuratie naar `app_config 'werkagenda'`** (mig 384). UI, check-levertijd, spoed-check, pickbaarheid en levertijd-match lezen dezelfde rij. Eenmalige best-effort-overname van bestaande localStorage-config.
- **B6 — Sortering (bevinding 5) bewust NIET geünificeerd in dit plan.** `berekenAgenda` (UI) sorteert in sync met de Lijst-weergave; `berekenSnijAgenda` (edge) zou daarvoor kwaliteit/kleur/rolnummer in `fetchWerkagendaInput` nodig hebben (query-verrijking + gedragswijziging in levertijd-schattingen). Eigen besluit/detailplan waard — gedocumenteerd in de kernel-header als bekende, bewuste divergentie.

**Buiten scope:** sorterings-unificatie (B6), `iso-week.ts`-spiegel (aparte module, synchroon, eigen afweging), week-53-fixtures (weekrekenkunde leeft in `iso-week.ts`, niet hier).

**Branch/worktree:** `refactor/werkagenda-een-bron`, in een **eigen worktree** (huisregel: substantieel werk meteen in worktree; vergeet `npm install` in `frontend/` van de worktree niet). Migratienummers **383/384** — her-verifieer bij branch-start (`ls supabase/migrations/ | tail`), bump bij collisie en pas dit plan aan.

---

## Fase 1 — Eén kernel + dode SQL weg

### Task 0: Branch + worktree + nummer-check

- [ ] **Step 1: Worktree + branch aanmaken**

```bash
git worktree add "C:/Users/migue/Documents/.worktrees/werkagenda-een-bron" -b refactor/werkagenda-een-bron main
cd "C:/Users/migue/Documents/.worktrees/werkagenda-een-bron/frontend" && npm install
```

- [ ] **Step 2: Verifieer dat 383/384 vrij zijn**

```bash
ls supabase/migrations/ | sort | tail -5
```
Expected: hoogste is `382_order_documenten_xml_mime.sql`. Anders: eerstvolgende vrije nummers gebruiken en dit plan consequent aanpassen.

---

### Task 1: Golden fixture + Deno-golden-test (RED)

De fixture pint de werkdag-semantiek (weekend, jaargrens, feestdagen, afwijkende werkweek, invalid input) en wordt straks door **beide** runtimes getoetst.

**Files:**
- Create: `supabase/functions/_shared/__tests__/werkagenda.golden.json`
- Create: `supabase/functions/_shared/__tests__/werkagenda.golden.test.ts`

- [ ] **Step 1: Schrijf de golden fixture**

`supabase/functions/_shared/__tests__/werkagenda.golden.json`:

```json
{
  "comment": "Golden truthtable voor werkdagMinN — getoetst door Deno (werkagenda.golden.test.ts) én Vitest (frontend werkagenda.contract.test.ts). Eén implementatie: _shared/werkagenda.ts (plan 2026-06-12-werkagenda-een-bron).",
  "cases": [
    { "naam": "weekend-skip: ma -1 -> vr", "iso": "2026-05-18", "n": 1, "verwacht": "2026-05-15" },
    { "naam": "5 terug over weekend (ex-mig-279-assert)", "iso": "2026-05-13", "n": 5, "verwacht": "2026-05-06" },
    { "naam": "N=0 identity", "iso": "2026-05-13", "n": 0, "verwacht": "2026-05-13" },
    { "naam": "jaargrens zonder feestdag: vr 2 jan -1 -> do 1 jan", "iso": "2026-01-02", "n": 1, "verwacht": "2026-01-01" },
    { "naam": "jaargrens met nieuwjaarsdag vrij -> wo 31 dec", "iso": "2026-01-02", "n": 1, "vrij": ["2026-01-01"], "verwacht": "2025-12-31" },
    { "naam": "Koningsdag 2026 (ma 27-04) vrij: di -1 -> vr", "iso": "2026-04-28", "n": 1, "vrij": ["2026-04-27"], "verwacht": "2026-04-24" },
    { "naam": "4-daagse werkweek (vr geen werkdag): ma -1 -> do", "iso": "2026-05-18", "n": 1, "werkdagen": [1, 2, 3, 4], "verwacht": "2026-05-14" },
    { "naam": "ongeldige datum -> input terug", "iso": "geen-datum", "n": 3, "verwacht": "geen-datum" }
  ]
}
```

- [ ] **Step 2: Schrijf de Deno-golden-test**

`supabase/functions/_shared/__tests__/werkagenda.golden.test.ts`:

```ts
// Golden-contracttest (Deno-kant). De Vitest-tegenhanger leest dezelfde JSON:
// frontend/src/lib/utils/__tests__/werkagenda.contract.test.ts.
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import golden from './werkagenda.golden.json' with { type: 'json' }
import { STANDAARD_WERKTIJDEN, werkdagMinN, type Werktijden } from '../werkagenda.ts'

for (const c of golden.cases) {
  Deno.test(`werkdagMinN golden: ${c.naam}`, () => {
    const cc = c as { iso: string; n: number; verwacht: string; vrij?: string[]; werkdagen?: number[] }
    const w: Werktijden = {
      ...STANDAARD_WERKTIJDEN,
      werkdagen: cc.werkdagen ?? STANDAARD_WERKTIJDEN.werkdagen,
      vrij: (cc.vrij ?? []).map((datum) => ({ datum })),
    }
    assertEquals(werkdagMinN(cc.iso, cc.n, w), cc.verwacht)
  })
}
```

- [ ] **Step 3: Run de test — verwacht ROOD**

```powershell
deno test --allow-read "supabase/functions/_shared/__tests__/werkagenda.golden.test.ts"
```
Expected: FAIL — de huidige module kent geen `vrij`/`'HH:mm'`-interface (type-error of feestdag-cases falen).

- [ ] **Step 4: Commit (rode test mag mee — markeert de seam)**

```bash
git add supabase/functions/_shared/__tests__/
git commit -m "test(werkagenda): golden fixture + Deno-golden-test voor de kernel (RED)"
```

---

### Task 2: Kernel herschrijven — `_shared/werkagenda.ts` wordt de eigenaar

Volledige nieuwe inhoud. Lokale-tijd-methodes (edge TZ=UTC → gedragsneutraal daar), rijke interface, strikte `teLaat`.

**Files:**
- Rewrite: `supabase/functions/_shared/werkagenda.ts`
- Rewrite: `supabase/functions/_shared/werkagenda.test.ts` (TZ-agnostisch)

- [ ] **Step 1: Vervang `supabase/functions/_shared/werkagenda.ts` volledig door:**

```ts
// ----------------------------------------------------------------------------
// EIGENAAR-MODULE: werkdag- en werkagenda-rekenkunde — de enige implementatie.
// ----------------------------------------------------------------------------
// Tot 2026-06 leefde deze rekenkunde op drie plekken (SQL mig 279 — nul
// callers, gedropt in mig 383; dit bestand; frontend bereken-agenda.ts).
// Sinds plan 2026-06-12-werkagenda-een-bron is dít de enige bron: de frontend
// importeert deze module direct (patroon: order-lifecycle/derive-status).
// Er is géén mirror meer om bij te houden. Contract: __tests__/werkagenda.
// golden.json, getoetst door Deno- én Vitest-test.
//
// Tijdzone: alle functies rekenen in LOKALE tijd (getDay/setHours). In de
// edge-runtime is TZ=UTC, dus daar identiek aan de oude UTC-variant; in de
// browser betekent 'start: 08:00' Amsterdamse tijd. Voor pure datum-functies
// (werkdagMinN) maakt de tijdzone niet uit.
//
// Feestdagen/vrije dagen: dagen in `Werktijden.vrij` tellen NIET als werkdag.
// De configuratie leeft in app_config sleutel 'werkagenda' (mig 384) — edge
// én frontend lezen dezelfde rij.
//
// teLaat-semantiek (besluit B4, 2026-06-12): strikt — deadline is 00:00 van
// (leverdatum − bufferDagen), zodat er minimaal `buffer` volle kalenderdagen
// tussen snij-eind en leverdatum zitten. UI en check-levertijd zeggen nu
// hetzelfde.
//
// Bekende, bewuste divergentie (B6): berekenSnijAgenda (hier) sorteert op
// leverdatum→rolId met NULL achteraan; de UI-`berekenAgenda` (frontend
// bereken-agenda.ts) sorteert in sync met de Lijst-weergave (leverdatum→
// kwaliteit→kleur→rolnummer, NULL als vandaag). Unificatie vergt verrijking
// van fetchWerkagendaInput in check-levertijd — eigen plan.

export interface FeestdagVrij {
  /** ISO YYYY-MM-DD */
  datum: string
  naam?: string
}

export interface Werktijden {
  /** ISO werkdagen 1=ma..7=zo */
  werkdagen: number[]
  /** Starttijd 'HH:mm' */
  start: string
  /** Eindtijd 'HH:mm' */
  eind: string
  /** Pauzestart 'HH:mm' (leeg = geen pauze) */
  pauzeStart: string
  /** Pauze-eind 'HH:mm' */
  pauzeEind: string
  /** Geblokkeerde dagen (feestdagen, vakantie) */
  vrij: FeestdagVrij[]
}

export const STANDAARD_WERKTIJDEN: Werktijden = {
  werkdagen: [1, 2, 3, 4, 5],
  start: '08:00',
  eind: '17:00',
  pauzeStart: '12:00',
  pauzeEind: '12:30',
  vrij: [],
}

/** Lokale kalenderdatum als ISO YYYY-MM-DD (géén toISOString — die is UTC). */
export function isoDatum(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseHHmm(tijd: string): { uren: number; minuten: number } {
  const [h, m] = tijd.split(':').map(Number)
  return { uren: h || 0, minuten: m || 0 }
}

function heeftPauze(w: Werktijden): boolean {
  return Boolean(w.pauzeStart && w.pauzeEind && w.pauzeStart !== w.pauzeEind)
}

export function isWerkdag(d: Date, w: Werktijden): boolean {
  const js = d.getDay() // 0=zo..6=za
  const iso = js === 0 ? 7 : js
  if (!w.werkdagen.includes(iso)) return false
  if (w.vrij && w.vrij.length) {
    const dag = isoDatum(d)
    if (w.vrij.some((v) => v.datum === dag)) return false
  }
  return true
}

/**
 * Trek N werkdagen af van een ISO-datum (YYYY-MM-DD). Een werkdag = dag in
 * `werkdagen` én niet in `vrij`. Voor dag-orders (ADR 0014): pick-horizon =
 * werkdagMinN(afleverdatum, 1); kritieke snij-deadline = werkdagMinN(
 * afleverdatum, dag_order_snij_buffer_werkdagen).
 *
 * N=0 retourneert de input. Max 60 stappen veiligheidsrem; ongeldige datum
 * retourneert de input ongewijzigd.
 */
export function werkdagMinN(iso: string, n: number, w: Werktijden = STANDAARD_WERKTIJDEN): string {
  const start = new Date(`${iso}T00:00:00`)
  if (isNaN(start.getTime())) return iso
  const d = new Date(start)
  let resterend = n
  let stappen = 0
  while (resterend > 0 && stappen < 60) {
    d.setDate(d.getDate() - 1)
    stappen += 1
    if (isWerkdag(d, w)) resterend -= 1
  }
  return isoDatum(d)
}

/** Eerste moment vanaf `vanaf` dat binnen werktijd valt. */
export function volgendeWerkminuut(vanaf: Date, w: Werktijden): Date {
  const d = new Date(vanaf.getTime())
  const { uren: sU, minuten: sM } = parseHHmm(w.start)
  const { uren: eU, minuten: eM } = parseHHmm(w.eind)
  const pStart = parseHHmm(w.pauzeStart)
  const pEind = parseHHmm(w.pauzeEind)
  const pauze = heeftPauze(w)

  for (let i = 0; i < 365; i++) {
    if (isWerkdag(d, w)) {
      const startDag = new Date(d); startDag.setHours(sU, sM, 0, 0)
      const eindDag = new Date(d); eindDag.setHours(eU, eM, 0, 0)
      if (d < startDag) d.setTime(startDag.getTime())
      if (d < eindDag) {
        if (pauze) {
          const pS = new Date(d); pS.setHours(pStart.uren, pStart.minuten, 0, 0)
          const pE = new Date(d); pE.setHours(pEind.uren, pEind.minuten, 0, 0)
          if (d >= pS && d < pE) d.setTime(pE.getTime())
        }
        return d
      }
    }
    d.setDate(d.getDate() + 1)
    d.setHours(0, 0, 0, 0)
  }
  return d
}

/** Tel netto werkminuten in [van, tot) — skipt avonden, weekenden, vrije dagen, pauze. */
export function werkminutenTussen(van: Date, tot: Date, w: Werktijden): number {
  if (tot <= van) return 0
  const { uren: sU, minuten: sM } = parseHHmm(w.start)
  const { uren: eU, minuten: eM } = parseHHmm(w.eind)
  const pStart = parseHHmm(w.pauzeStart)
  const pEind = parseHHmm(w.pauzeEind)
  const pauze = heeftPauze(w)

  let totaal = 0
  const d = new Date(van); d.setHours(0, 0, 0, 0)
  const einde = tot
  for (let i = 0; i < 400 && d.getTime() <= einde.getTime(); i++) {
    if (isWerkdag(d, w)) {
      const dagStart = new Date(d); dagStart.setHours(sU, sM, 0, 0)
      const dagEind = new Date(d); dagEind.setHours(eU, eM, 0, 0)
      const blokStart = van > dagStart ? van : dagStart
      const blokEind = einde < dagEind ? einde : dagEind
      if (blokEind > blokStart) {
        let mins = Math.floor((blokEind.getTime() - blokStart.getTime()) / 60_000)
        if (pauze) {
          const pS = new Date(d); pS.setHours(pStart.uren, pStart.minuten, 0, 0)
          const pE = new Date(d); pE.setHours(pEind.uren, pEind.minuten, 0, 0)
          const overlapStart = blokStart > pS ? blokStart : pS
          const overlapEind = blokEind < pE ? blokEind : pE
          if (overlapEind > overlapStart) {
            mins -= Math.floor((overlapEind.getTime() - overlapStart.getTime()) / 60_000)
          }
        }
        if (mins > 0) totaal += mins
      }
    }
    d.setDate(d.getDate() + 1)
  }
  return totaal
}

/** Voeg N werkminuten toe (skipt avonden, weekenden, vrije dagen, pauze). */
export function plusWerkminuten(start: Date, minuten: number, w: Werktijden): Date {
  let huidig = volgendeWerkminuut(start, w)
  let resterend = minuten
  const { uren: eU, minuten: eM } = parseHHmm(w.eind)
  const pStart = parseHHmm(w.pauzeStart)
  const pauze = heeftPauze(w)

  while (resterend > 0) {
    const eindDag = new Date(huidig); eindDag.setHours(eU, eM, 0, 0)
    let blokEind = eindDag
    if (pauze) {
      const pS = new Date(huidig); pS.setHours(pStart.uren, pStart.minuten, 0, 0)
      if (huidig < pS && pS < eindDag) blokEind = pS
    }
    const beschikbaar = Math.floor((blokEind.getTime() - huidig.getTime()) / 60_000)
    if (resterend <= beschikbaar) {
      return new Date(huidig.getTime() + resterend * 60_000)
    }
    resterend -= beschikbaar
    huidig = volgendeWerkminuut(new Date(blokEind.getTime() + 1), w)
  }
  return huidig
}

// ---------------------------------------------------------------------------
// Agenda-berekening per rol (edge: check-levertijd)
// ---------------------------------------------------------------------------

export interface RolAgendaInput {
  rolId: number
  /** Vroegste afleverdatum binnen deze rol (ISO YYYY-MM-DD), null = laatst */
  vroegsteAfleverdatum: string | null
  /** Geschatte snijduur in minuten (= wisseltijd + stuks × snijtijd) */
  duurMinuten: number
}

export interface RolAgendaSlot {
  start: Date
  eind: Date
  /** ISO YYYY-MM-DD van het EIND van het rol-blok (= klaar-datum) */
  klaarDatum: string
  /** True wanneer eind > 00:00 van (vroegsteAfleverdatum − snijLeverBufferDagen). */
  teLaat: boolean
}

/**
 * Plan rollen sequentieel in een werkagenda. Sorteert op vroegste
 * afleverdatum, daarna rolId (NULL-leverdatum achteraan — zie B6-noot boven).
 */
export function berekenSnijAgenda(
  rollen: RolAgendaInput[],
  werktijden: Werktijden,
  startVanaf: Date,
  snijLeverBufferDagen: number = 2,
): Map<number, RolAgendaSlot> {
  const gesorteerd = [...rollen].sort((a, b) => {
    if (a.vroegsteAfleverdatum === b.vroegsteAfleverdatum) return a.rolId - b.rolId
    if (!a.vroegsteAfleverdatum) return 1
    if (!b.vroegsteAfleverdatum) return -1
    return a.vroegsteAfleverdatum.localeCompare(b.vroegsteAfleverdatum)
  })

  const result = new Map<number, RolAgendaSlot>()
  let cursor = startVanaf
  for (const r of gesorteerd) {
    const start = volgendeWerkminuut(cursor, werktijden)
    const eind = plusWerkminuten(start, r.duurMinuten, werktijden)
    let teLaat = false
    if (r.vroegsteAfleverdatum) {
      const deadline = new Date(`${r.vroegsteAfleverdatum}T00:00:00`)
      deadline.setDate(deadline.getDate() - snijLeverBufferDagen)
      teLaat = eind > deadline
    }
    result.set(r.rolId, { start, eind, klaarDatum: isoDatum(eind), teLaat })
    cursor = eind
  }
  return result
}
```

- [ ] **Step 2: Herschrijf `supabase/functions/_shared/werkagenda.test.ts` TZ-agnostisch**

De oude tests asserteerden `toISOString()` (UTC) — met lokale-tijd-methodes falen die op een Amsterdam-machine. Vervang het bestand volledig door:

```ts
// Deno unit tests voor werkagenda.ts — TZ-agnostisch: datums via de lokale
// constructor, asserts via de lokale klok. Groen op de dev-machine
// (Europe/Amsterdam) én in CI/edge (UTC).
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  STANDAARD_WERKTIJDEN,
  volgendeWerkminuut,
  plusWerkminuten,
  berekenSnijAgenda,
  isoDatum,
  type RolAgendaInput,
} from './werkagenda.ts'

const lokaal = (j: number, m: number, d: number, u = 0, min = 0) => new Date(j, m - 1, d, u, min)
const klok = (d: Date) =>
  `${isoDatum(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// 16 april 2026 = donderdag
const DO_8u = lokaal(2026, 4, 16, 8, 0)

Deno.test('volgendeWerkminuut: vóór 08:00 → schuift naar 08:00 zelfde dag', () => {
  assertEquals(klok(volgendeWerkminuut(lokaal(2026, 4, 16, 6, 30), STANDAARD_WERKTIJDEN)), '2026-04-16 08:00')
})

Deno.test('volgendeWerkminuut: in pauze → schuift naar 12:30', () => {
  assertEquals(klok(volgendeWerkminuut(lokaal(2026, 4, 16, 12, 15), STANDAARD_WERKTIJDEN)), '2026-04-16 12:30')
})

Deno.test('volgendeWerkminuut: zaterdag → schuift naar maandag 08:00', () => {
  assertEquals(klok(volgendeWerkminuut(lokaal(2026, 4, 18, 10, 0), STANDAARD_WERKTIJDEN)), '2026-04-20 08:00')
})

Deno.test('volgendeWerkminuut: na 17:00 → volgende werkdag 08:00', () => {
  assertEquals(klok(volgendeWerkminuut(lokaal(2026, 4, 16, 17, 30), STANDAARD_WERKTIJDEN)), '2026-04-17 08:00')
})

Deno.test('volgendeWerkminuut: vrije dag → schuift naar volgende werkdag', () => {
  const w = { ...STANDAARD_WERKTIJDEN, vrij: [{ datum: '2026-04-16', naam: 'testvrij' }] }
  assertEquals(klok(volgendeWerkminuut(lokaal(2026, 4, 16, 10, 0), w)), '2026-04-17 08:00')
})

Deno.test('plusWerkminuten: +30 min vanaf 08:00 → 08:30', () => {
  assertEquals(klok(plusWerkminuten(DO_8u, 30, STANDAARD_WERKTIJDEN)), '2026-04-16 08:30')
})

Deno.test('plusWerkminuten: +4 uur vanaf 08:00 → 12:00 (vlak vóór pauze)', () => {
  assertEquals(klok(plusWerkminuten(DO_8u, 240, STANDAARD_WERKTIJDEN)), '2026-04-16 12:00')
})

Deno.test('plusWerkminuten: +5 uur vanaf 08:00 → 13:30 (skipt 30 min pauze)', () => {
  assertEquals(klok(plusWerkminuten(DO_8u, 300, STANDAARD_WERKTIJDEN)), '2026-04-16 13:30')
})

Deno.test('plusWerkminuten: +9 uur vanaf 08:00 → volgende werkdag (overschrijdt 17:00 + pauze)', () => {
  // Beschikbare werkminuten per dag: 09:00 − 0:30 pauze = 510 min
  // 510 op donderdag → resterend 90 min op vrijdag vanaf 08:00 → 09:30
  assertEquals(klok(plusWerkminuten(DO_8u, 600, STANDAARD_WERKTIJDEN)), '2026-04-17 09:30')
})

Deno.test('plusWerkminuten: vrijdag eind van dag → maandag', () => {
  // Vrijdag 17 april 16:00 + 120 min: 60 vrijdag (→17:00) + 60 maandag → ma 09:00
  assertEquals(klok(plusWerkminuten(lokaal(2026, 4, 17, 16, 0), 120, STANDAARD_WERKTIJDEN)), '2026-04-20 09:00')
})

Deno.test('plusWerkminuten: vrije vrijdag → werk schuift naar maandag', () => {
  const w = { ...STANDAARD_WERKTIJDEN, vrij: [{ datum: '2026-04-17' }] }
  // Donderdag 16:00 + 120 min: 60 do (→17:00), vr is vrij → 60 ma → ma 09:00
  assertEquals(klok(plusWerkminuten(lokaal(2026, 4, 16, 16, 0), 120, w)), '2026-04-20 09:00')
})

// ---------------------------------------------------------------------------
// berekenSnijAgenda
// ---------------------------------------------------------------------------

Deno.test('berekenSnijAgenda: 3 rollen op vroegste-leverdatum gesorteerd', () => {
  const rollen: RolAgendaInput[] = [
    { rolId: 1, vroegsteAfleverdatum: '2026-04-25', duurMinuten: 30 },
    { rolId: 2, vroegsteAfleverdatum: '2026-04-20', duurMinuten: 60 },
    { rolId: 3, vroegsteAfleverdatum: '2026-04-22', duurMinuten: 45 },
  ]
  const agenda = berekenSnijAgenda(rollen, STANDAARD_WERKTIJDEN, DO_8u)
  const r2 = agenda.get(2)!
  const r3 = agenda.get(3)!
  const r1 = agenda.get(1)!
  assertEquals(klok(r2.start), '2026-04-16 08:00')
  assertEquals(klok(r2.eind), '2026-04-16 09:00')
  assertEquals(klok(r3.start), '2026-04-16 09:00')
  assert(r1.start.getTime() > r3.eind.getTime() - 1)
})

Deno.test('berekenSnijAgenda: rol zonder afleverdatum komt achteraan', () => {
  const rollen: RolAgendaInput[] = [
    { rolId: 1, vroegsteAfleverdatum: null, duurMinuten: 30 },
    { rolId: 2, vroegsteAfleverdatum: '2026-04-20', duurMinuten: 30 },
  ]
  const agenda = berekenSnijAgenda(rollen, STANDAARD_WERKTIJDEN, DO_8u)
  assert(agenda.get(2)!.start.getTime() < agenda.get(1)!.start.getTime())
})

Deno.test('berekenSnijAgenda: hele backlog overspant meerdere dagen', () => {
  // 20 rollen × 30 min = 600 min; 1 dag = 510 min → laatste rol klaar op vrijdag
  const rollen: RolAgendaInput[] = Array.from({ length: 20 }, (_, i) => ({
    rolId: i + 1,
    vroegsteAfleverdatum: '2026-05-01',
    duurMinuten: 30,
  }))
  const agenda = berekenSnijAgenda(rollen, STANDAARD_WERKTIJDEN, DO_8u)
  assertEquals(agenda.get(20)!.klaarDatum, '2026-04-17')
})

Deno.test('berekenSnijAgenda: teLaat strikt — eind op (lever − buffer) zelf is te laat', () => {
  // Lever ma 20-04, buffer 2 → deadline za 18-04 00:00. Snij-eind do 16-04 09:00 < deadline → op tijd.
  const opTijd = berekenSnijAgenda(
    [{ rolId: 1, vroegsteAfleverdatum: '2026-04-20', duurMinuten: 60 }],
    STANDAARD_WERKTIJDEN, DO_8u,
  )
  assertEquals(opTijd.get(1)!.teLaat, false)
  // Lever vr 17-04, buffer 2 → deadline wo 15-04 00:00. Snij-eind do 16-04 → te laat.
  const teLaat = berekenSnijAgenda(
    [{ rolId: 1, vroegsteAfleverdatum: '2026-04-17', duurMinuten: 60 }],
    STANDAARD_WERKTIJDEN, DO_8u,
  )
  assertEquals(teLaat.get(1)!.teLaat, true)
})

Deno.test('berekenSnijAgenda: lege input → lege map', () => {
  assertEquals(berekenSnijAgenda([], STANDAARD_WERKTIJDEN, DO_8u).size, 0)
})
```

- [ ] **Step 3: Run alle werkagenda-tests — verwacht GROEN (incl. golden)**

```powershell
deno test --allow-read "supabase/functions/_shared/__tests__/werkagenda.golden.test.ts" "supabase/functions/_shared/werkagenda.test.ts"
```
Expected: alle tests PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/werkagenda.ts supabase/functions/_shared/werkagenda.test.ts
git commit -m "refactor(werkagenda): kernel met rijke interface (HH:mm + vrij) als enige implementatie"
```

---

### Task 3: Edge-callers groen houden (check-levertijd, spoed-check)

`spoed-check.ts` en `check-levertijd/index.ts` hoeven **geen code-wijziging** — ze gebruiken `STANDAARD_WERKTIJDEN` en de functie-signaturen zijn gelijk gebleven; alleen de Werktijden-*shape* is veranderd en die geven ze opaque door. Wel moet `spoed-check.test.ts` TZ-agnostisch (de fake-agenda-slots zijn nu in lokale tijd).

**Files:**
- Modify: `supabase/functions/_shared/spoed-check.test.ts`
- Verify only: `supabase/functions/_shared/spoed-check.ts`, `supabase/functions/check-levertijd/index.ts`

- [ ] **Step 1: Zet alle datum-constructors in `spoed-check.test.ts` om**

Voeg bovenaan (na de imports) toe:

```ts
const lokaal = (j: number, m: number, d: number, u = 0, min = 0) => new Date(j, m - 1, d, u, min)
```

Vervang vervolgens élke `new Date('YYYY-MM-DDTHH:mm:00Z')` door de lokale tegenhanger. Volledige lijst (regelnummers van vóór de edit):

| Regel | Oud | Nieuw |
|---|---|---|
| 19 | `new Date('2026-04-16T08:00:00Z')` | `lokaal(2026, 4, 16, 8, 0)` |
| 32 | `new Date('2026-04-13T08:00:00Z')` | `lokaal(2026, 4, 13, 8, 0)` |
| 33 | `new Date('2026-04-17T17:00:00Z')` | `lokaal(2026, 4, 17, 17, 0)` |
| 46 | `new Date('2026-04-13T08:00:00Z')` | `lokaal(2026, 4, 13, 8, 0)` |
| 47 | `new Date('2026-04-21T17:00:00Z')` | `lokaal(2026, 4, 21, 17, 0)` |
| 60 | `new Date('2026-04-13T08:00:00Z')` | `lokaal(2026, 4, 13, 8, 0)` |
| 61 | `new Date('2026-04-24T17:00:00Z')` | `lokaal(2026, 4, 24, 17, 0)` |
| 73 | `new Date('2026-04-13T08:00:00Z')` | `lokaal(2026, 4, 13, 8, 0)` |
| 74 | `new Date('2026-04-17T15:00:00Z')` | `lokaal(2026, 4, 17, 15, 0)` |
| 98 | `new Date('2026-04-13T08:00:00Z')` | `lokaal(2026, 4, 13, 8, 0)` |
| 99 | `new Date('2026-04-15T17:00:00Z')` | `lokaal(2026, 4, 15, 17, 0)` |
| 114 | `new Date('2026-04-20T08:00:00Z')` | `lokaal(2026, 4, 20, 8, 0)` |
| 115 | `new Date('2026-04-20T17:00:00Z')` | `lokaal(2026, 4, 20, 17, 0)` |
| 127 | `new Date('2026-04-13T08:00:00Z')` | `lokaal(2026, 4, 13, 8, 0)` |
| 128 | `new Date('2026-04-15T17:00:00Z')` | `lokaal(2026, 4, 15, 17, 0)` |
| 139 | `new Date('2026-04-13T08:00:00Z')` | `lokaal(2026, 4, 13, 8, 0)` |
| 140 | `new Date('2026-04-17T13:00:00Z')` | `lokaal(2026, 4, 17, 13, 0)` |

De asserts op regel 85-87 (`new Date(\`${result.snij_datum}T00:00:00Z\`)`) blijven staan — die parsen twee resultaat-strings symmetrisch en zijn TZ-neutraal.

- [ ] **Step 2: Run de volledige `_shared`-testsuite + typecheck van de edge-callers**

```powershell
deno test --allow-read "supabase/functions/_shared/"
deno check "supabase/functions/check-levertijd/index.ts"
```
Expected: alle tests PASS; `deno check` zonder errors. Faalt een spoed-check-test op een week-restruimte-getal → controleer of de betreffende slot-datum correct is omgezet (de berekening zelf is ongewijzigd).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/spoed-check.test.ts
git commit -m "test(spoed-check): TZ-agnostische datum-constructors na kernel-omschakeling"
```

---

### Task 4: Frontend op de kernel — `bereken-agenda.ts` wordt dunne UI-laag

**Files:**
- Rewrite: `frontend/src/lib/utils/bereken-agenda.ts`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/lib/utils/__tests__/werkagenda.contract.test.ts`

- [ ] **Step 1: Sta imports buiten de Vite-root toe**

In `frontend/vite.config.ts`, voeg binnen `defineConfig({...})` toe (na `resolve`):

```ts
  server: {
    fs: {
      // bereken-agenda.ts importeert de werkagenda-kernel uit
      // supabase/functions/_shared/ (één bron, plan 2026-06-12).
      allow: [path.resolve(__dirname, '..')],
    },
  },
```

- [ ] **Step 2: Vervang `frontend/src/lib/utils/bereken-agenda.ts` volledig door:**

```ts
// ----------------------------------------------------------------------------
// Dunne UI-laag bovenop de werkagenda-KERNEL — géén eigen rekenkunde meer.
// ----------------------------------------------------------------------------
// De werkdag-/werkminuten-rekenkunde leeft sinds plan 2026-06-12-werkagenda-
// een-bron uitsluitend in supabase/functions/_shared/werkagenda.ts en wordt
// hier direct geïmporteerd (patroon: derive-status; vite server.fs.allow
// staat de cross-root-import toe). Contract: werkagenda.golden.json, getoetst
// in __tests__/werkagenda.contract.test.ts (Vitest) én Deno-kant.
//
// Wat hier WEL leeft: de UI-specifieke groepering/sortering van snijplan-
// stukken (berekenAgenda — sort in sync met de Lijst-weergave) en de
// generieke lanes-planner (berekenLanes, confectie).

import type { SnijplanRow } from '@/lib/types/productie'
import {
  type Werktijden,
  volgendeWerkminuut,
  plusWerkminuten,
  isoDatum,
} from '../../../../supabase/functions/_shared/werkagenda'

export type { Werktijden, FeestdagVrij } from '../../../../supabase/functions/_shared/werkagenda'
export {
  STANDAARD_WERKTIJDEN,
  isoDatum,
  isWerkdag,
  werkdagMinN,
  volgendeWerkminuut,
  plusWerkminuten,
  werkminutenTussen,
} from '../../../../supabase/functions/_shared/werkagenda'

export interface RolBlok {
  rolId: number
  rolnummer: string
  kwaliteitCode: string
  kleurCode: string
  stukken: SnijplanRow[]
  /** Vroegste leverdatum binnen deze rol (ISO) */
  vroegsteLeverdatum: string | null
  /** Starttijd van de rol in de agenda */
  start: Date
  /** Eindtijd van de rol in de agenda */
  eind: Date
  /** Duur in minuten */
  duurMinuten: number
  /** True als eind > 00:00 van (leverdatum − buffer) — strikt, zoals check-levertijd (B4) */
  teLaat: boolean
}

export interface PlanningConfigLite {
  snijtijd_minuten: number
  wisseltijd_minuten: number
}

/** Groepeer stukken per rol + plan sequentieel in werkagenda. */
export function berekenAgenda(
  stukken: SnijplanRow[],
  werktijden: Werktijden,
  planningConfig: PlanningConfigLite,
  startVanaf: Date = new Date(),
  snijLeverBufferDagen: number = 2,
): RolBlok[] {
  type Groep = {
    rolId: number
    rolnummer: string
    kwaliteitCode: string
    kleurCode: string
    stukken: SnijplanRow[]
    vroegsteLeverdatum: string | null
  }
  const map = new Map<number, Groep>()
  for (const s of stukken) {
    if (s.rol_id == null) continue
    let g = map.get(s.rol_id)
    if (!g) {
      g = {
        rolId: s.rol_id,
        rolnummer: s.rolnummer ?? '?',
        kwaliteitCode: s.kwaliteit_code ?? '',
        kleurCode: s.kleur_code ?? '',
        stukken: [],
        vroegsteLeverdatum: null,
      }
      map.set(s.rol_id, g)
    }
    g.stukken.push(s)
    if (s.afleverdatum && (!g.vroegsteLeverdatum || s.afleverdatum < g.vroegsteLeverdatum)) {
      g.vroegsteLeverdatum = s.afleverdatum
    }
  }

  // Sort-key blijft in sync met de Lijst-weergave (snijplanning-overview.tsx):
  // leverdatum → kwaliteit → kleur → rolnummer. Zo staan rollen van dezelfde
  // kwaliteit aaneengesloten in de agenda (gunstig voor wisseltijd) en klopt
  // de volgorde 1-op-1 met wat de planner in de Lijst ziet.
  //
  // Rol zonder afgesproken leverdatum (alleen NULL-stukken): behandelen we
  // als 'vandaag' voor de sort — wens is zsm snijden, dus niet achteraan
  // stoppen. Tie-break daaronder geeft rollen mét deadline voorrang bij
  // gelijke datum, zodat we nooit een afspraak verdringen.
  //
  // NB: dit wijkt bewust af van de kernel-`berekenSnijAgenda` (B6) — zie de
  // header van _shared/werkagenda.ts.
  const vandaagIso = isoDatum(new Date())
  const groepen = Array.from(map.values()).sort((a, b) => {
    const aD = a.vroegsteLeverdatum ?? vandaagIso
    const bD = b.vroegsteLeverdatum ?? vandaagIso
    if (aD !== bD) return aD.localeCompare(bD)
    // Bij gelijke effectieve datum: echte deadline vóór NULL.
    const nullA = a.vroegsteLeverdatum == null ? 1 : 0
    const nullB = b.vroegsteLeverdatum == null ? 1 : 0
    if (nullA !== nullB) return nullA - nullB
    const k = a.kwaliteitCode.localeCompare(b.kwaliteitCode)
    if (k !== 0) return k
    const c = a.kleurCode.localeCompare(b.kleurCode)
    if (c !== 0) return c
    return a.rolnummer.localeCompare(b.rolnummer)
  })

  const blokken: RolBlok[] = []
  let cursor = startVanaf
  for (const g of groepen) {
    const duur = planningConfig.wisseltijd_minuten
      + g.stukken.length * planningConfig.snijtijd_minuten
    const start = volgendeWerkminuut(cursor, werktijden)
    const eind = plusWerkminuten(start, duur, werktijden)
    // teLaat strikt (B4): deadline = 00:00 van (leverdatum − buffer), zodat er
    // minimaal `buffer` volle kalenderdagen tussen snij-eind en lever zitten.
    // Identiek aan kernel-berekenSnijAgenda → UI en check-levertijd zeggen
    // nu hetzelfde.
    let teLaat = false
    if (g.vroegsteLeverdatum) {
      const deadline = new Date(g.vroegsteLeverdatum + 'T00:00:00')
      deadline.setDate(deadline.getDate() - snijLeverBufferDagen)
      teLaat = eind > deadline
    }
    blokken.push({
      rolId: g.rolId,
      rolnummer: g.rolnummer,
      kwaliteitCode: g.kwaliteitCode,
      kleurCode: g.kleurCode,
      stukken: g.stukken,
      vroegsteLeverdatum: g.vroegsteLeverdatum,
      start,
      eind,
      duurMinuten: duur,
      teLaat,
    })
    cursor = eind
  }
  return blokken
}

export interface LaneBlok<TItem> {
  item: TItem
  start: Date
  eind: Date
  duurMinuten: number
}

export interface BerekenLanesOpties<TItem, TKey> {
  laneKey: (item: TItem) => TKey
  duur: (item: TItem) => number
  sortKey: (item: TItem) => string | number
  startVanaf?: Date
  /** Minimum-starttijd per item (bv. rol-klaar + buffer). Lane-cursor wordt hiermee opgetrokken. */
  minStart?: (item: TItem) => Date | null | undefined
}

/**
 * Generieke lanes-planner: groepeert items per laneKey en plant binnen elke lane
 * sequentieel in de werkagenda. Lanes lopen onafhankelijk parallel (elk met eigen cursor).
 */
export function berekenLanes<TItem, TKey>(
  items: TItem[],
  werktijden: Werktijden,
  opties: BerekenLanesOpties<TItem, TKey>,
): Map<TKey, Array<LaneBlok<TItem>>> {
  const { laneKey, duur, sortKey, minStart, startVanaf = new Date() } = opties

  const perLane = new Map<TKey, TItem[]>()
  for (const it of items) {
    const key = laneKey(it)
    const lijst = perLane.get(key) ?? []
    lijst.push(it)
    perLane.set(key, lijst)
  }

  const resultaat = new Map<TKey, Array<LaneBlok<TItem>>>()
  for (const [key, lijst] of perLane) {
    const gesorteerd = [...lijst].sort((a, b) => {
      const sa = sortKey(a)
      const sb = sortKey(b)
      if (sa === sb) return 0
      if (typeof sa === 'number' && typeof sb === 'number') return sa - sb
      return String(sa).localeCompare(String(sb))
    })
    const blokken: Array<LaneBlok<TItem>> = []
    let cursor = startVanaf
    for (const item of gesorteerd) {
      const d = duur(item)
      const ms = minStart?.(item)
      const vanaf = ms && ms > cursor ? ms : cursor
      const start = volgendeWerkminuut(vanaf, werktijden)
      const eind = plusWerkminuten(start, d, werktijden)
      blokken.push({ item, start, eind, duurMinuten: d })
      cursor = eind
    }
    resultaat.set(key, blokken)
  }
  return resultaat
}
```

- [ ] **Step 3: Schrijf de Vitest-contracttest**

`frontend/src/lib/utils/__tests__/werkagenda.contract.test.ts`:

```ts
// Contracttest: de frontend consumeert exact dezelfde werkagenda-kernel als
// de edge (geen mirror; plan 2026-06-12-werkagenda-een-bron). Deze test pint
// de werkdag-semantiek met dezelfde golden fixture als de Deno-test —
// patroon: derive-status.test.ts.
import { describe, it, expect } from 'vitest'
import golden from '../../../../../supabase/functions/_shared/__tests__/werkagenda.golden.json'
import { STANDAARD_WERKTIJDEN, werkdagMinN, type Werktijden } from '../bereken-agenda'

describe('werkagenda: frontend ≡ golden truthtable', () => {
  for (const c of golden.cases) {
    it(c.naam, () => {
      const cc = c as { iso: string; n: number; verwacht: string; vrij?: string[]; werkdagen?: number[] }
      const w: Werktijden = {
        ...STANDAARD_WERKTIJDEN,
        werkdagen: cc.werkdagen ?? STANDAARD_WERKTIJDEN.werkdagen,
        vrij: (cc.vrij ?? []).map((datum) => ({ datum })),
      }
      expect(werkdagMinN(cc.iso, cc.n, w)).toBe(cc.verwacht)
    })
  }
})
```

- [ ] **Step 4: Verifieer frontend — typecheck, tests, dev-import**

```powershell
cd frontend; npm run typecheck; npx vitest run src/lib/utils/__tests__/werkagenda.contract.test.ts
npx vitest run
```
Expected: typecheck schoon; contracttest 8/8 PASS; volledige suite groen **behalve** `magazijn-pickbaarheid.contract.test.ts` (faalt 7/7 pre-existing op main — mockt `zendingen` i.p.v. `zending_orders`, niet door dit werk geraakt).

Start daarna kort de dev-server en open de snijplanning-agenda om de cross-root-import te bewijzen:

```powershell
npm run dev
```
Expected: geen Vite "outside of Vite serving allow list"-fout; agenda-weergave rendert. (Faalt dit tóch → fallback B3: zet de kernel-functies terug als lokale kopie in dit bestand en laat de contracttest de pariteit bewaken; meld dit expliciet in de commit.)

- [ ] **Step 5: Commit**

```bash
git add frontend/vite.config.ts frontend/src/lib/utils/bereken-agenda.ts frontend/src/lib/utils/__tests__/werkagenda.contract.test.ts
git commit -m "refactor(frontend): bereken-agenda consumeert werkagenda-kernel direct (één bron) + golden-contracttest

Gedragswijziging (B4): teLaat in de UI-agenda is nu strikt (00:00-deadline),
consistent met check-levertijd."
```

---

### Task 5: Dode SQL droppen (mig 383)

**Files:**
- Create: `supabase/migrations/383_drop_ongebruikte_werkagenda_sql.sql`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 383: drop ongebruikte werkagenda-SQL-functies (mig 279)
--
-- Mig 279 introduceerde werkdag_offset_n / werkdag_plus_n / werkdag_min_n /
-- werkagenda_kalender als "SQL ground-truth", maar er is nooit één SQL-caller
-- gekomen (geverifieerd 2026-06-12: nul verwijzingen in views/RPC's, repo én
-- live). De levende bron is supabase/functions/_shared/werkagenda.ts (plan
-- 2026-06-12-werkagenda-een-bron). Drie definities onderhouden voor nul
-- SQL-gebruik is puur divergentie-risico — vandaar drop. Her-introduceer pas
-- wanneer een echte SQL-caller bestaat, en laat die dan de werkagenda-config
-- uit app_config sleutel 'werkagenda' (mig 384) lezen i.p.v. hardcoded ma-vr.

-- Pre-flight: faal hard als een functie-body tóch naar de helpers verwijst
-- (DROP ... RESTRICT vangt alleen views/geregistreerde dependencies, geen
-- dynamische plpgsql-aanroepen).
DO $$
DECLARE v_caller TEXT;
BEGIN
  SELECT p.proname INTO v_caller
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (p.prosrc ILIKE '%werkdag\_offset\_n%' ESCAPE '\'
       OR p.prosrc ILIKE '%werkdag\_plus\_n%'   ESCAPE '\'
       OR p.prosrc ILIKE '%werkdag\_min\_n%'    ESCAPE '\'
       OR p.prosrc ILIKE '%werkagenda\_kalender%' ESCAPE '\')
     AND p.proname NOT IN ('werkdag_offset_n', 'werkdag_plus_n', 'werkdag_min_n', 'werkagenda_kalender')
   LIMIT 1;
  IF v_caller IS NOT NULL THEN
    RAISE EXCEPTION 'mig 383: functie "%" verwijst nog naar de werkagenda-helpers — niet droppen', v_caller;
  END IF;
END $$;

-- Wrappers eerst, dan de kern (RESTRICT default: een onverwachte view-dependency laat de drop falen).
DROP FUNCTION IF EXISTS werkdag_min_n(DATE, INTEGER);
DROP FUNCTION IF EXISTS werkdag_plus_n(DATE, INTEGER);
DROP FUNCTION IF EXISTS werkdag_offset_n(DATE, INTEGER);
DROP FUNCTION IF EXISTS werkagenda_kalender(DATE, DATE);

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Pas toe in de Supabase SQL Editor** (migraties gaan handmatig — MCP heeft geen toegang tot het Karpi-project)

Expected: `Success. No rows returned`. Een exception uit de pre-flight of een RESTRICT-fout = er bestaat tóch een live caller → stop, onderzoek, en laat de functies dan staan (plan-aanname vervalt).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/383_drop_ongebruikte_werkagenda_sql.sql
git commit -m "chore(db): drop ongebruikte werkagenda-SQL uit mig 279 (mig 383) — nul callers"
```

---

### Task 6: Docs fase 1 (levende documenten — verplicht)

**Files:**
- Modify: `docs/changelog.md` (entry bovenaan)
- Modify: `docs/architectuur.md` (seam-/spiegel-sectie: werkagenda is geen mirror meer)
- Modify: `CLAUDE.md` (de `lever_type`-bullet verwijst naar "helper `werkdagMinN` in bereken-agenda.ts + werkagenda.ts" → één kernel)
- Modify: `docs/superpowers/plans/2026-06-09-ts-sql-spiegeling-seam-consolidatie.md` (rij 5C + losse-opruiming-bullet afvinken met verwijzing)

- [ ] **Step 1: Changelog-entry toevoegen** (stijl van bestaande entries volgen)

```markdown
### 2026-06-12 — Werkagenda: één bron (kernel-consolidatie, mig 383)

De werkdag-/werkagenda-rekenkunde leefde op drie plekken: SQL (mig 279 — nul
callers, dode code), Deno `_shared/werkagenda.ts` (UTC, geen feestdagen) en
frontend `bereken-agenda.ts` (lokale tijd, wél feestdagen) — met al-uiteengelopen
interfaces, ~24u verschil in `teLaat`-semantiek en andere sortering.
Geconsolideerd: `_shared/werkagenda.ts` is nu de enige implementatie (rijke
interface met 'HH:mm' + `vrij`-feestdagen); de frontend importeert de kernel
direct (derive-status-patroon, vite `server.fs.allow`); golden fixture
`werkagenda.golden.json` wordt door Deno én Vitest getoetst; de dode SQL is
gedropt (mig 383). `teLaat` is geünificeerd op strikt (00:00-deadline) — de
UI-agenda en check-levertijd geven nu dezelfde vlag. Sorterings-verschil
berekenAgenda↔berekenSnijAgenda blijft bewust staan (B6, kernel-header).
```

- [ ] **Step 2: CLAUDE.md-verwijzing bijwerken**

In de `lever_type`-bullet: vervang `(helper `werkdagMinN` in [`bereken-agenda.ts`](frontend/src/lib/utils/bereken-agenda.ts) + [`werkagenda.ts`](supabase/functions/_shared/werkagenda.ts))` door `(helper `werkdagMinN` in de werkagenda-kernel [`_shared/werkagenda.ts`](supabase/functions/_shared/werkagenda.ts); frontend importeert die direct via `bereken-agenda.ts`)`.

- [ ] **Step 3: architectuur.md + plan-2026-06-09 bijwerken**

In `docs/architectuur.md`: noteer in de seam-/spiegel-paragraaf dat werkagenda géén TS↔TS-mirror meer is maar een direct geïmporteerde kernel (uitzondering op het mirror-patroon; voorwaarde: dependency-vrije module). In het 2026-06-09-plan: markeer rij 5C en de losse-opruiming-bullet "Werkagenda dode-SQL drop" als uitgevoerd → verwijs naar dit plan.

- [ ] **Step 4: Commit + typecheck-gate vóór merge-melding**

```powershell
cd frontend; npm run typecheck
git add docs/changelog.md docs/architectuur.md CLAUDE.md docs/superpowers/plans/2026-06-09-ts-sql-spiegeling-seam-consolidatie.md
git commit -m "docs(werkagenda): changelog/architectuur/CLAUDE.md na kernel-consolidatie"
```

Fase 1 is hiermee zelfstandig shippable. Meld klaar voor merge (niet zelf mergen; merge via push `branch:main` naar origin i.v.m. parallelle sessies).

---

## Fase 2 — Configuratie naar `app_config` (feestdag landt één keer, overal)

Zonder deze fase rekent check-levertijd nog steeds met hardcoded ma-vr 08:00-17:00 terwijl de UI een per-browser-localStorage-config gebruikt. Deze fase maakt `app_config 'werkagenda'` de enige configuratie-bron.

### Task 7: mig 384 — config-seed

**Files:**
- Create: `supabase/migrations/384_app_config_werkagenda.sql`

- [ ] **Step 1: Schrijf + apply de migratie (SQL Editor)**

```sql
-- Migratie 384: werkagenda-configuratie centraal in app_config
--
-- Werktijden + vrije dagen (feestdagen/vakantie) stonden tot nu in
-- localStorage ('karpi.werkagenda.werktijden') — per browser, onzichtbaar
-- voor edge functions. Eén rij voor alle clients: UI (productie-instellingen,
-- snijplanning-agenda), check-levertijd, spoed-check en Pick & Ship-horizon
-- lezen dezelfde kalender. Shape spiegelt de Werktijden-interface van
-- supabase/functions/_shared/werkagenda.ts (de kernel).

INSERT INTO app_config (sleutel, waarde)
VALUES ('werkagenda', jsonb_build_object(
  'werkdagen',  jsonb_build_array(1, 2, 3, 4, 5),
  'start',      '08:00',
  'eind',       '17:00',
  'pauzeStart', '12:00',
  'pauzeEind',  '12:30',
  'vrij',       jsonb_build_array()
))
ON CONFLICT (sleutel) DO NOTHING;

NOTIFY pgrst, 'reload schema';
```
Expected: `Success`. Verifieer: `SELECT waarde FROM app_config WHERE sleutel = 'werkagenda';` → de default-JSON.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/384_app_config_werkagenda.sql
git commit -m "feat(db): app_config 'werkagenda' — werktijden + vrije dagen centraal (mig 384)"
```

---

### Task 8: Frontend-hook van localStorage naar app_config

**Files:**
- Create: `frontend/src/lib/supabase/queries/werkagenda.ts`
- Modify: `frontend/src/components/werkagenda/werktijden-config.tsx` (alleen `useWerktijden`; de UI-componenten blijven ongewijzigd)

- [ ] **Step 1: Query-module schrijven**

`frontend/src/lib/supabase/queries/werkagenda.ts`:

```ts
// Werkagenda-configuratie (werktijden + vrije dagen) — app_config 'werkagenda'
// (mig 384). Eén rij voor alle clients: UI, check-levertijd (edge) en
// Pick & Ship lezen dezelfde kalender (plan 2026-06-12-werkagenda-een-bron).
import { supabase } from '../client'
import { STANDAARD_WERKTIJDEN, type Werktijden } from '@/lib/utils/bereken-agenda'

export async function fetchWerkagendaConfig(): Promise<Werktijden> {
  const { data, error } = await supabase
    .from('app_config')
    .select('waarde')
    .eq('sleutel', 'werkagenda')
    .maybeSingle()
  if (error) throw error
  return { ...STANDAARD_WERKTIJDEN, ...((data?.waarde ?? {}) as Partial<Werktijden>) }
}

export async function saveWerkagendaConfig(w: Werktijden): Promise<void> {
  const { error } = await supabase
    .from('app_config')
    .update({ waarde: w as unknown as Record<string, unknown> })
    .eq('sleutel', 'werkagenda')
  if (error) throw error
}
```

- [ ] **Step 2: `useWerktijden` ombouwen**

In `frontend/src/components/werkagenda/werktijden-config.tsx`: vervang de bestaande `useWerktijden` (regels 6-29, incl. de twee STORAGE_KEY-constanten blijven staan voor de eenmalige overname) door:

```tsx
import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWerkagendaConfig, saveWerkagendaConfig } from '@/lib/supabase/queries/werkagenda'

export function useWerktijden(): [Werktijden, (w: Werktijden) => void] {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['werkagenda-config'],
    queryFn: fetchWerkagendaConfig,
    staleTime: 60_000,
  })
  const mutation = useMutation({
    mutationFn: saveWerkagendaConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['werkagenda-config'] }),
  })

  const setWerktijden = (w: Werktijden) => {
    // Optimistisch zodat de agenda direct herrekent; mutatie persisteert.
    queryClient.setQueryData(['werkagenda-config'], w)
    mutation.mutate(w)
  }

  // Eenmalige overname van de oude per-browser localStorage-config: alleen
  // als de DB-rij nog exact de default is (= nooit centraal aangepast) nemen
  // we de lokale instellingen over; daarna verdwijnt de localStorage-key.
  const adoptie = useRef(false)
  useEffect(() => {
    if (!data || adoptie.current) return
    adoptie.current = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
      if (raw) {
        const lokaal = { ...STANDAARD_WERKTIJDEN, ...JSON.parse(raw) } as Werktijden
        const dbIsDefault = JSON.stringify(data) === JSON.stringify(STANDAARD_WERKTIJDEN)
        const lokaalAfwijkend = JSON.stringify(lokaal) !== JSON.stringify(STANDAARD_WERKTIJDEN)
        if (dbIsDefault && lokaalAfwijkend) setWerktijden(lokaal)
      }
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch { /* ignore */ }
  }, [data])

  return [data ?? STANDAARD_WERKTIJDEN, setWerktijden]
}
```

(Imports bovenaan het bestand samenvoegen met de bestaande; `useState` vervalt als die nergens anders gebruikt wordt.)

- [ ] **Step 3: Verifieer**

```powershell
cd frontend; npm run typecheck; npx vitest run
npm run dev
```
Expected: typecheck schoon; suite groen (zelfde pre-existing uitzondering). In de dev-app: pas op `/instellingen` (Productie) een werktijd + vrije dag aan → herlaad in een **andere** browser/incognito → instellingen staan er ook (= DB, niet localStorage).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/supabase/queries/werkagenda.ts frontend/src/components/werkagenda/werktijden-config.tsx
git commit -m "feat(werkagenda): werktijden + vrije dagen uit app_config i.p.v. localStorage (één bron voor alle clients)"
```

---

### Task 9: Edge consumeert de config (check-levertijd + levertijd-match)

**Files:**
- Modify: `supabase/functions/_shared/levertijd-types.ts` (`LevertijdConfig` + werktijden-veld)
- Modify: `supabase/functions/check-levertijd/index.ts` (`fetchConfig` + 3 call-sites)
- Modify: `supabase/functions/_shared/levertijd-match.ts` (`volgendeWerkdag`/`naarWerkdag` op kernel-`isWerkdag`)
- Modify: `supabase/functions/_shared/spoed-check.test.ts` (defaultConfig krijgt verplicht veld)

- [ ] **Step 1: `LevertijdConfig` uitbreiden**

In `supabase/functions/_shared/levertijd-types.ts`: voeg aan het `LevertijdConfig`-interface toe (+ import):

```ts
import type { Werktijden } from './werkagenda.ts'
// ... in interface LevertijdConfig:
  /** Werkagenda (app_config 'werkagenda', mig 384) — werkdagen/tijden/vrije dagen */
  werktijden: Werktijden
```

Werk de `DEFAULT_CONFIG`-definitie bij (staat in `check-levertijd/index.ts` of `levertijd-types.ts` — zoek op `DEFAULT_CONFIG`): voeg `werktijden: STANDAARD_WERKTIJDEN,` toe.

- [ ] **Step 2: `fetchConfig` leest de werkagenda-rij**

In `supabase/functions/check-levertijd/index.ts` (regel ~75-79): breid de sleutel-lijst uit en parse:

```ts
    .in('sleutel', ['productie_planning', 'order_config', 'werkagenda'])
```
en in de row-loop een extra tak:

```ts
    if (row.sleutel === 'werkagenda') {
      cfg.werktijden = { ...STANDAARD_WERKTIJDEN, ...(row.waarde as Partial<Werktijden>) }
    }
```

- [ ] **Step 3: De drie call-sites van `STANDAARD_WERKTIJDEN` omzetten naar `cfg.werktijden`**

| Plek | Oud | Nieuw |
|---|---|---|
| `index.ts` ~r330 | `berekenSnijAgenda(agendaInput, STANDAARD_WERKTIJDEN, new Date(), cfg.logistieke_buffer_dagen)` | `berekenSnijAgenda(agendaInput, cfg.werktijden, new Date(), cfg.logistieke_buffer_dagen)` |
| `index.ts` ~r381 | `werkdagMinN(gewenste_leverdatum, cfg.dag_order_snij_buffer_werkdagen, STANDAARD_WERKTIJDEN)` | `werkdagMinN(gewenste_leverdatum, cfg.dag_order_snij_buffer_werkdagen, cfg.werktijden)` |
| `index.ts` ~r415 | `evalueerSpoed(werkagenda, nieuwStukDuur, cfg, new Date())` | `evalueerSpoed(werkagenda, nieuwStukDuur, cfg, new Date(), cfg.werktijden)` |

- [ ] **Step 4: `volgendeWerkdag`/`naarWerkdag` op de kernel**

In `supabase/functions/_shared/levertijd-match.ts`: vervang de twee hardcoded za/zo-functies (r86-93 en r151-157) door kernel-gedreven varianten (import `isWerkdag, isoDatum, STANDAARD_WERKTIJDEN, type Werktijden` uit `./werkagenda.ts`):

```ts
export function volgendeWerkdag(vanaf: Date = new Date(), w: Werktijden = STANDAARD_WERKTIJDEN): string {
  const d = new Date(vanaf.getFullYear(), vanaf.getMonth(), vanaf.getDate())
  for (let i = 0; i < 60; i++) {
    d.setDate(d.getDate() + 1)
    if (isWerkdag(d, w)) break
  }
  return isoDatum(d)
}

export function naarWerkdag(isoDate: string, w: Werktijden = STANDAARD_WERKTIJDEN): string {
  const d = new Date(`${isoDate}T00:00:00`)
  if (isNaN(d.getTime())) return isoDate
  for (let i = 0; i < 60 && !isWerkdag(d, w); i++) {
    d.setDate(d.getDate() + 1)
  }
  return isoDatum(d)
}
```

Zoek daarna alle call-sites en geef de config door waar een `cfg` voorhanden is:

```powershell
rg -n "volgendeWerkdag|naarWerkdag|leverdatumVoorSnijDatum" supabase/functions
```
Per call-site in `check-levertijd/index.ts` en `levertijd-match.ts` zelf (`leverdatumVoorSnijDatum` → geef `w` door als extra param met default): voeg `cfg.werktijden` resp. de doorgegeven `w` toe. Call-sites in pure helpers zonder cfg-toegang behouden de `STANDAARD_WERKTIJDEN`-default (gedragsneutraal).

- [ ] **Step 5: `spoed-check.test.ts` defaultConfig aanvullen**

`defaultConfig` bouwt een compleet `LevertijdConfig`-object — het nieuwe verplichte veld toevoegen:

```ts
import { STANDAARD_WERKTIJDEN } from './werkagenda.ts'
// ... in defaultConfig-return:
    werktijden: STANDAARD_WERKTIJDEN,
```

- [ ] **Step 6: Verifieer + deploy**

```powershell
deno check "supabase/functions/check-levertijd/index.ts"
deno test --allow-read "supabase/functions/_shared/"
supabase functions deploy check-levertijd --project-ref wqzeevfobwauxkalagtn
```
Expected: check + tests groen; deploy succesvol. Smoke-test daarna in de app: open een maatwerk-orderregel zodat check-levertijd vuurt → respons zonder fout (Supabase logs bij twijfel).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/levertijd-types.ts supabase/functions/_shared/levertijd-match.ts supabase/functions/_shared/spoed-check.test.ts supabase/functions/check-levertijd/index.ts
git commit -m "feat(levertijd): check-levertijd rekent met centrale werkagenda-config (feestdagen + werktijden uit app_config)"
```

---

### Task 10: Pick & Ship-horizon + docs fase 2

**Files:**
- Modify: `frontend/src/modules/magazijn/queries/pickbaarheid.ts` (~r116)
- Modify: `docs/changelog.md`, `docs/database-schema.md` (app_config-sleutel), `CLAUDE.md` (lever_type-bullet: horizon gebruikt centrale config)

- [ ] **Step 1: Dag-order-horizon met centrale config**

In `frontend/src/modules/magazijn/queries/pickbaarheid.ts`: importeer `fetchWerkagendaConfig` uit `@/lib/supabase/queries/werkagenda`, haal de config op naast de bestaande order-fetches in `fetchPickShipOrders` (in de bestaande `Promise.all` of als extra await vóór de filter-stap):

```ts
  const werktijden = await fetchWerkagendaConfig()
```
en vervang regel ~116:

```ts
      const horizon = werkdagMinN(header.afleverdatum, 1)
```
door:

```ts
      const horizon = werkdagMinN(header.afleverdatum, 1, werktijden)
```
(Met als effect: valt een feestdag op de dag vóór een dag-order-aflevering, dan verschijnt de order een werkdag eerder in Pick & Ship — exact de bedoeling.)

- [ ] **Step 2: Verifieer**

```powershell
cd frontend; npm run typecheck; npx vitest run
```
Expected: groen (zelfde pre-existing uitzondering).

- [ ] **Step 3: Docs**

Changelog-entry (onder de fase-1-entry van Task 6, of als aparte 2026-06-XX-entry als fase 2 later landt):

```markdown
### 2026-06-12 — Werkagenda-config centraal (mig 384, fase 2)

Werktijden + vrije dagen verhuisd van per-browser-localStorage naar
`app_config 'werkagenda'`. UI (productie-instellingen, snijplanning-agenda),
`check-levertijd`/`spoed-check` (edge) en de Pick & Ship-dag-order-horizon
lezen nu dezelfde kalender — een feestdag invoeren landt één keer en telt
overal. `volgendeWerkdag`/`naarWerkdag` (levertijd-match) lopen nu ook via
kernel-`isWerkdag` i.p.v. hardcoded za/zo. Eenmalige best-effort-overname van
bestaande localStorage-instellingen (alleen als de DB-rij nog default is).
```

`docs/database-schema.md`: documenteer de nieuwe `app_config`-sleutel `werkagenda` (shape + mig 384). `CLAUDE.md`: in de `lever_type`-bullet vermelden dat de horizon de centrale werkagenda-config gebruikt.

- [ ] **Step 4: Commit + typecheck-gate + klaar-melding**

```powershell
cd frontend; npm run typecheck
git add frontend/src/modules/magazijn/queries/pickbaarheid.ts docs/changelog.md docs/database-schema.md CLAUDE.md
git commit -m "feat(magazijn): dag-order-horizon gebruikt centrale werkagenda-config + docs fase 2"
```

Meld de branch klaar voor merge (merge op commando, via push `branch:main` naar origin). Vermeld in de melding expliciet: (1) de teLaat-gedragswijziging in de UI-agenda (B4), (2) dat `check-levertijd` opnieuw deployed is, (3) dat operators hun werktijden nu centraal beheren en localStorage-instellingen eenmalig zijn overgenomen.

---

## Self-Review

**1. Spec-dekking:** De drie gesignaleerde implementaties zijn elk geadresseerd: SQL → drop (Task 5), Deno + frontend → één kernel (Task 2-4). Het "minimaal"-voorstel (contracttest met gedeelde golden fixtures incl. jaargrens/feestdagen) zit in Task 1+4; het "maximaal"-voorstel (frontend importeert `_shared` direct) is de gekozen hoofdroute (B3, met fallback). De tijdens onderzoek extra gevonden divergenties hebben elk een plek: feestdagen/localStorage (fase 2), teLaat (B4, Task 2+4), vierde mini-implementatie `naarWerkdag`/`volgendeWerkdag` (Task 9), sortering (bewust B6/buiten scope, gedocumenteerd in de kernel-header).

**2. Placeholder-scan:** Alle code-stappen bevatten volledige bestanden of exacte voor/na-regels; de twee zoek-stappen (DEFAULT_CONFIG-locatie in Task 9 Step 1, call-sites-grep in Task 9 Step 4) geven het exacte zoekcommando, het wijzigingspatroon en de verwachte vindplaatsen. Geen TBD's.

**3. Type-consistentie:** `Werktijden` (werkdagen/start/eind/pauzeStart/pauzeEind/vrij) is identiek in kernel (Task 2), golden-tests (Task 1/4), mig 384-JSON (Task 7), query-module (Task 8) en `LevertijdConfig.werktijden` (Task 9). `werkdagMinN(iso, n, w?)`-signatuur is overal gelijk; `isoDatum` wordt door kernel geëxporteerd en in Task 4 (vandaagIso) en Task 9 (levertijd-match) geconsumeerd. Migratienummers 383/384 consistent, met collisie-guard in Task 0.

**Bekende risico's:** (a) Vite-dev cross-root-import — fallback expliciet in Task 4 Step 4; (b) lokale-tijd-methodes draaien op de dev-machine in Europe/Amsterdam terwijl edge UTC draait — alle tests zijn bewust TZ-agnostisch herschreven (Task 2 Step 2, Task 3 Step 1); (c) mig 383-drop in live DB — dubbele guard (pre-flight DO-block + RESTRICT).
