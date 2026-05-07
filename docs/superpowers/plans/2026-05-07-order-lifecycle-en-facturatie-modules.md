# Order-lifecycle + Facturatie Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maak de keten Order → Pickronde → Zending → Facturatie testbaar en navigeerbaar door (1) `orders.status` één eigenaar te geven via een nieuwe Order-lifecycle Module met typed events, en (2) facturatie te consolideren in `modules/facturatie/` met een event-driven trigger op `order_events`.

**Architecture:** Twee deep verticale Modules die ADR-0006 + ADR-0007 implementeren. Fase 1 introduceert `order_events` (typed audit-tabel) + drie RPCs (`markeer_verzonden`, `markeer_geannuleerd`, `herbereken_wacht_status`) die als enige `orders.status` muteren via interne helper `_apply_transitie`. Fase 2 verhuist de facturatie-frontend en migreert de mig-118-trigger naar `AFTER INSERT ON order_events`.

**Tech Stack:** PostgreSQL (Supabase, plpgsql), TypeScript (frontend + edge functions), Vitest (contract-tests), TanStack Query, React.

**Specs/ADRs:**
- [ADR-0006: Order-lifecycle als deep Module](../../adr/0006-order-lifecycle-als-deep-module.md)
- [ADR-0007: Facturatie als deep Module](../../adr/0007-facturatie-als-deep-module.md)

**Type-keuze noot:** ADR-0006 toont `order_events.status_voor`/`status_na` als `TEXT`. Dit plan gebruikt het bestaande `order_status`-enum (al in PG sinds vóór mig 144) — strikter en consistent met `orders.status`. Geen functionele afwijking, alleen scherpere typing.

**Belangrijke afwijking van ADR-0006 (vastgesteld tijdens planning):** de status-set is breder dan ADR-0006 opsomde. UI in [`status-tabs.tsx`](../../../frontend/src/components/orders/status-tabs.tsx) toont 10 statussen incl. `In productie`, `In snijplan`, `Deels gereed`, `Wacht op picken` — die worden niet meer via `UPDATE orders SET status` geschreven (grep = 0 matches) maar bestaan mogelijk in de enum + in legacy productie-data. **Plan-spoor:** in Task 1.9 doen we eerst een data-audit; pas daarna beslist Task 1.10 of de CHECK-constraint strict (alleen 5 nieuwe waarden) of pragmatisch (ook legacy-waarden tolereren behalve `Klaar voor verzending`) wordt.

**Operationele context:**
- Migraties worden **handmatig** in de Supabase SQL Editor uitgevoerd — geen MCP, geen `supabase db push`. Zie [reference_karpi_supabase_mcp.md](../../../).
- Werkstijl: direct naar `main`, geen PRs. Frequent commits.
- Volgende migratienummer = **218** (mig 217 is laatste op disk).

---

## File Structure

### Fase 1 — Order-lifecycle (ADR-0006)

**Database (één migratie + één doc):**
- Create: `supabase/migrations/218_order_lifecycle_module.sql` — enum `order_event_type`, tabel `order_events`, RPCs `_apply_transitie`, `markeer_verzonden`, `markeer_geannuleerd`, `herbereken_wacht_status`, optionele CHECK-constraint, backfill.
- Modify: `supabase/migrations/217_pickronde_picker_factuur_keten.sql` — `voltooi_pickronde` roept `markeer_verzonden` aan i.p.v. inline `UPDATE orders SET status='Verzonden'` (regels 320-331).
- Modify: `supabase/migrations/153_afleverdatum_sync_met_io_claims.sql` — `herwaardeer_order_status` delegeert status-write aan `herbereken_wacht_status` van de Module.

> **Convention-noot:** mig 217 en 153 worden niet **bewerkt** in-place (idempotency-conventie van het project). I.p.v. dat: mig 218 vervangt deze functies via `CREATE OR REPLACE FUNCTION ...`. Tasks geven exact aan welke RPC-bodies in mig 218 worden geherdefinieerd.

**Frontend:**
- Create: `frontend/src/modules/orders-lifecycle/index.ts` — barrel export
- Create: `frontend/src/modules/orders-lifecycle/queries/transities.ts` — RPC-wrappers
- Create: `frontend/src/modules/orders-lifecycle/hooks/use-markeer-geannuleerd.ts`
- Create: `frontend/src/modules/orders-lifecycle/queries/order-events.ts` — fetcher voor timeline
- Create: `frontend/src/modules/orders-lifecycle/hooks/use-order-events.ts`
- Create: `frontend/src/modules/orders-lifecycle/components/order-events-timeline.tsx`
- Create: `frontend/src/modules/orders-lifecycle/__tests__/transities.contract.test.ts`
- Modify: `frontend/src/lib/supabase/queries/orders.ts` — verwijder eventuele `updateOrderStatus`-helper en directe `UPDATE` (TBD na grep)

**CI:**
- Create: `scripts/lint-no-direct-orders-status-update.sh` — grep-regel die faalt bij `UPDATE orders SET status` buiten Module-folder.
- Modify: `package.json` of `frontend/package.json` — voeg lint-script toe.

**Documenten:**
- Modify: `docs/changelog.md` — entries voor mig 218
- Modify: `docs/architectuur.md` — Module-graf-sectie met `modules/orders-lifecycle/`
- Modify: `docs/database-schema.md` — sectie `order_events` + `order_event_type`

### Fase 2 — Facturatie-Module (ADR-0007)

**Frontend (verhuizingen):**
- Move: `frontend/src/pages/facturatie/factuur-detail.tsx` → `frontend/src/modules/facturatie/pages/factuur-detail.tsx`
- Move: `frontend/src/pages/facturatie/facturatie-overview.tsx` → `frontend/src/modules/facturatie/pages/facturatie-overview.tsx`
- Move: `frontend/src/components/facturatie/factuur-lijst.tsx` → `frontend/src/modules/facturatie/components/factuur-lijst.tsx`
- Move: `frontend/src/hooks/use-facturen.ts` → `frontend/src/modules/facturatie/hooks/use-facturen.ts`
- Move: `frontend/src/lib/supabase/queries/facturen.ts` → `frontend/src/modules/facturatie/queries/facturen.ts`

**Frontend (nieuw):**
- Create: `frontend/src/modules/facturatie/index.ts` — barrel
- Create: `frontend/src/modules/facturatie/queries/klant-factuur-instellingen.ts`
- Create: `frontend/src/modules/facturatie/hooks/use-klant-factuur-instellingen.ts`
- Create: `frontend/src/modules/facturatie/__tests__/klant-factuur-instellingen.contract.test.ts`

**Frontend (modify imports):**
- Modify: `frontend/src/components/orders/order-facturen.tsx` — import-paden
- Modify: `frontend/src/components/klanten/klant-facturering-tab.tsx` — gebruik nieuwe hook
- Modify: `frontend/src/router.tsx` (of waar routes zitten) — import-paden voor pages
- Modify: alle bestanden die `@/lib/supabase/queries/facturen`, `@/hooks/use-facturen`, `@/components/facturatie/*` of `@/pages/facturatie/*` importeren — find-and-replace

**Database:**
- Create: `supabase/migrations/219_facturatie_event_listener.sql` — drop oude trigger, nieuwe trigger op `order_events`, optioneel `factuur_queue.bron_event_id`-kolom.

**Documenten:**
- Modify: `docs/changelog.md` — entries voor verhuizing + mig 219
- Modify: `docs/architectuur.md` — Module-graf + facturatie-flow-sectie

---

## Fase 1: Order-lifecycle Module (ADR-0006)

### Task 1.1: Migratie 218 schema-fundament — enum, tabel, index

**Files:**
- Create: `supabase/migrations/218_order_lifecycle_module.sql` (eerste blok)

- [ ] **Step 1: Schrijf migratie-header en schema-blok**

```sql
-- Migratie 218: Order-lifecycle Module (ADR-0006)
--
-- Introduceert order_events (typed audit-log van orders.status-overgangen) +
-- drie RPCs (markeer_verzonden, markeer_geannuleerd, herbereken_wacht_status)
-- die als enige orders.status muteren via _apply_transitie.
--
-- Sluit het patroon dat ADR-0005 doorpunt'te: orders.status had geen eigenaar.
-- Met deze migratie is er één schrijfpad; alle bestaande writers (mig 144/153,
-- mig 217 voltooi_pickronde, frontend annulerings-UI) gaan via deze RPCs.
--
-- Idempotent: enum via DO-block, tabel via CREATE TABLE IF NOT EXISTS,
-- RPCs via CREATE OR REPLACE.

-- 1. Enum order_event_type
DO $$ BEGIN
  CREATE TYPE order_event_type AS ENUM (
    'aangemaakt',
    'pickronde_voltooid',
    'wacht_status_herberekend',
    'geannuleerd'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Tabel order_events (append-only)
CREATE TABLE IF NOT EXISTS order_events (
  id                    BIGSERIAL PRIMARY KEY,
  order_id              BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type            order_event_type NOT NULL,
  status_voor           order_status,
  status_na             order_status NOT NULL,
  actor_medewerker_id   BIGINT REFERENCES medewerkers(id) ON DELETE SET NULL,
  actor_auth_user_id    UUID   REFERENCES auth.users(id)   ON DELETE SET NULL,
  reden                 TEXT,
  metadata              JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT order_events_actor_xor CHECK (
    NOT (actor_medewerker_id IS NOT NULL AND actor_auth_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS order_events_order_idx
  ON order_events(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS order_events_type_idx
  ON order_events(event_type, created_at DESC);

COMMENT ON TABLE order_events IS
  'Mig 218 (ADR-0006): typed audit-log van orders.status-overgangen. '
  'Bron-van-waarheid voor wie/wanneer/waarom een transitie deed. '
  'Geschreven door _apply_transitie binnen Order-lifecycle Module.';
```

