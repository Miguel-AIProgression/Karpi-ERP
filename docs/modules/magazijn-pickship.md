# Magazijn & Pick & Ship

> Module-doc: huidige staat + valkuilen. Chronologie: [docs/changelog.md](../changelog.md).
> Actuele RPC-bodies: [supabase/schema/functies.sql](../../supabase/schema/functies.sql) /
> [views.sql](../../supabase/schema/views.sql). Order-status-flow (incl. Pickronde-stappen
> 9-10, intake-gates): [docs/order-lifecycle.md](../order-lifecycle.md).

## Wat dit is

Pick & Ship is de werkvloer-brug tussen een bevestigde Order en een verzonden Zending.
Twee samenwerkende, bewust gesplitste concerns (ADR-0002): **Magazijn** bezit
Pickbaarheid (is het werk fysiek klaar), de Pickronde-bezigheid (picken → colli
afvinken → voltooien) en Manco (niet-gevonden colli); **Logistiek** bezit
Startbaarheid (mag de pickronde nú beginnen — vervoerder + intake-gates), de
`zendingen`-mutatie en de Bundel-Zending-vorming. Beide lagen zijn losstaand
testbaar en lezen elkaar alleen via smalle, met opzet dunne seams (views, pure
predicaat-modules).

## Kernbestanden

| Laag | Pad | Rol |
|---|---|---|
| DB view | `orderregel_pickbaarheid` / `order_pickbaarheid` (mig 386, laatste vorm mig 549) | Single source van Pickbaarheid, incl. Manco- en Concept-uitsluiting |
| DB RPC | `start_pickronden` (mig 248, guard mig 373, GLN-gate mig 544) | Enige entry-point pickronde-start (solo + Bundel-Zending, ADR-0012) |
| DB RPC | `voltooi_pickronde(n)` (mig 413/518, bulk mig 414) | Pickronde afronden, bundel-aware, Manco-aftakking |
| DB RPC | `markeer_colli_niet_gevonden` / `herstel_colli_pick` (mig 518) | Colli tijdens het picken markeren/herstellen |
| DB RPC | `manco_terug_naar_pickship` / `manco_niet_leverbaar` (mig 522) | Binnendienst-resolutie van een open Manco |
| DB RPC | `kan_deelzending` / `start_deelzending` (mig 413/473/477) | Deelzending aanmaken (reserveren, niet starten) |
| Frontend (magazijn) | [`modules/magazijn/pages/pick-overview.tsx`](../../frontend/src/modules/magazijn/pages/pick-overview.tsx) | Pick & Ship-hoofdpagina (sectionering, selectie) |
| Frontend (magazijn) | [`modules/magazijn/queries/pickbaarheid.ts`](../../frontend/src/modules/magazijn/queries/pickbaarheid.ts) | `fetchPickShipOrders` — headers + regels + zoeken op zending-nr |
| Frontend (magazijn) | [`modules/magazijn/queries/pickronde.ts`](../../frontend/src/modules/magazijn/queries/pickronde.ts) | RPC-wrappers voltooien/niet-gevonden/annuleren |
| Frontend (magazijn) | [`modules/magazijn/context/pick-selectie-context.ts`](../../frontend/src/modules/magazijn/context/pick-selectie-context.ts) | Multi-select-state, modus `starten`/`afronden` |
| Frontend (magazijn) | [`modules/magazijn/lib/afrond-selectie.ts`](../../frontend/src/modules/magazijn/lib/afrond-selectie.ts) | `zendingenVoorAfronden` — orders → unieke zendingen |
| Frontend (logistiek) | [`modules/logistiek/lib/startbaarheid.ts`](../../frontend/src/modules/logistiek/lib/startbaarheid.ts) | `bepaalStartbaarheid` — het canonieke predikaat (ADR-0037) |
| Frontend (logistiek) | [`modules/logistiek/hooks/use-pickbaarheid.ts`](../../frontend/src/modules/logistiek/hooks/use-pickbaarheid.ts) | Dunne wrapper om `startbaarheid.ts` t.b.v. de knoppen |
| Frontend (logistiek) | [`modules/logistiek/components/start-pickrondes-button.tsx`](../../frontend/src/modules/logistiek/components/start-pickrondes-button.tsx) / `start-week-button.tsx` | Pickronde-start-knoppen (cluster resp. hele week) |
| Frontend (logistiek) | [`modules/logistiek/queries/zendingen.ts`](../../frontend/src/modules/logistiek/queries/zendingen.ts) | `start_pickronden`-aanroep |
| Frontend (logistiek) | [`modules/logistiek/lib/combi-levering-achtergebleven.ts`](../../frontend/src/modules/logistiek/lib/combi-levering-achtergebleven.ts) | Vangnet tegen deelselectie van een Combi-levering-groep |
| Frontend (orders) | [`components/orders/deelzending-dialog.tsx`](../../frontend/src/components/orders/deelzending-dialog.tsx) | Handmatige deelzending-actie op order-detail |
| Frontend (orders) | [`modules/orders/components/manco-tab.tsx`](../../frontend/src/modules/orders/components/manco-tab.tsx) + `queries/manco.ts` | Manco-werklijst (orders-overzicht-tab) |
| Frontend (magazijn) | [`modules/magazijn/components/pick-problemen-banner.tsx`](../../frontend/src/modules/magazijn/components/pick-problemen-banner.tsx) | Amber banner → verwijst door naar de Manco-werklijst |

