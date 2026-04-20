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
/confectie                 Confectielijst (stukken te confectioneren) — leest confectie_planning_forward view
/confectie/planning        Meerweekse planning per lane (breedband/smalband/feston/...) met horizon 1/2/4/8 wk
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

### Real-time levertijd-check (order-aanmaak)
Edge function `check-levertijd` (`supabase/functions/check-levertijd/`) berekent tijdens order-entry een concrete leverdatum voor maatwerk-regels. Drie pure helper-modules in `supabase/functions/_shared/levertijd-*.ts`:
- **levertijd-match.ts**: zoekt rol in pipeline (status `Gepland`/`Wacht`) waar het nieuwe stuk nog op past via `tryPlacePiece` (FFDH); kiest vroegste snij-datum, exact match wint van uitwisselbaar bij gelijke datum.
- **levertijd-capacity.ts**: bepaalt snij-week (lever-week − 1), itereert tot ruimte beschikbaar (max 6 weken), vergelijkt bezetting (stuks + minuten) met `capaciteit_per_week × (1 − marge_pct/100)`. Backlog-check via RPC `backlog_per_kwaliteit_kleur`.
- **levertijd-resolver.ts**: combineert tot scenario (`match_bestaande_rol` | `nieuwe_rol_gepland` | `wacht_op_orders` | `spoed`) + NL onderbouwing (max 240 chars). **ASAP-by-default:** `wacht_op_orders` triggert alléén bij `geen_rol_passend` (geen voorraadrol breed/lang genoeg → inkoop nodig). De backlog-drempel `backlog_minimum_m2` is informatief en blokkeert niet — dat zorgt ervoor dat klanten standaard de vroegst mogelijke leverdatum krijgen.

Frontend: `useLevertijdCheck` hook (TanStack Query, 350 ms debounce, 60 s staleTime) + `<LevertijdSuggestie>` component met scenario-badge, datum, onderbouwing en "Neem datum over"-knop. Geïntegreerd in `order-form.tsx` voor de laatste maatwerk-regel met complete (kwaliteit, kleur, lengte, breedte). Bij edge-function fout valt de UI terug op `berekenAfleverdatum()`.

Configuratie in `app_config.productie_planning`: `logistieke_buffer_dagen` (default 2), `backlog_minimum_m2` (default 12). Performance-doel: < 1.5 s p95.

**Spoed-tak**: `evalueerSpoed()` (`_shared/spoed-check.ts`) checkt per ISO-week (deze + volgende) of er na de bestaande backlog nog ≥ benodigde-snijduur + `spoed_buffer_uren × 60` werkminuten beschikbaar zijn (over `werkdagen × 510` werkminuten/dag, gemeten met `werkminutenTussen`). Bij beschikbaar wordt de **laatste werkdag van de gekozen week** als snij-datum belofte gegeven (spoed krijgt voorrang in de planning), met `lever_datum = snij_datum + logistieke_buffer_dagen`. De UI-toggle in `<LevertijdSuggestie>` voegt automatisch een SPOEDTOESLAG-orderregel toe (zelfde patroon als VERZEND) en overschrijft de header-leverdatum. Spoed-config-velden in `app_config.productie_planning`: `spoed_buffer_uren`, `spoed_toeslag_bedrag`, `spoed_product_id`.

### Webshop-integratie (Lightspeed eCom)
Edge function `sync-webshop-order` (`supabase/functions/sync-webshop-order/index.ts`) ontvangt webhooks van de twee Floorpassion Lightspeed-shops (NL + DE, EU1-cluster `api.webshopapp.com`). Flow:

