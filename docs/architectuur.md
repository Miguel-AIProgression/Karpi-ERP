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
Frontend en backend worden geleidelijk per feature heringericht als **deep verticale Modules** onder `frontend/src/modules/{naam}/` en `supabase/functions/{naam}-*/`. Eerste twee modules in dit patroon waren `modules/edi/` en `modules/logistiek/`. De in [ADR-0001](adr/0001-order-voorstel-en-planning-als-twee-modules.md) beloofde `modules/orders/`-map is **nog niet gebouwd**: de order-intake/-voorstel-code leeft bewust verspreid over `components/orders/`, `lib/orders/`, `lib/supabase/queries/orders.ts` en `modules/orders-lifecycle/` (zie ADR-0001-note). De oude `modules/planning/`-belofte uit deze paragraaf is per [ADR-0013](adr/0013-snijplanning-module-en-cache-invalidation-seam.md) ingetrokken: Confectie en Snijplanning leven als zustermodules op één niveau, naast Maatwerk, Debiteuren etc. De **derde domein-module is `modules/magazijn/`** (pickbaarheid, pick-flow, locatie-mutaties op rollen + snijplannen) — zie [ADR-0002](adr/0002-pick-ship-splitst-naar-magazijn-en-logistiek.md). De **vierde is `modules/voorraadpositie/`** (mig 179 + mig 180; T001 tracer-bullet → T003 batch+filter) — bezit één concept "Voorraadpositie per (kwaliteit, kleur)" met SQL-RPC `voorraadposities()` als seam. Drie modi: single-paar (incl. ghost), batch (alleen eigen voorraad), batch+filter (server-side ILIKE op kw / search; exact op kleur). Consumers: **product-detail** (T001 single-paar), **rollen-overzicht** (T003 batch+filter — `RollenGroepRow` consumeert `Voorraadpositie` direct, page-laag mergt ghost-paren via `besteld_per_kwaliteit_kleur`), **MaatwerkLevertijdHint** (T002 — single-paar voor besteld-info). Vervangt op termijn de drie losse callers `rollen_uitwissel_voorraad` / `uitwisselbare_partners` / `besteld_per_kwaliteit_kleur` (cleanup in T005, #30). Past binnen ADR-0001 — geen aparte ADR. De **vijfde domein-module is `modules/orders-lifecycle/`** (mig 218) — enige schrijver van `orders.status` + `verzonden_at`, met typed audit-log `order_events`. Drie publieke RPCs (`markeer_verzonden`, `markeer_geannuleerd`, `herbereken_wacht_status`) via interne `_apply_transitie`. Lint-script `scripts/lint-no-direct-orders-status-update.sh` voorkomt regressie. Zie [ADR-0006](adr/0006-order-lifecycle-als-deep-module.md). De **zesde domein-module is `modules/facturatie/`** (mig 223) — bezit factuur-flow vanaf het Verzonden-event tot bezorgde PDF/EDI-INVOIC. Listener op `order_events` (`event_type='pickronde_voltooid' AND status_na='Verzonden'`) i.p.v. de oude `orders.status`-trigger uit mig 118. Frontend-Module met smal-scope verhuizing (pages, components, hooks, queries) + cross-cuts via barrel. Klant-factuurinstellingen (`factuurvoorkeur`, `btw_percentage`, `email_factuur`) blijven op `debiteuren` maar concept-eigenaarschap ligt bij deze Module. Zie [ADR-0007](adr/0007-facturatie-als-deep-module.md). De **zevende domein-module is `modules/maatwerk/`** — bezit de maatwerk-flow (selectors, prijs-/oppervlak-formules, levertijd-hint, m²-prijs-/band-/afwerking-lookups) plus admin-CRUD voor vormen, afwerkingen en m²-prijzen. Hooks-import-seam vanuit `modules/orders/` (geen slot-pattern); SQL `stuk_snij_marge_cm` + view-kolommen op `snijplanning_overzicht` (mig 233) blijven cross-cut, gewicht-resolver blijft eigen SQL-Module. Naam DB-aligned met `is_maatwerk`/`maatwerk_*`-kolommen. Zie [ADR-0009](adr/0009-maatwerk-als-deep-module.md). De **achtste domein-module is `modules/debiteuren/`** — bezit klant-masterdata, afleveradressen, klanteigen-namen-admin en klant-artikelnummers-admin. Naam DB-aligned (`debiteuren`-tabel, `debiteur_nr`-FKs); UI-tekst blijft "Klant", routes blijven `/klanten/...`. **Twee seam-stijlen**: hooks-import voor host-pagina + admin-CRUD; **slot-component `<KlantBenaming/>`** voor cross-Module display van klanteigen-namen-resolutie (orders/facturatie/magazijn-pakbon plaatsen 'm zonder hook-import) — backend-callers gebruiken `resolve_klanteigen_naam`-RPC direct, zonder TS-spiegel. Cross-cuts: tier-berekening blijft SQL-cron, vertegenwoordiger-koppeling consumeert Medewerkers-data, adres-snapshot blijft order-creatie-territorium (komt mee met ADR-0001-uitvoering). Slot-tabs Orders/Prijslijst tussentijds via directe imports — gemarkeerd als technisch krediet. Zie [ADR-0011](adr/0011-debiteur-als-deep-module.md). De **negende domein-module is `modules/confectie/`** — bezit confectie-lane-flow, capaciteit-math, deadline-formule en wekelijkse-planning forward-view. Smal scope (logica-laag); runtime-components/pages consumeren via barrel. De **tiende domein-module is `modules/snijplanning/`** ([ADR-0013](adr/0013-snijplanning-module-en-cache-invalidation-seam.md)) — bezit snijplan-CRUD, status-flow (Wacht → Gepland → Snijden → Gesneden → In confectie → Ingepakt), snijvoorstel-pipeline, rol-afsluiten-RPC-orchestratie, auto-planning en reststuk-/aangebroken-/afval-geometrie. Medium scope: logica-laag (queries/hooks/lib incl. snij-volgorde-derivatie) leeft in `modules/snijplanning/`; runtime-components in `components/snijplanning/` en pages in `pages/snijplanning/` consumeren via barrel. ADR-0013 introduceert tegelijk het **cross-Module cache-invalidation seam**: elke Module die naar buiten consumeerbare React-Query-keys heeft exporteert één publieke `invalidateNa<Domein>Mutatie(qc)`-helper via z'n `cache.ts`. Producers importeren cross-Module-helpers expliciet (geen runtime event-bus, geen centrale registry, geen prefix-magic). Snijplanning's `useVoltooiSnijplanRol` roept zowel `invalidateNaSnijplanMutatie(qc)` als `invalidateNaConfectieMutatie(qc)` aan zodat een gesneden stuk meteen onder "Klaar voor confectie" verschijnt. Cross-Module aanroepen lopen via een **TS-functie-contract** (shared edge-helper of barrel-export), niet via god-Module en niet via HTTP-tussenstappen. Iedere seam wordt afgedwongen met contract-tests die in beide kanten dezelfde fixtures draaien. Beslissing en alternatieven: [ADR-0001](adr/0001-order-voorstel-en-planning-als-twee-modules.md). De **elfde domein-module is `modules/reserveringen/`** ([ADR-0015](adr/0015-reservering-als-deep-module.md)) — bezit de allocator (`herallocateer_orderregel`), handmatige uitwisselbaar-claims, IO-claim-release op annulering, de `producten.gereserveerd`-cache via trigger en de TS-spiegel `berekenRegelDekking` met SQL-contract via `simuleer_dekking()`-RPC zodat dekking-berekening in beide kanten dezelfde fixtures draait. Backend-split: mig 254 vervangt god-orchestratie `herwaardeer_order_status` door drie expliciete aanroepen (Reservering + Order-lifecycle + tijdelijk Reservering voor afleverdatum-sync); de nieuwe Module-eigen RPCs zijn `herwaardeer_claims_voor_order`, `simuleer_dekking` en `boek_io_ontvangst_claims`. Mig 255 vervangt de trigger op `orders.status` door een listener op `order_events`-INSERT — symmetrie met de Facturatie-Module uit [ADR-0007](adr/0007-facturatie-als-deep-module.md). Cross-cuts buiten de Module: de `vrije_voorraad`-formule en de `orderregel_pickbaarheid`-view consumeren Reservering-state zonder eigenaarschap te claimen. Tijdelijk: `sync_order_afleverdatum_met_claims` blijft binnen Reservering tot de Levertijd-Module bestaat. Cache-seam: `invalidateNaReserveringsmutatie(qc)` via `cache.ts` (ADR-0013-pattern). Lint: `scripts/lint-no-direct-order-reserveringen-write.sh` voorkomt regressie op directe `order_reserveringen`-writes buiten de Module. De **twaalfde domein-module is `modules/inkoop/`** ([ADR-0017](adr/0017-inkoop-als-deep-module.md)) — bezit inkooporders, leveranciers en de ontvangst-flow. Medium scope: logica-laag (queries/hooks/mutations) + components + pages. Publieke RPCs (mig 271): `boek_inkooporder_ontvangst_stuks` voor het stuks-pad, `boek_inkooporder_ontvangst_rollen` voor het rollen-pad. Beide hernoemd uit de oude RPC's `boek_voorraad_ontvangst` en `boek_ontvangst` (pure rename — bodies identiek). Stuks-pad delegeert claim-consume aan Reservering's `boek_io_ontvangst_claims` (mig 254, ADR-0015). Oude RPC-namen blijven 1 release als DEPRECATED thin wrappers. Slot-component `<InkoopRegelSamenvatting>` wordt door Reservering's `RegelClaimDetail` geconsumeerd zonder hooks-import — patroon analoog aan `<KlantBenaming>` en `<VervoerderTag>`. Routes blijven `/inkoop` en `/leveranciers` (bookmark-compat), eigendom verhuist naar Module-folder (precedent: Debiteur met `/klanten`-routes). Open backlog: rol-creatie + `voorraad_mutaties`-INSERT verhuist naar toekomstige Voorraad/Producten-Module; inkoopgroepen-pages (klant-attribuut, ondanks de naam) verhuist naar Debiteur-Module; `create_inkooporder`-RPC vervangt initial-bulk-create Python-flow. Lint: `scripts/lint-no-direct-inkooporder-regel-write.sh` + ESLint `no-restricted-imports` beschermen Module-boundary. De **dertiende domein-module is `modules/levertijd/`** ([ADR-0020](adr/0020-levertijd-als-deep-module.md)) — **capaciteit-seam owner**, niet eigenaar van de leverbelofte zelf: `orders.afleverdatum` blijft Order-Module (commit-pad) + Reservering-Module (`sync_order_afleverdatum_met_claims`, IO-claim-sync). De Module bezit uitsluitend het order-niveau-label `orders.levertijd_status` (enum `standaard | eerder_dan_standaard | later_dan_standaard`, mig 276) plus de bevroren referentie-snapshot `orders.standaard_afleverdatum_berekend`; BEFORE-trigger `trg_levertijd_status_recalc` flipt het label automatisch als een IO-vertraging de afleverdatum schuift. **SQL-Module met smal publiek interface** — analoog aan Gewicht-resolver (mig 184-186) — twee RPC's: `levertijd_fit_check(p_regel_ids[], p_gewenste_week)` (mig 277) en `levertijd_snelste_haalbaar(p_regel_ids[])` (mig 277). Voor maatwerk-regels doet de Module een echte capaciteit-match op week-niveau tegen open snijplannen + `app_config.productie_planning`-config (optie B, mig 278 — capaciteit per week, geen `productie_groep`-segmentering in V1); voor voorraad-regels consumeert ze Reservering's `order_regel_levertijd`-view + uitwisselbaar-dekking zonder eigen capaciteit-bron. Werkagenda-rekenkunde (`werkdag_min_n` / `werkdag_plus_n` / `werkagenda_kalender`, mig 279) is **SQL-ground-truth**; de TS- en Deno-spiegels in [`bereken-agenda.ts`](../frontend/src/lib/utils/bereken-agenda.ts) en [`_shared/werkagenda.ts`](../supabase/functions/_shared/werkagenda.ts) blijven als geannoteerde *synchronous-only mirror* alleen voor UI-/edge-rekenwerk dat geen DB-roundtrip mag triggeren. Frontend-folder bevat dunne TS-wrappers (`queries/`, `cache.ts`, `types.ts`), hooks (`useFitCheck` debounced, `useSnelsteHaalbaar` on-demand, `useLevertijdStatus`, `useNeemSnelsteOver`) en components (`LevertijdStatusBadge`, `LevertijdFitIndicator`, `SnelsteHaalbaarKnop`). Slot-component `<LevertijdStatusBadge>` staat naast het ordernummer in order-list en order-detail-header (self-fetchend, analoog aan `<VervoerderTag>`); `order-form` consumeert de live fit-check via barrel-import. Cross-cut buiten de Module: `lever_type`-dag-buffer blijft canoniek in edge `check-levertijd`. **V2-backlog**: confectie-capaciteit-check, `productie_groep`-segmentering, FFDH-passt-check, bevroren leverbelofte-tabel + EDI/factuur/pakbon-consumers van het label.

#### Slot-pattern (presentatie-seam zonder data-coupling)
Wanneer een Module een component uit een andere Module wil renderen zonder bij die Module's data te hoeven, wordt de componente **self-fetching**: de consument plaatst 'm als slot zonder props, en de component haalt zelf zijn state op via een hook uit zijn eigen Module-barrel. Voorbeelden:
- `<VervoerderTag />` in `modules/logistiek/` — pick-context (`OrderPickCard` in `modules/magazijn/`) rendert 'm zonder props; de tag self-fetcht de actieve vervoerder via `useActieveVervoerder()`. Magazijn weet zo niets meer over vervoerders. Voor zending-specifieke weergave (logistiek-pagina's) blijft `<VervoerderTag code={...} />` werken.
- `<LevertijdSuggestie />` — gebruikt door order-form (in `components/orders/`, conceptueel `modules/orders/`-territorium per ADR-0001 — die map bestaat nog niet) zonder dat orders weet wat de planning-database-shape is. Sinds [ADR-0013](adr/0013-snijplanning-module-en-cache-invalidation-seam.md) leeft de logica niet meer in `modules/planning/` (die folder bestond nooit fysiek); de Snijplanning-Module en de Confectie-Module zijn aparte zustermodules.
- `<KlantBenaming />` in `modules/debiteuren/` — orders, facturatie en magazijn-pakbon plaatsen 'm met 4 props (`debiteurNr | inkoopgroepCode`, `kwaliteit`, `kleur`, `fallback`); de component self-fetcht via `useKlanteigenNaam` die `resolve_klanteigen_naam`-RPC aanroept. Backend-callers (factuur-RPC, EDI-builder, pakbon-edge) consumeren dezelfde SQL-RPC direct — twee adapters maken het een echt seam, geen TS-spiegel van de 5-niveaus fallback.

