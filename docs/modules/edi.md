# EDI/Transus

> Module-doc: huidige staat + valkuilen. Chronologie: [docs/changelog.md](../changelog.md). Actuele RPC-bodies: [supabase/schema/functies.sql](../../supabase/schema/functies.sql) / [views.sql](../../supabase/schema/views.sql).

## Wat dit is
Karpi's koppeling met handelspartners (Hornbach, BDSK/XXXLutz, SB-Möbel BOSS, Ostermann e.a.) loopt sinds de Windows-Connect-vervanging via Transus' SOAP-API. Transus is de vertaler naar/van EDIFACT D96A per partner; Karpi praat zelf een fixed-width "Custom ERP"-formaat. Alle in- en uitgaande berichten (order, orderbevestiging/ORDRSP, factuur/INVOIC, verzendbericht/DESADV) lopen via één centrale audit-/queue-tabel `edi_berichten`. De module bewaakt drie losse "iets klopt niet, kijk hiernaar"-signalen (Te koppelen / Te bevestigen / Debiteur te bevestigen — zie Valkuilen) en verzorgt de GLN-gedreven matching van een inkomende order naar de juiste debiteur én vestiging.

## Kernbestanden
| Laag | Pad | Rol |
|------|-----|-----|
| Edge function (poll) | [`supabase/functions/transus-poll/index.ts`](../../supabase/functions/transus-poll/index.ts) | M10110 ophalen, `matchDebiteur` (GLN-ladder), `create_edi_order` aanroepen |
| Edge function (send) | [`supabase/functions/transus-send/index.ts`](../../supabase/functions/transus-send/index.ts) | M10100 versturen (ORDRSP/INVOIC/DESADV vanuit de `edi_berichten`-queue), M10300 ack verwerken |
| Edge function (DESADV-sweep) | [`supabase/functions/bouw-verzendbericht-edi/index.ts`](../../supabase/functions/bouw-verzendbericht-edi/index.ts) | cron `verzendbericht-edi-sweep` (mig 377, elke 15 min), bouwt DESADV per gereed-gemelde zending |
| Edge function (factuur-EDI) | [`supabase/functions/bouw-factuur-edi/index.ts`](../../supabase/functions/bouw-factuur-edi/index.ts) | handmatig INVOIC opnieuw bouwen/versturen |
| Format-builders | [`supabase/functions/_shared/transus-formats/`](../../supabase/functions/_shared/transus-formats/) | `karpi-fixed-width.ts` (order/ORDRSP), `karpi-invoice-fixed-width.ts` (INVOIC), `karpi-verzendbericht.ts` (DESADV) |
| Gedeelde SOAP-client | [`supabase/functions/_shared/transus-soap.ts`](../../supabase/functions/_shared/transus-soap.ts) | M10100/M10110/M10300-envelope |
| Factuurdocument (ADR-0036) | [`supabase/functions/_shared/facturatie/`](../../supabase/functions/_shared/facturatie/) | `factuur-document.ts` + `naarInvoiceInput` voedt zowel `factuur-verzenden` als `bouw-factuur-edi` |
| Tabellen | `edi_berichten`, `edi_handelspartner_config`, `debiteur_gln_aliassen`, `externe_payloads` | zie [database-schema.md](../database-schema.md) §edi_berichten / §edi_handelspartner_config / §externe_payloads |
| Frontend module | [`frontend/src/modules/edi/`](../../frontend/src/modules/edi/) | berichten-overzicht, bericht-detail, koppel-widget, klant-EDI-tab, `registry.ts` (procesconfiguratie per partner) |
| Bevestig-dispatch | [`frontend/src/lib/orders/bevestiging-kanaal.ts`](../../frontend/src/lib/orders/bevestiging-kanaal.ts), [`frontend/src/modules/edi/lib/use-bevestig-edi-order.ts`](../../frontend/src/modules/edi/lib/use-bevestig-edi-order.ts) | `isOrderBevestigd`/`bepaalBevestigingKanaal` — één predicaat voor EDI (`edi_bevestigd_op`) vs. e-mail (`bevestigd_at`) |
| GLN-gate (aflever) | [`frontend/src/lib/orders/afleveradres-gln-gate.ts`](../../frontend/src/lib/orders/afleveradres-gln-gate.ts), [`afleveradres-gln-banner.tsx`](../../frontend/src/components/orders/afleveradres-gln-banner.tsx) (order-detail), [`afleveradres-ongekoppeld-banner.tsx`](../../frontend/src/modules/edi/components/afleveradres-ongekoppeld-banner.tsx) (overzicht) | pure predicate + twee banners |
| "Te koppelen"-vangnet | [`frontend/src/modules/edi/lib/te-koppelen.ts`](../../frontend/src/modules/edi/lib/te-koppelen.ts), [`te-koppelen-banner.tsx`](../../frontend/src/modules/edi/components/te-koppelen-banner.tsx) | `isTeKoppelen`/`filterTeKoppelen` |
| "Te bevestigen"-leverweek | [`frontend/src/lib/orders/edi-leverweek.ts`](../../frontend/src/lib/orders/edi-leverweek.ts), [`edi-leverweek-bevestigen.tsx`](../../frontend/src/components/orders/edi-leverweek-bevestigen.tsx) | `isLeverweekTeBevestigen`/`vergelijkLeverweek` |
| Voorbeelden/referentie | [`docs/transus/voorbeelden/`](../transus/voorbeelden/) | bron-EDIFACT-paren voor byte-identieke format-validatie |
| Runbooks | [`docs/runbooks/edi-cutover.md`](../runbooks/edi-cutover.md), [`docs/runbooks/edi-logboek.md`](../runbooks/edi-logboek.md) | operationele cutover-status per partner |

