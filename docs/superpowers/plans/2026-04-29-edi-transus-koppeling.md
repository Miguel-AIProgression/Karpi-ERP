# EDI / Transus-koppeling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Doel:** Karpi's EDI-berichtuitwisseling (39 handelspartners, ~9.000 berichten/12 maanden, top-5 = 84% volume) van Windows Connect naar de Transus SOAP API verhuizen, geïntegreerd in RugFlow ERP. Karpi blijft ontvangen wat het nu ontvangt, en stuurt automatisch de juiste uitgaande berichten (orderbevestiging, verzendbericht, factuur) op basis van interne triggers, zoals dat nu in Basta gebeurt.

**Architecture (samenvatting):** Alle EDI-verkeer loopt via één gedeelde tabel `edi_berichten` (raw + parsed + status). Inkomend: cron-driven `transus-poll` edge function pollt elke minuut M10110, parseert het bericht, maakt een order aan via een idempotente RPC `create_edi_order`, en bevestigt de ontvangst via M10300. Uitgaand: triggers op `orders` (status → `Bevestigd`), `zendingen` (status → `Verzonden`) en `facturen` (status → `Verstuurd`) zetten een rij in `edi_berichten` met status `Wachtrij`; een tweede cron `transus-send` pakt die op, bouwt het Karpi fixed-width formaat (huidige Basta-output) en verstuurt via M10100. Per debiteur staat in `edi_handelspartner_config` welke berichttypen actief zijn.

**Tech Stack:** Postgres-migraties + RPC's, Deno edge functions met TypeScript, React + TanStack Query + shadcn/ui frontend.

---

## Context & Ontwerpkeuzes

Resultaat van /grill-me + analyse van 3 voorbeeldberichten op 2026-04-29.

### Bericht-formaat: fixed-width "Custom ERP" (Basta-compatibel)

Drie formaten zijn onderzocht:
- **EDIFACT D96A** — wat partners (BDSK, Ostermann) sturen aan Transus.
- **Fixed-width** — wat Transus voor Karpi uitspuugt en wat Basta nu produceert/leest.
- **XML** — beschreven in Transus' generieke berichtspecificatie-PDF, maar **niet** in Karpi's huidige config.

**Keuze: fixed-width.** Transus is de full-duplex vertaler — Karpi blijft het bekende formaat in/uit pompen, Transus vertaalt naar/van EDIFACT richting de partners. Voordeel: geen Transus-config-wijziging nodig, geen impact op de 39 handelspartners, byte-voor-byte gelijkschakeling met Basta voor cutover-validatie. Nadeel: format is bedrijfseigen (geen publieke spec) — we documenteren de kolomposities zelf op basis van de drie geanalyseerde voorbeelden in `supabase/functions/_shared/transus-formats/`.

V2-overweging: omschakelen naar Transus-XML met Maureen — dat is robuuster en self-documenting, maar vereist per-partner-config-wijziging bij Transus.

### Architectuur: pull voor inkomend, queue-push voor uitgaand

Transus API biedt **geen webhook**. Inkomend gebeurt via M10110-polling: max 1 req/sec actief, max 1 req/min als queue leeg. Onze cron `transus-poll` draait elke 60 seconden en blijft pollen tot de queue leeg is binnen één invocatie.

Uitgaand werkt via een interne wachtrij. Triggers schrijven een `edi_berichten`-rij met `richting='uit'` en `status='Wachtrij'`. De `transus-send` cron (elke 60s) pakt openstaande rijen, bouwt de payload, verstuurt via M10100, en zet de status op `Verstuurd` (of `Fout` met retry-counter).

Idempotentie:
- **Inkomend:** `transactie_id` (unieke Transus-TransactionID) is unique key. Order-aanmaak gebruikt `bron_systeem='edi' + bron_order_id` voor idempotency op order-niveau.
- **Uitgaand:** uniek per (richting='uit', berichttype, bron_id) — bv. één INVOIC-bericht per `factuur_id`. Re-trigger op zelfde factuur is no-op.

### Triggermodel voor uitgaande berichten

Het Basta-gedrag dat we nabouwen:

