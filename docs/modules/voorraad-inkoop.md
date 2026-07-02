# Voorraad, Reservering & Inkoop

> Module-doc: huidige staat + valkuilen. Chronologie: [docs/changelog.md](../changelog.md). Actuele RPC-bodies: [supabase/schema/functies.sql](../../supabase/schema/functies.sql) / [views.sql](../../supabase/schema/views.sql).

## Wat dit is

Dit domein bezit drie samenhangende concepten: **Claim** (harde koppeling orderregel ↔ voorraad/inkooporder-regel, tabel `order_reserveringen`, Reservering-Module), **Inkooporder** (bestelling bij een leverancier, Inkoop-Module) en **Rol/Reststuk** (fysieke rol-voorraad, geen eigen Module maar wel eigen RPC-laag). De allocator (`herallocateer_orderregel`) koppelt orderregels aan eigen voorraad; bij een tekort kiest de gebruiker sinds 2026-06-24 zelf tussen voorraad/inkoop-alternatieven in plaats van dat het systeem automatisch omstickert. `producten.vrije_voorraad` is de "vandaag-leverbaar"-formule die de rest van het ERP (Pick & Ship, orderregel-dekking) consumeert.

## Kernbestanden

| Laag | Pad | Rol |
|---|---|---|
| Frontend-Module | [`frontend/src/modules/reserveringen/`](../../frontend/src/modules/reserveringen/) | Barrel (`index.ts`), `cache.ts` (`invalidateNaReserveringsmutatie`), hooks (`use-reserveringen.ts`: `useClaimsVoorOrder`, `useAllocatieOpties`, …), queries (`reserveringen.ts`, `allocatie-opties.ts`), lib (`dekking-preview.ts` = TS-spiegel van dekking), components (`RegelClaimDetail`, `SubstitutionPicker`, `UitwisselbaarTekortHint`, `UitwisselbaarToepassenRij`, `OntgrendelAllocatieKeuzeRij`, `LevertijdBadge`) |
| Frontend-Module | [`frontend/src/modules/inkoop/`](../../frontend/src/modules/inkoop/) | Barrel, `cache.ts` (`invalidateNaInkoopMutatie`), hooks (`use-inkooporders.ts`, `use-leveranciers.ts`, `use-boek-ontvangst.ts`), queries, components (`InkooporderFormDialog`, `OntvangstBoekenDialog`, `VoorraadOntvangstDialog`, `IORegelClaimsPopover`, `InkoopRegelSamenvatting`-slot, `EtaEditCell`), pages (`inkooporders-overview`, `inkooporder-detail`, `rol-stickers-print`, `leveranciers-overview`, `leverancier-detail`) |
| Frontend-Module | [`frontend/src/modules/voorraadpositie/`](../../frontend/src/modules/voorraadpositie/) | `hooks/use-voorraadpositie.ts`, `queries/voorraadposities.ts` + `ghost-besteld.ts` + `maatwerkvraag-orders.ts`, `lib/normaliseer-kleur.ts`, `types.ts` — voedt de Rollen & Reststukken-pagina |
| Losse frontend (nog niet gemodulariseerd) | [`frontend/src/components/rollen/`](../../frontend/src/components/rollen/), [`hooks/use-rollen.ts`](../../frontend/src/hooks/use-rollen.ts), [`lib/supabase/queries/rollen.ts`](../../frontend/src/lib/supabase/queries/rollen.ts), [`pages/rollen/rollen-overview.tsx`](../../frontend/src/pages/rollen/rollen-overview.tsx) | Rol-/reststuk-CRUD-dialogen (toevoegen/bewerken/verwijderen) |
| Order-mutations | [`frontend/src/lib/supabase/queries/order-mutations.ts`](../../frontend/src/lib/supabase/queries/order-mutations.ts) | `setAllocatieKeuze`, `ontgrendelAllocatieKeuze`, type `AllocatieKeuze` |
| Import | [`import/update_voorraad.py`](../../import/update_voorraad.py) (Basta-voorraadlijst), [`import/import_inkoopoverzicht.py`](../../import/import_inkoopoverzicht.py) (RLS-bypass, TODO-banner) | Excel-imports |
| Tabellen | `order_reserveringen`, `producten` (`voorraad`/`gereserveerd`/`backorder`/`vrije_voorraad`/`besteld_inkoop`/`stuks_artikelnr`/`stuks_per_doos`), `producten_voorraad_correcties`, `rollen`, `rol_mutaties`, `inkooporders`, `inkooporder_regels`, `leveranciers` | Kern-datamodel — zie [database-schema.md](../database-schema.md) |
| Views/RPC's | `voorraadposities()`, `order_regel_levertijd` (view), `besteld_per_kwaliteit_kleur()`, `allocatie_opties_voor_artikel()`, `herallocateer_orderregel()`/`_auto()`, `set_allocatie_keuze()`/`ontgrendel_allocatie_keuze()`, `corrigeer_voorraad_handmatig()`, `rol_handmatig_toevoegen()`/`_bewerken()`/`rol_verwijderen()`, `boek_inkooporder_ontvangst_stuks()`/`_rollen()`, `boek_io_ontvangst_claims()` | Canonieke body's in `supabase/schema/functies.sql` |

