---
status: accepted
date: 2026-05-08
---

# Maatwerk als deep Module — `op-maat.ts` god-bestand vervalt; medium-scope met admin-CRUD; hooks-import-seam vanuit Orders

## Context

Maatwerk is in V1 uitgebouwd als een **runtime-flow** (Standaard / Op maat-toggle, vorm-keuze, m²-prijs, levertijd-hint, snij-marge) plus een **admin-laag** (vormen, afwerkingen, m²-prijs-tabel, band-kleur-defaults). Code en queries leven verspreid:

- [`frontend/src/lib/supabase/queries/op-maat.ts`](../../frontend/src/lib/supabase/queries/op-maat.ts) — 761 regels, **39 exports** met overlappende verantwoordelijkheden (CRUD-rijen voor admin + runtime-lookups + selector-data)
- [`frontend/src/components/orders/order-form.tsx`](../../frontend/src/components/orders/order-form.tsx) — 939 regels, ~40 maatwerk-touchpoints
- [`frontend/src/components/orders/kwaliteit-first-selector.tsx`](../../frontend/src/components/orders/kwaliteit-first-selector.tsx) — 783 regels, alleen door order-line-editor in maatwerk-flow gebruikt
- [`frontend/src/components/orders/op-maat-selector.tsx`](../../frontend/src/components/orders/op-maat-selector.tsx), [`maatwerk-levertijd-hint.tsx`](../../frontend/src/components/orders/maatwerk-levertijd-hint.tsx)
- [`frontend/src/lib/utils/maatwerk-prijs.ts`](../../frontend/src/lib/utils/maatwerk-prijs.ts) — bbox × m²-prijs + €75 vorm-toeslag
- [`frontend/src/lib/utils/maatwerk-leverdatum.ts`](../../frontend/src/lib/utils/maatwerk-leverdatum.ts)
- [`frontend/src/pages/instellingen/vormen.tsx`](../../frontend/src/pages/instellingen/vormen.tsx), [`afwerkingen.tsx`](../../frontend/src/pages/instellingen/afwerkingen.tsx) — admin-CRUD
- DB-tabellen `maatwerk_vormen`, `afwerking_types`, `afwerking_kleuren` (mig 194), `maatwerk_band_defaults`, `maatwerk_m2_prijzen`, vorm-toeslag-RPCs (mig 179-183)

Voor andere domeinen — Logistiek, Magazijn, EDI, Orders, Planning, Voorraadpositie, Order-lifecycle (ADR-0006), Facturatie (ADR-0007) — bestaat een `modules/{naam}/`-folder met expliciete seam. Voor Maatwerk niet. **Deletion-test op `op-maat.ts`:** complexiteit verspreidt zich over 5+ callers (order-form, order-line-editor, kwaliteit-first-selector, instellingen-pages, klanteigen-namen-tab) — bewijs dat het concept echt werk doet, maar zonder cohesie. De interface is **shallow**: 39 losse exports met onduidelijke rangschikking (welke is admin-CRUD, welke is runtime-lookup, welke is selector-bron?).

De architectuur-review van 2026-05-08 markeerde dit als #1 deepening-kandidaat — naast Producten, Klanten, Inkoop en Reservering, allemaal nog zonder Module-eigenaar maar met kleinere blast-radius.

## Beslissing

Maak **`modules/maatwerk/`** als deep verticale Module. Drie ankers, vastgesteld in grilling-loop op 2026-05-08:

### Anker 1 — Naam: Maatwerk (DB-aligned)

Folder `modules/maatwerk/`, term **Maatwerk-Module** in docs. De UI-toggle "Standaard / Op maat" en de bestaande filenames `op-maat-*` worden hernoemd. Reden: DB-kolommen heten `is_maatwerk`, `maatwerk_kwaliteit_code`, `maatwerk_afwerking`, `maatwerk_band_kleur`, `maatwerk_m2_prijzen`, `maatwerk_band_defaults`, `maatwerk_vormen`. Data-woordenboek-term is "Maatwerk", niet "Op Maat". Module-naam mag niet driften van DB-naam — anders krijg je dezelfde "vier ladders voor één concept"-verspreiding die ADR-0008 net opruimde.

