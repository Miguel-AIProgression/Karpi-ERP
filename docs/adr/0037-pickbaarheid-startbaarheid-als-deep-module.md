# ADR-0037: Pickbaarheid/startbaarheid als één deep module

**Status:** Geaccepteerd (2026-06-18)

## Context

Het predikaat *"kan deze order nu een pickronde starten, en zo niet, waaróm
geblokkeerd"* leefde op **drie** plekken, waarvan twee in TypeScript náást elkaar:

1. **SQL-view `order_pickbaarheid`** (mig 386) — de *onderkant*: `alle_regels_pickbaar`,
   `pick_ship_zichtbaar`. Single source voor regel-pickbaarheid. Blijft ongewijzigd. ✓
2. **`usePickbaarheid`** (`modules/logistiek/hooks/use-pickbaarheid.ts`) — berekent de
   per-reden blokkade-sets voor de **knoppen** (`StartPickrondesButton`,
   `StartWeekButton`, bulk-actiebalk): `geenVervoerderIds`/`aflAdresIds`/`prijsIds` zijn
   daar **isPickbaar-guarded** (een reden telt alleen mee als de order verder pickbaar is).
3. **`pick-overview.tsx`** (`modules/magazijn/pages`) — herberekent overlappende sets
   **inline**: `geblokkeerdeOrderIds` (geen-vervoerder-sectie-split), `nietPrintbaarIds`
   (sink onderin week-/dag-sectie) en `selectableIds` (multi-select-selecteerbaarheid).

Plekken 2 en 3 werden met de hand synchroon gehouden via letterlijke comments ("zelfde
predicaat als StartPickrondesButton"). Dat is geen deep module — het is handmatige sync
over twee TS-lagen. De afleidingen wéken bovendien subtiel af: `geblokkeerdeOrderIds`
telde geen-vervoerder **ongeguard** (ook niet-pickbare orders belandden in de
"Geen vervoerder mogelijk"-sectie), terwijl de knop 'm isPickbaar-guarded telt.

Deletion-test: verwijder de inline-sets in `pick-overview` → de sortering/sectie/
selectie-logica breekt; de complexiteit ís echt nodig, maar hoort gecentraliseerd in
de pickbaarheid-module, niet gedupliceerd. Een vierde intake-gate toevoegen kostte drie
edits (hook + page + server-mirror). De logica concentreert rond één begrip —
*startbaarheid van een order voor de pickronde* — maar had geen huis.

## Besluit

1. **Eén pure module** `modules/logistiek/lib/startbaarheid.ts` draagt het predikaat.
   Elke order krijgt **precies één status** (single-state enum), bepaald in canonieke
   prioriteit door `bepaalStartbaarheid(input)`:

   ```
   in_pickronde > niet_pickbaar > afl_adres > prijs > geen_vervoerder > startbaar
   ```

   Plus één definitie `heeftGeenVervoerder(afhalen, regels)` (was 2× inline:
   `!afhalen && regels.some(r => r.bron === 'geen')`).

2. **Alle consumers lezen de status; niemand leidt 'm nog zelf af.**
   - `usePickbaarheid` (knoppen) mapt elke order door `bepaalStartbaarheid` en leidt zijn
     bestaande publieke velden (`pickbareOrders`, `geenVervoerderIds`, counts, …) af uit
     de status-map. Publieke API ongewijzigd → géén edits in de 3 knop-componenten.
   - `pick-overview` bouwt dezelfde status-map uit zijn al-aanwezige
     `useEffectieveVervoerderVoorOrders`-batch (geen extra fetch) en leidt
     `geblokkeerdeOrderIds`/`nietPrintbaarIds`/`selectableIds` eruit af.

3. **De prioriteit is de TS-spiegel van de server-poort.** `_valideer_intake_gates`
   (mig 395/396: adres vóór prijs) + de geen-vervoerder-guard in `start_pickronden`
   (mig 373) zijn de hard-block server-side; deze module spiegelt diezelfde
   reden-volgorde frontend-zijde. De pure functie is met fixtures los testbaar
   (`startbaarheid.test.ts`) — niet meer ongetest inline in een 581-regel-page.

4. **Eén canonieke definitie van "geen-vervoerder-geblokkeerd"** voor pagina én knoppen
   (isPickbaar-guarded via de prioriteit: `geen_vervoerder` is laagste prio, dus de
   carrier telt alleen als hij de *enige* resterende blocker is). Dit harmoniseert de
   eerdere inconsistentie — zie Consequenties.

## Bewust buiten scope

- **De regel-pickbaarheid zelf** (view `orderregel_pickbaarheid`/`order_pickbaarheid`,
  mig 386) — al de single source; `bepaalStartbaarheid` consumeert `alle_regels_pickbaar`,
  herleidt niets opnieuw.
- **De dag-order-horizon** (ADR-0014, `werkdagMinN`) blijft client-side in
  `fetchPickShipOrders` — die hangt af van `vandaag`, is een zichtbaarheids- (niet
  startbaarheids-)filter, en staat los van dit predikaat.
- **De server-poort** (`_valideer_intake_gates`, `start_pickronden`) blijft de
  autoritaire hard-block; deze TS-module is de UX-spiegel, geen vervanging.

## Consequenties

- Eén plek voor "wanneer startbaar / waarom niet"; een nieuwe intake-gate = één edit
  (een status-tak + de bron-vlag), niet drie hand-gesynchroniseerde plekken.
- Alle consumers krijgen identiek gedrag — de knop-disable, de page-sectionering en de
  multi-select-selecteerbaarheid kunnen niet meer uit elkaar lopen.
- **Bewuste gedragswijziging op de pagina:** een order komt voortaan alléén in de
  "Geen vervoerder mogelijk"-sectie als de vervoerder zijn énige blocker is. Orders die
  óók niet-pickbaar zijn (wacht op snijden/inkoop) of een adres-/prijs-gate hebben, tonen
  nu onder hun primaire reden in de week-/dag-sectie (gesorteerd onderaan) i.p.v. in de
  geen-vervoerder-sectie. Operationeel correcter: die sectie wijst nu precies de orders
  aan waar de magazijnier *alleen* op een vervoerder wacht.
- Frontend-only: geen migratie, geen deploy-volgorde. Een karakteriseringstest borgt
  0 regressie op de knop-API; de bestaande `magazijn-pickbaarheid.contract.test.ts`
  (view-laag) blijft ongewijzigd groen.