## Geldende ADR's & specs

- [ADR-0015](../adr/0015-reservering-als-deep-module.md) — Reservering als deep Module; claim-eigendom losgekoppeld van Order-lifecycle en Levertijd.
- [ADR-0017](../adr/0017-inkoop-als-deep-module.md) — Inkoop als deep Module; RPC-rename-symmetrie + slot-pattern naar Reservering.
- [ADR-0024](../adr/0024-handmatige-rol-crud-rpc-laag.md) — Handmatige rol-CRUD via RPC-laag, géén `producten.voorraad`-koppeling.
- [ADR-0026](../adr/0026-bruto-maatwerkvraag-naast-claim-cache.md) — Bruto-maatwerkvraag als pessimistisch planning-cijfer, expliciet los van de Claim-cache.
- [ADR-0027](../adr/0027-deadline-bewuste-claim-swap.md) — Deadline-bewuste claim-swap. **Let op:** de swap-fase die dit ADR beschrijft is sinds mig 497 (2026-06-24) niet meer actief in de allocator — zie Valkuilen.
- Plan: [`docs/superpowers/plans/2026-05-13-inkoop-als-deep-module.md`](../superpowers/plans/2026-05-13-inkoop-als-deep-module.md) (+ [VERIFICATIE](../superpowers/plans/2026-05-13-inkoop-als-deep-module-VERIFICATIE.md))
- Plan: [`docs/superpowers/plans/2026-04-29-inkoop-reserveringen.md`](../superpowers/plans/2026-04-29-inkoop-reserveringen.md)
- Backlog: [`docs/backlog/inkoop-module-followups.md`](../backlog/inkoop-module-followups.md) — open follow-ups uit de ADR-0017-code-review.
- Zie ook [order-lifecycle.md §7](../order-lifecycle.md) voor hoe de allocator per intake-kanaal wordt getriggerd, en [orders.md](orders.md) voor de afleverdatum-sync (mig 153) en de order_status-betekenis-flip (mig 470) — beide *consumeren* Claim-state maar zijn geen eigendom van dit domein.

## Bedrijfsregels (huidige staat)

### Allocator: korte vorm + volledige cascade (mig 497-502, 2026-06-24)

`herallocateer_orderregel(p_order_regel_id)` is de functie die `trg_orderregel_herallocateer` bij élke orderregel-mutatie aanroept — geldt dus voor **alle** intake-kanalen (handmatig/EDI/webshop/e-mail). Sinds mig 497 doet deze **korte vorm** alleen nog:
1. Doos→stuks-vertaling indien `producten.stuks_artikelnr IS NOT NULL` (mig 408, zie onder).
2. Release van niet-handmatige actieve claims op de regel (handmatige claims blijven staan en tellen mee als reeds gedekt).
3. **Stap 1: eigen voorraad** — `LEAST(resterend, voorraad_beschikbaar_voor_artikel(...))`, geïnsert als `bron='voorraad'`.

Een resterend tekort blijft gewoon tekort ("Wacht op inkoop") — er wordt **niet** meer automatisch een uitwisselbaar/equivalent artikel of de oudste open inkooporder geclaimd. De **volledige oude cascade** (Stap 1 → Stap 1.5 alias-voorraad binnen dezelfde uitwisselbare familie → Stap 2 IO op oudste `verwacht_datum`) leeft voort als **`herallocateer_orderregel_auto`**, en wordt alléén aangeroepen:
- na een bevestigde gebruikerskeuze via `set_allocatie_keuze` (voor het niet-gekozen restant van de regel);
- vanuit `bevestig_concept_order` (mig 541/546) bij het bevestigen van een Concept-order, per orderregel.

