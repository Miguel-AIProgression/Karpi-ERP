---
status: accepted
date: 2026-05-11
---

# Bundel-Zending als deep Module met identity-driven creation — één `start_pickronden` vervangt twee RPC's, 4D-sleutel als auto-bundel-default

## Context

Sinds mig 222 (2026-05-04) is *Bundel-Zending* een load-bearing concept in Karpi's logistiek: meerdere orders naar hetzelfde adres met dezelfde vervoerder in dezelfde week reizen op één pakbon, één transportbeweging, en — sinds [ADR-0010](0010-factuur-volgt-bundel-zending.md) — als één factuur. Mig 228-230 maakten de 4D-bundel-sleutel `(debiteur × adres-norm × vervoerder × verzendweek)` de canonieke identiteit. Mig 242 (vandaag, 2026-05-11) bevestigde `zending_orders` als de canonieke M2M-tabel voor "alle orders in een zending".

Maar er is nóóit een ADR geweest die de Bundel-Zending als Module afbakent. Het concept leeft verspreid over zes plekken:

- [`supabase/migrations/220_start_pickronden_voor_order.sql`](../../supabase/migrations/220_start_pickronden_voor_order.sql) — RPC voor solo-orders, splitst intern op vervoerder
- [`supabase/migrations/222_zending_bundeling.sql`](../../supabase/migrations/222_zending_bundeling.sql) — RPC `start_pickronden_bundel(order_ids[], picker_id)` voor bundel-paden
- [`supabase/migrations/229_voorgestelde_zending_bundels_view.sql`](../../supabase/migrations/229_voorgestelde_zending_bundels_view.sql) — de live-preview-view met 4D-groepering en drempel-toets
- [`frontend/src/modules/logistiek/components/bulk-verzendset-button.tsx`](../../frontend/src/modules/logistiek/components/bulk-verzendset-button.tsx) — bundel-pad in UI
- [`frontend/src/modules/logistiek/components/verzendset-button.tsx`](../../frontend/src/modules/logistiek/components/verzendset-button.tsx) — solo-pad in UI
- [`frontend/src/modules/magazijn/lib/bundel-cluster.ts`](../../frontend/src/modules/magazijn/lib/bundel-cluster.ts) — 3D shadow-clustering (vervoerder × adres, géén week) bovenop de al-correcte 4D-groepering uit [`groeperen.ts`](../../frontend/src/modules/magazijn/lib/groeperen.ts)

Symptoom dat de Module-incoherentie blootlegde, gerapporteerd 2026-05-11: ZEND-2026-0010 (ORD-2026-2046, FLOORPASSION 3572AC Utrecht, Verhoek) en ZEND-2026-0006 (ORD-2026-2042 Verhoek-deel, zelfde klant, zelfde adres, zelfde week) zijn als twee losse zendingen ontstaan waar het systeem onder ADR-0010 één bundel-zending had moeten vormen → twee facturen op 11-05-2026 i.p.v. één. Architectuur-analyse op 2026-05-11 wees drie oorzaken aan:

1. **Twee RPC-paden** (`start_pickronden_voor_order` en `start_pickronden_bundel`) met verschillende bundel-semantiek. De solo-RPC weet niets van de 4D-sleutel; klikken op de individuele "Verzendset"-knop start een aparte zending, ook als er een open bundel-kandidaat is.
2. **Drie clustering-sleutels stapelden op elkaar**. SQL-view groepeert op 4D (correct), [`groeperen.ts`](../../frontend/src/modules/magazijn/lib/groeperen.ts) clustert UI-cards op die view-sleutel (correct), maar [`bundel-cluster.ts`](../../frontend/src/modules/magazijn/lib/bundel-cluster.ts) clustert in `BulkVerzendsetButton` opnieuw, nu op 3D (vervoerder × adres). Werkt toevallig omdat de pagina al per week splitst, maar het is een schaduw-laag bovenop de canonical view.
3. **Bundel als entity heeft geen levenscyclus**. De bundel ontstaat exact op het moment van pickronde-start uit één RPC-call. Order die een seconde te laat verschijnt = aparte zending, voor altijd. ADR-0010's "1 bundel = 1 factuur" maakt dit gevoelig: elke gemiste bundel kost een extra factuur, een extra pakbon, en mogelijk een drempel-doorbraak die niet meer plaatsvindt.

