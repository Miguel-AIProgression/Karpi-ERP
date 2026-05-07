# Pickronde Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Splits het impliciete "verzendset-klik = pick-afgerond"-moment in twee stappen — zending start in `Picken`, voltooi-knop flipt naar `Klaar voor verzending`. Operator kan per colli aangeven "niet gevonden" met escalatie- of split-pad.

**Architecture:** Pickronde leeft in de **Magazijn-Module** als concept zonder eigen tabel. Status wordt vastgelegd in bestaande `zendingen.status` (enum-waardes `Picken` en `Klaar voor verzending` zijn al beschikbaar sinds mig 169). Per-colli pick-uitkomst landt op `zending_colli` (mig 209) via drie nieuwe kolommen. Drie smalle RPC's vormen het contract — bestaande HST-/EDI-trigger blijft ongemoeid en vuurt automatisch op het juiste moment. Zie [ADR-0003](../../adr/0003-pickronde-als-deepening-van-magazijn-module.md).

**Tech Stack:** Postgres (Supabase), React 18 + TypeScript + Vite, TanStack Query, TailwindCSS, Vitest (contract tests met fake-Supabase-client).

---

## Bestandsoverzicht

### Nieuwe bestanden

| Pad | Verantwoordelijkheid |
|---|---|
| `supabase/migrations/211_pickronde.sql` | Schema-mutaties + drie RPCs |
| `frontend/src/modules/magazijn/queries/pickronde.ts` | TS-wrappers rond drie RPCs + colli-fetch |
| `frontend/src/modules/magazijn/hooks/use-pickronde.ts` | TanStack Query mutations + invalidation |
| `frontend/src/modules/magazijn/pages/pick-problemen.tsx` | Werklijst voor magazijnchef bij `niet_gevonden` |
| `frontend/src/modules/magazijn/__tests__/pickronde.contract.test.ts` | Contract tests voor de drie RPC-wrappers |
| `frontend/src/modules/logistiek/components/voltooi-pickronde-knop.tsx` | Knop op printset-pagina, consumeert magazijn-hook |
| `frontend/src/modules/logistiek/components/colli-pick-vinkjes.tsx` | Vinkjes-lijst + niet-gevonden-dialog |

### Te wijzigen bestanden

| Pad | Wijziging |
|---|---|
| `frontend/src/modules/magazijn/index.ts` | Barrel-export: `useVoltooiPickronde`, `useMarkeerColliNietGevonden`, `usePickProblemen` |
| `frontend/src/modules/logistiek/pages/zending-printset.tsx` | Render `<ColliPickVinkjes>` + `<VoltooiPickrondeKnop>` |
| `frontend/src/modules/logistiek/pages/zendingen-overzicht.tsx` | Default-filter `status >= 'Klaar voor verzending'`, "Picken"-pil toevoegen |
| `frontend/src/modules/logistiek/components/verzendset-button.tsx` | Label/tooltip-update ("Start pickronde") |
| `frontend/src/router.tsx` | Route `/magazijn/pick-problemen` |
| `docs/changelog.md` | Entry voor mig 211 + Pickronde |

### Test-strategie

- **SQL-RPCs**: contract tests in TypeScript via fake-Supabase-client (zelfde pattern als [`magazijn-pickbaarheid.contract.test.ts`](../../frontend/src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts)). Documenteert RPC-naam, args, response-shape. SQL-correctheid wordt door de user op staging gevalideerd na migratie-apply (Karpi-MCP heeft geen toegang).
- **Frontend-componenten**: vitest + @testing-library/react voor `<ColliPickVinkjes>` (vinkjes-defaults, dialog-flow). Voor `<VoltooiPickrondeKnop>` alleen disabled-state-tests (de mutation zelf wordt door contract test gedekt).

---

> **Migratie-bouw verloopt incrementeel.** Tasks 1-4 schrijven elk een blok naar `211_pickronde.sql` met een aparte commit. Het bestand is pas een geldige, applicabele migratie ná Task 4. Apply op staging gebeurt in Task 4 step 3.

## Task 1: Migratie 211 — schema-mutaties

**Files:**
- Create: `supabase/migrations/211_pickronde.sql`

- [ ] **Step 1: Schrijf de migratie-header en enum-mutatie**

```sql
-- Migratie 211: Pickronde — pick-uitkomst per colli + status-default 'Picken'
--
-- Achtergrond: zie ADR-0003. create_zending_voor_order zette zendingen direct
-- op 'Klaar voor verzending', wat de HST-dispatch-trigger te vroeg activeerde.
-- Deze migratie:
--   1. Voegt enum `pick_uitkomst` + 3 kolommen toe aan zending_colli
--   2. Wijzigt create_zending_voor_order zodat zending in 'Picken' start
--   3. Introduceert drie RPCs: start_pickronde, markeer_colli_niet_gevonden,
--      voltooi_pickronde
--
-- Bestaande zendingen (status NIET 'Picken') zijn niet retroactief gemigreerd
-- — die hebben al geen Pickronde-flow nodig.
--
-- Idempotent.

DO $$ BEGIN
  CREATE TYPE pick_uitkomst AS ENUM ('open', 'gepickt', 'niet_gevonden');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE zending_colli
  ADD COLUMN IF NOT EXISTS pick_uitkomst pick_uitkomst NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS pick_opmerking TEXT,
  ADD COLUMN IF NOT EXISTS gepickt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_zending_colli_pick_uitkomst
  ON zending_colli (zending_id, pick_uitkomst);

COMMENT ON COLUMN zending_colli.pick_uitkomst IS
  'Per-colli uitkomst tijdens Pickronde. Default ''open''. Bij voltooi_pickronde '
  'worden alle ''open''-rijen automatisch op ''gepickt'' gezet (vinkjes-default-aan).';
COMMENT ON COLUMN zending_colli.pick_opmerking IS
  'Operator-notitie bij niet_gevonden (waarom kon dit niet gevonden worden).';
COMMENT ON COLUMN zending_colli.gepickt_at IS
  'Moment van voltooi_pickronde. NULL zolang colli niet gepickt is.';
```

- [ ] **Step 2: Commit (alleen schema, RPCs in volgende tasks)**

```bash
git add supabase/migrations/211_pickronde.sql
git commit -m "feat(pickronde): mig 211 schema — pick_uitkomst enum + zending_colli kolommen"
```

---

## Task 2: Migratie 211 — `start_pickronde` RPC

**Files:**
- Modify: `supabase/migrations/211_pickronde.sql`

- [ ] **Step 1: Append `start_pickronde`-RPC aan migratie**

