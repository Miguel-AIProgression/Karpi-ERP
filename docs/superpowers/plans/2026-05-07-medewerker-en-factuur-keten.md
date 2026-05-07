# Medewerker + Pickronde-Factuur-Keten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduceer een Medewerker-tabel met rol-tags (vertegenwoordiger/picker), koppel pickers aan de Pickronde-RPCs, en sluit de factuur-keten zodat `voltooi_pickronde` automatisch `orders.status='Verzonden'` flipt bij de laatste open zending.

**Architecture:** Twee opeenvolgende DB-migraties (214 + 215) met bijbehorende frontend-aanpassingen. Migratie 214 hernoemt `vertegenwoordigers` → `medewerkers`, voegt `rollen medewerker_rol[]` toe en maakt pickers mogelijk. Migratie 215 voegt `picker_id` toe aan `start_pickronde`/`voltooi_pickronde`/`markeer_colli_niet_gevonden` en laat `voltooi_pickronde` de factuur-keten sluiten via `orders.status='Verzonden'`. UI krijgt een nieuwe `/instellingen/medewerkers`-tab (vertegenwoordigers + pickers) en een picker-dropdown op de pick-flow.

**Tech Stack:** PostgreSQL 15 / Supabase, TypeScript, React 18+, TanStack Query, Vitest voor contract-tests.

**Referenties:**
- [ADR-0004](../../adr/0004-medewerker-als-overkoepelend-identity-concept.md) — Medewerker als overkoepelend identity-concept
- [ADR-0005](../../adr/0005-pickronde-sluit-de-factuur-keten.md) — Pickronde-voltooi flipt order naar Verzonden
- [ADR-0003](../../adr/0003-pickronde-als-deepening-van-magazijn-module.md) — Pickronde-introductie (basis)
- [data-woordenboek.md](../../data-woordenboek.md) §Medewerkers & Rollen, §Pickronde

---

## File Structure

### Database (in volgorde van toepassen)

| Bestand | Verantwoordelijkheid |
|---|---|
| `supabase/migrations/214_medewerker_tabel.sql` | Enum `medewerker_rol`, hernoem `vertegenwoordigers` → `medewerkers`, voeg `id BIGSERIAL` + `rollen medewerker_rol[]` toe, backfill, vertegenwoordigers-view voor backwards-compat. |
| `supabase/migrations/215_pickronde_picker_factuur_keten.sql` | Voeg `orders.verzonden_at`, `zendingen.picker_id`, `zending_colli.gepickt_door_id` toe. Update `start_pickronde`/`voltooi_pickronde`/`markeer_colli_niet_gevonden` met `p_picker_id`. Sluit factuur-keten in `voltooi_pickronde`. |

### Frontend — nieuw

| Bestand | Verantwoordelijkheid |
|---|---|
| `frontend/src/lib/supabase/queries/medewerkers.ts` | Bron-queries: `fetchMedewerkers(rol?)`, `fetchPickers()`, CRUD, rol-array-mutaties. |
| `frontend/src/hooks/use-medewerkers.ts` | TanStack-hooks rond medewerkers (algemeen). |
| `frontend/src/hooks/use-pickers.ts` | Smal hook: `usePickers()` — alleen actieve pickers, gefilterd. |
| `frontend/src/pages/instellingen/medewerkers/medewerkers-overview.tsx` | Pagina met tabs Vertegenwoordigers + Pickers. |
| `frontend/src/components/instellingen/pickers-tab.tsx` | Tab-content: lijst + nieuwe-knop. |
| `frontend/src/components/instellingen/picker-edit-dialog.tsx` | Dialog: naam + actief vlag. |
| `frontend/src/components/orders/picker-dropdown.tsx` | Herbruikbare dropdown (consument: pick-flow). |
| `frontend/src/modules/magazijn/__tests__/voltooi-pickronde-keten.contract.test.ts` | Contract-test op factuur-keten. |
| `frontend/src/modules/magazijn/__tests__/medewerker-rollen.contract.test.ts` | Contract-test rol-array gedrag. |

### Frontend — wijzigen

| Bestand | Wijziging |
|---|---|
| `frontend/src/lib/supabase/queries/vertegenwoordigers.ts` | Wijzig bron van tabel `vertegenwoordigers` → view `vertegenwoordigers_v` (gefilterd op rol). Geen API-breuk. |
| `frontend/src/hooks/use-vertegenwoordigers.ts` | Geen wijziging — gebruikt nog steeds vertegenwoordigers-queries. |
| `frontend/src/router.tsx` | Voeg `/instellingen/medewerkers` toe. Behoud `/vertegenwoordigers` als alias-route. |
| `frontend/src/modules/magazijn/queries/pick-ship.ts` (of waar `start_pickronde` aangeroepen wordt) | Geef `p_picker_id` mee. |
| `frontend/src/modules/magazijn/hooks/use-pickronde.ts` | Mutatie-signaturen: `pickerId` als verplicht veld. |
| `frontend/src/modules/logistiek/components/verzendset-button.tsx` | Picker-dropdown toevoegen vóór actie. |
| `frontend/src/modules/logistiek/pages/zending-printset.tsx` | Picker-dropdown bij voltooi-knop, niet-gevonden-flow. |
| `frontend/src/components/orders/zending-aanmaken-knop.tsx` | Picker-dropdown toevoegen. |

### Documentatie

| Bestand | Wijziging |
|---|---|
| `docs/database-schema.md` | Tabel `medewerkers` + enum `medewerker_rol` + nieuwe kolommen op `orders`/`zendingen`/`zending_colli`. |
| `docs/architectuur.md` | Verwijs naar ADR-0004 en ADR-0005 in module-overzicht. |
| `docs/changelog.md` | Mig 214 + 215 entries. |

---

## Pre-flight: branch + worktree

- [ ] **Step 0.1: Verifieer branch en clean working tree**

```powershell
git status
git branch --show-current
```

Als er nog uncommitted wijzigingen liggen die niet bij dit plan horen — eerst die in een aparte commit. Anders begin op een eigen branch:

```powershell
git checkout -b feat/medewerker-en-factuur-keten
```

---

## Phase 1: ADR-0004 — Medewerker-tabel (migratie 214)

### Task 1.1: Migratie 214 — schrijf de SQL

**Files:**
- Create: `supabase/migrations/214_medewerker_tabel.sql`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 214: Medewerker als overkoepelend identity-concept
--
-- Achtergrond: ADR-0004. De methodiek-flow vereist dat we bij een Pickronde
-- een Picker selecteren. We konden een aparte `pickers`-tabel maken naast
-- `vertegenwoordigers`, maar elke nieuwe rol (magazijnchef, inkoper) zou
-- dan een eigen tabel worden. Beter: één `medewerkers`-tabel met rol-tags.
--
-- Migratie-strategie:
--   1. Maak enum `medewerker_rol`.
--   2. Hernoem tabel `vertegenwoordigers` → `medewerkers`.
--   3. Voeg `id BIGSERIAL PRIMARY KEY` + `rollen medewerker_rol[]` toe.
--   4. Backfill bestaande rijen met rollen={'vertegenwoordiger'}.
--   5. Maak compat-view `vertegenwoordigers_v` voor bestaande callers.
--   6. Update `vertegenwoordiger_werkdagen` naar nieuwe FK indien nodig.
--
-- FKs op `klanten.vertegenw_code` en `orders.vertegenw_code` blijven
-- ongemoeid — `medewerkers.code` is nog steeds de target.

------------------------------------------------------------------------
-- 1. Enum medewerker_rol
------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medewerker_rol') THEN
    CREATE TYPE medewerker_rol AS ENUM ('vertegenwoordiger', 'picker');
  END IF;
