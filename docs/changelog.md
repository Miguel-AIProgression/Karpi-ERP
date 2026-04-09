# Changelog — RugFlow ERP

## 2026-04-09 — Op Maat configuratie-tabellen
- Nieuwe tabel `maatwerk_vormen`: instelbare vormen met toeslag (rechthoek, rond, ovaal, organisch A/B)
- Nieuwe tabel `afwerking_types`: instelbare afwerkingen met prijs (B, FE, LO, ON, SB, SF, VO, ZO)
- Nieuwe tabel `kwaliteit_standaard_afwerking`: standaard afwerking per kwaliteit
- Nieuwe tabel `maatwerk_m2_prijzen`: instelbare m²-prijs per kwaliteit/kleur (geseeded vanuit rollen)
- Extra kolommen op `order_regels`: m²-prijs, kostprijs/m², oppervlak, vorm-toeslag, afwerking-prijs, diameter, kwaliteit_code, kleur_code
- DROP CHECK constraint `order_regels_maatwerk_afwerking_check`, vervangen door FK naar `afwerking_types`
- FK constraint `fk_order_regels_vorm` naar `maatwerk_vormen` (ON DELETE RESTRICT)
- DB-functie `kleuren_voor_kwaliteit()` voor efficiënte kleur+prijs lookup
- RLS policies voor alle 4 nieuwe tabellen

## 2026-04-08 — Productiestatus zichtbaar in order detail

### Frontend
- Gewijzigd: `orders.ts` — `OrderRegelSnijplan` interface + snijplannen ophalen per maatwerk orderregel in `fetchOrderRegels`
- Gewijzigd: `order-regels-table.tsx` — maatwerk regels tonen nu maat, vorm, afwerking en productiestatus badge met link naar snijplanning

## 2026-04-08 — Afwerkingscodes uitbreiden + maatwerk in orderformulier

### Database (migration 038)
- Gewijzigd: `maatwerk_afwerking` CHECK constraint — oude waarden (geen/overlocked/band/blindzoom) vervangen door Karpi-standaard codes: B (Breedband), FE (Feston), LO (Locken), ON (Onafgewerkt), SB (Smalband), SF (Smalfeston), VO (Volume afwerking), ZO (Zonder afwerking)
- Migratie van bestaande data: overlocked→LO, band→B, blindzoom→ZO, geen→NULL

### Frontend
- Gewijzigd: `order-line-editor.tsx` — maatwerk-rij onder orderregel met afwerking, vorm, afmetingen, bandkleur en instructies
- Gewijzigd: `order-mutations.ts` — maatwerk velden meesturen naar create/update RPC
- Gewijzigd: `orders.ts` — maatwerk velden ophalen bij fetchOrderRegels
- Gewijzigd: `order-edit.tsx` — maatwerk velden doorgeven bij bewerken
- Gewijzigd: `article-selector.tsx` — product_type meenemen voor auto-detectie maatwerk
- Gewijzigd: `constants.ts` — AFWERKING_OPTIES en AFWERKING_MAP centraal
- Gewijzigd: `productie.ts` — MaatwerkAfwerking type met nieuwe codes
- Gewijzigd: confectie-tabel, sticker-layout, groep-accordion, week-groep-accordion, snijstukken-tabel — gebruiken nu AFWERKING_MAP

## 2026-04-08 — Snijoptimalisatie: automatische snijplanning

### Database (migration 037)
- Nieuw: `snijvoorstellen` tabel — voorstellen per kwaliteit+kleur met afvalstatistieken
- Nieuw: `snijvoorstel_plaatsingen` tabel — individuele stuk-plaatsingen per rol
- Nieuw: `geroteerd` kolom op `snijplannen` — of stuk 90° gedraaid is
- Nieuw: `keur_snijvoorstel_goed()` functie — atomische goedkeuring met concurrency guards
- Nieuw: `verwerp_snijvoorstel()` functie — verwerp concept-voorstellen
- Nummering: SNIJV prefix voor snijvoorstel nummers

## 2026-04-08 — Frontend snijoptimalisatie review

