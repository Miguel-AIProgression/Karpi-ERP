# Order-lifecycle — statusmodel, gates en flow

> **Levend document** (aangemaakt 2026-06-10). Dit is de toetssteen voor elke wijziging
> die de order-flow raakt: statussen, transities, gates, intake, productie, magazijn.
> Werk het bij wanneer een migratie een transitie/gate toevoegt of wijzigt.
> Vuistregel bij RPC's: de actuele body staat in `supabase/schema/functies.sql`
> (of via `pg_get_functiondef` op de live DB) — NIET in de migratiebestanden;
> zie §3.3. "Hoogst-genummerde migratie wint" is onbetrouwbaar gebleken
> (hernummeringen bij merges — audit 2026-07-02).

## 1. De hoofdflow

```
INTAKE (5 kanalen)              DEKKING                    PRODUCTIE (maatwerk)         MAGAZIJN                      EIND
─────────────────              ────────                   ────────────────────         ─────────                     ────
EDI / Shopify / Lightspeed  →  Klaar voor picken     →    Wacht op maatwerk        →   In pickronde             →    Verzonden
e-mail (→ Concept eerst)       ↕ Wacht op voorraad        (snijplan: Wacht → … →       Deels verzonden               Geannuleerd (cascade)
handmatig (order-form)         ↕ Wacht op inkoop          Ingepakt)                    (zending: Picken →            Maatwerk afgerond
                               (herbereken_wacht_status)                               Klaar voor verzending →       (alleen productie-only)
                                                                                       Onderweg)
```

- **Standaardmaat-regel**: dekking via `order_reserveringen` (voorraad- of IO-claims);
  pickbaar zodra claims de regel dekken.
- **Maatwerk-regel**: krijgt automatisch een Snijplan per stuk (`auto_maak_snijplan`);
  pickbaar pas als álle snijplannen `'Ingepakt'` zijn.
- **Productie-only order** (`alleen_productie=true`): doet alléén snijden + confectie,
  eindigt in `Maatwerk afgerond`, nooit in Pick & Ship/facturatie (afhandeling in Basta).

## 2. Order-statussen

Enum `order_status` (snapshot geborgd door mig 350, opvolger mig 568). Drie categorieën:

| Status | Categorie | Sinds | Betekenis / eigenaar |
|---|---|---|---|
| `Concept` | canoniek | mig 308 | E-mail-orders in review; allocator/snijplan **gegate** tot bevestiging |
| `Klaar voor picken` | canoniek | mig 257 | Default-landing (mig 275) én "alles gedekt"-doelstatus |
| `Wacht op voorraad` | canoniek | base | ≥1 regel met tekort zonder IO-claim |
| `Wacht op inkoop` | canoniek | mig 144 | ≥1 actieve IO-claim |
| `Wacht op maatwerk` | canoniek | mig 257 | ≥1 maatwerk-regel zonder snijplan `'Ingepakt'` |
| `Wacht op combi-levering` | canoniek | mig 563 (ADR-0040) | Klant wacht op de vrachtvrije-drempel over meerdere orders naar hetzelfde adres (`combi_levering_status`); laagste prioriteit in de ladder, kan ook demoveren vanuit `Klaar voor picken`; blokkeert Pick & Ship (mig 566) én `start_deelzending` (mig 573 — de bedoelde ontsnappingsroute is de order-override, niet een deelzending), niet productie |
| `In pickronde` | canoniek | mig 257 | Zending in `'Picken'`; command-beheerd (mig 258) |
| `Deels verzonden` | canoniek | mig 257 | ≥1 zending verzonden, ≥1 open |
| `Verzonden` | **terminaal** | base | Laatste open zending voltooid |
| `Geannuleerd` | **terminaal** | base | `markeer_geannuleerd` + event-cascade (§5) |
| `Maatwerk afgerond` | **terminaal** | mig 327 | Alleen productie-only; alle snijplannen geconfectioneerd |
| `Nieuw` | legacy | base | **Deprecated sinds mig 275** — mig 309/312 schreven hem per ongeluk weer bij EDI-intake (regressie); definitief gestopt in mig 357 |
| `Klaar voor verzending` | legacy | — | Opgeruimd in mig 218 (CHECK-constraint blokkeert) |
| `In productie` | legacy* | — | *Hergebruikt als initiële status van productie-only import (mig 329) |
| `Actie vereist`, `In snijplan`, `Deels gereed`, `Wacht op picken` | legacy | — | Getolereerd, nooit geschreven |

UI-kleuren: [`constants.ts`](../frontend/src/lib/utils/constants.ts).

## 3. Het ene schrijfpad: `_apply_transitie`

**Regel (mig 218):** elke wijziging van `orders.status` loopt via
`_apply_transitie(order_id, event_type, status_na, …)` — die schrijft de status,
zet `verzonden_at` bij `'Verzonden'`, en logt een `order_events`-rij. Listeners
haken op `order_events`, nooit op de status-kolom (ADR-0006/0015-patroon).
Afgedwongen door [`scripts/lint-no-direct-orders-status-update.sh`](../scripts/lint-no-direct-orders-status-update.sh)
(sinds deze branch ook over `migrations/3*.sql` en hoger).

### 3.1 Command-RPC's (allemaal via `_apply_transitie`)