Dit is duurder in queries (elke instance fetcht zelf) maar voorkomt dat seams datamodellen in beide richtingen koppelen.

#### ISO-week-kern + verzendweek-seam (orderdomein)
**Twee lagen, sinds 2026-06-07 gescheiden:**

1. **Rekenkern** — [`lib/utils/iso-week.ts`](../frontend/src/lib/utils/iso-week.ts) is de single source of truth voor "welke ISO-week hoort bij deze datum". **UTC-gebaseerd en TZ-onafhankelijk** (strippt de tijdcomponent), zodat een `DATE`-veld rond middernacht/jaargrens nooit een ander weeknummer geeft dan de SQL-referentie `to_char(date,'IW')` (mig 145/228). Exporteert `isoWeekJaar`/`isoWeek`/`isoWeekString`/`isoWeekMaandag`/`maandagVanIsoWeek`/`isoWeekRange` + string-helpers `isoWeekJaarVanIso`/`isoWeekStringVanIso`/`isoWeekFromString`. **Wall-clock "nu"**: de kern leest UTC-componenten, dus een rauwe `new Date()` zou in NL (UTC+1/+2) tussen lokaal 00:00–02:00 op de vóórgaande UTC-dag landen → verkeerde week. Helper `lokaleDatumAlsUtc(d)` verankert de **lokale** kalenderdatum op UTC-midnacht; alle today-vergelijkingen (`pickStatusVoor`, `bucketVoor`, `genereerWeekTabs`, `verzendWeekRelatief`) draaien hun `vandaag` daardoorheen. Edge functions delen geen module-import met de frontend en hebben een **identieke Deno-spiegel** [`_shared/iso-week.ts`](../supabase/functions/_shared/iso-week.ts) (geconsumeerd door `levertijd-capacity`, `spoed-check`, `levertijd-match`, `stuur-orderbevestiging`) — `lokaleDatumAlsUtc` zit daar bewust niet in (edge draait in UTC, lokaal == UTC). Beide kernen worden door eigen test-sets bewaakt (jaargrens, week 53, padding, TZ-robuustheid, SQL-pariteit); houd ze synchroon — SQL is de overkoepelende waarheid. Vóór deze consolidatie bestonden ≥6 frontend- + 3 edge-kopieën, deels op lokale tijd (latente off-by-one op een leverbelofte-veld).

