# Logistiek — HST API-koppeling implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatisch een TransportOrder bij vervoerder HST aanmaken zodra een zending de status "Klaar voor verzending" krijgt; track-trace en API-respons terug-loggen op de zending. Per debiteur configureerbaar welke vervoerder gebruikt wordt.

**Architectuur:** Adapter-pattern per vervoerder met **single switch-point** in plpgsql. Géén gegeneraliseerde `vervoerder_berichten`-queue: HST krijgt z'n eigen tabel `hst_transportorders` met HST-specifieke kolommen (`extern_transport_order_id`, `request_payload`, `response_payload`, `response_http_code`, retry/status-fields). Eén switch-RPC `enqueue_zending_naar_vervoerder(p_zending_id)` dispatcht op basis van `vervoerder_code` naar de adapter-RPC (`enqueue_hst_transportorder` voor HST; later `enqueue_edi_verzendbericht` voor Rhenus/Verhoek dat in bestaande `edi_berichten` schrijft). Trigger op zending kent dus geen vervoerders — hij roept alleen de switch aan. Nieuwe `vervoerders`-tabel houdt routing-keuze; `edi_handelspartner_config.vervoerder_code` legt vervoerder-keuze per debiteur vast. Zendingen-tabel wordt voor het eerst werkelijk aangemaakt (staat al in `database-schema.md` maar zonder migratie). Verticale folder `supabase/functions/hst-send/` bevat alle HST-specifieke files (payload-builder, HTTP-client, types, fixtures) — géén HST-types in `_shared/`. Edge function claimt uit `hst_transportorders`, doet HTTP Basic-auth POST naar HST, schrijft respons + tracking terug. Cron elke minuut.

**Tech Stack:** PostgreSQL (Supabase) met RLS + RPC's, Deno edge functions (TypeScript), HTTP Basic Auth, React 19 + TanStack Query, Vitest/Deno test.

---

## 1. Achtergrond

Karpi schakelt over van het oude Windows-systeem naar RugFlow. Onderdeel daarvan is de transport-koppeling. Karpi verzendt met **drie vervoerders**:

1. **HST** — REST API (deze plan)
2. **Rhenus** — EDI (apart plan, volgt later)
3. **Verhoek** — EDI (apart plan, volgt later)

Bron-mail: `Mail van Ai Progression - FW_ Nieuwe koppeling HST portaal.pdf` (2026-05-01).

HST-credentials voor de **acceptatie-omgeving** (pre-productie) zijn al door HST verstrekt:

```
API endpoint:   https://accp.hstonline.nl/rest/api/v1/TransportOrder
Username:       <Supabase Vault: HST_API_USERNAME — opvragen bij Wilfred / 1Password>
Wachtwoord:     <Supabase Vault: HST_API_WACHTWOORD — opvragen bij Wilfred / 1Password>
CustomerID:     <Supabase Vault: HST_API_CUSTOMER_ID — opvragen bij Wilfred / 1Password>
Web-portaal:    https://accp.hstonline.nl  (login + wachtwoord uit 1Password — niet committen)
Documentatie:   https://accp.hstonline.nl/restdoc/rest/api/v1#/   (geeft 404 zonder auth — handmatig in browser openen)
```

De productie-credentials volgen ná de cutover; voor dit plan werken we volledig op de ACCP-omgeving. HST heeft Wilfred een test-payload geleverd via een aparte attachment — die moeten we opvragen of als deel van Fase 0 uit het web-portaal halen.

### Naast-API-eisen die HST stelt

Uit de mail van Thom ten Brinke (2026-02-26): de **fysieke etiketten** die wij op de pakketten plakken moeten voor HST scanbaar zijn (barcode + depotnummer rechtsboven). Het etiket-voorbeeld toont een SSCC-barcode beginnend met `00 08715954444628200015` (SSCC-18 op basis van Karpi-GLN `8715954999998`). **Etiket-printflow zit niet in dit plan** — die volgt in fase 2 van de Logistiek-module. Voor de eerste cutover gebruiken we de etiketten die Karpi al print uit het oude systeem.

### Bestaande EDI-pattern als studie-object — bewust niet kopiëren

[`supabase/migrations/156_edi_handelspartner_config.sql`](../../../supabase/migrations/156_edi_handelspartner_config.sql) en [`157_edi_berichten.sql`](../../../supabase/migrations/157_edi_berichten.sql) zijn een verleidelijk template ("vervoerder-berichten" lijken sterk op "edi-berichten"), maar we **vermijden de kopieer-en-generaliseer-val**:

- `edi_berichten` is al de plek voor EDI-verkeer richting elke partner — inclusief het `'verzendbericht'`-berichttype dat Rhenus/Verhoek straks gaan gebruiken (DESADV).
- HST is geen EDI; HST is REST. Forceren in een gegeneraliseerde `vervoerder_berichten`-tabel zou een shallow abstractie zijn waarvan de kolomvorm (JSONB-payload, generieke retry, tekstuele extern_id) bijna net zoveel ruimte vraagt als de implementaties zelf.
- **Deletion-test:** als een hypothetische `vervoerder_berichten`-tabel werd weggehaald, zou complexiteit voor de twee EDI-vervoerders niet toenemen — die zit al in `edi_berichten`. Alleen HST-complexiteit zou ergens heen moeten — naar een eigen tabel. Dat doen we dus meteen.
- **Eén switch-RPC** (`enqueue_zending_naar_vervoerder`) als enige plek waar de vervoerder-typeswitch zit. Alle andere code (trigger, frontend, edge function) is vervoerder-blind óf vervoerder-specifiek — geen tussenlaag.

---

## 2. Doelen / non-doelen

### Doelen (in scope voor dit plan)