END $$;

------------------------------------------------------------------------
-- 2. Hernoem tabel
------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'vertegenwoordigers')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'medewerkers')
  THEN
    ALTER TABLE vertegenwoordigers RENAME TO medewerkers;
  END IF;
END $$;

------------------------------------------------------------------------
-- 3. Voeg id + rollen toe
------------------------------------------------------------------------
ALTER TABLE medewerkers
  ADD COLUMN IF NOT EXISTS id BIGSERIAL,
  ADD COLUMN IF NOT EXISTS rollen medewerker_rol[] NOT NULL DEFAULT '{}';

-- id wordt nieuwe surrogate PK; code blijft UNIQUE als business-key.
DO $$
BEGIN
  -- Drop oude PK op code als die bestaat
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'medewerkers'::regclass
      AND contype = 'p'
      AND conname = 'vertegenwoordigers_pkey'
  ) THEN
    ALTER TABLE medewerkers DROP CONSTRAINT vertegenwoordigers_pkey;
  END IF;

  -- Zet id als PK
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'medewerkers'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE medewerkers ADD CONSTRAINT medewerkers_pkey PRIMARY KEY (id);
  END IF;

  -- Code blijft UNIQUE (NULLs toegestaan voor pickers)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'medewerkers'::regclass
      AND contype = 'u'
      AND conname = 'medewerkers_code_key'
  ) THEN
    ALTER TABLE medewerkers ADD CONSTRAINT medewerkers_code_key UNIQUE (code);
  END IF;
END $$;

-- Code mag voortaan NULL zijn (pickers hebben geen code)
ALTER TABLE medewerkers ALTER COLUMN code DROP NOT NULL;

------------------------------------------------------------------------
-- 4. Backfill rollen
------------------------------------------------------------------------
UPDATE medewerkers
SET rollen = ARRAY['vertegenwoordiger']::medewerker_rol[]
WHERE rollen = '{}' AND code IS NOT NULL;

------------------------------------------------------------------------
-- 5. Backwards-compat: view vertegenwoordigers_v
------------------------------------------------------------------------
-- Bestaande queries die `from('vertegenwoordigers')` deden blijven werken
-- als ze naar `vertegenwoordigers_v` switchen. Voor nu: maak een view
-- zodat de oude tabelnaam ook nog herbruikbaar is (idempotent).
DROP VIEW IF EXISTS vertegenwoordigers CASCADE;

CREATE VIEW vertegenwoordigers AS
SELECT
  id,
  naam,
  code,
  email,
  telefoon,
  actief
FROM medewerkers
WHERE 'vertegenwoordiger' = ANY(rollen);

COMMENT ON VIEW vertegenwoordigers IS
  'Compat-view voor pre-mig-214 callers. Filtert medewerkers op rol '
  'vertegenwoordiger. Nieuwe code: gebruik direct medewerkers + rollen-filter.';

------------------------------------------------------------------------
-- 6. vertegenwoordiger_werkdagen — geen wijziging nodig
------------------------------------------------------------------------
-- Tabel verwijst via vertegenw_code naar medewerkers.code (nog steeds UNIQUE).
-- Geen FK-update nodig.

------------------------------------------------------------------------
-- 7. RLS / grants — overgenomen van vertegenwoordigers
------------------------------------------------------------------------
ALTER TABLE medewerkers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS medewerkers_read ON medewerkers;
CREATE POLICY medewerkers_read ON medewerkers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS medewerkers_write ON medewerkers;
CREATE POLICY medewerkers_write ON medewerkers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON medewerkers TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE medewerkers_id_seq TO authenticated;
GRANT SELECT ON vertegenwoordigers TO authenticated;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verifieer geen syntax-fouten**

```powershell
# Lokale syntax-check (als je psql lokaal hebt) of dry-run via Supabase CLI
# Als je Supabase MCP geen toegang heeft (zie memory: reference_karpi_supabase_mcp.md):
# Migratie wordt handmatig toegepast — sla deze stap over en plan voor staging.
```

- [ ] **Step 3: Pas toe op staging**

Open Supabase SQL Editor → plak migratie → execute. Verwacht: geen errors, twee `NOTICE`-regels uit DO-blocks zijn OK.

- [ ] **Step 4: Verifieer schema na migratie**

In SQL Editor:

```sql
-- Verwacht: enum bestaat
SELECT typname FROM pg_type WHERE typname = 'medewerker_rol';

-- Verwacht: tabel medewerkers met id, code, rollen
\d medewerkers

-- Verwacht: alle bestaande rijen hebben rollen={'vertegenwoordiger'}
SELECT COUNT(*) FROM medewerkers WHERE 'vertegenwoordiger' = ANY(rollen);
SELECT COUNT(*) FROM medewerkers WHERE rollen = '{}';  -- moet 0 zijn

-- Verwacht: view werkt
SELECT COUNT(*) FROM vertegenwoordigers;
```

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/214_medewerker_tabel.sql
git commit -m "feat(medewerker): mig 214 — vertegenwoordigers → medewerkers + rol-array (ADR-0004)"
```

---

### Task 1.2: TypeScript types regenereren

**Files:**
- Modify: `frontend/src/lib/supabase/database.types.ts` (auto-gegenereerd) — alleen als die bestaat

- [ ] **Step 1: Check of er een gegenereerd type-bestand is**

```powershell
Get-ChildItem -Path frontend\src -Recurse -Filter "database.types.ts" -ErrorAction SilentlyContinue
```

Als gevonden → regenereer via `npx supabase gen types typescript --project-id <ref> > frontend/src/lib/supabase/database.types.ts`. Als niet gevonden → skip deze taak.

- [ ] **Step 2: Commit indien gewijzigd**

```powershell
git add frontend/src/lib/supabase/database.types.ts
git commit -m "chore(types): regenerate na mig 214"
```

---

### Task 1.3: Frontend — medewerkers query-laag

**Files:**
- Create: `frontend/src/lib/supabase/queries/medewerkers.ts`

- [ ] **Step 1: Schrijf het queries-bestand**

```typescript
import { supabase } from '../client'

export type MedewerkerRol = 'vertegenwoordiger' | 'picker'

export interface Medewerker {
  id: number
  naam: string
  code: string | null
  email: string | null
  telefoon: string | null
  actief: boolean
  rollen: MedewerkerRol[]
}

export interface PickerOption {
  id: number
  naam: string
}