`ontgrendel_allocatie_keuze` valt bewust terug op de **korte** vorm (niet `_auto`) — anders zou ontgrendelen meteen weer een nieuwe automatische alias/IO-claim triggeren.

### Manuele allocatie-keuze bij tekort (mig 497-502)

Bij een tekort toont de UI (`UitwisselbaarTekortHint` bij aanmaak/bewerken, `UitwisselbaarToepassenRij` op order-detail) drie optietypes uit RPC `allocatie_opties_voor_artikel(artikelnr)`, gesorteerd op levertijd:
1. **Equivalent, nu op voorraad** (`bron='voorraad'`, ander artikel binnen dezelfde uitwisselbare familie — collectie + genormaliseerde kleur + maat + `maatwerk_vorm_code`).
2. **Eigen artikel, wacht op inkoop** (`bron='inkooporder_regel'` op het eigen/stuks-artikel, met ETA).
3. **Equivalent, wacht op zíjn eigen inkoop** (`bron='inkooporder_regel'` op het equivalent-artikel, met ETA).

`eigen_artikelnr` (mig 501, constante kolom) laat de frontend optie 2 van 1/3 onderscheiden zonder zelf de doos→stuks-vertaling (mig 408) te herhalen. De gebruiker kiest een aantal per optie; `set_allocatie_keuze(order_regel_id, keuzes JSONB)` (mig 500) released alle actieve claims op de regel en insert de gekozen opties als `is_handmatig=true` (IO-keuzes gevalideerd tegen `io_regel_ruimte()`), waarna het niet-gekozen restant via `herallocateer_orderregel_auto` verder cascadeert. `OntgrendelAllocatieKeuzeRij` toont een ontgrendel-actie zodra een regel ≥1 actieve handmatige claim heeft; `ontgrendel_allocatie_keuze` release't die en valt terug op de korte vorm.

`set_uitwisselbaar_claims` (mig 154, de oorspronkelijke smalle keuze-RPC) bestaat nog maar heeft **geen actieve callers meer** — `set_allocatie_keuze` heeft 'm vervangen. `handmatige_keuzes_voor_order` (mig 239, uitgebreid mig 502 met `bron`/`inkooporder_regel_id`/`verwacht_datum`) voedt edit-mode-hydratatie zodat een eerder gekozen IO-claim bij een ongewijzigde re-save niet stil naar een voorraad-claim herschrijft.

### Claim-lifecycle & dekking

`order_reserveringen`-rijen hebben `status IN ('actief', 'geleverd', 'released', 'verzonden')` (de `'verzonden'`-status is mig 468, bugfix B2 uit de 2026-07-02-audit: telt óók mee als dekking, anders vals "Wacht op nieuwe inkoop" op deels-verzonden orders). `claim_volgorde` (TIMESTAMPTZ, FIFO) bepaalt wie bij IO-ontvangst eerst bediend wordt — **wie eerst claimt, wordt eerst beleverd**; geen automatische herallocatie tussen orderregels bij een urgentere nieuwe order (zie Valkuilen voor de status van de ADR-0027-uitzondering hierop). `voorraad_beschikbaar_voor_artikel(artikelnr, excl_regel_id)` = `producten.voorraad − backorder − SUM(actieve/verzonden voorraad-claims van andere regels)`. `io_regel_ruimte(io_regel_id)` = `FLOOR(te_leveren_m) − SUM(actieve IO-claims)` (alleen `eenheid='stuks'`).

### `vrije_voorraad`-formule + altijd-in-sync (mig 149, mig 575)

Formule: `vrije_voorraad = voorraad − gereserveerd − backorder` (geen `+ besteld_inkoop`). `gereserveerd` = `SUM(order_reserveringen.aantal)` waar `bron='voorraad'` en `status IN ('actief','verzonden')` (`herbereken_product_reservering`, getriggerd door elke claim-mutatie via `trg_reservering_sync_producten`).