2. **Domein-seam** — [`lib/orders/verzendweek.ts`](../frontend/src/lib/orders/verzendweek.ts) is de single source of truth voor de mapping `orders.afleverdatum` → ISO-verzendweek. Karpi-context: een afleverdatum 06-05 betekent semantisch "verzonden in week 19", niet "geleverd op 6 mei". Magazijn (pick & ship — week-groepering, achterstallig-detectie), logistiek (zendingen, pakbon-WK-tag) en order-UI consumeren dezelfde NL-label-helpers (`verzendWeekVoor`, `verzendWeekSleutel`, `verzendWeekLabel` → "Verzendweek 19", `verzendWeekKort` → "Wk 19", `isoWeek`/`isoMaandag` als domein-alias op de kern). De wéék-berekening zelf delegeert naar laag 1; verandert ooit de mapping (bv. shift voor specifieke vervoerders, of expliciete `verzenddatum`-kolom), dan gebeurt dat hier en nergens anders.

#### Atomic-RPC-pattern voor multi-step state-mutaties
Wanneer een UI-actie meerdere DB-rijen moet aanpassen (vinden-of-maken + updaten), is twee opeenvolgende client-side calls fragiel: faalt de tweede dan blijft een dangling rij van de eerste achter. Centraliseer in één plpgsql-RPC. Voorbeeld: `set_locatie_voor_orderregel` (mig 0183) bundelt `INSERT magazijn_locaties ON CONFLICT` + `UPDATE snijplannen.locatie` voor `useUpdateMaatwerkLocatie`. Eén RPC = één transactie = atomair. Zie ADR-0002 ("Locatie-mutaties — pragma, geen seam-leak-fix").

### debiteur_nr als INTEGER PK (niet UUID)
Alle bronbestanden, logo-bestanden (`{debiteur_nr}.jpg`), klanteigen namen, orders, en afleveradressen verwijzen naar het debiteurnummer uit het oude systeem. UUID zou een onnodige mapping-laag toevoegen.

### artikelnr als TEXT PK (niet INTEGER)
Hoewel alle huidige artikelnummers numeriek zijn, is TEXT veiliger voor toekomstige codes.

### Adres-snapshots in orders
Orders slaan factuur- en afleveradressen op als kopie (snapshot), niet als FK naar afleveradressen. Dit voorkomt dat latere adreswijzigingen historische orders raken.

### Kwaliteitscode als centraal concept
De `kwaliteit_code` (3-4 letters uit de karpi_code) is de spil tussen producten, rollen, collecties en klanteigen namen. Het verbindt alles in het domein.

### Gewicht-bron op kwaliteit-niveau (mig 184–186, 2026-05-06)
Density (`gewicht_per_m2_kg`) leeft uitsluitend op `kwaliteiten` — geen kleur-, geen artikelnr-override. `producten.gewicht_kg` en `order_regels.gewicht_kg` zijn **gederiveerde caches**, onderhouden door triggers (`trg_kwaliteit_gewicht_recalc` → `trg_product_gewicht_recalc`). Cascade raakt alleen open orders; verzonden orders blijven historisch correct via `zendingen.totaal_gewicht_kg`-snapshot. Bij NULL kwaliteit-density valt de cache terug op legacy `producten.gewicht_kg` met flag `gewicht_uit_kwaliteit=false` — zichtbaar via `<GewichtBronBadge>` op product-detail. Voor maatwerk-vormen geldt **bbox-oppervlak** voor zowel prijs als gewicht (rond = `diameter²`). Resolver-functies `gewicht_per_m2_voor_kwaliteit`, `bereken_product_gewicht_kg`, `bereken_orderregel_gewicht_kg` zijn de smalle publieke API; alle gewicht-callers gaan voortaan hierdoor (geen verspreide `oppervlak × density`-formules meer).

### Admin-pseudo-orderregel als data-driven concept (ADR-0018, mig 272-273, 2026-05-13)
VERZEND/BUNDELKORTING/DREMPELKORTING zijn administratieve orderregels zonder voorraad-/IO-/levertijd-keten. Eén boolean (`producten.is_pseudo`) is de bron-van-waarheid; SQL-helper `is_admin_pseudo()` en TS-helper `isAdminPseudo(regel)` vervangen 15+ hardcoded string-lijsten. Toekomstige admin-pseudo's = pure DB-INSERT. `SHIPPING_PRODUCT_ID='VERZEND'` blijft als constant voor de unieke toe-voeg-semantiek (`applyShippingLogic`), niet voor skip-detectie. Lint-script + ESLint-regel voorkomen regressie naar hardcoded strings.

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

### Gedeelde formatters & datum-helpers
- [`lib/utils/formatters.ts`](../frontend/src/lib/utils/formatters.ts) is de centrale plek voor NL-presentatie: `formatCurrency`, `formatDate` (DD-MM-YYYY), `formatNumber`, `formatPercentage` en sinds 2026-06-07 **`formatDateTime(iso, { seconds? })`** (DD-MM-YYYY HH:MM, optioneel met seconden, null-safe → "—"). Rol je eigen datum/tijd-formattering niet meer per component — importeer uit hier (voorheen 5 component-lokale kopieën met afwijkende output).
- Week-uit-datum: zie de ISO-week-kern hierboven ([`lib/utils/iso-week.ts`](../frontend/src/lib/utils/iso-week.ts)), niet inline herberekenen.

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

## Import scripts (`import/`)

Python 3-scripts (pandas/openpyxl/supabase-py) draaien **los, vanuit de map
`import/`** als working dir; zo resolven zowel `from config import ...` als de
gedeelde helpers `from lib.x import y` (geen pakket-installatie nodig).

