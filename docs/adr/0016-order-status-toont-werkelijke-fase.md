---
status: accepted
date: 2026-05-13
---

# Order-status toont werkelijke fase — `Nieuw` splitst in `Klaar voor picken` / `In pickronde` / `Deels verzonden`

## Context

ADR-0006 vestigde Order-lifecycle als deep Module met `_apply_transitie` als enige schrijfpad. De canonieke ENUM bevat sindsdien vijf waarden: `Nieuw`, `Wacht op voorraad`, `Wacht op inkoop`, `Verzonden`, `Geannuleerd`.

Operationeel blijkt `Nieuw` een *vergaarbak-status*: het betekent "niet geannuleerd, niet verzonden, geen tekort". Daaronder vallen vier operationeel zeer verschillende toestanden:

1. Order is **klaar om gepickt te worden** — alle reserveringen zijn rond, magazijn kan beginnen.
2. Order zit **in een actieve pickronde** — pakker is bezig, zending is aangemaakt.
3. Order is **deels al verzonden** — multi-zending order waar één zending uit is, andere nog niet.
4. Order **wacht op maatwerk** — heeft ≥1 maatwerk-regel zonder ingepakt snijplan; magazijn kan nog niet picken want het maatwerk moet eerst gesneden en geconfectioneerd worden.

In het orders-overzicht is dat verschil onzichtbaar: alle vier tonen "Nieuw" (zie screenshot 2026-05-13 — Floorpassion-orders die al gefactureerd zijn naast Floorpassion-orders die nog niet ingepakt zijn, beide met identieke "Nieuw"-badge). De gebruiker moet doorklikken naar elke order om de daadwerkelijke fase te zien. Dat is een Module-incoherentie: de status biedt niet de informatie die zijn aanwezigheid in de UI suggereert.

Het patroon is hetzelfde als bij `Klaar voor verzending` (ADR-0006 §"spook-status"): een veld dat niet de werkelijkheid reflecteert, omdat de bron-events (pickronde gestart, zending uit) nooit terugschrijven naar `orders.status`.

## Beslissing

Breid `order_status` uit met vier nieuwe waarden die expliciet door de Order-lifecycle Module worden geschreven:

| Status | Wanneer | Schrijfpad |
|---|---|---|
| `Klaar voor picken` | geen tekort, geen actief maatwerk, geen actieve zending, niet verzonden | `herbereken_wacht_status` (vervangt `Nieuw` voor nieuwe orders) |
| `Wacht op maatwerk` | ≥1 maatwerk-regel zonder snijplan in eindstatus `Ingepakt` (geen tekort op vaste-maten) | `herbereken_wacht_status` (afgeleid uit snijplannen-state) |
| `In pickronde` | ≥1 zending in status `Picken` of `Klaar voor verzending` voor deze order | `markeer_pickronde_gestart` (nieuwe command-RPC) |
| `Deels verzonden` | ≥1 zending verzonden + ≥1 zending nog open | `markeer_deels_verzonden` (nieuwe command-RPC), geroepen vanuit `voltooi_pickronde` |

`Nieuw` blijft als ENUM-waarde bestaan (Postgres laat `DROP VALUE` niet toe), maar na backfill bevat geen enkele order deze waarde meer en de frontend toont hem niet als filter-tab.

### Status-machine na uitbreiding

```
Wacht op inkoop ──┐
Wacht op voorraad ─┤
Wacht op maatwerk ─┼─► Klaar voor picken ──► In pickronde ─┬─► Verzonden
                   │                                       └─► Deels verzonden ─► Verzonden
                                                                                       │
elk niet-Verzonden ────────────────► Geannuleerd ◄─────────────────────────────────────┘
```

Eindstatussen: `Verzonden` en `Geannuleerd` (ongewijzigd). `In pickronde` en `Deels verzonden` zijn intermediaire fases die door pickronde-events worden gezet/getransitioneerd — niet door claim-recompute. `herbereken_wacht_status` kiest tussen `Wacht op inkoop` / `Wacht op voorraad` / `Wacht op maatwerk` / `Klaar voor picken` op basis van actuele claim- en snijplan-state, en raakt de pickronde-fases niet aan.

### Volgorde van Wacht-X derivatie

In `herbereken_wacht_status` is de prioriteit:

1. `Wacht op inkoop` — meest blocking, materiaal moet eerst binnenkomen
2. `Wacht op voorraad` — geen voorraad, geen IO-claim, dus claim-acties nodig
3. `Wacht op maatwerk` — alle materialen zijn er; maatwerk moet nog gemaakt
4. `Klaar voor picken` — alles is rond, magazijn kan beginnen

Een maatwerk-order met openstaand vaste-maten-tekort toont `Wacht op inkoop` (of `Wacht op voorraad`) — niet `Wacht op maatwerk` — totdat de materialen aankomen. Pas dan flipt de status naar `Wacht op maatwerk` (snijplannen moeten nog door productie). Zodra de snijplannen `Ingepakt` zijn en alle vaste-maten gepickt kunnen worden → `Klaar voor picken`.

### Nieuwe RPC's

