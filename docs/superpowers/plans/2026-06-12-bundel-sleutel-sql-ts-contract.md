# Bundel-sleutel SQL↔TS golden-fixture-contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eén golden-fixture-bestand dat zowel de TS-bundel-sleutel-familie (Vitest) als de SQL-familie (zelf-testende migratie) toetst, zodat drift tussen UI-clustering en RPC-bundeling een rode test wordt i.p.v. een verkeerde zending — inclusief het dichten van de twee nu al aanwijsbare divergentie-klassen (Unicode-whitespace en ß/ẞ in DE-adressen).

**Architecture:** Golden JSON = canon (`frontend/src/lib/orders/__tests__/golden/bundel-sleutel.golden.json`). Consument 1: Vitest-contracttest toetst `normaliseerAdresKey` / `verzendWeekIsoString` / `bundelSleutelVoorOrder`. Consument 2: migratie 383 definieert `assert_bundel_sleutel_contract(JSONB)` en roept die aan met exact dezelfde JSON in een `$golden$`-dollar-quoted blok; een Vitest-sync-test parset dat blok uit het migratiebestand en deep-equal't het met de golden import — drift JSON↔migratie is dus óók een rode test. Daarnaast wordt `_normaliseer_afleveradres` (mig 222) geherdefinieerd met expliciete JS-pariteit (Unicode-whitespace-klasse + ß/ẞ→ss-fold) zodat het gedrag niet langer Postgres-locale-afhankelijk is; de TS-kant krijgt dezelfde fold. Dit volgt besluit 2 van het consolidatieplan 2026-06-09 (geen nieuw test-framework: zelf-testende migratie + golden-fixture binnen de bestaande `*.contract.test.ts`-conventie, precedent: `order-status.contract.test.ts` + `order-status.golden.json`).

**Tech Stack:** PostgreSQL (PL/pgSQL, migratie handmatig via Supabase SQL Editor — MCP heeft géén toegang tot het Karpi-project, `supabase db push` is gevaarlijk), Vitest in `frontend/`, geen nieuwe dependencies.

**Veiligheid van de normalisatie-wijziging:** bundel-sleutels worden nergens gepersisteerd — `bundel_sleutel`/`_normaliseer_afleveradres` worden on-the-fly geëvalueerd in view `voorgestelde_zending_bundels` (mig 229), `start_pickronden_bundel` (mig 222/248), de verzendweek-lock-trigger (mig 230) en `genereer_factuur_voor_week` (mig 232). Een gedragswijziging voor exotische tekens verandert dus geen opgeslagen data; hij kan hooguit een toekomstige clustering corrigeren (twee adressen die door NBSP/ß onterecht splitsten, bundelen voortaan wél). `zendingen.verzendweek` is een week-snapshot, geen sleutel — onaangeraakt.

---

## Geverifieerde uitgangssituatie (onderzoek 2026-06-12)

| Wat | SQL | TS | Test |
|---|---|---|---|
| Adres-normalisatie | `_normaliseer_afleveradres` (mig 222:57-69) | [`normaliseer-adres.ts`](../../frontend/src/lib/orders/normaliseer-adres.ts) | **geen** |
| Sleutel-compositie | `bundel_sleutel` (mig 228:56-69) | [`bundel-sleutel.ts`](../../frontend/src/lib/orders/bundel-sleutel.ts) | **geen** |
| Verzendweek | `verzendweek_voor_datum` (mig 228:25-37) | [`verzendweek.ts`](../../frontend/src/lib/orders/verzendweek.ts) | TS-only regressietest (`__tests__/verzendweek.test.ts`) — geen SQL-contract |

Lockstep wordt uitsluitend door comments bewaakt ("updates moeten beide kanten tegelijk landen"). Concrete divergentie-kandidaten, beide reëel voor de DE/BE-EDI-instroom (Hornbach DE, BDSK):

1. **Unicode-whitespace:** JS `\s` matcht NBSP (U+00A0), narrow NBSP (U+202F) e.d.; Postgres `\s` = `[[:space:]]` waarvan de niet-ASCII-dekking locale-afhankelijk is. Een NBSP uit een EDI-bericht of copy-paste → TS-key `1234AB|…`, SQL-key `1234 AB|…` (met NBSP) → popover toont 1 bundel, RPC maakt er 2 (of vice versa).
2. **ß/ẞ:** JS `'Straße'.toUpperCase()` → `'STRASSE'` (full case mapping); Postgres `upper()` met libc mapt per karakter → `'STRAßE'`/`'STRAẞE'`. Elke Duitse straatnaam met ß geeft dan structureel verschillende sleutels.
3. **TRIM:** SQL `TRIM()` strip alleen spaties; TS `.trim()` ook tabs/newlines/Unicode-spaties (relevant voor het land-veld).

Oplossing: golden fixtures pinnen het canonieke gedrag (NBSP = whitespace, ß/ẞ → SS); beide implementaties worden daarnaartoe gehard. Dit plan voert "losse opruiming 5A" uit het plan `2026-06-09-ts-sql-spiegeling-seam-consolidatie.md` uit.

---

## Branch-setup (vóór Task 1)

- [ ] **Maak branch + (aanbevolen) worktree aan**