```sql
-- ============================================================================
-- start_pickronde: vervangt de oude semantiek van create_zending_voor_order.
-- Maakt zending aan in status 'Picken' (niet meer 'Klaar voor verzending'),
-- genereert colli-rijen via genereer_zending_colli, returnt zending_id.
-- Idempotent: bestaande open zending voor de order wordt hergebruikt.
-- ============================================================================
CREATE OR REPLACE FUNCTION start_pickronde(p_order_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_zending_id     BIGINT;
  v_zending_status zending_status;
  v_zending_nr     TEXT;
  v_order          orders%ROWTYPE;
BEGIN
  SELECT id, status INTO v_zending_id, v_zending_status FROM zendingen
   WHERE order_id = p_order_id
     AND status NOT IN ('Afgeleverd')
   ORDER BY id DESC LIMIT 1;

  IF v_zending_id IS NOT NULL THEN
    -- Bestaande zending: zorg dat colli's bestaan en update aggregaten.
    PERFORM genereer_zending_colli(v_zending_id);

    UPDATE zendingen
       SET aantal_colli = COALESCE(aantal_colli, (
             SELECT COALESCE(SUM(COALESCE(ore.orderaantal, 0)), 0)::INTEGER
               FROM order_regels ore
              WHERE ore.order_id = p_order_id
                AND COALESCE(ore.artikelnr, '') <> 'VERZEND'
           )),
           totaal_gewicht_kg = COALESCE(totaal_gewicht_kg, (
             SELECT NULLIF(
               ROUND(COALESCE(SUM(COALESCE(ore.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0), 2),
               0
             )
               FROM order_regels ore
              WHERE ore.order_id = p_order_id
                AND COALESCE(ore.artikelnr, '') <> 'VERZEND'
           ))
     WHERE id = v_zending_id;

    -- Zending al doorgestroomd? Dan dispatch (mig 206-gedrag behouden).
    IF v_zending_status = 'Klaar voor verzending' THEN
      PERFORM enqueue_zending_naar_vervoerder(v_zending_id);
    END IF;
    RETURN v_zending_id;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr, order_id, status,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    verzenddatum, aantal_colli, totaal_gewicht_kg
  ) VALUES (
    v_zending_nr, p_order_id, 'Picken',  -- ← was 'Klaar voor verzending'
    v_order.afl_naam, v_order.afl_adres, v_order.afl_postcode, v_order.afl_plaats, v_order.afl_land,
    CURRENT_DATE,
    (SELECT COALESCE(SUM(COALESCE(ore.orderaantal, 0)), 0)::INTEGER
       FROM order_regels ore
      WHERE ore.order_id = p_order_id AND COALESCE(ore.artikelnr, '') <> 'VERZEND'),
    (SELECT NULLIF(ROUND(COALESCE(SUM(COALESCE(ore.gewicht_kg, 0) * COALESCE(ore.orderaantal, 0)), 0), 2), 0)
       FROM order_regels ore
      WHERE ore.order_id = p_order_id AND COALESCE(ore.artikelnr, '') <> 'VERZEND')
  ) RETURNING id INTO v_zending_id;

  INSERT INTO zending_regels (zending_id, order_regel_id, aantal)
  SELECT v_zending_id, ore.id, ore.orderaantal
    FROM order_regels ore
   WHERE ore.order_id = p_order_id
     AND COALESCE(ore.orderaantal, 0) > 0
     AND COALESCE(ore.artikelnr, '') <> 'VERZEND';

  -- Genereer SSCC-colli's voor de zending. HST-dispatch vuurt NIET op 'Picken' —
  -- pas bij voltooi_pickronde flipt de status en wordt enqueue_… aangeroepen.
  PERFORM genereer_zending_colli(v_zending_id);
  RETURN v_zending_id;
END;
$$;

GRANT EXECUTE ON FUNCTION start_pickronde(BIGINT) TO authenticated;

COMMENT ON FUNCTION start_pickronde IS
  'Start een Pickronde voor een order: maakt zending in status ''Picken'' aan + '
  'genereert colli-rijen. Idempotent. Dispatch naar vervoerder vuurt PAS op '
  'voltooi_pickronde. Bestaande open zending wordt hergebruikt.';

-- Backwards-compat alias: bestaande callers (zending-aanmaken-knop op
-- order-detail) blijven werken. Verwijderen kan later in een aparte migratie.
CREATE OR REPLACE FUNCTION create_zending_voor_order(p_order_id BIGINT)
RETURNS BIGINT
LANGUAGE sql AS $$
  SELECT start_pickronde(p_order_id);
$$;

GRANT EXECUTE ON FUNCTION create_zending_voor_order(BIGINT) TO authenticated;

COMMENT ON FUNCTION create_zending_voor_order IS
  'Mig 211: alias voor start_pickronde. Behouden voor bestaande callers (zending-'
  'aanmaken-knop op order-detail). Nieuwe code roept start_pickronde direct aan.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/211_pickronde.sql
git commit -m "feat(pickronde): mig 211 — start_pickronde RPC + alias create_zending_voor_order"
```

---

## Task 3: Migratie 211 — `markeer_colli_niet_gevonden` RPC

**Files:**
- Modify: `supabase/migrations/211_pickronde.sql`

- [ ] **Step 1: Append `markeer_colli_niet_gevonden`-RPC**