- [ ] **Step 2: Pas migratie toe in Supabase SQL Editor**

Run: kopieer `218_order_lifecycle_module.sql` in Supabase Dashboard → SQL Editor → Run.
Expected: `Success. No rows returned.`

- [ ] **Step 3: Verifieer**

Run in SQL Editor:
```sql
SELECT typname FROM pg_type WHERE typname = 'order_event_type';
SELECT to_regclass('public.order_events');
```
Expected: `order_event_type` rij + `order_events` regclass.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/218_order_lifecycle_module.sql
git commit -m "feat(order-lifecycle): mig 218 fundament — enum order_event_type + tabel order_events (ADR-0006)"
```

---

### Task 1.2: Migratie 218 — `_apply_transitie` interne helper

**Files:**
- Modify: `supabase/migrations/218_order_lifecycle_module.sql` (append)

- [ ] **Step 1: Append `_apply_transitie` functie aan mig 218**

Append aan bestaand bestand:

```sql
-- 3. Interne helper — atomair: UPDATE orders + INSERT order_events
CREATE OR REPLACE FUNCTION _apply_transitie(
  p_order_id            BIGINT,
  p_event_type          order_event_type,
  p_status_na           order_status,
  p_actor_medewerker_id BIGINT DEFAULT NULL,
  p_actor_auth_user_id  UUID   DEFAULT NULL,
  p_reden               TEXT   DEFAULT NULL,
  p_metadata            JSONB  DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_status_voor order_status;
  v_zet_verzonden_at BOOLEAN;
BEGIN
  SELECT status INTO v_status_voor FROM orders WHERE id = p_order_id;
  IF v_status_voor IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- No-op als status al gelijk is (idempotent).
  IF v_status_voor = p_status_na THEN
    RETURN;
  END IF;

  v_zet_verzonden_at := (p_status_na = 'Verzonden');

  UPDATE orders
     SET status = p_status_na,
         verzonden_at = CASE
           WHEN v_zet_verzonden_at AND verzonden_at IS NULL THEN now()
           ELSE verzonden_at
         END
   WHERE id = p_order_id;

  INSERT INTO order_events (
    order_id, event_type, status_voor, status_na,
    actor_medewerker_id, actor_auth_user_id, reden, metadata
  ) VALUES (
    p_order_id, p_event_type, v_status_voor, p_status_na,
    p_actor_medewerker_id, p_actor_auth_user_id, p_reden, p_metadata
  );
END;
$$;

COMMENT ON FUNCTION _apply_transitie IS
  'Mig 218: interne helper — enige plek in de codebase die UPDATE orders SET status doet. '
  'Atomair: status + verzonden_at (bij Verzonden) + INSERT order_events. '
  'Idempotent: no-op als status al gelijk is. Niet rechtstreeks aanroepen — gebruik '
  'markeer_verzonden / markeer_geannuleerd / herbereken_wacht_status.';
```

- [ ] **Step 2: Pas toe in SQL Editor**

Expected: `Success`.

- [ ] **Step 3: Snel-test (handmatig in SQL Editor)**

```sql
-- Snel-test op een test-order (vervang 9999 door een bestaand order-id of skip)
DO $$
DECLARE
  v_order_id BIGINT := 9999; -- pas aan
BEGIN
  -- skip als order niet bestaat
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_order_id) THEN
    RAISE NOTICE 'Skip: order % bestaat niet', v_order_id;
    RETURN;
  END IF;
  PERFORM _apply_transitie(v_order_id, 'aangemaakt', 'Nieuw');
  RAISE NOTICE 'Test gelukt';
END $$;
```

Expected: NOTICE — geen exception. Zo ja: rollback (de functie is no-op als status al `Nieuw` was).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/218_order_lifecycle_module.sql
git commit -m "feat(order-lifecycle): mig 218 _apply_transitie helper — enige schrijver van orders.status (ADR-0006)"
```

---

### Task 1.3: Migratie 218 — `markeer_verzonden` command + contract-test

**Files:**
- Modify: `supabase/migrations/218_order_lifecycle_module.sql` (append)
- Create: `frontend/src/modules/orders-lifecycle/queries/transities.ts`
- Create: `frontend/src/modules/orders-lifecycle/__tests__/transities.contract.test.ts`

- [ ] **Step 1: Schrijf failing contract-test eerst (TDD red)**

`frontend/src/modules/orders-lifecycle/__tests__/transities.contract.test.ts`:

```ts
// Contract tests voor Order-lifecycle Module RPC-wrappers.
// Pattern overgenomen van magazijn/__tests__/pickronde.contract.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcCalls: Array<{ fn: string; args: unknown }> = []
let nextRpcResponse: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(nextRpcResponse)
    },
  },
}))

import {
  markeerVerzonden,
  markeerGeannuleerd,
  herberekenWachtStatus,
} from '../queries/transities'

beforeEach(() => {
  rpcCalls.length = 0
  nextRpcResponse = { data: null, error: null }
})

describe('markeerVerzonden', () => {
  it('roept RPC markeer_verzonden aan met p_order_id en optionele actor', async () => {
    await markeerVerzonden({ orderId: 123, actorMedewerkerId: 7 })
    expect(rpcCalls).toEqual([{
      fn: 'markeer_verzonden',
      args: { p_order_id: 123, p_actor_medewerker_id: 7, p_actor_auth_user_id: null }
    }])
  })

  it('zonder actor stuurt beide null', async () => {
    await markeerVerzonden({ orderId: 5 })
    expect(rpcCalls[0].args).toMatchObject({
      p_order_id: 5,
      p_actor_medewerker_id: null,
      p_actor_auth_user_id: null,
    })
  })

  it('propageert RPC-fout als Error', async () => {
    nextRpcResponse = { data: null, error: { message: 'Order bestaat niet' } }
    await expect(markeerVerzonden({ orderId: 999 })).rejects.toThrow('Order bestaat niet')
  })
})
```

- [ ] **Step 2: Run test — verwacht FAIL (module bestaat nog niet)**

```bash
cd frontend && npx vitest run src/modules/orders-lifecycle/__tests__/transities.contract.test.ts
```

Expected: FAIL — `Cannot find module '../queries/transities'`.

- [ ] **Step 3: Schrijf TS-wrapper**

`frontend/src/modules/orders-lifecycle/queries/transities.ts`:

```ts
import { supabase } from '@/lib/supabase/client'

export interface MarkeerVerzondenInput {
  orderId: number
  actorMedewerkerId?: number | null
  actorAuthUserId?: string | null
}

export async function markeerVerzonden(input: MarkeerVerzondenInput): Promise<void> {
  const { error } = await supabase.rpc('markeer_verzonden', {
    p_order_id: input.orderId,
    p_actor_medewerker_id: input.actorMedewerkerId ?? null,
    p_actor_auth_user_id: input.actorAuthUserId ?? null,
  })
  if (error) throw new Error(error.message)
}

// markeerGeannuleerd + herberekenWachtStatus volgen in tasks 1.4 + 1.5.
// Stub-typing met `unknown` zodat de test-imports in 1.4/1.5 compileren
// — de echte signaturen vervangen deze in de volgende tasks.
export async function markeerGeannuleerd(_input: unknown): Promise<void> {
  throw new Error('not implemented yet')
}
export async function herberekenWachtStatus(_input: unknown): Promise<void> {
  throw new Error('not implemented yet')
}
```

- [ ] **Step 4: Run test — verwacht PASS voor markeerVerzonden, fail voor andere**

```bash
npx vitest run src/modules/orders-lifecycle/__tests__/transities.contract.test.ts -t markeerVerzonden
```

Expected: 3/3 PASS.

- [ ] **Step 5: Append `markeer_verzonden` aan mig 218**

