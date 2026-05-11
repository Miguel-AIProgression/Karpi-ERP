---
status: accepted
date: 2026-05-08
---

# Debiteur als deep Module — masterdata + adressen + klant-bound mappings; `<KlantBenaming/>` als slot-component voor cross-Module display

## Context

De Debiteur is hét centrale klant-concept in Karpi: alle FK-kolommen heten `debiteur_nr`, alle brondata + logo's verwijzen ernaar, vier andere Modules consumeren klant-velden (Facturatie ADR-0007, Vervoerder-keuze ADR-0008, EDI, Orders ADR-0001). Maar de Debiteur zelf heeft géén Module-eigenaar. Code leeft verspreid:

- [`pages/klanten/klant-detail.tsx`](../../frontend/src/pages/klanten/klant-detail.tsx) — 669 regels, 8 tabs (Info, Afleveradressen, Orders, Facturering, Klanteigen namen, Artikelnummers, Prijslijst, EDI)
- [`pages/klanten/klanten-overview.tsx`](../../frontend/src/pages/klanten/klanten-overview.tsx)
- [`components/klanten/`](../../frontend/src/components/klanten/) — `klant-card.tsx`, `klant-edit-dialog.tsx`, `klanteigen-namen-tab.tsx` (472 regels), `klant-artikelnummers-tab.tsx`, `klant-prijslijst-tab.tsx`, `klant-prijslijst-selector.tsx`, `klant-verteg-selector.tsx`, `klant-facturering-tab.tsx`
- [`lib/supabase/queries/klanten.ts`](../../frontend/src/lib/supabase/queries/klanten.ts) — 26 referenties naar `debiteuren`/`klanten`/`debiteur_nr`
- [`lib/supabase/queries/klanteigen-namen.ts`](../../frontend/src/lib/supabase/queries/klanteigen-namen.ts) — sinds 2026-05-08 single source of truth voor de resolver-aanroep (`fetchKlanteigenNaam` singular + `fetchKlanteigenNamenMap` batch); RPC `resolve_klanteigen_naam` is SQL-only
- [`hooks/use-klanten.ts`](../../frontend/src/hooks/use-klanten.ts) — bevat ook `useVertegenwoordigers` (post-ADR-0004 hoort dat bij Medewerkers) en `useKleurenVoorKwaliteit` (hoort bij Producten)

Deletion-test op `klant-detail.tsx`: complexiteit verspreidt zich over 9+ callers (3 callers van `klanten.ts`, 4 callers van `klanteigen-namen.ts`, plus prijslijst-detail-page die `useSetKlantPrijslijst` consumeert) — bewijs dat het concept werk doet, maar zonder cohesie. De interface is **shallow**: een mix van masterdata-CRUD, klant-bound catalogus-mappings, en cross-Module config-tabs (Facturatie/EDI) zonder dat de Debiteur-Module-grens er is.

ADR-0009 markeerde Klanten als kandidaat #3 voor deepening (Maatwerk = #1, Producten = #2). Met ADR-0009 in flight (stap 3/10) en ADR-0010 net aangenomen, is dit het natuurlijke vervolg in dezelfde discipline.

## Beslissing

Maak **`modules/debiteuren/`** als deep verticale Module. Vier ankers, vastgesteld in grilling-loop op 2026-05-08:

### Anker 1 — Naam: Debiteur (strikt DB-aligned)

Folder `modules/debiteuren/`, term **Debiteur-Module** in docs. Types `KlantRow`/`KlantDetail` worden hernoemd naar `DebiteurRow`/`DebiteurDetail`. Hooks `useKlant*` worden `useDebiteur*`. Page-bestandsnamen `klant-detail.tsx`/`klanten-overview.tsx` worden `debiteur-detail.tsx`/`debiteuren-overview.tsx`. **Routes blijven `/klanten/...`** en alle UI-tekst blijft "Klant" — dit is uitsluitend code- en docs-discipline. Reden: alle DB-FKs heten `debiteur_nr`, alle tabel-namen `debiteuren`, alle migraties refereren naar "debiteuren". Volgt ADR-0009-pattern (Maatwerk-Module, Anker 1) strict; voorkomt term-drift voor altijd. Vermijdt de "vier ladders voor één concept"-versplintering die ADR-0008 (vervoerder-keuze) net opruimde.