## Geldende ADR's & specs

- [ADR-0002](../adr/0002-pick-ship-splitst-naar-magazijn-en-logistiek.md) — magazijn/logistiek-splitsing, smal seam via slot-components.
- [ADR-0003](../adr/0003-pickronde-als-deepening-van-magazijn-module.md) — Pickronde-concept, status-flow `Picken → Klaar voor verzending`. **Het "blokkeer & escaleer / splits"-tweeledig niet-gevonden-ontwerp uit deze ADR is sinds mig 518 vervangen door Manco** (zie Valkuilen).
- [ADR-0012](../adr/0012-bundel-zending-als-deep-module.md) — `start_pickronden` als enige RPC, 4D-bundel-expansie, `force_solo_ids`.
- [ADR-0037](../adr/0037-pickbaarheid-startbaarheid-als-deep-module.md) — Startbaarheid als één pure module, canonieke prioriteit.
- [ADR-0040](../adr/0040-combi-levering-als-order-status.md) — Combi-levering is een `order_status`, geen Startbaarheid-gate (hoofdbehandeling elders, zie "Zie ook").
- [docs/order-lifecycle.md §9-10](../order-lifecycle.md) — de volledige Pickronde-/terminale-paden-flow in de bredere order-lifecycle-context.
- Plan manco: `docs/superpowers/plans/2026-06-26-manco-nl-de-binnendienst.md`.

## Bedrijfsregels (huidige staat)

### Pickbaarheid (view `order_pickbaarheid`, single source, mig 386)

- `pick_ship_zichtbaar` = alle regels pickbaar, OF (`deelleveringen_toegestaan` AND
  ≥1 regel pickbaar). Geen rij = geen niet-pseudo regels = niets te picken.
- Statusfilter in `orderregel_pickbaarheid` sluit uit: `Verzonden`, `Geannuleerd`,
  `Concept` (mig 577 — een onbevestigde intake-order kreeg via de allocator al
  echte voorraadclaims en verscheen anders toch in Pick & Ship).
- Admin-pseudo-regels (VERZEND, DROPSHIP-*, VORMTOESLAG, …) generiek uitgesloten
  (ADR-0018) — geen artikelnr-specifieke skip meer.
- **Manco-regel blijft in de view staan** (`is_pickbaar=false`, `wacht_op='manco'`,
  mig 549) i.p.v. volledig uitgesloten — anders verdwijnt de héle order uit
  `order_pickbaarheid` zodra alle regels manco zijn, en werkt mig 521's
  actieve-zending-override niet meer (ORD-2026-0382).
- **Actieve zending altijd zichtbaar** (mig 476): `EXISTS(zending_orders/zendingen
  status IN ('Gepland','Picken'))` is een eigen OR-tak — een net-gestarte pickronde
  blijft vindbaar ook als de statische pickbaarheid-snapshot inmiddels nee zegt.
- **Open-manco-guard** (mig 521): zolang een order ≥1 open manco-regel heeft
  (`pick_backorder_sinds` gezet, niet geannuleerd) is hij niet zichtbaar via de
  voorraad-/deellevering-takken — wél via de actieve-zending-tak. Terugkeer pas
  na binnendienst-afhandeling.
- **Concept-orders** in Pick & Ship en **Combi-levering-status-guard** zijn ook
  status-gates op deze view — zie resp. hierboven en "Zie ook" onderaan.
