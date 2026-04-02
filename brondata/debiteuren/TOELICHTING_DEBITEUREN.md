# Toelichting Debiteuren Import

## Doel
Dit script (`debiteuren_import.py`) schoont de debiteuren-exports uit het huidige systeem op, voegt ze samen, en produceert een importklaar Excel-bestand voor het nieuwe ERP systeem.

**Belangrijk:** Dit script is ontworpen om herhaald te draaien. Bij go-live:
1. Alle huidige data uit het ERP verwijderen
2. Nieuwe exports uit het oude systeem in deze map plaatsen
3. Script opnieuw draaien
4. Resultaat importeren in het ERP

Dezelfde opschoon- en samenvoegregels worden dan automatisch opnieuw toegepast.

---

## Bronbestanden

| Bestand | Inhoud | Sleutel |
|---------|--------|---------|
| `Debiteurenlijst per [datum].xlsx` | Alle adressen (hoofd + aflever) per debiteur | Debnr + Adresnr |
| `debadres_alles-[n].xlsx` | Factuurgegevens, prijslijst, conditie, korting, EAN, vertegenwoordiger | Debiteur (1 rij per debiteur) |
| `Overzicht klanteigen namen per [datum].xls` | Eigen artikelnamen per klant | Klant/Inkoopcomb. |
| `Klantartikelnummers.xls` | Eigen artikelnummers die klanten op pakbonnen/facturen willen | Debiteur + Artikel |
| `prijslijst[nr].xlsx` | Artikelprijzen per prijslijst | Artikelnr |

---

## Verwerkingsstappen

### Stap 0: Bestanden zoeken
- Zoekt automatisch de nieuwste versie van elk bestand op basis van bestandsnaam-patroon
- Als er meerdere versies zijn, wordt de meest recente gebruikt (op basis van bestandsdatum)

### Stap 1: Inlezen
- Elk bestand wordt ingelezen met de juiste header-rij
- Datatypes worden genormaliseerd (nummers als nummers, tekst als tekst)
- EAN-codes worden als tekst opgeslagen (geen floating point afronding)
- **GLN-codes afleveradressen** worden uit kolom "Naam 2" van de Debiteurenlijst geextraheerd naar een aparte kolom `GLN_afleveradres` (zie hieronder)

### Stap 2: Opschonen

**Postcodes:**
- Nederlandse postcodes worden genormaliseerd naar formaat `1234AB` (zonder spatie)
- Buitenlandse postcodes worden ongewijzigd gelaten

**Telefoonnummers:**
- Dubbele spaties verwijderd
- Verder ongewijzigd (landcodes en formaat blijven behouden)

**Namen:**
- Naar uppercase genormaliseerd
- Dubbele spaties verwijderd

**GLN-codes afleveradressen (kolom "Naam 2"):**
- Kolom "Naam 2" in de Debiteurenlijst bevat normaal een toevoeging bij de bedrijfsnaam (bijv. "(NR. 1025)" of "RETOUREN")
- Bij sommige afleveradressen staat hier echter een **GLN-nummer (afleveradres)** (10-14 cijfers), afkomstig uit elektronische bestelkoppelingen
- Het script herkent deze automatisch (regex: `^\d{10,14}$`) en verplaatst ze naar een aparte kolom `GLN_afleveradres`
- De originele "Naam 2" waarde wordt dan leeggemaakt zodat het veld alleen nog bedrijfsnaam-toevoegingen bevat
- Deze GLN-codes afleveradressen zijn belangrijk voor het leveradres bij elektronische bestellingen

**Opmerkingen:**
- Er worden in deze stap GEEN rijen verwijderd, alleen genormaliseerd
- Rijen zonder enig adresgegevens (geen straat, postcode, of plaats) worden gemarkeerd

### Stap 3: Ontdubbelen adressen

**Regel:** Per debiteur worden adressen die exact dezelfde combinatie van `Adres + Postcode + Plaats` hebben samengevoegd. Van duplicaten wordt de laagste `Adresnr` behouden.