```sql
-- Commands (door Pickronde-module aangeroepen)
markeer_pickronde_gestart(p_order_id, p_actor_medewerker_id := NULL, p_actor_auth_user_id := NULL)
  -- idempotent; no-op als al 'In pickronde' of 'Deels verzonden'
  -- faalt op 'Verzonden' / 'Geannuleerd'

markeer_deels_verzonden(p_order_id, p_actor_medewerker_id := NULL, p_actor_auth_user_id := NULL)
  -- idempotent; no-op als al 'Deels verzonden'
  -- vereist ≥1 open zending én ≥1 zending in eindstatus
```

Beide volgen het ADR-0006-contract: lopen via `_apply_transitie`, schrijven een `order_events`-rij met `event_type='pickronde_gestart'` resp. `'deels_verzonden'`. Twee nieuwe waarden in `order_event_type` ENUM.

### Factuur-trigger blijft onveranderd

`enqueue_factuur_voor_event` (mig 223) filtert al strict op `event_type='pickronde_voltooid' AND status_na='Verzonden'`. De nieuwe event-types `pickronde_gestart` en `deels_verzonden` triggeren géén factuur, dus de factuur-keten blijft één-op-één gekoppeld aan de uiteindelijke `Verzonden`-transitie.

### Backfill bestaande `Nieuw`-orders

Eenmalig in mig 258 met `event_type='backfill_fase_normalisatie'` voor audit. Volgorde van checks (eerste match wint):

1. Order heeft ≥1 zending in `('Onderweg','Afgeleverd')` en ≥1 nog open → `Deels verzonden`
2. Order heeft ≥1 zending in `('Picken','Klaar voor verzending')` → `In pickronde`
3. Order heeft ≥1 maatwerk-regel zonder snijplan in `'Ingepakt'` → `Wacht op maatwerk`
4. Resterende `Nieuw` → `Klaar voor picken`

Orders in `Wacht op voorraad`/`Wacht op inkoop` blijven ongemoeid — die statussen worden door dezelfde claim-recompute beheerd en zijn al correct.

## Consequenties

**Positief:**

- Het orders-overzicht toont in één oogopslag waar elke order operationeel staat. Geen vergaarbak meer.
- De frontend-tabs vallen terug op precies de waarden die de DB schrijft (mig 218 ruimde al `Klaar voor verzending` op order-niveau op; deze ADR ruimt de andere legacy-tabs op: `In snijplan`, `In productie`, `Deels gereed`).
- `Deels verzonden` maakt multi-vervoerder-orders zichtbaar — een toestand die voorheen bestond maar onzichtbaar was tussen pickrondes door.
- Reports/exports krijgen de fase gratis mee als kolom in plaats van afgeleid te moeten worden.

**Negatief / risico's:**

- `start_pickronden` (mig 248) moet na zending-aanmaak `markeer_pickronde_gestart` aanroepen voor elke betrokken order. Eén extra round-trip per RPC-aanroep. Acceptabel — het is dezelfde transactie.
- `voltooi_pickronde` (mig 222) splitst de eindlogica in twee paden (`markeer_verzonden` vs. `markeer_deels_verzonden`). Meer code, maar de regel is mechanisch ("laatste open zending → Verzonden, anders → Deels verzonden").
- Backfill schrijft 1× per `Nieuw`-order een event. Dataset is klein (~9 orders bij mig 218; vergelijkbaar nu), dus impact verwaarloosbaar.
- `Nieuw` blijft als dode ENUM-waarde achter. Geen functioneel probleem; cosmetische CHECK-uitbreiding (zoals mig 218 deed voor `Klaar voor verzending`) staat op de V2-backlog als data-set stabiel `Nieuw`-vrij blijkt.

## Alternatieven overwogen

- **UI-afgeleide fase zonder DB-wijziging.** Eenvoudiger, geen migratie. Verworpen: rapportage/export/Supabase MCP-queries zouden de fase moeten herberekenen; status zou tussen UI en DB uiteenlopen. Same-pattern als ADR-0006-rationale.
- **Aparte `fase`-kolom naast `status`.** Behoudt 5-waarden-ENUM, voegt 2e dimensie toe. Verworpen: in praktijk zijn fase en status één state-machine — twee kolommen splitsen de invariant zonder winst.
- **Volledige rebuild met staat-machine-library.** Te invasief voor de hoeveelheid extra waarden. ADR-0006-pattern werkt — extend, don't rebuild.

## Implementatie

- Mig 257: ENUM-uitbreiding (`ADD VALUE` × 4 voor `order_status` + × 2 voor `order_event_type`).
- Mig 258: `markeer_pickronde_gestart`, `markeer_deels_verzonden`, update `herbereken_wacht_status` met maatwerk-detectie, split `voltooi_pickronde`, update `start_pickronden`, backfill.
- Mig 259: `orders_list` view uitbreiden met bundel-kolommen voor het accordion-UI in het overzicht (apart concern, zelfde release).
- Frontend: tabs + kleur-mappings + bundel-accordion + factuur-status-badge.

Zie [`docs/superpowers/plans/2026-05-13-order-fase-zichtbaar-maken.md`](../superpowers/plans/2026-05-13-order-fase-zichtbaar-maken.md) voor het volledige implementatieplan.
