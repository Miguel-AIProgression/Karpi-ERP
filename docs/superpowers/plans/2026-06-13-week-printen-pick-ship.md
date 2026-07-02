# Plan: "Hele week printen" in Pick & Ship

**Datum:** 2026-06-13
**Status:** Concept — wacht op akkoord vóór bouw
**Aanleiding:** Tijdens meekijken met logistiek (13-06): zij printen pakbonnen + verzendlabels
vaak als één stapel. Wens: een hele week orders tegelijk selecteren en in één handeling
printen, i.p.v. cluster-voor-cluster.

---

## 1. Kernbevinding (bepaalt het hele ontwerp)

**Een pakbon of verzendlabel bestaat pas ná het starten van een pickronde.** Het label/
de pakbon hangt aan een **zending** (`zending_nr`, `zending_colli` met `sscc`/`colli_nr`),
en die zending ontstaat pas in `start_pickronden`. Er is **geen** manier om een pakbon/label
te previewen op kale order-data (geen SSCC, geen colli-indeling).

Gevolg: **"een week printen" = "voor alle pickbare orders van die week een pickronde starten,
en daarna de bulk-printset openen"**. Dit hergebruikt de bestaande infra volledig:

- `start_pickronden(order_ids[], picker_id, force_solo_ids[])` (mig 373) — auto-4D-bundeling,
  maakt zendingen + colli's, retourneert `zending_nr`'s.
- Bulk-printroute `/logistiek/printset/bulk?zendingen=Z1,Z2,…` ([bulk-printset.tsx](../../../frontend/src/modules/logistiek/pages/bulk-printset.tsx))
  — print **labels als één stapel** (knop "Stickers printen") en **pakbonnen als één stapel**
  (knop "Pakbonnen printen"), elk naar zijn eigen printer. Dit is precies de "1 stapel per
  printer"-wens; de nutteloze "Alles"-knop is in dezelfde sessie al verwijderd.

We hoeven dus **geen** nieuwe print-pijplijn te bouwen — alleen een **selectie-/start-entry op
weekniveau** die alle pickbare order-id's van de week verzamelt en in één `start_pickronden`
stopt, gevolgd door navigatie naar de bulk-printset.

---

## 2. Groot risico — eerst beslissen: terugdraai-veiligheid

Een week in één klik starten creëert **veel zendingen tegelijk**. Er bestaat **geen annuleer-RPC**
voor een pickronde (ADR-0003: bewust V2). Toen vandaag 2 orders teruggezet moesten worden, kon
dat alleen via handmatige SQL. Een "start hele week"-knop vergroot de kans op een grote
foutieve start dramatisch.

**Aanbeveling: bouw eerst een `annuleer_pickronde(zending_id)`-RPC als vangnet** vóór (of samen
met) deze feature. Minimale vorm:
- Guard: `zending.status = 'Picken'` én géén colli `pick_uitkomst <> 'open'` (niets gepickt).
- Verwijdert `zending_colli` / `zending_regels` / `zending_orders` / `zendingen`.
- Zet betrokken orders terug naar `'Klaar voor picken'`.
- Audit-event (let op: enum `order_event_type` heeft nu géén passende waarde — toevoegen).
- Frontend: "Terug uit pickronde"-knop op de Verzendset-pagina (alleen bij 0 gepickt).

Zonder dit vangnet adviseer ik de week-start minstens achter een **expliciete bevestiging met
telling** te zetten ("Start 23 zendingen voor week 25?").

> **Beslispunt 1:** annuleer-RPC eerst bouwen (aanbevolen), of week-start met alleen een
> bevestigingsdialog?

---

## 3. Functioneel ontwerp

### 3.1 Waar komt de knop?
Per weeksectie ([pick-week-sectie.tsx](../../../frontend/src/modules/magazijn/pages/../components/pick-week-sectie.tsx))
een kop-actie **"Hele week starten & printen (N)"** waarbij `N` = aantal **pickbare** orders in
die verzendweek (over alle klant-clusters en landen heen).

