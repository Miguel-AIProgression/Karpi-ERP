---
status: accepted
date: 2026-05-07
---

# Order-lifecycle als deep Module — `orders.status` krijgt één eigenaar; `Klaar voor verzending` verdwijnt op order-niveau

## Context

ADR-0005 sloot het concrete factuur-keten-gat door `voltooi_pickronde` `orders.status='Verzonden'` te laten flippen. Tegelijk legde dat ADR een breder probleem bloot dat het bewust door-puntte: **`orders.status` heeft geen eigenaar.**

Een audit van alle writers van het veld levert minstens vier onafhankelijke schrijfpaden op:

- `voltooi_pickronde` (mig 217) → `Verzonden`
- `herwaardeer_order_status` (mig 144) → `Nieuw`, `Wacht op voorraad`, `Wacht op inkoop`
- afleverdatum-/IO-claim-sync (mig 148, 153) → indirect via `herwaardeer_order_status`
- frontend annulerings-flow → `Geannuleerd`

Daarnaast filtert minstens 16 SQL-migraties op de status `'Klaar voor verzending'` als sentinel — terwijl een grep op `UPDATE orders SET status = 'Klaar voor verzending'` **nul resultaten** oplevert. Het is een spook-status: nergens geschreven, overal gefilterd. ADR-0003 noemde de afschaffing als "kandidaat-#3, raakt zes RPCs", ADR-0005 herhaalde het.

Het patroon dat hieruit oprijst is precies het patroon waar ADR-0001 voor waarschuwt: verspreide kennis met overlappende guards, een veld zonder eigenaar, "kleine wijziging → bug elders". Het mig-217-gat (factuur-trigger vuurde nooit omdat niemand `Verzonden` zette) is een *specimen* van dit patroon, niet de hele klasse.

## Beslissing

Introduceer **Order-lifecycle** als deep verticale Module die als **enige schrijver** van `orders.status` en `orders.verzonden_at` optreedt. Alle huidige writers stoppen met direct `UPDATE orders SET status` doen en signaleren in plaats daarvan via een smal RPC-contract.

### Scope (medium)

De Module bezit:

- het veld `orders.status` (canoniek via CHECK-constraint, zie onder)
- het veld `orders.verzonden_at` (audit-timestamp, samen met `Verzonden`-overgang gezet)
- de tabel `order_events` (append-only audit-log van transities, zie onder)
- de pure state-machine als TS-functie + bijbehorende contract-tests

De Module bezit **niet**: `afleverdatum` (blijft via `_sync_afleverdatum` in mig 153), `lever_modus` (blijft via `LeverModusDialog`), `gereserveerd`/`backorder` (claim-domein, mig 144). Deze velden zijn *input* voor de state-machine, geen *output*.

### Interface — hybride stijl

De Module exposed twee soorten RPCs:

```sql
-- Commands (expliciete actie van de caller)
markeer_verzonden(p_order_id, p_actor_medewerker_id := NULL, p_actor_auth_user_id := NULL)
markeer_geannuleerd(p_order_id, p_reden, p_actor_medewerker_id := NULL, p_actor_auth_user_id := NULL)

-- Recompute (afgeleid uit wereld-state)
herbereken_wacht_status(p_order_id)
  -- leest claims, kiest tussen 'Nieuw' / 'Wacht op voorraad' / 'Wacht op inkoop'
  -- doet niets als status ∈ {'Verzonden','Geannuleerd'} (terminal)
```

Beide routes lopen intern via `_apply_transitie(p_order_id, p_event_type, p_status_na, p_actor, p_reden, p_metadata)` die atomair: (1) `UPDATE orders SET status, verzonden_at`, (2) `INSERT INTO order_events`. Geen andere code in de codebase mag `UPDATE orders SET status = ...` doen — dat wordt vastgelegd in een lint-regel én CI-grep.

### Status-set canoniek — `Klaar voor verzending` op orders weg

```sql
ALTER TABLE orders ADD CONSTRAINT orders_status_chk
  CHECK (status IN ('Nieuw','Wacht op voorraad','Wacht op inkoop','Verzonden','Geannuleerd'));
```

De zes sentinel-filter-RPCs (mig 145, 153, 185, 186, 188, 192) verwijderen de spook-status uit hun `WHERE status NOT IN (...)`-clausules. Dit is geen losse schoonmaak — het is wat de medium-scope betekent: één state-machine, geen onbereikbare staat in de set.

### `order_events` schema

