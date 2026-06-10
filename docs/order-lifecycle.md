# Order-lifecycle — statusmodel, gates en flow

> **Levend document** (aangemaakt 2026-06-10). Dit is de toetssteen voor elke wijziging
> die de order-flow raakt: statussen, transities, gates, intake, productie, magazijn.
> Werk het bij wanneer een migratie een transitie/gate toevoegt of wijzigt.
> Vuistregel bij RPC's: **de hoogst-genummerde migratie met `CREATE OR REPLACE` wint** —
> zie §3.3 voor de actuele eigenaar per RPC.

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

Enum `order_status` (snapshot geborgd door mig 349). Drie categorieën:

| Status | Categorie | Sinds | Betekenis / eigenaar |
|---|---|---|---|
| `Concept` | canoniek | mig 308 | E-mail-orders in review; allocator/snijplan **gegate** tot bevestiging |
| `Klaar voor picken` | canoniek | mig 257 | Default-landing (mig 275) én "alles gedekt"-doelstatus |
| `Wacht op voorraad` | canoniek | base | ≥1 regel met tekort zonder IO-claim |
| `Wacht op inkoop` | canoniek | mig 144 | ≥1 actieve IO-claim |
| `Wacht op maatwerk` | canoniek | mig 257 | ≥1 maatwerk-regel zonder snijplan `'Ingepakt'` |
| `In pickronde` | canoniek | mig 257 | Zending in `'Picken'`; command-beheerd (mig 258) |
| `Deels verzonden` | canoniek | mig 257 | ≥1 zending verzonden, ≥1 open |
| `Verzonden` | **terminaal** | base | Laatste open zending voltooid |
| `Geannuleerd` | **terminaal** | base | `markeer_geannuleerd` + event-cascade (§5) |
| `Maatwerk afgerond` | **terminaal** | mig 327 | Alleen productie-only; alle snijplannen geconfectioneerd |
| `Nieuw` | legacy | base | **Deprecated sinds mig 275** — wordt niet meer geschreven |
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
| `markeer_pickronde_gestart` | → `In pickronde` | no-op op pickronde-fases; faalt op eindstatus | mig 258 |
| `markeer_deels_verzonden` | → `Deels verzonden` | idem | mig 258 |
| `herbereken_wacht_status` | → Wacht-op-X / `Klaar voor picken` | zie §4 | mig 275 (laatste) |
| `voltooi_confectie` (na-stap) | → `Maatwerk afgerond` | alleen `alleen_productie=true` + alle snijplannen afgerond | mig 347 |

### 3.2 Bekende uitzonderingen op het ene schrijfpad ⚠️

| Plek | Wat | Status |
|---|---|---|
| [`330_voltooi_confectie_maatwerk_afgerond.sql:80`](../supabase/migrations/330_voltooi_confectie_maatwerk_afgerond.sql) | directe `UPDATE orders SET status='Maatwerk afgerond'` | **Opgelost in mig 347** (via `_apply_transitie` + event `maatwerk_afgerond`) |
| [`308_concept_order_status.sql:126`](../supabase/migrations/308_concept_order_status.sql) | `bevestig_concept_order`: directe `UPDATE` + eigen events-INSERT | Open (bevinding B3) |
| `import_productie_only_order` (mig 329) | directe INSERT met status `'In productie'` | bewust: legacy-status, `herbereken` raakt hem niet aan |

### 3.3 RPC → actuele definitie (hoogst-genummerde migratie wint)

| RPC | Laatste definitie | Eerdere versies |
|---|---|---|
| `create_order_with_lines` | **mig 275** (status `'Klaar voor picken'`) | 152, 245 |
| `create_edi_order` | **mig 312** | 158, 159, 166, 309, 275 (string-patch) |
| `match_edi_artikel` | **mig 348** (maat-suffix-guard) | 159, 162 |
| `create_webshop_order` | **mig 322** (`debiteur_zeker`) | 085, 092, 308, 343 |
| `herbereken_wacht_status` | **mig 275** | 218, 258, 267 |
| `voltooi_confectie` | **mig 347** (`_apply_transitie`) | 101, 247, 250, 330 |
| `voltooi_pickronde` | mig 218 + bundel-aware (mig 222/242) | 217 |
| `start_pickronden` (unified) | **mig 248** | 220, 222 |

## 4. `herbereken_wacht_status` — beslislogica (mig 275)

Volgorde, eerste match wint:

