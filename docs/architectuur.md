# Architectuur — RugFlow ERP

## Tech Stack

| Laag | Technologie | Versie |
|------|-------------|--------|
| Database | Supabase (PostgreSQL 15) | Hosted |
| Auth | Supabase Auth | — |
| Storage | Supabase Storage | — |
| Frontend | React | 18+ |
| Taal | TypeScript | 5+ |
| Build | Vite | 5+ |
| Styling | TailwindCSS + shadcn/ui | 3+ / latest |
| Data fetching | TanStack Query (React Query) | 5+ |
| Routing | React Router | 6+ |
| Import scripts | Python 3 | 3.10+ |

## Supabase Project

- **Project ID:** wqzeevfobwauxkalagtn
- **URL:** https://wqzeevfobwauxkalagtn.supabase.co
- **Region:** (klant-beheerd project)
- **Env vars:** `VITE_SUPABASE_URL` en `VITE_SUPABASE_ANON_KEY` in `.env`
- **Toegang:** Niet via CLI/MCP — migraties toepassen via Supabase SQL Editor

## Architectuurbeslissingen

### debiteur_nr als INTEGER PK (niet UUID)
Alle bronbestanden, logo-bestanden (`{debiteur_nr}.jpg`), klanteigen namen, orders, en afleveradressen verwijzen naar het debiteurnummer uit het oude systeem. UUID zou een onnodige mapping-laag toevoegen.

### artikelnr als TEXT PK (niet INTEGER)
Hoewel alle huidige artikelnummers numeriek zijn, is TEXT veiliger voor toekomstige codes.

### Adres-snapshots in orders
Orders slaan factuur- en afleveradressen op als kopie (snapshot), niet als FK naar afleveradressen. Dit voorkomt dat latere adreswijzigingen historische orders raken.

### Kwaliteitscode als centraal concept
De `kwaliteit_code` (3-4 letters uit de karpi_code) is de spil tussen producten, rollen, collecties en klanteigen namen. Het verbindt alles in het domein.

### Gedenormaliseerde zoeksleutel
`zoeksleutel` = kwaliteit_code + "_" + kleur_code staat zowel op producten als rollen. Dit is bewuste denormalisatie voor snelle zoekqueries.

### Nummering via database-functie
`volgend_nummer('ORD')` genereert doorlopende nummers (ORD-2026-0001). Dit garandeert uniciteit en voorkomt race conditions.

## Frontend Patterns

### Data fetching
- TanStack Query voor alle Supabase queries
- Per module een query-bestand in `lib/supabase/queries/`
- Queries retourneren typed data (gegenereerd uit Supabase schema)

### Component structuur
- Pagina's in `pages/` (route-level, per module een submap)
- Feature-componenten in `components/{module}/`
- Gedeelde UI in `components/ui/` (shadcn/ui)

### Routes
```
/                          Dashboard
/orders                    Orders overzicht
/orders/nieuw              Nieuwe order aanmaken
/orders/:id                Order detail
/orders/:id/bewerken       Order bewerken
/klanten                   Klanten overzicht
/klanten/:id               Klant detail
/producten                 Producten overzicht
/producten/:id             Product detail
/samples                   (placeholder)
/facturatie                (placeholder)
/vertegenwoordigers        (placeholder)
/rollen                    (placeholder)
/magazijn                  (placeholder)
/snijplanning              (placeholder)
/confectie                 (placeholder)
/scanstation               (placeholder)
/pick-ship                 (placeholder)
/logistiek                 (placeholder)
/inkoop                    (placeholder)
/leveranciers              (placeholder)
/instellingen              (placeholder)
```

## Security

### Fase 1 (V1)
- RLS enabled op alle tabellen
- Policy: authenticated users = volledige CRUD
- Simpele auth gate (Supabase session check)

### Fase 2 (later)
- Rollen: admin, verkoop, magazijn, management
- Per-rol policies (bijv. magazijn kan geen debiteuren bewerken)