Grilling-loop op 2026-05-11 maakte de scope scherp: de Bundel-Zending verdient één eigen ADR die de Module-cohesie vastlegt, de drie verspreide entry-points consolideert, en stelling neemt op de granulariteit van bundel-membership (order vs orderregel) — zonder mig 242's net-aangenomen "M2M op order-niveau is canoniek"-belofte te schaden.

## Beslissing

**De Bundel-Zending is voortaan één deep Module met één publieke RPC.** Auto-bundeling is het default-gedrag; expliciet uitsplitsen is een operator-keuze die vóór pickronde-start kan plaatsvinden.

### Anker 1 — Eén RPC vervangt twee

```sql
start_pickronden(
  p_order_ids       BIGINT[],                          -- door operator geselecteerd
  p_picker_id       BIGINT,
  p_force_solo_ids  BIGINT[] DEFAULT '{}'::BIGINT[]    -- expliciet uit bundel gehouden
) RETURNS TABLE (zending_id BIGINT, zending_nr TEXT)
```

Gedrag in vier stappen:

1. **4D-uitbreiding (default-on auto-bundeling).** Voor elke `oid` in `p_order_ids`: zoek alle andere orders met identieke `bundel_sleutel(debiteur, adres-norm, vervoerder, week)` in [`voorgestelde_zending_bundels`](../../supabase/migrations/229_voorgestelde_zending_bundels_view.sql). Voeg deze "bundel-partners" toe aan de set, behalve de orders die in `p_force_solo_ids` staan.
2. **Groepering per 4D-sleutel.** Alle orders in de uitgebreide set worden gegroepeerd via `effectieve_vervoerder_per_orderregel` (mig 225/227) — multi-vervoerder-orders zoals ORD-2042 kunnen hun Verhoek-regels in de Verhoek-bundel en hun HST-regels in de HST-bundel hebben. Per unieke 4D-sleutel: één bundel-zending.
3. **Force-solo.** Elke order-id in `p_force_solo_ids` krijgt zijn eigen zending zonder bundel-partners (en met zijn eigen vervoerder-splitsing indien multi-vervoerder).
4. **Membership-vastlegging.** Per zending: rijen in `zending_orders` (mig 242 — canonical) + `zending_colli` (sub-order-granulariteit voor de niet-gevonden-flow). Returns alle aangemaakte zendingen voor de UI om naar `/logistiek/printset/bulk?zendingen=...` te navigeren.

De RPC's `start_pickronden_voor_order` (mig 220) en `start_pickronden_bundel` (mig 222) worden gedropt — beide use cases zijn dekkende deelgevallen van `start_pickronden`:
- `start_pickronden([order_id], picker_id)` met geen 4D-partners ≡ oude solo-flow
- `start_pickronden([order_ids], picker_id)` met expliciete partners ≡ oude bundel-flow
- `start_pickronden([order_id], picker_id, [order_id])` ≡ "ik wil expres solo ondanks bundel-kandidaten"

### Anker 2 — Bundel-eenheid blijft order; `zending_orders` blijft canoniek

Multi-vervoerder-orders zoals ORD-2042 worden door de RPC over meerdere bundel-zendingen verdeeld door per regel een aparte zending te schrijven — bestaande mig 220-mechaniek. Daardoor heeft ORD-2042 twee rijen in `zending_orders` (één voor de Verhoek-zending, één voor de HST-zending), wat geldig is voor een M2M-tabel.