- Zoeken op zending-nummer (2026-07-02, frontend-only): tijdens een zoekactie haalt
  `fetchZendingNrsPerOrder` per order de nrs op van zendingen in
  `Gepland`/`Picken`/`Klaar voor verzending` (bundel-aware via `zending_orders`,
  gechunkt tegen de PostgREST-rijencap); de zichtbaarheids-gate laat een
  niet-`pick_ship_zichtbaar`-order dan alsnog door als hij nog een niet-verzonden
  zending heeft — buiten zoeken is het gedrag byte-identiek.
- Dag-order-horizon (ADR 0014) blijft de enige client-side filter, afhankelijk
  van `vandaag` — een dag-order verschijnt pas vanaf `werkdagMinN(afleverdatum, 1)`.
- **Chunk-per-order_id** (fix 2026-06-11): regels worden per order_id gechunkt
  opgehaald — een kale GET liep tegen de PostgREST max-rows-cap (1000) aan.

### Startbaarheid (`bepaalStartbaarheid`, ADR-0037)

Eén status per order, canonieke prioriteit (eerste match wint):

```
in_pickronde > niet_pickbaar > afl_adres > afl_gln > prijs > geen_vervoerder > startbaar
```

- `niet_pickbaar`: `!alle_regels_pickbaar`, **tenzij** `heeft_gepland_zending`
  (mig 479 — zie Deelzending hieronder: een nog-niet-gestarte deelzending mag de
  order-brede knop niet blokkeren).
- `afl_adres` (mig 395): `afl_adres_incompleet_sinds` gezet.
- `afl_gln` (mig 543/544, **niet in ADR-0037 zelf gedocumenteerd — nieuwer**): een
  EDI-order met een aflever-GLN die geen vestiging matcht (stille HQ-fallback,
  `create_edi_order`) blokkeert nu hard i.p.v. ongemerkt op het hoofdadres te
  landen. Twee uitwegen: GLN alsnog aan een afleveradres koppelen (trigger wist
  de gate automatisch), of `markeer_afleveradres_gecontroleerd` (bewuste
  vrijgave, los van de orderbevestiging). Server-poort: tweede van de drie
  checks in `_valideer_intake_gates` (adres → afl_gln → prijs, per de live
  functie-body).
- `prijs` (mig 396): `prijs_ontbreekt_sinds` gezet.
- `geen_vervoerder` (mig 373): niet-afhaal + ≥1 regel `bron='geen'`. Eén
  definitie `heeftGeenVervoerder`, **isPickbaar-guarded** — een order komt hier
  alléén terecht als de vervoerder zijn énige blocker is.
- Alle consumers (knoppen via `usePickbaarheid`, page-sectionering/selecteerbaarheid
  in `pick-overview.tsx`) lezen deze ene status-map; niemand leidt 'm zelf af.
- Combi-levering is **geen** Startbaarheid-status meer (ADR-0040 supersedeert
  ADR-0039) — zie "Zie ook".

### Pickronde starten & afronden

- **Starten**: `start_pickronden(order_ids, picker_id, force_solo_ids)` — 4D-
  bundel-expansie (debiteur × adres-norm × vervoerder × verzendweek), één
  zending per bundel op status `'Picken'`, order → `In pickronde`. Enige live
  entry-point (ADR-0012); `start_pickronden_voor_order`, `start_pickronden_bundel`,
  `start_pickronde` en `create_zending_voor_order` zijn dode RPC's en per
  **mig 581 (2026-07-02) definitief gedropt** — ADR-0003's alias en ADR-0012's
  twee te-vervangen RPC's bestaan dus niet meer, ook niet als alias.
  Server-poort: `_valideer_intake_gates` ná de bundel-uitbreiding.
- **Afronden**: `voltooi_pickronden(zending_ids[], picker_id)` (mig 414) loopt
  per unieke zending (dedup via `zendingenVoorAfronden`) over `voltooi_pickronde`
  met een savepoint per zending — één falende zending blokkeert de batch niet.
  `voltooi_pickronde` zet alle `open`-colli's stilzwijgend op `gepickt`
  (vinkjes-omgekeerd: operator handelt alleen uitzonderingen af).
- **Multi-select met twee modi** (besluit 17-06-2026): één selectie-context
  (`pick-selectie-context.ts`) met modus `'starten'` (pickbare orders → start +
  print) vs. `'afronden'` (orders met lopende pickronde → in bulk compleet, geen
  printen/navigatie). `selectableIds` verschilt per modus; wisselen van modus
  wist de selectie (guarded render-setState, geen `useEffect`).