1. **No-touch**: huidig ∈ {`Verzonden`, `Geannuleerd`, `Klaar voor verzending`,
   `In productie`, `In snijplan`, `Deels gereed`, `Wacht op picken`,
   `In pickronde`, `Deels verzonden`} → return. (`Maatwerk afgerond` staat niet in
   die lijst — gedekt doordat de mig 347-na-stap zelf de eindcheck doet.)
2. ≥1 actieve claim `bron='inkooporder_regel'` → `Wacht op inkoop`
3. ≥1 niet-maatwerk, niet-admin-pseudo regel met `te_leveren > SUM(claims)` → `Wacht op voorraad`
4. ≥1 maatwerk-regel zonder snijplan `'Ingepakt'` → `Wacht op maatwerk`
5. Huidig ∈ {Wacht-op-X, `Nieuw`} → `Klaar voor picken`
6. Anders → no-op

Admin-pseudo-regels (`producten.is_pseudo`, ADR-0018) tellen nergens mee.
*Een parallel plan (2026-06-10, "order-status single-source") extraheert deze
ladder naar een pure `derive_wacht_status`-functie + TS-spiegel — gedrags-identiek.*

## 5. `order_events` — types en listeners

**Event-types** (mig 218 + 257 + 346): `aangemaakt`, `wacht_status_herberekend`,
`pickronde_gestart`, `deels_verzonden`, `pickronde_voltooid`, `geannuleerd`,
`backfill_fase_normalisatie`, `maatwerk_afgerond` (mig 346), plus domein-events
`claim_geswapt` (ADR-0027) en `levertijd_gewijzigd_door_eta` (mig 326).

**Listeners (triggers op `order_events`):**

| Trigger | Vuurt op | Doet | Bron |
|---|---|---|---|
| `trg_enqueue_factuur_op_event` | `pickronde_voltooid` + `status_na='Verzonden'` | factuur op queue (voorkeur per_zending/wekelijks) | mig 223 |
| `trg_order_events_reservering_release` | `geannuleerd` | alle actieve claims → `released` | mig 255 |
| `trg_order_events_snijplan_release` | `geannuleerd` | **alle** snijplannen → `'Geannuleerd'` (ongeacht voortgang) + rollen vrijgeven met NOT-EXISTS-guard | mig 290 |

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

Eenmalige gates (EDI-leverweek, debiteur) vs. herhaalbare gate (levertijd) — bewust
verschillend ontworpen (zie CLAUDE.md, mig 326-toelichting). Alle predicaten hebben
één bron-van-waarheid-helper; inline duplicaten zijn opgeruimd (intake-consolidatie slice 2).

## 7. Intake-kanalen — verschillen-matrix

| | Handmatig | EDI | Shopify | Lightspeed webhook | Lightspeed cron | E-mail |
|---|---|---|---|---|---|---|
| RPC | `create_order_with_lines` | `create_edi_order` | `create_webshop_order` | `create_webshop_order` | `create_webshop_order` | `create_webshop_order` |
| Initiële status | Klaar voor picken | Klaar voor picken | Klaar voor picken | Klaar voor picken | Klaar voor picken | **Concept** |
| Idempotency | geen (UI) | `(edi, TransactionID)` | `(shopify, order_id)` | `(lightspeed, order_id)` | idem | `(email, message_id)` |
| Debiteur-matching | UI-selector | GLN-ladder ([`debiteur-matcher.ts`](../supabase/functions/_shared/debiteur-matcher.ts)) | fuzzy-ladder + fallback | env `FLOORPASSION_DEBITEUR_NR` | idem | `match_klant_po` |
| Afleverdatum | UI (`bepaalOrderAfleverdatum`) | partner-header (+ snapshot) | note-attr of +7d | uit shipmentTitle | idem (sinds B4-fix; was NULL) | parse of vandaag |
| `lever_modus`/`lever_type` | UI-dialog/toggle | NULL → defaults | NULL | NULL | NULL | NULL |
| Maatwerk-regels | ja | **nee — vangnet mig 348 (B1)** | ja | ja | ja | onduidelijk |
| Allocator + snijplan-trigger | direct (INSERT-triggers mig 146/274) | direct | direct | direct | direct | **pas na bevestiging** |

Na elke landing: INSERT-trigger op `order_regels` → `herallocateer_orderregel` →
`herwaardeer_order_status`/`herbereken_wacht_status`; maatwerk-INSERT →
`auto_maak_snijplan` (mig 274/328).

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
| → `Gereed`/`Ingepakt` | `voltooi_confectie` (mig 347; zet `confectie_afgerond_op`) |
| any → `Geannuleerd` | order-annulerings-cascade (mig 290) |

