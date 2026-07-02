# Facturatie & BTW

> Module-doc: huidige staat + valkuilen. Chronologie: [docs/changelog.md](../changelog.md). Actuele RPC-bodies: [supabase/schema/functies.sql](../../supabase/schema/functies.sql) (gegenereerd snapshot) — niet chronologisch door migraties graven. Domeinbegrippen **Artikelpresentatie**, **Factuurdocument**, **Pakbondocument**: [CONTEXT.md](../../CONTEXT.md) (sectie "Facturatie & documenten") — hieronder niet herdefinieerd.

## Wat dit is

De facturatie-module zet een verzonden (of deels verzonden) Zending om in een factuur: een asynchrone queue (`factuur_queue`) verwerkt gebeurtenissen (pickronde voltooid, deelzending verzonden, wekelijkse cron) tot een Concept-factuur, past na een vertraging de BTW-regeling en verzendkosten-drempel toe, en verstuurt de factuur + pakbon per e-mail of EDI-INVOIC. Eén canoniek **Factuurdocument** (zie CONTEXT.md) is de enige bron voor wat er op de PDF én in het EDI-bericht staat.

## Kernbestanden

| Laag | Pad | Rol |
|---|---|---|
| DB-tabel | `facturen`, `factuur_regels` | Header + regels; zie [database-schema.md](../database-schema.md#facturen) |
| DB-tabel | `factuur_queue` | Asynchrone queue; zie [database-schema.md](../database-schema.md#factuur_queue) |
| RPC | `projecteer_concept_factuur(zending_id, factuur_id?)` | Herhaalbare projectie, geen side-effects (mig 428, laatst herschreven mig 550) |
| RPC | `finaliseer_concept_factuur(zending_id, factuur_id)` | Verse projectie + onomkeerbare side-effects (flip + kortingsregels) |
| RPC | `verwerk_concept_queue(max_batch)` | Fase 1 van de drain: projecteert concepten, race-safe `FOR UPDATE SKIP LOCKED` |
| RPC | `claim_factuur_queue_items(max_batch)` | Fase 2: claimt beschikbare + gefinaliseerde/finaliseerbare rijen |
| RPC | `bepaal_btw_regeling(afl_land, debiteur_land, afhalen, verlegd_vlag, btw_nummer, btw_pct)` | BTW-regeling per order/factuur (mig 455, herschreven mig 550) |
| RPC | `effectief_btw_pct(verlegd, pct)` | Klant-niveau BTW-fallback (mig 371) |
| RPC | `markeer_btw_regeling_geaccepteerd(factuur_id)` | Wist de controle-gate zonder data te wijzigen (mig 456) |
| RPC | `genereer_factuur_voor_week(debiteur_nr, jaar_week)` | Legacy wekelijks-pad (mig 232) |
| RPC | `enqueue_wekelijkse_verzamelfacturen()` | Cron-body, maandag 05:00 UTC (mig 122/231) |
| RPC | `maak_creditfactuur(...)` | Creditnota's, 4 modi (mig 467/504) |
| Edge function | [`factuur-verzenden`](../../supabase/functions/factuur-verzenden/index.ts) | De queue-drain: 2-fasen projecteren+finaliseren, BTW-hard-block, mail/EDI-dispatch, pakbon-mail |
| Edge function | [`bouw-factuur-edi`](../../supabase/functions/bouw-factuur-edi/index.ts) | Handmatige INVOIC-herzending vanaf de facturatie-UI |
| Edge function | [`factuur-pdf`](../../supabase/functions/factuur-pdf/index.ts) | On-demand PDF-generatie (preview/download) |
| Gedeeld (Deno) | [`_shared/btw.ts`](../../supabase/functions/_shared/btw.ts) | `effectiefBtwPct`/`isBtwVerlegd`/`isEuLand`/`bepaalBtwRegeling`/`HARD_BLOCK_REGELINGEN` |
| Gedeeld (Deno) | [`_shared/facturatie/factuur-document.ts`](../../supabase/functions/_shared/facturatie/factuur-document.ts) | `fetchFactuurDocument` — het Factuurdocument |
| Gedeeld (Deno) | [`_shared/facturatie/artikel-presentatie.ts`](../../supabase/functions/_shared/facturatie/artikel-presentatie.ts) | De Artikelpresentatie-resolver (`resolveKarpiCode` e.a.) |
| Gedeeld (Deno) | [`_shared/facturatie/factuur-invoice-renderer.ts`](../../supabase/functions/_shared/facturatie/factuur-invoice-renderer.ts) | `naarInvoiceInput` — dunne renderer naar `KarpiInvoiceInput` |
| Gedeeld (Deno) | [`_shared/facturatie/factuur-pdf-renderer.ts`](../../supabase/functions/_shared/facturatie/factuur-pdf-renderer.ts) | `naarFactuurPdfInput` — dunne renderer naar PDF-input |
| Gedeeld (Deno) | [`_shared/pakbon/`](../../supabase/functions/_shared/pakbon/) | `bouwPakbonDocument`/`genereerPakbonPDF` — het Pakbondocument (zie CONTEXT.md) |
| Frontend-module | `frontend/src/modules/facturatie/` | Facturen-overzicht, factuur-detail, BTW-banners, CBS/verkoopoverzicht-export |
| Frontend-shim | [`frontend/src/lib/orders/btw.ts`](../../frontend/src/lib/orders/btw.ts) | Cross-root re-export van `_shared/btw.ts` (ADR-0033) |

## Geldende ADR's & specs

- [ADR-0005](../adr/0005-pickronde-sluit-de-factuur-keten.md) — `voltooi_pickronde` flipt `orders.status='Verzonden'`, wat de factuur-trigger sluit
- [ADR-0007](../adr/0007-facturatie-als-deep-module.md) — facturatie geconsolideerd tot één frontend-module + event-driven trigger op `order_events`
- [ADR-0010](../adr/0010-factuur-volgt-bundel-zending.md) — `factuurvoorkeur='per_zending'` volgt de bundel-zending; het "1 zending = 1 factuur"-deel is **superseded door ADR-0041** (de drempel-toets blijft wél bundel-breed)
- [ADR-0041](../adr/0041-facturen-per-order-bij-bundel-zending.md) — facturen per order bij een bundel-zending: granulariteit `(zending_id, order_id)`, mig 578 (zie de bedrijfsregel-sectie hieronder)
- [ADR-0022](../adr/0022-betaaltermijn-en-per-zending-factuur-volgt-bundel-rpc.md) — betaaltermijn uit `betaalcondities`-tabel + per_zending-factuur volgt de bundel-RPC (verzendkosten-drempel/bundeling per factuur)
- [ADR-0036](../adr/0036-factuurdocument-als-deep-module.md) — Factuurdocument als deep module: één opgeloste factuur voor PDF én EDI-INVOIC (zie CONTEXT.md voor de begripsdefinitie)
- Plan: [2026-06-18-factuur-concept-fase-uitgestelde-verzending.md](../superpowers/plans/2026-06-18-factuur-concept-fase-uitgestelde-verzending.md) — de concept/finalisatie-split
- Plan: [2026-06-14-factuurdocument-deep-module.md](../superpowers/plans/2026-06-14-factuurdocument-deep-module.md) — uitvoeringsplan bij ADR-0036
- Plan: [2026-05-15-factuur-betaaltermijn-en-bundel-verzendkosten.md](../superpowers/plans/2026-05-15-factuur-betaaltermijn-en-bundel-verzendkosten.md) — betaaltermijn + bundel-verzendkosten (ADR-0022)
- Plan: [2026-06-03-edi-factuur-uitgaand.md](../superpowers/plans/2026-06-03-edi-factuur-uitgaand.md) — EDI-INVOIC uitgaand

## Bedrijfsregels (huidige staat)

### Factuur-queue: twee bronnen, één drain

- Een order krijgt automatisch een `factuur_queue`-rij via twee onafhankelijke paden: **event-driven** (`enqueue_factuur_voor_event`, reageert op `order_events` `'pickronde_voltooid'` **én** `'deels_verzonden'` — mig 473-475 breidde de conditie uit zodat een deelzending niet meer wacht tot de hele order compleet is, met een `ON CONFLICT (zending_id)`-guard tegen een dubbele regel bij latere order-completion) en **wekelijkse cron** (`enqueue_wekelijkse_verzamelfacturen`, maandag 05:00 UTC, mig 122/231).
- De queue-drain `factuur-verzenden` is **2-fasen** (mig 428): fase 1 `verwerk_concept_queue()` projecteert Concept-facturen voor nieuwe `per_zending`-rijen zonder `factuur_id` (geen vertraging, race-safe `FOR UPDATE SKIP LOCKED`); fase 2 `claim_factuur_queue_items` claimt alleen rijen die ófwel al een concept hebben ófwel geen `zending_id` dragen (wekelijks/legacy), én waarvan `beschikbaar_op IS NULL OR <= now()`.
- Idempotent tegen mail-retry: `factuur_queue.gefinaliseerd_op` (mig 428) markeert of `finaliseer_concept_factuur` al gedraaid heeft — bij een mislukte mail wordt alleen herverstuurd, nooit opnieuw gefinaliseerd (voorkomt `no_data_found` bij een lege her-projectie en dubbele kortingsregels).
- Wekelijkse/legacy queue-rijen (`zending_id IS NULL`) lopen nog via het oude directe pad (`genereer_factuur_voor_week`/`genereer_factuur`, geen concept-fase).

### Verzend-vertraging (mig 423)

- Een `per_zending`-factuur wordt **niet** direct gemaild — `factuur_queue.beschikbaar_op = now() + app_config.facturatie.vertraging_minuten` (default **120 minuten**), tunebaar zonder migratie.
- Geldt alléén voor het event-driven `per_zending`-pad. De wekelijkse cron (`beschikbaar_op` blijft NULL) en retries (`beschikbaar_op` al in het verleden) worden direct opgepakt.
- Reden: correcties in het vertragingsvenster (bv. een laatste regel toegevoegd) gaan mee, omdat `finaliseer_concept_factuur` altijd een verse projectie doet vóór de side-effects.

### Concept-fase: projectie versus finalisatie (mig 428)

- **`projecteer_concept_factuur(zending, factuur_id?)`** is herhaalbaar en side-effect-vrij: nieuw óf `DELETE factuur_regels` + herbouw op een bestaande factuur. Zet de factuur direct op **Concept** zodra de queue-rij bestaat — zichtbaar in de facturatie-module vóórdat de vertraging is verstreken.
- **`finaliseer_concept_factuur(zending, factuur_id)`** doet een verse projectie en dán de onomkeerbare stappen: `order_regels.gefactureerd`-flip + `BUNDELKORTING`/`DREMPELKORTING`-factuurregels (1-op-1 gespiegeld uit de kortingsberekening, geen aparte v_vk-afleiding).
- **Deploy-volgorde:** migratie + edge function ~samen deployen. Tussen de twee in claimt de oude drain geen `per_zending`-rijen (`factuur_id` blijft NULL zolang de nieuwe fase-1-RPC nog niet draait).
- Sinds **mig 550** is `projecteer_concept_factuur` herschreven als superset van mig 532 (toeslag op `created_at`-venster + procent-snapshot) — een eerdere overschrijving in mig 529/532 liet de `bepaal_btw_regeling`-aanroep wegvallen (drift-patroon: `CREATE OR REPLACE` zonder de vorige body als basis). Bij elke volgende wijziging aan deze RPC: de volledige mig-550-body als basis nemen, niet een oudere versie.

### Facturen per order bij bundel-zending (ADR-0041, mig 578, 2026-07-02)

- Klanteis: orders die fysiek gebundeld verzonden worden (Combi-levering/Bundel-Zending) krijgen **elk een eigen factuur** — factuur-granulariteit is `(zending_id, order_id)` op `factuur_queue` (dedup-index verschoven van alleen `zending_id`). Elke order: eigen concept-factuur, finalisatie, mail/EDI-INVOIC. De pakbon blijft gebundeld (was al per-order-gegroepeerd); elke order-factuur krijgt dezelfde bundel-pakbon als bijlage.
- **Drempel-toets blijft bundel-breed** (ADR-0010's motief) en is **finalisatie-volgorde-onafhankelijk**: de grondslag komt in het order-scoped pad uit `order_regels.bedrag` over álle orders van de zending, **zonder** gefactureerd-filter — mét filter zou een eerder gefinaliseerde order-factuur de grondslag van een latere verlagen en de korting-uitkomst van de volgorde afhangen.
- **Bewuste gedragscorrectie (geen neutraliteit):** een zusterorder krijgt alleen BUNDELKORTING als hij zélf een VERZEND-regel draagt — het oude bundel-pad crediteerde élke zusterorder (korting voor nooit-gefactureerde kosten; €210 te weinig op een echte 8-order-zending, zie ADR-0041). De som van N per-order-facturen kan bovendien op centen afwijken van de oude ene factuur door per-factuur-BTW-afronding.
- **`order_id IS NULL`-pad = legacy-gedrag** (alle orders op 1 factuur): behouden voor in-flight queue-rijen van vóór mig 578 én als deploy-window-vangnet — `finaliseer_concept_factuur` valt bij `p_order_id IS NULL` terug op een `factuur_queue`-lookup op `factuur_id`, zodat een oude edge-function-aanroep maar 1 order flipt, niet de hele bundel. Deploy-volgorde: **mig 578 vóór de edge-deploy**.
- Wekelijks pad (`genereer_factuur_voor_week`) onaangeroerd — alle 135 combi-klanten staan op `factuurvoorkeur='per_zending'` (live gecheckt 02-07).

### Pakbon bij de factuurmail

- `factuur-verzenden` hangt per zending die de factuur dekt (per_zending = 1 zending, wekelijks = N, via `zending_orders` op de gefactureerde orders) een pakbon-PDF aan — gerenderd door de gedeelde `_shared/pakbon/`-laag (`bouwPakbonDocument` → `genereerPakbonPDF`, pdf-lib; hetzelfde Pakbondocument als de geprinte pakbon).
- **Sinds 2026-06-25 (geen migratie, alleen `factuur-verzenden/index.ts`): factuur en pakbon gaan in twee gescheiden mails**, niet meer als bijlage bij dezelfde factuurmail. De factuurmail bevat alléén de factuur-PDF (en géén algemene voorwaarden meer); de pakbonmail bevat uitsluitend de pakbon-PDF('s) en gaat **altijd** uit (niet meer alleen bij een afwijkend adres). Ontvanger van de pakbonmail: `debiteuren.email_pakbon`, terugval `email_factuur` (`email_verzend` zit niet meer in de terugvalketen). Zie [changelog 2026-06-25](../changelog.md) ("Factuur- en pakbonmail gesplitst in twee aparte e-mails").
- Beide kanten zijn **best-effort**: ontbrekende zending/colli of een render-/mailfout op de pakbon wordt gelogd en overgeslagen — de factuurmail (al verstuurd) mag nooit alsnog retryen op een pakbonfout, dat zou een dubbele factuurmail betekenen. Pakbon best-effort geüpload naar `facturen/{debiteur_nr}/pakbon/{zending_nr}.pdf` als e-mailtijdlijn-referentie.
- Send + e-mailtijdlijn-log (`verstuurde_emails`) + rauwe-payload-audit (`externe_payloads`) lopen via één lokale seam `verstuurEnLog()` in `factuur-verzenden/index.ts` (3 call-sites: factuur-debiteur, betaler-kopie, pakbon).

### BTW-tarief: debiteur-niveau fallback (mig 371)

- `debiteuren.btw_verlegd_intracom` bepaalt het klant-niveau-fallbacktarief: verlegd → 0%, anders `debiteuren.btw_percentage` (NL-tarief, standaard 21%). SQL `effectief_btw_pct` ↔ TS `effectiefBtwPct`/`isBtwVerlegd` (`_shared/btw.ts`).
- Ontbrekend BTW-nummer bij een verlegde debiteur blokkeert **niet** (bewuste keuze) — amber waarschuwing op de klant-facturering-tab + script `import/check_verlegd_zonder_btw_nummer.py`.
- Deze vlag is sinds mig 550 **niet meer** de doorslaggevende factor voor EU-leveringen (zie hieronder) — ze blijft wel data voor de ICP-opgave.

### BTW-regeling per order/factuur, afleverland-bewust (mig 454-456, herzien mig 550)

`bepaal_btw_regeling(afl_land, debiteur_land, afhalen, verlegd_vlag, btw_nummer, btw_pct)` — SQL, gespiegeld door `bepaalBtwRegeling` in `_shared/btw.ts` — combineert het effectieve afleverland (`orders.afl_land`, fallback `debiteuren.land`; bij `afhalen=true` altijd `debiteuren.land`) tot **drie** regelingen:

| Regeling | Tarief | Blokkade |
|---|---|---|
| `nl_binnenland` | debiteur-fallback (zie boven) | geen — geldt ook bij **leeg land op order én debiteur** (62% van de actieve debiteuren, legacy NL-klanten; bewust geen blokkade) |
| `eu_b2b_icl` | 0% | geen hard-block; **advisory** als het debiteur-btw-nummer ontbreekt (voor de ICP-opgave) |
| `export_buiten_eu` | 0% (mits exportbewijs) | **hard-block** — geen exportbewijs-tracking, dus altijd menselijke bevestiging nodig |

- **Mig 550-correctie (2026-07-02, DECOR-UNION-incident):** de vierde regeling `eu_b2b_binnenland_afwijking` (EU-land maar `btw_verlegd_intracom=FALSE`) is **vervallen**. Elke levering aan een andere EU-lidstaat is voor Karpi (uitsluitend B2B) per definitie een ICL (art. 9(2)(b) Wet OB 1968) — het afleverland is objectiever dan de handmatige debiteur-checkbox, die foutief kon staan. `is_eu_land`/`isEuLand`: hardcoded 27-lidstatenlijst, **CH/NO/GB bewust non-EU**.
- `HARD_BLOCK_REGELINGEN` (`_shared/btw.ts`) bevat na mig 550 dus alleen nog `export_buiten_eu`.
- **De blokkade zit in `factuur-verzenden/index.ts`, niet in de factuur-aanmaak-RPC's.** `projecteer_concept_factuur`/`finaliseer_concept_factuur`/de legacy `genereer_factuur(_voor_week)` zetten de gate-kolommen (`facturen.btw_controle_nodig_sinds`, `btw_regeling`) **altijd**, ook bij een hard-block-regeling — de factuur wordt dus **altijd aangemaakt** (zichtbaar als Concept met de banner). Pas ná het aanmaken en vóór het versturen van mail/EDI checkt `factuur-verzenden` `HARD_BLOCK_REGELINGEN` en gooit een fout (queue-rij retryt, factuur blijft Concept). **Correctie-geschiedenis:** de eerste versie liet de RPC's zelf `RAISE EXCEPTION` doen vóór de INSERT — dan ontstond bij een blokkade helemaal géén factuur, alleen een onzichtbare `factuur_queue.last_error`, dus de banner was onbereikbaar. Vandaar de verplaatsing naar de edge function.
- Twee uitwegen: het afleverland/btw-nummer corrigeren (de gate wist zichzelf bij een volgende her-projectie) of `markeer_btw_regeling_geaccepteerd(factuur_id)` (bewuste bevestiging, wist de gate zonder data te wijzigen — een latere her-projectie kan 'm opnieuw zetten). UI: `BtwControleNodigBanner` op factuur-detail + banner/filter op het facturen-overzicht.
- Scope bewust niet meegenomen: VIES-validatie, OSS/particulierenregeling (Karpi is vrijwel uitsluitend B2B), exportbewijs-documentatie, ICP-automatisering, binnenlandse-verlegging (niet relevant voor tapijt-groothandel).

### Wekelijkse verzamelfactuur (mig 231-232)

- Debiteuren met `factuurvoorkeur='wekelijks'` (mig 117) krijgen op maandag 05:00 UTC één factuur per `(debiteur, ISO-week)`. `enqueue_wekelijkse_verzamelfacturen` groepeert orders waarvan `verzendweek_voor_datum(afleverdatum)` = de vorige ISO-week, met dubbele-vuur-bescherming via `NOT EXISTS` op pending/processing/done queue-rijen voor diezelfde `(debiteur, week)`.
- `genereer_factuur_voor_week(debiteur_nr, jaar_week)` volgt het no-op-guard-patroon (ADR-0022) en voegt **per bundel-zending** van die week één VERZEND-factuurregel toe — twee vervoerders in dezelfde week = twee verzendkosten-regels (elk mits onder de drempel).
- Drempel-toets per bundel: `gratis_verzending=TRUE` op de debiteur, of bundel-subtotaal ≥ `verzend_drempel` → verzendbedrag 0.
- Drempel-logica voor `per_zending`-facturen staat sinds ADR-0022 wél in `projecteer_concept_factuur` (via `verzendkosten_voor_bundel`) — voor `wekelijks` blijft dat het losstaande, oudere legacy-pad.

### EDI-mail-gate

- Een debiteur met `edi_handelspartner_config.factuur_uit=TRUE` én `transus_actief=TRUE` krijgt **uitsluitend** de EDI-INVOIC, géén factuur-e-mail (`ediFactuurActief`-gate in `factuur-verzenden`; `verstuurd_naar='EDI Transus'`). Geldt niet voor de pakbonmail — die volgt de eigen `email_pakbon`/`email_factuur`-ladder, ongeacht het EDI-kanaal van de factuur zelf.

### RG-Anschrift bij EDI-partners: volledige juridische naam vereist (2026-07-02, SB Möbel Boss/Porta)

- Klant Porta (crediteurenadministratie van de SB-Möbel-BOSS-keten) keurde 7 EDI-facturen af wegens "falsche RG-Anschriften": `debiteuren.fact_naam` voor debiteur 150761 stond op de handelsnaam "SB MÖBEL BOSS", terwijl de klant een bijgeleverde GLN/Rechnungsanschrift-lijst gebruikt waarin de invoicee-naam de **volledige juridische naam** is ("SB Möbel Boss Handelsgesellschaft mbH & Co.KG") — GLN en BTW-nummer klopten al exact. Les: bij een EDI-INVOIC-afkeuring op naam/adres eerst de klant om hun officiële GLN/Rechnungsanschrift-referentielijst vragen in plaats van te gissen — het adres kan al kloppen terwijl alleen de bedrijfsnaam een afkorting/handelsnaam is i.p.v. de statutaire naam.
- Fix was zuiver een stamdata-correctie (`debiteuren.fact_naam`), geen code-wijziging — zie Valkuilen hieronder voor de handmatige stappen om al-verstuurde facturen alsnog te corrigeren.

### Factuurdocument als deep module (ADR-0036)

- Eén canoniek **Factuurdocument** (`fetchFactuurDocument`, zie CONTEXT.md) voedt drie dunne renderers: `naarFactuurPdfInput` (factuur-PDF, zowel on-demand `factuur-pdf` als de PDF in `factuur-verzenden`) en `naarInvoiceInput` (EDI-INVOIC, zowel automatisch via `factuur-verzenden` als handmatig via `bouw-factuur-edi` — **vervangt** de vroegere twee losse mappers, die niet meer bestaan).
- De **orderbevestiging** (`stuur-orderbevestiging`) deelt alléén de Artikelpresentatie-resolver (`resolveKarpiCode`) en de `btw.ts`-seam, maar houdt een **eigen document** — ander lifecycle-moment (order-tijd, leest `order_regels`, er is nog geen factuur, 4-talige vertaling). Dit is bewust géén gedeelde documentlaag met het Factuurdocument.
- **Deploy-fan-out:** `factuur-verzenden`, `bouw-factuur-edi`, `factuur-pdf` en `stuur-orderbevestiging` delen `_shared/facturatie/` — een wijziging aan die map vereist het herdeployen van **alle vier**.
- Vangnet: pure-functie-tests in `_shared/facturatie/*.test.ts` (o.a. `factuur-invoice-renderer.test.ts` met een inline golden-achtige `KarpiInvoiceInput`-assertie) — geen aparte golden-fixture-JSON zoals bij `bundel-sleutel`/`normaliseer-land`.

## Valkuilen & gotcha's

- **`btw_verlegd_intracom` (debiteur-vlag) is niet meer de bron voor het EU-BTW-tarief.** Sinds mig 550 bepaalt het **afleverland** de regeling voor EU-bestemmingen (altijd `eu_b2b_icl`, 0%); de vlag blijft alleen data voor de ICP-opgave. Zet 'm dus niet handmatig aan/uit om een factuur-tarief te "fixen" — corrigeer het afleverland of accepteer de regeling via de banner.
- **`eu_b2b_binnenland_afwijking` bestaat niet meer als regeling** (mig 550) — kom je die term nog tegen in oudere code/labels (bv. het `REGELING_LABEL`-record in `btw-controle-nodig-banner.tsx`), dan is dat dode/legacy tekst, geen actief pad.
- **De BTW-hard-block zit in de edge function, niet in de RPC.** Een factuur met `export_buiten_eu` wordt altijd aangemaakt (Concept) — als je zoekt naar "waarom faalt de factuur-aanmaak", kijk niet in `projecteer_concept_factuur`/`finaliseer_concept_factuur`, die falen hier nooit op. De blokkade (mail/EDI tegenhouden) zit in `factuur-verzenden/index.ts`, ná de aanmaak.
- **Niet te verwarren: "vertraging" (mig 423) versus "concept-fase" (mig 428).** De vertraging (`beschikbaar_op`) bepaalt **wanneer** een `per_zending`-factuur verstuurd wordt; de concept-fase bepaalt **wanneer** de factuur-rij zelf zichtbaar wordt (altijd meteen, als Concept). Vóór mig 428 vielen die twee samen (niets zichtbaar tot de vertraging voorbij was) — dat was zelf de bug (ORD-2026-0614/0620) die mig 428 oploste.
- **Niet te verwarren: de pakbon-bijlage bij de factuurmail (mig 423) is achterhaald.** Sinds 2026-06-25 is de pakbon een **losse mail**, geen bijlage meer bij de factuurmail. Documentatie/comments die nog "pakbon als bijlage" beschrijven (incl. de mig-496-code-comment zelf) zijn bewust niet aangepast maar gedragsmatig achterhaald — het changelog van 2026-06-25 is de bron van waarheid.
- **Niet te verwarren: `factuur_queue.beschikbaar_op` (mig 423, facturatie) versus `verzend_wachtrij.beschikbaar_op` (mig 484, Rhenus-dagbatch).** Twee losse queues met hetzelfde gate-patroon voor een ander domein (facturatie-vertraging vs. vervoerder-dagbatch) — geen gedeelde kolom of trigger.
- **Bewust buiten scope (ADR-0036):** de factuur-generatie zelf (welke regels, welk bedrag, korting/drempel-opbouw) is géén onderdeel van het Factuurdocument-ADR — dat ADR raakt alleen hóe bestaande `factuur_regels` naar buiten gerenderd worden. De verzendkosten-drempel-logica (frontend `applyShippingLogic` vs. SQL `verzendkosten_voor_bundel`) is een aparte, nog niet geconsolideerde frictie.
- **Bewust buiten scope (mig 454-456/550):** VIES-validatie van het btw-nummer, OSS/particulierenregeling, exportbewijs-documentatie, ICP-automatisering, binnenlandse-verlegging.
- **Deploy-volgorde mig 428:** de migratie en de nieuwe `factuur-verzenden`-versie moeten ~gelijktijdig deployen — in het tussenliggende venster claimt de oude drain geen `per_zending`-rijen (geen dataverlies, wel een tijdelijke vertraging in de verwerking).
- **Retry-veiligheid hangt aan `gefinaliseerd_op`, niet aan `factuur_id`.** Een `factuur_id` kan al gezet zijn zonder dat de factuur al gefinaliseerd is (het concept uit fase 1) — check bij het debuggen van een "dubbele kortingsregel"-melding altijd of `gefinaliseerd_op` per ongeluk leeg is gebleven vóór een tweede finalisatie-poging.
- **`maak_creditfactuur` is mail-only — geen EDI-creditnota.** `stuur-creditfactuur` verstuurt uitsluitend een PDF per e-mail; er bestaat geen EDI-berichttype voor een creditnota (`edi_berichten.berichttype` staat vast op `order`/`orderbev`/`factuur`/`verzendbericht`) en het `creditNoteFlag`-veld in `karpi-invoice-fixed-width.ts` staat hardcoded op `'N'` — bewust zo gelaten in mig 467 ("vereist eerst afstemming met Transus over hun exacte credit-spec", nooit opgepakt). De "Verstuur via EDI"-knop op factuur-detail checkt niet of een factuur een creditnota is (`isCreditnota` zit niet in de zichtbaarheidsconditie) — klik 'm nooit op een creditnota, dat bouwt een INVOIC met een fout `creditNoteFlag` én een negatief bedrag dat `formatAmount()`/`padLeft` corrumpeert tot een ongeldig fixed-width veld.
- **Geen RPC voor "herfactureer na creditnota".** Na een volledige creditnota via `maak_creditfactuur` blijft `order_regels.gefactureerd = orderaantal` staan (de RPC reset dat nergens) én bezetten de oude `factuur_regels`-rijen nog steeds hun `order_regel_id` (unieke index `idx_factuur_regels_order_regel`). Om de order opnieuw te kunnen factureren met `genereer_factuur`/`projecteer_concept_factuur` moet je handmatig (a) `order_regels.gefactureerd` terugzetten voor precies de regels van de gecrediteerde factuur en (b) de oude `factuur_regels.order_regel_id` naar `NULL` zetten — anders knalt de nieuwe factuur-insert op de unieke index. `maak_creditfactuur` kopieert bovendien `fact_naam` van het origineel, dus een creditnota op een factuur met een foute naam heeft zelf ook een handmatige naam-correctie nodig.
- **Mogelijke regressie: creditnota zet origineel niet meer op `status='Gecrediteerd'`.** Mig 504/517 deden dat nog wel; de herschrijvingen in mig 518-520 (`CREATE OR REPLACE FUNCTION maak_creditfactuur`, telkens de hele body vervangen i.p.v. incrementeel gewijzigd) laten die UPDATE stilzwijgend weg — een gecrediteerde factuur is nu alleen herkenbaar via de omgekeerde koppeling (`facturen.credit_voor_factuur_id` op de creditnota), niet via de eigen status. Nog niet gefixt (2026-07-02) — check bij twijfel altijd `credit_voor_factuur_id`, niet `status`.

## Openstaand / V2

- **EDI-creditnota-ondersteuning** (afstemming met Transus over hun credit-spec, mig 467) én een **RPC voor "herfactureer na creditnota"** (reset `order_regels.gefactureerd` + loskoppel `factuur_regels.order_regel_id` in één transactie) — nu handmatig SQL per geval (zie Valkuilen, incident 2026-07-02). De `status='Gecrediteerd'`-regressie (mig 518-520) ook nog op te lossen.
- Drempel-logica voor `per_zending`-facturen is via ADR-0022 al gebouwd (`verzendkosten_voor_bundel`); voor `wekelijks` staat een vergelijkbare aanscherping nog op de V2-backlog (het legacy-pad `genereer_factuur_voor_week` is ongewijzigd sinds mig 232).
- De dode legacy-dispatch in `factuur-verzenden` (`type='wekelijks'`/`per_zending`-takken die naar gedropte RPC's verwezen vóór mig 240/428) is expliciet bewust-buiten-scope gehouden in ADR-0036 — nog niet opgeruimd.
- VIES-validatie, OSS/particulierenregeling, exportbewijs-tracking, ICP-automatisering: geen van alle gebouwd (mig 454-456/550, bewust scope-begrensd op B2B-tapijtgroothandel).