- **Startknoppen**: `StartPickrondesButton` (cluster-/order-niveau, met
  force-solo-checkboxes in de bundel-dialoog) en `StartWeekButton` (hele
  verzendweek in één klik, geen picker, `picker_id=NULL`, mig 394).
- **Combi-levering-vangnet**: `StartPickrondesButton` waarschuwt (checkbox-
  bevestiging, vaste audit-tekst) als het niet-aanvinken van een order een
  Combi-levering-groep zou splitsen — zie "Zie ook".

### Deelzending

- `kan_deelzending(order_id)` (read-only) + `start_deelzending(..., p_override_reden)`
  (mig 413/473) reserveren regels in een **nieuwe zending op status `'Gepland'`**
  — géén pickronde-start (mig 477): `markeer_pickronde_gestart` wordt niet
  aangeroepen, de orderstatus blijft ongewijzigd.
- De picker pakt de `'Gepland'`-zending later zelf op via de normale
  "Picken starten"-knop: `start_pickronden` promoot een bestaande `'Gepland'`-
  zending van de order naar `'Picken'` i.p.v. de regels dubbel te reserveren
  (`is_nieuw=false` in de response) — vandaar `heeft_gepland_zending` in
  Startbaarheid hierboven.
- `p_override_reden` omzeilt bewust `debiteuren.deelleveringen_toegestaan` met
  audit in `order_events.metadata`; blokkeert hard op `order.status='Wacht op
  combi-levering'` (mig 573 — de bedoelde route daar is de order-override, niet
  een deelzending).
- Weggooien vóór start: `annuleer_pickronde` accepteert sinds mig 478 ook
  `status IN ('Gepland','Picken')` — UI-copy "Deelzending verwijderen" voor
  `Gepland` (`AnnuleerPickrondeKnop`).
- Pakbon-indicator: `PakbonDocument.isDeelzending` toont een "DEELZENDING — niet
  de volledige order"-badge op browser- én server-PDF-pakbon.
- Facturatie-timing: `enqueue_factuur_voor_event` dekt zowel
  `event_type='pickronde_voltooid'` als `'deels_verzonden'` — een deelzending
  wacht niet meer tot de hele order compleet is.

### Manco

Definitie, gate-kolommen en de drie resolutie-uitkomsten staan in
[CONTEXT.md — Manco / Manco-resolutie](../../CONTEXT.md) (niet dupliceren).
Operationele regels die daar niet in staan:

- **Sinds mig 518 blokkeert een niet-gevonden colli de zending niet meer.**
  `markeer_colli_niet_gevonden(zending_colli_id, opmerking, picker_id)` zet
  alleen de colli-status; `voltooi_pickronde` slaagt altijd — de regel wordt
  daarbij bevroren tot Manco (`aantal-1`, `zending_regels.manco_aantal+1`,
  colli verwijderd, claim blijft gereserveerd). Is de héle zending manco, dan
  wordt de zending zelf verwijderd (niets te verzenden).
- `herstel_colli_pick` (mig 518) zet een per ongeluk gemarkeerde colli terug
  naar `open` ("Toch gevonden") **tijdens** de lopende pickronde.
- Verzendstatus per orderregel op order-detail (2026-06-26): badge *Verzonden*
  (groen) / *Manco — niet gevonden* (amber, open) / *Niet geleverd* (afgesloten)
  / *Nog te verzenden* — pure helper `bepaalRegelVerzendStatus`
  (`regel-verzendstatus.tsx`).
- Manco-werklijst-knoppen: "Opnieuw leveren" (was "Weer beschikbaar") en "Niet
  leverbaar / annuleren" (was "Niet leverbaar") — zelfde RPC's
  (`manco_terug_naar_pickship` / `manco_niet_leverbaar`), alleen copy gewijzigd.
- `PickProblemenBanner` op Pick & Ship toont open niet-gevonden-colli's en
  verwijst door naar de Manco-werklijst — het is geen blokkade meer, puur signaal.

## Valkuilen & gotcha's

