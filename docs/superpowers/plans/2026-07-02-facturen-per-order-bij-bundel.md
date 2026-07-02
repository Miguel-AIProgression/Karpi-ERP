# Facturen per order bij bundel-zending (combi-levering)

**Datum:** 2026-07-02 · **Branch:** `feat/combi-facturen-per-order` · **Worktree:** `.worktrees/combi-facturen`

## Eis (Miguel, 02-07)

> Facturen moeten apart gefactureerd worden en mogen niet verzameld worden. Dus als verschillende orders gebundeld worden wel aparte facturen (per order). En pakbon mag wel verzameld worden maar wel duidelijk welke artikelen bij welke order horen.

## Context & scope-besluiten

- **Pakbon: al gedekt.** Beide renderpaden (browser + server-PDF factuurbijlage) consumeren één canonieke builder (`_shared/pakbon/pakbon-document.ts`) die per bron-order groepeert met subkop "Order ORD-…" — getest in `aggregatie.test.ts` + `pakbon-document.test.tsx`. Geen werk.
- **Wekelijks pad: buiten scope.** Alle 135 combi-klanten staan op `factuurvoorkeur='per_zending'` (live gecheckt 02-07); slechts 2 niet-combi-debiteuren op 'wekelijks'. `genereer_factuur_voor_week` blijft onaangeroerd.
- **Geldt voor álle multi-order bundel-zendingen**, niet alleen combi — de eis is generiek geformuleerd, en de bundel-mechaniek (mig 222/228-230) maakt geen onderscheid. Voor een solo-zending (1 order) is het gedrag per definitie identiek aan nu.
- **Dit vervangt ADR-0010's "1 bundel-zending = 1 factuur"** → nieuwe ADR-0041. De drempel-toets blijft wél bundel-niveau (dat was ADR-0010's echte motief en het hele punt van combi-levering).

## Ontwerp

Granulariteit van de factuur-queue verschuift van **zending** naar **(zending, order)**. Elke queue-rij → eigen concept-factuur → eigen finalisatie → eigen mail/EDI-INVOIC. Migratie **578** (nummer her-verifiëren vlak vóór merge — parallelle sessies claimen live nummers).

### 1. `factuur_queue` (DDL)

- `ADD COLUMN order_id BIGINT REFERENCES orders(id)` (NULL voor legacy/wekelijkse rijen).
- Dedup-index: DROP `uq_factuur_queue_zending`; CREATE UNIQUE INDEX `uq_factuur_queue_zending_order` ON `factuur_queue (zending_id, order_id) WHERE zending_id IS NOT NULL`. Oude rijen (order_id NULL) conflicteren nooit (NULL ≠ NULL); nieuwe inserts vullen order_id altijd.

### 2. `enqueue_factuur_voor_event` (trigger)

De trigger vuurt al per order (NEW.order_id — dat is waarom de huidige dedup bestaat). De INSERT wordt juist simpeler: per zending waarin deze order zit één rij met `order_ids = ARRAY[NEW.order_id]`, `order_id = NEW.order_id`, `ON CONFLICT (zending_id, order_id) WHERE zending_id IS NOT NULL DO NOTHING`. De array_agg-subquery over zusterorders vervalt.

### 3. `projecteer_concept_factuur(p_zending_id, p_factuur_id, p_order_id DEFAULT NULL)`

Basis = **live body** (scratchpad `live_bodies.sql`, opgehaald via pg_get_functiondef 02-07 — NIET het migratiebestand; live wijkt af: mig 529/532-toeslag + mig 518-backorder-filter zitten erin).

