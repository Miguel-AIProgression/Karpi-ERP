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

### Module-grafiek (vertical slices met expliciete seams)
Frontend en backend worden geleidelijk per feature heringericht als **deep verticale Modules** onder `frontend/src/modules/{naam}/` en `supabase/functions/{naam}-*/`. Eerste twee modules in dit patroon waren `modules/edi/` en `modules/logistiek/`; daarop volgen `modules/orders/` (bezit het Order-voorstel) en `modules/planning/` (bezit snijplanning, confectie, levertijd-simulatie). Cross-Module aanroepen lopen via een **TS-functie-contract** (shared edge-helper of barrel-export), niet via god-Module en niet via HTTP-tussenstappen. Iedere seam wordt afgedwongen met contract-tests die in beide kanten dezelfde fixtures draaien. Beslissing en alternatieven: [ADR-0001](adr/0001-order-voorstel-en-planning-als-twee-modules.md).

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
3. `auto-plan-groep`: lock → release Gepland stukken → best-of-both heroptimalisatie → auto-approve
4. Rollen direct gereserveerd (status `in_snijplan`)
5. Snijder klikt "Start productie" → status `In productie` (niet meer herberekend)
6. Stukken buiten horizon of zonder beschikbare rollen blijven in Wacht (handmatige flow)