```sql
-- ============================================================================
-- markeer_colli_niet_gevonden: operator markeert één colli als niet vindbaar.
-- Twee modi:
--   'blokkeer' — colli krijgt pick_uitkomst='niet_gevonden'. Zending blijft in
--                'Picken'. Verschijnt op pick-problemen-werklijst voor chef.
--   'splits'   — colli wordt losgekoppeld (zending_regels-aantal verlaagd of
--                row verwijderd). Vereist orders.lever_modus = 'deelleveringen'.
--                Orderregel blijft open in de order voor latere Pickronde.
-- ============================================================================
CREATE OR REPLACE FUNCTION markeer_colli_niet_gevonden(
  p_zending_colli_id BIGINT,
  p_modus            TEXT,
  p_opmerking        TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_zending_id    BIGINT;
  v_order_id      BIGINT;
  v_lever_modus   TEXT;
  v_zending_st    zending_status;
  v_order_regel_id BIGINT;
BEGIN
  IF p_modus NOT IN ('blokkeer', 'splits') THEN
    RAISE EXCEPTION 'modus moet ''blokkeer'' of ''splits'' zijn (kreeg %)', p_modus;
  END IF;

  SELECT zc.zending_id, zc.order_regel_id, z.status, z.order_id
    INTO v_zending_id, v_order_regel_id, v_zending_st, v_order_id
    FROM zending_colli zc
    JOIN zendingen z ON z.id = zc.zending_id
   WHERE zc.id = p_zending_colli_id;

  IF v_zending_id IS NULL THEN
    RAISE EXCEPTION 'zending_colli % bestaat niet', p_zending_colli_id;
  END IF;

  IF v_zending_st <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde voor zending % is niet actief (status=%)', v_zending_id, v_zending_st;
  END IF;

  IF p_modus = 'blokkeer' THEN
    UPDATE zending_colli
       SET pick_uitkomst   = 'niet_gevonden',
           pick_opmerking  = p_opmerking,
           gepickt_at      = NULL
     WHERE id = p_zending_colli_id;
    RETURN;
  END IF;

  -- p_modus = 'splits': vereist deelleveringen.
  SELECT lever_modus INTO v_lever_modus FROM orders WHERE id = v_order_id;
  IF v_lever_modus IS DISTINCT FROM 'deelleveringen' THEN
    RAISE EXCEPTION 'Splitsen vereist order.lever_modus=''deelleveringen'' (was %)', v_lever_modus;
  END IF;

  -- Verlaag aantal op zending_regels; verwijder regel-rij als aantal=0.
  UPDATE zending_regels
     SET aantal = aantal - 1
   WHERE zending_id = v_zending_id
     AND order_regel_id = v_order_regel_id
     AND aantal > 0;

  DELETE FROM zending_regels
   WHERE zending_id = v_zending_id
     AND order_regel_id = v_order_regel_id
     AND COALESCE(aantal, 0) = 0;

  -- Verwijder de colli-rij zelf (CASCADE zorgt voor schoonmaken refs).
  DELETE FROM zending_colli WHERE id = p_zending_colli_id;

  -- Sync aantal_colli op zending.
  UPDATE zendingen
     SET aantal_colli = (SELECT COUNT(*) FROM zending_colli WHERE zending_id = v_zending_id)
   WHERE id = v_zending_id;

  -- NB: order_regels.te_leveren wordt NIET hier aangepast — dat veld leeft op
  -- de orderregel en wordt beheerd door de bestaande shipment-status-pipeline
  -- (eerstvolgende `start_pickronde` voor dezelfde order pakt het op).
  -- Indien op staging blijkt dat de orderregel niet automatisch terugkomt op
  -- de pick-card, voeg dan een herallocatie-call toe (volg-issue, niet V1).
END;
$$;

GRANT EXECUTE ON FUNCTION markeer_colli_niet_gevonden(BIGINT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION markeer_colli_niet_gevonden IS
  'Markeert één colli als niet gevonden tijdens Pickronde. modus=''blokkeer'' '
  'houdt zending in ''Picken''; ''splits'' verwijdert colli (vereist '
  'lever_modus=''deelleveringen''). Niet bruikbaar als pickronde voltooid is.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/211_pickronde.sql
git commit -m "feat(pickronde): mig 211 — markeer_colli_niet_gevonden RPC met blokkeer/splits"
```

---

## Task 4: Migratie 211 — `voltooi_pickronde` RPC

**Files:**
- Modify: `supabase/migrations/211_pickronde.sql`

- [ ] **Step 1: Append `voltooi_pickronde`-RPC**

```sql
-- ============================================================================
-- voltooi_pickronde: flipt zending van 'Picken' → 'Klaar voor verzending'.
-- Default-flow: alle pick_uitkomst='open' colli's worden automatisch op
-- 'gepickt' gezet (vinkjes-default-aan — operator hoeft alleen uitzonderingen
-- actief te markeren). Guard: GEEN colli's met pick_uitkomst='niet_gevonden'
-- mogen nog open staan.
--
-- De bestaande trg_zending_klaar_voor_verzending vuurt automatisch op de
-- status-overgang en regelt HST-dispatch.
-- ============================================================================
CREATE OR REPLACE FUNCTION voltooi_pickronde(p_zending_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig zending_status;
  v_aantal_niet_gevonden INTEGER;
BEGIN
  SELECT status INTO v_huidig FROM zendingen WHERE id = p_zending_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;
  IF v_huidig <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde voor zending % is niet actief (status=%)', p_zending_id, v_huidig;
  END IF;

  -- Guard: openstaande pick-problemen blokkeren voltooiing.
  SELECT COUNT(*) INTO v_aantal_niet_gevonden
    FROM zending_colli
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'niet_gevonden';

  IF v_aantal_niet_gevonden > 0 THEN
    RAISE EXCEPTION 'Pickronde heeft % openstaand(e) pick-probleem(en) — los op of splits eerst',
      v_aantal_niet_gevonden
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Default-aan: alle 'open' colli's worden 'gepickt'.
  UPDATE zending_colli
     SET pick_uitkomst = 'gepickt',
         gepickt_at    = now()
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'open';

  -- Status-flip → bestaande trigger trg_zending_klaar_voor_verzending vuurt.
  UPDATE zendingen
     SET status = 'Klaar voor verzending'
   WHERE id = p_zending_id;

  RETURN p_zending_id;
END;
$$;

GRANT EXECUTE ON FUNCTION voltooi_pickronde(BIGINT) TO authenticated;

COMMENT ON FUNCTION voltooi_pickronde IS
  'Sluit Pickronde af. Zet alle ''open''-colli''s op ''gepickt'' en flipt zending '
  'naar ''Klaar voor verzending''. Faalt als er ''niet_gevonden''-colli''s '
  'openstaan. Bestaande HST-trigger pakt dispatch op via status-overgang.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/211_pickronde.sql
git commit -m "feat(pickronde): mig 211 — voltooi_pickronde RPC met niet-gevonden-guard"
```

- [ ] **Step 3: User past migratie 211 toe op staging Supabase**

User actie (geen agent-step): open Supabase Dashboard → SQL Editor → plak inhoud van `supabase/migrations/211_pickronde.sql` → Run. Verifieer: `SELECT proname FROM pg_proc WHERE proname IN ('start_pickronde','markeer_colli_niet_gevonden','voltooi_pickronde');` returnt 3 regels.

---

## Task 5: TS-wrappers in `queries/pickronde.ts`

**Files:**
- Create: `frontend/src/modules/magazijn/queries/pickronde.ts`
- Test: `frontend/src/modules/magazijn/__tests__/pickronde.contract.test.ts`

- [ ] **Step 1: Schrijf falende contract tests**