### Anker 2 — Scope: Medium (incl. admin-CRUD, exclusief snij-marge)

De Module bezit:

- **Runtime-flow**: maatwerk-selectors (kwaliteit/kleur/vorm/afwerking/band-kleur), prijs-formule, oppervlak-formule (bbox), levertijd-hint, m²-prijs-lookup, standaard-defaults per kwaliteit/kleur
- **Admin-CRUD**: vormen, afwerkingen, m²-prijzen, band-kleur-defaults — pages verhuizen van `pages/instellingen/` naar `modules/maatwerk/pages/`
- **Mentaal eigendom (geen fysieke verhuizing)**: tabellen `maatwerk_vormen`, `afwerking_types`, `afwerking_kleuren`, `maatwerk_band_defaults`, `maatwerk_m2_prijzen`; vorm-toeslag-RPCs (mig 179-183); band-kleur-FK (mig 194)

De Module bezit **niet**:

- **SQL `stuk_snij_marge_cm` + view-kolommen op `snijplanning_overzicht`** (mig 126/143/233) — blijft cross-cut; Planning's `check-levertijd` edge function en `auto-plan-groep` consumeren de placed-kolommen via `_shared/db-helpers.fetchStukken`. Maatwerk's prijs-formule consumeert de SQL-functie indirect via `bereken_orderregel_prijs`. Twee adapters maken het een echt seam, geen Module-eigendom. **Update mig 233**: TS-spiegels verwijderd, SQL is enige bron-van-waarheid; consumers lezen via view-kolommen i.p.v. via TS-functie-import.
- **Gewicht-resolver** (mig 184-186) — blijft eigen SQL-Module met smal publiek interface (`gewicht_per_m2_voor_kwaliteit`, `bereken_product_gewicht_kg`, `bereken_orderregel_gewicht_kg`). De bbox-keuze voor maatwerk-vormen vs cirkel voor catalogus-rond blijft daar gemaakt — gewicht-resolver weet hoe oppervlak te bepalen per producttype, Maatwerk hoeft niets te exporteren.
- **`<LevertijdSuggestie>`** — blijft in `modules/planning/`. Consumeert door order-form als slot. Maatwerk-Module heeft een **eigen** `<MaatwerkLevertijdHint>` met andere semantiek (eerstvolgende inkoop + 2 weken buffer, geen capaciteits-simulatie). De twee hints staan naast elkaar, niet in elkaar.

### Anker 3 — Seam-stijl: Hooks-import (geen slot-pattern)

Order-form (939 regels, eigendom van `modules/orders/` per ADR-0001) blijft host van de UI. Imports verschuiven naar `@/modules/maatwerk`:

```ts
// frontend/src/components/orders/order-form.tsx (orders-Module)
import {
  useMaatwerkKwaliteitOpties,
  useMaatwerkKleurOpties,
  useVormOpties,
  useKwaliteitM2Prijs,
  useStandaardBandKleur,
  computeMaatwerkPrijs,
  computeMaatwerkOppervlak,
  type MaatwerkVormRow,
} from '@/modules/maatwerk';
```

Geen `<MaatwerkRegelEditor>` slot, geen `<MaatwerkRegelRow>`-extractie. Reden: 939 regels herschrijven heeft hoge blast-radius en weinig leverage als de UI toch host blijft. Hooks-import geeft de Module-grens zonder de UI te raken. Vergelijk met ADR-0007 (Facturatie): ook daar bleef `klant-facturering-tab.tsx` host en kwam de Module via barrel-import binnen.

### Module-Interface (publieke barrel)

`modules/maatwerk/index.ts` exporteert:

