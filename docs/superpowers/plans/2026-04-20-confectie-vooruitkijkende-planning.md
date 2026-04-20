# Confectie Vooruitkijkende Planning — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maak de confectie-planning vooruitkijkend — stukken verschijnen in de planning zodra ze deel uitmaken van een snijplan (nog vóór ze zijn gesneden), zodat de confectie-afdeling capaciteitsproblemen weken van tevoren ziet en werk per afwerkingsmethode kan voorsorteren.

**Architecture:** Eén gedeelde data-bron (`snijplannen`) voor zowel lijst als planning. Een nieuwe view `confectie_planning_forward` levert alle niet-afgeronde maatwerk-stukken (status `Gepland` → `In confectie`) met hun afgeleide `type_bewerking` via een expliciete mapping op `afwerking_types`. De view is **backward compatible**: kolommen die de bestaande `ConfectiePlanningRow`-components gebruiken (`confectie_id`, `confectie_nr`, `status`, `confectie_afgerond_op`, `ingepakt_op`, `locatie`, `snij_lengte_cm`, `snij_breedte_cm`) zijn aliassen op snijplan-velden. Frontend planning krijgt een meerweekse horizon met capaciteitsbalken per lane. Status-transities lopen via twee idempotente RPC's (`start_confectie`, `voltooi_confectie`).

**Tech Stack:** PostgreSQL (Supabase), TypeScript, React 18, TanStack Query, Vitest, TailwindCSS.

---

## Scope-afbakening

**In scope:**
- Mapping `afwerking_types.code` → `confectie_werktijden.type_bewerking`
- Vooruitkijkende view die álle open maatwerk-stukken levert
- Capaciteit per lane (aantal parallelle werkplekken) configureerbaar
- Planning-UI met week-vooruit-selector + bezettingsgraad per week per lane
- RPC's voor status-transities (Gesneden→In confectie→Gereed)

**Niet in scope (latere iteraties):**
- Confectie-scan workflow (barcode starten/afronden per stuk) — blijft voorlopig op `afrondConfectie()`
- Medewerker-allocatie / urenregistratie per stuk
- Legacy `confectie_orders`-tabel opruimen (blijft bestaan, wordt niet meer gebruikt door nieuwe view)
- Pick & Ship (aparte module)

**Sleutelbeslissingen:**
- **Bron = `snijplannen`**, niet `confectie_orders`. De `confectie_orders`-tabel wordt "dormant" — de nieuwe forward-view gebruikt hem niet. Opruimen volgt in een aparte cleanup-iteratie wanneer geen frontend-code hem meer leest.
- **Mapping op `afwerking_types`** in plaats van een losse lookup-tabel. Zo blijft de bron-of-truth bij de afwerkingsdefinitie en voorkomen we een derde tabel die in sync moet blijven.
- **"Gepland" tellen als confectie-werk-in-wachtrij.** Zodra er een snijplan met status `Gepland` bestaat, plannen we de confectie-slot alvast op basis van (geschatte) snij-einddatum + logistieke buffer. Dit geeft weken-vooruit zicht.

---

## File Structure

**Database (nieuw):**
- `supabase/migrations/096_afwerking_type_bewerking_mapping.sql` — kolom + FK + seed
- `supabase/migrations/097_confectie_werktijden_capaciteit.sql` — capaciteitskolommen
- `supabase/migrations/098_confectie_planning_forward_view.sql` — forward-looking view
- `supabase/migrations/099_confectie_status_rpcs.sql` — start_confectie + voltooi_confectie

**Frontend (wijzigen):**
- `frontend/src/lib/supabase/queries/confectie-planning.ts` — nieuwe interface + fetch
- `frontend/src/hooks/use-confectie-planning.ts` — nieuwe hook voor forward-view
- `frontend/src/pages/confectie/confectie-planning.tsx` — week-selector + capaciteitsbalken
- `frontend/src/components/confectie/lane-kolom.tsx` — bezettings-badge per week
- `frontend/src/components/confectie/capaciteit-balk.tsx` — **nieuw** (presentational)
- `frontend/src/components/confectie/week-selector.tsx` — **nieuw** (1/2/4/8 weken)
- `frontend/src/components/confectie/confectie-tijden-config.tsx` — extra velden

**Frontend (nieuw, tests):**
- `frontend/src/components/confectie/__tests__/capaciteit-balk.test.tsx`
- `frontend/src/lib/utils/__tests__/bereken-lanes-forward.test.ts`

**Docs (bijwerken):**
- `docs/database-schema.md`
- `docs/architectuur.md`
- `docs/changelog.md`
- `CLAUDE.md` (bedrijfsregel over confectie-workflow)

---

## Vooraf: verifieer test-setup

- [ ] **Check of Vitest is geconfigureerd**

Run: `cd frontend && npm test -- --run --reporter=dot 2>&1 | head -20`
Expected: Of een run zonder tests ("no tests found") óf bestaande tests die slagen. Als `vitest: command not found` → eerst setup toevoegen en apart committen.

- [ ] **Check of we op `main` staan en werkdirectory schoon is (mag eventueel in worktree)**

Run: `git status --short`
Expected: Alleen de gedeletede migraties 062-088 (staande `D` in `git status`). Deze staande deletions zijn legacy-opruiming en blijven buiten dit plan.

---

## Task 1: Mapping `maatwerk_afwerking` → `type_bewerking` op `afwerking_types`

**Doel:** Eén kolom op `afwerking_types` die per afwerkingscode (B/FE/LO/...) verwijst naar het bijbehorende `type_bewerking` in `confectie_werktijden`. Codes zonder confectie-werk (ON, ZO) krijgen NULL.

**Files:**
- Create: `supabase/migrations/096_afwerking_type_bewerking_mapping.sql`
- Modify: `docs/database-schema.md` (sectie `afwerking_types`)

- [ ] **Step 1: Schrijf de migratie**

```sql
-- 096_afwerking_type_bewerking_mapping.sql
-- Koppelt afwerkingscode (B/FE/LO/SB/SF/VO/ON/ZO) aan type_bewerking
-- (breedband/smalband/feston/...) zodat de confectie-planning per stuk
-- kan deriveren welke lane/station het werk krijgt.

ALTER TABLE afwerking_types
  ADD COLUMN IF NOT EXISTS type_bewerking TEXT
    REFERENCES confectie_werktijden(type_bewerking) ON UPDATE CASCADE;

COMMENT ON COLUMN afwerking_types.type_bewerking IS
  'Verwijzing naar confectie_werktijden.type_bewerking. NULL = geen confectie-werk (alleen stickeren).';

-- Seed bestaande codes. ON en ZO → NULL (stickeren, geen lane).
UPDATE afwerking_types SET type_bewerking = 'breedband'        WHERE code = 'B';
UPDATE afwerking_types SET type_bewerking = 'smalband'         WHERE code = 'SB';
UPDATE afwerking_types SET type_bewerking = 'feston'           WHERE code = 'FE';
UPDATE afwerking_types SET type_bewerking = 'smalfeston'       WHERE code = 'SF';
UPDATE afwerking_types SET type_bewerking = 'locken'           WHERE code = 'LO';
UPDATE afwerking_types SET type_bewerking = 'volume afwerking' WHERE code = 'VO';
UPDATE afwerking_types SET type_bewerking = NULL               WHERE code IN ('ON', 'ZO');
```

