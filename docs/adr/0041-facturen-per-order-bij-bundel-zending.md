---
status: accepted
date: 2026-07-02
supersedes: 0010-factuur-volgt-bundel-zending.md (gedeeltelijk — alleen het factuur-deel)
---

# Facturen per order bij bundel-zending — granulariteit (zending, order)

## Context

ADR-0010 legde vast: **1 bundel-zending = 1 factuur**. Dat klopte voor de drempel-toets (verzendkosten-drempel werkt alleen op bundel-niveau, dat is nog steeds waar) maar bleek fout voor de factuur zélf. Combi-levering (ADR-0039/0040) bundelt orders van klanten zoals SB Möbel Boss die bewust wachten tot hun cumulatieve bestelwaarde de vrachtvrije-drempel haalt, en die orders komen daardoor vaak van verschillende inkopers/afdelingen bij dezelfde debiteur samen in één zending terecht.

Expliciete eis (Miguel, 02-07):

> "Facturen moeten apart gefactureerd worden en mogen niet verzameld worden. Dus als verschillende orders gebundeld worden wel aparte facturen (per order). En pakbon mag wel verzameld worden maar wel duidelijk welke artikelen bij welke order horen."

Dit geldt generiek voor élke multi-order bundel-zending (mig 222/228-230), niet alleen combi-levering — de bundel-mechaniek maakt zelf geen onderscheid tussen "toevallig samen pickbaar in dezelfde week" en "bewust vastgehouden tot de drempel". Voor een solo-zending (1 order) verandert er niets: dat is en blijft 1 factuur.

Wekelijkse verzamelfacturen (`genereer_factuur_voor_week`) blijven buiten scope — alle 135 combi-klanten staan op `factuurvoorkeur='per_zending'` (live gecheckt 02-07), slechts 2 niet-combi-debiteuren op 'wekelijks', en die twee vragen niet om deze eis.

## Beslissing

**Factuur-granulariteit verschuift van zending naar (zending, order).** Elke order in een bundel-zending krijgt zijn eigen concept-factuur, eigen finalisatie en eigen mail/EDI-INVOIC — de pakbon blijft ongewijzigd per zending met per-order-groepering (bestond al: `_shared/pakbon/pakbon-document.ts` groepeert per bron-order met subkop "Order ORD-…", getest in `aggregatie.test.ts`/`pakbon-document.test.tsx`, geen wijziging nodig).

### `factuur_queue.order_id` als nieuwe schaal-as

`factuur_queue` krijgt kolom `order_id BIGINT REFERENCES orders(id)` (NULL voor legacy/wekelijkse rijen). De dedup-index verschuift van `(zending_id)` naar `(zending_id, order_id) WHERE zending_id IS NOT NULL`. `enqueue_factuur_voor_event` (die al per order vuurt) wordt daardoor eenvoudiger: één rij per (zending, order) i.p.v. de array_agg-subquery over zusterorders.

### Drempel-toets blijft bundel-breed, en is finalisatie-volgorde-onafhankelijk

