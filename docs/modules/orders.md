# Orders

> Module-doc: huidige staat + valkuilen. Chronologie: [docs/changelog.md](../changelog.md).
> Statusmodel, gates, RPC-dispatch-tabellen en het volledige productie-/magazijnpad staan
> uitputtend in [docs/order-lifecycle.md](../order-lifecycle.md) — dat document is de
> canonieke bron voor "welke status, welke transitie, welke RPC"; dit doc verwijst ernaar
> in plaats van het te dupliceren. Actuele RPC-bodies: [supabase/schema/functies.sql](../../supabase/schema/functies.sql)
> / [views.sql](../../supabase/schema/views.sql) — **nooit** de migratiebestanden (zie
> order-lifecycle.md §3.3).

## Wat dit is

Een **Order** is een klantbestelling met één of meer **Orderregels** (standaardmaat-artikel
of **Maatwerk**-stuk). Orders komen binnen via vijf **Intake-kanalen** (EDI, Shopify,
Lightspeed, e-mail, handmatig), landen via drie adapter-RPC's op één interne **Order-landing**,
doorlopen een statusmodel van intake → dekking → (bij maatwerk) productie → magazijn → factuur,
en dragen adres-/prijs-snapshots (geen live FK naar afleveradressen). Zie
[CONTEXT.md](../../CONTEXT.md) §"Orders & lifecycle" / §"Order-intake" voor de volledige
domeintaal (Order-landing, Order-commit, Order-hydratie, Productie-only order).

## Kernbestanden

| Laag | Pad | Rol |
|---|---|---|
| RPC (landing) | `create_order_with_lines` / `create_edi_order` / `create_webshop_order` (in [functies.sql](../../supabase/schema/functies.sql)) | Drie adapters op de Order-landing; alle drie INSERTen op `status='Concept'` sinds mig 542 |
| Edge functions | [`poll-email-orders`](../../supabase/functions/poll-email-orders/), [`sync-shopify-orders-poll`](../../supabase/functions/sync-shopify-orders-poll/) | E-mail- resp. Shopify-kanaal (Shopify: poll-branch, zie reference_shopify_polling_branch_only) |
| RPC | `bevestig_concept_order`, `delete_order`, `markeer_geannuleerd` | Concept-uitweg; delete-guard (`status≠'Verzonden'`, impliciete FK-guard); annuleer-cascade (ADR-0023) |
| Frontend | [`order-form.tsx`](../../frontend/src/components/orders/order-form.tsx) / [`order-header.tsx`](../../frontend/src/components/orders/order-header.tsx) | Aanmaken/bewerken (prijslijst-gate, `LeverDatumField`, `LeverModusDialog`) / bevestig-dispatch + gate-banners |
| Pure pipeline | [`order-commit.ts`](../../frontend/src/lib/orders/order-commit.ts) / [`order-hydratie.ts`](../../frontend/src/lib/orders/order-hydratie.ts) | Form → commit-plan / bestaande order → form-state |
| Pure modules | `admin-pseudo.ts`, `vorm-toeslag-regel.ts`, `afleveradres-gate.ts`, `prijs-ontbreekt.ts`, `levertijd-wijziging.ts`, `edi-leverweek.ts`, `intake-predicaten.ts`, `bevestiging-kanaal.ts`, `bundel-sleutel.ts` (alle in [`frontend/src/lib/orders/`](../../frontend/src/lib/orders/)) | Eén predicaat/pipeline per bedrijfsregel hieronder |
| Shared seams | [`_shared/debiteur-matcher.ts`](../../supabase/functions/_shared/debiteur-matcher.ts), [`_shared/order-lifecycle/derive-status.ts`](../../supabase/functions/_shared/order-lifecycle/derive-status.ts), [`_shared/combi-levering-tekst.ts`](../../supabase/functions/_shared/combi-levering-tekst.ts) | Debiteur-matching / `derive_wacht_status`-TS-spiegel / 4-talige combi-tekst |
| Combi-levering UI | [`combi-levering-in-wacht-knop.tsx`](../../frontend/src/components/orders/combi-levering-in-wacht-knop.tsx), [`combi-levering-badge.tsx`](../../frontend/src/components/orders/combi-levering-badge.tsx), [`combi-levering-achtergebleven.ts`](../../frontend/src/modules/logistiek/lib/combi-levering-achtergebleven.ts) | Order-detail-knop, status-badge, Pick & Ship-vangnet |
| Tabellen/views | `orders`, `order_regels`, `order_events`, `order_reserveringen`, `combi_levering_status` (view), `order_pickbaarheid` (view) | Zie [database-schema.md](../database-schema.md) |