| Trigger | Berichttype | Wanneer |
|---|---|---|
| Order krijgt status `Bevestigd` (handmatig of via aankomst-flow) op een EDI-debiteur met `orderbev_uit=true` | Orderbevestiging | Direct na status-overgang |
| Zending krijgt status `Verzonden` (scanstation) op een EDI-debiteur met `verzend_uit=true` | Verzendbericht | Direct na status-overgang |
| Factuur krijgt status `Verstuurd` op een EDI-debiteur met `factuur_uit=true` | Factuur | Direct na status-overgang. Vervangt of vult aan op de bestaande factuur-PDF-mail. |

In V1 worden deze triggers in de DB gezet (PL/pgSQL) en schrijven ze direct in `edi_berichten`. Dat houdt de transactie-grens schoon: als het hoofdrecord rolt-back, rolt het bericht ook.

### Datamodel-uitbreiding op orders (4-staps partij-keten)

EDI-orders hebben tot 4 verschillende GLN's per order: `BY` (besteller / winkel), `IV` (invoicee / HQ), `DP` (delivery party / fysiek afleveradres), `SN` (ship-notify, in praktijk gelijk aan DP). Onze huidige order-snapshot heeft alleen `fact_*` (factuuradres) en `afl_*` (afleveradres). We voegen `bes_*` (besteller-adres) toe, met snapshots, en breiden uit met `besteller_gln`, `factuuradres_gln`, `afleveradres_gln`. NULL voor handmatige orders en webshop-orders.

### Per-partner-configuratie

Niet elke EDI-klant gebruikt alle vier de berichten. Pilipp slaapt; BDSK gebruikt alle vier; sommige partners alleen orders ontvangen. Per `debiteur_nr` kennen we in `edi_handelspartner_config` deze toggles:

```
order_in        BOOLEAN  -- ontvangen we orders van deze klant via EDI?
orderbev_uit    BOOLEAN  -- moet onze orderbevestiging via EDI?
factuur_uit     BOOLEAN  -- moet onze factuur via EDI?
verzend_uit     BOOLEAN  -- moet ons verzendbericht via EDI?
test_modus      BOOLEAN  -- alle uitgaande berichten met IsTestMessage-marker
```

`test_modus` is per-partner zodat we tijdens cutover op test-handelspartner kunnen draaien zonder code-wijziging.

### Karpi-zelfgegevens

`bedrijfsgegevens.gln_eigen` op één centraal punt (`8715954999998`, vastgesteld uit `NAD+SU`-segmenten van de drie voorbeelden). Edge functions lezen dit om als `SupplierGLN` mee te sturen.

### Cutover-strategie

WC en API kunnen niet parallel draaien (bevestiging-conflict). Cutover-procedure:

1. Vóór cutover: build alles, test met Transus-test-handelspartner (Maureen aanvragen).
2. Cutover-moment: stop WC-service op `MITS-CA-01-009`, activeer `transus-poll` en `transus-send` crons in Supabase.
3. Eerste 48u: extra monitoring op top-5 (BDSK, SB-Möbel BOSS, Hornbach NL, Hammer, Krieger). Als enig bericht in `Fout`-status komt → handmatig fixen of ack'en, geen automatische blocker.
4. Na 1 week stabiel: WC volledig deinstalleren.

---

## File Structure

### Database migraties
- `supabase/migrations/156_edi_handelspartner_config.sql` — tabel + GLN-velden op orders, `bedrijfsgegevens.gln_eigen` veld
- `supabase/migrations/157_edi_berichten.sql` — tabel `edi_berichten` + enum `edi_bericht_status` + RPC's `create_edi_order`, `enqueue_edi_uitgaand`, `claim_volgende_uitgaand`, `markeer_edi_verstuurd`, `markeer_edi_fout`
- `supabase/migrations/158_edi_triggers_uitgaand.sql` — triggers op `orders.status`, `facturen.status`, `zendingen.status` (placeholder; zending-trigger pas actief als zendingen-tabel verzendbericht-fields heeft)