Substantieel werk → eigen branch; er draaien vaak parallelle sessies in de main-tree, dus bij voorkeur direct een worktree (incident 8 juni):

```bash
git -C "c:/Users/migue/Documents/Karpi ERP" worktree add ../.worktrees/bundel-sleutel-contract -b refactor/bundel-sleutel-contract
cd "c:/Users/migue/Documents/.worktrees/bundel-sleutel-contract"
cd frontend && npm install
```

(Zonder worktree: `git checkout -b refactor/bundel-sleutel-contract` vanaf actuele `main`.)

- [ ] **Verifieer dat migratienummer 383 vrij is**

```bash
ls supabase/migrations/ | sort | tail -5
```

Expected: hoogste is `382_*`. Staat er al een `383_*` (andere branch was eerder) → neem het eerstvolgende vrije nummer en pas de bestandsnaam in Task 3 én het zoekpatroon in Task 4 consequent aan. Her-check dit vlak vóór de merge (migratienummer-collisie-incident 10 juni).

---

### Task 1: Golden fixtures + TS-contracttest (+ ß/ẞ-fold in TS)

**Files:**
- Create: `frontend/src/lib/orders/__tests__/golden/bundel-sleutel.golden.json`
- Create: `frontend/src/lib/orders/__tests__/bundel-sleutel.contract.test.ts`
- Modify: `frontend/src/lib/orders/normaliseer-adres.ts`

Alle bestanden via de Write/Edit-tool aanmaken (nooit via PowerShell `Set-Content` — PS 5.1-mojibake-risico). De JSON gebruikt `\uXXXX`-escapes voor alle onzichtbare/bijzondere testtekens (NBSP, scharfes s e.d.) — neem die escapes letterlijk over, vervang ze niet door de echte tekens.

- [ ] **Step 1: Schrijf het golden-fixture-bestand**

Maak `frontend/src/lib/orders/__tests__/golden/bundel-sleutel.golden.json`:

```json
{
  "_lees_mij": "Canon voor de bundel-sleutel-familie. Twee consumenten: bundel-sleutel.contract.test.ts (TS, Vitest) en assert_bundel_sleutel_contract() in de laatste *_bundel_sleutel_contract*.sql-migratie (SQL). Wijzig je dit bestand, dan MOET er een nieuwe contract-migratie komen met hetzelfde JSON-blok — de sync-test in bundel-sleutel.contract.test.ts dwingt dat af.",
  "adres_cases": [
    { "naam": "basis: postcode-spaties weg, adres-collapse, land upper", "afl_adres": "Hoofdweg 12", "afl_postcode": "1234 ab", "afl_land": "nl", "verwacht": "1234AB|HOOFDWEG 12|NL" },
    { "naam": "meervoudige spaties en randen", "afl_adres": "  Hoofd   weg 12  ", "afl_postcode": " 1234  AB ", "afl_land": " NL ", "verwacht": "1234AB|HOOFD WEG 12|NL" },
    { "naam": "NBSP (U+00A0) telt als spatie", "afl_adres": "Hoofdweg\u00a012", "afl_postcode": "1234\u00a0AB", "afl_land": "NL", "verwacht": "1234AB|HOOFDWEG 12|NL" },
    { "naam": "narrow NBSP (U+202F) telt als spatie", "afl_adres": "Hoofdweg\u202f12", "afl_postcode": "1234 AB", "afl_land": "NL", "verwacht": "1234AB|HOOFDWEG 12|NL" },
    { "naam": "scharfes s klein (U+00DF) foldt naar SS", "afl_adres": "Industriestra\u00dfe 5", "afl_postcode": "68167", "afl_land": "DE", "verwacht": "68167|INDUSTRIESTRASSE 5|DE" },
    { "naam": "scharfes s hoofdletter (U+1E9E) foldt naar SS", "afl_adres": "INDUSTRIESTRA\u1e9eE 5", "afl_postcode": "68167", "afl_land": "DE", "verwacht": "68167|INDUSTRIESTRASSE 5|DE" },
    { "naam": "tab en newline rond land", "afl_adres": "Hoofdweg 12", "afl_postcode": "1234AB", "afl_land": "\tDE\n", "verwacht": "1234AB|HOOFDWEG 12|DE" },
    { "naam": "alles null geeft vraagtekens", "afl_adres": null, "afl_postcode": null, "afl_land": null, "verwacht": "?|?|?" },
    { "naam": "lege strings geven vraagtekens", "afl_adres": "", "afl_postcode": "", "afl_land": "", "verwacht": "?|?|?" },
    { "naam": "alleen-whitespace adres geeft vraagteken", "afl_adres": "   ", "afl_postcode": "1234AB", "afl_land": "NL", "verwacht": "1234AB|?|NL" }
  ],
  "week_cases": [
    { "naam": "midden in het jaar", "datum": "2026-05-06", "verwacht": "2026-W19" },
    { "naam": "zero-padding week 1", "datum": "2027-01-04", "verwacht": "2027-W01" },
    { "naam": "zondag hoort bij de voorgaande ISO-week", "datum": "2026-12-27", "verwacht": "2026-W52" },
    { "naam": "2026 heeft een week 53", "datum": "2026-12-31", "verwacht": "2026-W53" },
    { "naam": "1 jan 2026 valt in week 1 van eigen jaar", "datum": "2026-01-01", "verwacht": "2026-W01" },
    { "naam": "1 jan 2027 hoort bij ISO-jaar 2026 (W53)", "datum": "2027-01-01", "verwacht": "2026-W53" }
  ],
  "sleutel_cases": [
    { "naam": "vol: NL-order met HST", "debiteur_nr": 361208, "afl_adres": "Hoofdweg 12", "afl_postcode": "1234 AB", "afl_land": "NL", "afleverdatum": "2026-05-06", "vervoerder_code": "hst_api", "afhalen": false, "verwacht": "D361208|Vhst_api|W2026-W19|A1234AB|HOOFDWEG 12|NL" },
    { "naam": "geen vervoerder valt terug op GEEN", "debiteur_nr": 361208, "afl_adres": "Hoofdweg 12", "afl_postcode": "1234 AB", "afl_land": "NL", "afleverdatum": "2026-05-06", "vervoerder_code": null, "afhalen": false, "verwacht": "D361208|VGEEN|W2026-W19|A1234AB|HOOFDWEG 12|NL" },
    { "naam": "afhalen wint van vervoerder", "debiteur_nr": 361208, "afl_adres": "Hoofdweg 12", "afl_postcode": "1234 AB", "afl_land": "NL", "afleverdatum": "2026-05-06", "vervoerder_code": "hst_api", "afhalen": true, "verwacht": "D361208|VAFHAAL|W2026-W19|A1234AB|HOOFDWEG 12|NL" },
    { "naam": "geen afleverdatum valt terug op WGEEN", "debiteur_nr": 600556, "afl_adres": "Hoofdweg 12", "afl_postcode": "1234 AB", "afl_land": "NL", "afleverdatum": null, "vervoerder_code": "hst_api", "afhalen": false, "verwacht": "D600556|Vhst_api|WGEEN|A1234AB|HOOFDWEG 12|NL" },
    { "naam": "DE-bundel met ss-fold en week 53", "debiteur_nr": 600556, "afl_adres": "Industriestra\u00dfe 5", "afl_postcode": "68167", "afl_land": "de", "afleverdatum": "2026-12-31", "vervoerder_code": "rhenus_sftp", "afhalen": false, "verwacht": "D600556|Vrhenus_sftp|W2026-W53|A68167|INDUSTRIESTRASSE 5|DE" }
  ]
}
```

