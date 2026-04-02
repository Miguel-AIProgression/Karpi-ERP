# Toelichting: Voorraadbestanden samenvoegen

## Doel

Drie exportbestanden uit het oude systeem samenvoegen tot een importklaar bestand voor het nieuwe ERP. Dit proces is herbruikbaar: bij go-live worden dezelfde stappen doorlopen met verse exports.

---

## Benodigde bestanden

Plaats de volgende drie bestanden in de map `Voorraad`:

| Bestand | Formaat | Inhoud |
|---|---|---|
| `Vorratliste *.xls` | .xls | Alle artikelen met voorraadgegevens |
| `Artikelen met EAN.xlsx` | .xlsx | EAN-codes en vervolgomschrijvingen per artikel |
| `arollen*.xlsx` | .xlsx | Individuele rollen (maatwerk-voorraad) |

**Let op:** de bestandsnamen mogen variëren (bijv. andere datum), het script zoekt op het patroon. Bij meerdere bestanden van hetzelfde type wordt het nieuwste gebruikt.

---

## Script draaien

Open een terminal in de map `Voorraad` en draai:

```
python karpi_import.py
```

**Vereisten:** Python 3 met de packages `pandas`, `openpyxl` en `xlrd`. Installeer eventueel met:

```
pip install pandas openpyxl xlrd
```

---

## Wat het script doet

### Stap 1: Vorratliste laden

Uit de Vorratliste worden de volgende kolommen overgenomen:

- Artikelnr (sleutel voor koppeling)
- Karpi-code
- Omschrijving
- Voorraad
- Backorder
- Gereserveerd
- Besteld (ink)
- Vrije voorraad

### Stap 2: Artikelen met EAN laden en opschonen

Uit het EAN-bestand worden overgenomen:

- EAN-code
- Vervolgomschrijving

**Opschoning die het script uitvoert:**

- Het EAN-bestand bevat dubbele entries per artikel (o.a. "VEN."-regels die geen geldige EAN zijn). Deze worden eruit gefilterd: alleen numerieke codes van 8-13 cijfers worden behouden.
- Per artikelnummer wordt 1 EAN-code bewaard (de eerste geldige).

### Stap 3: Samenvoegen producten

De Vorratliste (leidend) wordt gekoppeld aan het EAN-bestand op basis van **Artikelnr**. Het resultaat bevat alle artikelen uit de Vorratliste, aangevuld met EAN-code en vervolgomschrijving waar beschikbaar.

Daarnaast wordt per artikel een **zoeksleutel** aangemaakt op basis van de Karpi-code:
- Eerste 3-4 letters = kwaliteitscode
- Eerste 2 cijfers = kleurcode
- Voorbeeld: `CISC21XX160230` wordt zoeksleutel `CISC_21`

### Stap 4: Rollen laden

Uit het rollenbestand worden overgenomen:

- Artikelnr
- Karpi-code
- Omschrijving
- VVP m2
- Rolnummer (uniek per rol)
- Lengte en breedte (omgerekend naar cm)
- Oppervlak
- Waarde

**Elke rol is een aparte regel.** Dus 2x Cisco 21 1500x400 cm = 2 losse regels, elk met eigen rolnummer.

Rollen krijgen dezelfde zoeksleutel als producten, zodat ze bij het zoeken op bijv. "Cisco 21" samen verschijnen.

---

## Output: Karpi_Import.xlsx

Het script genereert een Excel-bestand met drie tabbladen:

### Tab 1: Producten

Alle artikelen uit de Vorratliste, verrijkt met EAN en vervolgomschrijving.

| Kolom | Bron |
|---|---|
| Artikelnr | Vorratliste |
| Karpi-code | Vorratliste |
| EAN-code | Artikelen met EAN |
| Omschrijving | Vorratliste |
| Vervolgoms. | Artikelen met EAN |
| Voorraad | Vorratliste |
| Backorder | Vorratliste |
| Gereserveerd | Vorratliste |
| Besteld (ink) | Vorratliste |
| Vrije voorraad | Vorratliste |
| Kwaliteit_code | Afgeleid uit Karpi-code |
| Kleur_code | Afgeleid uit Karpi-code |
| Zoeksleutel | Kwaliteit_code + "_" + Kleur_code |

### Tab 2: Rollen

Elke individuele rol als aparte regel.

| Kolom | Bron |
|---|---|
| Artikelnr | arollen |
| Karpi-code | arollen |
| Omschrijving | arollen |
| VVP_m2 | arollen |
| Rolnummer | arollen (uniek per rol) |
| Lengte_cm | arollen (omgerekend) |
| Breedte_cm | arollen (omgerekend) |
| Afmeting | Samengesteld (bijv. "1500x400 cm") |
| Oppervlak | arollen |
| Waarde | arollen |
| Kwaliteit_code | Afgeleid uit Karpi-code |
| Kleur_code | Afgeleid uit Karpi-code |
| Zoeksleutel | Kwaliteit_code + "_" + Kleur_code |

### Tab 3: Rollen Overzicht

Samenvatting per kwaliteit/kleur combinatie. Dit tabblad gebruikt **live Excel-formules** (COUNTIF/SUMIF) die verwijzen naar het Rollen tabblad. Wanneer je in het Rollen tabblad een rol verwijdert of een waarde aanpast, worden de totalen in dit overzicht automatisch bijgewerkt.

| Kolom | Type |
|---|---|
| Kwaliteit_code | Waarde |
| Kleur_code | Waarde |
| Omschrijving | Waarde |
| Aantal_rollen | Formule: COUNTIF op Rollen |
| Totaal_oppervlak | Formule: SUMIF op Rollen |
| Totaal_waarde | Formule: SUMIF op Rollen |
| Zoeksleutel | Formule: Kwaliteit & "_" & Kleur |

---

## Workflow

### Eerste keer (ERP opbouwen)

1. Plaats de drie bronbestanden in de map `Voorraad`
2. Draai `python karpi_import.py`
3. Importeer `Karpi_Import.xlsx` in het ERP
4. Bouw het ERP verder op en test

### Go-live (actuele data)

1. Draai opnieuw de drie exports uit het oude systeem
2. Plaats ze in de map `Voorraad` (oude bestanden mogen blijven staan of overschreven worden; het script pakt het nieuwste)
3. Draai `python karpi_import.py`
4. Verwerk de nieuwe `Karpi_Import.xlsx` in het ERP (via mutatie-import: alleen wijzigingen, toevoegingen en verwijderingen doorvoeren)

---

## Aandachtspunten

- **Bestandsnamen:** het script zoekt op patroon (`Vorratliste*.xls`, `Artikelen met EAN.xlsx`, `arollen*.xlsx`). De EAN-bestandsnaam moet exact kloppen; de andere twee mogen variëren.
- **Meerdere bestanden:** als er meerdere Vorratliste- of arollen-bestanden staan, wordt het nieuwste (op basis van bestandsdatum) gebruikt.
- **EAN opschoning:** ~7.200 dubbele/ongeldige EAN-entries worden automatisch gefilterd. ~4% van de artikelen heeft geen EAN-match.
- **Rollen overzicht:** de formules in dit tabblad werken alleen in Excel (of Google Sheets), niet als je het bestand met Python/pandas inleest.
