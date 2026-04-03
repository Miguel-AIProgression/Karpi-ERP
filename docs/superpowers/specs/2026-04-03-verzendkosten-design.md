# Verzendkosten op orders

**Datum:** 2026-04-03
**Status:** Ontwerp goedgekeurd

## Doel

Verzendkosten automatisch toepassen op orders als orderregel. Regels:
- Orders < €500 excl. BTW → €20 verzendkosten
- Orders ≥ €500 excl. BTW → gratis verzending
- Per klant instelbaar: vinkje "altijd gratis verzending"
- Per order aanpasbaar: gebruiker kan verzendkosten-regel verwijderen of bedrag wijzigen

## Database wijzigingen

### 1. `debiteuren` tabel — nieuw veld

| Kolom | Type | Default | Beschrijving |
|---|---|---|---|
| `gratis_verzending` | BOOLEAN | `false` | Klant krijgt altijd gratis verzending |

### 2. `producten` tabel — nieuw speciaal product

| Veld | Waarde |
|---|---|
| `artikelnr` | `VERZEND` |
| `omschrijving` | `Verzendkosten` |
| `verkoopprijs` | `20.00` |
| `actief` | `true` |
| `kwaliteit_code` | `NULL` |
| `voorraad` | `999999` (voorkomt negatieve vrije_voorraad door reserveringstrigger) |

Dit product wordt als reguliere orderregel toegevoegd. Geen speciale tabelstructuur nodig.

### 3. Geen wijzigingen aan `orders` of `order_regels`

Verzendkosten zijn een gewone orderregel. De bestaande `update_order_totalen()` trigger telt ze automatisch mee in `totaal_bedrag`.

**Opmerking:** `aantal_regels` op de order telt de VERZEND-regel mee. Dit is acceptabel — het is een echte orderregel.

## Frontend logica

### Order form — automatische verzendkosten

1. Bij laden van order of selecteren van klant: haal `gratis_verzending` op van de debiteur
2. Bij elke wijziging in orderregels: bereken **subtotaal** (som van alle regels excl. de VERZEND-regel)
3. **Auto-toevoegen:** Als subtotaal < €500 én klant niet `gratis_verzending` → voeg VERZEND-regel toe als laatste regel (of update bestaande)
4. **Auto-verwijderen:** Als subtotaal ≥ €500 óf klant heeft `gratis_verzending` → verwijder VERZEND-regel automatisch
5. **Handmatige override:** Gebruiker kan de VERZEND-regel verwijderen of het bedrag aanpassen. Na een handmatige wijziging stopt de automatische logica voor die sessie (om ping-pong te voorkomen)
6. De VERZEND-regel is volledig bewerkbaar zoals elke andere orderregel

**Subtotaal vs. totaal:** Het subtotaal (excl. VERZEND) wordt gebruikt voor de drempellogica. Het weergegeven "Totaal" in de UI is het volledige totaal inclusief VERZEND-regel.

### Override-detectie

Een boolean `shippingOverridden` in de form state:
- Start als `false` bij nieuwe orders
- **Bij bewerken van bestaande orders:** start als `true` als er een VERZEND-regel bestaat (behoudt wat eerder was opgeslagen)
- Wordt `true` zodra de gebruiker de VERZEND-regel handmatig verwijdert of het bedrag wijzigt
- Zolang `true`: geen automatische toevoeg/verwijder-logica
- Reset bij wisselen van klant (alleen bij nieuwe orders; in edit-mode is klant niet wijzigbaar)

### Data-keten voor `gratis_verzending`

De volgende plekken moeten `gratis_verzending` meenemen:
1. `SelectedClient` interface in `client-selector.tsx` — nieuw veld `gratis_verzending: boolean`
2. `ClientSelector` query — `gratis_verzending` opnemen in `.select()`
3. `fetchClientCommercialData()` in `order-mutations.ts` — `gratis_verzending` meenemen voor edit-mode
4. `order-edit.tsx` — `gratis_verzending` doorgeven aan `SelectedClient` reconstructie

### ArticleSelector filter

Het VERZEND-product wordt uitgefilterd uit de zoekresultaten van de `ArticleSelector`. Verzendkosten worden alleen automatisch of via de VERZEND-regel zelf beheerd, niet handmatig toegevoegd via het artikelzoekveld.

### Validatie

Een order met alleen een VERZEND-regel (geen productregels) mag niet opgeslagen worden. De bestaande validatie `regels.length > 0` wordt aangescherpt naar: minstens 1 regel die geen VERZEND is.

### Klant-detail pagina

- Nieuw vinkje "Gratis verzending" op de klant-detail/bewerk pagina
- Toont huidige waarde, bewerkbaar door gebruiker

## Weergave

- VERZEND-regel wordt altijd als laatste regel getoond in de orderregels
- Visueel niet anders dan andere regels (gewone orderregel)
- Ordertotaal is inclusief verzendkosten (bestaande trigger)

## Constanten

| Constante | Waarde | Beschrijving |
|---|---|---|
| `SHIPPING_PRODUCT_ID` | `VERZEND` | Artikelnr van het verzendkostenproduct |
| `SHIPPING_THRESHOLD` | `500` | Drempelbedrag in euro (excl. BTW) |
| `SHIPPING_COST` | `20` | Standaard verzendkosten in euro |

Deze waarden zijn hardcoded in de frontend. Wijzigen vereist een code-aanpassing.

## Scope

### In scope
- Database migratie: `gratis_verzending` op debiteuren + VERZEND product
- Order form: automatische verzendkosten-logica met override
- ArticleSelector: VERZEND uitsluiten uit zoekresultaten
- Validatie: order moet minstens 1 niet-VERZEND regel bevatten
- Klant-detail: vinkje gratis verzending
- Data-keten: `gratis_verzending` door alle relevante queries/interfaces

### Buiten scope
- BTW-berekening (komt later)
- Meerdere verzendtarieven per regio/gewicht
- Instelbare drempels per klant (nu alleen aan/uit)