- **Niet te verwarren — Pickbaarheid vs. Startbaarheid vs. Manco.** Pickbaarheid
  zegt "is het werk klaar" (view, order/regel-niveau). Startbaarheid zegt "mag de
  pickronde nú beginnen" (incl. vervoerder + intake-gates, bouwt bovenop
  Pickbaarheid). Manco is geen status maar een te-onderzoeken signaal ("waarschijnlijk
  te hoog geteld") dat na de Pickronde ontstaat.
- **ADR-0003 is deels achterhaald, niet formeel als superseded gemarkeerd.** Het
  "blokkeer & escaleer" vs. "splits"-tweeledig ontwerp voor niet-gevonden colli
  (met een `p_modus`-argument op `markeer_colli_niet_gevonden`) bestaat niet meer:
  mig 518 verving het door de Manco-flow (één onvoorwaardelijk pad, geen modus-
  argument meer — de 3- en 4-argument-signatuur zijn gedropt). Lees ADR-0003 dus
  alleen voor het `Picken`-statusconcept zelf, niet voor de niet-gevonden-mechaniek.
- **ADR-0012's twee te-vervangen RPC's en ADR-0003's alias zijn nu daadwerkelijk
  weg** (mig 581, 2026-07-02): `start_pickronden_voor_order`,
  `start_pickronden_bundel`, `start_pickronde`, `create_zending_voor_order`
  bestaan niet meer op de live DB (drievoudig geverifieerd: geen SQL-, cron- of
  frontend-callers meer). `start_pickronden` is het enige pad.
- **Bewust niet gebouwd:** een hele order uit een lopende bundel-zending halen
  (ADR-0012 Anker 3) — bij regel-problemen volstaat colli-splitsing/Manco, bij
  grovere problemen herstart de magazijnchef via annuleren + opnieuw. Aanhechten
  van een laat-verschenen order aan een al-lopende pickronde (ADR-0012) — bewust
  buiten scope, de 4D-auto-expansie bij start voorkomt de meeste gevallen.
  Query-keys-centralisatie (ADR-0012-backlog) — orthogonaal, nog niet opgepakt.
- **Deploy-voorwaarde:** `order_pickbaarheid`/`orderregel_pickbaarheid` (mig 386
  en elke opvolger, laatst mig 549/577) moet vóór de frontend op de live DB staan
  — er is geen PGRST205-fallback meer; Pick & Ship faalt anders hard.
- **`geen-vervoerder` ≠ onzichtbaar.** Orders met ≥1 regel `bron='geen'` staan
  gewoon in de lijst; alleen pick-*start* is geblokkeerd (disabled knop +
  server-guard in `start_pickronden`). Escape-hatch: vervoerder-override op de
  orderregel.
- **`afl_gln`-gate is nieuwer dan ADR-0037/de meeste CLAUDE.md-bullets** over dit
  onderwerp — hij staat wél al in `StartStatus` (`startbaarheid.ts`) en de
  server-poort, maar is in geen ADR expliciet vastgelegd. Bron:
  `supabase/migrations/544_afleveradres_gln_gate.sql` (hernummerd van 535).
- **`combi-levering-achtergebleven.ts` is vereenvoudigd** sinds ADR-0040: de
  oude `wacht_op_combi_levering`-check binnen de functie is vervallen (een
  order die de functie ziet is per definitie al startbaar); hij beschermt nu
  uitsluitend tegen een operator die handmatig een deel van een al-zichtbare
  groep selecteert.

## Zie ook

**Combi-levering** (order-status `'Wacht op combi-levering'`, ADR-0040, mig
556-574) — volledige behandeling in `docs/modules/orders.md`. Het
Pick-&-Ship-relevante deel: een wachtende order bereikt de Pick & Ship-query
(`order_pickbaarheid.pick_ship_zichtbaar`) nooit — de status-guard zit op DB-
niveau (mig 566), niet in Startbaarheid. Het enige dat in dít domein leeft is
het vangnet tegen *handmatige deelselectie* van een al-zichtbare, al-startbare
groep: `combi_levering_deelnemer` op `PickShipOrder` (los van de
`order_pickbaarheid`-loop bepaald — dekt ook orders zonder rij daar, bv. alleen
admin-pseudo-regels) + `vindtAchtergeblevenCombiLeveringLeden`
(`combi-levering-achtergebleven.ts`), geconsumeerd door `StartPickrondesButton`.

## Openstaand / V2

- **Open bedrijfsvraag** (Pick & Ship Concept-filter, mig 577): moet een
  Concept-order eigenlijk al voorraadclaims krijgen? Bewust niet aangepakt bij
  de mig 577-fix — claim-gedrag ongewijzigd gelaten, aparte bedrijfskeuze.
- **Combi-levering**: testmail + rep-incognito + volledige Pick & Ship-flow nog
  te verifiëren na de mig 556-574-livegang (zie `docs/modules/orders.md`).
- Aanhechten aan een lopende Picken-zending voor een laat-verschenen order
  (ADR-0012) — heroverwegen bij concrete V2-druk.