### Frontend
- Nieuw: `snijvoorstel.ts` query module — Edge Function aanroep, voorstel ophalen, goedkeuren/verwerpen
- Nieuw: `snijvoorstel-review.tsx` pagina — review van gegenereerd snijvoorstel met SVG visualisatie per rol, samenvattingskaart, niet-geplaatste stukken, goedkeuren/verwerpen flow
- Gewijzigd: `groep-accordion.tsx` — "Genereren" knop (Scissors icon) per kwaliteit+kleur groep, roept Edge Function aan en navigeert naar review pagina
- Gewijzigd: `use-snijplanning.ts` — 4 nieuwe hooks: useGenereerSnijvoorstel, useSnijvoorstel, useKeurSnijvoorstelGoed, useVerwerpSnijvoorstel
- Gewijzigd: `productie.ts` types — SnijvoorstelResponse, SnijvoorstelRol, SnijvoorstelPlaatsing, etc. + geroteerd op SnijStuk
- Nieuwe route: `/snijplanning/voorstel/:voorstelId`

## 2026-04-08 — Edge Function snijoptimalisatie (FFDH strip-packing)

### Supabase Edge Function
- Nieuw: `supabase/functions/optimaliseer-snijplan/index.ts`
- FFDH 2D strip-packing algoritme voor optimale plaatsing van snijstukken op rollen
- Input: kwaliteit_code + kleur_code, vindt alle wachtende snijplannen
- Rolselectie: reststukken eerst (kleinste eerst), dan beschikbare rollen (kleinste eerst)
- Stuks worden in twee orientaties geprobeerd, best-fit shelf selectie
- Berekent afvalpercentage (rekening houdend met ronde vormen via pi*r^2)
- Slaat voorstel op in snijvoorstellen + snijvoorstel_plaatsingen tabellen
- Vereist: SNIJV nummeringstype, snijvoorstellen en snijvoorstel_plaatsingen tabellen (nog aan te maken)

## 2026-04-08 — Prijslijsten update april 2026

### Prijslijsten
- Alle bestaande prijslijsten verwijderd (101 stuks) behalve Floorpassion (0145)
- 8 nieuwe Benelux prijslijsten geïmporteerd (210-217), geldig per 01-04-2026:
  - 210: Benelux | 211: Benelux + MV | 212: Benelux + bamboe | 213: Benelux + MV + bamboe
  - 214: Benelux + RM | 215: Benelux + RM + MV | 216: Benelux + RM + bamboe | 217: Benelux + RM + MV + bamboe
- Totaal 15.780 prijsregels geïmporteerd, 52 nieuwe producten automatisch aangemaakt
- Klant-koppelingen bijgewerkt: 0150→0210, 0151→0211 (184 klanten), 0152→0212 (99 klanten), 0153→0213 (239 klanten)
- Nieuw Excel formaat: kolommen A=artikelnr, B=EAN, C=omschrijving, D=omschr.2, E=prijs
- Import script: `import/prijslijst_update_2026.py`

## 2026-04-08 — Automatische maatwerk detectie en snijplan aanmaak

### Database
- Migratie 034: auto-detect maatwerk orders en genereer snijplannen
- Alle order_regels met product_type='rol' worden automatisch gemarkeerd als is_maatwerk=true
- Snijplannen worden automatisch aangemaakt (status 'Wacht') voor alle maatwerk orderregels
- Trigger trg_auto_maatwerk: markeert nieuwe order_regels automatisch als maatwerk bij rol-producten
- Trigger trg_auto_snijplan: maakt automatisch een snijplan aan bij nieuwe maatwerk orderregels
- SNIJ nummeringstype toegevoegd voor snijplan_nr generatie
- snijplanning_overzicht view uitgebreid met sp.rol_id kolom

## 2026-04-08 — Productiemodule maatwerk tapijten

### Database
- Migraties 030-033: maatwerk velden, snijplan uitbreidingen, scan tracking, productie functies en views
- Nieuwe tabellen: scan_events, voorraad_mutaties, app_config
- Nieuwe functies: genereer_scancode(), beste_rol_voor_snijplan(), maak_reststuk()
- Nieuwe views: snijplanning_overzicht, confectie_overzicht, productie_dashboard
- Extended: snijplan_status enum, rollen.status CHECK, order_regels maatwerk kolommen

