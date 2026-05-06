# Changelog — RugFlow ERP

## 2026-05-06 — Oude RPC's na Voorraadpositie-Module-cutover (T005 / #30)

Vijfde en laatste slice van de Voorraadpositie-Module-epic ([PRD #25](https://github.com/Miguel-AIProgression/karpi-erp/issues/25)). Cleanup van de drie RPC's die door `voorraadposities()` (mig 179/180) zijn vervangen: `rollen_uitwissel_voorraad` (mig 112/115), `uitwisselbare_partners` (mig 114/115), `besteld_per_kwaliteit_kleur` (mig 137). Hiermee is de epic compleet — alle vijf taken (T001–T005) staan.

- **Audit-bevindingen — geen externe callers meer**:
  - `rollen_uitwissel_voorraad`: 0 callers in frontend / edge-functions / scripts / import / SQL-callers (voorraadposities consumeert 'm NIET — die roept `uitwisselbare_partners()` rechtstreeks aan). ⇒ **DROP**.
  - `uitwisselbare_partners`: 0 directe externe callers. SQL-caller: `voorraadposities()` (CTE-bron in partners-aggregaat). ⇒ **DEMOTE** (COMMENT-only). GRANT EXECUTE blijft voor `anon`/`authenticated` omdat `voorraadposities()` als `LANGUAGE sql STABLE` (= SECURITY INVOKER) inner-permissies eist.
  - `besteld_per_kwaliteit_kleur`: na T005-refactor enige frontend-callers via Module-seam (`fetchVoorraadpositie` + nieuw `fetchGhostBesteldParen`). SQL-caller: `voorraadposities()`. ⇒ **DEMOTE** (COMMENT-only). GRANT blijft om dezelfde reden + omdat `fetchGhostBesteldParen` vanuit de browser draait met `anon`/`authenticated`.
- **Optie Y-refactor (ghost-merge achter Module-seam)**: `pages/rollen/rollen-overview.tsx` riep direct `supabase.rpc('besteld_per_kwaliteit_kleur')` aan (T003's ghost-merge). Verplaatst naar nieuwe Module-export [`fetchGhostBesteldParen`](../frontend/src/modules/voorraadpositie/queries/ghost-besteld.ts). Module's bestaans-regel ("batch-modus geeft alleen eigen-voorraad-paren") onveranderd; ghost-merge-logica blijft op page-niveau. Resultaat: alle frontend-DB-calls voor de Voorraadpositie-data-flow lopen nu door de Module-barrel, zodat `besteld_per_kwaliteit_kleur` logisch gedemoot kan worden zonder breuk.
- **Mig 187 — uitvoering**: `DROP FUNCTION IF EXISTS rollen_uitwissel_voorraad();` + twee `COMMENT ON FUNCTION` met "INTERN — niet direct aanroepen vanuit nieuwe code"-richtlijn voor de andere twee. Geen `REVOKE` (zou `voorraadposities()` breken).
- **Tests**: nieuwe regression-fixture 10 (`fetchGhostBesteldParen` shape + RPC-aanroep + lege-array fallback bij fout + null→0-cast voor numerieken). 4 nieuwe tests (96/97 groen, 1 perf-test skipped). Rollen-overzicht-flow regression-vrij — Module-seam transparante vervanger voor de directe RPC-call.
- **Demote = conceptueel, niet permissief**: omdat browser-callers `anon`/`authenticated` gebruiken kan een echte `REVOKE` niet zonder Module + `voorraadposities()` te breken. De `COMMENT`-tekst documenteert de design-intent: nieuwe code hoort de Module-seam te gebruiken.

**Bestanden touched**:
- [`supabase/migrations/187_oude_rpcs_cleanup.sql`](../supabase/migrations/187_oude_rpcs_cleanup.sql) — DROP + COMMENT-only-demote.
- [`frontend/src/modules/voorraadpositie/queries/ghost-besteld.ts`](../frontend/src/modules/voorraadpositie/queries/ghost-besteld.ts) — nieuwe Module-query.
- [`frontend/src/modules/voorraadpositie/index.ts`](../frontend/src/modules/voorraadpositie/index.ts) — barrel-export uitgebreid.
- [`frontend/src/pages/rollen/rollen-overview.tsx`](../frontend/src/pages/rollen/rollen-overview.tsx) — directe RPC-call vervangen door `fetchGhostBesteldParen`.
- [`frontend/src/modules/voorraadpositie/__tests__/regression/fixture-10-ghost-besteld-paren.test.ts`](../frontend/src/modules/voorraadpositie/__tests__/regression/fixture-10-ghost-besteld-paren.test.ts) — 4 nieuwe testcases.
- [`docs/changelog.md`](changelog.md), [`docs/database-schema.md`](database-schema.md).

**HITL — migratie 187 handmatig toepassen op Supabase Karpi-project** (MCP heeft geen toegang). Idempotent: `DROP FUNCTION IF EXISTS` + `COMMENT ON FUNCTION` zijn beide veilig her-uitvoerbaar.

## 2026-05-06 — Gewicht per kwaliteit — bron-van-waarheid op `kwaliteiten` (#38–#43)

Implementatie van de gewicht-per-kwaliteit feature, aangevraagd door Piet-Hein Dobbe — relevante info voor vervoerder (HST-pakbon `weightKg`). Plan: [`docs/superpowers/plans/2026-05-06-gewicht-per-kwaliteit.md`](superpowers/plans/2026-05-06-gewicht-per-kwaliteit.md).

**Architectuur — Gewicht-resolver als deep SQL-Module:**
- Smal interface: `gewicht_per_m2_voor_kwaliteit`, `bereken_product_gewicht_kg`, `bereken_orderregel_gewicht_kg`.
- Brede implementatie: oppervlak-bepaling per producttype (vast/staaltje uit `lengte_cm × breedte_cm`, maatwerk uit `maatwerk_oppervlak_m2`), kwaliteit-density-lookup, NULL-fallback, trigger-cascade kwaliteit → producten → open order_regels.
- Alle gewicht-callers gaan voortaan hierdoor; bestaande `COALESCE(ore.gewicht_kg, p.gewicht_kg, 0)` in zending-aanmaak vervalt.

**Migraties:** _(originele nummers 180/181/182 hernummerd naar 184/185/186 wegens collisie met `180_voorraadposities_batch_filter` (T003) en `182_placeholder_rollen_opruim` (T004) op de feat/voorraadpositie-module-branch)_
- **184** — fundament: `kwaliteiten.gewicht_per_m2_kg` toegevoegd, `producten.lengte_cm`/`breedte_cm`/`gewicht_uit_kwaliteit` toegevoegd. Eenmalige regex-parsing van `karpi_code` (laatste 6 cijfers) vult lengte+breedte voor vaste en staaltje-producten.
- **185** — resolver-functies + cascade-triggers (`trg_kwaliteit_gewicht_recalc`, `trg_product_gewicht_recalc`) + modus-seed van `maatwerk_m2_prijzen.gewicht_per_m2_kg` naar `kwaliteiten` voor kwaliteiten zonder Excel-data. RPC `kleuren_voor_kwaliteit` leest gewicht voortaan uit `kwaliteiten`.
- **186** — cutover: hard reset van `order_regels.gewicht_kg` voor open orders, simplificatie van `create_zending_voor_order` (geen `p.gewicht_kg`-fallback meer), drop van `maatwerk_m2_prijzen.gewicht_per_m2_kg`.

**Frontend:**
- `berekenMaatwerkGewicht` → `berekenGewichtKg` verhuisd naar [`lib/utils/gewicht.ts`](../frontend/src/lib/utils/gewicht.ts). Importeurs: `op-maat-selector`, `kwaliteit-first-selector`.
- Nieuwe component [`<GewichtBronBadge>`](../frontend/src/components/kwaliteiten/gewicht-bron-badge.tsx) toont "uit oude bron"-badge op product-detail wanneer `producten.gewicht_uit_kwaliteit = false`.
- Nieuwe pagina `/instellingen/kwaliteiten` ([`pages/instellingen/kwaliteiten.tsx`](../frontend/src/pages/instellingen/kwaliteiten.tsx)) — sorteerbare tabel met inline-edit van gewicht-per-m², filters (alle/ontbreekt/ingevuld), banner met data-completing-status.
- Queries-bestand [`lib/supabase/queries/kwaliteiten.ts`](../frontend/src/lib/supabase/queries/kwaliteiten.ts) — `fetchKwaliteitenMetGewicht` + `updateKwaliteitGewicht`.
- Router-route + sidebar-item toegevoegd (`/instellingen/kwaliteiten`, icon `Scale`).

**Excel-import:**
- Bron: `brondata/voorraad/akwaliteitscodeslijst-260505.xlsx` — Karpi legacy-export (1049 kwaliteit-rijen, kolommen `Kwaliteitscode | Omschrijving | Gewicht per m2`). 1033 met geldig gewicht (1.25–25 kg/m², gemiddeld 2.29). 16 met 0.0 = niet-tapijt placeholder-codes (DIMV, MIXX, STAA etc.) → script behandelt als NULL.
- Script [`import/import_kwaliteit_gewichten.py`](../import/import_kwaliteit_gewichten.py) met `--dry-run` flag. Filtert no-op updates (huidige waarde = nieuwe waarde) zodat cascade-triggers niet onnodig firen. Onbekende codes → warning, niet fataal.

**Domeinwoordenboek toegevoegd:** Gewicht/m², Gewicht-resolver, Gewicht-cache, Gewicht-uit-kwaliteit-flag, Bbox-oppervlak (gewicht). Zie [`docs/data-woordenboek.md`](data-woordenboek.md).

**HITL — handmatig uit te voeren door Miguel:**
1. Migratie 184 + 185 apply'en op Karpi-Supabase (MCP heeft geen toegang, cf. memory).
2. `python import/import_kwaliteit_gewichten.py --dry-run` voor verificatie.
3. `python import/import_kwaliteit_gewichten.py` voor echte run.
4. Migratie 186 apply'en (cutover + cleanup).

## 2026-05-06 — Placeholder-rollen mig 112 + 113 opruim (T004 / #29)

Vierde slice van de Voorraadpositie-Module-epic ([PRD #25](https://github.com/Miguel-AIProgression/karpi-erp/issues/25)). Na T003's ghost-merge (rollen-overzicht toont (kw, kl)-paren zonder eigen voorraad via `besteld_per_kwaliteit_kleur` + view-laag-aanvulling) zijn de placeholder-rollen uit migraties 112 + 113 (oppervlak_m2=0, rolnummer 'PH-...') overbodig geworden. Ze waren een truc om "leeg-toch-zichtbaar"-paren te krijgen via de oude `fetchRollenGegroepeerd`-query, die in T003 is verwijderd.

- **Audit-bevindingen** — 0 frontend-hits voor `oppervlak_m2 = 0` of `rolnummer LIKE 'PH-%'`-filtering. Geen consumer leest meer specifiek op deze placeholder-shape:
  - RPC's mig 114 (`uitwisselbare_partners`), mig 115 (`rollen_uitwissel_voorraad`) en mig 137 (`besteld_per_kwaliteit_kleur`) filteren al expliciet op `oppervlak_m2 > 0`.
  - Mig 134 (`snijplanning_tekort_analyse`) sluit placeholders uit via `r.lengte_cm > 0 AND r.breedte_cm > 0`.
  - Mig 179 + 180 (`voorraadposities`) filtert eigen rollen op `oppervlak_m2 > 0`.
  - Edge-function `_shared/db-helpers.ts::fetchBeschikbareRollen` filtert PH-rollen al uit via `lengte <= 0 || breedte <= 0`. Defensieve filter blijft bestaan; mig 182 maakt hem hooguit nooit-true (geen breaking change).
- **Mig 182 — opruim** — `DELETE FROM rollen WHERE rolnummer LIKE 'PH-%' AND oppervlak_m2 = 0;`. Idempotent: bij re-run vindt DELETE 0 rijen.
- **Mig 112 + 113 INSERT-blok geneutraliseerd** — beide DO-blocks gewikkeld in `IF FALSE THEN ... END IF;`. RPC `rollen_uitwissel_voorraad()` in mig 112 (Deel 2) blijft intact — die wordt in T005 separaat gedemoteerd of gedropt na consumer-audit. Re-runs van mig 112/113 maken géén nieuwe PH-rollen meer aan.
- **Snijplanning + maatwerk-flow regression-vrij** — placeholders worden door alle bestaande filters al genegeerd. Rollen-overzicht ghost-groepen blijven verschijnen via de T003-ghost-merge.

**HITL — migraties 182 + de mig 112/113-updates handmatig toepassen op Supabase Karpi-project** (MCP heeft geen toegang). Volgorde: eerst mig 182 (DELETE), daarna mig 112/113 herinladen (no-op INSERT's overschrijven oude logica). Op een DB die mig 112/113 nooit heeft gedraaid is mig 182 eveneens een no-op DELETE.

## 2026-05-06 — MaatwerkLevertijdHint via Voorraadpositie-Module (T002 / #27)

Derde slice van de Voorraadpositie-Module-epic ([PRD #25](https://github.com/Miguel-AIProgression/karpi-erp/issues/25)). De maatwerk-levertijdhint cut-overt op de Module-seam zodat order-form, product-detail en rollen-overzicht alle drie via dezelfde `fetchVoorraadpositie`-call lezen.

- **`fetchMaatwerkLevertijdHint` migreert** — `frontend/src/lib/supabase/queries/op-maat.ts` regels 472–525. Vervangt de directe `supabase.rpc('besteld_per_kwaliteit_kleur')` + client-side `.find()` door één `await fetchVoorraadpositie(kw, kl)` uit `@/modules/voorraadpositie`. `besteld.eerstvolgende_verwacht_datum` wordt direct uit de Voorraadpositie gelezen i.p.v. uit een raw RPC-row. `app_config.order_config`-fetch en `iso_week_plus`-RPC-call ongewijzigd (buiten scope T002).
- **Nieuwe invariant — eigen voorraad blokkeert hint**: `voorraadpositie.voorraad.totaal_m2 > 0` ⇒ `{ status: 'geen_inkoop' }`. Reden: maatwerk kan direct uit voorraad gemaakt worden, dus een "wacht-op-inkoop"-melding is misleidend. Voorheen impliciet via caller-checks (snij-flow), nu expliciet in de hint-laag zelf.
- **Hint-tekst en weergave op orderregel ongewijzigd** — `MaatwerkLevertijdHint`-component (`frontend/src/components/orders/maatwerk-levertijd-hint.tsx`) ongemoeid; status-discriminator `inkoop_bekend | geen_inkoop` en signature van `fetchMaatwerkLevertijdHint` identiek aan main.
- **5 nieuwe vitest-tests** in `frontend/src/lib/supabase/queries/__tests__/op-maat.test.ts`: (a) ghost-paar → inkoop_bekend; (b) default-buffer 2 weken bij ontbrekende app_config; (c) geen voorraad én geen besteld → geen_inkoop; (d) eigen voorraad blokkeert hint ook als er besteld is; (e) `fetchVoorraadpositie` retourneert null → geen_inkoop. Mocks via `vi.mock('@/modules/voorraadpositie')` en `vi.mock('../../client')`.

Tests groen: 90/90 (85 → 90). Typecheck clean. Lint geen nieuwe errors.

## 2026-05-06 — Voorraadpositie-Module batch+filter + rollen-overzicht migratie (T003 / #28)

Tweede slice van de Voorraadpositie-Module-epic ([PRD #25](https://github.com/Miguel-AIProgression/karpi-erp/issues/25)). De Module krijgt batch+filter-modus, de rollen-overzicht-pagina cut-overt 1-op-1 op het Voorraadpositie-concept, en de oude `fetchRollenGegroepeerd` + `RolGroep`-type verdwijnen.

- **SQL-RPC `voorraadposities()` uitgebreid** (mig 180) — drie modi: (a) single-paar (kw + kl beide gevuld) → exacte match incl. ghost-paren, ongewijzigd t.o.v. T001; (b) batch (beide leeg) → álle paren met eigen voorraad; (c) batch+filter (kw / kl / search los) → server-side filtering op kwaliteit (ILIKE-substring), kleur (exact na normalisatie), search (ILIKE op `kw-kl` of `producten.naam`). Bestaans-regel: batch retourneert ALLEEN paren met eigen voorraad — ghost-paren met enkel besteld worden expliciet uitgesloten en moeten door de caller gemerged worden. Nieuwe output-kolommen: `rollen JSONB` (per-rol details voor expand-rows: id, rolnummer, lengte, breedte, oppervlak, status, rol_type, locatie, oorsprong_rol_id, reststuk_datum, artikelnr, kwaliteit_code, kleur_code — gesorteerd `rol_type ASC, rolnummer ASC`); `product_naam TEXT` (uit `producten`-tabel); `eerstvolgende_m`/`eerstvolgende_m2` (vroegste leverweek aandeel — uit mig 137).
- **Module-uitbreiding** — `Voorraadpositie` heeft nu `rollen: RolRow[]` + `product_naam: string | null`; `BesteldInkoop` heeft `eerstvolgende_m` + `eerstvolgende_m2`; nieuwe `VoorraadpositieFilter`-interface; nieuwe `fetchVoorraadposities(filter)` + `useVoorraadposities(filter)`-hook met queryKey `['voorraadposities', 'batch', kw, kl, search]`. queryKey-conventie gedocumenteerd in JSDoc bovenaan `hooks/use-voorraadpositie.ts`.
- **Rollen-overzicht migratie** — `RollenGroepRow` consumeert `Voorraadpositie` direct (geen tijdelijke `toRolGroep`-adapter in main). `RollenOverviewPage` gebruikt `useVoorraadposities` voor de batch-call + een aparte `besteld_per_kwaliteit_kleur`-call voor ghost-paren-merge (view-laag-aanvulling op page-niveau). Visueel + functioneel ongewijzigd t.o.v. T001-baseline.
- **Cleanup** — `fetchRollenGegroepeerd` verwijderd uit `frontend/src/lib/supabase/queries/rollen.ts` (de paginated rollen-fetch + 4-RPC-merge-logic); `useRollenGegroepeerd` verwijderd uit `hooks/use-rollen.ts`; `RolGroep`-interface verwijderd uit `frontend/src/lib/types/productie.ts`. Let op: `RolGroep` in `lib/utils/snijplan-mapping.ts` en `components/snijplanning/snij-bevestiging-modal.tsx` is een **ander** concept (snijplan-rol-grouping) en blijft bestaan.
- **5 nieuwe regression-fixtures** (vitest) — invarianten 5 t/m 9: (5) partners-sortering m² DESC, kw ASC, kl ASC; (6) bestaans-asymmetrie batch vs single (ghost-paar zit in single, niet in batch); (7) leverweek-aggregatie vroegste verwacht_datum wint; (8) `partners` is altijd een array (nooit NULL); (9) batch-call met lege filter geeft alle params als `null` door, lege strings worden ook null. Bestaande T001-fixtures aangepast om de nieuwe veld-shapes te tolereren.
- **Performance-baseline** — `__tests__/performance.test.ts` (skip-by-default via `VITEST_INCLUDE_PERF=1`) documenteert de strategie: seed Supabase test-branch met ~5000 rollen + ~200 IO-regels, run `fetchVoorraadposities({})` 10×, asserteer p95 < 500 ms. Implementatie als HITL-vervolg.

**HITL — migratie 180 nog handmatig toepassen op Supabase Karpi-project** (MCP heeft geen toegang). Tot dan retourneert `fetchVoorraadposities` een lege array met een warn-log; rollen-overzicht valt netjes terug op de ghost-merge zodat de "alleen besteld"-paren in elk geval zichtbaar blijven (zij het zonder eigen-voorraad-lijst).

## 2026-05-06 — QA-fixes order-voorstel epic (sub-issues van #17)

Vier UI-bugs gevonden tijdens handmatige QA-walkthrough van issue #17, met losse sub-issues geïsoleerd en gefixt.

- **#34 — Sortering orders-overzicht**: `fetchOrders` had geen secundaire sort, dus binnen dezelfde `orderdatum` kon de meest recente order op willekeurige plek belanden. `id DESC` toegevoegd als tiebreaker (id is auto-increment → monotoon stijgend → perfect proxy voor aanmaakvolgorde). Geen migratie nodig.
- **#32 — Maatwerk-regel zonder voorraad én zonder inkoop**: `fetchMaatwerkLevertijdHint` returnde `null` wanneer er geen openstaande inkoop was → component verbergde zichzelf → gebruiker zag niets. Discriminated-union-result `inkoop_bekend | geen_inkoop`; bij `geen_inkoop` toont de hint nu een amber-waarschuwing "Niet op voorraad — geen lopende inkoop bekend. Levertijd onbekend." zodat de gebruiker niet stilzwijgend een onleverbare regel toevoegt.
- **#33 — Verzendkosten + maatwerk-levertijd bij split-order (deelleveringen aan)**:
  - Verzendkosten gingen altijd naar het standaard- (resp. directe-) deel. Nu naar het **duurste** sub-totaal (gemixt-split én IO-split).
  - Maatwerk-deel gebruikte de statische `maatwerk_weken`-config (default 4 weken, klant-override mogelijk 1) → kreeg "+1 week" terwijl echte capaciteit 15 weken kan zijn. Nieuwe helper `berekenMaatwerkAfleverdatumViaSeam` roept de echte planning-seam (`check-levertijd`) aan voor élke maatwerk-regel met complete data en neemt de **MAX lever_datum** als afleverdatum van de maatwerk-sub-order. Fallback op de oude statische berekening voor onvolledige regels.
- **#35 — Uitwisselbaar-zichtbaarheid + prijslijst-fallback**:
  - In de voorraad-cel van `OrderLineEditor` verschijnt nu een passieve `(+N via ander type)`-indicator zodra er uitwisselbare voorraad bestaat — ongeacht tekort. Voorheen moest de gebruiker het orderaantal eerst boven de eigen voorraad drukken om dat te zien.
  - Nieuwe `prijs_uit_prijslijst`-flag op `OrderRegelFormData` (display-only). Bij prijs-fallback (klant heeft prijslijst, maar artikel staat er niet in) toont de prijs-cel "⚠ Niet uit prijslijst" — gebruiker weet dat hij een fallback-prijs gebruikt en kan handmatig corrigeren.

Tests groen: 13 testfiles, 74 tests. Typecheck clean. Lint geen nieuwe errors (6 pre-existing onveranderd).

## 2026-05-06 — Voorraadpositie-Module tracer-bullet (T001 / #26)

Eerste slice van de Voorraadpositie-Module-epic ([PRD #25](https://github.com/Miguel-AIProgression/karpi-erp/issues/25)). Levert één deep TS-Module rond het concept "Voorraadpositie per (kwaliteit, kleur)" + één SQL-RPC als seam. Past binnen [ADR-0001](adr/0001-order-voorstel-en-planning-als-twee-modules.md) — geen aparte ADR.

- **SQL-RPC `voorraadposities(p_kwaliteit, p_kleur, p_search)`** (mig 179) — single-paar-modus volledig werkend. Retourneert per (kw, kl) eigen voorraad (volle/aangebroken/reststuk + m²), uitwisselbare partners (gesorteerd m² DESC), `beste_partner` (alleen wanneer eigen_m²=0 én partners[0].m²>0 — invariant 1), en besteld-aggregatie. Bouwt op bestaande RPC's `uitwisselbare_partners()` (mig 115) en `besteld_per_kwaliteit_kleur()` (mig 137). Kleur-normalisatie (`'15.0' → '15'`) via één `regexp_replace`. Single-call retourneert ook ghost-paren (FULL OUTER JOIN tussen eigen, partners en besteld). T003 (#28) breidt uit met batch+filter-modus.
- **Module `frontend/src/modules/voorraadpositie/`** met `types.ts`, `queries/voorraadposities.ts` (`fetchVoorraadpositie`), `hooks/use-voorraadpositie.ts`, `lib/normaliseer-kleur.ts` en barrel-export. queryKey-conventie `['voorraadpositie', kw, kl]`, staleTime 60 s. Lege string voor kw of kl → `null` zonder Supabase-call.
- **Product-detail-pagina** consumeert `useVoorraadpositie` voor de "Openstaande inkooporders"-sectie-totaal (m¹). De per-IO-regel-detail (leverancier, status, leverweek per regel) blijft uit `useOpenstaandeInkoopVoorArtikel` komen — die data zit niet in het aggregate. Visueel + functioneel ongewijzigd t.o.v. main; de `voorraadpositie?.besteld?.besteld_m` heeft een fallback op de regel-sum zodat de UI ook zonder mig 179 deployment correct blijft tonen.
- **4 regression-fixtures** (vitest) in `frontend/src/modules/voorraadpositie/__tests__/regression/` bewaken de invarianten: (1) eigen blokkeert beste_partner; (2) symmetrie partners; (3) kleur-normalisatie + lege-string-guard zonder rpc-call; (4) `besteld_m2 = 0` (niet null) bij ontbrekende standaard_breedte_cm.

**HITL — migratie 179 nog handmatig toepassen op Supabase Karpi-project** (MCP heeft geen toegang). Tot dan retourneert `fetchVoorraadpositie` `null` met een warn-log; de product-detail-pagina valt netjes terug op de regel-sum-berekening voor het sectie-totaal.

## 2026-05-05 — Pick-ship gesplitst naar `modules/magazijn/` + uitbreiding `modules/logistiek/`

Pick-ship-folder bevatte drie verschillende concerns (pickbaarheid, vervoerder-selectie, zending-creatie) in een flat-namespace. Heringericht volgens [ADR-0002](adr/0002-pick-ship-splitst-naar-magazijn-en-logistiek.md).

- **`modules/magazijn/`** is de derde deep verticale Module (na orders + planning). Bezit pickbaarheid, pick-buckets, locatie-mutaties op rollen + snijplannen, magazijn-locaties-tabel, pick-overview-pagina (route `/pick-ship` blijft), `OrderPickCard`. Smal publiek oppervlak via barrel — pure helpers blijven privé.
- **`modules/logistiek/`** uitgebreid met `<VerzendsetButton>` en `useActieveVervoerder()`-hook. `<VervoerderTag>` is voortaan self-fetching wanneer geen `code`-prop wordt gegeven (slot-pattern in pick-context).
- **Atomiciteitsbug locatie-update opgelost**: nieuwe RPC `set_locatie_voor_orderregel` (mig 0183) bundelt `INSERT magazijn_locaties ON CONFLICT` + `UPDATE snijplannen.locatie` in één transactie. Voorkomt dangling rijen wanneer de tweede call faalt.
- Contract-test `magazijn-pickbaarheid.contract.test.ts` bewaakt vier `fetchPickShipOrders`-scenario's (view + N regels, view + 0 regels, view ontbreekt → fallback, header-only).
- `architectuur.md` documenteert nu het slot-pattern en atomic-RPC-pattern als bewuste designkeuzes.

Issues #20-#24 (epic:magazijn-module). Geen DB-schema-migratie naar FK voor `snijplannen.locatie` — V2.

## 2026-05-05 — Architectuurplan: Order-voorstel + Planning als deep verticale Modules

Architectuur-grilling-sessie heeft de order-intake-flow geanalyseerd en als deepening-kandidaat geïdentificeerd: zes lagen (order-form → line-editor → uitwisselbaar-hint → levertijd-suggestie → claim-RPC's → DB) die één logisch domeinconcept (`Order-voorstel`) verdelen.

- **Beslissing**: Order-voorstel + Planning worden twee aparte deep verticale Modules met een TS-functie-contract als seam — vastgelegd in [ADR-0001](adr/0001-order-voorstel-en-planning-als-twee-modules.md).
- **Plan**: zie [`2026-05-05-order-voorstel-en-planning-modules.md`](superpowers/plans/2026-05-05-order-voorstel-en-planning-modules.md) voor scope, module-grenzen, save/read-paths, migratie-aanpak (big-bang in worktree met regression-snapshot), en test-strategie (contract-tests op de seam, regression-snapshot op 20 representatieve order-fixtures).
- **`data-woordenboek.md`**: nieuwe term `Order-voorstel` toegevoegd (parallel aan `Snijvoorstel`); verwijst naar ADR-0001.
- **`architectuur.md`**: nieuwe subsectie "Module-grafiek (vertical slices met expliciete seams)" als anker-beslissing.

Pick-ship blijft uit scope (eigen Module in latere migratie); `<LevertijdSuggestie>` verhuist naar Planning-Module; `maatwerk-prijs.ts` valt onder Orders-Module.

Uitvoering nog niet gestart — eerstvolgende stap is het genereren van de regression-fixture-set.

---

## 2026-05-01 — Nieuw-product-formulier: auto artikelnr/karpi-code, maatwerk-afwerking, voorraad-lock

[`ProductCreatePage`](../frontend/src/pages/producten/product-create.tsx) heeft drie kwaliteitsverbeteringen gekregen die het aanmaakproces afstemmen op de Karpi-conventies:

- **Artikelnummer auto-doornummeren.** Nieuwe query [`fetchNextArtikelnr`](../frontend/src/lib/supabase/queries/producten.ts) bepaalt het volgende 9-cijferige artikelnr op basis van `MAX(artikelnr) + 1` binnen de karpi_code-prefix `{kwaliteit}{kleur}` (bijv. `FAMU48` → 298480000…298480003 → suggestie `298480004`). Fallbacks: zelfde kleurcode-range als kwaliteit+kleur leeg is, anders globale max +1, anders `298000000`. Per variant-rij telt het nummer op (rij 0 = base, rij 1 = base+1, etc.). Veld blijft editable; manuele wijziging schakelt auto-suggestie voor die rij uit.
- **Karpi-code auto-genereren.** Nieuwe `buildKarpiCode`-helper produceert het format `{KWALITEIT}{KLEUR:2}XX{BREEDTE:3}{LENGTE:3 of "RND"}` zodra kwaliteit, kleur, breedte en lengte ingevuld zijn — zelfde conventie als `parse_karpi_code` in `import/sync_rollen_voorraad.py`. Manuele override blijft mogelijk.
- **Maatwerk-afwerking in stamgegevens.** Nieuw selectveld in de stamgegevens-sectie toont `afwerking_types` (B, FE, LO, ON, SB, SF, VO, ZO). Bij opslaan wordt de waarde geüpsert in `maatwerk_afwerking_per_kleur` als zowel kwaliteit als kleur gezet zijn (per-kleur override), anders in `kwaliteit_standaard_afwerking` (kwaliteit-default). Bij heropenen wordt de bestaande waarde voor (kwaliteit, kleur) voorgevuld via `fetchAfwerkingVoorKleur` → `fetchStandaardAfwerking`. Nieuwe helper [`setAfwerkingVoorKleur`](../frontend/src/lib/supabase/queries/op-maat.ts).
- **Voorraad locked op 0 + actief default false.** Voorraadveld in de variantentabel is read-only/disabled (visueel gegrijst) — voorraad ontstaat pas via boek-ontvangst op de inkooporder. De `Actief`-checkbox staat standaard uit met uitleg ("pas zichtbaar zodra de eerste inkoop is ontvangen"), aansluitend bij de werkflow: product aanmaken → IO maken → ontvangen → activeren.

Geen migratie nodig — alle gebruikte tabellen (`afwerking_types`, `kwaliteit_standaard_afwerking`, `maatwerk_afwerking_per_kleur`) bestonden al.

---

## 2026-05-01 — Debiteuren gekoppeld aan nieuwe prijslijsten 0210 / 0211

Op basis van twee Excel-exports uit het oude systeem (`klantenbestand prijslijst 150.xlsx` met 644 debiteuren en `klantenbestand prijslijst 151.xlsx` met 183 debiteuren) zijn de actuele klantkoppelingen in `debiteuren.prijslijst_nr` bijgewerkt: lijst 150 → `0210` (BENELUX PER 01.04.2026), lijst 151 → `0211` (BENELUX INCL. MV PER 01.04.2026). De 0211-debiteuren stonden al gekoppeld vanuit `prijslijst_update_2026.py`; de 642 0210-debiteuren stonden op `NULL` en zijn nu bijgewerkt. Twee debiteuren ontbraken nog volledig in de DB en zijn alsnog aangemaakt op basis van de Excel-bron (incl. `afleveradres adres_nr=0` en koppeling aan `0210`): `301009 SARAH COUMANS INTERIEURONTWERP` (NL, Astrid Roth) en `570004 MEUBLETA` (BE, Siemen Esprit). Eindstand: prijslijst `0210` = 644 debiteuren, `0211` = 184 debiteuren. Script: [`import/koppel_debiteuren_prijslijst_2026_05.py`](../import/koppel_debiteuren_prijslijst_2026_05.py) — idempotent, slaat reeds-correcte koppelingen over.

---

## 2026-05-01 — Productzoek in order matcht klant-eigen kwaliteitsnamen

Klanten plaatsen vaak bestellingen onder hun eigen kwaliteitsnaam (bijv. "BREDA") in plaats van de Karpi-code (`BEAC`). Het zoekveld in `KwaliteitFirstSelector` (zichtbaar als "Zoek kwaliteit..." in [`OrderLineEditor`](../frontend/src/components/orders/order-line-editor.tsx)) gebruikt nu — zodra een klant geselecteerd is — óók `klanteigen_namen.benaming` en `klanteigen_namen.omschrijving` als zoekbron. Klant-eigen matches verschijnen bovenaan de resultatenlijst met een blauwe `· klant: <naam>`-hint, zodat de orderintake-medewerker direct ziet waarom een kwaliteit gevonden werd op een term die niet in de Karpi-omschrijving voorkomt.

Daarnaast filtert het zoekveld nu strikter wanneer de zoekterm óók een kleurcode bevat (bijv. `ross 55`): kwaliteiten zonder een actief product met die kleurcode vallen af. Voorheen verscheen LAGO bij "ross 55" omdat de klant-eigen naam ROSS matchte, terwijl LAGO geen kleur 55 voert. Kleurcodes worden vergeleken met en zonder `.0`-suffix.

Aanpassingen: [`searchKwaliteitenViaProducten`](../frontend/src/lib/supabase/queries/op-maat.ts) accepteert optioneel `debiteurNr` + `kleurHint`, query't `klanteigen_namen` parallel, en doet bij kleurHint een tweede `producten`-query om de kandidaat-kwaliteiten te filteren op werkelijke kleurbeschikbaarheid; `KwaliteitOptie` heeft nieuw veld `klant_eigen_naam`. [`KwaliteitFirstSelector`](../frontend/src/components/orders/kwaliteit-first-selector.tsx), [`OrderLineEditor`](../frontend/src/components/orders/order-line-editor.tsx) en [`OrderForm`](../frontend/src/components/orders/order-form.tsx) reiken `debiteur_nr` van `client` door. Geen migratie nodig — de tabel `klanteigen_namen` bestond al sinds V1-import.

---

## 2026-05-01 — Migratie 178: documenten-bijlagen bij orders en inkooporders

Gebruikers kunnen nu PDF/JPG/PNG/Excel/Word/TXT-bijlagen koppelen aan zowel verkooporders (klant-PO, bevestiging) als inkooporders (orderbevestiging leverancier, pakbon, factuur). Migratie 178 voegt twee tabellen toe (`order_documenten`, `inkooporder_documenten`, beide met `ON DELETE CASCADE` op de parent + RLS voor `authenticated`) en één gedeelde private storage-bucket `order-documenten` met paden `orders/{order_id}/...` en `inkooporders/{inkooporder_id}/...`. Bucket-limiet: 25 MB per bestand, expliciete `allowed_mime_types`.

Frontend: gedeelde `<DocumentenSectie>` component (drag-drop + signed-URL preview + omschrijving inline editen + delete) plus `<DocumentenBuffer>` voor de order-create-flow waar nog geen `order_id` bestaat — buffert files lokaal en uploadt ze in `OrderForm.onAfterCreate` na succesvolle save (bij split-orders gekoppeld aan beide order-id's). Inpassingen op `inkooporder-detail.tsx`, `order-detail.tsx`, `order-edit.tsx`, `order-create.tsx`. Centrale queries in `lib/supabase/queries/documenten.ts` en hooks in `hooks/use-documenten.ts` (één set, parameteriseerbaar via `kind: 'order' | 'inkooporder'`).

---

## 2026-05-01 - Pick & Ship verzendset met stickers en pakbon

Pick & Ship heeft nu per volledig pickbare order een **Verzendset**-actie. De actie maakt/hergebruikt een `zendingen`-rij via `create_zending_voor_order`, kiest automatisch de vervoerder uit `edi_handelspartner_config.vervoerder_code`, en opent `/logistiek/:zending_nr/printset` met printbare colli-stickers en A4-pakbon. Stickers tonen afleveradres, vervoerder, colli-volgnummer en GS1-128/SSCC-barcode; de pakbon toont orderregels, besteld/geleverd, afleveradres, colli en gewicht.

Migratie 177 scherpt `create_zending_voor_order` definitief aan nadat `176_zending_vervoerder_auto_selectie` de RPC opnieuw overschreef: gebruikt `order_regels.orderaantal` in plaats van de niet-bestaande kolom `aantal`, vult `zending_regels.aantal`, `zendingen.aantal_colli` en `zendingen.totaal_gewicht_kg` voor de printflow.

---

## 2026-05-01 - Vervoerders achter Logistiek-instellingen

Het losse sidebar-item "Vervoerders" is verwijderd. Vervoerderbeheer blijft beschikbaar via de instellingenknop rechtsboven op het Logistiek-overzicht (`/logistiek`), zodat de operationele navigatie compacter blijft en de routes `/logistiek/vervoerders` en `/logistiek/vervoerders/:code` intact blijven.

---

## 2026-05-01 - Pick & Ship toont open orders met fallback

Pick & Ship leest nu standaard alle open orders (`status != Verzonden/Geannuleerd`) in plaats van alleen regels die al als pickbaar zijn gemarkeerd. Als de database-view `orderregel_pickbaarheid` nog niet is toegepast of nog niet in de Supabase schema-cache zit, valt de frontend terug op `orders` + `order_regels`, zodat de pickpagina niet leeg blijft. Orderkaarten tonen nu ook de orderstatus.

---

## 2026-05-01 — Migratie 175: HST-instellingen seed

Vult `vervoerders`-rij voor `hst_api` met `api_endpoint` (acceptatie-host), `api_customer_id` (`038267`), contactpersoon (Niek Zandvoort, n.zandvoort@hst.nl) en uitgebreide `notities` op basis van e-mailcorrespondentie 2026-02-26 t/m 2026-03-02. `actief` blijft `FALSE` tot na succesvolle cutover-test (Fase 4 van het HST-API-plan).

Plan: [`docs/superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md`](superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md).

---

## 2026-05-01 — Migratie 174: vervoerder-instellingen + stats-view

Uitbreiding `vervoerders`-tabel met 7 kolommen voor instellingen, contactgegevens en tarief-notities (vrije tekst V1): `api_endpoint`, `api_customer_id`, `account_nummer`, `kontakt_naam`, `kontakt_email`, `kontakt_telefoon`, `tarief_notities`. Nieuwe view `vervoerder_stats` voor dashboard-pages (aantal klanten, zendingen totaal/deze-maand, HST success/fail-counts). Frontend `/logistiek/vervoerders` overzicht + detail-pagina onder `frontend/src/modules/logistiek/`.

Plan: [`docs/superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md`](superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md) (Fase A; B = gestructureerde tarieven, C = auto-selectie blijven roadmap).

---

## 2026-05-01 — Migratie 169: zendingen-tabel

Eerste werkelijke materialisatie van `zendingen` + `zending_regels` (stond al in schema-doc beschreven, maar nog nooit aangemaakt). Inclusief enum `zending_status` (Gepland, Picken, Ingepakt, Klaar voor verzending, Onderweg, Afgeleverd), `created_at`/`updated_at` met trigger, RLS, en lazy `volgend_nummer('ZEND')`-sequence voor `ZEND-2026-0001`. Voorbereiding op logistiek-module HST API-koppeling.

Plan: [`docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md`](superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md).

---

## 2026-05-01 — Migratie 170: vervoerders + per-debiteur vervoerderkeuze

Nieuwe `vervoerders`-lookup-tabel met 3 zaad-rijen (`hst_api`, `edi_partner_a` Rhenus, `edi_partner_b` Verhoek — alle drie default `actief=FALSE`). Plus nieuwe kolom `edi_handelspartner_config.vervoerder_code` (FK → `vervoerders.code`) voor per-debiteur routing. Géén automatische re-routing van openstaande zendingen bij wisseling — alleen nieuwe zendingen volgen de nieuwe waarde.

---

## 2026-05-01 — Migratie 171: hst_transportorders + adapter-RPCs

HST-adapter-implementatie. Eigen tabel `hst_transportorders` met HST-specifieke kolommen (`extern_transport_order_id`, `extern_tracking_number`, `request_payload`, `response_payload`, `response_http_code`, retry/status, `is_test`). Nieuwe enum `hst_transportorder_status` (Wachtrij, Bezig, Verstuurd, Fout, Geannuleerd). Vier RPC's: `enqueue_hst_transportorder`, `claim_volgende_hst_transportorder`, `markeer_hst_verstuurd`, `markeer_hst_fout`. Idempotentie via partial unique index `uk_hst_to_zending_actief` (één actieve transportorder per zending, retry zet oude rij eerst op `Geannuleerd`).

Géén gegeneraliseerde `vervoerder_berichten`-tabel — verticale slice voor HST. Toekomstige EDI-vervoerders hergebruiken straks de bestaande `edi_berichten`-tabel met `berichttype='verzendbericht'`. Reden: deletion-test wijst uit dat een gegeneraliseerde queue-tabel shallow zou zijn (interface bijna net zo complex als de twee implementaties).

---

## 2026-05-01 — Migratie 172: switch-RPC + zending-trigger

Nieuwe RPC `create_zending_voor_order(p_order_id)` (idempotent — returnt bestaande actieve zending of maakt nieuwe rij + bijbehorende `zending_regels` met status direct `'Klaar voor verzending'`). Nieuwe **single-switch-point** RPC `enqueue_zending_naar_vervoerder(p_zending_id)` als enige plek in de codebase waar op `vervoerder_code` wordt gedispatcht naar de adapter-RPC (`'hst_api'` → `enqueue_hst_transportorder`; toekomstige `'edi_partner_a/b'` → `enqueue_edi_verzendbericht`). Plus AFTER INSERT/UPDATE OF status-trigger `trg_zending_klaar_voor_verzending` op `zendingen` die bij transitie naar `'Klaar voor verzending'` de switch-RPC aanroept. Trigger weet niets over HST/EDI — alle vervoerder-onderscheid leeft in de switch.

---

## 2026-05-01 — Migratie 173: hst-send pg_cron schedule

Edge function `hst-send` draait elke minuut via pg_cron. Claimt rijen uit `hst_transportorders` (status `Wachtrij`), bouwt HST TransportOrder-payload (lokale builder in [`supabase/functions/hst-send/payload-builder.ts`](../supabase/functions/hst-send/payload-builder.ts)), POST'st naar `https://accp.hstonline.nl/rest/api/v1/TransportOrder` met HTTP Basic-auth, schrijft response + tracking terug via `markeer_hst_verstuurd` of retry/fout via `markeer_hst_fout`. Cutover blijft op ACCP-omgeving; productie-credentials volgen apart.

---

## 2026-05-01 - EDI-orderprijzen uit debiteurprijslijst

EDI-orders `ORD-2026-2022` en `ORD-2026-2023` kwamen correct binnen qua artikelen, maar hadden `€0,00` omdat `create_edi_order` alleen `producten.verkoopprijs` gebruikte. Voor BDSK/LUTZ PATCH-artikelen is die productprijs leeg; de juiste prijs staat in prijslijst `0201`.

- **Data-correctie:** legacy BDSK-debiteuren `600553`, `600554` en `600555` zijn gekoppeld aan LUTZ-prijslijst `0201`; `ORD-2026-2022` en `ORD-2026-2023` zijn herprijsd naar totaal `€56,49` (`29,73 + 13,38 + 13,38`).
- **Migratie 166:** [`166_edi_prijzen_uit_prijslijst.sql`](../supabase/migrations/166_edi_prijzen_uit_prijslijst.sql) herdefinieert `create_edi_order` zodat EDI-regels eerst uit `debiteuren.prijslijst_nr -> prijslijst_regels` worden geprijsd, met fallback op `producten.verkoopprijs`.
- **Frontend-vangnet:** handmatige EDI-upload en demo-flow kiezen bij dubbele GLN's voortaan eerst een actieve debiteur met prijslijst en herprijzen de aangemaakte order direct na de RPC-call.
- **Backfill:** dezelfde migratie vult bestaande EDI-orderregels zonder prijs bij waar een prijslijstprijs bestaat.

---

## 2026-05-01 - aanvullende prijslijsten geimporteerd en gekoppeld

De nieuwe ZIP-bestanden `prijslijsten.zip` en `toevoegingprijslijsten.zip` zijn verwerkt naar Supabase.

- **Import tooling:** toegevoegd: [`import/prijslijsten_aanvulling_manifest.json`](../import/prijslijsten_aanvulling_manifest.json) en [`import/import_prijslijsten_aanvulling.py`](../import/import_prijslijsten_aanvulling.py). Het script draait standaard als dry-run en schrijft rapporten onder `import/rapporten/`.
- **Koppellogica:** debiteuren worden gekoppeld via de oude `Prijslijst`-kolom in [`brondata/debiteuren/Karpi_Debiteuren_Import.xlsx`](../brondata/debiteuren/Karpi_Debiteuren_Import.xlsx), met expliciete validatie voor Porta (`630859`, `630861`, `630862`) en LUTZ (`600556`, `600562`, `600571`, `600572`) uit de mail.
- **Supabase-resultaat:** 14 prijslijsten geupsert, 13.627 prijslijstregels geupsert, 227 debiteuren gekoppeld en 6 ontbrekende producten minimaal aangemaakt.
- **Nacontrole:** idempotentie-dry-run na import gaf 0 nieuwe producten, 0 waarschuwingen en 0 blokkerende problemen.

---

## 2026-04-30 — EDI vertical-module + berichttype-registry + klantconfiguratie UI

Twee architectuurkeuzes uit `/improve-codebase-architecture`-review samengebracht met de geplande klant-config-UI.

- **Vertical-module:** `frontend/src/lib/edi/`, `frontend/src/pages/edi/`, `frontend/src/components/edi/`, `frontend/src/lib/supabase/queries/edi.ts` en `frontend/src/hooks/use-edi.ts` zijn samengevoegd onder [`frontend/src/modules/edi/`](../frontend/src/modules/edi/) (sub-folders `pages/`, `components/`, `hooks/`, `queries/`, `lib/`). Externe consumers importeren via de barrel `@/modules/edi`.
- **Berichttype-registry:** [`registry.ts`](../frontend/src/modules/edi/registry.ts) is bron-van-waarheid voor de vier types (`order`, `orderbev`, `factuur`, `verzendbericht`) — code, richting, UI-label, UI-subtitle, `configToggleKey`, `relatedEntity`, `transusProcess`. Frontend itereert over `getBerichttypenVoorRichting(...)`. Backend (poll/send edge functions) blijft V1 op huidige switch — registry-spiegel volgt in een follow-up plan.
- **EDI-klantconfiguratie UI** — klant-detail krijgt EDI-tab met de processen uit de registry (Inkomend/Uitgaand gegroepeerd) + test-modus + notities. Klanten-overzicht krijgt EDI-filter (Alle / EDI / Niet-EDI) en EDI-tag op klantkaart + detail-header. Schrijft naar bestaande `edi_handelspartner_config` (mig 156). UI: [klant-edi-tab.tsx](../frontend/src/modules/edi/components/klant-edi-tab.tsx), [edi-tag.tsx](../frontend/src/modules/edi/components/edi-tag.tsx). Geen migratie nodig.

---

## 2026-04-30 - EDI/Transus facturen via Karpi fixed-width INVOIC

Uitgaande facturen kunnen nu als Transus INVOIC-bericht in de EDI-wachtrij worden gezet. Het nieuwe BDSK-voorbeeld `Bericht-ID 168849861.zip` is toegevoegd als fixture en gebruikt om de byte-layout van Karpi's fixed-width factuurformaat te verankeren.

- **Edge/shared:** nieuwe builder `supabase/functions/_shared/transus-formats/karpi-invoice-fixed-width.ts` maakt 1107-byte headerregels en 312-byte artikelregels voor Transus' Custom ERP INVOIC-formaat.
- **Factuurflow:** `supabase/functions/factuur-verzenden/index.ts` queue't bij `edi_handelspartner_config.transus_actief=true` en `factuur_uit=true` automatisch een `edi_berichten`-rij (`berichttype='factuur'`, `status='Wachtrij'`). E-mail blijft mogelijk naast EDI, maar is niet meer verplicht voor EDI-only debiteuren.
- **Fixtures/tests:** toegevoegd: `factuur-uit-bdsk-168849861.txt`, `edifact-output-invoic-bdsk-168849861.edi` en unit-testdekking voor beide BDSK-factuurvoorbeelden plus RugFlow-nummernormalisatie.
- **Docs:** architectuur, data-woordenboek en Transus voorbeeld-README bijgewerkt zodat het verschil duidelijk is: orderbevestigingen gaan als TransusXML, facturen als Karpi fixed-width INVOIC.

---

## 2026-04-30 — BTW-verlegd-flag voor intracommunautaire EU-debiteuren

Eerste echte BDSK round-trip in Transus' "Bekijken en testen" leverde een **structureel correcte EDIFACT D96A `ORDRSP`** op — alle GLN's, datums en LIN-segmenten matchen het origineel `edifact-output-ordrsp-bdsk-168911805.edi`. Eén productie-blokker bleef over: `<VATPercentage>21</VATPercentage>` ipv `0` (BDSK is intracommunautair B2B → BTW-verlegd).

- **Migratie 164** ([`164_btw_verlegd_intracom.sql`](../supabase/migrations/164_btw_verlegd_intracom.sql)):
  - Nieuwe kolom `debiteuren.btw_verlegd_intracom BOOLEAN DEFAULT FALSE`.
  - Conservatieve backfill — zet TRUE voor debiteuren met `land` in een herkenbare EU-non-NL lidstaat (DE, BE, FR, AT, IT, ES en ~20 andere; varianten incl. landcode + voluit-naam).
  - Partial index `idx_debiteuren_btw_verlegd_intracom` voor snelle filtering.
- **Frontend** ([`download-orderbev-xml.ts`](../frontend/src/lib/edi/download-orderbev-xml.ts)):
  - Query haalt `btw_verlegd_intracom` mee uit `debiteuren`.
  - Als flag=TRUE → `vatPercentage = 0`, anders fallback naar `btw_percentage` (default 21%).
- **Format-validatie BDSK orderbev:** in deze test bewezen dat `<OrderResponseNumber>ORD-2026-20200001</...>` (alfanumeriek) wordt geaccepteerd, en dat Karpi-artikelnrs in `<ArticleCodeSupplier>` (i.p.v. Basta-legacy `PATS23XX080150`) ook werken zolang GTIN klopt.
- **Auto-memory bijgewerkt:** `project_edi_transus` legt vast dat TransusXML voor BDSK orderbev werkt + alle BDSK-GLN-rollen.

---

## 2026-04-30 - EDI/Transus orderbevestiging technisch cutover-ready gemaakt

De handmatige round-trip-flow is doorgetrokken naar de echte queue/send-kant: orderbevestigingen worden nu als TransusXML in `edi_berichten.payload_raw` gezet, bestaande wachtrij-rijen met het oude fixed-width formaat worden omgezet zolang ze nog niet verstuurd zijn, en de nieuwe `transus-send` edge function verstuurt wachtrij-payloads via M10100.

- **Frontend:** `download-orderbev-xml.ts` gebruikt nu de echte orderkolommen (`order_nr`, `klant_referentie`, `besteller_gln`, `factuuradres_gln`, `afleveradres_gln`) en haalt BTW via `debiteuren.btw_percentage`; `bevestig-helper.ts` bouwt/queue't TransusXML met `order_response_seq`.
- **Edge:** gedeelde fixed-width parser accepteert Transus-regels met afgekapte trailing spaces; `transus-poll` schrijft M10300 ack-resultaten terug naar `ack_status`/`acked_at`; `transus-send` claimt en verstuurt uitgaande berichten via M10100.
- **Waarom:** de eerdere build faalde en de echte M10110-parser/send-flow liep nog niet gelijk met de bewezen BDSK TransusXML-rondreis.

---

## 2026-04-30 — producten.ean_code cleanup (`.0`-suffix) + tolerante EDI-matching

Fix voor data-quality issue dat tijdens de eerste echte BDSK-upload aan het licht kwam: `producten.ean_code` bevatte consistent een trailing `.0` (bv. `8715954176023.0`), erfenis van een Excel-import die GTIN's als FLOAT las. Hierdoor matchte de EDI-`match_edi_artikel`-RPC nooit op echte GTIN's uit Transus-berichten en vielen alle inkomende EDI-orderregels terug op `[EDI ongematcht]`.

- **Migratie 162** ([`supabase/migrations/162_producten_ean_code_cleanup.sql`](../supabase/migrations/162_producten_ean_code_cleanup.sql)):
  - Eenmalige `UPDATE` strijkt `.0`-suffix weg op alle bestaande rijen.
  - Nieuwe `BEFORE INSERT OR UPDATE`-trigger `producten_normaliseer_ean_code` strijkt `.0` + whitespace bij elke schrijfactie — voorkomt herhaling bij volgende imports.
  - `match_edi_artikel` uitgebreid met defensieve fallback (1b: probeert ook `p_gtin || '.0'`) als safety net mocht de trigger ooit niet gevuurd hebben.
- **Scope:** ~25.000 producten met `.0`-suffix, geen schade aan numeriek-correcte rijen.
- **Diagnose:** klant 8MRE0 op BDSK had drie GTIN's (`8715954176023`, `218143`, `235829`) die wel in `producten` stonden, maar onder Karpi's interne artikelnrs (`526230180`, `526920010`, `526100024`) — niet onder de Basta-legacy nummering `PATS23XX080150` etc. die in oude orderbev-XML's staat.

---

## 2026-04-30 — EDI handmatige upload/download voor round-trip-validatie

Nieuwe knop **"Bestand uploaden"** op [`/edi/berichten`](../frontend/src/pages/edi/berichten-overzicht.tsx) waarmee echte `.inh`-bestanden uit Transus' archief kunnen worden geüpload, geparseerd en verwerkt zonder dat de M10110 SOAP-poll actief hoeft te zijn. Op uitgaande orderbev-berichten staat een nieuwe **"TransusXML"-download-knop** die een `<ORDERRESPONSES>`-XML on-the-fly bouwt uit `orders` + `order_regels` — dat bestand kan in Transus' "Bekijken en testen"-tab worden geüpload om de partner-format-validatie te testen.

- **Plan:** [`docs/superpowers/plans/2026-04-30-edi-handmatige-upload-download.md`](superpowers/plans/2026-04-30-edi-handmatige-upload-download.md).
- **Nieuwe modules:**
  - [`frontend/src/lib/edi/upload-helper.ts`](../frontend/src/lib/edi/upload-helper.ts) — verwerkt `.inh`-bestand: sanity-check, parse, dedup op SHA-256, debiteur-match op GLN, insert, `create_edi_order` RPC.
  - [`frontend/src/lib/edi/transus-xml.ts`](../frontend/src/lib/edi/transus-xml.ts) — pure TransusXML-builder met `buildOrderbevTransusXml` + `buildOrderResponseNumber`. Format reverse-engineered uit echt BDSK-bestand `orderbev-uit-bdsk-168911805.xml`.
  - [`frontend/src/lib/edi/download-orderbev-xml.ts`](../frontend/src/lib/edi/download-orderbev-xml.ts) — bouwt XML on-demand uit DB-state (order + regels + producten.ean_code) en triggert download.
  - [`frontend/src/components/edi/upload-bericht-dialog.tsx`](../frontend/src/components/edi/upload-bericht-dialog.tsx) — modal met file-input, dedup-flag en preview-stap.
- **Database (migratie 161):**
  - `edi_handelspartner_config.orderbev_format` enum (`transus_xml` / `fixed_width`, default `transus_xml`).
  - `edi_berichten.order_response_seq` integer voor `<OrderResponseNumber>`-bouw (4-digit zero-padded suffix conform BDSK-voorbeeld: `26554360` + `0001` = `265543600001`).
  - `edi_berichten.transus_test_*` velden voor handmatige Transus-validatie-status (fase 4).
  - `ruim_edi_demo_data()` uitgebreid met `UPLOAD-`-prefix.
- **Parser-tolerantie:** `parseKarpiOrder` accepteert nu lengte-varianten van ±2 bytes per regel (rechts-padding met spaces). Echte BDSK 8MRE0 fixture had header 462 bytes ipv 463 — Transus levert soms zonder trailing space.
- **Tests:** 19 unit-tests groen in `src/lib/edi/`. Inclusief byte-vergelijking van TransusXML-builder tegen `orderbev-uit-bdsk-168911805.xml` en parser-test op `rondreis-bdsk-8MRE0/Karpi Group home fashion/ord168871472.inh`.

---

## 2026-04-30 — EDI/Transus pre-cutover dataverzamelplan

Nieuw document [`docs/transus/pre-cutover-data-stappenplan.md`](transus/pre-cutover-data-stappenplan.md) toegevoegd met een praktisch stappenplan voor de EDI-cutover: welke Transus-specificaties, voorbeeldberichten, GLN-/artikelmappings, API-testgegevens en operationele afspraken nog verzameld moeten worden, plus wat er technisch moet gebeuren zodra die data compleet is.

- **Waarom:** De huidige demo-rondreis bewijst vooral de interne RugFlow-flow, maar nog niet dat echte Transus input/output voor orderbevestiging en factuur door partners wordt geaccepteerd. Het plan maakt expliciet waar de go/no-go voor cutover op gebaseerd moet zijn.
- **Belangrijkste focus:** orderbevestiging eerst hard valideren via Transus Online `Bekijken en testen`; pas daarna M10100/M10110/M10300 productieflow activeren.

---

## 2026-04-29 — Orderregel claim-uitsplitsing als geneste sub-rijen

Op order-detail toont elke stuks-orderregel nu de volledige bron-uitsplitsing als visueel geneste sub-rijen onder de hoofdregel — gericht op de verzamelaar in het magazijn die moet zien dat een deel van een uitwisselbaar artikel komt en omgestickerd moet worden.

- **Wat er per regel staat:** vier mogelijke sub-rijen in vaste leverbaarheid-volgorde — eigen voorraad → omsticker → IO → wacht op nieuwe inkoop. Sub-aantallen tellen op tot `te_leveren` (synthetische "wacht"-rij vult het tekort in).
- **Visuele stijl:** neutraal grijs voor eigen voorraad + IO; amber voor omsticker (actie vereist); rose voor wacht (probleem). Sub-aantallen staan onder de "Te leveren"-kolom; bron-info colSpant Artikel + Omschrijving (Patroon II — aantallen blijven uitgelijnd).
- **Omsticker-regel** toont het bron-artikelnr (klikbaar), omschrijving van het uitwisselbare product, locatie als bekend, en een expliciete "→ stickeren naar {orderregel.artikelnr}"-noot.
- **Scope:** alleen stuks-orders met `te_leveren > 0` en `is_maatwerk=false`. Maatwerk-regels behouden hun bestaande paarse maatwerk-info-rij; m-rollen-orders en volledig verzonden regels blijven zonder sub-rijen.
- **Verwijderd:** de klikbare popover (`RegelClaimDetail`) op de levertijd-badge en de `via INK-...`-hint daaronder — dezelfde info staat nu uitgeklapt zonder klik. `LevertijdBadge` blijft op de hoofdregel als snelle status-glance.
- **Niet op factuur:** de uitsplitsing is puur intern/operationeel. Conform business-rule mig 154 blijven factuur en order-regel-weergave 1× origineel artikel.
- **Data:** nieuwe query [`fetchClaimsVoorOrder`](../frontend/src/lib/supabase/queries/reserveringen.ts) — één call voor alle claims van een order + één gebatchte product-lookup voor `fysiek_artikelnr`-omschrijving en -locatie. Hook `useClaimsVoorOrder` parallel aan `useLevertijdVoorOrder`.

---

## 2026-04-29 — EDI/Transus-koppeling: fundament voor inkomend verkeer

Eerste fase van de migratie van Windows Connect (op MITS-CA-01-009) naar de Transus SOAP API. Karpi heeft 39 EDI-handelspartners (~9.000 berichten/12 maanden, top-5 = 84% volume — BDSK 44%, SB-Möbel BOSS 18%, Hornbach NL, Hammer, Krieger). Plan: [`docs/superpowers/plans/2026-04-29-edi-transus-koppeling.md`](superpowers/plans/2026-04-29-edi-transus-koppeling.md).

- **Bericht-formaat: fixed-width "Custom ERP" (Basta-compatibel).** Drie productie-voorbeelden van 2026-04-29 geanalyseerd ([`docs/transus/voorbeelden/`](transus/voorbeelden/)). Transus-Online label bevestigt: gegevensbron-type "Fixed length", ID 17653, versie 10. Kolomposities reverse-engineered uit Ostermann (rijke veldenset, 23 regels) + BDSK (schrale veldenset, 1 regel). Header = 463 bytes, article = 281 bytes. EDIFACT-passthrough naar partners blijft werk van Transus.
- **Datamodel:** [`edi_handelspartner_config`](../supabase/migrations/156_edi_handelspartner_config.sql) (per debiteur de 4 berichttype-toggles + transus_actief + test_modus); [`edi_berichten`](../supabase/migrations/157_edi_berichten.sql) (centrale audit-/queue-tabel met enum `edi_bericht_status`); GLN-velden + `bes_*`-snapshots op `orders` voor de 4-staps partij-keten (BY/IV/DP/SN); `app_config.bedrijfsgegevens.gln_eigen=8715954999998`.
- **RPCs:** `log_edi_inkomend` (idempotent op transactie_id), `markeer_edi_ack`, `enqueue_edi_uitgaand` (idempotent op berichttype+bron), `claim_volgende_uitgaand` (FOR UPDATE SKIP LOCKED), `markeer_edi_verstuurd`, `markeer_edi_fout` (retry-loop, max 3).
- **Edge functions:** [`_shared/transus-soap.ts`](../supabase/functions/_shared/transus-soap.ts) (M10100/M10110/M10300 SOAP-client, base64+CP-1252 handling); [`_shared/transus-formats/karpi-fixed-width.ts`](../supabase/functions/_shared/transus-formats/karpi-fixed-width.ts) (parser voor Order-bericht — 100% match tegen 2 voorbeelden in test); [`transus-poll`](../supabase/functions/transus-poll/index.ts) (cron-driven inbox-leeghaler in **read-only modus**: parseert + logt + ackt zonder order-creatie).
- **Frontend:** nieuwe sidebar-sectie "EDI" met `/edi/berichten`-overzicht (in/uit toggle, status- en type-filters, polling 30s) en `/edi/berichten/:id` detailpagina (geparseerde JSON + ruwe payload + retry-info + gerelateerde order/factuur).
- **Buiten V1-fase 1:** order-creatie via `create_edi_order` RPC (komt in fase 2 zodra parser-validatie via Transus' Testen-tab klopt); uitgaande triggers voor orderbev/factuur/verzending; cutover van WC naar API. Vereist nog: `TRANSUS_CLIENT_ID` + `TRANSUS_CLIENT_KEY` als Supabase secrets, test-handelspartner van Transus, en Maureen-akkoord voor de Custom ERP-config-overstap.
- **Cutover-constraint** (uit Transus' antwoord): Windows Connect en de API kunnen niet parallel draaien (beide bevestigen automatisch). Cutover is dus big-bang voor alle 39 partners. Pilot-validatie loopt via Transus' test-handelspartner.
- **Migraties:** [156](../supabase/migrations/156_edi_handelspartner_config.sql), [157](../supabase/migrations/157_edi_berichten.sql).

---

## 2026-04-29 — Inkoop-reserveringen V1: bugfixes + afleverdatum-sync + uitwisselbaar-hint

Drie issues uit de eerste live-test van ORD-2026-2004:

- **Migratie 153** — `herwaardeer_order_status` synct nu ook `orders.afleverdatum` naar de laatste IO-claim-leverdatum (verwacht_datum + buffer). Schuift alleen vooruit, nooit terug. Voorheen gaf ORD-2026-2004 afleverdatum 04-05-2026 + levertijd 2026-W27 — inconsistent. Helper `bereken_late_claim_afleverdatum(order_id)` + `sync_order_afleverdatum_met_claims(order_id)`. Backfill draait éénmalig over alle open orders met IO-claims.
- **Bug fix** [`fetchClaimsVoorProduct`](../frontend/src/lib/supabase/queries/producten.ts) — PostgREST `.eq()` op een nested join-kolom (`order_regels.artikelnr`) filterde niet. Herschreven naar twee-stap: eerst orderregel-IDs van het artikel ophalen (incl. `fysiek_artikelnr` voor omstickeren), dan claims op die IDs. Product-detail toont nu correct de "Op voorraad gereserveerd" + "Wacht op inkoop" secties voor het bekeken artikel.
- **UI-suggestie uitwisselbaar bij tekort** — nieuwe component [`UitwisselbaarTekortHint`](../frontend/src/components/orders/uitwisselbaar-tekort-hint.tsx) verschijnt inline onder een orderregel met `te_leveren > vrije_voorraad` als er uitwisselbare producten met voorraad zijn. Klik = `omstickeren` aanzetten (commerciële keuze van de gebruiker, geen DB-allocatie). Allocator blijft simpel: exact-artikelnr-matching.

---

## 2026-04-29 — Inkoop-reserveringen V1 (vaste maten)

Reserveringssysteem uitgebreid met harde koppeling naar inkooporderregels voor vaste maten — order-aanmaak alloceert automatisch over voorraad + openstaande inkoop, met klantkeuze "deelleveren / in 1×" en berekende verwachte leverweek per orderregel. Maatwerk krijgt alleen een levertijd-indicator (V1).

- **Datamodel:** nieuwe tabel [`order_reserveringen`](../supabase/migrations/144_order_reserveringen_basis.sql) (`bron='voorraad' | 'inkooporder_regel'`); kolom `orders.lever_modus` (`deelleveringen | in_een_keer`); enum-waarde `Wacht op inkoop`. Buffer-keys `inkoop_buffer_weken_vast=1` / `inkoop_buffer_weken_maatwerk=2` in `app_config.order_config`.
- **Allocatie-seam:** [`herallocateer_orderregel(p_order_regel_id)`](../supabase/migrations/145_order_reserveringen_rpcs.sql) — idempotent: release alle actieve claims + alloceer voorraad-eerst, dan oudste IO (`verwacht_datum ASC`). Triggers (mig 146) op `order_regels` mutatie + `orders` status + `inkooporders` `Geannuleerd` schakelen automatisch in. Claim-volgorde-prio: wie eerst claimt, wordt eerst beleverd.
- **Vrije voorraad:** `vrije_voorraad = voorraad − gereserveerd − backorder` (geen `+ besteld_inkoop` meer); `gereserveerd` is voortaan SUM van actieve `bron='voorraad'`-claims (mig 149). Toekomstige inkoop blijft zichtbaar via `besteld_inkoop` en `order_reserveringen` maar telt niet meer mee in "vandaag-leverbaar".
- **Ontvangst:** [`boek_voorraad_ontvangst`](../supabase/migrations/148_boek_voorraad_ontvangst_consumeer_claims.sql) consumeert IO-claims in claim-volgorde en verschuift naar voorraad-claims (mig 148).
- **Views:** `order_regel_levertijd` (status + verwachte_leverweek per regel) + `inkooporder_regel_claim_zicht` (geclaimd/vrij per IO-regel) — mig 150.
- **RPC's bijgewerkt (mig 152):** `create_order_with_lines` + `update_order_with_lines` lezen `lever_modus` uit JSONB-payload zodat de `LeverModusDialog`-keuze persisteert.
- **Frontend:** levertijd-badge per orderregel (groen/amber/rose/violet) met claim-popover (`RegelClaimDetail`); `LeverModusDialog` opent bij opslaan als ≥1 regel tekort heeft (default uit `debiteuren.deelleveringen_toegestaan`); `IORegelClaimsPopover` op IO-detail; "Op voorraad gereserveerd" + "Wacht op inkoop" secties op product-detail; maatwerk-levertijdhint op `op-maat-selector` (eerstvolgende inkoopweek + 2 wk).
- **Architectuur:** gedeelde [`isoWeek()`-helper](../frontend/src/lib/utils/iso-week.ts) — bron-van-waarheid voor week-uit-datum berekeningen in de UI, parallel aan SQL-side `iso_week_plus()`.
- **Migraties:** [144](../supabase/migrations/144_order_reserveringen_basis.sql), [145](../supabase/migrations/145_order_reserveringen_rpcs.sql), [146](../supabase/migrations/146_order_reserveringen_triggers.sql), [147](../supabase/migrations/147_inkoop_status_release_trigger.sql), [148](../supabase/migrations/148_boek_voorraad_ontvangst_consumeer_claims.sql), [149](../supabase/migrations/149_vrije_voorraad_semantiek.sql), [150](../supabase/migrations/150_order_reserveringen_views.sql), [151](../supabase/migrations/151_backfill_order_reserveringen.sql), [152](../supabase/migrations/152_order_rpcs_lever_modus.sql).
- **V2-backlog:** maatwerk-claim op IO-rol, handmatige IO-keuze (override), spoed-prio (claim-stelen), klantnotificatie bij IO-vertraging, claim voor `eenheid='m'`-rollen.

---

## 2026-04-29 — Snijden: SnijVolgorde als deep module + operator-vriendelijke mes-instructies

### 2026-04-29 — Rol-uitvoer modal: rij = breedte-mes-instelling, geen y-band-clustering
- **Wat:** De rol-uitvoer modal toonde elke shelf met absolute lengte-mes-positie ("Rij 1 · Lengte-mes op 866 cm") en clusterde pieces met aangrenzende y-banden ten onrechte in één rij. Nieuw: **één Rij = één breedte-mes-instelling**. Pieces gestapeld langs de rollengte met verschillende breedtes worden nu aparte Rijen; consecutive Rijen met dezelfde primary breedte-mes-positie krijgen een `(blijft staan)`-badge ("Mes laten staan op 325" — operator-feedback van 24-04). Ronde stukken tonen "snij vierkant 325×325 → 320×320 rond met de hand" met de marge correct opgeteld. Lengte-mes is nu incrementeel ("lengte 275") i.p.v. absoluut.
- **Waarom:** Operator-feedback van de snijder (24-04, 3 screenshots IC2901TA21C/VERR130 C/I26080LO13C/MARI13): de huidige modal toonde foute mes-instellingen — soms één Rij voor 3 pieces met verschillende breedtes, ronde stukken zonder de +5cm vierkant-instructie, en absolute lengte-mes-waarden waar incrementele duidelijker zijn. Het deep-module-refactor extraheert ~250 regels shelf-grouping + knife-derivation uit `rol-uitvoer-modal.tsx` (842→~600 regels) naar [`frontend/src/lib/snij-volgorde/`](frontend/src/lib/snij-volgorde/) als pure functie — testbaar zonder React-mount, herbruikbaar voor toekomstige print/sticker views, en de rij-definitie matcht het mentale model van de operator.
- **Architectuur:** [`buildSnijVolgorde(input) → SnijVolgorde`](frontend/src/lib/snij-volgorde/derive.ts) is een pure functie die `Placement[]` (uit `snijplanning_overzicht`) + reststukken/aangebroken/afval (uit [compute-reststukken.ts](frontend/src/lib/utils/compute-reststukken.ts)) transformeert naar geordende `Rij[]` met `KnifeOperation`-rijen. Per `KnifeOperation` zijn `snij_maat` (wat het mes maakt, incl. marge) en `bestelde_maat` (klant-orientatie) gescheiden, plus een `handeling`-enum (`geen|orientatie_swap|rond_uitsnijden|ovaal_uitsnijden|zo_marge_extra`) die de UI vertaalt naar de juiste hand-bewerking-tekst.
- **Migratie 143:** [`supabase/migrations/143_snijplanning_overzicht_marge_geroteerd.sql`](supabase/migrations/143_snijplanning_overzicht_marge_geroteerd.sql) breidt `snijplanning_overzicht` uit met `marge_cm` (single-source uit `stuk_snij_marge_cm()` migratie 126) en `geroteerd` (was niet via view exposed). **Status:** initiële migratie-poging gaf `42P16: cannot drop columns from view` omdat de live view extra kolommen heeft die niet in de repo staan (gemaakt via SQL editor). Wachten op Miguel's kolom-output van `information_schema.columns` voor strikte superset.
- **Tests:** 19 nieuwe unit tests in [derive.test.ts](frontend/src/lib/snij-volgorde/derive.test.ts) met echte LORA 13-fixture (uit DB-query 2026-04-29), synthetische multi-lane (VERR130 C-stijl), geroteerd rechthoek, ZO-marge, en reststuk-markers.
- **Files:** [frontend/src/lib/snij-volgorde/types.ts](frontend/src/lib/snij-volgorde/types.ts), [frontend/src/lib/snij-volgorde/derive.ts](frontend/src/lib/snij-volgorde/derive.ts), [frontend/src/lib/snij-volgorde/derive.test.ts](frontend/src/lib/snij-volgorde/derive.test.ts), [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx), [frontend/src/lib/types/productie.ts](frontend/src/lib/types/productie.ts), [supabase/migrations/143_snijplanning_overzicht_marge_geroteerd.sql](supabase/migrations/143_snijplanning_overzicht_marge_geroteerd.sql).

## 2026-04-29 — Uitwisselbaarheid: canonieke seam (fase 1 — functie + diff-check)

### 2026-04-29 — Fase 2 (deel 1): snijplanning callers omzetten naar `uitwisselbare_paren()`
- **Wat:** Migratie [142_tekort_analyse_via_uitwisselbare_paren.sql](supabase/migrations/142_tekort_analyse_via_uitwisselbare_paren.sql) herschrijft `snijplanning_tekort_analyse()`: de drie parallelle CTE's (Map1 / collectie / self) worden vervangen door één `LATERAL JOIN uitwisselbare_paren(g.kwaliteit_code, g.kleur_code)`. Daarnaast: TypeScript-helpers `fetchUitwisselbarePairs` + `fetchUitwisselbareCodes` zijn samengevoegd tot één `fetchUitwisselbareParen()` die de RPC aanroept; `fetchBeschikbareRollen` + `fetchBezettePlaatsingen` accepteren nu een `KwaliteitKleurPair[]`-input. Edge functions [auto-plan-groep](supabase/functions/auto-plan-groep/index.ts) en [optimaliseer-snijplan](supabase/functions/optimaliseer-snijplan/index.ts) zijn ontdaan van hun Map1→collectie fallback-cascade — één RPC-call doet alles.
- **Waarom:** De edge function en de UI tekort-analyse gebruikten verschillende fallback-volgordes en konden daardoor verschillende uitwissel-sets opleveren voor hetzelfde input-paar. Met de canonieke seam zien beide gegarandeerd dezelfde set. De code is bovendien fors korter (geen handgeschreven OR-clauses meer in de edge, geen drie-CTE-cascade in SQL).
- **Status van de 4 conflict-paren** uit de diff-check: DREA ↔ PLUS (basis PLUS11/PLUS12), waar Map1 ze als aliassen markeert maar de collecties "cloud" (id 36) en "PLUSH" (id 30) ze als verschillende lijnen behandelen. Beslissing: collecties wint; deze 4 Map1-rijen verdwijnen vanzelf wanneer Map1 in fase 3 gedropt wordt. Mocht het toch dezelfde lijn zijn, dan kan handmatig `UPDATE kwaliteiten SET collectie_id = 36 WHERE collectie_id = 30` uitgevoerd worden voordat fase 3 start.
- **Volgende stappen** (fase 2 — deel 2): `kleuren_voor_kwaliteit()` SQL refactoren; `op-maat.ts` `fetchMaatwerkArtikelNr` + `fetchStandaardBandKleur` ad-hoc cascades vervangen; heroverwegen of `uitwisselbare_partners` + `rollen_uitwissel_voorraad` nog nodig zijn naast de RPC. **Fase 3:** `kwaliteit_kleur_uitwisselgroepen` + view `kwaliteit_kleur_uitwisselbaar` + `import_uitwisselgroepen.py` droppen.
- **Files:** [supabase/migrations/142_tekort_analyse_via_uitwisselbare_paren.sql](supabase/migrations/142_tekort_analyse_via_uitwisselbare_paren.sql), [supabase/functions/_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts), [supabase/functions/auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts), [supabase/functions/optimaliseer-snijplan/index.ts](supabase/functions/optimaliseer-snijplan/index.ts).

### 2026-04-29 — Map1 → collectie-gaps data-driven dichten (alle groepen)
- **Wat:** Migratie [141_uitwissel_collectie_gaps_data_driven.sql](supabase/migrations/141_uitwissel_collectie_gaps_data_driven.sql) loopt over ALLE Map1-groepen `(basis_code, variant_nr)` en past de structurele gaps aan: groepen waarvan geen lid een collectie heeft krijgen een nieuwe collectie (naam = basis_code, groep_code = `m1_<basis>_v<n>`); groepen waarvan één lid wel een collectie heeft krijgen de andere leden in diezelfde collectie. Genuine conflicts (leden in verschillende collecties — 4 paren in de diff-check) worden geskipt met `RAISE NOTICE` en blijven zichtbaar in `uitwisselbaarheid_map1_diff` voor handmatige beslissing.
- **Waarom:** Migratie 139 dekte slechts 3 hand-gepickte clusters; de echte diff was 154 rijen verspreid over veel meer Map1-groepen. Een data-driven aanpak is robuuster en idempotent.
- **Files:** [supabase/migrations/141_uitwissel_collectie_gaps_data_driven.sql](supabase/migrations/141_uitwissel_collectie_gaps_data_driven.sql).

### 2026-04-29 — `uitwisselbare_paren()` v2: bron-check verwijderen + genormaliseerde output
- **Wat:** Migratie [140_uitwisselbare_paren_zonder_bron_check.sql](supabase/migrations/140_uitwisselbare_paren_zonder_bron_check.sql) herschrijft de canonieke functie. Twee aanpassingen: (1) de check "(target_kw, target_kl) moet bestaan in producten ∪ rollen ∪ maatwerk_m2_prijzen" is verwijderd — pure aliassen zonder eigen voorraad/product (zoals SOPI/SOPV) werden onterecht overgeslagen; (2) `target_kleur_code` in de output is nu altijd genormaliseerd (".0"-suffix gestript), callers normaliseren hun join-side.
- **Waarom:** De v1 uit migratie 138 koppelde de aliassing-relatie aan voorraad-bestaan. Maar zoals het domein werkt: voorraad ligt vaak alleen onder de "primaire" naam (CISC of VELV), pas bij output (sticker na snijden, of stickerwissel bij vaste maten) wordt een alias-naam toegekend. SOPI is een valide alias voor CISC ook als er nooit een SOPI-rij in producten staat. De relatie is *administratief*, niet *materieel*. Diff-check `uitwisselbaarheid_map1_diff` gaf na migratie 139 dan ook 154 rijen i.p.v. de verwachte 0; na 140 zou dat 0 moeten zijn.
- **Files:** [supabase/migrations/140_uitwisselbare_paren_zonder_bron_check.sql](supabase/migrations/140_uitwisselbare_paren_zonder_bron_check.sql).

### 2026-04-29 — Map1 → collectie-gaps dichten (3 clusters)
- **Wat:** Migratie [139_uitwissel_collectie_gaps_dichten.sql](supabase/migrations/139_uitwissel_collectie_gaps_dichten.sql) repareert de 49 rijen die de diff-check uit migratie 138 retourneerde — allemaal categorie "input/target zonder collectie_id". Drie clusters waar Map1 wél een aliassing-relatie bevatte maar `kwaliteiten.collectie_id` niet ingevuld was: SOPI+SOPV (gekoppeld aan bestaande CISC/VELV-collectie), ANNA+BREE (nieuwe collectie `m1anna`), BERM+EDGB (nieuwe collectie `m1berm`). Idempotent (`ON CONFLICT DO NOTHING` + `IS NULL`-guards). Verificatie: na toepassing moet `SELECT COUNT(*) FROM uitwisselbaarheid_map1_diff` = 0 geven.
- **Waarom:** Map1 dekte deze paren wel, de collectie-regel niet. Voordat callers omgezet kunnen worden naar `uitwisselbare_paren()` moest de collectie-tabel deze paren ook bevatten — anders zouden ze als "geen partners" worden gezien zodra Map1 wegvalt. Naam-keuze "m1anna"/"m1berm" is een placeholder; hernoemen kan later via UPDATE op `collecties.naam`.
- **Files:** [supabase/migrations/139_uitwissel_collectie_gaps_dichten.sql](supabase/migrations/139_uitwissel_collectie_gaps_dichten.sql).

### 2026-04-29 — `uitwisselbare_paren()` als bron-van-waarheid voor uitwissel-relaties
- **Wat:** Migratie [138_uitwisselbare_paren_canoniek.sql](supabase/migrations/138_uitwisselbare_paren_canoniek.sql) introduceert SQL-functie `uitwisselbare_paren(p_kwaliteit_code, p_kleur_code)` die alle aliassen voor een (kwaliteit, kleur)-paar teruggeeft. Resolver: zelfde `kwaliteiten.collectie_id` én genormaliseerde kleur-code matcht (via bestaande helper `normaliseer_kleur_code()`). Bron: producten ∪ rollen ∪ maatwerk_m2_prijzen — een paar wordt herkend zodra het ergens in het systeem bestaat. Self-row altijd gegarandeerd. Plus: diagnostische view `uitwisselbaarheid_map1_diff` die laat zien welke Map1-paren nog NIET door de nieuwe regel afgedekt worden, met een `reden`-kolom per onbedekt paar.
- **Waarom:** De edge functie voor snijplanning had inconsistent gedrag bij uitwisselbare kwaliteiten omdat ZES callers zelfstandig de uitwissel-logica reproduceerden — soms op `kwaliteit_kleur_uitwisselgroepen` (Map1), soms op `kwaliteiten.collectie_id`, soms op een hybride fallback-cascade, met verschillende uitkomsten voor dezelfde input. Daardoor zag bv. order-aanmaak géén equivalent-voorraad waar snijplanning die wél vond. De UI Producten → "Uitwisselbaar"-tab gebruikte al de collectie+kleur-regel (56 groepen, 170 leden, kleuren met hetzelfde nummer auto-gekoppeld) — dat is nu de canonieke regel die alle backend-callers gaan delen. Domein-rationale: kwaliteit-codes zijn aliassen voor één fysieke partij (verschillende namen voor verschillende afnemers), zie nieuwe entry "Aliassing-lagen" in [data-woordenboek.md](docs/data-woordenboek.md).
- **Volgende stappen** (na verificatie dat `SELECT * FROM uitwisselbaarheid_map1_diff` leeg is, eventueel via collectie-membership uitbreiden voor onbedekt paren): herschrijf `snijplanning_tekort_analyse()` + `kleuren_voor_kwaliteit()`, vervang `_shared/db-helpers.ts` `fetchUitwisselbarePairs`/`fetchUitwisselbareCodes` door één RPC-call, refactor `op-maat.ts` `fetchMaatwerkArtikelNr` + `fetchStandaardBandKleur`, drop `kwaliteit_kleur_uitwisselgroepen` + view `kwaliteit_kleur_uitwisselbaar` + import-script `import_uitwisselgroepen.py`.
- **Files:** [supabase/migrations/138_uitwisselbare_paren_canoniek.sql](supabase/migrations/138_uitwisselbare_paren_canoniek.sql), [docs/data-woordenboek.md](docs/data-woordenboek.md), [docs/database-schema.md](docs/database-schema.md).

## 2026-04-24 — Inkoop-zicht op rollen-overview + product-detail

### 2026-04-24 — Tag "besteld m²" per kwaliteit/kleur + eerstvolgende leverweek
- **Wat:** Nieuwe RPC [`besteld_per_kwaliteit_kleur()`](supabase/migrations/137_besteld_per_kwaliteit_kleur.sql) aggregeert openstaande inkooporder-regels per (kwaliteit, kleur): totaal `te_leveren_m`, omgerekend naar m² via `kwaliteiten.standaard_breedte_cm`, aantal orders, eerstvolgende `leverweek` + `verwacht_datum`, plus het deel dat in díe eerstvolgende levering valt. Hergebruikt de bestaande view `openstaande_inkooporder_regels` (migratie 127). `fetchRollenGegroepeerd()` mergt deze info op elke groep (veld `inkoop`) en maakt ook lege groepen aan voor combinaties die alléén besteld staan — zodat "LAMI 15 — 300 m² besteld, wk 18/2026" toch in de overview verschijnt.
- **Waarom:** Zonder dit was "hoeveel komt er nog binnen?" alleen zichtbaar in het inkoopmodule-overzicht, niet op het moment dat je naar een voorraad-groep kijkt. Operators/inkopers zagen vaak "Geen voorraad" terwijl er volgende week al een rol zou binnenkomen. De eerstvolgende leverweek in de tag maakt directe prioritering mogelijk ("kan ik wachten of moet ik nu orderen?").
- **UI:** [rollen-groep-row.tsx](frontend/src/components/rollen/rollen-groep-row.tsx) — nieuwe `BesteldChip` naast de bestaande status-badges/partner-chips, met `Truck`-icoon, m²-totaal en "wk NN/YYYY"-label. Bij hover tooltip met orders-count + split "waarvan X m² in eerste levering". Lege groepen (alleen inkoop, geen voorraad) vervangen de "Geen voorraad"-tag door de inkoop-chip.
- **Files:** [supabase/migrations/137_besteld_per_kwaliteit_kleur.sql](supabase/migrations/137_besteld_per_kwaliteit_kleur.sql), [frontend/src/lib/supabase/queries/rollen.ts](frontend/src/lib/supabase/queries/rollen.ts), [frontend/src/lib/types/productie.ts](frontend/src/lib/types/productie.ts), [frontend/src/components/rollen/rollen-groep-row.tsx](frontend/src/components/rollen/rollen-groep-row.tsx).

### 2026-04-24 — Product-detail: sectie "Openstaande inkooporders"
- **Wat:** Product-detailpagina krijgt een nieuwe tabel onder de voorraad-block met álle openstaande inkooporder-regels voor het artikel: inkooporder-nr (link naar detail), leverancier, status, verwachte leverweek, besteld/geleverd/te leveren meters. Gesorteerd op `verwacht_datum ASC` zodat de eerstvolgende levering bovenaan staat. Nieuwe query `fetchOpenstaandeInkoopregelsVoorArtikel()` + hook `useOpenstaandeInkoopVoorArtikel()` — leest rechtstreeks uit de bestaande view `openstaande_inkooporder_regels`.
- **Waarom:** Het veld "Besteld (ink)" in de voorraad-block toonde alleen een totaal zonder context. Je moest naar het inkoopmodule om te zien wanneer/van wie het kwam. Nu is dat één blik op de productpagina.
- **Files:** [frontend/src/lib/supabase/queries/inkooporders.ts](frontend/src/lib/supabase/queries/inkooporders.ts), [frontend/src/hooks/use-inkooporders.ts](frontend/src/hooks/use-inkooporders.ts), [frontend/src/pages/producten/product-detail.tsx](frontend/src/pages/producten/product-detail.tsx).

## 2026-04-24 — Fix: `boek_ontvangst` werkelijke voorraad_mutaties-kolommen
- **Wat:** Migratie [136_boek_ontvangst_voorraad_mutaties_schema_fix.sql](supabase/migrations/136_boek_ontvangst_voorraad_mutaties_schema_fix.sql) herschrijft de INSERT in `voorraad_mutaties` binnen `boek_ontvangst` naar de werkelijke kolomnamen: `lengte_cm`/`breedte_cm`/`notitie`/`aangemaakt_door`/`referentie_id`/`referentie_type` + `type='inkoop'`. Eerdere versies (migraties 127/133/135) gebruikten verzonnen namen (`lengte_voor_cm`, `lengte_na_cm`, `reden`, `medewerker`, type=`'ontvangst'`) uit outdated docs, wat leidde tot runtime-error `column "lengte_voor_cm" of relation "voorraad_mutaties" does not exist` zodra een operator ontvangst probeerde te boeken.
- **Waarom:** De echte tabel-definitie komt uit commit `ece9ecd` (productiemodule-foundation) en is nooit gewijzigd. De docs in [database-schema.md](docs/database-schema.md) beschreven een verzonnen schema — nu gesynchroniseerd met de werkelijke DB-structuur.
- **Files:** [supabase/migrations/136_boek_ontvangst_voorraad_mutaties_schema_fix.sql](supabase/migrations/136_boek_ontvangst_voorraad_mutaties_schema_fix.sql), [docs/database-schema.md](docs/database-schema.md).

## 2026-04-24 — Inkoop: auto-genereer rolnummers bij ontvangst (R-YYYY-NNNN)

### 2026-04-24 — `boek_ontvangst` genereert rolnummer automatisch
- **Wat:** Migratie [135_boek_ontvangst_auto_rolnummer.sql](supabase/migrations/135_boek_ontvangst_auto_rolnummer.sql) maakt sequence `r_2026_seq` en update `boek_ontvangst`: als het `rolnummer`-veld in de JSONB input leeg/null is, genereert hij via `volgend_nummer('R')` een nieuw nummer in de ERP-brede conventie (`R-2026-0001`, `R-2026-0002`, …). Behoudt de m²-fix uit migratie 133. Bij (zeer onwaarschijnlijke) collision met legacy numerieke/S-prefix rolnummers retry't de RPC tot een vrij nummer.
- **Waarom:** Operator hoefde geen zelfbedacht rolnummer meer te typen in de ontvangst-dialog (foutgevoelig, risico op duplicaten/collisions). De conventie `R-YYYY-NNNN` is consistent met `ORD-YYYY-`, `INK-YYYY-`, `SNIJ-YYYY-` en onmiddellijk herkenbaar als "nieuwe-systeem-rol" t.o.v. legacy (puur numeriek of S-prefix).
- **UI:** [ontvangst-boeken-dialog.tsx](frontend/src/components/inkooporders/ontvangst-boeken-dialog.tsx) — rolnummer-input is niet meer verplicht (placeholder "leeg = auto R-YYYY-NNNN"). Na succes toont de dialog een bevestigings-view met de toegekende rolnummers zodat de operator ze kan noteren/printen voor de fysieke rollen.
- **Bonus-fix:** `useBoekOntvangst` invalideert nu ook `['inkooporder-detail']` — voorheen bleef "Te leveren" op de detail-pagina hangen op de oude waarde direct na ontvangst.
- **Files:** [supabase/migrations/135_boek_ontvangst_auto_rolnummer.sql](supabase/migrations/135_boek_ontvangst_auto_rolnummer.sql), [frontend/src/components/inkooporders/ontvangst-boeken-dialog.tsx](frontend/src/components/inkooporders/ontvangst-boeken-dialog.tsx), [frontend/src/lib/supabase/queries/inkooporders.ts](frontend/src/lib/supabase/queries/inkooporders.ts), [frontend/src/hooks/use-inkooporders.ts](frontend/src/hooks/use-inkooporders.ts).

## 2026-04-24 — Snijplanning: cross-kwaliteit fix + tekort-analyse UI + packing lookahead

### 2026-04-24 — Packing lookahead: minimaliseer aantal aangesneden rollen
- **Wat:** `packAcrossRolls` in [guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts) draait nu **twee greedy passes** met verschillende rol-sortering en kiest de globaal beste uitkomst. De default sort (reststuk-eerst, daarbinnen kleinste) behoudt reststuk-opmaak-gedrag; de nieuwe `sortRollsLargestFirst` probeert binnen dezelfde priority-tier grootste rol eerst te gebruiken. `compareResults` pikt de uitkomst met minste niet-geplaatst → minste rollen → minste m²-gebruik → laagste afval.
- **Waarom:** Real-world case MARI 13 (2026-04-24): 5 stukken met 3 beschikbare rollen (1300, 1500, 350). Oude packer kiest kleinste rol eerst → 3 rollen aangebroken. Operator bevestigde dat alle 5 op de 1500-rol passen met rotaties (Y-gebruik ~1440 cm). Elk extra aangebroken rol = schaar-omstelling + meer reststuk-fragmenten = verloren tijd.
- **Impact:** Geen API-wijziging; edge functions (`auto-plan-groep`, `optimaliseer-snijplan`) werken onveranderd. Regressietest toegevoegd in [guillotine-packing.test.ts](supabase/functions/_shared/guillotine-packing.test.ts): `LOOKAHEAD: MARI13 — bundelt op 1 grote rol` + `LOOKAHEAD: reststuk-voorkeur blijft gerespecteerd`. Runtime-kosten: 2× packing-werk per groep — acceptabel want groepen zijn klein (≤ tientallen stukken).
- **Files:** [supabase/functions/_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts), [supabase/functions/_shared/guillotine-packing.test.ts](supabase/functions/_shared/guillotine-packing.test.ts).

## 2026-04-24 — Snijplanning: cross-kwaliteit release-bug + tekort-analyse UI-mismatch

### 2026-04-24 — Fix: `release_gepland_stukken` respecteert cross-kwaliteit plaatsingen
- **Wat:** Migratie [133_release_gepland_op_bestel_kwaliteit.sql](supabase/migrations/133_release_gepland_op_bestel_kwaliteit.sql) herschrijft `release_gepland_stukken(p_kwaliteit, p_kleur)` zodat hij filtert op `order_regels.maatwerk_kwaliteit_code / _kleur_code` i.p.v. op `rollen.kwaliteit_code / _kleur_code`. De oude versie (migratie 073) gaf álle Gepland-snijplannen op een LUXR-rol vrij wanneer `auto-plan-groep(LUXR, 17)` draaide — dus ook de VERR 17-stukken die via uitwisselbaarheid correct op LUXR-rollen geplaatst stonden. Die verweesden daarna (`rol_id = NULL`) terwijl hun snijvoorstel op `goedgekeurd` bleef staan.
- **Waarom:** Root cause-analyse (systematic-debugging skill, zie conversatie 2026-04-24) wees uit dat het packing-algoritme wél correcte kandidaten vond en `keur_snijvoorstel_goed` wél juist koppelde, maar dat de eerstvolgende auto-plan-cyclus voor de ROL-kwaliteit de cross-kwaliteit plaatsingen kapot maakte. Symptoom: screenshots waar LUXR-rollen VERR-stukken toonden in het goedgekeurde voorstel, maar de huidige `snijplannen`-rij `rol_id = NULL` had. Exacte matches (LUXR-stuk op LUXR-rol) bleven heel, omdat die alleen geraakt werden wanneer de eigen kwaliteit-groep herplande.
- **Impact:** Cross-kwaliteit plaatsingen blijven voortaan intact. Bestaande verweesde snijplannen (`rol_id=NULL, status=Gepland/Wacht`) worden automatisch opgepakt zodra `auto-plan-groep` opnieuw voor hún eigen groep draait. Voor een eenmalige sweep: `node scripts/herplan-alle-groepen.mjs`.
- **Regressietest:** [scripts/test-release-cross-kwaliteit.sql](scripts/test-release-cross-kwaliteit.sql) — dummy VERR-op-LUXR plaatsing + beide release-richtingen, alles in `BEGIN; … ROLLBACK;` zodat er geen data blijft hangen.
- **Files:** [supabase/migrations/133_release_gepland_op_bestel_kwaliteit.sql](supabase/migrations/133_release_gepland_op_bestel_kwaliteit.sql), [scripts/test-release-cross-kwaliteit.sql](scripts/test-release-cross-kwaliteit.sql).

### 2026-04-24 — Fix: `snijplanning_tekort_analyse()` synchroon met edge (Map1 + placeholders)
- **Wat:** Migratie [134_tekort_analyse_map1_en_placeholders.sql](supabase/migrations/134_tekort_analyse_map1_en_placeholders.sql) herschrijft `snijplanning_tekort_analyse()` zodat hij (1) primair de fijnmazige Map1 (`kwaliteit_kleur_uitwisselbaar` view) raadpleegt en pas op `kwaliteiten.collectie_id` terugvalt als Map1 leeg is — identiek aan `auto-plan-groep` edge function, en (2) placeholder-rollen (`lengte_cm = 0 OR breedte_cm = 0`) uitsluit uit zowel de telling als de `max_lange/max_korte`-bepaling.
- **Waarom:** De UI-diagnose verschilde van de realiteit die de edge ziet. Voorbeelden uit productie: `VELV 15` toonde collectie-codes `CAST,CISC,SPRI,VELV` terwijl Map1 ook `SOPI/SOPV` bevat; `OASI 51` zei "geen collectie" terwijl Map1 `WOTO 51` als partner heeft. Placeholders (0×0 stub-rollen voor inkoop-signalering uit migratie 112) leidden tot de misleidende melding `Rol te klein max 0×0 cm` i.p.v. "geen bruikbare voorraad".
- **Impact:** Return-signatuur ongewijzigd — `groep-accordion.tsx` en `snijplanning.ts`-query blijven werken zonder frontend-wijziging. `heeft_collectie` is nu TRUE zodra Map1 óf collectie uitwissel-opties biedt (kolomnaam is legacy; semantiek = "heeft uitwissel-partners").
- **Files:** [supabase/migrations/134_tekort_analyse_map1_en_placeholders.sql](supabase/migrations/134_tekort_analyse_map1_en_placeholders.sql).

## 2026-04-24 — Inkoopmodule V1: leveranciers + inkooporders + ontvangst-flow

### 2026-04-24 — Team snijtafel uitgesloten + eenheid (m/stuks) per regel
- **Wat:** Inkooporder_regels krijgt kolom `eenheid` CHECK `('m','stuks')` — afgeleid uit `producten.product_type` (`rol` → `m`, anders → `stuks`). Import-script filtert leverancier_nr 20010 (Team snijtafel = interne orders) uit, en bepaalt eenheid per regel. Migratie 127 is nu **robuust tegen bestaande stub-tabellen** via `ALTER TABLE ADD COLUMN IF NOT EXISTS` per kolom (fix voor "column leverancier_nr does not exist" bij hergebruik). Nieuwe RPC `boek_voorraad_ontvangst(regel_id, aantal, medewerker)` voor vaste producten (hoogt `producten.voorraad` op i.p.v. rollen aan te maken). `boek_ontvangst` valideert nu dat regel eenheid=`m` heeft. `sync_besteld_inkoop` rekent alleen voor rol-producten om naar m², anders direct in stuks.
- **Waarom:** Karpi signaleerde dat Team snijtafel interne orders zijn (geen externe inkoop) en dat de Excel ook vaste-afmeting-orders bevat (stuks, geen meters). Eén kolom met ambigue betekenis (meters XOR stuks) vraagt om een eenheid-markering.
- **Cijfers na filter:** 21 leveranciers, 235 orders, 1.088 regels (235 rol-regels / 853 vast-regels), ~98.219 openstaand (m + st.).
- **Files:** [supabase/migrations/127_inkooporders_leveranciers.sql](supabase/migrations/127_inkooporders_leveranciers.sql), [import/import_inkoopoverzicht.py](import/import_inkoopoverzicht.py), [frontend/src/lib/supabase/queries/inkooporders.ts](frontend/src/lib/supabase/queries/inkooporders.ts), [frontend/src/hooks/use-inkooporders.ts](frontend/src/hooks/use-inkooporders.ts), [frontend/src/components/inkooporders/voorraad-ontvangst-dialog.tsx](frontend/src/components/inkooporders/voorraad-ontvangst-dialog.tsx), [frontend/src/pages/inkooporders/inkooporder-detail.tsx](frontend/src/pages/inkooporders/inkooporder-detail.tsx).

### 2026-04-24 — Leveranciers, inkooporders en inkooporder_regels
- **Wat:** Migratie [127_inkooporders_leveranciers.sql](supabase/migrations/127_inkooporders_leveranciers.sql) maakt de tabellen `leveranciers`, `inkooporders` en `inkooporder_regels` + enum `inkooporder_status` + kolom `rollen.inkooporder_regel_id`. Views `leveranciers_overzicht` en `inkooporders_overzicht` aggregeren openstaande orders/meters per leverancier en per order. Trigger `trg_sync_besteld_inkoop` houdt `producten.besteld_inkoop` automatisch synchroon met de som van openstaande inkooporder-regels (omgerekend naar m² via `kwaliteiten.standaard_breedte_cm`). RPC `boek_ontvangst(regel_id, rollen[], medewerker)` maakt fysieke rollen aan, logt een `voorraad_mutaties`-entry van type `ontvangst` en zet de order-status op `Deels ontvangen`/`Ontvangen`.
- **Waarom:** Inkoopproces was alleen in docs gedefinieerd — geen tabellen, geen UI. Deze migratie brengt de documentatie en de werkelijkheid weer gelijk + voegt de ontvangst-flow toe.
- **Files:** [supabase/migrations/127_inkooporders_leveranciers.sql](supabase/migrations/127_inkooporders_leveranciers.sql).

### 2026-04-24 — Eenmalige import uit Inkoopoverzicht.xlsx
- **Wat:** Nieuw script [import/import_inkoopoverzicht.py](import/import_inkoopoverzicht.py) dat de openstaande regels (Status ∈ {0, 1} én Te leveren > 0) uit `Inkoopoverzicht.xlsx` (83.301 rijen totaal) laadt: 22 leveranciers, 535 orders, 4.273 regels, ~107.191 m nog te leveren. Order-nr via `bouw_inkooporder_nr(oud_nr)` (formaat `INK-YYYY-NNNN`). Leverweek `'01/2049` en `'50/2017` worden gefilterd (alleen weken tussen 2024 en 2030 krijgen `verwacht_datum`). Draait dry-run standaard; `--apply` schrijft daadwerkelijk.
- **Waarom:** Karpi wil de openstaande inkooporders ook voor historische orders kunnen afvinken bij levering — die moeten eerst in de DB zitten. Afgeronde orders (Te leveren = 0) worden niet geïmporteerd (scope-keuze).
- **Files:** [import/import_inkoopoverzicht.py](import/import_inkoopoverzicht.py).

### 2026-04-24 — Frontend: leveranciers-tab + inkooporders-tab + ontvangst-modal + nieuwe-bestelling-form
- **Wat:** Nieuwe pagina's [leveranciers-overview.tsx](frontend/src/pages/leveranciers/leveranciers-overview.tsx) (lijst met openstaande orders/m² + actief-filter), [leverancier-detail.tsx](frontend/src/pages/leveranciers/leverancier-detail.tsx) (gegevens + openstaande orders), [inkooporders-overview.tsx](frontend/src/pages/inkooporders/inkooporders-overview.tsx) (filters op status, leverancier en alleen-open + stat-cards openstaand/deze-week/achterstallig), [inkooporder-detail.tsx](frontend/src/pages/inkooporders/inkooporder-detail.tsx) (regels met `Ontvangst`-knop per regel). Componenten [ontvangst-boeken-dialog.tsx](frontend/src/components/inkooporders/ontvangst-boeken-dialog.tsx) (N rollen per ontvangst met rolnummer/lengte/breedte) en [inkooporder-form-dialog.tsx](frontend/src/components/inkooporders/inkooporder-form-dialog.tsx) (nieuwe bestelling met regels-editor, genereert `INK-YYYY-NNNN` via `volgend_nummer('INK')`). Queries [leveranciers.ts](frontend/src/lib/supabase/queries/leveranciers.ts) + [inkooporders.ts](frontend/src/lib/supabase/queries/inkooporders.ts) en hooks [use-leveranciers.ts](frontend/src/hooks/use-leveranciers.ts) + [use-inkooporders.ts](frontend/src/hooks/use-inkooporders.ts). Placeholders in [router.tsx](frontend/src/router.tsx) vervangen door echte pagina's.
- **Waarom:** Karpi wil openstaande orders zien met verwachte leverdatum, kunnen afvinken bij binnenkomst (rollen komen dan automatisch in voorraad), en vanuit hier nieuwe bestellingen kunnen inboeken — zodat bij levering alleen nog afgevinkt hoeft te worden.
- **Files:** [frontend/src/pages/leveranciers/*](frontend/src/pages/leveranciers), [frontend/src/pages/inkooporders/*](frontend/src/pages/inkooporders), [frontend/src/components/inkooporders/*](frontend/src/components/inkooporders), [frontend/src/components/leveranciers/*](frontend/src/components/leveranciers), [frontend/src/hooks/use-leveranciers.ts](frontend/src/hooks/use-leveranciers.ts), [frontend/src/hooks/use-inkooporders.ts](frontend/src/hooks/use-inkooporders.ts), [frontend/src/lib/supabase/queries/leveranciers.ts](frontend/src/lib/supabase/queries/leveranciers.ts), [frontend/src/lib/supabase/queries/inkooporders.ts](frontend/src/lib/supabase/queries/inkooporders.ts), [frontend/src/router.tsx](frontend/src/router.tsx).

## 2026-04-22 — Snijplanning: operator-snijinstructies + snij-marges

### 2026-04-22 — Rol-uitvoer-modal: operator-terminologie + mes-nummering
- **Wat:** Shelf-header in [rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx) spreekt nu operator-taal: `Lengte-mes op Y cm` (afsnijden dwars over de rol) + `Breedte-mes 1/2/3 op X cm` (interne strip-verdelers), met maximaal 3 breedte-messen want dat is het machine-maximum. Een stuk dat groter geplaatst is dan besteld krijgt onder de maat een expliciete amber-regel `→ bijsnijden met hand naar X × Y cm` i.p.v. de voorheen grijze `(besteld …)`-hint.
- **Waarom:** De snijder aan de machine moet direct kunnen aflezen welke mes-standen hij moet instellen, in de terminologie die hij kent. Oude UI noemde de Y-afsnijding "breedtesnit" en de X-messen "mes-stand" — dat is exact omgekeerd van hoe de machine de messen benoemt.
- **Files:** [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx).

### 2026-04-22 — Snij-marges: ZO +6 cm, rond/ovaal +5 cm
- **Wat:** Nieuwe SQL-functie `stuk_snij_marge_cm(afwerking, vorm)` in [migratie 126](supabase/migrations/126_snij_marges_zo_rond.sql) + TS-helper [snij-marges.ts](supabase/functions/_shared/snij-marges.ts). `snijplanning_tekort_analyse()` past de marge nu toe op de per-stuk rol-past-check (patched versie van migratie 117). `fetchStukken()` in de edge function past dezelfde marge toe zodat de packer met de fysieke snij-maat rekent, niet met de nominale. Bij combi ZO + rond wint de grootste marge (niet cumulatief).
- **Waarom:** Operator snijdt ZO-afwerking 6 cm groter (126×126 voor een 120×120 klant-stuk → rondom 6 cm voor de afwerking) en ronde stukken met 5 cm speling (voor handmatig uitzagen). Tekort-analyse en packer rekenden voorheen met de nominale maat → silent misplacement risk bij krappe rollen. Na deze change is een 320×230 ronde pas "passend" als de rol ≥ 325×235 is.
- **Impact:** Tekort-analyse kan voor sommige groepen nu een stuk als `grootste_onpassend` markeren dat voorheen "paste". Dat is correct gedrag, was eerder een hidden bug.
- **Files:** [supabase/migrations/126_snij_marges_zo_rond.sql](supabase/migrations/126_snij_marges_zo_rond.sql), [supabase/functions/_shared/snij-marges.ts](supabase/functions/_shared/snij-marges.ts) (+ test), [supabase/functions/_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts).

### 2026-04-22 — Shelf-mes-validator (zachte planner-check)
- **Wat:** Nieuwe pure TS-module [shelf-mes-validator.ts](supabase/functions/_shared/shelf-mes-validator.ts) die per rol controleert hoeveel interne breedte-mes-posities een shelf vereist. Als > 3 (machine-maximum) → entry in `samenvatting.shelf_waarschuwingen` op de edge-function-response + `console.warn`. De `optimaliseer-snijplan` en `auto-plan-groep` edge functions roepen de validator na packing aan.
- **Waarom:** De UI toont max 3 breedte-messen, maar het packing-algoritme heeft die constraint niet. Zonder validator zou een theoretisch 5-strip-shelf silent een onuitvoerbaar plan opleveren. Zachte check — plaatsingen worden niet afgewezen, omdat een hardere constraint het scoring-pad raakt en een apart traject verdient.
- **Files:** [supabase/functions/_shared/shelf-mes-validator.ts](supabase/functions/_shared/shelf-mes-validator.ts) (+ test), [supabase/functions/optimaliseer-snijplan/index.ts](supabase/functions/optimaliseer-snijplan/index.ts), [supabase/functions/auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts).

## 2026-04-22 — Facturatie-module V1

Facturen worden automatisch gegenereerd + gemaild bij order-status 'Verzonden'
(klanten met `factuurvoorkeur='per_zending'`) of via wekelijkse cron (maandag 05:00 UTC,
voor klanten met `factuurvoorkeur='wekelijks'`). PDF volgens Karpi-layout, algemene
voorwaarden als tweede bijlage.

- Migraties 117–122: enums + tabellen facturen/factuur_regels, factuur_queue + trigger,
  RPC genereer_factuur, seed Karpi BV bedrijfsgegevens, queue-recovery, pg_cron
  (drain 1min + recovery 5min + wekelijks maandag 05:00 UTC).
- Kolommen `debiteuren.factuurvoorkeur` + `debiteuren.btw_percentage` toegevoegd
  (BTW per klant: 21% NL default, 0% voor EU-intracom/export).
- Edge function `factuur-verzenden` drainst queue: RPC → PDF (pdf-lib) → storage upload
  → Resend email met algemene voorwaarden als 2e bijlage.
- Pure helpers in `_shared/`: `factuur-bedrag.ts`, `factuur-pdf.ts`, `resend-client.ts`
  met Deno tests.
- Frontend: `/facturatie` lijst + detail, klant-detail tab "Facturering",
  `/instellingen/bedrijfsgegevens`, nieuwe sidebar-items.
- Secrets nodig: `RESEND_API_KEY`, `FACTUUR_FROM_EMAIL`, `FACTUUR_REPLY_TO`,
  `ALGEMENE_VOORWAARDEN_PATH`. Storage buckets: `facturen` (privé), `documenten` (public).
- Out of scope V1: herinneringen, aanmaningen, credit-nota's, partiële facturatie,
  herversturen-knop, automatische BTW-afleiding uit land.
- Plan: `docs/superpowers/plans/2026-04-22-facturatie-module.md`.

### 2026-04-22 — Levertijd-check: geen datums in het verleden meer
- **Wat:** Twee fixes in [check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts) + [levertijd-match.ts](supabase/functions/_shared/levertijd-match.ts).
  1. **Primair** — `fetchWerkagendaInput` filtert nu `.in('status', PLANNING_STATUS_IN_PIPELINE)` (`'Gepland'` + `'Snijden'`) i.p.v. alleen `'Snijden'`, consistent met `fetchBestaandePlaatsingen`. Gepland-rollen krijgen daardoor een realistisch sequentieel werkagenda-slot (start ≥ vandaag) en de match-tak hoeft niet meer door te vallen naar de ongeflourde fallback.
  2. **Defense-in-depth** — `snijDatumVoorRol` floort uitkomst aan `volgendeWerkdag(vandaag)`: afleverdatum-pad én planning_week-pad retourneren nooit meer een datum in het verleden, ook niet wanneer de werkagenda om een of andere reden geen slot heeft.
- **Waarom:** Miguel meldde "Past op bestaande rol — leverdatum 06-04-2026" terwijl vandaag 22-04 is. Oorzaak: rol CISC11 3 stond op `Gepland` met een bestaande order die al overtijd was (afleverdatum 6-4). Werkagenda negeerde `'Gepland'` → match-tak viel terug op `snijDatumVoorRol(afleverdatum − buffer)` = 4-4-2026. Leverdatum = 6-4. Drie weken in het verleden.
- **Files:** [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts), [supabase/functions/_shared/levertijd-match.ts](supabase/functions/_shared/levertijd-match.ts), [supabase/functions/_shared/levertijd-match.test.ts](supabase/functions/_shared/levertijd-match.test.ts) (+ 2 regressie-tests voor backlog scenarios), [docs/architectuur.md](docs/architectuur.md).

### 2026-04-22 — Facturatie Task 8: PDF-generator met Karpi-layout (pdf-lib)
- **Wat:** `supabase/functions/_shared/factuur-pdf.ts` — server-side PDF-generatie voor Karpi BV facturen via `pdf-lib@1.17.1` (esm.sh). A4 portrait, Courier-font, volledige Karpi-layout: bedrijfs-header, klant-adresblok, info-blok, tabel-header, gegroepeerde orderregels per order_nr, TRANSPORTEREN/TRANSPORT BLAD bij paginering, BTW-blok, betalingscondities, gecentreerde footer (kvk/btw/bank/IBAN). Automatische pagina-ombreuk wanneer de cursor <40mm boven onderkant uitkomt. `supabase/functions/_shared/factuur-pdf.test.ts` — drie Deno-tests: magic-bytes (PDF-signature), 50-regeltest (paginering), 0%-BTW-test (intracom/export).
- **Waarom:** Task 8 van het facturatie-module plan. PDF wordt server-side gegenereerd (Deno Edge Function) zodat wekelijkse verzamelfacturen zonder actieve browser werken en als bijlage aan de Resend-mail gehangen kunnen worden.
- **Files:** [supabase/functions/_shared/factuur-pdf.ts](supabase/functions/_shared/factuur-pdf.ts), [supabase/functions/_shared/factuur-pdf.test.ts](supabase/functions/_shared/factuur-pdf.test.ts).

### 2026-04-22 — Edge Functions: verify_jwt=false voor publishable-key compat
- **Wat:** `supabase/config.toml` aangemaakt met `verify_jwt = false` voor `check-levertijd`, `auto-plan-groep` en `optimaliseer-snijplan` — de drie functies die vanuit de frontend via `supabase.functions.invoke()` worden aangeroepen.
- **Waarom:** De `sb_publishable_...` API-keyvorm (in `frontend/.env` als `VITE_SUPABASE_ANON_KEY`) is geen JWT. De Edge-gateway wijst het met `verify_jwt=true` af als `UNAUTHORIZED_INVALID_JWT_FORMAT` (HTTP 401). Resultaat: de real-time levertijd-check liet alleen de fallback-melding "Real-time levertijd-check niet beschikbaar" zien. De functies gebruiken intern `SUPABASE_SERVICE_ROLE_KEY` voor DB-toegang en lezen geen user-JWT — gateway-check was dus overbodig én blokkerend.
- **Handmatige actie:** Config.toml pakt alleen bij CLI-deploy. Directe fix via Supabase Dashboard → Edge Functions → [naam] → "Enforce JWT Verification" UIT voor elk van de drie functies.

### 2026-04-22 — Snijplanning: snij-volgorde gegroepeerd per shelf (fysieke guillotine-workflow)
- **Wat:** [rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx) groepeert de snij-volgorde nu in **shelves** (rijen langs de rol-lengte) met per rij een oranje header die de fysieke snij-instructie toont: "Rij N · breedtesnit op {yEnd} cm · lengtesnitten op {x1, x2, …} cm". Events binnen de shelf sorteren op X-positie (links→rechts lengtesnit-volgorde). Banding-tolerantie 5 cm voor afrondingen.
- **Waarom:** Miguel meldde dat het algoritme correct plant maar de UI de fysieke snij-workflow niet weerspiegelt. Op de Karpi snijtafel wordt een rol eerst één keer over de breedte gesneden (Y-as, "breedtesnit"), dan in de lengte (X-as, "lengtesnitten"). Mesinstelling voor de lengtesnit is de tijdrovende stap — twee stukken met dezelfde Y-positie willen opeenvolgend gesneden worden zodat de snijder het mes maar één keer hoeft in te stellen. Shelf-header maakt expliciet bij welke cumulatieve Y de breedtesnit moet vallen en welke X-grenzen daarna als lengtesnit gelden. Geen algoritmische verandering — dit is alleen presentatie, maar kritisch voor bruikbaarheid in de werkplaats.
- **Files:** [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx).

### 2026-04-22 — Snijplanning: dead-zone awareness + free-rect-based reststukken
- **Wat (algoritme):** `findBestPlacement` in [_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts) gebruikt nu **dead-zone lexicografische scoring**: als de rol-rest na placement onder `AANGEBROKEN_MIN_LENGTE` (100 cm) zou zakken — en dus niet meer aanbreekbaar is — schakelt het criterium van "yEnd ↓" naar "reststuk-m² ↑". Safe-zone placements (die de rol aanbreekbaar houden) winnen altijd van dead-zone, en binnen elke zone gelden de eigen tiebreakers. `packRollGuillotine` krijgt `rolLengte` als expliciet argument om de dead-zone grens te bepalen.
- **Wat (reststuk-detectie):** Shelf-based `computeReststukken` vervangen door **free-rect subtraction + greedy disjoint cover** in beide locaties: [supabase/functions/_shared/compute-reststukken.ts](supabase/functions/_shared/compute-reststukken.ts) en [frontend/src/lib/utils/compute-reststukken.ts](frontend/src/lib/utils/compute-reststukken.ts). De oude shelf-reconstructie miste interne gaps (bv. combinatie rechter-strip + sliver onder korter stuk + end-strip werd in 3 afzonderlijke kleine rechthoeken gesplitst terwijl er één grote samenhangende rechthoek was). De nieuwe disjoint-cover claimt greedy de grootste kwalificerende rechthoek en subtraheerd die vóór de volgende iteratie — geen overlappende reststukken, maximaal bruikbare restwaarde.
- **Wat (UI-classificatie):** In `computeReststukkenAngebrokenAfval` worden full-width end-strips nu alleen als "aangebrokenEnd" geclassificeerd wanneer `lengte_cm ≥ AANGEBROKEN_MIN_LENGTE` (100 cm). Kortere full-width strips gaan door als normaal reststuk (met eigen rolnummer en sticker) zolang ze kwalificeren (≥ 50×100). Voorheen kwamen die strips in een "dode zone": niet aanbreekbaar (< 100 cm) én niet zichtbaar als reststuk → verloren bij `voltooi_snijplan_rol`.
- **Waarom:** Screenshot-scenario op rol IC2901TA13B (TAMA 13, 400×250 cm, 3 stukken 243×200 + 45×170 + 80×163) toonde "0 reststukken · 4 afval" terwijl er feitelijk een 400×50 end-strip (2 m² bruikbaar bij 50×100 drempel) én een interne 112×87 gap (0,97 m²) als reststuk hadden moeten verschijnen. Drie oorzaken: (1) UI verwijderde de 50-cm end-strip als onbruikbare aangebroken-rol terwijl die wél als reststuk kwalificeert, (2) shelf-based reststuk-detectie zag de 112×87 gap helemaal niet, (3) algoritme koos niet-dead-zone-aware tussen placement-opties. User's prioriteiten-hiërarchie: (1) reststukken gebruiken als bron → (2) max stukken per rol → (3) rol-lengte zuinig → (4) reststuk maximaliseren. In dead-zone valt prio 3 weg (rol gaat toch op), zodat prio 4 promoveert. Benchmark: 0 regressies over 10 scenarios, +2 reststukken op IC2901TA13B, alle eerdere winsten (391 cm) behouden.
- **Files:** [supabase/functions/_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts), [supabase/functions/_shared/compute-reststukken.ts](supabase/functions/_shared/compute-reststukken.ts), [frontend/src/lib/utils/compute-reststukken.ts](frontend/src/lib/utils/compute-reststukken.ts), [supabase/functions/_shared/guillotine-packing.test.ts](supabase/functions/_shared/guillotine-packing.test.ts), [supabase/functions/_shared/compute-reststukken.test.ts](supabase/functions/_shared/compute-reststukken.test.ts), [scripts/vergelijk-snijalgoritmes.mjs](scripts/vergelijk-snijalgoritmes.mjs).

### 2026-04-22 — Rollen-overzicht: placeholder-rollen voor ontbrekende maatwerk-paren

- **Wat:** "Rollen & Reststukken" toont nu álle maatwerk (kwaliteit, kleur) paren uit `maatwerk_m2_prijzen`, ook als er geen eigen voorraad is (bv. CISC 15). Lege groepen krijgen een "Leverbaar via [KWAL kleur] — N rollen, M m²"-badge wanneer `kwaliteit_kleur_uitwisselgroepen` een alternatief met voorraad aanwijst.
- **Waarom:** import van rollenvoorraad sloeg kwaliteiten zonder eigen voorraad over, waardoor leverbare maatwerk-varianten onzichtbaar waren.
- **Hoe:** migratie `112_rollen_placeholder_maatwerk.sql` — (a) idempotente INSERT van placeholder-rollen (`rolnummer = 'PH-{KWAL}-{KLEUR}'`, `oppervlak_m2 = 0`, `status = 'beschikbaar'`), (b) RPC `rollen_uitwissel_voorraad()` voor equiv-info. Frontend `fetchRollenGegroepeerd` mergt equiv op lege groepen; `RollenGroepRow` toont dim-state + badge.
- **Impact:** `leeg_op` stat-card stijgt met het aantal ingevoegde placeholders. Overige cijfers ongewijzigd. Geen snijplanning-impact (oppervlak=0 is onbruikbaar maar geldig).

### 2026-04-22 — Reststuk-drempel verlaagd naar 50×100 cm
- **Wat:** `RESTSTUK_MIN_SHORT` 70 → **50** en `RESTSTUK_MIN_LONG` 140 → **100** in alle 4 locaties: [supabase/functions/_shared/compute-reststukken.ts](supabase/functions/_shared/compute-reststukken.ts), [supabase/functions/_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts), [frontend/src/lib/utils/compute-reststukken.ts](frontend/src/lib/utils/compute-reststukken.ts), [scripts/vergelijk-snijalgoritmes.mjs](scripts/vergelijk-snijalgoritmes.mjs). Test-assertions + doc-references bijgewerkt.
- **Waarom:** Praktijkobservatie van Miguel op rol VERR130: een strook van 180×60 cm werd als afval geclassificeerd terwijl die in de werkplaats nog prima verkoopbaar is. Hogere drempel 70×140 was te strict voor Karpi's workflow — resulteerde in reststukken die fysiek naar de afvalbak gingen. Nieuwe drempel 50×100 sluit aan bij wat in praktijk nog herbruikbaar is voor kleine maatwerk-orders. Benchmark blijft 0 regressies, 391 cm rol-lengte bespaard; aantal gekwalificeerde reststukken stijgt (stress-test: +4 kwalificerende stukken t.o.v. oude drempel).
- **Files:** [compute-reststukken.ts × 2 + guillotine-packing.ts + vergelijk-snijalgoritmes.mjs + compute-reststukken.test.ts + snij-visualisatie.tsx + architectuur.md].

### 2026-04-22 — Snijplanning: reststuk-aware placement-scoring
- **Wat:** `findBestPlacement` in [_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts) gebruikt nu lexicografische scoring: (1) Y-eindpositie minimaal, (2) reststuk-m² maximaal, (3) kleinste vrije rechthoek eerst, (4) compactste leftover. Per kandidaat-placement wordt de volledige nieuwe free-rect-set gesimuleerd en het kwalificerende reststuk-oppervlak (≥70×140) meegerekend. De per-rol score tussen Guillotine- en FFDH-resultaat in `scorePacking` heeft nu ook een reststuk-m² term.
- **Waarom:** Op rol K1756006D (FIRE 20, 400×325) met stukken 310×220 + 40×80 werd het 40×80 stuk niet-geroteerd geplaatst — resultaat: 50×220 + 40×140 afval (1,66 m² verloren). Door stuk 2 geroteerd (80×40) te plaatsen ontstaat 10×40 afval + **90×180 reststuk** (1,62 m² bruikbaar). Zonder reststuk-term in de score miste het algoritme deze rotatie omdat beide varianten gelijk scoren op rol-lengte en afval-percentage. Benchmark ([scripts/vergelijk-snijalgoritmes.mjs](scripts/vergelijk-snijalgoritmes.mjs)) blijft 0 regressies, 3 winsten op rol-lengte (+391 cm totaal) én nu 1 extra reststuk-winst op K1756006D. Zonder Y-eind als primair criterium zou voorbeeld 2 regressie krijgen (560 → 660 cm): rol-lengte moet domineren over reststuk-theorie, anders rekt het algoritme de rol op om reststuk-waarde te forceren.
- **Files:** [supabase/functions/_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts), [supabase/functions/_shared/guillotine-packing.test.ts](supabase/functions/_shared/guillotine-packing.test.ts), [scripts/vergelijk-snijalgoritmes.mjs](scripts/vergelijk-snijalgoritmes.mjs).

### 2026-04-22 — Snijplanning: best-of-both packing (Guillotine + FFDH per rol)
- **Wat:** `packAcrossRolls` uit [_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts) vervangt de FFDH-only implementatie in beide edge functions ([auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts), [optimaliseer-snijplan/index.ts](supabase/functions/optimaliseer-snijplan/index.ts)). Per rol worden nu zowel een Guillotine-cut layout (Best Area Fit + Short Axis Split, met vrije rechthoeken als first-class state) als de klassieke FFDH shelf-layout berekend; het resultaat met meeste geplaatste stukken / kleinste rol-lengte / laagste afval wint. Reststuk-bescherming (`maxReststukVerspillingPct` uit `app_config.productie_planning`) en rol-sortering (reststukken vóór volle rollen) blijven ongewijzigd. [_shared/ffdh-packing.ts](supabase/functions/_shared/ffdh-packing.ts) blijft als fundament bestaan.
- **Waarom:** FFDH scoorde per stuk op *gap-usefulness* i.p.v. totale rol-consumptie, wat zichtbaar werd op rol IC2900VE16A (LAMI 16): een 80×320 stuk landde op een nieuwe shelf onder een 240×340 terwijl het prima in de 160×340 vrije ruimte ernaast had gepast. Benchmark over 8 scenarios ([scripts/vergelijk-snijalgoritmes.mjs](scripts/vergelijk-snijalgoritmes.mjs)): 3 scenarios winst (voorbeeld 2: −100 cm = 4 m², klein-in-reststuk: −20 cm, 20 random stukken stress-test: −271 cm = 10,8 m²), 0 regressies, 5 gelijk. Totaal −391 cm rol-lengte over de testset. Reden voor de best-of-both wrapper i.p.v. pure Guillotine: een edge-case (smalle rol + strip-achtige stukken) waarin FFDH's rotatie-lookahead strikt wint — door beide te draaien nemen we dat gratis mee.
- **Files:** [supabase/functions/_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts), [supabase/functions/_shared/guillotine-packing.test.ts](supabase/functions/_shared/guillotine-packing.test.ts), [supabase/functions/auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts), [supabase/functions/optimaliseer-snijplan/index.ts](supabase/functions/optimaliseer-snijplan/index.ts), [scripts/vergelijk-snijalgoritmes.mjs](scripts/vergelijk-snijalgoritmes.mjs), [docs/architectuur.md](docs/architectuur.md).

### 2026-04-22 — Snijplan-maten sync + auto-plan triggers uitgebreid
- **Migratie [110_snijplan_maten_sync.sql](supabase/migrations/110_snijplan_maten_sync.sql):** `auto_maak_snijplan()` gebruikte `COALESCE(NEW.maatwerk_lengte_cm, 100)` als default → snijplan werd 100×100 aangemaakt voor webshop-regels waar `parseMaatwerkDims()` niets uit de producttitel kon halen. Later werd de order_regel handmatig bijgewerkt met echte maten, maar het snijplan bleef 100×100 (geen UPDATE-trigger). Rol-toewijzingen op basis van 100×100 gaven verkeerde planning. Fix: hardcoded default weg (geen snijplan als maten NULL), plus nieuwe `auto_sync_snijplan_maten()` AFTER UPDATE-trigger op `order_regels` die `lengte_cm/breedte_cm` synchroon houdt. Maakt ook alsnog een snijplan als het bij INSERT was overgeslagen. Slaat update over als rol al toegewezen (RAISE WARNING) — handmatig releasen nodig.
- **Migratie [111_auto_plan_triggers_uitbreiden.sql](supabase/migrations/111_auto_plan_triggers_uitbreiden.sql):** migratie 100 dekte alleen INSERT op `rollen`. Nu twee extra statement-level triggers: (1) `snijplannen_auto_plan_na_insert` start auto-plan-groep wanneer een snijplan wordt aangemaakt (webshop-import, handmatig) via de gekoppelde order_regel's kwaliteit/kleur; (2) `rollen_auto_plan_na_status_update` vuurt wanneer een rol transiteert naar `beschikbaar`/`reststuk` (voorraad komt terug). Beide non-blocking via pg_net, zelfde advisory-lock patroon als migratie 100. Let op: PG staat geen kolomlijst (`OF status`) toe samen met transition tables → trigger vuurt op elke UPDATE en filtert zelf op status-transitie.
- **Backfill:** [scripts/backfill-snijplan-maten-sync.sql](scripts/backfill-snijplan-maten-sync.sql) corrigeerde 18 desync snijplannen (1 zonder rol, 17 met rol) en maakte 70 ontbrekende snijplannen aan voor order_regels waar is_maatwerk pas later op true gezet was. Voor 3 snijplannen met `rollen.snijden_gestart_op IS NOT NULL` zijn alleen de maten gecorrigeerd (rol behouden) omdat de rollen fysiek in productie waren; later alsnog gereset + herplanned omdat de posities op basis van 100×100 niet klopten.
- **Waarom:** snijplanning toonde systematisch 100×100 voor orders die via Lightspeed-import binnenkwamen en later handmatig van afmetingen werden voorzien. "Zou plannbaar moeten zijn — draai auto-plan opnieuw"-banners (de sky-blauwe `voldoende`-reden) waren het zichtbare symptoom van zowel de desync als de ontbrekende auto-plan-triggers bij nieuwe snijplannen en vrijkomende rollen.
- **Files:** [supabase/migrations/110_snijplan_maten_sync.sql](supabase/migrations/110_snijplan_maten_sync.sql), [supabase/migrations/111_auto_plan_triggers_uitbreiden.sql](supabase/migrations/111_auto_plan_triggers_uitbreiden.sql), [scripts/backfill-snijplan-maten-sync.sql](scripts/backfill-snijplan-maten-sync.sql).

### 2026-04-22 — Snijplanning: snij-volgorde toont consistent breedte × lengte
- **Wat:** In [rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx) toonde de snij-rij `breedte_cm × lengte_cm` van het `SnijStuk`. Dat is in optimizer-conventie Y × X (langs × over de rol) — precies de inverse van de header (`rolBreedte × rolLengte (breedte × lengte)`) en van de reststuk-/aangebroken-rijen (die `ReststukRect` met `breedte_cm = X` gebruiken). Gefixt door lokaal naar UI-conventie (over × langs) te vertalen via `placedBreedte = snijStuk.lengte_cm`, `placedLengte = snijStuk.breedte_cm`. De `(besteld …)`-vergelijking is meegeswapt zodat hij alleen verschijnt als de geplaatste oriëntatie afwijkt van de klant-bestelde richting.
- **Waarom:** Klacht "bij Start snijden staat nog steeds niet alles structureel breedte × lengte". `SnijStuk` (uit [snijplan-mapping.ts:62](frontend/src/lib/utils/snijplan-mapping.ts#L62)) en `ReststukRect` (uit [compute-reststukken.ts:67](frontend/src/lib/utils/compute-reststukken.ts#L67)) gebruiken tegengestelde naamgeving; in de view-laag samenbrengen voorkomt het slepen aan twee parallelle producent-types.
- **Files:** [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx).

### 2026-04-20 — Op-maat: verkoopprijs_m2 fallback naar MAATWERK-artikelprijs
- **Migratie [107_kleuren_voor_kwaliteit_fallback_verkoopprijs.sql](supabase/migrations/107_kleuren_voor_kwaliteit_fallback_verkoopprijs.sql):** eerste poging — `verkoopprijs_m2` via COALESCE (eerst `maatwerk_m2_prijzen`, anders `producten.verkoopprijs` van het MAATWERK-artikel). Idem voor `equiv_m2_prijs`.
- **Migratie [108_kleuren_voor_kwaliteit_fallback_replace.sql](supabase/migrations/108_kleuren_voor_kwaliteit_fallback_replace.sql):** zelfde logica als 107 maar via `CREATE OR REPLACE` (geen DROP) voor veilige hercompilatie zonder view-dependencies te breken.
- **Migratie [109_kleuren_voor_kwaliteit_fallback_prioriteit.sql](supabase/migrations/109_kleuren_voor_kwaliteit_fallback_prioriteit.sql):** **fix**. De `eigen_maatwerk_artikel` CTE in 107/108 sorteerde op `(product_type='overig'?0:1), artikelnr` — bij VELV 16 won daardoor `771160017` (VELVET TOUCH Contour, `product_type='overig'`, verkoopprijs=NULL) van `771169998` (VELV16MAATWERK, €24,26). Gevolg: NULL in COALESCE en UI viel nog steeds terug op `equiv_m2_prijs` (€19,86). 109 prioriteert nu: (1) 'MAATWERK' in omschrijving/karpi_code, (2) verkoopprijs NOT NULL, (3) product_type='overig'. Zelfde fix ook toegepast op `uit_maatwerk_artikel` en `uit_m2_prijs` CTE's voor consistentie.
- **Waarom:** VELV 16 had geen `maatwerk_m2_prijzen`-rij → `verkoopprijs_m2` was NULL → UI toonde €19,86 (CISC-equivalent) terwijl VELV16MAATWERK zelf €24,26 heeft. Na 109 geeft `kleuren_voor_kwaliteit('VELV').verkoopprijs_m2` voor kleur 16 correct €24,26 terug.

### 2026-04-20 — Op-maat: uitwisselbare rol als alternatief bij 0 eigen voorraad
- **Wat:** Als een kwaliteit+kleur geen eigen rol heeft maar een uitwisselbare kwaliteit wél (via `kwaliteit_kleur_uitwisselgroepen`, zelfde `basis_code` + `variant_nr`), wordt dat nu automatisch voorgesteld in de Op-maat flow. Factuur houdt de bestelde kwaliteit (omstickeer-model); snijplan/voorraad landt op de uitwisselbare rol via `fysiek_artikelnr` + `omstickeren=true`. Voorbeeld: VELV 16 (geen rol) → CISC 16 (3 rol/138 m²), klant ziet VELV 16 op factuur.
- **Migratie [105_kleuren_voor_kwaliteit_uitwisselbaar.sql](supabase/migrations/105_kleuren_voor_kwaliteit_uitwisselbaar.sql):** RPC `kleuren_voor_kwaliteit(p_kwaliteit)` herschreven. Retourneert nu ook kleuren die alleen via uitwisselgroep bereikbaar zijn, vult `equiv_rollen`/`equiv_m2` echt (was altijd 0) en drie nieuwe velden: `equiv_kwaliteit_code`, `equiv_artikelnr`, `equiv_m2_prijs`. Signatuurwijziging → DROP + CREATE.
- **Migratie [106_maatwerk_artikel_kwaliteit_kleur_backfill.sql](supabase/migrations/106_maatwerk_artikel_kwaliteit_kleur_backfill.sql):** backfill van 377 MAATWERK-artikelen (patroon `{KWAL}{KLEUR}MAATWERK`) die `kwaliteit_code=NULL, kleur_code=NULL` hadden. Zonder dit vond `fetchMaatwerkArtikelNr` het bestelde VELV16MAATWERK niet (kwaliteit-filter faalde) en viel onterecht door naar het CISC-alternatief. Alleen backfill als afgeleide code bestaat in `kwaliteiten` (respecteert FK).
- **Frontend:**
  - [op-maat.ts](frontend/src/lib/supabase/queries/op-maat.ts): `KleurOptie` uitgebreid met `equiv_kwaliteit_code` / `equiv_artikelnr` / `equiv_m2_prijs`.
  - [kwaliteit-first-selector.tsx](frontend/src/components/orders/kwaliteit-first-selector.tsx): afleiding `gebruiktUitwisselbaar` (0 eigen + uitwisselbaar beschikbaar); banner toont bron-kwaliteit; `handleAdd` zet `fysiek_artikelnr` + `omstickeren=true`; kleur-dropdown toont "+X m² via CISC"; `fetchKlantPrijs` heeft nieuwe fallback naar `producten.verkoopprijs` van het gevonden maatwerk-artikel (fijnmaziger dan generieke `maatwerk_m2_prijzen`-kwaliteitsrij).
- **Waarom:** de infrastructuur (`SubstitutionPicker`, `omstickeren`, uitwisselgroepen-tabel) bestond al, maar `kleuren_voor_kwaliteit` vulde `equiv_*` nooit in en MAATWERK-artikelen waren niet koppelbaar aan kwaliteit+kleur — de Op-maat flow kon dus niet signaleren dat een uitwisselbare rol als alternatief diende. Resultaat: bij VELV 16 zag men "0 m² totaal" en kon er geen orderregel gemaakt worden hoewel er 138 m² CISC 16 op rol stond.
- **Files:** [supabase/migrations/105_kleuren_voor_kwaliteit_uitwisselbaar.sql](supabase/migrations/105_kleuren_voor_kwaliteit_uitwisselbaar.sql), [supabase/migrations/106_maatwerk_artikel_kwaliteit_kleur_backfill.sql](supabase/migrations/106_maatwerk_artikel_kwaliteit_kleur_backfill.sql), [frontend/src/lib/supabase/queries/op-maat.ts](frontend/src/lib/supabase/queries/op-maat.ts), [frontend/src/components/orders/kwaliteit-first-selector.tsx](frontend/src/components/orders/kwaliteit-first-selector.tsx).

### 2026-04-20 — snijplanning_tekort_analyse RPC hersteld (collecties-only)
- **Wat:** Migratie [102_snijplanning_tekort_analyse_restore.sql](supabase/migrations/102_snijplanning_tekort_analyse_restore.sql) zet de RPC `snijplanning_tekort_analyse()` terug die samen met migraties 078/079 uit de repo was verdwenen. Uitwisselbaarheid wordt nu puur via `kwaliteiten.collectie_id` bepaald (de fallback-pad uit de oude versie); de Map1-infrastructuur (`kwaliteit_kleur_uitwisselgroepen`-tabel + view `kwaliteit_kleur_uitwisselbaar`) komt niet terug. Kleur-match houdt de `.0`-suffix-normalisatie (zoeksleutel "13" ↔ "13.0"). Output-contract matcht de bestaande `TekortAnalyseRow`-interface in [snijplanning.ts](frontend/src/lib/supabase/queries/snijplanning.ts) — geen frontend-wijziging nodig.
- **Waarom:** Zonder de RPC retourneerde `supabase.rpc('snijplanning_tekort_analyse')` een permanente error en bleven de "Tekort"-accordions in de snijplanning-UI op "Analyse wordt geladen…" staan. Fijnmazige Map1-uitwisselbaarheid wordt bewust niet heringevoerd (eerder besloten per TAM→TAMA harmonisatie dat één kwaliteit-code per voorraadgroep voldoende is).
- **Files:** [supabase/migrations/102_snijplanning_tekort_analyse_restore.sql](supabase/migrations/102_snijplanning_tekort_analyse_restore.sql).

## 2026-04-20 — Confectie vooruitkijkende planning
- `afwerking_types.type_bewerking` kolom + FK naar `confectie_werktijden` (migratie 096)
- `confectie_werktijden.parallelle_werkplekken` kolom (migratie 097)
- Nieuwe view `confectie_planning_forward` met alle open maatwerk-stukken, backward-compat aliassen (migratie 098)
- Defensieve `ALTER TABLE snijplannen` voor `confectie_afgerond_op`, `ingepakt_op`, `locatie` (migratie 098)
- RPC's `start_confectie`, `voltooi_confectie` voor status-transities (migratie 101)
- Frontend: week-horizon selector (1/2/4/8 wk), capaciteitsbalken per lane, filter klaar-vs-alles op Lijst-tab
- `afrondConfectie()` nu via `voltooi_confectie` RPC
- Vitest + React Testing Library setup toegevoegd aan frontend
- **Waarom:** confectie kon alleen "al gesneden" werk zien — nu zijn overbelaste weken vooraf zichtbaar.

### 2026-04-20 — Auto-snijplanning triggert nu ook bij nieuwe rollen (niet alleen bij orders)
- **Wat:** Migratie [100_auto_plan_op_rol_insert.sql](supabase/migrations/100_auto_plan_op_rol_insert.sql) voegt een AFTER INSERT STATEMENT-level trigger op `rollen` toe die per unieke (kwaliteit_code, kleur_code)-combinatie een `pg_net.http_post` naar de [auto-plan-groep](supabase/functions/auto-plan-groep/index.ts) edge function afvuurt. Respecteert `app_config.snijplanning.auto_planning.enabled`; leest endpoint + auth-header uit dezelfde config-rij (velden `edge_url` / `auth_header`) zodat er geen secrets in de repo staan. Non-blocking via `EXCEPTION WHEN OTHERS`, edge function heeft eigen advisory lock. Eenmalige handmatige trigger uitgevoerd voor achterstallige groepen TAMA 13 (1 stuk) en TAMA 21 (4 stukken op 2 rollen).
- **Waarom:** Voorheen werd auto-planning alleen getriggerd bij order-aanmaak (zie [order-form.tsx:286-306](frontend/src/components/orders/order-form.tsx#L286-L306)). Wanneer maatwerk-orders als "tekort" geregistreerd stonden en er daarna nieuwe rollen binnenkwamen, bleef de tekort-analyse de orders als onplanbaar tonen — zelfs als de nieuwe voorraad technisch voldoende was. Een trigger op `rollen`-INSERT pakt nu zowel handmatige opboeking als bulk-imports automatisch op, en door STATEMENT-level (i.p.v. ROW-level) krijgen bulk-imports één call per kwaliteit/kleur i.p.v. per rol.
- **Setup:** Nog één keer na de migratie runnen: `UPDATE app_config SET waarde = jsonb_set(jsonb_set(waarde, '{edge_url}', to_jsonb('https://<ref>.supabase.co/functions/v1/auto-plan-groep'::text)), '{auth_header}', to_jsonb('Bearer <publishable-key>'::text)) WHERE sleutel = 'snijplanning.auto_planning';`
- **Files:** [supabase/migrations/100_auto_plan_op_rol_insert.sql](supabase/migrations/100_auto_plan_op_rol_insert.sql).

### 2026-04-20 — Productomschrijvingen gesync'd met kleur_code (karpi_code leidend)
- **Wat:** Migratie [099_omschrijvingen_kleur_consistency.sql](supabase/migrations/099_omschrijvingen_kleur_consistency.sql) vervangt "KLEUR X" in de omschrijving door de werkelijke `kleur_code` uit de karpi_code voor 4 producten waar deze afweken: AMBE25XX160230 (24→25), RENA45XX080300 (46→45), BUXV49180VIL (209→49), DOTT26500PPS (126→26). Regex behoudt originele kapitalisatie ("Kleur"/"KLEUR") via capture-group.
- **Waarom:** Diagnose-query toonde 4 data-inconsistenties waar productnaam en karpi-afgeleide kleur_code elkaar tegenspraken. Beslissing: karpi_code is leidend (= de autoritaire bron voor kwaliteit/kleur/breedte); omschrijving is presentatie en wordt daaraan aangepast. Voorkomt dat klanten/medewerkers de omschrijving zien als "waar" terwijl de snijplanning/voorraad op kleur_code werkt.
- **Files:** [supabase/migrations/099_omschrijvingen_kleur_consistency.sql](supabase/migrations/099_omschrijvingen_kleur_consistency.sql).

### 2026-04-20 — HAR1 + WLP1/WLP4 kleur_code-bug gerepareerd
- **Wat:** Migratie [098_har1_wlp_kleur_code_fix.sql](supabase/migrations/098_har1_wlp_kleur_code_fix.sql) herstelt de "3 letters + cijfer"-prefix-kleur-bug voor HAR1-producten (HARMONY — kleur_db `16/19/19` → `65/95/99`) en WLP1/WLP4-producten (WOOLPLUSH — kleur_db `11/41` → beide `18`). Alleen `kleur_code` + `zoeksleutel` worden bijgewerkt; `kwaliteit_code` (HAR / WLP) blijft gelijk — geen leverancier-switch zoals bij TAM→TAMA. Rollen worden gedenormaliseerd gesynchroniseerd. Pre/post-`NOTICE` telt afwijkingen tussen naam en kleur_code; post-telling moet 0 zijn.
- **Waarom:** Dezelfde bug als in migratie 096: de legacy-afleiding "eerste 2 cijfers uit karpi_code" pakt de prefix-cijfers mee zodra de prefix zelf een cijfer bevat. Zonder fix bleven deze rollen onzichtbaar voor zoeksleutel-gebaseerde voorraad-matching in de snijplanning. WLP1/WLP4 smelten hierdoor samen onder `zoeksleutel=WLP_18` (bewust, confirmed per user) — als ze later écht gesplitst moeten kan dat in een vervolgmigratie met aparte kwaliteiten.
- **Files:** [supabase/migrations/098_har1_wlp_kleur_code_fix.sql](supabase/migrations/098_har1_wlp_kleur_code_fix.sql).

### 2026-04-20 — Webshop: klantprijs uit prijslijst i.p.v. consumentprijs uit Lightspeed
- **Wat:** Nieuwe helper [supabase/functions/_shared/klant-prijs.ts](supabase/functions/_shared/klant-prijs.ts) haalt de debiteur-specifieke prijs op uit `prijslijst_regels` via `debiteuren.prijslijst_nr`. Voor maatwerk = m²-prijs × oppervlak (l×b/10000); voor standaard artikel = prijs per stuk. Fallback: `producten.verkoopprijs`; anders NULL (geen consumentprijs overschrijven). Beide edge functions ([sync-webshop-order](supabase/functions/sync-webshop-order/index.ts), [import-lightspeed-orders](supabase/functions/import-lightspeed-orders/index.ts)) gebruiken deze helper i.p.v. `row.priceIncl`. Backfill-script [scripts/backfill-floorpassion-klantprijs.mjs](scripts/backfill-floorpassion-klantprijs.mjs) corrigeerde 73 bestaande regels over Floorpassion-orders.
- **Waarom:** Floorpassion plaatst de order bij Karpi — de prijzen die Lightspeed meestuurt zijn consumentenprijzen van de webshop. Karpi factureert aan Floorpassion tegen de afgesproken prijslijst-tarieven (bv. LAGO19MAATWERK = €19,04/m² op prijslijst 0145). Voorbeeld ORD-2026-1683 regel 1: Lightspeed leverde €375 (consument); herberekend naar 270×140 × €19,04/m² = €71,97 (Karpi→Floorpassion).
- **Files:** [supabase/functions/_shared/klant-prijs.ts](supabase/functions/_shared/klant-prijs.ts), [supabase/functions/sync-webshop-order/index.ts](supabase/functions/sync-webshop-order/index.ts), [supabase/functions/import-lightspeed-orders/index.ts](supabase/functions/import-lightspeed-orders/index.ts), [scripts/backfill-floorpassion-klantprijs.mjs](scripts/backfill-floorpassion-klantprijs.mjs).

### 2026-04-20 — Webshop: "Op maat"-orders altijd als maatwerk + `customFields: false`-guard
- **Wat:** Productmatcher in [supabase/functions/_shared/product-matcher.ts](supabase/functions/_shared/product-matcher.ts) herkent "Op maat" / "Wunschgröße" / "Durchmesser" nu vroeg in het alias-pad en retourneert direct `is_maatwerk=true` — óók als de afmeting tijdelijk ontbreekt. Geen fallback meer naar "eerste hit op kwaliteit+kleur" bij expliciet maatwerk, want die matchte willekeurig op een standaard artikel (bijv. GLAM-19 080×150) waardoor de order-UI "Op maat" toonde zonder afmeting. Kwaliteit-disambiguïteit via `articleCode`: "LAGO19MAATWERK" levert nu LAGO-19 i.p.v. willekeurig GLAM (eerste alias-hit). [lightspeed-client.ts](supabase/functions/_shared/lightspeed-client.ts) + scripts gebruiken `Array.isArray(customFields)`-guard want Lightspeed retourneert soms `customFields: false` (PHP-style) i.p.v. `null`/`[]` — die falsy waarde crashte `for (const f of false)`. Backfill-script [scripts/rematch-floorpassion-orders.mjs](scripts/rematch-floorpassion-orders.mjs) uitgebreid: selecteert nu óók regels met `is_maatwerk=false` waarvan `omschrijving_2` "Op maat"/"Wunschgr*"/"Durchmesser" bevat, zodat bestaande foutief-gematchte regels worden gecorrigeerd.
- **Waarom:** ORD-2026-1683 (Ross 19 — Op maat) toonde geen afmeting in de order-UI. Root cause: de deployed matcher kreeg geen customFields binnen (of crashte op `customFields: false`), waardoor sizeRaw leeg bleef en de "geen maat → eerste hit op kwaliteit+kleur"-fallback LAGO-19 → GLAM-19 080×150 koos. Fix voorkomt dat scenario doorverbinding: expliciet maatwerk mag nooit naar een standaard artikel gematcht worden. Dry-run backfill corrigeert 41 regels over 38 orders.
- **Files:** [supabase/functions/_shared/product-matcher.ts](supabase/functions/_shared/product-matcher.ts), [supabase/functions/_shared/lightspeed-client.ts](supabase/functions/_shared/lightspeed-client.ts), [scripts/rematch-floorpassion-orders.mjs](scripts/rematch-floorpassion-orders.mjs), [scripts/backfill-maatwerk-afmeting.mjs](scripts/backfill-maatwerk-afmeting.mjs).

### 2026-04-20 — TAM-kwaliteit geharmoniseerd naar TAMA (vervanger failliete leverancier)
- **Wat:** Migratie [096_tama_kwaliteit_harmoniseren.sql](supabase/migrations/096_tama_kwaliteit_harmoniseren.sql) repareert TAM1-producten op twee fronten: (1) `kwaliteit_code` 'TAM' → 'TAMA', (2) `kleur_code` herberekend op positie 5-6 van `karpi_code` (niet de eerste 2 cijfers — prefix 'TAM1' bevat zelf al een cijfer, waardoor de standaard-afleiding "11/12" pakte i.p.v. de werkelijke "13/21/23"). `zoeksleutel` mee-herberekend; bijbehorende rollen gedenormaliseerd meegeüpdatet. Pre/post-`RAISE NOTICE` met teltelling; fail-fast als kwaliteit 'TAMA' niet bestaat.
- **Waarom:** De oorspronkelijke BALTA-leverancier voor TAMAR is failliet; een vervanger levert functioneel dezelfde rollen onder prefix 'TAM1'. Zonder harmonisatie zag de snijplanning-tekort-analyse voor TAMA "geen voorraad" terwijl de TAM1-rollen fysiek in het magazijn liggen. Voorkeur voor samenvoegen in één kwaliteit-code boven het herinvoeren van de `kwaliteit_kleur_uitwisselgroepen` / Map1.xlsx-infrastructuur uit verwijderde migraties 078/079 — simpeler en genoeg voor deze casus.
- **Files:** [supabase/migrations/096_tama_kwaliteit_harmoniseren.sql](supabase/migrations/096_tama_kwaliteit_harmoniseren.sql).

### 2026-04-19 — Webshop-integratie live: webhooks + unmatched-vlag + slimmere matcher
- **Wat:** Lightspeed webhooks `orders/paid` zijn geregistreerd voor NL (id 4740622) + DE (id 4740623) — richten naar de live edge function `sync-webshop-order`. Productie-debiteur is **260000 "FLOORPASSION"** (bestaande rij; synthetische 99001 uit migratie 091 blijft ongebruikt). Migratie [094_orders_heeft_unmatched_regels.sql](supabase/migrations/094_orders_heeft_unmatched_regels.sql) voegt `orders.heeft_unmatched_regels BOOLEAN` toe + trigger op `order_regels` die de vlag automatisch onderhoudt bij inserts/updates/deletes. Backfill heeft 63 bestaande orders correct gevlagd. Edge function idempotency-check nu vóór Lightspeed-fetch verplaatst — dubbele webhooks hitten geen rate-limit meer. Matcher slim uitgebreid: herkent `VERZEND` (verzendkosten-regels), `[STAAL]` (Gratis Muster), `[MAATWERK]` (Wunschgröße / Op maat / Volgens tekening), `[MAATWERK-ROND]` (Durchmesser/rond), plus `parsed_karpi` via `kwaliteit+kleur+maat` parsing uit productTitle+variantTitle. Scripts [sync-webshop-orders.mjs](scripts/sync-webshop-orders.mjs) (polling, WATCH-mode) en [rematch-unmatched-webshop-regels.mjs](scripts/rematch-unmatched-webshop-regels.mjs) (backfill bestaande regels met nieuwe matcher). Na backfill: 91% van regels auto-gematched, resterende netjes gecategoriseerd via prefixen.
- **Waarom:** Piet/Hein moet dit weekend live testbestellingen kunnen plaatsen en ze direct in RugFlow zien verschijnen — webhook-registratie maakt dat real-time. De unmatched-vlag laat de orderlijst in één oogopslag zien welke orders review nodig hebben (anti-slip onderleggers, reinigingskits, custom sizes) zonder elke regel te openen. Prefix-matching (`[STAAL]` / `[MAATWERK]`) geeft de reviewer meteen context: "Gratis Muster" wil je anders behandelen dan "Wunschgröße 130x190 cm". De idempotency-volgorde-fix is belangrijk omdat Lightspeed aggressief retryt (tot 10×) — elke retry zou anders opnieuw de Lightspeed REST API aanspreken.
- **Files:** [supabase/migrations/094_orders_heeft_unmatched_regels.sql](supabase/migrations/094_orders_heeft_unmatched_regels.sql), [supabase/functions/sync-webshop-order/index.ts](supabase/functions/sync-webshop-order/index.ts), [supabase/functions/_shared/product-matcher.ts](supabase/functions/_shared/product-matcher.ts), [scripts/sync-webshop-orders.mjs](scripts/sync-webshop-orders.mjs), [scripts/rematch-unmatched-webshop-regels.mjs](scripts/rematch-unmatched-webshop-regels.mjs), [docs/data-woordenboek.md](docs/data-woordenboek.md), [docs/database-schema.md](docs/database-schema.md), [docs/architectuur.md](docs/architectuur.md).

### 2026-04-17 — Lightspeed eCom webshop-integratie (fase 1: orders)
- **Wat:** Webhook-gebaseerde koppeling met Floorpassion NL + DE Lightspeed eCom shops. Migratie [091_floorpassion_verzameldebiteur.sql](supabase/migrations/091_floorpassion_verzameldebiteur.sql) zet verzameldebiteur 99001 = FLOORPASSION WEBSHOP. Migratie [092_orders_bron_tracking.sql](supabase/migrations/092_orders_bron_tracking.sql) voegt `bron_systeem` / `bron_shop` / `bron_order_id` toe aan orders met partial unique index (idempotentie) + nieuwe RPC `create_webshop_order`. Nieuwe edge function [sync-webshop-order](supabase/functions/sync-webshop-order/index.ts) ontvangt `orders/paid` webhooks, verifieert MD5-signature (shop-specifiek secret), fetcht de volledige order via Lightspeed REST API en maakt een order aan. Shared helpers: [lightspeed-client.ts](supabase/functions/_shared/lightspeed-client.ts), [lightspeed-verify.ts](supabase/functions/_shared/lightspeed-verify.ts) (+ tests), [product-matcher.ts](supabase/functions/_shared/product-matcher.ts). Scripts: [register-lightspeed-webhooks.mjs](scripts/register-lightspeed-webhooks.mjs) (idempotent, registreert `orders/paid` per shop), [test-lightspeed-sync-local.mjs](scripts/test-lightspeed-sync-local.mjs) (smoke-test met fake webhook + geldige signature). Credentials in `supabase/functions/.env` (gitignored).
- **Waarom:** Karpi wil één backoffice voor alle orderstromen (B2B + webshop). Particuliere kopers krijgen geen eigen debiteur-rij; hun naam/adres landt als leveradres-snapshot op de order (consistent met bestaande orders-architectuur). Alleen `orders/paid` luisteren voorkomt dat onbetaalde winkelmandjes in productie komen. Unmatched producten blokkeren de order niet — regel wordt aangemaakt met `[UNMATCHED]` prefix en NULL `artikelnr` voor handmatige review. Partial unique index op (bron_systeem, bron_order_id) maakt Lightspeed-retries idempotent.
- **Files:** [supabase/migrations/091_floorpassion_verzameldebiteur.sql](supabase/migrations/091_floorpassion_verzameldebiteur.sql), [supabase/migrations/092_orders_bron_tracking.sql](supabase/migrations/092_orders_bron_tracking.sql), [supabase/functions/sync-webshop-order/index.ts](supabase/functions/sync-webshop-order/index.ts), [supabase/functions/_shared/lightspeed-client.ts](supabase/functions/_shared/lightspeed-client.ts), [supabase/functions/_shared/lightspeed-verify.ts](supabase/functions/_shared/lightspeed-verify.ts), [supabase/functions/_shared/lightspeed-verify.test.ts](supabase/functions/_shared/lightspeed-verify.test.ts), [supabase/functions/_shared/product-matcher.ts](supabase/functions/_shared/product-matcher.ts), [supabase/functions/.env.example](supabase/functions/.env.example), [scripts/register-lightspeed-webhooks.mjs](scripts/register-lightspeed-webhooks.mjs), [scripts/test-lightspeed-sync-local.mjs](scripts/test-lightspeed-sync-local.mjs), [docs/superpowers/plans/2026-04-17-lightspeed-webshop-orders.md](docs/superpowers/plans/2026-04-17-lightspeed-webshop-orders.md).

### 2026-04-17 — End-of-roll full-width = aangebroken rol, niet reststuk
- **Wat:** Migratie [090_voltooi_snijplan_rol_aangebroken.sql](supabase/migrations/090_voltooi_snijplan_rol_aangebroken.sql) voegt optionele param `p_aangebroken_lengte` toe aan `voltooi_snijplan_rol`. Als gezet (≥100 cm): originele rol behoudt rolnummer, lengte wordt verkort, status blijft `beschikbaar`, `rol_type` wordt via trigger op `aangebroken` gezet, voorraadmutatie `type='aangebroken'` wordt gelogd. Grondstofkosten-toerekening (088) trekt `aangebroken_m²` af van `afval_m²` zodat gesneden stukken niet de hele overgebleven lengte betalen. Frontend: nieuwe helper [computeReststukkenAngebrokenAfval](frontend/src/lib/utils/compute-reststukken.ts) splitst end-of-roll strip met volle breedte af als aparte `aangebrokenEnd` wanneer rol_type in ('volle_rol','aangebroken'); bij reststuk-rollen valt hij terug op oud reststuk-gedrag. [RolUitvoerModal](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx) toont de regel met blauwe "Aangebroken" badge + tekst "behoud rol {rolnummer} (volle breedte)"; bij afsluiten wordt `aangebrokenLengte` doorgegeven aan `voltooi_snijplan_rol`.
- **Waarom:** Vervolg op 086/087. Bij OASI 11 (320 × 4620) werd na het snijden van 2 kleine stukken een full-width strip van 320 × 4110 als nieuwe reststuk-rol "OASI 11-R3" aangemaakt. Fysiek is dat gewoon de originele rol met een verkorte lengte. Met de aangebroken-flow blijft het rolnummer behouden, de oorsprong-keten klopt, en het voorraadoverzicht toont niet nodeloos versnipperde reststuk-rollen.
- **Files:** [supabase/migrations/090_voltooi_snijplan_rol_aangebroken.sql](supabase/migrations/090_voltooi_snijplan_rol_aangebroken.sql), [frontend/src/lib/utils/compute-reststukken.ts](frontend/src/lib/utils/compute-reststukken.ts), [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx), [frontend/src/lib/supabase/queries/snijvoorstel.ts](frontend/src/lib/supabase/queries/snijvoorstel.ts), [frontend/src/hooks/use-snijplanning.ts](frontend/src/hooks/use-snijplanning.ts).

### 2026-04-17 — Snijplan-status gesplitst in 'Gepland' + 'Snijden' (lock-semantiek hersteld)
- **Wat:** Migratie [089_snijplan_status_gepland_vs_snijden.sql](supabase/migrations/089_snijplan_status_gepland_vs_snijden.sql) zet de status `'Gepland'` weer naast `'Snijden'`. `'Gepland'` = stuk toegewezen aan rol, cutlist aanpasbaar (`rollen.snijden_gestart_op IS NULL`). `'Snijden'` = rol fysiek onder het mes, bevroren. Trigger uit migratie 070 geïnverteerd: `'Wacht' → 'Gepland'`. Backfill: bestaande Snijden-stukken op rollen met `snijden_gestart_op IS NULL` → Gepland. RPC's aangepast: `keur_snijvoorstel_goed` zet op Gepland, `start_snijden_rol` promoot alle Gepland-stukken op die rol naar Snijden + timestamp, nieuwe `pauzeer_snijden_rol` unlockt (weigert als al Gesneden-stukken), `release_gepland_stukken` filtert direct op Gepland. Edge functions: [auto-plan-groep](supabase/functions/auto-plan-groep/index.ts) `statuses: ['Gepland', 'Wacht']`, [fetchBezettePlaatsingen](supabase/functions/_shared/db-helpers.ts) haalt Gepland-stukken, [check-levertijd](supabase/functions/check-levertijd/index.ts) `PLANNING_STATUS_IN_PIPELINE = ['Gepland', 'Snijden']`. Frontend: [SnijplanStatus type](frontend/src/lib/types/productie.ts) + [SNIJPLAN_STATUS_COLORS](frontend/src/lib/utils/constants.ts) uitgebreid met Gepland; alle status-filters accepteren beide. Pauzeer-knop in [rol-uitvoer-modal](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx) roept nu `pauzeer_snijden_rol` aan (was no-op).
- **Waarom:** Migraties 069/070 harmoniseerden Gepland+Snijden naar Snijden, waardoor het verschil tussen "gepland maar aanpasbaar" en "fysiek onder het mes" verloren ging. Gevolg: auto-plan kon geen stukken toevoegen aan al-geplande-maar-niet-gestarte rollen (gap-filling mislukte), overzicht toonde elk gepland stuk als 'Snijden' (verwarrend), en er was geen structurele pauzeer-actie. Concreet scenario: 100×100 FLOORPASSION belandde op een aparte rol terwijl OASI 11 nog een shelf-gap had. Met de splitsing blijft gap-filling werken tot iemand daadwerkelijk op "Start snijden" drukt, en "Pauzeer" geeft een rol weer vrij voor herplanning.
- **Files:** [supabase/migrations/089_snijplan_status_gepland_vs_snijden.sql](supabase/migrations/089_snijplan_status_gepland_vs_snijden.sql), [supabase/functions/_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts), [supabase/functions/auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts), [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts), [frontend/src/lib/types/productie.ts](frontend/src/lib/types/productie.ts), [frontend/src/lib/utils/constants.ts](frontend/src/lib/utils/constants.ts), [frontend/src/lib/utils/snijplan-mapping.ts](frontend/src/lib/utils/snijplan-mapping.ts), [frontend/src/lib/supabase/queries/snijplanning.ts](frontend/src/lib/supabase/queries/snijplanning.ts), [frontend/src/lib/supabase/queries/snijvoorstel.ts](frontend/src/lib/supabase/queries/snijvoorstel.ts), [frontend/src/lib/supabase/queries/snijplanning-mutations.ts](frontend/src/lib/supabase/queries/snijplanning-mutations.ts), [frontend/src/hooks/use-snijplanning.ts](frontend/src/hooks/use-snijplanning.ts), [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx), [frontend/src/components/snijplanning/groep-accordion.tsx](frontend/src/components/snijplanning/groep-accordion.tsx), [frontend/src/pages/snijplanning/productie-groep.tsx](frontend/src/pages/snijplanning/productie-groep.tsx), [frontend/src/pages/snijplanning/productie-rol.tsx](frontend/src/pages/snijplanning/productie-rol.tsx).

### 2026-04-17 — Grondstofkosten per snijplan bij rol-afsluiting
- **Wat:** Migratie [088_grondstofkosten_per_snijplan.sql](supabase/migrations/088_grondstofkosten_per_snijplan.sql) voegt drie kolommen toe aan `snijplannen`: `grondstofkosten` (€), `grondstofkosten_m2` (m² incl. afval-aandeel) en `inkoopprijs_m2` (snapshot bronrol). `voltooi_snijplan_rol` herschreven zodat bij elke rol-afsluiting het afval proportioneel over de zojuist gesneden stukken wordt verdeeld (`afval_m² = bronrol_m² − gesneden_m² − reststuk_m²`) en de kosten per snijplan worden ingevuld. Nieuwe reststuk-rollen krijgen nu óók `waarde` (oppervlak × bronrol-prijs-per-m²). Smoke-test in [scripts/test-grondstofkosten-rpc.sql](scripts/test-grondstofkosten-rpc.sql) met fixture 320×1000 cm rol, 3 stukken + 1 reststuk-rechthoek.
- **Waarom:** Nodig voor exacte winstmarge-berekening per orderregel. Weggegooid materiaal (bv. 50×270 cm naast een 270×270 rond) drukt op de stukken die nú worden gesneden, niet op toekomstige stukken uit reststukken. Reststukken gaan met correcte voorraadwaarde terug naar de voorraad — daarmee telt hun waarde mee in `dashboard_stats.voorraadwaarde_inkoop`. UI-koppeling (order-margin, rapportages) volgt in een vervolgplan.
- **Files:** [supabase/migrations/088_grondstofkosten_per_snijplan.sql](supabase/migrations/088_grondstofkosten_per_snijplan.sql), [scripts/test-grondstofkosten-rpc.sql](scripts/test-grondstofkosten-rpc.sql), [docs/database-schema.md](docs/database-schema.md).

### 2026-04-17 — Standaard rolbreedte per kwaliteit (bron van waarheid voor rol_type)
- **Wat:** Nieuwe kolom `kwaliteiten.standaard_breedte_cm` + seed voor 77 kwaliteiten o.b.v. modus-analyse over bestaande `volle_rol`-rollen ([086_kwaliteit_standaard_breedte.sql](supabase/migrations/086_kwaliteit_standaard_breedte.sql)). `bereken_rol_type()` herschreven naar STABLE met DB-lookup op `producten → kwaliteiten.standaard_breedte_cm`; fallback op oude artikelnr-heuristiek (laatste 3 cijfers), daarna 400 cm ([087_bereken_rol_type_gebruikt_kwaliteit_standaard.sql](supabase/migrations/087_bereken_rol_type_gebruikt_kwaliteit_standaard.sql)). Alle bestaande rollen opnieuw geclassificeerd.
- **Waarom:** Kwaliteiten als OASI/NOMA/RUBI/CAVA hebben artikelnummers zonder 3-cijferige breedte-suffix en rollen van 320 cm i.p.v. 400 cm. De oude heuristiek viel terug op 400 cm, waardoor 320 cm-rollen onterecht als `reststuk` werden geclassificeerd. Zichtbaar in het snij-modal van OASI 11 (320 × 4620) waar R3 (320 × 4110) als reststuk werd getoond terwijl het een aangebroken rol is. Met expliciete bron per kwaliteit is het onderscheid correct en kan de frontend-reststukken-logica (volgende stap) volle-breedte end-of-roll als aangebroken rol behandelen.
- **Files:** [supabase/migrations/086_kwaliteit_standaard_breedte.sql](supabase/migrations/086_kwaliteit_standaard_breedte.sql), [supabase/migrations/087_bereken_rol_type_gebruikt_kwaliteit_standaard.sql](supabase/migrations/087_bereken_rol_type_gebruikt_kwaliteit_standaard.sql), [docs/database-schema.md](docs/database-schema.md), [docs/data-woordenboek.md](docs/data-woordenboek.md).

### 2026-04-17 — Auto-plan: shelf-gap-filling op deels-geplande rollen + max-reststuk-verspilling als filter
- **Wat:** Auto-plan-groep kan nu nieuwe stukken plaatsen in de shelf-gaps van rollen die al gedeeltelijk gepland zijn (status `in_snijplan`, productie nog niet gestart). Nieuwe helpers [reconstructShelves](supabase/functions/_shared/ffdh-packing.ts) en [fetchBezettePlaatsingen](supabase/functions/_shared/db-helpers.ts) + `packAcrossRolls({bezetteMap, maxReststukVerspillingPct})`. Sort-tier in [sortRolls](supabase/functions/_shared/ffdh-packing.ts) geeft rollen met bestaande plaatsingen voorrang boven verse rollen (gap-filling first). `app_config.productie_planning.max_reststuk_verspilling_pct` wordt nu ook door auto-plan gelezen: reststukken worden overgeslagen als hun afval na packing boven de drempel uitkomt. Migratie [085_keur_snijvoorstel_in_snijplan.sql](supabase/migrations/085_keur_snijvoorstel_in_snijplan.sql) update `keur_snijvoorstel_goed` zodat die `in_snijplan`-rollen accepteert (mits `snijden_gestart_op IS NULL`). Tests in [ffdh-packing.test.ts](supabase/functions/_shared/ffdh-packing.test.ts).
- **Waarom:** In het praktijkvoorbeeld kreeg de 100×100 (FLOORPASSION, ORD-2026-0015) een eigen rol 1101 (320×1500) toegewezen, terwijl rol OASI 11 (320×4620) nog een shelf-gap van 150×170 had naast de reeds geplande 170×170 VAN DAM. Oorzaak: rollen met status `in_snijplan` werden uitgesloten van `fetchBeschikbareRollen`, dus latere auto-plan-rondes zagen de bestaande gaps niet. Gevolg: onnodig materiaalgebruik (hele rol aansnijden voor één klein stuk). De `max_reststuk_verspilling_pct` beschermt kleine voorraad-reststukken tegen overmatige verspilling.
- **Files:** [supabase/functions/_shared/ffdh-packing.ts](supabase/functions/_shared/ffdh-packing.ts), [supabase/functions/_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts), [supabase/functions/auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts), [supabase/migrations/085_keur_snijvoorstel_in_snijplan.sql](supabase/migrations/085_keur_snijvoorstel_in_snijplan.sql), [supabase/functions/_shared/ffdh-packing.test.ts](supabase/functions/_shared/ffdh-packing.test.ts).

### 2026-04-17 — Dashboard KPI's omgehangen naar Goldratt TOC-framing (Inventory + Open verkooporders)
- **Wat:** Migratie [084_dashboard_stats_goldratt_toc.sql](supabase/migrations/084_dashboard_stats_goldratt_toc.sql) herformuleert twee KPI's volgens Theory of Constraints: `voorraadwaarde_inkoop` = **Inventory (I)** = `SUM(rollen.waarde)` excl. `status='verkocht'` (kapitaal vastgebonden aan inkoopprijs); `voorraadwaarde_verkoop` = **open verkooporders** = `SUM(totaal_bedrag) − SUM(VERZEND)` over orders met `status NOT IN ('Verzonden','Geannuleerd')` (pipeline die nog throughput gaat worden). Dashboard-kaarten hernoemd naar "Vastliggend in voorraad" en "Openstaande verkooporders". JSDoc in [dashboard.ts](frontend/src/lib/supabase/queries/dashboard.ts) aangepast.
- **Waarom:** Miguel wil sturen via Goldratt's The Goal — zichtbaar hebben waar kapitaal vastzit (I) en welke order-commitments er nog open staan. De 083-definitie telde ook verkochte rollen en alle historische omzet, wat semantisch niet past bij TOC. Met de nieuwe definitie is I → T (Inventory wordt Throughput via openstaande orders) direct afleesbaar.
- **Files:** [supabase/migrations/084_dashboard_stats_goldratt_toc.sql](supabase/migrations/084_dashboard_stats_goldratt_toc.sql), [frontend/src/pages/dashboard.tsx](frontend/src/pages/dashboard.tsx), [frontend/src/lib/supabase/queries/dashboard.ts](frontend/src/lib/supabase/queries/dashboard.ts).

### 2026-04-17 — Dashboard KPI's: voorraadwaarde (inkoop) over alle rollen + verkoop = orderomzet excl. verzend
- **Wat:** Nieuwe migratie [083_dashboard_stats_nieuwe_voorraadwaarden.sql](supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql) herdefinieert twee kolommen in `dashboard_stats`: `voorraadwaarde_inkoop` sommeert nu `rollen.waarde` over **alle** rollen (ongeacht status), en `voorraadwaarde_verkoop` is `SUM(orders.totaal_bedrag) − SUM(order_regels.bedrag WHERE artikelnr='VERZEND')` over niet-geannuleerde orders. Frontend ongewijzigd; dezelfde kolomnamen, andere betekenis. JSDoc-comments in [dashboard.ts](frontend/src/lib/supabase/queries/dashboard.ts) documenteren de nieuwe semantiek.
- **Waarom:** De oorspronkelijke view rapporteerde alleen voorraadwaarden van rollen met `status='beschikbaar'` en gebruikte `oppervlak × vvp` als verkoopwaarde — beide geven een vertekend beeld. Miguel wil (a) inkoopwaarde van alle tapijten in de database zien en (b) de daadwerkelijke gerealiseerde orderomzet zonder verzendkosten.
- **Files:** [supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql](supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql), [docs/database-schema.md](docs/database-schema.md), [frontend/src/lib/supabase/queries/dashboard.ts](frontend/src/lib/supabase/queries/dashboard.ts).

### 2026-04-17 — Backlog-drempel blokkeert levertijd niet meer (ASAP-by-default)
- **Wat:** [levertijd-resolver.ts](supabase/functions/_shared/levertijd-resolver.ts) `resolveScenario` valt niet meer terug op `wacht_op_orders` wanneer `backlog.voldoende = false`. Bij een geldige match-cycle zonder bestaande rol-plek én voldoende voorraadmateriaal kiest de resolver direct `nieuwe_rol_gepland` met de eerstvolgende vrije snijweek. `wacht_op_orders` blijft uitsluitend bestaan voor `geen_rol_passend` (geen voorraadrol breed/lang genoeg → inkoop nodig). Test in [levertijd-resolver.test.ts](supabase/functions/_shared/levertijd-resolver.test.ts) bijgewerkt; backlog-info blijft zichtbaar in `details.backlog`.
- **Waarom:** Doelstelling is altijd "zo snel mogelijk leveren mits andere orders niet gehinderd worden". De backlog-drempel (12 m²) zorgde voor onnodig wachten ("vroegst 4 weken") terwijl er voorraadmateriaal beschikbaar was. Capaciteits-iteratie verschuift al naar volgende week als de huidige vol zit, dus order-hindering wordt nog steeds voorkomen. Praktijkvoorbeeld: ATELIER DIEUDONNEE order met 0 m² backlog kreeg 15-05-2026 ipv directe planning in eerstvolgende vrije week.
- **Files:** [supabase/functions/_shared/levertijd-resolver.ts](supabase/functions/_shared/levertijd-resolver.ts), [supabase/functions/_shared/levertijd-resolver.test.ts](supabase/functions/_shared/levertijd-resolver.test.ts).

### 2026-04-16 — Lever_datum altijd op werkdag (skip weekend)
- **Wat:** Nieuwe helpers in [levertijd-match.ts](supabase/functions/_shared/levertijd-match.ts): `naarWerkdag(iso)` schuift een datum vooruit naar de eerstvolgende ma-vr; `leverdatumVoorSnijDatum(snij, buffer)` combineert `+buffer kalenderdagen` met `naarWerkdag`. Toegepast op alle 4 lever_datum berekeningen (`kiesBesteMatch` in match, `nieuwe_rol_gepland` + `wacht_op_orders.vroegst_mogelijk` in resolver, `evalueerSpoed` in spoed-check). 5 nieuwe weekend-tests.
- **Waarom:** Bij snij-datum vrijdag + 2 dagen buffer landde de leverdatum op zondag — onmogelijk om te leveren. De UI toonde dat onterecht als geldige datum.
- **Files:** [supabase/functions/_shared/levertijd-match.ts](supabase/functions/_shared/levertijd-match.ts), [supabase/functions/_shared/levertijd-resolver.ts](supabase/functions/_shared/levertijd-resolver.ts), [supabase/functions/_shared/spoed-check.ts](supabase/functions/_shared/spoed-check.ts).

### 2026-04-16 — Spoed-rejectie bij te-late backlog + buffer-aware teLaat
- **Wat:** [werkagenda.ts](supabase/functions/_shared/werkagenda.ts) `RolAgendaSlot` heeft nieuw verplicht veld `teLaat`. `berekenSnijAgenda` accepteert `snijLeverBufferDagen`-arg (default 2) en markeert een rol als `teLaat=true` zodra `eind > leverdatum − buffer`. [spoed-check.ts](supabase/functions/_shared/spoed-check.ts) rejecteert spoed direct met scenario `spoed_geen_plek` zodra ANY slot in de backlog `teLaat=true` is. [bereken-agenda.ts](frontend/src/lib/utils/bereken-agenda.ts) (frontend agenda-tab) gebruikt dezelfde buffer-logica zodat de rode "te laat"-markering ook al rollen vangt waar geen 2-dagen-buffer voor logistiek is. UI-bericht in `<SpoedToggle>` legt verschil uit tussen "planner zit al achter" en "beide weken vol".
- **Waarom:** De spoed-check beloofde nog plek deze week terwijl de bestaande backlog al rollen bevatte die op de leverdatum zélf gesneden werden (0 dagen buffer voor afwerking + verzending). Een spoed-belofte daarbovenop zou die rollen alleen nóg verder achter duwen. De nieuwe rejectie zegt eerlijk "planner zit al in nood, geen spoed mogelijk" en de Agenda-tab markeert deze rollen visueel als rood met `AlertTriangle`.
- **Files:** [supabase/functions/_shared/werkagenda.ts](supabase/functions/_shared/werkagenda.ts), [supabase/functions/_shared/spoed-check.ts](supabase/functions/_shared/spoed-check.ts), [supabase/functions/_shared/spoed-check.test.ts](supabase/functions/_shared/spoed-check.test.ts), [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts), [frontend/src/lib/utils/bereken-agenda.ts](frontend/src/lib/utils/bereken-agenda.ts), [frontend/src/components/orders/levertijd-suggestie.tsx](frontend/src/components/orders/levertijd-suggestie.tsx).

### 2026-04-16 — Spoed-optie bij levertijd-check
- **Wat:** `check-levertijd` retourneert nu een `spoed`-tak met `(beschikbaar, scenario, snij_datum, lever_datum, week_restruimte_uren, toeslag_bedrag)` gebaseerd op werk-restruimte deze + volgende ISO-week minus 4u buffer. UI toont een toggle in [`<LevertijdSuggestie>`](frontend/src/components/orders/levertijd-suggestie.tsx); bij activeren wordt de leverdatum overschreven en automatisch een `SPOEDTOESLAG`-orderregel toegevoegd (€50 default uit `app_config.productie_planning.spoed_toeslag_bedrag`). Spoed krijgt voorrang in de planning — de belofte-datum is de laatste werkdag van de gekozen week. Nieuwe shared module [`_shared/spoed-check.ts`](supabase/functions/_shared/spoed-check.ts) met 9 Deno unit tests; `werkagenda.ts` uitgebreid met `werkminutenTussen` voor netto-werkminuten-berekening.
- **Waarom:** Sales kan klanten met urgente verzoeken bedienen mits er capaciteit is, met transparante prijs-impact en zonder de planner handmatig te benaderen. De 4u buffer voorkomt dat planners onder druk komen wanneer een week bijna vol zit.
- **Files:** [supabase/migrations/082_app_config_spoed_velden.sql](supabase/migrations/082_app_config_spoed_velden.sql), [supabase/functions/_shared/spoed-check.ts](supabase/functions/_shared/spoed-check.ts), [supabase/functions/_shared/spoed-check.test.ts](supabase/functions/_shared/spoed-check.test.ts), [supabase/functions/_shared/werkagenda.ts](supabase/functions/_shared/werkagenda.ts), [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts), [frontend/src/lib/constants/spoed.ts](frontend/src/lib/constants/spoed.ts), [frontend/src/components/orders/levertijd-suggestie.tsx](frontend/src/components/orders/levertijd-suggestie.tsx), [frontend/src/components/orders/order-form.tsx](frontend/src/components/orders/order-form.tsx).

### 2026-04-16 — Order-aanmaak triggert auto-plan-groep + werkagenda-port voor levertijd-check
- **Wat:** Na succesvolle order-aanmaak (en update) roept [order-form.tsx](frontend/src/components/orders/order-form.tsx) `triggerAutoplan(kwaliteit, kleur)` aan voor elke unieke maatwerk-groep, mits `app_config.snijplanning.auto_planning.enabled = true`. Snijplanning-queries worden geïnvalideerd zodat de UI direct de nieuwe rol-toewijzingen toont. Failures zijn niet-blokkerend voor de order-aanmaak.
  Daarnaast: nieuwe shared module [werkagenda.ts](supabase/functions/_shared/werkagenda.ts) (Deno-port van `frontend/src/lib/utils/bereken-agenda.ts`) berekent de werkelijke snij-datum per rol uit de cumulatieve werkagenda (sortering op vroegste leverdatum + werktijden 08:00-17:00 ma-vr met 12:00-12:30 pauze). [check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts) gebruikt deze nu i.p.v. `afleverdatum − buffer`.
- **Waarom:** Voorheen kwam een nieuwe maatwerk-order in de "Tekort"-tab van snijplanning zonder rol-toewijzing — de auto-planning was wél globaal aan, maar werd alleen handmatig in de snijplanning-UI getriggerd. Daarnaast gaf de levertijd-check een datum die onnodig laat was (gebaseerd op de afleverdatum minus buffer), terwijl de werkelijke snij-datum eerder ligt in de actuele werkagenda. Voorbeeld CISC 11 300×200: oude check 04-05-2026, nieuwe check 24-04-2026.
- **Files:** [frontend/src/components/orders/order-form.tsx](frontend/src/components/orders/order-form.tsx), [supabase/functions/_shared/werkagenda.ts](supabase/functions/_shared/werkagenda.ts), [supabase/functions/_shared/werkagenda.test.ts](supabase/functions/_shared/werkagenda.test.ts), [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts).

### 2026-04-16 — Fix levertijd-check: status-filter + afleverdatum-bron
- **Wat:** `PLANNING_STATUS_IN_PIPELINE` van `['Gepland', 'Wacht']` naar `['Snijden']` in [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts). Embedded select toegevoegd `order_regels(orders(afleverdatum))` om de werkelijke leverdatum mee te krijgen. `snijDatumVoorRol` gebruikt nu `afleverdatum − logistieke_buffer_dagen` als primaire bron, met `planning_week` als fallback.
- **Waarom:** Migratie 070 zet alle `'Gepland'` en `'Wacht'` snijplannen automatisch om naar `'Snijden'` (via trigger). Het oude filter matchte daardoor 0 records → altijd `wacht_op_orders` zelfs als er rollen met vrije ruimte op de planning stonden. Daarnaast zijn `snijplannen.planning_week` en `snijplannen.afleverdatum` in de praktijk altijd NULL; de echte leverdatum komt uit `orders.afleverdatum` via de FK-keten `snijplannen → order_regels → orders`.

### 2026-04-16 — Real-time levertijd-check bij order-aanmaak
- **Wat:** Nieuwe edge function `check-levertijd` ([supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts)) die tijdens order-entry een concrete leverdatum + onderbouwing berekent. Drie pure helper-modules (match/capacity/resolver) in [supabase/functions/_shared/levertijd-*.ts](supabase/functions/_shared/) met 58 Deno unit tests. Frontend integratie via `useLevertijdCheck`-hook (350 ms debounce, 60s staleTime) en `<LevertijdSuggestie>`-component, gerenderd in `order-form.tsx` na de header-grid voor de laatste maatwerk-regel. Migraties 080 (`backlog_per_kwaliteit_kleur` RPC) en 081 (`logistieke_buffer_dagen`, `backlog_minimum_m2` in `app_config.productie_planning`).
- **Waarom:** Sales communiceerde standaard "4 weken" zonder onderbouwing. De tool kent de planning-state (snijplannen + rollen + capaciteit + backlog) en kan nu vier scenario's onderscheiden: `match_bestaande_rol` (vroegste, hergebruikt restruimte), `nieuwe_rol_gepland` (capaciteit + backlog OK), `wacht_op_orders` (te weinig backlog of geen passende rol), `spoed` (gewenste datum < 2 dagen niet haalbaar). Hergebruikt FFDH `tryPlacePiece` uit [_shared/ffdh-packing.ts](supabase/functions/_shared/ffdh-packing.ts) voor restruimte-check op bestaande rol-plannen.
- **Files:** [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts), [supabase/functions/_shared/levertijd-types.ts](supabase/functions/_shared/levertijd-types.ts), [supabase/functions/_shared/levertijd-match.ts](supabase/functions/_shared/levertijd-match.ts), [supabase/functions/_shared/levertijd-capacity.ts](supabase/functions/_shared/levertijd-capacity.ts), [supabase/functions/_shared/levertijd-resolver.ts](supabase/functions/_shared/levertijd-resolver.ts), [supabase/migrations/080_backlog_per_kwaliteit_kleur.sql](supabase/migrations/080_backlog_per_kwaliteit_kleur.sql), [supabase/migrations/081_app_config_levertijd_velden.sql](supabase/migrations/081_app_config_levertijd_velden.sql), [frontend/src/lib/supabase/queries/levertijd.ts](frontend/src/lib/supabase/queries/levertijd.ts), [frontend/src/hooks/use-levertijd-check.ts](frontend/src/hooks/use-levertijd-check.ts), [frontend/src/components/orders/levertijd-suggestie.tsx](frontend/src/components/orders/levertijd-suggestie.tsx), [frontend/src/components/orders/order-form.tsx](frontend/src/components/orders/order-form.tsx).

### 2026-04-15 — Tekort-analyse gebruikt Map1 uitwisselgroepen
- **Wat:** Migratie 079 herschrijft `snijplanning_tekort_analyse()` zodat primair de Map1-tabel (via `kwaliteit_kleur_uitwisselbaar`) wordt gebruikt en pas terugvalt op `collecties` als het input-paar niet in Map1 staat. `heeft_collectie=true` zodra Map1 óf collectie uitwisselbaarheid kent; `uitwisselbare_codes` komt uit Map1-paren wanneer beschikbaar.
- **Waarom:** De "Tekort"-tab toonde onterecht "Geen collectie gekoppeld aan kwaliteit FEAT" en "Geen voorraad in uitwisselbare kwaliteiten (CAST, CISC, SPRI, VELV) voor kleur 15" terwijl Map1 deze groepen wel definieert (FEAT13→GENT13, VELV15→CISC15).
- **Files:** [079_tekort_analyse_uitwisselgroepen.sql](supabase/migrations/079_tekort_analyse_uitwisselgroepen.sql).

### 2026-04-15 — Fijnmazige uitwisselbaarheid (Map1.xlsx → snijplanning)
- **Wat:** Nieuwe tabel `kwaliteit_kleur_uitwisselgroepen` (PK `(kwaliteit_code, kleur_code, variant_nr)`, groeperend op `basis_code`) en view `kwaliteit_kleur_uitwisselbaar`. Migratie 078. Importscript `import/import_uitwisselgroepen.py` leest `Map1.xlsx` (573 rijen, 274 basis-groepen, 92 met meerdere leden). Edge-functies `optimaliseer-snijplan` en `auto-plan-groep` gebruiken nu `fetchUitwisselbarePairs` als primaire bron voor uitwisselbaarheid en filteren rollen via expliciete `(kwaliteit,kleur)`-paren (`.or(and(...),and(...))`). Valt terug op `collecties` wanneer het input-paar niet in de tabel staat.
- **Waarom:** Het oude `collecties`-model groepeert te permissief (alle kwaliteiten in dezelfde collectie + zelfde kleur). Map1 definieert de werkelijke uitwisselbaarheidsgroepen op `(kwaliteit, kleur)`-niveau (bv. binnen 1VRIJ horen `ANNA11` en `BREE11` samen, maar `BABY12` in een eigen groep).
- **Files:** [078_kwaliteit_kleur_uitwisselgroepen.sql](supabase/migrations/078_kwaliteit_kleur_uitwisselgroepen.sql), [import/import_uitwisselgroepen.py](import/import_uitwisselgroepen.py), [_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts), [optimaliseer-snijplan/index.ts](supabase/functions/optimaliseer-snijplan/index.ts), [auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts).

### 2026-04-15 — Auto-planning: filter op rol_id IS NULL in fetchStukken
- **Wat:** `fetchStukken` in [_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts) filtert nu óók op `rol_id IS NULL`. Fout-afhandeling in [auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts) serialiseert PostgrestError-objecten (die geen `Error`-instance zijn) correct naar `message + detail + hint + code`. Het runnerscript [scripts/eenmalig-auto-plan-alle-groepen.mjs](scripts/eenmalig-auto-plan-alle-groepen.mjs) toont extra error-velden en vangt onverwachte responses af.
- **Waarom:** Voor VELV 13 faalde auto-plan met `Auto-plan fout: [object Object]`. Oorzaak: `fetchStukken` trok snijplannen op met status='Snijden' zonder filter op `rol_id`. Voor VELV 13 waren 5 plannen al eerder toegewezen aan rol 1755 (legacy/stale state); het voorstel bevatte plaatsingen voor die plannen, waarna de guard in `keur_snijvoorstel_goed` ("Niet alle snijplannen zijn nog onaangetast") terecht weigerde. De filter `rol_id IS NULL` stemt `fetchStukken` af op wat de guard verwacht en op de tekort-analyse.
- **Files:** [_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts), [auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts), [scripts/eenmalig-auto-plan-alle-groepen.mjs](scripts/eenmalig-auto-plan-alle-groepen.mjs).

### 2026-04-15 — Snijplanning KPI-cards: horizon + deze week
- **Wat:** De 4 oude stat-cards (Wacht op planning / Gepland / Gesneden / In confectie) op de snijplanning-overview zijn vervangen door 3 horizon-gerichte KPI's: (1) "Binnen horizon (N wkn)" = snijplannen met status `Snijden` binnen `weken_vooruit`, (2) "Te snijden deze week" = status `Snijden` + afleverdatum in huidige kalenderweek (ma–zo), (3) "Gesneden deze week" = status `Gesneden` + `gesneden_op` in huidige week. Nieuwe query `fetchSnijplanningKpis(totDatum)` ([snijplanning.ts](frontend/src/lib/supabase/queries/snijplanning.ts)) draait 3 `head: true` count-queries parallel; nieuwe hook `useSnijplanningKpis`.
- **Waarom:** De oude cards aggregeerden over álle snijplannen (ook buiten de horizon) waardoor getallen niet klopten met de zichtbare lijst, en gaven geen operationele focus. De snijder wil weten: hoeveel staat er in de pijplijn, wat moet déze week klaar, en hoeveel is er al gedaan.

### 2026-04-15 — Kleur_code normalisatie (strip trailing ".0")
- **Wat:** Migratie 077 strippt trailing `.0` uit `kleur_code` in `rollen`, `producten` (+ `zoeksleutel` herberekend), `order_regels.maatwerk_kleur_code`, `snijvoorstellen`, `snijplan_groep_locks` (composite PK) en `maatwerk_m2_prijzen` (UK). Bij UK/PK-botsingen wordt de `.0`-rij verwijderd als de genormaliseerde variant al bestaat. CHECK-constraints voorkomen dat trailing `.0` opnieuw binnenkomt. De helper-functie `normaliseer_kleur_code(TEXT)` wordt idempotent aangemaakt. Frontend [rollen.ts](frontend/src/lib/supabase/queries/rollen.ts) `fetchRollenGegroepeerd` laat de `.0`-variant-fallback in `kleurFilter` vallen.
- **Waarom:** Dezelfde kleur verscheen dubbel in de rollen-voorraad-UI (bv. `VELV 10` én `VELV 10.0`, `GOKI 13.0`) doordat legacy data inconsistent was. Groepering in de UI is exact-match op string; normalisatie in de database is de enige duurzame fix.
- **Files:** [077_normaliseer_kleur_code.sql](supabase/migrations/077_normaliseer_kleur_code.sql), [rollen.ts](frontend/src/lib/supabase/queries/rollen.ts).

### 2026-04-15 — Order bewerken: FK-conflict met snijplannen opgelost + afleverdatum-override
- **Wat:** Migratie 074 schrijft `update_order_with_lines` RPC om van "DELETE alle regels + INSERT opnieuw" naar een merge-strategie: bestaande regels worden ge-UPDATE op `id`, nieuwe regels worden ge-INSERT, en alleen regels die uit de payload verdwenen zijn worden verwijderd. `OrderRegelFormData` bevat nu een optioneel `id`-veld; `order-edit.tsx` geeft de originele regel-ids door aan het formulier. In `order-form.tsx` is een nieuwe `afleverdatumOverridden`-state toegevoegd: zodra de gebruiker de afleverdatum handmatig wijzigt, wordt de auto-berekening (op basis van klant-levertermijn en regels) overgeslagen. Error-rendering in de form toont nu ook niet-`Error`-objecten (supabase geeft `{message, ...}`) zodat Postgres-foutmeldingen zichtbaar worden i.p.v. de generieke "Er ging iets mis".
- **Waarom:** (1) Bij het bewerken van een order waarvan regels al gekoppeld waren aan een snijplan viel de save om op `snijplannen_order_regel_id_fkey` — de delete-and-reinsert strategie botste met de FK zonder ON DELETE. Door regels op id te updaten blijft de koppeling intact. (2) De auto-herberekening van de afleverdatum overschreef handmatige aanpassingen telkens wanneer orderregels muteerden; de override-vlag lost dat op en respecteert de expliciete keuze van de gebruiker.
- **Files:** [074_update_order_with_lines_merge.sql](supabase/migrations/074_update_order_with_lines_merge.sql), [order-mutations.ts](frontend/src/lib/supabase/queries/order-mutations.ts), [order-edit.tsx](frontend/src/pages/orders/order-edit.tsx), [order-form.tsx](frontend/src/components/orders/order-form.tsx).

### 2026-04-15 — Planning-horizon: één bron van waarheid (`weken_vooruit`)
- **Wat:** De planning-horizon voor de snijplanning komt nu uitsluitend uit `planningConfig.weken_vooruit` (Productie Instellingen). Dit filter is altijd actief — groepen met leverdatum voorbij de horizon verdwijnen uit de lijst. `AutoPlanningConfig.horizon_weken` is verwijderd (type, default, UI); auto-planning leest de horizon óók uit `planningConfig` wanneer enabled. Snijplanning-header toont nu zichtbaar de actieve horizon (bv. "horizon 4 weken (t/m 13-05-2026)").
- **Waarom:** Eerder stond de `weken_vooruit`-instelling in Productie Instellingen als UI-dummy: de daadwerkelijke filter gebruikte `autoConfig.horizon_weken` en werd alleen toegepast als auto-planning enabled was. Verwarrend en inconsistent. Nu geldt: wat de gebruiker in Instellingen configureert, is wat er filtert.
- **Files:** [snijplanning-overview.tsx](frontend/src/pages/snijplanning/snijplanning-overview.tsx), [use-snijplanning.ts](frontend/src/hooks/use-snijplanning.ts), [auto-planning.ts](frontend/src/lib/supabase/queries/auto-planning.ts), [auto-planning-config.tsx](frontend/src/components/snijplanning/auto-planning-config.tsx).

## 2026-04-15 — Rollenvoorraad gesynchroniseerd
- Script: `import/sync_rollen_voorraad.py` (dry-run + `--apply`)
- Bron: `Rollenvoorraad per 15042026.xlsx` (1428 unieke rollen)
- Nieuw: 159, geüpdatet: 140, afgevoerd (status `verkocht`): 28, beschermd overgeslagen: 93
- Beschermde rollen hebben workflow-status (`in_snijplan`/`gereserveerd`/`gesneden`) en zijn niet aangeraakt
- Let op: afvoer-status is `'verkocht'` (niet `'geen_voorraad'` — bestaat niet als geldige DB-waarde; check constraint `rollen_status_check` staat alleen toe: `beschikbaar`, `gereserveerd`, `verkocht`, `gesneden`, `reststuk`, `in_snijplan`)

### 2026-04-15 — Testdata refresh: orders-2026 (toekomstige afleverdatum + maatwerk)
- **Wat:** Migratie 068 voegt RPC `admin_truncate_orders()` toe (TRUNCATE orders + order_regels CASCADE). Nieuw script [import/reimport_orders_2026.py](import/reimport_orders_2026.py) leest `orders-2026.xlsx`, filtert op order-niveau (behoud alleen orders waarvan `min(afleverdatum) > vandaag`), vraagt interactieve `WIS`-bevestiging, en laadt de gefilterde set opnieuw (orders + order_regels). Bevat `parse_maatwerk()`: regels met `karpi_code *MAATWERK` krijgen automatisch `is_maatwerk=true` + `maatwerk_vorm` (rechthoek / rond / ovaal) + `maatwerk_lengte_cm` + `maatwerk_breedte_cm` uit de artikel-omschrijving (bv `VERR18XX400260` → 400×260 rechthoek, `VELV15XX200RND` → Ø200 rond). Producten-lookup gepagineerd (fix: eerder slechts 1000/27068 opgehaald waardoor 96% artikelnrs op NULL eindigden). Eenmalige SQL backfill: `UPDATE producten SET kwaliteit_code = LEFT(r.karpi_code,4), kleur_code = SUBSTRING(r.karpi_code FROM 5 FOR 2) FROM order_regels r WHERE p.artikelnr=r.artikelnr AND p.kwaliteit_code IS NULL`. Resultaat: 365 orders / 615 regels, waarvan 323 maatwerk; na auto-plan-groep batch zijn 40 kwaliteit/kleur-groepen gepland op rollen (110 geskipt — geen voorraad).
- **Waarom:** Demo-dataset bevatte veel orders met afleverdatum in het verleden waardoor flows (snijplanning, confectie-planning) niet getest konden worden. Met alleen toekomstige orders + correct gemarkeerde maatwerk is de testomgeving bruikbaar.
- **Impact:** Downstream tabellen (`snijplannen`, `snijplan_groepen`, `snijplan_rollen`, `kleuren`, `confectie_planning`, rol-koppelingen) zijn geleegd via CASCADE. Bekende gaps: (1) auto_maak_snijplan trigger zet nog status `'Wacht'`, terwijl `snijplanning_groepen_gefilterd` RPC `totaal_snijden` telt — werkt toch omdat `auto-plan-groep` edge function nog op `'Wacht'` zoekt; toekomstige migratie moet deze statussen harmoniseren. (2) `producten.is_maatwerk` bestaat niet als kolom; maatwerk-detectie gebeurt alleen op order_regel-niveau via karpi_code-suffix.

### 2026-04-15 — Levertermijn per type (standaard/maatwerk) + deelleveringen
- **Wat:** Migratie 067 vervangt `debiteuren.standaard_levertermijn_weken` door twee aparte velden `standaard_maat_werkdagen` en `maatwerk_weken`, en voegt `deelleveringen_toegestaan` boolean toe. `app_config.order_config` bevat nu `{standaard_maat_werkdagen:5, maatwerk_weken:4}`. Nieuwe pure util [afleverdatum.ts](frontend/src/lib/utils/afleverdatum.ts) berekent per type de datum en de langste. `OrderForm` recalculeert afleverdatum bij elke klant-wissel én orderregel-mutatie op basis van `is_maatwerk` per regel; toont bij gemengde orders beide subdatums als hint. Bij klant met `deelleveringen_toegestaan=true` en gemengde order verschijnt een checkbox "Deelleveringen" (default aan) — bij aanmaken wordt de order gesplitst in 2 losse `createOrder()` calls (standaard + maatwerk), verzendkosten-regel gaat mee met de standaard-order, navigatie naar orders-lijst in plaats van detail. Instellingen-pagina en klant-detail-header zijn uitgebreid met de nieuwe velden (2 aparte overrides + toggle).
- **Waarom:** Eén globale levertermijn dekte de praktijk niet: voorraad-karpetten leveren we binnen 5 dagen uit, maatwerk duurt ~4 weken. Bij gemengde orders wil Karpi de keuze geven om te splitsen zodat het standaard-deel niet hoeft te wachten op het maatwerk.

### 2026-04-15 — Rol-uitvoer flow: start/afvinken/sluiten met tijdregistratie
- **Wat:** Nieuwe "Start met rol"-knop op productie-groep (`productie-groep.tsx`) en snijplanning-accordion (`week-groep-accordion.tsx`) opent `RolUitvoerModal` (nieuw `rol-uitvoer-modal.tsx`). Modal toont snij-visualisatie + lijst stukken met checkboxes (default aangevinkt), per-stuk sticker-print en bulk-print, en "Rol afsluiten" knop. Bij openen registreert een idempotente RPC `start_snijden_rol` de starttijd. Bij afsluiten worden alléén afgevinkte snijplannen als `Gesneden` gemarkeerd; niet-afgevinkte stukken gaan terug naar `Wacht` (rol_id/positie gereset) zodat ze automatisch in de volgende optimalisatie-run meedraaien. Reststukken worden berekend op basis van alléén afgevinkte stukken. Migraties 063 (kolommen `snijden_gestart_op`/`snijden_voltooid_op`/`snijden_gestart_door` op rollen), 064 (`start_snijden_rol` RPC), 066 (`voltooi_snijplan_rol` uitgebreid met `p_snijplan_ids BIGINT[]`). Oude 2-stappen flow "Start productie" → "Rol gesneden" vervangen door één knop + modal.
- **Waarom:** Eerdere flow kon alleen in één keer de hele rol afvinken — geen per-stuk afvinken, geen manier om een rol te sluiten met slechts een deel gesneden, en geen starttijd-registratie. De modal sluit aan bij de werkpraktijk: medewerker start rol, vinkt af wat hij daadwerkelijk snijdt, print stickers direct, sluit rol af — en wat niet lukte rolt automatisch mee naar de volgende run. Start/eind-timestamps op rol-niveau maken latere tijdanalyse (snijduur per rol) mogelijk.
- **Impact:** Migraties 063/064/066; nieuwe kolommen op `rollen`; nieuwe RPC + uitgebreide signatuur van `voltooi_snijplan_rol` (backwards compatible — `p_snijplan_ids=NULL` behoudt oud gedrag). Route `/snijplanning/productie/{rolId}` blijft bestaan maar wordt niet meer gelinkt vanaf de hoofd-flow.

### 2026-04-15 — Standaard levertermijn (globaal + per klant)
- **Wat:** Migratie 061 voegt kolom `debiteuren.standaard_levertermijn_weken` (INTEGER NULL) toe en seedt `app_config.order_config = {"standaard_levertermijn_weken": 1}`. Nieuwe query-module `order-config.ts` (fetch/update globale config). Instellingen-pagina kreeg Card "Order-instellingen" met numeric input voor globale default (weken). Klant-detailpagina kreeg inline "Standaard levertermijn"-veld (NULL = valt terug op globaal). `OrderForm.handleClientChange` vult bij klant-selectie automatisch `afleverdatum = vandaag + N×7 dagen` (N = klant-override ?? globaal ?? 1), alleen als afleverdatum nog leeg is zodat handmatige keuzes niet worden overschreven. `ClientSelector` selecteert nu ook `verzendkosten`, `verzend_drempel`, `standaard_levertermijn_weken`.
- **Waarom:** De afleverdatum was telkens handmatig werk; in de praktijk heeft elke klant een vrij vaste levertermijn. Met een globale default + per-klant override komt de datum automatisch goed.

### 2026-04-15 — Meerdere reststukken per gesneden rol
- **Wat:** Nieuwe util `compute-reststukken.ts` (backend Deno + frontend kopie) berekent álle rechthoekige restgebieden uit een FFDH-layout: rechter-strip per shelf, onder-sliver per kort stuk, en end-of-roll strip. Filter: ≥ 70×140 cm = bruikbaar reststuk, kleiner = afval. `optimaliseer-snijplan` voegt `reststukken[]` toe aan elke rol in de response. `SnijVisualisatie` rendert elk reststuk als groen-omlijnde box met afmetinglabel. Migratie 060 breidt `voltooi_snijplan_rol()` uit met JSONB-parameter `p_reststukken` zodat per kwalificerend rechthoek een rol-record met `status='beschikbaar'` + `oorsprong_rol_id` wordt aangemaakt (rolnummer = `<rol>-R1`, `-R2`, …). Productie-rol/groep tonen alle gegenereerde reststuk-stickers ineens; oude `ReststukBevestigingModal` is uit deze flow verwijderd. `SnijRolVoorstel` en `SnijvoorstelRol` types kregen optioneel veld `reststukken: ReststukRect[]`.
- **Waarom:** Eerder werd alleen de end-of-roll strip als reststuk geregistreerd; alle ruimte naast geplaatste stukken (bv. 80×300 strip naast een 320×300 stuk op een rol van 400 breed) ging verloren als afval. Karpi wil maximale herbruikbaarheid: elk rechthoek dat groot genoeg is voor toekomstig werk moet voorraad worden met eigen QR-sticker.

### 2026-04-15 — rol_type classificatie (volle_rol / aangebroken / reststuk)
- **Wat:** Migraties 058 + 059. Nieuwe enum `rol_type` + kolom op `rollen`. Helper `bereken_rol_type()` leidt de classificatie af uit artikelnr (laatste 3 cijfers = standaard breedte), breedte_cm, lengte_cm en oorsprong_rol_id. Trigger `rollen_set_rol_type` houdt de kolom automatisch in sync. `voltooi_snijplan_rol()` zet rest-rollen nu op `status='beschikbaar'` i.p.v. `'reststuk'`; drempel verhoogd van 50cm naar 100cm. `rollen_stats()` RPC aggregeert op rol_type. Frontend: `RolRow` en queries/badges gebruiken `rol_type` i.p.v. status-heuristiek.
- **Waarom:** Oude logica telde elke gesneden rest als "reststuk", ongeacht breedte. Werkelijkheid: een reststuk heeft een afwijkende breedte; een aangebroken rol heeft nog standaard breedte maar minder lengte. Classificatie moet fysieke werkelijkheid weerspiegelen, losgekoppeld van workflow-status.
- **Impact:** `rollen.rol_type` kolom (NOT NULL). Bestaande rollen backfilled. Status 'reststuk' blijft bestaan voor legacy data maar wordt niet meer automatisch toegekend bij snijden.

### 2026-04-13 — Confectie-planning gebaseerd op snijplannen
- **Wat:** Migratie 054 herdefinieert view `confectie_planning_overzicht` zodat hij leest uit `snijplanning_overzicht` (status `Gesneden`/`In confectie`) i.p.v. `confectie_orders`. `type_bewerking` wordt afgeleid via `confectie_bewerking_voor_afwerking()`. Confectielijst filtert `Gereed` weg — alleen nog openstaand werk.
- **Waarom:** Lijst en planning gebruikten twee verschillende bronnen waardoor items wel in de lijst stonden maar niet in de planning. Eén bron = één waarheid.
- **Impact:** Migratie 054; `fetchConfectielijst` filtert nu alleen `Gesneden`/`In confectie`.

### 2026-04-13 — Confectie-planning frontend
- **Wat:** Nieuwe `/confectie/planning` route met lanes per afwerkingstype (breedband, feston, locken, enz.). Parallelle lanes, binnen elke lane sequentieel op leverdatum. Werktijden gedeeld met snijplanning (`useWerktijden`, localStorage `karpi.werkagenda.werktijden`). Per-type config (`minuten_per_meter`, `wisseltijd_minuten`, `actief`) inline bewerkbaar via `ConfectieTijdenConfig`. Blokken worden rood gemarkeerd bij eind > leverdatum. Tabs bovenaan Lijst/Planning koppelen naar `/confectie` en `/confectie/planning`.
- **Waarom:** Planner ziet in één oogopslag wanneer welk stuk geconfectioneerd wordt en of het op tijd klaar is voor de leverdatum (spec 10).
- **Impact:** Nieuwe bestanden `lib/supabase/queries/confectie-planning.ts`, `hooks/use-confectie-planning.ts`, `components/confectie/confectie-tijden-config.tsx`, `lane-kolom.tsx`, `confectie-blok-card.tsx`, `pages/confectie/confectie-planning.tsx`. Route toegevoegd in `router.tsx`; `ConfectieTabs` geïntegreerd in `confectie-overview.tsx`.

### 2026-04-13 — Order-bewerking locken op basis van snijstatus
- **Wat:** Orders zijn niet meer onbeperkt bewerkbaar. Drie modi via `computeOrderLock(regels)` in `lib/utils/order-lock.ts`:
  - `none` — nog niets fysiek gesneden → volledige bewerking zoals voorheen.
  - `afwerking-only` — ≥1 maatwerkregel staat op `Gesneden`/`In confectie` en heeft nog geen afwerking → minimalistisch scherm (`AfwerkingOnlyEditor`) waar alleen afwerking (+ bandkleur bij B/SB) per regel gezet kan worden.
  - `full` — alle gesneden regels hebben al afwerking, of alles staat op `Ingepakt`/`Gereed` → order volledig op slot; "Bewerken"-knop grijst uit, directe URL toont amber waarschuwing.
- **Waarom:** Na fysiek snijden kloppen wijzigingen in aantal/prijs/maatvoering niet meer met het stuk. Afwerking wordt vaak pas bij confectie bepaald → die blijft open tot `Ingepakt`.
- **Impact:** Nieuw `order-lock.ts` + `afwerking-only-editor.tsx`, nieuwe mutation `updateRegelAfwerking()` in `order-mutations.ts`, aanpassingen in `order-edit.tsx`, `order-detail.tsx`, `order-header.tsx`.

### 2026-04-13 — Migratie 053: confectie_werktijden tabel + planning-view voor confectie-planning module
- **Wat:** Nieuwe configuratietabel `confectie_werktijden` (PK `type_bewerking`, `minuten_per_meter`, `wisseltijd_minuten`, `actief`, `bijgewerkt_op`) met seed-defaults voor 7 types (breedband, smalband, feston, smalfeston, locken, volume afwerking, stickeren). Trigger-functie `set_bijgewerkt_op()` houdt timestamp bij. Nieuwe view `confectie_planning_overzicht` joint `confectie_orders` → `order_regels` → `orders` → `debiteuren` (+ producten/rollen voor kwaliteit/kleur fallback) en filtert op status 'Wacht op materiaal' / 'In productie'. RLS volgt projectconventie (authenticated full access).
- **Waarom:** Database-fundament voor confectie-planning module (spec 10): planner ziet per afwerkingstype welk stuk wanneer aan de beurt is, met geschatte duur op basis van strekkende meter × minuten/meter + wisseltijd.
- **Noot:** Spec noemde status 'In confectie' maar dat hoort bij `snijplan_status`; voor `confectie_status` is het equivalent 'In productie' — view gebruikt de juiste enum-waarde.

### 2026-04-09 — Fix: overlappende stukken in snijplan visualisatie
- **Wat:** Stukken op de productie-groep pagina werden visueel overlappend getekend terwijl de FFDH-posities correct waren.
- **Oorzaak:** De `snijplanning_overzicht` view miste de `geroteerd` kolom. De frontend moest rotatie raden via shelf-inferentie en koos verkeerd wanneer beide oriëntaties geometrisch pasten. Bijv. stuk 1373 (300×200, geroteerd=true → geplaatst als 200×300) werd getekend als 300×200, waardoor het stuk 1720 (x:200-400) overlapte.
- **Fix:** `geroteerd` kolom toegevoegd aan de view (migratie 048) + `SnijplanRow` type + `mapSnijplannenToStukken` gebruikt nu de vlag direct i.p.v. raden.
- **Impact:** Migratie 048 (DROP+CREATE snijplanning_overzicht), `snijplanning_groepen` view cascade-gedropped (niet actief gebruikt, frontend gebruikt de RPC functie).

### 2026-04-09 — Snijplanning verbeteringen (snijtijden + reststuk flow)
- **Wat:** Drie ontbrekende features uit de oorspronkelijke eisen geïmplementeerd:
  1. **Snijtijden configuratie:** Wisseltijd per rol (default 15 min) en snijtijd per karpet (default 5 min) instelbaar via Productie Instellingen. Geschatte totaaltijd getoond op snijvoorstel-review en productie-groep pagina's.
  2. **Reststuk bevestigingsmodal:** Na het snijden verschijnt een modal waarin de gebruiker de restlengte kan aanpassen of kan kiezen voor "geen reststuk". Pas na bevestiging wordt het reststuk opgeslagen.
  3. **Reststuk sticker printen:** Na bevestiging toont het systeem een reststuk-sticker (rolnummer, kwaliteit, kleur, afmetingen, QR-code, locatieveld) met print-knop.
- **Impact:** Migratie 047 (voltooi_snijplan_rol met p_override_rest_lengte parameter), PlanningConfig uitgebreid met wisseltijd_minuten/snijtijd_minuten, 2 nieuwe componenten (reststuk-bevestiging-modal, reststuk-sticker-layout)

### 2026-04-09 — Fix: dubbele groepen in snijplanning (kleur_code normalisatie)
- **Wat:** Kleur_codes "12" en "12.0" werden als aparte groepen getoond in snijplanning
- **Oorzaak:** Database bevat beide varianten; RPC groepeerde op ruwe kleur_code
- **Fix:** Nieuwe `normaliseer_kleur_code()` SQL helper die ".0" suffix stript. RPC `snijplanning_groepen_gefilterd` groepeert nu op genormaliseerde waarden. Frontend queries gebruiken `getKleurVariants()` om beide varianten op te vragen bij detail- en rollen-queries.
- **Impact:** Migratie 047, frontend queries snijplanning.ts aangepast

### 2026-04-09 — Automatische snijplanning met rolreservering
- **Wat:** Automatische snijplanning die bij nieuwe orders de snijplanning heroptimaliseert en rollen direct reserveert
- **Waarom:** Voorkomt dubbele rolreservering en geeft voorraad-inzicht (gereserveerd vs. vrij). Prioriteit: levertermijn → efficiëntie
- **Hoe:**
  - Nieuwe edge function `auto-plan-groep`: release Gepland stukken → FFDH heroptimalisatie → auto-goedkeuring
  - FFDH algoritme geëxtraheerd naar `_shared/ffdh-packing.ts` (gedeeld door beide edge functions)
  - Globale configuratie via `app_config` (aan/uit + horizon 1-4 weken)
  - "Start productie" knop per rol: beschermt stukken tegen heroptimalisatie
  - Race condition preventie via `snijplan_groep_locks` tabel
- **Impact:** Migratie 046, 2 nieuwe RPCs (`release_gepland_stukken`, `start_productie_rol`), nieuwe edge function, frontend config component

### 2026-04-09 — Snijplanning week-filter
- **Wat:** Leverdatum-filter toegevoegd aan snijplanning overzicht — filtert op week-niveau (deze week, 1-4 weken vooruit)
- **Waarom:** Planning op basis van leverdata — focus op urgente orders ipv heel de backlog
- **Impact:** Nieuwe RPC functies `snijplanning_groepen_gefilterd` en `snijplanning_status_counts_gefilterd`, week-filter component, edge function accepteert `tot_datum`

## 2026-04-09 — Snijplanning productie workflow

### Tab-filtering
- Tabs op snijplanning overview filteren nu daadwerkelijk de groepen
- View `snijplanning_groepen` uitgebreid met per-status counts (incl. `totaal_in_confectie`)
- Naamgeving: `totaal_status_gesneden` (enkel status) vs `totaal_gesneden` (voorbij snijfase)

### Productie-flow
- Nieuwe pagina `/snijplanning/productie/:rolId` voor productie per rol
- Rol-visualisatie met correcte rotatie-inferentie (gedeelde utility)
- "Rol gesneden" knop markeert alle stukken als gesneden via RPC `voltooi_snijplan_rol`
- Sticker preview na het snijden
- "Snijden" shortcut knop in accordion header
- V1 aanname: hele rol wordt in één keer gesneden, geen partial cutting
- Status-transitie V1: Gepland → Gesneden (tussenliggende "In productie" status niet gebruikt)

### Stickers
- Herontwerp met Floorpassion branding en QR-code (synchroon SVG, geen flash)
- QR-codes dienen als tracking door het hele proces (snijden → confectie → inpak)
- Bulk sticker print pagina `/snijplanning/stickers`
- Per regel of bulk (hele groep/rol) printen
- 2 stickers per stuk: tapijt + orderdossier

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