/** Alle medewerkers, optioneel gefilterd op één rol. */
export async function fetchMedewerkers(rol?: MedewerkerRol): Promise<Medewerker[]> {
  let query = supabase
    .from('medewerkers')
    .select('id, naam, code, email, telefoon, actief, rollen')
    .order('naam')

  if (rol) {
    query = query.contains('rollen', [rol])
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Medewerker[]
}

/** Alleen actieve pickers, light-weight payload voor dropdown. */
export async function fetchPickers(): Promise<PickerOption[]> {
  const { data, error } = await supabase
    .from('medewerkers')
    .select('id, naam')
    .contains('rollen', ['picker'])
    .eq('actief', true)
    .order('naam')
  if (error) throw error
  return (data ?? []) as PickerOption[]
}

/** Maak nieuwe picker. Geen code. */
export async function createPicker(naam: string): Promise<Medewerker> {
  const { data, error } = await supabase
    .from('medewerkers')
    .insert({
      naam,
      rollen: ['picker'] satisfies MedewerkerRol[],
      actief: true,
    })
    .select('id, naam, code, email, telefoon, actief, rollen')
    .single()
  if (error) throw error
  return data as Medewerker
}

/** Update naam / actief / contact-velden. Niet rollen — daar is een aparte mutatie voor. */
export async function updateMedewerker(
  id: number,
  patch: Partial<Pick<Medewerker, 'naam' | 'email' | 'telefoon' | 'actief'>>,
): Promise<void> {
  const { error } = await supabase.from('medewerkers').update(patch).eq('id', id)
  if (error) throw error
}

/** Voeg een rol toe (bv. picker erbij voor een bestaande vertegenwoordiger). */
export async function addRolToMedewerker(id: number, rol: MedewerkerRol): Promise<void> {
  const { data, error: fetchErr } = await supabase
    .from('medewerkers')
    .select('rollen')
    .eq('id', id)
    .single()
  if (fetchErr) throw fetchErr

  const huidig = (data?.rollen ?? []) as MedewerkerRol[]
  if (huidig.includes(rol)) return

  const { error } = await supabase
    .from('medewerkers')
    .update({ rollen: [...huidig, rol] })
    .eq('id', id)
  if (error) throw error
}

/** Verwijder een rol. Als rollen leeg wordt: medewerker blijft bestaan maar zonder rol. */
export async function removeRolVanMedewerker(id: number, rol: MedewerkerRol): Promise<void> {
  const { data, error: fetchErr } = await supabase
    .from('medewerkers')
    .select('rollen')
    .eq('id', id)
    .single()
  if (fetchErr) throw fetchErr

  const huidig = (data?.rollen ?? []) as MedewerkerRol[]
  const nieuw = huidig.filter((r) => r !== rol)

  const { error } = await supabase
    .from('medewerkers')
    .update({ rollen: nieuw })
    .eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 2: Commit**

```powershell
git add frontend/src/lib/supabase/queries/medewerkers.ts
git commit -m "feat(medewerker): query-laag voor medewerkers + pickers"
```

---

### Task 1.4: Contract-test — rol-array gedrag

**Files:**
- Create: `frontend/src/modules/magazijn/__tests__/medewerker-rollen.contract.test.ts`

- [ ] **Step 1: Schrijf de test**

Volg het patroon van `magazijn-pickbaarheid.contract.test.ts`. Test moet bewijzen:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import {
  fetchMedewerkers,
  fetchPickers,
  createPicker,
  addRolToMedewerker,
  removeRolVanMedewerker,
} from '@/lib/supabase/queries/medewerkers'
import { supabase } from '@/lib/supabase/client'

describe('Medewerker rollen-array gedrag (mig 214)', () => {
  let createdIds: number[] = []

  beforeEach(() => {
    createdIds = []
  })

  afterEach(async () => {
    if (createdIds.length > 0) {
      await supabase.from('medewerkers').delete().in('id', createdIds)
    }
  })

  it('createPicker maakt rij met rollen={picker} en code=NULL', async () => {
    const picker = await createPicker('Test Picker')
    createdIds.push(picker.id)

    expect(picker.rollen).toEqual(['picker'])
    expect(picker.code).toBeNull()
    expect(picker.actief).toBe(true)
  })

  it('fetchPickers retourneert alleen actieve pickers', async () => {
    const actief = await createPicker('Actieve Picker')
    const inactief = await createPicker('Inactieve Picker')
    createdIds.push(actief.id, inactief.id)
    await supabase.from('medewerkers').update({ actief: false }).eq('id', inactief.id)

    const pickers = await fetchPickers()
    const ids = pickers.map((p) => p.id)
    expect(ids).toContain(actief.id)
    expect(ids).not.toContain(inactief.id)
  })

  it('addRolToMedewerker — vertegenwoordiger kan ook picker worden', async () => {
    const picker = await createPicker('Multi-rol persoon')
    createdIds.push(picker.id)

    await addRolToMedewerker(picker.id, 'vertegenwoordiger')
    const all = await fetchMedewerkers()
    const found = all.find((m) => m.id === picker.id)

    expect(found?.rollen.sort()).toEqual(['picker', 'vertegenwoordiger'])
  })

  it('removeRolVanMedewerker — verwijdert één rol, andere blijft', async () => {
    const picker = await createPicker('Multi-rol persoon')
    createdIds.push(picker.id)

    await addRolToMedewerker(picker.id, 'vertegenwoordiger')
    await removeRolVanMedewerker(picker.id, 'picker')

    const all = await fetchMedewerkers('vertegenwoordiger')
    const found = all.find((m) => m.id === picker.id)
    expect(found?.rollen).toEqual(['vertegenwoordiger'])
  })

  it('vertegenwoordigers-view retourneert alleen rij met rol vertegenwoordiger', async () => {
    const picker = await createPicker('Alleen-picker')
    createdIds.push(picker.id)

    const { data, error } = await supabase
      .from('vertegenwoordigers')
      .select('id')
      .eq('id', picker.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
```

- [ ] **Step 2: Run test — verwacht: groen na mig 214 staat op staging**

```powershell
cd frontend
npm run test -- medewerker-rollen.contract
```

Verwacht: 5 tests passing. Als test faalt op connectivity — controleer `frontend/.env.test` of soortgelijk. Als test faalt op view → mig 214 niet geapplyd.

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/modules/magazijn/__tests__/medewerker-rollen.contract.test.ts
git commit -m "test(medewerker): contract-test rol-array gedrag (mig 214)"
```

---

### Task 1.5: Frontend — hooks

**Files:**
- Create: `frontend/src/hooks/use-medewerkers.ts`
- Create: `frontend/src/hooks/use-pickers.ts`

- [ ] **Step 1: `use-medewerkers.ts`**

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchMedewerkers,
  createPicker,
  updateMedewerker,
  addRolToMedewerker,
  removeRolVanMedewerker,
  type Medewerker,
  type MedewerkerRol,
} from '@/lib/supabase/queries/medewerkers'

export function useMedewerkers(rol?: MedewerkerRol) {
  return useQuery({
    queryKey: ['medewerkers', rol ?? 'all'],
    queryFn: () => fetchMedewerkers(rol),
  })
}

export function useCreatePicker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (naam: string) => createPicker(naam),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['medewerkers'] })
      qc.invalidateQueries({ queryKey: ['pickers'] })
    },
  })
}

export function useUpdateMedewerker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: number
      patch: Partial<Pick<Medewerker, 'naam' | 'email' | 'telefoon' | 'actief'>>
    }) => updateMedewerker(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['medewerkers'] })
      qc.invalidateQueries({ queryKey: ['pickers'] })
    },
  })
}

export function useAddRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, rol }: { id: number; rol: MedewerkerRol }) =>
      addRolToMedewerker(id, rol),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['medewerkers'] }),
  })
}

export function useRemoveRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, rol }: { id: number; rol: MedewerkerRol }) =>
      removeRolVanMedewerker(id, rol),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['medewerkers'] }),
  })
}
```

- [ ] **Step 2: `use-pickers.ts`**

```typescript
import { useQuery } from '@tanstack/react-query'
import { fetchPickers } from '@/lib/supabase/queries/medewerkers'

export function usePickers() {
  return useQuery({
    queryKey: ['pickers'],
    queryFn: fetchPickers,
    staleTime: 5 * 60 * 1000,
  })
}
```

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/hooks/use-medewerkers.ts frontend/src/hooks/use-pickers.ts
git commit -m "feat(medewerker): hooks useMedewerkers + usePickers"
```

---

### Task 1.6: UI — pagina `/instellingen/medewerkers`

**Files:**
- Create: `frontend/src/pages/instellingen/medewerkers/medewerkers-overview.tsx`
- Create: `frontend/src/components/instellingen/pickers-tab.tsx`
- Create: `frontend/src/components/instellingen/picker-edit-dialog.tsx`

Houd elk bestand <200 regels (zie CLAUDE.md). Volg de stijl van bestaande instellingen-pagina's (`afwerking-kleuren-submenu.tsx` als referentie).