Sinds mig 575 dwingt trigger `trg_producten_sync_vrije_voorraad` (`BEFORE UPDATE OF voorraad, gereserveerd, backorder` op `producten`) de formule af bij **élke** wijziging, ongeacht de bron — niet meer alleen bij claim-mutaties. Handmatige voorraad-correcties lopen daarom verplicht via RPC **`corrigeer_voorraad_handmatig(artikelnr, nieuwe_voorraad, reden)`** (frontend `updateProduct()` routeert hier automatisch naartoe i.p.v. een kale kolom-UPDATE) en loggen in ledger `producten_voorraad_correcties` (van/naar/delta/reden/wanneer/`huidige_actor_email()`).

`import/update_voorraad.py` (periodieke Basta-voorraadlijst-import) zet `producten.voorraad` hard op Basta's fysieke telling, die niets weet van tussentijdse RugFlow-correcties. Bij elke run leest het script open correcties (`verwerkt_in_import_op IS NULL`) en parseert de lijst-datum uit de bestandsnaam:
- correctie **ná** de lijst-datum → Basta kende 'm nog niet → wordt bovenop de nieuwe baseline toegepast, blijft open;
- correctie **vóór** de lijst-datum → Basta's telling heeft 'm al verwerkt → wordt afgesloten (`verwerkt_in_import_op` gezet), niet nogmaals opgeteld.

Zo gaat een correctie nooit verloren en telt hij nooit dubbel.

### Antislip doos-stuks koppeling (mig 408)

Antislip wordt per doos ingekocht maar aan sommige klanten per doos, aan anderen per stuk verkocht. **Stuks-artikel = bron-van-waarheid voor voorraad; doos-artikel = ordering vehicle.** Koppeling via `producten.stuks_artikelnr` + `producten.stuks_per_doos`. Zowel `herallocateer_orderregel` als `_auto` vertalen vóór allocatie `(artikelnr, te_leveren)` naar `(stuks_artikelnr, te_leveren × stuks_per_doos)` als `stuks_artikelnr IS NOT NULL`. Trigger `trg_sync_doos_vrije_voorraad` (`AFTER UPDATE` op het stuks-product) zet `doos.voorraad`/`vrije_voorraad = FLOOR(stuks-waarde / stuks_per_doos)` en `doos.gereserveerd`/`backorder = 0` — bestaande UI/order-form werkt zonder aanpassing op het doos-artikel.

**Inkoop-IO's horen altijd op het stuks-artikel** (in stuks), nooit op het doos-artikel — anders matcht de IO-claim-lookup in Stap 2/optie 2-3 niet. Huidige koppelingen: 900000005 (80×150, 20 st/doos) ↔ 900000020; 900000006 (130×190, 15 st) ↔ 900000021; 900000000 (160×230, 12 st) ↔ 900000022; 900000001 (190×290, 8 st) ↔ 900000023; 900000009 (240×340, 5 st) ↔ 900000024. Open: 900000015 (300×400, 4 st/doos) wacht op stuks-artikel 900000025; 900000018 (60×110) is stuks-only zonder doos.

### Rollen & Reststukken — handmatige CRUD (ADR-0024, mig 290-293)

Drie `SECURITY DEFINER`-RPC's (`rol_handmatig_toevoegen`, `rol_handmatig_bewerken`, `rol_verwijderen`) zijn het **enige** mutatiepad voor de Rollen & Reststukken-pagina. Elke RPC eist een niet-lege `reden`, valideert, muteert en schrijft in dezelfde transactie een auditregel naar `rol_mutaties`. `rol_verwijderen`-guard: alleen toegestaan bij `status='beschikbaar'`, of een los reststuk met `status NOT IN ('gereserveerd','in_snijplan','verkocht','gesneden')`; een rol die in een snijplan zit (`EXISTS ... snijplannen WHERE rol_id = ...`) kan nooit verwijderd worden, en een resterende FK-violation op de `DELETE` (historische voorraad-mutaties/koppelingen) geeft een expliciete fout i.p.v. een kale constraint-error.

**Géén `producten.voorraad`-koppeling voor rol-artikelen.** De pagina toont m²-totalen live via `SUM(rollen)` (RPC `voorraadposities()`); de allocator/`order_reserveringen` bedient alleen `eenheid='stuks'`-artikelen — rol-producten doen daar niet aan mee. Geen enkele RPC/trigger onderhoudt `producten.voorraad` vanuit rollen. Koppelen zou een legacy-kolom muteren die voor rollen nergens gelezen wordt.

### Bruto-maatwerkvraag & Vrij voor nieuw maatwerk (ADR-0026)