| RPC | Transitie | Guard | Bron |
|---|---|---|---|
| `markeer_verzonden` | → `Verzonden` | faalt op `Geannuleerd` | mig 218 |
| `markeer_geannuleerd` | → `Geannuleerd` | faalt op `Verzonden` | mig 218 |
| `markeer_pickronde_gestart` | → `In pickronde` | no-op op pickronde-fases; faalt op eindstatus | mig 258 (mig 571: + `herbereken_wacht_status`-cascade ná de transitie) |
| `markeer_deels_verzonden` | → `Deels verzonden` | idem | mig 258 |
| `herbereken_wacht_status` | → Wacht-op-X / `Klaar voor picken` | zie §4 | mig 565 (laatste; ADR-0040-groep-cascade) |
| `voltooi_confectie` (na-stap) | → `Maatwerk afgerond` | alleen `alleen_productie=true` + alle snijplannen afgerond | mig 348 |
| `bevestig_concept_order` | `Concept` → `Klaar voor picken` | faalt als status ≠ `Concept` | mig 354 |

### 3.2 Bekende uitzonderingen op het ene schrijfpad ⚠️

| Plek | Wat | Status |
|---|---|---|
| [`330_voltooi_confectie_maatwerk_afgerond.sql:80`](../supabase/migrations/330_voltooi_confectie_maatwerk_afgerond.sql) | directe `UPDATE orders SET status='Maatwerk afgerond'` | **Opgelost in mig 348** (via `_apply_transitie` + event `maatwerk_afgerond`) |
| [`308_concept_order_status.sql:126`](../supabase/migrations/308_concept_order_status.sql) | `bevestig_concept_order`: directe `UPDATE` + events-INSERT op **niet-bestaande kolom `actor`** (crashte bij elke bevestiging) | **Opgelost in mig 354** (via `_apply_transitie`; bevinding B3) |
| `import_productie_only_order` (mig 329) | directe INSERT met status `'In productie'` | bewust: legacy-status, `herbereken` raakt hem niet aan |

### 3.3 Welke functie-body is actueel?

**Kijk NOOIT in `supabase/migrations/` voor de actuele body van een functie**
— dezelfde functie is daar tot 16× herdefinieerd (`genereer_factuur`), de
bestandsnummers lopen niet 1-op-1 met de toepassingsvolgorde (hernummeringen
bij merges), en de handmatige RPC→migratie-tabel die hier stond was zelf
verouderd voor 7 van de kern-RPC's (audit 2026-07-02 — o.a.
`herbereken_wacht_status` stond op mig 352 terwijl mig 468/470 de live body
droegen; `create_order_with_lines` op 275 terwijl 481/542 wonnen). Precies zo
ontstond de mig-428-BTW-regressie: een nieuwe RPC herbouwde een oude
migratie-body i.p.v. de live versie.

De canonieke bron is de gegenereerde snapshot:

    supabase/schema/functies.sql + views.sql
    (ververs met: node scripts/dump-schema.mjs)

Ad-hoc één functie checken kan ook rechtstreeks:
`supabase db query --linked -o json "SELECT pg_get_functiondef(p.oid) FROM
pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE
n.nspname='public' AND p.proname='<functie>'"` — maar werk NOOIT vanaf een
migratiebestand. Wie een functie wijzigt: nieuwe migratie schrijven **vanaf
de live/snapshot-body**, applyen (`supabase db query --linked -f`), snapshot
verversen, beide committen. Migratiebestanden zijn write-once-geschiedenis
(het "waarom"); de snapshot is de actuele staat (het "wat"). De per-RPC-
wijzigingsgeschiedenis blijft vindbaar via `git log -S <functienaam> --
supabase/migrations/` en docs/changelog.md — een handmatige tabel is niet
meer nodig (bewijs: de laatste versie ervan miste 7 kern-RPC's en werd één
dag na de audit alweer ingehaald door mig 565/572/573).

## 3.4 Trigger-landschap op `order_regels` (live geverifieerd 2026-07-02)

Een `INSERT`/`UPDATE`/`DELETE` op `order_regels` kan tot **10** triggers laten
vuren. AFTER-triggers vuren alfabetisch op triggernaam — let op:
`trg_order_regels_…` sorteert vóór `trg_orderregel_…`. Volledige lijst
(bron: `pg_trigger` op de live DB; definities in `supabase/schema/functies.sql`):

| Trigger | Vuurt op |
|---|---|
| `order_regels_sync_unmatched` | AFTER I/D/U OF `artikelnr` |
| `order_regels_totalen` | AFTER INSERT/DELETE/UPDATE |
| `order_regels_updated_at` | BEFORE UPDATE |
| `trg_auto_maatwerk` | BEFORE INSERT |
| `trg_auto_snijplan` | AFTER INSERT |
| `trg_auto_sync_snijplan_maten` | AFTER UPDATE OF `maatwerk_lengte_cm`, `maatwerk_breedte_cm`, `is_maatwerk` |
| `trg_lock_orderregel_vervoerder` | BEFORE UPDATE OF `vervoerder_code` (guard, blokkeert) |
| `trg_order_regels_maatwerk_kw_fallback` | BEFORE INSERT/UPDATE |
| `trg_order_regels_prijs_gate` | AFTER I/D/U OF `prijs`, `korting_pct`, `artikelnr` |
| `trg_orderregel_herallocateer` | AFTER INSERT/DELETE/UPDATE (élke kolom) → `herallocateer_orderregel` → claims + `herwaardeer_order_status` |

Wie een orderregel-UPDATE debugt: dit is de volledige set — een agent die er
maar één of twee kent, mist cascades.

## 4. `herbereken_wacht_status` — beslislogica (mig 564/565, ADR-0040)

Volgorde, eerste match wint:

1. **No-touch**: huidig ∈ {`Concept`, `Verzonden`, `Geannuleerd`, `Klaar voor verzending`,
   `In productie`, `In snijplan`, `Deels gereed`, `Wacht op picken`,
   `In pickronde`, `Deels verzonden`, `Maatwerk afgerond` (sinds mig 351)} → return.
   `Maatwerk afgerond` ontbrak t/m mig 275 (ouder dan mig 327) — regressie-pad
   naar `Wacht op maatwerk` bij elke orderregel-touch; zie bevinding B13.
   `'Wacht op combi-levering'` staat hier BEWUST niet in (mig 564) — moet
   herhaaldelijk herevalueerbaar blijven.