## Geldende ADR's & specs
- ADR-0036 ([`factuurdocument-als-deep-module.md`](../adr/0036-factuurdocument-als-deep-module.md)) — INVOIC (auto via `factuur-verzenden` én handmatig via `bouw-factuur-edi`) is een dunne renderer op één canoniek `FactuurDocument`; nooit meer een eigen fetch/resolve per pad bouwen.
- ADR-0033 ([`gedeelde-logica-cross-root-import-niet-kopieren.md`](../adr/0033-gedeelde-logica-cross-root-import-niet-kopieren.md)) — relevant voor de landnaam→ISO-2-normalisatie die EDI-adressen ook raakt (`_shared/adres-split.ts`).
- Plan: [`docs/superpowers/plans/2026-04-29-edi-transus-koppeling.md`](../superpowers/plans/2026-04-29-edi-transus-koppeling.md) — oorspronkelijk cutover-plan (fase 1 t/m go-live).
- [`docs/transus/pre-cutover-data-stappenplan.md`](../transus/pre-cutover-data-stappenplan.md), [`docs/transus/mail-aan-transus.md`](../transus/mail-aan-transus.md), [`docs/transus/demo-rondreis.md`](../transus/demo-rondreis.md), [`docs/transus/werklijst-35-afleveradressen.md`](../transus/werklijst-35-afleveradressen.md) — cutover-correspondentie en testrecepten.
- Verwant maar eigen module: [`docs/superpowers/plans/2026-06-22-deelzending-correctheid.md`](../superpowers/plans/2026-06-22-deelzending-correctheid.md) (DESADV-herontwerp op zending-niveau, mig 475).

## Bedrijfsregels (huidige staat)

### Architectuur & bericht-stroom (mig 156-157)
- Alle EDI-verkeer loopt via `edi_berichten` (audit + queue), gekoppeld aan Transus' SOAP-API: M10100 (versturen), M10110 (poll-ontvangen), M10300 (ack).
- Uitgaand formaat: fixed-width "Custom ERP" (Transus-Online ID 17653, versie 10) — Transus vertaalt zelf naar/van EDIFACT D96A richting de partners.
- Karpi-GLN: `8715954999998`.
- Per-debiteur schakelaars in `edi_handelspartner_config`: `transus_actief` (hoofdschakelaar) + 4 berichttype-toggles (`order_in`, `orderbev_uit`, `factuur_uit`, `verzend_uit`) + `test_modus`.
- **Cutover was big-bang**: Windows Connect en de Transus-API kunnen niet parallel draaien voor dezelfde partner (39 partners in één keer overgezet, zie [`edi-cutover.md`](../runbooks/edi-cutover.md)).

