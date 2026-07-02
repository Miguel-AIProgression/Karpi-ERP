# Order-intake-verdieping: Order-commit-pipeline + Order-landing-kern — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development of superpowers:executing-plans per fase. Fase 1 en Fase 2 verdienen elk een eigen detailplan vóór uitvoering (writing-plans Scope Check); dit document legt de geverifieerde bevindingen, de besluiten en de fasering vast.

**Goal:** De order-aanmaak verdiepen tot twee diepe modules — de pure TS **Order-commit**-pipeline (form-orkestratie testbaar maken) en de SQL **Order-landing**-kern (drie RPC's worden adapters op één invarianten-dragende kern) — zónder gedragsverandering en zonder de drie RPC-signaturen te raken.

**Architecture:** zie CONTEXT.md-termen **Intake-kanaal**, **Order-landing**, **Order-commit** (toegevoegd 2026-06-10). De kanalen blijven bezitter van hun bron-specifieke vertaling (GLN-ladder, prijsbepaling, afleverdatum-strategie, verzendregel-bron); de kern bezit de invarianten (nummering, idempotency, regel-kolommenset, status/event-seeding, snapshot-fallback).

**Tech Stack:** Supabase/PostgreSQL (migraties handmatig via SQL Editor — MCP heeft geen toegang tot Karpi), React/TS + Vitest, Deno edge functions.

---

## Geverifieerde bevindingen (onderzoek 2026-06-10, 3 agents + handverificatie)

1. **De gedeelde kern bestaat al half — in triggers.** Allocatie (`trg_orderregel_herallocateer` → `herallocateer_orderregel`, mig 146), `levertijd_status`-afleiding (mig 276) en product-reservering-sync vuren op élk insert-pad. Claims/allocatie zijn dus niet gedupliceerd; de divergentie zit in de RPC-bodies.
2. **Live gap gevonden en gefixt (Fase 0):** `create_webshop_order` (mig 322) dropte `maatwerk_vorm` stilletjes uit de regel-JSON (JSONB geeft geen fout op onbekende sleutels) → webshop-maatwerk landde zonder vorm, snijplan ging van rechthoek uit. Mig 343 (branch `fix/webshop-maatwerk-vorm`) fixt dit met gevalideerde lookup.
3. **Divergentie-kaart RPC-bodies** (volledige matrix in het onderzoeksverslag van de sessie):
   - Idempotency-guard: EDI ✓, webshop ✓, **`create_order_with_lines` ✗** (dubbelklik = dubbele order).
   - Debiteur-snapshot in SQL: alleen EDI (incl. GLN-ladder); webshop/form vertrouwen op de caller.
   - Regel-kolommen: EDI 9, webshop 16 (na mig 343 17), form 31 — drie verschillende subsets van dezelfde tabel.
   - Status-seeding: webshop roept `herbereken_wacht_status` expliciet; EDI/form vertrouwen op de trigger-keten.
4. **Zes gedocumenteerde incidenten** (gewicht ×1000, Shopify fallback-debiteur, maatwerk_vorm, EDI-afleveradres, header-only orders, betaaltermijn) zitten allemaal in de klasse "gedupliceerde logica of overgeslagen invariant per pad".
5. **Collisie-constraints:** `create_edi_order`-signatuur is bevroren — de productie-only-import (mig 329, Python) roept hem aan. Migratienummer **342 is al dubbel geclaimd** (`342_bug_meldingen` op `feat/feedback-bug-tool` én `342_assert_status_enum_snapshot` op `refactor/snijplan-status-enum`) — verifieer nummers bij elke fase-start en bump.

## Besluiten (eigenaar, 2026-06-10)

1. **maatwerk_vorm-gap: direct gefixt** (Fase 0, mig 343 — klaar voor toepassing + merge).
2. **Vangnet: zelf-testende migraties** (mig 333/340-patroon, `DO $$ … RAISE EXCEPTION $$`) — geen harness-eerst. Consequentie: SQL-zelf-tests zijn definitie-/fixture-niveau, geen volledige characterization; daarom extra klein faseren (één invariant per migratie) en de TS-golden-fixtures van Fase 1 als gedrags-anker gebruiken.
3. **Kern-scope: maximaal** — óók debiteur-/adres-snapshot-fallback in de kern. **Semantiek vastgelegd:** aangeleverde waarden winnen altijd; de DB-lookup vult alleen ontbrekende `fact_*`/`afl_*`-velden (zoals EDI nu al doet). Dit behoudt de form-override van afleveradressen als feature.
4. **Gedragsverbeteringen zijn aparte, bewuste stappen** — geen stiekeme bijvangst: (a) idempotency voor het form-pad, (b) uniform `'aangemaakt'`-event. Elk krijgt een eigen go/no-go in Fase 2.

## Fasering

| Fase | Inhoud | Branch | Status / gate |
|---|---|---|---|
| **0** | maatwerk_vorm-fix (mig 343) | `fix/webshop-maatwerk-vorm` | **Klaar** — wacht op SQL-Editor-toepassing + merge-commando |
| **1** | Order-commit-pipeline (TS, kandidaat 2) | `refactor/order-commit-pipeline` (eigen worktree) | Onafhankelijk van Fase 2; eerst detailplan |
| **2** | Order-landing-kern (SQL, kandidaat 1, maximaal) | `refactor/order-landing-kern` (eigen worktree) | Na Fase 1 (golden fixtures = gedrags-anker); eerst detailplan; nummer-check bij start |

---

## Fase 0 — maatwerk_vorm (UITGEVOERD 2026-06-10)

- [x] Mig 343 geschreven: `create_webshop_order` body verbatim mig 322 + `maatwerk_vorm`-insert, gevalideerd tegen `maatwerk_vormen(code)` (onbekend → NULL, geen FK-fout — order blijft altijd landen). Zelf-test: definitie bevat lookup + de drie TS-codes (`rond`/`ovaal`/`organisch_a`) bestaan in de tabel.
- [x] Changelog-entry + commit `8218045` op `fix/webshop-maatwerk-vorm` (worktree `C:/Users/migue/Documents/karpi-webshop-maatwerk-vorm`).
- [ ] **Eigenaar:** mig 343 draaien in de Supabase SQL Editor (verwacht: `NOTICE: Mig 343: alle asserties geslaagd`).
- [ ] **Eigenaar:** "merge naar main"-commando geven.
- [ ] Verificatie ná de eerstvolgende webshop-maatwerkorder met vorm: `SELECT order_nr, artikelnr, maatwerk_vorm FROM order_regels r JOIN orders o ON o.id=r.order_id WHERE o.bron_systeem IN ('shopify','lightspeed') AND r.is_maatwerk ORDER BY r.id DESC LIMIT 10;`

## Fase 1 — Order-commit-pipeline (kandidaat 2)

**Doel:** de orkestratie in `saveMutation.mutationFn` ([order-form.tsx](../../../frontend/src/components/orders/order-form.tsx), create-flow ~r366-450) — dekking → split-keuze → verzend-toewijzing → lever_modus → claims-volgorde — als pure functie `bouwOrderCommit(input) → OrderCommitPlan`, met golden fixtures die het huidige gedrag vastpinnen vóór de form omgaat.

**Aanpak (gedrag-behoud kritisch):**
1. **Fixtures eerst (RED):** `frontend/src/lib/orders/__tests__/order-commit.test.ts` + golden-JSON per scenario, afgeleid uit de huidige saveMutation-takken: (a) deelleveringen + gemengd maatwerk/standaard-split, (b) IO-tekort-split bij lever_modus='deelleveringen' (sub-orders krijgen 'in_een_keer' — bestaand gedrag, pinnen!), (c) géén split, (d) verzend-tie naar deel A, (e) admin-pseudo-regels (geskipt in dekking), (f) spoed-regel aanwezig.
2. `frontend/src/lib/orders/order-commit.ts`: pure `bouwOrderCommit({regels, header, client, dekkingPerRegel, leverModusKeuze, afleverdatums}) → {orders: [{header, regels}], gesplitst}` — hergebruikt `wijsVerzendNaarDuurste` + `splitRegelOpDekking` (slice 3) als interne bouwstenen.
3. Form herbedraden: `mutationFn` = `bouwOrderCommit` aanroepen → plan uitvoeren (per order `createOrder`, dan `persistUitwisselbaarKeuzes` + `triggerAutoplanForMaatwerk`). Geen logica-wijziging, alleen verplaatsing.
4. **Edit-flow blijft ongemoeid** (geen split-detectie — bestaande, gedocumenteerde divergentie; apart beslispunt).
5. Verificatie: `npm run typecheck` + `npx vitest run src/lib/orders/__tests__/order-commit.test.ts` + handmatige smoke (1 gemengde order in de UI).

## Fase 2 — Order-landing-kern (kandidaat 1, maximaal)

**Per invariant één migratie, elk zelf-testend; adapters behouden hun signatuur.**

1. **Stap A — regel-insert-superset:** interne functie `_land_order_regels(p_order_id, p_regels JSONB)` met de volledige 31-kolommenset (form-niveau, mig 275) + gevalideerde lookups (vorm-patroon van mig 343). Drie vervolg-migraties laten elk pad hem aanroepen (EDI → webshop → form, één per migratie). Zelf-test per migratie: definitie-asserties + fixture-JSONB door de functie in een rollback-blok waar zonder side-effects mogelijk. *Lost de "subset-drop"-klasse categorisch op: nieuwe `order_regels`-kolom = één plek.*
2. **Stap B — header-landing:** `_land_order_header(p_kanaal, p_header JSONB, p_opties)` bezit nummering (`volgend_nummer`), optionele idempotency-key (form-pad geeft er geen door = huidig gedrag), gates-defaults (`debiteur_zeker` e.d.) én **snapshot-fallback** (besluit 3: aangeleverd wint, DB vult gaten — EDI's bestaande gedrag wordt de kern-semantiek).
3. **Stap C — status/event-seeding uniform:** allen via expliciete `herbereken_wacht_status` (zoals webshop nu). **Klein gedragsverschil voor EDI/form** (event-rij verschijnt waar die nu uit de trigger-keten komt) — bewust go/no-go-moment.
4. **Stap D — adapters versimpelen:** `create_edi_order` houdt GLN-ladder + prijsladder en delegeert landing; idem webshop/form. Signaturen byte-voor-byte gelijk (productie-only-import!).
5. **Aparte besluiten (niet stilzwijgend meenemen):** form-idempotency (client-submit-token), uniform `'aangemaakt'`-event.

**Gates Fase 2:** na Fase 1 (fixtures als anker); migratienummers verifiëren (`ls supabase/migrations | tail`) — 342 is al dubbel geclaimd; coördineer met `feat/productie-only-import` als die nog open staat.

## Open bevindingen uit testorder ORD-2026-0118 (Piet-Hein, 2026-06-10, Shopify)

Drie pre-existing gaten in het Shopify-intake-pad, zichtbaar geworden bij het live-testen van mig 343 (vorm landde correct; deze drie niet door mig 343 gedekt). Elk is een los shipbare adapter-fix; diagnose-queries staan in de sessie van 2026-06-10:

1. **Dubbele regels per tapijt** — de Shopify-customizer stuurt vermoedelijk per tapijt een weergave-item + een "Selections"-companion-item; `buildRegels` (sync-shopify-order) importeert beide als losse orderregel → dubbele snijplannen/allocatie. **Eerst payload-bewijs** (`externe_payloads`-query op order 0118), dan companion-detectie/merge in `buildRegels`.
2. **€ 0,00-orders** — `buildRegels` negeert `item.price` (wat de klant betaalde) en vertrouwt op `haalKlantPrijs`, die voor ongematcht maatwerk `null` geeft → niet-factureerbare order. Ontwerpkeuze: voor B2C-Shopify is de betaalde prijs de orderprijs (fallback- of primair-bron). Raakt ook het rode raw-SKU-als-artikelnr-symptoom (553139998).
3. **"Geen snijplan" op maatwerk mét getoonde afmetingen** — `auto_maak_snijplan` (mig 328) vereist `is_maatwerk + lengte + breedte`; UI toonde maten maar geen snijplannen. Diagnose nodig (regel-query op 0118): staan de maten écht in de DB (→ trigger-probleem) of niet (→ parsing-gat, UI toont maten uit andere bron)?

## Bewust buiten scope

- Kanaal-specifieke logica unificeren (GLN-matching, afleverdatum-strategieën, verzendregel-bronnen, split-op-dekking) — dat is adapter-werk, bewust divers.
- `update_order_with_lines`/edit-flow-split — eigen beslispunt.
- SQL-integratie-test-harness — staat in het allocator-harness-plan (2026-06-09); zodra dat gebouwd is, krijgen de kern-functies daar characterization-fixtures bij.