```typescript
// frontend/src/modules/magazijn/__tests__/pickronde.contract.test.ts
//
// Contract tests voor de drie Pickronde-RPC-wrappers. Documenteert RPC-naam,
// argument-shape en response-parsing — geen integratie met echte Supabase.
// Pattern overgenomen van magazijn-pickbaarheid.contract.test.ts.

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
  startPickronde,
  markeerColliNietGevonden,
  voltooiPickronde,
} from '../queries/pickronde'

beforeEach(() => {
  rpcCalls.length = 0
  nextRpcResponse = { data: null, error: null }
})

describe('startPickronde', () => {
  it('roept RPC start_pickronde aan met p_order_id en returnt het zending-id', async () => {
    nextRpcResponse = { data: 42, error: null }
    const id = await startPickronde(123)
    expect(rpcCalls).toEqual([{ fn: 'start_pickronde', args: { p_order_id: 123 } }])
    expect(id).toBe(42)
  })

  it('gooit fout met message van Supabase als RPC faalt', async () => {
    nextRpcResponse = { data: null, error: { message: 'Order bestaat niet' } }
    await expect(startPickronde(999)).rejects.toThrow('Order bestaat niet')
  })
})

describe('markeerColliNietGevonden', () => {
  it('blokkeer-modus zonder opmerking', async () => {
    await markeerColliNietGevonden({ colliId: 7, modus: 'blokkeer' })
    expect(rpcCalls).toEqual([{
      fn: 'markeer_colli_niet_gevonden',
      args: { p_zending_colli_id: 7, p_modus: 'blokkeer', p_opmerking: null },
    }])
  })

  it('splits-modus met opmerking', async () => {
    await markeerColliNietGevonden({ colliId: 8, modus: 'splits', opmerking: 'rol kwijt' })
    expect(rpcCalls).toEqual([{
      fn: 'markeer_colli_niet_gevonden',
      args: { p_zending_colli_id: 8, p_modus: 'splits', p_opmerking: 'rol kwijt' },
    }])
  })

  it('gooit fout met details bij splits-zonder-deelleveringen', async () => {
    nextRpcResponse = {
      data: null,
      error: { message: "Splitsen vereist order.lever_modus='deelleveringen'" },
    }
    await expect(
      markeerColliNietGevonden({ colliId: 9, modus: 'splits' })
    ).rejects.toThrow(/deelleveringen/)
  })
})

describe('voltooiPickronde', () => {
  it('roept RPC voltooi_pickronde aan met p_zending_id', async () => {
    nextRpcResponse = { data: 42, error: null }
    const id = await voltooiPickronde(42)
    expect(rpcCalls).toEqual([{ fn: 'voltooi_pickronde', args: { p_zending_id: 42 } }])
    expect(id).toBe(42)
  })

  it('gooit fout met restrict_violation-context bij openstaande problemen', async () => {
    nextRpcResponse = {
      data: null,
      error: { message: 'Pickronde heeft 2 openstaand(e) pick-probleem(en)', code: '23001' },
    }
    await expect(voltooiPickronde(42)).rejects.toThrow(/openstaand/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/modules/magazijn/__tests__/pickronde.contract.test.ts
```

Expected: FAIL — `Cannot find module '../queries/pickronde'`

- [ ] **Step 3: Implementeer de wrappers**

```typescript
// frontend/src/modules/magazijn/queries/pickronde.ts
import { supabase } from '@/lib/supabase/client'

export type NietGevondenModus = 'blokkeer' | 'splits'

export interface MarkeerNietGevondenArgs {
  colliId: number
  modus: NietGevondenModus
  opmerking?: string | null
}

export async function startPickronde(orderId: number): Promise<number> {
  const { data, error } = await supabase.rpc('start_pickronde', { p_order_id: orderId })
  if (error) throw toError(error, 'Pickronde starten mislukt')
  return Number(data)
}

export async function markeerColliNietGevonden(
  args: MarkeerNietGevondenArgs
): Promise<void> {
  const { error } = await supabase.rpc('markeer_colli_niet_gevonden', {
    p_zending_colli_id: args.colliId,
    p_modus: args.modus,
    p_opmerking: args.opmerking ?? null,
  })
  if (error) throw toError(error, 'Markeren niet-gevonden mislukt')
}

export async function voltooiPickronde(zendingId: number): Promise<number> {
  const { data, error } = await supabase.rpc('voltooi_pickronde', {
    p_zending_id: zendingId,
  })
  if (error) throw toError(error, 'Pickronde voltooien mislukt')
  return Number(data)
}

// Colli-fetch voor de pick-vinkjes-UI.
export interface PickColliRij {
  id: number
  colli_nr: number
  sscc: string | null
  pick_uitkomst: 'open' | 'gepickt' | 'niet_gevonden'
  pick_opmerking: string | null
  omschrijving_snapshot: string | null
}

export async function fetchColliVoorZending(zendingId: number): Promise<PickColliRij[]> {
  const { data, error } = await supabase
    .from('zending_colli')
    .select('id, colli_nr, sscc, pick_uitkomst, pick_opmerking, omschrijving_snapshot')
    .eq('zending_id', zendingId)
    .order('colli_nr', { ascending: true })

  if (error) throw toError(error, 'Colli ophalen mislukt')
  return (data ?? []) as PickColliRij[]
}

export interface PickProbleemRij {
  colli_id: number
  zending_id: number
  zending_nr: string
  order_nr: string
  klant_naam: string | null
  omschrijving_snapshot: string | null
  pick_opmerking: string | null
}

export async function fetchPickProblemen(): Promise<PickProbleemRij[]> {
  const { data, error } = await supabase
    .from('zending_colli')
    .select(`
      id, pick_opmerking, omschrijving_snapshot,
      zending_id,
      zendingen!inner (
        zending_nr, status,
        orders!inner (
          order_nr,
          debiteuren:debiteuren!orders_debiteur_nr_fkey ( naam )
        )
      )
    `)
    .eq('pick_uitkomst', 'niet_gevonden')
    .eq('zendingen.status', 'Picken')

  if (error) throw toError(error, 'Pick-problemen ophalen mislukt')
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as {
      id: number
      pick_opmerking: string | null
      omschrijving_snapshot: string | null
      zending_id: number
      zendingen: {
        zending_nr: string
        orders: { order_nr: string; debiteuren?: { naam: string | null } | null }
      }
    }
    return {
      colli_id: r.id,
      zending_id: r.zending_id,
      zending_nr: r.zendingen.zending_nr,
      order_nr: r.zendingen.orders.order_nr,
      klant_naam: r.zendingen.orders.debiteuren?.naam ?? null,
      omschrijving_snapshot: r.omschrijving_snapshot,
      pick_opmerking: r.pick_opmerking,
    }
  })
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    const parts = [obj.message, obj.details, obj.hint, obj.code]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    if (parts.length > 0) return new Error(`${fallback}: ${parts.join(' ')}`)
  }
  return new Error(`${fallback}: ${String(error)}`)
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd frontend && npx vitest run src/modules/magazijn/__tests__/pickronde.contract.test.ts
```

Expected: PASS — alle 6 tests groen.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/magazijn/queries/pickronde.ts \
        frontend/src/modules/magazijn/__tests__/pickronde.contract.test.ts
