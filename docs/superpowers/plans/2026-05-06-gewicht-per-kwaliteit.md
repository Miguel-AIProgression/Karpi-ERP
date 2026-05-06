# Gewicht per kwaliteit — bron-van-waarheid op `kwaliteiten`, gederiveerd op product en orderregel

**Datum:** 2026-05-06
**Status:** Plan vastgesteld na grilling via `/grill-me` + architectuurperspectief via `/improve-codebase-architecture`. Klaar voor `/to-issues`.
**Aanleiding:** Mail Piet-Hein Dobbe (2026-05-06) — gewichten per kwaliteit moeten verwerkt worden, automatisch totaalgewicht per orderregel/zending, primair voor vervoerder-info (HST `weightKg`).

## Doel

Vandaag is "gewicht" verspreid over vijf bronnen met overlappende rollen: `producten.gewicht_kg` (handmatig per stuk), `maatwerk_m2_prijzen.gewicht_per_m2_kg` (per kwaliteit+kleur, gebruikt in maatwerk-flow), `order_regels.gewicht_kg` (snapshot bij regel-aanmaak), `rollen.gewicht_kg` (per fysieke rol), en `prijslijst_regels.gewicht` (legacy). Callers kennen de fallback-keten — `create_zending_voor_order` doet zelf `COALESCE(ore.gewicht_kg, p.gewicht_kg, 0)`.

Gewenste uitkomst:

- **Eén bron-van-waarheid:** `kwaliteiten.gewicht_per_m2_kg`. Geen kleur- of artikelnr-override.
- **Gewicht-resolver als deep SQL-Module:** smalle interface (één functie), brede implementatie (oppervlak-bepaling per producttype, NULL-fallback, kwaliteit-lookup). Alle gewichts-callers gaan hierdoor.
- **Trigger-cascade:** kwaliteit → producten → open order_regels. Wijziging op één plek werkt automatisch door tot pakbon.
- **Gewicht-uit-oude-bron-flag** zichtbaar tot data-migratie compleet is — geen hard block, wel transparantie.
- **Vervoerder krijgt actueel gewicht** via bestaande zending-snapshot, zonder dat caller-code verandert.

## Architectuurperspectief — diepe modules

### Deep SQL-Module: `gewicht_resolver` (nieuw)

**Smal interface (publiek):**
- `bereken_orderregel_gewicht_kg(p_order_regel_id BIGINT) → NUMERIC` — gewicht voor een bestaande orderregel, gebaseerd op type (vast/maatwerk), oppervlakte, kwaliteit-density, met NULL-fallback. Pure functie, idempotent.
- `bereken_product_gewicht_kg(p_artikelnr TEXT) → NUMERIC` — gewicht voor een vast product.
- `gewicht_per_m2_voor_kwaliteit(p_kwaliteit_code TEXT) → NUMERIC` — eenvoudige lookup.