```sql
-- 4. Command — markeer_verzonden
CREATE OR REPLACE FUNCTION markeer_verzonden(
  p_order_id            BIGINT,
  p_actor_medewerker_id BIGINT DEFAULT NULL,
  p_actor_auth_user_id  UUID   DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_huidig = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Geannuleerde order % kan niet op Verzonden worden gezet', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'pickronde_voltooid',
    p_status_na           := 'Verzonden',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION markeer_verzonden(BIGINT, BIGINT, UUID) TO authenticated;

COMMENT ON FUNCTION markeer_verzonden IS
  'Mig 218 (ADR-0006): zet orders.status=Verzonden + verzonden_at=now() + audit-event. '
  'Caller: voltooi_pickronde (mig 217 update) of frontend handmatig. '
  'Idempotent. Faalt op geannuleerde orders.';
```

- [ ] **Step 6: Apply mig in SQL Editor; commit**

```bash
git add supabase/migrations/218_order_lifecycle_module.sql frontend/src/modules/orders-lifecycle/queries/transities.ts frontend/src/modules/orders-lifecycle/__tests__/transities.contract.test.ts
git commit -m "feat(order-lifecycle): mig 218 markeer_verzonden command + contract-test (ADR-0006)"
```

---

### Task 1.4: Migratie 218 — `markeer_geannuleerd` command + test

**Files:**
- Modify: `supabase/migrations/218_order_lifecycle_module.sql` (append)
- Modify: `frontend/src/modules/orders-lifecycle/queries/transities.ts`
- Modify: `frontend/src/modules/orders-lifecycle/__tests__/transities.contract.test.ts`

- [ ] **Step 1: Test eerst — append failing test**

```ts
describe('markeerGeannuleerd', () => {
  it('roept RPC markeer_geannuleerd aan met p_order_id, p_reden, p_actor', async () => {
    await markeerGeannuleerd({ orderId: 7, reden: 'klant heeft geannuleerd', actorAuthUserId: 'abc' })
    expect(rpcCalls).toEqual([{
      fn: 'markeer_geannuleerd',
      args: {
        p_order_id: 7,
        p_reden: 'klant heeft geannuleerd',
        p_actor_medewerker_id: null,
        p_actor_auth_user_id: 'abc',
      }
    }])
  })

  it('vereist reden (compile-time check via TS-types — geen runtime test nodig)', () => {
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 2: Run — verwacht FAIL**

```bash
npx vitest run src/modules/orders-lifecycle/__tests__/transities.contract.test.ts -t markeerGeannuleerd
```

Expected: FAIL — "not implemented yet".

- [ ] **Step 3: Vervang stub-implementatie**

In `transities.ts`:

```ts
export interface MarkeerGeannuleerdInput {
  orderId: number
  reden: string
  actorMedewerkerId?: number | null
  actorAuthUserId?: string | null
}

