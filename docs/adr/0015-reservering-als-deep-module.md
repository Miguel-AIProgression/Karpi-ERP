---
status: accepted
date: 2026-05-13
---

# Reservering als deep Module — claim-eigendom losgekoppeld van Order-lifecycle en Levertijd

## Context

Het **Claim**-concept staat eerstegraads in [`data-woordenboek.md`](../data-woordenboek.md): elke rij in `order_reserveringen` koppelt een orderregel hard aan voorraad of een inkooporder-regel; statussen `actief → geleverd → released`; de tabel is sinds mig 144 bron-van-waarheid voor `producten.gereserveerd`. Daarmee voldoet Reservering aan alle eisen voor een diepe verticale Module — alleen heeft het er geen.

### Sprawl backend (mig 144-156, 218)

De allocator-logica leeft verspreid over twaalf migraties:

- mig 144 — tabel `order_reserveringen` + ENUM `claim_bron`
- mig 145 — `herallocateer_orderregel`, `herwaardeer_order_status`, `release_claims_voor_io_regel`, `io_regel_ruimte`, `voorraad_beschikbaar_voor_artikel`
- mig 146 — triggers `trg_orderregel_herallocateer`, `trg_order_status_herallocateer`, `trg_reservering_sync_producten`
- mig 147 — IO-status-release-trigger
- mig 148 — IO-ontvangst-consume binnen `boek_voorraad_ontvangst`
- mig 149 — `vrije_voorraad`-formule (omsluit Reservering's `gereserveerd`-cache)
- mig 150/156 — view `order_regel_levertijd`
- mig 153 — `sync_order_afleverdatum_met_claims` ingehaakt in `herwaardeer_order_status`
- mig 154 — `set_uitwisselbaar_claims`, herziene `herallocateer_orderregel` met fysiek_artikelnr + handmatige-claim-bescherming
- mig 155 — RLS
- mig 218 — `herwaardeer_order_status` delegeert status-writes aan Order-lifecycle's `herbereken_wacht_status`
- mig 236/239 — read-RPCs voor frontend (`claims_voor_product`, `handmatige_keuzes_voor_order`)

`herwaardeer_order_status` is sinds mig 218 een **drievoudige orchestratie**: loop alle regels → allocator-cyclus → roep `herbereken_wacht_status` (Order-lifecycle) → roep `sync_order_afleverdatum_met_claims` (Levertijd-domein, mig 153). Drie Modules poken vanuit één functie zonder eigenaar.

### Sprawl frontend

- [`lib/supabase/queries/reserveringen.ts`](../../frontend/src/lib/supabase/queries/reserveringen.ts) — 270 regels, vier fetch-functies + types
- [`hooks/use-reserveringen.ts`](../../frontend/src/hooks/use-reserveringen.ts) — 40 regels, vier `useQuery`-wrappers
- [`lib/utils/regel-dekking.ts`](../../frontend/src/lib/utils/regel-dekking.ts) — `berekenRegelDekking`, pure TS-spiegel van wat `herallocateer_orderregel` server-side doet
- [`components/orders/regel-claim-detail.tsx`](../../frontend/src/components/orders/regel-claim-detail.tsx) — toont claim-uitsplitsing per stuks-regel
- [`components/orders/substitution-picker.tsx`](../../frontend/src/components/orders/substitution-picker.tsx) — UI voor handmatige uitwisselbaar-keuze
- [`components/orders/uitwisselbaar-tekort-hint.tsx`](../../frontend/src/components/orders/uitwisselbaar-tekort-hint.tsx) — orchestreert de keuze via `set_uitwisselbaar_claims`
- [`components/orders/levertijd-badge.tsx`](../../frontend/src/components/orders/levertijd-badge.tsx) — leeft op `OrderRegelLevertijd`-shape

Importeert vanuit `components/orders/`, `hooks/`, `lib/utils/`, `lib/supabase/queries/` — vier folders voor één concept. RPC `set_uitwisselbaar_claims` wordt door [`order-mutations.ts:132`](../../frontend/src/lib/supabase/queries/order-mutations.ts#L132) aangeroepen vanuit de order-save-flow, dus de "Module" is óók verstrengeld met Order-Voorstel-territorium.

### Deletion test

Verwijder `herallocateer_orderregel` en de drie publieke RPCs: claim-volgorde-prio, IO-ruimte-checks, omsticker-routing en `gereserveerd`-cache-onderhoud verschijnen verspreid over order-create, order-update, IO-ontvangst, IO-annulering, set-uitwisselbaar-UI, status-recompute. Negen plus callsites, elk met eigen mini-allocator. De Module **verdient** depth.

## Beslissing

Vier samenhangende ingrepen.

### Ingreep 1 — Maak `modules/reserveringen/` als deep verticale Module (medium scope)

Folder `modules/reserveringen/`, term **Reservering-Module**, naam DB-aligned (tabel `order_reserveringen`). Glossary-term **Claim** blijft voor de rij-instantie.

**Scope (volgt Snijplanning-precedent ADR-0013):** logica-laag verhuist; claim-related runtime-components verhuizen mee omdat ze nergens anders thuishoren (ze leven op `OrderClaim`/`OrderRegelLevertijd`-shapes die deze Module exporteert).

De Module bezit:
- **Queries** voor `order_regel_levertijd`-view, `order_reserveringen` selects, `handmatige_keuzes_voor_order`, `claims_voor_product`
- **Mutations** via RPC-wrappers voor `herallocateer_orderregel`, `herwaardeer_claims_voor_order` (nieuw, zie Ingreep 2), `set_uitwisselbaar_claims`, `release_claims_voor_io_regel`
- **Lib-helpers** voor dekking-preview (TS-spiegel, zie Ingreep 4) en contract-fixtures
- **Components** `RegelClaimDetail`, `SubstitutionPicker`, `UitwisselbaarTekortHint`, `LevertijdBadge`
- **Cache.ts** met `invalidateNaReserveringsmutatie(qc)`

De Module bezit **niet**:
- **Order-form-host** — blijft in `components/orders/` (komt mee met toekomstige Order-Voorstel-Module, kandidaat #2 uit architectuur-skill-rapportage)
- **`vrije_voorraad`-formule** — blijft op `producten`-view (consumeert `gereserveerd`-cache als input)
- **`orderregel_pickbaarheid`-view** (mig 170) — eigendom Magazijn (consumeert claim-state)
- **`orders.status`-writes** — Order-lifecycle (ADR-0006); Reservering vraagt alleen om recompute
- **`orders.afleverdatum`-sync** — tijdelijk geparkeerd binnen Reservering (zie Ingreep 2), verhuist later naar Levertijd-Module (open backlog)

### Ingreep 2 — Splits `herwaardeer_order_status` in drie expliciete aanroepen

`herwaardeer_order_status` is een god-orchestratie geworden. Vervang door drie aparte functies, elk in z'n eigen Module:

```sql
-- Reservering-Module bezit:
herwaardeer_claims_voor_order(p_order_id BIGINT) RETURNS VOID
  -- Loop alle orderregels van de order, roep herallocateer_orderregel per stuk.
  -- Schrijft GEEN orders.status en GEEN orders.afleverdatum.

-- Order-lifecycle bezit (al bestaand sinds mig 218):
herbereken_wacht_status(p_order_id BIGINT) RETURNS VOID

-- Tijdelijk binnen Reservering, later naar Levertijd-Module:
sync_order_afleverdatum_met_claims(p_order_id BIGINT) RETURNS VOID
  -- Markeer met TODO-comment "ownership verhuist naar Levertijd-Module".
```

Callers (drie call-sites vandaag: trigger `trg_orderregel_herallocateer`, manual order-edit, IO-ontvangst) krijgen drie expliciete regels:

```sql
PERFORM herwaardeer_claims_voor_order(p_order_id);
PERFORM herbereken_wacht_status(p_order_id);
PERFORM sync_order_afleverdatum_met_claims(p_order_id);
```

Het oude `herwaardeer_order_status` blijft als **thin wrapper** met deprecation-comment voor back-compat tijdens migratie; verwijder in een volgende migratie nadat alle callers omgezet zijn.

### Ingreep 3 — Trigger op `order_events` i.p.v. `orders.status`

Vervang `trg_order_status_herallocateer` (op `orders` UPDATE WHERE status changed) door een listener op `order_events` INSERT met `WHEN (NEW.event_type IN ('geannuleerd', 'pickronde_voltooid'))`. Past bij ADR-0006-event-pattern (Facturatie luistert óók op `order_events`).

> **Review-correctie (mig 256, 2026-05-13):** initieel luisterde mig 255 alleen op `'geannuleerd'`. Daardoor bleven claims `status='actief'` na verzending, waardoor `voorraad_beschikbaar_voor_artikel` (mig 154) Verzonden-claims ten onrechte meetelde. Mig 256 breidt de trigger uit naar `'pickronde_voltooid'` met eenmalige back-fill voor reeds-Verzonden orders. De oude mig 146-trigger reageerde óók op Verzonden-transities — die dekking is hiermee hersteld.

Effect: geen directe trigger meer op `orders.status` buiten Order-lifecycle's eigen `_apply_transitie`. Lint-script `scripts/lint-no-direct-orders-status-update.sh` blijft groen; symmetrie met Facturatie-Module.

`trg_orderregel_herallocateer` (op order_regels CRUD) en `trg_reservering_sync_producten` (op order_reserveringen CRUD) blijven tabel-triggers — die zitten binnen Reservering's eigen state.

### Ingreep 4 — `simuleer_dekking` RPC + contract-test

Voeg pure read-only RPC toe:

```sql
simuleer_dekking(p_artikelnr TEXT, p_te_leveren INT, p_uitwisselbaar_keuzes JSONB)
  RETURNS TABLE (direct INT, uitwisselbaar INT, io_tekort INT)
```

Geen `INSERT`/`UPDATE`; alleen `SELECT` op voorraad + open IO-ruimte. Twee adapters:
- **TS-spiegel** `berekenRegelDekking` blijft in `modules/reserveringen/lib/dekking-preview.ts` voor laggy-free UI in line-editor.
- **SQL-RPC** als bron-van-waarheid; Vitest met 20 fixtures (eigen voorraad / handmatig uitwisselbaar / IO-mix / nul-voorraad / overflow) controleert byte-voor-byte gelijkheid.

Maakt het seam *twee-adapter, contract-tested* in plaats van de huidige *één-adapter-met-stille-spiegel*.

### Ingreep 5 — Lint-script en cache-seam

- `scripts/lint-no-direct-order-reserveringen-write.sh` — scant `supabase/migrations/` en `supabase/functions/` op `INSERT INTO order_reserveringen`, `UPDATE order_reserveringen`, `DELETE FROM order_reserveringen` buiten een whitelist (mig 144-156, 218, nieuwe split-mig, backfill mig 151).
- `modules/reserveringen/cache.ts` exporteert `invalidateNaReserveringsmutatie(qc)` die de relevante query-keys raakt:

```ts
export function invalidateNaReserveringsmutatie(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['order-levertijd'] })
  qc.invalidateQueries({ queryKey: ['order-claims'] })
  qc.invalidateQueries({ queryKey: ['order-regel-claims'] })
  qc.invalidateQueries({ queryKey: ['io-regel-claims'] })
  qc.invalidateQueries({ queryKey: ['handmatige-keuzes'] })
  qc.invalidateQueries({ queryKey: ['producten'] }) // wegens gereserveerd-cache
}
```

Cross-Module producers (order-form save-flow, IO-ontvangst-page, IO-annulering, Order-lifecycle's annulerings-RPC-aanroep) importeren via `import { invalidateNaReserveringsmutatie } from '@/modules/reserveringen'` en chainen na succesvolle mutatie.

## Module-Interface (publieke barrel)

`modules/reserveringen/index.ts` exporteert:

**Hooks (queries):** `useLevertijdVoorOrder`, `useClaimsVoorOrder`, `useClaimsVoorOrderRegel`, `useClaimsVoorIORegel`, `useHandmatigeKeuzesVoorOrder`, `useClaimsVoorProduct`.

**Hooks (mutations):** `useSetUitwisselbaarClaims`, `useHerwaardeerClaimsVoorOrder` (advanced caller-export, voor edge cases buiten triggers).

**Cache:** `invalidateNaReserveringsmutatie(qc)` — voor cross-Module-producers.

**Components:** `RegelClaimDetail`, `SubstitutionPicker`, `UitwisselbaarTekortHint`, `LevertijdBadge`.

**Lib (pure):** `berekenRegelDekking` (TS-spiegel), `regelDekkingFixtures` (gedeelde fixtures TS↔SQL).

**Types:** `OrderRegelLevertijd`, `OrderClaim`, `IORegelClaim`, `ClaimBron`, `ClaimStatus`, `LevertijdStatus`, `LeverModus`, `HandmatigeKeuzePerRegel`, `RegelDekking`.

Geen barrel-export van losse query-functies (`fetchClaimsVoorOrder`, etc.) — alleen hooks naar buiten, conform Snijplanning-precedent.

## Frontend-folder-structuur

```
frontend/src/modules/reserveringen/
├── index.ts                              ← barrel
├── cache.ts                              ← invalidateNaReserveringsmutatie (NIEUW)
├── hooks/
│   └── use-reserveringen.ts              ← van hooks/use-reserveringen.ts
├── queries/
│   └── reserveringen.ts                  ← van lib/supabase/queries/reserveringen.ts
├── lib/
│   ├── dekking-preview.ts                ← van lib/utils/regel-dekking.ts (berekenRegelDekking)
│   └── __tests__/
│       └── dekking-contract.test.ts      ← NIEUW (TS ↔ SQL fixtures via simuleer_dekking)
└── components/
    ├── regel-claim-detail.tsx            ← van components/orders/regel-claim-detail.tsx
    ├── substitution-picker.tsx           ← van components/orders/substitution-picker.tsx
    ├── uitwisselbaar-tekort-hint.tsx     ← van components/orders/uitwisselbaar-tekort-hint.tsx
    └── levertijd-badge.tsx               ← van components/orders/levertijd-badge.tsx
```

## Migratiepad

Conform feedback-memory "Na ADR direct stap 1/N committen; niet stapelen zonder code-werk": **ADR + alle stappen in één PR/commit**, niet eerst ADR los committen.

1. **Stap 1 — Module-skelet (FE):** folder + lege barrel + `cache.ts` met `invalidateNaReserveringsmutatie`.
2. **Stap 2 — Queries verhuizen (FE):** `reserveringen.ts` naar `modules/reserveringen/queries/`. Re-export uit oude pad als deprecation-shim tot stap 7.
3. **Stap 3 — Hook verhuizen (FE):** `use-reserveringen.ts` naar `modules/reserveringen/hooks/`. Voeg cross-Module cache-invalidation toe in `useSetUitwisselbaarClaims` (Reservering's eigen helper + `invalidateNaOrdersMutatie` als die later bestaat).
4. **Stap 4 — TS-spiegel + contract-test-skelet (FE):** `regel-dekking.ts` naar `modules/reserveringen/lib/dekking-preview.ts`. Fixture-bestand. Vitest-test-skelet (rode test; groen na stap 6 met `simuleer_dekking`).
5. **Stap 5 — Components verhuizen (FE):** vier components van `components/orders/` naar `modules/reserveringen/components/`. Update ~10 import-paden in order-form, line-editor, order-regels-table, order-edit.
6. **Stap 6 — Split-migratie (BE, mig 254):**
   - `herwaardeer_claims_voor_order(p_order_id)` toegevoegd (Reservering)
   - `sync_order_afleverdatum_met_claims` blijft (Reservering, TODO-comment voor Levertijd)
   - `herwaardeer_order_status` herdefinieerd als thin wrapper met `DEPRECATED`-comment
   - `simuleer_dekking(...)` toegevoegd (read-only)
   - Trigger-callsite refactor: drie expliciete `PERFORM` i.p.v. één
7. **Stap 7 — Event-trigger-migratie (BE, mig 255):** vervang `trg_order_status_herallocateer` door `trg_order_events_reservering_release` op `order_events` INSERT.
8. **Stap 8 — Lint-script (repo):** `scripts/lint-no-direct-order-reserveringen-write.sh` + pre-commit-hook of CI-stap.
9. **Stap 9 — ESLint regressie-regel (FE):** `no-restricted-imports` voor oude paden (`@/lib/supabase/queries/reserveringen`, `@/lib/utils/regel-dekking`, `@/hooks/use-reserveringen`) met ADR-0015-verwijzing.
10. **Stap 10 — Oude bestanden verwijderen (FE):** 7 oude bestanden weg na verificatie dat geen imports meer leven.
11. **Stap 11 — Docs:** `architectuur.md` (Module-graf-paragraaf — elfde Module + `herwaardeer_order_status`-split-notitie), `data-woordenboek.md` (Reservering-Module-term toevoegen), `changelog.md`.

## Overwogen alternatieven

- **`modules/claims/`** — afgewezen. Tabel heet `order_reserveringen`, glossary-term **Claim** is rij-niveau, **Reservering** is concept-niveau. Module-naam aligneert op het concept conform Debiteur/Facturatie/Maatwerk-precedent.

- **`modules/allocator/`** — afgewezen. Verbergt dat de Module óók handmatige uitwisselbaar-keuze, IO-receipt-consume en cache-onderhoud bezit. "Allocator" is implementatie, niet concept.

- **Reservering + Levertijd in één pass** — uitgesteld. `sync_order_afleverdatum_met_claims` zit logisch in Levertijd-domein (kandidaat #3 uit architectuur-skill-rapportage), maar verhuizen vereist óók de FE-spiegels (`bereken-agenda.ts`, `afleverdatum.ts`, `verzendweek.ts`) en `check-levertijd`-edge function te raken. Bundelen verdubbelt blast-radius. Tijdelijk parkeren binnen Reservering met TODO-comment volstaat.

- **Kill TS-spiegel `berekenRegelDekking`, alleen RPC-roundtrip** — afgewezen. Order-form en line-editor reken de dekking opnieuw bij elke aantal-keystroke; debounce + roundtrip zou ~50–200ms UI-vertraging toevoegen voor wat een 8-regel-pure-functie is. Contract-test (50 regels Vitest) houdt drift weg zonder die kosten.

- **Event-bus voor allocator-trigger** — afgewezen. `trg_orderregel_herallocateer` op `order_regels` CRUD is een directe tabel-trigger waar de transactionele garantie bij hoort. Een event-listener zou eventual consistency introduceren waar atomicity de invariant is (`producten.gereserveerd` mag nooit divergeren van actieve claims).

- **`order_regel_levertijd` verhuizen naar Levertijd-Module** — afgewezen. De view leest puur op claim-state (`order_reserveringen` join `inkooporder_regels`); zonder Reservering bestaat hij niet. Levertijd-Module wordt later **consumer** van deze view, niet eigenaar.

- **Volledig scope (incl. `boek_voorraad_ontvangst`-splitsing)** — uitgesteld. `boek_voorraad_ontvangst` mengt rol-creatie (Voorraad-domein) + IO-claim-consume (Reservering-domein). Extract `boek_io_ontvangst_claims` als publieke RPC en laat `boek_voorraad_ontvangst` 'm aanroepen. Klein werk, kan in stap 6 mee; ben ik flexibel op, neig naar wél meenemen omdat het anders losse claim-writes vanuit `boek_voorraad_ontvangst` overlaat die de lint zou flaggen.

## Open kandidaten op de backlog

- **Levertijd-Module** — kandidaat #3 uit architectuur-skill-rapportage. Verhuist `sync_order_afleverdatum_met_claims` (mig 153) + de `check-levertijd`-edge function + `bereken-agenda.ts`/`afleverdatum.ts`/`verzendweek.ts` naar één Module met als seam de RPC `bereken_levertijd(order_id | regel_inputs[], lever_type, lever_modus)`. Eigen vervolg-ADR.

- **`boek_voorraad_ontvangst`-splitsing** — extract `boek_io_ontvangst_claims` als publieke Reservering-RPC, laat Voorraad-RPC 'm aanroepen. Mogelijk meegenomen in stap 6 van dit ADR; anders losse vervolg-stap.

- **Order-Voorstel-Module** — kandidaat #2 uit architectuur-skill-rapportage. Eenmaal die bestaat, consumeren Order-Voorstel én Reservering elkaar via barrels (Order-Voorstel roept `useSetUitwisselbaarClaims` aan vanuit save-flow; Reservering's componenten consumeren `OrderRegelFormData`-shape uit Order-Voorstel). Maakt het Reservering-cache-seam ook concreet (`invalidateNaOrdersMutatie` van Order-Voorstel chainen).