- [ ] **Step 1: `picker-edit-dialog.tsx`** — eenvoudige dialog met `naam` (verplicht) en `actief` (toggle).

```tsx
import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useCreatePicker, useUpdateMedewerker } from '@/hooks/use-medewerkers'
import type { Medewerker } from '@/lib/supabase/queries/medewerkers'

interface Props {
  open: boolean
  picker: Medewerker | null
  onClose: () => void
}

export function PickerEditDialog({ open, picker, onClose }: Props) {
  const [naam, setNaam] = useState('')
  const [actief, setActief] = useState(true)
  const createMut = useCreatePicker()
  const updateMut = useUpdateMedewerker()

  useEffect(() => {
    if (picker) {
      setNaam(picker.naam)
      setActief(picker.actief)
    } else {
      setNaam('')
      setActief(true)
    }
  }, [picker, open])

  const submit = async () => {
    if (!naam.trim()) return
    if (picker) {
      await updateMut.mutateAsync({ id: picker.id, patch: { naam: naam.trim(), actief } })
    } else {
      const nieuw = await createMut.mutateAsync(naam.trim())
      if (!actief) await updateMut.mutateAsync({ id: nieuw.id, patch: { actief: false } })
    }
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{picker ? 'Picker bewerken' : 'Picker toevoegen'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div>
            <Label>Naam</Label>
            <Input value={naam} onChange={(e) => setNaam(e.target.value)} autoFocus />
          </div>
          <div className="flex items-center justify-between">
            <Label>Actief</Label>
            <Switch checked={actief} onCheckedChange={setActief} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuleren</Button>
          <Button onClick={submit} disabled={!naam.trim()}>Opslaan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: `pickers-tab.tsx`** — lijst van pickers + nieuwe-knop.

```tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { useMedewerkers } from '@/hooks/use-medewerkers'
import { PickerEditDialog } from './picker-edit-dialog'
import type { Medewerker } from '@/lib/supabase/queries/medewerkers'

export function PickersTab() {
  const { data: pickers, isLoading } = useMedewerkers('picker')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Medewerker | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Pickers</h3>
        <Button onClick={() => { setEditing(null); setDialogOpen(true) }}>
          <Plus className="h-4 w-4 mr-2" /> Picker toevoegen
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Laden…</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-left">
              <th className="py-2">Naam</th>
              <th className="py-2">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(pickers ?? []).map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-2">{p.naam}</td>
                <td className="py-2">{p.actief ? 'Actief' : 'Inactief'}</td>
                <td className="py-2 text-right">
                  <Button variant="ghost" size="sm"
                    onClick={() => { setEditing(p); setDialogOpen(true) }}>
                    Bewerken
                  </Button>
                </td>
              </tr>
            ))}
            {pickers?.length === 0 && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-muted-foreground">
                  Nog geen pickers. Klik 'Picker toevoegen' om te beginnen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <PickerEditDialog
        open={dialogOpen}
        picker={editing}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  )
}
```

- [ ] **Step 3: `medewerkers-overview.tsx`** — pagina met tabs.

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useSearchParams } from 'react-router-dom'
import { PickersTab } from '@/components/instellingen/pickers-tab'
import VertegenwoordigersOverview from '@/pages/vertegenwoordigers/vertegenwoordigers-overview'

export default function MedewerkersOverview() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'vertegenwoordigers'

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Medewerkers</h1>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList>
          <TabsTrigger value="vertegenwoordigers">Vertegenwoordigers</TabsTrigger>
          <TabsTrigger value="pickers">Pickers</TabsTrigger>
        </TabsList>
        <TabsContent value="vertegenwoordigers">
          <VertegenwoordigersOverview />
        </TabsContent>
        <TabsContent value="pickers">
          <PickersTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

> **Let op:** `VertegenwoordigersOverview` is de bestaande overzichtspagina. Als die nog geen default-export heeft, voeg `export default` toe aan het bestand.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/pages/instellingen/medewerkers/medewerkers-overview.tsx frontend/src/components/instellingen/pickers-tab.tsx frontend/src/components/instellingen/picker-edit-dialog.tsx
git commit -m "feat(medewerker): /instellingen/medewerkers pagina met tabs"
```

---

### Task 1.7: Router — voeg route toe

**Files:**
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Lees huidige router**

```powershell
# Lees router.tsx om de juiste positie + import-stijl te zien
```

Voeg toe (binnen de bestaande routes-array):

```tsx
{
  path: 'instellingen/medewerkers',
  element: <MedewerkersOverview />,
},
```

en boven aan:

```tsx
import MedewerkersOverview from '@/pages/instellingen/medewerkers/medewerkers-overview'
```

`/vertegenwoordigers` route blijft bestaan — geen redirect nodig (het detail-pad blijft werken).

- [ ] **Step 2: Verifieer route in browser**

```powershell
cd frontend
npm run dev
```

Ga naar `http://localhost:5173/instellingen/medewerkers`. Verwacht: tabs Vertegenwoordigers + Pickers, vertegenwoordigers-tab toont bestaande overzicht, pickers-tab is leeg met "Picker toevoegen" knop.

- [ ] **Step 3: Voeg picker handmatig toe via UI** — verifieer dat hij verschijnt.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/router.tsx
git commit -m "feat(medewerker): route /instellingen/medewerkers"
```

---

### Task 1.8: Update zijbalk-navigatie

**Files:**
- Modify: zijbalk-component (zoek `Vertegenwoordigers` link in `frontend/src/components/layout/` of soortgelijk)

- [ ] **Step 1: Zoek de menu-item**

```powershell
# Grep voor Vertegenwoordigers in layout
```

Zie `Grep` op pattern `Vertegenwoordigers` in `frontend/src/components/layout/` of `frontend/src/components/sidebar.tsx`.

- [ ] **Step 2: Vervang link**

Vervang het oude menu-item `Vertegenwoordigers → /vertegenwoordigers` door:

```
Medewerkers → /instellingen/medewerkers
```

(of plaats Medewerkers onder Instellingen-submenu, afhankelijk van structuur).

- [ ] **Step 3: Test in browser** — klik door beide tabs.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/components/layout/<file>
git commit -m "feat(medewerker): zijbalk-link Medewerkers"
```

---

### Task 1.9: Documentatie — database-schema + changelog

**Files:**
- Modify: `docs/database-schema.md`
- Modify: `docs/changelog.md`

- [ ] **Step 1: Voeg `medewerkers` tabel toe aan database-schema.md**

Onder de juiste sectie (waarschijnlijk bij Klanten & Commercieel of nieuwe sectie Medewerkers):

```markdown
### medewerkers (was: vertegenwoordigers, mig 214)

| Kolom | Type | Beschrijving |
|---|---|---|
| id | BIGSERIAL PK | surrogate key |
| naam | TEXT NOT NULL | volledige naam |
| code | TEXT UNIQUE NULL | 3-4 letter code; alleen vertegenwoordigers |
| email, telefoon | TEXT | contact-info |
| actief | BOOLEAN DEFAULT TRUE | |
| rollen | medewerker_rol[] | enum-array, niet leeg in praktijk |

Enum `medewerker_rol`: `vertegenwoordiger | picker`. View `vertegenwoordigers` is een filter op rollen.
```

- [ ] **Step 2: Voeg changelog-entry toe**

```markdown
## 2026-05-07 — mig 214 Medewerker-tabel (ADR-0004)
- Hernoem `vertegenwoordigers` → `medewerkers` met `id BIGSERIAL` PK + `rollen medewerker_rol[]`
- Enum `medewerker_rol` (`vertegenwoordiger | picker`)
- Backfill bestaande rijen met `rollen={'vertegenwoordiger'}`
- View `vertegenwoordigers` als compat-laag voor pre-mig callers
- Nieuwe pagina `/instellingen/medewerkers` met tabs
```

