# Snijplanning Leverdatum-filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gebruikers kunnen de snijplanning filteren op afleverdatum (week-niveau), zodat ze 1-4 weken vooruit kijken en snijplannen genereren voor alleen die periode.

**Architecture:** Een PostgreSQL RPC-functie vervangt de directe view-query en accepteert een optionele `tot_datum` parameter. De frontend krijgt een week-selector balk die de datum doorgeeft aan alle queries (groepen, status counts, en snijvoorstel-generatie). De edge function `optimaliseer-snijplan` ontvangt dezelfde datum-filter zodat alleen relevante stukken worden ingepland.

**Ontwerpbeslissingen:**
- RPC functies worden **altijd** gebruikt (ook zonder filter, met `NULL`), zodat er geen twee codepaden zijn
- Dashboard stat cards (totaal te snijden, gepland, etc.) blijven **ongefilterd** — ze tonen de globale productiestatus
- De expanded accordion detailweergave filtert ook op datum, zodat gebruikers geen irrelevante stukken zien

**Tech Stack:** PostgreSQL (RPC function), React/TypeScript, TanStack Query, Supabase Edge Functions (Deno)

---

## File Structure

| Actie | Bestand | Verantwoordelijkheid |
|-------|---------|---------------------|
| Create | `supabase/migrations/045_snijplanning_groepen_gefilterd.sql` | RPC functie met datum-filter |
| Create | `frontend/src/components/snijplanning/week-filter.tsx` | Week-selector UI component |
| Modify | `frontend/src/lib/supabase/queries/snijplanning.ts` | Queries aanpassen voor datum-filter |
| Modify | `frontend/src/hooks/use-snijplanning.ts` | Hooks aanpassen voor datum-parameter |
| Modify | `frontend/src/pages/snijplanning/snijplanning-overview.tsx` | Week-filter integreren in pagina |
| Modify | `frontend/src/lib/supabase/queries/snijvoorstel.ts` | `generateSnijvoorstel` datum-param |
| Modify | `supabase/functions/optimaliseer-snijplan/index.ts` | Edge function datum-filter |
| Modify | `docs/database-schema.md` | RPC functie documenteren |
| Modify | `docs/changelog.md` | Wijziging loggen |

---

### Task 1: Database — RPC functie voor gefilterde groepen

**Files:**
- Create: `supabase/migrations/045_snijplanning_groepen_gefilterd.sql`

- [ ] **Step 1: Schrijf de migratie met de RPC functie**

```sql
-- Migration 045: RPC functie voor snijplanning groepen met optionele datum-filter
-- Hiermee kunnen gebruikers filteren op afleverdatum (bv. komende 1-4 weken)

CREATE OR REPLACE FUNCTION snijplanning_groepen_gefilterd(p_tot_datum DATE DEFAULT NULL)
RETURNS TABLE (
  kwaliteit_code TEXT,
  kleur_code TEXT,
  totaal_stukken INTEGER,
  totaal_orders INTEGER,
  totaal_m2 FLOAT,
  totaal_gesneden INTEGER,
  vroegste_afleverdatum DATE,
  totaal_wacht INTEGER,
  totaal_gepland INTEGER,
  totaal_in_productie INTEGER,
  totaal_status_gesneden INTEGER,
  totaal_in_confectie INTEGER,
  totaal_gereed INTEGER
) LANGUAGE sql STABLE AS $$
  SELECT
    so.kwaliteit_code,
    so.kleur_code,
    COUNT(*)::INTEGER AS totaal_stukken,
    COUNT(DISTINCT so.order_id)::INTEGER AS totaal_orders,
    ROUND(SUM(so.snij_lengte_cm::NUMERIC * so.snij_breedte_cm::NUMERIC / 10000), 1)::FLOAT AS totaal_m2,
    COUNT(*) FILTER (WHERE so.status IN ('Gesneden', 'In confectie', 'Ingepakt', 'Gereed'))::INTEGER AS totaal_gesneden,
    MIN(so.afleverdatum) FILTER (WHERE so.status NOT IN ('Gesneden', 'In confectie', 'Ingepakt', 'Gereed', 'Geannuleerd')) AS vroegste_afleverdatum,
    COUNT(*) FILTER (WHERE so.status = 'Wacht')::INTEGER AS totaal_wacht,
    COUNT(*) FILTER (WHERE so.status = 'Gepland')::INTEGER AS totaal_gepland,
    COUNT(*) FILTER (WHERE so.status = 'In productie')::INTEGER AS totaal_in_productie,
    COUNT(*) FILTER (WHERE so.status = 'Gesneden')::INTEGER AS totaal_status_gesneden,
    COUNT(*) FILTER (WHERE so.status = 'In confectie')::INTEGER AS totaal_in_confectie,
    COUNT(*) FILTER (WHERE so.status IN ('Gereed', 'Ingepakt'))::INTEGER AS totaal_gereed
  FROM snijplanning_overzicht so
  WHERE so.kwaliteit_code IS NOT NULL
    AND (p_tot_datum IS NULL OR so.afleverdatum <= p_tot_datum)
  GROUP BY so.kwaliteit_code, so.kleur_code
  ORDER BY so.kwaliteit_code, so.kleur_code;
$$;

-- Ook een gefilterde status count functie
CREATE OR REPLACE FUNCTION snijplanning_status_counts_gefilterd(p_tot_datum DATE DEFAULT NULL)
RETURNS TABLE (
  status TEXT,
  aantal BIGINT
) LANGUAGE sql STABLE AS $$
  SELECT
    so.status::TEXT,
    COUNT(*) AS aantal
  FROM snijplanning_overzicht so
  WHERE so.kwaliteit_code IS NOT NULL
    AND so.status NOT IN ('Geannuleerd')
    AND (p_tot_datum IS NULL OR so.afleverdatum <= p_tot_datum)
  GROUP BY so.status
  HAVING COUNT(*) > 0;
$$;
```

