# Pick-ship splitst naar magazijn-Module + logistiek-uitbreiding

**Datum:** 2026-05-05
**Beslissing:** [ADR-0002](../../adr/0002-pick-ship-splitst-naar-magazijn-en-logistiek.md)
**Status:** Plan vastgesteld na grilling via `/improve-codebase-architecture`. Klaar voor `/to-issues`.

## Doel

De huidige `pick-ship`-folder bevat drie verschillende concerns: pickbaarheid (magazijn-werk), vervoerder-selectie (logistiek-werk dat toevallig op de pick-card werd getoond) en zending-creatie (logistiek-mutatie). De flat-namespace-structuur (`lib/supabase/queries/`, `hooks/`, `components/`) maakt callers afhankelijk van drie importpaden voor één concept.

Gewenste uitkomst:
- `modules/magazijn/` is de derde deep verticale Module na `modules/orders/` en `modules/planning/`. Smal publiek oppervlak (alleen pages, hooks, types) via barrel-export.
- Vervoerder-selectie en `<VerzendsetButton>` leven in `modules/logistiek/`. `OrderPickCard` consumeert `<VervoerderTag>` als slot — geen data-coupling.
- Pickbaarheid-fallback (DB-view ontbreekt) is volledig achter de Module-interface verborgen. Caller ziet één retour-type.
- Latente atomiciteitsbug in locatie-update (twee opeenvolgende RPC's) opgelost via één DB-RPC.

## Vastgestelde keuzes

### Module-naam en scope

- Concept: **Magazijn** (toegevoegd aan `data-woordenboek.md`, sectie "Magazijn & Pick-flow"). _Niet_ "pick-ship" — dat was de oude folder-naam, geen domein-entiteit.
- `modules/magazijn/` bezit: pickbaarheid, pick-buckets, locatie-mutaties op rollen + snijplannen, magazijn-locaties-tabel, pick-overview-pagina, `OrderPickCard`.
- `modules/logistiek/` (uitbreiding) krijgt: `<VerzendsetButton>` + actieve-vervoerder-fetch.

### Publieke interface — smal

`modules/magazijn/index.ts` exporteert alleen:
- **Pages:** `MagazijnOverviewPage` (route `/pick-ship`, URL blijft).
- **Hooks:** `usePickShipOrders`, `usePickShipStats`, `useUpdateMaatwerkLocatie`, `useUpdateRolLocatie`, `useMagazijnLocaties`.
- **Types:** `PickShipOrder`, `PickShipRegel`, `PickShipBron`, `PickShipWachtOp`, `BucketKey`, `VervoerderSelectieStatus`.

Pure helpers (`mapPickbaarheidRegel`, `comparePickShipOrders`, `bucketVoor`, `chunks`) blijven intern. Geen externe consumer importeert ze; brede surface = padding zonder leverage.

### Pickbaarheid-fallback achter de seam

`fetchPickbaarheidRegels` mapt al twee shapes naar één type (`PickbaarheidRij`). Die discipline blijft, met expliciete documentatie: caller weet niet of de view aanwezig is. `FallbackOrderRegelRij` blijft module-private.

### Locatie-mutaties — pragma, geen seam-leak-fix

`updateMaatwerkLocatie` (UPDATE op `snijplannen`) en `updateRolLocatieVoorArtikel` (UPDATE op `rollen`) blijven in `modules/magazijn/` ondanks dat snijplannen + rollen formeel planning/voorraad-tables zijn. Operator-context is puur magazijn (locatie scannen tijdens pick). Tabel-eigenaarschap is hier implementatiedetail.

**Wel**: de twee opeenvolgende RPC's (`createOrGetMagazijnLocatie` + `updateMaatwerkLocatie`) worden vervangen door één atomic DB-RPC `set_locatie_voor_orderregel(p_order_regel_id INT, p_code TEXT)`. Lost de latente atomiciteitsbug op (als de tweede call faalt blijft een dangling magazijn_locatie achter).

### Vervoerder verhuist naar logistiek

- Verwijder vervoerder-fetch (regels 99-127 van `pick-ship.ts`) en de vier `vervoerder_*`-velden van `OrderHeaderRij` + `PickShipOrder`.
- `<VervoerderTag>` (bestaat al in `modules/logistiek/`) wordt zelf-fetchend: nieuwe of bestaande hook `useActieveVervoerder()` in logistiek levert `{ code, naam, selectie_status }`.
- `OrderPickCard` rendert `<VervoerderTag />` zonder props.
- `<VerzendsetButton>` verhuist als file naar `modules/logistiek/components/` en wordt door `OrderPickCard` via barrel geïmporteerd.

### URL-coupling blijft

De twee `<Link to="/pick-ship">` in `modules/logistiek/pages/zending-printset.tsx` blijven ongewijzigd. `useQueryClient().invalidateQueries({ queryKey: ['pick-ship'] })` in `use-zendingen.ts` ook. URL- en query-key-strings zijn geen code-coupling.

## Bestandsverhuizingen

Allemaal via `git mv` om history te behouden.

| Bron | Doel |
|------|------|
| `frontend/src/lib/supabase/queries/pick-ship.ts` | `frontend/src/modules/magazijn/queries/pickbaarheid.ts` |
| `frontend/src/lib/supabase/queries/pick-ship-transform.ts` | `frontend/src/modules/magazijn/queries/pick-ship-transform.ts` |
| `frontend/src/lib/supabase/queries/magazijn-locaties.ts` | `frontend/src/modules/magazijn/queries/magazijn-locaties.ts` |
| `frontend/src/hooks/use-pick-ship.ts` | `frontend/src/modules/magazijn/hooks/use-pick-ship.ts` |
| `frontend/src/lib/types/pick-ship.ts` | `frontend/src/modules/magazijn/lib/types.ts` |
| `frontend/src/lib/utils/pick-ship-buckets.ts` | `frontend/src/modules/magazijn/lib/buckets.ts` |
| `frontend/src/lib/utils/__tests__/pick-ship-buckets.test.ts` | `frontend/src/modules/magazijn/lib/__tests__/buckets.test.ts` |
| `frontend/src/pages/pick-ship/pick-ship-overview.tsx` | `frontend/src/modules/magazijn/pages/pick-overview.tsx` |
| `frontend/src/components/pick-ship/order-pick-card.tsx` | `frontend/src/modules/magazijn/components/order-pick-card.tsx` |
| `frontend/src/components/pick-ship/locatie-edit.tsx` | `frontend/src/modules/magazijn/components/locatie-edit.tsx` |
| `frontend/src/components/pick-ship/magazijn-locatie-edit.tsx` | `frontend/src/modules/magazijn/components/magazijn-locatie-edit.tsx` |
| `frontend/src/components/pick-ship/verzendset-button.tsx` | `frontend/src/modules/logistiek/components/verzendset-button.tsx` |

Lege folders na verhuis (`pages/pick-ship/`, `components/pick-ship/`) worden verwijderd.

## Stappenplan (issues)

### Issue A — DB-migratie: atomic locatie-update

**Doel:** vervang `createOrGetMagazijnLocatie` + `UPDATE snijplannen` door één RPC.

**Werk:**
- Nieuwe migratie `supabase/migrations/NNN_set_locatie_voor_orderregel.sql`.
- RPC `set_locatie_voor_orderregel(p_order_regel_id INT, p_code TEXT) RETURNS INT` (returnt magazijn_locatie_id).
- Body: `INSERT INTO magazijn_locaties (code) ... ON CONFLICT (code) DO UPDATE ... RETURNING id` → `UPDATE snijplannen SET locatie = p_code WHERE order_regel_id = p_order_regel_id AND status = 'Ingepakt'` → return id.
- Schrijf naar `docs/database-schema.md` (RPC-sectie).

**Onafhankelijk grijpbaar:** ja — frontend gebruikt nieuwe RPC pas in Issue D.

### Issue B — Folder-skelet `modules/magazijn/`

**Doel:** lege module-structuur klaarzetten zodat verhuizingen plaatsvinden in een schone container.

**Werk:**
- Maak `modules/magazijn/{hooks,queries,components,pages,lib,__tests__}/`.
- Maak lege `modules/magazijn/index.ts` (commentaar: "barrel komt in Issue F").
- Voeg path-alias toe in `tsconfig.json` indien nodig (`@/modules/magazijn/*`).

**Onafhankelijk grijpbaar:** ja.

### Issue C — Bestandsverhuizing met `git mv`

**Doel:** alle 12 bestanden verhuizen, 100% mechanisch, geen logica wijzigen.

**Werk:**
- Voer alle `git mv` uit zoals in tabel hierboven.
- Verwijder lege folders.
- Doe **geen** content-edits in deze stap. Imports breken bewust — Issue D fixt ze.
- Commit met `feat(magazijn): verhuis pick-ship-bestanden naar modules/magazijn (git mv)`.

**Onafhankelijk grijpbaar:** ja, maar levert kapotte build op tot Issue D klaar is. PR bundelen met D.

### Issue D — Imports updaten + smalle barrel + vervoerder verhuist

**Doel:** code laat compileren, vervoerder-fetch verhuist mee.

**Werk:**
- Update alle imports in verhuisde bestanden naar nieuwe paden.
- Verwijder regels 99-127 uit `modules/magazijn/queries/pickbaarheid.ts` (vervoerder-fetch).
- Verwijder `vervoerder_code`, `vervoerder_naam`, `vervoerder_actief`, `vervoerder_selectie_status` uit `OrderHeaderRij` en `PickShipOrder`.
- `OrderPickCard`: vervang vervoerder-prop-rendering door `<VervoerderTag />` self-fetch.
- Voeg `useActieveVervoerder()` hook toe aan `modules/logistiek/hooks/use-vervoerders.ts` (of hergebruik bestaande). `<VervoerderTag>` consumeert die hook.
- `<VerzendsetButton>` (verhuisd in C): import uit `modules/logistiek` updaten waar consumeerd.
- Update `modules/magazijn/index.ts` naar smalle barrel zoals in plan.
- Update `frontend/src/router.tsx` en sidebar-imports.
- Update `useUpdateMaatwerkLocatie` om de nieuwe RPC `set_locatie_voor_orderregel` aan te roepen (één await ipv twee).

**Onafhankelijk grijpbaar:** nee — afhankelijk van Issue A (RPC) + Issue C (verhuizing).

### Issue E — Tests verhuizen + magazijn-contract-test

**Doel:** bestaande tests blijven groen, nieuwe contract-test bewaakt de Module-interface.

**Werk:**
- Bestaande `pick-ship-buckets.test.ts` is al verhuisd in C. Verifieer dat `vitest` 'm pakt op de nieuwe locatie.
- Schrijf `modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts` (vergelijkbaar met `modules/planning/__tests__/planning-seam.contract.test.ts`): vier scenario's — view aanwezig met N regels, view aanwezig zonder regels, view ontbreekt (fallback), order zonder regels.
- Mock Supabase-client niet via een framework — gebruik factory-pattern voor `PickbaarheidRij`-fixtures.

**Onafhankelijk grijpbaar:** ja, na D.

### Issue F — Documentatie bijwerken

**Doel:** docs reflecteren de nieuwe Module-grafiek.

**Werk:**
- `docs/architectuur.md` sectie "Module-grafiek" bijwerken: `modules/magazijn/` als derde Module na orders + planning. Verwijs naar ADR-0002.
- `docs/changelog.md` entry toevoegen.
- `docs/database-schema.md` RPC `set_locatie_voor_orderregel` documenteren.

**Onafhankelijk grijpbaar:** ja, na D.

## Niet in scope

- **Schema-migratie `snijplannen.locatie` → FK naar `magazijn_locaties.id`** — V2-werk, té grote impact voor deze migratie.
- **Magazijn-Module presentatie-componenten exporteren** — geen externe consumer heeft ze nodig.
- **Pick-ship URL hernoemen naar `/magazijn`** — risico voor bookmarks van magazijn-medewerkers; niet de moeite voor een interne refactor.
- **Andere domain-modules migreren** (Klanten, Inkoop, Facturatie, Producten, Rollen) — `/improve-codebase-architecture` Kandidaat 2; aparte beslissing per module.

## Verifieerbare uitkomst

- `npm run lint` + `npm run typecheck` slagen op `feat/magazijn-module`.
- Vitest-suite groen, inclusief nieuwe magazijn-contract-test.
- Pick-overview op `/pick-ship` toont identiek gedrag aan vóór de migratie: dezelfde orders, dezelfde buckets, dezelfde vervoerder-badge, locatie-edit werkt atomair (één DB-call).
- `git log --follow` op verhuisde bestanden toont ononderbroken history.
- Geen externe consumer importeert pure helpers (`mapPickbaarheidRegel`, etc.) buiten de Module — gecheckt via `grep`.