**Hooks (data-fetching, mutations):**
- `useMaatwerkKwaliteitOpties`, `useMaatwerkKleurOpties(kw)`
- `useVormOpties`, `useAfwerkingTypes`
- `useKwaliteitM2Prijs(kw)`, `useStandaardBandKleur(kw, kl, afwerking)`, `useStandaardAfwerking(kw)`, `useAfwerkingVoorKleur(kw, kl)`
- `useStandaardMatenVoorKwaliteit(kw)`, `useMaatwerkArtikelNr(kw, kl)`
- `useMaatwerkLevertijdHint({...})`
- Admin: `useUpsertVorm`, `useDeleteVorm`, `useUpsertAfwerkingType`, `useSetStandaardAfwerking`, `useSetBandKleurDefault`

**Pure functies (geen DB):**
- `computeMaatwerkPrijs({vorm, lengte, breedte, m2Prijs, vormToeslag, korting})`
- `computeMaatwerkOppervlak({vorm, lengte, breedte})` — bbox-formule (rond → diameter², ovaal → bbox, rechthoek → l × b)
- `bepaalMaatwerkLeverdatum({...})` — uit `maatwerk-leverdatum.ts`

**Components:**
- `<MaatwerkSelector>` (was `op-maat-selector.tsx`)
- `<MaatwerkLevertijdHint>`
- `<KwaliteitFirstSelector>` (alleen door order-line-editor in maatwerk-flow gebruikt)
- `<VormAfmetingSelector>`

**Types:** `MaatwerkVormRow`, `AfwerkingType`, `BandDefault`, `KwaliteitOptie`, `KleurOptie`, `MaatwerkLevertijdHintResult`, `StandaardMaat`

**Pages (router-imports):** `VormenInstellingen`, `AfwerkingenInstellingen`, `M2PrijzenInstellingen`, `BandKleurenInstellingen`

Geen barrel-export van `lib/queries/`-helpers — die blijven intern (interne implementatie). Geen barrel-export van losse query-functies (zoals `fetchVormen`) — alleen hooks naar buiten, om te garanderen dat alle callers via React Query gaan en cache-invalidatie consistent is.

### Frontend-folder-structuur

```
frontend/src/modules/maatwerk/
├── index.ts                               ← barrel
├── components/
│   ├── maatwerk-selector.tsx              ← van components/orders/op-maat-selector
│   ├── maatwerk-levertijd-hint.tsx        ← van components/orders/
│   ├── kwaliteit-first-selector.tsx       ← van components/orders/ (783 regels, alleen maatwerk-flow)
│   └── vorm-afmeting-selector.tsx
├── pages/
│   ├── vormen-instellingen.tsx            ← van pages/instellingen/vormen.tsx
│   ├── afwerkingen-instellingen.tsx       ← van pages/instellingen/afwerkingen.tsx
│   ├── m2-prijzen-instellingen.tsx
│   └── band-kleuren-instellingen.tsx
├── hooks/
│   ├── use-maatwerk-opties.ts
│   ├── use-kwaliteit-m2-prijs.ts
│   ├── use-standaard-band-kleur.ts
│   ├── use-standaard-afwerking.ts
│   ├── use-maatwerk-levertijd-hint.ts
│   └── use-maatwerk-instellingen.ts        ← admin-mutations
├── queries/
│   └── maatwerk-runtime.ts                 ← van lib/supabase/queries/op-maat.ts (gesplitst)
└── lib/
    ├── prijs.ts                            ← van lib/utils/maatwerk-prijs.ts
    ├── oppervlak.ts                        ← bbox-formule
    └── leverdatum.ts                       ← van lib/utils/maatwerk-leverdatum.ts
```

### Module-eigenaarschap (mentaal vs fysiek)

Volgt ADR-0001/0007:

- **Frontend-eigendom (fysiek)**: alle bovengenoemde files in `modules/maatwerk/`.
- **Backend-eigendom (mentaal)**: tabellen + RPCs leven in `supabase/migrations/` zoals voorheen. Module-doc verwijst er naar; geen verhuizing van migraties.
- **Cross-cut behoud**: SQL `stuk_snij_marge_cm` + view-kolommen `marge_cm`/`placed_*` op `snijplanning_overzicht` blijven staan; Planning's `check-levertijd` blijft consumeren via `_shared/db-helpers.fetchStukken`. (TS-spiegels weggehaald in mig 233.)

### Migratiepad

Eén PR, geen schema-wijziging:

1. Folder `modules/maatwerk/` aanmaken + barrel.
2. ~12 files verhuizen volgens tabel hierboven; imports updaten in order-form, order-line-editor, klanteigen-namen-tab (waar relevant).
3. `op-maat.ts` (761 regels, 39 exports) splitsen:
   - Runtime-lookups + selector-data → `queries/maatwerk-runtime.ts`
   - Pure formules → `lib/prijs.ts`, `lib/oppervlak.ts`
   - Admin-mutations → `hooks/use-maatwerk-instellingen.ts`
4. Routes voor admin-pages: huidige `/instellingen/vormen`, `/instellingen/afwerkingen` blijven werken; één release lang bestaan beide paden, daarna alleen de nieuwe (eventueel gegroepeerd onder `/instellingen/maatwerk/`).
5. Verwijder oude files (`components/orders/op-maat-selector.tsx`, `maatwerk-levertijd-hint.tsx`, `kwaliteit-first-selector.tsx`, `lib/utils/maatwerk-prijs.ts`, `lib/utils/maatwerk-leverdatum.ts`, `lib/supabase/queries/op-maat.ts`, `pages/instellingen/vormen.tsx`, `afwerkingen.tsx`).
6. Bestaande tests in `lib/supabase/queries/__tests__/op-maat.test.ts` verhuizen naar `modules/maatwerk/queries/__tests__/`.

Geen DB-migratie. Geen edge-function-wijziging. Geen contract-test-toevoeging — de bestaande `op-maat.test.ts` dekt het kritieke pad.

## Overwogen alternatieven

- **Smal scope (admin-CRUD blijft in `pages/instellingen/`)** — afgewezen. Concept-eigenaarschap zou versplinteren: Module die zegt "ik bezit Maatwerk-domein" maar de admin-tabellen niet kent, is shallow. M²-prijzen en vorm-toeslag-defaults zijn de bron-van-waarheid voor de runtime-formule; ze horen bij dezelfde Module. Vergelijk met Facturatie-Module (ADR-0007) waar `factuurvoorkeur` op `debiteuren` blijft maar concept-eigenaarschap toch bij de Module ligt — hier kan de admin-page wél fysiek mee.

- **Breed scope (incl. snij-marge-formule)** — afgewezen. SQL `stuk_snij_marge_cm` (mig 126) wordt ook door Planning's `check-levertijd` edge function en `auto-plan-groep` gebruikt. Maatwerk-eigendom zou een formule-contract via barrel forceren dat door edge-functions geïmporteerd moet worden — extra coupling zonder duidelijke leverage. De formule is *gedeeld domein-kennis* (snij-machine-marge per vorm/afwerking), niet *Maatwerk-specifiek*. Twee adapters (Maatwerk-prijs-frontend via `bereken_orderregel_prijs` + Planning-edge via view-kolommen) maken het een echt cross-cut seam, niet een Module-export. Sinds mig 233 zit het seam volledig in SQL (geen TS-spiegels meer).

- **Slot-pattern (`<MaatwerkRegelEditor>` self-fetcht)** — afgewezen. Order-form is 939 regels met 40 maatwerk-touchpoints; een slot zou herschrijving van de form-flow vereisen, of een tweede UI-render-pad creëren. Hooks-import bereikt de Module-grens zonder de UI te raken. Slot-pattern is waardevol voor *cross-Module-presentatie* (`<VervoerderTag>` van Logistiek in Magazijn-pick-card) waar data-coupling vermeden moet worden — niet voor *intra-Module-velden* die toch in de form leven.

- **Regel-row-splitsing (`<StandaardRegelRow>` + `<MaatwerkRegelRow>`)** — afgewezen voor V1, mogelijk V2. Geeft de duidelijkste locality (alle maatwerk-velden op één plek) maar vereist refactor van de form-state-management; korting, prijslijst-lookup, regel-volgnummer leven nu één laag boven de regel-rij. Hooks-import-stap zet eerst de Module-grens; row-splitsing kan daarna in een afzonderlijke PR.