- [ ] **Step 3: Commit**

```powershell
git add docs/database-schema.md docs/changelog.md
git commit -m "docs(medewerker): database-schema + changelog mig 214"
```

---

## Phase 2: ADR-0005 — Pickronde-picker + factuur-keten (migratie 215)

### Task 2.1: Bestaande pickronde-RPCs lezen voor referentie

- [ ] **Step 1: Lees `start_pickronde`, `voltooi_pickronde`, `markeer_colli_niet_gevonden`**

```powershell
# Lees mig 211 om de exacte signatuur te zien
```

Verifieer met name:
- Of `voltooi_pickronde` momenteel `RETURNS BIGINT` of iets anders
- Of `markeer_colli_niet_gevonden` `p_modus`-parameter heeft
- Of er een `create_zending_voor_order`-alias bestaat
- Of het idempotentie-mechanisme via `IF NOT EXISTS` of via een sentinel-status werkt

> **Belangrijk:** lees deze body's letterlijk; mig 215 is `CREATE OR REPLACE` op exact dezelfde signatuur (anders wordt het een nieuwe overload).

---

### Task 2.2: Migratie 215 — schema-wijzigingen + RPC-updates

**Files:**
- Create: `supabase/migrations/215_pickronde_picker_factuur_keten.sql`

- [ ] **Step 1: Schema-additions**

```sql
-- Migratie 215: Pickronde krijgt Picker, voltooi sluit factuur-keten
--
-- Achtergrond: ADR-0005. voltooi_pickronde flipte alleen zending-status;
-- orders.status='Verzonden' werd nergens gezet, dus mig-118-factuur-trigger
-- vuurde nooit. Nu: voltooi_pickronde flipt orders.status='Verzonden' bij
-- de laatste open zending van de order.
--
-- Daarnaast: picker (FK naar medewerkers) bij start + voltooi.
--
-- Idempotent: kolommen via ADD COLUMN IF NOT EXISTS, RPCs via CREATE OR REPLACE.

------------------------------------------------------------------------
-- 1. Kolommen
------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS verzonden_at TIMESTAMPTZ;

ALTER TABLE zendingen
  ADD COLUMN IF NOT EXISTS picker_id BIGINT REFERENCES medewerkers(id) ON DELETE SET NULL;

ALTER TABLE zending_colli
  ADD COLUMN IF NOT EXISTS gepickt_door_id BIGINT REFERENCES medewerkers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS zendingen_picker_id_idx ON zendingen(picker_id);
CREATE INDEX IF NOT EXISTS orders_verzonden_at_idx ON orders(verzonden_at);
```

- [ ] **Step 2: Update `start_pickronde`**

```sql
------------------------------------------------------------------------
-- 2. start_pickronde — picker_id nu verplicht
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION start_pickronde(p_order_id BIGINT, p_picker_id BIGINT)
RETURNS BIGINT AS $$
DECLARE
  v_zending_id BIGINT;
BEGIN
  IF p_picker_id IS NULL THEN
    RAISE EXCEPTION 'Picker is verplicht bij start van pickronde';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM medewerkers
    WHERE id = p_picker_id AND 'picker' = ANY(rollen) AND actief
  ) THEN
    RAISE EXCEPTION 'Medewerker % is geen actieve picker', p_picker_id;
  END IF;

  -- Idempotent: bestaande Picken-zending hergebruiken
  SELECT id INTO v_zending_id
  FROM zendingen
  WHERE order_id = p_order_id AND status = 'Picken'
  ORDER BY id DESC
  LIMIT 1;

  IF v_zending_id IS NOT NULL THEN
    -- Bestaat al — update picker als die nog leeg was
    UPDATE zendingen SET picker_id = COALESCE(picker_id, p_picker_id)
    WHERE id = v_zending_id;
    RETURN v_zending_id;
  END IF;

  -- Nieuwe zending aanmaken via bestaande logica (delegate)
  -- LET OP: roep hier dezelfde insert-functie aan als de oude
  -- create_zending_voor_order, of inline de insert-block.
  -- (Implementatie hangt af van wat in mig 211/172 staat — zie task 2.1.)

  v_zending_id := _create_zending_basic(p_order_id, 'Picken');

  UPDATE zendingen SET picker_id = p_picker_id WHERE id = v_zending_id;

  -- Genereer colli's voor deze zending (mig 213)
  PERFORM genereer_zending_colli(v_zending_id);

  RETURN v_zending_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION start_pickronde(BIGINT, BIGINT) TO authenticated;

-- Drop oude 1-arg variant uit mig 211 als die bestaat
DROP FUNCTION IF EXISTS start_pickronde(BIGINT);
```

> **Implementatie-notitie:** `_create_zending_basic` is een placeholder voor de werkelijke insert-logica uit mig 172/211. Lees die migratie en inline of refactor het correct. **Doe geen aanname** — verifieer eerst.

- [ ] **Step 3: Update `voltooi_pickronde` met factuur-sluitstuk**

```sql
------------------------------------------------------------------------
-- 3. voltooi_pickronde — picker + factuur-keten
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION voltooi_pickronde(
  p_zending_id BIGINT,
  p_picker_id BIGINT
)
RETURNS BIGINT AS $$
DECLARE
  v_order_id BIGINT;
  v_open_count INTEGER;
BEGIN
  IF p_picker_id IS NULL THEN
    RAISE EXCEPTION 'Picker is verplicht bij voltooi van pickronde';
  END IF;

  -- Guard: zending bestaat + status Picken
  SELECT order_id INTO v_order_id
  FROM zendingen WHERE id = p_zending_id AND status = 'Picken';

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Zending % is niet in status Picken', p_zending_id;
  END IF;

  -- Guard: geen openstaande niet_gevonden-colli's
  IF EXISTS (
    SELECT 1 FROM zending_colli
    WHERE zending_id = p_zending_id AND pick_uitkomst = 'niet_gevonden'
  ) THEN
    RAISE EXCEPTION 'Pick-problemen openstaand op zending %', p_zending_id;
  END IF;

  -- Open colli's → gepickt + audit
  UPDATE zending_colli
  SET pick_uitkomst = 'gepickt',
      gepickt_at = now(),
      gepickt_door_id = p_picker_id
  WHERE zending_id = p_zending_id AND pick_uitkomst = 'open';

  -- Zending → Klaar voor verzending (HST-trigger vuurt automatisch)
  UPDATE zendingen
  SET status = 'Klaar voor verzending',
      picker_id = COALESCE(picker_id, p_picker_id)
  WHERE id = p_zending_id;

  -- Sluitstuk factuur-keten: alleen als dit de laatste open zending is
  SELECT COUNT(*) INTO v_open_count
  FROM zendingen
  WHERE order_id = v_order_id
    AND status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd', 'Geannuleerd');

  IF v_open_count = 0 THEN
    UPDATE orders
    SET status = 'Verzonden',
        verzonden_at = now()
    WHERE id = v_order_id
      AND status NOT IN ('Verzonden', 'Geannuleerd');
    -- trg_enqueue_factuur (mig 118) vuurt automatisch op deze status-overgang
  END IF;

  RETURN p_zending_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) TO authenticated;

DROP FUNCTION IF EXISTS voltooi_pickronde(BIGINT);
```

- [ ] **Step 4: Update `markeer_colli_niet_gevonden`**

