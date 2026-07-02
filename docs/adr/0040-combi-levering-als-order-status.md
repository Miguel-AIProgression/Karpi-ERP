---
status: accepted
date: 2026-07-01
supersedes: 0039-combi-levering-als-startbaarheid-gate.md
---

# Combi-levering — een echte order_status, geen Startbaarheid-gate

## Context

ADR-0039 koos bewust voor een Startbaarheid-gate (ADR-0037): een Combi-levering-order bleef `Klaar voor picken` en dus **zichtbaar in Pick & Ship**, met alleen het *starten* van de pickronde geblokkeerd via een frontend-only `wacht_op_combi_levering`-veld in `startbaarheid.ts`. De expliciet overwogen en afgewezen alternatief was een nieuwe `order_status`-waarde — de redenering destijds: "de order ís gewoon `Klaar voor picken`, een nieuwe status zou het onderscheid tussen productie-/logistiek-fase en pickronde-start-toestemming vervagen."

Bij het testen (na livegang van mig 550-556) bleek dit niet de gewenste werking. De expliciete eis: een order die de vrachtvrije-drempel nog niet haalt moet **gelockt zijn op commercie, in een eigen tab, en helemaal niet in Pick & Ship verschijnen** — Pick & Ship moet schoon blijven van orders die er toch niets te zoeken hebben. ADR-0039's "geen nieuwe status"-argument bleek in de praktijk het probleem te zíjn, niet de oplossing.

## Beslissing

**Combi-levering krijgt een echte `order_status`-waarde: `'Wacht op combi-levering'`.** Dit hergebruikt het bestaande, single-source statusmodel (`derive_wacht_status`, mig 346/352/470/540) dat al exact dit patroon kent voor `Wacht op inkoop`/`Wacht op voorraad`/`Wacht op maatwerk`: de order zit in een tussenfase totdat een voorwaarde vervuld is, productie loopt gewoon door (geen enkele productie-/snijplanning-query filtert op deze specifieke status), en pas bij `Klaar voor picken` verschijnt de order in Pick & Ship.

### Anker 1 — Laagste prioriteit in de bestaande ladder, niet in de no-touch-lijst

`derive_wacht_status` (mig 558) krijgt een 5e parameter `p_wacht_op_combi_levering`, geëvalueerd ná de io-claim/tekort/maatwerk-checks en vóór de promotie naar `Klaar voor picken`. Bewust **niet** toegevoegd aan de no-touch/eindstatus-lijst: de status moet herhaaldelijk herevalueerbaar blijven en kan zowel promoveren naar `Klaar voor picken` als — symmetrisch aan het bestaande ADR-0027-claim-swap-precedent — demoveren vanuit `Klaar voor picken` als een sibling wegvalt en de groep weer onder de drempel zakt.

### Anker 2 — Groep-cascade in `herbereken_wacht_status`

Combi-levering is een groepsbeslissing (2D-sleutel debiteur_nr × genormaliseerd afleveradres); de overige drie criteria zijn puur order-eigen. `herbereken_wacht_status` (mig 559) krijgt een `p_cascade_groep`-parameter (default TRUE): ná het herevalueren van de eigen order herevalueert dezelfde functie ook elke sibling in de groep, met `cascade=FALSE` in de recursieve aanroep zodat er nooit een cyclus ontstaat (max. recursiediepte 2). De cascade-parameter wordt bewust `FALSE` gezet in de ene call-site die zelf al over alle orders van een klant loopt (`trg_debiteuren_combi_levering_fn`), om O(n²)-overhead bij een klantbrede toggle te voorkomen.

### Anker 3 — Pick & Ship-zichtbaarheid wordt een status-guard

`order_pickbaarheid` (mig 560) was tot nu toe puur regel-gebaseerd. Een expliciete `AND o.status <> 'Wacht op combi-levering'`-guard op de `pick_ship_zichtbaar`-tak (zelfde stijl als mig 521's open-manco-guard) is nu de daadwerkelijke bron van "niet zichtbaar in Pick & Ship".

### Anker 4 — Orders-overzicht-tab is de bestaande status-dropdown

`'Wacht op combi-levering'` wordt geregistreerd in `FASE_STATUSES` — exact hetzelfde mechanisme als de andere wacht-statussen, geen nieuwe UI-component nodig. `fetchStatusCounts`/`fetchOrders` hebben al generieke fallbacks voor elke nieuwe enum-waarde.

### Anker 5 — Wat blijft, wat vervalt

Blijft ongewijzigd: `debiteuren.combi_levering`/`orders.combi_levering_override`, `combi_levering_status`-view, `combi_levering_orderregel_subtotaal`, de VERZEND-regel-triggers (mig 552/555, nu aangevuld met een status-herwaardering-aanroep, mig 561), order-form-toggle, debiteur-detail-toggle, `combi-levering-in-wacht-knop.tsx` + RPC, orderbevestiging-paragraaf.

Vervalt (dode code — een wachtende order bereikt Pick & Ship nooit meer): het `wacht_op_combi_levering`-veld/StartStatus-lid in `startbaarheid.ts` en de bijbehorende fetch/velden op `PickShipOrder`.

Blijft bestaan, maar vereenvoudigd: `combi-levering-achtergebleven.ts` — beschermt niet tegen "de cascade mist een sibling" (die convergeert altijd), maar tegen een operator die in Pick & Ship handmatig een subset van een al-zichtbare, al-startbare groep selecteert. Dat scenario verandert niet; alleen de overbodig geworden `wacht_op_combi_levering`-check binnen de functie is geschrapt.

## Overwogen alternatieven

- **Vasthouden aan de Startbaarheid-gate (ADR-0039), alleen Pick & Ship visueel filteren op de client** — afgewezen: zou de facto hetzelfde bereiken maar zonder de bestaande statusmodel-infrastructuur (golden fixtures, snapshot-assert, orders-overzicht-tab) te hergebruiken; een order zou dan nog steeds `Klaar voor picken` heten terwijl hij het feitelijk niet is, wat toekomstige lezers van `orders.status` op het verkeerde been zet.
- **Een losse "commercie"-tabel/queue naast `orders`** — afgewezen: dupliceert precies het bestaande "wacht-fase-vóór-Klaar-voor-picken"-patroon met een nieuw datamodel, tegen de expliciete architectuurregel dat gedeelde logica niet gekopieerd wordt.

## Consequenties

### Migraties (feat/combi-levering, ná mig 556)

557 (enum, geïsoleerd bestand) → 558 (`derive_wacht_status`, 5-arg) → 559 (`herbereken_wacht_status`, groep-cascade) → 560 (`order_pickbaarheid`-guard) → 561 (combi-levering-triggers roepen nu ook `herbereken_wacht_status` aan) → 562 (enum-snapshot-assert-opvolger van mig 350).

### Frontend

`FASE_STATUSES`, `ORDER_STATUS_COLORS`, `ACTIVE_ORDER_STATUSES` (vertegenwoordigers-dashboard), de order-status-golden/contract-testset en `derive-status.ts`/golden-fixture zijn bijgewerkt. `startbaarheid.ts` is een veld/status lichter; `combi-levering-achtergebleven.ts` blijft, vereenvoudigd.

### Documenten

`docs/order-lifecycle.md` §2/§4, `docs/database-schema.md`, `CLAUDE.md`, `docs/changelog.md` bijgewerkt. ADR-0039 blijft staan met een "superseded by ADR-0040"-notitie (audit trail), niet verwijderd.