### Anker 2 — Scope: Medium (incl. klanteigen namen + klant-artikelnummers)

De Module bezit:

- **Masterdata** (Info-tab): naam, KVK, BTW-nummer, factuuradres, vertegenwoordiger-koppeling (FK), inkoopgroep-koppeling (FK), `deelleveringen_toegestaan`, `tier`, betaalconditie
- **Afleveradressen** (Afleveradressen-tab + CRUD): adres-CRUD met `adres_nr=0` als hoofdadres
- **Klanteigen namen** (admin-CRUD-tab): kwaliteit-niveau benaming (XOR debiteur/inkoopgroep, optioneel kleur-verfijning, 5-niveaus fallback)
- **Klant-artikelnummers** (admin-CRUD-tab): artikelnr-niveau identificatie voor pakbon/factuur
- **Page-shell** voor klant-overview + klant-detail

De Module bezit **niet**:

- **Orders-tab** — slot uit Orders-Module (ADR-0001, nog uit te voeren). **Tussentijds: directe import** uit [`lib/supabase/queries/orders.ts`](../../frontend/src/lib/supabase/queries/orders.ts) — gemarkeerd als technisch krediet in deze ADR.
- **Facturering-tab** — slot uit `modules/facturatie/` (ADR-0007). De Module zelf bezit het concept Factuur-instellingen (`btw_percentage`, `email_factuur`, `verzendkosten`, `verzend_drempel`, `gratis_verzending`); `<KlantFactureringTab/>` consumeert via barrel.
- **Prijslijst-tab** — geen Module-eigenaar. **Tussentijds: directe import** uit [`lib/supabase/queries/prijslijsten.ts`](../../frontend/src/lib/supabase/queries/prijslijsten.ts) en blijft fysiek in `components/klanten/`. Kandidaat voor toekomstige Prijslijst-Module-ADR.
- **EDI-tab** — slot uit `modules/edi/` (al bestaand). `<KlantEdiConfigTab/>` consumeert `useEdiHandelspartnerConfig` via de EDI-barrel.
- **Tier-berekening** — SQL-cron `herbereken_klant_tiers()` blijft cross-cut. Debiteur-Module exposeert `tier`-veld op `DebiteurRow`-type via barrel; berekening blijft in DB. Geen TS-laag nodig.
- **Adres-snapshot-helper** — `bouwAfleveradresSnapshot(klant, adresNr)` voor order-creatie blijft inline in order-form. Komt mee met Orders-Module-uitvoering (ADR-0001). Buiten scope.

### Anker 3 — Seam-stijl: Slot-component voor `<KlantBenaming/>` + hooks-import voor de rest

**Twee adapters dwingen het seam.** Klant-bound benaming-resolutie wordt door 4 frontend-callers (orders, facturatie, magazijn, debiteuren-zelf) én door 3 backend-callers ([`genereer_factuur_voor_bundel`](../../supabase/migrations/) mig 234, EDI-bericht-builders, pakbon-edge-functions) geconsumeerd. Backend kan geen React-component aanroepen → de **bron-van-waarheid moet SQL** zijn (`resolve_klanteigen_naam`, single source of truth sinds 2026-05-08). De keuze gaat alleen over de TS-adapter.