git commit -m "feat(pickronde): TS-wrappers + contract tests voor drie RPCs"
```

---

## Task 6: TanStack Query hooks

**Files:**
- Create: `frontend/src/modules/magazijn/hooks/use-pickronde.ts`
- Modify: `frontend/src/modules/magazijn/index.ts`

- [ ] **Step 1: Schrijf de hooks**

```typescript
// frontend/src/modules/magazijn/hooks/use-pickronde.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchColliVoorZending,
  fetchPickProblemen,
  markeerColliNietGevonden,
  startPickronde,
  voltooiPickronde,
  type MarkeerNietGevondenArgs,
} from '../queries/pickronde'

export function useColliVoorZending(zendingId: number | undefined) {
  return useQuery({
    queryKey: ['pickronde', 'colli', zendingId],
    queryFn: () => fetchColliVoorZending(zendingId!),
    enabled: zendingId != null,
    staleTime: 10_000,
  })
}

export function usePickProblemen() {
  return useQuery({
    queryKey: ['pickronde', 'problemen'],
    queryFn: fetchPickProblemen,
    staleTime: 30_000,
  })
}

export function useStartPickronde() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: number) => startPickronde(orderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickronde'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
      qc.invalidateQueries({ queryKey: ['zendingen'] })
    },
  })
}

export function useMarkeerColliNietGevonden() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: MarkeerNietGevondenArgs) => markeerColliNietGevonden(args),
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ['pickronde'] })
      // Bij splits verandert ook zending_regels en aantal_colli.
      if (args.modus === 'splits') {
        qc.invalidateQueries({ queryKey: ['zendingen'] })
        qc.invalidateQueries({ queryKey: ['pick-ship'] })
      }
    },
  })
}

export function useVoltooiPickronde() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (zendingId: number) => voltooiPickronde(zendingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickronde'] })
      qc.invalidateQueries({ queryKey: ['zendingen'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
    },
  })
}
```

- [ ] **Step 2: Update barrel-export**

Open `frontend/src/modules/magazijn/index.ts`. Voeg toe (na bestaande exports):

```typescript
export {
  useColliVoorZending,
  usePickProblemen,
  useStartPickronde,
  useMarkeerColliNietGevonden,
  useVoltooiPickronde,
} from './hooks/use-pickronde'

export type {
  PickColliRij,
  PickProbleemRij,
  NietGevondenModus,
  MarkeerNietGevondenArgs,
} from './queries/pickronde'
```

- [ ] **Step 3: Verifieer dat barrel-import werkt — typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS (geen TS-errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/magazijn/hooks/use-pickronde.ts \
        frontend/src/modules/magazijn/index.ts
git commit -m "feat(pickronde): TanStack hooks + barrel-export voor magazijn-module"
```

---

## Task 7: `<ColliPickVinkjes>`-component

Per-colli vinkjes-lijst met niet-gevonden-dialog. Default: alle vinkjes "aan" (= colli zal als gepickt worden voltooid). Operator klikt cross-button om colli te markeren als niet-gevonden.

**Files:**
- Create: `frontend/src/modules/logistiek/components/colli-pick-vinkjes.tsx`

- [ ] **Step 1: Implementeer component**

```typescript
// frontend/src/modules/logistiek/components/colli-pick-vinkjes.tsx
import { useState } from 'react'
import { CheckSquare, Square, AlertCircle, X } from 'lucide-react'
import {
  useColliVoorZending,
  useMarkeerColliNietGevonden,
  type NietGevondenModus,
  type PickColliRij,
} from '@/modules/magazijn'
import { cn } from '@/lib/utils/cn'

interface Props {
  zendingId: number
  /** order.lever_modus — bepaalt of 'splits'-optie beschikbaar is. */
  leverModus: 'deelleveringen' | 'in_een_keer' | null
}

export function ColliPickVinkjes({ zendingId, leverModus }: Props) {
  const { data: colli = [], isLoading } = useColliVoorZending(zendingId)
  const [dialogColli, setDialogColli] = useState<PickColliRij | null>(null)

  if (isLoading) return <div className="text-sm text-slate-500">Colli laden...</div>
  if (colli.length === 0) return null

  const aantalNietGevonden = colli.filter((c) => c.pick_uitkomst === 'niet_gevonden').length

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">Pick-status per colli</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Vinkjes zijn standaard aan. Markeer alleen colli's die je niet kunt vinden.
          </p>
        </div>
        {aantalNietGevonden > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-rose-600">
            <AlertCircle size={13} />
            {aantalNietGevonden} probleem
          </span>
        )}
      </div>
      <ul className="divide-y divide-slate-100">
        {colli.map((c) => (
          <ColliRij key={c.id} colli={c} onMarkeerNietGevonden={() => setDialogColli(c)} />
        ))}
      </ul>
      {dialogColli && (
        <NietGevondenDialog
          colli={dialogColli}
          leverModus={leverModus}
          onClose={() => setDialogColli(null)}
        />
      )}
    </div>
  )
}

function ColliRij({
  colli,
  onMarkeerNietGevonden,
}: {
  colli: PickColliRij
  onMarkeerNietGevonden: () => void
}) {
  const isGepickt = colli.pick_uitkomst === 'gepickt'
  const isOpen = colli.pick_uitkomst === 'open'
  const isNietGevonden = colli.pick_uitkomst === 'niet_gevonden'

  return (
    <li className="py-2 flex items-center gap-3">
      {isNietGevonden ? (
        <X size={18} className="text-rose-500 shrink-0" />
      ) : isGepickt ? (
        <CheckSquare size={18} className="text-emerald-500 shrink-0" />
      ) : (
        <Square size={18} className="text-slate-400 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className={cn('text-sm', isNietGevonden && 'text-rose-700 line-through')}>
          {colli.omschrijving_snapshot ?? `Colli ${colli.colli_nr}`}
        </div>
        {colli.sscc && (
          <div className="text-xs text-slate-400 font-mono">SSCC {colli.sscc}</div>
        )}
        {colli.pick_opmerking && (
          <div className="text-xs text-rose-600 mt-0.5">⚠ {colli.pick_opmerking}</div>
        )}
      </div>
      {!isNietGevonden && isOpen && (
        <button
          onClick={onMarkeerNietGevonden}
          className="text-xs text-slate-500 hover:text-rose-600"
        >
          Niet gevonden
        </button>
      )}
    </li>
  )
}

function NietGevondenDialog({
  colli,
  leverModus,
  onClose,
}: {
  colli: PickColliRij
  leverModus: 'deelleveringen' | 'in_een_keer' | null
  onClose: () => void
}) {
  const mutate = useMarkeerColliNietGevonden()
  const [opmerking, setOpmerking] = useState('')
  const [error, setError] = useState<string | null>(null)
  const splitsAllowed = leverModus === 'deelleveringen'

  async function submit(modus: NietGevondenModus) {
    setError(null)
    try {
      await mutate.mutateAsync({ colliId: colli.id, modus, opmerking: opmerking || null })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h3 className="text-lg font-semibold mb-2">Colli niet gevonden</h3>
        <p className="text-sm text-slate-600 mb-3">
          {colli.omschrijving_snapshot ?? `Colli ${colli.colli_nr}`}
        </p>
        <textarea
          value={opmerking}
          onChange={(e) => setOpmerking(e.target.value)}
          placeholder="Optionele opmerking voor de magazijnchef"
          rows={2}
          className="w-full text-sm rounded border border-slate-200 p-2 mb-3"
        />
        <div className="space-y-2">
          <button
            onClick={() => submit('blokkeer')}
            disabled={mutate.isPending}
            className="w-full text-left px-3 py-2 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 disabled:opacity-50"
          >
            <div className="font-medium text-sm">Blokkeer & escaleer</div>
            <div className="text-xs text-slate-600">
              Pickronde wacht tot magazijnchef het probleem oplost
            </div>
          </button>
          <button
            onClick={() => submit('splits')}
            disabled={mutate.isPending || !splitsAllowed}
            className="w-full text-left px-3 py-2 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
          >
            <div className="font-medium text-sm">Splits zending</div>
            <div className="text-xs text-slate-600">
              {splitsAllowed
                ? 'Verzend de overige colli\'s; deze regel blijft open in de order'
                : 'Niet beschikbaar — order.lever_modus is niet "deelleveringen"'}
            </div>
          </button>
        </div>
        {error && <div className="mt-2 text-xs text-rose-600">{error}</div>}
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="text-sm text-slate-600 hover:text-slate-900">
            Annuleer
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/logistiek/components/colli-pick-vinkjes.tsx
git commit -m "feat(pickronde): ColliPickVinkjes component met niet-gevonden-dialog"
```

