# Pickbaarheid — Minimum Viable Verticale Integratie (MVI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduceer **Pickbaarheid** als bron-van-waarheid voor "is deze orderregel klaar om uit het magazijn te halen, en zo ja, waar ligt 'ie", en consumeer dit verticaal van DB-view tot Pick & Ship-pagina, voor zowel maatwerk- als standaard-regels.

**Architecture:** Een SQL-view `orderregel_pickbaarheid` aggregeert per `order_regels`-rij de fysieke staat — voor maatwerk uit `snijplannen` (`status='Ingepakt'` + `snijplannen.locatie`), voor standaard via `order_reserveringen` (actieve voorraad-claim) en `rollen.locatie_id → magazijn_locaties.code` met `producten.locatie` als zachte fallback. De Pick & Ship-pagina (zelfde URL/layout van V1) leest deze view en rendert per regel een groen vinkje + locatie of een `Wacht op X`-badge. Locatie-bewerken werkt polymorf: één combobox-component (`MagazijnLocatieEdit`) gevoed door `magazijn_locaties`, met twee schrijf-paden — voor maatwerk text in `snijplannen.locatie`, voor standaard FK in `rollen.locatie_id`. Nieuwe codes worden idempotent aangemaakt via RPC.

**Tech Stack:** PostgreSQL (view + RPC), React + TypeScript, TanStack Query, Vitest.

---

## Context & Referenties

**Pick & Ship V1 (te herwerken, behoudt route+layout):**
- [pick-ship-overview.tsx](frontend/src/pages/pick-ship/pick-ship-overview.tsx)
- [queries/pick-ship.ts](frontend/src/lib/supabase/queries/pick-ship.ts)
- [types/pick-ship.ts](frontend/src/lib/types/pick-ship.ts)
- [order-pick-card.tsx](frontend/src/components/pick-ship/order-pick-card.tsx)
- [locatie-edit.tsx](frontend/src/components/pick-ship/locatie-edit.tsx)
- [hooks/use-pick-ship.ts](frontend/src/hooks/use-pick-ship.ts)
- [pick-ship-buckets.ts](frontend/src/lib/utils/pick-ship-buckets.ts) — bucketing blijft ongewijzigd

**Plan-voorganger:** [2026-05-01-pick-ship-samenvoegen.md](docs/superpowers/plans/2026-05-01-pick-ship-samenvoegen.md)

