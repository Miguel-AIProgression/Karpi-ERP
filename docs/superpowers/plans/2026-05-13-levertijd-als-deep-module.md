# Plan — Levertijd als deep Module

**ADR:** [ADR-0020](../../adr/0020-levertijd-als-deep-module.md)
**Datum:** 2026-05-13
**Status:** stap 1 in dezelfde commit als ADR; vervolgstappen open

## Doel

Levertijd-Module realiseren conform ADR-0020: capaciteit-seam owner met smal SQL-interface, order-niveau status-label + bevroren snapshot, continue fit-check in order-form, en operator-flow voor "snelste haalbare overnemen". Klant-communicatie-doel: voorkant van order-intake kan tegen actuele snij-planning aangeven of de standaard-levertijd haalbaar is, of er een snellere optie bestaat, en het label reist door het proces zichtbaar mee.

## Stappenplan

### Stap 1 — Mig 276: schema + status-trigger + snapshot-backfill (deze commit)

**Wat:**
- Twee nieuwe kolommen op `orders`:
  - `levertijd_status TEXT` met CHECK-constraint (`standaard | eerder_dan_standaard | later_dan_standaard | NULL`)
  - `standaard_afleverdatum_berekend DATE` (bevroren snapshot, immutable na commit)
- `trg_levertijd_status_recalc()` trigger-functie + `BEFORE INSERT OR UPDATE OF afleverdatum, standaard_afleverdatum_berekend` trigger op `orders`. Deriveert `levertijd_status` automatisch uit afleverdatum-vs-snapshot.
- Backfill: bestaande orders met `afleverdatum IS NOT NULL` krijgen `standaard_afleverdatum_berekend = afleverdatum`. Trigger zet automatisch `levertijd_status = 'standaard'`. Geen retro-effecten op historische orders.
- ASSERT-blok: trigger bestaat, backfill volledig.

**Acceptatie:**
- Mig 276 toegepast zonder errors.
- Bestaande orders met afleverdatum hebben `levertijd_status = 'standaard'` en snapshot = afleverdatum.
- Nieuwe order zonder snapshot heeft `levertijd_status = NULL`.
- Wijziging van `afleverdatum` op een order met snapshot triggert herrekening van label.

### Stap 2 — RPC-skeleton: `levertijd_fit_check` + `levertijd_snelste_haalbaar`

**Wat:**
- Migratie 276: signatures + initiële body.
  - Voor **voorraad-regels**: delegate naar Reservering's `order_regel_levertijd`-view.
  - Voor **maatwerk-regels**: tijdelijke "always-haalbaar" stub die TRUE retourneert + `eerstvolgend_haalbaar = gewenste_week`. Echte capaciteit-match komt in stap 7.