2. ≥1 actieve claim `bron='inkooporder_regel'` → `Wacht op voorraad` (mig 470-betekenis)
3. ≥1 niet-maatwerk, niet-admin-pseudo regel met `te_leveren > SUM(claims)` → `Wacht op inkoop` (mig 470-betekenis)
4. ≥1 maatwerk-regel zonder snijplan `'Ingepakt'` → `Wacht op maatwerk`
5. Klant wacht op de Combi-levering-drempel (`combi_levering_status.wacht_op_combi_levering`) → `Wacht op combi-levering` (mig 564, ADR-0040 — laagste prioriteit, kan ook demoveren vanuit `Klaar voor picken`)
6. Huidig ∈ {Wacht-op-X (incl. `Wacht op combi-levering`), `Nieuw`} → `Klaar voor picken`
7. Anders → no-op

Admin-pseudo-regels (`producten.is_pseudo`, ADR-0018) tellen nergens mee.
**Single-source sinds mig 346/352/470/540/564:** de beslislogica leeft in de pure functie
`derive_wacht_status` (SQL, laatste def mig 564) met TS-spiegel
[`derive-status.ts`](../supabase/functions/_shared/order-lifecycle/derive-status.ts)
en golden-fixture; `herbereken_wacht_status` verzamelt alleen nog de state en
delegeert. Wijzig de ladder dus in `derive_wacht_status` + TS-spiegel + golden,
nooit meer inline.

**Groep-cascade (mig 565, ADR-0040):** Combi-levering is — anders dan de drie
overige criteria — een groepsbeslissing (2D-sleutel debiteur_nr × genormaliseerd
afleveradres, `combi_levering_status`). `herbereken_wacht_status` herevalueert
daarom, ná de eigen-order-transitie, onvoorwaardelijk ook elke sibling in de
groep (`p_cascade_groep`, default TRUE), met `cascade=FALSE` in de recursieve
sibling-aanroep — geen cyclus mogelijk (max. recursiediepte 2).

**Callers van `herbereken_wacht_status`:** (1) elke claim-/orderregel-mutatie via
`herwaardeer_order_status` (mig 254-wrapper, ADR-0015); (2) sinds **mig 486** de
listener `trg_snijplan_herbereken_order_status` op `snijplannen` zodra een stuk de
`'Ingepakt'`-grens kruist (confectie→pick terugkoppeling — zie §8); (3) sinds
**mig 567** de twee Combi-levering-triggers (`trg_orders_combi_levering_override_fn`
cascade=TRUE, `trg_debiteuren_combi_levering_fn` cascade=FALSE — die loopt zelf al
over alle orders van de klant); (4) sinds **mig 571** `markeer_pickronde_gestart`,
ná de transitie naar `'In pickronde'` — zonder deze aanroep bleven achterblijvers
van een deels gestarte Combi-levering-groep stale `'Klaar voor picken'` tot de
gestarte order verzonden was; (5) sinds **mig 572** `update_order_with_lines`, aan
het eind van élke edit (eigen order + nieuwe groep), plús `herbereken_combi_groep`
voor de verlaten groep bij een adres-/debiteurwijziging. Zonder (2) bleef
een afgeronde maatwerk-order op `Wacht op maatwerk` staan terwijl hij al pickbaar was.

## 5. `order_events` — types en listeners

**Event-types** (mig 218 + 257 + 346): `aangemaakt`, `wacht_status_herberekend`,
`pickronde_gestart`, `deels_verzonden`, `pickronde_voltooid`, `geannuleerd`,
`backfill_fase_normalisatie`, `maatwerk_afgerond` (mig 347), plus domein-events
`claim_geswapt` (ADR-0027) en `levertijd_gewijzigd_door_eta` (mig 326).

**Listeners (triggers op `order_events`):**