- `zendingen` + `zending_regels` tabel-migratie aanmaken zoals beschreven in [`docs/database-schema.md:413-436`](../../database-schema.md#L413-L436), inclusief enum `zending_status`.
- `vervoerders` tabel met 3 zaad-rijen (puur routing-lookup, géén berichten erin).
- `edi_handelspartner_config.vervoerder_code` kolom (NULL = nog te kiezen).
- `hst_transportorders` HST-specifieke queue/audit-tabel met HST-eigen kolommen (request/response/http_code/extern_id/retry/status).
- HST-specifieke RPC's: `enqueue_hst_transportorder`, `claim_volgende_hst_transportorder`, `markeer_hst_verstuurd`, `markeer_hst_fout`.
- **Switch-RPC** `enqueue_zending_naar_vervoerder(p_zending_id)` die op basis van `vervoerder_code` de juiste adapter-RPC aanroept. Voor HST: `enqueue_hst_transportorder`. Bij Rhenus/Verhoek (later): `enqueue_edi_verzendbericht` (schrijft naar `edi_berichten`).
- Edge function `hst-send` die een TransportOrder bij HST aanmaakt en respons + tracking terugschrijft.
- Trigger op `zendingen.status` → roept `enqueue_zending_naar_vervoerder` aan wanneer status overgaat naar **"Klaar voor verzending"**. Trigger weet niets van HST/EDI-onderscheid.
- Logistiek-pagina `/logistiek` met (a) zendingen-overzicht filterable op vervoerder + status, (b) detail-view met API-payload + respons, (c) handmatige "verstuur opnieuw"-knop voor `Fout`-status.
- Klant-detail-tab "Vervoerder" voor het instellen van `vervoerder_code` per debiteur, parallel aan de bestaande EDI-tab.
- Vitest/Deno-tests op de payload-builder met fixtures uit Fase 0.
- Documentatie-update in `docs/database-schema.md`, `docs/architectuur.md`, `docs/changelog.md`.

### Non-doelen (expliciet niet in dit plan)

- ❌ EDI-koppeling met Rhenus en Verhoek — aparte plans.
- ❌ Etiket/SSCC-print-flow — fase 2 van de logistiek-module.
- ❌ Tracking-status pull (HST → ons) — fase 2; we slaan alleen het bij creatie ontvangen `transportOrderId` en eventuele `trackingNumber` op.
- ❌ Annuleren of wijzigen van transportorders (PUT/DELETE) — fase 2; eerste pilot doet alleen creates.
- ❌ Productie-credentials activeren — gehele plan draait op ACCP. Cutover-plan voor productie volgt apart.
- ❌ Pick & Ship-uitbreiding (welke pakketten/colli-info per zending) — die input-data komt later uit de Pick & Ship module ([`2026-05-01-pick-ship-samenvoegen.md`](2026-05-01-pick-ship-samenvoegen.md)). Voor dit plan zijn `aantal_colli` en `totaal_gewicht_kg` handmatig invulbaar op de zending.
- ❌ Multi-zending-per-order-flow met deelleveringen-routing — V1 ondersteunt 1 zending per order voor de HST-pilot.
- ❌ Het automatisch zetten van `orders.status = 'Klaar voor verzending'` — die transitie blijft handmatig via order-detail (zoals nu); wij reageren slechts op de zending-status.

### Aannames die in plan-review bevestigd moeten worden

1. **Trigger-bron is `zendingen.status`, niet `orders.status`.** Reden: één order kan in V2 in meerdere zendingen splitsen en de levermomenten verschillen dan; de zending is de werkelijke fysieke eenheid die HST ophaalt.
2. **`vervoerder_code`-keuze is per debiteur, niet per zending.** Reden: in het oude systeem werd dat ook zo gedaan. Voor uitzonderingen (eenmalig andere vervoerder voor één zending) kan in fase 2 een per-zending override worden toegevoegd.
3. **Zending-aanmaak gebeurt in V1 handmatig** vanuit een nog te bouwen knop op order-detail ("Maak zending aan") of via een Pick & Ship-actie. **Dit plan bouwt die knop**: bij `orders.status='Klaar voor verzending'` verschijnt op order-detail een knop "Zending aanmaken" die één `zendingen`-rij + bijbehorende `zending_regels` aanmaakt en de zending direct op status `Klaar voor verzending` zet (= HST-trigger).
4. **Authenticatie:** HTTP Basic met username:password als Supabase secrets (`HST_API_USERNAME`, `HST_API_WACHTWOORD`, `HST_API_BASE_URL`, `HST_API_CUSTOMER_ID`). Zelfde patroon als `TRANSUS_CLIENT_ID/KEY` in `supabase/functions/.env.example`.
5. **Cron-frequentie:** elke minuut (idem `transus-send`).
6. **Idempotentie:** uniek-index op `(berichttype='transportorder', bron_tabel='zendingen', bron_id)` voor actieve statussen — exact zoals `edi_berichten`.

---

## 3. Architectuur-overzicht

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

> **Verticale slicing**: alle HST-specifieke files leven in [`supabase/functions/hst-send/`](../../../supabase/functions/hst-send/) (payload-builder, HTTP-client, types, fixtures). De enige cross-vervoerder-laag is de switch-RPC `enqueue_zending_naar_vervoerder` — daar wordt **eenmaal** een type-keuze gemaakt. Toekomstige vervoerder = nieuwe adapter-tabel + adapter-RPC + extra `WHEN`-tak in de switch.

---

## 4. File Structure

### Create

**Database (migrations/):**

- `supabase/migrations/169_zendingen_tabel.sql` — zending_status enum + zendingen + zending_regels + zending_nr-sequentie + RLS + updated_at-trigger.
- `supabase/migrations/170_vervoerders_tabel.sql` — vervoerders tabel + 3 zaad-rijen + `edi_handelspartner_config.vervoerder_code` kolom + FK.
- `supabase/migrations/171_hst_transportorders.sql` — hst_transportorder_status enum + `hst_transportorders` HST-eigen tabel + HST-specifieke RPC's (`enqueue_hst_transportorder`, `claim_volgende_hst_transportorder`, `markeer_hst_verstuurd`, `markeer_hst_fout`) + RLS.
- `supabase/migrations/172_zending_trigger.sql` — `create_zending_voor_order` RPC + `enqueue_zending_naar_vervoerder` switch-RPC + `trg_zending_klaar_voor_verzending` AFTER INSERT/UPDATE trigger.

**Edge function (verticale slice):**

- `supabase/functions/hst-send/index.ts` — entry-point edge function (cron / HTTP-trigger), orchestratie.
- `supabase/functions/hst-send/payload-builder.ts` — bouwt TransportOrder JSON uit `zendingen`-row + `bedrijfsgegevens` + debiteur-snapshot. Pure functie.
- `supabase/functions/hst-send/payload-builder.test.ts` — Deno test op payload-builder met fixture uit Fase 0.
- `supabase/functions/hst-send/hst-client.ts` — `postTransportOrder()` Basic-auth wrapper.
- `supabase/functions/hst-send/types.ts` — HST-specifieke TS-types (`HstTransportOrderPayload`, `HstResponse`, `ZendingInput`, `OrderInput`, `BedrijfInput`). **Niet** in `_shared/` — dit is verticale slice, types horen bij hun caller.
- `supabase/functions/hst-send/fixtures/example-transportorder-request.json` (uit Fase 0).
- `supabase/functions/hst-send/fixtures/example-transportorder-response.json` (uit Fase 0).

**Frontend module:**

- `frontend/src/modules/logistiek/index.ts` — barrel-export.
- `frontend/src/modules/logistiek/registry.ts` — vervoerder-display-data (`VERVOERDER_REGISTRY`).
- `frontend/src/modules/logistiek/queries/zendingen.ts` — `fetchZendingen`, `fetchZendingMetTransportorders`, `verstuurZendingOpnieuw`.
- `frontend/src/modules/logistiek/queries/vervoerder-config.ts` — `fetchKlantVervoerderConfig`, `upsertKlantVervoerderConfig`.
- `frontend/src/modules/logistiek/hooks/use-zendingen.ts` — TanStack Query wrappers.
- `frontend/src/modules/logistiek/hooks/use-vervoerder-config.ts` — TanStack Query wrappers.
- `frontend/src/modules/logistiek/pages/zendingen-overzicht.tsx` — tabel + filters.
- `frontend/src/modules/logistiek/pages/zending-detail.tsx` — detail + transportorder-historie + opnieuw-versturen-knop. Toont JSON-payloads inline via `<pre>{JSON.stringify(...)}</pre>` — geen aparte payload-viewer-component.
- `frontend/src/modules/logistiek/components/vervoerder-tag.tsx` — gekleurde badge (HST blauw, EDI-A oranje, EDI-B paars, Geen grijs).
- `frontend/src/modules/logistiek/components/zending-status-badge.tsx`.
- `frontend/src/components/klanten/klant-vervoerder-tab.tsx` — per-debiteur vervoerder-keuze in klant-detail.
- `frontend/src/components/orders/zending-aanmaken-knop.tsx` — knop op order-detail die `create_zending_voor_order` aanroept.

**Documentatie:**

- (geen nieuwe docs — alleen updates aan bestaande, zie "Modify".)

### Modify

- `frontend/src/router.tsx` — `/logistiek` route → `<ZendingenOverzichtPage />`; nieuwe `/logistiek/:zending_nr` route → `<ZendingDetailPage />`. Verwijder `<PlaceholderPage>`.
- `frontend/src/lib/utils/constants.ts:118-126` — sidebar groep "Operationeel" → "Logistiek" sub-items: `Zendingen` + `Vervoerders` (deze laatste opent klanten-overzicht gefilterd op vervoerder-config-status).
- `frontend/src/pages/klanten/klant-detail.tsx` — voeg tab "Vervoerder" toe naast bestaande tabs (Algemeen, EDI, Adressen, etc).
- `frontend/src/pages/orders/order-detail.tsx` — voeg `<ZendingAanmakenKnop />` toe in actie-balk wanneer `order.status === 'Klaar voor verzending'` én er nog geen actieve zending bestaat.
- `supabase/functions/.env.example` — voeg `HST_API_USERNAME`, `HST_API_WACHTWOORD`, `HST_API_BASE_URL`, `HST_API_CUSTOMER_ID` toe.
- `docs/database-schema.md` — wijzig sectie "zendingen" en "zending_regels" om aan te geven dat ze nu echt bestaan (verwijder eventuele "gepland"-noten); voeg secties toe voor `vervoerders` en `hst_transportorders`; voeg enum-waarden `zending_status` en `hst_transportorder_status` toe.
- `docs/architectuur.md` — sectie "Logistiek-module" toevoegen met diagram (kopieer uit sectie 3 hierboven).
- `docs/changelog.md` — entry per migratie.

### Delete

- Niets.

---

## 5. Design-besluiten (vastgelegd)

1. **Geen gegeneraliseerde `vervoerder_berichten`-tabel — per vervoerder/protocol z'n eigen tabel.** HST krijgt `hst_transportorders`. EDI-vervoerders (Rhenus, Verhoek) hergebruiken straks de bestaande `edi_berichten`-tabel met `berichttype='verzendbericht'` (DESADV) — die plek bestaat al sinds migratie 157. Reden: een gegeneraliseerde queue-tabel met JSONB-payload + tekstuele extern_id zou *shallow* zijn (interface bijna net zo complex als implementatie) terwijl de twee EDI-koppelingen hun eigen pattern al hebben. Premature abstraction: bij N=1 (HST) bouw je geen seam. **Locality:** alles wat HST-specifiek is staat in HST-tabel + HST-folder.

2. **Eén switch-RPC `enqueue_zending_naar_vervoerder` als single-point voor type-dispatch.** PL/pgSQL leest `vervoerder_code` en routeert naar de juiste adapter-RPC (`enqueue_hst_transportorder` voor HST; later `enqueue_edi_verzendbericht` voor Rhenus/Verhoek). Reden: een switch-op-type bestaat nu eenmaal in iedere multi-protocol routing-laag — concentreer die op één plek (één plpgsql-functie van ~30 regels) i.p.v. te versmeren over trigger + edge functions + frontend. Bij vervoerder #4 voeg je één `WHEN`-tak toe en je weet zeker dat je niets vergeet.

3. **Vervoerder-keuze als kolom op `edi_handelspartner_config`, niet aparte tabel.** Dat veld heet weliswaar `edi_*`, maar functioneel is het de "logistieke handelspartner-configuratie". In een latere refactor kan het hernoemd worden naar `handelspartner_config`. Voor nu: één tabel, één rij per debiteur, alle koppeling-toggles bij elkaar. NULL = "vervoerder nog niet gekozen".

4. **Vervoerders-tabel als enum-light.** Lookup-tabel i.p.v. PostgreSQL-enum omdat we per vervoerder metadata nodig hebben (display-naam, kleur, type). Migratie 170 zaait 3 rijen: `hst_api`, `edi_partner_a` (placeholder), `edi_partner_b` (placeholder). De plans voor Rhenus/Verhoek activeren hun rij; in dit plan staan beiden op `actief=false`.

5. **Verticale folder per vervoerder.** Alle HST-files leven in [`supabase/functions/hst-send/`](../../../supabase/functions/hst-send/) — payload-builder, HTTP-client, types, fixtures. Géén HST-types in `_shared/` (dat zou de gedeelde laag vervuilen voor één caller). `_shared/` blijft alleen voor wat werkelijk door meerdere edge functions wordt gebruikt (Supabase-client-factory). Bij toekomstige Rhenus-vertical: nieuwe map `supabase/functions/rhenus-send/` met dezelfde interne structuur.

6. **`zending_status`-enum precies zoals docs/database-schema.md:810** beschrijven: `Gepland, Picken, Ingepakt, Klaar voor verzending, Onderweg, Afgeleverd`. Trigger reageert op transitie naar `Klaar voor verzending`.

7. **`zending_nr`-formaat:** `ZEND-2026-0001` via bestaande `volgend_nummer('ZEND')`-RPC; lazy sequence-create.

8. **HST `referenceNumber` = `zending_nr`** (niet `order_nr`), zodat HST per zending een unieke ref heeft. Het webportaal toont referenceNumber, dus dit is wat de Karpi-medewerker bij vragen naar HST opzoekt.

9. **`customerReference` = `order_nr`** als secundair veld (HST-payload heeft beide referentie-velden — Wilfred bevestigt na Fase 0).

10. **Payload-builder is puur** (input: ZendingInput + BedrijfInput + OrderInput → output: `HstTransportOrderPayload`). Geen DB-toegang, geen secrets, alleen data-mapping. Dat maakt unit-testing met fixtures triviaal — interface = test-surface.

11. **Edge function gebruikt niet `Deno.serve` als webhook**, maar wordt door cron aangeroepen. Volgt structuur van `transus-send`: Bearer-CRON_TOKEN-header, loop tot N records of timeout, retourneer summary-JSON.

12. **Geen `payload-viewer.tsx`-component.** `<pre>{JSON.stringify(payload, null, 2)}</pre>` direct in `zending-detail.tsx`. Pas extracteren bij tweede call-site of bij syntax-highlighting-behoefte. **Deletion-test:** een ge-extracteerde wrapper rond `JSON.stringify` is shallow — interface bijna net zo complex als implementatie.

13. **Bestanden klein.** Max 250 regels per bestand. `hst-send/index.ts` zou onder 100 regels moeten zitten — alleen orchestratie.

14. **TDD waar zinvol.** Payload-builder, switch-RPC en trigger-gedrag krijgen tests met fixtures. UI-componenten en HTTP-client krijgen geen tests in V1 (consistent met rest van project).

15. **Commits klein en frequent**, conform `feedback_git_workflow.md`. Direct op `codex/prijslijsten` of een nieuwe `feature/logistiek-hst` branch — bevestigen aan begin Fase 1.

16. **Documentatie bijwerken aan eind van iedere fase**, niet pas helemaal achteraf — anders raakt de schema-doc en architectuur-doc voor de zoveelste keer achter.

---

## 6. Tasks

> **Conventie:** elke taak heeft (a) `Files`-blok met exact te creëren/wijzigen paden, (b) checkbox-stappen 2-5 minuten elk, (c) commando + verwacht resultaat, (d) commit als laatste stap. **Stop na elke fase voor review.**

---

### Fase 0 — API-discovery (geen code)

> **Doel:** voordat we ook maar één byte code schrijven, weten we exact welk JSON-schema HST verwacht en welke respons ze teruggeven. Resultaat: een fixture in `supabase/functions/hst-send/fixtures/` die de basis vormt voor de Deno-tests in Fase 2.

#### Task 0.1: HST API-documentatie ophalen

**Files:**
- Create: `docs/logistiek/hst-api/openapi.json` (of `swagger.json`, afhankelijk van wat HST beschikbaar stelt)
- Create: `docs/logistiek/hst-api/README.md`

- [ ] **Stap 1:** Open `https://accp.hstonline.nl/restdoc/rest/api/v1#/` in een browser (eventueel ingelogd via web-portaal eerst). Sla de OpenAPI/Swagger JSON op via "Download" of via Network-tab → kopieer naar `docs/logistiek/hst-api/openapi.json`.

- [ ] **Stap 2:** Schrijf in `docs/logistiek/hst-api/README.md`:
  - Endpoint-overzicht (POST/GET/PUT/DELETE per resource).
  - Authenticatiemethode (verifieer of het Basic of bv. OAuth is — Niek zei username+password dus Basic, maar de OpenAPI is leidend).
  - Required vs optional velden voor `POST /TransportOrder`.
  - Response-schema voor 200 (welk veld bevat het transportOrderId? welk veld bevat eventueel tracking?).
  - Error-response-shape (4xx/5xx body).

- [ ] **Stap 3:** Commit
  ```bash
  git add docs/logistiek/hst-api/
  git commit -m "docs(logistiek): hst api openapi-spec + readme uit acceptatieomgeving"
  ```

#### Task 0.2: Live curl-test tegen ACCP — happy path

**Files:**
- Create: `docs/logistiek/hst-api/curl-tests.md` (cmd-history + responses)
- Create: `supabase/functions/hst-send/fixtures/example-transportorder-request.json`
- Create: `supabase/functions/hst-send/fixtures/example-transportorder-response.json`

- [ ] **Stap 1:** Vraag bij Wilfred / Niek de bijgevoegde "test-payload" op die HST aan Wilfred heeft geleverd (mail 2026-03-02 14:20). Sla die payload op als `fixtures/example-transportorder-request.json`. Als die niet beschikbaar is: stel een minimale payload op puur op basis van de OpenAPI required-velden uit Task 0.1.

- [ ] **Stap 2:** POST de payload naar HST ACCP via curl:
  ```bash
  # Exporteer eerst HST_API_WACHTWOORD uit Supabase Vault (of 1Password) — NIET inline plakken / committen.
  curl -X POST 'https://accp.hstonline.nl/rest/api/v1/TransportOrder' \
    -u "$HST_API_USERNAME:$HST_API_WACHTWOORD" \
    -H 'Content-Type: application/json' \
    -d @supabase/functions/hst-send/fixtures/example-transportorder-request.json \
    -v
  ```
  Verwacht: HTTP 200 of 201 met body bevattende een `transportOrderId` (of soortgelijk veld).

- [ ] **Stap 3:** Sla de response op als `fixtures/example-transportorder-response.json`. Documenteer in `curl-tests.md`:
  - Exact request (incl. headers behalve auth)
  - Exact response (incl. status-code en headers)
  - Tijd in ms
  - Welk veld in de response is het tracking-/order-ID?

- [ ] **Stap 4:** Verifieer in het web-portaal `https://accp.hstonline.nl` (login + wachtwoord uit 1Password/Vault — niet hier inplakken) dat de testorder zichtbaar is. Maak een screenshot in `docs/logistiek/hst-api/screenshots/`.

- [ ] **Stap 5:** Commit
  ```bash
  git add supabase/functions/hst-send/fixtures/ docs/logistiek/hst-api/
  git commit -m "test(logistiek): hst transportorder curl-rondreis op ACCP geslaagd"
  ```

#### Task 0.3: Negative-path probes

**Files:**
- Modify: `docs/logistiek/hst-api/curl-tests.md` (extra secties)

- [ ] **Stap 1:** Probeer bewust drie foute requests en log de responses:
  1. Verkeerde Basic-auth (foute wachtwoord) → 401?
  2. Lege body → 400?
  3. Verplicht veld weglaten → welke error-shape?

- [ ] **Stap 2:** Documenteer in `curl-tests.md` welke retry-strategie zinvol is per status-code (401 = niet retryen; 5xx = wel retryen; 400 = niet retryen, markeer Fout).

- [ ] **Stap 3:** Commit
  ```bash
  git add docs/logistiek/hst-api/curl-tests.md
  git commit -m "docs(logistiek): hst api error-paden voor retry-strategie"
  ```

#### **🛑 Review-checkpoint na Fase 0**

> Toon de live-API-fixtures aan Miguel. Bevestig: payload-shape, response-shape, retry-strategie. Pas de aannames in sectie 2 aan indien nodig. **Pas dán door naar Fase 1.**

---

### Fase 1 — Database-schema

#### Task 1.1: Zendingen-tabel + zending_regels (migratie 169)

**Files:**
- Create: `supabase/migrations/169_zendingen_tabel.sql`

- [ ] **Stap 1:** Schrijf de migratie. Sjabloon:

  ```sql
  -- Migratie 169: zendingen + zending_regels
  --
  -- Eerste werkelijke materialisatie van de zendingen-tabel (stond al in
  -- docs/database-schema.md beschreven, was nog nooit aangemaakt). Bron-van-waarheid
  -- voor de logistieke flow: één rij per fysieke zending naar een afleveradres.
  -- Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md
  --
  -- Idempotent.

  -- Status-enum
  DO $$ BEGIN
    CREATE TYPE zending_status AS ENUM (
      'Gepland',
      'Picken',
      'Ingepakt',
      'Klaar voor verzending',
      'Onderweg',
      'Afgeleverd'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  -- Hoofd-tabel
  CREATE TABLE IF NOT EXISTS zendingen (
    id                 BIGSERIAL PRIMARY KEY,
    zending_nr         TEXT NOT NULL UNIQUE,            -- ZEND-2026-0001
    order_id           BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    status             zending_status NOT NULL DEFAULT 'Gepland',
    verzenddatum       DATE,
    track_trace        TEXT,                            -- HST-tracking-nummer of EDI-equivalent
    -- Adres-snapshot (kopie van orders.afl_*; voor de eventuele uitzondering dat
    -- één order naar verschillende adressen splitst in V2)
    afl_naam           TEXT,
    afl_adres          TEXT,
    afl_postcode       TEXT,
    afl_plaats         TEXT,
    afl_land           TEXT,
    -- Pakket-info (handmatig in V1, later via Pick & Ship)
    totaal_gewicht_kg  NUMERIC,
    aantal_colli       INTEGER,
    opmerkingen        TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_zendingen_order ON zendingen (order_id);
  CREATE INDEX IF NOT EXISTS idx_zendingen_status ON zendingen (status);

  -- Regels-tabel
  CREATE TABLE IF NOT EXISTS zending_regels (
    id              BIGSERIAL PRIMARY KEY,
    zending_id      BIGINT NOT NULL REFERENCES zendingen(id) ON DELETE CASCADE,
    order_regel_id  BIGINT REFERENCES order_regels(id) ON DELETE SET NULL,
    artikelnr       TEXT REFERENCES producten(artikelnr),
    rol_id          BIGINT REFERENCES rollen(id),
    aantal          INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_zending_regels_zending ON zending_regels (zending_id);

  -- updated_at-trigger op zendingen
  CREATE OR REPLACE FUNCTION set_zendingen_updated_at() RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_zendingen_updated_at ON zendingen;
  CREATE TRIGGER trg_zendingen_updated_at
    BEFORE UPDATE ON zendingen
    FOR EACH ROW EXECUTE FUNCTION set_zendingen_updated_at();

  -- Geen nummering-seed nodig: volgend_nummer('ZEND') lazy-creëert de sequence
  -- `zend_2026_seq` bij eerste aanroep — zie migratie 116.

  -- RLS (consistent met andere V1-tabellen)
  ALTER TABLE zendingen ENABLE ROW LEVEL SECURITY;
  ALTER TABLE zending_regels ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS zendingen_all ON zendingen;
  CREATE POLICY zendingen_all ON zendingen FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

  DROP POLICY IF EXISTS zending_regels_all ON zending_regels;
  CREATE POLICY zending_regels_all ON zending_regels FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
  ```

- [ ] **Stap 2:** Sanity-check: bevestig dat `volgend_nummer('ZEND')` werkelijk lazy een sequence creëert. Snel verifiëren:
  ```bash
  grep -n "FUNCTION volgend_nummer" supabase/migrations/*.sql
  ```
  Lees de body — de implementatie in migratie 116 doet `nextval(format('%s_%s_seq', lower(prefix), jaar))` met fallback. Zo niet, of als hij een vooraf bestaande `nummering`-rij verwacht: voeg dan alsnog een seed toe met de werkelijke kolomnamen (waarschijnlijk `type, jaar, laatste_nummer`). Anders niets doen — sequence wordt vanzelf aangemaakt.

- [ ] **Stap 3:** Pas migratie toe op lokaal Supabase (of via Supabase MCP). Zie [`reference_karpi_supabase_mcp.md`](../../../C:/Users/migue/.claude/projects/c--Users-migue-Documents-Karpi-ERP/memory/reference_karpi_supabase_mcp.md) — MCP heeft geen toegang tot dit project, dus migratie wordt **handmatig** in Supabase Studio SQL-editor uitgevoerd. Verifieer:
  ```sql
  SELECT volgend_nummer('ZEND'); -- moet 'ZEND-2026-0001' returnen (of soortgelijk)
  INSERT INTO zendingen (zending_nr, order_id, status) VALUES ('TEST-ZEND-1', 1, 'Gepland') RETURNING id;
  DELETE FROM zendingen WHERE zending_nr = 'TEST-ZEND-1';
  ```

- [ ] **Stap 4:** Update `docs/database-schema.md` regels 413–436: vervang "Gepland concept" door werkelijk schema (kolom-types matchen). Voeg regel `created_at, updated_at` toe.

- [ ] **Stap 5:** Update `docs/changelog.md` met entry:
  ```markdown
  ## 2026-05-01 — Migratie 169: zendingen-tabel
  Eerste werkelijke materialisatie van zendingen + zending_regels (stond al in schema-doc, maar nog nooit aangemaakt). Voorbereiding op logistiek-module HST API-koppeling.
  ```

- [ ] **Stap 6:** Commit
  ```bash
  git add supabase/migrations/169_zendingen_tabel.sql docs/database-schema.md docs/changelog.md
  git commit -m "feat(zendingen): mig 169 — zendingen + zending_regels tabellen"
  ```

#### Task 1.2: Vervoerders-tabel + vervoerder-keuze-kolom (migratie 170)

**Files:**
- Create: `supabase/migrations/170_vervoerders_tabel.sql`

- [ ] **Stap 1:** Schrijf migratie:

  ```sql
  -- Migratie 170: vervoerders + per-debiteur vervoerderkeuze
  -- Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md

  CREATE TABLE IF NOT EXISTS vervoerders (
    code           TEXT PRIMARY KEY,                  -- 'hst_api', 'edi_partner_a', etc.
    display_naam   TEXT NOT NULL,                     -- 'HST', 'Rhenus', 'Verhoek'
    type           TEXT NOT NULL CHECK (type IN ('api', 'edi')),
    actief         BOOLEAN NOT NULL DEFAULT FALSE,    -- pas TRUE als koppeling werkt
    notities       TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  COMMENT ON TABLE vervoerders IS
    'Beschikbare vervoerders. code wordt als FK gebruikt op edi_handelspartner_config.vervoerder_code.';

  -- Zaai 3 rijen
  INSERT INTO vervoerders (code, display_naam, type, actief, notities) VALUES
    ('hst_api',        'HST',     'api', FALSE, 'REST API. Auth via Basic. Plan 2026-05-01.'),
    ('edi_partner_a',  'Rhenus',  'edi', FALSE, 'EDI — placeholder, plan volgt.'),
    ('edi_partner_b',  'Verhoek', 'edi', FALSE, 'EDI — placeholder, plan volgt.')
  ON CONFLICT (code) DO NOTHING;

  -- updated_at trigger
  CREATE OR REPLACE FUNCTION set_vervoerders_updated_at() RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_vervoerders_updated_at ON vervoerders;
  CREATE TRIGGER trg_vervoerders_updated_at
    BEFORE UPDATE ON vervoerders
    FOR EACH ROW EXECUTE FUNCTION set_vervoerders_updated_at();

  -- Per-debiteur keuze: kolom op edi_handelspartner_config
  ALTER TABLE edi_handelspartner_config
    ADD COLUMN IF NOT EXISTS vervoerder_code TEXT REFERENCES vervoerders(code);

  COMMENT ON COLUMN edi_handelspartner_config.vervoerder_code IS
    'Welke vervoerder gebruikt deze debiteur? NULL = nog niet gekozen / handmatige flow. '
    'Bij wisseling van waarde wordt geen automatische re-routing van openstaande zendingen '
    'gedaan — alleen nieuwe zendingen volgen de nieuwe waarde.';

  CREATE INDEX IF NOT EXISTS idx_edi_handelspartner_vervoerder
    ON edi_handelspartner_config (vervoerder_code)
    WHERE vervoerder_code IS NOT NULL;

  -- RLS
  ALTER TABLE vervoerders ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS vervoerders_all ON vervoerders;
  CREATE POLICY vervoerders_all ON vervoerders FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
  ```

- [ ] **Stap 2:** Apply en verifieer:
  ```sql
  SELECT * FROM vervoerders;             -- 3 rijen
  \d edi_handelspartner_config           -- vervoerder_code-kolom aanwezig
  ```

- [ ] **Stap 3:** Update `docs/database-schema.md`: voeg sectie "vervoerders" toe; voeg kolom toe aan `edi_handelspartner_config`-sectie.

- [ ] **Stap 4:** Commit
  ```bash
  git add supabase/migrations/170_vervoerders_tabel.sql docs/database-schema.md
  git commit -m "feat(logistiek): mig 170 — vervoerders + per-debiteur keuze"
  ```

#### Task 1.3: HST-transportorders tabel + HST-RPCs (migratie 171)

**Files:**
- Create: `supabase/migrations/171_hst_transportorders.sql`

- [ ] **Stap 1:** Schrijf de migratie. **Bewust HST-specifiek** — geen gegeneraliseerde `vervoerder_berichten`. Adapter-pattern: deze tabel + RPC's vormen de HST-adapter-implementatie.

  ```sql
  -- Migratie 171: hst_transportorders + HST-specifieke RPC's
  -- Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md
  --
  -- HST-adapter-implementatie. Bevat alleen wat HST nodig heeft:
  -- request/response JSONB, HTTP-statuscode, HST extern transportOrderId, retry.
  -- Géén berichttype-discriminator (alle rijen zijn transportorders).
  -- Géén vervoerder_code (deze tabel ÍS HST).
  -- Toekomstige Rhenus/Verhoek (EDI) hergebruiken bestaande edi_berichten met
  -- berichttype='verzendbericht' — geen wijziging aan deze tabel.

  -- Status-enum
  DO $$ BEGIN
    CREATE TYPE hst_transportorder_status AS ENUM (
      'Wachtrij',     -- nog te versturen
      'Bezig',        -- claim_volgende_hst_transportorder heeft 'm gepakt
      'Verstuurd',    -- HST gaf 200 + transportOrderId
      'Fout',         -- retry_count >= max
      'Geannuleerd'   -- handmatig geblokkeerd
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  CREATE TABLE IF NOT EXISTS hst_transportorders (
    id                          BIGSERIAL PRIMARY KEY,
    -- Onze koppeling
    zending_id                  BIGINT NOT NULL REFERENCES zendingen(id) ON DELETE CASCADE,
    debiteur_nr                 INTEGER REFERENCES debiteuren(debiteur_nr),
    -- Status
    status                      hst_transportorder_status NOT NULL DEFAULT 'Wachtrij',
    -- HST-specifieke externe correlatie
    extern_transport_order_id   TEXT,            -- HST.transportOrderId uit response
    extern_tracking_number      TEXT,            -- HST.trackingNumber uit response (mogelijk)
    -- Payloads
    request_payload             JSONB,           -- door builder gevuld bij claim of bij enqueue
    response_payload            JSONB,
    response_http_code          INTEGER,
    -- Foutbehandeling
    retry_count                 INTEGER NOT NULL DEFAULT 0,
    error_msg                   TEXT,
    -- Test-flag (acceptatie-omgeving)
    is_test                     BOOLEAN NOT NULL DEFAULT FALSE,
    -- Timestamps
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at                     TIMESTAMPTZ,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_hst_to_status
    ON hst_transportorders (status);
  CREATE INDEX IF NOT EXISTS idx_hst_to_zending
    ON hst_transportorders (zending_id);
  CREATE INDEX IF NOT EXISTS idx_hst_to_debiteur
    ON hst_transportorders (debiteur_nr, created_at DESC);

  -- Idempotentie: één actieve transportorder per zending.
  -- Bij Fout/Geannuleerd valt de rij buiten de index — retry via verstuurZendingOpnieuw
  -- moet de oude rij eerst op Geannuleerd zetten (zie verstuurZendingOpnieuw in Task 3.1).
  CREATE UNIQUE INDEX IF NOT EXISTS uk_hst_to_zending_actief
    ON hst_transportorders (zending_id)
    WHERE status NOT IN ('Fout', 'Geannuleerd');

  COMMENT ON TABLE hst_transportorders IS
    'HST-adapter: één rij per transportorder die naar HST is/wordt verstuurd. '
    'HST-specifiek (geen multi-vervoerder-abstractie). EDI-vervoerders gebruiken '
    'edi_berichten. Plan: 2026-05-01-logistiek-hst-api-koppeling.md.';

  -- updated_at-trigger
  CREATE OR REPLACE FUNCTION set_hst_to_updated_at() RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_hst_to_updated_at ON hst_transportorders;
  CREATE TRIGGER trg_hst_to_updated_at
    BEFORE UPDATE ON hst_transportorders
    FOR EACH ROW EXECUTE FUNCTION set_hst_to_updated_at();

  ALTER TABLE hst_transportorders ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS hst_to_all ON hst_transportorders;
  CREATE POLICY hst_to_all ON hst_transportorders FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

  -- ============================================================================
  -- HST-adapter RPC's
  -- ============================================================================

  -- enqueue_hst_transportorder: HST-adapter-RPC. Wordt aangeroepen door
  -- enqueue_zending_naar_vervoerder (mig 172) als vervoerder_code='hst_api'.
  CREATE OR REPLACE FUNCTION enqueue_hst_transportorder(
    p_zending_id   BIGINT,
    p_debiteur_nr  INTEGER,
    p_is_test      BOOLEAN DEFAULT FALSE
  ) RETURNS BIGINT AS $$
  DECLARE
    v_id BIGINT;
  BEGIN
    INSERT INTO hst_transportorders (zending_id, debiteur_nr, status, is_test)
         VALUES (p_zending_id, p_debiteur_nr, 'Wachtrij', p_is_test)
    ON CONFLICT (zending_id) WHERE status NOT IN ('Fout', 'Geannuleerd')
    DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

  GRANT EXECUTE ON FUNCTION enqueue_hst_transportorder(BIGINT, INTEGER, BOOLEAN) TO authenticated;

  COMMENT ON FUNCTION enqueue_hst_transportorder IS
    'HST-adapter: plaatst transportorder op wachtrij. Idempotent — als al een '
    'actieve rij voor de zending bestaat, no-op. Request_payload wordt pas '
    'gebouwd door de edge function bij claim (zo blijft data bij verzending vers).';

  -- claim_volgende_hst_transportorder
  CREATE OR REPLACE FUNCTION claim_volgende_hst_transportorder()
  RETURNS hst_transportorders AS $$
  DECLARE
    v_row hst_transportorders;
  BEGIN
    UPDATE hst_transportorders
       SET status = 'Bezig'
     WHERE id = (
       SELECT id FROM hst_transportorders
        WHERE status = 'Wachtrij'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING * INTO v_row;
    RETURN v_row;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

  GRANT EXECUTE ON FUNCTION claim_volgende_hst_transportorder() TO authenticated;

  -- markeer_hst_verstuurd: na 200-respons. Schrijft tracking terug op zending.
  CREATE OR REPLACE FUNCTION markeer_hst_verstuurd(
    p_id                          BIGINT,
    p_extern_transport_order_id   TEXT,
    p_extern_tracking_number      TEXT,
    p_request_payload             JSONB,
    p_response_payload            JSONB,
    p_response_http_code          INTEGER
  ) RETURNS VOID AS $$
  DECLARE
    v_zending_id BIGINT;
  BEGIN
    UPDATE hst_transportorders
       SET status = 'Verstuurd',
           extern_transport_order_id = p_extern_transport_order_id,
           extern_tracking_number = p_extern_tracking_number,
           request_payload = p_request_payload,
           response_payload = p_response_payload,
           response_http_code = p_response_http_code,
           sent_at = now(),
           error_msg = NULL
     WHERE id = p_id
     RETURNING zending_id INTO v_zending_id;

    -- Tracking + status doorzetten naar zending
    IF v_zending_id IS NOT NULL THEN
      UPDATE zendingen
         SET track_trace = COALESCE(p_extern_tracking_number, p_extern_transport_order_id),
             status = CASE
               WHEN status = 'Klaar voor verzending' THEN 'Onderweg'::zending_status
               ELSE status
             END
       WHERE id = v_zending_id;
    END IF;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

  GRANT EXECUTE ON FUNCTION markeer_hst_verstuurd(BIGINT, TEXT, TEXT, JSONB, JSONB, INTEGER) TO authenticated;

  -- markeer_hst_fout: retry tot max_retries
  CREATE OR REPLACE FUNCTION markeer_hst_fout(
    p_id              BIGINT,
    p_error           TEXT,
    p_request_payload JSONB DEFAULT NULL,
    p_response_payload JSONB DEFAULT NULL,
    p_response_http_code INTEGER DEFAULT NULL,
    p_max_retries     INTEGER DEFAULT 3
  ) RETURNS VOID AS $$
  DECLARE
    v_huidige_retry INTEGER;
  BEGIN
    SELECT retry_count INTO v_huidige_retry FROM hst_transportorders WHERE id = p_id;

    UPDATE hst_transportorders
       SET retry_count = retry_count + 1,
           error_msg = p_error,
           request_payload = COALESCE(p_request_payload, request_payload),
           response_payload = p_response_payload,
           response_http_code = p_response_http_code,
           status = CASE
             WHEN v_huidige_retry + 1 >= p_max_retries THEN 'Fout'::hst_transportorder_status
             ELSE 'Wachtrij'::hst_transportorder_status
           END
     WHERE id = p_id;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

  GRANT EXECUTE ON FUNCTION markeer_hst_fout(BIGINT, TEXT, JSONB, JSONB, INTEGER, INTEGER) TO authenticated;
  ```

- [ ] **Stap 2:** Apply en verifieer dat alle 4 HST-functies bestaan:
  ```sql
  SELECT proname FROM pg_proc WHERE proname LIKE '%hst%' ORDER BY proname;
  ```
  Verwacht: `claim_volgende_hst_transportorder`, `enqueue_hst_transportorder`, `markeer_hst_fout`, `markeer_hst_verstuurd`, `set_hst_to_updated_at`.

- [ ] **Stap 3:** Smoke-test handmatig (vereist een bestaande zending — gebruik test-row uit Task 1.1 stap 3 of maak nieuwe):
  ```sql
  -- Pak een willekeurige zending of maak er één
  INSERT INTO zendingen (zending_nr, order_id, status) VALUES ('TEST-ZEND-2', 1, 'Gepland') RETURNING id;
  -- Stel je krijgt id = X

  SELECT enqueue_hst_transportorder( <X>, 169130, FALSE);
  SELECT * FROM claim_volgende_hst_transportorder();  -- moet rij returnen, status='Bezig'

  -- Cleanup
  DELETE FROM hst_transportorders WHERE zending_id = <X>;
  DELETE FROM zendingen WHERE id = <X>;
  ```

- [ ] **Stap 4:** Update `docs/database-schema.md`: nieuwe sectie "hst_transportorders" + RPC-lijst onder die sectie. Vermeld in algemene kop dat dit de HST-adapter is en dat EDI-vervoerders straks `edi_berichten` hergebruiken.

- [ ] **Stap 5:** Commit
  ```bash
  git add supabase/migrations/171_hst_transportorders.sql docs/database-schema.md
  git commit -m "feat(logistiek): mig 171 — hst_transportorders + adapter rpcs"
  ```

#### Task 1.4: Switch-RPC + zending-trigger + create_zending_voor_order (migratie 172)

**Files:**
- Create: `supabase/migrations/172_zending_trigger.sql`

- [ ] **Stap 1:** Schrijf migratie. Kernpunt: `enqueue_zending_naar_vervoerder` is **single-point-of-dispatch** — de enige plek in de hele codebase waar een keuze op `vervoerder_code` wordt gemaakt.

  ```sql
  -- Migratie 172: switch-RPC + zending-trigger + create_zending_voor_order
  -- Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md

  -- ============================================================================
  -- create_zending_voor_order: maakt 1 zending + zending_regels aan voor 1 order.
  -- Wordt aangeroepen vanuit "Zending aanmaken"-knop op order-detail.
  -- Idempotent: als er al een actieve zending voor de order bestaat, returnt die.
  -- ============================================================================
  CREATE OR REPLACE FUNCTION create_zending_voor_order(
    p_order_id BIGINT
  ) RETURNS BIGINT AS $$
  DECLARE
    v_zending_id BIGINT;
    v_zending_nr TEXT;
    v_order      orders%ROWTYPE;
  BEGIN
    SELECT id INTO v_zending_id FROM zendingen
     WHERE order_id = p_order_id
       AND status NOT IN ('Afgeleverd')
     ORDER BY id DESC LIMIT 1;
    IF v_zending_id IS NOT NULL THEN
      RETURN v_zending_id;
    END IF;

    SELECT * INTO v_order FROM orders WHERE id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
    END IF;

    v_zending_nr := volgend_nummer('ZEND');

    INSERT INTO zendingen (
      zending_nr, order_id, status,
      afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
      verzenddatum
    ) VALUES (
      v_zending_nr, p_order_id, 'Klaar voor verzending',
      v_order.afl_naam, v_order.afl_adres, v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
      CURRENT_DATE
    )
    RETURNING id INTO v_zending_id;

    INSERT INTO zending_regels (zending_id, order_regel_id, artikelnr, aantal)
    SELECT v_zending_id, ore.id, ore.artikelnr, ore.aantal
      FROM order_regels ore
     WHERE ore.order_id = p_order_id
       AND ore.aantal > 0;

    RETURN v_zending_id;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

  GRANT EXECUTE ON FUNCTION create_zending_voor_order(BIGINT) TO authenticated;

  COMMENT ON FUNCTION create_zending_voor_order IS
    'Maakt één zending + zending_regels voor één order. Idempotent. Status direct op '
    '"Klaar voor verzending" zodat trg_zending_klaar_voor_verzending meteen vuurt.';

  -- ============================================================================
  -- enqueue_zending_naar_vervoerder: SINGLE SWITCH-POINT.
  -- Enige plek waar op vervoerder_code wordt gedispatched. Alle andere code
  -- (trigger, edge function, frontend) is vervoerder-blind óf vervoerder-specifiek.
  -- ============================================================================
  CREATE OR REPLACE FUNCTION enqueue_zending_naar_vervoerder(
    p_zending_id BIGINT
  ) RETURNS TEXT AS $$
  DECLARE
    v_order_id        BIGINT;
    v_debiteur_nr     INTEGER;
    v_vervoerder_code TEXT;
    v_actief          BOOLEAN;
    v_is_test         BOOLEAN := FALSE;
  BEGIN
    -- Zending → order → debiteur → vervoerder_code
    SELECT z.order_id, o.debiteur_nr
      INTO v_order_id, v_debiteur_nr
      FROM zendingen z JOIN orders o ON o.id = z.order_id
     WHERE z.id = p_zending_id;
    IF v_debiteur_nr IS NULL THEN RETURN 'no_debiteur'; END IF;

    SELECT vervoerder_code INTO v_vervoerder_code
      FROM edi_handelspartner_config
     WHERE debiteur_nr = v_debiteur_nr;
    IF v_vervoerder_code IS NULL THEN RETURN 'no_vervoerder_gekozen'; END IF;

    SELECT actief INTO v_actief FROM vervoerders WHERE code = v_vervoerder_code;
    IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

    -- DISPATCH naar adapter-RPC. Dit is de enige plaats waar deze switch leeft.
    -- Toekomstige vervoerder = nieuwe WHEN-tak hier.
    CASE v_vervoerder_code
      WHEN 'hst_api' THEN
        PERFORM enqueue_hst_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
        RETURN 'enqueued_hst';

      -- WHEN 'edi_partner_a' THEN
      --   PERFORM enqueue_edi_verzendbericht(...);
      --   RETURN 'enqueued_edi';
      --
      -- (komt in plan voor Rhenus/Verhoek; nu alleen HST geactiveerd)

      ELSE
        RAISE NOTICE 'Vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
        RETURN 'no_adapter_voor_' || v_vervoerder_code;
    END CASE;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

  GRANT EXECUTE ON FUNCTION enqueue_zending_naar_vervoerder(BIGINT) TO authenticated;

  COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
    'SWITCH-POINT: dispatcht een zending naar de adapter-RPC van de gekoppelde '
    'vervoerder. Enige plek in de codebase waar op vervoerder_code wordt geswitcht. '
    'Returnt een textuele status (enqueued_hst, no_vervoerder_gekozen, etc.) — '
    'niet voor controle-flow gebruikt door callers, alleen voor logging/debugging. '
    'Bij toekomstige vervoerder: voeg WHEN-tak toe.';

  -- ============================================================================
  -- Trigger op zendingen: alleen op transitie naar 'Klaar voor verzending'.
  -- Trigger weet niets over HST of EDI. Roept alleen de switch-RPC aan.
  -- ============================================================================
  CREATE OR REPLACE FUNCTION fn_zending_klaar_voor_verzending() RETURNS TRIGGER AS $$
  BEGIN
    IF NEW.status <> 'Klaar voor verzending' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'Klaar voor verzending' THEN RETURN NEW; END IF;

    PERFORM enqueue_zending_naar_vervoerder(NEW.id);
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

  DROP TRIGGER IF EXISTS trg_zending_klaar_voor_verzending ON zendingen;
  CREATE TRIGGER trg_zending_klaar_voor_verzending
    AFTER INSERT OR UPDATE OF status ON zendingen
    FOR EACH ROW EXECUTE FUNCTION fn_zending_klaar_voor_verzending();
  ```

- [ ] **Stap 2:** Apply.

- [ ] **Stap 3:** Test handmatig in Studio SQL:
  ```sql
  -- Activeer hst_api en koppel aan een test-debiteur
  UPDATE vervoerders SET actief = TRUE WHERE code = 'hst_api';
  INSERT INTO edi_handelspartner_config (debiteur_nr, vervoerder_code)
       VALUES (169130, 'hst_api')
  ON CONFLICT (debiteur_nr) DO UPDATE SET vervoerder_code = 'hst_api';

  -- Pak een bestaande order van debiteur 169130
  SELECT id, order_nr FROM orders WHERE debiteur_nr = 169130 ORDER BY id DESC LIMIT 5;

  -- Maak zending — trigger moet vuren → switch-RPC → enqueue_hst_transportorder
  SELECT create_zending_voor_order( <order_id> );

  -- Verifieer dat een rij in hst_transportorders is verschenen
  SELECT id, zending_id, status FROM hst_transportorders ORDER BY id DESC LIMIT 1;

  -- Test ook negative path: zonder vervoerder gekozen
  DELETE FROM edi_handelspartner_config WHERE debiteur_nr = 169130;
  -- Maak nieuwe zending → moet GEEN hst_transportorders-rij opleveren
  SELECT create_zending_voor_order( <ander order_id van zelfde debiteur> );
  -- Verifieer geen nieuwe hst_transportorders-rij

  -- Cleanup
  DELETE FROM hst_transportorders WHERE zending_id IN (SELECT id FROM zendingen WHERE order_id IN (<id1>, <id2>));
  DELETE FROM zending_regels WHERE zending_id IN (SELECT id FROM zendingen WHERE order_id IN (<id1>, <id2>));
  DELETE FROM zendingen WHERE order_id IN (<id1>, <id2>);
  UPDATE vervoerders SET actief = FALSE WHERE code = 'hst_api';
  ```

- [ ] **Stap 4:** Commit
  ```bash
  git add supabase/migrations/172_zending_trigger.sql
  git commit -m "feat(logistiek): mig 172 — zending-trigger + switch-rpc + create_zending_voor_order"
  ```

#### **🛑 Review-checkpoint na Fase 1**

> Toon de migraties + smoke-test-output. Bevestig dat de queue-flow werkt vóór we de edge function bouwen.

---

### Fase 2 — Edge function `hst-send`

#### Task 2.1: Project-skeleton + secrets

**Files:**
- Create: `supabase/functions/hst-send/index.ts` (skeleton)
- Create: `supabase/functions/hst-send/deno.json` (kopieer van `transus-send/deno.json` als die bestaat, of maak conform Supabase-default)
- Modify: `supabase/functions/.env.example`

- [ ] **Stap 1:** Voeg toe aan `.env.example`:
  ```env
  # HST vervoerder API (acceptatie + productie)
  HST_API_BASE_URL=https://accp.hstonline.nl/rest/api/v1
  HST_API_USERNAME=
  HST_API_WACHTWOORD=
  HST_API_CUSTOMER_ID=
  ```
  (Niet de werkelijke credentials in deze file — leeg laten en in Supabase Vault zetten. ACCP-username, -wachtwoord en -CustomerID staan in 1Password / Vault.)

- [ ] **Stap 2:** Maak `index.ts` skeleton (kopieer structuur van `transus-send/index.ts`):
  ```ts
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const CRON_TOKEN  = Deno.env.get('CRON_TOKEN')!

  const HST_BASE_URL    = Deno.env.get('HST_API_BASE_URL')!
  const HST_USERNAME    = Deno.env.get('HST_API_USERNAME')!
  const HST_WACHTWOORD  = Deno.env.get('HST_API_WACHTWOORD')!
  const HST_CUSTOMER_ID = Deno.env.get('HST_API_CUSTOMER_ID')!

  const MAX_PER_RUN = 25

  Deno.serve(async (req) => {
    if (req.headers.get('Authorization') !== `Bearer ${CRON_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 })
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
    const summary = { processed: 0, succeeded: 0, failed: 0, skipped: 0 }

    for (let i = 0; i < MAX_PER_RUN; i++) {
      const { data: row, error } = await supabase
        .rpc('claim_volgende_hst_transportorder')
        .single()
      if (error || !row?.id) break  // niets meer in de queue
      summary.processed++

      try {
        // TODO: payload-builder + HST-call + markeer_hst_verstuurd → Task 2.2-2.4
        await new Promise((r) => setTimeout(r, 0))
      } catch (e) {
        summary.failed++
        await supabase.rpc('markeer_hst_fout', {
          p_id: row.id,
          p_error: String(e),
        })
      }
    }

    return new Response(JSON.stringify(summary), {
      headers: { 'Content-Type': 'application/json' },
    })
  })
  ```

- [ ] **Stap 3:** Deploy (vereist Supabase CLI):
  ```bash
  supabase functions deploy hst-send --no-verify-jwt
  ```
  Verwacht: deploy-success-bericht.

- [ ] **Stap 4:** Smoke-test (queue moet leeg zijn → summary `{processed:0, ...}`):
  ```bash
  curl -X POST 'https://<project-ref>.supabase.co/functions/v1/hst-send' \
    -H "Authorization: Bearer $CRON_TOKEN"
  ```

- [ ] **Stap 5:** Commit
  ```bash
  git add supabase/functions/hst-send/ supabase/functions/.env.example
  git commit -m "feat(logistiek): hst-send edge function skeleton"
  ```

#### Task 2.2: Payload-builder met Deno-test (verticale slice — alle types lokaal)

**Files:**
- Create: `supabase/functions/hst-send/types.ts` (HST-specifieke TS-types — **niet** in `_shared/`)
- Create: `supabase/functions/hst-send/payload-builder.ts`
- Create: `supabase/functions/hst-send/payload-builder.test.ts`
- Reference: `supabase/functions/hst-send/fixtures/example-transportorder-request.json` (uit Fase 0)

- [ ] **Stap 1:** Schrijf de failing test eerst.

  ```ts
  // supabase/functions/hst-send/payload-builder.test.ts
  import { assertEquals } from 'https://deno.land/std/assert/mod.ts'
  import { bouwTransportOrderPayload } from './payload-builder.ts'
  import expectedFixture from './fixtures/example-transportorder-request.json' with { type: 'json' }

  Deno.test('bouwTransportOrderPayload — happy path matcht HST-fixture', () => {
    const result = bouwTransportOrderPayload({
      zending: {
        zending_nr: 'ZEND-2026-0001',
        afl_naam: 'KNUTZEN TEPPICH-HOF',
        afl_adres: 'OSTERWEIDE 14',
        afl_postcode: '23562',
        afl_plaats: 'LUEBECK',
        afl_land: 'DE',
        totaal_gewicht_kg: 12.5,
        aantal_colli: 1,
        opmerkingen: null,
        verzenddatum: '2026-05-04',
      },
      order: {
        order_nr: 'ORD-2026-0042',
      },
      bedrijf: {
        bedrijfsnaam: 'KARPI BV',
        adres: 'Tweede Broekdijk 10',
        postcode: '7122 LB',
        plaats: 'Aalten',
        land: 'NL',
        telefoon: '+31 (0)543-476116',
        email: 'info@karpi.nl',
      },
      hstCustomerId: '038267',
    })

    // Pas asserties aan op werkelijke shape uit fixture
    assertEquals(result.customerId, '038267')
    assertEquals(result.referenceNumber, 'ZEND-2026-0001')
    assertEquals(result.customerReference, 'ORD-2026-0042')
    assertEquals(result.consignee.name, 'KNUTZEN TEPPICH-HOF')
    assertEquals(result.consignee.country, 'DE')
    assertEquals(result.shipper.name, 'KARPI BV')
    // ... voeg toe wat fixture vereist
  })
  ```

- [ ] **Stap 2:** Run de test → moet falen (`bouwTransportOrderPayload` bestaat niet):
  ```bash
  cd supabase/functions/hst-send
  deno test payload-builder.test.ts
  ```
  Verwacht: FAIL.

- [ ] **Stap 3:** Schrijf `payload-builder.ts`:
  ```ts
  import type { ZendingInput, OrderInput, BedrijfInput, HstTransportOrderPayload }
    from './types.ts'

  export function bouwTransportOrderPayload(args: {
    zending: ZendingInput
    order: OrderInput
    bedrijf: BedrijfInput
    hstCustomerId: string
  }): HstTransportOrderPayload {
    const { zending, order, bedrijf, hstCustomerId } = args
    return {
      customerId: hstCustomerId,
      referenceNumber: zending.zending_nr,
      customerReference: order.order_nr,
      pickupDate: zending.verzenddatum,
      shipper: {
        name: bedrijf.bedrijfsnaam,
        address: bedrijf.adres,
        postalCode: bedrijf.postcode,
        city: bedrijf.plaats,
        country: bedrijf.land === 'Nederland' ? 'NL' : bedrijf.land,
        phone: bedrijf.telefoon,
        email: bedrijf.email,
      },
      consignee: {
        name: zending.afl_naam ?? '',
        address: zending.afl_adres ?? '',
        postalCode: zending.afl_postcode ?? '',
        city: zending.afl_plaats ?? '',
        country: zending.afl_land ?? '',
      },
      packages: [{
        type: 'PARCEL',  // bevestig in Fase 0 of HST een ander codetype gebruikt
        quantity: zending.aantal_colli ?? 1,
        weightKg: zending.totaal_gewicht_kg ?? null,
      }],
      remarks: zending.opmerkingen ?? null,
    }
  }
  ```

- [ ] **Stap 4:** Schrijf de types in `supabase/functions/hst-send/types.ts`:
  ```ts
  export interface ZendingInput {
    zending_nr: string
    afl_naam: string | null
    afl_adres: string | null
    afl_postcode: string | null
    afl_plaats: string | null
    afl_land: string | null
    totaal_gewicht_kg: number | null
    aantal_colli: number | null
    opmerkingen: string | null
    verzenddatum: string | null
  }
  export interface OrderInput { order_nr: string }
  export interface BedrijfInput {
    bedrijfsnaam: string
    adres: string
    postcode: string
    plaats: string
    land: string
    telefoon: string
    email: string
  }
  export interface HstTransportOrderPayload {
    customerId: string
    referenceNumber: string
    customerReference: string
    pickupDate: string | null
    shipper: { name: string; address: string; postalCode: string; city: string; country: string; phone: string; email: string }
    consignee: { name: string; address: string; postalCode: string; city: string; country: string }
    packages: Array<{ type: string; quantity: number; weightKg: number | null }>
    remarks: string | null
  }
  ```

- [ ] **Stap 5:** Run test → moet slagen:
  ```bash
  deno test payload-builder.test.ts
  ```
  Verwacht: PASS.

- [ ] **Stap 6:** **Stem de exact-fixture-shape af op de werkelijke HST OpenAPI-spec uit Fase 0.** Bovenstaande velden zijn een redelijke gok; HST kan andere namen gebruiken (bv. `Address1` i.p.v. `address`). Deze stap is iteratief: pas types aan tot de test groen blijft én de fixture volledig matcht.

- [ ] **Stap 7:** Commit
  ```bash
  git add supabase/functions/hst-send/payload-builder.ts \
          supabase/functions/hst-send/payload-builder.test.ts \
          supabase/functions/hst-send/types.ts
  git commit -m "feat(hst-send): payload-builder met deno-test op fixture"
  ```

#### Task 2.3: HST HTTP-client

**Files:**
- Create: `supabase/functions/hst-send/hst-client.ts`

- [ ] **Stap 1:** Schrijf:
  ```ts
  import type { HstTransportOrderPayload, HstResponse } from './types.ts'

  // HstResponse zit in types.ts — ook daar definiëren als hij er nog niet staat:
  //   export interface HstResponse {
  //     ok: boolean
  //     httpCode: number
  //     body: any
  //     transportOrderId: string | null
  //     trackingNumber: string | null
  //     errorMsg: string | null
  //   }

  export async function postTransportOrder(args: {
    baseUrl: string
    username: string
    wachtwoord: string
    payload: HstTransportOrderPayload
  }): Promise<HstResponse> {
    const { baseUrl, username, wachtwoord, payload } = args
    const auth = btoa(`${username}:${wachtwoord}`)

    const res = await fetch(`${baseUrl}/TransportOrder`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    let body: any = null
    try { body = await res.json() } catch { body = await res.text() }

    return {
      ok: res.ok,
      httpCode: res.status,
      body,
      // Pas onderstaande veld-paden aan op werkelijke HST-respons uit Fase 0
      transportOrderId: res.ok ? (body?.transportOrderId ?? body?.id ?? null) : null,
      trackingNumber: res.ok ? (body?.trackingNumber ?? null) : null,
      errorMsg: res.ok ? null : (body?.message ?? body?.error ?? `HTTP ${res.status}`),
    }
  }
  ```

- [ ] **Stap 2:** Geen unit-test voor `hst-client.ts` (consistent met restant project — HTTP-clients worden integratie-getest via cutover-rondreis in Fase 5).

- [ ] **Stap 3:** Commit
  ```bash
  git add supabase/functions/hst-send/hst-client.ts
  git commit -m "feat(hst-send): basic-auth http-client voor TransportOrder"
  ```

#### Task 2.4: Orchestratie in `index.ts`

**Files:**
- Modify: `supabase/functions/hst-send/index.ts`

- [ ] **Stap 1:** Vervang TODO-blok door echte flow:
  ```ts
  // ... binnen for-loop, na succesvolle claim:

  // Haal context-data op die de payload-builder nodig heeft
  const zending_id = row.zending_id
  const { data: zending } = await supabase
    .from('zendingen').select('*').eq('id', zending_id).single()
  const { data: order } = await supabase
    .from('orders').select('order_nr').eq('id', zending!.order_id).single()
  const { data: bedrijfRow } = await supabase
    .from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single()
  const bedrijf = bedrijfRow!.waarde as any

  const payload = bouwTransportOrderPayload({
    zending: zending!,
    order: order!,
    bedrijf,
    hstCustomerId: HST_CUSTOMER_ID,
  })

  const result = await postTransportOrder({
    baseUrl: HST_BASE_URL,
    username: HST_USERNAME,
    wachtwoord: HST_WACHTWOORD,
    payload,
  })

  if (result.ok) {
    summary.succeeded++
    await supabase.rpc('markeer_hst_verstuurd', {
      p_id: row.id,
      p_extern_transport_order_id: result.transportOrderId,
      p_extern_tracking_number: result.trackingNumber,
      p_request_payload: payload,
      p_response_payload: result.body,
      p_response_http_code: result.httpCode,
    })
  } else {
    summary.failed++
    await supabase.rpc('markeer_hst_fout', {
      p_id: row.id,
      p_error: result.errorMsg ?? 'onbekende fout',
      p_request_payload: payload,
      p_response_payload: result.body,
      p_response_http_code: result.httpCode,
      p_max_retries: 3,
    })
  }
  ```

- [ ] **Stap 2:** Voeg de imports toe boven aan `index.ts`:
  ```ts
  import { bouwTransportOrderPayload } from './payload-builder.ts'
  import { postTransportOrder } from './hst-client.ts'
  ```

- [ ] **Stap 3:** Type-check:
  ```bash
  deno check index.ts
  ```
  Verwacht: geen errors.

- [ ] **Stap 4:** Re-deploy:
  ```bash
  supabase functions deploy hst-send --no-verify-jwt
  ```

- [ ] **Stap 5:** End-to-end smoke-test op ACCP:
  - Activeer in Supabase: `UPDATE vervoerders SET actief = TRUE WHERE code = 'hst_api';`
  - Koppel test-debiteur: `INSERT INTO edi_handelspartner_config (debiteur_nr, vervoerder_code) VALUES (169130, 'hst_api') ON CONFLICT (debiteur_nr) DO UPDATE SET vervoerder_code = 'hst_api';`
  - Maak zending: `SELECT create_zending_voor_order( <een test-order-id> );`
  - Trigger handmatig: `curl -X POST '...' -H "Authorization: Bearer $CRON_TOKEN"`
  - Verwacht in summary: `processed:1, succeeded:1`
  - Verifieer in Supabase: `SELECT * FROM hst_transportorders ORDER BY id DESC LIMIT 1;` → status='Verstuurd', extern_transport_order_id gevuld
  - Verifieer in HST web-portaal: testorder zichtbaar
  - Verifieer in Supabase: `SELECT track_trace FROM zendingen WHERE id = ...;` → gevuld met tracking-nr of transportOrderId
  - **Cleanup:** zet vervoerder weer inactief tot Fase 4 productie-cutover:
    ```sql
    UPDATE vervoerders SET actief = FALSE WHERE code = 'hst_api';
    ```
    Dit voorkomt dat ad-hoc test-zendingen tijdens Fase 3 ongewild naar HST worden gestuurd.

- [ ] **Stap 6:** Commit
  ```bash
  git add supabase/functions/hst-send/index.ts
  git commit -m "feat(hst-send): end-to-end orchestratie — claim, build, post, mark"
  ```

#### Task 2.5: Cron-schedule

**Files:**
- Modify: `supabase/functions/hst-send/index.ts` (cron-comment in header)
- Create of modify: pg_cron migratie (volgt patroon van `transus-send` cron)

- [ ] **Stap 1:** Verifieer of er al een pg_cron entry voor `transus-send` bestaat:
  ```bash
  grep -rn "cron.schedule.*transus-send" supabase/migrations/ supabase/seeds/ 2>/dev/null
  ```

- [ ] **Stap 2:** Maak migratie `173_hst_send_cron.sql` (NUMMERING: stem af op huidige hoogste, dit wordt waarschijnlijk 173):
  ```sql
  -- Migratie 173: pg_cron schedule voor hst-send
  SELECT cron.schedule(
    'hst-send-elke-minuut',
    '* * * * *',
    $$ SELECT net.http_post(
         url := current_setting('app.supabase_url') || '/functions/v1/hst-send',
         headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_token'))
       ) $$
  );
  ```
  > Pas exact-format aan op wat al gebruikt wordt voor `transus-send`. Sommige Supabase-projecten gebruiken expliciete URLs i.p.v. `current_setting`.

- [ ] **Stap 3:** Apply, verifieer:
  ```sql
  SELECT * FROM cron.job WHERE jobname = 'hst-send-elke-minuut';
  ```

- [ ] **Stap 4:** Wacht 1-2 minuten en check `cron.job_run_details` of de invocatie geslaagd is.

- [ ] **Stap 5:** Commit
  ```bash
  git add supabase/migrations/173_hst_send_cron.sql
  git commit -m "feat(hst-send): pg_cron schedule elke minuut"
  ```

#### **🛑 Review-checkpoint na Fase 2**

> Live rondreis op ACCP geslaagd? Een echte zending in HST-portaal? Track-trace teruggekomen? Pas dán door naar Fase 3.

---

### Fase 3 — Frontend logistiek-module

#### Task 3.1: Module-skeleton + queries

**Files:**
- Create: `frontend/src/modules/logistiek/index.ts`
- Create: `frontend/src/modules/logistiek/registry.ts`
- Create: `frontend/src/modules/logistiek/queries/zendingen.ts`
- Create: `frontend/src/modules/logistiek/queries/vervoerder-config.ts`

- [ ] **Stap 1:** Schrijf `registry.ts` (puur display-data — géén berichttypen-registry meer want adapters bepalen zelf wat ze sturen):
  ```ts
  export type VervoerderCode = 'hst_api' | 'edi_partner_a' | 'edi_partner_b'
  export type VervoerderType = 'api' | 'edi'

  export interface VervoerderDef {
    code: VervoerderCode
    displayNaam: string
    type: VervoerderType
    badgeKleur: 'blauw' | 'oranje' | 'paars' | 'grijs'
  }

  export const VERVOERDER_REGISTRY: Record<VervoerderCode, VervoerderDef> = {
    hst_api:        { code: 'hst_api',       displayNaam: 'HST',     type: 'api', badgeKleur: 'blauw'  },
    edi_partner_a:  { code: 'edi_partner_a', displayNaam: 'Rhenus',  type: 'edi', badgeKleur: 'oranje' },
    edi_partner_b:  { code: 'edi_partner_b', displayNaam: 'Verhoek', type: 'edi', badgeKleur: 'paars'  },
  }
  ```

- [ ] **Stap 2:** Schrijf `queries/zendingen.ts`. Voor V1 leest deze module alleen `hst_transportorders` (HST-adapter-tabel). Bij toekomstige Rhenus/Verhoek-vertical wordt hier een tweede query toegevoegd voor `edi_berichten WHERE berichttype='verzendbericht'`.
  ```ts
  import { supabase } from '@/lib/supabase/client'

  export async function fetchZendingen(filters?: { status?: string; debiteur_nr?: number }) {
    let q = supabase.from('zendingen').select(`
      id, zending_nr, status, verzenddatum, track_trace,
      afl_naam, afl_postcode, afl_plaats, afl_land,
      aantal_colli, totaal_gewicht_kg, created_at,
      orders!inner ( id, order_nr, debiteur_nr,
        debiteuren ( debiteur_nr, naam,
          edi_handelspartner_config ( vervoerder_code ) ) ),
      hst_transportorders ( id, status, extern_transport_order_id, extern_tracking_number, sent_at )
    `).order('id', { ascending: false }).limit(200)

    if (filters?.status) q = q.eq('status', filters.status)
    if (filters?.debiteur_nr) q = q.eq('orders.debiteur_nr', filters.debiteur_nr)
    return await q
  }

  export async function fetchZendingMetTransportorders(zending_nr: string) {
    return await supabase.from('zendingen').select(`
      *, orders!inner ( *, debiteuren ( * ) ),
      zending_regels ( * ),
      hst_transportorders ( * )
    `).eq('zending_nr', zending_nr).single()
  }

  export async function verstuurZendingOpnieuw(transportorder_id: number) {
    // Reset Fout-rij naar Wachtrij. Edge case: als er ondertussen al een nieuwe
    // actieve transportorder voor dezelfde zending bestaat, blokkeert
    // uk_hst_to_zending_actief de update. Zet eventuele duplicate eerst op Geannuleerd.
    const { data: huidig } = await supabase.from('hst_transportorders')
      .select('id, zending_id')
      .eq('id', transportorder_id).single()
    if (huidig) {
      await supabase.from('hst_transportorders')
        .update({ status: 'Geannuleerd', error_msg: 'Vervangen door retry van #' + transportorder_id })
        .eq('zending_id', huidig.zending_id)
        .neq('id', transportorder_id)
        .in('status', ['Wachtrij', 'Bezig', 'Verstuurd'])
    }
    return await supabase.from('hst_transportorders')
      .update({ status: 'Wachtrij', error_msg: null, retry_count: 0 })
      .eq('id', transportorder_id)
  }
  ```

- [ ] **Stap 3:** Schrijf `queries/vervoerder-config.ts`:
  ```ts
  import { supabase } from '@/lib/supabase/client'

  export async function fetchKlantVervoerderConfig(debiteur_nr: number) {
    return await supabase.from('edi_handelspartner_config')
      .select('debiteur_nr, vervoerder_code')
      .eq('debiteur_nr', debiteur_nr)
      .maybeSingle()
  }

  export async function upsertKlantVervoerderConfig(
    debiteur_nr: number,
    vervoerder_code: string | null
  ) {
    return await supabase.from('edi_handelspartner_config')
      .upsert({ debiteur_nr, vervoerder_code })
  }
  ```

- [ ] **Stap 4:** Commit
  ```bash
  git add frontend/src/modules/logistiek/
  git commit -m "feat(logistiek): frontend module-skeleton + queries"
  ```

#### Task 3.2: Hooks (TanStack Query wrappers)

**Files:**
- Create: `frontend/src/modules/logistiek/hooks/use-zendingen.ts`
- Create: `frontend/src/modules/logistiek/hooks/use-vervoerder-config.ts`

- [ ] **Stap 1:** Schrijf hooks volgens patroon `frontend/src/modules/edi/hooks/use-edi.ts`. (TanStack `useQuery`/`useMutation` met queryKey-strategy.)

- [ ] **Stap 2:** Commit
  ```bash
  git add frontend/src/modules/logistiek/hooks/
  git commit -m "feat(logistiek): tanstack query hooks"
  ```

#### Task 3.3: Zendingen-overzicht-pagina + components

**Files:**
- Create: `frontend/src/modules/logistiek/pages/zendingen-overzicht.tsx`
- Create: `frontend/src/modules/logistiek/components/vervoerder-tag.tsx`
- Create: `frontend/src/modules/logistiek/components/zending-status-badge.tsx`

- [ ] **Stap 1:** `vervoerder-tag.tsx` — kleine badge die `displayNaam + badgeKleur` toont op basis van `VERVOERDER_REGISTRY`.

- [ ] **Stap 2:** `zending-status-badge.tsx` — kleur per `zending_status`-waarde (zelfde patroon als `order-status-badge.tsx`).

- [ ] **Stap 3:** `zendingen-overzicht.tsx`:
  - Header: "Zendingen"
  - Filter-bar: vervoerder-pillen (Alle / HST / Rhenus / Verhoek / Geen) + status-pillen (Alle / Klaar voor verzending / Onderweg / Afgeleverd)
  - Tabel: zending_nr | order_nr | klant | afl-stad | vervoerder | status | track_trace | aantal_colli | gewicht
  - Klik op rij → `/logistiek/:zending_nr`

- [ ] **Stap 4:** Verifieer in browser (dev-server):
  ```bash
  cd frontend && npm run dev
  ```
  Open `http://localhost:5173/logistiek` — moet bestaande test-zending tonen die in Fase 2 stap 5 is aangemaakt.

- [ ] **Stap 5:** Commit
  ```bash
  git add frontend/src/modules/logistiek/pages/zendingen-overzicht.tsx \
          frontend/src/modules/logistiek/components/
  git commit -m "feat(logistiek): zendingen-overzicht-pagina + badges"
  ```

#### Task 3.4: Zending-detail-pagina

**Files:**
- Create: `frontend/src/modules/logistiek/pages/zending-detail.tsx`

> Géén aparte `payload-viewer.tsx` — JSON inline via `<pre>{JSON.stringify(payload, null, 2)}</pre>`. Een wrapper-component zou shallow zijn (interface bijna net zo complex als implementatie). Pas extracteren bij tweede call-site of bij syntax-highlighting-behoefte.

- [ ] **Stap 1:** `zending-detail.tsx`:
  - Header: zending_nr + status-badge + vervoerder-tag
  - Sectie 1: zending-info (afleveradres, verzenddatum, gewicht, colli, track_trace)
  - Sectie 2: order-koppeling (order_nr, klant, afl-snapshot, link naar order-detail)
  - Sectie 3: regels-tabel
  - Sectie 4: HST-transportorder-historie — alle `hst_transportorders`-rijen voor deze zending. Per rij: status-badge, sent_at, extern_transport_order_id, http_code, request_payload + response_payload als `<pre>`, retry-knop bij `Fout`-status (roept `verstuurZendingOpnieuw` aan).
  - **Anticiperen op Rhenus/Verhoek:** sectie 4 leest nu uit `zending.hst_transportorders[]`. Bij latere EDI-vertical komt daarnaast een tweede subsectie voor `edi_berichten WHERE berichttype='verzendbericht'`. Geen forcering tot nu — aparte stukjes UI per adapter is OK.

- [ ] **Stap 2:** Smoke-test in browser.

- [ ] **Stap 3:** Commit
  ```bash
  git add frontend/src/modules/logistiek/pages/zending-detail.tsx
  git commit -m "feat(logistiek): zending-detail-pagina met inline payload-blokken"
  ```

#### Task 3.5: Klant-vervoerder-tab

**Files:**
- Create: `frontend/src/components/klanten/klant-vervoerder-tab.tsx`
- Modify: `frontend/src/pages/klanten/klant-detail.tsx`

- [ ] **Stap 1:** `klant-vervoerder-tab.tsx`:
  - Dropdown met alle `vervoerders.actief = true` rijen + "Geen (handmatige flow)" optie
  - Save-button → `upsertKlantVervoerderConfig`
  - Disabled-state met uitleg-tekst als `vervoerders.actief = false` voor de gekozen code

- [ ] **Stap 2:** Voeg tab toe aan `klant-detail.tsx` naast bestaande tabs.

- [ ] **Stap 3:** Smoke-test: open een klant, kies "HST", refresh, waarde blijft staan.

- [ ] **Stap 4:** Commit
  ```bash
  git add frontend/src/components/klanten/klant-vervoerder-tab.tsx \
          frontend/src/pages/klanten/klant-detail.tsx
  git commit -m "feat(logistiek): vervoerder-tab op klant-detail"
  ```

#### Task 3.6: Zending-aanmaken-knop op order-detail

**Files:**
- Create: `frontend/src/components/orders/zending-aanmaken-knop.tsx`
- Modify: `frontend/src/pages/orders/order-detail.tsx`

- [ ] **Stap 1:** `zending-aanmaken-knop.tsx`:
  ```tsx
  // Toont knop alleen als order.status === 'Klaar voor verzending'
  // Roept supabase.rpc('create_zending_voor_order', { p_order_id })
  // Bij succes: toast + navigeer naar /logistiek/{zending_nr_returned}
  // Disabled met tooltip als debiteur geen vervoerder_code heeft (toon: "Stel eerst vervoerder in op klantkaart")
  ```

- [ ] **Stap 2:** Integreer in `order-detail.tsx` actie-balk.

- [ ] **Stap 3:** Smoke-test e2e: maak knop → zending verschijnt op /logistiek → cron pakt op → status wordt "Onderweg" + track_trace gevuld.

- [ ] **Stap 4:** Commit
  ```bash
  git add frontend/src/components/orders/zending-aanmaken-knop.tsx \
          frontend/src/pages/orders/order-detail.tsx
  git commit -m "feat(logistiek): zending-aanmaken-knop op order-detail"
  ```

#### Task 3.7: Router + sidebar

**Files:**
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/lib/utils/constants.ts`

- [ ] **Stap 1:** In `router.tsx`: vervang `/logistiek` PlaceholderPage door `<ZendingenOverzichtPage />`. Voeg `/logistiek/:zending_nr` toe naar `<ZendingDetailPage />`.

- [ ] **Stap 2:** Verifieer dat sidebar-item al "Logistiek" heet ([screenshot uit user-bericht 2026-05-01 toont al "Logistiek"](.) in de operationele sectie). Geen wijziging nodig tenzij we sub-items willen toevoegen.

- [ ] **Stap 3:** Commit
  ```bash
  git add frontend/src/router.tsx frontend/src/lib/utils/constants.ts
  git commit -m "feat(logistiek): router + sidebar wiring"
  ```

#### **🛑 Review-checkpoint na Fase 3**

> Volledige UI-rondreis: klant-tab vervoerder = HST → order op "Klaar voor verzending" → knop → zending verschijnt op /logistiek → cron stuurt → tracking + status update zichtbaar in UI.

---

### Fase 4 — Cutover-test op ACCP

#### Task 4.1: End-to-end test met 3 echte orders

**Files:**
- Create: `docs/logistiek/hst-cutover-test-2026-05-XX.md` (gevulde dag-rapportage)

- [ ] **Stap 1:** Kies 3 representatieve klanten van Karpi die HST gebruiken. Stel `vervoerder_code = 'hst_api'` in op die debiteuren.

- [ ] **Stap 2:** Maak van elk een testorder aan, breng tot status "Klaar voor verzending", klik "Zending aanmaken".

- [ ] **Stap 3:** Verifieer voor elke 3:
  - Zending verschijnt in /logistiek
  - hst_transportorders-rij komt op status "Verstuurd"
  - HST web-portaal toont de zending met juiste data
  - track_trace teruggekomen

- [ ] **Stap 4:** Test ook 1 negatief geval: maak een zending aan voor klant zonder `vervoerder_code` → trigger doet niets (verwacht). Documenteer.

- [ ] **Stap 5:** Schrijf rapport `docs/logistiek/hst-cutover-test-2026-05-XX.md` met screenshots, RC-output, en go/no-go-conclusie.

- [ ] **Stap 6:** Commit
  ```bash
  git add docs/logistiek/hst-cutover-test-*.md
  git commit -m "docs(logistiek): hst cutover-test ACCP rapport"
  ```

#### Task 4.2: Productie-credentials wisselen

**Files:**
- Modify: Supabase Vault (handmatig, niet in git)

- [ ] **Stap 1:** Wacht op productie-credentials van Niek/Wilfred (productie-username, productie-wachtwoord, productie-base-URL: vermoedelijk `https://hstonline.nl/rest/api/v1`).

- [ ] **Stap 2:** Update Supabase Secrets in dashboard: `HST_API_BASE_URL`, `HST_API_USERNAME`, `HST_API_WACHTWOORD`. **NIET** in `.env.example` zetten.

- [ ] **Stap 3:** Re-deploy: `supabase functions deploy hst-send --no-verify-jwt`.

- [ ] **Stap 4:** **EERSTE PRODUCTIE-RIT:** maak één echte order aan van een klant die we hebben afgesproken om als pilot te gebruiken. Volg in HST-productie-portaal of de zending verschijnt.

- [ ] **Stap 5:** Bij succes: zet `vervoerders.actief = TRUE` in productie. Vóór die tijd blijft trigger inactief.

- [ ] **Stap 6:** Commit (geen credentials, alleen statuswisseling als die in een seed-migratie zit):
  ```bash
  git commit --allow-empty -m "chore(logistiek): hst api productie-cutover voltooid"
  ```

#### **🛑 Review-checkpoint na Fase 4**

> Productie-rondreis bevestigd? Iedereen weet dat het live is? Pas dán af-sluit-update naar architectuur.md + changelog.

---

### Fase 5 — Documentatie + afsluit

#### Task 5.1: Architectuur.md update

**Files:**
- Modify: `docs/architectuur.md`

- [ ] **Stap 1:** Voeg sectie "Logistiek-module" toe na de bestaande EDI-sectie. Inhoud: het diagram uit sectie 3 van dit plan + kort verhaal over de keuzes (zie sectie 5 design-besluiten).

- [ ] **Stap 2:** Commit
  ```bash
  git add docs/architectuur.md
  git commit -m "docs(architectuur): logistiek-module sectie toegevoegd"
  ```

#### Task 5.2: Changelog + plan-status

**Files:**
- Modify: `docs/changelog.md`

- [ ] **Stap 1:** Eind-entry:
  ```markdown
  ## 2026-05-XX — Logistiek-module fase 1: HST API live
  Eerste vervoerder-koppeling actief. Trigger op zending → "Klaar voor verzending" → automatisch TransportOrder bij HST. Per-klant configureerbaar via klant-detail tab.
  Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md
  ```

- [ ] **Stap 2:** Commit
  ```bash
  git add docs/changelog.md
  git commit -m "docs(changelog): logistiek hst api fase 1 afgerond"
  ```

#### Task 5.3: Plan-bestand markeren als afgerond

- [ ] **Stap 1:** Bovenin dit plan-bestand een statusregel toevoegen:
  ```markdown
  **Status:** ✅ Afgerond YYYY-MM-DD — productie-live, eerste klant-pilot succesvol.
  ```

- [ ] **Stap 2:** Commit
  ```bash
  git add docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md
  git commit -m "docs(plan): logistiek hst api gemarkeerd als afgerond"
  ```

---

## 7. Volgorde-afhankelijkheden + parallelisme

- Fase 0 → Fase 1 → Fase 2 → Fase 3: strikt sequentieel.
- Binnen Fase 1: 169 → 170 → 171 → 172 (FK's en RPC-dependencies).
- Binnen Fase 2: 2.1 → 2.2 (test) → 2.3 → 2.4 (orchestratie) → 2.5 (cron).
- Binnen Fase 3: 3.1 → 3.2 (queries+hooks); 3.3 + 3.4 + 3.5 + 3.6 kunnen daarna parallel; 3.7 sluit af.
- Fase 4 vereist Fase 1-3 volledig. Fase 5 vereist Fase 4.

## 8. Risico's + mitigaties

| Risico | Mitigatie |
|---|---|
| HST API-shape wijkt af van wat we aannemen → fixture matcht niet | Fase 0 lost dit op vóór code; payload-builder testen tegen echte fixture |
| Productie-credentials komen pas later → planning-uitloop | Fase 0-3 volledig op ACCP; productie-cutover (Fase 4.2) is geïsoleerd |
| Trigger schiet per ongeluk dubbel als zending van Onderweg → Klaar voor verzending → Onderweg flapt | Idempotentie via `uk_hst_to_zending_actief` partial index — duplicate insert no-op |
| Cron-frequentie elke minuut = potentieel rate-limit issue bij HST | MAX_PER_RUN=25; bij rate-limit gaan rijen naar Fout met status-code 429 → retry-cycle handelt af |
| Wijziging vervoerder_code op klant tijdens openstaande zending | Bewust: alleen nieuwe zendingen volgen nieuwe waarde (sectie 5, besluit 3) |
| Switch-RPC ontbreekt `WHEN`-tak voor nieuwe vervoerder na deploy → trigger faalt stil | `enqueue_zending_naar_vervoerder` returnt `'no_adapter_voor_<code>'` + `RAISE NOTICE`. Test op die return-waarde in Rhenus/Verhoek-plan toevoegen. |
| Productie-cutover gaat fout, klant wacht op pakket | Vóór cutover: `vervoerders.actief = FALSE` houdt alle triggers inactief; rollback = single UPDATE |

## 9. Verifieer-vóór-claim-compleet checklist

Aan het einde van het plan:
- [ ] Alle 5 migraties (169–173) toegepast en geverifieerd.
- [ ] Edge function `hst-send` deployed en cron actief.
- [ ] Live rondreis op ACCP succesvol (3 testorders).
- [ ] Productie-rondreis succesvol (1 pilot-order).
- [ ] `docs/database-schema.md`, `docs/architectuur.md`, `docs/changelog.md` bijgewerkt.
- [ ] Klant-vervoerder-tab werkt + valideert.
- [ ] Zending-aanmaken-knop op order-detail werkt + disabled-state correct.
- [ ] Zending-detail toont request- + response-payload + retry-knop.
- [ ] `enqueue_zending_naar_vervoerder` is de enige plek in de codebase met een switch op `vervoerder_code` — verifieer met `grep -rn "vervoerder_code" supabase/ frontend/`. Switches in andere lagen = regressie.

---

## 10. Open vragen voor plan-review

1. **Fase 0 zonder de specifieke HST-attachment-fixture**: kan Wilfred die test-payload nu doorsturen? Anders bouwen we hem zelf op basis van OpenAPI required-velden.
2. **Branch-strategy**: huidige branch is `codex/prijslijsten`. Nieuwe `feature/logistiek-hst` branch starten of doorgaan op de huidige?
3. **Klant-vervoerder-keuze als kolom op `edi_handelspartner_config`** (sectie 5, besluit 3). Acceptabel of liever aparte tabel `debiteur_vervoerder_config`? De naam-mismatch (`edi_*` voor logistiek-data) is m.i. niet erg, maar bij de eerste niet-EDI-vervoerder #2 wordt die mismatch zichtbaarder. Mogelijk later refactor naar `handelspartner_config`.
4. **`zending-aanmaken-knop` als enige trigger-bron — niet automatisch.** Confirm: gebruiker klikt expliciet, geen automatisme. Reden: die actie kan niet zonder gewicht/colli, en die data komt van pakker.
5. **HST `customerReference` = `order_nr`**: bevestig met Wilfred dat dat het juiste veld is om te tonen.
6. **Switch-RPC of TG-functie-dispatch?** Plan kiest een aparte `enqueue_zending_naar_vervoerder`-RPC die de trigger aanroept. Alternatief: dispatch direct in `fn_zending_klaar_voor_verzending`. Argument vóór aparte RPC: testbaar zonder DML, ook handmatig vanuit edge function aan te roepen voor recovery. Argument tegen: één laag extra. Houden zoals het nu staat?
7. **Bij Rhenus/Verhoek-plan straks**: schrijven we dan `enqueue_edi_verzendbericht`-RPC die in `edi_berichten` schrijft, of breiden we de switch uit naar een DESADV-builder die direct DOM-data in `edi_berichten` zet? **Buiten scope** voor dit plan — onthouden voor het EDI-vervoerder-plan.