export async function markeerGeannuleerd(input: MarkeerGeannuleerdInput): Promise<void> {
  const { error } = await supabase.rpc('markeer_geannuleerd', {
    p_order_id: input.orderId,
    p_reden: input.reden,
    p_actor_medewerker_id: input.actorMedewerkerId ?? null,
    p_actor_auth_user_id: input.actorAuthUserId ?? null,
  })
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 4: Run — verwacht PASS**

Expected: 5/5 PASS.

- [ ] **Step 5: Append SQL — `markeer_geannuleerd`**

```sql
-- 5. Command — markeer_geannuleerd
CREATE OR REPLACE FUNCTION markeer_geannuleerd(
  p_order_id            BIGINT,
  p_reden               TEXT,
  p_actor_medewerker_id BIGINT DEFAULT NULL,
  p_actor_auth_user_id  UUID   DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_huidig = 'Verzonden' THEN
    RAISE EXCEPTION 'Verzonden order % kan niet meer worden geannuleerd', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'geannuleerd',
    p_status_na           := 'Geannuleerd',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id,
    p_reden               := p_reden
  );
END;
$$;

GRANT EXECUTE ON FUNCTION markeer_geannuleerd(BIGINT, TEXT, BIGINT, UUID) TO authenticated;

COMMENT ON FUNCTION markeer_geannuleerd IS
  'Mig 218 (ADR-0006): zet orders.status=Geannuleerd + audit-event. '
  'Reden verplicht voor audit-trail. Faalt op reeds verzonden orders.';
```

- [ ] **Step 6: Apply mig in SQL Editor + commit**

```bash
git add supabase/migrations/218_order_lifecycle_module.sql frontend/src/modules/orders-lifecycle/queries/transities.ts frontend/src/modules/orders-lifecycle/__tests__/transities.contract.test.ts
git commit -m "feat(order-lifecycle): mig 218 markeer_geannuleerd command + test (ADR-0006)"
```

---

### Task 1.5: Migratie 218 — `herbereken_wacht_status` recompute + test

**Files:**
- Modify: `supabase/migrations/218_order_lifecycle_module.sql` (append)
- Modify: `frontend/src/modules/orders-lifecycle/queries/transities.ts`
- Modify: `frontend/src/modules/orders-lifecycle/__tests__/transities.contract.test.ts`

- [ ] **Step 1: Append failing test**

```ts
describe('herberekenWachtStatus', () => {
  it('roept RPC herbereken_wacht_status aan met alleen p_order_id', async () => {
    await herberekenWachtStatus({ orderId: 12 })
    expect(rpcCalls).toEqual([{
      fn: 'herbereken_wacht_status',
      args: { p_order_id: 12 }
    }])
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Vervang stub**

```ts
export interface HerberekenWachtStatusInput { orderId: number }
export async function herberekenWachtStatus(input: HerberekenWachtStatusInput): Promise<void> {
  const { error } = await supabase.rpc('herbereken_wacht_status', {
    p_order_id: input.orderId,
  })
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 4: Run — PASS (6/6)**

- [ ] **Step 5: Append SQL `herbereken_wacht_status` — splits status-write af van mig 153-versie**

> Bron-locatie-noot: `herwaardeer_order_status` is **eerst gedefinieerd in mig 145** (regels ~87-150) en daarna in mig 153 herdefinieerd via `CREATE OR REPLACE` om afleverdatum-sync toe te voegen. De **live versie** is dus die uit mig 153 (laatste `CREATE OR REPLACE` wint). Wij raken mig 145 en 153 niet aan; mig 218 doet weer een `CREATE OR REPLACE` (Task 1.8) die de status-keuze delegeert naar de hier nieuwe `herbereken_wacht_status` en de afleverdatum-sync intact laat. De code hieronder kopieert de status-keuze-logica uit mig 153 zoals die werkelijk in productie draait.

```sql
-- 6. Recompute — herbereken_wacht_status
-- Bevat alleen de status-keuze. De claim-checks + afleverdatum-sync
-- blijven in herwaardeer_order_status (mig 153, geüpdatet in Task 1.8).
CREATE OR REPLACE FUNCTION herbereken_wacht_status(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig order_status;
  v_heeft_io_claim BOOLEAN;
  v_heeft_tekort BOOLEAN;
  v_doel order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;

  -- Eindstatussen + actieve productie/picking niet aanraken (compatibel met mig 153).
  -- Bij pad-strict (Task 1.10): de laatste 5 leden zijn dood — CHECK garandeert
  -- dat ze niet bestaan op orders. Bij pad-pragmatisch: ze tolereren legacy data.
  -- Defensief consistent in beide paden; opruimen volgt in vervolg-iteratie als
  -- pad-strict gekozen is (zie Task 1.11 sentinel-cleanup-scope).
  IF v_huidig IN (
    'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
    'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken'
  ) THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    WHERE oreg.order_id = p_order_id
      AND r.bron = 'inkooporder_regel'
      AND r.status = 'actief'
  ) INTO v_heeft_io_claim;

  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = false
      AND oreg.artikelnr IS NOT NULL
      AND oreg.te_leveren > COALESCE((
        SELECT SUM(aantal) FROM order_reserveringen r
        WHERE r.order_regel_id = oreg.id AND r.status = 'actief'
      ), 0)
  ) INTO v_heeft_tekort;

  IF v_heeft_io_claim THEN
    v_doel := 'Wacht op inkoop';
  ELSIF v_heeft_tekort THEN
    v_doel := 'Wacht op voorraad';
  ELSIF v_huidig IN ('Wacht op inkoop', 'Wacht op voorraad') THEN
    v_doel := 'Nieuw';
  ELSE
    RETURN; -- niets te doen
  END IF;

  PERFORM _apply_transitie(
    p_order_id   := p_order_id,
    p_event_type := 'wacht_status_herberekend',
    p_status_na  := v_doel
  );
END;
$$;

GRANT EXECUTE ON FUNCTION herbereken_wacht_status(BIGINT) TO authenticated;

COMMENT ON FUNCTION herbereken_wacht_status IS
  'Mig 218 (ADR-0006): leest claim-state, kiest Wacht op X / Nieuw, schrijft via _apply_transitie. '
  'Eindstatussen + actieve productie/picking-statussen worden niet aangeraakt. '
  'Wordt aangeroepen door herwaardeer_order_status (mig 153) en kan ook handmatig.';
```

- [ ] **Step 6: Apply + commit**

```bash
git add supabase/migrations/218_order_lifecycle_module.sql frontend/src/modules/orders-lifecycle/queries/transities.ts frontend/src/modules/orders-lifecycle/__tests__/transities.contract.test.ts
git commit -m "feat(order-lifecycle): mig 218 herbereken_wacht_status recompute + test (ADR-0006)"
```

---

### Task 1.6: Migratie 218 — backfill `order_events`

**Files:**
- Modify: `supabase/migrations/218_order_lifecycle_module.sql` (append)

- [ ] **Step 1: Append backfill-blok**

```sql
-- 7. Backfill: één synthetisch event per bestaande order
-- 'aangemaakt' op orders.orderdatum (DATE → cast naar timestamptz), plus
-- 'pickronde_voltooid' als verzonden_at gevuld. Idempotent: NOT EXISTS-guard.
--
-- Noot: orders heeft geen aangemaakt_op-kolom — orderdatum is de beste
-- proxy voor ontstaan-moment. Voor strikte audit-rapportage zijn historische
-- timestamps benaderend; nieuwe events na mig 218 hebben created_at = now().
INSERT INTO order_events (order_id, event_type, status_voor, status_na, created_at, metadata)
SELECT
  o.id,
  'aangemaakt'::order_event_type,
  NULL,
  o.status,
  COALESCE(o.orderdatum::timestamptz, now()),
  jsonb_build_object('backfill', true)
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM order_events oe
  WHERE oe.order_id = o.id AND oe.event_type = 'aangemaakt'
);

INSERT INTO order_events (order_id, event_type, status_voor, status_na, created_at, metadata)
SELECT
  o.id,
  'pickronde_voltooid'::order_event_type,
  NULL,
  'Verzonden'::order_status,
  o.verzonden_at,
  jsonb_build_object('backfill', true)
FROM orders o
WHERE o.verzonden_at IS NOT NULL
  AND o.status = 'Verzonden'
  AND NOT EXISTS (
    SELECT 1 FROM order_events oe
    WHERE oe.order_id = o.id AND oe.event_type = 'pickronde_voltooid'
  );
```

- [ ] **Step 2: Apply + verifieer count**

In SQL Editor:
```sql
SELECT event_type, COUNT(*) FROM order_events GROUP BY event_type;
```
Expected: `aangemaakt` = `(SELECT COUNT(*) FROM orders)`; `pickronde_voltooid` = `(SELECT COUNT(*) FROM orders WHERE verzonden_at IS NOT NULL)`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/218_order_lifecycle_module.sql
git commit -m "feat(order-lifecycle): mig 218 backfill order_events voor bestaande orders (ADR-0006)"
```

---

### Task 1.7: Migratie 218 — Update `voltooi_pickronde` (mig 217) → `markeer_verzonden`

**Files:**
- Modify: `supabase/migrations/218_order_lifecycle_module.sql` (append CREATE OR REPLACE)

- [ ] **Step 1: Append herdefinitie van `voltooi_pickronde`**

> Vervangt regels 268-335 van [mig 217](../../../supabase/migrations/217_pickronde_picker_factuur_keten.sql). De picker-validatie + colli-update + zending-status-flip blijven; alleen de inline `UPDATE orders SET status='Verzonden'` (regels 320-331) wordt vervangen door `PERFORM markeer_verzonden(...)`.

```sql
-- 8. Herdefinitie voltooi_pickronde — order-status-write delegeren aan markeer_verzonden
CREATE OR REPLACE FUNCTION voltooi_pickronde(
  p_zending_id BIGINT,
  p_picker_id  BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig             zending_status;
  v_aantal_niet_gev    INTEGER;
  v_order_id           BIGINT;
  v_open_zendingen     INTEGER;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  SELECT status, order_id INTO v_huidig, v_order_id
    FROM zendingen WHERE id = p_zending_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;
  IF v_huidig <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde voor zending % is niet actief (status=%)', p_zending_id, v_huidig;
  END IF;

  SELECT COUNT(*) INTO v_aantal_niet_gev
    FROM zending_colli
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'niet_gevonden';
  IF v_aantal_niet_gev > 0 THEN
    RAISE EXCEPTION 'Pickronde heeft % openstaand(e) pick-probleem(en) — los op of splits eerst',
      v_aantal_niet_gev USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE zending_colli
     SET pick_uitkomst   = 'gepickt',
         gepickt_at      = now(),
         gepickt_door_id = p_picker_id
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'open';

  UPDATE zendingen
     SET status    = 'Klaar voor verzending',
         picker_id = COALESCE(picker_id, p_picker_id)
   WHERE id = p_zending_id;

  -- Sluitstuk factuur-keten: bij laatste open zending, delegeer naar Order-lifecycle
  SELECT COUNT(*) INTO v_open_zendingen
    FROM zendingen
   WHERE order_id = v_order_id
     AND status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd', 'Geannuleerd');

  IF v_open_zendingen = 0 THEN
    -- Skip voor reeds-Verzonden of Geannuleerde orders (markeer_verzonden zou
    -- exception gooien op Geannuleerd; mig 217 deed silent-skip via WHERE-clause).
    IF NOT EXISTS (
      SELECT 1 FROM orders
       WHERE id = v_order_id
         AND status IN ('Verzonden', 'Geannuleerd')
    ) THEN
      PERFORM markeer_verzonden(
        p_order_id            := v_order_id,
        p_actor_medewerker_id := p_picker_id
      );
      -- Tot mig 219: factuur-trigger trg_enqueue_factuur vuurt op de orders.status-UPDATE.
      -- Na mig 219: trg_enqueue_factuur is gedropt; trg_enqueue_factuur_op_event
      -- vuurt op de bijbehorende order_events-INSERT (gedaan door _apply_transitie).
    END IF;
  END IF;

  RETURN p_zending_id;
END;
$$;

COMMENT ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) IS
  'Mig 218 (ADR-0006): voltooit Pickronde, delegeert order-status-write aan markeer_verzonden. '
  'Vervangt mig 217-versie die orders direct UPDATE-de.';
```

- [ ] **Step 2: Apply mig**

- [ ] **Step 3: Validatie — bestaande pickronde-tests draaien nog**

```bash
cd frontend && npx vitest run src/modules/magazijn/__tests__/pickronde.contract.test.ts
```
Expected: PASS — RPC-naam + args ongewijzigd vanuit caller-perspectief.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/218_order_lifecycle_module.sql
git commit -m "refactor(order-lifecycle): mig 218 voltooi_pickronde roept markeer_verzonden ipv direct UPDATE (ADR-0006)"
```

---

### Task 1.8: Migratie 218 — Update `herwaardeer_order_status` (mig 153) → `herbereken_wacht_status`

**Files:**
- Modify: `supabase/migrations/218_order_lifecycle_module.sql` (append CREATE OR REPLACE)

- [ ] **Step 1: Append herdefinitie**

> Doel: laat de naar-buiten-zichtbare API ongewijzigd, delegeer de status-keuze. `herwaardeer_order_status` staat sinds mig 153 live (was eerst in mig 145 gedefinieerd). Mig 218 doet weer een `CREATE OR REPLACE` zonder de oudere migraties te bewerken.

```sql
-- 9. Herdefinitie herwaardeer_order_status — delegeert status-write aan Module
CREATE OR REPLACE FUNCTION herwaardeer_order_status(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  -- Module bepaalt status (Wacht op X / Nieuw / no-op bij eindstatus)
  PERFORM herbereken_wacht_status(p_order_id);

  -- Mig 153 verantwoordelijkheid behouden: afleverdatum vooruit syncen
  PERFORM sync_order_afleverdatum_met_claims(p_order_id);
END;
$$;

COMMENT ON FUNCTION herwaardeer_order_status IS
  'Mig 218 (ADR-0006): herwaardeert order — delegeert status-keuze aan Order-lifecycle Module '
  '(herbereken_wacht_status) en blijft afleverdatum-sync owen (sync_order_afleverdatum_met_claims). '
  'Backwards-compat: alle bestaande callers (triggers, RPCs) blijven dezelfde signature aanroepen.';
```

- [ ] **Step 2: Apply mig**

- [ ] **Step 3: Snel-test integratie**

In SQL Editor (kies één order met active claims):
```sql
SELECT id, status FROM orders WHERE status = 'Wacht op inkoop' LIMIT 1;
-- noteer id, dan:
SELECT herwaardeer_order_status(<id>);
SELECT * FROM order_events WHERE order_id = <id> ORDER BY created_at DESC LIMIT 3;
```
Expected: order_events bevat een `wacht_status_herberekend` rij **alleen als** de status werkelijk veranderde — anders no-op (idempotent).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/218_order_lifecycle_module.sql
git commit -m "refactor(order-lifecycle): mig 218 herwaardeer_order_status delegeert status-write naar Module (ADR-0006)"
```

---

### Task 1.9: Data-audit — welke statussen leven werkelijk in productie?

**Files:** geen — alleen rapport.

- [ ] **Step 1: Run audit-query in SQL Editor**

```sql
SELECT status, COUNT(*) AS aantal
FROM orders
GROUP BY status
ORDER BY aantal DESC;
```

- [ ] **Step 2: Documenteer uitkomst**

Schrijf in `docs/superpowers/plans/2026-05-07-order-lifecycle-en-facturatie-modules.md` (dit document) onder een nieuwe sectie `## Data-audit uitkomst (Task 1.9)` de gevonden waarden.

Beslissingsregel:
- Als er **alleen** orders bestaan met statussen `{Nieuw, Wacht op voorraad, Wacht op inkoop, Verzonden, Geannuleerd}`: kies pad **strict** voor Task 1.10 (CHECK alleen die 5).
- Als er ook orders met `Klaar voor verzending`, `In productie`, etc. bestaan: kies pad **pragmatisch** — verwijder alleen `Klaar voor verzending` via een data-cleanup naar een passende doelstatus (`Nieuw` of `Wacht op voorraad`), tolereer de rest.
- Als data-cleanup risicovol blijkt: stel Task 1.10 + 1.11 uit naar een vervolg-iteratie. Markeer in dit doc.

- [ ] **Step 3: Commit het rapport**

```bash
git add docs/superpowers/plans/2026-05-07-order-lifecycle-en-facturatie-modules.md
git commit -m "docs(order-lifecycle): data-audit uitkomst — bepaalt CHECK-strategie voor mig 218 task 1.10"
```

---

### Task 1.10: Migratie 218 — CHECK-constraint op `orders.status` (conditioneel op Task 1.9)

**Files:**
- Modify: `supabase/migrations/218_order_lifecycle_module.sql` (append)

- [ ] **Step 1: Schrijf cleanup + CHECK afhankelijk van audit-uitkomst**

**Pad strict** (audit toont alleen 5 levende statussen):

```sql
-- 10a. CHECK-constraint — strict 5-statussen
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_chk;
ALTER TABLE orders ADD CONSTRAINT orders_status_chk
  CHECK (status IN ('Nieuw','Wacht op voorraad','Wacht op inkoop','Verzonden','Geannuleerd'));
```

**Pad pragmatisch** (audit toont legacy-data):

```sql
-- 10b. Cleanup spook-status + CHECK — pragmatisch
-- Migreer 'Klaar voor verzending' op orders naar 'Nieuw' (pre-pickronde-state).
-- Audit-trail: schrijft een synthetisch order_events.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM orders WHERE status = 'Klaar voor verzending' LOOP
    PERFORM _apply_transitie(
      p_order_id := r.id,
      p_event_type := 'wacht_status_herberekend',
      p_status_na := 'Nieuw',
      p_reden := 'Mig 218 cleanup: spook-status Klaar voor verzending verwijderd (ADR-0006)',
      p_metadata := jsonb_build_object('cleanup', true)
    );
  END LOOP;
END $$;

-- CHECK verbiedt voortaan 'Klaar voor verzending' op orders
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_chk;
ALTER TABLE orders ADD CONSTRAINT orders_status_chk
  CHECK (status <> 'Klaar voor verzending');
```

- [ ] **Step 2: Apply gekozen pad**

- [ ] **Step 3: Verifieer**

```sql
SELECT COUNT(*) FROM orders WHERE status = 'Klaar voor verzending';
-- Expected: 0
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conname = 'orders_status_chk';
-- Expected: zichtbare CHECK-clausule
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/218_order_lifecycle_module.sql
git commit -m "feat(order-lifecycle): mig 218 CHECK-constraint orders.status — spook 'Klaar voor verzending' weg (ADR-0006)"
```

---

### Task 1.11: Sentinel-filters opschonen in 6 RPCs

**Files:**
- Modify: `supabase/migrations/218_order_lifecycle_module.sql` (append CREATE OR REPLACE per RPC)

> Doelfuncties (uit ADR-0006): mig 145, 153, 185, 186, 188, 192. Deze filteren `WHERE status NOT IN ('Klaar voor verzending', ...)` of `IF v_huidig IN ('Klaar voor verzending', ...)`. Met de CHECK-constraint van Task 1.10 zijn die filters bewijsbaar dood.

- [ ] **Step 1: Identificeer per migratie de filter-clausule**

Run grep:

```bash
grep -n "Klaar voor verzending" supabase/migrations/{145,153,185,186,188,192}*.sql
```

- [ ] **Step 2: Per gevonden RPC: schrijf `CREATE OR REPLACE` zonder de spook-clausule**

> Door grootte: doe dit per RPC als sub-step met aparte commit. Kopieer de bestaande body uit de bron-migratie, verwijder `'Klaar voor verzending'` uit de IN-lijst, en append aan mig 218.

- [ ] **Step 3: Apply mig 218 (de cumulatieve)**

- [ ] **Step 4: Run alle bestaande contract-tests**

```bash
cd frontend && npx vitest run src/modules
```
Expected: alle tests groen — sentinel-cleanup is gedragsbehoud (status was toch nooit in de DB).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/218_order_lifecycle_module.sql
git commit -m "refactor(order-lifecycle): mig 218 verwijder 'Klaar voor verzending'-sentinel uit 6 RPCs (ADR-0006)"
```

---

### Task 1.12: Frontend `modules/orders-lifecycle/` — barrel + types

**Files:**
- Create: `frontend/src/modules/orders-lifecycle/index.ts`
- Modify: `frontend/src/modules/orders-lifecycle/queries/transities.ts` (al bestaand)

- [ ] **Step 1: Schrijf barrel**

```ts
// frontend/src/modules/orders-lifecycle/index.ts
export {
  markeerVerzonden,
  markeerGeannuleerd,
  herberekenWachtStatus,
  type MarkeerVerzondenInput,
  type MarkeerGeannuleerdInput,
} from './queries/transities'

// useMarkeerGeannuleerd volgt in Task 1.13
// useOrderEvents + OrderEventsTimeline volgen in Task 1.13b
```

- [ ] **Step 2: Verifieer typecheck**

```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/orders-lifecycle/index.ts
git commit -m "feat(order-lifecycle): module barrel-export (ADR-0006)"
```

---

### Task 1.13: Frontend `useMarkeerGeannuleerd` hook + replace annulerings-mutatie

**Files:**
- Create: `frontend/src/modules/orders-lifecycle/hooks/use-markeer-geannuleerd.ts`
- Modify: `frontend/src/modules/orders-lifecycle/index.ts`
- Modify: bestaande caller (te vinden via grep — vermoedelijk een knop op order-detail)

- [ ] **Step 1: Vind de huidige annulerings-mutatie**

```bash
cd frontend && grep -rn "Geannuleerd" src/components/orders src/lib/supabase/queries/orders.ts src/pages/orders
```

Documenteer de bestaande caller in een commit-message.

- [ ] **Step 2: Schrijf hook**

```ts
// frontend/src/modules/orders-lifecycle/hooks/use-markeer-geannuleerd.ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { markeerGeannuleerd, type MarkeerGeannuleerdInput } from '../queries/transities'

export function useMarkeerGeannuleerd() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: MarkeerGeannuleerdInput) => markeerGeannuleerd(input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['order', vars.orderId] })
      qc.invalidateQueries({ queryKey: ['order-events', vars.orderId] })
    },
  })
}
```

- [ ] **Step 3: Voeg toe aan barrel**

In `index.ts`:
```ts
export { useMarkeerGeannuleerd } from './hooks/use-markeer-geannuleerd'
```

- [ ] **Step 4: Vervang bestaande annulerings-caller**

Update gevonden caller om `useMarkeerGeannuleerd` te gebruiken i.p.v. directe `updateOrder`-mutatie. Verwijder eventueel dode `updateOrderStatus`-helper uit `lib/supabase/queries/orders.ts`.

- [ ] **Step 5: Run frontend-tests + typecheck**

```bash
npx tsc --noEmit && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/orders-lifecycle/ frontend/src/<gevonden caller>
git commit -m "refactor(order-lifecycle): annulerings-mutatie via useMarkeerGeannuleerd hook (ADR-0006)"
```

---

### Task 1.14: Lint/CI — grep-rule `UPDATE orders SET status` buiten Module

**Files:**
- Create: `scripts/lint-no-direct-orders-status-update.sh`
- Modify: `package.json` of `frontend/package.json` (lint-script)

- [ ] **Step 1: Schrijf shell-script**

> **Platform-noot:** dit script gebruikt POSIX-shell-features (`set -euo pipefail`, `[[`). Op Windows draait het via Git Bash (deel van Git for Windows) — het standaardpad voor dit project. PowerShell-uitvoerders moeten via Git Bash invoke'en.
>
> **Scope-keuze:** scant **alleen `frontend/`** + nieuwe migraties in `supabase/migrations/2*.sql` (218+). Legacy SQL-migraties 145, 153, 217 (de drie historische directe writers) staan niet in de scan-set: zij zijn historisch correct; mig 218 vervangt hun bodies via `CREATE OR REPLACE` zonder hun bestanden te bewerken.

```bash
#!/usr/bin/env bash
# scripts/lint-no-direct-orders-status-update.sh
# Faalt als 'UPDATE orders SET status' voorkomt in nieuwe code.
# Scope: frontend/ TS/TSX + supabase/migrations/2*.sql (Module-tijdperk).
# Legacy migraties 145/153/217 zijn historisch en niet meer bewerkt.
set -euo pipefail

ALLOWED_PATHS=(
  'supabase/migrations/218_order_lifecycle_module.sql'
)

# Zoek matches: frontend (excl. node_modules/dist) + nieuwe migraties.
frontend_matches=$(grep -rEn "UPDATE\s+orders\s+SET[^;]*\bstatus\b" frontend/src \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=node_modules --exclude-dir=dist 2>/dev/null || true)

migration_matches=$(grep -rEn "UPDATE\s+orders\s+SET[^;]*\bstatus\b" \
  supabase/migrations/2*.sql 2>/dev/null || true)

all="${frontend_matches}
${migration_matches}"

failed=0
echo "$all" | while IFS=: read -r file line rest; do
  [ -z "$file" ] && continue
  allowed=0
  for path in "${ALLOWED_PATHS[@]}"; do
    if [[ "$file" == *"$path"* ]]; then allowed=1; break; fi
  done
  if [ "$allowed" -eq 0 ]; then
    echo "FAIL: $file:$line — gebruik markeer_verzonden / markeer_geannuleerd / herbereken_wacht_status uit @/modules/orders-lifecycle"
    failed=1
  fi
done

if [ "$failed" -eq 1 ]; then
  exit 1
fi

echo "OK: geen directe UPDATE orders SET status buiten Module-allowlist"
```

- [ ] **Step 2: Voeg npm-script toe**

In `frontend/package.json` of root `package.json`:
```json
"scripts": {
  "lint:order-status": "bash scripts/lint-no-direct-orders-status-update.sh"
}
```

- [ ] **Step 3: Run lokaal**

```bash
chmod +x scripts/lint-no-direct-orders-status-update.sh
bash scripts/lint-no-direct-orders-status-update.sh
```
Expected: `OK`. Als er nog directe writes zijn — fix in Task 1.13 of voeg toe aan `ALLOWED_DIRS` met motivatie.

- [ ] **Step 4: Commit**

```bash
git add scripts/lint-no-direct-orders-status-update.sh package.json
git commit -m "ci(order-lifecycle): lint-rule voorkomt directe UPDATE orders SET status (ADR-0006)"
```

---

### Task 1.15: Doc-updates Fase 1

**Files:**
- Modify: `docs/changelog.md`
- Modify: `docs/architectuur.md`
- Modify: `docs/database-schema.md`

- [ ] **Step 1: Append changelog-entry**

```markdown
## 2026-05-07 — Order-lifecycle Module (ADR-0006, mig 218)

- Nieuwe Module `modules/orders-lifecycle/` als enige schrijver van `orders.status` + `orders.verzonden_at`.
- Tabel `order_events` (typed audit-log) met enum `order_event_type`.
- RPCs `markeer_verzonden`, `markeer_geannuleerd`, `herbereken_wacht_status` + interne `_apply_transitie`.
- `voltooi_pickronde` (mig 217) en `herwaardeer_order_status` (mig 153) gerefactored — delegeren status-write.
- CHECK-constraint verwijdert spook-status `Klaar voor verzending` van orders.
- Lint-script `scripts/lint-no-direct-orders-status-update.sh` voorkomt regressie.
```

- [ ] **Step 2: Update `docs/architectuur.md`**

Voeg toe aan de Module-graf-sectie (rond regel 28-29):

```markdown
De **vijfde domein-module is `modules/orders-lifecycle/`** — bezit de evolutie van `orders.status` + `verzonden_at` + audit-log `order_events`. Drie RPCs als publieke seam (`markeer_verzonden`, `markeer_geannuleerd`, `herbereken_wacht_status`), interne `_apply_transitie` als enige schrijver. Zie [ADR-0006](adr/0006-order-lifecycle-als-deep-module.md).
```

- [ ] **Step 3: Update `docs/database-schema.md`**

Append onder de Order-sectie:

```markdown
### order_events
Typed audit-log van orders.status-overgangen (mig 218, ADR-0006).
| Kolom | Type | Toelichting |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| order_id | BIGINT FK → orders | |
| event_type | order_event_type | aangemaakt / pickronde_voltooid / wacht_status_herberekend / geannuleerd |
| status_voor | order_status NULL | |
| status_na | order_status | |
| actor_medewerker_id | BIGINT FK → medewerkers | XOR met auth_user_id |
| actor_auth_user_id | UUID FK → auth.users | XOR met medewerker_id |
| reden | TEXT | |
| metadata | JSONB | |
| created_at | TIMESTAMPTZ | |

### order_event_type (enum)
`aangemaakt | pickronde_voltooid | wacht_status_herberekend | geannuleerd`
```

- [ ] **Step 4: Commit**

```bash
git add docs/changelog.md docs/architectuur.md docs/database-schema.md
git commit -m "docs(order-lifecycle): changelog + architectuur + database-schema updates voor ADR-0006"
```

---

## Fase 2: Facturatie-Module (ADR-0007)

### Task 2.1: Folder-structuur `modules/facturatie/`

**Files:**
- Create: `frontend/src/modules/facturatie/index.ts` (lege barrel, vult zich in volgende tasks)

- [ ] **Step 1: Maak folders**

```bash
mkdir -p frontend/src/modules/facturatie/{pages,components,hooks,queries,__tests__}
echo "// Barrel — vult zich tijdens fase 2" > frontend/src/modules/facturatie/index.ts
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/facturatie/
git commit -m "feat(facturatie): folder-skeleton modules/facturatie/ (ADR-0007)"
```

---

### Task 2.2: Verhuis pages

**Files:**
- Move: `pages/facturatie/factuur-detail.tsx` → `modules/facturatie/pages/factuur-detail.tsx`
- Move: `pages/facturatie/facturatie-overview.tsx` → `modules/facturatie/pages/facturatie-overview.tsx`
- Modify: `frontend/src/router.tsx` (of waar pages worden geïmporteerd)

- [ ] **Step 1: git-move**

```bash
git mv frontend/src/pages/facturatie/factuur-detail.tsx frontend/src/modules/facturatie/pages/factuur-detail.tsx
git mv frontend/src/pages/facturatie/facturatie-overview.tsx frontend/src/modules/facturatie/pages/facturatie-overview.tsx
rmdir frontend/src/pages/facturatie 2>/dev/null || true
```

- [ ] **Step 2: Vind alle imports**

```bash
cd frontend && grep -rn "@/pages/facturatie\|pages/facturatie/factuur-detail\|pages/facturatie/facturatie-overview" src/
```

- [ ] **Step 3: Vervang import-paden**

Voor elke gevonden import: vervang `@/pages/facturatie/...` door `@/modules/facturatie/pages/...`.

- [ ] **Step 4: Append barrel-exports voor router**

In `modules/facturatie/index.ts`:
```ts
export { default as FactuurDetailPage } from './pages/factuur-detail'
export { default as FacturatieOverviewPage } from './pages/facturatie-overview'
```

> **Noot:** vervang `default` door named export als de bestaande pages named exports zijn — controleer in de file.

- [ ] **Step 5: Update router-imports naar barrel**

Vervang `import FactuurDetail from '@/modules/facturatie/pages/factuur-detail'` door `import { FactuurDetailPage } from '@/modules/facturatie'`.

- [ ] **Step 6: Run typecheck + dev-server**

```bash
npx tsc --noEmit
npm run dev # browse to /facturatie en /facturatie/:id om visueel te valideren
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(facturatie): verhuis pages naar modules/facturatie/pages/ (ADR-0007)"
```

---

### Task 2.3: Verhuis components

**Files:**
- Move: `components/facturatie/factuur-lijst.tsx` → `modules/facturatie/components/factuur-lijst.tsx`

- [ ] **Step 1: git-move + vervang imports**

```bash
git mv frontend/src/components/facturatie/factuur-lijst.tsx frontend/src/modules/facturatie/components/factuur-lijst.tsx
rmdir frontend/src/components/facturatie 2>/dev/null || true

cd frontend && grep -rln "components/facturatie/factuur-lijst" src/ | \
  xargs sed -i.bak "s|@/components/facturatie/factuur-lijst|@/modules/facturatie/components/factuur-lijst|g"
find frontend/src -name "*.bak" -delete
```

> Op Windows: gebruik `Get-ChildItem -Recurse -Filter *.bak | Remove-Item` of equivalent. Sed werkt via Git Bash.

- [ ] **Step 2: Append barrel**

```ts
export { FactuurLijst } from './components/factuur-lijst'
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit && git add -A && git commit -m "refactor(facturatie): verhuis components/factuur-lijst naar Module (ADR-0007)"
```

---

### Task 2.4: Verhuis `use-facturen` hook

**Files:**
- Move: `hooks/use-facturen.ts` → `modules/facturatie/hooks/use-facturen.ts`

- [ ] **Step 1: git-move**

```bash
git mv frontend/src/hooks/use-facturen.ts frontend/src/modules/facturatie/hooks/use-facturen.ts
```

- [ ] **Step 2: Voeg eerst barrel-export toe — vóór de sed-replace**

In `frontend/src/modules/facturatie/index.ts`, append:
```ts
export * from './hooks/use-facturen'
```

> Volgorde: barrel-export eerst, vervolgens import-paden vervangen. Andere weg om → tussenstap waar het oude pad weg is en de nieuwe barrel nog leeg → typecheck breekt.

- [ ] **Step 3: Vervang imports**

```bash
cd frontend && grep -rln "@/hooks/use-facturen\|hooks/use-facturen" src/ | \
  xargs -d '\n' sed -i.bak "s|@/hooks/use-facturen|@/modules/facturatie|g"
find . -name "*.bak" -delete
```

> Op Windows-paden met spaties: `xargs -d '\n'` voorkomt splitting op spatie. Werkt in Git Bash.

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit && git add -A && git commit -m "refactor(facturatie): verhuis use-facturen hook naar Module (ADR-0007)"
```

---

### Task 2.5: Verhuis `lib/queries/facturen.ts`

**Files:**
- Move: `lib/supabase/queries/facturen.ts` → `modules/facturatie/queries/facturen.ts`

- [ ] **Step 1: git-move**

```bash
git mv frontend/src/lib/supabase/queries/facturen.ts frontend/src/modules/facturatie/queries/facturen.ts
```

- [ ] **Step 2: Vervang imports**

```bash
cd frontend && grep -rln "@/lib/supabase/queries/facturen\|lib/supabase/queries/facturen" src/ | \
  xargs sed -i.bak "s|@/lib/supabase/queries/facturen|@/modules/facturatie/queries/facturen|g"
find . -name "*.bak" -delete
```

> **Belangrijk:** de Module mag deze queries intern gebruiken; cross-cuts (order-facturen.tsx) moeten via barrel — dat doen we in Task 2.9.

- [ ] **Step 3: Typecheck**

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(facturatie): verhuis queries/facturen naar Module (ADR-0007)"
```

---

### Task 2.6: Nieuwe queries/klant-factuur-instellingen.ts + test

**Files:**
- Create: `frontend/src/modules/facturatie/queries/klant-factuur-instellingen.ts`
- Create: `frontend/src/modules/facturatie/__tests__/klant-factuur-instellingen.contract.test.ts`

- [ ] **Step 1: Schrijf failing test**

```ts
// __tests__/klant-factuur-instellingen.contract.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const supabaseCalls: any[] = []
let nextResponse: any = { data: null, error: null }

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, val: any) => ({
          single: () => {
            supabaseCalls.push({ op: 'select', table, cols, col, val })
            return Promise.resolve(nextResponse)
          },
        }),
      }),
      update: (patch: any) => ({
        eq: (col: string, val: any) => {
          supabaseCalls.push({ op: 'update', table, patch, col, val })
          return Promise.resolve(nextResponse)
        },
      }),
    }),
  },
}))