Welke regels fysiek in welke zending zitten wordt afgeleid via `zending_colli.orderregel_id`. Geen nieuwe `zending_regels`-tabel — die zou expliciete regel-niveau-membership opleveren, maar verdubbelt informatie die `zending_colli` al draagt en zou mig 242's canonieke-belofte breken.

### Anker 3 — Pre-pickronde split via `force_solo_ids`; tijdens-pick split blijft niet-gevonden-flow

Twee plekken waar een operator een order/colli uit een bundel kan halen:

- **Vóór pickronde-start**: operator vinkt in de bundel-dialog één of meer orders uit. Die gaan via `p_force_solo_ids` mee — krijgen elk een eigen zending, de overige orders bundelen door. Use cases: rush-order, klant belde, andere afleverdatum nét niet geforceerd.
- **Tijdens lopende Pickronde**: bestaande niet-gevonden-flow ([data-woordenboek r163](../data-woordenboek.md#L163)) blijft de enige uitsplits-route. Werkt op colli-niveau (`markeer_colli_niet_gevonden(modus='splits'|'blokkeer')`). Een hele order uit een lopende bundel halen wordt **niet** ondersteund; bij regel-niveau-problemen is colli-splitsing voldoende, bij grover problemen herstart de magazijnchef de bundel via een andere weg (annuleer + opnieuw).

Toegevoegd ondersteund: bij een **bundel-zending** mag `markeer_colli_niet_gevonden(modus='splits')` werken óók als de eigen order `lever_modus <> 'deelleveringen'` is — de bundel-zending bevat per definitie meerdere orders, en het verlies van één colli betekent niet automatisch een deellevering van die order. Restrictie `deelleveringen_toegestaan` op debiteur-niveau blijft voor de eigen order; alleen de cross-order-context van een bundel mag de check overrulen. (Concrete implementatie in mig 248's update aan de niet-gevonden-RPC.)

### Anker 4 — Eén UI-knop met dialog vervangt twee

`<BulkVerzendsetButton>` en `<VerzendsetButton>` worden vervangen door één `<StartPickrondesButton>` + `<StartPickrondesDialog>`. De knop staat op zowel order-cards (in `OrderPickCard`) als cluster-cards (in `KlantClusterBlok`) — beide openen dezelfde dialog. De dialog toont:

- Alle 4D-matchende orders met checkbox per regel, default aangevinkt. Uitvinken = naar `p_force_solo_ids`.
- Bundel-besparing (uit `voorgestelde_zending_bundels.bundel_besparing`) als prominente €-pijl.
- Picker-dropdown (mig 217), met `last-picker-id`-recall uit localStorage.
- Eén "Start"-knop die `start_pickronden(order_ids, picker_id, force_solo_ids)` aanroept.

Resultaat: één dialog-component die zowel pure solo (1 order, geen partners) als bundel (≥2 orders) afhandelt. [`bundel-cluster.ts`](../../frontend/src/modules/magazijn/lib/bundel-cluster.ts) (140 regels schaduw-clustering) wordt verwijderd; [`groeperen.ts`](../../frontend/src/modules/magazijn/lib/groeperen.ts) blijft de enige UI-clustering, gevoed door [`voorgestelde-bundels.ts`](../../frontend/src/modules/logistiek/queries/voorgestelde-bundels.ts).

### Geen wijziging aan `voorgestelde_zending_bundels`

De view doet exact wat de Module nodig heeft: 4D-groepering met drempel-toets en besparing-berekening. De RPC consumeert 'm voor 4D-uitbreiding; de UI consumeert 'm voor cluster-rendering. Single source of truth blijft intact.

## Overwogen alternatieven

- **Per-orderregel-membership-tabel `zending_regels(zending_id, orderregel_id, aantal)`** — afgewezen tijdens grilling. Lijkt fysiek correcter (1 pakbon = N regels van M orders), maar verdubbelt informatie die `zending_colli.orderregel_id` al draagt. Bovendien zou het mig 242's net-aangenomen "M2M op order-niveau is canoniek"-belofte direct herzien — een dure herfundering voor een granulariteits-winst die de niet-gevonden-flow al via `zending_colli` levert. De operator denkt in orders, niet in losse orderregels; UI en factuur-aggregatie volgen.

- **Aanhechten aan lopende Picken-zending** ("ORD-B verscheen pas na ORD-A's start — hecht ORD-B aan bij A's open Picken-zending") — afgewezen. Vereist dat een actieve Pickronde meerdere operators of een herstart-mechaniek heeft; verbreekt de "1 pickronde = 1 picker"-belofte uit mig 217 / ADR-0005. De fix voor het ZEND-0010/0006-geval zit op een ander niveau: door auto-4D-uitbreiding bij `start_pickronden` is het ongebruikelijk dat orders later arriveren — operators zien de bundel al voorgesteld vóór ze klikken. Bij echte tijd-mismatch (operator A klaar voordat B verschijnt) accepteren we dat B een aparte zending wordt. Heroverwegen als V2-vraag concrete druk geeft.

- **Strict auto: solo-pad volledig droppen** — afgewezen. Operator-escape voor zeldzame "expres solo"-gevallen (verzending eerder, vervoerder-test, klant-uitzondering) is wenselijk. `p_force_solo_ids` is de minimaal-invasieve escape — geen aparte RPC, geen aparte knop, alleen een dialog-checkbox.

- **Force-uniform vóór bundelen** ("multi-vervoerder-orders mogen niet bundelen tot operator de vervoerder-regels uniform maakt") — afgewezen. Reduceert mig 219's per-regel-vervoerder de-facto tot order-niveau en straft een rationele situatie (klant heeft 1 regel waarop hij specifiek HST wil i.p.v. de default). De RPC kan de splitsing zelf doen zonder operator-tussenkomst.

- **Querykeys-centralisatie als onderdeel van ADR-0012** — afgewezen. Aparte concern (geldt voor alle Modules, niet alleen Bundel-Zending); blijft op de backlog als kandidaat #2 uit het 2026-05-11 architectuur-rapport. De 10s-lag in /logistiek wordt nu opgelost via één-regel-fix op `useVoltooiPickronde` (verkeerde prefix); volledige centralisatie kan later.

## Consequenties

### Migraties

- **Mig 248** — `start_pickronden(BIGINT[], BIGINT, BIGINT[])` RPC. Implementeert 4D-uitbreiding via `voorgestelde_zending_bundels` + groepering per `effectieve_vervoerder_per_orderregel`. Update `markeer_colli_niet_gevonden` zodat `modus='splits'` ook werkt op bundel-zendingen (cross-order-context-check).
- **Mig 249** — drop `start_pickronden_voor_order(BIGINT, BIGINT)` (mig 220) en `start_pickronden_bundel(BIGINT[], BIGINT)` (mig 222). `NOTIFY pgrst, 'reload schema';`.

### Frontend

- **Nieuw**: `frontend/src/modules/logistiek/components/start-pickrondes-button.tsx` (knop op order-card én cluster-card) + `start-pickrondes-dialog.tsx` (checkbox-lijst, besparing-display, picker-dropdown, één submit). Component-folder hoort onder `modules/logistiek/` (ADR-0008 module-eigenaarschap: vervoerder-cluster + zending-creatie horen daar).
- **Verwijderd**: [`bulk-verzendset-button.tsx`](../../frontend/src/modules/logistiek/components/bulk-verzendset-button.tsx), [`verzendset-button.tsx`](../../frontend/src/modules/logistiek/components/verzendset-button.tsx), [`bundel-cluster.ts`](../../frontend/src/modules/magazijn/lib/bundel-cluster.ts) (incl. `clusterOpAdresEnVervoerder` export uit `modules/magazijn/index.ts`).
- **Refactor**: [`pick-week-sectie.tsx`](../../frontend/src/modules/magazijn/components/pick-week-sectie.tsx) — `<BulkVerzendsetButton>` aanroep wordt `<StartPickrondesButton>`. [`order-pick-card.tsx`](../../frontend/src/modules/magazijn/components/order-pick-card.tsx) — `<VerzendsetButton>` wordt `<StartPickrondesButton>` met `orders={[order]}` als input. Beide gebruiken dezelfde dialog.
- **Queries**: [`zendingen.ts`](../../frontend/src/modules/logistiek/queries/zendingen.ts) — `startPickrondenVoorOrder` + `startPickrondenBundel` → één `startPickrondes(orderIds, pickerId, forceSoloIds?)`-wrapper. Hooks (`useCreateZendingVoorOrder` etc.) gerefactord.
- **One-line fix gelijkop** (orthogonaal aan deze ADR maar in dezelfde commit-keten): [`use-pickronde.ts:64`](../../frontend/src/modules/magazijn/hooks/use-pickronde.ts#L64) `queryKey: ['zendingen']` → `['logistiek', 'zendingen']` zodat `useVoltooiPickronde` de juiste cache invalideert in plaats van te wachten op de 30s-poll-tick. Verlost de gerapporteerde 10s-lag in /logistiek.

### Tests

- Contract-test op `start_pickronden` met vier fixtures:
  1. Solo-input zonder partners → 1 zending, 1 `zending_orders`-rij.
  2. Solo-input mét 4D-partner → 1 bundel-zending met beide orders.
  3. Bundel-input met `force_solo_ids` → 1 bundel-zending (resterend) + 1 solo-zending (geforceerd).
  4. Multi-vervoerder-order (zoals ORD-2042) + andere uniform-Verhoek-order → 2 zendingen, één bundel (Verhoek-regels van beide), één solo (HST-regel van de multi-order).
- Frontend: integration-test op `<StartPickrondesDialog>` — checkbox-toggle leidt tot `force_solo_ids`, submit roept RPC met juiste argumenten aan.
- Bestaande tests op `start_pickronden_voor_order` / `start_pickronden_bundel` worden vervangen (niet geüpdatet — RPC-namen vervallen).

### Documenten

- [`data-woordenboek.md`](../data-woordenboek.md) — nieuwe term **Bundel-Zending** met definitie, 4D-sleutel-verwijzing, M2M-relatie tot `zending_orders` en sub-order-mechaniek via `zending_colli`.
- [`architectuur.md`](../architectuur.md) — sectie "Logistiek-flow" wordt herschreven: één RPC `start_pickronden` als entry-point, vier-stappen-gedrag, geen onderscheid tussen solo en bundel.
- [`changelog.md`](../changelog.md) — entry voor 2026-05-11 met ADR-0012-verwijzing en migratie-keten 248/249.
- [`CLAUDE.md`](../../CLAUDE.md) — bedrijfsregel "Zending-bundeling op afleveradres (mig 222)" wordt geüpdatet met de auto-bundeling-default en de `force_solo_ids`-escape.

### Open kandidaten op de backlog

- **Querykeys-centralisatie** (kandidaat #2 uit het 2026-05-11 architectuur-rapport). Typed builder-module voor alle React-Query-keys, voorkomt prefix-mismatch-bugs zoals die in `useVoltooiPickronde`. Orthogonaal aan deze ADR; geen blokkade voor mig 248/249.
- **Effectieve-vervoerder-resolutie als één view/RPC** (kandidaat #3). De frontend-aggregatie `aggregeerVervoerderKeuzeVoorOrder` verdwijnt impliciet met deze ADR (clustering gebeurt SQL-side), maar het bredere idee "één canonieke vervoerder-resolutie voor alle consumers" blijft een aparte deepening.
- **Aanhechten aan lopende Picken-zending** voor het scenario "B verscheen na A's start" — heroverwegen als V2-vraag concrete druk geeft.
- **POD-callback van vervoerders** voor zending-status `Afgeleverd` — uit ADR-0010, blijft open.
