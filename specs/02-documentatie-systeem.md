# Spec: Documentatie Systeem

## Wat dit oplost

Een AI-agent die dit project oppakt moet binnen secondes begrijpen: wat is dit project, waar staat alles, hoe is de database opgebouwd, en wat is de huidige status. Documentatie is de bron van waarheid — niet de code, niet git history.

## Componenten

### 1. CLAUDE.md (max 100 regels)

Het **startpunt** voor elke AI-sessie. Bevat:

- Eénregelige projectomschrijving
- Tech stack samenvatting
- Verwijzingen naar alle levende documenten (met pad)
- Huidige status / waar we zijn in de bouw
- Belangrijkste conventies en regels
- Instructie: "werk deze docs bij na elke wijziging"

**Niet in CLAUDE.md:** gedetailleerde schemas, lange uitleg, implementatiedetails — die staan in de verwezen documenten.

### 2. docs/database-schema.md

Leesbare beschrijving van alle Supabase tabellen:

- Per tabel: doel, kolommen met types en toelichting, primary/foreign keys
- Relaties tussen tabellen (in tekst en als ASCII-diagram)
- Enums en hun waarden
- Views en hun doel
- Import-volgorde (FK dependencies)

Dit is GEEN SQL dump — het is een document dat je leest om de database te begrijpen.

### 3. docs/architectuur.md

- Tech stack met versies
- Supabase project referentie (project ID, URL)
- Authenticatie aanpak (RLS, rollen)
- Frontend patterns (React Query, component structuur)
- Beslissingen die genomen zijn en waarom (bijv. "debiteur_nr als INTEGER PK, niet UUID")

### 4. docs/data-woordenboek.md

Domeinbegrippen die een buitenstaander niet kent:

- Debiteur = klant/afnemer
- Kwaliteit = tapijtsoort (3-4 letter code, bijv. CISC = Cisco)
- Collectie = groep uitwisselbare kwaliteiten
- Zoeksleutel = kwaliteit_code + "_" + kleur_code
- Rol = individuele fysieke tapijtrol met uniek rolnummer
- Karpi-code = artikelcode die kwaliteit + kleur + afmetingen encodeert
- GLN = Global Location Number (bedrijfslocatie-ID, niet product-EAN)
- Vertegenwoordiger = sales rep (code in orders, naam in debiteuren)

### 5. docs/changelog.md

Chronologisch logboek van significante wijzigingen:

```
## 2026-04-02
- Project opgezet: mappenstructuur, CLAUDE.md, specs
- Database migraties 001-010 toegepast
```

Niet elke commit — alleen mijlpalen en beslissingen.

## Acceptatiecriteria

1. CLAUDE.md bestaat, is max 100 regels, en bevat werkende verwijzingen naar alle docs
2. Elke verwezen doc bestaat en is ingevuld met actuele informatie
3. database-schema.md beschrijft alle tabellen, kolommen, relaties en is leesbaar zonder SQL-kennis
4. Een AI-agent die alleen CLAUDE.md leest, kan doorverwijzen naar het juiste detail-document voor elke vraag
5. Na elke wijziging aan database/frontend worden de relevante docs bijgewerkt (dit is een doorlopend criterium)

## Bijwerk-regels (wanneer welk document updaten)

| Wijziging | Te updaten docs |
|-----------|----------------|
| Nieuwe tabel/kolom in Supabase | database-schema.md |
| Nieuwe relatie/FK | database-schema.md, architectuur.md (als nieuw patroon) |
| Nieuw domeinbegrip | data-woordenboek.md |
| Nieuwe frontend pagina/module | architectuur.md (routes), CLAUDE.md (als nieuw domeingebied) |
| Mappenstructuur wijziging | CLAUDE.md (als het de structuur-sectie raakt) |
| Elke significante wijziging | changelog.md (datum + wat + waarom) |

**Regel:** CLAUDE.md verwijst alleen, bevat geen detail. Als een verwijzing verouderd raakt, is het de taak van de volgende sessie om het te corrigeren.

## Edge cases

- Bij het toevoegen van een nieuwe tabel: database-schema.md, architectuur.md (als er een nieuwe relatie is), en CLAUDE.md (als er een nieuw domeingebied bijkomt) moeten bijgewerkt worden
- changelog.md groeit onbeperkt — dat is prima, het wordt niet in CLAUDE.md inline opgenomen

## Dependencies

- Spec 01 (project structuur) — docs/ map moet bestaan