### Frontend
- Snijplanning module: overzicht per week, gegroepeerd per kwaliteit+kleur, SVG snijvoorstel visualisatie, sticker print
- Confectie module: scan-gestuurd overzicht van afwerkingsstatus
- Scanstation Inpak: tablet-vriendelijk scaninterface voor barcode/QR
- Magazijn: overzicht gereed product met locatiebeheer
- Rollen & Reststukken: gegroepeerd rolbeheer met status badges
- Planning Instellingen: configuratie capaciteit, modus, reststuk verspilling
- Shared: scan-input component, productie types, status kleuren

## 2026-04-03 — Automatische verzendkosten (VERZEND) in orderformulier
- **Frontend:** Nieuw bestand `frontend/src/lib/constants/shipping.ts` met SHIPPING_PRODUCT_ID, SHIPPING_THRESHOLD (€500), SHIPPING_COST (€20)
- **Frontend:** `order-form.tsx` — automatische VERZEND-regel bij subtotaal < €500, verwijderd bij ≥ €500
- **Frontend:** Klanten met `gratis_verzending = true` krijgen nooit verzendkosten
- **Frontend:** Handmatige override: na bewerking/verwijdering van VERZEND-regel stopt de automatische logica
- **Frontend:** Edit mode: bestaande VERZEND-regels worden behouden (override=true)
- **Frontend:** `order-line-editor.tsx` — toont subtotaal en totaal apart wanneer VERZEND-regel aanwezig is
- **Frontend:** `article-selector.tsx` — filtert VERZEND-product uit zoekresultaten
- **Frontend:** `client-selector.tsx` + `order-mutations.ts` — `gratis_verzending` veld toegevoegd aan queries
- **Doel:** Automatische verzendkosten voor kleine orders, met mogelijkheid tot handmatige override

## 2026-04-03 — Product substitutie bij orderregels
- **Database:** `fysiek_artikelnr` en `omstickeren` kolommen op `order_regels` (migratie 025)
- **Database:** `zoek_equivalente_producten()` functie voor equivalentie-lookup via collecties
- **Database:** Reserveringstriggers aangepast: reserveert op `fysiek_artikelnr` (indien gezet)
- **Database:** RPCs `create/update/delete_order_with_lines` bijgewerkt voor substitutie-kolommen (migratie 026)
- **Frontend:** ArticleSelector toont automatisch substitutie-suggesties bij voorraad = 0
- **Frontend:** SubstitutionPicker component voor kiezen van equivalent product
- **Frontend:** Orderregels tonen substitutie-indicator (fysiek artikel + omstickeren badge)
- **Frontend:** fetchOrderRegels laadt substitutie-data voor edit mode
- **Doel:** Klant bestelt product X (factuur), magazijn levert product Y (pakbon) en stickert om

## 2026-04-03 — Klantspecifieke prijslijsten import
- Spec: `specs/09-prijslijst-excel-import.md` — koppeling WeTransfer ZIP (45 Excel prijslijsten) aan klanten
- Python importscript `import/prijslijst_import.py`:
  - ZIP-extractie met filtering van lock-bestanden en macOS metadata
  - Bestandsnaam → prijslijst_nr mapping (regex + zero-padding)
  - Cross-validatie bestandsnaam vs Excel-celwaarde
  - Upsert naar `prijslijst_headers` (nr, naam, geldig_vanaf) en `prijslijst_regels` (artikelnr, prijs, gewicht, etc.)
  - Validatie tegen debiteuren (gekoppelde klanten) en producten (bekende artikelnrs)
  - Configureerbare FK-bescherming (`SKIP_UNKNOWN_ARTIKELNRS`)
  - Gedetailleerd rapport per bestand + totalen

## 2026-04-03 — Klantlogo's import & weergave
- Storage bucket `logos` aangemaakt met publieke leestoegang (migratie 024)
- Python upload script `import/upload_logos.py` met deduplicatie en DB-matching
- Logo zichtbaar op klant-detailpagina met initialen-fallback
- 1.800+ logo's klaar voor upload naar Supabase Storage

## 2026-04-03

### Herclassificatie band-producten
- Band-producten (katoen, leder, leather) zonder karpi_code van "Vaste maat" → "Overig"
- Migratie: `023_herclassificatie_banden_naar_overig.sql`

## 2026-04-02 (update 8)