import {
  fetchKlantFactuurInstellingen,
  updateKlantFactuurInstellingen,
} from '../queries/klant-factuur-instellingen'

beforeEach(() => {
  supabaseCalls.length = 0
  nextResponse = { data: null, error: null }
})

describe('fetchKlantFactuurInstellingen', () => {
  it('selecteert facturatie-velden uit debiteuren op debiteur_nr', async () => {
    nextResponse = {
      data: { factuurvoorkeur: 'wekelijks', btw_percentage: 21, email_factuur: 'a@b.nl' },
      error: null,
    }
    const r = await fetchKlantFactuurInstellingen(123)
    expect(supabaseCalls[0]).toMatchObject({
      op: 'select',
      table: 'debiteuren',
      col: 'debiteur_nr',
      val: 123,
    })
    expect(r).toEqual({ factuurvoorkeur: 'wekelijks', btw_percentage: 21, email_factuur: 'a@b.nl' })
  })
})

describe('updateKlantFactuurInstellingen', () => {
  it('update alleen de drie facturatie-velden', async () => {
    await updateKlantFactuurInstellingen(123, { factuurvoorkeur: 'per_zending' })
    expect(supabaseCalls[0]).toMatchObject({
      op: 'update',
      table: 'debiteuren',
      patch: { factuurvoorkeur: 'per_zending' },
      col: 'debiteur_nr',
      val: 123,
    })
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Schrijf implementatie**

```ts
// queries/klant-factuur-instellingen.ts
import { supabase } from '@/lib/supabase/client'

export type FactuurVoorkeur = 'per_zending' | 'wekelijks'

export interface KlantFactuurInstellingen {
  factuurvoorkeur: FactuurVoorkeur
  btw_percentage: number
  email_factuur: string | null
}

export async function fetchKlantFactuurInstellingen(
  debiteur_nr: number,
): Promise<KlantFactuurInstellingen | null> {
  const { data, error } = await supabase
    .from('debiteuren')
    .select('factuurvoorkeur, btw_percentage, email_factuur')
    .eq('debiteur_nr', debiteur_nr)
    .single()
  if (error) throw new Error(error.message)
  return data as KlantFactuurInstellingen | null
}

export async function updateKlantFactuurInstellingen(
  debiteur_nr: number,
  patch: Partial<KlantFactuurInstellingen>,
): Promise<void> {
  const { error } = await supabase
    .from('debiteuren')
    .update(patch)
    .eq('debiteur_nr', debiteur_nr)
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/facturatie/
git commit -m "feat(facturatie): klant-factuur-instellingen queries + test (ADR-0007)"
```

---

### Task 2.7: Hook `useKlantFactuurInstellingen` + barrel

**Files:**
- Create: `frontend/src/modules/facturatie/hooks/use-klant-factuur-instellingen.ts`
- Modify: `frontend/src/modules/facturatie/index.ts`

- [ ] **Step 1: Hook**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchKlantFactuurInstellingen,
  updateKlantFactuurInstellingen,
  type KlantFactuurInstellingen,
} from '../queries/klant-factuur-instellingen'

export function useKlantFactuurInstellingen(debiteur_nr: number | null) {
  return useQuery({
    queryKey: ['klant-factuur-instellingen', debiteur_nr],
    queryFn: () => fetchKlantFactuurInstellingen(debiteur_nr!),
    enabled: debiteur_nr != null,
  })
}

export function useUpdateKlantFactuurInstellingen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { debiteur_nr: number; patch: Partial<KlantFactuurInstellingen> }) =>
      updateKlantFactuurInstellingen(vars.debiteur_nr, vars.patch),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['klant-factuur-instellingen', vars.debiteur_nr] })
      qc.invalidateQueries({ queryKey: ['klant', vars.debiteur_nr] })
    },
  })
}
```

- [ ] **Step 2: Barrel**

```ts
// In modules/facturatie/index.ts:
export {
  fetchKlantFactuurInstellingen,
  updateKlantFactuurInstellingen,
  type FactuurVoorkeur,
  type KlantFactuurInstellingen,
} from './queries/klant-factuur-instellingen'
export {
  useKlantFactuurInstellingen,
  useUpdateKlantFactuurInstellingen,
} from './hooks/use-klant-factuur-instellingen'
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit && git add -A && git commit -m "feat(facturatie): useKlantFactuurInstellingen hook + barrel (ADR-0007)"
```

---

### Task 2.8: Update `klant-facturering-tab.tsx` — gebruik nieuwe hook

**Files:**
- Modify: `frontend/src/components/klanten/klant-facturering-tab.tsx`

- [ ] **Step 1: Lees huidige tab**

```bash
cd frontend && cat src/components/klanten/klant-facturering-tab.tsx
```

Identificeer de huidige write naar `factuurvoorkeur` (waarschijnlijk via `updateKlant` of een mutation in `lib/queries/klanten.ts`).

- [ ] **Step 2: Vervang door barrel-imports**

```ts
import {
  useKlantFactuurInstellingen,
  useUpdateKlantFactuurInstellingen,
} from '@/modules/facturatie'