- `v_scope_ids := CASE WHEN p_order_id IS NULL THEN v_order_ids ELSE ARRAY[p_order_id] END`. Guard: p_order_id moet in v_order_ids zitten (EXCEPTION anders).
- **Scope-gebonden** (v_scope_ids): regels-INSERT, no-op-guard (`v_aantal_te_factureren`), afleverland/BTW (`v_eerste_order` := de scope-order zelf — netter dan de huidige `[1]`-representant), toeslag-BOOL_AND, `uw_referentie`.
- **Bundel-gebonden** (v_order_ids, ALTIJD hele zending): `v_is_afhalen` (BOOL_OR) en de **drempel-grondslag**.
- **Drempel-grondslag-fix (kritiek):** `v_bundel_subtotaal` komt nu uit de factuurregels van de eigen factuur — bij per-order-facturen zou finalisatie van factuur 1 (`gefactureerd`-flip) de grondslag van factuur 2's verse rebuild verlagen → korting verdwijnt afhankelijk van finalisatie-volgorde. Nieuw: grondslag = `SUM(orr.bedrag)` over `order_regels` van ALLE `v_order_ids`, filters: `pick_backorder_sinds IS NULL AND pick_backorder_geannuleerd_op IS NULL`, `artikelnr NOT IN ('VERZEND','BUNDELKORTING','DREMPELKORTING','TOESLAG')` — **zónder** gefactureerd-filter. Deterministisch en volgorde-onafhankelijk. (Bewuste semantiek-nuance bij deelzending-overlap: grondslag telt de hele order-waarde — klant-gunstig, past bij combi-intentie. In ADR documenteren.)
- **Korting-blok per order** (alleen als p_order_id gezet; NULL-pad behoudt de huidige logica byte-identiek voor in-flight rijen):
  - Eigen VERZEND-regel op deze factuur? Zo nee → geen korting-regel.
  - `p_order_id = v_order_ids[1]` (verzendkosten-drager): drempel gehaald (`v_vk.status='gratis_drempel'`) → DREMPELKORTING (eigen VERZEND geneutraliseerd); anders VERZEND blijft staan (klant betaalt 1× per bundel).
  - `p_order_id ≠ v_order_ids[1]`: altijd BUNDELKORTING (mits VERZEND-bedrag > 0) — een bundel is 1 fysieke transportbeweging, zusterorders betalen nooit verzendkosten. Omschrijving: `format('Bundelkorting verzending (gebundeld %s orders)', array_length(v_order_ids,1))` — N uit de zending, niet uit de eigen factuurregels.
- Toeslag/eindtotalen: ongewijzigde formules over de eigen factuurregels.

### 4. `finaliseer_concept_factuur(p_zending_id, p_factuur_id, p_order_id DEFAULT NULL)`

- **Deploy-window-vangnet:** bij `p_order_id IS NULL` eerst `SELECT order_id FROM factuur_queue WHERE factuur_id = p_factuur_id` — een oude edge-function-deploy die met 2 args aanroept flipt dan tóch alleen de juiste order. (Zelfde lookup in projecteer bij p_factuur_id niet-NULL.) Zonder dit vangnet zou het window tussen mig-apply en edge-deploy `gefactureerd` zetten op orders die níet op de factuur staan — geld-pad, dus verplicht.
- `gefactureerd`-flip: `WHERE order_id = ANY(v_scope_ids)` i.p.v. hele bundel.
- Korting-orderregel-spiegeling: loopt al via `factuur_regels WHERE factuur_id = v_factuur_id` → automatisch per-order correct, ongewijzigd.

### 5. `verwerk_concept_queue` / `claim_factuur_queue_items`

- `verwerk_concept_queue`: SELECT + doorgeven van `q.order_id` aan projecteer.
- `claim_factuur_queue_items`: `order_id` toevoegen aan RETURNS TABLE (DROP FUNCTION eerst — return-shape-wijziging, precedent mig 428).

### 6. Edge function `factuur-verzenden/index.ts`

- Claimed item-type + beide RPC-aanroepen krijgen `p_order_id: item.order_id ?? null`.
- `genereerPakbonBijlagen` ongewijzigd: elke order-factuur van een bundel krijgt dezelfde bundel-pakbon als bijlage (per order gegroepeerd) — exact de eis.
- Deploy direct na mig-apply (vangnet in §4 dekt het window).

### 7. Docs

ADR-0041 (`facturen-per-order-bij-bundel.md`, supersedes het factuur-deel van ADR-0010), `docs/changelog.md`, `docs/database-schema.md` (factuur_queue.order_id + functie-signatures), CLAUDE.md-bullet (kort, verwijst naar ADR).

## Verificatie (verplicht vóór apply, rolled-back op live DB)

`supabase db query --linked -f` met DO-blok + afsluitende `RAISE EXCEPTION 'ROLLBACK'` (output + rollback in één):

1. **Bundel 2 orders:** fabriceer/zoek bundel-zending → simuleer events → 2 queue-rijen → `verwerk_concept_queue` → 2 concepten, elk uitsluitend eigen order-regels + eigen VERZEND/korting; som van beide totalen == totaal van de oude één-factuur-projectie (vooraf met p_order_id NULL gemeten in dezelfde transactie).
2. **Volgorde-onafhankelijkheid:** finaliseer factuur B vóór A → A's verse rebuild behoudt identieke korting-regels/grondslag.
3. **Solo-zending regressie:** projectie met (zending, order) == projectie met (zending, NULL) byte-identiek (row-voor-row vergelijking factuur_regels + header-totalen).
4. **Deploy-window:** finaliseer met p_order_id NULL op een per-order queue-rij → flipt alleen de queue-rij-order.
5. **Dedup:** dubbel event → geen dubbele queue-rij per (zending, order).

## Uitvoering

Subagent-driven (sonnet): implementer A = mig 578 + rolled-back tests; implementer B = edge function + docs/ADR; daarna onafhankelijke code-review; merge pas op Miguels commando; edge-deploy direct na apply+merge.