- [ ] **Step 2: Migratie toepassen**

Run: `npx supabase db push` (of: apply via MCP `mcp__claude_ai_Supabase__apply_migration`).
Expected: `Applying migration 096_afwerking_type_bewerking_mapping.sql... done`.

- [ ] **Step 3: Verifieer met query**

Run:
```sql
SELECT code, naam, type_bewerking FROM afwerking_types ORDER BY volgorde;
```
Expected: Alle 8 codes terug, B→breedband, SB→smalband, FE→feston, SF→smalfeston, LO→locken, VO→volume afwerking, ON→NULL, ZO→NULL.

- [ ] **Step 4: Update `docs/database-schema.md`**

Voeg toe in de `afwerking_types` tabelrij:
```
| type_bewerking | TEXT FK → confectie_werktijden.type_bewerking | Lane waar dit afwerkingstype wordt gedaan. NULL = geen confectie (alleen stickeren). |
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/096_afwerking_type_bewerking_mapping.sql docs/database-schema.md
git commit -m "feat(confectie): koppel afwerkingscode aan type_bewerking lane"
```

---

## Task 2: Capaciteit per lane op `confectie_werktijden`

**Doel:** Naast minuten_per_meter en wisseltijd ook vastleggen hoeveel parallelle werkplekken een lane heeft. Een lane met 2 werkplekken kan 2× zoveel werk per wall-clock-uur verzetten.

**Files:**
- Create: `supabase/migrations/097_confectie_werktijden_capaciteit.sql`
- Modify: `frontend/src/lib/supabase/queries/confectie-planning.ts`
- Modify: `frontend/src/components/confectie/confectie-tijden-config.tsx`
- Modify: `docs/database-schema.md`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- 097_confectie_werktijden_capaciteit.sql
-- Parallelle werkplekken per lane: maakt planning schaalbaar naar 2+ man
-- achter een station zonder het minuten-model aan te passen.

ALTER TABLE confectie_werktijden
  ADD COLUMN IF NOT EXISTS parallelle_werkplekken INTEGER NOT NULL DEFAULT 1
    CHECK (parallelle_werkplekken >= 1);

COMMENT ON COLUMN confectie_werktijden.parallelle_werkplekken IS
  'Aantal werkplekken dat parallel aan dit type_bewerking kan werken. ≥1. Planning rekent beschikbare werkminuten × dit getal.';
```

- [ ] **Step 2: Migratie toepassen**

Run: `npx supabase db push`
Expected: `Applying migration 097_... done`.

- [ ] **Step 3: Verifieer met query**

```sql
SELECT type_bewerking, minuten_per_meter, wisseltijd_minuten, parallelle_werkplekken, actief
FROM confectie_werktijden ORDER BY type_bewerking;
```
Expected: alle rijen hebben `parallelle_werkplekken = 1`.

- [ ] **Step 4: Interface uitbreiden**

In `frontend/src/lib/supabase/queries/confectie-planning.ts`:

```typescript
export interface ConfectieWerktijd {
  type_bewerking: string
  minuten_per_meter: number
  wisseltijd_minuten: number
  parallelle_werkplekken: number
  actief: boolean
  bijgewerkt_op: string | null
}

// Breid updateConfectieWerktijd uit:
export async function updateConfectieWerktijd(
  type_bewerking: string,
  velden: Partial<Pick<ConfectieWerktijd,
    'minuten_per_meter' | 'wisseltijd_minuten' | 'parallelle_werkplekken' | 'actief'
  >>,
): Promise<ConfectieWerktijd> {
  // ... ongewijzigd
}
```

- [ ] **Step 5: Config-UI uitbreiden**

In `frontend/src/components/confectie/confectie-tijden-config.tsx`, voeg een input-kolom toe voor `parallelle_werkplekken` (integer, min=1). Plaats vóór de `actief`-checkbox. Follow het bestaande patroon van `minuten_per_meter`:

```tsx
<td className="py-2 px-3">
  <input
    type="number"
    min={1}
    step={1}
    value={w.parallelle_werkplekken}
    onChange={(e) => {
      const val = parseInt(e.target.value, 10)
      if (Number.isFinite(val) && val >= 1) {
        patch(w.type_bewerking, { parallelle_werkplekken: val })
      }
    }}
    className="w-16 px-2 py-1 border border-slate-200 rounded text-sm tabular-nums"
  />
</td>
```

Voeg bijpassende `<th>Werkplekken</th>` toe in de header.

- [ ] **Step 6: Handmatige rooktest**

Run: `cd frontend && npm run dev`
Navigeer naar systeem-instellingen → confectie-werktijden. Verhoog `parallelle_werkplekken` voor 'breedband' naar 2, bewaar, ververs. Expected: waarde is persistent.

- [ ] **Step 7: Update `docs/database-schema.md`**

In sectie `confectie_werktijden`: voeg rij toe:
```
| parallelle_werkplekken | INTEGER NOT NULL DEFAULT 1 | Aantal parallelle werkplekken. Planning rekent beschikbare minuten × dit getal per week. |
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/097_confectie_werktijden_capaciteit.sql \
        frontend/src/lib/supabase/queries/confectie-planning.ts \
        frontend/src/components/confectie/confectie-tijden-config.tsx \
        docs/database-schema.md
git commit -m "feat(confectie): capaciteit per lane instelbaar (parallelle werkplekken)"
```

---

## Task 3: Forward-looking view `confectie_planning_forward`

**Doel:** Eén view die álle open maatwerk-stukken levert (snijplan.status IN Gepland/Wacht/Snijden/Gesneden/In confectie) met het afgeleide `type_bewerking`, een geschatte `confectie_startdatum` en de strekkende meter. Bron = `snijplannen` + `afwerking_types` (voor mapping) + `orders`/`order_regels` (voor klant/afleverdatum) + `rollen` (voor rolnummer).

**Planning-logica (voor `confectie_startdatum`):**
- `Gesneden`/`In confectie` → direct beschikbaar (=vandaag)
- `Snijden` → vandaag (bijna klaar)
- `Gepland`/`Wacht` → `COALESCE(snijplan.gesneden_datum, afleverdatum − 2 werkdagen buffer, vandaag)`. Simpel gehouden: de backend geeft één bestgok-datum, frontend kan dat verfijnen.

**Files:**
- Create: `supabase/migrations/098_confectie_planning_forward_view.sql`
- Modify: `docs/database-schema.md`

- [ ] **Step 1: Schrijf de view**

```sql
-- 098_confectie_planning_forward_view.sql
-- Vooruitkijkende confectie-planning: álle niet-afgehandelde maatwerk-stukken
-- (inclusief Gepland/Wacht/Snijden) met hun lane (type_bewerking) en verwachte
-- startdatum voor confectie-werk. Bron: snijplannen (geen confectie_orders).
--
-- Backward-compatible: levert óók de kolomnamen die de bestaande
-- ConfectiePlanningRow-components (LaneKolom/ConfectieBlokCard/AfrondModal)
-- en de SnijplanRow-based overview-tabel verwachten. Dit vermijdt een
-- generieke type-refactor van die components in deze iteratie.