- [ ] **Step 2: Schrijf de TS-contracttest**

Maak `frontend/src/lib/orders/__tests__/bundel-sleutel.contract.test.ts`:

```ts
// Contracttest: TS-bundel-sleutel-familie ≡ golden-fixture ≡ SQL-familie.
// Golden = canon; de SQL-kant wordt geborgd door assert_bundel_sleutel_contract()
// in de laatste *_bundel_sleutel_contract*.sql-migratie. De sync-describe
// onderaan bewijst dat het $golden$-blok in die migratie inhoudelijk gelijk is
// aan dit JSON-bestand — één bron, twee consumenten (patroon: order-status.contract.test.ts).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import golden from './golden/bundel-sleutel.golden.json'
import { normaliseerAdresKey } from '../normaliseer-adres'
import { verzendWeekIsoString } from '../verzendweek'
import { bundelSleutelVoorOrder } from '../bundel-sleutel'

describe('golden: normaliseerAdresKey', () => {
  for (const c of golden.adres_cases) {
    it(c.naam, () => {
      expect(
        normaliseerAdresKey({
          afl_adres: c.afl_adres,
          afl_postcode: c.afl_postcode,
          afl_land: c.afl_land,
        })
      ).toBe(c.verwacht)
    })
  }
})

describe('golden: verzendWeekIsoString', () => {
  for (const c of golden.week_cases) {
    it(c.naam, () => {
      expect(verzendWeekIsoString(c.datum)).toBe(c.verwacht)
    })
  }
})

describe('golden: bundelSleutelVoorOrder (compositie, end-to-end)', () => {
  for (const c of golden.sleutel_cases) {
    it(c.naam, () => {
      expect(
        bundelSleutelVoorOrder({
          debiteur_nr: c.debiteur_nr,
          afl_adres: c.afl_adres,
          afl_postcode: c.afl_postcode,
          afl_land: c.afl_land,
          afleverdatum: c.afleverdatum,
          vervoerder_code: c.vervoerder_code,
          afhalen: c.afhalen,
        })
      ).toBe(c.verwacht)
    })
  }
})

describe('sync: golden ≡ $golden$-blok in de contract-migratie', () => {
  const hier = dirname(fileURLToPath(import.meta.url))
  const migrationsDir = resolve(hier, '../../../../../supabase/migrations')

  it('laatste *_bundel_sleutel_contract*.sql draagt exact dezelfde fixtures', () => {
    const kandidaten = readdirSync(migrationsDir)
      .filter((f) => f.includes('bundel_sleutel_contract'))
      .sort()
    expect(
      kandidaten.length,
      'geen contract-migratie gevonden — is mig 383 al aangemaakt (Task 3)?'
    ).toBeGreaterThan(0)
    const sql = readFileSync(join(migrationsDir, kandidaten.at(-1)!), 'utf8')
    const m = sql.match(/\$golden\$([\s\S]*?)\$golden\$/)
    expect(m, 'migratie mist het $golden$…$golden$-blok').not.toBeNull()
    const inMigratie = JSON.parse(m![1])
    // _lees_mij is documentatie, geen contract-data.
    const { _lees_mij: _a, ...goldenData } = golden as Record<string, unknown>
    const { _lees_mij: _b, ...migratieData } = inMigratie
    expect(migratieData).toEqual(goldenData)
  })
})
```