```sql
CREATE TYPE order_event_type AS ENUM (
  'aangemaakt',
  'pickronde_voltooid',
  'wacht_status_herberekend',
  'geannuleerd'
);

CREATE TABLE order_events (
  id                    BIGSERIAL PRIMARY KEY,
  order_id              BIGINT NOT NULL REFERENCES orders(id),
  event_type            order_event_type NOT NULL,
  status_voor           TEXT,
  status_na             TEXT NOT NULL,
  actor_medewerker_id   BIGINT REFERENCES medewerkers(id),
  actor_auth_user_id    UUID   REFERENCES auth.users(id),
  reden                 TEXT,
  metadata              JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (actor_medewerker_id IS NULL) OR (actor_auth_user_id IS NULL)
  )
);
CREATE INDEX order_events_order_idx ON order_events(order_id, created_at DESC);
```

Polymorfe actor: óf medewerker (Pickronde via mig 217), óf auth.user (kantoor-mutatie), óf beide NULL (system, bv. recompute na claim-trigger). Apart van `activiteiten_log` (dat blijft generieke trigger-based CRUD-audit).

### Migratiepad

Drie huidige Adapters → echt Seam, niet hypothetisch:

| Caller vandaag | Wordt | Type |
|---|---|---|
| `voltooi_pickronde` doet `UPDATE orders SET status='Verzonden', verzonden_at=now()` | `voltooi_pickronde` roept `markeer_verzonden(v_order_id, p_actor_medewerker_id := p_picker_id)` | command |
| `herwaardeer_order_status` doet `UPDATE orders SET status = ...` | functie roept `herbereken_wacht_status(p_order_id)` aan; intern wordt de daadwerkelijke `UPDATE` weggehaald | recompute |
| Frontend annulerings-mutatie | RPC-call `markeer_geannuleerd(order_id, reden)` ipv directe `update orders set status` | command |

`herwaardeer_order_status` blijft bestaan als orchestrator (claim-checks + recompute), maar het schrijven verhuist naar de Module.

### Module-eigenaarschap

Volgt ADR-0001/0002:

- **Backend-eigendom**: alle RPCs in dedicated migratie + `supabase/functions/_shared/order-lifecycle/`-helpers (state-machine als TS-functie voor regression-tests).
- **Frontend-eigendom**: `frontend/src/modules/orders-lifecycle/` met hooks (`useMarkeerGeannuleerd`), barrel-export, en eventueel `<OrderEventsTimeline />` voor order-detail. Naast — niet vervangend — de bestaande `modules/orders/` (intake/order-voorstel uit ADR-0001).

## Overwogen alternatieven

- **Smalle scope (alleen `orders.status`, `verzonden_at` blijft buiten)** — afgewezen omdat audit-velden die op één transitie samen worden gezet, conceptueel bij die transitie horen. `verzonden_at` los houden zou een tweede schrijver van order-velden creëren tijdens dezelfde RPC-call.
- **Brede scope (incl. `afleverdatum`, `lever_modus`, claim-recompute)** — afgewezen als god-Module-vorm. Raakt mig 144, 148, 153, 185, 186, 188, 192, 217 in één PR. ADR-0001 vestigde claims juist als aparte Module; die grens niet doorbreken.
- **Events-only stijl (één `notify_order_event(id, type)`-RPC)** — afgewezen omdat de Module dan alle wereld-state-checks zelf moet kennen (claim-status, zending-status, IO-status). Past slecht op de bestaande recompute-functie `herwaardeer_order_status`. De hybride respecteert de huidige denkwijze.
- **Commands-only stijl (geen recompute)** — afgewezen. `herwaardeer_order_status` zou alleen z'n laatste regel verhuizen — 80% van de logica blijft buiten de Module. Lekkere seam wordt niet bereikt.
- **`Klaar voor verzending` op orders behouden** — afgewezen. Status wordt nergens geschreven (bewezen via grep), alleen sentinel-gefilterd. Niet opruimen tijdens deze refactor zou de schuld die ADR-0003 en ADR-0005 doorpunten in stand laten — terwijl we toch alle relevante RPCs aanraken.
- **Status-set hertekenen (`Tekort` met `tekort_reden`)** — afgewezen voor deze ADR. Raakt 40+ frontend-locaties (status-tabs, filter-pills, badges, pick-week-secties). Verdient een eigen ADR + UI-traject.
- **Hergebruik `activiteiten_log` voor lifecycle-events** — afgewezen. Generieke tabel kent alleen `gebruiker_id UUID FK auth.users`; mig 217's picker is een `medewerker_id BIGINT`. Polymorfe actor verstoppen in JSONB breekt FK-integriteit en maakt rapportage-queries duur (GIN-index op JSONB ipv typed kolom). `activiteiten_log` blijft voor algemene CRUD-audit.
- **Twee logs (generiek + specifiek)** — afgewezen als dubbele schrijf op de hot path; geen runtime-rol voor `activiteiten_log` op order-mutaties die een tweede log rechtvaardigt.
- **Naam "Order-keten"** — afgewezen ondanks parallel met "factuur-keten" (ADR-0005). "Keten" wekt verwachting van end-to-end (order → zending → factuur) terwijl de Module alleen het status-segment dekt. Naming zou expectations breken.
- **Naam "Order-statusbeheer"** — overwogen voor NL-consistentie met Verzendset/Pickronde. Afgewezen ten gunste van het kortere "Order-lifecycle" — past beter bij folder-naam-conventies van bestaande modules.

