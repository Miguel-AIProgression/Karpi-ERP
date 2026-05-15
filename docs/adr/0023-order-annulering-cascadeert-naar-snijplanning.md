# ADR-0023 — Order-annulering cascadeert naar de Snijplanning-Module (event-listener)

- **Status:** Geaccepteerd
- **Datum:** 2026-05-15
- **Context-trigger:** Productie-observatie P. Dobbe — geannuleerde order bleef op de snijlijst staan, rollen niet vrijgegeven.

## Context

P. Dobbe annuleerde een order maar de bijbehorende snijplannen bleven op de
snijlijst staan; de gereserveerde rollen kwamen niet vrij. Verwachting van de
werkvloer: zolang een order nog niet (volledig) is verwerkt mag hij geannuleerd
worden, waarna hij van de snijlijst verdwijnt én alle gereserveerde
stukken/rollen weer vrij komen.

### Oorzaak-analyse

`markeer_geannuleerd` ([mig 218](../../supabase/migrations/218_order_lifecycle_module.sql))
zet `orders.status='Geannuleerd'` en schrijft een `geannuleerd`-event in
`order_events`. Daarop reageert exact één listener:
`trg_order_events_reservering_release` ([mig 255](../../supabase/migrations/255_reservering_order_events_trigger.sql))
— die releaset álle `order_reserveringen` (voorraad- + IO-claims).

**Niemand cancelt de `snijplannen`.** Hun status blijft `'Gepland'`/`'Snijden'`,
ze blijven aan hun `rol_id` gekoppeld en de rol blijft `in_snijplan`. Twee
gevolgen:

1. **Zichtbaarheid.** De snijlijst leest `snijplanning_overzicht`
   ([mig 233](../../supabase/migrations/233_snijplanning_overzicht_placed_kolommen.sql))
   met filter `sp.status IN ('Gepland','Snijden')`. Die view joint `orders o`
   maar heeft — anders dan de zustersview `orderregel_pickbaarheid`
   ([mig 288](../../supabase/migrations/288_orderregel_pickbaarheid_snijden_rang.sql),
   regel 101: `WHERE o.status NOT IN ('Verzonden','Geannuleerd')`) — **géén
   order-status-filter**. `snijplanning_overzicht` was hier de afwijkende.
2. **Rol-vastlegging.** De rol blijft `in_snijplan` zonder dat er een geldige
   order achter zit.

De claims (stukken) kwamen dus wél vrij; de snijplannen + rollen niet.

## Besluit

1. **Snijplanning luistert op `order_events`, net als Reservering.** Nieuwe
   handler `trg_order_events_snijplan_release()` + trigger op
   `order_events` `WHEN (event_type = 'geannuleerd')`, symmetrisch met
   `trg_order_events_reservering_release` (mig 255). Bij een
   `geannuleerd`-event:
   - **alle** snijplannen van de order (`status <> 'Geannuleerd'`) → `'Geannuleerd'`
     — ongeacht voortgang (bewuste werkvloer-keuze: een geannuleerde order is
     dood, ook al lag er al een stuk onder het mes);
   - geraakte rollen die door deze cancel hun laatste actieve
     (`Gepland/Snijden/Gesneden`) snijplan verliezen → terug naar `'reststuk'`
     (indien `oorsprong_rol_id` gevuld) of `'beschikbaar'`, met
     `snijden_gestart_op = NULL` (schone lei). Rollen die nog een ander
     (niet-geannuleerd) order bedienen blijven onaangeroerd.

   Hergebruikt het rol-vrijgave-patroon van `release_gepland_stukken`
   ([mig 133](../../supabase/migrations/133_release_gepland_op_bestel_kwaliteit.sql)),
   inclusief de `NOT EXISTS`-guard zodat een gedeelde rol niet onder een
   andere order vandaan wordt getrokken.

2. **Defense-in-depth op de view.** `snijplanning_overzicht` krijgt
   `WHERE o.status <> 'Geannuleerd'`. Bewust **alleen** `'Geannuleerd'`, niet
   `'Verzonden'` (zoals `orderregel_pickbaarheid` dat doet): `snijplanning_overzicht`
   voedt óók de fysieke rol-uitvoer-view (`fetchRolSnijstukken`) en de packer
   (`_shared/db-helpers.fetchStukken`) — een Verzonden-filter zou daar
   al-gesneden stukken verbergen. Geannuleerd is onbetwist: zo'n order hoort
   nergens in de snijplanning, ook niet als de trigger ooit faalt of bij
   legacy-data.

3. **Backfill.** Bestaande `Geannuleerd`-orders met niet-geannuleerde
   snijplannen (o.a. P. Dobbe's order) worden eenmalig via dezelfde logica
   opgeruimd.

## Gevolgen

- **Positief:** order annuleren is nu symmetrisch met order verwijderen wat
  betreft snijplan-opschoning; de snijlijst toont nooit meer een dode order;
  vrijgekomen rollen worden door de bestaande `rollen`-status-trigger
  (mig 111) automatisch weer aan auto-plan aangeboden voor wachtende orders.
- **Negatief / risico:** "ongeacht voortgang" betekent dat een rol die fysiek
  onder het mes lag toch naar `beschikbaar` kan gaan en `snijden_gestart_op`
  verliest — bewust geaccepteerd; een geannuleerde order rechtvaardigt geen
  half-afgesneden rol in limbo. Geen voorraadmutatie-correctie voor reeds
  fysiek gesneden reststukken (zeldzaam bij annulering vóór snijden; valt
  buiten scope).
- **Niet in scope:** `snijvoorstellen`-opschoning (auto-plan filtert al op
  order-/snijplan-status), Verzonden-filter op de view.

## Alternatieven overwogen

- **Alleen de view filteren (`o.status`).** Verbergt de order van de lijst maar
  laat zombie-snijplannen + vastgehouden rollen achter — lost P. Dobbe's
  tweede eis (rollen vrij) niet op. Verworpen als enige fix; behouden als
  defense-in-depth-laag.
- **Cascade in `markeer_geannuleerd` zelf.** Zou de RPC laten weten van de
  Snijplanning-Module en het event-driven ADR-0015/ADR-0006-patroon doorbreken.
  De listener-op-`order_events` houdt modules ontkoppeld.
- **Blokkeren bij snij-voortgang (exception, zoals order verwijderen).**
  Afgewezen door de werkvloer: annuleren moet altijd kunnen; de operator wil
  geen handmatige snijplan-opschoning vooraf.