**Schema-referenties:**
- magazijn_locaties: [database-schema.md:96-105](docs/database-schema.md#L96-L105) — code (UK), omschrijving, type
- rollen.locatie_id: [database-schema.md:229](docs/database-schema.md#L229) — FK bestaat, ongebruikt
- snijplannen.locatie: [database-schema.md:465](docs/database-schema.md#L465) — vrije TEXT
- producten.locatie: [database-schema.md:203](docs/database-schema.md#L203) — vrije TEXT
- order_reserveringen: [database-schema.md:289-302](docs/database-schema.md#L289-L302) — claims-tabel
- snijplan_status enum-waarden: [database-schema.md:814](docs/database-schema.md#L814)
- order_status: [database-schema.md:809](docs/database-schema.md#L809)
- Migratie 168 (al gemerged): `snijplan_locatie` op view `snijplanning_overzicht`

## Design-besluiten (uit conversatie)

1. **A1 — `magazijn_locaties` is bron van locaties.** Tabel + `rollen.locatie_id` FK bestaan al. Geen seed nodig — codes worden on-the-fly aangemaakt via idempotente RPC `create_or_get_magazijn_locatie`. Codes worden genormaliseerd `UPPER + TRIM`.
2. **B1 — Geen backfill.** Bestaande rollen zonder locatie tonen "—". Nieuwe locaties komen via Pick & Ship-edit (V1) en later via `boek_ontvangst` (V2-follow-up).
3. **C1 — `producten.locatie` blijft als zachte fallback.** Pickbaarheid-view valt terug op `producten.locatie` als de gekozen rol geen locatie heeft. Geen migratie weg.
4. **D1 — Pick & Ship V1-layout blijft.** Zelfde route, stat cards, buckets, zoekveld, filter-tabs. Alleen query + types + render veranderen.
5. **E1 — Brede view.** `orderregel_pickbaarheid` toont alle openstaande orderregels (orders met `status NOT IN ('Verzonden','Geannuleerd')`); frontend filtert op `is_pickbaar` + bucket.
6. **Maatwerk-pickbaarheid = ALLE bijbehorende snijplannen status='Ingepakt'.** Een orderregel met 3 stuks waarvan 2 ingepakt + 1 in productie: niet pickbaar, `wacht_op='inpak'`, `pickbaar_stuks=2`, `totaal_stuks=3`.
7. **Standaard-pickbaarheid = actieve voorraad-claim aanwezig.** Pragmatische proxy. Een geclaimde voorraad mag aangenomen worden voldoende; precieze rol-instance volgen is V2.
8. **Locatie standaard-regel = "een willekeurige beschikbare rol-met-locatie van dit artikel" óf `producten.locatie`.** Geen rol-toewijzing per claim in V1.
9. **Eén locatie-edit-component, twee schrijf-paden.** `MagazijnLocatieEdit` doet type-ahead op `magazijn_locaties.code`. Caller geeft `onSave(code)`-callback; hook bepaalt schrijf-pad op basis van `regel.is_maatwerk`.
10. **`boek_ontvangst`-uitbreiding voor inkomende rollen = MVI-V2 follow-up.** Buiten dit plan; V1 vult `magazijn_locaties` via Pick & Ship-bewerkingen door pickers/admin.
11. **Migraties: agent commit, gebruiker past handmatig toe** (Karpi Supabase MCP heeft geen toegang).
12. **Bestanden klein.** Splits zodra >250 regels.

## File Structure

### Create (DB-migraties)
- `supabase/migrations/169_create_or_get_magazijn_locatie.sql` — RPC voor on-the-fly locatie-aanmaak
- `supabase/migrations/170_orderregel_pickbaarheid_view.sql` — nieuwe view

### Create (frontend)
- `frontend/src/lib/supabase/queries/magazijn-locaties.ts` — `fetchMagazijnLocaties`, `createOrGetMagazijnLocatie`
- `frontend/src/hooks/use-magazijn-locaties.ts` — `useMagazijnLocaties`, `useCreateOrGetMagazijnLocatie`
- `frontend/src/components/pick-ship/magazijn-locatie-edit.tsx` — type-ahead combobox

### Modify
- `frontend/src/lib/types/pick-ship.ts` — `PickShipRegel` V2: `is_pickbaar`, `bron`, `wacht_op`, `fysieke_locatie`, varianten-velden
- `frontend/src/lib/supabase/queries/pick-ship.ts` — query op `orderregel_pickbaarheid`-view; nieuwe mutate-helpers (`updateMaatwerkLocatie`, `updateRolLocatieVoorArtikel`)
- `frontend/src/hooks/use-pick-ship.ts` — twee mutate-hooks i.p.v. één
- `frontend/src/components/pick-ship/locatie-edit.tsx` — wrapper rond `MagazijnLocatieEdit`, polymorfe schrijf-keuze
- `frontend/src/components/pick-ship/order-pick-card.tsx` — render `wacht_op`-badges, bron-iconen, maatwerk vs. standaard

### Delete
- Geen.

### Tests
- Bestaande: `frontend/src/lib/utils/__tests__/pick-ship-buckets.test.ts` blijft groen (geen wijziging).
- Nieuw: geen unit-tests in dit plan — view-logica wordt manueel via SQL geverifieerd; UI manueel via browser-smoke-test (consistent met rest van codebase).

---

## Implementatie

### Task 1: RPC `create_or_get_magazijn_locatie`

**Files:**
- Create: `supabase/migrations/169_create_or_get_magazijn_locatie.sql`

- [ ] **Stap 1: Schrijf migratie**

```sql
-- Migration 169: RPC create_or_get_magazijn_locatie
--
-- Idempotente helper voor on-the-fly aanmaken van magazijn-locatie-rijen.
-- Gebruik: bij Pick & Ship LocatieEdit kan een gebruiker een nieuwe code intypen;
-- de RPC vindt of maakt 'm aan en geeft de id terug. Code wordt UPPER + TRIM.
-- In MVI-V2 ook gebruikt door boek_ontvangst om binnenkomende rollen te koppelen.

CREATE OR REPLACE FUNCTION create_or_get_magazijn_locatie(
  p_code TEXT,
  p_omschrijving TEXT DEFAULT NULL,
  p_type TEXT DEFAULT 'rek'
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_code TEXT;
  v_id BIGINT;
BEGIN
  v_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF v_code = '' THEN
    RAISE EXCEPTION 'Magazijnlocatie-code mag niet leeg zijn';
  END IF;

  SELECT id INTO v_id FROM magazijn_locaties WHERE code = v_code;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO magazijn_locaties (code, omschrijving, type, actief)
  VALUES (v_code, p_omschrijving, p_type, true)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION create_or_get_magazijn_locatie IS
  'Idempotent: vindt magazijn_locaties.id voor `code` (UPPER+TRIM) of maakt rij aan. '
  'Migratie 169.';
```

- [ ] **Stap 2: Commit**

```bash
git add supabase/migrations/169_create_or_get_magazijn_locatie.sql
git commit -m "feat(db): RPC create_or_get_magazijn_locatie (mig 169)"
```

---

### Task 2: Frontend module — magazijn-locaties queries + hook

**Files:**
- Create: `frontend/src/lib/supabase/queries/magazijn-locaties.ts`
- Create: `frontend/src/hooks/use-magazijn-locaties.ts`

- [ ] **Stap 1: Schrijf queries**

```ts
// frontend/src/lib/supabase/queries/magazijn-locaties.ts
import { supabase } from '../client'

export interface MagazijnLocatie {
  id: number
  code: string
  omschrijving: string | null
  type: string
  actief: boolean
}

export async function fetchMagazijnLocaties(): Promise<MagazijnLocatie[]> {
  const { data, error } = await supabase
    .from('magazijn_locaties')
    .select('id, code, omschrijving, type, actief')
    .eq('actief', true)
    .order('code', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as MagazijnLocatie[]
}

export async function createOrGetMagazijnLocatie(code: string): Promise<number> {
  const { data, error } = await supabase.rpc('create_or_get_magazijn_locatie', {
    p_code: code,
  })
  if (error) throw error
  return data as number
}
```

- [ ] **Stap 2: Schrijf hook**

```ts
// frontend/src/hooks/use-magazijn-locaties.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createOrGetMagazijnLocatie,
  fetchMagazijnLocaties,
} from '@/lib/supabase/queries/magazijn-locaties'

export function useMagazijnLocaties() {
  return useQuery({
    queryKey: ['magazijn-locaties'],
    queryFn: fetchMagazijnLocaties,
    staleTime: 60_000,
  })
}

export function useCreateOrGetMagazijnLocatie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createOrGetMagazijnLocatie,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['magazijn-locaties'] }),
  })
}
```

- [ ] **Stap 3: TS-check + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/lib/supabase/queries/magazijn-locaties.ts frontend/src/hooks/use-magazijn-locaties.ts
git commit -m "feat(magazijn): queries + hook voor magazijn-locaties"
```

---

### Task 3: `MagazijnLocatieEdit` — type-ahead combobox

**Files:**
- Create: `frontend/src/components/pick-ship/magazijn-locatie-edit.tsx`

- [ ] **Stap 1: Schrijf component**

```tsx
// frontend/src/components/pick-ship/magazijn-locatie-edit.tsx
import { useMemo, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { useMagazijnLocaties } from '@/hooks/use-magazijn-locaties'

interface Props {
  /** Huidige locatie-code (text voor maatwerk; ML.code voor rol). NULL = niet ingesteld. */
  huidigeCode: string | null
  /** Wordt aangeroepen na "✓"-klik met de genormaliseerde UPPER-code. */
  onSave: (code: string) => Promise<void>
}

export function MagazijnLocatieEdit({ huidigeCode, onSave }: Props) {
  const [bewerken, setBewerken] = useState(false)
  const [waarde, setWaarde] = useState(huidigeCode ?? '')
  const [bezig, setBezig] = useState(false)
  const { data: locaties } = useMagazijnLocaties()

  const suggesties = useMemo(() => {
    if (!locaties || !waarde) return []
    const q = waarde.toUpperCase()
    return locaties.filter((l) => l.code.includes(q)).slice(0, 8)
  }, [locaties, waarde])

  if (!bewerken) {
    if (huidigeCode) {
      return (
        <button
          onClick={() => {
            setWaarde(huidigeCode)
            setBewerken(true)
          }}
          className="inline-flex items-center gap-1 text-slate-700 hover:text-terracotta-600 group"
        >
          <span className="font-mono text-xs">{huidigeCode}</span>
          <Pencil size={11} className="opacity-0 group-hover:opacity-60" />
        </button>
      )
    }
    return (
      <button
        onClick={() => setBewerken(true)}
        className="text-xs text-terracotta-500 hover:text-terracotta-600"
      >
        + locatie
      </button>
    )
  }

  const opslaan = async () => {
    const code = waarde.trim().toUpperCase()
    if (!code) {
      setBewerken(false)
      return
    }
    setBezig(true)
    try {
      await onSave(code)
      setBewerken(false)
    } finally {
      setBezig(false)
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-0.5 relative">
      <div className="inline-flex items-center gap-1">
        <input
          autoFocus
          value={waarde}
          onChange={(e) => setWaarde(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') opslaan()
            if (e.key === 'Escape') setBewerken(false)
          }}
          placeholder="A-12"
          className="w-24 px-1.5 py-0.5 text-xs border border-slate-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-terracotta-400"
        />
        <button
          onClick={opslaan}
          disabled={bezig}
          className="text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
        >
          <Check size={14} />
        </button>
        <button onClick={() => setBewerken(false)} className="text-slate-400 hover:text-slate-600">
          <X size={14} />
        </button>
      </div>
      {suggesties.length > 0 && (
        <ul className="absolute top-6 left-0 z-10 bg-white border border-slate-200 rounded shadow-md text-xs min-w-[6rem]">
          {suggesties.map((l) => (
            <li
              key={l.id}
              onMouseDown={(e) => {
                e.preventDefault()
                setWaarde(l.code)
              }}
              className="px-2 py-1 font-mono hover:bg-slate-100 cursor-pointer"
            >
              {l.code}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Stap 2: TS-check + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/pick-ship/magazijn-locatie-edit.tsx
git commit -m "feat(pick-ship): MagazijnLocatieEdit type-ahead component"
```

---

### Task 4: View `orderregel_pickbaarheid`

**Files:**
- Create: `supabase/migrations/170_orderregel_pickbaarheid_view.sql`

⚠️ **Implementer-note:** verifieer eerst de exacte snijplan_status-enum-waarden via [database-schema.md:814](docs/database-schema.md#L814) — moet matchen met `Wacht`, `Gepland`, `Gesneden`, `In confectie`, `In productie`, `Gereed`, `Ingepakt`, `Geannuleerd`. Pas de `CASE`-mapping aan als enum-waarden afwijken.

- [ ] **Stap 1: Schrijf migratie**

```sql
-- Migration 170: orderregel_pickbaarheid view
--
-- Per orderregel: kan deze nu uit het magazijn? Waar ligt 'ie? Anders: waarop wachten we?
-- Bron-van-waarheid voor Pick & Ship-pagina (V2). Toekomstig ook voor 'Wacht op picken'-
-- auto-derivation in herwaardeer_order_status (kandidaat 2, niet in dit plan).
--
-- Logica (zie plan 2026-05-01-pickbaarheid-mvi.md):
--   Maatwerk: pickbaar als ALLE snijplannen.status='Ingepakt'. wacht_op afgeleid van
--             slechtst-presterende snijplan. Locatie = MIN(snijplannen.locatie) over
--             Ingepakt-rijen.
--   Standaard: pickbaar als orderregel >=1 actieve voorraad-claim heeft. Anders
--              wacht_op='inkoop'. Locatie = COALESCE(rol-met-locatie.code, producten.locatie).

CREATE OR REPLACE VIEW orderregel_pickbaarheid AS
WITH maatwerk_aggr AS (
  SELECT
    sp.order_regel_id,
    COUNT(*)                                          AS totaal_stuks,
    COUNT(*) FILTER (WHERE sp.status = 'Ingepakt')    AS pickbaar_stuks,
    MIN(sp.locatie) FILTER (WHERE sp.status = 'Ingepakt') AS locatie,
    -- Slechtste-status-rangordening (laagste rang = vroegst in pipeline = slechtst)
    MIN(
      CASE sp.status
        WHEN 'Wacht'        THEN 1
        WHEN 'Gepland'      THEN 2
        WHEN 'Gesneden'     THEN 3
        WHEN 'In confectie' THEN 4
        WHEN 'In productie' THEN 5
        WHEN 'Gereed'       THEN 6
        WHEN 'Ingepakt'     THEN 7
        ELSE NULL
      END
    ) AS slechtste_rang
  FROM snijplannen sp
  WHERE sp.status <> 'Geannuleerd'
  GROUP BY sp.order_regel_id
),
voorraad_claim AS (
  SELECT
    rsv.order_regel_id,
    COUNT(*) AS aantal_actief
  FROM order_reserveringen rsv
  WHERE rsv.bron = 'voorraad' AND rsv.status = 'actief'
  GROUP BY rsv.order_regel_id
),
rol_locatie_per_artikel AS (
  -- Eén representatieve rol-met-locatie per artikelnr (laagste rol-id)
  SELECT DISTINCT ON (r.artikelnr)
    r.artikelnr,
    ml.code AS code
  FROM rollen r
  JOIN magazijn_locaties ml ON ml.id = r.locatie_id
  WHERE r.status = 'beschikbaar' AND r.locatie_id IS NOT NULL
  ORDER BY r.artikelnr, r.id ASC
)
SELECT
  oreg.id            AS order_regel_id,
  oreg.order_id,
  oreg.regelnummer,
  oreg.artikelnr,
  oreg.is_maatwerk,
  oreg.orderaantal,
  oreg.maatwerk_lengte_cm,
  oreg.maatwerk_breedte_cm,
  oreg.omschrijving,
  oreg.maatwerk_kwaliteit_code,
  oreg.maatwerk_kleur_code,
  ma.totaal_stuks,
  ma.pickbaar_stuks,
  -- is_pickbaar
  CASE
    WHEN oreg.is_maatwerk THEN
      COALESCE(ma.pickbaar_stuks = ma.totaal_stuks AND ma.totaal_stuks > 0, false)
    ELSE
      COALESCE(vc.aantal_actief > 0, false)
  END AS is_pickbaar,
  -- bron
  CASE
    WHEN oreg.is_maatwerk         THEN 'snijplan'
    WHEN rl.code IS NOT NULL      THEN 'rol'
    WHEN p.locatie IS NOT NULL    THEN 'producten_default'
    ELSE NULL
  END AS bron,
  -- fysieke_locatie
  CASE
    WHEN oreg.is_maatwerk THEN ma.locatie
    ELSE COALESCE(rl.code, p.locatie)
  END AS fysieke_locatie,
  -- wacht_op
  CASE
    WHEN oreg.is_maatwerk THEN
      CASE
        WHEN ma.totaal_stuks IS NULL OR ma.slechtste_rang IS NULL THEN 'snijden'
        WHEN ma.slechtste_rang <= 2 THEN 'snijden'
        WHEN ma.slechtste_rang <= 4 THEN 'confectie'
        WHEN ma.slechtste_rang <= 6 THEN 'inpak'
        ELSE NULL
      END
    ELSE
      CASE WHEN COALESCE(vc.aantal_actief, 0) = 0 THEN 'inkoop' ELSE NULL END
  END AS wacht_op
FROM order_regels oreg
JOIN orders o            ON o.id = oreg.order_id
LEFT JOIN producten p    ON p.artikelnr = oreg.artikelnr
LEFT JOIN maatwerk_aggr ma   ON ma.order_regel_id = oreg.id
LEFT JOIN voorraad_claim vc  ON vc.order_regel_id = oreg.id
LEFT JOIN rol_locatie_per_artikel rl ON rl.artikelnr = oreg.artikelnr
WHERE o.status NOT IN ('Verzonden', 'Geannuleerd');

COMMENT ON VIEW orderregel_pickbaarheid IS
  'Per orderregel: is_pickbaar, fysieke_locatie, bron (snijplan|rol|producten_default), '
  'wacht_op (snijden|confectie|inpak|inkoop|null). Verenigt maatwerk- en standaard-paden. '
  'Migratie 170.';
```

- [ ] **Stap 2: Commit**

```bash
git add supabase/migrations/170_orderregel_pickbaarheid_view.sql
git commit -m "feat(db): orderregel_pickbaarheid view (mig 170)"
```

---

### Task 5: Types V2 — `PickShipRegel` herwerken

**Files:**
- Modify: `frontend/src/lib/types/pick-ship.ts`

⚠️ **Note:** dit breekt tijdelijk de query/component bestanden. Tasks 6-8 fixen dat. Implementer mag commit doen in "rode build" status — wordt direct daarna groen.

- [ ] **Stap 1: Read huidige bestand**

Read [frontend/src/lib/types/pick-ship.ts](frontend/src/lib/types/pick-ship.ts) zodat je weet welke exports er nu zijn (`BucketKey`, `BUCKET_VOLGORDE`, `BUCKET_LABEL`, `PickShipRegel`, `PickShipOrder`).

- [ ] **Stap 2: Vervang `PickShipRegel`-interface**

`BucketKey`-blok ongewijzigd laten. Vervang **alleen** de `PickShipRegel`-interface. `PickShipOrder` past minimaal aan (regels-array houdt nieuwe shape).

```ts
// Voeg toe boven PickShipRegel:
export type PickShipBron = 'snijplan' | 'rol' | 'producten_default' | null
export type PickShipWachtOp = 'snijden' | 'confectie' | 'inpak' | 'inkoop' | null

// Vervang volledige PickShipRegel:
export interface PickShipRegel {
  order_regel_id: number
  artikelnr: string | null
  is_maatwerk: boolean
  product: string
  kleur: string | null
  maat_cm: string
  m2: number
  orderaantal: number
  is_pickbaar: boolean
  bron: PickShipBron
  fysieke_locatie: string | null
  wacht_op: PickShipWachtOp
  totaal_stuks?: number | null
  pickbaar_stuks?: number | null
}

// PickShipOrder blijft dezelfde shape; alleen `regels: PickShipRegel[]` wordt nieuw.
```

- [ ] **Stap 3: Commit (build mag tijdelijk rood zijn)**

```bash
git add frontend/src/lib/types/pick-ship.ts
git commit -m "feat(pick-ship): PickShipRegel V2 (pickbaar/bron/wacht_op)"
```

---

### Task 6: Queries V2 — lees `orderregel_pickbaarheid`

**Files:**
- Modify (vervang inhoud): `frontend/src/lib/supabase/queries/pick-ship.ts`

⚠️ **Implementer-note:**
- Verifieer hoe `orders.klant_naam` momenteel wordt opgehaald in andere queries (bv. [orders.ts](frontend/src/lib/supabase/queries/orders.ts) of [reserveringen.ts](frontend/src/lib/supabase/queries/reserveringen.ts)). Patroon kan zijn: directe kolom (denormalized), of join met `debiteuren!inner(naam)`. Volg het bestaande patroon.
- Bestaande `updateSnijplanLocatie` en `SnijplanningRij`-interface mogen weg.

- [ ] **Stap 1: Vervang volledige bestand**

```ts
// frontend/src/lib/supabase/queries/pick-ship.ts
import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import { bucketVoor } from '@/lib/utils/pick-ship-buckets'
import type {
  BucketKey,
  PickShipBron,
  PickShipOrder,
  PickShipRegel,
  PickShipWachtOp,
} from '@/lib/types/pick-ship'

interface PickbaarheidRij {
  order_regel_id: number
  order_id: number
  regelnummer: number
  artikelnr: string | null
  is_maatwerk: boolean
  orderaantal: number
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  omschrijving: string | null
  maatwerk_kwaliteit_code: string | null
  maatwerk_kleur_code: string | null
  totaal_stuks: number | null
  pickbaar_stuks: number | null
  is_pickbaar: boolean
  bron: PickShipBron
  fysieke_locatie: string | null
  wacht_op: PickShipWachtOp
}

interface OrderHeaderRij {
  id: number
  order_nr: string
  klant_naam: string | null
  debiteur_nr: number
  afl_naam: string | null
  afl_plaats: string | null
  afleverdatum: string | null
}

export interface PickShipParams {
  bucket?: BucketKey
  search?: string
  vandaag?: Date
  /** Default true: alleen orders met >=1 pickbare regel. */
  alleen_pickbaar?: boolean
}

export interface PickShipStats {
  totaal_orders: number
  totaal_stuks: number
  totaal_m2: number
  per_bucket: Record<BucketKey, number>
}

export async function fetchPickShipOrders(
  params: PickShipParams = {}
): Promise<PickShipOrder[]> {
  const { search, bucket, vandaag = new Date(), alleen_pickbaar = true } = params

  const { data: regelsRaw, error } = await supabase
    .from('orderregel_pickbaarheid')
    .select(
      'order_regel_id, order_id, regelnummer, artikelnr, is_maatwerk, ' +
        'orderaantal, maatwerk_lengte_cm, maatwerk_breedte_cm, omschrijving, ' +
        'maatwerk_kwaliteit_code, maatwerk_kleur_code, totaal_stuks, ' +
        'pickbaar_stuks, is_pickbaar, bron, fysieke_locatie, wacht_op'
    )
  if (error) throw error
  const regels = (regelsRaw ?? []) as unknown as PickbaarheidRij[]
  if (regels.length === 0) return []

  const orderIds = Array.from(new Set(regels.map((r) => r.order_id)))
  const { data: ordersRaw, error: oerr } = await supabase
    .from('orders')
    .select('id, order_nr, klant_naam, debiteur_nr, afl_naam, afl_plaats, afleverdatum')
    .in('id', orderIds)
  if (oerr) throw oerr
  const headers = (ordersRaw ?? []) as unknown as OrderHeaderRij[]
  const headerMap = new Map(headers.map((h) => [h.id, h]))

  let work = regels
  if (search) {
    const s = sanitizeSearch(search).toLowerCase()
    if (s) {
      work = regels.filter((r) => {
        const h = headerMap.get(r.order_id)
        return (
          (h?.order_nr ?? '').toLowerCase().includes(s) ||
          (h?.klant_naam ?? '').toLowerCase().includes(s) ||
          (r.omschrijving ?? '').toLowerCase().includes(s) ||
          (r.artikelnr ?? '').toLowerCase().includes(s)
        )
      })
    }
  }

  const perOrder = new Map<number, PickShipOrder>()
  for (const r of work) {
    const h = headerMap.get(r.order_id)
    if (!h) continue

    const lengte = r.maatwerk_lengte_cm ?? 0
    const breedte = r.maatwerk_breedte_cm ?? 0
    const m2 = r.is_maatwerk ? Math.round(((lengte * breedte) / 10000) * 100) / 100 : 0

    const regel: PickShipRegel = {
      order_regel_id: r.order_regel_id,
      artikelnr: r.artikelnr,
      is_maatwerk: r.is_maatwerk,
      product:
        r.omschrijving ??
        [r.maatwerk_kwaliteit_code, r.maatwerk_kleur_code].filter(Boolean).join(' '),
      kleur: r.maatwerk_kleur_code,
      maat_cm: r.is_maatwerk ? `${lengte} x ${breedte}` : `${r.orderaantal} stuk(s)`,
      m2,
      orderaantal: r.orderaantal,
      is_pickbaar: r.is_pickbaar,
      bron: r.bron,
      fysieke_locatie: r.fysieke_locatie,
      wacht_op: r.wacht_op,
      totaal_stuks: r.totaal_stuks,
      pickbaar_stuks: r.pickbaar_stuks,
    }

    let order = perOrder.get(r.order_id)
    if (!order) {
      order = {
        order_id: h.id,
        order_nr: h.order_nr,
        klant_naam: h.klant_naam ?? '',
        debiteur_nr: h.debiteur_nr,
        afl_naam: h.afl_naam,
        afl_plaats: h.afl_plaats,
        afleverdatum: h.afleverdatum,
        bucket: bucketVoor(h.afleverdatum, vandaag),
        regels: [],
        totaal_m2: 0,
        aantal_regels: 0,
      }
      perOrder.set(r.order_id, order)
    }
    order.regels.push(regel)
    order.totaal_m2 = Math.round((order.totaal_m2 + m2) * 100) / 100
    order.aantal_regels = order.regels.length
  }

  let result = Array.from(perOrder.values())
  if (alleen_pickbaar) {
    result = result.filter((o) => o.regels.some((r) => r.is_pickbaar))
  }
  if (bucket) result = result.filter((o) => o.bucket === bucket)
  return result
}

export async function fetchPickShipStats(vandaag: Date = new Date()): Promise<PickShipStats> {
  const orders = await fetchPickShipOrders({ vandaag })
  const stats: PickShipStats = {
    totaal_orders: orders.length,
    totaal_stuks: orders.reduce((s, o) => s + o.aantal_regels, 0),
    totaal_m2: Math.round(orders.reduce((s, o) => s + o.totaal_m2, 0) * 100) / 100,
    per_bucket: {
      achterstallig: 0, vandaag: 0, morgen: 0, deze_week: 0,
      volgende_week: 0, later: 0, geen_datum: 0,
    },
  }
  for (const o of orders) stats.per_bucket[o.bucket] += 1
  return stats
}

/** Schrijf locatie-text naar alle Ingepakt-snijplannen van een orderregel (maatwerk-pad). */
export async function updateMaatwerkLocatie(
  orderRegelId: number,
  locatieCode: string
): Promise<void> {
  const { error } = await supabase
    .from('snijplannen')
    .update({ locatie: locatieCode })
    .eq('order_regel_id', orderRegelId)
    .eq('status', 'Ingepakt')
  if (error) throw error
}

/** Zet locatie_id op de eerste beschikbare rol van een artikel (standaard-pad). */
export async function updateRolLocatieVoorArtikel(
  artikelnr: string,
  magazijnLocatieId: number
): Promise<void> {
  const { data, error: selErr } = await supabase
    .from('rollen')
    .select('id')
    .eq('artikelnr', artikelnr)
    .eq('status', 'beschikbaar')
    .order('id', { ascending: true })
    .limit(1)
  if (selErr) throw selErr
  const rolId = (data?.[0] as { id: number } | undefined)?.id
  if (!rolId) throw new Error(`Geen beschikbare rol voor artikel ${artikelnr}`)
  const { error } = await supabase
    .from('rollen')
    .update({ locatie_id: magazijnLocatieId })
    .eq('id', rolId)
  if (error) throw error
}
```

- [ ] **Stap 2: TS-check + commit (build wordt nu groen)**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/lib/supabase/queries/pick-ship.ts
git commit -m "feat(pick-ship): query op orderregel_pickbaarheid view"
```

---

### Task 7: Hooks V2 + LocatieEdit polymorf

**Files:**
- Modify: `frontend/src/hooks/use-pick-ship.ts`
- Modify (vervang): `frontend/src/components/pick-ship/locatie-edit.tsx`

- [ ] **Stap 1: Hook bijwerken**

```ts
// frontend/src/hooks/use-pick-ship.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchPickShipOrders,
  fetchPickShipStats,
  updateMaatwerkLocatie,
  updateRolLocatieVoorArtikel,
  type PickShipParams,
} from '@/lib/supabase/queries/pick-ship'
import { createOrGetMagazijnLocatie } from '@/lib/supabase/queries/magazijn-locaties'

export function usePickShipOrders(params: PickShipParams = {}) {
  return useQuery({
    queryKey: ['pick-ship', 'orders', params],
    queryFn: () => fetchPickShipOrders(params),
    staleTime: 30_000,
  })
}

export function usePickShipStats() {
  return useQuery({
    queryKey: ['pick-ship', 'stats'],
    queryFn: () => fetchPickShipStats(),
    staleTime: 30_000,
  })
}

export function useUpdateMaatwerkLocatie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ orderRegelId, code }: { orderRegelId: number; code: string }) => {
      await createOrGetMagazijnLocatie(code) // zorgt dat code in magazijn_locaties staat (voor type-ahead)
      await updateMaatwerkLocatie(orderRegelId, code)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pick-ship'] }),
  })
}

export function useUpdateRolLocatie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ artikelnr, code }: { artikelnr: string; code: string }) => {
      const id = await createOrGetMagazijnLocatie(code)
      await updateRolLocatieVoorArtikel(artikelnr, id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pick-ship'] }),
  })
}
```

- [ ] **Stap 2: LocatieEdit polymorf**

```tsx
// frontend/src/components/pick-ship/locatie-edit.tsx
import { MagazijnLocatieEdit } from './magazijn-locatie-edit'
import { useUpdateMaatwerkLocatie, useUpdateRolLocatie } from '@/hooks/use-pick-ship'
import type { PickShipRegel } from '@/lib/types/pick-ship'

interface Props {
  regel: PickShipRegel
}

export function LocatieEdit({ regel }: Props) {
  const maatwerkMut = useUpdateMaatwerkLocatie()
  const rolMut = useUpdateRolLocatie()

  const onSave = async (code: string) => {
    if (regel.is_maatwerk) {
      await maatwerkMut.mutateAsync({ orderRegelId: regel.order_regel_id, code })
    } else {
      if (!regel.artikelnr) throw new Error('Standaard regel zonder artikelnr')
      await rolMut.mutateAsync({ artikelnr: regel.artikelnr, code })
    }
  }

  return <MagazijnLocatieEdit huidigeCode={regel.fysieke_locatie} onSave={onSave} />
}
```

- [ ] **Stap 3: Build + commit**

```bash
cd frontend && npm run build
git add frontend/src/hooks/use-pick-ship.ts frontend/src/components/pick-ship/locatie-edit.tsx
git commit -m "feat(pick-ship): hooks + LocatieEdit polymorf (maatwerk + rol)"
```

---

### Task 8: OrderPickCard render — wacht_op badges + iconen

**Files:**
- Modify (vervang): `frontend/src/components/pick-ship/order-pick-card.tsx`

- [ ] **Stap 1: Vervang component**

```tsx
// frontend/src/components/pick-ship/order-pick-card.tsx
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, ExternalLink } from 'lucide-react'
import { LocatieEdit } from './locatie-edit'
import { formatDate } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import type { PickShipOrder, PickShipWachtOp } from '@/lib/types/pick-ship'

const WACHT_OP_LABEL: Record<NonNullable<PickShipWachtOp>, string> = {
  snijden: 'Wacht op snijden',
  confectie: 'Wacht op confectie',
  inpak: 'Wacht op inpak',
  inkoop: 'Wacht op inkoop',
}

interface Props {
  order: PickShipOrder
}

export function OrderPickCard({ order }: Props) {
  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <div className="flex items-start justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div>
          <Link
            to={`/orders/${order.order_id}`}
            className="inline-flex items-center gap-1 text-terracotta-600 font-medium hover:underline"
          >
            {order.order_nr}
            <ExternalLink size={12} />
          </Link>
          <div className="text-sm text-slate-700 mt-0.5">{order.klant_naam}</div>
          {order.afl_naam && (
            <div className="text-xs text-slate-500 mt-0.5">
              → {order.afl_naam}{order.afl_plaats ? `, ${order.afl_plaats}` : ''}
            </div>
          )}
        </div>
        <div className="text-right text-sm">
          <div className="text-slate-700 font-medium">{formatDate(order.afleverdatum)}</div>
          <div className="text-xs text-slate-500">
            {order.aantal_regels} regel{order.aantal_regels === 1 ? '' : 's'}
            {order.totaal_m2 > 0 ? ` · ${order.totaal_m2.toFixed(2)} m²` : ''}
          </div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
            <th className="py-1.5 px-3 font-medium w-8"></th>
            <th className="py-1.5 px-3 font-medium">Product</th>
            <th className="py-1.5 px-3 font-medium">Type · Maat</th>
            <th className="py-1.5 px-3 font-medium">Status</th>
            <th className="py-1.5 px-3 font-medium">Locatie</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {order.regels.map((r) => (
            <tr
              key={r.order_regel_id}
              className={cn('hover:bg-slate-50', !r.is_pickbaar && 'opacity-70')}
            >
              <td className="py-2 px-3">
                {r.is_pickbaar ? (
                  <CheckCircle2 size={16} className="text-emerald-500" />
                ) : (
                  <Clock size={16} className="text-amber-500" />
                )}
              </td>
              <td className="py-2 px-3">
                <span className="text-slate-700">{r.product}</span>
                {r.kleur && <span className="text-slate-400 ml-1 text-xs">({r.kleur})</span>}
                {r.artikelnr && !r.is_maatwerk && (
                  <span className="text-slate-400 ml-1 text-xs">{r.artikelnr}</span>
                )}
              </td>
              <td className="py-2 px-3 text-xs text-slate-600">
                {r.is_maatwerk ? (
                  <>
                    <span className="text-orange-600 font-medium">Op maat</span> · {r.maat_cm}
                    {r.totaal_stuks != null && r.totaal_stuks > 1 && (
                      <span className="ml-1 text-slate-400">
                        ({r.pickbaar_stuks}/{r.totaal_stuks} stuks)
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-blue-600 font-medium">Standaard</span> · {r.orderaantal} stuk(s)
                  </>
                )}
              </td>
              <td className="py-2 px-3 text-xs">
                {r.is_pickbaar ? (
                  <span className="text-emerald-600">Klaar om te picken</span>
                ) : r.wacht_op ? (
                  <span className="text-amber-600">{WACHT_OP_LABEL[r.wacht_op]}</span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="py-2 px-3">
                {r.is_pickbaar || r.fysieke_locatie ? (
                  <LocatieEdit regel={r} />
                ) : (
                  <span className="text-slate-300 text-xs">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Stap 2: Build + tests**

```bash
cd frontend && npm run build
cd frontend && npx vitest run
```
Verwacht: build clean, alle tests groen.

- [ ] **Stap 3: Commit**

```bash
git add frontend/src/components/pick-ship/order-pick-card.tsx
git commit -m "feat(pick-ship): render wacht_op-badges en bron-aware kolommen"
```

---

### Task 9: Smoke-test setup

- [ ] **Stap 1: Verifieer migraties klaar voor user**

Verzamel exact welke migraties handmatig toegepast moeten worden:
- `169_create_or_get_magazijn_locatie.sql`
- `170_orderregel_pickbaarheid_view.sql`

Plus migratie 168 als die nog niet liep (uit voorgaand plan).

- [ ] **Stap 2: Build + tests groen?**

```bash
cd frontend && npm run build && npx vitest run
```

- [ ] **Stap 3: SQL-verificatie-snippets voorbereiden**

Plak deze in commit-message of finaal antwoord aan user:

```sql
-- Verifieer migratie 169
SELECT proname FROM pg_proc WHERE proname = 'create_or_get_magazijn_locatie';
SELECT create_or_get_magazijn_locatie('TEST-A1');
SELECT * FROM magazijn_locaties WHERE code = 'TEST-A1';
DELETE FROM magazijn_locaties WHERE code = 'TEST-A1';

-- Verifieer migratie 170
SELECT count(*) FROM orderregel_pickbaarheid;
SELECT * FROM orderregel_pickbaarheid WHERE is_pickbaar LIMIT 5;
SELECT wacht_op, count(*) FROM orderregel_pickbaarheid GROUP BY wacht_op;
SELECT bron, count(*) FROM orderregel_pickbaarheid GROUP BY bron;
```

- [ ] **Stap 4: Final code review subagent**

Roep `code-reviewer` aan voor de complete diff vanaf het begin van de MVI-branch (alle 9 task-commits). Aandachtspunten meegeven: spec-compliance met dit plan, edge cases in view-CASE-branches (NULL afhandeling, snijplannen-status mismatch met enum), polymorfisme van LocatieEdit, en regressie-risico op V1-functionaliteit.

---

## Verificatie (eindcheck)

1. `npm run build` slaagt zonder TS-errors.
2. `npx vitest run` toont alle tests groen (incl. de 10 bestaande bucket-helper tests).
3. Migraties 169 + 170 toegepast op productie-Supabase (handmatig door user).
4. Pick & Ship-pagina toont zowel maatwerk- als standaard-regels.
5. Niet-pickbare regels tonen `Wacht op X`-badge (snijden / confectie / inpak / inkoop).
6. Pickbare regels tonen groen vinkje + locatie (of "+ locatie"-knop).
7. Locatie-edit werkt voor maatwerk én standaard; nieuwe codes verschijnen in `magazijn_locaties` via RPC.
8. V1-functionaliteit niet geregresseerd: maatwerk-Ingepakt-stuks blijven pickbaar zoals voorheen.

---

## Niet in scope (follow-ups)

- **MVI-V2: `boek_ontvangst`-uitbreiding** — locatie meegeven bij rol-ontvangst zodat nieuwe rollen direct `locatie_id` krijgen. Vraagt aparte migratie + UI in `OntvangstBoekenDialog`.
- **Auto-derivation `Wacht op picken`-status** (kandidaat 2 uit architectuur-review) — `herwaardeer_order_status` uitbreiden om de status automatisch te schrijven o.b.v. `orderregel_pickbaarheid.is_pickbaar` per orderregel.
- **Backfill bestaande rollen-zonder-locatie** (B1-keuze).
- **Per-rol-instance-toewijzing aan voorraad-claims** (`order_reserveringen.rol_id`) — geeft de view een precieze rol-locatie i.p.v. "een willekeurige rol-met-locatie van dit artikel".
- **Scanstation pick-actie** (kandidaat 5).
- **`Wacht op picken`-tab in Pick & Ship** — laat de tab live gaan zodra de auto-derivation werkt.
- **Doc-updates** (changelog, architectuur, data-woordenboek met "Pickbaarheid", "Stelling") — uitstellen tot user's EDI-WIP gemerged is.