### GLN-matching en debiteur-/vestigingskoppeling (mig 306-307, 543-544)
`matchDebiteur` in [`transus-poll/index.ts`](../../supabase/functions/transus-poll/index.ts) matcht **meest-specifiek-eerst**, `.0`-import-artefact-tolerant (matcht zowel `gln` als `gln.0`):
1. aflever-GLN → `afleveradressen.gln_afleveradres`
2. besteller-GLN → `afleveradressen.gln_afleveradres`
3. besteller/gefactureerd-GLN → `debiteuren.gln_bedrijf` (**inactieve debiteuren overgeslagen**, zodat centrale-facturatie-ketens zoals Hornbach op de actieve entiteit landen, niet op de vaak-inactieve hoofd-AG)
4. → `debiteur_gln_aliassen` (mig 307) als vijfde stap, voor ketens met **meerdere factuur-GLN's onder één debiteur** (bv. BDSK/XXXLutz #600556: naast `9007019015989` ook `9007019010007`)

Twee koppel-routes in [`koppel-vestiging-widget.tsx`](../../frontend/src/modules/edi/components/koppel-vestiging-widget.tsx) voor een ongematchte order:
- **aflever-GLN op afleveradres** (RPC `koppel_edi_afleveradres`, mig 306) — voor een vaste vestiging (Hornbach); onthoudt de GLN op het gekozen afleveradres, volgende order matcht automatisch op stap 1.
- **factuur-GLN als debiteur-alias** (RPC `koppel_edi_debiteur_alias`, mig 307) — voor centrale facturatie met wisselend afleveradres (BDSK); default-modus in de widget als de aflever-GLN ontbreekt maar er wél een factuur-GLN is.

**Harde poort op de aflever-GLN (mig 543-544, 2026-06-30/07-01):** `create_edi_order` matchte het afleveradres altijd al **exact** op `gln_afleveradres`, en viel bij geen match **stil** terug op het debiteur-hoofdadres — een order werd dus gewoon aangemaakt, alleen naar het verkeerde adres (aanleiding: ORD-2026-0892, XXXLutz Gottfrieding → Würzburg-HQ; ~9 orders over 3 debiteuren in dezelfde val). Dat stille gedrag van `create_edi_order` zelf is ongewijzigd; twee nieuwe kolommen + trigger maken het nu wél zichtbaar en blokkerend:
- `orders.afl_gln_ongekoppeld_sinds` — AUTO (trigger `trg_orders_afl_gln_gate`): gezet zodra een EDI-order (niet-afhaal, niet-productie-only, niet-eindstatus) een aflever-GLN heeft die geen vestiging matcht (single-source predicaat `_afl_gln_matcht_vestiging`, spiegelt `create_edi_order`).
- `orders.afl_gln_gecontroleerd_op` — HANDMATIG (RPC `markeer_afleveradres_gecontroleerd`): operator geeft het adres bewust vrij, los van de gewone orderbevestiging.
- **Blokkade** = `ongekoppeld_sinds IS NOT NULL AND gecontroleerd_op IS NULL`; twee wegen eruit: (a) GLN alsnog koppelen aan een vestiging (de `afleveradressen`-trigger wist de gate op **alle** wachtende orders met die GLN, niet alleen de triggerende), of (b) bewust vrijgeven via de RPC.
- Zit als tweede van de drie checks in de gedeelde poort `_valideer_intake_gates` (volgorde in de live functie-body: afleveradres-compleetheid → afl_gln → prijs) → blokkeert `start_pickronden`.
- View `edi_orders_afleveradres_ongekoppeld` voedt twee UI's: order-detail-banner (resolve-actie) en de orders-overzicht-veiligheidsnet-banner (spiegelt het "Te koppelen"-patroon, mig 306).
- Backfill bewust beperkt tot orders die de pickronde nog niet gestart waren (een order die al 'In pickronde'/'Deels verzonden'/'Klaar voor verzending' is, wordt niet met terugwerkende kracht gevlagd — de poort helpt daar toch niets meer).

