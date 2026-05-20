# 0025 — Shape-bias in reststuk-scoring naast pure m²

**Status:** Geaccepteerd · 2026-05-20

## Context
Het snijplan-algoritme (`_shared/guillotine-packing.ts` en de twee
`compute-reststukken.ts`-spiegels) waardeert reststukken puur op oppervlak
(`area = breedte × lengte`). Boven de kwalificatie-drempel
(`RESTSTUK_MIN_SHORT=50`, `RESTSTUK_MIN_LONG=100`) telt elke vierkante centimeter
even zwaar — een 150×450 (verkoopbaar als woonkamer-tapijt) en een 75×905
(alleen bruikbaar voor staaltjes) scoren bij gelijke area gelijkwaardig.

Gevolg, geobserveerd op rol VERR130 C (400×1500 cm) met 3 placements
(250×450 + 325×225 + 235×235): de packer-layout laat technisch een 150×450 free-rect
liggen, maar de modal-rapportage (greedy-disjoint-cover op pure area) kiest een
marginaal grotere 75×905-strip die door alle drie rijen heen loopt, plus een
75×450 sliver en 95×230. De gebruiker krijgt drie strips waar één bruikbaar
tapijtrestant logischer was geweest. Met dezelfde shape-blindheid maakt het
algoritme óók in andere scenario's nutteloos-smalle keuzes wanneer placement-
opties leiden tot gelijke totaal-m².

Onderliggend domein-onderscheid (zie [data-woordenboek](../data-woordenboek.md)
entries *Reststuk*, *Reststuk-scoring*, *Staaltjes-restant*): een chunkier
reststuk heeft échte verkoopwaarde als off-the-shelf tapijt, een smalle strip
heeft hooguit latente waarde voor staaltjes-productie — en staaltjes is in V1
geen actieve productie-stroom met eigen lifecycle.

## Beslissing

Vervang in alle drie de plekken die nu `area = w × h` rekenen door een
**shape-gebiased score**:

```
score = area × √(short / long)
```

waarbij `short = min(w, h)` en `long = max(w, h)`.

Voorbeelden:

| Reststuk | area (cm²) | √(short/long) | score |
|---|---|---|---|
| 200×200 (klein vierkant) | 40 000 | 1.000 | 40 000 |
| 150×450 | 67 500 | 0.577 | **38 950** |
| 75×905 | 67 875 | 0.288 | **19 550** |
| 50×300 (smal latje) | 15 000 | 0.408 | 6 120 |

Een 150×450 verslaat dus duidelijk een gelijk-area 75×905, en blijft in
dezelfde orde-grootte als een klein vierkant. Smalle strips boven de
kwalificatie-drempel **verdwijnen niet** — ze blijven als reststuk
gerapporteerd — maar ze trekken geen placement-beslissingen meer naar zich toe.

De drempel (`RESTSTUK_MIN_SHORT=50`, `RESTSTUK_MIN_LONG=100`) blijft
ongewijzigd: 75-cm strips mogen als reststuk getoond worden voor de latente
staaltjes-bruikbaarheid. We veranderen alleen hoe zwaar ze meetellen in
keuzes tussen alternatieven.

**Drie plekken in lockstep**:
1. `_shared/guillotine-packing.ts::reststukAreaCm2` → hernoemen naar
   `reststukScoreCm2`, formule aanpassen. Gebruikt in `findBestPlacement`
   (placement-keuze) en `runGreedyPass` (Guillotine-vs-FFDH-keuze).
2. `_shared/compute-reststukken.ts::greedyDisjointReststukken` → de
   greedy-pick-sorteer veranderen van `area` naar `score`. Gebruikt door
   backend-RPC's die fysieke reststukken aanmaken.
3. `frontend/src/modules/snijplanning/lib/compute-reststukken.ts` →
   1-op-1 spiegel, zelfde verandering. Gebruikt door de rol-uitvoer-modal.

`scorePacking` (Guillotine-vs-FFDH-keuze, regel 542-558) gebruikt `reststuk_m2`
× 100 als bonus. Dat blijft conceptueel m²-eenheid — we voeden alleen de
shape-gewogen versie in. Het 100-gewicht hoeft niet aangepast.

## Alternatieven (verworpen)

- **A — `score = area × (short/long)`** (lineair). Te streng: een 75×905
  telt voor maar 5 625 (~8% van zijn area). Risico op overshoot: packer
  accepteert extra rolverbruik om smalle strips te vermijden, terwijl een
  smalle strip nog altijd boven nul-waarde uitkomt voor staaltjes. Verworpen.
- **C — Tier-tabel** (`short<75 ×0.3`, `<150 ×0.75`, anders `×1.0`). Discreet
  en uitlegbaar, maar introduceert harde knikpunten — een 74-strip telt voor
  ×0.3 en een 76-strip voor ×0.75. Vraagt om configureerbaarheid in
  `app_config.snijplanning` om die knikpunten te tunen, wat de implementatie
  verdubbelt. Verworpen voor V1.
- **D — Drempel verhogen naar 150×100** (smalle strips vallen onder de drempel
  en tellen nergens meer mee). Gebruiker wil 75×905-strips nog wél kunnen
  gebruiken voor staaltjes — ze moeten zichtbaar blijven, alleen geen
  placement-voorkeur meer trekken. Verworpen.
- **E — Aspect-ratio-cap** (alleen reststukken met `long/short < N` tellen
  voor scoring, rest = 0). Te alles-of-niets; same harde-knikpunt-bezwaar
  als C. Verworpen.

## Gevolgen

- **Gewenst:** bij keuze tussen layouts met gelijke totaal-m² aan reststukken
  wint de variant met chunkier vormen. In het VERR130 C-scenario verdwijnt de
  75×905-strip uit de modal en verschijnt 150×450 als R1.
- **Regressie-risico:** bestaande pack-scenarios in `guillotine-packing.test.ts`
  / `compute-reststukken.test.ts` kunnen andere placements opleveren. Tests
  moeten worden bijgewerkt waar de oude pure-area-aanname zat ingebakken; nieuwe
  test toevoegen die specifiek het VERR130 C-scenario dekt (200×200 wint van
  75×905 bij vrije keuze; 150×450 wint van 75×905 bij gelijke area).
- **Geen DB-migratie nodig:** de `bereken_rol_type()` trigger en
  `maak_reststuk()`-RPC blijven ongewijzigd. Bestaande `rol_type='reststuk'`-
  rijen in `rollen` zijn niet geraakt. De drempel `50×100` blijft de grens
  voor "kwalificeert als reststuk-rol" zowel in DB-classificatie als in
  scoring-input.
- **Configureerbaarheid:** geen `app_config.snijplanning`-veld voor deze
  formule. Een wortel-formule heeft geen tuneable parameter (`√(short/long)` is
  parameterloos); pas als operationele praktijk laat zien dat de balans
  doorslaat, herzien.
- **Aangebroken rol-rest:** wordt apart afgehandeld via `rol_type='aangebroken'`
  en de `AANGEBROKEN_MIN_LENGTE`-grens. Niet geraakt door deze ADR — staat los
  van reststuk-scoring.
- **Documentatie:** [data-woordenboek](../data-woordenboek.md) heeft de
  dubbele "Reststuk"-entry geconsolideerd en de termen *Reststuk-scoring* en
  *Staaltjes-restant* toegevoegd.