## Geldende ADR's & specs

- [ADR-0006](../adr/0006-order-lifecycle-als-deep-module.md) — order-lifecycle als deep module (single write-path `_apply_transitie`)
- [ADR-0016](../adr/0016-order-status-toont-werkelijke-fase.md) — `order_status` toont de werkelijke fase, niet alleen intake
- [ADR-0018](../adr/0018-admin-pseudo-orderregel-als-data-driven-concept.md) — admin-pseudo-orderregel als data-driven concept
- [ADR-0014](../adr/0014-leveren-op-leverdatum-naast-leverweek.md) — `lever_type` (dag- vs. week-order)
- [ADR-0023](../adr/0023-order-annulering-cascadeert-naar-snijplanning.md) — annuleren-cascade naar snijplanning
- [ADR-0037](../adr/0037-pickbaarheid-startbaarheid-als-deep-module.md) — Pickbaarheid/Startbaarheid (Pick & Ship-kant, zie [magazijn-pickship.md](magazijn-pickship.md))
- [ADR-0039](../adr/0039-combi-levering-als-startbaarheid-gate.md) — **superseded**, audit trail only
- [ADR-0040](../adr/0040-combi-levering-als-order-status.md) — Combi-levering als echte `order_status`
- Plan: [2026-06-07-gedeelde-debiteur-matcher-seam.md](../superpowers/plans/2026-06-07-gedeelde-debiteur-matcher-seam.md)
- Plan: [2026-06-14-factuurdocument-deep-module.md](../superpowers/plans/2026-06-14-factuurdocument-deep-module.md) — orderbevestiging deelt alleen de karpi-code-resolver, houdt een eigen document (zie Valkuilen)

## Bedrijfsregels (huidige staat)

### Intake — alle kanalen landen op Concept

**Universele Concept-intake-gate (mig 540-542):** elke nieuw aangemaakte order landt
altijd eerst op `order_status='Concept'`, ongeacht kanaal. De drie landing-RPC's
(`create_order_with_lines`, `create_edi_order`, `create_webshop_order`) INSERTen direct
op `'Concept'`; `poll-email-orders` gaf dat al expliciet mee. Vier lekken zijn gedicht
(mig 540): `derive_wacht_status` (no-touch), `herallocateer_orderregel` (guard),
`auto_maak_snijplan`/`auto_sync_snijplan_maten` (guards), `actieve_snijgroepen`
(uitgebreide NOT IN) — alle vier inert voor Concept-orders. **Enige uitweg:**
`bevestig_concept_order(p_order_id)` (mig 541) — transitie naar `'Klaar voor picken'`,
maakt geblokkeerde maatwerk-snijplannen alsnog aan, heralloceert per regel, herbereken_wacht_status
voor de definitieve status. Volledige status-/gate-tabel: order-lifecycle.md §2, §6, §7.
**Niet te wijzigen:** `registreer_achteraf_order` (mig 524)/`markeer_achteraf_verzonden`
(mig 539) omzeilen de normale workflow bewust voor retroactieve orders.

**Order aanmaken vereist een gekoppelde prijslijst (mig 481):** `create_order_with_lines`
weigert (`RAISE EXCEPTION`, vóór de INSERT) een nieuwe order als
`debiteuren.prijslijst_nr IS NULL`. Frontend-spiegel: `order-form.tsx`'s `saveMutation`
gooit dezelfde melding (`mode === 'create' && !client.prijslijst_nr`). **Alleen
creatie, geen edit** — een bestaande order blijft altijd bewerkbaar. Scope bewust beperkt
tot de handmatige RPC: `create_edi_order`/`create_webshop_order` hebben al een
intentionele fallback op `producten.verkoopprijs` (mig 166) en worden hier niet geraakt —
een automatisch inkomend kanaal mag niet blijven liggen op een ontbrekende koppeling; de
prijs-ontbreekt-gate (mig 396, zie hieronder) vangt een verkeerde prijs daar al af.