- [ ] **Step 3: Run de test — verwacht RED op de ẞ-case en de sync-describe**

```bash
cd frontend && npx vitest run src/lib/orders/__tests__/bundel-sleutel.contract.test.ts
```

Expected: FAIL op precies twee plekken: (1) adres-case "scharfes s hoofdletter (U+1E9E) foldt naar SS" — `'ẞ'.toUpperCase()` blijft `'ẞ'`, dus de TS-kant geeft nog `…STRAẞE…`; (2) de sync-test — mig 383 bestaat nog niet. De overige cases (NBSP, tab, ß-klein) slagen al op TS: dat bewijst meteen dat de divergentie aan de SQL-kant zit. Faalt er méér → eerst begrijpen waarom, niet de fixture aanpassen.

- [ ] **Step 4: Hard de TS-normalisatie (ß/ẞ-fold)**

Vervang de functie-body in `frontend/src/lib/orders/normaliseer-adres.ts` — volledige nieuwe inhoud:

```ts
// Adres-normalisatie voor zending-bundeling — single source of truth.
//
// Spiegelt 1-op-1 de SQL-functie `_normaliseer_afleveradres(adres, postcode,
// land)` (mig 222, gehard in mig 383). Het contract wordt afgedwongen door
// golden fixtures (__tests__/golden/bundel-sleutel.golden.json): de Vitest-
// contracttest toetst deze module, `assert_bundel_sleutel_contract()` toetst
// de SQL-kant met exact dezelfde cases. Wijzig je gedrag → golden bijwerken
// → nieuwe contract-migratie (de sync-test dwingt dat af).
// Gebruikt door:
//   · `bundel-sleutel.ts`             (frontend bundel-key)
//   · `bundel-cluster.ts`             (Pick & Ship UI-clustering)
//   · `voorgestelde-bundels.ts`       (preview-fetcher type-narrowing)
//
// Vorm: `POSTCODE|ADRES|LAND`, alle uppercase.
// - Postcode: alle whitespace verwijderd ('1234 AB' → '1234AB')
// - Adres:    whitespace genormaliseerd ('  Hoofd  weg 12  ' → 'HOOFD WEG 12')
// - Land:     trim + uppercase ('  nl ' → 'NL')
// - ß (U+00DF) en ẞ (U+1E9E) folden naar 'SS' — JS toUpperCase() doet dat
//   alleen voor ß; Postgres upper() voor geen van beide (locale-afhankelijk).
//   De expliciete fold maakt beide kanten deterministisch gelijk.
// Lege/missende velden krijgen '?'.

const foldScharfesS = (s: string) => s.replace(/[\u00DF\u1E9E]/g, 'ss')

export function normaliseerAdresKey(input: {
  afl_adres: string | null
  afl_postcode: string | null
  afl_land: string | null
}): string {
  const postcode =
    foldScharfesS(input.afl_postcode ?? '')
      .replace(/\s+/g, '')
      .toUpperCase()
      .trim() || '?'
  const adres =
    foldScharfesS(input.afl_adres ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase() || '?'
  const land = foldScharfesS(input.afl_land ?? '').trim().toUpperCase() || '?'
  return `${postcode}|${adres}|${land}`
}
```

- [ ] **Step 5: Run de test opnieuw — alleen de sync-describe mag nog falen**

```bash
cd frontend && npx vitest run src/lib/orders/__tests__/bundel-sleutel.contract.test.ts
```

Expected: alle adres-/week-/sleutel-cases PASS; alléén "sync: golden ≡ $golden$-blok" FAIL (migratie komt in Task 3).

- [ ] **Step 6: Run de bestaande order-tests als regressie-check**

```bash
cd frontend && npx vitest run src/lib/orders
```

Expected: geen nieuwe failures t.o.v. main (de verzendweek-regressietest blijft onaangeraakt; `normaliseerAdresKey` had geen tests en de fold raakt alleen ß/ẞ-input).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/orders/__tests__/golden/bundel-sleutel.golden.json frontend/src/lib/orders/__tests__/bundel-sleutel.contract.test.ts frontend/src/lib/orders/normaliseer-adres.ts
git commit -m "test(logistiek): golden-fixture-contract bundel-sleutel-familie + ss-fold in TS-normalisatie

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: SQL-probe — bewijs de live divergentie (RED voor de SQL-kant)

Geen bestandswijziging; documenteert het werkelijke gedrag van de live DB vóór de fix. Postgres' `\s`- en `upper()`-gedrag voor niet-ASCII is locale-afhankelijk — we leggen de feitelijke uitkomst vast i.p.v. erover te speculeren.

- [ ] **Step 1: Draai de probe in de Supabase SQL Editor**

```sql
SELECT
  _normaliseer_afleveradres(E'Hoofdweg\u00A012', E'1234\u00A0AB', 'NL') AS nbsp_case,
  _normaliseer_afleveradres('Industriestra' || chr(223) || 'e 5', '68167', 'DE') AS ss_case,
  upper(chr(223)) AS upper_ss,
  regexp_replace(E'a\u00A0b', '\s+', '_', 'g') AS pg_s_matcht_nbsp;
```

Expected (één van beide, allebei acceptabel — noteer de uitkomst letterlijk voor de commit-message van Task 3):
- **Divergentie bevestigd** (waarschijnlijk): `nbsp_case` bevat nog een NBSP (≠ `1234AB|HOOFDWEG 12|NL`) en/of `ss_case` = `68167|INDUSTRIESTRAßE 5|DE` (of met `ẞ`). Dit is het harde bewijs van de bevinding.
- **Geen divergentie op deze DB**: ook dan is mig 383 nodig — het huidige gedrag is een toevallige locale-eigenschap, geen contract; de v2-functie maakt het deterministisch.

---

### Task 3: Migratie 383 — geharde `_normaliseer_afleveradres` + `assert_bundel_sleutel_contract`

**Files:**
- Create: `supabase/migrations/383_bundel_sleutel_contract.sql`

De bestandsnaam moet `bundel_sleutel_contract` bevatten (de sync-test uit Task 1 zoekt daarop). Toekomstige migraties die één van de drie functies wijzigen, volgen dezelfde naamconventie en herhalen de `SELECT assert_bundel_sleutel_contract($golden$…$golden$::jsonb);`-aanroep met de dan actuele golden-inhoud.

- [ ] **Step 1: Schrijf de migratie**

Maak `supabase/migrations/383_bundel_sleutel_contract.sql`. Het `$golden$`-blok in sectie 3 moet **exact** de inhoud van `bundel-sleutel.golden.json` zijn (kopieer het bestand integraal, inclusief `_lees_mij` — de sync-test vergelijkt na parse, dus whitespace-verschillen zijn onschadelijk, sleutel-inhoud niet):

```sql
-- Migratie 383: bundel-sleutel-contract — SQL ≡ TS via golden fixtures
--
-- Probleem: de bundel-sleutel-familie bestaat in twee runtimes —
-- _normaliseer_afleveradres (mig 222) + bundel_sleutel + verzendweek_voor_datum
-- (mig 228) in SQL, en normaliseer-adres.ts / bundel-sleutel.ts / verzendweek.ts
-- in de frontend. Lockstep werd alleen door comments bewaakt. Divergentie =
-- operator ziet in de Pick & Ship-popover N bundels, start_pickronden_bundel
-- maakt er M — stil. Twee divergentie-klassen waren al aanwijsbaar:
--   1. Unicode-whitespace: JS \s matcht NBSP (U+00A0) e.d.; Postgres \s
--      ([[:space:]]) is daar locale-afhankelijk in.
--   2. ß/ẞ: JS toUpperCase() vouwt ß→SS (full case mapping); Postgres upper()
--      mapt per karakter en laat ß staan. Elke Duitse straatnaam met ß
--      (Hornbach-DE/BDSK-instroom) gaf structureel verschillende sleutels.
--
-- Oplossing in drie delen:
--   1. _normaliseer_afleveradres v2: expliciete JS-pariteit — de volledige
--      JS-\s-tekenklasse uitgeschreven + ß/ẞ→ss-fold vóór upper(). Daarmee is
--      het gedrag onafhankelijk van de DB-locale. Sleutels worden nergens
--      gepersisteerd (view 229 / RPC 222+248 / trigger 230 / RPC 232 evalueren
--      on-the-fly), dus dit wijzigt geen opgeslagen data.
--   2. assert_bundel_sleutel_contract(JSONB): loopt over golden fixtures en
--      RAISE EXCEPTION bij elke mismatch.
--   3. Aanroep met het $golden$-blok = letterlijke kopie van
--      frontend/src/lib/orders/__tests__/golden/bundel-sleutel.golden.json.
--      De Vitest-sync-test (bundel-sleutel.contract.test.ts) parset dit blok
--      en vergelijkt het met de golden JSON — één bron, twee consumenten.
--
-- Conventie voortaan: elke migratie die _normaliseer_afleveradres,
-- bundel_sleutel of verzendweek_voor_datum wijzigt, heet *_bundel_sleutel_
-- contract*.sql en eindigt met dezelfde assert-aanroep (golden zo nodig eerst
-- bijwerken — de sync-test pakt altijd de laatste contract-migratie).
--
-- Idempotent: CREATE OR REPLACE; de assert-aanroep is read-only.

------------------------------------------------------------------------
-- 1. _normaliseer_afleveradres v2 — deterministische JS-pariteit
------------------------------------------------------------------------
-- Tekenklasse = exact wat JS \s matcht: \t \n \v \f \r spatie NBSP U+1680
-- U+2000-200A LS PS U+202F U+205F U+3000 U+FEFF (BOM/ZWNBSP).
-- chr(223) = scharfes s klein (U+00DF), chr(7838) = hoofdletter-variant
-- (U+1E9E) — als chr() geschreven zodat er geen onzichtbare of verminkbare
-- literals in de functionele SQL staan (mojibake-historie op Windows).
CREATE OR REPLACE FUNCTION _normaliseer_afleveradres(
  p_adres    TEXT,
  p_postcode TEXT,
  p_land     TEXT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT
       -- postcode: alle whitespace weg
       COALESCE(NULLIF(TRIM(UPPER(REGEXP_REPLACE(
         REPLACE(REPLACE(COALESCE(p_postcode, ''), chr(223), 'ss'), chr(7838), 'ss'),
         '[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+',
         '', 'g'))), ''), '?')
    || '|'
       -- adres: whitespace-runs naar 1 spatie, randen trimmen
    || COALESCE(NULLIF(TRIM(UPPER(REGEXP_REPLACE(
         REPLACE(REPLACE(COALESCE(p_adres, ''), chr(223), 'ss'), chr(7838), 'ss'),
         '[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+',
         ' ', 'g'))), ''), '?')
    || '|'
       -- land: alleen rand-whitespace strippen (binnenste blijft, zoals TS .trim())
    || COALESCE(NULLIF(UPPER(REGEXP_REPLACE(
         REPLACE(REPLACE(COALESCE(p_land, ''), chr(223), 'ss'), chr(7838), 'ss'),
         '^[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
         '', 'g')), ''), '?');
$$;

COMMENT ON FUNCTION _normaliseer_afleveradres(TEXT, TEXT, TEXT) IS
  'Mig 222, gehard in mig 383: match-key voor afleveradres-vergelijking '
  '(postcode|adres|land, uppercase, JS-identieke whitespace-klasse, ss-fold). '
  'Contract: golden fixtures in frontend/src/lib/orders/__tests__/golden/'
  'bundel-sleutel.golden.json, afgedwongen door assert_bundel_sleutel_contract '
  '(SQL) en bundel-sleutel.contract.test.ts (TS). Wijzigen = golden bijwerken '
  '+ nieuwe *_bundel_sleutel_contract*.sql-migratie.';

------------------------------------------------------------------------
-- 2. assert_bundel_sleutel_contract — de SQL-consument van de golden fixtures
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_bundel_sleutel_contract(p_golden JSONB)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  f      JSONB;
  v_uit  TEXT;
  v_verw TEXT;
  v_n    INTEGER := 0;
BEGIN
  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'adres_cases') LOOP
    v_uit  := _normaliseer_afleveradres(f->>'afl_adres', f->>'afl_postcode', f->>'afl_land');
    v_verw := f->>'verwacht';
    IF v_uit IS DISTINCT FROM v_verw THEN
      RAISE EXCEPTION 'bundel-sleutel-contract adres_case "%": kreeg "%", verwacht "%"',
        f->>'naam', v_uit, v_verw;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'week_cases') LOOP
    v_uit  := verzendweek_voor_datum((f->>'datum')::date);
    v_verw := f->>'verwacht';
    IF v_uit IS DISTINCT FROM v_verw THEN
      RAISE EXCEPTION 'bundel-sleutel-contract week_case "%": kreeg "%", verwacht "%"',
        f->>'naam', v_uit, v_verw;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'sleutel_cases') LOOP
    v_uit := bundel_sleutel(
      (f->>'debiteur_nr')::integer,
      _normaliseer_afleveradres(f->>'afl_adres', f->>'afl_postcode', f->>'afl_land'),
      CASE WHEN COALESCE((f->>'afhalen')::boolean, FALSE)
           THEN 'AFHAAL' ELSE f->>'vervoerder_code' END,
      verzendweek_voor_datum((f->>'afleverdatum')::date)
    );
    v_verw := f->>'verwacht';
    IF v_uit IS DISTINCT FROM v_verw THEN
      RAISE EXCEPTION 'bundel-sleutel-contract sleutel_case "%": kreeg "%", verwacht "%"',
        f->>'naam', v_uit, v_verw;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'bundel-sleutel-contract: alle % cases geslaagd', v_n;