- [ ] **Step 2: Pas de migratie toe op Supabase**

Run: `npx supabase db push` of via Supabase Dashboard > SQL Editor

- [ ] **Step 3: Verifieer de functie werkt**

Test in SQL Editor:
```sql
-- Alles (geen filter)
SELECT * FROM snijplanning_groepen_gefilterd();
-- Komende 2 weken
SELECT * FROM snijplanning_groepen_gefilterd(CURRENT_DATE + INTERVAL '14 days');
-- Status counts gefilterd
SELECT * FROM snijplanning_status_counts_gefilterd(CURRENT_DATE + INTERVAL '14 days');
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/045_snijplanning_groepen_gefilterd.sql
git commit -m "feat: RPC functies voor snijplanning groepen met datum-filter"
```

---

### Task 2: Frontend — Week-filter component

**Files:**
- Create: `frontend/src/components/snijplanning/week-filter.tsx`

- [ ] **Step 1: Maak het week-filter component**

```tsx
import { cn } from '@/lib/utils/cn'
import { CalendarDays } from 'lucide-react'

export interface WeekFilterOption {
  label: string
  weken: number | null  // null = alle (geen filter)
}

const WEEK_OPTIONS: WeekFilterOption[] = [
  { label: 'Alle', weken: null },
  { label: 'Deze week', weken: 0 },
  { label: '1 week', weken: 1 },
  { label: '2 weken', weken: 2 },
  { label: '3 weken', weken: 3 },
  { label: '4 weken', weken: 4 },
]

/** Bereken de datum voor N weken vooruit (eind van die week = zondag) */
export function berekenTotDatum(weken: number | null): string | null {
  if (weken === null) return null
  const nu = new Date()
  // Ga naar einde van huidige week (zondag) + N extra weken
  const dag = nu.getDay()  // 0=zo, 1=ma, ...
  const dagenTotZondag = dag === 0 ? 0 : 7 - dag
  const totDatum = new Date(nu)
  totDatum.setDate(nu.getDate() + dagenTotZondag + (weken * 7))
  return totDatum.toISOString().split('T')[0]  // YYYY-MM-DD
}

interface WeekFilterProps {
  geselecteerd: number | null
  onChange: (weken: number | null) => void
}

export function WeekFilter({ geselecteerd, onChange }: WeekFilterProps) {
  const totDatum = berekenTotDatum(geselecteerd)

  return (
    <div className="flex items-center gap-2">
      <CalendarDays size={16} className="text-slate-400" />
      <span className="text-sm text-slate-500">Levering t/m:</span>
      <div className="flex gap-1">
        {WEEK_OPTIONS.map((opt) => {
          const isActive = geselecteerd === opt.weken
          return (
            <button
              key={opt.label}
              onClick={() => onChange(opt.weken)}
              className={cn(
                'px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-blue-600 text-white font-medium'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      {totDatum && (
        <span className="text-xs text-slate-400 ml-1">
          (t/m {new Date(totDatum + 'T00:00:00').toLocaleDateString('nl-NL')})
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/snijplanning/week-filter.tsx
git commit -m "feat: week-filter component voor snijplanning leverdatum"
```