### Leverweek: voorstel + bevestiging (mig 309-310, 2026-06-04, mig 316)
- De partner-leverdatum is een **klantwens**, geen toezegging: `create_edi_order` zet 'm op `orders.afleverdatum` (voorstel — allocator/mig 153 mogen vooruitschuiven) én als onveranderlijke snapshot op `orders.edi_gewenste_afleverdatum`.
- Een EDI-order is **"te bevestigen"** zolang `edi_bevestigd_op IS NULL` — **niet** hetzelfde als `bevestigd_at` (dat is de e-mail-orderbevestiging, mig 304).
- **Bevestiging is administratief, niet operationeel-blokkerend** (besluit 2026-06-04): de order moet hoe dan ook geleverd/geproduceerd worden. De oorspronkelijke mig 309/310-gates die onbevestigde EDI-orders uit Pick & Ship en productie-intake (`snijplanning_overzicht`) weerden zijn via **mig 316** volledig teruggedraaid — onbevestigde EDI-orders zijn gewoon pickbaar en snijdbaar.
- Operator bevestigt op order-detail ([`EdiLeverweekBevestigen`](../../frontend/src/components/orders/edi-leverweek-bevestigen.tsx)): kiest de definitieve leverweek → zet `afleverdatum` vast + `bevestigOrderViaEdi` (zet `edi_bevestigd_op`, plaatst de orderbev op de wachtrij). De orderbev draagt de **bevestigde** datum, niet de rauwe wens.
- Pure helpers: [`edi-leverweek.ts`](../../frontend/src/lib/orders/edi-leverweek.ts) (`isLeverweekTeBevestigen`, `vergelijkLeverweek`) — voedt nog de "Te bevestigen"-chip, maar sinds mig 316 geen pickbaarheids-/productiefilter meer.

### Universele bevestig-knop: ORDRSP vs. e-mail (besluit 2026-06-11)
Canonieke behandeling: [orders.md](orders.md) (sectie Universele bevestig-knop) — hier alleen de EDI-kant:
- EDI-order met `transus_actief && orderbev_uit` → ORDRSP via `useBevestigEdiOrder`; EDI-order **zonder** actieve orderbev-toggle → gewoon e-mail (waarna `BevestigOrderDialog` met `sluitEdiGate=true` óók de `edi_bevestigd_op`-gate sluit).
- GTIN op de EDI-orderbevestiging komt uit het inkomende bericht met fallback op `producten.ean_code` (zie changelog 18-06, `orderbev-gtin.ts`).

### Uitgaande berichten: DESADV / INVOIC / ORDRSP
- **DESADV (verzendbericht):** automatische sweep `bouw-verzendbericht-edi` (cron `verzendbericht-edi-sweep`, mig 377, jobid 12, elke 15 min), voor partners met `verzend_uit && transus_actief` (Hornbach NL 361208, BDSK 600556). Filtert admin-pseudo/VERZEND-regels (ADR-0018); toont het **originele** artikel (omsticker blijft intern, zelfde regel als de factuur). Format `karpi-verzendbericht.ts`, byte-identiek gevalideerd tegen een echt Hornbach-bericht; géén tracking-slot.
  - **Zending-als-eenheid (mig 475, 2026-06-22):** kandidaten komen uit `zendingen.gereed_op IS NOT NULL` (eerste "Klaar voor verzending"-moment, niet `orders.status='Verzonden'` — een deelzending bereikt dat moment vaak terwijl de order nog 'Deels verzonden' staat). Idempotentie-sleutel `(order_id, zending_id)` via `uk_edi_berichten_verzendbericht_actief`. Regels komen uit `SUM(zending_regels.aantal)` per order_regel (niet `orderaantal`) — een orderregel kan over meerdere zendingen verdeeld zijn. Een bundel-zending (mig 222, meerdere orders in 1 zending) levert nog steeds 1 DESADV per order.
  - **Leverbonnummer-uniciteit (2026-06-25, geen migratie):** het leverbonnummer (BGM+351) werd uit alleen het zendingnummer afgeleid — bij een bundel-zending (≥2 orders in 1 zending) kregen beide DESADV's hetzelfde nummer en weigerde Hornbach de tweede. Nu `leverbonNummer() = last4(zendingNr) + last4(orderNr)` (8 cijfers, uniek per (zending, order)-paar) in `karpi-verzendbericht.ts`.