END $fn$;

COMMENT ON FUNCTION assert_bundel_sleutel_contract(JSONB) IS
  'Mig 383: toetst _normaliseer_afleveradres + verzendweek_voor_datum + '
  'bundel_sleutel tegen de golden fixtures (RAISE EXCEPTION bij mismatch). '
  'Aanroepen aan het eind van elke migratie die een van de drie wijzigt.';

------------------------------------------------------------------------
-- 3. Het contract draait nu — $golden$-blok = kopie van bundel-sleutel.golden.json
------------------------------------------------------------------------
SELECT assert_bundel_sleutel_contract($golden$
<<HIER DE INTEGRALE INHOUD VAN bundel-sleutel.golden.json PLAKKEN>>
$golden$::jsonb);

NOTIFY pgrst, 'reload schema';
```

Vervang de placeholder-regel `<<HIER …>>` door de letterlijke inhoud van het golden-bestand uit Task 1 (het hele JSON-object, van `{` t/m `}`).

- [ ] **Step 2: RED in de SQL Editor — assert tegen de óúde functie**

Plak in de Supabase SQL Editor **alleen sectie 2 + sectie 3** (assert-functie + aanroep, dus zónder de v2-herdefinitie van sectie 1) en draai.

Expected: `ERROR: bundel-sleutel-contract adres_case "NBSP (U+00A0) telt als spatie": …` of de ß-case — afhankelijk van de Task 2-probe-uitkomst. Dit is het formele bewijs dat de oude SQL-kant het contract schond. (Sloeg de probe in Task 2 op géén divergentie? Dan slaagt dit al — noteer dat en ga door; de v2 blijft nodig voor determinisme.)

- [ ] **Step 3: GREEN — draai de volledige migratie**

Draai het hele bestand `383_bundel_sleutel_contract.sql` in de SQL Editor.

Expected: `NOTICE: bundel-sleutel-contract: alle 21 cases geslaagd` en geen error. (21 = 10 adres + 6 week + 5 sleutel.)

- [ ] **Step 4: Steekproef tegen echte data — verandert er iets aan live clustering?**

```sql
-- Orders waarvan de adres-norm verandert door de v2 (NBSP/ß in de praktijk):
SELECT o.id, o.order_nr, o.afl_adres, o.afl_postcode, o.afl_land
  FROM orders o
 WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
   AND (o.afl_adres ~ E'[\u00A0\u202F]' OR o.afl_adres LIKE '%' || chr(223) || '%'
        OR o.afl_postcode ~ E'[\u00A0\u202F]');