CREATE OR REPLACE VIEW confectie_planning_forward AS
SELECT
  -- Primaire identifiers (nieuwe namen)
  sp.id                                 AS snijplan_id,
  sp.snijplan_nr                        AS snijplan_nr,
  sp.scancode                           AS scancode,
  sp.status                             AS snijplan_status,
  -- Alias-kolommen zodat bestaande components blijven werken
  sp.id                                 AS confectie_id,     -- alias voor LaneKolom-key
  sp.snijplan_nr                        AS confectie_nr,     -- alias voor AfrondModal
  sp.status                             AS status,           -- alias voor overview-tabel
  -- Lane + derived velden
  at.type_bewerking                     AS type_bewerking,
  sp.order_regel_id                     AS order_regel_id,
  orr.order_id                          AS order_id,
  o.order_nr                            AS order_nr,
  d.naam                                AS klant_naam,
  orr.maatwerk_afwerking                AS maatwerk_afwerking,
  orr.maatwerk_band_kleur               AS maatwerk_band_kleur,
  orr.maatwerk_instructies              AS maatwerk_instructies,
  orr.maatwerk_vorm                     AS maatwerk_vorm,    -- overview-kolom
  orr.maatwerk_vorm                     AS vorm,             -- planning-kolom
  COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm)   AS lengte_cm,
  COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm) AS breedte_cm,
  -- Aliassen voor overview-tabel (SnijplanRow.snij_*)
  COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm)   AS snij_lengte_cm,
  COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm) AS snij_breedte_cm,
  -- Strekkende meter (2×(l+b) in cm, rond/ovaal: π×max(l,b))
  CASE
    WHEN lower(COALESCE(orr.maatwerk_vorm, '')) IN ('rond', 'ovaal') THEN
      (pi() * GREATEST(COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm, 0),
                       COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm, 0)))::numeric
    ELSE
      (2 * (COALESCE(sp.lengte_cm, orr.maatwerk_lengte_cm, 0) +
            COALESCE(sp.breedte_cm, orr.maatwerk_breedte_cm, 0)))::numeric
  END                                   AS strekkende_meter_cm,
  r.id                                  AS rol_id,
  r.rolnummer                           AS rolnummer,
  orr.maatwerk_kwaliteit_code           AS kwaliteit_code,
  orr.maatwerk_kleur_code               AS kleur_code,
  sp.afleverdatum                       AS afleverdatum,
  -- Afrond-velden (aliassen direct van snijplannen)
  sp.confectie_afgerond_op              AS confectie_afgerond_op,
  sp.ingepakt_op                        AS ingepakt_op,
  sp.locatie                            AS locatie,
  -- Beste gok wanneer het stuk de confectie binnenkomt
  CASE
    WHEN sp.status IN ('Gesneden', 'In confectie') THEN CURRENT_DATE
    WHEN sp.status = 'Snijden' THEN CURRENT_DATE
    WHEN sp.gesneden_datum IS NOT NULL THEN sp.gesneden_datum
    WHEN sp.afleverdatum IS NOT NULL THEN sp.afleverdatum - INTERVAL '2 days'
    ELSE CURRENT_DATE
  END::date                             AS confectie_startdatum,
  sp.opmerkingen                        AS opmerkingen
FROM snijplannen sp
LEFT JOIN order_regels orr  ON orr.id  = sp.order_regel_id
LEFT JOIN orders o          ON o.id    = orr.order_id
LEFT JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN rollen r          ON r.id    = sp.rol_id
LEFT JOIN afwerking_types at ON at.code = orr.maatwerk_afwerking
WHERE sp.status IN ('Gepland', 'Wacht', 'Snijden', 'Gesneden', 'In confectie', 'Ingepakt');

COMMENT ON VIEW confectie_planning_forward IS
  'Vooruitkijkende confectie-lijst: alle open maatwerk-snijplannen met afgeleide type_bewerking en verwachte confectie-startdatum. Biedt zowel nieuwe (snijplan_*) als legacy (confectie_*, snij_*) kolomnamen voor backward compatibility.';
```

**Opmerking over kolommen op `snijplannen`:** Dit plan gaat ervan uit dat `snijplannen` de kolommen `confectie_afgerond_op`, `ingepakt_op` en `locatie` al heeft (de bestaande `afrondConfectie()` schrijft ernaar). Verifieer vóór commit:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'snijplannen'
  AND column_name IN ('confectie_afgerond_op', 'ingepakt_op', 'locatie');
```
Als één ontbreekt, voeg vóór de `CREATE OR REPLACE VIEW` toe:
```sql
ALTER TABLE snijplannen
  ADD COLUMN IF NOT EXISTS confectie_afgerond_op TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ingepakt_op           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locatie               TEXT;
```

- [ ] **Step 2: Migratie toepassen**

Run: `npx supabase db push`
Expected: `Applying migration 098_... done`.

- [ ] **Step 3: Rooktest view**

Run:
```sql
SELECT type_bewerking, count(*)
FROM confectie_planning_forward
GROUP BY type_bewerking
ORDER BY 2 DESC;
```
Expected: niet-leeg als er open maatwerk-orders zijn; som = aantal open maatwerk-snijplannen. Stukken met afwerking ON/ZO krijgen `type_bewerking = NULL` (vallen later in "alleen stickeren"-sectie).

- [ ] **Step 4: Update `docs/database-schema.md`**

In de sectie Views, voeg rij toe:
```
| confectie_planning_forward | Vooruitkijkende confectie-planning — alle open maatwerk-snijplannen (Gepland..In confectie) met afgeleide type_bewerking + confectie_startdatum |
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/098_confectie_planning_forward_view.sql docs/database-schema.md
git commit -m "feat(confectie): forward-looking view met alle open maatwerk-stukken"
```

---

## Task 4: Frontend-queries + hook voor forward-view

**Doel:** Type-definitie + hook die de nieuwe view leest en cachet.

**Files:**
- Modify: `frontend/src/lib/supabase/queries/confectie-planning.ts`
- Modify: `frontend/src/hooks/use-confectie-planning.ts`

- [ ] **Step 1: Type + fetch toevoegen**

Voeg toe in `confectie-planning.ts`:

```typescript
export interface ConfectiePlanningForwardRow {
  // Primaire identifiers
  snijplan_id: number
  snijplan_nr: string
  scancode: string | null
  snijplan_status: string
  // Backward-compat aliassen (voor bestaande LaneKolom/AfrondModal/overview)
  confectie_id: number          // = snijplan_id
  confectie_nr: string           // = snijplan_nr
  status: string                 // = snijplan_status
  snij_lengte_cm: number | null  // = lengte_cm
  snij_breedte_cm: number | null // = breedte_cm
  maatwerk_vorm: string | null   // = vorm (andere alias)
  // Lane + derived
  type_bewerking: string | null
  order_regel_id: number
  order_id: number
  order_nr: string
  klant_naam: string | null
  maatwerk_afwerking: string | null
  maatwerk_band_kleur: string | null
  maatwerk_instructies: string | null
  vorm: string | null
  lengte_cm: number | null
  breedte_cm: number | null
  strekkende_meter_cm: number | null
  rol_id: number | null
  rolnummer: string | null
  kwaliteit_code: string | null
  kleur_code: string | null
  afleverdatum: string | null
  // Afrond-velden
  confectie_afgerond_op: string | null
  ingepakt_op: string | null
  locatie: string | null
  // Vooruitkijk
  confectie_startdatum: string
  opmerkingen: string | null
}

export async function fetchConfectiePlanningForward(): Promise<ConfectiePlanningForwardRow[]> {
  const { data, error } = await supabase
    .from('confectie_planning_forward')
    .select('*')
    .order('confectie_startdatum', { ascending: true })
  if (error) throw error
  return (data ?? []) as ConfectiePlanningForwardRow[]
}
```

- [ ] **Step 2: Hook toevoegen**

In `frontend/src/hooks/use-confectie-planning.ts`:

```typescript
export function useConfectiePlanningForward() {
  return useQuery({
    queryKey: ['confectie', 'planning-forward'],
    queryFn: fetchConfectiePlanningForward,
    staleTime: 30_000,
  })
}
```

(Zorg dat `fetchConfectiePlanningForward` geïmporteerd is uit `@/lib/supabase/queries/confectie-planning`.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: geen errors (alleen eventuele bekende legacy-warnings die er al stonden).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/supabase/queries/confectie-planning.ts \
        frontend/src/hooks/use-confectie-planning.ts
git commit -m "feat(confectie): query + hook voor forward planning view"
```

---

## Task 5: Meerweekse lanes-planner met capaciteit

**Doel:** Een nieuwe pure helper die items groepeert per lane + per week en de bezetting (benodigd / beschikbaar) uitrekent, rekening houdend met `parallelle_werkplekken` per lane.

**Files:**
- Create: `frontend/src/lib/utils/confectie-forward-planner.ts`
- Create: `frontend/src/lib/utils/__tests__/confectie-forward-planner.test.ts`

- [ ] **Step 1: Schrijf de test eerst**

```typescript
// confectie-forward-planner.test.ts
import { describe, it, expect } from 'vitest'
import { groepeerPerLaneEnWeek, bezettingPerWeek } from '../confectie-forward-planner'
import type { ConfectiePlanningForwardRow } from '@/lib/supabase/queries/confectie-planning'

const basisRow: ConfectiePlanningForwardRow = {
  snijplan_id: 1,
  snijplan_nr: 'SNIJ-2026-0001',
  scancode: null,
  snijplan_status: 'Gepland',
  type_bewerking: 'breedband',
  order_regel_id: 1,
  order_id: 1,
  order_nr: 'ORD-2026-0001',
  klant_naam: 'TESTKLANT',
  maatwerk_afwerking: 'B',
  maatwerk_band_kleur: null,
  maatwerk_instructies: null,
  vorm: 'rechthoek',
  lengte_cm: 300,
  breedte_cm: 200,
  strekkende_meter_cm: 1000, // 10 m
  rol_id: null,
  rolnummer: null,
  kwaliteit_code: 'MIRA',
  kleur_code: '12',
  afleverdatum: null,
  confectie_startdatum: '2026-04-20', // maandag week 17
  opmerkingen: null,
}

describe('groepeerPerLaneEnWeek', () => {
  it('groepeert één item op juiste lane + isoweek', () => {
    const map = groepeerPerLaneEnWeek([basisRow])
    expect(map.get('breedband')?.get('2026-W17')).toHaveLength(1)
  })

  it('stopt rijen zonder type_bewerking in de "geen-lane" bucket', () => {
    const zonder = { ...basisRow, type_bewerking: null, maatwerk_afwerking: 'ON' }
    const map = groepeerPerLaneEnWeek([zonder])
    expect(map.get('__geen_lane__')?.get('2026-W17')).toHaveLength(1)
  })
})

describe('bezettingPerWeek', () => {
  it('rekent benodigde minuten = (meters × minuten_per_meter) + wisseltijd per stuk', () => {
    const rows = [basisRow] // 10 m
    const werktijden = { minuten_per_meter: 3, wisseltijd_minuten: 5, parallelle_werkplekken: 1 }
    const beschikbaar = 2400 // 5 werkdagen × 480 min
    const bez = bezettingPerWeek(rows, werktijden, beschikbaar)
    expect(bez.nodigMin).toBe(35) // 10*3 + 5
    expect(bez.beschikbaarMin).toBe(2400)
    expect(bez.overload).toBe(false)
  })

  it('signaleert overload wanneer nodig > beschikbaar × werkplekken', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...basisRow, snijplan_id: i }))
    const werktijden = { minuten_per_meter: 10, wisseltijd_minuten: 5, parallelle_werkplekken: 1 }
    const beschikbaar = 1000
    const bez = bezettingPerWeek(rows, werktijden, beschikbaar)
    expect(bez.overload).toBe(true)
  })

  it('schaalt beschikbare tijd met parallelle_werkplekken', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ ...basisRow, snijplan_id: i }))
    const werktijden = { minuten_per_meter: 10, wisseltijd_minuten: 5, parallelle_werkplekken: 2 }
    const beschikbaar = 1000
    // nodig: 50 × (10*10 + 5) = 5250 ; beschikbaar*2 = 2000 ; overload=true
    // verlaag stukken naar 10
    const rows2 = rows.slice(0, 10)
    const bez2 = bezettingPerWeek(rows2, werktijden, beschikbaar)
    expect(bez2.nodigMin).toBe(1050)
    expect(bez2.beschikbaarMin).toBe(2000) // 1000 × 2
    expect(bez2.overload).toBe(false)
  })
})
```

- [ ] **Step 2: Draai de test, verifieer dat hij faalt**

Run: `cd frontend && npx vitest run src/lib/utils/__tests__/confectie-forward-planner.test.ts`
Expected: FAIL — module bestaat nog niet.

- [ ] **Step 3: Implementeer de planner**

```typescript
// frontend/src/lib/utils/confectie-forward-planner.ts
import type { ConfectiePlanningForwardRow } from '@/lib/supabase/queries/confectie-planning'

const GEEN_LANE = '__geen_lane__' as const

/** ISO-weeksleutel "YYYY-Www" uit een YYYY-MM-DD datum (canoniek algoritme). */
export function isoWeekKey(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  // Zet d naar de donderdag van diezelfde ISO-week (bepaalt het ISO-jaar)
  const dow = d.getDay() || 7 // zo=7, ma=1, ... za=6
  d.setDate(d.getDate() + 4 - dow)
  const jaar = d.getFullYear()
  const yearStart = new Date(jaar, 0, 1)
  const diffDagen = Math.round((d.getTime() - yearStart.getTime()) / 86400000)
  const week = Math.ceil((diffDagen + 1) / 7)
  return `${jaar}-W${String(week).padStart(2, '0')}`
}