Twee extra velden op `voorraadposities()`: `bruto_maatwerkvraag_m2` en `vrij_voor_nieuw_maatwerk_m2`. **Bruto-maatwerkvraag** is een pessimistische planning-projectie per uitwisselbare familie (`collectie_id, genormaliseerde_kleur_code`): `SUM(min(stuk.lengte_cm, stuk.breedte_cm) × kwaliteit.standaard_breedte_cm)` over snijplannen in status `{Wacht, Gepland, Snijden}` — géén packer-simulatie, géén snij-marges (dubbel pessimisme), géén tijdshorizon-filter. Wordt **niet** geschreven naar `order_reserveringen` — puur berekend in de RPC, geen toewijzing.

**V1-formule Vrij voor nieuw maatwerk:** `voorraad m² − Bruto-maatwerkvraag`. Claims (`producten.gereserveerd`) worden **niet** afgetrokken in V1 — die cache is in **stuks**, niet m² (mig 149); 1-op-1-aftrek zou voor vaste-maat-claims een fors fout cijfer geven. `besteld_inkoop` staat bewust **buiten** de KPI als losse pill (analoog aan de mig-149-keuze om IO uit `vrije_voorraad` te halen). UI: Vrij-chip per familie-rij + sorteer-dropdown op de Rollen-pagina (`RollenGroepRow`) — puur inzicht, géén drempel/kleurcodering/auto-trigger in V1.

### Inkoop: ontvangst-RPC's + naming-symmetrie (ADR-0017, mig 271)

Twee parallelle ontvangst-paden zijn hernoemd voor naming-symmetrie: `boek_voorraad_ontvangst` → **`boek_inkooporder_ontvangst_stuks`** (vaste-maten stuks-pad, delegeert claim-consume via `PERFORM boek_io_ontvangst_claims(...)` — die RPC is en blijft **Reservering-eigendom**, Inkoop is consumer) en `boek_ontvangst` → **`boek_inkooporder_ontvangst_rollen`** (rollen-pad: rol-creatie + `voorraad_mutaties`-INSERT). De oude namen bestaan nog als **DEPRECATED thin wrappers** (zie Openstaand/V2 voor de opruimdatum).

Reservering's `RegelClaimDetail` toont per IO-claim-sub-rij een IO-meta-samenvatting via Inkoop's slot-component `<InkoopRegelSamenvatting ioRegelId={...}>` — **direct geïmporteerd** uit `@/modules/inkoop` (amendement op het oorspronkelijke prop-injection-ontwerp; runtime-cycle Reservering↔Inkoop is onproblematisch omdat Vite/Rollup dit zonder fout afhandelen en de data-shapes gescheiden blijven — alleen `ioRegelId: number` steekt over). Batch-prefetch (`usePrefetchInkoopRegelSamenvattingen`) voorkomt N+1 round-trips bij een popover met meerdere IO-claims.

### Inkooporder wijzigen = RPC's met Claim-vloer (mig 601-604, 2026-07-02)

Aanmaken via `create_inkooporder` (transactioneel, ook stuks; besteldatum default `CURRENT_DATE`) — vervangt de RLS-bypassende directe writes van `import/import_inkoopoverzicht.py`. Regel-mutaties lopen via `voeg_/wijzig_/annuleer_/verwijder_inkooporder_regel` — nooit directe writes (ADR-0017).

**Claim-vloer** (CONTEXT.md): verlagen/verwijderen onder `geleverd + verkooporder-claims + snijplan-'Wacht op inkoop'-claims` vereist expliciet `p_vrijgeven=TRUE`; de RPC released dan snijplan-stukken (per-regel-variant van mig 445) + verkooporder-claims (`release_claims_voor_io_regel`) én force-released resterende handmatige claims op die regel (allocator laat die by design nooit los; defensieve post-check blijft als vangnet) zodat orders zíchtbaar terugvallen naar 'Wacht op inkoop'. `verwijder_inkooporder_regel` weigert óók regels met claim-historie (`order_reserveringen` is append-only audit, FK `ON DELETE RESTRICT` — kale DELETE op `inkooporder_regels` is verboden terrein, ook wegens FK `snijplannen.verwacht_inkooporder_regel_id` `ON DELETE SET NULL`).