**Gedeelde debiteur-matcher-seam** ([`_shared/debiteur-matcher.ts`](../../supabase/functions/_shared/debiteur-matcher.ts),
2026-06-07): alle vier automatische kanalen mappen naar `debiteur_nr` via één module
(spiegelt `product-matcher.ts`), resultaat `DebiteurMatch{debiteur_nr, bron, zeker}`.
- **Eén actief-definitie:** `isActieveDebiteur` = `status <> 'Inactief'` **met NULL
  meegerekend** → `.or(ACTIEF_OR_FILTER)` (`'status.is.null,status.neq.Inactief'`),
  **nooit** `.neq('status','Inactief')` (sluit NULL uit).
- **`zeker`-vlag = uniekheids-gate alleen op fuzzy strategieën** (naam-deelmatch/e-mail →
  `false`); GLN/expliciet nr/exacte naam/BTW → altijd `true`.
- GLN-ladder (`matchDebiteurOpGln`, 5 stappen: aflever→besteller→gefactureerd→alias,
  Hornbach-inactieve-skip + BDSK-alias ingebouwd, `.0`-tolerant); EDI's
  `transus-poll matchDebiteur` delegeert hiernaar.
- **Slice 4 (mig 322) — debiteur te bevestigen:** onzekere fuzzy match blokkeert niet maar
  zet `orders.debiteur_zeker=false`+`debiteur_match_bron`. Predicaat (single source:
  [`intake-predicaten.ts`](../../frontend/src/lib/orders/intake-predicaten.ts)
  `isDebiteurTeBevestigen`): `debiteur_zeker=false AND (bron IS NULL OR bron <>
  'env_fallback') AND status <> 'Geannuleerd'` — `env_fallback` valt bewust af (verwachte
  eindbestemming voor een verzameldebiteur, geen fout).
- **Slice 5 — env-ladder:** Lightspeed/Shopify-catch-all → `matchDebiteurViaEnv` →
  altijd `{bron:'env_fallback', zeker:false}`.

### Statusmodel, dekking, gates

Het volledige statusmodel (enum-waarden, categorieën, transities), de
`derive_wacht_status`-beslisladder, de gates-tabel en de intake-kanalen-matrix leven in
[order-lifecycle.md](../order-lifecycle.md) §2–§7 — dat is de canonieke bron, hier alleen
de aanvullingen die niet 1-op-1 in dat document staan:

**`order_status` 'Wacht op inkoop'/'Wacht op voorraad' — betekenis omgedraaid (mig 470):**
sinds mig 470 (correct, huidige betekenis): `'Wacht op inkoop'` = nog géén IO-claim, er
moet één besteld worden; `'Wacht op voorraad'` = IO-claim bestaat al, wacht op levering.
Vóór mig 470 was dit omgekeerd (verwarrend t.o.v. de naam). Single source:
`derive_wacht_status()` + TS-spiegel `deriveWachtStatus()`
([`derive-status.ts`](../../supabase/functions/_shared/order-lifecycle/derive-status.ts),
golden-fixture-contracttest). Bestaande orders zijn gebackfilld (atomaire CASE-UPDATE).
**Bewust niet aangeraakt:** `snijplan_status` heeft toevallig óók een waarde
`'Wacht op inkoop'` (mig 437-445) — volledig los enum-type, ander concept, behoudt zijn
oorspronkelijke (correcte) betekenis.

**Levertijd-wijziging-signalering (mig 326):** wanneer een leverancier-ETA-update
(`update_regel_eta`) `orders.afleverdatum` bidirectioneel laat schuiven
(`sync_order_afleverdatum_eta`, kan zowel vervroegen als verlaten — anders dan de
forward-only mig-153-sync hieronder), wordt dat pas gemeld bij een **ISO-leverweek**-
verschil (`verzendweek_voor_datum`) — kleine dag-schuiven binnen dezelfde week melden
bewust niet. Bij een verschuiving: event `levertijd_gewijzigd_door_eta` +
`orders.levertijd_wijziging_te_bevestigen_sinds = now()`. **Eén nullable gate-kolom**
(niet een gemeld/bevestigd-paar) omdat de gate **herhaaldelijk** open/dicht moet — anders
dan de eenmalige EDI-leverweek-gate. Herbevestiging is puur administratief
(`markeer_levertijd_herbevestigd` zet de gate op NULL, geen automatische klant-mail).
**Valkuil:** de "voor"-afleverdatum moet **vóór** `herallocateer_orderregel` gesnapshot
worden (`p_oude_afleverdatum`-parameter) — die triggert zelf al een forward-only sync die
de waarde kan hebben verschoven, anders detecteert de vergelijking niets. UI: tab
"Levertijd gewijzigd" op orders-overzicht + amber
[`LevertijdWijzigingBanner`](../../frontend/src/components/orders/levertijd-wijziging-banner.tsx).