export function groepeerPerLaneEnWeek(
  rows: ConfectiePlanningForwardRow[],
): Map<string, Map<string, ConfectiePlanningForwardRow[]>> {
  const result = new Map<string, Map<string, ConfectiePlanningForwardRow[]>>()
  for (const r of rows) {
    const lane = r.type_bewerking ?? GEEN_LANE
    const week = isoWeekKey(r.confectie_startdatum)
    let perWeek = result.get(lane)
    if (!perWeek) {
      perWeek = new Map()
      result.set(lane, perWeek)
    }
    const lijst = perWeek.get(week) ?? []
    lijst.push(r)
    perWeek.set(week, lijst)
  }
  return result
}

export interface LaneWerktijd {
  minuten_per_meter: number
  wisseltijd_minuten: number
  parallelle_werkplekken: number
}

export interface Bezetting {
  nodigMin: number
  beschikbaarMin: number
  overload: boolean
}

export function bezettingPerWeek(
  rows: ConfectiePlanningForwardRow[],
  werktijd: LaneWerktijd,
  werkminutenPerWeek: number,
): Bezetting {
  let nodig = 0
  for (const r of rows) {
    const meters = (r.strekkende_meter_cm ?? 0) / 100
    nodig += meters * werktijd.minuten_per_meter + werktijd.wisseltijd_minuten
  }
  const beschikbaar = werkminutenPerWeek * werktijd.parallelle_werkplekken
  return {
    nodigMin: Math.round(nodig),
    beschikbaarMin: beschikbaar,
    overload: nodig > beschikbaar,
  }
}
```

- [ ] **Step 4: Tests slagen**

Run: `cd frontend && npx vitest run src/lib/utils/__tests__/confectie-forward-planner.test.ts`
Expected: PASS, 4 tests groen.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/utils/confectie-forward-planner.ts \
        frontend/src/lib/utils/__tests__/confectie-forward-planner.test.ts
git commit -m "feat(confectie): forward-planner util met lane/week-bezetting + tests"
```

---

## Task 6: Capaciteitsbalk-component

**Doel:** Visuele balk die per week per lane de bezetting toont (groen/geel/rood).

**Files:**
- Create: `frontend/src/components/confectie/capaciteit-balk.tsx`
- Create: `frontend/src/components/confectie/__tests__/capaciteit-balk.test.tsx`

- [ ] **Step 1: Schrijf component-test**

```tsx
// capaciteit-balk.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CapaciteitBalk } from '../capaciteit-balk'

describe('CapaciteitBalk', () => {
  it('toont groen bij <80% bezetting', () => {
    const { container } = render(
      <CapaciteitBalk nodigMin={100} beschikbaarMin={1000} label="Week 17" />
    )
    expect(container.querySelector('.bg-emerald-500')).toBeTruthy()
    expect(screen.getByText(/10%/)).toBeTruthy()
  })

  it('toont amber bij 80-100% bezetting', () => {
    const { container } = render(
      <CapaciteitBalk nodigMin={900} beschikbaarMin={1000} label="Week 17" />
    )
    expect(container.querySelector('.bg-amber-500')).toBeTruthy()
  })

  it('toont rood + percentage > 100 bij overload', () => {
    const { container } = render(
      <CapaciteitBalk nodigMin={1500} beschikbaarMin={1000} label="Week 17" />
    )
    expect(container.querySelector('.bg-red-500')).toBeTruthy()
    expect(screen.getByText(/150%/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Installeer test-deps als ze ontbreken**

Run: `cd frontend && npm ls @testing-library/react`
Als niet aanwezig: `npm install -D @testing-library/react @testing-library/jest-dom jsdom` en voeg `environment: 'jsdom'` toe aan vitest config.

- [ ] **Step 3: Draai de test, verifieer failure**

Run: `cd frontend && npx vitest run src/components/confectie/__tests__/capaciteit-balk.test.tsx`
Expected: FAIL — component bestaat niet.

- [ ] **Step 4: Implementeer component**

```tsx
// frontend/src/components/confectie/capaciteit-balk.tsx
import { cn } from '@/lib/utils/cn'

export interface CapaciteitBalkProps {
  nodigMin: number
  beschikbaarMin: number
  label: string
}

export function CapaciteitBalk({ nodigMin, beschikbaarMin, label }: CapaciteitBalkProps) {
  const pct = beschikbaarMin > 0 ? (nodigMin / beschikbaarMin) * 100 : 0
  const overload = pct > 100
  const druk = pct >= 80 && pct <= 100
  const kleur = overload ? 'bg-red-500' : druk ? 'bg-amber-500' : 'bg-emerald-500'
  const weergavePct = Math.round(pct)
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-slate-500 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn('h-full transition-all', kleur)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className={cn('w-12 text-right tabular-nums', overload && 'text-red-600 font-medium')}>
        {weergavePct}%
      </span>
    </div>
  )
}
```

- [ ] **Step 5: Tests slagen**

Run: `cd frontend && npx vitest run src/components/confectie/__tests__/capaciteit-balk.test.tsx`
Expected: PASS, 3 tests groen.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/confectie/capaciteit-balk.tsx \
        frontend/src/components/confectie/__tests__/capaciteit-balk.test.tsx
git commit -m "feat(confectie): capaciteitsbalk-component + tests"
```

---

## Task 7: Week-selector component

**Doel:** Simpele tab-rij "Deze week | +2 wk | +4 wk | +8 wk" die een horizon-waarde teruggeeft.

**Files:**
- Create: `frontend/src/components/confectie/week-selector.tsx`

- [ ] **Step 1: Implementeer**

```tsx
// frontend/src/components/confectie/week-selector.tsx
import { cn } from '@/lib/utils/cn'

export type HorizonWeken = 1 | 2 | 4 | 8

export const HORIZON_OPTIES: Array<{ waarde: HorizonWeken; label: string }> = [
  { waarde: 1, label: 'Deze week' },
  { waarde: 2, label: '2 weken' },
  { waarde: 4, label: '4 weken' },
  { waarde: 8, label: '8 weken' },
]

export function WeekSelector({
  waarde,
  onChange,
}: {
  waarde: HorizonWeken
  onChange: (w: HorizonWeken) => void
}) {
  return (
    <div className="inline-flex rounded-[var(--radius)] border border-slate-200 bg-white p-0.5">
      {HORIZON_OPTIES.map((o) => {
        const active = o.waarde === waarde
        return (
          <button
            key={o.waarde}
            onClick={() => onChange(o.waarde)}
            className={cn(
              'px-3 py-1.5 text-xs rounded transition-colors',
              active
                ? 'bg-terracotta-50 text-terracotta-700 font-medium'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/confectie/week-selector.tsx
git commit -m "feat(confectie): week-horizon-selector"
```

---

## Task 8: Planning-pagina aansluiten op forward-view