```sql
------------------------------------------------------------------------
-- 4. markeer_colli_niet_gevonden — picker erbij voor audit
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION markeer_colli_niet_gevonden(
  p_zending_colli_id BIGINT,
  p_modus TEXT,
  p_opmerking TEXT,
  p_picker_id BIGINT
)
RETURNS VOID AS $$
DECLARE
  v_zending_id BIGINT;
  v_order_id BIGINT;
  v_lever_modus TEXT;
BEGIN
  IF p_picker_id IS NULL THEN
    RAISE EXCEPTION 'Picker is verplicht';
  END IF;

  IF p_modus NOT IN ('blokkeer', 'splits') THEN
    RAISE EXCEPTION 'Ongeldige modus: %', p_modus;
  END IF;

  SELECT zc.zending_id, z.order_id
    INTO v_zending_id, v_order_id
  FROM zending_colli zc
  JOIN zendingen z ON z.id = zc.zending_id
  WHERE zc.id = p_zending_colli_id;

  IF p_modus = 'splits' THEN
    SELECT lever_modus INTO v_lever_modus FROM orders WHERE id = v_order_id;
    IF v_lever_modus IS DISTINCT FROM 'deelleveringen' THEN
      RAISE EXCEPTION 'Splits alleen toegestaan bij lever_modus=deelleveringen (huidig: %)', v_lever_modus;
    END IF;
    -- Splits: koppel colli los, mark voor latere pickronde
    UPDATE zending_colli
    SET zending_id = NULL,
        pick_uitkomst = 'open',
        pick_opmerking = p_opmerking,
        gepickt_door_id = p_picker_id
    WHERE id = p_zending_colli_id;
  ELSE
    -- Blokkeer & escaleer
    UPDATE zending_colli
    SET pick_uitkomst = 'niet_gevonden',
        pick_opmerking = p_opmerking,
        gepickt_door_id = p_picker_id
    WHERE id = p_zending_colli_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_colli_niet_gevonden(BIGINT, TEXT, TEXT, BIGINT) TO authenticated;

DROP FUNCTION IF EXISTS markeer_colli_niet_gevonden(BIGINT, TEXT, TEXT);
```

- [ ] **Step 5: `create_zending_voor_order`-alias**

```sql
------------------------------------------------------------------------
-- 5. Compat-alias create_zending_voor_order — accepteert picker_id optioneel
------------------------------------------------------------------------
-- Bestaande callers (zending-aanmaken-knop op order-detail) kunnen nog
-- zonder picker werken; UI moet z.s.m. naar start_pickronde overschakelen.
-- Voor nu: alias zonder picker → faalt, met picker → start_pickronde.
DROP FUNCTION IF EXISTS create_zending_voor_order(BIGINT);

CREATE OR REPLACE FUNCTION create_zending_voor_order(
  p_order_id BIGINT,
  p_picker_id BIGINT
)
RETURNS BIGINT AS $$
BEGIN
  RETURN start_pickronde(p_order_id, p_picker_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_zending_voor_order(BIGINT, BIGINT) TO authenticated;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 6: Pas migratie toe op staging — verifieer**

In Supabase SQL Editor:

```sql
-- Verwacht: 4 RPCs met picker_id parameter
SELECT proname, pg_get_function_arguments(oid)
FROM pg_proc
WHERE proname IN ('start_pickronde', 'voltooi_pickronde', 'markeer_colli_niet_gevonden', 'create_zending_voor_order');

-- Verwacht: kolommen bestaan
\d orders   -- moet verzonden_at hebben
\d zendingen  -- moet picker_id hebben
\d zending_colli  -- moet gepickt_door_id hebben
```

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/215_pickronde_picker_factuur_keten.sql
git commit -m "feat(pickronde): mig 215 — picker_id + factuur-keten sluitstuk (ADR-0005)"
```

---

### Task 2.3: Contract-test — voltooi_pickronde-keten

**Files:**
- Create: `frontend/src/modules/magazijn/__tests__/voltooi-pickronde-keten.contract.test.ts`

- [ ] **Step 1: Schrijf de test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { supabase } from '@/lib/supabase/client'
import { createPicker } from '@/lib/supabase/queries/medewerkers'

describe('voltooi_pickronde — factuur-keten sluitstuk (mig 215)', () => {
  let pickerId: number
  let testOrderId: number | null = null

  beforeEach(async () => {
    const picker = await createPicker(`Test ${Date.now()}`)
    pickerId = picker.id
  })

  afterEach(async () => {
    // Cleanup test-order en picker — implementatie hangt af van fixture-conventie
    if (testOrderId) {
      await supabase.from('zendingen').delete().eq('order_id', testOrderId)
      await supabase.from('orders').delete().eq('id', testOrderId)
    }
    await supabase.from('medewerkers').delete().eq('id', pickerId)
  })

  it('start_pickronde faalt zonder picker_id', async () => {
    const { error } = await supabase.rpc('start_pickronde', {
      p_order_id: 1,
      p_picker_id: null,
    })
    expect(error?.message).toMatch(/picker.*verplicht/i)
  })

  it('start_pickronde faalt als medewerker geen picker-rol heeft', async () => {
    // Maak vertegenwoordiger zonder picker-rol
    const { data: verteg } = await supabase
      .from('medewerkers')
      .insert({ naam: 'NoPicker', rollen: ['vertegenwoordiger'] })
      .select()
      .single()
    const { error } = await supabase.rpc('start_pickronde', {
      p_order_id: 1,
      p_picker_id: verteg!.id,
    })
    expect(error?.message).toMatch(/geen actieve picker/i)
    await supabase.from('medewerkers').delete().eq('id', verteg!.id)
  })

  it('voltooi_pickronde flipt orders.status=Verzonden bij laatste open zending', async () => {
    // FIXTURE NODIG: maak een test-order met 1 zending in Picken-status.
    // Implementatie van fixture: zie bestaande tests voor patroon.
    // Skeleton:
    const orderId = await createTestOrderMet1Zending(pickerId)
    testOrderId = orderId

    const { data: voorOrder } = await supabase
      .from('orders')
      .select('status, verzonden_at')
      .eq('id', orderId)
      .single()
    expect(voorOrder?.status).not.toBe('Verzonden')
    expect(voorOrder?.verzonden_at).toBeNull()

    const { data: zending } = await supabase
      .from('zendingen')
      .select('id')
      .eq('order_id', orderId)
      .single()

    const { error } = await supabase.rpc('voltooi_pickronde', {
      p_zending_id: zending!.id,
      p_picker_id: pickerId,
    })
    expect(error).toBeNull()

    const { data: naOrder } = await supabase
      .from('orders')
      .select('status, verzonden_at')
      .eq('id', orderId)
      .single()
    expect(naOrder?.status).toBe('Verzonden')
    expect(naOrder?.verzonden_at).not.toBeNull()
  })

  it('voltooi_pickronde flipt order NIET als nog een zending open is', async () => {
    const orderId = await createTestOrderMet2Zendingen(pickerId)
    testOrderId = orderId

    const { data: zendingen } = await supabase
      .from('zendingen')
      .select('id, status')
      .eq('order_id', orderId)
      .order('id')

    // Voltooi alleen de eerste
    await supabase.rpc('voltooi_pickronde', {
      p_zending_id: zendingen![0].id,
      p_picker_id: pickerId,
    })

    const { data: order } = await supabase
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .single()
    expect(order?.status).not.toBe('Verzonden')
  })

  it('voltooi_pickronde audit — gepickt_door_id wordt gezet', async () => {
    const orderId = await createTestOrderMet1Zending(pickerId)
    testOrderId = orderId

    const { data: zending } = await supabase
      .from('zendingen')
      .select('id')
      .eq('order_id', orderId)
      .single()
    await supabase.rpc('voltooi_pickronde', {
      p_zending_id: zending!.id,
      p_picker_id: pickerId,
    })

    const { data: colli } = await supabase
      .from('zending_colli')
      .select('gepickt_door_id, pick_uitkomst')
      .eq('zending_id', zending!.id)
    expect(colli?.every((c) => c.gepickt_door_id === pickerId)).toBe(true)
    expect(colli?.every((c) => c.pick_uitkomst === 'gepickt')).toBe(true)
  })
})

