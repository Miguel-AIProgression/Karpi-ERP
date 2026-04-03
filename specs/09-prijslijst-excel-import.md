# Spec: Prijslijst Excel Import (per klant)

## Wat dit oplost

Karpi heeft per klant een eigen prijslijst als Excel-bestand. Deze 45 bestanden (aangeleverd als ZIP) moeten geïmporteerd worden in de bestaande `prijslijst_headers` en `prijslijst_regels` tabellen, zodat elke klant de juiste productprijzen ziet in het ERP-portaal.

## Job to Be Done

> Als Karpi-medewerker wil ik de klantspecifieke prijslijsten (Excel) importeren in de database, zodat elke klant automatisch de juiste prijzen ziet op basis van zijn gekoppelde prijslijst_nr.

## Bronbestand

- **Locatie:** `wetransfer_prijslijst_2025-11-19_1107.zip`
- **Inhoud:** 45 Excel-bestanden (`.xlsx`), elk met patroon: `Prijslijst {nummer} {klantnaam}.xlsx`
- **Voorbeelden:**
  - `Prijslijst 191 Fame Flooring.xlsx`
  - `Prijslijst 153 benelux incl. bamboe en MV.xlsx`
  - `Prijslijst 206 Riviera (licentie) 670011.xlsx`

### Bestandsnaam → prijslijst_nr mapping

Het nummer in de bestandsnaam (bijv. `191`) correspondeert met `prijslijst_headers.nr` en `debiteuren.prijslijst_nr`. De database gebruikt zero-padded 4-character nummers:

| Bestandsnaam | Nummer in naam | prijslijst_nr in DB |
|---|---|---|
| Prijslijst 191 Fame Flooring.xlsx | 191 | `0191` |
| Prijslijst 153 benelux ... .xlsx | 153 | `0153` |

**Mapping-logica:** extraheer het nummer uit de bestandsnaam → zero-pad naar 4 tekens → match met `prijslijst_headers.nr`.

### Excel-structuur (identiek in alle 45 bestanden)

| Rij | Inhoud |
|-----|--------|
| 0 | Titelrij: `Prijslijst-overzicht`, `Bedrijf: A` |
| 1 | Metadata: prijslijst_nummer, klantnaam + datum |
| 2 | **Kolomkoppen** (altijd identiek) |
| 3+ | **Data** |

**Kolommen (rij 2):**

| Kolom | Naam | Type | Maps naar DB |
|-------|------|------|-------------|
| A | Artikelnr | int | `prijslijst_regels.artikelnr` (als TEXT) |
| B | Omschrijving | str | `prijslijst_regels.omschrijving` |
| C | Omschr.2 | str (nullable) | `prijslijst_regels.omschrijving_2` |
| D | Prijs | float/int | `prijslijst_regels.prijs` |
| E | Techn.omschrijving | str (nullable) | **Niet importeren** (geen kolom in DB) |
| F | Gewicht | str/int (nullable) | `prijslijst_regels.gewicht` (cast naar numeric) |

**Opmerking:** `ean_code` bestaat in de DB maar niet in de Excel → wordt `NULL` gelaten.

## Bestaande database-structuur

### prijslijst_headers
- `nr` TEXT PK — bijv. `"0191"`
- `naam` TEXT — bijv. `"FAME FLOORING PER 19.11.2025"`
- `geldig_vanaf` DATE
- `actief` BOOLEAN (default TRUE)

### prijslijst_regels
- `prijslijst_nr` TEXT FK → prijslijst_headers
- `artikelnr` TEXT FK → producten
- `ean_code` TEXT (nullable)
- `omschrijving` TEXT
- `omschrijving_2` TEXT (nullable)
- `prijs` NUMERIC(10,2)
- `gewicht` NUMERIC(8,2) (nullable)
- **UK:** `(prijslijst_nr, artikelnr)`

### debiteuren (relevante kolom)
- `prijslijst_nr` TEXT FK → prijslijst_headers — koppelt klant aan prijslijst

## Import-logica

### Stap 1: ZIP uitpakken
- Extract alle `.xlsx` bestanden uit de ZIP
- Filter `~$` lock-bestanden en `__MACOSX/` metadata

### Stap 2: Per bestand verwerken
Voor elk Excel-bestand:
1. **Nummer extraheren** uit bestandsnaam via regex: `Prijslijst (\d+)` → zero-pad naar 4 tekens
2. **Prijslijst header upserten** in `prijslijst_headers`:
   - `nr` = zero-padded nummer
   - `naam` = uit rij 1 van de Excel (metadata)
   - `geldig_vanaf` = datum uit metadata (parse `"PER DD.MM.YYYY"`) of `NULL`
   - `actief` = TRUE