Koppeling naar de order: maatwerk-regel is pickbaar ⇔ alle snijplannen `'Ingepakt'`;
tot die tijd houdt regel 4 van §4 de order op `Wacht op maatwerk`. Voor productie-only
orders flipt `voltooi_confectie` de order naar `Maatwerk afgerond` zodra alle
snijplannen `confectie_afgerond_op` hebben (inpak-stap niet vereist) — via
`_apply_transitie` met event `maatwerk_afgerond` (mig 346/347).

**Dubbele bezet-guard (mig 301, VERR130-incident):** planning-pool sluit rollen uit op
`snijden_gestart_op IS NOT NULL` **én** op ANY snijplan in `Snijden`/`Gesneden` —
beide nodig vanwege het window tussen status-promotie en rol-vlag.

## 9. Magazijnpad — pickbaarheid → zending → Verzonden → factuur

1. **Pickbaarheid** ([`pickbaarheid.ts`](../frontend/src/modules/magazijn/queries/pickbaarheid.ts)):
   order zichtbaar in Pick & Ship als álle regels pickbaar (of ≥1 bij
   `deelleveringen_toegestaan`). Uitgesloten: productie-only (`alleen_productie=false`-filter),
   dag-orders buiten horizon (`werkdagMinN(afleverdatum, 1)`), header-only orders.
2. **Pickronde-start** (`start_pickronden`, mig 248): 4D-bundel-expansie
   (debiteur × adres × vervoerder × verzendweek), één zending per bundel
   (status `'Picken'`), order → `In pickronde`.
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
  Sinds mig 347 met `order_events`-audit (`maatwerk_afgerond`).

## 11. Bevindingen (2026-06-10) — getriageerd

Status-legenda: ✅ = gefixt op branch `fix/order-lifecycle-hardening` (mig 346-349).

### A. Go-live-relevant (verzending + maatwerk volgende week)

- **B1 — EDI kan geen maatwerk landen.** ✅ *vangnet* — het Transus-formaat draagt
  maat/vorm alleen als tekst-suffix in de artikelcode; de token-match dropte die
  stilzwijgend. Mig 348 weigert een token-match wanneer de suffix een maat-patroon
  (`155x230`) of vorm-woord (`rund`/`rond`/`ovaal`) bevat → regel landt als
  ongematcht in de bestaande 'Actie vereist'-flow, operator beoordeelt. **Echte
  EDI-maatwerk-parsing = V2** zodra de geweigerde regels een corpus vormen.
- **B2 — `Maatwerk afgerond` zonder order_event.** ✅ — mig 346 (event-type
  `maatwerk_afgerond`) + mig 347 (`voltooi_confectie` via `_apply_transitie`).
- **B4 — Lightspeed-cron landt orders zonder afleverdatum.** ✅ —
  `import-lightspeed-orders` gebruikt nu dezelfde `bepaalAfleverdatumUitOrder` +
  `maatwerk_weken`-fallback als het webhook-pad. **Redeploy edge function nodig.**

### B. Contract-borging

- **B5 — Order-status-enum-snapshot-assert.** ✅ — mig 349 (set-vergelijking;
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

### C. Opruimen/V2

- **B3 — `bevestig_concept_order` buiten `_apply_transitie`** (mig 308:126): event
  wordt wel gelogd maar met eigen INSERT (afwijkende kolommen) en zonder de
  `verzonden_at`-logica van het ene schrijfpad. Meenemen bij eerstvolgende
  Concept-flow-wijziging.
- **B7 — mig 275 patcht `create_edi_order` via string-`REPLACE()`** — fragiel patroon;
  inmiddels overruled door mig 312, maar niet herhalen.
- **B8 — `lever_modus`/`lever_type` blijven NULL bij alle externe kanalen.** Voor
  `lever_type` is er een debiteur-default; `lever_modus` blijft NULL ook als een
  externe order tekort heeft (de `LeverModusDialog` bestaat alleen in het handmatige
  kanaal). Gevolg voor levertijd-berekening van externe orders met tekort onderzoeken.
- **B9 — `order_events` draagt geen intake-kanaal-metadata** — audit ziet niet via
  welk kanaal een order ontstond (alleen `orders.bron_systeem`). Nice-to-have.
- **B10 — Legacy statussen** (`Nieuw`, `Actie vereist`, `In snijplan`, `Deels gereed`,
  `Wacht op picken`) staan nog in de enum; `In productie` is hergebruikt door
  productie-only (mig 329). Opruim-/hernoem-kandidaat zodra productie-only een
  eigen status krijgt.