Gedeelde code in `supabase/functions/_shared/` (packing-algoritmes, DB helpers) wordt door beide edge functions geïmporteerd.

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
/magazijn                  Redirect naar /pick-ship
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
/pick-ship                 Open orders gegroepeerd op afleverdatum; verrijkt met pickbaarheid/locatie als view beschikbaar is
/logistiek                 Zendingen-overzicht met vervoerder/status-filters
/logistiek/:zending_nr     Zending-detail met transportorder/API-historie
/logistiek/:zending_nr/printset  Printbare verzendset: stickers + pakbon
/inkoop                    Inkooporders overzicht (stat-cards + filters op status/leverancier/alleen-open)
/inkoop/:id                Inkooporder detail (regels met "Ontvangst boeken" knop per regel)
/leveranciers              Leveranciers overzicht (met openstaande orders/meters per leverancier)
/leveranciers/:id          Leverancier detail (gegevens + openstaande inkooporders)
/instellingen              (placeholder)
/instellingen/productie    Planning instellingen: capaciteit, modus, reststuk verspilling
```

## EDI / Transus Flow

Alle EDI-verkeer loopt via `edi_berichten` als audit- en queue-tabel.

**Inkomend:** `supabase/functions/transus-poll` pollt Transus M10110 met `CRON_TOKEN`, decodeert het bericht via `_shared/transus-soap.ts`, detecteert Karpi fixed-width ORDERS en parseert via `_shared/transus-formats/karpi-fixed-width.ts`. De parser accepteert echte Transus-bestanden waarvan trailing spaces zijn afgekapt (header 462/463, artikel 280/281). Na verwerking wordt M10300 aangeroepen en schrijft `markeer_edi_ack` `ack_status`, `ack_details` en `acked_at` terug. Ordercreatie via `create_edi_order` matcht artikelen met `match_edi_artikel` en prijst regels via `debiteuren.prijslijst_nr -> prijslijst_regels`; alleen als daar geen prijs staat valt de RPC terug op `producten.verkoopprijs`.

**Uitgaand:** de EDI-bevestig-flow bouwt orderbevestigingen als TransusXML (`<ORDERRESPONSES>`) en zet die XML direct in `edi_berichten.payload_raw` met `richting='uit'`, `berichttype='orderbev'`, status `Wachtrij` en `order_response_seq`. Facturen gebruiken Karpi fixed-width INVOIC (1107-byte header + 312-byte regels), gebouwd in `supabase/functions/_shared/transus-formats/karpi-invoice-fixed-width.ts` op basis van echte BDSK-voorbeelden. `factuur-verzenden` queue't zo'n EDI-factuur automatisch wanneer `edi_handelspartner_config.transus_actief=true` en `factuur_uit=true`; e-mail blijft mogelijk naast EDI, maar is niet vereist voor EDI-only debiteuren. `supabase/functions/transus-send` claimt alle uitgaande wachtrij-rijen via `claim_volgende_uitgaand()`, verstuurt `payload_raw` ongewijzigd via M10100, en markeert succes met `markeer_edi_verstuurd` of retry/fout met `markeer_edi_fout`.

Handmatige pre-cutover-validatie blijft beschikbaar via `/edi/berichten`: echte `.inh` uploaden, order aanmaken, orderbev queue'en en de TransusXML downloaden voor Transus Online "Bekijken en testen".

**Frontend-organisatie (vanaf 2026-04-30):** alle EDI-frontend-code leeft onder [`frontend/src/modules/edi/`](../frontend/src/modules/edi/) als één feature-module (`pages/`, `components/`, `hooks/`, `queries/`, `lib/`). Externe consumers (klanten-, orders-modules, router, sidebar) importeren via de barrel `@/modules/edi`. **Berichttype-registry** [`registry.ts`](../frontend/src/modules/edi/registry.ts) is bron-van-waarheid voor de vier types (`order`, `orderbev`, `factuur`, `verzendbericht`); UI-componenten itereren over `getBerichttypenVoorRichting(...)` i.p.v. hard-coded lijsten. Backend (poll/send edge functions) gebruikt de registry nog niet — V2-werk: spiegel naar `supabase/functions/_shared/edi/registry.ts`.

## Logistiek-module

Karpi verzendt met **drie vervoerders**: HST (REST API), Rhenus (EDI) en Verhoek (EDI). Dit document beschrijft de end-state vanaf migraties 169–173, waarin de **HST-koppeling** is opgeleverd; de twee EDI-vervoerders volgen in latere plans en gebruiken straks de bestaande `edi_berichten`-tabel met `berichttype='verzendbericht'`. Per debiteur wordt vastgelegd welke vervoerder gebruikt wordt via `edi_handelspartner_config.vervoerder_code` (FK → `vervoerders.code`).

### Flow

```
┌──────────────────┐  1. order Klaar voor verzending           ┌──────────────────┐
│ Order detail-    │ ────────────────────────────────────────▶ │ Knop: "Zending   │
│ pagina (UI)      │                                           │ aanmaken"        │
└──────────────────┘                                           └─────────┬────────┘
                                                                         │ 2. RPC create_zending_voor_order(p_order_id)
                                                                         ▼
                                                              ┌────────────────────┐
                                                              │ INSERT zendingen   │
                                                              │ (status='Klaar     │
                                                              │  voor verzending') │
                                                              └─────────┬──────────┘
                                                                        │ 3. AFTER INSERT/UPDATE trigger
                                                                        │    op status='Klaar voor verzending'
                                                                        ▼
                                                              ┌────────────────────────────────┐
                                                              │ enqueue_zending_naar_         │
                                                              │   vervoerder(zending_id)       │  ◀── single switch-point
                                                              │                                │
                                                              │ leest vervoerder_code uit      │
                                                              │ edi_handelspartner_config en   │
                                                              │ dispatcht naar adapter-RPC:    │
                                                              │                                │
                                                              │   'hst_api'                    │
                                                              │      → enqueue_hst_            │
                                                              │          transportorder        │
                                                              │   'edi_partner_a/b' (later)    │
                                                              │      → enqueue_edi_            │
                                                              │          verzendbericht        │
                                                              │   NULL                         │
                                                              │      → no-op                   │
                                                              └─────────┬──────────────────────┘
                                                                        │ INSERT hst_transportorders
                                                                        │ status='Wachtrij'
                                                                        ▼
                                              ┌─────────────────────────────────────────────┐
                                              │ edge function hst-send (cron elke minuut)   │
                                              │  • claim_volgende_hst_transportorder()      │
                                              │  • bouw TransportOrder JSON (lokale builder)│
                                              │  • POST /rest/api/v1/TransportOrder         │
                                              │    Authorization: Basic ...                 │
                                              │  • bij 200: markeer_hst_verstuurd()         │
                                              │      → schrijf extern_transport_order_id +  │
                                              │        eventueel tracking_nummer terug op   │
                                              │        zendingen.track_trace                │
                                              │  • bij 4xx/5xx: markeer_hst_fout()          │
                                              │      → retry tot max_retries=3              │
                                              └─────────────────────────────────────────────┘
```

### Pick & Ship verzendset

Vanaf `/pick-ship` kan een magazijnmedewerker op een volledig pickbare order de actie **Verzendset** starten. De frontend roept `create_zending_voor_order(p_order_id)` aan; de database kiest daarna op zendingniveau de vervoerder via `selecteer_vervoerder_voor_zending()` (V1: precies één actieve vervoerder) en opent `/logistiek/:zending_nr/printset`. Die printset bevat per colli een verzendsticker met GS1-128/SSCC-barcode en vervoerderbadge, plus een A4-pakbon met orderregels, aantallen, afleveradres en colli/gewicht-samenvatting. De zending-trigger blijft de bron voor automatische dispatch naar de adapter; de printset is de magazijn-output voor de fysieke zending.

### Belangrijkste design-besluiten

- **Adapter-pattern, géén gegeneraliseerde queue-tabel.** HST krijgt z'n eigen tabel `hst_transportorders` met HST-specifieke kolommen (`extern_transport_order_id`, `request_payload`, `response_payload`, `response_http_code`, retry/status). EDI-vervoerders hergebruiken straks `edi_berichten` met `berichttype='verzendbericht'`. Reden — *deletion-test*: als een hypothetische `vervoerder_berichten`-tabel werd weggehaald, zou complexiteit voor de EDI-vervoerders niet toenemen (die zit al in `edi_berichten`); alleen HST-complexiteit zou ergens heen moeten — naar een eigen tabel. Dat doen we dus meteen, zonder shallow-abstraction-tussenlaag.
- **Single switch-point in `enqueue_zending_naar_vervoerder`.** PL/pgSQL-functie van ~30 regels is de enige plek in de codebase waar op `vervoerder_code` wordt geswitcht. Trigger, frontend en edge function zijn vervoerder-blind óf vervoerder-specifiek — geen tussenlaag. Bij vervoerder #4 voeg je één `WHEN`-tak toe en je weet zeker dat je niets vergeet.
- **Verticale folder per vervoerder.** Alle HST-files leven in [`supabase/functions/hst-send/`](../supabase/functions/hst-send/) — payload-builder, HTTP-client, types, fixtures. Géén HST-types in `_shared/`. Bij toekomstige Rhenus-vertical: nieuwe map `supabase/functions/rhenus-send/` met dezelfde interne structuur.
- **HST-tracking → `zendingen.track_trace`.** Na 200-respons schrijft `markeer_hst_verstuurd` het `transportOrderId` (of `trackingNumber` als HST dat al heeft) terug op `zendingen.track_trace` en promoveert de zending-status van `'Klaar voor verzending'` naar `'Onderweg'`.
- **Vervoerders-tabel als enum-light.** Lookup-tabel i.p.v. PostgreSQL-enum omdat we per vervoerder metadata nodig hebben (display-naam, kleur, type). Migratie 170 zaait 3 rijen; alleen `hst_api` wordt actief gezet bij cutover.
- **Trigger-bron is `zendingen.status`, niet `orders.status`.** Eén order kan in V2 in meerdere zendingen splitsen met verschillende leverdata — de zending is de werkelijke fysieke eenheid die HST ophaalt.
- **Cron-frequentie:** edge function `hst-send` draait elke minuut via pg_cron (mig 173).

Voor implementatiedetails (taak-volgorde, fixtures, payload-shape, retry-strategieën): zie [`docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md`](superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md).

### Vervoerder-instellingen + roadmap

De `/logistiek/vervoerders`-pages (overzicht + detail) wijzen op een drie-fase-roadmap:

- **Fase A (mig 174 — vandaag):** uitbreiding `vervoerders`-tabel met instellingen, contactgegevens en `tarief_notities` (vrije tekst). View `vervoerder_stats` voedt de UI met klant- en zending-tellingen. Twee nieuwe pages onder `frontend/src/modules/logistiek/` (`vervoerders-overzicht.tsx` + `vervoerder-detail.tsx`), bereikbaar via de instellingenknop op het Logistiek-overzicht.
- **Fase B (later, ~4-8 weken na A):** vervang vrije-tekst tarieven door gestructureerde tabellen `vervoerder_zones`, `vervoerder_zone_postcodes` en `vervoerder_tarieven` met versie-historie via `geldig_vanaf`/`geldig_tot`. Lookup-RPC `get_tarief(vervoerder, zone, gewicht_kg, datum)`.
- **Fase C (eindstaat):** auto-selectie via `selecteer_vervoerder_voor_zending(zending_id)` — filter op `vervoerder_voorwaarden` (max gewicht/afmetingen, ondersteunde landen, leverdagen), score op tarief + klant-voorkeur. Trigger `fn_zending_klaar_voor_verzending` roept de selector aan vóór `enqueue_zending_naar_vervoerder`. `edi_handelspartner_config.vervoerder_code` wordt zachte voorkeur i.p.v. harde keuze.

A → B → C is een harde volgorde: geen B vóór ≥2 weken Fase A-gebruik en geen C vóór ten minste 2 vervoerders volledige tarieven hebben in B. Volledig plan: [`docs/superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md`](superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md).

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
Supabase Edge Function (`supabase/functions/optimaliseer-snijplan/index.ts`) die 2D strip-packing uitvoert via de **best-of-both strategie**: per rol runt de code zowel Guillotine-cut (reststuk-aware placement-scoring) als FFDH (First Fit Decreasing Height), en kiest het resultaat met meeste geplaatste stukken, kleinste rol-lengte, meeste reststuk-waarde, laagste afval. Neemt kwaliteit_code + kleur_code als input, vindt alle wachtende snijplannen, pakt ze optimaal op beschikbare rollen (reststukken eerst), en slaat het voorstel op in `snijvoorstellen` + `snijvoorstel_plaatsingen`. Retourneert plaatsingen met coordinaten, afvalpercentages en samenvatting. Vereist SNIJV nummeringstype.

**Placement-selectie (Guillotine, dead-zone aware):** Lexicografisch per zone. Een placement zit in de **safe zone** als `yEnd ≤ rolLengte − AANGEBROKEN_MIN_LENGTE` (rol-rest blijft ≥ 100 cm en dus aanbreekbaar), anders **dead zone** (rol gaat toch op). Safe wint altijd van dead. Binnen **safe**: (1) Y-eindpositie minimaal (rol zuinig), (2) reststuk-m² maximaal, (3) Best Area Fit, (4) leftover-short. Binnen **dead**: (1) reststuk-m² maximaal (prio 4 promoveert — rol gaat toch op, dan telt elke bruikbare rest), (2) Y-eind minimaal, (3) BAF, (4) leftover-short. Voor elke kandidaat wordt de volledige free-rect-update gesimuleerd om de reststuk-waarde te meten. Reststuk-detectie in de UI gebruikt dezelfde free-rect subtraction + greedy disjoint cover, zodat wat het algoritme "ziet" ook in de snij-modal en op stickers verschijnt.

**Algoritme-keuze per rol:** Guillotine wint op scenarios waar kleine stukken uit grote vrije ruimtes gehaald moeten worden (letterlijk "haal het stuk uit het reststuk") én op scenarios waar rotatie een kwalificerend reststuk oplevert. FFDH wint op specifieke patronen dankzij rotatie-lookahead. De best-of-both wrapper (`_shared/guillotine-packing.ts`) garandeert dat we nooit slechter presteren dan de oude FFDH-only flow.

### Operator-terminologie & snij-marges
De snijmachine heeft **1 lengte-mes** (snijdt de rol dwars af op een ingestelde Y-positie) en **3 breedte-messen** (staan parallel aan de rol-lengte op instelbare X-posities, verdelen een rij in max 4 naast-elkaar-strips bij één lengte-mes-slag). De `rol-uitvoer-modal` spreekt deze taal: header per rij toont `Lengte-mes op Y cm` + `Breedte-mes 1/2/3 op X cm`. Interne X-snit-posities worden afgeleid uit placement-coördinaten (regels waar een verticale snit door de volledige shelf-hoogte loopt zonder een stuk te doorsnijden). Stukken die groter geplaatst zijn dan besteld (door marge-ophoging, zie onder) tonen een amber `→ bijsnijden met hand naar …`-instructie.

**Snij-marges** (single source of truth in [snij-marges.ts](supabase/functions/_shared/snij-marges.ts) + SQL-functie `stuk_snij_marge_cm` in migratie 126):
- `maatwerk_afwerking = 'ZO'` → **+6 cm** op beide dimensies (rondom 6 cm voor afwerking)
- `maatwerk_vorm IN ('rond', 'ovaal')` → **+5 cm** op beide dimensies (speling voor handmatig uitzagen)
- Combi ZO + rond: **grootste marge wint** (niet cumulatief)

`fetchStukken()` past de marge toe vóór de packer, zodat fysieke snij-maat wordt gepland. `snijplanning_tekort_analyse()` past dezelfde marge toe bij de rol-past-check. De view-kolommen `snij_lengte_cm`/`snij_breedte_cm` blijven nominale (klant-)maat — de opgehoogde maat verschijnt alleen in het packing-resultaat, zodat de modal `placed vs besteld` automatisch uit elkaar kan trekken.

**Shelf-mes-validator** ([shelf-mes-validator.ts](supabase/functions/_shared/shelf-mes-validator.ts)): post-check in `optimaliseer-snijplan` + `auto-plan-groep` die rapporteert als een shelf meer dan 3 breedte-mes-posities vereist. Zachte check — output gaat als `samenvatting.shelf_waarschuwingen` op de edge-function-response + `console.warn`, plaatsingen worden niet afgewezen.

### Inkoop & ontvangst flow
- Openstaande inkooporders worden geimporteerd uit `Inkoopoverzicht.xlsx` via `import/import_inkoopoverzicht.py` (dry-run default, `--apply` voor persistent). Alleen regels met `Te leveren > 0` én `Status ∈ {0,1}` komen erin.
- Nieuwe bestellingen worden handmatig ingevoerd via `InkooporderFormDialog` op `/inkoop` — inkooporder-nummer wordt gegenereerd via `volgend_nummer('INK')` (INK-YYYY-NNNN).
- Bij binnenkomst opent de operator een regel via de `Ontvangst` knop op `/inkoop/:id` en vult N rollen in (rolnummer + lengte_cm + breedte_cm). De RPC `boek_ontvangst` maakt de rollen aan (status=`beschikbaar`, gekoppeld aan `inkooporder_regel_id`), schrijft een `voorraad_mutaties`-entry type=`ontvangst` en werkt de order-status bij. De trigger `trg_sync_besteld_inkoop` synchroniseert tegelijkertijd `producten.besteld_inkoop` op basis van resterende open regels.
- Voor het Excel-bestand matcht `Artikelnummer` (numeriek 7-digit) 1-op-1 met `producten.artikelnr`. Artikelen die niet in de masterdata staan (~20%, vermoedelijk grondstoffen/obsolete) worden geimporteerd met `artikelnr=NULL` en snapshot in `artikel_omschrijving`/`karpi_code`.

### Prijslijst-imports

Aanvullende klant-/inkooporganisatie-prijslijsten worden geimporteerd via [`import/import_prijslijsten_aanvulling.py`](../import/import_prijslijsten_aanvulling.py). Het script is dry-run by default en gebruikt [`import/prijslijsten_aanvulling_manifest.json`](../import/prijslijsten_aanvulling_manifest.json) als bestandsmanifest. De debiteurkoppeling komt niet uit fuzzy naammatching maar uit de oorspronkelijke debiteuren-export [`brondata/debiteuren/Karpi_Debiteuren_Import.xlsx`](../brondata/debiteuren/Karpi_Debiteuren_Import.xlsx), kolom `Prijslijst`.

Flow: ZIP-bestand + Excel lezen -> Excel-prijslijstnummer valideren tegen manifest -> actieve debiteuren zoeken met dezelfde oude prijslijstcode -> ontbrekende producten minimaal aanmaken -> `prijslijst_headers` en `prijslijst_regels` upserten -> `debiteuren.prijslijst_nr` zetten. Na elke run schrijft het script een rapport onder `import/rapporten/`.

### Reststuk tracking
Na het snijden toont `voltooi_snijplan_rol()` een bevestigingsmodal waarin de gebruiker de restlengte kan aanpassen of kan kiezen om geen reststuk op te slaan. Na bevestiging wordt een reststuk-sticker geprint (rolnummer, kwaliteit, kleur, afmetingen, QR-code, locatieveld). Reststukken worden opgeslagen als nieuwe rol met status 'reststuk', gekoppeld via `oorsprong_rol_id`. Alle voorraadmutaties worden gelogd in `voorraad_mutaties`.

### Snijtijden
Wisseltijd per rol en snijtijd per karpet zijn configureerbaar via Productie Instellingen (`app_config`). Geschatte totaaltijd wordt getoond op snijvoorstel-review en productie-groep pagina's. Formule: `(rollen × wisseltijd) + (stukken × snijtijd)`.

### Real-time levertijd-check (order-aanmaak)
Edge function `check-levertijd` (`supabase/functions/check-levertijd/`) berekent tijdens order-entry een concrete leverdatum voor maatwerk-regels. Drie pure helper-modules in `supabase/functions/_shared/levertijd-*.ts`:
- **levertijd-match.ts**: zoekt rol in pipeline (status `Gepland`/`Snijden`) waar het nieuwe stuk nog op past via `tryPlacePiece` (FFDH); kiest vroegste snij-datum, exact match wint van uitwisselbaar bij gelijke datum. Snij-datum komt bij voorkeur uit de sequentiële werkagenda (realistisch moment na bestaande backlog); fallback `snijDatumVoorRol` floort altijd op eerstvolgende werkdag ≥ vandaag zodat backlog-rollen met overtijd-afleverdatum nooit een snij-datum in het verleden opleveren.
- **levertijd-capacity.ts**: bepaalt snij-week (lever-week − 1), itereert tot ruimte beschikbaar (max 6 weken), vergelijkt bezetting (stuks + minuten) met `capaciteit_per_week × (1 − marge_pct/100)`. Backlog-check via RPC `backlog_per_kwaliteit_kleur`.
- **levertijd-resolver.ts**: combineert tot scenario (`match_bestaande_rol` | `nieuwe_rol_gepland` | `wacht_op_orders` | `spoed`) + NL onderbouwing (max 240 chars). **ASAP-by-default:** `wacht_op_orders` triggert alléén bij `geen_rol_passend` (geen voorraadrol breed/lang genoeg → inkoop nodig). De backlog-drempel `backlog_minimum_m2` is informatief en blokkeert niet — dat zorgt ervoor dat klanten standaard de vroegst mogelijke leverdatum krijgen.

Frontend: `useLevertijdCheck` hook (TanStack Query, 350 ms debounce, 60 s staleTime) + `<LevertijdSuggestie>` component met scenario-badge, datum, onderbouwing en "Neem datum over"-knop. Geïntegreerd in `order-form.tsx` voor de laatste maatwerk-regel met complete (kwaliteit, kleur, lengte, breedte). Bij edge-function fout valt de UI terug op `berekenAfleverdatum()`.

**Auth-noot (Edge-gateway):** `check-levertijd`, `auto-plan-groep` en `optimaliseer-snijplan` zijn gedeployed met `verify_jwt = false` (zie [supabase/config.toml](supabase/config.toml)). De nieuwe `sb_publishable_...` API-keyvorm in de frontend is geen JWT; met de default `verify_jwt=true` zou de Edge-gateway `supabase.functions.invoke()`-calls blokkeren met HTTP 401 `UNAUTHORIZED_INVALID_JWT_FORMAT`. De functies gebruiken intern `SUPABASE_SERVICE_ROLE_KEY` voor DB-toegang en lezen geen user-JWT, dus gateway-check is overbodig. Toggle staat ook aan/uit via Supabase Dashboard → Edge Functions → [naam] → "Enforce JWT Verification".

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

## Facturatie-flow (2026-04-22)

```
order.status='Verzonden'
        │
        ▼
  TRIGGER enqueue_factuur_bij_verzonden (migratie 118)
        │ (alleen als klant.factuurvoorkeur='per_zending')
        ▼
  factuur_queue (status=pending)
        │
        ▼  pg_cron elke minuut (migratie 122)
  EDGE FN factuur-verzenden
        │
        ├─ markeer processing + processing_started_at=now()
        ├─ RPC genereer_factuur (migratie 119):
        │    facturen + factuur_regels INSERT, order_regels.gefactureerd = orderaantal,
        │    BTW-% uit debiteuren.btw_percentage
        ├─ pdf-lib → Uint8Array (Karpi layout, Courier monospace, A4)
        ├─ Storage.upload('facturen/{debiteur_nr}/FACT-YYYY-NNNN.pdf')
        ├─ als EDI actief is voor debiteur:
        │    bouw Karpi fixed-width INVOIC en INSERT edi_berichten(status='Wachtrij')
        ├─ als email_factuur gevuld is:
        │    Storage.download('documenten/algemene-voorwaarden-karpi-bv.pdf')
        │    Resend.emails.send(to=debiteur.email_factuur,
        │      attachments=[factuur-pdf, algemene-voorwaarden])
        └─ facturen.status='Verstuurd', factuur_queue.status='done'

Wekelijkse modus (maandag 05:00 UTC):
  pg_cron → enqueue_wekelijkse_verzamelfacturen()
        → per klant met factuurvoorkeur='wekelijks':
          INSERT factuur_queue(order_ids=[alle ongefactureerde verzonden orders])

Recovery (elke 5 minuten):
  pg_cron → recover_stuck_factuur_queue()
        → zet factuur_queue-items >10 min in 'processing' terug op 'pending'
```

**Bedrijfsgegevens-config**: `app_config.sleutel='bedrijfsgegevens'` bevat KVK, BTW, IBAN
etc. Bewerkbaar via `/instellingen/bedrijfsgegevens`.

**Klantvoorkeur**: `debiteuren.factuurvoorkeur` (`per_zending` | `wekelijks`) +
`debiteuren.btw_percentage` (21.00 standaard; 0 voor EU-intracom/export).
Bewerkbaar in klant-detail → tab "Facturering".

## Inkoop-reserveringen (2026-04-29, mig 144–152)

Bij order-aanmaak worden vaste-maat-orderregels automatisch gealloceerd over voorraad + openstaande inkoop. Bron-van-waarheid: tabel [`order_reserveringen`](../supabase/migrations/144_order_reserveringen_basis.sql) met rijen voor zowel voorraadclaims als IO-claims.

```
order_regel ─┬─ order_reserveringen ─┬─ bron='voorraad'         (geen FK)
             │                       └─ bron='inkooporder_regel' ── inkooporder_regel
             │
             └─ herallocateer_orderregel(id) (centrale RPC, idempotent)
```

### Allocatie-volgorde
1. **Voorraad eerst** — `LEAST(te_leveren, voorraad_beschikbaar_voor_artikel())`
2. **Daarna oudste IO** — over `inkooporder_regels` met `eenheid='stuks'` en `inkooporders.status IN ('Besteld','Deels ontvangen')`, geordend op `verwacht_datum ASC NULLS LAST`. Per IO-regel `LEAST(resterend, io_regel_ruimte())`.
3. Resterend > 0 → tekort → order op `Wacht op inkoop` (claim aanwezig) of `Wacht op voorraad` (geen claim, geen IO beschikbaar).

### Claim-volgorde-prio
FIFO via `claim_volgorde TIMESTAMPTZ DEFAULT now()`. Geen automatische herallocatie wanneer een nieuwere order met urgenter afleverdatum binnenkomt — wie eerst claimt, wordt eerst beleverd bij IO-ontvangst. Spoed-prio (claim-stelen) staat op de V2-backlog.

### Levenscyclus
| Event | Trigger | Effect |
|-------|---------|--------|
| Orderregel INSERT/UPDATE (artikelnr/te_leveren/is_maatwerk wisselt) | `trg_orderregel_herallocateer` | `herallocateer_orderregel(id)` — release + nieuw alloceren |
| Orderregel DELETE | FK ON DELETE CASCADE | Claims verdwijnen; trigger C herberekent `producten.gereserveerd` |
| Order status → `Geannuleerd` / `Verzonden` | `trg_order_status_herallocateer` | Per regel `herallocateer_orderregel` (releaset claims) |
| `inkooporders.status → 'Geannuleerd'` | `trg_inkooporder_status_release` | Per IO-regel `release_claims_voor_io_regel` → getroffen orderregels heralloceren naar volgende IO of "Wacht op nieuwe inkoop" |
| IO `verwacht_datum` wijzigt | (geen trigger) | Levertijd wordt live afgeleid via view `order_regel_levertijd` |
| `boek_voorraad_ontvangst(io_regel, aantal)` | (RPC, mig 148) | IO-claims consumeren in `claim_volgorde`; geconsumeerd deel → voorraad-claim op zelfde orderregel; `producten.voorraad += aantal`; per geraakte order `herwaardeer_order_status` |
| `order_reserveringen` INSERT/UPDATE/DELETE | `trg_reservering_sync_producten` | `herbereken_product_reservering(artikelnr)` |

### Levertijd-berekening
View `order_regel_levertijd` (mig 150) levert per orderregel:
- `levertijd_status`: `voorraad` | `op_inkoop` | `wacht_op_nieuwe_inkoop` | `maatwerk`
- `verwachte_leverweek`: `iso_week_plus(io_datum, buffer)` waar `buffer = inkoop_buffer_weken_vast` (default 1) uit `app_config.order_config`. Bij `orders.lever_modus='in_een_keer'` wint de max IO-datum, anders de min (eerste week).

### Maatwerk (V1)
Maatwerk-regels (`is_maatwerk=true`) reserveren NIET op IO. Op de orderregel wordt een hint getoond via `MaatwerkLevertijdHint`: eerstvolgende inkoop-leverweek + 2 weken buffer (`inkoop_buffer_weken_maatwerk`). Echte claim op rol-IO (`eenheid='m'`) staat in V2.

### Claim-uitsplitsing per orderregel (UI)
Op order-detail toont elke stuks-orderregel met `te_leveren > 0` een geneste sub-rij per claim-bron, in vaste volgorde: eigen voorraad → omsticker (uitwisselbaar) → IO → "Wacht op nieuwe inkoop". De synthetische "wacht"-rij vult `te_leveren − som(actieve claims)` zodat de sub-aantallen altijd optellen tot het hoofdregel-getal. Bron: query `fetchClaimsVoorOrder(orderId)` — één call op `order_reserveringen` plus een gebatchte `producten`-lookup voor omschrijving + locatie van afwijkende `fysiek_artikelnr`-waardes.

Doel is de verzamelaar in het magazijn: omsticker-rijen krijgen amber-accent + locatie-tag + expliciete "→ stickeren naar {orderregel.artikelnr}"-noot, wacht-rijen krijgen rose-accent. Maatwerk- en m-regels krijgen geen uitsplitsing (vallen buiten de stuks-claim-flow). Factuur- en orderregel-uitvoer blijven 1× origineel artikel — de uitsplitsing is puur intern.

### `vrije_voorraad`-formule (mig 149)
Voorheen: `voorraad − gereserveerd − backorder + besteld_inkoop`. Sinds mig 149: `voorraad − gereserveerd − backorder` (geen `+ besteld_inkoop`). Toekomstige inkoop is zichtbaar via aparte velden + via `order_reserveringen`, maar telt niet in "vandaag-leverbaar".