---

## Task 8: `<VoltooiPickrondeKnop>`-component

**Files:**
- Create: `frontend/src/modules/logistiek/components/voltooi-pickronde-knop.tsx`

- [ ] **Step 1: Implementeer component**

```typescript
// frontend/src/modules/logistiek/components/voltooi-pickronde-knop.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, PackageCheck } from 'lucide-react'
import { useColliVoorZending, useVoltooiPickronde } from '@/modules/magazijn'

interface Props {
  zendingId: number
  zendingStatus: string
}

export function VoltooiPickrondeKnop({ zendingId, zendingStatus }: Props) {
  const navigate = useNavigate()
  const { data: colli = [] } = useColliVoorZending(zendingId)
  const mutate = useVoltooiPickronde()
  const [error, setError] = useState<string | null>(null)

  if (zendingStatus !== 'Picken') return null

  const aantalNietGevonden = colli.filter((c) => c.pick_uitkomst === 'niet_gevonden').length
  const disabled = mutate.isPending || aantalNietGevonden > 0

  async function handleClick() {
    setError(null)
    try {
      await mutate.mutateAsync(zendingId)
      navigate('/logistiek')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const tooltip = aantalNietGevonden > 0
    ? `Eerst ${aantalNietGevonden} pick-probleem oplossen (chef)`
    : 'Markeer alle colli als gepickt en stuur door naar verzending'

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={disabled}
        title={tooltip}
        className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {mutate.isPending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <PackageCheck size={14} />
        )}
        Voltooi pickronde
      </button>
      {error && <div className="max-w-72 text-right text-xs text-rose-600">{error}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/logistiek/components/voltooi-pickronde-knop.tsx
git commit -m "feat(pickronde): VoltooiPickrondeKnop met niet-gevonden-guard"
```

---

## Task 9: Printset-pagina krijgt vinkjes-blok + voltooi-knop

**Files:**
- Modify: `frontend/src/modules/logistiek/pages/zending-printset.tsx`

- [ ] **Step 1: Oriëntatie op huidige pagina**

Open [`frontend/src/modules/logistiek/pages/zending-printset.tsx`](../../frontend/src/modules/logistiek/pages/zending-printset.tsx) en bekijk:
- De `useZendingPrintSet`-hook-aanroep (gebruikt voor data-load).
- De `<PageHeader>` en het eerste render-blok met `<PakbonDocument>` / `<ShippingLabel>` — daar komen de Pickronde-componenten boven.
- `fetchZendingPrintSet` in [`frontend/src/modules/logistiek/queries/zendingen.ts`](../../frontend/src/modules/logistiek/queries/zendingen.ts) — daar moet `lever_modus` aan het select-veld worden toegevoegd.

- [ ] **Step 2: Voeg `lever_modus` toe aan printset-fetch**

Open [`frontend/src/modules/logistiek/queries/zendingen.ts`](frontend/src/modules/logistiek/queries/zendingen.ts) en breid `ZendingPrintSet`-type + select-string uit met `lever_modus`. Specifiek: in het `orders!inner (...)`-blok van `fetchZendingPrintSet` (rond regel 180) voeg `lever_modus` toe. Voeg toe aan het `orders`-type op de `ZendingPrintSet`-interface:

```typescript
// In ZendingPrintSet interface, blok 'orders':
    lever_modus: string | null
```

In het select-string in `fetchZendingPrintSet`:

```typescript
        id, order_nr, oud_order_nr, klant_referentie, orderdatum, afleverdatum,
        week, afhalen, lever_modus, debiteur_nr, vertegenw_code,
```

- [ ] **Step 3: Render `<ColliPickVinkjes>` en `<VoltooiPickrondeKnop>`**

In `zending-printset.tsx`, voeg de imports toe:

```typescript
import { ColliPickVinkjes } from '@/modules/logistiek/components/colli-pick-vinkjes'
import { VoltooiPickrondeKnop } from '@/modules/logistiek/components/voltooi-pickronde-knop'
```

Voeg een nieuwe sectie toe boven het bestaande pakbon/labels-blok (zoek naar de eerste rendering van `<PakbonDocument` of `<ShippingLabel` — voeg hierboven in een `non-print:` blok):

```tsx
{zending && zending.status === 'Picken' && (
  <div className="non-print mb-4 space-y-3">
    <ColliPickVinkjes
      zendingId={zending.id}
      leverModus={
        (zending.orders.lever_modus as 'deelleveringen' | 'in_een_keer' | null) ?? null
      }
    />
    <div className="flex justify-end">
      <VoltooiPickrondeKnop zendingId={zending.id} zendingStatus={zending.status} />
    </div>
  </div>
)}
```