1. Lightspeed stuurt `orders/paid` webhook naar `/sync-webshop-order?shop=nl|de` (auth via MD5-signature in `x-signature` header, secret per shop uit env)
2. Edge function verifieert signature (constante tijd), fetcht de volledige order + regels via de Lightspeed REST API
3. **Idempotentie-check gaat vóór Lightspeed-fetch**: als `(bron_systeem, bron_order_id)` al bestaat retourneert de function meteen `was_existing=true` zonder REST-calls (voorkomt rate-limit hits bij Lightspeed's tot 10× retry-mechanisme)
4. Elke orderregel wordt gematched via de slimme matcher: (a) `articleCode`/`sku` → `producten.karpi_code` (Floorpassion stuurt karpi-codes zoals `GALA14XX140200`), (b) `artikelnr` fallback, (c) `ean_code`, (d) **parsed karpi**: `kwaliteit + kleur + afmeting` geëxtraheerd uit productTitle+variantTitle → kandidaat-karpi-codes, (e) `omschrijving` ilike (uniek). Speciale categorieën: `VERZEND` (verzendkosten), `[STAAL]` (Gratis Muster), `[MAATWERK]` (Wunschgröße/Op maat/Volgens tekening), `[MAATWERK-ROND]` (Durchmesser/rond)
5. RPC `create_webshop_order` (migraties 092/093/094) doet atomic insert in `orders` + `order_regels` onder debiteur **260000 "FLOORPASSION"** (bestaande rij uit het oude systeem; de synthetische 99001 uit migratie 091 wordt in productie niet gebruikt). Zet `orders.heeft_unmatched_regels = TRUE` als ≥1 regel NULL artikelnr heeft — orderlijst kan daarmee "Actie vereist" filter tonen. Trigger op `order_regels` houdt de vlag live synchroon bij handmatige mutaties
6. Particuliere eindkoper komt alléén in de leveradres-snapshot (`afl_*` velden), consistent met bestaande snapshot-architectuur

Credentials per shop in `supabase/functions/.env` (gitignored): `LIGHTSPEED_{NL,DE}_API_{KEY,SECRET}`, `LIGHTSPEED_{NL,DE}_CLUSTER_URL`, `FLOORPASSION_DEBITEUR_NR`. Deploy edge function met `--no-verify-jwt` (webhooks hebben geen Supabase JWT). Webhook-registratie via `scripts/register-lightspeed-webhooks.mjs`. Unmatched producten krijgen `[UNMATCHED]`-prefix in `omschrijving` + NULL `artikelnr` — order wordt niet geblokkeerd maar gemarkeerd voor handmatige review. Fase 2 (voorraad-sync, levertijden terug naar webshop) is nog niet in scope.

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

## Confectie workflow

- **Bron-of-truth:** tabel `snijplannen`. Alle lijst/planning-views lezen hiervan (niet van legacy `confectie_orders`).
- **Lane-mapping:** `order_regels.maatwerk_afwerking` (B/FE/LO/SB/SF/VO/ON/ZO) → `afwerking_types.type_bewerking` → `confectie_werktijden.type_bewerking` (breedband/smalband/feston/smalfeston/locken/volume afwerking). ON/ZO hebben geen lane (alleen stickeren).
- **Forward-view:** `confectie_planning_forward` levert alle open maatwerk-snijplannen (status Gepland..In confectie/Ingepakt) inclusief verwachte `confectie_startdatum`. Backward-compat aliassen voor legacy components.
- **Capaciteit per lane:** `confectie_werktijden.parallelle_werkplekken` (integer, default 1). Planning rekent `beschikbare_werkminuten × parallelle_werkplekken` per week per lane.
- **Status-transities:** via RPC's `start_confectie(snijplan_id)` en `voltooi_confectie(snijplan_id, afgerond, ingepakt, locatie)`, niet via directe UPDATE. Idempotent.
- **TOC-framing:** elke lane is een constraint; capaciteitsbalk per week signaleert overload vóór het zover is.

### Op Maat Module
- Toggle "Standaard / Op maat" in order-line-editor
- Bij "Op maat": KwaliteitKleurSelector → VormAfmetingSelector → prijsberekening → toevoegen
- Prijsberekening: oppervlak_m² × verkoopprijs/m² + vormtoeslag + afwerkingprijs - korting%
- m²-prijs bron: `maatwerk_m2_prijzen` tabel (admin-instelbaar, geseeded vanuit rollen)
- Vorm-weergave: centraal `vorm-labels.ts` systeem (gebruikt door snijplanning, stickers, orders)
- Rol-producten in ArticleSelector redirecten automatisch naar op-maat flow