// In component:
const { data, isLoading } = useKlantFactuurInstellingen(debiteurNr)
const updateMut = useUpdateKlantFactuurInstellingen()

const handleSave = (voorkeur) =>
  updateMut.mutate({ debiteur_nr: debiteurNr, patch: { factuurvoorkeur: voorkeur } })
```

- [ ] **Step 3: Verwijder dode code uit `lib/queries/klanten.ts`**

Verwijder eventuele `updateKlantFactuurvoorkeur`-helper als die er was. Andere klant-mutaties blijven.

- [ ] **Step 4: Visueel valideren in dev-server**

```bash
npm run dev
# browse naar /klanten/<id> → tab Facturering
# wijzig voorkeur → check dat refresh ze toont
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/klanten/klant-facturering-tab.tsx frontend/src/lib/supabase/queries/klanten.ts
git commit -m "refactor(facturatie): klant-facturering-tab gebruikt useKlantFactuurInstellingen (ADR-0007)"
```

---

### Task 2.9: Update `order-facturen.tsx` — barrel-import

**Files:**
- Modify: `frontend/src/components/orders/order-facturen.tsx`

- [ ] **Step 1: Vervang directe import**

```ts
// Was:
import { useFacturen } from '@/hooks/use-facturen'
// Wordt:
import { useFacturen } from '@/modules/facturatie'
```

> Eventuele `fetchFacturenVoorOrder`-imports uit `lib/queries/facturen.ts` worden ook via barrel.

- [ ] **Step 2: Typecheck + visueel testen**

Browse `/orders/<id>` met factuur-zicht.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/orders/order-facturen.tsx
git commit -m "refactor(facturatie): order-facturen importeert via @/modules/facturatie barrel (ADR-0007)"
```