### Gedeelde helpers in `import/lib/` (2026-06-07)
Eén bron van waarheid voor de batch- en normalisatie-logica die voorheen
massaal (14× `upsert_batch`, ~6× numpy-`clean`, 3× `norm`/`clean_gln`)
gekopieerd stond. Nieuw import-script = **importeren, niet kopiëren**.

- [`lib/supabase_helpers.py`](../import/lib/supabase_helpers.py):
  `create_supabase_client()`, `upsert_batch(sb, table, records, *, mode="upsert"|"insert", on_conflict=...)`,
  `batch_delete`, `batch_select`. `sb` is altijd de **expliciete
  eerste parameter** (geen verborgen globale) → testbaar met een mock-client.
  De `mode="insert"`-tak maakt de oude stille `.insert()`-afwijking in
  `reimport_orders_2026.py` expliciet i.p.v. verstopt onder de naam "upsert".
- [`lib/normalize.py`](../import/lib/normalize.py): `norm`,
  `clean_value(v, *, date_fmt=None|'%Y-%m-%d'|'iso')`,
  `clean_gln(g, *, strict=False)`. Gedragsverschillen die scripts echt nodig
  hebben worden via een parameter overbrugd (datum-formaat per script;
  `strict=True` voor het Transus-adresboek dat álle niet-cijfers uit de GLN
  strpriped), niet via een geforceerde merge.
- Bestaande leaf-modules `lib/snijlijst_parser.py` + `lib/strip_allocator.py`
  blijven naast de nieuwe helpers staan.

Unit-tests in [`import/tests/`](../import/tests/) (`pytest`, `pythonpath=.`):
`test_supabase_helpers.py` (mock-`sb` bewijst upsert-vs-insert-pad + chunking)
en `test_normalize.py` (NaN/NaT/numpy + beide date-formats + `clean_gln`-strict).

## EDI / Transus Flow

Alle EDI-verkeer loopt via `edi_berichten` als audit- en queue-tabel.

**Inkomend:** `supabase/functions/transus-poll` pollt Transus M10110 met `CRON_TOKEN`, decodeert het bericht via `_shared/transus-soap.ts`, detecteert Karpi fixed-width ORDERS en parseert via `_shared/transus-formats/karpi-fixed-width.ts`. De parser accepteert echte Transus-bestanden waarvan trailing spaces zijn afgekapt (header 462/463, artikel 280/281). Na verwerking wordt M10300 aangeroepen en schrijft `markeer_edi_ack` `ack_status`, `ack_details` en `acked_at` terug. Ordercreatie via `create_edi_order` matcht artikelen met `match_edi_artikel` en prijst regels via `debiteuren.prijslijst_nr -> prijslijst_regels`; alleen als daar geen prijs staat valt de RPC terug op `producten.verkoopprijs`.

**Uitgaand:** de EDI-bevestig-flow bouwt orderbevestigingen als TransusXML (`<ORDERRESPONSES>`) en zet die XML direct in `edi_berichten.payload_raw` met `richting='uit'`, `berichttype='orderbev'`, status `Wachtrij` en `order_response_seq`. Facturen gebruiken Karpi fixed-width INVOIC (1107-byte header + 312-byte regels), gebouwd in `supabase/functions/_shared/transus-formats/karpi-invoice-fixed-width.ts` op basis van echte BDSK-voorbeelden. `factuur-verzenden` queue't zo'n EDI-factuur automatisch wanneer `edi_handelspartner_config.transus_actief=true` en `factuur_uit=true`; e-mail blijft mogelijk naast EDI, maar is niet vereist voor EDI-only debiteuren. `supabase/functions/transus-send` claimt alle uitgaande wachtrij-rijen via `claim_volgende_uitgaand()`, verstuurt `payload_raw` ongewijzigd via M10100, en markeert succes met `markeer_edi_verstuurd` of retry/fout met `markeer_edi_fout`.

Handmatige pre-cutover-validatie blijft beschikbaar via `/edi/berichten`: echte `.inh` uploaden, order aanmaken, orderbev queue'en en de TransusXML downloaden voor Transus Online "Bekijken en testen".

**Frontend-organisatie (vanaf 2026-04-30):** alle EDI-frontend-code leeft onder [`frontend/src/modules/edi/`](../frontend/src/modules/edi/) als één feature-module (`pages/`, `components/`, `hooks/`, `queries/`, `lib/`). Externe consumers (klanten-, orders-modules, router, sidebar) importeren via de barrel `@/modules/edi`. **Berichttype-registry** [`registry.ts`](../frontend/src/modules/edi/registry.ts) is bron-van-waarheid voor de vier types (`order`, `orderbev`, `factuur`, `verzendbericht`); UI-componenten itereren over `getBerichttypenVoorRichting(...)` i.p.v. hard-coded lijsten. Backend (poll/send edge functions) gebruikt de registry nog niet — V2-werk: spiegel naar `supabase/functions/_shared/edi/registry.ts`.

## Logistiek-module

Karpi verzendt met **drie vervoerders**: HST (REST API), Rhenus (EDI) en Verhoek (EDI). Dit document beschrijft de end-state vanaf migraties 169–173, waarin de **HST-koppeling** is opgeleverd; de twee EDI-vervoerders volgen in latere plans en gebruiken straks de bestaande `edi_berichten`-tabel met `berichttype='verzendbericht'`. Vervoerder-keuze leeft sinds [ADR-0008](adr/0008-vervoerder-keuze-als-deep-module.md) per orderregel — bron-van-waarheid is `order_regels.vervoerder_code` (override) + `vervoerder_selectie_regels` (regel-engine), met ladder `override → regel → geen`. Geen klant-fallback meer.

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
                                                              │ zendingen.vervoerder_code      │
                                                              │ (gematerialiseerd door         │
                                                              │ start_pickronden_voor_order op │
                                                              │ basis van per-orderregel-      │
                                                              │ resolver, ADR-0008) en         │
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

Vanaf `/pick-ship` kan een magazijnmedewerker op een volledig pickbare order de actie **Verzendset** starten. De frontend roept `start_pickronden_voor_order(p_order_id, p_picker_id)` aan (mig 220); die groepeert orderregels op effectieve vervoerder uit `effectieve_vervoerder_per_orderregel` (mig 219+221+225, ladder `override → regel → geen`) en maakt **per unieke vervoerder één zending** — een order met `[UPS, DPD]`-regels splitst dus in twee zendingen. Vanaf de pick-card kan de operator de pill `VervoerderInlineSelect` gebruiken om alle regels van een order in één klik te overrulen via `set_orderregel_vervoerder_override_voor_order` (mig 227, bulk-RPC). De `/logistiek/:zending_nr/printset` opent met de gematerialiseerde `zendingen.vervoerder_code` per zending. Die printset bevat per colli een verzendsticker met GS1-128/SSCC-barcode en vervoerderbadge, plus een A4-pakbon met orderregels, aantallen, afleveradres en colli/gewicht-samenvatting. De zending-trigger blijft de bron voor automatische dispatch naar de adapter; de printset is de magazijn-output voor de fysieke zending.

### Belangrijkste design-besluiten