De verzendkosten-drempel (ADR-0010's oorspronkelijke motief) blijft op het niveau van de hele zending getoetst — dat is nog steeds het enige niveau waarop bundeling zin heeft. Maar omdat elke order nu zijn eigen factuur krijgt, mag de grondslag voor die toets niet meer afhangen van welke factuur al gefinaliseerd is: `projecteer_concept_factuur` berekent de grondslag als `SUM(order_regels.bedrag)` over **alle** orders van de zending, **zonder** een `gefactureerd`-filter. Zou de grondslag wél filteren op "nog niet gefactureerd", dan zou finalisatie van factuur 1 (de `gefactureerd`-flip) de grondslag van factuur 2's verse rebuild verlagen — en zou de uitkomst van de drempel-toets (korting wel/niet) afhangen van de volgorde waarin de facturen gefinaliseerd worden. Dat is expliciet getest (plan-scenario "volgorde-onafhankelijkheid": finaliseer factuur B vóór A → A's rebuild behoudt identieke korting/grondslag).

Bewuste semantiek-nuance bij overlap met een deelzending: de grondslag telt de volledige order-waarde, ook als een deel van die order via een andere zending gaat. Dat is klant-gunstig en past bij de combi-levering-intentie (de klant wordt niet benadeeld doordat zijn bestelling toevallig over twee fysieke zendingen verdeeld is).

### Korting-verdeling per order

Van de VERZEND-kostenregel-logica verhuist de "wie draagt de verzendkosten"-beslissing naar een per-order-blok:

- De **verzendkosten-drager** (eerste order van de zending) krijgt DREMPELKORTING als de bundel de drempel haalt, of houdt zijn VERZEND-regel als dat niet zo is (klant betaalt 1× per bundel, niet per order).
- **Zusterorders** krijgen altijd BUNDELKORTING op hun eigen VERZEND-regel (mits die regel bestaat en > €0) — een bundel is 1 fysieke transportbeweging, zusterorders betalen nooit een eigen verzendkosten-component.

### Pakbon blijft ongewijzigd

De pakbon was al per-order-gegroepeerd (ADR-0033-precedent, `_shared/pakbon/`) — geen wijziging nodig. Elke order-factuur van een bundel krijgt bij verzending dezelfde bundel-pakbon als bijlage; `genereerPakbonBijlagen` in `factuur-verzenden/index.ts` blijft letterlijk ongewijzigd.

## Overwogen alternatieven

- **Eén factuur per bundel met per-order-subtotalen als sub-secties** — afgewezen: dat is precies wat de klant expliciet niet wil ("mogen niet verzameld worden"). De boekhoudkundige eenheid moet de order zijn, niet de fysieke transportbeweging — dat is het omgekeerde van ADR-0010's oorspronkelijke argument, maar de klanteis is hier leidend boven de eerdere aanname.
- **Drempel-toets per order** — afgewezen: zou de facto de bundel-bonus tenietdoen (2× een kleine order zou dan nooit samen de drempel halen), exact het scenario dat ADR-0010 destijds probeerde op te lossen. De drempel-toets blijft daarom bewust bundel-breed, los van de factuur-granulariteit.
- **Grondslag filteren op `gefactureerd`-status** — afgewezen: maakt de uitkomst afhankelijk van finalisatie-volgorde (zie hierboven), een niet-deterministisch en dus onbetrouwbaar drempelresultaat.

## Consequenties

- **Migratie 578:** `factuur_queue.order_id` toegevoegd; dedup-index verschoven naar `(zending_id, order_id)`; `enqueue_factuur_voor_event` vereenvoudigd; `projecteer_concept_factuur`/`finaliseer_concept_factuur` krijgen een 3e parameter `p_order_id DEFAULT NULL`; `claim_factuur_queue_items` retourneert `order_id` erbij.
- **Deploy-window-vangnet:** `finaliseer_concept_factuur` valt bij `p_order_id IS NULL` terug op een lookup in `factuur_queue` (`WHERE factuur_id = p_factuur_id`) — een edge-function-deploy die nog met de oude 2-argument-vorm aanroept flipt daardoor toch alleen de juiste order, niet de hele bundel. Zonder dit vangnet zou het window tussen mig-apply en edge-deploy `gefactureerd` kunnen zetten op orders die niet op de factuur staan.
- **Edge function `factuur-verzenden/index.ts`:** het geclaimde-item-type krijgt `order_id: number | null`; beide RPC-aanroepen in het per_zending-pad geven `p_order_id: item.order_id ?? null` mee. `genereerPakbonBijlagen` en de rest ongewijzigd.
- **N mails/EDI-INVOICs per bundel** i.p.v. 1 — een bundel van 3 orders genereert nu 3 factuurmails/INVOICs, elk met dezelfde bundel-pakbon als bijlage.
- **Wekelijks pad (`genereer_factuur_voor_week`) blijft onaangeroerd** — buiten scope, zie Context.

## Superseded (gedeeltelijk)

- [ADR-0010](0010-factuur-volgt-bundel-zending.md) — het factuur-deel ("1 bundel-zending = 1 factuur") is vervangen door deze ADR. De bundel-zending/pakbon-mechaniek (bundel-sleutel, `zending_orders` M2M, drempel-toets-níveau) uit ADR-0010 blijft volledig van kracht.