```

Expected: 0 of een handvol rijen. Rijen die matchen worden voortaan *correcter* gebundeld (zelfde fysieke adres → zelfde sleutel); geen actie nodig, maar noteer aantallen in de commit-message.

- [ ] **Step 5: Run de sync-test — nu volledig GREEN**

```bash
cd frontend && npx vitest run src/lib/orders/__tests__/bundel-sleutel.contract.test.ts
```

Expected: alle tests PASS, inclusief "sync: golden ≡ $golden$-blok in de contract-migratie".

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/383_bundel_sleutel_contract.sql
git commit -m "feat(logistiek): bundel-sleutel-contract als zelf-testende migratie + JS-pariteit in _normaliseer_afleveradres (mig 383)

Probe-uitkomst live DB vóór fix: <PLAK HIER DE TASK-2-OUTPUT>
Steekproef geraakte open orders: <AANTAL uit Step 4>

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Typecheck + volledige test-run

- [ ] **Step 1: Typecheck (verplicht vóór merge — verzendweek-incident 9 juni)**

```bash
cd frontend && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 2: Volledige Vitest-run van de orders-module**

```bash
cd frontend && npx vitest run src/lib/orders
```

Expected: alles PASS behalve eventuele pre-existing failures die ook op main staan (check bij twijfel `git stash && npx vitest run src/lib/orders` op main; bekende pre-existing: `magazijn-pickbaarheid.contract.test.ts` faalt elders in de repo, niet in deze map).

