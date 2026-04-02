# Spec: Data Import Pipeline

## Wat dit oplost

De brondata uit het oude systeem (Excel-bestanden) moet getransformeerd en geïmporteerd worden in Supabase. Dit is een herbruikbaar proces: bij go-live worden dezelfde stappen doorlopen met verse exports.

## Bronbestanden

### Voorraad (in `brondata/voorraad/`)
- `Karpi_Import.xlsx` — samengevoegd bestand met tabs: Producten, Rollen, Rollen Overzicht
- Oorspronkelijke exports: Vorratliste, Artikelen met EAN, arollen

### Debiteuren (in `brondata/debiteuren/`)
- `Karpi_Debiteuren_Import.xlsx` — tabs: Debiteuren, Afleveradressen, Klanteigen_namen, Klantartikelnummers, Prijslijsten
- `Karpi_Debiteuren_Rapportage.xlsx` — verwerkingsrapportage

### Logo's (in `brondata/logos/`)
- JPG-bestanden genaamd `{debiteur_nr}.jpg` (bijv. `100004.jpg`)
- Uploaden naar Supabase Storage bucket `logos`

## Import-volgorde (FK dependencies)

```
 1. vertegenwoordigers     (geen FK)
 2. collecties             (geen FK) — 56 groepen uit aliassen
 3. kwaliteiten            (FK → collecties) — ALLE 997 codes
 4. magazijn_locaties      (geen FK)
 5. prijslijst_headers     (geen FK)
 6. debiteuren             (FK → vertegenwoordigers, prijslijst_headers)
 7. afleveradressen        (FK → debiteuren, vertegenwoordigers)
 8. producten              (FK → kwaliteiten)
 9. rollen                 (FK → producten, kwaliteiten, magazijn_locaties)
10. prijslijst_regels      (FK → prijslijst_headers, producten)
11. klanteigen_namen       (FK → debiteuren, kwaliteiten)
12. klant_artikelnummers    (FK → debiteuren, producten)
13. orders                 (FK → debiteuren, vertegenwoordigers)
14. order_regels           (FK → orders, producten)
15. logo's                 (Supabase Storage upload)
```

## Bijzonderheden

### Kwaliteiten vullen (stap 3)
Drie bronnen samenbrengen:
- 991 codes uit producten (kwaliteit_code kolom)
- 170 codes uit aliassen-bestand (met collectie_id)
- 363 codes uit klanteigen namen
- Totaal: 997 uniek. 5 codes bestaan alleen in klanteigen namen (VENI, MOLN, HAR1, DOTS, ZENZ)

### Vertegenwoordiger mapping
- Debiteuren-export heeft **namen** ("Emily Dobbe")
- Orders-export heeft **codes** ("19")
- Import moet code ↔ naam koppelen (handmatig of via heuristiek)

### Debiteur_nr als key
- `debiteur_nr` (INTEGER) is de primary key overal
- Logo-bestanden heten `{debiteur_nr}.jpg`
- Alle bronbestanden verwijzen via dit nummer

## Acceptatiecriteria

1. Alle 14 data-imports slagen zonder FK violations
2. Import is **idempotent**: opnieuw draaien geeft hetzelfde resultaat (UPSERT)
3. Rapportage na import: per tabel hoeveel rijen ingevoegd/bijgewerkt
4. Logo's zijn geüpload naar Supabase Storage en benaderbaar via URL
5. Het script is herbruikbaar voor go-live (verse exports → opnieuw draaien)
6. Config-bestand met Supabase URL/key (niet hardcoded, `.env`)

## Edge cases

- ~4% van producten heeft geen EAN-match → `ean_code = NULL` (acceptabel)
- 5 kwaliteitscodes bestaan alleen in klanteigen namen → moeten toch in kwaliteiten-tabel
- Geblokkeerde debiteuren (Blokkade=J) krijgen status "Inactief" maar worden wel geïmporteerd
- Prijslijst_nr in debiteuren moet matchen met prijslijst_headers.nr

## Dependencies

- Spec 01 (mappenstructuur) — `import/` en `brondata/` directories
- Spec 03 (database) — alle tabellen moeten bestaan voor import