3. **Data lezen** vanaf rij 3 (skip rij 0-2)
4. **Per rij** een `prijslijst_regels` record opbouwen:
   - `prijslijst_nr` = zero-padded nummer
   - `artikelnr` = kolom A als TEXT (int → str conversie)
   - `omschrijving` = kolom B
   - `omschrijving_2` = kolom C (nullable)
   - `prijs` = kolom D als float (default 0 als leeg)
   - `gewicht` = kolom F gecast naar float (nullable)
5. **Upsert** alle regels met conflict op `(prijslijst_nr, artikelnr)`

### Stap 3: Validatie
- Controleer of het geëxtraheerde prijslijst_nr voorkomt in `debiteuren.prijslijst_nr`
- Log waarschuwingen voor prijslijsten die aan GEEN enkele klant gekoppeld zijn
- Log waarschuwingen voor artikelnrs die niet bestaan in `producten`

### Stap 4: Rapportage
Per bestand loggen:
- Bestandsnaam → prijslijst_nr mapping
- Aantal regels geïmporteerd
- Aantal onbekende artikelnrs (niet in `producten`)
- Gekoppelde klant(en)

## Gedrag bij bestaande data

**Vervangen (upsert):** Bestaande regels met dezelfde `(prijslijst_nr, artikelnr)` combinatie worden overschreven met nieuwe prijzen. Regels die niet in de nieuwe Excel staan maar wél in de DB blijven staan (geen DELETE).

## Acceptatiecriteria

1. **Alle 45 bestanden worden verwerkt** zonder fouten
2. **Correcte mapping:** prijslijst_nr in de database matcht met het nummer in de bestandsnaam (zero-padded)
3. **Idempotent:** het script opnieuw draaien geeft hetzelfde resultaat
4. **Rapportage:** na afloop een overzicht met per bestand: prijslijst_nr, aantal regels, gekoppelde klant(en), waarschuwingen
5. **Geen data-verlies:** bestaande regels die niet in de Excel staan worden NIET verwijderd
6. **FK-integriteit:** alleen artikelnrs die bestaan in `producten` worden ingevoegd (of: warning + skip)
7. **Alle prijzen correct:** prijs en gewicht worden correct geconverteerd naar numerieke waarden

## Edge cases

- **Bestandsnaam-parsing:** Sommige namen bevatten extra info: `Prijslijst 206 Riviera (licentie) 670011.xlsx` — alleen het eerste getal na "Prijslijst" telt
- **Gewicht als string:** Kolom F bevat gewicht soms als string (`'1.25'`) → moet gecast worden naar float
- **Lege rijen:** Sommige bestanden hebben lege rijen aan het einde → overslaan
- **Hele getallen als prijs:** Prijs kan int of float zijn (bijv. `177` of `27.67`) → consistent opslaan als NUMERIC(10,2)
- **Artikelnr als int:** Excel slaat nummers op als int (bijv. `602110000`) → converteren naar TEXT string
- **Onbekende prijslijst:** Als een prijslijst_nr niet gekoppeld is aan een debiteur → waarschuwing (niet blokkeren)
- **Onbekende artikelnr:** Als een artikelnr niet bestaat in `producten` → meenemen met warning of overslaan (configureerbaar)
- **Dubbele nummers:** Twee bestanden kunnen hetzelfde nummer hebben (bijv. 206 en 207 voor Riviera met/zonder licentie) — elk is een aparte prijslijst

## Dependencies

- **Spec 03** (database schema) — `prijslijst_headers`, `prijslijst_regels`, `debiteuren` tabellen moeten bestaan
- **Spec 04** (data import) — het bestaande import-script importeert al prijslijstdata uit de master Excel; dit script vervangt/update die data met de individuele klantprijslijsten
- `producten` tabel moet gevuld zijn (voor FK-validatie van artikelnrs)
- `debiteuren` tabel moet gevuld zijn met `prijslijst_nr` (voor koppeling-validatie)

## Technische keuze

Implementeren als **Python-script** in `import/`, consistent met het bestaande import-framework (`supabase_import.py`). Hergebruik van bestaande patterns: `supabase-py` client, `openpyxl` voor Excel, `upsert_batch()` helper, `.env` config.