---

### Task 5: Levende documentatie bijwerken (verplicht per CLAUDE.md)

**Files:**
- Modify: `docs/changelog.md` (nieuwe entry bovenaan)
- Modify: `docs/database-schema.md` (functie-beschrijvingen)
- Modify: `CLAUDE.md` (bundel-bedrijfsregel)
- Modify: `docs/superpowers/plans/2026-06-09-ts-sql-spiegeling-seam-consolidatie.md` (punt 5A afronden)

- [ ] **Step 1: Changelog-entry**

Voeg bovenaan de chronologische lijst in `docs/changelog.md` toe (stijl aanpassen aan bestaande entries):

```markdown
### 2026-06-12 — Bundel-sleutel SQL↔TS-contract met golden fixtures (mig 383)

De bundel-sleutel-familie (`_normaliseer_afleveradres`/`bundel_sleutel`/
`verzendweek_voor_datum` ↔ `normaliseer-adres.ts`/`bundel-sleutel.ts`/
`verzendweek.ts`) werd alleen door comments in lockstep gehouden. Nu: één
golden-fixture-bestand (`bundel-sleutel.golden.json`) met twee consumenten —
Vitest-contracttest (TS) en `assert_bundel_sleutel_contract()` (SQL, zelf-
testende migratie); een sync-test bewijst dat het `$golden$`-blok in de
laatste contract-migratie gelijk is aan de JSON. Tegelijk twee echte
divergentie-klassen gedicht: Unicode-whitespace (NBSP e.d. — JS `\s` matchte
die wel, Postgres locale-afhankelijk) en ß/ẞ→SS (JS full case mapping vs
Postgres per-karakter-upper) — relevant voor alle DE-adressen. Sleutels worden
nergens gepersisteerd, dus geen databackfill. Conventie: functie-wijziging =
golden bijwerken + nieuwe `*_bundel_sleutel_contract*.sql` met assert-aanroep.
```

- [ ] **Step 2: database-schema.md**

Zoek in `docs/database-schema.md` de beschrijving van `_normaliseer_afleveradres` (en/of de functie-lijst) en werk bij conform bestaande stijl:
- `_normaliseer_afleveradres`: vermeld "gehard in mig 383: JS-identieke whitespace-klasse + ß/ẞ→ss-fold; contract via golden fixtures".
- Nieuwe functie toevoegen: `assert_bundel_sleutel_contract(JSONB) → void` — "mig 383: toetst de bundel-sleutel-familie tegen golden fixtures; aanroepen in elke migratie die de familie wijzigt".

