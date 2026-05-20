# ADR-0026 — Bruto-maatwerkvraag als pessimistisch planning-cijfer naast Claim-cache

**Status:** Geaccepteerd
**Datum:** 2026-05-20
**Beslisser:** Miguel
**Context:** [[Bruto-maatwerkvraag]] · [[Vrij voor nieuw maatwerk]] · [[Claim]] · [[Vrije voorraad]] · [[Uitwisselbaar]] · [ADR-0015](0015-reservering-als-deep-module.md) · [ADR-0019](0019-snijplan-per-fysiek-stuk-niet-per-orderregel.md)

## Context

De Rollen & Reststukken-pagina toont per `(kwaliteit_code, kleur_code)` de eigen voorraad (m² + rolcounts), uitwisselbare partners, en de openstaande inkoop (`besteld_inkoop` + eerstvolgende leverweek). Wat ontbreekt is **inzicht in toekomstige rol-belasting uit open maatwerk-orders**: hoeveel m² aan rol-materiaal staat er nog onder druk van snijplannen die nog niet gesneden zijn?

De bestaande [[Reservering-Module]] dekt dit niet:

- `producten.gereserveerd` (mig 144) is een Claim-cache uit `order_reserveringen` — alleen voor **vaste-maat**-orderregels. Maatwerk reserveert geen Claims in V1 (zie CLAUDE.md).
- De [[Snijplanning-Module]] kijkt 4 weken vooruit (mig 274 `auto_maak_snijplan` seedt per stuk), maar de inkoop-vraag is "wat staat er **überhaupt** open, ongeacht horizon".
- `vrije_voorraad` (mig 149) is een vandaag-perspectief, geen toekomstig-druk-cijfer.

De inkoper heeft een **bestelradar** nodig die los staat van zowel de Claim-cache als de 4-weeks-snijplanning-window, en die rekening houdt met dat een maatwerk-stuk **de volledige rolbreedte opslokt** in worst-case (er is geen garantie dat de packer meerdere smalle stukken naast elkaar past wanneer ze nog niet eens gepland zijn).

## Beslissing

Introduceer twee gekoppelde domeinconcepten:

### 1. Bruto-maatwerkvraag (planning-projectie)

Per **uitwisselbare familie** (`collectie_id, genormaliseerde_kleur_code`) de pessimistische projectie van rol-m² die nog uit voorraad moet komen.

**Formule per stuk:**

```
verbruik_m2 = min(stuk.lengte_cm, stuk.breedte_cm) × kwaliteit.standaard_breedte_cm
```

**Aggregatie:** SUM over snijplannen in status `{Wacht, Gepland, Snijden}`, op familie-niveau.

**Bewuste keuzes:**

| Aspect | Keuze | Waarom |
|---|---|---|
| Per-stuk vs. packer-aware | Per-stuk | Bestelradar, geen packing-simulatie. Pessimisme is feature: liever te vroeg signaal dan te laat. |
| Snij-marges meetellen | Nee | De `min(l,b) × rolbreedte`-formule heeft al structurele overschatting (stuk 100×200 telt voor 4 m², stuk is 2 m²). Marges erbij = dubbel pessimisme. |
| Tijdshorizon-filter | Geen | Bewust los van de 4-weeks-snijplanning. Inkoper wil álle open vraag zien, niet alleen de korte-termijn-druk. |
| Status-grens | `{Wacht, Gepland, Snijden}` | Materiaal verlaat de rol pas bij `voltooi_snijplan_rol` (`Gesneden`-flip). `Snijden`-stukken horen nog mee — het mes draait, maar materiaal is nog in de rol. |
| Eenheid | Uitwisselbare familie | Voor uitwisselbare paren ligt het fysieke materiaal als invariant onder één alias (één partij = één voorraad). Per-(kw,kl) zou structureel valse alarmen geven op partner-aliases zonder eigen voorraad. |

**Niet te verwarren met [[Claim]]:** Claims (`order_reserveringen`-rijen) zijn fysiek toegewezen materiaal. Bruto-maatwerkvraag is een planning-projectie, geen toewijzing. Wordt **niet** geschreven naar `order_reserveringen`; berekend in de RPC (uitbreiding van `voorraadposities`), niet gepersisteerd.

