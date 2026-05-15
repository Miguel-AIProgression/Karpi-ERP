---
status: accepted
date: 2026-05-13
---

# Levertijd als deep Module — planning-fit-checker met order-niveau status-label

## Context

Levertijd-logica is in de huidige codebase versplinterd over drie runtimes en vijf interface-ingangen, zonder duidelijke eigenaar. De vraag "wanneer kunnen we deze regel/order leveren?" wordt beantwoord door samenwerkende fragmenten met verschillende vocabulaires (werkdagen / weken / capaciteit-per-week) en zonder gedeelde ground-truth.

### Sprawl (≈1400 regels verspreid)

**Frontend TS:**
- [`lib/utils/bereken-agenda.ts`](../../frontend/src/lib/utils/bereken-agenda.ts) — 354 regels: werkdag-rekenkunde, `werkdagMinN`, `bucketVoor`, ISO-week-helpers
- [`lib/orders/order-afleverdatum.ts`](../../frontend/src/lib/orders/order-afleverdatum.ts) — 41 regels: statische klant-config-fallback (`bepaalOrderAfleverdatum`)
- [`modules/maatwerk/lib/leverdatum.ts`](../../frontend/src/modules/maatwerk/lib/leverdatum.ts) — 66 regels: `berekenMaatwerkAfleverdatumViaSeam`
- [`hooks/use-levertijd-check.ts`](../../frontend/src/hooks/use-levertijd-check.ts) — 83 regels
- [`lib/supabase/queries/levertijd.ts`](../../frontend/src/lib/supabase/queries/levertijd.ts) — 97 regels

**Deno-edge (`_shared/`, ~534 regels):**
- [`werkagenda.ts`](../../supabase/functions/_shared/werkagenda.ts) — 203 regels (een **TS-spiegel** van delen van `bereken-agenda.ts` — twee runtimes, twee implementaties)
- [`levertijd-capacity.ts`](../../supabase/functions/_shared/levertijd-capacity.ts) — 138 regels
- [`levertijd-match.ts`](../../supabase/functions/_shared/levertijd-match.ts) — 196 regels
- [`levertijd-resolver.ts`](../../supabase/functions/_shared/levertijd-resolver.ts) — 200 regels
- Edge-function `check-levertijd` als enige uitvoerder