- **Adapter-pattern, géén gegeneraliseerde queue-tabel.** HST krijgt z'n eigen tabel `hst_transportorders` met HST-specifieke kolommen (`extern_transport_order_id`, `request_payload`, `response_payload`, `response_http_code`, retry/status). EDI-vervoerders hergebruiken straks `edi_berichten` met `berichttype='verzendbericht'`. Reden — *deletion-test*: als een hypothetische `vervoerder_berichten`-tabel werd weggehaald, zou complexiteit voor de EDI-vervoerders niet toenemen (die zit al in `edi_berichten`); alleen HST-complexiteit zou ergens heen moeten — naar een eigen tabel. Dat doen we dus meteen, zonder shallow-abstraction-tussenlaag.
- **Single switch-point in `enqueue_zending_naar_vervoerder`.** PL/pgSQL-functie van ~30 regels is de enige plek in de codebase waar op `vervoerder_code` wordt geswitcht. Trigger, frontend en edge function zijn vervoerder-blind óf vervoerder-specifiek — geen tussenlaag. Bij vervoerder #4 voeg je één `WHEN`-tak toe en je weet zeker dat je niets vergeet.
- **Verticale folder per vervoerder.** Alle HST-files leven in [`supabase/functions/hst-send/`](../supabase/functions/hst-send/) — payload-builder, HTTP-client, types, fixtures. Géén HST-types in `_shared/`. Bij toekomstige Rhenus-vertical: nieuwe map `supabase/functions/rhenus-send/` met dezelfde interne structuur.
- **HST-tracking → `zendingen.track_trace`.** Na 200-respons schrijft `markeer_hst_verstuurd` het `transportOrderId` (of `trackingNumber` als HST dat al heeft) terug op `zendingen.track_trace` en promoveert de zending-status van `'Klaar voor verzending'` naar `'Onderweg'`.
- **Vervoerders-tabel als enum-light.** Lookup-tabel i.p.v. PostgreSQL-enum omdat we per vervoerder metadata nodig hebben (display-naam, kleur, type). Migratie 170 zaait 3 rijen; alleen `hst_api` wordt actief gezet bij cutover.
- **Trigger-bron is `zendingen.status`, niet `orders.status`.** Eén order kan in V2 in meerdere zendingen splitsen met verschillende leverdata — de zending is de werkelijke fysieke eenheid die HST ophaalt.
- **Cron-frequentie:** edge function `hst-send` draait elke minuut via pg_cron (mig 173).

Voor implementatiedetails (taak-volgorde, fixtures, payload-shape, retry-strategieën): zie [`docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md`](superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md).

### HST-observability + altijd-een-vervoerder ([ADR-0030](adr/0030-altijd-een-vervoerder-en-hst-default-carrier.md))

Bij het productie-klaar maken van de HST-koppeling (mig 336-339) zijn twee gaten gedicht — additief bovenop de vervoerder-ladder uit ADR-0008, zonder de resolver te wijzigen.

**Altijd een vervoerder (default-carrier).** HST is de enige actieve koppeling, dus is `hst_api` de **default binnen NL** via een **catch-all** rij in `vervoerder_selectie_regels` (prio `99999` = laagste, conditie `{"land":["NL"]}`, notitie "Default-vervoerder binnen NL"). De bestaande ladder `override → regel → geen` levert HST nu als bodem; specifieke regels (lagere prio) winnen nog steeds — geen resolver-edit. De expliciete administratieve bron-van-waarheid is `vervoerders.is_default` (partial unique index `uk_vervoerders_is_default` → hooguit één TRUE). De catch-all-INSERT is **gegate op `hst_api.actief=TRUE`** — bewust nog FALSE tot de cutover, dus de default wordt pas dan effectief. Orders waarvan een regel buiten het HST-bereik valt blijven `bron='geen'` → "handmatig vervoerder kiezen" (nu expliciet zichtbaar i.p.v. stille terugval). Een tweede vervoerder = eigen regels + `is_default` omzetten, geen code-edit.

**Pre-flight validator-seam.** Vóór de HST-POST controleert de pure validator `valideerVoorVervoerder(ctx) → {ok, problemen[]}` ([`_shared/vervoerder-eisen.ts`](../supabase/functions/_shared/vervoerder-eisen.ts), codes `TELEFOON_ONTBREEKT` / `ADRESVELD_LEEG` / `LAND_BUITEN_BEREIK`, const `HST_LANDEN_BEREIK=['NL']`) of de zending aan de vervoerder-eisen voldoet — faalt een eis dan gaat de transportorder direct op `Fout` met heldere reden, geen kansloze HST-call. De validator is gespiegeld als frontend-kopie [`frontend/src/lib/orders/vervoerder-eisen.ts`](../frontend/src/lib/orders/vervoerder-eisen.ts) omdat Deno-edge-code niet door Vite importeerbaar is — zelfde seam-patroon als [`_shared/debiteur-matcher.ts`](../supabase/functions/_shared/debiteur-matcher.ts) ↔ de frontend `product-matcher`-spiegel.

**Observability-keten (reaper + monitor + cron-health).** Net als de EDI poll silent failure kon de `hst-send`-cron stilvallen of een transportorder mid-claim op `'Bezig'` laten hangen zonder signaal. Drie ingrepen:

- **Self-healing reaper** — RPC `herstel_vastgelopen_hst(p_minuten INTEGER DEFAULT 10)` (mig 337, SECURITY DEFINER) zet `hst_transportorders`-rijen die >`p_minuten` op `'Bezig'` hangen terug naar `'Wachtrij'`. Bovenin élke `hst-send`-run aangeroepen + handmatig.
- **Aggregaat-monitor** — view `hst_verzend_monitor` (één rij, geen state): `verstuurd_vandaag`, `fout_open`, `wachtrij`, `bezig`, `oudste_wachtrij_minuten`, `oudste_bezig_minuten`. De laatste twee zijn het **cron-health-signaal** (hoog = verzend-cron staat stil; UI-drempel 5 min).
- **Handmatig-nodig-monitor** — view `orders_zonder_vervoerder` voedt de "handmatig vervoerder kiezen"-teller.

**Frontend.** Module `logistiek`: query's + helpers (`cronVermoedelijkStil`, `telHstAandacht`, `countOrdersZonderVervoerder`) in [`queries/hst-monitor.ts`](../frontend/src/modules/logistiek/queries/hst-monitor.ts), TanStack-hooks (refetchInterval 30s/60s) in [`hooks/use-hst-monitor.ts`](../frontend/src/modules/logistiek/hooks/use-hst-monitor.ts), de HST-verzendmonitor als tab **"Verzendmonitor"** op de vervoerder-detailpagina van HST — route `/logistiek/vervoerders/hst_api/monitor` ([`components/hst-monitor-panel.tsx`](../frontend/src/modules/logistiek/components/hst-monitor-panel.tsx) — KPI's, open-fouten-tabel met echte `error_msg` + opnieuw-versturen-knop, cron-health-waarschuwing; sinds 2026-06-10 geen eigen menu-item meer, de oude route `/logistiek/hst-monitor` redirect en de rode aandacht-badge zit op het nav-item Logistiek), en de rode/amber [`HstAandachtBanner`](../frontend/src/modules/logistiek/components/hst-aandacht-banner.tsx) op Pick & Ship (spiegelt het `EdiTeKoppelenBanner`-patroon).

**HST-edge-bugfixes.** `hst-client.ts` `extractErrorMsg` leest nu ook HST's PascalCase-veld `ErrorMessage` (operator kreeg eerder kaal `"HTTP 400"`); `payload-builder.ts` vult `ToAddress.PhoneNumber` uit het nieuwe snapshot `zendingen.afl_telefoon` (mig 339, was hardcoded leeg). Aanleiding: ACCP-afkeuring 2026-06-09 "Bellen voor aflevering, geef telefoonnummer op".

### Verhoek-koppeling: AA2.0-XML via SFTP ([ADR-0031](adr/0031-verhoek-xml-sftp-adapter.md), mig 374-376)