Ontvangst (mig 603, superset van mig 271): per-rol `locatie` → `rollen.locatie_id`, over-levering >110% vereist bevestiging, karpi_code-only regels (artikelnr NULL) weigeren rol-ontvangst ("Koppel eerst een artikel" — `rollen.artikelnr` NOT NULL + FK, karpi_code niet uniek).

Werkinstructie: [`docs/werkwijze-inkoop.md`](../werkwijze-inkoop.md). **Leveranciersportal** (CONTEXT.md) blijft ETA+notitie-only (portal.karpi.nl = statische `docs/portal/index.html`; de React-portal-routes zijn verwijderd, zie changelog 2026-07-02). ⚠ **Mig 604** (deprecated ontvangst-wrappers droppen, zie Openstaand/V2) draait pas ná merge+deploy, vóór 2026-07-13.

## Valkuilen & gotcha's

- **ADR-0027's claim-swap-fase is sinds mig 497 (2026-06-24) niet meer actief.** ADR-0027 beschrijft dat `herallocateer_orderregel` bij een tekort een voorraad-claim van een andere, later-leverende order kon "afpakken" (EDD-selectie + laatst-passende IO) om een urgentere order te bedienen. Mig 497 heeft `herallocateer_orderregel` teruggebracht tot **alleen** Stap 1 (eigen voorraad) — de swap-fase (die tussen Stap 1 en Stap 2 zat) is daarmee verdwenen uit de live functie-body (geverifieerd in `supabase/schema/functies.sql`; er is geen aparte swap-functie waar de logica naartoe verhuisd zou zijn). De trigger `trg_io_regel_insert_swap_evaluate` en de `deadline_conflict_na_swap`-detectie in `sync_order_afleverdatum_met_claims` bestaan nog en zijn niet fout, maar zijn **functioneel inert** voor nieuwe orders: er worden sinds mig 497 geen nieuwe `claim_geswapt_weg`-events meer aangemaakt om op te reageren. **[ADR-0027](../adr/0027-deadline-bewuste-claim-swap.md), [data-woordenboek.md](../data-woordenboek.md) (term "Claim-swap") en `docs/modules/snijplanning.md`'s ADR-lijst zijn op dit punt nog niet bijgewerkt** — behandel de swap-beschrijving daarin als historisch, niet als huidige gedrag. [order-lifecycle.md §7](../order-lifecycle.md) beschrijft de mig-497-toestand wél correct.
- **`herallocateer_orderregel` ≠ `herallocateer_orderregel_auto` — verwar niet welke waar draait.** De korte vorm draait op élke orderregel-mutatie (alle intake-kanalen, ook automatisch EDI/webshop). De volledige cascade draait **alleen** na een expliciete gebruikerskeuze (`set_allocatie_keuze`) of bij Concept-bevestiging (`bevestig_concept_order`). Een automatisch ingeladen order met tekort wordt dus nooit meer stilletjes omgestickerd — dat was vóór mig 497 wél zo (aanleiding: gebruiker zag een omsticker-label dat hij zich niet kon herinneren gekozen te hebben).
- **`set_uitwisselbaar_claims` (mig 154) is dode code** — bestaat nog in de DB maar heeft geen actieve callers meer sinds `set_allocatie_keuze` (mig 500) 'm heeft vervangen. Niet gebruiken in nieuwe code; niet verwarren met de wél-actieve `set_allocatie_keuze`.
- **Niet te verwarren:** Claim (`order_reserveringen`, fysiek toegewezen materiaal) ↔ Bruto-maatwerkvraag (ADR-0026, planning-projectie). De laatste wordt nooit naar `order_reserveringen` geschreven en telt niet mee in `producten.gereserveerd`.
- **Geen `producten.voorraad`-koppeling voor rol-artikelen** (ADR-0024) — een legacy-kolom die voor rollen nergens gelezen wordt; niet per ongeluk gaan onderhouden.
- **Handmatige voorraad-correctie moet via `corrigeer_voorraad_handmatig`, nooit een kale `UPDATE producten SET voorraad=...`.** De `vrije_voorraad`-trigger (mig 575) herberekent de formule sowieso bij elke wijziging, maar een kale UPDATE mist de audit-ledger (`producten_voorraad_correcties`) én de Basta-import-bescherming — bij de eerstvolgende `update_voorraad.py`-run wordt zo'n ongelogde correctie stil overschreven.
- **`herwaardeer_order_status(order_id)` is de orchestratie-laag boven de allocator** — roept ná elke allocatie-cyclus `herbereken_wacht_status` (Order-lifecycle, status-write) én `sync_order_afleverdatum_met_claims` (mig 153, forward-only afleverdatum-shift) aan. Beide zijn eigendom van andere domeinen (respectievelijk order-lifecycle.md en orders.md) — Reservering vraagt alleen om recompute, schrijft zelf geen `orders.status`/`orders.afleverdatum` rechtstreeks. `herwaardeer_claims_voor_order(order_id)` (los van `herwaardeer_order_status`) itereert alle niet-admin-pseudo-regels van een order en roept per regel `herallocateer_orderregel` aan — gebruikt bij whole-order re-evaluatie (bv. na order-edit).
- **Deploy-volgorde n.v.t. specifiek voor dit domein** — geen bekende migratie-vóór-frontend-afhankelijkheid buiten de standaard mig-vóór-deploy-conventie.
- **`besteld_inkoop` staat bewust buiten zowel `vrije_voorraad` (mig 149) als de Bruto-maatwerkvraag-KPI (ADR-0026)** — in beide gevallen omdat vermenging met een toekomst-leverweek schijnzekerheid geeft; de inkoper/verkoper moet die afweging zelf maken via de losse pill.
- **`order_status` 'Wacht op inkoop' ↔ 'Wacht op voorraad' betekenis is omgedraaid sinds mig 470** (`derive_wacht_status`, order-lifecycle-eigendom) — Claim-state (deze module) voedt die statusbepaling, maar de betekenis/semantiek zelf leeft in [order-lifecycle.md](../order-lifecycle.md)/[orders.md](orders.md). Het los-staande `snijplan_status`-enum heeft toevallig óók een waarde `'Wacht op inkoop'` (mig 437-445) — ander enum-type, ander concept, snijplanning-eigendom, niet aangeraakt door mig 470.
- **`create_inkooporder`-RPC bestaat sinds mig 601 (2026-07-02)** — zie de sectie hierboven. `import/import_inkoopoverzicht.py`'s directe RLS-bypassende table-writes zijn daarmee vervangen; het script + zijn TODO-banner zijn nog niet opgeruimd (backlog).