### Vertegenwoordigers module (nieuw)
- **Overzichtspagina** (`/vertegenwoordigers`): ranking tabel met alle reps
  - Kolommen: ranking, naam, omzet, % van totaal, klanten, tier-verdeling (G/S/B), open orders, gem. orderwaarde
  - Sorteerbaar op omzet, naam, klanten, open orders
  - Periodefilter: YTD, Q1, Q2, Q3, Q4 (berekend uit orders tabel)
  - Inactieve reps visueel gedempt
- **Detailpagina** (`/vertegenwoordigers/:code`):
  - Header met contactgegevens + 4 stat-kaarten (omzet, klanten, open orders, gem. order)
  - CSS mini-bars per maand (omzet trend, proportioneel aan hoogste maand)
  - Tab Klanten: alle gekoppelde klanten met omzet, tier, orders, plaats
  - Tab Orders: alle orders met statusfilter (Alle/Open/Afgerond)
- Nieuwe queries: `fetchVertegOverview`, `fetchVertegDetail`, `fetchVertegMaandomzet`, `fetchVertegKlanten`, `fetchVertegOrders`
- Spec: `specs/08-vertegenwoordigers-module.md`

### Klanteigen namen, artikelnummers en vertegenwoordigers overal zichtbaar
- **Klant-detail pagina** volledig vernieuwd met 5 tabs (conform spec 07):
  - Info (met vertegenwoordiger, route, rayon, factuurgegevens)
  - Afleveradressen
  - Orders
  - Klanteigen namen (kwaliteiten met klant-specifieke benamingen)
  - Artikelnummers (klant-specifieke artikelnummers met product lookup)
- **Order-detail**: orderregels tonen nu klanteigen naam (blauw, onder omschrijving) en klant-artikelnr
- **Order-detail**: vertegenwoordiger fallback naar klant's vertegenwoordiger als order geen eigen code heeft
- **Klant-card**: vertegenwoordiger naam zichtbaar op elke klantkaart
- **Klanten-overzicht**: filter op vertegenwoordiger toegevoegd
- Nieuwe queries: `fetchKlanteigenNamen`, `fetchKlantArtikelnummers`, `fetchVertegenwoordigers`
- `fetchKlantDetail` joint nu vertegenwoordiger naam via relatie
- `fetchOrderRegels` verrijkt regels met klanteigen namen en klant-artikelnummers (batch lookup)

## 2026-04-02 (update 7)

### Automatische voorraadreservering bij orders
- **Migratie 020**: Trigger-gebaseerd reserveringssysteem
  - `herbereken_product_reservering(artikelnr)`: herberekent `gereserveerd` en `vrije_voorraad` voor één product
  - Trigger op `order_regels` (INSERT/UPDATE/DELETE): update productreservering bij elke wijziging
  - Trigger op `orders` (status UPDATE): herbereken bij statuswijziging (bijv. annulering geeft voorraad vrij)
  - Actieve statussen reserveren: Nieuw t/m Klaar voor verzending
  - Eindstatussen geven vrij: Verzonden, Geannuleerd
- **Migratie 021**: Eenmalige sync van bestaande orders naar `producten.gereserveerd`
- Formule: `gereserveerd = SUM(te_leveren)` van alle actieve order_regels per artikelnr
- Formule: `vrije_voorraad = voorraad - gereserveerd - backorder + besteld_inkoop`

## 2026-04-02 (update 6)

### Magazijnlocaties op producten
- **Migratie 019**: `locatie` kolom (TEXT) toegevoegd aan `producten` tabel
- `producten_overzicht` view uitgebreid met locatie
- **Import script** `import_locaties.py`: leest 5.606 locaties uit `Locaties123.xls`, slaat "Maatw." over (302 unieke locaties)
- **Frontend**: locatie als sorteerbare kolom in producten-overzicht
- Inline bewerkbaar: klik op locatie badge om te wijzigen of toe te voegen
- Lege locaties tonen een "Locatie" placeholder bij hover

## 2026-04-02 (update 5)