**Voorbeeld:** Als debiteur 100004 twee keer "CAVALERIEWEG 35, 3902JR, VEENENDAAL" heeft (adresnr 0 en adresnr 3), dan wordt adresnr 3 verwijderd.

**Adresnr 0 (hoofdadres) wordt altijd behouden.**

**Rapportage:** Alle verwijderde duplicaten worden gelogd in het rapportagebestand (tab `Verwijderde_duplicaten`) zodat exact zichtbaar is wat er verwijderd is.

### Stap 4: Samenvoegen tot Master

**Basis:** `debadres_alles` (1 rij per debiteur) - bevat alle commerciele data:
- Factuuradres
- Prijslijst, korting, betaalconditie
- Vertegenwoordiger
- BTW-nummer
- EAN/GLN-code
- Blokkade-status

**Verrijkt met** extra velden uit de Debiteurenlijst (hoofdadres = adresnr 0):
- E-mailadres
- Mail-2
- Faxnummer
- Route

**Primary key:** Het debiteurnummer is de unieke sleutel. Dit nummer komt overal in terug: bronbestanden, afleveradressen, klanteigen namen, en ook als bestandsnaam van de logo's (bijv. `KlantLogo/100004.jpg`). In Supabase wordt dit `debiteur_nr INTEGER PRIMARY KEY`.

**Status:** Geblokkeerde debiteuren (Blokkade=J) krijgen status "Inactief", actieve (Blokkade=N) krijgen "Actief". Beide worden meegenomen in de output.

### Stap 5: Koppelen klanteigen namen

- Klanteigen namen worden gekoppeld aan debiteurnummers
- De debiteurnaam wordt toegevoegd voor leesbaarheid
- In het Excel-bestand wordt via een INDEX/MATCH-formule gecontroleerd of de klant nog actief is

### Stap 6: Opslaan

---

## Output bestanden

### `Karpi_Debiteuren_Import.xlsx`

| Tabblad | Inhoud | Sleutel | Verwijzingen |
|---------|--------|---------|-------------|
| **Debiteuren** | Master: 1 rij per debiteur met status, adressen, commerciele data | Debiteur (nummer) | - |
| **Afleveradressen** | Alle unieke afleveradressen per debiteur | Debnr + Adresnr | VLOOKUP naar Debiteuren (Naam) |
| **Klanteigen_namen** | Eigen artikelnamen per klant | Klant/Inkoopcomb. | VLOOKUP naar Debiteuren (Status) |
| **Klantartikelnummers** | Eigen artikelnummers per klant voor pakbonnen/facturen | Debiteur + Artikel | VLOOKUP naar Debiteuren (Status) |
| **Prijslijsten** | Artikelprijzen | Artikelnr | - |

**Verwijzingen:** Elk tabblad dat refereert aan debiteuren bevat VLOOKUP-formules die de naam en/of status opzoeken uit het Debiteuren-tabblad. Als een debiteur gewijzigd wordt in het Debiteuren-tabblad, worden deze verwijzingen automatisch bijgewerkt.

### `Karpi_Debiteuren_Rapportage.xlsx`

| Tabblad | Inhoud |
|---------|--------|
| **Verwerkingsstappen** | Overzicht van elke stap: wat gedaan, hoeveel rijen voor/na, hoeveel verwijderd |
| **Verwijderde_duplicaten** | Exacte lijst van verwijderde dubbele adressen |

---

## Kolommen per tabblad