| Trigger | Vuurt op | Doet | Bron |
|---|---|---|---|
| `trg_enqueue_factuur_op_event` | `pickronde_voltooid` + `status_na='Verzonden'` | factuur op queue (voorkeur per_zending/wekelijks) | mig 223 |
| `trg_order_events_reservering_release` | `geannuleerd` | alle actieve claims → `released` | mig 255 |
| `trg_order_events_snijplan_release` | `geannuleerd` | **alle** snijplannen → `'Geannuleerd'` (ongeacht voortgang) + rollen vrijgeven met NOT-EXISTS-guard | mig 290 |
| `trg_order_events_zending_release` | `geannuleerd` | verwijdert per zending met status `'Gepland'`/`'Picken'` de regels/colli van DE geannuleerde order; bundel-bewust (zending blijft bestaan met herberekende `aantal_colli`/`totaal_gewicht_kg` als een andere order 'm nog draagt) | mig 480 |

Listeners vuren onafhankelijk en moeten idempotent zijn. Nieuwe cascade-effecten =
nieuwe listener op `order_events`, géén edit in de command-RPC's.

## 6. Gates — "vraagt menselijke actie", los van status

| Gate | Kolom(men) | Gezet door | Gereset door | Predicaat-helper | Blokkerend? |
|---|---|---|---|---|---|
| EDI-leverweek "Te bevestigen" | `edi_bevestigd_op` (+ snapshot `edi_gewenste_afleverdatum`) | `create_edi_order` (NULL laten) | `markeer_order_edi_bevestigd` via [`EdiLeverweekBevestigen`](../frontend/src/components/orders/edi-leverweek-bevestigen.tsx) | [`edi-leverweek.ts`](../frontend/src/lib/orders/edi-leverweek.ts) | **Nee** — administratief (mig 310-gates teruggedraaid in mig 316 + pickbaarheid.ts) |
| Levertijd gewijzigd | `levertijd_wijziging_te_bevestigen_sinds` | `sync_order_afleverdatum_eta` bij ISO-week-verschuiving (mig 326) | `markeer_levertijd_herbevestigd` | [`levertijd-wijziging.ts`](../frontend/src/lib/orders/levertijd-wijziging.ts) | Nee — administratief; **herhaalbaar** (open/dicht) |
| Debiteur te bevestigen | `debiteur_zeker` + `debiteur_match_bron` | `create_webshop_order` bij fuzzy match (mig 322) | `bevestigDebiteur` of order-bewerken | [`intake-predicaten.ts`](../frontend/src/lib/orders/intake-predicaten.ts) | Nee — administratief (`env_fallback` telt bewust niet mee) |
| Concept (e-mail-review) | `status='Concept'` (status, geen kolom-gate) | `poll-email-orders` via `p_initieel_status` | `bevestig_concept_order` → `Klaar voor picken` | status-filter | **Ja** — allocator + snijplan gegate tot bevestiging (mig 308) |
| EDI "Te koppelen" | `edi_berichten.order_id IS NULL` (vóór order-bestaan) | `transus-poll` bij GLN-mismatch | `koppel_edi_afleveradres` / `koppel_edi_debiteur_alias` | [`te-koppelen.ts`](../frontend/src/modules/edi/lib/te-koppelen.ts) | n.v.t. — er ís nog geen order |
| Afleveradres ontbreekt | `afl_adres_incompleet_sinds` | BEFORE-trigger `trg_orders_afl_adres_gate` bij leeg afl_naam/adres/postcode/plaats (niet-afhaal, mig 395) | adres aanvullen (trigger wist auto) | [`afleveradres-gate.ts`](../frontend/src/lib/orders/afleveradres-gate.ts) | **Ja** — `start_pickronden` weigert via `_valideer_intake_gates`; herhaalbaar |
| Prijs ontbreekt | `prijs_ontbreekt_sinds` | AFTER-trigger `trg_order_regels_prijs_gate` bij €0/NULL-regel (niet pseudo/VERZEND, korting<100, mig 396) | `markeer_prijs_geaccepteerd` of prijscorrectie | [`prijs-ontbreekt.ts`](../frontend/src/lib/orders/prijs-ontbreekt.ts) | **Ja** — `start_pickronden` weigert via `_valideer_intake_gates`; herhaalbaar |

Eenmalige gates (EDI-leverweek, debiteur) vs. herhaalbare gate (levertijd) — bewust
verschillend ontworpen (zie CLAUDE.md, mig 326-toelichting). Alle predicaten hebben
één bron-van-waarheid-helper; inline duplicaten zijn opgeruimd (intake-consolidatie slice 2).

De intake-gates afleveradres (mig 395) & prijs (mig 396) zijn de enige **blokkerende**
kolom-gates: ze delen de server-side poort `_valideer_intake_gates(order_ids[])` die
`start_pickronden` aanroept ná de bundel-uitbreiding. Detectie zit in DB-triggers (single
source) zodat álle intake-kanalen gedekt zijn, niet per kanaal. **Productie-only orders
(`alleen_productie=true`, Basta) zijn uitgesloten van beide gates (mig 397)** — verzending
en facturatie lopen daar via Basta, dus de gates zijn voor hen betekenisloos.

## 6a. Orderbevestiging — kanaal-dispatch (besluit 2026-06-11)

De "Bevestig order"-knop in [`order-header.tsx`](../frontend/src/components/orders/order-header.tsx)
dispatcht op `bron_systeem` en partnerconfig via `bepaalBevestigingKanaal` in
[`bevestiging-kanaal.ts`](../frontend/src/lib/orders/bevestiging-kanaal.ts):

| `bron_systeem` | Partnerconfig | Kanaal | Wat gebeurt er |
|---|---|---|---|
| ≠ `'edi'` | n.v.t. | `email` | PDF-orderbevestiging via `stuur-orderbevestiging` (gate `bevestigd_at`, mig 304) |
| `'edi'` | `transus_actief && orderbev_uit` | `edi` | ORDRSP op `edi_berichten`-wachtrij → `transus-send` (gate `edi_bevestigd_op`, mig 158) |
| `'edi'` | anders (config null / toggles uit) | `email` | PDF-orderbevestiging per e-mail (gate `bevestigd_at`); na verzenden wordt ook `edi_bevestigd_op` gezet (`sluitEdiGate=true`) zodat de leverweek-gate sluit |

**Per documenttype:** wat de partner niet via EDI wil ontvangen, gaat automatisch per e-mail
(besluit 11-06, Miguel). De "EDI nooit via mail"-regel geldt per documenttype, niet per klant
of order. Kanaal `'edi_stil'` bestaat niet meer.

**Twee bevestigings-gates — onderscheid:**
- `bevestigd_at` (mig 304): e-mail-orderbevestiging. Telt ook voor "Opnieuw versturen". Bij EDI-orders via email-kanaal: is de gate van de daadwerkelijke bevestiging.
- `edi_bevestigd_op` (mig 158): EDI-leverweek-gate. Dekt de leverweek-flow (`EdiLeverweekBevestigen`) én de ORDRSP-flow (`BevestigOrderEdiDialog`). Bij email-kanaal EDI-orders: wordt `best-effort` gesloten ná de mail, zodat het "Te bevestigen"-chip verdwijnt.

**Eén bevestigd-predicaat:** `isOrderBevestigd(order, kanaal?)` in [`bevestiging-kanaal.ts`](../frontend/src/lib/orders/bevestiging-kanaal.ts):
- Met `kanaal='edi'` → `edi_bevestigd_op`
- Met `kanaal='email'` → `bevestigd_at` (ook voor EDI-orders — edi_bevestigd_op alleen is niet genoeg, de mail moet ook verstuurd zijn)
- Zonder kanaal → oud fallback-gedrag (EDI → `edi_bevestigd_op`, anders → `bevestigd_at`)

**Gedeelde flow `useBevestigEdiOrder`** ([`use-bevestig-edi-order.ts`](../frontend/src/modules/edi/lib/use-bevestig-edi-order.ts)): laadt `edi_handelspartner_config`, bepaalt het kanaal en roept bij `kanaal='edi'` `bevestigOrderViaEdi` aan of bij `kanaal='email'` alleen `bevestigOrderZonderEdiBericht` (administratieve leverweek-vastlegging; de orderbev-mail gaat via de universele "Bevestig order"-knop).

## 7. Intake-kanalen — verschillen-matrix

| | Handmatig | EDI | Shopify | Lightspeed webhook | Lightspeed cron | E-mail |
|---|---|---|---|---|---|---|
| RPC | `create_order_with_lines` | `create_edi_order` | `create_webshop_order` | `create_webshop_order` | `create_webshop_order` | `create_webshop_order` |
| Initiële status | Klaar voor picken | Klaar voor picken (sinds mig 357; mig 309/312-regressie zette `'Nieuw'`) | Klaar voor picken | Klaar voor picken | Klaar voor picken | **Concept** |
| Idempotency | geen (UI) | `(edi, TransactionID)` | `(shopify, order_id)` | `(lightspeed, order_id)` | idem | `(email, message_id)` |
| Debiteur-matching | UI-selector | GLN-ladder ([`debiteur-matcher.ts`](../supabase/functions/_shared/debiteur-matcher.ts)) | fuzzy-ladder + fallback | env `FLOORPASSION_DEBITEUR_NR` | idem | `match_klant_po` |
| Afleverdatum | UI (`bepaalOrderAfleverdatum`) | partner-header (+ snapshot) | note-attr of +7d | uit shipmentTitle | idem (sinds B4-fix; was NULL) | parse of vandaag |
| `lever_modus`/`lever_type` | UI-dialog/toggle | NULL → defaults | NULL | NULL | NULL | NULL |
| Maatwerk-regels | ja | **nee — vangnet mig 349 (B1)** | ja | ja | ja | onduidelijk |
| Allocator + snijplan-trigger | direct (INSERT-triggers mig 146/274) | direct | direct | direct | direct | **pas na bevestiging** |

Na elke landing: INSERT-trigger op `order_regels` → `herallocateer_orderregel` →
`herwaardeer_order_status`/`herbereken_wacht_status`; maatwerk-INSERT →
`auto_maak_snijplan` (mig 274/328).

**Mig 497-502 (2026-06-24):** `herallocateer_orderregel` (de naam die deze trigger
aanroept, dus geldt voor élk kanaal hierboven) claimt bij een tekort niet meer
automatisch een uitwisselbaar/equivalent artikel of de oudste open inkooporder
— alleen nog eigen voorraad (Stap 1). Een resterend tekort blijft gewoon
tekort/"Wacht op inkoop" totdat een gebruiker op order-detail of in het
order-formulier expliciet een keuze maakt uit de 3 opties (`allocatie_opties_voor_artikel`,
`UitwisselbaarTekortHint`/`UitwisselbaarToepassenRij`) — dat geldt dus ook voor
automatisch ingeladen EDI/webshop-orders, die voorheen stilletjes omgestickerd
konden worden. De oude volledige cascade leeft voort als
`herallocateer_orderregel_auto`, aangeroepen ná een bevestigde keuze voor het
niet-gekozen restant. Zie `docs/database-schema.md` (`order_reserveringen`).

## 8. Productiepad — snijplan-lifecycle

Statussen (single source: [`snijplan-status.ts`](../supabase/functions/_shared/snijplan-status.ts),
geborgd door mig 344-snapshot-assert): `Wacht → Gepland → In productie → Snijden →
Gesneden → In confectie → Gereed → Ingepakt`, plus `Geannuleerd`.

| Transitie | Eigenaar |
|---|---|
| (insert) → `Wacht` | `auto_maak_snijplan` (mig 274/328) |
| `Wacht` → `Gepland` → plaatsing op rol | auto-planner / packer (`auto-plan-groep`) |
| → `Snijden` | snijstart (scanstation); zet ook `rollen.snijden_gestart_op` |
| `Snijden` → `Gesneden` | `voltooi_snijplan_rol` (rol → `gesneden` of `beschikbaar` bij aangebroken) |
| `Gesneden` → `In confectie` | `start_confectie` |
| → `Gereed`/`Ingepakt` | `voltooi_confectie` (mig 348; zet `confectie_afgerond_op`) |
| any → `Geannuleerd` | order-annulerings-cascade (mig 290) |

Koppeling naar de order: maatwerk-regel is pickbaar ⇔ alle snijplannen `'Ingepakt'`;
tot die tijd houdt regel 4 van §4 de order op `Wacht op maatwerk`. Voor productie-only
orders flipt `voltooi_confectie` de order naar `Maatwerk afgerond` zodra alle
snijplannen `confectie_afgerond_op` hebben (inpak-stap niet vereist) — via
`_apply_transitie` met event `maatwerk_afgerond` (mig 347/348).

**Terugkoppel-seam snijplan→order (mig 486, 2026-06-24):** de order-fase is een
afleiding van de productie- **én** de claim-state. Tot mig 486 herberekende
niets `orders.status` ná een confectie-/inpak-stap (noch `voltooi_confectie`,
noch de kale scanstation-`UPDATE` in `opboekenItem`, noch een snijplan-trigger),
waardoor een gewone maatwerk-order op `Wacht op maatwerk` bleef staan terwijl
`orderregel_pickbaarheid` (mig 386) hem al pickbaar toonde — twee verhalen
naast elkaar (de order toonde nooit `Klaar voor picken` en sprong direct naar
`In pickronde`). Listener `trg_snijplan_herbereken_order_status` (`AFTER UPDATE
OF status ON snijplannen`, `WHEN` het stuk de `'Ingepakt'`-grens kruist, in- of
uitpakken) roept nu `herbereken_wacht_status` voor de eigenaar-order aan. Vangt
beide Ingepakt-zetters op één plek (ADR-0006/0015-listener-patroon — géén edit
in de command-RPC's). Productie-only orders worden overgeslagen (eigen terminale
flip hierboven). De beslissing blijft single-source via `derive_wacht_status`,
die `In pickronde`/`Verzonden`/`Maatwerk afgerond` no-toucht — een al-gestarte
pickronde wordt nooit teruggetrokken.

**Dubbele bezet-guard (mig 301, VERR130-incident):** planning-pool sluit rollen uit op
`snijden_gestart_op IS NOT NULL` **én** op ANY snijplan in `Snijden`/`Gesneden` —
beide nodig vanwege het window tussen status-promotie en rol-vlag.

**Express + verdringing-veiligheidsnet (Fase 2, mig 450, 2026-06-20):** `orders.express`
(handmatige vlag, `ExpressToggle` op order-detail) krijgt hoogste sorteerprioriteit in
`sortPieces` (`_shared/ffdh-packing.ts`) — vóór grootte/oppervlak/afleverdatum. Toggelen
triggert direct `auto-plan-groep` voor de (kwaliteit, kleur)-groepen van de maatwerk-regels
op die order. Regel (verbatim gebruikerseis): heroptimaliseren mag, **maar nooit zodanig
dat een order die zijn snij-deadline zou halen hem daardoor mist** — gebeurt dat toch, dan
moet het systeem het voorleggen i.p.v. stilletjes doorvoeren. Implementatie hergebruikt de
bestaande `snijvoorstellen.status='concept'`-aftakking (ADR-0021's FIFO-rode-badge-carve-out,
zie §6-stijl gates): `auto-plan-groep` snapshot de rol-toewijzing vóór de release
(`fetchOudeRolToewijzingen`), en na het packen is een stuk dat eerst een echte rol had maar
nergens meer geplaatst is (ook niet via de IO-claim-pas) "verdrongen". Wordt de
herberekende haalbaarheid (`_shared/snij-haalbaarheid.ts`, verplaatst hierheen vanuit
`frontend/src/lib/orders/` — ADR-0033) voor zo'n stuk `rood`, dan blijft het hele voorstel
`'concept'` (geen auto-approve) en bevat de response een `verdrongen_orders`-array. Géén
nieuwe gate-kolom of UI — de planner ontdekt het concept-voorstel via dezelfde
voorstel-review-pagina als een rode FIFO-badge.

**Handmatige rol-toewijzing met bescherming (Fase 4, mig 453, 2026-06-20):** een planner kan
een `Gepland`-stuk handmatig naar een specifieke compatibele rol verplaatsen (`Move`-knop in
`groep-accordion.tsx`) via RPC `wijs_snijplan_handmatig_toe` — zet `rol_id`/positie +
`snijplannen.is_handmatig_toegewezen=true`. `release_gepland_stukken` slaat vergrendelde
stukken over, dus `auto-plan-groep` kan de keuze nooit terugdraaien; het vergrendelde stuk
wordt door de bestaande `fetchBezettePlaatsingen` simpelweg gezien als bezette shelf-ruimte
(zelfde mechanisme als een al-gesneden stuk). Positiebepaling op de gekozen rol hergebruikt
de pure packing-helpers `reconstructShelves`/`tryPlacePiece` (`_shared/ffdh-packing.ts`) in de
nieuwe edge function `wijs-snijplan-handmatig-toe` — geen nieuwe positioneringslogica.
Ontgrendelen (`ontgrendel_handmatige_toewijzing`, `Lock`-badge) geeft het stuk vrij en
triggert direct een nieuwe `auto-plan-groep`-run; **toewijzen triggert dit ook**, nodig om de
Fase-3 IO-claim-aggregaat (`inkooporder_regels.snijplan_gebruikte_lengte_cm`) correct te
hertellen wanneer een "Wacht op inkoop"-stuk naar een echte rol verplaatst wordt (er is geen
per-stuk-aandeel bijgehouden, alleen het totaal per virtuele rol).

## 9. Magazijnpad — pickbaarheid → zending → Verzonden → factuur

1. **Pickbaarheid** ([`pickbaarheid.ts`](../frontend/src/modules/magazijn/queries/pickbaarheid.ts)):
   order zichtbaar in Pick & Ship op basis van `order_pickbaarheid.pick_ship_zichtbaar`
   (view, mig 386 — single source). Predikaat: alle regels pickbaar OR (`deelleveringen_toegestaan`
   AND ≥1 pickbaar). Geen rij in de view = geen (niet-pseudo) regels = niets te picken.
   Admin-pseudo-regels (ADR-0018, incl. VERZEND en DROPSHIP-*) zijn generiek uitgesloten in
   `orderregel_pickbaarheid` — er is geen VERZEND-specifieke TS-skip meer.
   De enige resterende client-side filterlogica is de dag-order-horizon
   (`werkdagMinN(afleverdatum, 1)`, ADR 0014) — die hangt af van `vandaag`.
   Productie-only orders (`alleen_productie=TRUE`) staan wél in de view (die filtert alleen
   op order-status) maar worden uit Pick & Ship geweerd door de TS-headerquery
   (`.eq('alleen_productie', false)` in `fetchOpenOrderHeaders`, R1-guard mig 345 —
   gepind in `pickbaarheid-productie-only.test.ts`). **Chunk-per-order_id (fix 2026-06-11):**
   een kale GET op `orderregel_pickbaarheid` liep tegen de PostgREST max-rows-cap (1000)
   aan waardoor orders stilletjes verdwenen; dit is per-order opgelost in de query-laag.
   **Deploy-voorwaarde (mig 386):** de view `order_pickbaarheid` moet op de live DB staan
   vóór de frontend deployt — er is geen PGRST205-fallback meer.
   Een order **zonder effectieve vervoerder blijft wél zichtbaar** maar kan
   geen pickronde starten (zie stap 2).
2. **Pickronde-start** (`start_pickronden`, mig 248 → guard mig 373): 4D-bundel-expansie
   (debiteur × adres × vervoerder × verzendweek), één zending per bundel
   (status `'Picken'`), order → `In pickronde`. **Geen-vervoerder-guard (mig 373):**
   een niet-afhaal-order met ≥1 regel `bron='geen'` weigert met
   "Geen vervoerder mogelijk" — frontend-spiegel in `StartPickrondesButton`
   (disabled knop met zelfde label). Escape-hatch: vervoerder-override op de
   orderregel. **Combi-levering (mig 556-568, ADR-0040 — supersedeert
   ADR-0039's Startbaarheid-gate):** géén frontend-only blokkade meer — een
   wachtende order krijgt `orders.status='Wacht op combi-levering'` (§2/§4) en
   bereikt de Pick & Ship-query (`order_pickbaarheid.pick_ship_zichtbaar`,
   mig 566) dus nooit. Bron: view `combi_levering_status` (mig 557/561/562):
   TRUE zolang de (debiteur × adres-norm)-groep van openstaande orders de
   vrachtvrije-drempel niet haalt, of niet alle leden individueel pickbaar
   zijn. Klant-instelling `debiteuren.combi_levering` + order-override
   `orders.combi_levering_override`; trigger `trg_debiteuren_combi_levering`/
   `trg_orders_combi_levering_override` (mig 558/567) voegt/verwijdert zowel de
   VERZEND-regel als de `orders.status`-transitie op het juiste moment (met
   groep-cascade, §4). Géén nieuwe bundel-mechaniek: eenmaal vrijgegeven
   orders (promoveren automatisch, zodra de groep de drempel haalt — geen
   operator-actie nodig) landen via de bestaande 4D-bundel-expansie automatisch
   in dezelfde zending. Pick & Ship-vangnet tegen handmatige deelselectie van
   een al-zichtbare groep: [`combi-levering-achtergebleven.ts`](../frontend/src/modules/logistiek/lib/combi-levering-achtergebleven.ts).
3. **`voltooi_pickronde`** (bundel-aware via `zending_orders`): zending →
   `'Klaar voor verzending'`; laatste open zending van de order → `markeer_verzonden`
   → `Verzonden`; anders → `Deels verzonden`.
4. **Factuur**: listener op `pickronde_voltooid`-event (§5) — per_zending direct op
   queue, wekelijks via maandag-cron (mig 231/232).
5. **Transport (HST)**: `enqueue_hst_transportorder` → cron `hst-send`
   (`Wachtrij → Bezig → Verstuurd`/`Fout`; reaper mig 337). **Asynchroon en
   niet-blokkerend** voor de order-status: een HST-`Fout` houdt `Verzonden` niet tegen —
   bewaking via `hst_verzend_monitor` + aandacht-banner (ADR-0030).

## 10. Terminale paden

- **`Verzonden`**: via laatste `voltooi_pickronde`. Daarna locked (annuleren faalt).
- **`Geannuleerd`**: `markeer_geannuleerd` → event → cascade (claims released,
  snijplannen → `Geannuleerd`, rollen vrijgegeven; §5). Defense-in-depth:
  `snijplanning_overzicht` filtert `Geannuleerd` (mig 290, her-asserted mig 316).
- **`Maatwerk afgerond`**: alleen productie-only; geen factuur, geen transport,
  geen annulerings-cascade. Magazijnier zoekt op Basta-nummer en handelt daar af.
  Sinds mig 348 met `order_events`-audit (`maatwerk_afgerond`).

## 11. Bevindingen (2026-06-10) — getriageerd

Status-legenda: ✅ = gefixt op branch `fix/order-lifecycle-hardening` (mig 348-352;
op 2026-06-10 initieel toegepast als 346-350, hernummerd wegens collisie met
`346_derive_wacht_status_single_source` op main).

### A. Go-live-relevant (verzending + maatwerk volgende week)

- **B1 — EDI kan geen maatwerk landen.** ✅ *vangnet* — het Transus-formaat draagt
  maat/vorm alleen als tekst-suffix in de artikelcode; de token-match dropte die
  stilzwijgend. Mig 349 weigert een token-match wanneer de suffix een maat-patroon
  (`155x230`) of vorm-woord (`rund`/`rond`/`ovaal`) bevat → regel landt als
  ongematcht in de bestaande 'Actie vereist'-flow, operator beoordeelt. **Echte
  EDI-maatwerk-parsing = V2** zodra de geweigerde regels een corpus vormen.
  *Bekende gaten in de guard (bewust, eerst corpus):* suffix met alléén een getal
  (`"526650046 160"`), vorm-woord aan getal geplakt (`"RUND160"`), `155*230`,
  `Ø 160`, Engels `round`. Vóór de cutover: corpus-query op historische
  `edi_berichten`-payloads om refusal-volume en gemiste varianten te kwantificeren.
- **B2 — `Maatwerk afgerond` zonder order_event.** ✅ — mig 347 (event-type
  `maatwerk_afgerond`) + mig 348 (`voltooi_confectie` via `_apply_transitie`).
- **B4 — Lightspeed-cron landt orders zonder afleverdatum.** ✅ —
  `import-lightspeed-orders` gebruikt nu dezelfde `bepaalAfleverdatumUitOrder` +
  `maatwerk_weken`-fallback als het webhook-pad. **Redeploy edge function nodig.**

### B. Contract-borging

- **B5 — Order-status-enum-snapshot-assert.** ✅ — mig 350 (set-vergelijking;
  basis-enum-volgorde is niet uit de repo-historie af te leiden). Spiegels die bij
  een enum-wijziging mee moeten: snapshot, `ORDER_STATUS_COLORS`, dit document §2.
- **B6 — Transitie-contract-tests**: guards van §3.1 vastleggen. Bestaat deels
  ([`transities.contract.test.ts`](../frontend/src/modules/orders-lifecycle/__tests__/transities.contract.test.ts));
  het parallel lopende "order-status single-source"-plan dekt de ladder-logica.
- **B11 — Lint-scope-gat.** ✅ — `lint-no-direct-orders-status-update.sh` scande
  alleen `migrations/2*.sql`, waardoor mig 308/330 erdoorheen glipten; scant nu
  ook `3*.sql`+ (308/330 expliciet ge-allowlist als bevroren historie).
- **B12 — `ORDER_STATUS_COLORS` miste `'Maatwerk afgerond'`.** ✅ — badge viel
  terug op niets; teal toegevoegd.
- **B13 — `Maatwerk afgerond` regresseerde naar `Wacht op maatwerk`.** ✅ — de
  no-touch-lijst van `herbereken_wacht_status` (mig 275, ouder dan mig 327) kende
  de terminale status niet: elke orderregel-touch op een afgeronde productie-only
  order zette hem terug (maatwerk-tak vindt snijplannen zonder `'Ingepakt'` —
  productie-only eindigt bewust op confectie-afgerond). Mig 351 voegde de status
  toe aan de inline guard (gevonden in de code-review van deze branch).
  **Samenloop met "order-status single-source" (mig 346 op main):** diens pure
  `derive_wacht_status` had dezelfde gap (de truthtable pinde alleen de
  all-false-combinatie; met `maatwerk=true` — per definitie waar voor afgeronde
  productie-only orders — vuurde tak 4 alsnog). Mig 352 verenigt beide:
  delegatie hersteld mét `'Maatwerk afgerond'` in de pure functie, TS-spiegel
  en golden-fixture mee, truthtable uitgebreid met de echte B13-case.

### C. Opruimen/V2

- **B3 — `bevestig_concept_order` was kapot.** ✅ (mig 354, toegepast als 353) — bij nadere inspectie
  géén opruimwerk maar een echte bug: de mig 308-versie deed een events-INSERT op
  de niet-bestaande kolom `actor` (en miste het verplichte `status_na`) → de RPC
  crashte bij élke Concept-bevestiging, transactie rolde terug. De flow is in de
  UI bedraad (`use-bevestig-concept-order`) maar kon dus nooit succesvol draaien.
  Nu via `_apply_transitie` (event `aangemaakt`, metadata `bron`).
- **B7 — mig 275 patcht `create_edi_order` via string-`REPLACE()`** — fragiel patroon;
  precies wat misging: mig 309/312 herdefinieerden de functie mét de oude
  `'Nieuw'`-literal terug (de patch zat niet in een leesbaar bronbestand).
  **Regressie hersteld in mig 357** via een schone, volledige herdefinitie +
  backfill; het REPLACE-patroon niet herhalen.
- **B8 — `lever_modus` NULL bij externe kanalen.** ✅ *onderzocht (2026-06-10),
  geen acute bug.* `lever_type` is non-issue: kolom is `NOT NULL DEFAULT 'week'`
  (mig 244) — externe orders zijn week-orders (conservatief; of B2C-webshoporders
  `'datum'` verdienen is een designvraag voor de landing-kern). `lever_modus`
  blijft wél NULL bij externe orders met tekort; drie consumenten, drie uitkomsten:
  (1) `bereken_late_claim_afleverdatum` (mig 153) behandelt NULL expliciet als
  `'in_een_keer'` → afleverdatum-sync veilig; (2) levertijd-views (mig 150/156)
  vallen bij NULL in de ELSE-tak → tonen de **eerste** IO-week terwijl de
  header-afleverdatum naar de **laatste** sync't — optimistische weergave;
  (3) zending-**splitsen** (`markeer_colli_niet_gevonden 'splits'`, mig 211/217)
  weigert op NULL (`IS DISTINCT FROM 'deelleveringen'`) — herstelbaar: order
  bewerken triggert de `LeverModusDialog` bij tekort. **Aanbeveling:** bij landing
  defaulten uit `debiteuren.deelleveringen_toegestaan` — input voor stap B van de
  Order-landing-kern (Fase 2-plan), niet als losse fix.
- **B9 — `order_events` draagt geen intake-kanaal-metadata** — audit ziet niet via
  welk kanaal een order ontstond (alleen `orders.bron_systeem`). Nice-to-have.
- **B14 — `sync_order_afleverdatum_met_claims` mist `'Maatwerk afgerond'`.** ✅
  (mig 355, toegepast als 354) — eindstatus-guard compleet gemaakt; zelfde klasse als B13 (elke
  status-lijst ouder dan mig 327 moet de terminale status expliciet kennen).
  Risico was al laag (maatwerk reserveert niet op IO in V1 → no-op).
- **B10 — Legacy statussen** (`Nieuw`, `Actie vereist`, `In snijplan`, `Deels gereed`,
  `Wacht op picken`) staan nog in de enum; `In productie` is hergebruikt door
  productie-only (mig 329). Opruim-/hernoem-kandidaat zodra productie-only een
  eigen status krijgt.