### Orderregels

**Admin-pseudo-orderregel (ADR-0018, mig 272-273):** orderregels met een administratief
artikel (geen fysieke leverbaarheid — VERZEND/VORMTOESLAG/DROPSHIP-*/BUNDELKORTING/
DREMPELKORTING) worden uniform geskipt in allocator, status-bepaling, levertijd-view,
pickbaarheid en dekking-preview. Bron-van-waarheid: `producten.is_pseudo BOOLEAN`. Predikaten:
SQL `is_admin_pseudo(artikelnr)` en TS
[`isAdminPseudo(regel)`](../../frontend/src/lib/orders/admin-pseudo.ts) — accepteert zowel
form-data (`is_pseudo` top-level) als query-resultaten (`producten ( is_pseudo )`-join).
Nieuw admin-pseudo-artikel toevoegen = pure `UPDATE producten`, geen code-edit. **Niet te
verwarren** met `SHIPPING_PRODUCT_ID='VERZEND'` (die constant bedient het *toevoegen* van
een verzendregel via `applyShippingLogic` — skip-detectie en construct zijn verschillende
semantieken).

**Vormtoeslag als eigen orderregel (mig 465):** de vorm-toeslag
(`maatwerk_vormen.toeslag`, bv. €75 voor rond/ovaal/ellips) is een **eigen orderregel**
met artikelnr `VORMTOESLAG` (admin-pseudo, altijd `korting_pct=0`), direct ná de
bijbehorende maatwerk-regel — voorheen zat de toeslag in de per-m²-prijs, waardoor de
regel-korting% er ook van afging. `maatwerk_vorm_toeslag` blijft als metadata op de
maatwerk-regel (voedt de companion + oude rapportages). **Koppeling is géén DB-FK maar een
array-positie-convention** (companion staat altijd direct ná zijn maatwerk-regel;
`regelnummer` wordt bij elke save uit de array-positie herberekend) — zie
[`vorm-toeslag-regel.ts`](../../frontend/src/lib/orders/vorm-toeslag-regel.ts)
(`syncVormToeslagRegel`/`verwijderRegelMetCompanion`). Geen wijziging nodig aan
snijplanning/allocator/pickbaarheid/facturatie (companion is generiek admin-pseudo).
**Handmatig (her)toevoegen:** knop "Overige regel toevoegen"
([`overige-regel-toevoegen.tsx`](../../frontend/src/components/orders/overige-regel-toevoegen.tsx))
toont alle `is_pseudo=TRUE`-artikelen (gewone artikel-zoekers filteren die bewust uit).
VORMTOESLAG is bijzonder (companion, geen order-brede regel): bij >1 kandidaat eerst
kiezen bij welke maatwerk-regel het hoort, en hergebruikt `syncVormToeslagRegel` zelf
(leest de toeslag uit `parent.maatwerk_vorm_toeslag`, niet uit `producten.verkoopprijs` —
die staat voor VORMTOESLAG bewust op NULL).

**Afleverdatum sync met IO-claims (mig 153):** `herwaardeer_order_status` synct na elke
alloc-cyclus `orders.afleverdatum` naar de laatste IO-claim-leverdatum
(`MAX(verwacht_datum) + inkoop_buffer_weken_vast × 7` dagen) als die later valt. **Schuift
alleen vóóruit, nooit terug** — reflecteert dus altijd minimaal de werkelijke
claim-belofte. Eindstatussen (Verzonden/Geannuleerd/Klaar voor verzending) blijven
ongewijzigd. **Niet te verwarren** met de bidirectionele mig-326-sync hierboven
(leverancier-ETA-gedreven, kan wel terugschuiven).

### Lever-instellingen (per order)

**`lever_modus`:** order-niveau keuze `deelleveringen` / `in_een_keer`. Default uit
`debiteuren.deelleveringen_toegestaan`, gevuld via
[`LeverModusDialog`](../../frontend/src/components/orders/lever-modus-dialog.tsx) bij
opslaan als ≥1 regel tekort heeft. Bepaalt levertijd-berekening (eerste IO-week resp. max
IO-week) en aantal zendingen. NULL voor orders zonder tekort.