- Telt alleen orders die `isPickbaar` zijn én niet geblokkeerd (geen vervoerder / afleveradres
  incompleet / prijs ontbreekt — dezelfde gates als `StartPickrondesButton`, mig 392/393).
- Toont geblokkeerd-telling: "(3 overgeslagen — nog niet pickbaar of geblokkeerd)".

### 3.2 Dag-orders
Een week-tab bevat ook een **dag-orders**-sectie (`lever_type='datum'`). Voorstel: de
"hele week"-knop pakt **alleen de week-orders**; dag-orders blijven hun eigen cluster-start
houden (ze verschijnen pas 1 werkdag vóór afleverdatum en hebben eigen urgentie).

> **Beslispunt 2:** dag-orders meenemen in "hele week", of bewust apart laten?

### 3.3 Flow
1. Operator klikt "Hele week starten & printen (N)".
2. Bevestigingsdialog: aantal zendingen (na 4D-bundeling kan dit < N zijn), aantal overgeslagen,
   optioneel een picker (nu optioneel — net opgeleverd), waarschuwing dat starten zendingen
   aanmaakt.
3. Eén `start_pickronden(order_ids, picker_id, [])` met **alle** pickbare week-order-id's.
   - Auto-4D-bundeling clustert wat samen reist; force-solo niet nodig op dit niveau.
4. Navigatie naar `/logistiek/printset/bulk?zendingen=…` met alle geretourneerde `zending_nr`'s.
5. Operator print de labels-stapel (knop 1 → labelprinter) en de pakbon-stapel (knop 2 →
   A4-printer), elk apart.

### 3.4 Herhaald printen / al gestarte orders
Orders die al "In pickronde" staan worden door `isPickbaar` (`!actieve_pickronde`) al uitgesloten,
dus de week-knop dubbel klikken start ze niet opnieuw. Voor het opnieuw printen van een al
lopende week is een aparte route ("print alle lopende zendingen van week X") denkbaar — backlog.

---

## 4. Implementatieslices (verticaal)

**Slice 0 (aanbevolen, los van de feature): `annuleer_pickronde`-RPC + knop** — terugdraai-vangnet.

**Slice 1: weekniveau-aggregatie + knop**
- Helper in [pick-overview.tsx](../../../frontend/src/modules/magazijn/pages/pick-overview.tsx) /
  `pick-week-sectie.tsx` die per verzendweek alle pickbare order-id's verzamelt.
- Nieuw component `StartWeekButton` (hergebruikt de gate-/vervoerder-logica uit
  `StartPickrondesButton`; overweeg die logica te extraheren naar een hook
  `usePickbareOrders(orders)` om duplicatie te vermijden).

**Slice 2: bevestigingsdialog + start + navigatie**
- Dialog met telling + optionele picker.
- `useStartPickrondes().mutateAsync({ orderIds, pickerId, forceSoloIds: [] })`.
- Navigatie naar bulk-printset (bestaande logica uit `StartPickrondesButton.handleStart`).

**Slice 3 (optioneel): "print lopende week opnieuw"**
- Query: alle zendingen `status='Picken'` met `verzendweek = X` → bulk-printset.

---

## 5. Wat we NIET bouwen
- Geen pakbon/label-preview vóór pickronde-start (technisch onmogelijk zonder zending).
- Geen samengevoegde "alles door één printer"-print (logistiek wil juist gescheiden printers —
  daarom is de "Alles"-knop verwijderd).
- Geen nieuwe print-template — `bulk-printset` dekt het.

---

## 6. Openstaande beslissingen
1. Annuleer-RPC eerst (vangnet) of alleen bevestigingsdialog?
2. Dag-orders meenemen in "hele week" of apart?
3. Knop op weekniveau (per `PickWeekSectie`) of één globale "start huidige tab"-knop bovenaan?
4. Picker bij week-start verplicht of optioneel laten (nu globaal optioneel)?