---

### Task 3: Frontend — Queries aanpassen met datum-filter

**Files:**
- Modify: `frontend/src/lib/supabase/queries/snijplanning.ts:31-47` (fetchSnijplanningGroepen)
- Modify: `frontend/src/lib/supabase/queries/snijplanning.ts:124-141` (fetchSnijplanningStatusCounts)

- [ ] **Step 1: Pas fetchSnijplanningGroepen aan om altijd RPC te gebruiken**

In `frontend/src/lib/supabase/queries/snijplanning.ts`, vervang `fetchSnijplanningGroepen`:

```typescript
/** Fetch grouped summaries, optionally filtered by delivery date.
 *  Always uses RPC function (handles NULL = no filter natively). */
export async function fetchSnijplanningGroepen(
  search?: string,
  totDatum?: string | null
): Promise<SnijGroepSummary[]> {
  const { data, error } = await supabase.rpc('snijplanning_groepen_gefilterd', {
    p_tot_datum: totDatum ?? null,
  })
  if (error) throw error
  let results = (data ?? []) as SnijGroepSummary[]

  if (search) {
    const s = sanitizeSearch(search)?.toLowerCase()
    if (s) {
      results = results.filter(
        (g) =>
          g.kwaliteit_code.toLowerCase().includes(s) ||
          g.kleur_code.toLowerCase().includes(s)
      )
    }
  }
  return results
}
```

- [ ] **Step 2: Pas fetchSnijplanningStatusCounts aan om altijd RPC te gebruiken**

Vervang de bestaande `fetchSnijplanningStatusCounts` functie:

```typescript
/** Fetch status counts, optionally filtered by delivery date.
 *  Always uses RPC function (single query instead of 8 separate counts). */
export async function fetchSnijplanningStatusCounts(
  totDatum?: string | null
): Promise<SnijplanStatusCount[]> {
  const { data, error } = await supabase.rpc('snijplanning_status_counts_gefilterd', {
    p_tot_datum: totDatum ?? null,
  })
  if (error) throw error
  return (data ?? []).map((r: { status: string; aantal: number }) => ({
    status: r.status,
    aantal: Number(r.aantal),
  }))
}
```