**`lever_type` (ADR-0014, mig 244):** order-niveau intentie `'week'` (B2B-default, ~90%)
of `'datum'` (B2C, dag-order). Dag-orders verschijnen pas 1 werkdag vóór afleverdatum in
Pick & Ship (`werkdagMinN`, gedeelde werkagenda-kernel) en krijgen voorrang in
`check-levertijd` (kritieke deadline = afleverdatum − `dag_order_snij_buffer_werkdagen`,
default 2 werkdagen). Default per klant via `debiteuren.default_lever_type`; per order
overschrijfbaar via `LeverDatumField` (segmented toggle,
[`order-form.tsx`](../../frontend/src/components/orders/order-form.tsx)). Bundel-sleutel
(4D, zie hieronder), wekelijkse verzamelfactuur en IO-sync bundelen dag- en week-orders
normaal als de sleutel matcht. Terracotta 📅-badges op order-detail/Pick & Ship/orders-
overzicht onderscheiden dag-orders.

**`afhalen` (mig 204, hersteld mig 585):** order-niveau boolean "klant haalt zelf op".
Geen vervoerder-waarde — de vlag omzeilt de hele vervoerder-as
(`enqueue_zending_naar_vervoerder` → `'afhalen_geen_vervoerder'`, mig 205). Bij
`afhalen=TRUE`: adres-gate én GLN-gate slaan niet aan (`fn_orders_afl_adres_gate`),
`afl_*`-velden horen leeg te zijn (mig 537 — documenten/UI leiden het Karpi-afhaaladres
af uit `app_config.bedrijfsgegevens`: pakbon "AFHAALLOCATIE", orderbevestiging,
order-detail), VERZEND-regel vervalt altijd (`verzend-regel.ts` +
`verzendkosten_voor_bundel` → `'gratis_afhalen'`), BTW volgt het debiteurland (nooit
`afl_land`), en de zending eindigt handmatig via `markeer_zending_afgehaald` op status
`'Afgehaald'` (mig 482/483). Facturatie triggert normaal op `pickronde_voltooid` —
losgekoppeld van het afhaal-moment. **Contract (mig 585):** de header-kolomlijst van
`update_order_with_lines` moet álle sleutels lezen die
[`order-mutations.ts`](../../frontend/src/lib/supabase/queries/order-mutations.ts)
meestuurt; `assert_update_order_header_contract()` toetst dat en móet slagen in elke
migratie die de RPC herdefinieert (mig 527 verloor zo `afhalen`/`lever_type`/
`fact_email`/`afl_email` — afhalen aanvinken bij bewerken deed wekenlang stil niets).

**Bundel-sleutel (mig 228-230):** een order groepeert met andere orders in
`(debiteur × adres-norm × effectieve vervoerder × verzendweek)` — single source
[`bundel-sleutel.ts`](../../frontend/src/lib/orders/bundel-sleutel.ts), SQL↔TS-contract
via golden fixtures (mig 385). Bepaalt of orders samen in 1 zending/pakbon/transportorder
landen bij pickronde-start (volledige zending-bundeling: magazijn/logistiek-module-doc).
Relevant hier omdat Combi-levering eenzelfde soort adres-groepering gebruikt, maar
zónder de vervoerder/verzendweek-dimensie (zie hieronder).

### Orderbevestiging — kanaal-dispatch

**Universele bevestig-knop:** de "Bevestig order"-knop op
[`order-header.tsx`](../../frontend/src/components/orders/order-header.tsx) dispatcht op
`bron_systeem` + `edi_handelspartner_config` via
[`bepaalBevestigingKanaal`](../../frontend/src/lib/orders/bevestiging-kanaal.ts):

| `bron_systeem` | Partnerconfig | Kanaal |
|---|---|---|
| ≠ `'edi'` | n.v.t. | `email` (PDF via `stuur-orderbevestiging`) |
| `'edi'` | `transus_actief && orderbev_uit` | `edi` (ORDRSP via Transus-wachtrij) |
| `'edi'` | anders (config null/toggles uit) | `email` — ná verzenden sluit ook `edi_bevestigd_op` (`sluitEdiGate=true`) |