// --- helpers — vereisen fixture-laag, vul in volgens bestaande conventie ---
async function createTestOrderMet1Zending(_pickerId: number): Promise<number> {
  throw new Error('Fixture-helper: implementeer volgens bestaande contract-test patronen')
}
async function createTestOrderMet2Zendingen(_pickerId: number): Promise<number> {
  throw new Error('Fixture-helper: implementeer volgens bestaande contract-test patronen')
}
```

> **Belangrijk:** de fixture-helpers `createTestOrderMet1Zending` etc. moeten zo geschreven worden dat ze gebruikmaken van bestaande seed-/test-data of van directe inserts. Kijk naar `magazijn-pickbaarheid.contract.test.ts` voor het patroon. **Niet over een aanname heen werken** — als de bestaande contract-tests een specifieke seed-helper gebruiken, hergebruik die.

- [ ] **Step 2: Run de test**

```powershell
cd frontend
npm run test -- voltooi-pickronde-keten.contract
```

Verwacht: tests groen na fixture-helpers ingevuld zijn. Verwacht falende rood vóór mig 215 staat.

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/modules/magazijn/__tests__/voltooi-pickronde-keten.contract.test.ts
git commit -m "test(pickronde): contract-test factuur-keten sluitstuk"
```

---

### Task 2.4: Frontend — picker-dropdown component

**Files:**
- Create: `frontend/src/components/orders/picker-dropdown.tsx`

- [ ] **Step 1: Schrijf component**

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePickers } from '@/hooks/use-pickers'

interface Props {
  value: number | null
  onChange: (id: number | null) => void
  placeholder?: string
  disabled?: boolean
}

export function PickerDropdown({ value, onChange, placeholder = 'Kies picker', disabled }: Props) {
  const { data: pickers, isLoading } = usePickers()

  return (
    <Select
      value={value?.toString() ?? ''}
      onValueChange={(v) => onChange(v ? Number(v) : null)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger>
        <SelectValue placeholder={isLoading ? 'Laden…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {(pickers ?? []).map((p) => (
          <SelectItem key={p.id} value={p.id.toString()}>{p.naam}</SelectItem>
        ))}
        {pickers?.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            Geen pickers — voeg er een toe in /instellingen/medewerkers.
          </div>
        )}
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 2: Commit**

```powershell
git add frontend/src/components/orders/picker-dropdown.tsx
git commit -m "feat(pickronde): herbruikbare PickerDropdown component"
```

---

### Task 2.5: Frontend — verzendset-button met picker

**Files:**
- Modify: `frontend/src/modules/logistiek/components/verzendset-button.tsx`
- Modify: `frontend/src/modules/magazijn/hooks/use-pickronde.ts` (of waar `useStartPickronde` leeft)

- [ ] **Step 1: Lees bestaande verzendset-button**

```powershell
# Lees verzendset-button.tsx en de mutation-hook
```

- [ ] **Step 2: Voeg state + dropdown toe**

Wijzig component zodat klikken op "Verzendset" eerst een dialog opent met PickerDropdown. Pas wanneer een picker gekozen is wordt `start_pickronde(orderId, pickerId)` aangeroepen.

```tsx
// Skeleton-wijziging:
const [pickerDialogOpen, setPickerDialogOpen] = useState(false)
const [pickerId, setPickerId] = useState<number | null>(null)
const startMut = useStartPickronde()

// onClick van de bestaande knop:
onClick={() => setPickerDialogOpen(true)}

// In de dialog:
<PickerDropdown value={pickerId} onChange={setPickerId} />
<Button
  disabled={!pickerId}
  onClick={() => {
    startMut.mutate({ orderId, pickerId: pickerId! })
    setPickerDialogOpen(false)
  }}
>
  Start pickronde
</Button>
```

- [ ] **Step 3: Update `useStartPickronde` signatuur**

In `use-pickronde.ts`:

```typescript
export function useStartPickronde() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ orderId, pickerId }: { orderId: number; pickerId: number }) => {
      const { data, error } = await supabase.rpc('start_pickronde', {
        p_order_id: orderId,
        p_picker_id: pickerId,
      })
      if (error) throw error
      return data as number
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickbaarheid'] })
      qc.invalidateQueries({ queryKey: ['zendingen'] })
    },
  })
}
```

- [ ] **Step 4: Test in browser**

Start dev-server, ga naar pick-overview, klik Verzendset op een pickbare order. Verwacht: dialog verschijnt, picker-dropdown is gevuld, start-knop disabled tot picker gekozen, na klik wordt zending in Picken-status aangemaakt.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/modules/logistiek/components/verzendset-button.tsx frontend/src/modules/magazijn/hooks/use-pickronde.ts
git commit -m "feat(pickronde): picker-dropdown bij Verzendset-klik"
```

---

### Task 2.6: Frontend — voltooi pickronde + niet-gevonden flow

**Files:**
- Modify: `frontend/src/modules/logistiek/pages/zending-printset.tsx`
- Modify: `frontend/src/modules/magazijn/hooks/use-pickronde.ts`

- [ ] **Step 1: Voeg picker-state op printset-pagina toe**

Bij eerste laden: pre-fill met `zending.picker_id` (de picker die hem startte). Operator mag wisselen — bv. shift-overgang.

- [ ] **Step 2: Update `useVoltooiPickronde` + `useMarkeerColliNietGevonden` signaturen**

Beide hooks accepteren nu een verplichte `pickerId`.

```typescript
export function useVoltooiPickronde() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ zendingId, pickerId }: { zendingId: number; pickerId: number }) => {
      const { error } = await supabase.rpc('voltooi_pickronde', {
        p_zending_id: zendingId,
        p_picker_id: pickerId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zendingen'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['facturen'] })
    },
  })
}
```

- [ ] **Step 3: Voeg PickerDropdown bovenaan voltooi-blok**

```tsx
<div className="space-y-2">
  <Label>Picker (verplicht)</Label>
  <PickerDropdown value={pickerId} onChange={setPickerId} />
  <Button
    disabled={!pickerId || hasOpenNietGevonden}
    onClick={() => voltooiMut.mutate({ zendingId, pickerId: pickerId! })}
  >
    Voltooi pickronde
  </Button>
</div>
```

- [ ] **Step 4: Test in browser**

End-to-end:
1. Start pickronde via Verzendset (Task 2.5)
2. Open printset-pagina
3. Voltooi met picker → verifieer dat order.status='Verzonden' wordt + factuur in queue komt
4. Test ook niet-gevonden: markeer 1 colli niet-gevonden → voltooi-knop disabled

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/modules/logistiek/pages/zending-printset.tsx frontend/src/modules/magazijn/hooks/use-pickronde.ts
git commit -m "feat(pickronde): picker-dropdown bij voltooi + niet-gevonden flow"
```

---

### Task 2.7: Frontend — order-detail Zending-aanmaken-knop

**Files:**
- Modify: `frontend/src/components/orders/zending-aanmaken-knop.tsx`

- [ ] **Step 1: Voeg picker-dropdown toe** (zelfde patroon als Task 2.5)