- Beide RPC's accepteren array `p_regel_ids BIGINT[]` voor batch-aanroep.
- `levertijd_snelste_haalbaar` retourneert voor voorraad-regels: 1-2 werkdagen vooruit (pick + verzend) als op voorraad; eerstvolgende IO-week als wacht op IO; uitwisselbaar-pad als beschikbaar (lees Reservering's `dekking_preview_voor_regel`-RPC).

**Acceptatie:**
- `SELECT * FROM levertijd_fit_check(ARRAY[id1, id2], '2026-W25')` werkt op voorraad-regels en maatwerk-regels.
- Voor maatwerk: stub-result `haalbaar=true` met TODO-marker in code.
- Voor voorraad: result-shape klopt met view-data.

### Stap 3 — Frontend Module-skelet

**Wat:**
- Folder `frontend/src/modules/levertijd/`:
  - `index.ts` (barrel — leeg in deze stap)
  - `cache.ts` — `invalidateNaLevertijdMutatie(qc)`
  - `types.ts` — `LevertijdStatus`, `FitCheckResultaat`, `SnelsteHaalbaarResultaat`
- Geen hooks/components yet.

**Acceptatie:**
- `import { invalidateNaLevertijdMutatie } from '@/modules/levertijd'` compileert.
- Types-exports beschikbaar.

### Stap 4 — Hook-migratie: `useFitCheck` + `useSnelsteHaalbaar` + `useLevertijdStatus` + `useNeemSnelsteOver`

**Wat:**
- `hooks/use-fit-check.ts` — `useQuery` met debounce (300ms), key `['levertijd', 'fit-check', regelIds, gewensteWeek]`.
- `hooks/use-snelste-haalbaar.ts` — `useQuery` met `enabled: false`, manueel triggerbaar via `refetch()`.
- `hooks/use-levertijd-status.ts` — `useQuery` op `orders.levertijd_status` voor badge-rendering.
- `hooks/use-neem-snelste-over.ts` — `useMutation` die `orders.afleverdatum` aanpast (Module schrijft via bestaande `updateOrder`-mutation; trigger zet `levertijd_status`).
- Bestaande `frontend/src/hooks/use-levertijd-check.ts` wordt re-export shim die `useFitCheck` doorgeeft (één release back-compat), markeer DEPRECATED.

**Acceptatie:**
- Bestaande callers van `useLevertijdCheck` blijven werken.
- Debounce verifieerbaar: rapid typing genereert geen N RPC-calls.

### Stap 5 — `<LevertijdStatusBadge>` slot + integratie

**Wat:**
- `components/levertijd-status-badge.tsx` — kleurcoded chip per enum-waarde:
  - `standaard` → geen badge (default = "niets bijzonders")
  - `eerder_dan_standaard` → oranje "Eerder"
  - `later_dan_standaard` → rood "Later"
- Tooltip toont: "Klant-standaard: wk N — actuele belofte: wk M" + reden bij `later`.
- Integratie in [`pages/orders/orders-overview.tsx`](../../frontend/src/pages/orders/orders-overview.tsx): chip naast ordernummer-kolom, na bestaande `ZEND-`-badge.
- Integratie in [`pages/orders/order-detail.tsx`](../../frontend/src/pages/orders/order-detail.tsx): chip in header naast status-badge (`Nieuw`/`Wacht op voorraad`/etc.).

**Acceptatie:**
- Order met afwijkende afleverdatum toont badge in lijst én detail.
- Tooltip-tekst klopt met snapshot vs actueel.

### Stap 6 — Order-form integratie: live fit-check + snelste-overneem-knop

**Wat:**
- `components/levertijd-fit-indicator.tsx` — inline indicator per regel in [`order-form.tsx`](../../frontend/src/components/orders/order-form.tsx):
  - Groen vinkje als haalbaar
  - Oranje waarschuwing als niet haalbaar, met `eerstvolgend_haalbaar`-week
- `components/snelste-haalbaar-knop.tsx` — knop "Klant heeft haast — toon snelste haalbare". Klik = aanroep `useSnelsteHaalbaar.refetch()`; resultaat toont in popover met "Overnemen"-actie.
- Overneem-flow: `useNeemSnelsteOver`-mutation past `orders.afleverdatum` aan; trigger updatet `levertijd_status` naar `eerder_dan_standaard`.
- Bij commit van een nieuwe order: order-form roept eerst `levertijd_fit_check` aan met finale waarden voordat `createOrder` triggert. Bij niet-haalbaar: read-only waarschuwing (uit grilling: 1a), commit gaat door als operator akkoord is.
- Snapshot wordt geschreven in `createOrder`/`updateOrderWithLines` — `standaard_afleverdatum_berekend` = `bepaalOrderAfleverdatum`-resultaat. Eenmalig bij eerste commit, daarna immutable.

**Acceptatie:**
- Order-form toont live fit-status per regel.
- Snelste-haalbaar-knop werkt, popover toont alternatief, overnemen werkt.
- Snapshot wordt eenmalig gezet bij commit; volgende save raakt 'm niet aan.

### Stap 7 — Maatwerk capaciteit-match in SQL

**Wat:**
- Migratie 277: vervang stub-body van `levertijd_fit_check` en `levertijd_snelste_haalbaar` voor maatwerk-regels met PL/pgSQL-implementatie die de huidige Deno-logica spiegelt:
  - Lees open snijplannen per `productie_groep` per week
  - Lees `productie_planning`-config (capaciteit_per_week, wisseltijd_minuten, logistieke_buffer_dagen)
  - Match gewenste week tegen bezetting + buffer
  - Voor `snelste_haalbaar`: zoek eerste week met capaciteit-ruimte
- Edge-function `check-levertijd` wordt thin wrapper rond `levertijd_fit_check` (back-compat voor `berekenMaatwerkAfleverdatumViaSeam`-callers).
- ASSERT-blok: contract-test fixtures verifiëren dat SQL- en Deno-versie dezelfde antwoorden geven voor 5 representatieve scenarios.

**Acceptatie:**
- `levertijd_fit_check` op maatwerk-regel geeft realistisch antwoord (niet meer altijd `true`).
- `check-levertijd`-edge response onveranderd voor bestaande callers.
- Contract-test groen.

### Stap 8 — Werkagenda-spiegel cleanup

**Wat:**
- Werkdag-helpers naar SQL: `werkdag_min_n(p_datum, p_n)`, `werkagenda_kalender(p_van, p_tot)`, `werkdag_plus_n(...)`.
- `_shared/werkagenda.ts` (Deno-edge) wordt thin RPC-wrapper.
- `bereken-agenda.ts` (frontend TS) behoudt synchrone helpers voor UI-pad (Magazijn's `bucketVoor` doet honderden bucket-toetsen per render — DB-call zou onacceptabel zijn). Markeren met header-comment: "Synchronous-only mirror — SQL ground-truth in werkdag_min_n. Wijzigingen ook daar."
- Lint-script `scripts/lint-werkagenda-sync.sh` (optional, low-prio): vergelijkt TS-mirror tegen SQL-resultaat op een fixed set fixtures.

**Acceptatie:**
- Werkagenda-rekenkunde produceert identieke output uit SQL en TS-mirror voor 100 sample-dates.
- Geen functionele regressie in `bucketVoor`-tests.

### Stap 9 — Lint + ESLint

**Wat:**
- `scripts/lint-no-direct-levertijd-write.sh`: scant `supabase/migrations/` + `supabase/functions/` op directe writes naar `orders.levertijd_status` of `orders.standaard_afleverdatum_berekend` buiten een whitelist (mig 276 + Module-RPC's).
- ESLint `no-restricted-imports` regel voor `@/hooks/use-levertijd-check` (gemarkeerd DEPRECATED in stap 4) → wijst naar `@/modules/levertijd`.

**Acceptatie:**
- Lint-script returnt 0 violations op huidige codebase.
- ESLint geeft warning bij oude import-pad.

### Stap 10 — Docs

**Wat:**
- `architectuur.md`: Module-graf-paragraaf bijwerken (Levertijd als dertiende Module). Diagram-update.
- `changelog.md`: per stap een entry, of één samenvattende entry na stap 9.
- `data-woordenboek.md`: al gedaan in deze commit. Eventueel verfijnen na implementatie-leerwerk.

**Acceptatie:**
- Module-graf-paragraaf vermeldt 13 Modules + verwijst naar ADR-0020.
- Changelog complete.

## Belangrijke randvoorwaarden

- **Stap 1 ↔ ADR in dezelfde commit** (feedback-memory adr-implementatie-pairing). Vervolgstappen losse commits.
- **Geen schrijven aan `orders.afleverdatum` vanuit Levertijd-Module** — blijft Order-Module (commit-pad) en Reservering-Module (mig 153/254 sync). Module schrijft alleen `levertijd_status` en `standaard_afleverdatum_berekend`.
- **Reservering-Module's `order_regel_levertijd`-view blijft Reservering-eigendom.** Levertijd consumeert, schrijft niet.
- **Werkagenda-TS-spiegel in `bereken-agenda.ts` blijft bestaan voor UI-pad** (synchrone callers). Niet schrappen.
- **Confectie-capaciteit-check V2** — interface laat ruimte voor uitbreiding zonder breaking change. Niet hijacking deze stappen.
- **EDI/factuur/pakbon-consumers van label V2** — V1 is alleen interne UI (order-list + order-detail header).

## Risico's & mitigaties

- **Snapshot-backfill creëert "stille" status quo**: alle bestaande orders krijgen `levertijd_status = 'standaard'` ongeacht echte planning-werkelijkheid. Mitigatie: dat is bewust — historie is bevroren, labels zijn alleen forward-looking.
- **Trigger-overhead op orders-tabel**: BEFORE-trigger op `afleverdatum`-update is goedkoop (één DATE-vergelijking), geen secundaire UPDATE. Risico verwaarloosbaar.
- **Continue debounced RPC-aanroep tijdens order-form-edit**: kan edge-budget aanspreken. Mitigatie: debounce 300ms + React Query-cache (staleTime 30s) + alleen vuren bij regel-mutatie, niet bij ieder render-pass.
- **Race-conditie bij gelijktijdige spoed-aanvragen**: ADR aanvaardt optimistische resolutie (laatste wint, andere krijgt nieuwe fit-check bij commit). Geen capaciteit-slot-reservering in V1.
- **Maatwerk-fit-check is stub in stap 2-6**: pas in stap 7 echt realistisch. Tussenliggend kan een nieuwe order claim "haalbaar" terwijl planning vol is. Mitigatie: stap 7 binnen 1-2 weken na stap 6.

## Volgorde-flexibiliteit

Stappen 2-6 hangen niet strikt aan elkaar — Module-skelet (3) en hooks (4) kunnen parallel met RPC-skeleton (2). Stap 5 (badge) kan los voor stap 6 (order-form) lopen. Stap 7 (maatwerk SQL) kan vóór stap 8 (werkagenda) of erna. Stap 9-10 sluiten af.

Stap 1 staat fundamenteel los — schema + trigger zijn pre-condition voor al het andere en gaan dus eerst in.