Verhoek Europe is de tweede vervoerder naast HST. Hun protocol — eigen XML-formaat "XMLstandardVerhoekEuropeAA20" (AA2.0) over SFTP — past niet in het Transus-EDI-pad. De adapter is gebouwd als **verticale spiegel van de HST-adapter**, met maximaal hergebruik van bestaande seams en bewust gespiegeld (nog niet gegeneraliseerd) omdat HST live en stabiel is.

**Maximaal hergebruik:**
- `_shared/adres-split.ts` — `splitAdres`/`normalizeCountry` geëxtraheerd uit `hst-send/payload-builder.ts` (gedragsneutraal, hst-send importeert voortaan uit de seam; gaat mee bij de eerstvolgende hst-deploy).
- `_shared/vervoerder-eisen.ts` — `verhoek_sftp`-tak toegevoegd naast de bestaande HST-tak; dezelfde `valideerVoorVervoerder(ctx)`-signatuur, andere eisen (adresvelden verplicht; telefoon/land niet verplicht voor Verhoek).
- `enqueue_zending_naar_vervoerder` — switch-RPC-tak `WHEN 'sftp' → enqueue_verhoek_transportorder` (mig 375); geen wijziging aan resolver of trigger.
- `externe_payloads` — audit-vangnet kanaal `'verhoek'` (best-effort, mag verwerking niet blokkeren).
- Storage-bucket `order-documenten/verhoek-xml/` — XML-kopie in dezelfde bucket `order-documenten`, pad `verhoek-xml/` naast `hst-vrachtbrieven/` (ADR-0030-patroon).
- Cron-vault-secret `cron_token` — hergebruikt door `verhoek-send-elke-minuut` (mig 376).

**Gespiegeld (niet gegeneraliseerd):**
- Adapter-tabel `verhoek_transportorders` + enum `verhoek_transportorder_status` + 5 RPC's — identieke structuur als `hst_transportorders`/`hst_transportorder_status`, eigen per-vervoerder-tabel (verticaal patroon, ADR-0031 motivatie).
- Edge function `verhoek-send` — orchestrator-loop (claim → preflight → XML → SFTP-upload → markeer); structuur identiek aan `hst-send` maar protocol volledig anders (XML over SFTP vs. JSON over REST).
- Monitor-view `verhoek_verzend_monitor` — structuur identiek aan `hst_verzend_monitor` (mig 338).
- **Derde vervoerder = moment van generaliseren** (ADR-0031, gevolgen). Nu bewust gespiegeld — abstractie halverwege zou HST destabiliseren.

**Dry-run-mechanisme + config-gedreven go-live.** Alle onbekenden van Verhoek (opdrachtgevernummer, ScanCode-prefix, Levering/SoortLevering-codes, Verpakkingseenheid) leven in `app_config` sleutel `'verhoek'` — antwoorden van Verhoek = SQL-UPDATE, géén redeploy. Secrets `VERHOEK_SFTP_*` + `VERHOEK_DRY_RUN` (default `true` = geen SFTP-upload, wél XML/audit/storage). Go-live = secrets invullen + `app_config.verhoek.opdrachtgever_nummer` zetten + `verhoek_sftp.actief=TRUE` — géén code-deploy.

**Colli-preflight.** `verhoek-send/xml-builder.ts` `valideerVerhoekColli` controleert per colli of SSCC, lengte/breedte (cm) en gewicht_kg gevuld zijn. Ontbrekende velden → rij op `Fout` met `Pre-flight:`-reden, geen upload. Bekende datagap: `zending_colli.gewicht_kg` is NULL bij bestaande zendingen — moet gevuld worden vóór de pilot.

**Bestandsnaam als dedup-sleutel.** `Karpi_<timestamp>_<zending_nr>.xml` wordt gepersisteerd in `verhoek_transportorders.bestandsnaam` vóór de SFTP-upload, zodat retries dezelfde naam hergebruiken. Bij Verhoek is de bestandsnaam de verwerkingssleutel (DataEntry deduplicatie).

**Status Fase 1 (2026-06-11):** code compleet + unit-getest. Mig 374/375/376 apply'en, edge functions deployen, rebex-runtime-spike draaien en dry-run-rondreis uitvoeren staan open (wordt door Miguel gedaan).

### Vervoerder-Keuze als deep Module ([ADR-0008](adr/0008-vervoerder-keuze-als-deep-module.md))

Vóór de refactor leefde "welke vervoerder geldt voor X" in vier tabellen (`vervoerders.actief`, `vervoerder_selectie_regels`, `edi_handelspartner_config.vervoerder_code`, `order_regels.vervoerder_code`) met drie verschillende fallback-volgordes verspreid over `preview_vervoerder_voor_order` (mig 215), `effectieve_vervoerder_per_orderregel` (mig 219+221) en `selecteer_vervoerder_voor_zending` (mig 210). Plus een vierde ladder in de UI-pill. Bug-symptoom: gebruikers konden DPD kiezen op een order zonder zichtbaar effect (silent failure in upsert naar de misnoemde EDI-tabel + incomplete cache-invalidatie).

**Sinds mig 224/225/227 één seam, één ladder.**

- **Bron-van-waarheid: orderregel.** `order_regels.vervoerder_code` (override) + `vervoerder_selectie_regels` (regel-engine). Klant-fallback bestaat niet meer als concept.
- **Ladder:** `override → regel-evaluator → geen`. Order-niveau is een afgeleide aggregatie (`'uniform'` met code / `'mix'` met breakdown / `'leeg'`).
- **Read-RPC:** `effectieve_vervoerder_per_orderregel(p_order_id)` returnt `(orderregel_id, override_code, evaluator_code, evaluator_service, effectief_code, effectief_service, bron, is_locked, uitleg)`. Bron-domein: `{override, regel, geen, afhalen}`.
- **Write-RPCs:** `update order_regels set vervoerder_code = …` (single-regel, lock-trigger uit mig 219 blokkeert wijziging zodra een open zending naar de regel verwijst) en `set_orderregel_vervoerder_override_voor_order(p_order_id, p_vervoerder_code)` (bulk, mig 227 — vangt `restrict_violation` per regel zodat geblokkeerde regels typed teruggegeven worden, niet als exception).
- **Frontend-Module:** `modules/logistiek` exporteert via barrel `useVervoerderKeuzeVoorOrder` (afgeleide aggregatie, cache-deelt met per-regel-key) en `useSetOrderVervoerderOverride` (bulk-RPC + 6-key invalidation). De pill `VervoerderInlineSelect` schrijft via deze hook met inline foutbanner (geen toast-library nodig). De `VervoerderOrderregelPill` op detail-niveau gebruikt single-regel-write.
- **Materialisatie op zending:** `start_pickronden_voor_order` (mig 220) leest `effectieve_vervoerder_per_orderregel`, groepeert op effectief_code en maakt per unieke code één zending — daarom kan een order met multi-vervoerder splitsen in N zendingen. `selecteer_vervoerder_voor_zending` (mig 210) is intussen vervoerder-blind; krijgt z'n input van de RPC hierboven, niet meer van een eigen ladder.
- **Eenmalige data-migratie (mig 224):** bestaande klant-fallbacks zijn auto-vertaald naar `vervoerder_selectie_regels` met conditie `{debiteur_nrs: [X]}` en prio 9000. Operator beheert ze daarna via `/verzendregels`. De klant-detail-tab "Vervoerder" is verwijderd — geen UX-affordance meer voor het oude concept.

**Migratie-keten:** mig 224 (data-migratie naar regels) → mig 225 (ladder versimpelen, `is_locked` behouden) → mig 227 (DROP COLUMN `edi_handelspartner_config.vervoerder_code` + drop preview-RPC + bulk-override-RPC).

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

