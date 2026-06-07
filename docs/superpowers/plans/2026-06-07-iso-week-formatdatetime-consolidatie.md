# Plan: Consolidatie ISO-week-/verzendweek-berekening + `formatDateTime`

**Datum:** 2026-06-07
**Type:** Deepening / techdebt — duplicatie → één bron-van-waarheid
**Status:** Voorstel (geverifieerd via parallel onderzoek)

---

## 1. Aanleiding

Een code-review markeerde twee verwante duplicatie-clusters:

1. **Verzendweek-/ISO-week-resolutie** — het ISO-weeknummer wordt op meerdere
   plekken opnieuw uitgevonden, deels op UTC, deels op lokale tijd, elk met een
   eigen jaarwissel-randgeval. Dit is geen cosmetische duplicatie maar een
   **latente timezone-bug op een leverbelofte-veld**.
2. **`formatDateTime`** — vier component-lokale kopieën van datum/tijd-formattering,
   met onderling verschillende output (met/zonder seconden, met/zonder jaar),
   terwijl `formatters.ts` wél `formatDate`/`formatCurrency` heeft maar geen
   `formatDateTime`.

Beide zitten "in dezelfde hoek" (een presentatie-/rekenkern die niet centraal
staat) en worden in dit plan samen aangepakt.

### Gekozen richting (beslissingen 2026-06-07)

- **Week-kern locatie:** `lib/utils/iso-week.ts` wordt de **UTC-correcte** kern.
  De huidige lokale-tijd-implementatie daar is de bug; we vervangen die door de
  bewezen UTC-variant uit `verzendweek.ts`. `verzendweek.ts` en alle overige
  consumenten importeren voortaan de kern.
- **Scope:** Frontend **én** edge functions (Deno). Edge functions delen geen
  module-import met de frontend; die krijgen een eigen `_shared/iso-week.ts`-spiegel.
- **Leverbaar:** Dit plan-document. Geen code-wijzigingen vóór akkoord.

---

## 2. Verifieerde bevindingen

### 2.1 ISO-week — volledige inventaris (geverifieerd)

De review noemde "4 plekken"; de verfijnde review "6 frontend-implementaties".
Parallel onderzoek bevestigt **6 frontend-duplicaten** + **centrale helpers** +
**edge-function-duplicaten**. Volledige tabel:

| # | Bestand | Functie | Tijd-basis | Return | Status |
|---|---------|---------|-----------|--------|--------|
| 1 | [iso-week.ts](../../../frontend/src/lib/utils/iso-week.ts) | `isoWeek` / `isoWeekString` / `isoWeekFromString` | **lokaal** ⚠ | `number` / `"YYYY-Www"` / `string\|null` | centraal (buggy) |
| 2 | [verzendweek.ts:13](../../../frontend/src/lib/orders/verzendweek.ts#L13) | `isoWeek` (+ verzend-helpers) | **UTC** ✓ | `{jaar, week}` | centraal (correct) |
| 3 | [forward-planner.ts:6](../../../frontend/src/modules/confectie/lib/forward-planner.ts#L6) | `isoWeekKey` | lokaal | `"YYYY-Www"` | duplicaat |
| 4 | [supplier-portal.tsx:66](../../../frontend/src/pages/portal/supplier-portal.tsx#L66) | `isoWeek` | lokaal | `"Wk N, YYYY"` | duplicaat |
| 5 | [levertijd-suggestie.tsx:163](../../../frontend/src/components/orders/levertijd-suggestie.tsx#L163) | `isoWeekUit` | UTC | `number` | duplicaat |
| 6 | [inkoop-regel-overzicht-tab.tsx:33](../../../frontend/src/modules/inkoop/components/inkoop-regel-overzicht-tab.tsx#L33) | `isoWeekLabel` | lokaal | `"wk NN"` | duplicaat |
| 7 | [buckets.ts](../../../frontend/src/modules/magazijn/lib/buckets.ts) | `bucketVoor` / `genereerWeekTabs` | — | — | ✓ importeert al uit verzendweek.ts |
| 8 | [bundel-sleutel.ts:19](../../../frontend/src/lib/orders/bundel-sleutel.ts#L19) | — | — | — | ✓ importeert `verzendWeekIsoString` |

**Edge functions (Deno) — eigen duplicaten:**

| # | Bestand | Functie | Tijd-basis | Status |
|---|---------|---------|-----------|--------|
| 9 | `supabase/functions/_shared/levertijd-capacity.ts` | `isoWeekJaar` / `snijWeekVoorLever` | UTC | duplicaat |
| 10 | `supabase/functions/_shared/spoed-check.ts` | `isoWeekEnJaar` / `isoWeekStart` | UTC | duplicaat |
| 11 | `supabase/functions/stuur-orderbevestiging/index.ts` | `verzendweekLabel` | **lokaal** ⚠ | duplicaat |
| 12 | `supabase/functions/_shared/levertijd-match.ts` | `maandagVanWeek` | UTC | week-arithmetiek (util-kandidaat) |

> **Werkdag-aritmetiek apart houden.** `_shared/werkagenda.ts` /
> `lib/utils/bereken-agenda.ts` (mig 279-spiegel) en
> `confectie/lib/deadline.ts` rekenen met **werkdag-offsets**, niet met
> ISO-weeknummers. Die vallen **buiten** dit plan — niet samenvoegen met de
> week-kern.

### 2.2 SQL-tegenhanger (geverifieerd — géén blocker)

- `verzendweek_voor_datum(DATE) → TEXT` (mig 228) =
  `to_char(p_datum,'IYYY') || '-W' || to_char(p_datum,'IW')`.
- `iso_week_plus(DATE, INT)` (mig 145) — variant met week-offset.
- Werkt op `DATE` (timezone-onafhankelijk per definitie) → **dit is de juiste,
  TZ-veilige referentie**. De TS-kern moet hierop aansluiten.

> **Correctie op een eerdere onderzoeks-claim.** Er werd een "HOOG RISICO"
> padding-mismatch gemeld (TS `2026-W03` vs SQL `2026-W3`). Dit is **onjuist**:
> PostgreSQL `to_char(date,'IW')` zéro-padt naar 2 cijfers (`03`). TS
> (`padStart(2,'0')`) en SQL matchen dus. **Geen blocker.** Wel als
> regressietest vastleggen (zie §5).

### 2.3 De échte bug

De divergentie zit tussen **lokale-tijd**- en **UTC**-implementaties. Voor een
datum zonder tijdcomponent (`afleverdatum` is `DATE`) levert een lokale-tijd-
berekening in tijdzones ≠ UTC rond **middernacht en jaargrenzen** een ander
weeknummer op dan de UTC/SQL-referentie. Dat raakt:

- `iso-week.ts` (#1) — lokaal, gebruikt op order-regel-/product-/claim-detail.
- `forward-planner.ts` (#3) — lokaal, **grouping-sleutel** voor confectie-planning.
- `inkoop-regel-overzicht-tab.tsx` (#6) & `supplier-portal.tsx` (#4) — lokaal, labels.
- `stuur-orderbevestiging` (#11) — lokaal, **week-label op de orderbevestiging
  naar de klant** (hoogste impact: externe communicatie).

Bovendien wijken sommige duplicaten af in afronding (`Math.round` vs `Math.ceil`),
wat een extra off-by-one-bron is rond week 52/53.

### 2.4 `formatDateTime` — inventaris (geverifieerd)

[`formatters.ts`](../../../frontend/src/lib/utils/formatters.ts) exporteert
`formatCurrency`, `formatDate`, `formatPercentage`, `formatNumber` — **geen**
`formatDateTime`. Vier componenten rollen hun eigen versie:

| Bestand | Jaar | Seconden | Null-safe | Methode |
|---------|------|----------|-----------|---------|
| [confectie-tabel.tsx:10](../../../frontend/src/components/confectie/confectie-tabel.tsx#L10) | nee | nee | ja (`'—'`) | Intl |
| [berichten-overzicht.tsx:307](../../../frontend/src/modules/edi/pages/berichten-overzicht.tsx#L307) | ja | nee | nee | Intl |
| [bericht-detail.tsx:324](../../../frontend/src/modules/edi/pages/bericht-detail.tsx#L324) | ja | **ja** | nee | Intl |
| [hst-transportorder-card.tsx:135](../../../frontend/src/modules/logistiek/components/hst-transportorder-card.tsx#L135) | ja | nee | nee | Intl |

Plus een vijfde: [supplier-portal.tsx:60](../../../frontend/src/pages/portal/supplier-portal.tsx#L60)
heeft een lokale `formatDate` (split/rejoin) die `formatters.ts::formatDate`
dupliceert. Geen van de vijf importeert `formatters.ts`.

Rijkste variant = `bericht-detail.tsx` (jaar + seconden + Intl).

---

## 3. Doel-architectuur

### 3.1 Frontend week-kern (`lib/utils/iso-week.ts`)

Eén UTC-correcte rekenkern; alle labels eromheen zijn dunne consumenten.

```ts
// lib/utils/iso-week.ts — UTC-kern (vervangt huidige lokale impl.)

/** ISO-week + ISO-jaar voor een datum. UTC-gebaseerd; TZ-onafhankelijk. */
export function isoWeekJaar(d: Date): { jaar: number; week: number }

/** ISO-weeknummer (1-53). */
export function isoWeek(d: Date): number            // = isoWeekJaar(d).week

/** Sorteer-/sleutel-string "YYYY-Www" (zero-padded, matcht SQL to_char IW). */
export function isoWeekString(d: Date): string

/** Maandag (UTC-midnight) van de ISO-week van d. */
export function isoWeekMaandag(d: Date): Date

/** Maandag→zondag range voor (jaar, week) — t.b.v. week-headers. */
export function isoWeekRange(jaar: number, week: number): { van: Date; tot: Date }

/** Veilige string-variant: "YYYY-MM-DD" → "YYYY-Www" of null. */
export function isoWeekStringFromIso(iso: string | null | undefined): string | null
```

Eén interface (`datum → week`) = één testoppervlak. De buggy lokale variant is
daarna onbereikbaar.

### 3.2 `verzendweek.ts` als dunne consument

`verzendweek.ts` behoudt z'n domein-helpers (`verzendWeekSleutel`,
`verzendWeekLabel`, `verzendWeekKort`, `verzendWeekIsoString`,
`verzendWeekStringToDatum`, `verzendWeekDiff`, `pickWeek*`, `pickStatus*`) maar
**verwijdert de eigen `isoWeek`/`isoMaandag`** en importeert die uit de kern.
De label-formattering (NL-teksten) blijft hier lokaal — alleen het *rekenen* gaat weg.

`bundel-sleutel.ts` blijft `verzendWeekIsoString` consumeren (ongewijzigd).

### 3.3 Edge-function-kern (`supabase/functions/_shared/iso-week.ts`)

Nieuwe `_shared/iso-week.ts` met dezelfde UTC-kern (Deno kan de frontend-module
niet importeren). `levertijd-capacity.ts`, `spoed-check.ts`,
`levertijd-match.ts` en `stuur-orderbevestiging/index.ts` consumeren die.
Dit haalt met name de **lokale-tijd** `verzendweekLabel` in de orderbevestiging
gelijk met de rest.

### 3.4 `formatDateTime` in `formatters.ts`

```ts
// lib/utils/formatters.ts — toevoegen

/** Datum + tijd in NL-formaat: 07-06-2026 14:03 (of 14:03:25 met seconds). */
export function formatDateTime(
  iso: string | null | undefined,
  opts?: { seconds?: boolean }
): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const datum = d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const tijd = d.toLocaleTimeString('nl-NL', {
    hour: '2-digit', minute: '2-digit',
    ...(opts?.seconds ? { second: '2-digit' } : {}),
  })
  return `${datum} ${tijd}`
}
```

De vijf kopieën worden imports. `bericht-detail.tsx` gebruikt
`formatDateTime(x, { seconds: true })`; `supplier-portal.tsx` gebruikt
`formatters.ts::formatDate`.

> **Bewuste output-normalisatie:** `confectie-tabel.tsx` toonde voorheen géén
> jaar (DD-MM HH:MM). Na centralisatie krijgt het jaar erbij (DD-MM-YYYY HH:MM),
> conform de CLAUDE.md-conventie. Dit is een zichtbare maar gewenste wijziging —
> in PR-omschrijving benoemen.

---

## 4. Implementatie — verticale slices

Volgorde zo dat na elke slice alles compileert en testbaar is.

### Slice A — Frontend week-kern + tests (fundament)
1. Herschrijf `lib/utils/iso-week.ts` naar de UTC-kern (§3.1).
2. Schrijf `lib/utils/__tests__/iso-week.test.ts` (zie §5) — **eerst rood, dan groen**.
3. `npm run test` + `tsc --noEmit` groen.

### Slice B — `verzendweek.ts` consumeert de kern
1. Verwijder `isoWeek`/`isoMaandag` uit `verzendweek.ts`; importeer uit kern.
2. Bestaande `verzendweek.test.ts` (80+ cases) moet **ongewijzigd groen** blijven
   — dit is de regressie-vangnet dat de kern UTC-correct is.

### Slice C — Frontend duplicaten → consumenten
Per bestand: lokale functie verwijderen, kern importeren, label-laag behouden.
1. `forward-planner.ts` → `isoWeekKey` = `isoWeekString` (let op: was lokaal → nu UTC; grouping-sleutel verandert mogelijk rond jaargrens — gewenst).
2. `supplier-portal.tsx` → `isoWeek` label via kern.
3. `levertijd-suggestie.tsx` → `isoWeekUit` = `isoWeek` (verwijdert `Math.round`-variant).
4. `inkoop-regel-overzicht-tab.tsx` → `isoWeekLabel` via kern.

### Slice D — Edge-function-kern
1. Nieuwe `supabase/functions/_shared/iso-week.ts` (UTC-kern + Deno-test).
2. `levertijd-capacity.ts`, `spoed-check.ts`, `levertijd-match.ts` consumeren.
3. `stuur-orderbevestiging/index.ts`: `verzendweekLabel` → kern (lokaal→UTC fix).
4. Edge functions die wijzigen handmatig **deployen** (geen auto-deploy in repo).

### Slice E — `formatDateTime` centralisatie
1. `formatDateTime` toevoegen aan `formatters.ts` + unit-test.
2. Vijf kopieën vervangen door imports (4× `formatDateTime`, 1× `formatDate`).

### Slice F — Documentatie
1. `docs/data-woordenboek.md`: ijk "Verzendweek" — kern woont nu in
   `lib/utils/iso-week.ts` (UTC), `verzendweek.ts` levert domein-labels.
2. `docs/architectuur.md`: noteer de week-kern + `formatDateTime` als gedeelde utils.
3. `docs/changelog.md`: datum + wat + waarom.

---

## 5. Test-strategie

De kernwaarde is dat **datum → week** op één plek testbaar wordt. Verplichte cases
in `iso-week.test.ts`:

- **Jaargrens:** `2026-12-27` (zo) → week 52/2026; `2027-01-04` (ma) → week 1/2027;
  `2026-12-31` → ISO-jaar **2027** (donderdag-regel).
- **Week 53:** een jaar met 53 ISO-weken (bv. 2026 heeft 53? verifiëren — anders 2020/2032).
- **Padding:** week 3 → `"2026-W03"` (matcht SQL `to_char IW`).
- **TZ-robuustheid:** dezelfde kalenderdatum geprikt om `T00:00:00Z` én `T23:00:00Z`
  levert hetzelfde weeknummer (bewijst dat de lokale-tijd-bug weg is).
- **SQL-pariteit (regressie):** een vaste set datums waarvan de verwachte
  `"YYYY-Www"` 1-op-1 gelijk is aan wat `verzendweek_voor_datum` zou geven.
- **`isoWeekRange`:** (2026, 19) → maandag/zondag correct.

`verzendweek.test.ts` blijft de integrale regressietest voor de domein-laag.

---

## 6. Risico's & aandachtspunten

| Risico | Mitigatie |
|--------|-----------|
| Lokaal→UTC verschuift bestaande labels rond jaargrens | Gewenst gedrag (bug-fix); benoemen in PR; tests dekken de grensgevallen |
| `forward-planner` grouping-sleutel verandert | Zelfde sleutel-format; alleen randdatums verschuiven — naar de **correcte** week |
| `confectie-tabel` toont nu jaar in datum/tijd | Bewuste normalisatie naar CLAUDE.md-conventie; benoemen |
| Edge functions niet auto-gedeployed | Slice D expliciet: handmatige deploy + rondreis-check |
| Twee kern-kopieën (frontend + Deno) drijven uit | Identieke test-set in beide; comment-pointer naar elkaar; SQL is de overkoepelende waarheid |

---

## 7. Acceptatiecriteria

- [ ] Eén UTC-kern in `lib/utils/iso-week.ts`; geen lokale-tijd-weekberekening meer in frontend.
- [ ] `verzendweek.ts` + 4 frontend-duplicaten (#3–#6) importeren de kern; geen eigen `isoWeek*`.
- [ ] `_shared/iso-week.ts` bestaat; #9–#12 consumeren die; `stuur-orderbevestiging` is UTC-correct.
- [ ] `formatDateTime` in `formatters.ts`; 5 kopieën verwijderd.
- [ ] `iso-week.test.ts` dekt jaargrens, week 53, padding, TZ-robuustheid, SQL-pariteit; alle tests groen.
- [ ] `verzendweek.test.ts` ongewijzigd groen.
- [ ] `tsc --noEmit` + lint groen; gewijzigde edge functions gedeployed.
- [ ] `data-woordenboek.md`, `architectuur.md`, `changelog.md` bijgewerkt.

---

## 8. Buiten scope

- Werkdag-aritmetiek (`werkagenda.ts` / `bereken-agenda.ts` / `deadline.ts`, mig 279).
- SQL-functies `verzendweek_voor_datum` / `iso_week_plus` (zijn correct; blijven de referentie).
- Verdere formatter-uitbreiding buiten `formatDateTime`.