**Doel:** `confectie-planning.tsx` herschrijven om de nieuwe forward-view + per-week-bezetting te tonen. Horizon default = 4 weken. Elk item krijgt een status-badge (Gepland/Snijden/Gesneden/In confectie) zodat medewerkers zien wat al klaar ligt vs. wat nog gesneden moet worden.

**Compatibility-hack:** `LaneKolom`, `ConfectieBlokCard` en `AfrondModal` blijven ongewijzigd. Ze accepteren `ConfectiePlanningRow`, en `ConfectiePlanningForwardRow` is een **superset** (zie Task 4) — de aliassen `confectie_id`, `confectie_nr`, `status`, `confectie_afgerond_op`, `ingepakt_op`, `locatie` leveren dezelfde velden die ze nodig hebben. Bij doorgeven casten we naar `ConfectiePlanningRow` via een structureel-compatible type-assertion.

**Files:**
- Modify: `frontend/src/pages/confectie/confectie-planning.tsx`
- Modify: `frontend/src/components/confectie/lane-kolom.tsx`

- [ ] **Step 1: Lane-kolom component uitbreiden met bezetting**

In `lane-kolom.tsx`: voeg een optionele prop `bezettingen?: Array<{ weekLabel: string; nodigMin: number; beschikbaarMin: number }>` toe. Render die bovenaan de kolom (boven de titel) met `CapaciteitBalk` per week. Geen wijziging aan de `blokken`-prop zelf — de forward-rows worden vóór doorgeven gecast naar `ConfectiePlanningRow`.

Oude aanroepen zonder `bezettingen` blijven werken (prop is optioneel).

- [ ] **Step 2: Planning-pagina omschakelen**

Vervang de top van `confectie-planning.tsx` met deze structuur:

```tsx
import { useMemo, useState } from 'react'
// ... bestaande imports
import { WeekSelector, type HorizonWeken } from '@/components/confectie/week-selector'
import { useConfectiePlanningForward } from '@/hooks/use-confectie-planning'
import {
  groepeerPerLaneEnWeek,
  bezettingPerWeek,
  isoWeekKey,
} from '@/lib/utils/confectie-forward-planner'
import { werkminutenTussen } from '@/lib/utils/bereken-agenda'

export function ConfectiePlanningPage() {
  const [werktijden] = useWerktijden()
  const [horizon, setHorizon] = useState<HorizonWeken>(4)
  const { data: forward, isLoading: fwLoading } = useConfectiePlanningForward()
  const { data: werktijdenConfig, isLoading: tijdenLoading } = useConfectieWerktijden()

  const tijdenMap = useMemo(() => {
    const map = new Map<string, ConfectieWerktijd>()
    for (const w of werktijdenConfig ?? []) map.set(w.type_bewerking, w)
    return map
  }, [werktijdenConfig])

  const weekLabels = useMemo(() => berekenWeeksInHorizon(horizon), [horizon])

  const laneData = useMemo(() => {
    const perLane = groepeerPerLaneEnWeek(forward ?? [])
    const result: Array<{
      type: string
      weken: Array<{ weekLabel: string; bezetting: Bezetting; items: ConfectiePlanningForwardRow[] }>
    }> = []
    for (const [lane, perWeek] of perLane) {
      if (lane === '__geen_lane__') continue
      const cfg = tijdenMap.get(lane)
      if (!cfg || !cfg.actief) continue
      const weken = weekLabels.map((weekLabel) => {
        const items = perWeek.get(weekLabel) ?? []
        const beschikbaar = werkminutenInWeek(weekLabel, werktijden)
        const bezetting = bezettingPerWeek(items, cfg, beschikbaar)
        return { weekLabel, bezetting, items }
      })
      result.push({ type: lane, weken })
    }
    // Sort lanes volgens configured volgorde of alfabetisch
    return result.sort((a, b) => a.type.localeCompare(b.type))
  }, [forward, tijdenMap, weekLabels, werktijden])

  const geenLane = useMemo(() => {
    const perLane = groepeerPerLaneEnWeek(forward ?? [])
    const perWeek = perLane.get('__geen_lane__') ?? new Map()
    const alle: ConfectiePlanningForwardRow[] = []
    for (const [, items] of perWeek) alle.push(...items)
    return alle
  }, [forward])

  // ... resterende render: één LaneKolom per lane-entry met weekbalken bovenaan
}
```

Voeg onderaan `confectie-planning.tsx` twee helpers toe:

```tsx
function toLocalIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function berekenWeeksInHorizon(horizon: HorizonWeken): string[] {
  const vandaag = new Date()
  const weken: string[] = []
  for (let i = 0; i < horizon; i++) {
    const d = new Date(vandaag)
    d.setDate(vandaag.getDate() + i * 7)
    // Local-date formatter voorkomt UTC-drift laat op de dag (CEST → UTC)
    weken.push(isoWeekKey(toLocalIsoDate(d)))
  }
  return Array.from(new Set(weken))
}

function werkminutenInWeek(weekLabel: string, werktijden: Werktijden): number {
  const [jaar, w] = weekLabel.split('-W').map(Number)
  // Start: maandag van die ISO-week
  const jan4 = new Date(jaar, 0, 4)
  const jan4Dow = (jan4.getDay() + 6) % 7 // 0=ma
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - jan4Dow)
  const maandag = new Date(week1Monday)
  maandag.setDate(week1Monday.getDate() + (w - 1) * 7)
  const zondag = new Date(maandag)
  zondag.setDate(maandag.getDate() + 7)
  return werkminutenTussen(maandag, zondag, werktijden)
}
```

- [ ] **Step 3: Typecheck + dev-rooktest**

Run: `cd frontend && npx tsc --noEmit`
Expected: geen errors.

Run: `cd frontend && npm run dev`
Navigeer naar `/confectie/planning`. Verwacht: horizon-selector bovenaan; één kolom per actieve lane; capaciteitsbalken per week binnen elke lane; items onder de balken met status-badge.

- [ ] **Step 4: Lege-staat verifiëren**

Check lege database of filter op een lane zonder werk. Verwacht: "Niets om te plannen in de gekozen horizon" ipv "Geen stukken".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/confectie/confectie-planning.tsx \
        frontend/src/components/confectie/lane-kolom.tsx