Volledige tabel + de twee bevestig-gates (`bevestigd_at` vs. `edi_bevestigd_op`) staan in
order-lifecycle.md §6a. **CLAUDE.md-correctie (deze sessie):** twee tegenstrijdige
bullets stonden in CLAUDE.md — één zei "dispatch op bron_systeem + config, alle andere
orders → e-mail", de andere zei "EDI-orders krijgen nooit een e-mail-orderbevestiging".
Geverifieerd tegen de code (`bevestiging-kanaal.ts` + `order-header.tsx`): **de eerste
versie is correct en geïmplementeerd** — een EDI-order zonder actieve EDI-orderbev-config
krijgt gewoon een e-mail-bevestiging (besluit 2026-06-11, kanaal `'edi_stil'` bestaat niet
meer). De tweede bullet was stale/onjuist.

### Orders verwijderen & annuleren

**Verwijderen:** `delete_order` weigert bij `status='Verzonden'`; verder géén expliciete
snijplan-guard in de RPC zelf — een order met snijplannen in status `'Snijden'`,
`'Gesneden'` of later gooit een FK-fout op `snijplannen_order_regel_id_fkey` zodra
`DELETE FROM order_regels` wordt uitgevoerd. Snijplannen met vroege statussen
(`'Wacht'`, `'Gepland'`) moeten dus eerst handmatig verwijderd worden.

**Annuleren cascadeert naar Snijplanning (ADR-0023, mig 290, mig 480):**
`markeer_geannuleerd` schrijft een `geannuleerd`-event; drie ontkoppelde listeners op
`order_events` reageren (volledige tabel: order-lifecycle.md §5) —
reservering-release (mig 255), snijplan-release (**alle** snijplannen → `'Geannuleerd'`,
ongeacht voortgang — bewuste werkvloer-keuze, anders dan bij _verwijderen_, mig 290), en
zending-release (mig 480: verwijdert per zending met status `'Gepland'`/`'Picken'` de
regels/colli van de geannuleerde order; bundel-bewust — blijft de zending gekoppeld aan
een andere, niet-geannuleerde order, dan blijft de zending bestaan met herberekende
aantallen). **Géén "niets-gepickt"-guard** (anders dan `annuleer_pickronde`) — annuleren
is definitiever dan de "per ongeluk gestart"-correctieknop. Defense-in-depth:
`snijplanning_overzicht` filtert `WHERE o.status <> 'Geannuleerd'` (bewust niet ook
`'Verzonden'` — die view voedt ook de fysieke rol-uitvoer).

### Combi-levering (ADR-0040, mig 556-574)

Klanten kunnen op klantniveau (`debiteuren.combi_levering`) aangeven liever te wachten met
verzenden dan verzendkosten te betalen op een losse, kleine order: nieuwe orders die zelf
onder `verzend_drempel` blijven, blijven staan totdat het cumulatieve totaal van al hun
openstaande orders naar hetzelfde adres de drempel haalt, waarna ze samen als 1 zending
verzonden worden.

