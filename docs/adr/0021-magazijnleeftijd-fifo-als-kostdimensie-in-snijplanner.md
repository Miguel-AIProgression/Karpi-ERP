# ADR-0021 — Magazijnleeftijd (FIFO) als kost-dimensie in de Snijplanning-packer naast materiaal-efficiëntie

Status: accepted (2026-05-15) — **live in modus `simpel`; geavanceerde laag geparkeerd**

## Amendement 2026-05-15 — geparkeerd in modus `simpel`

De interne rol-data is nog niet op orde, dus de volledige kost-afweging draait nog niet productie. We introduceren `app_config.snijplanning.modus` (mig 285, default `'simpel'`):

- **`simpel` (nu live):** elke rol + voortvloeiende reststukken hebben `in_magazijn_sinds` (mig 280-282), en de snijplanner pakt **strikt de oudst-binnengekomen rol eerst** (binnen de bestaande priority-tiers + C1). Géén kost-afweging, géén extra-snijverlies-acceptatie, géén badge, géén auto-approve-carve-out (`fifoMetrics` blijft leeg). Op de rollen-pagina is per (kw,kl) zichtbaar wanneer elke rol binnenkwam en welke als eerste aan de beurt is (mig 286).
- **`geavanceerd` (later live):** de hieronder beschreven volledige functionaliteit. Alle code blijft aanwezig en getest; omschakelen = `modus` op `'geavanceerd'` (Instellingen → Productie Instellingen) zodra de data klopt.

De rest van deze ADR beschrijft de `geavanceerd`-modus.

## Context

Tapijtrollen van dezelfde kwaliteit + kleur-nr zijn van kleur identiek zolang ze vers zijn; kleurverschil ontstaat **puur door fysieke veroudering** naarmate een rol langer in het magazijn ligt. Dat geeft zichtbaar verschil wanneer één klant uit meerdere rollen wordt beleverd, of een week later bijbestelt. De packer (`_shared/guillotine-packing.ts`, gebruikt door `optimaliseer-snijplan` en `auto-plan-groep`) optimaliseerde tot nu toe puur op snijverlies + rol-zuinigheid, waardoor oude voorraad onbeperkt kon blijven liggen.

## Beslissing

We voeren `rollen.in_magazijn_sinds DATE` in als single source of waarheid voor de magazijnleeftijd (mig 280). Het wordt gezet bij IO-ontvangst (mig 281) en **geërfd door reststukken/aangebroken rollen van de moederrol** — de klok reset niet bij snijden (mig 282). Bewust een nieuw veld i.p.v. `reststuk_datum` herdefiniëren: die kolom heeft een afhankelijkheid in de kostentoerekening van `voltooi_snijplan_rol` (`reststuk_datum = CURRENT_DATE`) die niet mag breken.

De packer weegt leeftijd als kost: `kost = totaal_m2_afval − Σ_{gebruikte oude rol} α·max(0, leeftijd − drempel)`, met drempel 90 dgn en absolute voorrang vanaf 180 dgn — alles tunebaar via `app_config.snijplanning`. Twee harde constraints overrulen de leeftijdsscore: **C1** geen verdringing van rollen die al voor een ander goedgekeurd voorstel gereserveerd zijn; **C2** geen stuk met afleverdatum laten vallen dat de pure-efficiency-variant wél tijdig plaatste (conservatieve V1: terugvallen op efficiency). Transparantie via een subtiele per-snijgroep-badge (`snijvoorstellen.fifo_*`, mig 284) die alleen kleurt bij merkbaar extra afval; een rode badge wordt in `auto-plan-groep` **niet** auto-goedgekeurd maar blijft `concept` voor handmatige beoordeling.

## Gevolgen

- Een short-circuit (geen promotabele rol ouder dan de drempel) houdt het ~90%-verse-voorraad-geval gratis: legacy-gedrag, grijze badge, geen tweede packing-pass.
- Zonder `PackOptions.fifo` is het packer-gedrag exact als vóór mig 280-284; bestaande ffdh/guillotine-tests blijven ongewijzigd.
- C2 is bewust grof (val-terug-op-efficiency bij conflict) — per-rolwissel-rollback staat op de V2-backlog.