- [ ] **Step 4: Typecheck + dev-server**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

```bash
cd frontend && npm run dev
```

Open browser → maak een test-order, klik "Verzendset" op pick-card, zie printset-pagina met vinkjes-blok.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/logistiek/queries/zendingen.ts \
        frontend/src/modules/logistiek/pages/zending-printset.tsx
git commit -m "feat(pickronde): printset-pagina toont vinkjes + voltooi-knop bij status='Picken'"
```

---

## Task 10: Zendingen-overzicht — default filter `>= Klaar voor verzending`

**Files:**
- Modify: `frontend/src/modules/logistiek/pages/zendingen-overzicht.tsx`
- Modify: `frontend/src/modules/logistiek/queries/zendingen.ts`

- [ ] **Step 1: Breid `fetchZendingen` uit met multi-status filter**

Open [`frontend/src/modules/logistiek/queries/zendingen.ts`](frontend/src/modules/logistiek/queries/zendingen.ts), regel ±117 (`fetchZendingen`). Vervang het `status`-filter:

```typescript
  // VOOR:
  // if (filters.status) q = q.eq('status', filters.status)

  // NA:
  if (filters.status) {
    q = q.eq('status', filters.status)
  } else if (filters.exclude_picken !== false) {
    // Default: verberg lopende Pickrondes (status='Picken' / 'Gepland').
    q = q.in('status', ['Klaar voor verzending', 'Onderweg', 'Afgeleverd'])
  }
```

Breid het `ZendingenFilters`-interface uit:

```typescript
export interface ZendingenFilters {
  status?: ZendingStatus
  debiteur_nr?: number
  /** Default true: verberg status='Picken' (lopende pickrondes). */
  exclude_picken?: boolean
}
```

- [ ] **Step 2: Voeg "Picken"-pil toe aan zendingen-overzicht**

Open `frontend/src/modules/logistiek/pages/zendingen-overzicht.tsx`. Wijzig `STATUS_PILLEN`:

```typescript
const STATUS_PILLEN: StatusFilter[] = [
  'alle',
  'Picken',                  // ← nieuw, magazijnchef-blik
  'Klaar voor verzending',
  'Onderweg',
  'Afgeleverd',
]
```

In de `useZendingen`-call: zorg dat `'alle'` ook geen Picken toont. Pas de filter-logica aan:

```typescript
  const { data: zendingen = [], isLoading } = useZendingen({
    status: statusFilter === 'alle' ? undefined : statusFilter,
    // 'alle' = default = exclude Picken; expliciete keuze 'Picken' overschrijft via status-filter.
  })
```

(`exclude_picken` blijft default true, dus 'alle' filtert lopende Pickrondes weg. Operator die expliciet "Picken" kiest, krijgt ze.)

- [ ] **Step 3: Update beschrijvende tekst onder PageHeader**

In `<PageHeader description={...} />`, voeg toelichting toe:

```typescript
description={`${gefilterd.length} zendingen${aantalFout ? ` — ${aantalFout} met HST-fout` : ''}${statusFilter === 'alle' ? ' (lopende Pickrondes verborgen)' : ''}`}
```

- [ ] **Step 4: Verifieer in browser**

```bash
cd frontend && npm run dev
```

Open `/logistiek` → standaard zie je geen 'Picken'-zendingen meer. Klik filter "Picken" → zie de lopende Pickronde uit Task 9.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/logistiek/queries/zendingen.ts \
        frontend/src/modules/logistiek/pages/zendingen-overzicht.tsx
git commit -m "feat(pickronde): zendingen-overzicht verbergt lopende Pickrondes default"
```

---

## Task 11: `<VerzendsetButton>`-tooltip + label-update

**Files:**
- Modify: `frontend/src/modules/logistiek/components/verzendset-button.tsx`

- [ ] **Step 1: Pas tooltip-tekst aan**

Open [`frontend/src/modules/logistiek/components/verzendset-button.tsx`](frontend/src/modules/logistiek/components/verzendset-button.tsx). Vervang de `tooltip`-ternary (regel 28-38) zodat de "Maak zending"-tekst nu "Start pickronde" zegt:

```typescript
  const tooltip = order.afhalen
    ? !isVolledigPickbaar
      ? 'Nog niet alle regels zijn klaar om te picken'
      : 'Start afhaal-pickronde (geen verzendstickers)'
    : actieveVervoerder.selectie_status === 'geen_actieve_vervoerder'
      ? 'Activeer eerst een vervoerder bij Logistiek > instellingen'
      : actieveVervoerder.selectie_status === 'meerdere_actieve_vervoerders'
        ? 'Meerdere vervoerders actief: richt eerst prijs/criteria-selectie in'
        : !isVolledigPickbaar
          ? 'Nog niet alle regels zijn klaar om te picken'
          : 'Start pickronde — print stickers en pakbon, dan afronden op printset-pagina'
```

