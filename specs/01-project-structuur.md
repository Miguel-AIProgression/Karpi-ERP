# Spec: Project Structuur & Organisatie

## Wat dit oplost

Alle bestanden staan nu plat in de root. Dit moet georganiseerd worden in een logische mappenstructuur zodat elke AI-agent of ontwikkelaar direct begrijpt waar alles staat.

## Gewenste mappenstructuur

```
Karpi ERP/
├── CLAUDE.md                          # Centrale referentie (max 100 regels)
├── docs/
│   ├── database-schema.md             # Supabase tabellen, kolommen, relaties
│   ├── architectuur.md                # Tech stack, beslissingen, patronen
│   ├── data-woordenboek.md            # Domeinbegrippen (debiteur, rol, kwaliteit, etc.)
│   └── changelog.md                   # Wat is wanneer gewijzigd
├── specs/                             # Requirement specs (deze bestanden)
│   ├── 01-project-structuur.md
│   ├── 02-documentatie-systeem.md
│   ├── ...
├── brondata/
│   ├── voorraad/                      # Excel exports voorraad + toelichting
│   │   └── toelichting.md
│   ├── debiteuren/                    # Excel exports debiteuren + toelichting
│   │   └── TOELICHTING_DEBITEUREN.md
│   └── logos/                         # Uitgepakte klantlogo's (uit zip)
├── mockups/                           # HTML design mockups (inspiratie)
│   ├── dashboard.html
│   ├── klanten.html
│   ├── orders.html
│   └── producten.html
├── import/                            # Python import scripts
│   ├── config.py
│   ├── supabase_import.py
│   └── requirements.txt
├── supabase/
│   └── migrations/                    # SQL migraties per task
│       ├── 001_basis.sql
│       ├── 002_referentiedata.sql
│       └── ...
└── frontend/                          # React/TypeScript applicatie
    ├── src/
    │   ├── app/                       # Pagina's (routing)
    │   ├── components/                # React componenten
    │   ├── lib/                       # Supabase client, queries, utils
    │   └── hooks/                     # React Query hooks
    ├── package.json
    └── ...
```

## Acceptatiecriteria

1. Alle bestaande bestanden zijn verplaatst naar de juiste map (niets verloren)
2. De root bevat alleen CLAUDE.md en mappen — geen losse bestanden
3. Het planbestand (`2026-04-01-rugflow-erp-database-en-frontend.md`) wordt verplaatst naar `docs/` als referentie
4. De zip met logo's wordt uitgepakt naar `brondata/logos/`
5. Elke map heeft een duidelijk doel dat afleidbaar is uit de naam
6. De structuur ondersteunt groei: nieuwe modules/features passen erin zonder herstructurering

## Edge cases

- De zip met logo's is 137MB — uitpakken kan even duren
- Excel-bestanden in `brondata/` zijn read-only referenties, niet om te bewerken
- `frontend/` directory wordt pas aangemaakt wanneer de React app geïnitialiseerd wordt

## Dependencies

- Geen — dit is de eerste stap
