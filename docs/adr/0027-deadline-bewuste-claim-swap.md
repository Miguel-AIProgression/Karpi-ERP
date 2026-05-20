---
status: accepted
date: 2026-05-20
---

# Deadline-bewuste claim-swap — voorraad volgt urgentie zonder claim-volgorde-prio volledig op te geven

## Context

Karpi krijgt regelmatig B2B-orders waarin een klant expliciet aangeeft het product **pas later** geleverd te willen hebben — bijvoorbeeld omdat de eindklant van die B2B-klant het pas over 20 weken wil ontvangen. De klant zegt dan "lever wk 40", terwijl de standaard-leverweek bij Karpi voor dat product bij intake bv. wk 1 zou zijn.

Vandaag claimt [`herallocateer_orderregel`](../../supabase/migrations/154_uitwisselbaar_claims.sql) (mig 154) **gulzig** in vaste volgorde: handmatige uitwisselbaar → voorraad eigen artikel → IO eigen artikel op `verwacht_datum ASC`. De [[Claim-volgorde-prio]]-invariant (CLAUDE.md, [[data-woordenboek.md#Claim-volgorde-prio]]) zegt expliciet: **wie eerst claimt, wordt eerst beleverd; geen automatische herallocatie bij urgentere nieuwe orders.**

### Het probleem dat dat veroorzaakt

- T0: order A komt binnen met `afleverdatum=wk 40` (klant heeft "geen haast" gecommuniceerd, operator vult bewust wk 40 in i.p.v. de wk 1 default). Voorraad=1. Allocator claimt voorraad.
- T+1 week: order B komt binnen, `afleverdatum=wk 21` (urgent, default voor die klant). Voorraad=0 (A heeft 'm). Allocator → IO op wk 30. B mist deadline.

Optimale uitkomst was geweest: A → IO wk 30 (past ruim in wk 40), B → voorraad (geleverd wk 1). Beide deadlines gehaald.

### Waarom dit dossier nu opduikt

Gebruiker bracht het ter sprake bij de grilling-sessie 2026-05-20: "Soms wordt een product besteld, maar pas met een levertijd over 20 weken. We willen sws kunnen leveren aan de klant op de afgesproken datum, maar willen voorkomen dat er producten lange termijn gereserveerd liggen terwijl daardoor andere orders moeten wachten." Frequentie: incidenteel, niet structureel per klant — komt bij meerdere klanten voor maar onvoorspelbaar welke order.

### Wat al bestaat en hergebruikt kan worden

- `orders.afleverdatum` — operator-input, IS de klant-eis (vandaag al; geen tweede inputveld nodig).
- `orders.standaard_afleverdatum_berekend` ([ADR-0020](0020-levertijd-als-deep-module.md)) — bevroren snapshot bij commit van wat de klant-config-default zou zijn geweest. Onafhankelijk van mig 153-shifts.
- `orders.levertijd_status` (ADR-0020) — derived label dat al `'later_dan_standaard'` wordt bij `afleverdatum > standaard_afleverdatum_berekend`.
- `herallocateer_orderregel` (mig 154 / [ADR-0015](0015-reservering-als-deep-module.md)) — idempotente RPC die ook nu al releasen + opnieuw alloceert.
- `order_events` (ADR-0006) — event-pattern voor cross-Module-listeners.
- `sync_order_afleverdatum_met_claims` (mig 153) — schuift `afleverdatum` vooruit bij IO-vertraging, precedent voor "afleverdatum is geen onverstoorbare belofte".

### Deletion test

Verwijder het swap-pad: de business-pijn keert terug — operator moet handmatig claims herassign-en bij conflict, of accepteert dat urgente orders deadline missen omdat een latere-deadline-order de voorraad bezet houdt. Geen alternatieve workaround in de huidige codebase. De feature **verdient** ingreep.

## Beslissing

**Eén beperkte herziening van [[Claim-volgorde-prio]] + reactieve swap-policy in `herallocateer_orderregel`, zonder schema-uitbreiding.** Vijf ingrepen.

### Ingreep 1 — Swap-policy in allocator (Reservering-Module bezit)

Wanneer `herallocateer_orderregel(p_order_regel_id)` voor een urgentere orderregel B onvoldoende voorraad vindt en wil terugvallen op IO, voegt de RPC een **swap-fase** toe vóór de IO-fallback:

```
1. Bestaande logica: handmatige uitwisselbaar-claims respecteren
2. Bestaande logica: voorraad eigen artikel claimen
3. [NIEUW] swap-fase: als er nog resterend tekort is,
   scan voor swap-kandidaten (zie Ingreep 2) en pak vrijgekomen voorraad
4. Bestaande logica: IO eigen artikel op verwacht_datum ASC
```

Geen wijziging aan handmatige-uitwisselbaar-respect of aan de IO-fallback zelf — alleen een extra tak tussen stap 2 en stap 4.

### Ingreep 2 — Swap-bron selectie: EDD + voorraad-only

**Swap-baar bron-criterium** (alle voorwaarden, AND):

- Order A heeft een actieve `bron='voorraad'`-claim op hetzelfde `fysiek_artikelnr` als B nodig heeft
- A.`afleverdatum > standaard_afleverdatum_berekend` (= operator heeft bewust later ingevuld; "tolerance" hardcoded op exact-groter; later configureerbaar via `app_config.reservering.swap_minimum_marge_dagen` als dat nodig blijkt)
- A heeft **uitsluitend voorraad-claims** voor deze orderregel (geen multi-source met IO — multi-source = V2 edge case)
- A.`status NOT IN ('Verzonden', 'Geannuleerd')`

**Selectie als meerdere kandidaten — EDD (Earliest Deadline gives last):**

```sql
ORDER BY A.afleverdatum DESC, A.id ASC
```

A met de meeste headroom (verste afleverdatum) verliest claim eerst. Reden: behoudt veiligheidsmarge in de zwakste schakel; symmetrie met de prio-volgorde in de IO-keuze (Ingreep 3).

### Ingreep 3 — IO-keuze voor swap: laatst-passende

Wanneer A's voorraad-claim naar IO wordt verplaatst, kiest de allocator de **laatst-passende** IO:

```sql
SELECT ir.id, io.verwacht_datum
  FROM inkooporder_regels ir
  JOIN inkooporders io ON io.id = ir.inkooporder_id
 WHERE ir.artikelnr = A.fysiek_artikelnr
   AND ir.eenheid = 'stuks'
   AND io.status IN ('Besteld', 'Deels ontvangen')
   AND io.verwacht_datum + (inkoop_buffer_weken_vast * 7) <= A.afleverdatum
 ORDER BY io.verwacht_datum DESC, ir.id ASC
 LIMIT 1
```

**Bewust DESC, niet ASC** (afwijking van de bestaande IO-volgorde in `herallocateer_orderregel` mig 154 r187). Reden: bewaart vroege IO's voor toekomstige urgente claims. Past bij dezelfde optie-waarde-redenering als EDD voor de swap-bron. Aparte tak in de RPC — niet vermengd met de standaard-IO-fallback (die blijft `ASC`).

Buffer-conditie hergebruikt `inkoop_buffer_weken_vast` uit `app_config.order_config` (mig 150 / `order_regel_levertijd`-view), dus consistente buffer-semantiek met levertijd-rekening.

### Ingreep 4 — Audit-trail via `order_events`

Bij elke geslaagde swap insert de RPC twee events:

```sql
INSERT INTO order_events (order_id, event_type, metadata) VALUES
  (A.order_id, 'claim_geswapt_weg', jsonb_build_object(
    'naar_order_id', B.order_id,
    'orderregel_id', A.orderregel_id,
    'aantal', v_swap_aantal,
    'oude_bron', 'voorraad',
    'nieuwe_bron', 'inkooporder_regel',
    'io_regel_id', v_io_regel_id,
    'fysiek_artikelnr', v_artikelnr
  )),
  (B.order_id, 'claim_geswapt_naar', jsonb_build_object(
    'van_order_id', A.order_id,
    'orderregel_id', B.orderregel_id,
    'aantal', v_swap_aantal,
    'bron', 'voorraad',
    'fysiek_artikelnr', v_artikelnr
  ));
```

Twee event-types (one per kant van de swap) zodat beide orders een eigen audit-rij krijgen op order-detail. Past in ADR-0006-pattern; existing listeners op `order_events` (mig 255 cascade-release, mig 290 snijplan-release) raken dit niet — nieuwe event-types worden niet door bestaande triggers opgepikt.

### Ingreep 5 — Reverse-swap-conditie: alarm, geen auto-rollback

Wanneer een IO waarop A geswapt is later vertraagt zodanig dat `verwacht_datum + buffer > A.afleverdatum`, doet `sync_order_afleverdatum_met_claims` (mig 153) z'n bestaande werk (afleverdatum vooruit schuiven). De daaropvolgende trigger op `orders.afleverdatum`-change (ADR-0020) flipt `levertijd_status` naar `'later_dan_standaard'` — maar dat label kent dat geval al.

**Toevoeging**: detecteer post-swap-conflict expliciet en schrijf:

```sql
-- Binnen sync_order_afleverdatum_met_claims, na de UPDATE:
IF v_nieuwe_afleverdatum > v_standaard_afleverdatum_berekend
   AND EXISTS (SELECT 1 FROM order_events
               WHERE order_id = p_order_id
                 AND event_type = 'claim_geswapt_weg') THEN
  INSERT INTO order_events (order_id, event_type, metadata)
  VALUES (p_order_id, 'deadline_conflict_na_swap', jsonb_build_object(
    'oude_afleverdatum', v_oude_afleverdatum,
    'nieuwe_afleverdatum', v_nieuwe_afleverdatum,
    'standaard', v_standaard_afleverdatum_berekend
  ));
END IF;
```

Operator-dashboard (orders-overview) toont rood label op deze orders via een join op `order_events`. **Geen automatische reverse-swap** — handmatige operator-actie (klant bellen, spoedinkoop, voorraad uit ander kanaal). Reden: cascade-complexiteit, oscillatie-risico, niet auditeerbaar. Bij hoge frequentie heroverwegen voor V2.

## Module-interface en eigendom

- **`herallocateer_orderregel`** blijft de centrale RPC; alleen body uitgebreid met swap-fase. Geen nieuwe publieke RPC.
- **Triggers** blijven ongewijzigd qua signatuur — `trg_orderregel_herallocateer` (mig 146) en `trg_io_status_release` (mig 147) roepen al `herallocateer_orderregel` aan. Extra trigger toevoegen: `trg_io_regel_insert_swap_evaluate` — bij nieuwe IO besteld, scan orderregels in status `Wacht op inkoop` / `Wacht op nieuwe inkoop` om te zien of swap nu kan helpen (heractiveert ze).
- **Event-types** `'claim_geswapt_weg'`, `'claim_geswapt_naar'`, `'deadline_conflict_na_swap'` worden niet door bestaande listeners gelezen — nieuwe code-paden moeten ze expliciet opnemen. Toegevoegd aan `order_events.event_type`-doc.
- **Geen schema-wijziging** op `orders`, `order_regels`, of `order_reserveringen`. Slechts allocator-policy + nieuwe event-types.
- **Cross-Module-impact:**
  - **Levertijd-Module**: `LevertijdStatusBadge` toont al `later_dan_standaard` — geen UI-werk voor swap-orders. Wel nieuw: detectie en weergave van `deadline_conflict_na_swap` event (orders-overview rood label).
  - **Order-lifecycle (ADR-0006)**: nieuwe event-types invoegen, geen status-transitie-impact.

## Frontend-werk

Minimaal — `RegelClaimDetail` toont vandaag al de bron-uitsplitsing (mig 154 / [`@/modules/reserveringen/components/regel-claim-detail.tsx`](../../frontend/src/modules/reserveringen/components/regel-claim-detail.tsx)). Voor swap-uitleg voegen we toe:

1. **Order-detail events-tab** — render `'claim_geswapt_weg'` / `'claim_geswapt_naar'` events met klikbare link naar de tegen-order. Bestaande events-tab pattern hergebruiken.
2. **Orders-overview rood label** — query op orders met `deadline_conflict_na_swap`-event in laatste 30 dagen, kleur-coding in [`pages/orders/orders-overview.tsx`](../../frontend/src/pages/orders/orders-overview.tsx).
3. **`RegelClaimDetail` tooltip** — bij IO-claim die door swap is ontstaan: toon "Was voorraad, afgestaan aan ORD-2026-NNNN op DD-MM-YYYY" (lookup via events). Niet kritisch voor V1, kan in fase 2.

Géén nieuw inputveld in order-form. Operator vult `afleverdatum` zoals altijd — als ze "wk 40" kiest terwijl de default wk 1 is, ontstaat de swap-toestemming vanzelf via de bevroren snapshot.

## Migratiepad

Conform feedback-memory "Na ADR direct stap 1/N committen": ADR + Stap 1 in deze commit, vervolgstappen in opvolgende commits.

1. **Stap 1 — ADR** (deze commit) + data-woordenboek-update + CLAUDE.md-update.
2. **Stap 2 — Mig 297: swap-fase in `herallocateer_orderregel`** + nieuwe trigger `trg_io_regel_insert_swap_evaluate` + nieuwe `order_event_type`-enum-waarden (`claim_geswapt_weg`, `claim_geswapt_naar`, `deadline_conflict_na_swap`). Idempotent. Geen schema-DDL anders dan `ALTER TYPE ... ADD VALUE`. **Correctie t.o.v. eerdere snippets in deze ADR**: `order_events`-kolom heet **`metadata`** (mig 218), niet `payload`. Event-types zijn ENUM, niet TEXT.
3. **Stap 3 — Mig 298: `sync_order_afleverdatum_met_claims`-update** voor `deadline_conflict_na_swap`-event-emit bij post-swap-vertraging.
4. **Stap 4 — Frontend: order-detail events-tab** uitbreiden met swap-event-rendering (Reservering-Module's `<RegelClaimDetail>` of nieuwe `<SwapEventRij>` component).
5. **Stap 5 — Frontend: orders-overview rood label** voor `deadline_conflict_na_swap`-orders.
6. **Stap 6 — Vitest contract-test**: nieuwe fixtures in `modules/reserveringen/lib/__tests__/dekking-contract.test.ts` voor swap-paden (A → IO via swap, B → voorraad, EDD selectie bij 2+ kandidaten, laatst-passend IO-keuze, geen swap als geen IO past, geen swap als A.afleverdatum ≤ snapshot).
7. **Stap 7 — Lint**: `scripts/lint-no-direct-order-reserveringen-write.sh` blijft groen (swap gebeurt binnen de bestaande RPC).
8. **Stap 8 — Changelog + architectuur.md** updaten (Reservering-Module-paragraaf, nieuwe event-types).

## Overwogen alternatieven

- **Nieuwe kolom `uiterste_afleverdatum DATE`** (grilling-pad Q4) — afgewezen na grilling Q9: operator vult vandaag al `afleverdatum` bij intake; tweede DATE-veld is UX-ruis voor een feature die in 80% van orders niet relevant is. `standaard_afleverdatum_berekend` (ADR-0020-snapshot, bevroren bij commit) levert hetzelfde signaal zonder nieuwe input. Vervuiling door mig 153 is een non-issue omdat swap-bron-criterium beperkt is tot voorraad-only-orders (waar mig 153 niet schuift).

- **Proactieve JIT-allocatie (β uit grilling Q5)** — afgewezen. Zou bij intake van A direct IO claimen i.p.v. voorraad, om voorraad vrij te houden. Maar dan beweegt A's `afleverdatum` direct van wk 1 naar wk 30 — verrast operator/klant terwijl er nog geen B is. Lazy/reactief swap geeft hetzelfde optimale resultaat **als** B daadwerkelijk komt, en raakt A niet als B niet komt.

- **Uitgestelde allocatie (γ uit grilling Q5)** — afgewezen. Geen claim aanmaken bij intake, pas bij conflict of IO-binnenkomst beslissen. Breekt de invariant dat `producten.gereserveerd` = som van actieve claims (mig 144/149); maakt levertijd-belofte onzeker; vereist nieuwe orderregel-status. Architecturaal te invasief.

- **Cascade-swap (>1 stap)** — afgewezen voor V1. Theoretisch krachtiger ("A2 swapt IO wk 25→28, A1 swapt voorraad→IO wk 25, B krijgt voorraad") maar oscillatie-gevoelig, complexe lock-volgorde, niet auditeerbaar. Pak op in V2 als business >5 conflicten/week meldt waarbij 1-stap niet volstaat.

- **Automatische reverse-swap bij IO-vertraging** — afgewezen. Tweede orde van het cascade-probleem; voorraad zou heen-en-weer kunnen oscilleren tussen orders bij IO-fluctuaties. Alarm + handmatige actie is goedkoper voor verwachte (lage) frequentie.

- **Oudste-passende IO bij swap** — afgewezen ten gunste van laatst-passende. Verspilt vroege IO-capaciteit aan late-deadline-orders; tegenstrijdig met EDD-redenering voor swap-bron-selectie.

- **Per-klant default `default_uiterste_marge_weken`** (grilling Q9c) — afgewezen voor V1. Business-trigger is per-order incidenteel, niet per-klant structureel. Voegen we toe als concrete klant met >5 lange-termijn-orders/maand opduikt. Voorkomt impliciet swap-toestaan voor klanten die operator niet doorlichtte.

- **Reverse-swap (omgekeerd EDD-zoektocht)** bij IO-vertraging — afgewezen, zie boven.

- **FCFS-respect bij multi-kandidaat-selectie** (loser = eerst-gebleven voorraad-claim) — afgewezen. Straft trouwe wachters; EDD is robuuster tegen IO-vertraging.

## Open backlog

- **V2**: Cascade-swap (multi-step) als 1-staps regelmatig niet volstaat.
- **V2**: Multi-source-orders (voorraad-claim + IO-claim op dezelfde orderregel) als swap-bron — nu uitgesloten.
- **V2**: Spoed-overrides voor IO-claims onderling (claim-volgorde-prio voor IO-claims, niet alleen voor voorraad). Zie [[Claim-volgorde-prio]]-toevoeging.
- **V2**: Configureerbare `swap_minimum_marge_dagen` in `app_config.reservering` als de exacte-groter-vergelijking te scherp blijkt (bv. weekend-afronding-issues).
- **V2**: Actiever signaal bij `deadline_conflict_na_swap` (Slack/mail) als rood label op orders-overview onvoldoende blijkt.
- **V2**: Per-klant `default_uiterste_marge_weken` als business-patroon zich consolideert per klant.
- **V2**: Reverse-swap bij IO-vertraging — auto i.p.v. handmatig.