### 2. Vrij voor nieuw maatwerk (afgeleide KPI)

Per familie: **V1-formule** = `voorraad m² − Bruto-maatwerkvraag`. Claims (`producten.gereserveerd`) worden **niet** afgetrokken in V1 — die cache is `SUM(order_reserveringen.aantal)` in **stuks** (mig 149), niet m². Aftrek 1-op-1 zou voor vaste-maat-Claims een fors fout cijfer geven (5 stuks vloerkleed 200×300 wordt dan -5 m² i.p.v. de werkelijke -30 m²). Voor pure maatwerk-families is `gereserveerd` sowieso 0 (maatwerk reserveert geen voorraad-Claims in V1, zie CLAUDE.md), dus het V1-effect is voornamelijk dat gemengde families (rol + vaste-maat in zelfde familie) hun vaste-maat-druk niet zien — acceptabel binnen "stap 1 = inzicht".

**V2-formule (backlog):** `voorraad m² − Claims_in_m² − Bruto-maatwerkvraag`, waarbij `Claims_in_m² = SUM(aantal × stuk_m²)` via `producten`-join (`eenheid='stuks'` → `aantal × lengte_cm × breedte_cm / 10000`, `eenheid='m'` → `aantal × breedte_cm / 100`).

**`besteld_inkoop` bewust buiten de KPI** — staat als losse pill ernaast (eerstvolgende leverweek + m²). Analoog aan de mig 149-keuze om IO uit `vrije_voorraad` te halen: vermengen geeft schijn-zekerheid omdat IO een toekomst-week heeft die de inkoper apart moet afwegen.

### 3. Pragmatische RPC-uitbreiding, geen breaking shift

`voorraadposities()`-RPC (mig 179/180/286) blijft per (kw, kl) retourneren. Twee nieuwe velden:

- `bruto_maatwerkvraag_m2`: aggregeert intern over uitwisselbare familie (zelfde resolver als de `partners`-tak)
- `vrij_voor_nieuw_maatwerk_m2`: familie-voorraad + familie-Claims − bruto-maatwerkvraag

De UI toont sowieso al de primary-rij van de familie (voorraad ligt onder 1 alias). De aggregatie zorgt dat de cijfers fysiek kloppen ongeacht op welke partner-alias de Rollen-pagina filtert.

### 4. UI = puur inzicht, geen alarm

V1 stap 1:

- **Vrij-chip** per familie-rij (alleen het afgeleide cijfer; Bruto-maatwerkvraag bij expand)
- **Sorteer-dropdown** naast de zoekbalk (default: alfabetisch op kwaliteit — geen breaking change)
- **Géén drempel, géén kleurcodering, géén auto-trigger**

V2-backlog: drempel + alarm-kleuren, tijdslijn-projectie tegen IO-leverweek, aparte Inkoop-radar-pagina met bulk-IO-creatie.

## Alternatieven afgewogen

| Alternatief | Verworpen omdat |
|---|---|
| Packer-aware schatting (guillotine simuleren) | Te duur, en verschuift de packing-realiteit (die hoort in de 4-weeks-snijplanning, mig 280-286). Voor een bestelradar is pessimisme een feature. |
| Schrijven naar `order_reserveringen` als nieuwe `bron='maatwerk_projectie'` | Botst met [ADR-0015](0015-reservering-als-deep-module.md): Claims = fysieke toewijzing, niet planning-schaduw. Vermenging zou de `producten.gereserveerd`-cache, `vrije_voorraad`-formule en allocator semantisch corrumperen. |
| Per (kw, kl), niet per familie | Structureel valse alarmen: een bestelling op (VERR, 12) terwijl voorraad onder (LAGO, 12) ligt geeft (VERR, 12) "vol rood" en (LAGO, 12) "vol groen", terwijl de familie eigenlijk in evenwicht is. |
| IO meerekenen in de KPI | IO heeft een toekomst-leverweek die niet matched met bruto-vraag-afleverdatums in V1. Vermengen geeft "vandaag groen" terwijl het stuk eigenlijk pas in wk 18 binnenkomt. Inkoper moet die afweging zelf maken — IO blijft losse pill (analoog mig 149). |
| Tijdshorizon-filter (bv. 12 weken) | Willekeurige drempel. Karpi heeft typisch korte maatwerk-doorlooptijden; lange stukken zijn zeldzaam. Filter zou meer ruis verbergen dan signaal toevoegen. |
| Snij-marges meetellen | `stuk_snij_marge_cm()` is `+5/+6 cm`-correctie. Op de pessimistische `min(l,b) × rolbreedte`-basis (die al een ~50% overschatting per stuk geeft) is +5 cm overbodig. Dubbel pessimisme verbergt de werkelijke druk. |
| Volledige UI-shift naar familie-rij | Niet nodig: de Rollen-pagina toont in praktijk al de primary-alias-rij met partners als pills (zie LUXURY KLEUR 12 met SHDE 12 / VERR 12 als partner-chips). De RPC-aggregatie volstaat. |