git commit -m "feat(confectie): meerweekse planning-horizon met capaciteitsbalken"
```

---

## Task 9: Lijst-tab aansluiten op forward-view

**Doel:** De Lijst-tab toont nu alleen Gesneden/In confectie stukken via `snijplanning_overzicht`. Schakel over naar de forward-view, met filter-keuze bovenaan: "Alleen klaar voor confectie" (default) vs "Alles open (incl. gepland)".

**Files:**
- Modify: `frontend/src/pages/confectie/confectie-overview.tsx`
- Modify: `frontend/src/hooks/use-snijplanning.ts` (verwijder `useConfectielijst` OF markeer deprecated — kies #1 als alleen deze page hem gebruikt)

- [ ] **Step 1: Zoek gebruikers van `useConfectielijst`**

Run: `grep -r useConfectielijst frontend/src`
Actie: als alleen `confectie-overview.tsx` het gebruikt, verwijder de hook + query + sluit aan op forward-view.

- [ ] **Step 2: Overview omschakelen**

Vervang in `confectie-overview.tsx`:
- `useConfectielijst()` → `useConfectiePlanningForward()` (of een afgeleide die snijplan_status ∈ {Gesneden, In confectie} filtert als default)
- Voeg een toggle toe: `<Tabs>` "Klaar voor confectie" | "Alles (incl. gepland)"
- De `groepenPerAfwerking`-logica blijft intact, maar gebruikt `row.maatwerk_afwerking` uit de nieuwe row-shape
- Bewaar kolom `Status` — toont nu ook `Gepland`/`Snijden` voor forward-items

- [ ] **Step 3: Update `fetchConfectielijst` verwijderen (optioneel)**

Als geen andere consumer: verwijder `fetchConfectielijst` uit `snijplanning.ts` en de bijbehorende hook. Voorkom dode code.

- [ ] **Step 4: Typecheck + dev-rooktest**

Run: `cd frontend && npx tsc --noEmit && npm run dev`
Navigeer naar `/confectie`. Verwacht:
- Default toggle = "Klaar voor confectie" → alleen Gesneden/In confectie stukken zichtbaar (gelijk aan oude gedrag)
- Toggle → "Alles (incl. gepland)" → volledige open wachtrij, inclusief Gepland-items met grijze status-badge

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/confectie/confectie-overview.tsx \
        frontend/src/hooks/use-snijplanning.ts \
        frontend/src/lib/supabase/queries/snijplanning.ts
git commit -m "feat(confectie): lijst leest forward-view met filter klaar-vs-alles"
```

---

## Task 10: RPC's voor status-transities

**Doel:** Twee idempotente RPC's die de snijplan-statussen doorzetten. `afrondConfectie()` uit `confectie-planning.ts` blijft werken maar gaat via `voltooi_confectie` ipv directe UPDATE.

**Files:**
- Create: `supabase/migrations/099_confectie_status_rpcs.sql`
- Modify: `frontend/src/lib/supabase/queries/confectie-planning.ts`
- Modify: `docs/database-schema.md`

- [ ] **Step 1: Schrijf de RPC's**

```sql
-- 099_confectie_status_rpcs.sql
-- Idempotente status-transities voor confectie-workflow.

CREATE OR REPLACE FUNCTION start_confectie(p_snijplan_id BIGINT)
RETURNS snijplannen
LANGUAGE plpgsql
AS $$
DECLARE
  v_row snijplannen;
BEGIN
  UPDATE snijplannen
     SET status = 'In confectie'
   WHERE id = p_snijplan_id
     AND status IN ('Gesneden', 'In confectie')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'snijplan % niet in status Gesneden/In confectie (of bestaat niet)', p_snijplan_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION start_confectie(BIGINT) IS
  'Zet snijplan-status op ''In confectie''. Idempotent: accepteert ook wanneer al In confectie.';

CREATE OR REPLACE FUNCTION voltooi_confectie(
  p_snijplan_id BIGINT,
  p_afgerond    BOOLEAN DEFAULT true,
  p_ingepakt    BOOLEAN DEFAULT false,
  p_locatie     TEXT    DEFAULT NULL
)
RETURNS snijplannen
LANGUAGE plpgsql
AS $$
DECLARE
  v_row snijplannen;
  v_nu  TIMESTAMPTZ := NOW();
  v_eff_afgerond BOOLEAN := p_afgerond OR p_ingepakt;  -- ingepakt impliceert afgerond
BEGIN
  UPDATE snijplannen
     SET confectie_afgerond_op = CASE WHEN v_eff_afgerond THEN v_nu ELSE NULL END,
         ingepakt_op           = CASE WHEN p_ingepakt THEN v_nu ELSE NULL END,
         locatie               = CASE
                                   WHEN p_locatie IS NULL THEN locatie
                                   WHEN trim(p_locatie) = '' THEN NULL
                                   ELSE trim(p_locatie)
                                 END,
         status                = CASE
                                   WHEN p_ingepakt THEN 'Gereed'
                                   WHEN v_eff_afgerond THEN 'In confectie'
                                   ELSE 'Gesneden'  -- terug naar Gesneden als afrond teruggedraaid
                                 END
   WHERE id = p_snijplan_id
     AND status IN ('Gesneden', 'In confectie', 'Gereed')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'snijplan % niet in status Gesneden/In confectie/Gereed', p_snijplan_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION voltooi_confectie(BIGINT, BOOLEAN, BOOLEAN, TEXT) IS
  'Rondt confectie af of draait af. p_afgerond=true → confectie_afgerond_op=NOW(); false → clear + status terug naar Gesneden. p_ingepakt=true → status Gereed + ingepakt_op=NOW() (impliceert afgerond). p_locatie="" → clear locatie; NULL → ongemoeid laten. Idempotent.';
```

Let op: de `snijplannen` tabel mist momenteel de kolommen `confectie_afgerond_op`, `ingepakt_op`, `locatie` in de schema-doc regels 377-400, maar de huidige `afrondConfectie()`-code schrijft wel naar die velden. Dit betekent dat ze al bestaan in de database maar niet in de docs.

Verifieer eerst:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'snijplannen'
  AND column_name IN ('confectie_afgerond_op', 'ingepakt_op', 'locatie');
```
Als één van de drie ontbreekt: voeg eerst `ALTER TABLE snijplannen ADD COLUMN ...` toe bovenaan migratie 099.

- [ ] **Step 2: Migratie toepassen**

Run: `npx supabase db push`
Expected: `Applying migration 099_... done`.

- [ ] **Step 3: Rooktest RPC's**

Run (in SQL editor, met een test-snijplan_id):
```sql
SELECT id, status FROM start_confectie(123);
-- p_afgerond=true, p_ingepakt=true, p_locatie='A01-R03'
SELECT id, status, ingepakt_op FROM voltooi_confectie(123, true, true, 'A01-R03');
```
Expected: beide returnen één rij, status gewijzigd zoals verwacht (Gesneden→In confectie→Gereed).

- [ ] **Step 4: `afrondConfectie()` omschakelen naar RPC**

In `frontend/src/lib/supabase/queries/confectie-planning.ts`:

```typescript
export async function afrondConfectie({ snijplan_id, afgerond, ingepakt, locatie }: AfrondConfectieInput) {
  const { data, error } = await supabase.rpc('voltooi_confectie', {
    p_snijplan_id: snijplan_id,
    p_afgerond: afgerond,
    p_ingepakt: ingepakt,
    p_locatie: locatie,
  })
  if (error) throw error
  return data
}