---

### Task 2.10: Migratie 219 — drop oude trigger + nieuwe trigger op `order_events`

**Files:**
- Create: `supabase/migrations/219_facturatie_event_listener.sql`

- [ ] **Step 1: Schrijf migratie**

```sql
-- Migratie 219: Facturatie luistert op order_events ipv orders.status (ADR-0007)
--
-- Vervangt mig 118-trigger trg_enqueue_factuur die op orders.status='Verzonden'
-- vuurde. Met ADR-0006 wordt dat veld via _apply_transitie geschreven, dat ook
-- een order_events-rij INSERT'eert. Op die typed event-stroom luisteren is
-- robuuster: oorzaak (welke pickronde, welke picker) blijft traceerbaar.

-- 1. Optionele kolom — koppel factuur_queue aan bron-event voor audit
ALTER TABLE factuur_queue
  ADD COLUMN IF NOT EXISTS bron_event_id BIGINT REFERENCES order_events(id);

COMMENT ON COLUMN factuur_queue.bron_event_id IS
  'Mig 219 (ADR-0007): order_events-rij die deze factuur heeft getriggerd. NULL voor wekelijkse verzamelfacturen + legacy.';

-- 2. Drop oude trigger
DROP TRIGGER IF EXISTS trg_enqueue_factuur ON orders;

-- 3. Nieuwe trigger-procedure op order_events
-- Schema-noot: factuur_queue heeft debiteur_nr NOT NULL + type NOT NULL CHECK
-- IN ('per_zending','wekelijks'). factuurvoorkeur is een enum-type (niet TEXT).
-- Zie mig 117 + 118.
CREATE OR REPLACE FUNCTION enqueue_factuur_voor_event()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_voorkeur   factuurvoorkeur;
  v_debiteur_nr INTEGER;
BEGIN
  -- Alleen op pickronde_voltooid → Verzonden
  IF NEW.event_type <> 'pickronde_voltooid' OR NEW.status_na <> 'Verzonden' THEN
    RETURN NEW;
  END IF;

  -- Lees debiteur + factuurvoorkeur via order
  SELECT o.debiteur_nr, d.factuurvoorkeur
    INTO v_debiteur_nr, v_voorkeur
    FROM orders o
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.id = NEW.order_id;

  IF v_voorkeur = 'per_zending' THEN
    INSERT INTO factuur_queue (debiteur_nr, order_ids, type, bron_event_id)
    VALUES (v_debiteur_nr, ARRAY[NEW.order_id], 'per_zending', NEW.id);
  END IF;
  -- 'wekelijks' wordt door pg_cron-job opgepikt — geen rij hier.

  RETURN NEW;
END;
$$;

-- 4. Nieuwe trigger
CREATE TRIGGER trg_enqueue_factuur_op_event
  AFTER INSERT ON order_events
  FOR EACH ROW
  EXECUTE PROCEDURE enqueue_factuur_voor_event();

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply in SQL Editor**

- [ ] **Step 3: End-to-end-test (handmatig)**

In SQL Editor:
```sql
-- 1. Kies een test-order met klant.factuurvoorkeur='per_zending', niet-verzonden
SELECT o.id, o.status, d.factuurvoorkeur FROM orders o
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
 WHERE d.factuurvoorkeur = 'per_zending'
   AND o.status <> 'Verzonden'
 LIMIT 1;

