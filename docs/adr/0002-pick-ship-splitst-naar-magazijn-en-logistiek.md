---
status: accepted
date: 2026-05-05
---

# Pick-ship splitst naar magazijn-Module + uitbreiding van logistiek-Module

## Context

ADR-0001 voorzag pick-ship als toekomstige derde Module ("vervolg-stap orders → picken → versturen"). Bij het uitwerken bleek de bestaande `lib/supabase/queries/pick-ship.ts` + `components/pick-ship/`-folder feitelijk drie verschillende concerns te bevatten: (1) **pickbaarheid** bepalen per orderregel + locatie-mutaties op rollen/snijplannen — magazijn-werk; (2) **vervoerder-selectie** voor de zending — logistiek-werk dat alleen toevallig op de pick-card werd getoond; (3) de **verzendset-knop** die `create_zending_voor_order` aanroept — een logistiek-mutatie verkleed als magazijn-actie.

Eén Module voor dit alles zou de mixed-concerns conserveren en de `modules/logistiek/`-folder uithollen.

## Beslissing

Splits in twee Modules met een **smal seam**:

- **`modules/magazijn/`** — bezit pickbaarheid (view `orderregel_pickbaarheid` + fallback), bucket-categorisering, locatie-mutaties op rollen + snijplannen, de pick-overview-pagina en `OrderPickCard`. Hosting van de fallback-tak achter de module-interface betekent dat callers één retour-type zien, niet twee data-shapes.
- **`modules/logistiek/`** (uitbreiding) — krijgt `VerzendsetButton` (mutatie op `zendingen`) en de actieve-vervoerder-fetch. `OrderPickCard` consumeert `<VervoerderTag>` als slot-component via barrel — geen data-coupling.

De **publieke interface** van `modules/magazijn/` is smal: alleen pages + hooks + types. Pure helpers (`mapPickbaarheidRegel`, `comparePickShipOrders`, `bucketVoor`) blijven intern — geen externe consumer heeft ze nodig.

## Overwogen alternatieven

- **Eén `modules/pick-ship/`-Module** (zoals ADR-0001 schetste) — afgewezen omdat het vervoerder-eigenaarschap dubbelzinnig laat (vervoerders-tabel + zendingen-tabel zijn logistiek-domein) en de naam de mixed concerns conserveert.
- **Hele `OrderPickCard` naar logistiek** — afgewezen omdat 80% van de kaart magazijn-data toont (bucket, pickbaarheid, locatie). Logistiek zou data van magazijn moeten consumeren — meer coupling dan de slot-pattern-oplossing.
- **Locatie-mutaties (`updateMaatwerkLocatie`, `updateRolLocatieVoorArtikel`) verhuizen naar `modules/planning/`** omdat ze `snijplannen` en `rollen` muteren — afgewezen omdat de operator-context puur magazijn is (locatie scannen tijdens picken). Tabel-eigenaarschap is hier implementatiedetail. **Wel** opgepakt: de twee opeenvolgende RPC's `createOrGetMagazijnLocatie` + `updateMaatwerkLocatie` worden vervangen door één atomic DB-RPC `set_locatie_voor_orderregel` om de latente atomiciteitsbug op te lossen.
- **Brede publieke interface** met pure helpers geëxporteerd — afgewezen na realiteit-check: geen externe consumer importeert de helpers. Eén adapter = hypothetische seam. Smal blijft default.

## Consequenties

- `lib/supabase/queries/pick-ship.ts`, `lib/supabase/queries/pick-ship-transform.ts`, `lib/supabase/queries/magazijn-locaties.ts`, `hooks/use-pick-ship.ts`, `pages/pick-ship/`, `components/pick-ship/` (minus `verzendset-button.tsx`) verhuizen naar `modules/magazijn/`. `lib/types/pick-ship.ts` en `lib/utils/pick-ship-buckets.ts` (+ test) gaan mee.
- `components/pick-ship/verzendset-button.tsx` verhuist naar `modules/logistiek/components/`.
- Vervoerder-selectie-fetch (regel 113-127 van `pick-ship.ts`) wordt een hook in `modules/logistiek/hooks/use-vervoerders.ts`; `<VervoerderTag>` consumeert die zelf.
- Nieuwe DB-migratie: RPC `set_locatie_voor_orderregel(p_order_regel_id, p_code)` die intern `create_or_get_magazijn_locatie` + `UPDATE snijplannen SET locatie = ...` atomair doet.
- Router-imports updaten (`router.tsx`); de twee `<Link to="/pick-ship">` URLs in logistiek blijven ongewijzigd (URL-coupling is acceptabel, geen code-coupling).
- Pickbaarheid-fallback (DB-view ontbreekt) blijft achter de module-interface — caller weet daar niets van.