- **INVOIC (factuur):** gaat via het canonieke `FactuurDocument` (ADR-0036) → `naarInvoiceInput`, gedeeld door de automatische route (`factuur-verzenden`) en de handmatige route (`bouw-factuur-edi`) — beide byte-identiek, golden-gepind.
  - **NAD+IV-GLN-fix (2026-06-25, geen migratie):** voor centrale-facturatie-ketens (Hornbach, mig 306/307) leverde `orders.factuuradres_gln` de interchange-/routerings-GLN i.p.v. de echte factuurontvanger — Transus routeert al zelf via de partnerconfig. NAD+IV komt nu uit `debiteuren.gln_bedrijf` (`.0`-artefact gestript); UNB-routering blijft `factuuradres_gln`. Voor BDSK vielen beide GLN's toevallig samen, dus bleef dat pad ongewijzigd correct.
  - BTW verlegd (`effectief_btw_pct`, zie de facturatie-/BTW-module) wordt al door de INVOIC-mapper meegenomen — géén EDI-specifieke logica.
- **ORDRSP (orderbevestiging):** zie "Universele bevestig-knop" hierboven — alleen actief richting partners met `orderbev_uit`.

### Rauwe-payload-audit, in- én uitgaand (mig 324 → 325)
- `externe_payloads` (mig 324 als `inkomende_payloads`, hernoemd in mig 325 — de `richting`-kolom dekt ook `'out'`) is een append-only diagnose-vangnet voor **niet-EDI**-kanalen: inbound Shopify (`sync-shopify-order`, later e-mail/webshop/lightspeed) en outbound vervoerders (HST via `hst-send`).
- **EDI heeft z'n eigen, rijkere audit/queue**: `edi_berichten.payload_raw` — géén dubbele logging naar `externe_payloads` voor EDI-verkeer.
- Two-step voor inbound: `log_externe_payload` (status `'ontvangen'`) → `markeer_externe_payload_verwerkt`. Outbound schrijft na élke POST één rij met eindstatus direct, **elke retry = nieuwe rij** (volledige foutgeschiedenis bewaard — anders dan `hst_transportorders`, dat per poging overschrijft).
- Alle logging is best-effort (try/catch + warn) — mag verwerking/verzending nooit blokkeren.
- Deprecated wrappers `log_inkomende_payload`/`markeer_inkomende_payload_verwerkt` bestaan nog (mig 325) tot `sync-shopify-order` herdeployed is.
- **EDI-carriers (Rhenus/Verhoek via `transus-send`) loggen nog niet naar dit vangnet, en er is geen diagnose-UI** — beide staan op de backlog (zie Openstaand).

## Valkuilen & gotcha's

**Drie verschillende "iets klopt niet"-signalen — niet verwisselen:**
| Signaal | Betekenis | Predicaat | Waar zichtbaar |
|---|---|---|---|
| **"Te koppelen"** | inkomend EDI-bericht heeft **helemaal geen order** opgeleverd (debiteur/vestiging onvindbaar) | `richting='in' AND berichttype='order' AND order_id IS NULL` (filtert op `order_id`, **niet** op status — de poll laat de status soms op `Verwerkt` staan terwijl order-creatie faalde) | EDI-berichten-overzicht-filter + rose banner op orders-overzicht (`EdiTeKoppelenBanner`) |
| **Aflever-GLN "ongekoppeld"** (mig 543-544) | order **is wél aangemaakt**, maar de aflever-GLN matchte geen vestiging → stille terugval op het debiteur-hoofdadres | `afl_gln_ongekoppeld_sinds IS NOT NULL AND afl_gln_gecontroleerd_op IS NULL` | order-detail-banner + orders-overzicht-veiligheidsnet-banner, hard-block in `_valideer_intake_gates` |
| **"Te bevestigen"** (leverweek) | order bestaat, adres klopt, maar de **klant-gewenste leverweek** is nog niet operationeel bevestigd | `bron_systeem='edi' AND edi_bevestigd_op IS NULL` | status-overstijgende chip op orders-overzicht, amber paneel op order-detail |
| **"Debiteur te bevestigen"** (niet-EDI, maar zelfde patroon) | een **fuzzy** debiteur-match (Shopify/e-mail/webshop) is onzeker | `debiteur_zeker=false AND ...` | eigen banner/tab, zie de debiteur-matcher-seam (2026-06-07) — géén EDI-mechanisme, wél gebouwd naar hetzelfde nullable-gate-patroon |