### Edge functions
- `supabase/functions/_shared/transus-soap.ts` — SOAP envelope-builders + parsers voor M10100/M10110/M10300, error-codes
- `supabase/functions/_shared/transus-formats/karpi-fixed-width.ts` — parser+builder voor Karpi's bedrijfseigen fixed-width formaat (orders/orderbev/factuur/verzendbericht)
- `supabase/functions/_shared/transus-formats/karpi-fixed-width.test.ts` — round-trip tests met de drie voorbeeldberichten in `docs/transus/voorbeelden/`
- `supabase/functions/transus-poll/index.ts` — cron-driven, leegmaakt M10110-queue, parseert en inserteert via RPC, ackt via M10300
- `supabase/functions/transus-send/index.ts` — cron-driven, claimt openstaande uitgaande berichten, bouwt payload, verstuurt via M10100, markeert resultaat

### Voorbeelden / referentie
- `docs/transus/voorbeelden/order-in-ostermann-168818626.inh` — uitgepakt uit ZIP, anonimiseerbaar
- `docs/transus/voorbeelden/order-in-bdsk-168766180.inh`
- `docs/transus/voorbeelden/factuur-uit-bdsk-166794659.txt`
- `docs/transus/voorbeelden/edifact-source-orders-bdsk.edi` — wat Transus binnenkrijgt, ter referentie
- `docs/transus/voorbeelden/edifact-output-invoic-bdsk.edi` — wat Transus uitspuugt, ter referentie
- `docs/transus/specs/order-bericht-spec.pdf` — generieke Transus-specificatie (XML-vorm, V2-toekomst)

### Frontend — queries & hooks
- `frontend/src/lib/supabase/queries/edi.ts` — fetch berichten, fetch handelspartner-config, mutate config, refetch via TanStack Query keys

### Frontend — pagina's & componenten
- `frontend/src/pages/edi/berichten-overzicht.tsx` — hoofdpagina onder `/edi/berichten`, in/uit toggle, status-filter, paginering
- `frontend/src/pages/edi/bericht-detail.tsx` — detailpagina per bericht: raw payload, parse-status, gerelateerde order/factuur, retry-knop bij `Fout`
- `frontend/src/components/klanten/klant-edi-tab.tsx` — nieuwe tab op klant-detail: handelspartner-config, GLN's, recente berichten
- `frontend/src/components/orders/edi-bron-badge.tsx` — kleine badge bij `bron_systeem='edi'` orders met link naar het ruwe bericht

### Router-toevoeging
- `frontend/src/router.tsx` — routes `/edi/berichten` + `/edi/berichten/:id`
- `frontend/src/components/layout/sidebar.tsx` — nieuwe link "EDI-berichten" onder een EDI-section (toon altijd, ook als nog geen berichten zijn)

### Config / secrets
- Supabase env vars: `TRANSUS_CLIENT_ID`, `TRANSUS_CLIENT_KEY`
- `app_config` keys: `edi_config.poll_interval_seconds` (default 60), `edi_config.max_retries` (default 3)

### Cron / scheduled functions
- `supabase/functions/_cron/transus-poll-cron.json` of via Supabase Studio: every minute → `transus-poll`
- Idem `transus-send` every minute

### Docs-updates
- `docs/architectuur.md` — sectie EDI-laag toevoegen, naast bestaande Lightspeed-sectie
- `docs/database-schema.md` — `edi_handelspartner_config`, `edi_berichten`, `edi_bericht_status`-enum, GLN-velden op orders en bedrijfsgegevens
- `docs/data-woordenboek.md` — termen: EDI, Transus, EDIFACT, GLN, GTIN, fixed-width, M10100/M10110/M10300, MessageReference, TransactionID, IsTestMessage, BGM 220/231/351/380, NAD+BY/SU/IV/DP
- `docs/changelog.md` — nieuwe entry met datum, files, waarom
- `CLAUDE.md` — bedrijfsregel-blokje voor EDI (inkomende-order-flow, uitgaande triggers, cutover-procedure)

---

## Implementation Tasks

### Step 1 — Plan + voorbeelden vastleggen
- [x] Plan opslaan
- [ ] Voorbeelden uit ZIPs naar `docs/transus/voorbeelden/` kopiëren (handmatig — niet in repo committen tot anonimisering)