**Huidige-staat-model (ADR-0040, vervangt ADR-0039's Startbaarheid-gate-aanpak):** een
echte `order_status`-waarde `'Wacht op combi-levering'` — géén losse tabel/queue, geen
Pick & Ship-zichtbare-maar-geblokkeerde order. Hergebruikt het bestaande
`derive_wacht_status`-patroon (net als `Wacht op inkoop`/`Wacht op voorraad`/
`Wacht op maatwerk`):

- **Groepering:** view `combi_levering_status` groepeert op `(debiteur_nr,
  _normaliseer_afleveradres(...))` — **bewust zónder vervoerder/verzendweek** (in
  tegenstelling tot de Bundel-sleutel hierboven), want het punt is juist over meerdere
  weken heen wachten. Uitgesloten van groep-lidmaatschap: `status IN ('Verzonden',
  'Geannuleerd', 'In pickronde', 'Deels verzonden', 'Concept')`, `alleen_productie=true`,
  dropship-orders (`is_dropship_order`).
- **Prioriteit in de ladder:** laagste van de vier wacht-redenen (ná io-claim/tekort/
  maatwerk), maar **niet** in de no-touch-lijst — kan dus ook demoveren vanuit
  `Klaar voor picken` als een sibling wegvalt en de groep weer onder de drempel zakt.
- **Groep-cascade:** `herbereken_wacht_status(order_id, p_cascade_groep=true)`
  herevalueert na de eigen order ook elke sibling (recursie met `cascade=false`, max.
  diepte 2 — geen cyclus mogelijk).
- **Pick & Ship-guard:** `order_pickbaarheid.pick_ship_zichtbaar` heeft een expliciete
  `AND o.status <> 'Wacht op combi-levering'`. Een wachtende order bereikt Pick & Ship dus
  nooit — zie ook [magazijn-pickship.md](magazijn-pickship.md) voor het aanvullende Pick & Ship-vangnet
  ([`combi-levering-achtergebleven.ts`](../../frontend/src/modules/logistiek/lib/combi-levering-achtergebleven.ts))
  dat beschermt tegen een operator die handmatig een subset van een al-startbare groep
  selecteert.
- **Alle-leden-pickbaar-eis:** een order is pas startbaar als (1) het cumulatieve
  subtotaal (excl. VERZEND, generiek via `is_admin_pseudo()`) de drempel haalt, ÉN (2)
  elk lid van de groep individueel pickbaar is — les uit een eerder incident
  (ZEND-2026-0010/0006): zodra de drempel gehaald is, wordt de groep als 1 blok
  behandeld, nooit deels los verzonden.
- **Escape-hatches:** order-niveau `orders.combi_levering_override` (analoog `afhalen`)
  forceert het directe VERZEND-pad voor die ene order. Knop
  [`CombiLeveringInWachtKnop`](../../frontend/src/components/orders/combi-levering-in-wacht-knop.tsx)
  (RPC `zet_order_in_combi_levering_wacht`) zet `debiteuren.combi_levering=TRUE`
  **klantbreed** + de override voor déze order op `FALSE`, verstuurt een nieuwe
  orderbevestiging — bewaakt zelf dezelfde statuslijst als de SQL-guard.
- **Drempel-toets op vrijgavemoment:** zolang een order wacht, staat er géén VERZEND-regel
  op — twee triggers (`trg_orders_combi_levering_override`,
  `trg_debiteuren_combi_levering`) voegen/verwijderen 'm bij een override- of
  klant-instelling-wijziging, en roepen sindsdien ook `herbereken_wacht_status` aan.
- **Communicatie:** orderbevestiging (mail + PDF, 4-talig, één bron
  [`combi-levering-tekst.ts`](../../supabase/functions/_shared/combi-levering-tekst.ts))
  toont een uitlegparagraaf zolang de order wacht, query op `combi_levering_status` (niet
  lokaal herberekend). Zowel de view als frontend `applyShippingLogic` vallen bij een NULL
  `verzend_drempel` terug op dezelfde €500-default.

**Belangrijk audit trail:** [ADR-0039](../adr/0039-combi-levering-als-startbaarheid-gate.md)
(Startbaarheid-gate-aanpak: order blijft `Klaar voor picken`, alleen *starten*
geblokkeerd) is **superseded** door ADR-0040 — bij livetesten bleek dat niet de gewenste
werking (Pick & Ship moet schoon blijven van wachtende orders). ADR-0039 blijft staan als
geschiedenis, niet als geldende architectuur.

### Inkoopgroepen (mig 189)

10 INKC-organisaties staan in tabel `inkoopgroepen`; een debiteur hoort aan maximaal 1
groep via FK `debiteuren.inkoopgroep_code`. **`orders.inkooporganisatie` blijft een
TEXT-snapshot** van de inkoopgroep-code op aanmaakmoment — orders bewegen niet mee bij een
latere wijziging op de debiteur. Zie [database-schema.md](../database-schema.md#inkoopgroepen)
voor het volledige tabelmodel; centraal beheer onder `/inkoopgroepen` (klanten-domein, niet
hier verder uitgewerkt).

## Valkuilen & gotchas

- **`registreer_achteraf_order`/`markeer_achteraf_verzonden` blijven bewust buiten de
  Concept-gate** — retroactieve orders slaan de normale workflow bewust over.
- **Prijslijst-gate raakt alleen creatie, nooit edit** — een bestaande order zonder
  koppeling blijft altijd bewerkbaar; `create_edi_order`/`create_webshop_order` hebben een
  eigen fallback en zijn hier bewust niet aangepast.
- **`isAdminPseudo` ≠ `SHIPPING_PRODUCT_ID`-check** — skip-detectie (lezen) en
  regel-constructie (schrijven) zijn twee losse concepten in twee losse modules.
- **`'Wacht op inkoop'` bestaat in twee ongerelateerde enums** (`order_status` én
  `snijplan_status`) — betekenen iets anders, nooit met elkaar verwarren.
- **`sync_order_afleverdatum_met_claims` (mig 153, forward-only) ≠
  `sync_order_afleverdatum_eta` (mig 326, bidirectioneel)** — twee losse
  afleverdatum-syncs met verschillend gedrag; de laatste kan wél terugschuiven.
- **Twee bevestigings-gates, verschillend ontworpen:** `bevestigd_at` en `edi_bevestigd_op`
  (eenmalig) vs. `levertijd_wijziging_te_bevestigen_sinds` (herhaalbaar, open/dicht) — bewuste
  ontwerpkeuze, niet inconsistentie.
- **Kanaal `'edi_stil'` bestaat niet meer** — als je die term nog tegenkomt in oudere code
  of docs, is dat verouderd; de huidige dispatch kent alleen `'edi'`/`'email'`.
- **`env_fallback` in de debiteur-matcher telt bewust NIET mee** in "debiteur te
  bevestigen" — dat is de verwachte eindbestemming voor een verzameldebiteur (consumenten-
  webshop met wisselend afleveradres), geen foutsignaal.
- **Combi-levering-groepering gebruikt een 2D-sleutel** (debiteur × adres), **niet** de 4D
  Bundel-sleutel (die ook vervoerder + verzendweek meeneemt) — verschillende doelen: de
  bundel-sleutel bepaalt "welke orders delen 1 fysieke zending", Combi-levering bepaalt
  "welke orders wachten samen op de vrachtvrije-drempel, over weken heen".
  Deploy-volgorde bij groepswijzigingen aan de bundel-sleutel: golden fixtures bijwerken +
  nieuwe contract-migratie (zie `bundel-sleutel.ts`-header).
- **Deploy-volgorde intake-gates (mig 395-396):** moeten vóór de frontend live staan — de
  Pick & Ship-query en `orders_list` lezen de nieuwe kolommen direct.
- **Deploy-volgorde combi-levering-migraties:** `ALTER TYPE ... ADD VALUE` (mig 563) moet
  in een **geïsoleerd migratiebestand** staan — Postgres staat het niet toe in dezelfde
  transactie als gebruik van de nieuwe waarde (project-precedent: mig 437/438).
- **RPC-bodies nooit uit `supabase/migrations/` lezen** — dezelfde functie is soms tot 16×
  herdefinieerd; de canonieke bron is de snapshot (`supabase/schema/functies.sql`/
  `views.sql`), zie order-lifecycle.md §3.3.
- **`update_order_with_lines` herdefiniëren = van de snapshot uitgaan én
  `assert_update_order_header_contract()` aanroepen** — mig 527 herschreef de body vanaf
  een verouderde versie en verloor stilzwijgend 4 header-kolommen (`afhalen`, `lever_type`,
  `fact_email`, `afl_email`); drie latere herdefinities (547/548/572) namen de kapotte
  body over. Hersteld in mig 585. JSONB-RPC's droppen onbekende/ontbrekende sleutels
  zonder fout — de assert is de enige harde bewaking.
- **Intake-regelmatching (Shopify/Lightspeed) is N+1-bewust gemaakt (perf, geen
  bedrijfsregel-wijziging):** `buildRegels`/`buildLightspeedRegels` halen
  `debiteuren` (korting_pct/prijslijst_nr/naam) nu één keer per order-run op i.p.v.
  per orderregel, en geven `haalKlantPrijs` de `prijslijstNr` mee. `matchProduct`
  krijgt daarnaast een optionele `IntakeCache` (`_shared/order-intake/intake-cache.ts`)
  die `klanteigen_namen` per debiteur memoized binnen één run — bewust GEEN
  module-globale cache (edge functions blijven warm; stale-data-risico over
  orders/debiteuren heen). Matching-volgorde/-prioriteit is ongewijzigd; alleen
  de query-herhaling is weg. Bewust niet aangepakt: de overige `producten`/
  `karpi_code`/`ean`-lookups verderop in `matchProduct` (afhankelijk van
  eerdere match-uitkomst per regel — batchen zou de aanroepvolgorde kunnen
  wijzigen) en `matchAliasGlobaalUniek` (query hangt af van het eerste woord
  van de productnaam, wisselt per regel).

## Openstaand / V2

- **Debiteur-matcher, Slice 5 (nog open):** échte Floorpassion-B2B-matching achter dezelfde
  GLN/fuzzy-ladder (nu nog `env_fallback`); e-mailkanaal (heeft al een eigen `zeker` uit
  `match_klant_po`) aansluiten op het generieke `debiteur_zeker`-veld — nu nog gedekt door
  de Concept-review (mig 308) in plaats van het expliciete gate-mechanisme.