**Slot-component `<KlantBenaming/>`** voor display in andere Modules (zoals `<VervoerderTag/>` in [`docs/architectuur.md:33`](../architectuur.md#L33), slot-pattern paragraaf):

```tsx
// In modules/orders/.../regel-rij.tsx
<KlantBenaming
  debiteurNr={order.debiteur_nr}
  kwaliteit={regel.kwaliteit_code}
  kleur={regel.kleur_code}
  fallback={regel.omschrijving}
/>
```

Geen prop-drilling van resolver-shape, geen hook-imports in 3 niet-debiteur-Modules. Component self-fetcht via interne `useKlanteigenNaam`-hook, die `resolve_klanteigen_naam`-RPC aanroept. **Geen TS-spiegel van de 5-niveaus fallback-logica** — die leeft alleen in SQL. Dat voldoet aan de discipline uit het architectuur-rapport van 2026-05-08 (TS↔SQL: óf SQL-only óf contract-test) zonder een aparte ADR daarvoor.

**Hooks-import** voor de host-pagina (`debiteur-detail.tsx`) en voor admin-CRUD-mutations:

```ts
// In modules/debiteuren/pages/debiteur-detail.tsx
import {
  useDebiteurDetail,
  useAfleveradressen,
  useUpsertDebiteur,
  useUpsertAfleveradres,
  useUpsertKlanteigenNaam,
  useUpsertKlantArtikelnr,
} from '@/modules/debiteuren';
```

Conform ADR-0009-pattern (Maatwerk Anker 3): hooks-import voor intra-Module-velden, slot-pattern voor cross-Module-presentatie. Geen `<DebiteurEditor>`-slot — de detail-page is host en bezit alle masterdata-mutations zelf.

### Anker 4 — Slot-deps op niet-bestaande Modules: tussentijdse directe imports + technisch krediet

Twee slot-tabs zouden uit Modules komen die nog niet bestaan: Orders-Module (ADR-0001 niet uitgevoerd) en Prijslijst-Module (geen ADR). Wacht hier niet op — Debiteur-Module wordt nu gebouwd, beide tabs importeren tussentijds direct uit hun bestaande query-files. Sectie "Open kandidaten op de backlog" in deze ADR markeert wat verhuist zodra de bron-Module ontstaat.

Voordeel: Debiteur-deepening is niet ge-blokkeerd op ADR-0001-uitvoering (die een 20-cases regression-baseline vereist en grote blast-radius heeft). Risico: tussentijdse drift mogelijk maar gemarkeerd, en de slot-tab-componenten zijn klein genoeg dat verhuizing later mechanisch is.

### Module-Interface (publieke barrel)

`modules/debiteuren/index.ts` exporteert:

**Hooks (data-fetching, mutations):**
- `useDebiteur(debiteurNr)`, `useDebiteurenLijst({filters})`, `useDebiteurDetail(debiteurNr)` (incl. tier, prijslijst-info, verteg-info)
- `useAfleveradressen(debiteurNr)`
- `useKlanteigenNaam(debiteurNr | inkoopgroepCode, kwaliteit, kleur)` — interne hook van `<KlantBenaming/>`, ook beschikbaar voor advanced-callers
- `useKlanteigenNamenVoorKlant(debiteurNr)` — admin-tab data-bron
- `useKlantArtikelnummers(debiteurNr)`
- Mutations: `useUpsertDebiteur`, `useUpsertAfleveradres`, `useUpsertKlanteigenNaam`, `useDeleteKlanteigenNaam`, `useUpsertKlantArtikelnr`

**Components:**
- `<KlantBenaming/>` — slot-component voor cross-Module display (4-prop interface: `debiteurNr|inkoopgroepCode`, `kwaliteit`, `kleur`, `fallback`)
- `<KlanteigenNamenTab/>` — admin-UI in klant-detail-host (V2: ook in inkoopgroep-detail-host via `inkoopgroepCode`-prop)
- `<KlantArtikelnummersTab/>` — admin-UI
- `<DebiteurCard/>` — voor lijsten elders (bv. order-detail)
- `<DebiteurEditDialog/>` — gebruikt op overview-page

**Types:** `DebiteurRow`, `DebiteurDetail`, `Afleveradres`, `KlanteigenNaam`, `KlantArtikelnr`

**Pages (router-imports):** `DebiteurenOverview`, `DebiteurDetail`

Geen barrel-export van losse query-functies (`fetchDebiteur`, `fetchKlanteigenNamenMap`) — alleen hooks naar buiten, om te garanderen dat alle frontend-callers via React Query gaan en cache-invalidatie consistent is. Backend-callers gebruiken `resolve_klanteigen_naam`-RPC direct (geen barrel-coupling).

### Frontend-folder-structuur

```
frontend/src/modules/debiteuren/
├── index.ts                                   ← barrel
├── pages/
│   ├── debiteuren-overview.tsx                ← van pages/klanten/klanten-overview.tsx
│   └── debiteur-detail.tsx                    ← van pages/klanten/klant-detail.tsx (669 regels — host)
├── components/
│   ├── klant-benaming.tsx                     ← <KlantBenaming/> slot-component (NIEUW)
│   ├── debiteur-card.tsx                      ← van components/klanten/klant-card.tsx
│   ├── debiteur-edit-dialog.tsx               ← van klant-edit-dialog.tsx
│   ├── klanteigen-namen-tab.tsx               ← van components/klanten/ (472 regels)
│   ├── klant-artikelnummers-tab.tsx           ← van components/klanten/
│   ├── klant-verteg-selector.tsx              ← van components/klanten/ (consumeert useMedewerkers, niet useDebiteur)
│   └── afleveradressen-tab.tsx                ← uitgesplitst uit klant-detail.tsx
├── hooks/
│   ├── use-debiteuren.ts                      ← gerefactorde use-klanten.ts
│   ├── use-klanteigen-namen.ts                ← van hooks/use-klanteigen-namen.ts
│   └── use-klant-benaming.ts                  ← intern, drijft <KlantBenaming/>
└── queries/
    ├── debiteuren.ts                          ← van lib/supabase/queries/klanten.ts
    ├── klanteigen-namen.ts                    ← van lib/supabase/queries/klanteigen-namen.ts
    └── klant-artikelnummers.ts                ← van lib/supabase/queries/klanten.ts (uitgesplitst)
```

### Module-eigenaarschap (mentaal vs fysiek)

Volgt ADR-0001/0007/0009:

- **Frontend-eigendom (fysiek)**: alle bovengenoemde files in `modules/debiteuren/`.
- **Backend-eigendom (mentaal)**: tabellen `debiteuren`, `afleveradressen`, `klanteigen_namen`, `klant_artikelnummers`; SQL-RPC's `resolve_klanteigen_naam` (single source of truth voor benaming-resolutie), `herbereken_klant_tiers`, `volgend_nummer('KLA')` indien van toepassing. Migraties leven in `supabase/migrations/` zoals voorheen; geen verhuizing van SQL.
- **Cross-cut behoud**:
  - `resolve_klanteigen_naam`-RPC blijft SQL-only-bron-van-waarheid; backend-callers (factuur-RPC, EDI-builder, pakbon-edge) consumeren direct, geen Module-import.
  - Tier-berekening (cron) blijft cross-cut; UI-laag exposeert het resultaat-veld via `DebiteurRow`.
  - `vertegenwoordigers`-koppeling: hook hoort bij Medewerkers-Module (sinds ADR-0004 hernoemd). `useVertegenwoordigers` verhuist nu uit `use-klanten.ts` naar `use-medewerkers.ts`. `<KlantVertegSelector>` (de UI-selector) blijft binnen Debiteur-Module want het is "selector op debiteur-attribuut" — die consumeert `useMedewerkers({rol: 'vertegenwoordiger'})`.

### Migratiepad

Eén PR per stap (volgens ADR-0009-incrementeel-pattern, "stap N/M"-commits):

1. **Stap 1/8 — folder + lege barrel** (chore): `modules/debiteuren/index.ts` met re-exports vanuit huidige paden. Geen verhuizing nog.
2. **Stap 2/8 — `<KlantBenaming/>`-slot-component** (feat): nieuwe component op basis van bestaande `useKlanteigenNaam`-hook (resolver-aanroep al geconcentreerd in `klanteigen-namen.ts` per 2026-05-08-commit). Eerste interne caller: klant-detail-tab toont nu via deze component i.p.v. directe rendering.
3. **Stap 3/8 — verhuis queries + hooks** (refactor): `klanten.ts` → `modules/debiteuren/queries/debiteuren.ts`; `klanteigen-namen.ts` → `modules/debiteuren/queries/`; `klant-artikelnummers` uitgesplitst van `klanten.ts`. Bug-fixes meegenomen: `useVertegenwoordigers` naar `use-medewerkers.ts`, `useKleurenVoorKwaliteit` naar `use-producten.ts`.
4. **Stap 4/8 — verhuis pages + components + rename** (refactor): `pages/klanten/*` → `modules/debiteuren/pages/`, `components/klanten/*` → `modules/debiteuren/components/`. Alle `KlantRow` → `DebiteurRow`, `useKlant*` → `useDebiteur*`. Routes blijven `/klanten/...`.
5. **Stap 5/8 — `<KlantBenaming/>`-adoptie in andere Modules** (refactor): order-form-regel-rendering, factuur-PDF-builder (frontend), pakbon-display gebruiken voortaan de slot-component i.p.v. directe RPC-calls.
6. **Stap 6/8 — afleveradressen-tab uitsplitsen** (refactor): de 669-regel `klant-detail.tsx` host-page wordt kleiner door `<AfleveradressenTab>` als losse component.
7. **Stap 7/8 — verwijder oude paden** (chore): oude bestanden die alleen nog re-exporteerden geheel verwijderen; ESLint-regel om imports uit `@/lib/supabase/queries/klanten` te verbieden.
8. **Stap 8/8 — docs + changelog finalisatie** (docs).

Geen DB-migratie. Geen edge-function-wijziging. Geen contract-test-toevoeging — `resolve_klanteigen_naam` is al SQL-only zonder TS-spiegel.

## Overwogen alternatieven

- **Smal scope (alleen masterdata + adressen)** — afgewezen. Klanteigen namen en klant-artikelnummers hebben Debiteur als bron-van-waarheid; zonder hen mist de Module concept-eigenaarschap voor klant-bound catalogus-mappings. Vergelijk met ADR-0009 Maatwerk-medium-scope-keuze (incl. admin-CRUD).

- **Breed scope (incl. tier + adres-snapshot + verteg-selector als hook)** — afgewezen. Tier-berekening is een SQL-cron met breed bereik (klant-tabel-mutaties); centralisatie-poging zou een TS-laag toevoegen die geen werk doet. Adres-snapshot is order-creatie-territorium (ADR-0001 Orders-Module) en hoort daar te wonen. Verteg-selector consumeert Medewerkers-data, niet Debiteur-data.

- **Klanteigen-namen als eigen Module (`modules/klanteigen-namen/`)** — afgewezen. De resolver heeft één concept-eigenaar nodig (gebruiker-instructie 2026-05-08: "Er moet 1 plek zijn waar alle klant eigennamen staan, one source of truth"). Splitsing tussen Debiteur-Module (admin) en eigen Module (resolver) zou die "1 plek" verzwakken zonder duidelijke leverage. Ook de inkoopgroep-modus van de tabel breekt strict klant-eigendom niet — de admin-UI kan beide modi tonen vanuit één Module-host.

- **Resolver via hook-export i.p.v. slot-component** — afgewezen. Drie niet-debiteur-Modules (Orders, Facturatie, Magazijn) zouden een hook-import-pad naar Debiteur krijgen voor naam-display. Slot-pattern maakt de seam smaller (4-prop-component-interface i.p.v. hook + state + render-takken in elke caller) en past in bestaand patroon (`<VervoerderTag/>`).

- **Wacht op Orders-Module en Prijslijst-Module** — afgewezen. ADR-0001 vereist regression-baseline van 20 order-cases en heeft grote blast-radius; geen Prijslijst-ADR bestaat. Twee blokkades op een deepening die zelfstandig waarde levert is overdreven gating. Tussentijds-directe-imports met expliciete markering is conform pragma-ADR-0009-stijl.

- **Naam "Klanten-Module"** — afgewezen. Sluit aan bij bestaande folder/page-namen, maar drift met DB-FK-namen (`debiteur_nr`) en data-woordenboek-term ("Debiteur"). Module-naam moet anker zijn voor lange tijd; aansluiten bij DB-vocab voorkomt future "wat heet wat"-verwarring. ADR-0009 maakte dezelfde keuze voor Maatwerk (DB-aligned i.p.v. UI-toggle "Op Maat").

- **Hybride: folder Klanten + types Debiteur** — afgewezen. Drift wordt expliciet aan beide kanten van de seam, mengt twee werelden in één import-regel (`useDebiteur` + `<KlantCard>`). Strikt DB-aligned is duurzamer.

## Consequenties

- **Frontend-verhuizing** (geen schema-wijziging):
  - 8 page+component-files verhuizen naar `modules/debiteuren/`.
  - Types `KlantRow`/`KlantDetail` hernoemd naar `DebiteurRow`/`DebiteurDetail` — global rename via TypeScript-language-server.
  - Hooks `useKlant*` hernoemd naar `useDebiteur*` — global rename.
  - 3 callers van `klanten.ts` updaten naar `@/modules/debiteuren`-barrel.
  - 4 callers van `klanteigen-namen.ts` updaten — frontend-callers via `<KlantBenaming/>`, backend-callers ongewijzigd (RPC blijft).
  - Bug-fix: `useVertegenwoordigers` (uit `use-klanten.ts`) verhuist naar `use-medewerkers.ts`. `useKleurenVoorKwaliteit` (uit `use-klanten.ts`) verhuist naar `use-producten.ts` of `use-kwaliteiten.ts`.
  - Routes ongewijzigd (`/klanten/`, `/klanten/:id`).

- **Documenten**:
  - [`architectuur.md`](../architectuur.md) — Module-graf-paragraaf aanvullen met `modules/debiteuren/` als achtste domein-Module. Slot-pattern-paragraaf uitbreiden met `<KlantBenaming/>`-voorbeeld.
  - [`data-woordenboek.md`](../data-woordenboek.md) — nieuwe term "Debiteur-Module" in sectie "Klanten & Commercieel" (na bestaande term "Debiteur"). Crossref bij "klanteigen_namen", "klant_artikelnummers", "Tier".
  - [`changelog.md`](../changelog.md) — entry 2026-05-08 met Module-introductie en migratiepad-stap 1 (folder + lege barrel).

- **Tests**:
  - Bestaande tests voor klant-CRUD verhuizen naar `modules/debiteuren/queries/__tests__/`.
  - Nieuwe component-test voor `<KlantBenaming/>`: rendert fallback bij geen data, rendert benaming bij hit, rendert kleur-specifieke override bij twee rijen (klant+kleur > klant+NULL).
  - Geen contract-test (resolver is SQL-only zonder TS-spiegel).

- **Lint/CI**: ESLint-regel toevoegen om imports uit `@/lib/supabase/queries/klanten` en `@/hooks/use-klanten` te verbieden zodra de bestanden weg zijn (zelfde patroon als ADR-0009 voor `op-maat.ts`).

- **Open kandidaten op de backlog**:
  - **Orders-tab op debiteur-detail** verhuist naar `modules/orders/` zodra ADR-0001 uitgevoerd is. Tussentijds directe import uit `lib/supabase/queries/orders.ts`.
  - **Prijslijst-tab op debiteur-detail** verhuist naar een toekomstige Prijslijst-Module zodra die een ADR krijgt. Tussentijds directe import uit `lib/supabase/queries/prijslijsten.ts`.
  - **Adres-snapshot-helper** komt mee met Orders-Module-uitvoering (ADR-0001).
  - **Inkoopgroep-detail-page** krijgt later `<KlanteigenNamenTab inkoopgroepCode={...}/>` als slot — V2-uitbreiding van dezelfde component, geen ADR nodig.
  - **Producten-Module** als kandidaat #2 uit ADR-0009-backlog — eigen ADR. Maatwerk-Module + Debiteur-Module + Producten-Module trio sluit de drie grootste verspreide concepten af.
  - **Medewerkers-Module** als kleine kandidaat (post-ADR-0004 hernoemd, geen Module-folder). Lichtgewicht: alleen `lib/supabase/queries/medewerkers.ts` + `hooks/use-medewerkers.ts`. Kan zonder eigen ADR mee in een schoonmaak-PR samen met dit ADR-uitvoeringen.