> **Bonus:** Dit vervangt ook de oude implementatie die 8 losse queries deed — nu 1 enkele RPC call.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/supabase/queries/snijplanning.ts
git commit -m "feat: snijplanning queries ondersteunen datum-filter via RPC"
```

---

### Task 4: Frontend — Hooks aanpassen

**Files:**
- Modify: `frontend/src/hooks/use-snijplanning.ts:48-53` (useSnijplanningGroepen)
- Modify: `frontend/src/hooks/use-snijplanning.ts:63-68` (useSnijplanningStatusCounts)

- [ ] **Step 1: Pas useSnijplanningGroepen aan**

```typescript
export function useSnijplanningGroepen(search?: string, totDatum?: string | null) {
  return useQuery({
    queryKey: ['snijplanning', 'groepen', search, totDatum],
    queryFn: () => fetchSnijplanningGroepen(search, totDatum),
  })
}
```

- [ ] **Step 2: Pas useSnijplanningStatusCounts aan**

```typescript
export function useSnijplanningStatusCounts(totDatum?: string | null) {
  return useQuery({
    queryKey: ['snijplanning', 'status-counts', totDatum],
    queryFn: () => fetchSnijplanningStatusCounts(totDatum),
  })
}
```

- [ ] **Step 3: Pas useSnijplannenVoorGroep aan voor datum-filtering**

De expanded detail view moet ook gefilterd worden, anders ziet de gebruiker stukken buiten de geselecteerde periode.

```typescript
export function useSnijplannenVoorGroep(
  kwaliteitCode: string,
  kleurCode: string,
  enabled = true,
  totDatum?: string | null
) {
  return useQuery({
    queryKey: ['snijplanning', 'groep', kwaliteitCode, kleurCode, totDatum],
    queryFn: () => fetchSnijplannenVoorGroep(kwaliteitCode, kleurCode, totDatum),
    enabled,
  })
}
```

En in `snijplanning.ts`, pas `fetchSnijplannenVoorGroep` aan:

```typescript
export async function fetchSnijplannenVoorGroep(
  kwaliteitCode: string,
  kleurCode: string,
  totDatum?: string | null
): Promise<SnijplanRow[]> {
  let query = supabase
    .from('snijplanning_overzicht')
    .select('*')
    .eq('kwaliteit_code', kwaliteitCode)
    .eq('kleur_code', kleurCode)
    .order('afleverdatum', { ascending: true, nullsFirst: false })

  if (totDatum) {
    query = query.lte('afleverdatum', totDatum)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as SnijplanRow[]
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/use-snijplanning.ts
git commit -m "feat: snijplanning hooks accepteren datum-filter parameter"
```

---

### Task 5: Frontend — Pagina integreren met week-filter

**Files:**
- Modify: `frontend/src/pages/snijplanning/snijplanning-overview.tsx`

- [ ] **Step 1: Voeg week-filter state en component toe**

Voeg de import en state toe bovenaan het component:

```typescript
import { WeekFilter, berekenTotDatum } from '@/components/snijplanning/week-filter'
```

Voeg state toe in `SnijplanningOverviewPage`:

```typescript
const [wekenVooruit, setWekenVooruit] = useState<number | null>(null)
const totDatum = berekenTotDatum(wekenVooruit)
```

Update de hooks om `totDatum` door te geven:

```typescript
const { data: groepen, isLoading } = useSnijplanningGroepen(search || undefined, totDatum)
const { data: statusCounts } = useSnijplanningStatusCounts(totDatum)
```

- [ ] **Step 2: Plaats de WeekFilter in de UI**

Voeg toe tussen de search en status tabs (rond regel 75, na het search `</div>`):

```tsx
{/* Week filter */}
<div className="mb-4">
  <WeekFilter geselecteerd={wekenVooruit} onChange={setWekenVooruit} />
</div>
```

- [ ] **Step 3: Test de integratie handmatig**

1. Open `/snijplanning` in de browser
2. Klik op "2 weken" — alleen groepen met afleverdatum ≤ 2 weken vooruit verschijnen
3. Klik op "Alle" — terug naar het volledige overzicht
4. Controleer dat status tabs de juiste counts tonen per filter
5. Controleer dat zoeken + week-filter samenwerken

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/snijplanning/snijplanning-overview.tsx
git commit -m "feat: week-filter geintegreerd in snijplanning overzicht"
```

---

### Task 6: Edge function — Datum-filter bij snijvoorstel generatie

**Files:**
- Modify: `supabase/functions/optimaliseer-snijplan/index.ts:320-332`
- Modify: `frontend/src/lib/supabase/queries/snijvoorstel.ts:5-25`
- Modify: `frontend/src/hooks/use-snijplanning.ts:158-168`
- Modify: `frontend/src/components/snijplanning/groep-accordion.tsx` (generateSnijvoorstel call)

- [ ] **Step 1: Edge function — accepteer tot_datum parameter**

In `supabase/functions/optimaliseer-snijplan/index.ts`, voeg `tot_datum` toe aan de request body parsing (rond regel 315):

```typescript
const { kwaliteit_code, kleur_code, tot_datum } = await req.json()
```

Pas de query aan (rond regel 324-331) om `tot_datum` te filteren:

```typescript
let query = supabase
  .from('snijplanning_overzicht')
  .select(
    'id, snij_lengte_cm, snij_breedte_cm, maatwerk_vorm, order_nr, klant_naam, afleverdatum, kwaliteit_code, kleur_code',
  )
  .eq('status', 'Wacht')
  .eq('kwaliteit_code', kwaliteit_code)
  .eq('kleur_code', kleur_code)

if (tot_datum) {
  query = query.lte('afleverdatum', tot_datum)
}

const { data: snijplannen, error: spError } = await query
```

- [ ] **Step 2: Frontend query — stuur tot_datum mee**

In `frontend/src/lib/supabase/queries/snijvoorstel.ts`, pas `generateSnijvoorstel` aan:

```typescript
export async function generateSnijvoorstel(
  kwaliteitCode: string,
  kleurCode: string,
  totDatum?: string | null
): Promise<SnijvoorstelResponse> {
  const body: Record<string, string> = { kwaliteit_code: kwaliteitCode, kleur_code: kleurCode }
  if (totDatum) body.tot_datum = totDatum

  const { data, error } = await supabase.functions.invoke('optimaliseer-snijplan', { body })
  // ... rest unchanged
```

- [ ] **Step 3: Hook — stuur tot_datum mee**

In `frontend/src/hooks/use-snijplanning.ts`, pas `useGenereerSnijvoorstel` aan:

```typescript
export function useGenereerSnijvoorstel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kwaliteitCode, kleurCode, totDatum }: { kwaliteitCode: string; kleurCode: string; totDatum?: string | null }) =>
      generateSnijvoorstel(kwaliteitCode, kleurCode, totDatum),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
    },
  })
}
```

- [ ] **Step 4: GroepAccordion — stuur tot_datum mee bij genereren**

In `frontend/src/components/snijplanning/groep-accordion.tsx`, voeg `totDatum` als prop toe en stuur mee bij de mutatie. De `GroepAccordion` component moet een extra prop `totDatum?: string | null` accepteren en deze doorgeven aan `generateSnijvoorstel.mutate()`:

```tsx
// In de interface/props
interface GroepAccordionProps {
  // ... bestaande props
  totDatum?: string | null
}

// Bij de mutate call
genereerMutatie.mutate({
  kwaliteitCode: kwaliteitCode,
  kleurCode: kleurCode,
  totDatum: totDatum,
})

// Bij de useSnijplannenVoorGroep hook call
const { data: snijplannen } = useSnijplannenVoorGroep(
  kwaliteitCode, kleurCode, isOpen, totDatum
)
```

En in `snijplanning-overview.tsx` de prop doorgeven:

```tsx
<GroepAccordion
  key={`${g.kwaliteit_code}-${g.kleur_code}`}
  // ... bestaande props
  totDatum={totDatum}
/>
```

- [ ] **Step 5: Deploy de edge function**

Run: `npx supabase functions deploy optimaliseer-snijplan`

- [ ] **Step 6: Test de volledige flow**

1. Selecteer "2 weken" filter
2. Klik "Genereren" bij een groep
3. Verifieer dat het snijvoorstel alleen stukken bevat met afleverdatum ≤ 2 weken
4. Klik "Alle" en genereer opnieuw — alle stukken worden meegenomen

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/optimaliseer-snijplan/index.ts frontend/src/lib/supabase/queries/snijvoorstel.ts frontend/src/hooks/use-snijplanning.ts frontend/src/components/snijplanning/groep-accordion.tsx frontend/src/pages/snijplanning/snijplanning-overview.tsx
git commit -m "feat: snijvoorstel generatie respecteert week-filter"
```

---

### Task 7: Documentatie bijwerken

**Files:**
- Modify: `docs/database-schema.md`
- Modify: `docs/changelog.md`

- [ ] **Step 1: Database schema documentatie**

Voeg onder de functies-sectie in `docs/database-schema.md` toe:

```markdown
| snijplanning_groepen_gefilterd(p_tot_datum) | Gegroepeerde snijplanning met optionele afleverdatum-filter |
| snijplanning_status_counts_gefilterd(p_tot_datum) | Status counts met optionele afleverdatum-filter |
```

- [ ] **Step 2: Changelog bijwerken**

Voeg toe aan `docs/changelog.md`:

```markdown
### 2026-04-09 — Snijplanning week-filter
- **Wat:** Leverdatum-filter toegevoegd aan snijplanning overzicht — filtert op week-niveau (deze week, 1-4 weken vooruit)
- **Waarom:** Planning op basis van leverdata — focus op urgente orders ipv heel de backlog
- **Impact:** Nieuwe RPC functies `snijplanning_groepen_gefilterd` en `snijplanning_status_counts_gefilterd`, week-filter component, edge function accepteert `tot_datum`
```

- [ ] **Step 3: Commit**

```bash
git add docs/database-schema.md docs/changelog.md
git commit -m "docs: snijplanning week-filter documentatie"
```