## Openstaand / V2

- **Deprecated wrappers opruimen** — `boek_voorraad_ontvangst`/`boek_ontvangst` (mig 271) zijn thin wrappers voor 1 release; mig 604 dropt ze, streefdatum toepassen **2026-07-13**, pas ná merge+deploy (`docs/backlog/inkoop-module-followups.md` punt 1).
- **`import/import_inkoopoverzicht.py` opruimen** — nu `create_inkooporder` (mig 601) bestaat, kan het script + zijn TODO-banner vervallen ten gunste van de RPC.
- **`queries/inkooporders.ts` >300 regels** — logische file-split (`inkooporders.ts`/`ontvangst.ts`/`rol-stickers.ts`/`openstaande.ts`), geen haast (backlog punt 3).
- **Contract-test DB-gedrag** — 14 `it.todo`-stubs in `boek-ontvangst-contract.test.ts` wachten op test-DB-infrastructuur (backlog punt 5).
- **Rol-creatie + `voorraad_mutaties`-INSERT** — tijdelijk geparkeerd binnen Inkoop's rollen-pad-RPC; eigenaar wordt een toekomstige Voorraad/Producten-Module (ADR-0017 open backlog).
- **`besteld_per_kwaliteit_kleur`-view (mig 137)** — eigendom verschuift naar een toekomstige Voorraad/Producten-Module zodra die bestaat.
- **Vrij-voor-nieuw-maatwerk V2** — Claims-in-m² alsnog aftrekken (`producten`-join met eenheid-conversie), drempel + kleurcodering, tijdslijn-projectie tegen IO-leverweek, aparte Inkoop-radar-pagina met bulk-IO-suggesties (ADR-0026 V2-backlog).
- **ADR-0027 V2-items** (cascade-swap, multi-source swap-bron, spoed-overrides IO-claims onderling, configureerbare marge, actiever alarm-signaal) — relevant alleen als de swap-fase zelf ooit heractiveert; sinds mig 497 is dit een backlog-op-een-backlog.
- **Levertijd-Module (kandidaat, ADR-0015 open backlog)** — zou `sync_order_afleverdatum_met_claims` (mig 153) + `check-levertijd` + de frontend-levertijd-helpers overnemen van Reservering; nog niet gestart.