**SQL:**
- View `order_regel_levertijd` (mig 150) — eigendom Reservering-Module (data-woordenboek's "Verwachte leverweek")
- SQL-helpers `iso_week_plus`, `verzendweek_voor_datum`
- `sync_order_afleverdatum_met_claims` (mig 153/254) — eigendom Reservering, schrijft `orders.afleverdatum` op IO-claim-pad

### Vijf interface-ingangen, geen unieke schrijver

De vraag "wat is de leverbelofte?" heeft vijf antwoorden, elk op een andere plek:

1. **Form-time hint** — `bepaalOrderAfleverdatum` rekent statisch werkdagen op `orderdatum`
2. **Maatwerk-seam** — `berekenMaatwerkAfleverdatumViaSeam` roept edge-function `check-levertijd` aan voor capaciteit-check
3. **IO-claim-sync** — Reservering's `sync_order_afleverdatum_met_claims` schuift `afleverdatum` vóóruit bij IO-vertraging (mig 153)
4. **Order-commit** — Order-form schrijft `orders.afleverdatum` rechtstreeks bij save
5. **Pick-horizon** — Magazijn's `bucketVoor` consumeert `afleverdatum` voor pick-week-bucket via `werkdagMinN`

[ADR-0014](0014-leveren-op-leverdatum-naast-leverweek.md) moest voor de `lever_type`-introductie in drie aparte files patchen (`bereken-agenda.ts`, `pickbaarheid.ts`, `check-levertijd`-edge) plus een SQL-config-sleutel. Werkagenda-helper is tweemaal gespiegeld (TS `werkdagMinN` ↔ Deno `werkagenda.ts`). Snij-marge heeft sinds [ADR-0013](0013-snijplanning-module-en-cache-invalidation-seam.md) een erkende seam (`stuk_snij_marge_cm`); levertijd-rekenkunde niet.

### Deletion test

Verwijder `bereken-agenda.ts` + `_shared/werkagenda.ts` + `check-levertijd`-edge: order-form-hint, maatwerk-datum-resolve, pick-bucket-categorisering, dag-order-Pick-Ship-window, en capaciteit-bewuste maatwerk-levertijd vallen samen om. Reservering's `order_regel_levertijd`-view blijft staan (los pad), maar het capaciteit-bewuste antwoord is verloren. De logica **verdient** depth.

### Trigger: klant-communicatie als ankerdoel

Aanleiding voor deze ADR: Karpi wil aan de **voorkant** van het order-intake-proces aan de klant kunnen communiceren dat de levertijd afwijkt van standaard (eerder als haast, later als planning vol), met goede check tegen actuele snij-planning. Vandaag is dat per-component-improvisatie; consistent doorzetten naar UI-badge, pakbon-comm, EDI ORDRSP en factuur is alleen mogelijk als één Module het label persistent schrijft.

## Beslissing

Levertijd-Module wordt een **planning-fit-checker** met smal publiek interface, **niet** eigenaar van de leverbelofte zelf. Vijf ingrepen.

### Ingreep 1 — Module-scope: capaciteit-seam owner (niet beloofte-eigenaar)

Module bezit:
- **Werkagenda-rekenkunde** als single ground-truth in SQL (`werkdag_min_n`, `werkagenda_kalender`)
- **Capaciteit-match** voor maatwerk-regels: open snijplannen + `productie_planning`-config (V1: snij; V2-backlog: confectie)
- **Fit-check-resolver** voor voorraad-regels: read-only lookup in Reservering's `order_regel_levertijd`-view + uitwisselbaar-dekking
- **Status-label** `orders.levertijd_status` — enige schrijver (zie Ingreep 3)
- **Standaard-snapshot** `orders.standaard_afleverdatum_berekend` — bevroren bij commit, voorkomt retro-effects bij klant-config-wijziging

Module bezit **niet**:
- `orders.afleverdatum` zelf — blijft Order-Module (commit-pad) en Reservering-Module (IO-claim-sync via mig 153/254)
- View `order_regel_levertijd` — blijft Reservering's bezit; Levertijd-Module is consumer
- Statische klant-config-fallback (`bepaalOrderAfleverdatum`) — pure formule op klant-config-velden, blijft Order-Module
- Bucket-/pick-week-logica (`bucketVoor`) — Magazijn-Module's bezit, consumeert Levertijd's werkagenda-SQL-functies via TS-spiegel-helper

**Scope-onderscheid met Reservering:** Reservering bezit het **claim-/IO-driven** antwoord ("welke week komt deze regel uit de keten als ik niets forceer?"); Levertijd bezit het **capaciteit-/planning-driven** antwoord ("is die week haalbaar?", "kan het sneller als ik forceer?"). De twee Modules raken elkaar via een read-only view — geen schrijf-conflict.

### Ingreep 2 — SQL-Module met dunne wrappers (analoog aan Gewicht-resolver)

Implementatie-keuze uit grilling-loop 2026-05-13: **(iii) SQL als ground-truth**. Werkagenda-rekenkunde wordt Postgres-functies, capaciteit-match een PL/pgSQL-RPC, frontend en edges consumeren beide via dezelfde RPC. Eén ground-truth, geen runtime-spiegels meer.

**Werkagenda-spiegels** (`werkdagMinN` in `bereken-agenda.ts` ↔ `werkagenda.ts` in `_shared/`) worden vervangen door SQL-functies. Uitzondering: TS-helpers in `bereken-agenda.ts` blijven voor UI-rekenwerk dat geen DB-roundtrip mag triggeren (Magazijn's `bucketVoor` doet honderden bucket-toetsen tijdens render — niet over te zetten naar RPC zonder cache).

`_shared/levertijd-*.ts` (Deno-edge, ~530 regels) wordt **niet ineens** naar SQL gemigreerd. Eerste stap: edge-function `check-levertijd` wordt thin wrapper rond de twee nieuwe RPC's; bestaande Deno-logica blijft als implementatie-detail achter de RPC tot een latere stap.

### Ingreep 3 — Twee publieke RPC's, smal interface

Uit grilling: (ii) twee aparte RPC's, semantiek verschilt te veel voor één parameter-flag.

```sql
levertijd_fit_check(p_regel_ids BIGINT[], p_gewenste_week TEXT)
  RETURNS TABLE (
    regel_id BIGINT,
    haalbaar BOOLEAN,
    reden TEXT,
    eerstvolgend_haalbaar TEXT
  )

levertijd_snelste_haalbaar(p_regel_ids BIGINT[])
  RETURNS TABLE (
    regel_id BIGINT,
    snelste_haalbaar TEXT,
    spoed_uitleg TEXT
  )
```

`p_gewenste_week` is een ISO-weekstring (`'2026-W24'`). Beide RPC's accepteren een array zodat een complete order in één call gecheckt kan worden (form-time-aanroep doet één RPC per mutation-cycle, niet N).

Voor **voorraad-regels** delegeren beide RPC's intern naar Reservering's `order_regel_levertijd`-view; geen eigen capaciteit-rekenpad. Voor **maatwerk-regels** doet `fit_check` een lichte capaciteit-match (passt gewenste week tegen open snijplannen-bezetting + buffer), en `snelste_haalbaar` doet een diepere zoek (mid-week-slots, uitwisselbaar-omsticker-pad).

### Ingreep 4 — Label-design: order-niveau enum + bevroren snapshot

Uit grilling: (A) order-niveau, niet regel-niveau. Twee nieuwe kolommen:

```sql
ALTER TABLE orders
  ADD COLUMN levertijd_status TEXT
    CHECK (levertijd_status IN ('standaard', 'eerder_dan_standaard', 'later_dan_standaard')),
  ADD COLUMN standaard_afleverdatum_berekend DATE;
```

- `standaard_afleverdatum_berekend` — snapshot bij commit van wat de klant-config-formule (`debiteuren.standaard_maat_werkdagen` + `maatwerk_weken`, of `app_config.order_config`-defaults) bij `orderdatum` zou hebben opgeleverd. **Bevroren**, immutable na commit. Voorkomt rare retro-effects als klant-config later wijzigt.
- `levertijd_status` — gederiveerd uit `orders.afleverdatum` vs `standaard_afleverdatum_berekend` op het moment van schrijven.

**Wie schrijft `levertijd_status`?**
- Bij order-commit: Module zet `standaard_afleverdatum_berekend` (snapshot) + initiële `levertijd_status` op basis van `afleverdatum`-vs-snapshot
- Post-commit: trigger op `orders.afleverdatum`-change herberekent `levertijd_status` (afleverdatum ≤ snapshot → 'standaard' of 'eerder'; > snapshot → 'later'). Zo flipt het label automatisch als Reservering's `sync_order_afleverdatum_met_claims` (mig 153) de afleverdatum vooruit schuift bij IO-vertraging — geen handmatige actie nodig.

**Onderscheid met `is_spoed`:** `is_spoed` is een klant-aanvraag (input — "haast graag"); `levertijd_status` is de planning-uitkomst (output — "afwijking is daadwerkelijk vastgelegd"). Beide blijven bestaan, los van elkaar.

### Ingreep 5 — UX-aanhechting: badge naast ordernummer

Module exporteert slot-component `<LevertijdStatusBadge orderId={..}>` (patroon analoog aan `<KlantBenaming>`, `<VervoerderTag>`, `<InkoopRegelSamenvatting>` — directe barrel-import door consumers).

Consumers in V1:
- **Order-list** (`pages/orders/orders-overview.tsx`): chip naast ordernummer, kleurcoded per enum-waarde (groen = standaard, oranje = eerder, geel/rood = later). Past in de bestaande chip-rij naast `ZEND-2026-NNNN`-badges.
- **Order-detail header** (`pages/orders/order-detail.tsx`): chip naast `Nieuw`-status, met tooltip "klant-standaard wk 25 → actuele belofte wk 24, operator heeft snelste overgenomen" of "wk 25 → wk 27, IO INK-2026-0123 vertraagd".
- **Order-form** (`components/orders/order-form.tsx`): live "haalbaar"-indicator per regel via continue debounced `useFitCheck`-hook + één knop "Snelste haalbare week overnemen" als `useSnelsteHaalbaar` een betere optie teruggeeft.

V2-backlog UX-consumers: pakbon-badge, EDI ORDRSP-toelichting, factuur-PDF-vermelding, Floorpassion-confirmatie-email.

## Module-Interface (publieke barrel)

`modules/levertijd/index.ts` exporteert:

**Hooks (queries):**
- `useFitCheck(regelIds, gewensteWeek)` — debounced, continue caller voor form-time-haalbaarheids-check
- `useSnelsteHaalbaar(regelIds)` — on-demand, getriggerd door operator-knop "Klant heeft haast"
- `useLevertijdStatus(orderId)` — leest `orders.levertijd_status` voor badge-rendering

**Mutations:**
- `useNeemSnelsteOver(orderId, gekozenWeek)` — past `orders.afleverdatum` aan, Module zet `levertijd_status='eerder_dan_standaard'` als deel van dezelfde transactie

**Components:**
- `<LevertijdStatusBadge>` — slot voor order-list + order-detail header
- `<LevertijdFitIndicator>` — inline indicator in order-form per regel
- `<SnelsteHaalbaarKnop>` — operator-actie om snelste over te nemen

**Types:** `LevertijdStatus`, `FitCheckResultaat`, `SnelsteHaalbaarResultaat`.

**Cache:** `invalidateNaLevertijdMutatie(qc)` — chained door order-mutaties wanneer `afleverdatum` wijzigt.

Geen barrel-export van losse query-functies of werkagenda-helpers — die blijven SQL-private + (waar UI-pad nodig) TS-pure-helper in `bereken-agenda.ts`.

## Frontend-folder-structuur

```
frontend/src/modules/levertijd/
├── index.ts                          ← barrel
├── cache.ts                          ← invalidateNaLevertijdMutatie
├── hooks/
│   ├── use-fit-check.ts              ← NIEUW (vervangt use-levertijd-check.ts)
│   ├── use-snelste-haalbaar.ts       ← NIEUW
│   ├── use-levertijd-status.ts       ← NIEUW
│   └── use-neem-snelste-over.ts      ← NIEUW
├── queries/
│   └── levertijd.ts                  ← van lib/supabase/queries/levertijd.ts
├── lib/
│   ├── status-derive.ts              ← pure: afleverdatum + snapshot → enum
│   └── __tests__/
│       ├── status-derive.test.ts     ← NIEUW
│       └── fit-check-contract.test.ts ← NIEUW (RPC-contract fixtures)
└── components/
    ├── levertijd-status-badge.tsx    ← slot
    ├── levertijd-fit-indicator.tsx   ← inline in order-form
    └── snelste-haalbaar-knop.tsx     ← operator-actie
```

## SQL-ingreep — Mig 276 (eerste van een reeks)

Pattern conform [ADR-0017](0017-inkoop-als-deep-module.md) / mig 271 (smal contract, body-migratie incrementeel):

```sql
-- 1. Schema: nieuwe kolommen op orders
ALTER TABLE orders
  ADD COLUMN levertijd_status TEXT
    CHECK (levertijd_status IN ('standaard', 'eerder_dan_standaard', 'later_dan_standaard')),
  ADD COLUMN standaard_afleverdatum_berekend DATE;

-- 2. Werkagenda-functies (single ground-truth)
CREATE OR REPLACE FUNCTION werkdag_min_n(p_datum DATE, p_n INT) RETURNS DATE ...
CREATE OR REPLACE FUNCTION werkagenda_kalender(p_van DATE, p_tot DATE) RETURNS SETOF DATE ...

-- 3. Publieke RPC's (smal contract)
CREATE OR REPLACE FUNCTION levertijd_fit_check(...) RETURNS TABLE (...) ...
CREATE OR REPLACE FUNCTION levertijd_snelste_haalbaar(...) RETURNS TABLE (...) ...

-- 4. Status-trigger
CREATE OR REPLACE FUNCTION trg_levertijd_status_recalc() RETURNS TRIGGER ...
CREATE TRIGGER trg_orders_afleverdatum_status
  AFTER UPDATE OF afleverdatum ON orders
  FOR EACH ROW EXECUTE FUNCTION trg_levertijd_status_recalc();

-- 5. Backfill voor bestaande orders
UPDATE orders SET
  standaard_afleverdatum_berekend = ...  -- her-derive uit klant-config bij orderdatum
WHERE standaard_afleverdatum_berekend IS NULL;
```

**Body-migratie incrementeel:** in mig 272 zit de skeleton + werkagenda-functies + status-trigger + backfill. Capaciteit-match-logica van `_shared/levertijd-capacity.ts`/`levertijd-match.ts` blijft Deno-side achter `check-levertijd`-edge tot een vervolg-migratie; de RPC's roepen dan tijdelijk de edge aan via `extensions.http` of vergelijkbaar, of (eenvoudiger) de RPC's bevatten een eerste SQL-versie die "good enough" is voor maatwerk-fit-check zonder de volle Deno-resolver-logica. Definitieve keuze tijdens implementatie.

Edge-function `check-levertijd` blijft bestaan als thin RPC-wrapper voor back-compat met `berekenMaatwerkAfleverdatumViaSeam`-callers; gemarkeerd DEPRECATED na de migratie en in een vervolg-release verwijderen.

## Migratiepad

Conform "Na ADR direct stap 1/N committen": **ADR + Stap 1 (schema + RPC-skeleton) in één commit**. Vervolgstappen in `docs/superpowers/plans/2026-05-13-levertijd-als-deep-module.md`:

1. **Stap 1 — Mig 276: schema (kolommen + check-constraints) + status-trigger + backfill** (deze commit)
2. **Stap 2 — RPC-skeleton:** `levertijd_fit_check` + `levertijd_snelste_haalbaar` met initiële SQL-implementatie voor voorraad-regels (delegate naar `order_regel_levertijd`-view)
3. **Stap 3 — Module-skelet:** `modules/levertijd/` met barrel, cache, types
4. **Stap 4 — Hook-migratie:** `useFitCheck` vervangt `useLevertijdCheck`; `useSnelsteHaalbaar` + `useNeemSnelsteOver` nieuw
5. **Stap 5 — Status-badge:** `<LevertijdStatusBadge>` slot + integratie in order-list + order-detail header
6. **Stap 6 — Order-form integratie:** continue debounced fit-check + snelste-haalbaar-knop + overneem-flow
7. **Stap 7 — Maatwerk capaciteit-match SQL:** verplaats `_shared/levertijd-capacity.ts`/`levertijd-match.ts`-logica naar PL/pgSQL onder `levertijd_fit_check` en `levertijd_snelste_haalbaar`; `check-levertijd`-edge wordt thin wrapper
8. **Stap 8 — Werkagenda-spiegel-cleanup:** Deno's `_shared/werkagenda.ts` vervangen door RPC-calls naar SQL-werkdag-functies; TS-spiegel in `bereken-agenda.ts` behouden voor UI-pad maar markeren als "synchronous-only mirror — see Levertijd-Module SQL ground-truth"
9. **Stap 9 — Lint + ESLint:** `scripts/lint-no-direct-levertijd-write.sh` (geen directe writes naar `orders.levertijd_status` of `standaard_afleverdatum_berekend` buiten Module-RPC's), ESLint `no-restricted-imports` voor oude paden
10. **Stap 10 — Docs:** `architectuur.md` Module-graf-paragraaf (dertiende Module), changelog

## Overwogen alternatieven

- **Module-vorm (A) Policy-only / (B) Eigenaar van de leverbelofte** — afgewezen in grilling 2026-05-13 ten gunste van (C) Capaciteit-seam owner. (A) is shallow (geen DB-eigendom = geen seam); (B) zou Reservering's `sync_order_afleverdatum_met_claims` overschrijven, wat een tweede schrijver van `orders.afleverdatum` introduceert in plaats van het juist te concentreren.

- **Bevroren leverbelofte-tabel + EDI-update-flow (scope (b)/(c) uit grilling)** — afgewezen voor V1. Klant-communicatie-doel ("voorkant kunnen zeggen later/eerder") wordt door de UI-badge + status-label volledig bediend. Audit-trail van belofte-wijzigingen en proactieve klant-updates bij IO-vertraging zijn V2.

- **Scenario-set met prijs-tags (β/γ uit grilling)** — afgewezen. Karpi-flow is een binaire keuze: "klopt standaard?" en "zo niet/op aanvraag: snelst haalbaar". Geen marketplace van geprijsde varianten; spoed-toeslag (waar van toepassing) blijft Pricing-domein, niet Levertijd.

- **Capaciteit-slot-reservering bij snelste-haalbaar (γ)** — afgewezen voor V1. Race-conditie tussen gelijktijdige spoed-aanvragen los je optimistisch op bij commit (laatste-keuze-staat-bij-overflow → operator krijgt "scenario niet meer beschikbaar"-fout). Reservering-tabel is overkill zolang spoed-vraag laagvolume blijft.

- **Confectie-capaciteit-check in V1** — afgewezen. Snij is de zichtbare bottleneck en zit al in `check-levertijd`; confectie-lane-bezetting (`confectie_planning_forward`-view) hoort thematisch erbij maar voegt onbeperkt veel scope toe (per `type_bewerking`, parallelle werkplekken). V2-backlog. RPC-interface laat ruimte voor uitbreiding zonder breaking change.

- **Werkagenda-spiegels op één plek samenvoegen via path-alias (ii uit grilling-locatie-vraag)** — afgewezen. Deno-Vite tooling-mismatch (deno-fmt, deno-check, IDE-import-resolutie) maakt cross-runtime imports brittle. SQL als ground-truth is de schoonste keuze; TS-spiegel in `bereken-agenda.ts` blijft minimal omdat alleen UI-synchrone callers (zoals `bucketVoor`) hem nog gebruiken.

- **Label op orderregel-niveau** — afgewezen in grilling. Operator/klant denken op order-niveau ("deze order gaat later"); regel-niveau-differentiatie voegt UI-complexiteit toe voor een edge-case (één order met een mix van standaard en spoed-regels) die in V1-praktijk vrijwel niet voorkomt.

- **Hergebruik `is_spoed`-vlag i.p.v. nieuwe enum** — afgewezen. `is_spoed` is een klant-input ("ik heb haast graag"), `levertijd_status` is een planning-output ("afwijking is bevestigd"). Ze zijn semantisch los — een spoed-aanvraag kan resulteren in `standaard` (gewenst was haalbaar zonder forceren), `eerder_dan_standaard` (geforceerd), of zelfs `later_dan_standaard` (snelste-haalbaar bleek nog steeds buiten klant-standaard te vallen).

- **Read-only of blocking-modus voor "standaard niet haalbaar"** — uit grilling: (1a) Read-only waarschuwing gekozen. Auto-correct (1b) zou klant verrassen; blocking (1c) past niet bij Floorpassion-koper-flow waar geen operator tussen zit.

## Amendement (2026-05-15) — twee bewust gescheiden levertijd-paden

Tijdens implementatie-afronding bleek de in Ingreep 2 / migratiepad-stap 7 veronderstelde "edge wordt thin wrapper rond de RPC's" een verkeerde aanname over één-vormigheid. Er zijn **twee fundamenteel verschillende levertijd-vragen** met verschillende input en verschillende UX-eisen:

| | Pre-persist maatwerk-config-flow | Gepersisteerde-regel-flow |
|---|---|---|
| **Caller** | [`LevertijdSuggestie`](../../frontend/src/components/orders/levertijd-suggestie.tsx) tijdens maatwerk-regel samenstellen | order-form fit-indicator + `<LevertijdStatusBadge>` |
| **Input** | kwaliteit/kleur/lengte/breedte/vorm — **nog geen orderregel-id** | `regelIds: number[]` — gepersisteerde regels |
| **Output** | rijk: scenario-badge, onderbouwing, rol-match, capaciteit, backlog, eerder-haalbaar | smal: `{haalbaar, reden, eerstvolgend_haalbaar}` |
| **Bron** | edge `check-levertijd` (`berekenMaatwerkAfleverdatumViaSeam`) | RPC's `levertijd_fit_check` / `levertijd_snelste_haalbaar` |

**Beslissing (gebruiker, 2026-05-15): de twee paden blijven bewust gescheiden.** De edge `check-levertijd` is **geen** afgedankte back-compat-laag maar de permanente bron voor de pre-persist maatwerk-config-flow (er is daar per definitie geen regel-id, en de rijke scenario-UX is een productvereiste). De Levertijd-Module-RPC's bezitten de gepersisteerde-regel-flow. Beide consumeren dezelfde `productie_planning`-config; de capaciteit-definitie blijft daarmee één concept ook al zijn er twee uitvoeringspaden.

**Gevolg voor eerdere ADR-tekst:** Ingreep 2's "edge wordt thin wrapper", migratiepad-stap 7's "`check-levertijd`-edge wordt thin wrapper", en de regel ``check-levertijd`-edge verwijderen` in de open backlog **vervallen**. De `useLevertijdCheck`-shim is geen tijdelijke migratie-brug meer; alleen de `useFitCheck`-re-export daarin is dat (nieuw werk importeert rechtstreeks uit `@/modules/levertijd`). De ESLint-`no-restricted-imports`-regel blijft staan om nieuw werk naar de Module te leiden — `LevertijdSuggestie`'s gebruik van `useLevertijdCheck` is een bewuste, gedocumenteerde uitzondering, geen tech-debt.

**Convergentie-optie blijft open, niet gepland:** als de pre-persist-flow ooit ook regel-id-loos via SQL moet (config-based `levertijd_fit_check_config(kwaliteit,kleur,maten,week)` + rijkere return), kan dat zonder breaking change op de bestaande RPC's. Niet in scope; alleen oppakken bij een concrete trigger (bv. edge-runtime uitfaseren).

## Open backlog

- Confectie-capaciteit-check uitbreiden naar `levertijd_fit_check`/`levertijd_snelste_haalbaar` (V2)
- Bevroren leverbelofte-tabel + EDI ORDRSP-update-flow bij belofte-wijziging (V2)
- Pakbon-badge, factuur-PDF-vermelding, Floorpassion-confirmatie-email als consumers van `levertijd_status`
- Capaciteit-slot-reservering bij snelste-haalbaar (V2, alleen bij hoge spoed-aanvraag-volume)
- Orders-overview-lijst-badge integreren zodra het parallelle klant-filter-werk in `orders-overview.tsx` gemerged is (detail-header + order-form zijn al live)
- Optioneel/niet-gepland: config-based `levertijd_fit_check_config` zodat de pre-persist maatwerk-flow ook regel-id-loos via SQL kan (zie Amendement) — alleen bij concrete trigger
- `_shared/levertijd-*.ts` (Deno) naar SQL migreren blijft mogelijk maar is **niet** langer een doel op zich (zie Amendement — de edge blijft een legitiem permanent pad)