- **`edi_berichten.payload_raw` ≠ `externe_payloads`**: EDI heeft zijn eigen rijke audit/queue; het generieke vangnet (mig 324-325) bedient bewust alleen niet-EDI-kanalen. Nooit EDI-verkeer óók naar `externe_payloads` gaan loggen.
- **`externe_payloads` ≠ `hst_transportorders`**: de eerste is de append-only historie (elke retry een nieuwe rij), de tweede de actuele transport-status (overschrijft per poging).
- **`edi_bevestigd_op` (mig 158/309) ≠ `bevestigd_at` (mig 304)**: eerste = EDI-leverweek-bevestiging, tweede = generieke e-mail-orderbevestigd-timestamp. Beide kunnen op dezelfde order voorkomen via verschillende kanalen (zie "Universele bevestig-knop").
- **`edi_gewenste_afleverdatum` ≠ `levertijd_wijziging_te_bevestigen_sinds`** (mig 326, andere module — leverancier-ETA-signalering): de EDI-gate is eenmalig en vast bij order-aanmaak; de ETA-gate moet herhaaldelijk open/dicht kunnen — bewust twee losse mechanismes met een eigen nullable-kolom-vorm. Zie de order-lifecycle-doc voor mig 326 zelf.
- **Cutover-constraint blijft van toepassing bij een nieuwe partner:** Windows Connect en Transus-API kunnen niet parallel voor dezelfde partner — een nieuwe partner aansluiten is een bewuste, geïsoleerde cutover, geen geleidelijke uitrol.
- **`vervoerder_code` op `edi_handelspartner_config` is legacy** (mig 170): niet meer leidend voor logistieke dispatch sinds mig 176 — de gekozen vervoerder staat op `zendingen.vervoerder_code` (zie de logistiek/vervoerder-module).
- **Bewust niet gebouwd:** diagnose-UI voor `externe_payloads` en EDI-carrier-logging (Rhenus/Verhoek via `transus-send`) naar hetzelfde vangnet — backlog, geen verborgen aanname dat het al bestaat.
- **PGRST201-valkuil bij DESADV/orderbev-embeds:** kale PostgREST-embeds (`debiteuren(naam)`, `producten(ean_code)`) kunnen ambigu zijn bij meerdere FK's (bv. `betaler`-FK, `fysiek_artikelnr`-FK van mig 154) — gebruik expliciete FK-hints (`debiteuren!orders_debiteur_nr_fkey`, `producten!order_regels_artikelnr_fkey`).
- **Een INVOIC-afkeuring op "verkeerd factuuradres" kan een naam-probleem zijn, geen adres-probleem.** GLN/BTW-nummer/straat-postcode-plaats kunnen exact kloppen terwijl de partner de factuur toch afkeurt, omdat `debiteuren.fact_naam` een handelsnaam/afkorting bevat in plaats van de volledige juridische naam die in hun crediteurenregistratie staat (incident 2026-07-02, SB Möbel Boss/Porta — zie [facturatie.md](facturatie.md#rg-anschrift-bij-edi-partners-volledige-juridische-naam-vereist-2026-07-02-sb-möbel-bossporta) voor de fix en de creditnota-/herfacturatie-gaten die daarbij aan het licht kwamen).

## Openstaand / V2
- EDI-carriers (Rhenus/Verhoek, via `transus-send`) loggen nog niet naar `externe_payloads`; er is geen diagnose-UI voor het vangnet — beide backlog (mig 324-325-bullet).
- 6 EDI-orders staan nog handmatig te koppelen op de aflever-GLN-gate (operationele restpost na mig 543-544, zie changelog/memory 01-07 — geen codewerk, wel een openstaande actie).
- DESADV/INVOIC-herzendingen na de 2026-06-25-fix (afgekeurde Hornbach-berichten + 15 INVOIC's) — operationeel, geen code.

---
**Bullets uit CLAUDE.md die informatie bevatten die nergens anders in `docs/` stond** (dus nu uitsluitend hier leeft): de volledige GLN-matching-ladder-stappen 1-5 inclusief de motivatie per stap, de "Universele bevestig-knop"-dispatchlogica (was als losse bullet aanwezig maar niet in de oorspronkelijke opdracht-lijst), de drieweg-disambiguatie-tabel "Te koppelen / GLN ongekoppeld / Te bevestigen / Debiteur te bevestigen", en de leverbonnummer-/NAD+IV-fixes van 2026-06-25 (geen migratie, dus nergens anders vastgelegd dan in de changelog-tekst zelf — hier voor het eerst samengevat in regelvorm).
