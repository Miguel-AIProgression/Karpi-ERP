---
status: accepted
date: 2026-05-05
---

# Order-voorstel en Planning zijn twee aparte deep verticals met een TS-functie-contract als seam

## Context

Bij het aanmaken van een (maatwerk-)order moet RugFlow tegelijkertijd vier dingen weten: (1) hoe de regels gedekt zijn vanuit voorraad/uitwisselbaar/openstaande inkooporder, (2) of een `lever_modus`-keuze nodig is, (3) wat de afleverdatum wordt, en (4) bij maatwerk: of er een passende rol in de snij-pipeline zit en wanneer die gesneden zou worden. Punten 1–3 zijn commerciële beslissingen; punt 4 is productie-planning (FFDH 2D strip-packing, capaciteits-bezetting, backlog-simulatie, spoed-evaluatie).

Vóór deze beslissing leefde dit verspreid: punten 1–3 in `frontend/src/components/orders/` + losse RPC's, punt 4 in een edge-functie `check-levertijd` met `_shared/levertijd-*.ts` helpers. Beide kanten waren impliciet aan elkaar gekoppeld zonder zichtbare grens.

## Beslissing

We splitsen dit in **twee deep verticale Modules** met een expliciete seam ertussen:

- **`modules/orders/`** — bezit het Order-voorstel-concept (regels, dekking, lever-modus-vraag, afleverdatum, save). Deep RPC `bouw_order_voorstel` doet de allocatie-simulatie zonder commit; edge-functie `orders-bouw-voorstel` is de orchestrator.
- **`modules/planning/`** — bezit alle productie-planning (snijplanning, confectie-planning, levertijd-simulatie voor maatwerk, capaciteit). Edge-functie `planning-simuleer-levertijd` is de uitvoerder.

De **seam** is een pure TS-functie-contract: `simuleerLevertijd(maatwerkRegels) → scenario`. Cross-Module-aanroep gaat via een shared TS-helper die door beide edge-functies geïmporteerd wordt — niet via god-Module en niet via HTTP-tussenstap.

## Overwogen alternatieven

- **God-Module die zowel Orders als Planning bevat** — afgewezen omdat het exact het probleem is dat we willen oplossen (verspreide kennis, "kleine wijziging → bug elders"). Diepte is goed, breedte is niet hetzelfde.
- **Frontend-orchestratie** — `useOrderVoorstel` hook roept Orders-RPC + Planning-edge parallel aan en combineert. Afgewezen omdat de combinatie-logica dan aan de UI-kant leeft, niet-transactioneel is, en bij UI-bugs inconsistente staat kan creëren.
- **Eén shared TS-laag in `_shared/order-voorstel/`** — afgewezen omdat het beide concerns mengt en de seam onzichtbaar maakt (geen folder-grens, geen barrel-export).
- **Order-voorstel-Module nu, Planning later (optie III in de grilling)** — afgewezen omdat het een tijdelijke `lib/planning/seam.ts` introduceert en een tweede pijnlijke migratie garandeert. "In één keer goed" weegt zwaarder dan migratie-omvang.

## Consequenties

- Beide Modules kunnen onafhankelijk evolueren. Vervanging van het FFDH-algoritme = één file in `modules/planning/`. Wijziging van lever-modus-regels = één file in `modules/orders/`.
- De seam wordt expliciet getest met **contract-tests** die in beide Modules dezelfde fixtures draaien (`seam.contract.test.ts`).
- Andere consumers van Planning (snijplan-creatie, capaciteits-rapportage, dashboard-widgets) gebruiken dezelfde seam — twee adapters maken het een echte seam, niet een hypothetische.
- Pick-ship wordt later z'n eigen Module (vervolg-stap orders → picken → versturen) en consumeert Orders + Logistiek via vergelijkbare seams. Bewust nu uit scope.
- `<LevertijdSuggestie>`-component verhuist naar `modules/planning/` (presentatie van Planning-data), wordt geconsumeerd door `modules/orders/`. UI volgt de seam.
- Migratie zonder regression-snapshot werkt niet: er bestaat geen testfixture-set en het runtime-gedrag is breed. Eerste stap van uitvoering is het genereren van ~20 representatieve order-cases als regression-baseline.