### Debiteuren (master)
| Kolom | Bron | Toelichting |
|-------|------|-------------|
| Debiteur | debadres_alles | Debiteurnummer — primary key, ook bestandsnaam van logo's (bijv. `100004.jpg`) |
| Naam | debadres_alles | Bedrijfsnaam (genormaliseerd: uppercase) |
| Status | Afgeleid van Blokkade | "Actief" of "Inactief" |
| Standaard-adres | debadres_alles | Straat hoofdadres |
| Postcd | debadres_alles | Postcode (genormaliseerd) |
| Plaats | debadres_alles | Plaatsnaam |
| Land | debadres_alles | Landnaam |
| Tel. | debadres_alles | Telefoonnummer |
| Naam (fact.adres) | debadres_alles | Naam op factuur |
| Adres (fact) | debadres_alles | Factuuradres |
| Postc. | debadres_alles | Postcode factuuradres |
| Plaats (fact) | debadres_alles | Plaats factuuradres |
| Mailadres (Fact.) | debadres_alles | E-mail voor facturen |
| Mailadres (overig) | debadres_alles | Overig e-mailadres |
| Mail-2 | Debiteurenlijst | Tweede e-mailadres |
| Fax | Debiteurenlijst | Faxnummer |
| Inkooporg. | debadres_alles | Inkooporganisatie |
| Betaler | debadres_alles | Betalende partij |
| Vertegenwoordiger | debadres_alles | Verkoper/agent |
| Route | Debiteurenlijst | Routecode |
| Rayon | debadres_alles | Rayoncode |
| Rayonnaam | debadres_alles | Rayonnaam |
| Prijslijst | debadres_alles | Gekoppelde prijslijst |
| % Deb.kort | debadres_alles | Debiteurenkorting (percentage) |
| Conditie | debadres_alles | Betaalconditie |
| BTW-nummer | debadres_alles | BTW-identificatienummer |
| GLN_bedrijf | debadres_alles | GLN-nummer van het moederbedrijf (Global Location Number) |

### Afleveradressen
| Kolom | Toelichting |
|-------|-------------|
| Debnr | Debiteurnummer (koppeling met Debiteuren tab) |
| Adresnr | Adresvolgnummer (0 = hoofdadres) |
| Naam | Naam bij dit adres |
| Naam 2 | Toevoeging bij naam (bijv. "(NR. 1025)"), leeg als het een EDI-code was |
| GLN_afleveradres | GLN-nummer (afleveradres) voor elektronische bestellingen (uit originele "Naam 2" kolom, alleen als 10-14 cijfers) |
| Adres | Straatnaam + nummer |
| Postcd | Postcode |
| Plaats | Plaatsnaam |
| Land | Land |
| Telef. | Telefoonnummer bij dit adres |
| Mailadres | E-mail bij dit adres |
| Mail-2 | Tweede e-mail |
| Route | Routecode |
| Vertegenw | Vertegenwoordiger |
| Debiteur_naam_check | *Formule:* Naam opgezoekt uit Debiteuren tab als controle |

---

## EAN-codes uitleg

De EAN-codes in `debadres_alles` (kolom Y) zijn **GLN-nummers** (Global Location Numbers). Dit zijn unieke identificatiecodes voor bedrijfslocaties, niet voor producten. Voorbeeld: alle SB Mobel Boss filialen delen hetzelfde GLN-nummer van het moederbedrijf.

De Debiteurenlijst bevat GEEN EAN-codes. Wat op EAN-codes lijkt in de kolom "Fax" zijn Duitse telefoonnummers (bijv. `4987099292181` = +49 8709 929 2181).

**Er zijn 182 debiteuren met een EAN/GLN-code, en 180 unieke codes.**

---

## Koppeling met Supabase en logo's

Het **debiteurnummer** is de primary key in alle tabellen. Logo's in de zip heten `KlantLogo/{debiteurnummer}.jpg` (bijv. `100004.jpg`), waardoor ze direct te koppelen zijn aan de debiteur.

**In Supabase:**
- `debiteur_nr INTEGER PRIMARY KEY` in de `debiteuren` tabel
- Foreign key in `afleveradressen`, `klanteigen_namen`, etc.
- Logo's opslaan in Supabase Storage als `{debiteur_nr}.jpg`

---

## Herhaalbaarheid

Dit script is ontworpen voor herhaald gebruik:

1. **Input:** Plaats nieuwe exports in de `Debiteuren` map
2. **Run:** `python debiteuren_import.py`
3. **Output:** Altijd dezelfde structuur, zelfde opschoonregels
4. **Controle:** Rapportagebestand toont exact wat er gedaan is

De opschoonregels zijn deterministisch - dezelfde input geeft altijd dezelfde output.