**Snij-marges** (single source of truth: SQL-functie `stuk_snij_marge_cm` in migratie 126 — sinds mig 233 zijn er geen TS-spiegels meer):
- `maatwerk_afwerking = 'ZO'` → **+6 cm** op beide dimensies (rondom 6 cm voor afwerking)
- `maatwerk_vorm IN ('rond', 'ovaal')` → **+5 cm** op beide dimensies (speling voor handmatig uitzagen)
- Combi ZO + rond: **grootste marge wint** (niet cumulatief)

De marge wordt eenmalig in SQL toegepast en aan callers geleverd via twee view-kolommen op `snijplanning_overzicht` met gerichte semantiek: **`marge_cm`** voor operator-tekst ("hoeveel bijsnijden") en **`placed_lengte_cm`/`placed_breedte_cm`** voor de packer ("welke afmeting plaatsen"). `fetchStukken()` leest de placed-kolommen direct, geen TS-helper meer. `snijplanning_tekort_analyse()` past dezelfde SQL-functie inline toe bij de rol-past-check. De originele `snij_lengte_cm`/`snij_breedte_cm` blijven nominale (klant-)maat — de modal kan dus nog altijd `placed vs besteld` uit elkaar trekken. Regressie-bescherming voor `stuk_snij_marge_cm` zit als `DO $$ ASSERT … $$`-blok in mig 233 (vervangt de oude Deno-test).

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

### Klant-PO parsing (order uitvullen vanuit PDF)
Edge function `parse-klant-po` (`supabase/functions/parse-klant-po/`) laat medewerkers een klant-inkooporder-PDF uploaden vanuit de `DocumentenBuffer` op de order-aanmaakpagina en vult het order-formulier automatisch voor. De flow bestaat uit twee gescheiden lagen:

1. **Extractie (`_shared/po-extract.ts` — puur, getest):** stuurt de PDF naar de Claude Messages-API en ontvangt ongestructureerde ruwe tekst (debiteurgegevens, regels, aantallen). Geen DB-aanroepen; eenvoudig te unit-testen.
2. **Deterministische koppeling — RPC `match_klant_po` (mig 294):** matcht de ruwe extractie tegen de database zonder AI-heuristieken. Debiteur via btw → e-maildomein → exacte naam (telkens precies 1 hit = `zeker`, anders geen debiteur; alleen actieve debiteuren). Per regel: kwaliteit via **reverse-lookup op `klanteigen_namen.benaming`** (debiteur-/inkoopgroep-scoped) én exacte `kwaliteiten.omschrijving` — *niet* `resolve_klanteigen_naam` (die resolver werkt in de tegengestelde richting); kleur via numeriek suffix; artikel via `klant_artikelnummers` en `producten`. Debiteur en elke regel dragen een eigen `zeker`-label (geen per-veld-label). STABLE, geen side-effects. GRANT anon/authenticated/service_role.

**Frontend (`@/lib/orders/po-prefill`):** vult uitsluitend `zeker`-velden in de `initialData`-structuur. `OrderCreatePage` geeft een nieuwe `key` aan `OrderForm` zodat het formulier hermount met de voorgevulde data — geen auto-opslag, de medewerker controleert en slaat handmatig op. UI-entry: "📄 Order uitvullen"-knop per PDF in `DocumentenBuffer` + samenvattingsbanner.

**Auth:** `parse-klant-po` is gedeployed met `verify_jwt = false` (patroon identiek aan `check-levertijd`). Vereist secret `ANTHROPIC_API_KEY` op de edge-functie-omgeving (handmatig gezet via Supabase Dashboard → Edge Functions → Secrets).

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

### Gedeelde order-intake-seam (inbound → orderregels)
De drie Deno-webhook-kanalen (Shopify, Lightspeed-webhook, Lightspeed-cron) bouwen hun orderregels via gedeelde helpers in [`_shared/order-intake/`](../supabase/functions/_shared/order-intake/) (2026-06-09):
- **`gewicht.ts`** — `kgVanLightspeedGewicht(raw)`: één gewicht-normalisatie (micro-kg → kg, NUMERIC(8,2)-begrenzing). Loste een factor-1000-bug op: de webhook deelde door 1e6, de cron foutief door 1e3 op identieke brondata.
- **`types.ts`** — `IntakeRegel`, het gedeelde regel-shape (vervangt het ad-hoc `regels: unknown[]` per kanaal); komt 1-op-1 overeen met de kolommen die `create_webshop_order(p_regels)` verwacht.
- **`lightspeed-regels.ts`** — `buildLightspeedRegels(supabase, rows, debiteurNr)` + pure `toIntakeRegel(...)`: één regelbouw voor beide Lightspeed-paden (waren near-duplicate `buildRegels`, dreven uiteen op gewicht-conversie, `maatwerk_vorm` en omschrijving-opbouw).

