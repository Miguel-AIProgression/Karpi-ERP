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

### Automatische snijplanning
Bij nieuwe orders wordt de snijplanning automatisch herberekend en goedgekeurd:
1. Order aangemaakt → `auto_maak_snijplan()` trigger maakt snijplan (status Wacht)
2. Frontend of edge function triggert `auto-plan-groep` als leverdatum binnen horizon
3. `auto-plan-groep`: lock → release Gepland stukken → FFDH heroptimalisatie → auto-approve
4. Rollen direct gereserveerd (status `in_snijplan`)
5. Snijder klikt "Start productie" → status `In productie` (niet meer herberekend)
6. Stukken buiten horizon of zonder beschikbare rollen blijven in Wacht (handmatige flow)

Gedeelde code in `supabase/functions/_shared/` (FFDH algoritme, DB helpers) wordt door beide edge functions geïmporteerd.

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
/snijplanning              Snijplanning overzicht per week, gegroepeerd per kwaliteit+kleur
/snijplanning/rol/:rolId   Snijvoorstel per rol (SVG strip-packing visualisatie)
/snijplanning/voorstel/:voorstelId  Review pagina voor gegenereerd snijvoorstel (optimalisatie)
/snijplanning/productie/:rolId  Productie-pagina per rol
/snijplanning/stickers     Bulk sticker print (query params: kwaliteit, kleur, rol, status)
/snijplanning/:id/stickers Sticker print weergave voor gesneden stukken
/confectie                 Confectie overzicht: scan-gestuurd afwerkingsstatus
/scanstation               Tablet-vriendelijk scaninterface voor barcode/QR inpak
/rollen                    Rolbeheer: gegroepeerd per kwaliteit/kleur met status badges
/magazijn                  Gereed product overzicht met locatiebeheer
/pick-ship                 (placeholder)
/logistiek                 (placeholder)
/inkoop                    (placeholder)
/leveranciers              (placeholder)
/instellingen              (placeholder)
/instellingen/productie    Planning instellingen: capaciteit, modus, reststuk verspilling
```

## Security

### Fase 1 (V1)
- RLS enabled op alle tabellen
- Policy: authenticated users = volledige CRUD
- Simpele auth gate (Supabase session check)

### Fase 2 (later)
- Rollen: admin, verkoop, magazijn, management
- Per-rol policies (bijv. magazijn kan geen debiteuren bewerken)

## Productie Patterns

### Scancode-gestuurd proces
Elk snijplan en confectie-order krijgt een unieke scancode (via `genereer_scancode()`). Barcode/QR-stickers worden geprint en gescand op elk werkstation. Scans worden gelogd in `scan_events` voor traceerbaarheid.

### Strip-packing snijvoorstel
Snijplannen worden gevisualiseerd als SVG op de rol (2D strip-packing). `positie_x`/`positie_y` kolommen bepalen de plaatsing. De `beste_rol_voor_snijplan()` functie selecteert de optimale rol (minste verspilling).

### Edge Function: optimaliseer-snijplan
Supabase Edge Function (`supabase/functions/optimaliseer-snijplan/index.ts`) die FFDH (First Fit Decreasing Height) 2D strip-packing uitvoert. Neemt kwaliteit_code + kleur_code als input, vindt alle wachtende snijplannen, pakt ze optimaal op beschikbare rollen (reststukken eerst), en slaat het voorstel op in `snijvoorstellen` + `snijvoorstel_plaatsingen`. Retourneert plaatsingen met coordinaten, afvalpercentages en samenvatting. Vereist SNIJV nummeringstype.

### Reststuk tracking
Na het snijden toont `voltooi_snijplan_rol()` een bevestigingsmodal waarin de gebruiker de restlengte kan aanpassen of kan kiezen om geen reststuk op te slaan. Na bevestiging wordt een reststuk-sticker geprint (rolnummer, kwaliteit, kleur, afmetingen, QR-code, locatieveld). Reststukken worden opgeslagen als nieuwe rol met status 'reststuk', gekoppeld via `oorsprong_rol_id`. Alle voorraadmutaties worden gelogd in `voorraad_mutaties`.

### Snijtijden
Wisseltijd per rol en snijtijd per karpet zijn configureerbaar via Productie Instellingen (`app_config`). Geschatte totaaltijd wordt getoond op snijvoorstel-review en productie-groep pagina's. Formule: `(rollen × wisseltijd) + (stukken × snijtijd)`.

### Productie modules
- **Snijplanning**: weekoverzicht, gegroepeerd per kwaliteit+kleur, SVG snijvoorstel, sticker print, reststuk-bevestigingsflow
- **Confectie**: scan-gestuurd overzicht van afwerkingsstatus per medewerker
- **Scanstation Inpak**: tablet-vriendelijk interface, barcode/QR scan voor status-updates
- **Magazijn**: gereed product met locatiebeheer
- **Rollen & Reststukken**: gegroepeerd rolbeheer met status badges en oorsprong-tracking
- **Planning Instellingen**: configuratie via `app_config` tabel (capaciteit, planmodus, max verspilling, snijtijden)

### Shared productie componenten
- `ScanInput`: herbruikbaar scan-invoer component (camera + handmatig)
- Productie types: gedeelde TypeScript types voor snijplannen, confectie, scan events
- Status kleuren: consistente kleurcodering per productie-status
- `frontend/src/lib/utils/snijplan-mapping.ts` — Gedeelde rotatie-inferentie + plan-reconstructie

### Op Maat Module
- Toggle "Standaard / Op maat" in order-line-editor
- Bij "Op maat": KwaliteitKleurSelector → VormAfmetingSelector → prijsberekening → toevoegen
- Prijsberekening: oppervlak_m² × verkoopprijs/m² + vormtoeslag + afwerkingprijs - korting%
- m²-prijs bron: `maatwerk_m2_prijzen` tabel (admin-instelbaar, geseeded vanuit rollen)
- Vorm-weergave: centraal `vorm-labels.ts` systeem (gebruikt door snijplanning, stickers, orders)
- Rol-producten in ArticleSelector redirecten automatisch naar op-maat flow
