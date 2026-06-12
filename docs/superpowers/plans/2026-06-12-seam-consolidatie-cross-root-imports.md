# Seam-consolidatie: cross-root imports i.p.v. kopieën — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De vier handmatig-gesynchroniseerde kopieparen tussen `supabase/functions/_shared/` en `frontend/src/` vervangen door één bron-van-waarheid in `_shared/` met dunne frontend re-export-shims, zodat de incident-klasse "kopie vergeten bij te werken" (SSCC-incident 12-06) structureel onmogelijk wordt.

**Architecture:** `supabase/functions/_shared/` wordt de single source voor pure gedeelde logica — Deno kán niet uit `frontend/` importeren (deploy-bundeling), maar de frontend kan aantoonbaar wél cross-root uit `_shared/` importeren (de contracttests `derive-status.test.ts` en `order-status.contract.test.ts` doen dit al). Frontend-bestanden blijven op hun bestaande pad bestaan als re-export-shim (consumers raken niet aan), eventueel met frontend-only extensies eronder. Alleen *pure* modules (geen Deno-API's, geen https-imports, geen DB) komen in aanmerking.

**Tech Stack:** TypeScript (`moduleResolution: bundler`, `allowImportingTsExtensions: true` — extensieloos importeren werkt), Vite 7 (dev-server heeft `server.fs.allow`-verruiming nodig voor bestanden buiten `frontend/`), Vitest, Deno (edge functions).

---

## Onderzoeksbevindingen (geverifieerd 2026-06-12)

| Paar | _shared (Deno) | frontend | Status |
|---|---|---|---|
| vervoerder-eisen | `_shared/vervoerder-eisen.ts` | `src/lib/orders/vervoerder-eisen.ts` | Functioneel identiek (alleen stijl/comments). Frontend-kopie is **dead code**: nul consumers. |
| iso-week | `_shared/iso-week.ts` | `src/lib/utils/iso-week.ts` | Kern (6 functies) body-identiek; frontend heeft 5 extra functies (deels bewust frontend-only: `lokaleDatumAlsUtc`). |
| snijplan-status | `_shared/snijplan-status.ts` | `src/lib/utils/snijplan-status.ts` | Frontend is **strikte superset** (+ `CONFECTIE_STATUSSEN`, `INPAK_KANDIDAAT`, `CONFECTIE_INSTROOM`, `isSnijplanStatus`). Gedeelde exports identiek. De `_shared`-header anticipeert deze consolidatie al ("Tot de Fase 3-shim Deno↔Vite koppelt"). |
| email-list / email-recipients | `_shared/email-list.ts` | `src/lib/email-recipients.ts` | `splitEmailRecipients` body-identiek; frontend heeft extra `parseEmailRecipients` + `EMAIL_RE`. |

**Cross-root precedent:** `frontend/src/lib/orders/__tests__/derive-status.test.ts:8` importeert `../../../../../supabase/functions/_shared/order-lifecycle/derive-status` — werkt onder Vitest. Voor productie-code is de Vite **dev-server** het enige nieuwe risico: `server.fs.allow` staat standaard mogelijk geen bestanden buiten `frontend/` toe (de build en Vitest hebben die beperking niet). Task 2 lost dat op en verifieert het expliciet.

**Bewuste keuzes:**
- Richting: `_shared` = bron. Andersom kan niet (Deno-deploy bundelt relatieve imports; `../../frontend/src/...` in een edge function is fragiel/onbundelbaar).
- Frontend-shims behouden de bestaande paden (`@/lib/utils/iso-week` etc.) — geen import-churn bij 20+ consumers, CLAUDE.md-verwijzingen blijven kloppen.
- `vervoerder-eisen` frontend wordt een shim (geen delete): CLAUDE.md/ADR-0030 documenteert het pad voor toekomstig Pick & Ship-gebruik.
- Geen equivalentie-contracttests per paar nodig: na consolidatie ís er maar één implementatie — de bestaande tests (frontend + Deno) draaien er via shim resp. direct tegenaan.
- `werkagenda.ts` ↔ `bereken-agenda.ts` is **bewust buiten scope**: dat paar heeft gedocumenteerde gedragsverschillen (zie comment "Naam↔gedrag-mapping (code-review S2)" in `bereken-agenda.ts`) — consolideren is daar een apart, inhoudelijk traject.

**Bekend pre-existing falen:** `magazijn-pickbaarheid.contract.test.ts` faalt 7/7 op main (mockt `zendingen` i.p.v. `zending_orders`). Negeren — geen regressie van dit werk.

---

### Task 1: Worktree + branch aanmaken

**Files:** geen (omgeving)

- [ ] **Step 1: Maak een worktree met branch `refactor/seam-cross-root-imports`**

```bash
cd "/c/Users/migue/Documents/Karpi ERP"
git worktree add .claude/worktrees/seam-cross-root-imports -b refactor/seam-cross-root-imports
cd .claude/worktrees/seam-cross-root-imports
```

- [ ] **Step 2: Installeer frontend-dependencies in de worktree**

```bash
cd frontend && npm install
```

Verwacht: `node_modules/` aanwezig, geen errors. Alle vervolgcommando's in dit plan draaien **vanuit de worktree-root** (`.claude/worktrees/seam-cross-root-imports`), niet vanuit de hoofdtree.

- [ ] **Step 3: Verifieer de uitgangssituatie — bestaande tests groen**

```bash
cd frontend && npx vitest run src/lib/email-recipients.test.ts src/lib/utils/__tests__/status-enums.contract.test.ts src/lib/orders/__tests__/derive-status.test.ts
```

Verwacht: PASS (3 bestanden). Dit bewijst o.a. dat cross-root-import onder Vitest werkt vóór we beginnen.

---

### Task 2: Vite dev-server toestaan buiten `frontend/` te lezen

**Files:**
- Modify: `frontend/vite.config.ts`

De build en Vitest kunnen al buiten de root resolven; alleen de dev-server blokkeert standaard `/@fs/`-requests buiten de workspace-root. Zonder deze stap werkt `npm run dev` straks niet meer voor pagina's die (indirect) een shim importeren.

- [ ] **Step 1: Voeg `server.fs.allow` toe**

Vervang in `frontend/vite.config.ts` het bestaande `defineConfig`-object:

```ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    fs: {
      // Cross-root imports uit supabase/functions/_shared (ADR-0033, seam-
      // consolidatie): de dev-server serveert anders geen bestanden buiten
      // frontend/. '..' = de repo-root; build en Vitest hebben dit niet nodig.
      allow: ['..'],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add frontend/vite.config.ts
git commit -m "chore(frontend): sta dev-server cross-root reads naar _shared toe (ADR-0033)"
```

---

### Task 3: email-recipients → re-export uit `_shared/email-list.ts`

**Files:**
- Modify: `supabase/functions/_shared/email-list.ts` (wordt volledige bron: + `parseEmailRecipients`)
- Modify: `frontend/src/lib/email-recipients.ts` (wordt pure re-export)
- Test (bestaand, blijft): `frontend/src/lib/email-recipients.test.ts`

- [ ] **Step 1: Maak `_shared/email-list.ts` de volledige bron**

Volledige nieuwe inhoud van `supabase/functions/_shared/email-list.ts`:

```ts
// Pure helpers voor het factuur-e-mailveld (`debiteuren.email_factuur`) dat
// één óf meerdere ontvangers kan bevatten. Opslag is één TEXT-kolom met de
// adressen komma-gescheiden (conventie `, ` zoals `verstuurd_naar`).
//
// Single source of truth (ADR-0033): de frontend re-exporteert dit bestand
// cross-root via `frontend/src/lib/email-recipients.ts` — niet kopiëren.
// Puur houden: geen Deno-API's, geen https-imports.

// Splitst op komma, puntkomma of whitespace; lege stukken vallen weg.
// Bare e-mailadressen bevatten geen spaties, dus whitespace splitsen is veilig
// en vangt het geval op waarin de gebruiker adressen met een spatie scheidt.
export function splitEmailRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// Bewust simpel/tolerant: één `@` met niet-lege delen en een punt in het
// domein. Strenger willen we niet zijn dan de mailserver zelf.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface EmailRecipientsParse {
  /** Genormaliseerde, komma-gescheiden string voor opslag (leeg → ''). */
  normalized: string
  emails: string[]
  invalid: string[]
}

export function parseEmailRecipients(raw: string): EmailRecipientsParse {
  const emails = splitEmailRecipients(raw)
  const invalid = emails.filter((e) => !EMAIL_RE.test(e))
  return {
    normalized: emails.join(', '),
    emails,
    invalid,
  }
}
```

- [ ] **Step 2: Maak van `frontend/src/lib/email-recipients.ts` een pure re-export**

Volledige nieuwe inhoud:

```ts
// Re-export-shim (ADR-0033): de implementatie leeft in
// supabase/functions/_shared/email-list.ts — één bron voor edge én frontend.
// Bestaat alleen zodat consumers het vertrouwde @/lib-pad houden.
export * from '../../../supabase/functions/_shared/email-list'
```

- [ ] **Step 3: Run de bestaande frontend-test**

```bash
cd frontend && npx vitest run src/lib/email-recipients.test.ts
```

Verwacht: PASS — de test importeert `./email-recipients` en bewijst dat de shim dezelfde API levert.

- [ ] **Step 4: Typecheck + production build (eerste cross-root import in productie-code — `klant-facturering-tab.tsx` gebruikt `parseEmailRecipients`)**

```bash
cd frontend && npm run typecheck && npm run build
```

Verwacht: beide exit 0. Faalt de typecheck op strict-opties (bv. `noUnusedLocals`) ín het `_shared`-bestand: dat bestand dan compliant maken (het is puur TS, geen Deno-specifics).

- [ ] **Step 5: Dev-server smoke (verifieert Task 2)**

```bash
cd frontend && npx vite --port 5199 &
sleep 6
curl -s http://localhost:5199/src/lib/email-recipients.ts
```

Verwacht: de getransformeerde module bevat een `/@fs/...supabase/functions/_shared/email-list.ts`-import en géén 403. Daarna:

```bash
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/email-list.ts frontend/src/lib/email-recipients.ts
git commit -m "refactor(seam): email-recipients consolideren naar _shared/email-list (ADR-0033)"
```

---

### Task 4: iso-week → kern uit `_shared`, frontend-extensies blijven lokaal

**Files:**
- Modify: `supabase/functions/_shared/iso-week.ts` (alleen header-comment)
- Modify: `frontend/src/lib/utils/iso-week.ts` (kern eruit, re-export erin; 5 frontend-functies blijven)
- Tests (bestaand, blijven): `supabase/functions/_shared/iso-week.test.ts` + alle frontend-consumenten-tests

- [ ] **Step 1: Werk de header van `_shared/iso-week.ts` bij** (implementatie ongewijzigd)

Vervang regels 1-9 (het bestaande header-commentaarblok) door:

```ts
// ISO 8601 week-kern — UTC-gebaseerd, TZ-onafhankelijk.
//
// Single source of truth (ADR-0033): de frontend re-exporteert deze kern
// cross-root via `frontend/src/lib/utils/iso-week.ts` (die er frontend-only
// helpers aan toevoegt, o.a. `lokaleDatumAlsUtc` — edge draait in UTC en heeft
// die niet nodig). De overkoepelende waarheid blijft SQL:
// `to_char(date,'IYYY') || '-W' || to_char(date,'IW')` (mig 145/228).
//
// CONTRACT: alle functies lezen de UTC-componenten van de Date en strippen de
// tijdcomponent. Geef dus een Date waarvan het UTC-moment de bedoelde
// kalenderdatum is (bv. `new Date('2026-05-06T00:00:00Z')` of `Date.UTC(...)`).
```

- [ ] **Step 2: Herschrijf `frontend/src/lib/utils/iso-week.ts`**

Volledige nieuwe inhoud (kern weg, re-export + bestaande frontend-functies ongewijzigd):

```ts
/**
 * ISO 8601 week-helpers voor de frontend.
 *
 * De kern (isoWeekJaar/isoWeek/isoWeekString/isoWeekMaandag/maandagVanIsoWeek)
 * leeft in supabase/functions/_shared/iso-week.ts en wordt hier cross-root
 * ge-re-exporteerd (ADR-0033) — één implementatie voor edge én frontend.
 * Hieronder alleen frontend-only uitbreidingen: week-ranges voor UI-headers,
 * en wall-clock/"YYYY-MM-DD"-parsing die op UTC-midnacht verankert zodat de
 * lokale tijdzone het weeknummer nooit verschuift (edge draait in UTC en
 * heeft die verankering niet nodig).
 */

import { isoWeekJaar, isoWeekString, maandagVanIsoWeek } from '../../../../supabase/functions/_shared/iso-week'
import type { IsoWeekJaar } from '../../../../supabase/functions/_shared/iso-week'

export * from '../../../../supabase/functions/_shared/iso-week'

/** Maandag→zondag (UTC-midnacht) voor (jaar, week) — t.b.v. week-headers. */
export function isoWeekRange(jaar: number, week: number): { van: Date; tot: Date } {
  const van = maandagVanIsoWeek(jaar, week)
  const tot = new Date(van)
  tot.setUTCDate(van.getUTCDate() + 6)
  return { van, tot }
}

/**
 * UTC-verankerde Date van de LOKALE kalenderdatum van `d`. Bedoeld voor een
 * wall-clock instant (`new Date()` = "nu"): de kern leest UTC-componenten, dus
 * een rauwe `new Date()` zou in NL (UTC+1/+2) tussen lokaal 00:00 en 02:00 op de
 * vóórgaande UTC-dag landen → verkeerde ISO-week. Door eerst de lokale
 * kalenderdatum te nemen en die op UTC-midnacht te verankeren, vergelijkt "nu"
 * correct met een `afleverdatum`-DATE (die ook op UTC-midnacht verankerd wordt).
 *
 * Bewust NIET in de Deno-bron: edge functions draaien in UTC, daar is lokaal == UTC.
 */
export function lokaleDatumAlsUtc(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

/**
 * Parse "YYYY-MM-DD" (of een volledige ISO-timestamp) naar een UTC-verankerde
 * Date, of `null` bij ontbrekende/ongeldige input. Een kale datum krijgt
 * `T00:00:00Z` zodat de lokale tijdzone het weeknummer niet verschuift.
 */
function utcVanIso(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** ISO-week+jaar voor een "YYYY-MM-DD"-string (of ISO-timestamp), of null. */
export function isoWeekJaarVanIso(iso: string | null | undefined): IsoWeekJaar | null {
  const d = utcVanIso(iso)
  return d ? isoWeekJaar(d) : null
}

/** "YYYY-Www" voor een "YYYY-MM-DD"-string, of null. */
export function isoWeekStringVanIso(iso: string | null | undefined): string | null {
  const d = utcVanIso(iso)
  return d ? isoWeekString(d) : null
}

/**
 * Backwards-compat: enkel het ISO-weeknummer als string voor een YYYY-MM-DD
 * datum (voedt "wk {n}"-labels). Nieuwe code: gebruik `isoWeekJaarVanIso`.
 */
export function isoWeekFromString(iso: string | null | undefined): string | null {
  const w = isoWeekJaarVanIso(iso)
  return w ? String(w.week) : null
}
```

Let op: `import type { IsoWeekJaar }` als aparte regel is verplicht door `verbatimModuleSyntax`.

- [ ] **Step 3: Run frontend tests + typecheck + build**

```bash
cd frontend && npx vitest run && npm run typecheck && npm run build
```

Verwacht: alles PASS/exit 0, behalve het bekende pre-existing falen van `magazijn-pickbaarheid.contract.test.ts` (7 tests — negeren).

- [ ] **Step 4: Run de Deno-test op de bron**

```bash
deno test supabase/functions/_shared/iso-week.test.ts
```

Verwacht: PASS (bron is ongewijzigd, dit is een regressie-check).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/iso-week.ts frontend/src/lib/utils/iso-week.ts
git commit -m "refactor(seam): iso-week-kern consolideren naar _shared, frontend-extensies blijven lokaal (ADR-0033)"
```

---

### Task 5: snijplan-status → superset naar `_shared`, frontend wordt pure re-export

**Files:**
- Modify: `supabase/functions/_shared/snijplan-status.ts` (krijgt de volledige frontend-superset)
- Modify: `frontend/src/lib/utils/snijplan-status.ts` (wordt pure re-export)
- Tests (bestaand, blijven): `supabase/functions/_shared/snijplan-status.test.ts` + `frontend/src/lib/utils/__tests__/status-enums.contract.test.ts`

- [ ] **Step 1: Maak `_shared/snijplan-status.ts` de volledige bron**

Volledige nieuwe inhoud (= de frontend-superset, met bijgewerkte header):

```ts
// Single source of truth voor snijplan-/confectie-status (spiegelt DB-enums).
// De frontend re-exporteert dit bestand cross-root via
// frontend/src/lib/utils/snijplan-status.ts (ADR-0033) — niet kopiëren.
// Toets-ankers: status-enums.contract.test.ts (TS ≡ snapshot, Vitest) +
// snijplan-status.test.ts (Deno) + supabase/migrations/344 (snapshot ≡ DB).
// Wijzig je een DB-enum, werk dan status-enums.golden.json + deze arrays +
// mig 344 samen bij.

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

/** Auto-planner bronpool: nog in te plannen (Gepland) + legacy Wacht-rijen (mig 069). */
export const PLANBAAR = ['Gepland', 'Wacht'] as const satisfies readonly SnijplanStatus[]

export const isSnijplanStatus = (s: string): s is SnijplanStatus =>
  (SNIJPLAN_STATUSSEN as readonly string[]).includes(s)
```

- [ ] **Step 2: Maak van `frontend/src/lib/utils/snijplan-status.ts` een pure re-export**

Volledige nieuwe inhoud:

```ts
// Re-export-shim (ADR-0033): de implementatie leeft in
// supabase/functions/_shared/snijplan-status.ts — één bron voor edge én
// frontend. Bestaat alleen zodat consumers het vertrouwde @/lib-pad houden.
export * from '../../../../supabase/functions/_shared/snijplan-status'
```

- [ ] **Step 3: Run de contracttest (Vitest) + Deno-test**

```bash
cd frontend && npx vitest run src/lib/utils/__tests__/status-enums.contract.test.ts
cd .. && deno test supabase/functions/_shared/snijplan-status.test.ts
```

Verwacht: beide PASS. De Vitest-contracttest toetst nu via de shim direct de `_shared`-bron tegen `status-enums.golden.json` — de drift-detectie TS ≡ DB blijft dus volledig intact, maar dekt voortaan ook de edge-kant.

- [ ] **Step 4: Typecheck + build (veel consumers: confectie, scanstation, snijplanning)**

```bash
cd frontend && npm run typecheck && npm run build
```

Verwacht: exit 0. `import type { SnijplanStatus, ConfectieStatus }` in `constants.ts`/`productie.ts` blijft werken via de shim.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/snijplan-status.ts frontend/src/lib/utils/snijplan-status.ts
git commit -m "refactor(seam): snijplan-status-superset naar _shared, frontend re-exporteert (ADR-0033)"
```

---

### Task 6: vervoerder-eisen → frontend-shim (dode kopie weg)

**Files:**
- Modify: `supabase/functions/_shared/vervoerder-eisen.ts` (alleen header-comment)
- Modify: `frontend/src/lib/orders/vervoerder-eisen.ts` (wordt pure re-export)
- Test (bestaand, blijft): `supabase/functions/_shared/vervoerder-eisen.test.ts`

- [ ] **Step 1: Werk de header van `_shared/vervoerder-eisen.ts` bij** (implementatie ongewijzigd)

Vervang regels 1-5 (het bestaande header-commentaarblok) door:

```ts
// Gedeelde pre-flight validator: kent de eisen van de logistieke partijen vóór
// verzending. V1 dekt alleen HST (enige actieve API-vervoerder). Puur — geen
// DB/secrets — zodat zowel de edge functions (laatste poort) als de frontend
// (waarschuwingsvlag, via re-export-shim frontend/src/lib/orders/
// vervoerder-eisen.ts, ADR-0033) dezelfde uitkomst gebruiken.
```

- [ ] **Step 2: Maak van `frontend/src/lib/orders/vervoerder-eisen.ts` een pure re-export**

Volledige nieuwe inhoud (de oude kopie was dead code — nul consumers — maar het pad blijft bestaan omdat CLAUDE.md/ADR-0030 het documenteert voor toekomstig Pick & Ship-gebruik):

```ts
// Re-export-shim (ADR-0033): de implementatie leeft in
// supabase/functions/_shared/vervoerder-eisen.ts — één bron voor edge én
// frontend. Nog geen frontend-consumers; gereserveerd voor de Pick & Ship-
// waarschuwingsvlag (ADR-0030).
export * from '../../../../supabase/functions/_shared/vervoerder-eisen'
```

- [ ] **Step 3: Typecheck + Deno-test**

```bash
cd frontend && npm run typecheck
cd .. && deno test supabase/functions/_shared/vervoerder-eisen.test.ts
```

Verwacht: beide exit 0. Let op: de shim heeft geen consumers, dus de build bewijst hier niets extra's — typecheck dekt de resolutie.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/vervoerder-eisen.ts frontend/src/lib/orders/vervoerder-eisen.ts
git commit -m "refactor(seam): dode vervoerder-eisen-kopie vervangen door re-export-shim (ADR-0033)"
```

---

### Task 7: ADR-0033 + conventie in CLAUDE.md + levende docs

**Files:**
- Create: `docs/adr/0033-gedeelde-logica-cross-root-import-niet-kopieren.md`
- Modify: `CLAUDE.md` (sectie `## Conventies`)
- Modify: `docs/architectuur.md` (seam-patroon-beschrijving)
- Modify: `docs/changelog.md`

- [ ] **Step 1: Schrijf ADR-0033**

Volledige inhoud van `docs/adr/0033-gedeelde-logica-cross-root-import-niet-kopieren.md`:

```markdown
# ADR-0033: Gedeelde pure logica wordt cross-root geïmporteerd, niet gekopieerd

**Status:** Geaccepteerd (2026-06-12)

## Context

Het "seam-patroon" (één pure module aan beide kanten van de Deno↔Vite-grens,
handmatig synchroon gehouden) was uitgegroeid tot vier kopieparen:
`vervoerder-eisen.ts`, `iso-week.ts`, `snijplan-status.ts` en
`email-list.ts`↔`email-recipients.ts`. De aanname "Deno-edge-modules zijn niet
door Vite importeerbaar" gold alleen voor modules met https-imports of
Deno-API's — voor pure modules niet. De repo bewees dat zelf al:
`order-lifecycle/derive-status.ts` heeft géén kopie en wordt door
frontend-contracttests rechtstreeks cross-root geïmporteerd.

Handmatige kopieën zijn dezelfde incident-klasse als het SSCC-incident van
12-06-2026 (twee generatoren voor hetzelfde gegeven → divergentie →
"geen data" op het depot): één kant aanpassen zonder de spiegel is stil
gedrag-verschil tussen UI en edge. `snijplan-status` was al gedivergeerd
(frontend-superset).

## Besluit

1. **`supabase/functions/_shared/` is de single source** voor TS-logica die
   edge én frontend delen. Andersom kan niet: Deno-deploy bundelt relatieve
   imports en kan niet betrouwbaar uit `frontend/src/` lezen.
2. **Alleen pure modules** komen in aanmerking: geen Deno-API's, geen
   https-imports, geen DB/secrets. Niet-pure logica houdt aparte modules per
   runtime (zoals `debiteur-matcher.ts` ↔ `product-matcher.ts`).
3. **De frontend importeert/re-exporteert cross-root.** Bestaande
   frontend-paden blijven als dunne shim bestaan (`export * from
   '../../../../supabase/functions/_shared/<module>'`), eventueel aangevuld met
   frontend-only functies (bv. `lokaleDatumAlsUtc` in `iso-week`).
4. **Nieuwe gedeelde logica wordt nooit gekopieerd.** Kan een module niet puur
   gemaakt worden, dan is een equivalentie-contracttest op gedeelde fixtures
   (golden-file, zoals `derive-status.golden.json`) het vangnet.
5. Vite dev-server: `server.fs.allow: ['..']` in `frontend/vite.config.ts`
   maakt het serveren van `_shared`-bestanden buiten `frontend/` mogelijk.

## Consequenties

- Divergentie tussen UI en edge is voor deze modules categorisch onmogelijk
  (deletion-test: de frontend-bestanden zijn pass-through zonder eigen logica).
- Frontend-`npm run typecheck` checkt voortaan ook de geïmporteerde
  `_shared`-modules onder de strenge frontend-compileropties.
- De Vitest-contracttests (o.a. `status-enums.contract.test.ts`) toetsen nu
  direct de bron die de edge functions gebruiken.
- `_shared`-modules die frontend-geïmporteerd worden, moeten puur blijven —
  een Deno-import toevoegen breekt de frontend-build (dat is gewenst: de
  build bewaakt de puurheid).
- Buiten scope gelaten: `werkagenda.ts` ↔ `bereken-agenda.ts` (gedocumenteerd
  gedragsverschil, apart traject als consolidatie daar gewenst is).
```

- [ ] **Step 2: Voeg de conventie toe aan CLAUDE.md**

In `CLAUDE.md`, sectie `## Conventies`, na de regel `- Componenten: 1 concern per bestand, extracteer herbruikbare delen` toevoegen:

```markdown
- **Gedeelde TS-logica edge ↔ frontend (ADR-0033):** pure modules leven éénmalig in `supabase/functions/_shared/`; de frontend importeert/re-exporteert ze cross-root (zie de shims `@/lib/utils/iso-week`, `@/lib/utils/snijplan-status`, `@/lib/email-recipients`, `@/lib/orders/vervoerder-eisen`). Nieuwe gedeelde logica wordt **nooit gekopieerd**; kan het niet puur (Deno-API's/https-imports/DB), dan aparte modules per runtime + golden-file-contracttest (patroon `derive-status.golden.json`).
```

- [ ] **Step 3: Werk `docs/architectuur.md` bij**

Zoek de bestaande beschrijving van het seam-/spiegel-patroon (grep op `seam` of `spiegel`) en voeg daar een alinea toe die naar ADR-0033 verwijst; minimaal:

```markdown
**Seam-patroon herzien (ADR-0033, 2026-06-12):** de handmatige kopieparen
(`vervoerder-eisen`, `iso-week`, `snijplan-status`, `email-list`/`email-recipients`)
zijn vervangen door één bron in `supabase/functions/_shared/` met cross-root
re-export-shims in de frontend. Kopieën van pure modules zijn niet langer
toegestaan; zie ADR-0033 voor de criteria.
```

- [ ] **Step 4: Changelog-entry**

Bovenaan de entries in `docs/changelog.md` toevoegen (datumformaat van het bestand volgen):

```markdown
## 2026-06-12 — Seam-consolidatie: cross-root imports i.p.v. kopieën (ADR-0033)
Vier handmatig-gesynchroniseerde kopieparen tussen `supabase/functions/_shared/`
en `frontend/src/` vervangen door één bron in `_shared/` + dunne frontend
re-export-shims: `vervoerder-eisen` (frontend-kopie was dead code),
`iso-week` (kern gedeeld, frontend-extensies lokaal), `snijplan-status`
(frontend-superset → `_shared`) en `email-list`/`email-recipients`.
Waarom: handmatige kopieën = dezelfde incident-klasse als het SSCC-incident
(12-06); `snijplan-status` was al gedivergeerd. Vite dev-server kreeg
`server.fs.allow: ['..']`. Conventie vastgelegd in CLAUDE.md + ADR-0033.
```

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0033-gedeelde-logica-cross-root-import-niet-kopieren.md CLAUDE.md docs/architectuur.md docs/changelog.md
git commit -m "docs: ADR-0033 — gedeelde pure logica cross-root importeren, niet kopiëren"
```

---

### Task 8: Eindverificatie

**Files:** geen (verificatie)

- [ ] **Step 1: Volledige frontend-suite + typecheck + build**

```bash
cd frontend && npx vitest run && npm run typecheck && npm run build
```

Verwacht: alles groen behalve het bekende pre-existing falen `magazijn-pickbaarheid.contract.test.ts` (7 tests, faalt ook op main — geen regressie van dit werk).

- [ ] **Step 2: Alle Deno-tests van de geraakte `_shared`-modules**

```bash
deno test supabase/functions/_shared/iso-week.test.ts supabase/functions/_shared/snijplan-status.test.ts supabase/functions/_shared/vervoerder-eisen.test.ts
```

Verwacht: PASS.

- [ ] **Step 3: Deletion-test (de kern van de hele exercitie)**

```bash
grep -c "export" frontend/src/lib/email-recipients.ts frontend/src/lib/utils/snijplan-status.ts frontend/src/lib/orders/vervoerder-eisen.ts
```

Verwacht: elk van deze drie bestanden bevat exact 1 `export`-regel (de re-export) en nul eigen logica. `iso-week.ts` is de bewuste uitzondering (frontend-extensies) — verifieer handmatig dat de 6 kernfuncties (`isoWeekJaar`, `isoWeek`, `isoWeekString`, `isoWeekMaandag`, `maandagVanIsoWeek`, `IsoWeekJaar`) er niet meer in gedefinieerd staan:

```bash
grep -n "export function isoWeekJaar\b\|export function isoWeek\b\|export function isoWeekString\b\|export function isoWeekMaandag\|export function maandagVanIsoWeek" frontend/src/lib/utils/iso-week.ts
```

Verwacht: geen treffers.

- [ ] **Step 4: Geen merge naar main**

Conform de git-workflow: branch `refactor/seam-cross-root-imports` blijft staan; merge naar `main` gebeurt pas op expliciet commando van Miguel (push dan via `git push origin refactor/seam-cross-root-imports:main`-patroon i.v.m. parallelle sessies — zie memory "Merge-race parallelle sessies"). Vóór merge: migratienummers her-verifiëren is hier n.v.t. (geen migraties), wél `npm run typecheck` nogmaals draaien op de actuele main-merge-basis.