- **Naam "Op Maat"** — afgewezen. Sluit aan bij UI-toggle en bestaande filenames (`op-maat-*`), maar drift van DB-kolomnamen (`is_maatwerk`, `maatwerk_*`) en data-woordenboek-term. Module-naam moet anker zijn voor een lange tijd; aansluiten bij DB-vocab voorkomt future "wat heet wat" verwarring. Architectuur.md-sectie "Op Maat Module" wordt hernoemd.

- **Eigen tabel `maatwerk_instellingen` voor m²-prijs + vorm-toeslag-bedrag** — afgewezen voor V1. Vorm-toeslag-€75 leeft als hardcoded waarde in mig 179-183 RPCs; m²-prijs zit in `maatwerk_m2_prijzen` (per kwaliteit). Centralisatie kan in V2 als de set settings groter wordt; voor nu is het verspreid maar elke setting heeft een natuurlijke locatie.

- **Edge function `maatwerk-prijs-bereken`** — afgewezen als overengineering. Prijs-formule is pure TS, draait client-side in <1ms. Geen edge nodig. Vergelijk met `check-levertijd` waar simulation + capaciteit + spoed wel een server-roundtrip rechtvaardigt — maatwerk-prijs niet.

## Consequenties

- **Frontend-verhuizing** (geen schema-wijziging):
  - ~12 files verhuizen volgens tabel.
  - `op-maat.ts` (761 regels, 39 exports) splitst in 3 files (queries/runtime, lib/prijs, lib/oppervlak) + admin-hooks.
  - Order-form en order-line-editor importeren via `@/modules/maatwerk`.
  - Bestaande routes `/instellingen/vormen` en `/instellingen/afwerkingen` blijven werken; nieuwe routes onder `/instellingen/maatwerk/...` worden geïntroduceerd. Eén release dual; daarna alleen nieuwe paden (vermelden in changelog bij verwijdering).

- **Documenten**:
  - [`architectuur.md`](../architectuur.md) — Module-graf-paragraaf aanvullen met `modules/maatwerk/`. Sectie "Op Maat Module" hernoemen naar "Maatwerk-Module" en uitbreiden met seam-beschrijving.
  - [`data-woordenboek.md`](../data-woordenboek.md) — nieuwe sectie `## Maatwerk` met termen *Maatwerk-Module*, *Vorm-toeslag (€75)*, *m²-prijs*, *Standaard-maat (maatwerk)*. Bestaande termen *Maatwerk*, *Vorm*, *Bbox-oppervlak*, *Snij-marge*, *Productie_groep* worden cross-referenced of verhuisd.
  - [`changelog.md`](../changelog.md) — entry 2026-05-08 met de Module-introductie.

- **Tests**:
  - `lib/supabase/queries/__tests__/op-maat.test.ts` verhuist naar `modules/maatwerk/queries/__tests__/maatwerk-runtime.test.ts`. Tests blijven inhoudelijk gelijk — alleen import-pad wijzigt.
  - Geen nieuwe contract-test (snij-marge blijft cross-cut, geen TS↔SQL-spiegel die getest moet worden).

- **Lint/CI:** geen extra grep-regel zoals ADR-0006's "geen `UPDATE orders SET status` buiten Module". Maatwerk heeft geen veld zonder eigenaar — de hooks-import-discipline is voldoende. Wel: nieuwe ESLint-regel om imports van `@/lib/supabase/queries/op-maat` te verbieden zodra de file weg is, om regressie te voorkomen.

- **Open kandidaten op de backlog**:
  - Regel-row-splitsing (`<MaatwerkRegelRow>` + `<StandaardRegelRow>`) — V2-refactor van order-form-state-management.
  - Eigen tabel `maatwerk_instellingen` als de set settings voorbij 5 velden groeit (BTW per land, prijs-staffel, etc.).
  - Snij-marge-cross-cut formaliseren met TS↔SQL-contract-test (zelfde patroon als zending-bundel-sleutel uit mig 228).
  - Producten-Module en Klanten-Module — kandidaten #2 en #3 uit de architectuur-review (2026-05-08), apart traject. Maatwerk's seam-discipline is de blueprint.
