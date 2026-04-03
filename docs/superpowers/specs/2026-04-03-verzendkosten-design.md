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
| `prijs` | `20.00` |

Dit product wordt als reguliere orderregel toegevoegd. Geen speciale tabelstructuur nodig.

### 3. Geen wijzigingen aan `orders` of `order_regels`

Verzendkosten zijn een gewone orderregel. De bestaande `update_order_totalen()` trigger telt ze automatisch mee in `totaal_bedrag`.

## Frontend logica

### Order form — automatische verzendkosten

1. Bij laden van order of selecteren van klant: haal `gratis_verzending` op van de debiteur
2. Bij elke wijziging in orderregels: bereken subtotaal (som van alle regels excl. de VERZEND-regel)
3. **Auto-toevoegen:** Als subtotaal < €500 én klant niet `gratis_verzending` → voeg VERZEND-regel toe als laatste regel (of update bestaande)
4. **Auto-verwijderen:** Als subtotaal ≥ €500 óf klant heeft `gratis_verzending` → verwijder VERZEND-regel automatisch
5. **Handmatige override:** Gebruiker kan de VERZEND-regel verwijderen of het bedrag aanpassen. Na een handmatige wijziging stopt de automatische logica voor die sessie (om ping-pong te voorkomen)
6. De VERZEND-regel is volledig bewerkbaar zoals elke andere orderregel

### Override-detectie

Een boolean `shippingOverridden` in de form state:
- Start als `false`
- Wordt `true` zodra de gebruiker de VERZEND-regel handmatig verwijdert of het bedrag wijzigt
- Zolang `true`: geen automatische toevoeg/verwijder-logica
- Reset bij wisselen van klant

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
- Database migratie: `gratis_verzending` op debiteuren
- Product record: `VERZEND` aanmaken
- Order form: automatische verzendkosten-logica
- Klant-detail: vinkje gratis verzending
- RPC's bijwerken indien nodig (VERZEND-regel gaat als gewone orderregel mee)

### Buiten scope
- BTW-berekening (komt later)
- Meerdere verzendtarieven per regio/gewicht
- Instelbare drempels per klant (nu alleen aan/uit)