export async function startConfectie(snijplan_id: number) {
  const { data, error } = await supabase.rpc('start_confectie', { p_snijplan_id: snijplan_id })
  if (error) throw error
  return data
}
```

- [ ] **Step 5: Handmatige rooktest van `afrondConfectie` via UI**

Run: `cd frontend && npm run dev`
Open `/confectie/planning`, klik een stuk, rondt af + inpakken. Verwacht: snijplan-status wordt `Gereed`, stuk verdwijnt uit forward-view (status valt buiten de filter).

- [ ] **Step 6: Update `docs/database-schema.md`**

- Breid het functie-overzicht uit met `start_confectie(BIGINT)` en `voltooi_confectie(BIGINT, BOOLEAN, BOOLEAN, TEXT)` (laatste sig: `p_snijplan_id, p_afgerond, p_ingepakt, p_locatie`).
- Voeg aan de `snijplannen`-rijen toe (indien nog niet gedocumenteerd): `confectie_afgerond_op TIMESTAMPTZ`, `ingepakt_op TIMESTAMPTZ`, `locatie TEXT`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/099_confectie_status_rpcs.sql \
        frontend/src/lib/supabase/queries/confectie-planning.ts \
        docs/database-schema.md
git commit -m "feat(confectie): RPC start_confectie + voltooi_confectie, afrondConfectie via RPC"
```

---

## Task 11: Documentatie afmaken

**Files:**
- Modify: `docs/architectuur.md`
- Modify: `docs/changelog.md`
- Modify: `docs/data-woordenboek.md` (licht)
- Modify: `CLAUDE.md` (bedrijfsregel)

- [ ] **Step 1: Architectuur: confectie-flow-blok**

In `docs/architectuur.md` bij `/confectie`: vervang de huidige omschrijving door:

```
/confectie         Confectielijst (stukken te confectioneren)
  /confectie/planning   Meerweekse planning per lane (breedband/smalband/feston/...)
```

Voeg een sectie toe "Confectie workflow":
- Bron-of-truth = `snijplannen`
- Mapping afwerking→lane via `afwerking_types.type_bewerking`
- Forward-view: `confectie_planning_forward`
- RPC's: `start_confectie`, `voltooi_confectie`
- Capaciteit per lane via `confectie_werktijden.parallelle_werkplekken`
- Goldratt TOC-framing: lanes = constraints, bezettingsbalk per week = early warning

- [ ] **Step 2: Changelog**

In `docs/changelog.md` bovenaan:

```markdown
## 2026-04-20 — Confectie vooruitkijkende planning
- `afwerking_types.type_bewerking` kolom + FK naar `confectie_werktijden`
- `confectie_werktijden.parallelle_werkplekken` kolom
- Nieuwe view `confectie_planning_forward` met alle open maatwerk-stukken
- RPC's `start_confectie`, `voltooi_confectie` voor status-transities
- Frontend: week-horizon selector (1/2/4/8 wk), capaciteitsbalken per lane
- `afrondConfectie()` nu via `voltooi_confectie` RPC
- **Waarom:** confectie kon alleen "al gesneden" werk zien — nu zijn overbelaste weken vooraf zichtbaar.
```

- [ ] **Step 3: Data-woordenboek**

Voeg toe onder de bestaande confectie-regel:

```
Confectie-lane: Werkstation voor één type_bewerking (breedband, smalband, feston, smalfeston, locken, volume afwerking). Meerdere parallelle werkplekken mogelijk per lane.
Confectie-horizon: Aantal weken vooruit dat de planning toont (default 4).
Bezetting: Nodig / beschikbaar × 100%. >100% = overload.
```

- [ ] **Step 4: CLAUDE.md bedrijfsregel**

In de sectie "Bedrijfsregels", voeg toe:

```
- **Confectie-planning:** bron is `snijplannen` via view `confectie_planning_forward`. Lane (type_bewerking) wordt afgeleid van `maatwerk_afwerking` via `afwerking_types.type_bewerking`. Afwerkingen `ON`/`ZO` hebben geen lane en verschijnen onder "alleen stickeren". Status-transities lopen via RPC's `start_confectie` en `voltooi_confectie`, niet directe UPDATE.
```

- [ ] **Step 5: Commit docs**

```bash
git add docs/architectuur.md docs/changelog.md docs/data-woordenboek.md CLAUDE.md
git commit -m "docs(confectie): vooruitkijkende planning + lane-concept"
```

---

## Task 12: End-to-end rooktest

**Doel:** Zorg dat de gehele keten werkt in dev, vanaf een nieuwe maatwerk-order tot "Gereed".

- [ ] **Step 1: Start dev-server**

Run: `cd frontend && npm run dev`

- [ ] **Step 2: Maak testorder**

- Maak een order aan met een `is_maatwerk=true` orderregel, afwerking=`B`, lengte=300, breedte=200.
- Verwacht: snijplan wordt auto-aangemaakt (bestaande trigger `auto_maak_snijplan`), status `Wacht`.

- [ ] **Step 3: Controleer forward-view**

Navigeer naar `/confectie/planning`. Verwacht: stuk verschijnt in de `breedband`-lane in de week van `confectie_startdatum`.

- [ ] **Step 4: Doorloop snijden**

Ken een rol toe, markeer als `Gesneden` via scanstation/RPC.
Verwacht: stuk blijft in forward-view, status-badge = `Gesneden`, blijft in dezelfde lane.

- [ ] **Step 5: Rondt af**

Klik in planning-view op het stuk → afrondmodal → "ingepakt" → bevestig.
Verwacht: RPC `voltooi_confectie(..., true, ...)` wordt geroepen, snijplan-status → `Gereed`, stuk verdwijnt uit beide views.

- [ ] **Step 6: Verifieer overload-signaal**

Maak 50 maatwerk-orders in één week met afwerking=`B`.
Verwacht: balk voor die week kleurt rood, percentage >100%.

- [ ] **Step 7: Finale typecheck + tests**

Run:
```bash
cd frontend && npx tsc --noEmit && npx vitest run
```
Expected: groen.

- [ ] **Step 8: Geen commit**

Deze taak is puur verifiërend. Als iets breekt → terug naar de betreffende task.

---

## Afrondings-checklist

- [ ] Alle migraties (096-099) toegepast op productie en doorgezet in `supabase/migrations/`
- [ ] Vitest-tests groen
- [ ] TypeScript check groen
- [ ] Dev-server laat forward-planning zien met week-horizon werkend
- [ ] `docs/database-schema.md`, `docs/architectuur.md`, `docs/changelog.md`, `docs/data-woordenboek.md`, `CLAUDE.md` bijgewerkt
- [ ] Legacy `useConfectielijst` + `fetchConfectielijst` verwijderd of expliciet als deprecated gemarkeerd

---

## Open vragen / later

1. **`confectie_orders`-tabel opruimen.** Na deze implementatie is de tabel dode code. Volgende iteratie: migratie die hem archiveert/drop, na laatste controle dat geen edge-function meer leest.
2. **Medewerker-allocatie per lane** (wie werkt aan welk station) — toekomst.
3. **Automatische `start_confectie`-trigger?** Nu is een stuk pas `In confectie` wanneer een medewerker op "start" drukt in een (nog te bouwen) scanstation. Alternatief: trigger bij eerste keer openen van het stuk in de planning. Hangt af van toekomstige scan-flow.
4. **Per-stuk planningsvenster ipv alleen week-granulariteit.** Nu klumpt de view per ISO-week; een daggrid kan later.