## Consequenties

- **Migratie (volgnr 218):**
  - Maak enum `order_event_type`.
  - Maak tabel `order_events` + index.
  - Maak RPCs `markeer_verzonden`, `markeer_geannuleerd`, `herbereken_wacht_status`, intern `_apply_transitie`.
  - Update `voltooi_pickronde` (mig 217) om `markeer_verzonden` aan te roepen ipv directe `UPDATE orders`.
  - Update `herwaardeer_order_status` (mig 144) om de directe `UPDATE` te vervangen door een interne aanroep van `_apply_transitie` met event_type `'wacht_status_herberekend'`.
  - Voeg `CHECK (status IN (...))` toe op `orders.status`. Verwijder `'Klaar voor verzending'` uit de zes sentinel-filter-RPCs (mig 145/153/185/186/188/192).
  - Backfill: voor bestaande verzonden orders één synthetisch `order_events`-rij met `event_type='aangemaakt'` + `created_at = orders.created_at`, eventueel `'pickronde_voltooid'` als `verzonden_at IS NOT NULL`. Pure-data, geen state-machine-runs.

- **Frontend:**
  - Nieuwe folder `frontend/src/modules/orders-lifecycle/` (hooks, barrel, evt. `<OrderEventsTimeline />` voor order-detail).
  - Annulerings-mutatie verhuist naar `useMarkeerGeannuleerd`-hook in deze module.
  - Bestaande `modules/orders/` blijft ongemoeid (intake/voorstel — ADR-0001).

- **Tests:** state-machine als pure TS-functie ⇒ unit-testbaar zonder DB. Drie RPC-contract-tests (`markeer_verzonden`, `markeer_geannuleerd`, `herbereken_wacht_status`) valideren guards (terminal-statussen, idempotentie, actor-XOR). End-to-end contract-test op de keten `voltooi_pickronde → markeer_verzonden → factuur_queue → factuur` vervangt drie losse end-to-end klik-tests. **Ingelost per Fase 2 (2026-06-10, mig 346):** de beloofde pure TS-state-machine bestaat als `deriveWachtStatus` in [`_shared/order-lifecycle/derive-status.ts`](../../supabase/functions/_shared/order-lifecycle/derive-status.ts), gespiegeld door pure SQL-functie `derive_wacht_status` (mig 346) waarnaar `herbereken_wacht_status` de beslissing delegeert. Een golden-fixture-truthtable van 21 cases bindt beide kanten: Vitest-contracttest (`frontend/src/lib/orders/__tests__/derive-status.test.ts`, TS ≡ fixture) + zelf-testende migratie (SQL ≡ dezelfde combinaties). `_apply_transitie` blijft het enige schrijfpad.

- **Lint/CI:** grep-regel die faalt bij `UPDATE orders SET status` buiten `modules/orders-lifecycle/` of de bijbehorende migraties. Voorkomt regressie naar "veld zonder eigenaar".

- **Domeinwoordenboek:** termen *Order-lifecycle* en *order_events* toegevoegd onder Orders & Operationeel ([data-woordenboek.md:81-82](../data-woordenboek.md#L81-L82)).

- **Open kandidaten op de backlog** (niet in deze ADR):
  - Status-hertekening (`Tekort` met reden) — eigen ADR + UI-traject.
  - ~~Per-zending-facturatie (`debiteuren.factuurvoorkeur='per_zending'` activeren) — kan via een tweede event-type `zending_klaar_voor_verzending` zonder ADR-0006 te raken.~~ **Gesloten per [ADR-0010](0010-factuur-volgt-bundel-zending.md)** (2026-05-08): `per_zending` is gedropt; factuur volgt de bundel-zending in de wekelijkse cron. Geen tweede event-type op `order_events` nodig.
  - Facturatie als eigen Module (kandidaat #1 uit de architectuur-review) — apart traject; deze ADR opent de ruimte door de keten-trigger nu schoon te isoleren.