- [ ] **Step 3: CLAUDE.md-bedrijfsregel aanvullen**

Zoek in `CLAUDE.md` in de bullet **"Dynamische bundel-preview + week-dimensie (mig 228-230)"** de zin die eindigt op "gespiegeld in [`bundel-sleutel.ts`](frontend/src/lib/orders/bundel-sleutel.ts)." en breid uit tot:

```
gespiegeld in [`bundel-sleutel.ts`](frontend/src/lib/orders/bundel-sleutel.ts). **SQL↔TS-contract (mig 383):** golden fixtures in `frontend/src/lib/orders/__tests__/golden/bundel-sleutel.golden.json` toetsen beide kanten (Vitest-contracttest + `assert_bundel_sleutel_contract()`); wie `_normaliseer_afleveradres`/`bundel_sleutel`/`verzendweek_voor_datum` of de TS-spiegels wijzigt: golden bijwerken + nieuwe `*_bundel_sleutel_contract*.sql`-migratie die de assert opnieuw aanroept — de sync-test in `bundel-sleutel.contract.test.ts` wordt anders rood.
```

- [ ] **Step 4: Consolidatieplan 5A afronden**

In `docs/superpowers/plans/2026-06-09-ts-sql-spiegeling-seam-consolidatie.md`, sectie "Losse opruimingen", vervang de bullet **"Bundel-sleutel golden-fixture (5A)"** door:

```markdown
- **Bundel-sleutel golden-fixture (5A): ✅ uitgevoerd 2026-06-12** (mig 383 + `bundel-sleutel.contract.test.ts`, zie plan `2026-06-12-bundel-sleutel-sql-ts-contract.md`). Bonus: twee echte divergentie-klassen gedicht (Unicode-whitespace, ß/ẞ-fold) — de "geen bewezen bug"-inschatting bleek te optimistisch voor DE-adressen.
```

- [ ] **Step 5: Commit**

```bash
git add docs/changelog.md docs/database-schema.md CLAUDE.md docs/superpowers/plans/2026-06-09-ts-sql-spiegeling-seam-consolidatie.md
git commit -m "docs(logistiek): bundel-sleutel-contract in changelog, schema-docs, CLAUDE.md; consolidatieplan 5A afgerond

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Klaar voor merge

- [ ] **Her-verifieer het migratienummer** (`ls supabase/migrations/ | sort | tail -5` — geen tweede `383_*` van een parallelle branch; bij collisie hernummeren + sync-test opnieuw draaien).
- [ ] **Meld aan de gebruiker** dat `refactor/bundel-sleutel-contract` klaar is, met: de Task 2-probe-uitkomst (was de divergentie live aantoonbaar?), het aantal geraakte open orders (Task 3 Step 4), en dat mig 383 al handmatig is toegepast in de SQL Editor. **Niet zelf mergen** — wachten op expliciet "merge naar main" (CLAUDE.md git-workflow; merge via push `branch:main` naar origin, niet via lokale main-ref).

---

## Self-Review

**1. Spec-dekking:** De bevinding vroeg om (a) verificatie — gedaan, met twee concrete divergentie-klassen scherper dan de oorspronkelijke claim; (b) contracttest met golden fixtures als SQL-assertions in een migratie én in Vitest — Task 1 (Vitest) + Task 3 (migratie); (c) "één fixture-bestand, twee consumenten" — de sync-test in Task 1 Step 2 dwingt de gelijkheid golden.json ≡ `$golden$`-blok af, en de naamconventie `*_bundel_sleutel_contract*.sql` houdt dat houdbaar bij toekomstige wijzigingen. De "~65 call-sites"-claim uit de review is niet exact gereproduceerd (117 treffers over 36 bestanden voor de hele familie, deels docs) maar de orde van grootte en het risico kloppen.

**2. Placeholder-scan:** Eén bewuste placeholder: `<<HIER DE INTEGRALE INHOUD VAN bundel-sleutel.golden.json PLAKKEN>>` in Task 3 Step 1 — dat is een kopieer-instructie van een in Task 1 volledig uitgeschreven artefact (geen ontwerpgat), expliciet zo gemarkeerd omdat dubbel afdrukken van 70 regels JSON de kans op transcriptie-drift juist vergroot; de sync-test vangt elke kopieerfout. Commit-messages bevatten invulvelden voor empirische uitkomsten (probe-output, aantallen) — per definitie pas bij uitvoering bekend.

**3. Type-consistentie:** `normaliseerAdresKey`-signatuur ongewijzigd (alle bestaande callers blijven werken); `bundelSleutelVoorOrder`-aanroep in de test matcht de bestaande interface incl. optionele `afhalen`; SQL-signaturen `_normaliseer_afleveradres(TEXT,TEXT,TEXT)` en `bundel_sleutel(INTEGER,TEXT,TEXT,TEXT)` identiek aan mig 222/228 (CREATE OR REPLACE zonder signatuurwijziging — geen view/RPC-herdefinities nodig). Case-telling klopt: 10+6+5=21. Het zoekpatroon van de sync-test (`bundel_sleutel_contract`) matcht de migratie-bestandsnaam.