## Gevolgen

### Positief

- Inkoper ziet in één oogopslag per familie hoeveel rol-m² écht vrij is voor nieuwe maatwerk-orders.
- Sortering op Vrij oplopend brengt families onder druk vanzelf bovenaan.
- Geen breaking change op `voorraadposities`-callers: bestaande velden ongewijzigd, twee velden bijkomend.
- Concept-scheiding [[Claim]] (toewijzing) vs. [[Bruto-maatwerkvraag]] (projectie) is expliciet — geen verwarring meer in vervolg-discussies.

### Risico's / mitigaties

- **Pessimisme kan tot 50% overschatting per stuk geven.** Acceptabel voor V1 (inzicht > precisie). Documenteer in woordenboek + ADR.
- **Aggregatie-overhead in RPC.** `voorraadposities` wordt al per page-render uitgevoerd; één extra CTE (snijplannen × kwaliteiten × uitwisselbare_paren) is acceptabel. Indexen op `snijplannen.status` en `snijplannen.order_regel_id` bestaan al.
- **Familie-aggregatie veronderstelt de "1 voorraad per familie"-invariant.** Bij edge cases (voorraad onder meerdere aliases tegelijk) wordt het Vrij-cijfer gerepliceerd op meerdere rijen. Acceptabel voor V1; als regressie blijkt, V2-shift naar UI-collapse (D1) als opvolg-ADR.

### Migratie

- Nieuwe migratie `296_voorraadposities_bruto_maatwerkvraag.sql`: drop & recreate `voorraadposities` met 2 extra return-velden.
- TS-type `Voorraadpositie` in `frontend/src/modules/voorraadpositie/types.ts` uitbreiden.
- `RollenGroepRow` krijgt een Vrij-chip; pagina krijgt sorteer-dropdown.
- Woordenboek-entries [[Bruto-maatwerkvraag]] + [[Vrij voor nieuw maatwerk]] al toegevoegd in dezelfde sessie als deze ADR.

## V2-backlog (niet in deze ADR)

1. Drempel + kleurcodering (config in `app_config.voorraad.vrij_drempel_m2`, eventueel per kwaliteit).
2. Tijdslijn-projectie: per week-bucket bruto-vraag uit afleverdatums × IO-binnenkomst.
3. Aparte Inkoop-radar-pagina met bulk-IO-suggesties.
4. Echte familie-UI-collapse (D1) als de "1 voorraad per familie"-invariant in praktijk wordt geschonden.
5. Maatwerk-Claim op IO-niveau (zit nu op de V1-backlog van [ADR-0015](0015-reservering-als-deep-module.md)).
6. **Claims-in-m² toevoegen aan Vrij-formule** (V1 trekt Claims niet af — zie §2). Vereist `producten`-join met conditionele unit-conversie (`eenheid='stuks'` → `aantal × stuk_m²`, `eenheid='m'` → `aantal × breedte`). Pas relevant zodra gemengde families (rol + vaste-maat in zelfde collectie+kleur) significante vaste-maat-druk hebben — momenteel zeldzaam in Karpi-data.