**EDI valt bewust buiten deze seam**: dat kanaal bouwt zijn regels in SQL (`create_edi_order`), niet in een Deno-adapter. De gedeelde SQL-insert-kern (de drie insert-RPC's laten convergeren) is een apart vervolgbeslispunt, nog niet ingepland.

### Gedeelde debiteur-matcher-seam (inbound → `debiteur_nr`)
Alle inbound-kanalen (EDI, Shopify, e-mail, webshop/Lightspeed) mappen een binnenkomende order naar een `debiteur_nr` via één gedeelde module [`_shared/debiteur-matcher.ts`](../supabase/functions/_shared/debiteur-matcher.ts), spiegelbeeld van `product-matcher.ts`. Result-interface `DebiteurMatch{debiteur_nr, bron, zeker}`. Bouwstenen (één implementatie, getest): `normaliseerNaam`, `glnVarianten` (`.0`-tolerant), `isActieveDebiteur`/`ACTIEF_OR_FILTER` (= `status <> 'Inactief'` mét NULL meegerekend), `matchDebiteurOpGln` (5-staps GLN-ladder voor EDI), en `matchDebiteurViaEnv(envKey)` voor de vaste-verzameldebiteur-kanalen.

**`zeker`-vlag = uniekheids-gate, alleen op fuzzy** (bedrijfsnaam-deelmatch / e-mail → `zeker:false`; GLN / expliciet nr / exacte naam → `zeker:true`). Een onzekere match **blokkeert de order niet**: hij wordt aangemaakt mét `orders.debiteur_zeker=false` + `orders.debiteur_match_bron` (mig 322). Het orders-overzicht toont dan een amber banner + status-tab **"Debiteur te bevestigen"**, en order-detail een bevestig-widget. Predicaat (één bron-van-waarheid in `fetchOrders` + `countTeBevestigenDebiteurOrders` + de JS-conditie op order-detail): `debiteur_zeker=false AND (debiteur_match_bron IS NULL OR debiteur_match_bron <> 'env_fallback') AND status <> 'Geannuleerd'` (NULL-safe). **`env_fallback` (verzameldebiteur) valt bewust af** — voor consumenten-webshops met wisselend afleveradres is dat de verwachte eindbestemming, geen fout. Onderscheid: dit is order-niveau ("debiteur geraden"), versus EDI's **"Te koppelen"** (bericht-niveau, géén order) en EDI's **"Te bevestigen"** (leverweek). Detail: zie de CLAUDE.md-bullet "Gedeelde debiteur-matcher-seam" + [plan](superpowers/plans/2026-06-07-gedeelde-debiteur-matcher-seam.md).

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

### Maatwerk-Module ([ADR-0009](adr/0009-maatwerk-als-deep-module.md))

Sinds 2026-05-08 leeft de maatwerk-flow als deep verticale Module onder `frontend/src/modules/maatwerk/` met **medium scope**: order-side runtime-flow (selectors, prijs-formule, levertijd-hint, m²-prijs-/band-/standaard-maat-lookups) **plus** admin-CRUD voor vormen, afwerkingen, m²-prijzen en band-kleur-defaults. Eigendom volgt de DB-vocab — folder en docs heten **Maatwerk** (DB-aligned met `is_maatwerk`, `maatwerk_*`-kolommen), niet de oude UI-label "Op Maat".

**Seam-stijl: hooks-import.** [`order-form.tsx`](../frontend/src/components/orders/order-form.tsx) (eigendom van `modules/orders/` per ADR-0001) blijft host van de UI; alle maatwerk-data en -formules komen via barrel-imports uit `@/modules/maatwerk`:

```ts
import {
  useMaatwerkKwaliteitOpties,
  useMaatwerkKleurOpties,
  useVormOpties,
  useKwaliteitM2Prijs,
  useStandaardBandKleur,
  useMaatwerkLevertijdHint,
  computeMaatwerkPrijs,
  computeMaatwerkOppervlak,
} from '@/modules/maatwerk';
```

**Pure commit-helpers (geëxtraheerd uit `order-form.tsx`):** de geld-rekenende split-/verzend-toewijzing-logica uit `saveMutation.mutationFn` leeft sinds 2026-06-09 als pure, geteste functies in [`lib/orders/split-order.ts`](../frontend/src/lib/orders/split-order.ts) — `wijsVerzendNaarDuurste` (verzendregel naar de duurste sub-order, issue #33) en `splitRegelOpDekking` (per-regel directe/IO-splitsing + proportionele bedrag-herberekening). Géén React/I/O; `order-form` importeert ze. Maakt de berekeningen los testbaar zonder de 1000+ regel-component te mounten.

**Cross-cuts (blijven buiten Module):**

- **SQL `stuk_snij_marge_cm` (mig 126) + view-kolommen op `snijplanning_overzicht` (mig 233)** — gedeelde formule voor +5/+6 cm marges (rond/ovaal/ZO/combi). Sinds mig 233 enige bron-van-waarheid; consumers lezen `marge_cm` (operator) of `placed_lengte_cm`/`placed_breedte_cm` (packer) uit de view. Planning's `check-levertijd`, `auto-plan-groep` en `optimaliseer-snijplan` consumeren de placed-kolommen via `_shared/db-helpers.fetchStukken`; Maatwerk's prijs-formule consumeert de SQL-functie indirect via `bereken_orderregel_prijs`. Twee adapters maken het een echt cross-cut, geen Module-eigendom.
- **Gewicht-resolver (mig 184-186)** — eigen SQL-Module met smal interface. Bezit de bbox-vs-cirkel-keuze voor maatwerk-vormen vs catalogus-rond. Maatwerk hoeft geen gewicht-functie te exporteren.
- **`<LevertijdSuggestie>` blijft Planning** — toont snij-/leverdatum met capaciteits-simulatie. Maatwerk-Module heeft de **eigen** `<MaatwerkLevertijdHint>` met andere semantiek (eerstvolgende inkoop + 2 weken buffer, geen capaciteits-simulatie).

**Admin-CRUD verhuist:** routes `/instellingen/vormen` en `/instellingen/afwerkingen` worden vervangen door pages onder `modules/maatwerk/pages/`. Eén release lang blijven beide paden bestaan om bookmarks niet te breken.

**Prijsberekening (formule):** `oppervlak_m² × m²-prijs + vorm-toeslag + afwerkingprijs − korting%`. Oppervlak via bbox-formule (rond → diameter², ovaal → bbox, rechthoek → l × b). m²-prijs uit `maatwerk_m2_prijzen` (admin-instelbaar, geseeded vanuit rollen). Vorm-toeslag €75 voor vormen ≠ rechthoek (mig 179-183). Vorm-weergave via centraal `vorm-labels.ts` systeem (gebruikt door snijplanning, stickers, orders). Rol-producten in ArticleSelector redirecten automatisch naar de maatwerk-flow.

## Facturatie-flow (2026-05-08, [ADR-0010](adr/0010-factuur-volgt-bundel-zending.md))

**Eén factuur per bundel-zending.** Aggregatie volgt de 4-dim bundel-sleutel uit mig 228 — `(debiteur × adres-norm × vervoerder × verzendweek)`. Wekelijkse cron is de enige enqueue-bron; per_zending-modus is gedropt (mig 233).

```
Wekelijkse cron (maandag 05:00 UTC, mig 122):
  pg_cron → enqueue_wekelijkse_verzamelfacturen()
        → per bundel-zending van vorige week zonder factuur:
          INSERT factuur_queue(zending_id, order_ids=[zo.order_id WHERE zo.zending_id=…])

Drain (elke minuut, pg_cron):
  factuur_queue (status=pending)
        │
        ▼  EDGE FN factuur-verzenden
        │
        ├─ atomair claim_factuur_queue_items() (mig 227, FOR UPDATE SKIP LOCKED)
        ├─ RPC genereer_factuur_voor_bundel(zending_id) (mig 234):
        │    · facturen + factuur_regels INSERT
        │    · order_regels.gefactureerd = orderaantal voor regels in zending_orders
        │    · 1× VERZEND-regel via verzendkosten_voor_bundel(deb, subtotaal, is_afhalen)
        │    · BTW-% uit debiteuren.btw_percentage
        ├─ pdf-lib → Uint8Array (Karpi layout, Courier monospace, A4)
        ├─ Storage.upload('facturen/{debiteur_nr}/FACT-YYYY-NNNN.pdf')
        ├─ als EDI actief is voor debiteur:
        │    bouw Karpi fixed-width INVOIC en INSERT edi_berichten(status='Wachtrij')
        ├─ als email_factuur gevuld is:
        │    Storage.download('documenten/algemene-voorwaarden-karpi-bv.pdf')
        │    Resend.emails.send(to=debiteur.email_factuur,
        │      attachments=[factuur-pdf, algemene-voorwaarden])
        └─ facturen.status='Verstuurd', factuur_queue.status='done'

Recovery (elke 5 minuten):
  pg_cron → recover_stuck_factuur_queue()
        → zet factuur_queue-items >10 min in 'processing' terug op 'pending'
```

**Verzendkosten-resolver**: SQL-functie `verzendkosten_voor_bundel(deb_nr, subtotaal, is_afhalen)` (mig 234) returnt `(te_betalen, status, reden)` met status uit `{gratis_afhalen | gratis_klantafspraak | gratis_drempel | betaald}`. Bron-van-waarheid voor de drempel-toets — eerder leefde die in 4 verspreide CASE-takken (view 229, mig 232, order-form, drempel-progressbar).

**Bedrijfsgegevens-config**: `app_config.sleutel='bedrijfsgegevens'` bevat KVK, BTW, IBAN etc. Bewerkbaar via `/instellingen/bedrijfsgegevens`.

**Klant-instellingen**: `debiteuren.btw_percentage` (21.00 standaard; 0 voor EU-intracom/export), `debiteuren.email_factuur`, `debiteuren.verzendkosten`, `debiteuren.verzend_drempel`, `debiteuren.gratis_verzending`. Bewerkbaar in klant-detail → tab "Facturering". `factuurvoorkeur` is gedropt per ADR-0009.

### BUNDELKORTING-artikelnr (mig 256)

Bij `gratis_drempel`-status splitst de factuur in 2 regels:
- `VERZEND` met volle verzendkosten (positief)
- `BUNDELKORTING` met tegenboeking (negatief)

Bron-van-waarheid voor "factuur is bundel-factuur" is `factuur_regels`:
factuur met >1 distinct `order_id` op product-regels (exclusief
VERZEND/BUNDELKORTING). Frontend detecteert via `fetchBundelInfoVoorFactuur`.

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