(Knop-label "Verzendset" / "Afhaalset" blijft — dat is wat de operator print, en dat is wat de fysieke output beschrijft. Alleen het tooltip-verhaal is bijgewerkt.)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/logistiek/components/verzendset-button.tsx
git commit -m "feat(pickronde): tooltip update — 'Start pickronde' ipv 'Maak zending'"
```

---

## Task 12: Pick-problemen-werklijst pagina

**Files:**
- Create: `frontend/src/modules/magazijn/pages/pick-problemen.tsx`
- Modify: `frontend/src/modules/magazijn/index.ts`
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Implementeer pagina**

```typescript
// frontend/src/modules/magazijn/pages/pick-problemen.tsx
import { Link } from 'react-router-dom'
import { AlertCircle, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { usePickProblemen } from '../hooks/use-pickronde'

export function PickProblemenPage() {
  const { data: problemen = [], isLoading } = usePickProblemen()

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <AlertCircle size={22} className="text-rose-500" />
            Pick-problemen
          </span>
        }
        description={`${problemen.length} colli's gemarkeerd als 'niet gevonden' tijdens lopende Pickrondes`}
      />

      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Laden...
        </div>
      ) : problemen.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-500">
          Geen openstaande pick-problemen.
        </div>
      ) : (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                <th className="py-2 px-3 font-medium">Zending</th>
                <th className="py-2 px-3 font-medium">Order</th>
                <th className="py-2 px-3 font-medium">Klant</th>
                <th className="py-2 px-3 font-medium">Colli-omschrijving</th>
                <th className="py-2 px-3 font-medium">Opmerking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {problemen.map((p) => (
                <tr key={p.colli_id} className="hover:bg-slate-50">
                  <td className="py-2 px-3">
                    <Link
                      to={`/logistiek/${p.zending_nr}/printset`}
                      className="inline-flex items-center gap-1 text-terracotta-600 font-medium hover:underline"
                    >
                      {p.zending_nr}
                      <ExternalLink size={11} />
                    </Link>
                  </td>
                  <td className="py-2 px-3 text-slate-600">{p.order_nr}</td>
                  <td className="py-2 px-3">{p.klant_naam ?? '—'}</td>
                  <td className="py-2 px-3 text-slate-600">
                    {p.omschrijving_snapshot ?? '—'}
                  </td>
                  <td className="py-2 px-3 text-rose-600 text-xs">
                    {p.pick_opmerking ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Voeg toe aan barrel + router**

`frontend/src/modules/magazijn/index.ts`:

```typescript
export { PickProblemenPage } from './pages/pick-problemen'
```

`frontend/src/router.tsx`:

```typescript
// In imports (regel 38):
import { MagazijnOverviewPage, PickProblemenPage } from '@/modules/magazijn'

// In children (na pick-ship):
{ path: 'magazijn/pick-problemen', element: <PickProblemenPage /> },
```

- [ ] **Step 3: Voeg link toe in zijbalk-navigatie**

Vind de sidebar-component:

```bash
grep -rn "Pick & Ship\|pick-ship" frontend/src/components/layout/
```

Voeg een sub-item of nieuwe rij toe naar `/magazijn/pick-problemen` met label "Pick-problemen" + `AlertCircle`-icon (uit `lucide-react`). Volg het bestaande patroon van de andere sidebar-items voor styling.

- [ ] **Step 4: Typecheck + dev-server**

```bash
cd frontend && npx tsc --noEmit && npm run dev
```

Open `/magazijn/pick-problemen` — moet renderen, ofwel "geen problemen" of de werklijst.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/magazijn/pages/pick-problemen.tsx \
        frontend/src/modules/magazijn/index.ts \
        frontend/src/router.tsx \
        frontend/src/components/layout/sidebar.tsx
git commit -m "feat(pickronde): pick-problemen werklijst-pagina + route"
```

---

## Task 13: Documentatie — changelog

**Files:**
- Modify: `docs/changelog.md`

- [ ] **Step 1: Voeg changelog-entry toe**

Open [`docs/changelog.md`](docs/changelog.md). Voeg bovenaan (na de header) toe:

```markdown
## 2026-05-07 — Pickronde-flow (mig 211)

**Beslissing:** [ADR-0003](adr/0003-pickronde-als-deepening-van-magazijn-module.md)
**Plan:** [docs/superpowers/plans/2026-05-07-pickronde-implementatie.md](superpowers/plans/2026-05-07-pickronde-implementatie.md)

- Migratie 211: enum `pick_uitkomst` + 3 kolommen op `zending_colli`. Drie nieuwe RPC's: `start_pickronde`, `markeer_colli_niet_gevonden`, `voltooi_pickronde`.
- `create_zending_voor_order` is nu alias voor `start_pickronde`. Zending start in status `Picken`, niet meer direct in `Klaar voor verzending`.
- Bestaande HST-/EDI-trigger (`trg_zending_klaar_voor_verzending`) ongemoeid — vuurt nu pas op echte voltooi-moment.
- Frontend: nieuwe `<ColliPickVinkjes>` + `<VoltooiPickrondeKnop>` op printset-pagina; nieuwe `/magazijn/pick-problemen`-werklijst voor magazijnchef.
- Zendingen-overzicht verbergt lopende Pickrondes default (filter "Picken" laat ze zien).
- _Waarom_: gebruiker zag zendingen op `Klaar voor verzending` voordat het tapijt fysiek van de plank was — door bundeling van "stickers printen" met "zending creëren". Pickronde scheidt deze twee momenten.
```

- [ ] **Step 2: Commit**

```bash
git add docs/changelog.md
git commit -m "docs(pickronde): changelog-entry voor mig 211 + ADR-0003"
```

---

## Verificatie-checklist (manueel, na alle tasks)

- [ ] **Migratie 211 toegepast op staging Supabase** (via dashboard)
- [ ] **Cold path**: `/orders/<nieuw-order>` → klik "Verzendset" op pick-card → zending verschijnt **niet** op `/logistiek` (filter `alle` toont 'm niet)
- [ ] **Pick-pagina**: printset-pagina toont vinkjes-blok bovenaan; "Voltooi pickronde"-knop is groen en klikbaar
- [ ] **Niet-gevonden flow blokkeer**: klik "Niet gevonden" op één colli → kies "Blokkeer & escaleer" → opmerking → bevestig. Pagina toont colli met rood ⚠. Voltooi-knop wordt disabled met tooltip "Eerst N pick-probleem oplossen"
- [ ] **Pick-problemen-werklijst**: `/magazijn/pick-problemen` toont de zojuist gemarkeerde colli
- [ ] **Niet-gevonden flow splits** (alleen bij order met `lever_modus='deelleveringen'`): zelfde flow, kies "Splits zending" → colli verdwijnt uit lijst, `aantal_colli` op zending omlaag
- [ ] **Voltooi succes**: zonder openstaande problemen → klik voltooi-knop → navigatie naar `/logistiek` → zending verschijnt nu in standaard-lijst, status `Klaar voor verzending`
- [ ] **HST-dispatch**: na voltooi-klik vuurt `enqueue_zending_naar_vervoerder` → check `hst_transportorders`-tabel: nieuwe rij in status `Wachtrij` (alleen voor HST-debiteuren).
- [ ] **Backwards-compat**: order-detail "Zending aanmaken"-knop blijft werken (alias). Zending start ook daar in `Picken`.

---

## Rollback-strategie

Migratie 211 is volledig idempotent en non-destructief: drie nieuwe kolommen met defaults + drie nieuwe RPC's. Bij rollback:

```sql
-- Revert mig 211 (handmatig, indien nodig):
DROP FUNCTION IF EXISTS voltooi_pickronde(BIGINT);
DROP FUNCTION IF EXISTS markeer_colli_niet_gevonden(BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS start_pickronde(BIGINT);
-- create_zending_voor_order moet teruggezet worden naar mig 206-versie:
-- (paste mig 206 inhoud)
ALTER TABLE zending_colli
  DROP COLUMN IF EXISTS pick_uitkomst,
  DROP COLUMN IF EXISTS pick_opmerking,
  DROP COLUMN IF EXISTS gepickt_at;
DROP TYPE IF EXISTS pick_uitkomst;
```

Frontend-rollback: revert de commits in omgekeerde volgorde (Task 13 → Task 1).

In-flight zendingen in status `Picken` op het moment van rollback moeten handmatig naar `Klaar voor verzending` worden geflipt (UPDATE op `zendingen.status`).