### Uitwisselbaar-tab op producten overzicht
- **Tab-navigatie** toegevoegd: "Collecties" (bestaande tabel) en "Uitwisselbaar"
- Uitwisselbaar-tab toont alle collecties met 2+ kwaliteiten, gegroepeerd per uitwisselbare groep
- Per kwaliteit worden kleurbadges getoond; gedeelde kleuren (in 2+ kwaliteiten) zijn blauw gemarkeerd met ketting-icoon
- Nieuwe query `fetchUitwisselbareGroepen()` combineert collecties, kwaliteiten en producten-kleuren
- Nieuwe hook `useUitwisselbareGroepen()` met 5 min staleTime
- Nieuw component: `uitwisselbaar-tab.tsx`

## 2026-04-02 (update 4)

### Product type inline bewerkbaar + herclassificatie
- **Type badge** in producten-overzicht is nu klikbaar — opent dropdown om type te wijzigen
- Nieuwe `updateProductType()` query + `useUpdateProductType()` mutation hook
- Na wijziging wordt de productenlijst automatisch ververst
- **Migratie 018**: Herclassificatie van 1407 → 2 "overig" producten:
  - 208 → vast (NNNxNNN >= 1m², ROND patronen)
  - 86 → staaltje (NNNxNNN < 1m², tegels, zitkussens)
  - 175 → rol (BR patroon, ROLLEN, typische rolbreedtes 145-500)
  - 908 MAATWK placeholders gedeactiveerd
  - 17 "NIET GEBRUIKEN" producten gedeactiveerd

## 2026-04-02 (update 3)

### Staaltjes herkenning (product_type)
- **Migratie 017**: producten met vaste afmetingen < 1m² krijgen `product_type = 'staaltje'`
  - Afmeting wordt geparsed uit omschrijving (`CA: NNNxNNN`) — breedte × hoogte < 10.000 cm²
- **Frontend**: nieuw filter tab "Staaltjes", paarse badge "Staaltje"
- **ProductType**: uitgebreid met `'staaltje'` waarde

## 2026-04-02 (update 2)

### Product type onderscheid (vast vs rol)
- Analyse van Karpi_Import.xlsx vs Karpi_Importv2.xlsx: v2 verwijdert 367 MAATWERK placeholders
- **Migratie 015**: `product_type` kolom toegevoegd aan producten (`vast`, `rol`, `overig`)
  - `vast` = vaste afmeting (omschrijving bevat `CA:NNNxNNN`)
  - `rol` = rolproduct, maatwerk (omschrijving bevat `BREED`)
  - `overig` = niet geclassificeerd
  - MAATWERK placeholder producten verwijderd
- **Config**: import wijst nu naar `Karpi_Importv2.xlsx`
- **Import script**: leidt `product_type` af uit omschrijving/karpi_code bij import
- **Frontend producten overzicht**: type filter (Alle/Vaste maten/Rolproducten/Overig) + kleur-badges
- **Frontend product detail**: type badge naast productnaam

## 2026-04-02

### Project opgezet
- Mappenstructuur aangemaakt: brondata/, docs/, specs/, mockups/, supabase/, import/, frontend/
- Bronbestanden verplaatst naar logische mappen
- 1.931 klantlogo's uitgepakt naar brondata/logos/
- CLAUDE.md aangemaakt (centrale referentie, max 100 regels)
- Levende documenten aangemaakt: database-schema.md, architectuur.md, data-woordenboek.md
- 7 requirement specs geschreven (01-07)

### Database
- 10 SQL-migratiebestanden geschreven (001-010)
- 26 tabellen, 6 enums, 5 views, 5 functies, RLS policies, storage bucket
- Nog niet toegepast op Supabase (handmatig via SQL Editor)

### Frontend V1
- React/TypeScript/Vite project opgezet met TailwindCSS v4 + shadcn/ui inspiratie
- Layout: dark sidebar met terracotta accent, topbar met zoekbalk
- Alle 20+ routes aangemaakt (V1 pagina's + placeholders)
- **Orders module**: overzicht (status-tabs, zoeken, paginering) + detail (header, adressen, regels)
- **Klanten module**: overzicht (kaart-grid met logo's, tier badges) + detail (info, adressen, orders)
- **Producten module**: overzicht (tabel met voorraad-indicatoren) + detail (voorraad, rollen)
- **Dashboard**: statistiek-kaarten + recente orders tabel (via Supabase views)
- Supabase queries per module, React Query hooks, formatters (€, datums)
- Alle bestanden <150 regels, netjes opgesplitst per concern