- [ ] **Step 2: Test op order-detail-pagina**

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/components/orders/zending-aanmaken-knop.tsx
git commit -m "feat(pickronde): picker-dropdown bij ZendingAanmakenKnop op order-detail"
```

---

### Task 2.8: UI-bewijs — verzonden_at op order-detail

**Files:**
- Modify: order-detail-component (zoek `verzonden_at` of bestaande status-display)

- [ ] **Step 1: Toon verzonden_at + factuur-link**

Op order-detail, status-blok: als `orders.status='Verzonden'` toon "Verzonden op {verzonden_at}" + link naar de factuur (via factuurnr-lookup of factuur-status).

Maakt de causaliteit visueel zichtbaar — ondersteunt regression-detection ("hé, factuur miste hier").

- [ ] **Step 2: Commit**

```powershell
git add frontend/src/components/orders/order-detail.tsx  # of soortgelijk
git commit -m "feat(orders): toon verzonden_at + factuur-link na sluiting"
```

---

### Task 2.9: Documentatie — schema + changelog + ADR-status

**Files:**
- Modify: `docs/database-schema.md` — kolommen + RPC-signaturen
- Modify: `docs/changelog.md` — entry voor mig 215
- Modify: `docs/data-woordenboek.md` — al voorbereid; alleen verifiëren

- [ ] **Step 1: Update database-schema.md**

```markdown
### orders (mig 215)
- + `verzonden_at TIMESTAMPTZ` — ingevuld door `voltooi_pickronde` bij sluiten van laatste zending

### zendingen (mig 215)
- + `picker_id BIGINT REFERENCES medewerkers(id)` — picker die de Pickronde startte/voltooide

### zending_colli (mig 215)
- + `gepickt_door_id BIGINT REFERENCES medewerkers(id)` — picker die deze colli markeerde

### RPC-signatuur-wijzigingen (mig 215)
- `start_pickronde(p_order_id BIGINT, p_picker_id BIGINT) RETURNS BIGINT`
- `voltooi_pickronde(p_zending_id BIGINT, p_picker_id BIGINT) RETURNS BIGINT`
- `markeer_colli_niet_gevonden(p_zending_colli_id, p_modus, p_opmerking, p_picker_id) RETURNS VOID`
- `create_zending_voor_order(p_order_id, p_picker_id)` als alias
```

- [ ] **Step 2: Update changelog**

```markdown
## 2026-05-07 — mig 215 Pickronde-picker + factuur-keten sluitstuk (ADR-0005)
- `orders.verzonden_at`, `zendingen.picker_id`, `zending_colli.gepickt_door_id`
- `start_pickronde`/`voltooi_pickronde`/`markeer_colli_niet_gevonden` accepteren `p_picker_id` (verplicht)
- `voltooi_pickronde` flipt `orders.status='Verzonden'` bij laatste open zending → factuur-trigger (mig 118) vuurt
- Frontend: PickerDropdown op Verzendset, voltooi pickronde, ZendingAanmakenKnop
```

- [ ] **Step 3: Commit**

```powershell
git add docs/database-schema.md docs/changelog.md
git commit -m "docs(pickronde): schema + changelog mig 215"
```

---

## Phase 3: Smoke-test end-to-end

### Task 3.1: Volledige flow op staging

- [ ] **Step 1: Maak test-picker via UI**

`/instellingen/medewerkers` → tab Pickers → Toevoegen → "Smoke Test Picker"

- [ ] **Step 2: Maak test-order**

Order met 1 vaste-maat regel die volledig op voorraad gedekt is. Verifieer: order is pickbaar in `/magazijn/pick-overview`.

- [ ] **Step 3: Klik Verzendset → kies picker → Start**

Verifieer: zending in status `Picken`, picker_id ingevuld.

- [ ] **Step 4: Open printset → voltooi pickronde**

Verifieer:
- Zending → `Klaar voor verzending`
- Order → `Verzonden`
- `orders.verzonden_at` ingevuld
- `zending_colli.gepickt_door_id` = picker
- HST-trigger `trg_zending_klaar_voor_verzending` heeft gevuurd (check `edi_berichten` of zending dispatch-log)
- `factuur_queue` heeft een nieuwe rij (mig 118 trigger)
- Edge function `factuur-verzenden` heeft de queue afgehandeld (controleer `facturen.status='Verstuurd'`)

- [ ] **Step 5: Documenteer test-resultaat in changelog**

```markdown
## 2026-05-07 — smoke-test mig 214+215 op staging
- Test-order [order-nr] doorlopen: pick → voltooi → factuur. Factuur [factuur-nr] verzonden naar [email].
```

- [ ] **Step 6: Commit final docs**

```powershell
git add docs/changelog.md
git commit -m "docs: smoke-test resultaat mig 214+215"
```

---

## Phase 4: Cleanup & merge

- [ ] **Step 1: Verifieer geen achterblijvers**

```powershell
# Vraag om bevestiging — geen aliases meer nodig?
git log --oneline main..HEAD
```

- [ ] **Step 2: Merge naar main** (volgens memory: feedback_git_workflow.md — directe merge, geen PR)

```powershell
git checkout main
git merge --no-ff feat/medewerker-en-factuur-keten
git push origin main
```

- [ ] **Step 3: Verwijder feature-branch**

```powershell
git branch -d feat/medewerker-en-factuur-keten
git push origin --delete feat/medewerker-en-factuur-keten
```

---

## Risico's en open punten voor de uitvoerder

1. **Migratie-volgorde:** mig 214 móét vóór mig 215. Als staging out-of-order draait → eerst 214 volledig toepassen + verifiëren, dan pas 215.

2. **`vertegenwoordigers` als view i.p.v. tabel** — bestaande callers die `INSERT INTO vertegenwoordigers` doen breken. Grep eerst:
   ```
   Grep voor `from('vertegenwoordigers').insert` — als gevonden: refactor naar medewerkers met rollen={'vertegenwoordiger'}.
   ```

3. **`vertegenwoordiger_werkdagen` FK** — verifieer dat de FK op `vertegenw_code` blijft werken na rename (kolom-FK, niet tabel-FK in PG). Als de FK expliciet `REFERENCES vertegenwoordigers(code)` was, kan PG hem na rename automatisch hernoemen — verifieer.

4. **`_create_zending_basic` placeholder** — Task 2.2 Step 2 noemt deze placeholder. **Niet inkleuren** zonder eerst mig 211 te lezen. De werkelijke insert-logica zit in mig 172/211 en heeft side-effects (zending_regels-aanmaak). Refactor of inline-call.

5. **Picker-dropdown bij geen pickers** — als nog geen picker is aangemaakt, kan operator geen pickronde starten. Acceptabel voor V1 mits magazijnchef ten minste één picker invult vóór de eerste pickronde. Eventueel onboarding-tip op pick-overview als `usePickers().data.length === 0`.

6. **Factuur-keten-test op staging** — alleen draaien als `factuur-verzenden`-edge function actief is op staging (env vars + Resend-keys). Anders blijft de queue staan en is dat geen regressie.

7. **Tests vereisen schemalaag van staging** — contract-tests gaan tegen Supabase-staging, niet lokale DB. Verifieer dat `frontend/.env.test` (of equivalent) naar het juiste project wijst.

---

## Definition of Done

- [ ] Mig 214 + 215 toegepast op staging zonder errors
- [ ] Beide contract-tests groen
- [ ] Smoke-test (Phase 3) doorlopen: order → factuur in één keten
- [ ] Geen achtergebleven `vertegenwoordigers`-table-only calls (alleen via view)
- [ ] Documentatie bijgewerkt: schema + changelog + woordenboek
- [ ] PickerDropdown beschikbaar op alle drie de pick-startpunten (Verzendset, ZendingAanmakenKnop, voltooi-pickronde)
- [ ] ADR-0004 + ADR-0005 status `accepted` (al vastgelegd) en gerefereerd vanuit data-woordenboek
- [ ] Branch gemerged in main, feature-branch verwijderd