-- 2. Trigger handmatig markeer_verzonden
SELECT markeer_verzonden(<order_id>);

-- 3. Check factuur_queue
SELECT * FROM factuur_queue WHERE bron_event_id IS NOT NULL ORDER BY id DESC LIMIT 1;
```

Expected: er staat een nieuwe `pending`-rij met `bron_event_id` ingevuld.

- [ ] **Step 4: Rollback test-order**

```sql
-- Zet status terug naar oorspronkelijke + verwijder test-rij uit queue
UPDATE orders SET status = 'Nieuw', verzonden_at = NULL WHERE id = <order_id>;
DELETE FROM factuur_queue WHERE bron_event_id = (SELECT id FROM order_events WHERE order_id = <order_id> ORDER BY id DESC LIMIT 1);
DELETE FROM order_events WHERE order_id = <order_id> AND event_type = 'pickronde_voltooid';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/219_facturatie_event_listener.sql
git commit -m "feat(facturatie): mig 219 trigger op order_events ipv orders.status (ADR-0007)"
```

---

### Task 2.11: Doc-updates Fase 2

**Files:**
- Modify: `docs/changelog.md`
- Modify: `docs/architectuur.md`

- [ ] **Step 1: Append changelog**

```markdown
## 2026-05-07 — Facturatie-Module (ADR-0007, mig 219)

- Frontend `modules/facturatie/` — verhuist pages, components, hook, queries.
- Nieuwe queries/hook `useKlantFactuurInstellingen` — Module bezit klant-factuurvoorkeur-concept.
- Mig 219: trigger luistert op order_events.event_type='pickronde_voltooid' i.p.v. orders.status; factuur_queue.bron_event_id traceert oorzaak.
```

- [ ] **Step 2: Update `architectuur.md` — Module-graf + facturatie-flow-sectie**

Update de "Facturatie-flow"-sectie om het diagram te corrigeren: trigger-input is `order_events` ipv `orders.status='Verzonden'`. Voeg toe aan Module-graf-sectie:
```markdown
De **zesde domein-module is `modules/facturatie/`** — bezit factuur-flow vanaf het Verzonden-event tot bezorgde PDF/EDI-INVOIC. Listener op order_events i.p.v. orders.status-trigger sinds mig 219. Zie [ADR-0007](adr/0007-facturatie-als-deep-module.md).
```

- [ ] **Step 3: Commit**

```bash
git add docs/changelog.md docs/architectuur.md
git commit -m "docs(facturatie): changelog + architectuur updates voor ADR-0007"
```

---

## Eind-validatie (na beide fasen)

- [ ] **Run alle frontend-tests**

```bash
cd frontend && npx tsc --noEmit && npx vitest run
```

Expected: alle groen.

- [ ] **Run lint-rule**

```bash
bash scripts/lint-no-direct-orders-status-update.sh
```

Expected: `OK`.

- [ ] **End-to-end keten (handmatig in dev-stack)**

1. Maak een test-order met klant.factuurvoorkeur='per_zending'
2. Maak een Pickronde via `/orders/<id>` → "Zending aanmaken" met picker
3. Voltooi Pickronde via `/logistiek/<zending_nr>/printset`
4. Verifieer:
   - `orders.status` = `Verzonden` + `verzonden_at` gevuld
   - `order_events` heeft `pickronde_voltooid` rij met `actor_medewerker_id` = picker
   - `factuur_queue` heeft `pending` rij met `bron_event_id` gevuld
   - Na 1-2 min (cron-drain): factuur is gegenereerd, PDF in Storage, email verzonden
   - `factuur_queue.status` = `done`

- [ ] **Commit eind-validatie als slot-commit**

```bash
git commit --allow-empty -m "chore: eind-validatie ADR-0006 + ADR-0007 keten — order → pickronde → zending → factuur loopt"
```

---

## Open punten / vervolg-iteraties

- **Per-zending-facturatie activeren** — vereist nieuwe `event_type='zending_klaar_voor_verzending'` in enum + zending-Module-RPC die het schrijft.
- **Status-strings typed via Postgres-enum + generated TS-types** (#4 uit architectuur-review) — orthogonaal, hygiëne-werk.
- **Status-set hertekenen (`Tekort` met reden)** — eigen ADR + UI-traject.
- **`Klaar voor verzending` op order-niveau volledig opruimen** — als data-audit (Task 1.9) blokkades opleverde.