### Step 2 — Migratie 156: handelspartner-config + GLN-velden
- [ ] Veld `bedrijfsgegevens.gln_eigen TEXT NOT NULL DEFAULT '8715954999998'`
- [ ] Tabel `edi_handelspartner_config` (debiteur_nr PK, 5 toggles + transus_actief + test_modus)
- [ ] GLN-velden op `orders`: `besteller_gln`, `factuuradres_gln`, `afleveradres_gln`, plus `bes_naam, bes_adres, bes_postcode, bes_plaats, bes_land`
- [ ] RLS-policies (authenticated = volledige toegang, fase 1)
- [ ] Index op `edi_handelspartner_config.transus_actief`
- [ ] Backfill: voor debiteuren met `gln_bedrijf IS NOT NULL` → `edi_handelspartner_config` rij met `order_in=true, transus_actief=false` (klaar maar nog niet aan)
- [ ] Idempotent (IF NOT EXISTS overal)

### Step 3 — Migratie 157: edi_berichten + queue-RPCs
- [ ] Enum `edi_bericht_status` (`Wachtrij`, `Verstuurd`, `Verwerkt`, `Fout`, `Geannuleerd`)
- [ ] Tabel `edi_berichten` (id, transactie_id NULLABLE UNIQUE, richting CHECK, berichttype CHECK, status, debiteur_nr FK, order_id FK NULLABLE, factuur_id FK NULLABLE, zending_id FK NULLABLE, payload_raw TEXT, payload_parsed JSONB, error_msg TEXT, retry_count INT, ack_status, created_at, sent_at, acked_at)
- [ ] Unieke partial index voor uitgaand: één per (berichttype, bron_id)
- [ ] RPC `create_edi_order(p_payload TEXT, p_transactie_id TEXT, p_debiteur_nr INT, p_payload_parsed JSONB) RETURNS BIGINT` — idempotent op transactie_id, maakt order + regels via bestaande pipeline, koppelt order_id terug
- [ ] RPC `enqueue_edi_uitgaand(p_berichttype TEXT, p_debiteur_nr INT, p_bron_id BIGINT, p_payload_parsed JSONB) RETURNS BIGINT`
- [ ] RPC `claim_volgende_uitgaand() RETURNS edi_berichten` — pakt 1 rij FOR UPDATE SKIP LOCKED met status='Wachtrij'
- [ ] RPC `markeer_edi_verstuurd(p_id BIGINT, p_transactie_id TEXT)`
- [ ] RPC `markeer_edi_fout(p_id BIGINT, p_error TEXT)`
- [ ] RLS policies + GRANT EXECUTE op authenticated voor alle RPCs

### Step 4 — Migratie 158: triggers voor uitgaande berichten
- [ ] Trigger `trg_orders_edi_orderbev` op `AFTER UPDATE OF status ON orders` — bij overgang naar `Bevestigd` op debiteur met `orderbev_uit=true` → `enqueue_edi_uitgaand('orderbev', ...)` met basis-payload (order_nr, klant_referentie, regels)
- [ ] Trigger `trg_facturen_edi_factuur` op `AFTER UPDATE OF status ON facturen` — bij overgang naar `Verstuurd` op debiteur met `factuur_uit=true` → enqueue 'factuur'
- [ ] Trigger `trg_zendingen_edi_verzend` placeholder — opmerking dat hij geactiveerd wordt zodra `zendingen` voldoende DESADV-data heeft (SSCC, gewicht, etc.)
- [ ] Allemaal idempotent + skip als handelspartner-config niet `transus_actief=true`

### Step 5 — Edge function shared: SOAP-client
- [ ] `transus-soap.ts` — `sendM10100(clientId, key, message): {transactionId, exitCode}`, `receiveM10110(clientId, key): {transactionId?, message?, exitCode}`, `confirmM10300(clientId, key, transactionId, status, statusDetails?): {exitCode}`
- [ ] Base64-encode/decode payloads
- [ ] Strict timeout (10s) en exit-code-mapping naar errors

### Step 6 — Edge function shared: Karpi fixed-width parser/builder
- [ ] Parse-functie inkomend `parseKarpiOrder(raw: string): KarpiOrderParsed` — kolom-georiënteerd op basis van de 2 voorbeeld-orders
- [ ] Build-functie uitgaand `buildKarpiOrderbevestiging(input)` op basis van … (we hebben geen voorbeeld; volg INVOIC-patroon, leveren met `0` record + regels — header verschilt per type)
- [ ] Build-functie uitgaand `buildKarpiFactuur(input): string` — gespiegeld op het factuurvoorbeeld in `docs/transus/voorbeelden/`
- [ ] Tests met round-trip op de drie voorbeelden
- [ ] Format-versie-veld in JSONB voor backwards compat