**Brede implementatie (intern):**
- Oppervlak-bepaling per producttype: vast/staaltje uit `producten.lengte_cm × breedte_cm`; maatwerk uit `maatwerk_oppervlak_m2` (al bbox-volgend, zie [`berekenPrijsOppervlakM2`](../../frontend/src/lib/utils/maatwerk-prijs.ts#L5-L18)); rol/overig → NULL.
- Kwaliteit-density-lookup (`kwaliteiten.gewicht_per_m2_kg`).
- NULL-fallback-logica + flag-management (`gewicht_uit_kwaliteit`).
- Trigger-cascade (zie hieronder).

**Triggers (intern, niet publiek):**
- `trg_kwaliteit_gewicht_recalc` op `kwaliteiten` — bij UPDATE van `gewicht_per_m2_kg`, herrekent alle producten in die kwaliteit, en cascadeert naar open `order_regels`.
- `trg_product_gewicht_recalc` op `producten` — bij UPDATE van `gewicht_kg`, herrekent open `order_regels.gewicht_kg` voor regels met dat artikelnr.

**Callers gaan ALLEMAAL door dit oppervlak:**
| Caller | Vóór | Ná |
|--------|------|-----|
| Trigger op kwaliteit-update | n.v.t. (was er niet) | `bereken_product_gewicht_kg` per product |
| Trigger op product-update | n.v.t. | `bereken_orderregel_gewicht_kg` per regel |
| `update_order_totalen()` | somt `order_regels.gewicht_kg` | onveranderd — somt nu cache die elders gevuld wordt |
| `create_zending_voor_order` (mig 176/177) | `COALESCE(ore.gewicht_kg, p.gewicht_kg, 0)` | gewoon `ore.gewicht_kg` — fallback weg, want trigger garandeert verse waarde |
| `kleuren_voor_kwaliteit` RPC | retourneert gewicht uit `maatwerk_m2_prijzen` | retourneert gewicht uit `kwaliteiten` (kolom in mw_m2_prijzen vervalt) |
| Frontend `berekenMaatwerkGewicht` | rechtstreekse multiplicatie | onveranderd — caller heeft gewicht/m² al via prop, formule blijft pure helper |

**Deletion-test:** als ik `gewicht_resolver` wegdenk, verschijnt complexiteit op vier plekken — de twee triggers, `create_zending_voor_order`, en de Excel-import-update-paden zouden elk hun eigen oppervlak/kwaliteit/NULL-logica moeten dragen. Concentreert complexiteit. Pass.

### Frontend: pragmatisch, geen aparte `modules/gewicht/`

Op TS-zijde is gewicht niet groot genoeg voor een eigen Module (geen workflow, geen tabel-eigenaarschap). Wel consolideren:

- `frontend/src/lib/utils/gewicht.ts` — nieuwe locatie. Bevat `berekenGewichtKg(oppervlakM2, gewichtPerM2)` + format-helpers. Vervangt [`berekenMaatwerkGewicht` in `maatwerk-prijs.ts`](../../frontend/src/lib/utils/maatwerk-prijs.ts#L36) — naam-rename om expliciet te maken dat het generiek is, niet maatwerk-only.
- `frontend/src/lib/supabase/queries/kwaliteiten.ts` — uitbreiden met `fetchKwaliteitenMetGewicht`, `updateKwaliteitGewicht`. Geen nieuwe queries-folder.
- `frontend/src/pages/instellingen/kwaliteiten.tsx` — settings-pagina. Past bij bestaand patroon (`bedrijfsgegevens.tsx`, `productie-instellingen.tsx`).
- `frontend/src/components/kwaliteiten/gewicht-bron-badge.tsx` — kleine badge "uit oude bron" voor producten waar `gewicht_uit_kwaliteit = false`. Eén plek voor consistente styling.

**Reden geen `modules/gewicht/`:** deletion-test op TS-zijde — als ik die module wegdenk, blijft er nauwelijks complexiteit hangen (één pure functie, één query-uitbreiding, één pagina). Module-boundary zou padding zijn zonder leverage.

## Vastgestelde keuzes (uit grill-sessie)

### 1. Bron van waarheid: `kwaliteiten.gewicht_per_m2_kg`

Eén niveau. Géén kleur-override (drop kolom op `maatwerk_m2_prijzen`), géén artikelnr-override. Piet-Heins instructie "per product, niet per maat" = "per kwaliteit", niet "per artikelnr".

### 2. `producten.gewicht_kg` = gederiveerde cache

Behouden voor backward-compat (bestaande callers blijven werken). Onderhouden door `trg_kwaliteit_gewicht_recalc`. Geen handmatige edits meer in product-form. Producten van type `'rol'` en `'overig'` worden niet automatisch herrekend — daar blijft handmatige waarde.

### 3. Bestaande `maatwerk_m2_prijzen.gewicht_per_m2_kg` — modus-seed dan drop

Volgorde:
1. Nieuwe kolom `kwaliteiten.gewicht_per_m2_kg` toevoegen.
2. Seed via modus per kwaliteit van bestaande `maatwerk_m2_prijzen.gewicht_per_m2_kg`.
3. Excel-import van Piet-Hein overschrijft (kwaliteit-keys die in Excel staan).
4. Drop `maatwerk_m2_prijzen.gewicht_per_m2_kg` in laatste migratie. RPC `kleuren_voor_kwaliteit` wijzigt bron naar `kwaliteiten`.

### 4. `order_regels.gewicht_kg` = snapshot met auto-herberekening voor open orders

Bij wijziging van `kwaliteiten.gewicht_per_m2_kg`: trigger herrekent alle `order_regels` van orders waarvan `status NOT IN ('Verzonden','Geannuleerd','Klaar voor verzending')`. Verzonden orders blijven historisch correct via `zendingen.totaal_gewicht_kg` (al bevroren bij verzending in mig 176/177).

### 5. NULL-handling: B3 — flag-gebaseerd, geen hard block

- Kwaliteit zonder gewicht → `producten.gewicht_kg` houdt huidige waarde (legacy), `gewicht_uit_kwaliteit = false`.
- Kwaliteit krijgt gewicht → trigger zet `gewicht_uit_kwaliteit = true` en herrekent.
- UI toont badge op product-detail + filter "ontbreekt nog" op instellingen-pagina.

### 6. Excel-import: eenmalig Python-script

Bron = legacy export uit oud Karpi-systeem (zelfde categorie als bestaande `brondata/`-bestanden). Patroon: `import/import_kwaliteit_gewichten.py` met UPSERT op kwaliteit-code. Idempotent voor heruploads tijdens cutover-week.

### 7. UI: instellingen-pagina

Route `/instellingen/kwaliteiten`. Sorteerbare/zoekbare tabel met kolommen: `kwaliteit_code | omschrijving | collectie | standaard_breedte_cm | gewicht_per_m2_kg | aantal_producten | flag_uit_oude_bron`. Inline edit met optimistische update + audit-log via bestaande trigger op `activiteiten_log`.

### 8. Oppervlak-bron vaste producten: nieuwe kolommen

`producten.lengte_cm INTEGER`, `producten.breedte_cm INTEGER` — eenmalig gevuld via regex-parsing op `karpi_code`/`artikelnr` voor `product_type IN ('vast','staaltje')`. Permanent veld, geen on-the-fly parsing. Parse-rapport voor onmatchbare artikelnrs.

### 9. Vorm-bbox al ingebouwd

[`berekenPrijsOppervlakM2`](../../frontend/src/lib/utils/maatwerk-prijs.ts#L5-L18) gebruikt `diameter²` voor rond (industrie-bbox). `maatwerk_oppervlak_m2` is dus al bbox-volgend; gewicht-resolver gebruikt het direct. Klopt met Piet-Heins regel ("rond 200 cm = 200×200 = 4 m²").

### 10. Cutover bestaande open orders: hard reset

Bestaande orders zijn weggooi-data (volgende week komt actuele orderlijst). Geen diff-rapport. Eénmalige UPDATE als laatste stap van migratie 186 herrekent alle open `order_regels.gewicht_kg`.

### 11. Facturen buiten scope

`factuur_regels` heeft geen gewicht-veld. Pakbon-flow gebruikt zending-snapshot, niet factuur.

## Domeinwoordenboek-toevoegingen

In `docs/data-woordenboek.md` onder sectie "Producten & Voorraad" toevoegen:

| Term | Betekenis |
|------|-----------|
| **Gewicht/m²** | Density per kwaliteit in kg per vierkante meter. Bron-van-waarheid: `kwaliteiten.gewicht_per_m2_kg`. Drijft alle gewicht-berekeningen voor orderregels en zendingen. Ingegeven via instellingen-pagina `/instellingen/kwaliteiten` of via eenmalige Excel-import (`import/import_kwaliteit_gewichten.py`). NULL = nog niet ingevuld; producten in deze kwaliteit vallen terug op legacy `producten.gewicht_kg`. |
| **Gewicht-resolver** | SQL-Module die gewicht voor een orderregel of product berekent uit oppervlakte × kwaliteit-density. Smalle publieke API: `bereken_orderregel_gewicht_kg(p_id)` en `bereken_product_gewicht_kg(p_artikelnr)`. Brede implementatie: oppervlak-bepaling per producttype, NULL-fallback, trigger-cascade. Alle gewicht-callers gaan hierdoor — geen verspreide `oppervlak × density`-formules meer. |
| **Gewicht-cache** | Verzamelnaam voor de gederiveerde gewicht-velden: `producten.gewicht_kg` (kg per stuk, gederiveerd uit kwaliteit + lengte × breedte) en `order_regels.gewicht_kg` (snapshot bij regel-aanmaak/-update, herrekend voor open orders bij kwaliteit-mutatie). Beide onderhouden door triggers — niet handmatig editen. |
| **Gewicht-uit-kwaliteit-flag** | Boolean `producten.gewicht_uit_kwaliteit`. TRUE = `gewicht_kg` is gederiveerd uit `kwaliteiten.gewicht_per_m2_kg`. FALSE = legacy waarde uit oude systeem (kwaliteit heeft nog geen gewicht ingevuld). Maakt migratie-voortgang zichtbaar; data-completing-rapport filtert hierop. |
| **Bbox-oppervlak (gewicht)** | Voor maatwerk-vormen (rond/ovaal) wordt het gewicht berekend op het omsluitende rechthoek (lengte × breedte), niet op de werkelijke geometrische oppervlakte. Industrie-standaard voor zowel prijs (`berekenPrijsOppervlakM2`) als gewicht. Voor rond: `diameter²`. |

## Bestandsverhuizingen / nieuwe bestanden

| Bron | Doel | Actie |
|------|------|-------|
| `frontend/src/lib/utils/maatwerk-prijs.ts:36-39` (`berekenMaatwerkGewicht`) | `frontend/src/lib/utils/gewicht.ts` (`berekenGewichtKg`) | Verhuizen + rename. Imports updaten in `op-maat-selector.tsx`, `kwaliteit-first-selector.tsx`. |
| (nieuw) | `frontend/src/pages/instellingen/kwaliteiten.tsx` | Nieuwe pagina |
| (nieuw) | `frontend/src/components/kwaliteiten/gewicht-bron-badge.tsx` | Nieuwe badge-component |
| (nieuw) | `frontend/src/lib/supabase/queries/kwaliteiten.ts` | Uitbreiden of nieuw aanmaken (`fetchKwaliteitenMetGewicht`, `updateKwaliteitGewicht`) |
| (nieuw) | `import/import_kwaliteit_gewichten.py` | Excel → Supabase UPSERT |

## Stappenplan (issues)

### Issue A — Migratie 184: kolommen + parsing van lengte/breedte

**Doel:** structuur klaarzetten zonder gedrag te veranderen. Geen triggers nog; geen RPC-wijzigingen.

**Taken:**
- `ALTER TABLE kwaliteiten ADD COLUMN gewicht_per_m2_kg NUMERIC(8,3)`.
- `ALTER TABLE producten ADD COLUMN lengte_cm INTEGER, ADD COLUMN breedte_cm INTEGER, ADD COLUMN gewicht_uit_kwaliteit BOOLEAN NOT NULL DEFAULT false`.
- Eenmalige UPDATE: parse `karpi_code` regex `(\d{3})(\d{3})$` (laatste 6 cijfers = lengte+breedte voor `product_type IN ('vast','staaltje')`). Bewaar parse-rapport in `_migratie_logs`-tabel of als COMMENT in migratie-bestand.
- Index `producten_kwaliteit_code_idx` (als nog niet aanwezig) voor snelle herrekening.
- Update `docs/database-schema.md` voor de nieuwe kolommen.

**Verifieerbaar:** SELECT toont `lengte_cm`/`breedte_cm` op alle vaste/staaltje-producten. Onmatchbare artikelnrs zichtbaar.

### Issue B — Migratie 185: modus-seed + gewicht-resolver-functies + triggers

**Doel:** functionele kern. Bron-van-waarheid wordt actief.

**Taken:**
- Modus-seed `kwaliteiten.gewicht_per_m2_kg` uit `maatwerk_m2_prijzen.gewicht_per_m2_kg` (per kwaliteit: meest voorkomende waarde over kleuren).
- SQL-functie `gewicht_per_m2_voor_kwaliteit(p_kwaliteit_code TEXT) → NUMERIC(8,3)`. STABLE.
- SQL-functie `bereken_product_gewicht_kg(p_artikelnr TEXT) → TABLE(gewicht_kg NUMERIC, uit_kwaliteit BOOLEAN)`. STABLE.
- SQL-functie `bereken_orderregel_gewicht_kg(p_order_regel_id BIGINT) → NUMERIC`. STABLE.
- Trigger `trg_kwaliteit_gewicht_recalc` op `kwaliteiten` (AFTER UPDATE OF gewicht_per_m2_kg). Update producten + cascadeert.
- Trigger `trg_product_gewicht_recalc` op `producten` (AFTER UPDATE OF gewicht_kg). Cascadeert naar open `order_regels`.
- Update RPC `kleuren_voor_kwaliteit` — leest gewicht uit `kwaliteiten` ipv `maatwerk_m2_prijzen`.
- Update RPC's die `order_regels` aanmaken (`create_order` / `create_webshop_order`-familie): laat `gewicht_kg` initieel NULL en laat trigger het invullen — of vul direct via `bereken_orderregel_gewicht_kg`. **Beslissing in implementatie:** trigger is robuuster (caller hoeft niets te weten).

**Verifieerbaar:** UPDATE op één kwaliteit met test-waarde → producten in die kwaliteit hebben nieuw `gewicht_kg`, `gewicht_uit_kwaliteit = true`, en open `order_regels` met dat artikelnr zijn herrekend. Verzonden orders ongewijzigd.

### Issue C — Frontend: gewicht-helper + instellingen-pagina + badge

**Doel:** UI-laag voor data-onderhoud + zichtbaarheid.

**Taken:**
- Verhuis [`berekenMaatwerkGewicht`](../../frontend/src/lib/utils/maatwerk-prijs.ts#L36) naar nieuwe `lib/utils/gewicht.ts` als `berekenGewichtKg`. Update imports in `op-maat-selector.tsx`, `kwaliteit-first-selector.tsx`.
- Nieuwe component `<GewichtBronBadge gewichtUitKwaliteit={...} />` in `components/kwaliteiten/`. Twee staten: "kwaliteit" (groen/neutraal, geen badge) of "uit oude bron" (gele waarschuwing).
- Nieuwe pagina `pages/instellingen/kwaliteiten.tsx`:
  - TanStack Query `useKwaliteitenMetGewicht`.
  - Kolommen + filters zoals beschreven.
  - Inline edit met `useUpdateKwaliteitGewicht` mutation.
  - Banner bovenaan: "X van Y kwaliteiten hebben nog geen gewicht ingevuld".
- Route toevoegen aan router-config.
- Navigatie-item onder Instellingen.
- Integreer `<GewichtBronBadge>` in `pages/producten/product-detail.tsx` naast huidige gewicht-veld.

**Verifieerbaar:** klik door naar `/instellingen/kwaliteiten`, edit een gewicht, zie product-detail van een product in die kwaliteit live updaten (via TanStack invalidatie).

### Issue D — Python-import-script

**Doel:** Piet-Heins Excel landen in Supabase.

**Taken:**
- `import/import_kwaliteit_gewichten.py` — leest Excel uit `brondata/voorraad/` (exact pad zodra Excel beschikbaar is). Verwacht kolommen `kwaliteit_code` en `gewicht_per_m2_kg`.
- UPSERT op `kwaliteit_code` — `ON CONFLICT (code) DO UPDATE SET gewicht_per_m2_kg = EXCLUDED.gewicht_per_m2_kg WHERE kwaliteiten.gewicht_per_m2_kg IS DISTINCT FROM EXCLUDED.gewicht_per_m2_kg`. Voorkomt onnodige trigger-cascades.
- Dry-run-flag: print eerst aantal rijen die zouden veranderen.
- Bewaar pad-conventie consistent met andere import-scripts (`supabase_import.py`-stijl).

**Verifieerbaar:** dry-run laat verwacht aantal updates zien. Echte run + spot-check op 3 kwaliteiten in instellingen-pagina.

### Issue E — Migratie 186: cutover + cleanup

**Doel:** schoon eindplaatje na alle bovenstaande issues.

**Taken:**
- Hard reset: `UPDATE order_regels SET gewicht_kg = bereken_orderregel_gewicht_kg(id) WHERE order_id IN (SELECT id FROM orders WHERE status NOT IN ('Verzonden','Geannuleerd','Klaar voor verzending'))`.
- `ALTER TABLE maatwerk_m2_prijzen DROP COLUMN gewicht_per_m2_kg`.
- Verifieer dat geen RPC of view nog `mw_m2_prijzen.gewicht_per_m2_kg` leest (grep + test).
- Vereenvoudig `create_zending_voor_order` (mig 176/177 — refactor in nieuwe migratie): vervang `COALESCE(ore.gewicht_kg, p.gewicht_kg, 0)` door `COALESCE(ore.gewicht_kg, 0)` — orderregel-cache is nu altijd verse waarde.
- Update `docs/database-schema.md` (drop kolom, gewicht-resolver-functies in `Functies`-sectie).
- Update `docs/architectuur.md` met bedrijfsregel "Gewicht-bron: één waarheid op kwaliteit, gederiveerd op product/orderregel via gewicht-resolver".
- Update `docs/changelog.md`.
- Update `docs/data-woordenboek.md` met de termen uit de sectie "Domeinwoordenboek-toevoegingen".

**Verifieerbaar:** zending-aanmaak op test-order produceert correct `totaal_gewicht_kg`. HST-payload bevat correcte `weightKg`. Geen verwijzingen meer naar gedropte kolom.

### Issue F — ADR (optioneel, alleen als reviewer twijfelt)

**Doel:** vastleggen waarom gewicht-density per kwaliteit en niet per (kwaliteit+kleur) of per artikelnr.

Indien gewenst: `docs/adr/0003-gewicht-bron-op-kwaliteit-niveau.md` met de beslissing en reden ("kleur-pigment-gewicht-verschil verwaarloosbaar; per-artikelnr-override leidt tot data-puinhoop bij maat-varianten van zelfde tapijt"). Niet blokkerend voor implementatie.

## Risico's

- **Trigger-fanout bij massa-Excel-import:** UPSERT van 1000 kwaliteiten → cascadeert naar duizenden producten en order_regels. Mitigatie: WHERE-clause in UPSERT (`IS DISTINCT FROM`) voorkomt no-op updates; Excel-import in één transactie zodat triggers één keer aan einde firen.
- **Onparseerbare karpi-codes:** producten zonder `(\d{3})(\d{3})$` patroon krijgen NULL `lengte_cm`/`breedte_cm` → cache blijft op legacy. Acceptabel voor V1; rapport in migratie-output.
- **Performance van trigger-cascade op 'Wacht op inkoop'-orders:** open orders kunnen lang openstaan. Mitigatie: index op `orders.status` is al aanwezig; herrekening doet alleen UPDATE waar oude ≠ nieuw.
- **HST-API gevoeligheid:** als `weightKg` NULL blijft (kwaliteit nog niet gevuld), HST-call kan falen. Mitigatie: bestaande fallback `p.gewicht_kg` blijft werken via legacy-waarde + `gewicht_uit_kwaliteit=false`-flag → niet stilletjes NULL.

## Niet-doelen

- Gewicht per kleur of per artikelnr-override (uit grill-vraag 1 + 2).
- Gewicht voor `product_type IN ('rol','overig')` automatiseren (V1-scope).
- Facturen krijgen een gewicht-veld (geen functioneel doel).
- Webshop-import (Lightspeed) gewicht-mapping wijzigen — die blijft uit shop-payload komen, snapshots overlappen niet.
- UI om gewicht handmatig per product te overschrijden (botst met "niet per maat").

## Acceptatiecriteria (functioneel)

- [ ] `kwaliteiten.gewicht_per_m2_kg` is gevuld voor minstens de top-50 kwaliteiten op basis van openstaande orderregels.
- [ ] `/instellingen/kwaliteiten` toont alle 997 kwaliteiten, inline-edit werkt, audit-log toont wijzigingen.
- [ ] Een nieuwe maatwerk-orderregel krijgt automatisch `gewicht_kg` zonder dat de frontend de berekening doet.
- [ ] Een nieuwe vaste-product-orderregel idem.
- [ ] Wijzigen van een kwaliteit-gewicht herrekent open `order_regels` zichtbaar binnen één seconde.
- [ ] HST-payload toont correct `weightKg` voor een test-zending.
- [ ] Producten met `gewicht_uit_kwaliteit = false` tonen badge in product-detail.
- [ ] `maatwerk_m2_prijzen.gewicht_per_m2_kg` is gedropt; geen view of RPC verwijst er nog naar.