### Step 7 — Edge function: transus-poll
- [ ] Bij iedere invocatie: lees env-secrets, haal `bedrijfsgegevens.gln_eigen`, loop M10110 totdat exitCode != 0 of message leeg
- [ ] Per bericht: bepaal berichttype uit eerste record-positie, parse, bepaal `debiteur_nr` uit `BuyerGLN` of `InvoiceeGLN`, roep `create_edi_order` aan, bevestig via M10300 met Status=0 bij succes / Status=1 + error-tekst bij parse-failure
- [ ] Bewaar raw payload in `edi_berichten` ongeacht parse-resultaat (audit-trail)
- [ ] Rate-limit-safe: 1 sec wachten tussen calls
- [ ] Auth: deploy met `--no-verify-jwt`, beveiligd via cron-token in URL of header

### Step 8 — Edge function: transus-send
- [ ] Loop tot `claim_volgende_uitgaand` NULL teruggeeft
- [ ] Per claim: bouw payload (op basis van `payload_parsed` en `berichttype`), verstuur via M10100, markeer succes/fout
- [ ] Bij fout: retry_count++, terug naar Wachtrij als < max_retries, anders status=Fout
- [ ] 1 sec tussen requests

### Step 9 — Frontend query-laag
- [ ] `queries/edi.ts` — types `EdiBericht`, `EdiHandelspartnerConfig`; functies `fetchEdiBerichten(filters)`, `fetchEdiBericht(id)`, `fetchHandelspartnerConfig(debiteurNr)`, `mutateHandelspartnerConfig`, `retryEdiBericht(id)`
- [ ] Hooks `useEdiBerichten`, `useEdiBericht`, `useHandelspartnerConfig` met TanStack Query

### Step 10 — Frontend pagina's
- [ ] `/edi/berichten` overzicht — tabel met datum, partner, type, richting, status; filters
- [ ] `/edi/berichten/:id` detail — raw payload, parsed JSON, gerelateerd order/factuur (klikbare links), retry-knop
- [ ] Klant-detail tab "EDI" — config-toggles + GLN-velden + recente berichten van deze klant
- [ ] Order-detail badge "EDI" met klikbare link naar bron-bericht
- [ ] Sidebar-link "EDI-berichten"

### Step 11 — Docs & changelog
- [ ] Update `docs/architectuur.md` (EDI-sectie)
- [ ] Update `docs/database-schema.md` (nieuwe tabellen + velden)
- [ ] Update `docs/data-woordenboek.md` (EDI/EDIFACT/GLN/etc.)
- [ ] Update `docs/changelog.md`
- [ ] Update `CLAUDE.md` (bedrijfsregels EDI)

### Step 12 — Cutover-voorbereiding
- [ ] Mail Maureen: vraag test-handelspartner + test-GLN
- [ ] Vraag Maureen: berichtspecs voor uitgaande typen (orderbev/factuur/verzending) zoals voor "Order ontvangen" al beschikbaar
- [ ] Schrijf cutover-runbook in `docs/runbooks/edi-cutover.md`

---

## Buiten V1 (V2-backlog)

- **DESADV (verzendbericht) pas activeren** als `zendingen` voldoende velden heeft (SSCC pakketcodes, brutogewicht, tracking-ID, leverbon-nr).
- **Omschakeling naar Transus-XML-formaat** — robuuster, self-documenting, maar vereist Transus-config-wijziging per partner. Plan apart na ervaring met fixed-width.
- **Order-wijzigingsberichten** (ORDCHG) — V1 negeren we; in V1 alleen nieuwe orders.
- **Order-annuleringsberichten** — handmatige flow in V1.
- **Status-poll uit Transus** (heeft de partner onze factuur ge-acked?) — niet in deze API; mogelijk via Online portal-API te scrapen, V2.
- **Webhook-style push vanuit Transus** — niet beschikbaar; pull-only.
