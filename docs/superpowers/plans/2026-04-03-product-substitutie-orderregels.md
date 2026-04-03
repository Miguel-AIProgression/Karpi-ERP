# Product Substitutie in Orderregels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a product is out of stock, show equivalent alternatives (same collectie + kleur) so the order can reference the ordered product name while reserving stock from a physical substitute — with an "omstickeren" flag for the pakbon.

**Architecture:** Add `fysiek_artikelnr` and `omstickeren` columns to `order_regels` for tracking which physical product to pick. Create a DB function `zoek_equivalente_producten` that finds in-stock alternatives via collecties. Extend the ArticleSelector to show substitution suggestions when stock is 0, and show substitution info in the order line editor.

**Tech Stack:** PostgreSQL (migration), React/TypeScript (frontend components), Supabase client queries.

---

## Hoe het werkt (functioneel)

1. Gebruiker zoekt "DELICATE 155x230" → vrije_voorraad = 0
2. Systeem zoekt automatisch equivalente producten (zelfde collectie + zelfde kleur_code) met voorraad > 0
3. Gebruiker ziet suggesties: "RENAISSANCE 155x230 (vrij: 3)" 
4. Gebruiker kiest substituut → orderregel wordt:
   - `artikelnr` = origineel besteld artikel (DELICATE) — voor factuur & klant
   - `fysiek_artikelnr` = fysiek te leveren artikel (RENAISSANCE) — voor pakbon & voorraad
   - `omstickeren` = true — signaal voor magazijn
5. Voorraadreservering loopt op `fysiek_artikelnr` (RENAISSANCE), niet op besteld artikel
6. Pakbon toont: "RENAISSANCE → omstickeren naar DELICATE"

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/025_product_substitutie.sql` | Create | DB migration: new columns + equivalentie-functie |
| `frontend/src/lib/supabase/queries/product-equivalents.ts` | Create | Query function to fetch equivalent products |
| `frontend/src/components/orders/article-selector.tsx` | Modify | Show substitution suggestions when stock = 0 |
| `frontend/src/components/orders/substitution-picker.tsx` | Create | UI for picking a substitute product |
| `frontend/src/components/orders/order-line-editor.tsx` | Modify | Show substitution info on order lines |
| `frontend/src/lib/supabase/queries/order-mutations.ts` | Modify | Pass fysiek_artikelnr + omstickeren to RPC |
| `frontend/src/lib/supabase/queries/orders.ts` | Modify | Load substitution data in fetchOrderRegels (edit mode) |
| `docs/database-schema.md` | Modify | Document new columns + function |
| `docs/changelog.md` | Modify | Log the change |

---

## Task 1: Database Migration — Nieuwe kolommen + equivalentie-functie

**Files:**
- Create: `supabase/migrations/025_product_substitutie.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 025_product_substitutie.sql
-- Voeg substitutie-kolommen toe aan order_regels
-- en maak een functie om equivalente producten te vinden

-- 1. Nieuwe kolommen op order_regels
ALTER TABLE public.order_regels
  ADD COLUMN fysiek_artikelnr TEXT REFERENCES public.producten(artikelnr),
  ADD COLUMN omstickeren BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_regels.fysiek_artikelnr
  IS 'Artikelnr van het fysiek te leveren product (bij substitutie). NULL = zelfde als artikelnr.';
COMMENT ON COLUMN public.order_regels.omstickeren
  IS 'True als het fysieke product omgestickerd moet worden naar de bestelde productnaam.';

-- 2. Functie: zoek equivalente producten met voorraad
CREATE OR REPLACE FUNCTION zoek_equivalente_producten(
  p_artikelnr TEXT,
  p_min_voorraad INTEGER DEFAULT 1
)
RETURNS TABLE(
  artikelnr       TEXT,
  karpi_code      TEXT,
  omschrijving    TEXT,
  kwaliteit_code  TEXT,
  kleur_code      TEXT,
  vrije_voorraad  INTEGER,
  besteld_inkoop  INTEGER,
  verkoopprijs    NUMERIC(10,2)
) AS $$
DECLARE
  v_collectie_id  BIGINT;
  v_kleur_code    TEXT;
BEGIN
  -- Haal collectie + kleur op van het bronproduct
  SELECT k.collectie_id, p.kleur_code
    INTO v_collectie_id, v_kleur_code
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE p.artikelnr = p_artikelnr;

  -- Geen collectie = geen equivalenten
  IF v_collectie_id IS NULL THEN
    RETURN;
  END IF;

  -- Zoek producten met zelfde collectie + zelfde kleur, maar ander artikelnr
  RETURN QUERY
  SELECT p.artikelnr,
         p.karpi_code,
         p.omschrijving,
         p.kwaliteit_code,
         p.kleur_code,
         p.vrije_voorraad,
         p.besteld_inkoop,
         p.verkoopprijs
    FROM producten p
    JOIN kwaliteiten k ON k.code = p.kwaliteit_code
   WHERE k.collectie_id = v_collectie_id
     AND p.kleur_code = v_kleur_code
     AND p.artikelnr <> p_artikelnr
     AND p.actief = true
     AND p.vrije_voorraad >= p_min_voorraad
   ORDER BY p.vrije_voorraad DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. Update reservering-functie: gebruik fysiek_artikelnr als die gezet is
-- Originele functie (migration 020) berekende:
--   gereserveerd = SUM(te_leveren) WHERE artikelnr = p_artikelnr
-- Nieuwe versie gebruikt COALESCE(fysiek_artikelnr, artikelnr) zodat
-- voorraad gereserveerd wordt op het FYSIEKE product, niet het bestelde.
CREATE OR REPLACE FUNCTION herbereken_product_reservering(p_artikelnr TEXT)
RETURNS VOID AS $$
DECLARE
    v_gereserveerd INTEGER;
BEGIN
  -- Lock producten-rij om race conditions te voorkomen
  PERFORM 1 FROM producten WHERE artikelnr = p_artikelnr FOR UPDATE;

  SELECT COALESCE(SUM(or2.te_leveren), 0)
    INTO v_gereserveerd
    FROM order_regels or2
    JOIN orders o ON o.id = or2.order_id
   WHERE COALESCE(or2.fysiek_artikelnr, or2.artikelnr) = p_artikelnr
     AND o.status NOT IN ('Verzonden', 'Geannuleerd');

  UPDATE producten
     SET gereserveerd = v_gereserveerd,
         vrije_voorraad = voorraad - v_gereserveerd - backorder + besteld_inkoop
   WHERE artikelnr = p_artikelnr;
END;
$$ LANGUAGE plpgsql;

-- 4. Update de orderregel-trigger om ook fysiek_artikelnr te herberekenen
CREATE OR REPLACE FUNCTION update_reservering_bij_orderregel()
RETURNS TRIGGER AS $$
BEGIN
  -- Bij DELETE of UPDATE: herbereken voor het OUDE (fysieke) artikelnr
  IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.artikelnr IS NOT NULL THEN
    PERFORM herbereken_product_reservering(COALESCE(OLD.fysiek_artikelnr, OLD.artikelnr));
    -- Als fysiek verschilt van besteld, herbereken ook het bestelde product
    IF OLD.fysiek_artikelnr IS NOT NULL AND OLD.fysiek_artikelnr IS DISTINCT FROM OLD.artikelnr THEN
      PERFORM herbereken_product_reservering(OLD.artikelnr);
    END IF;
  END IF;

  -- Bij INSERT of UPDATE: herbereken voor het NIEUWE (fysieke) artikelnr
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.artikelnr IS NOT NULL THEN
    IF TG_OP = 'INSERT'
       OR OLD.artikelnr IS DISTINCT FROM NEW.artikelnr
       OR OLD.fysiek_artikelnr IS DISTINCT FROM NEW.fysiek_artikelnr THEN
      PERFORM herbereken_product_reservering(COALESCE(NEW.fysiek_artikelnr, NEW.artikelnr));
      IF NEW.fysiek_artikelnr IS NOT NULL AND NEW.fysiek_artikelnr IS DISTINCT FROM NEW.artikelnr THEN
        PERFORM herbereken_product_reservering(NEW.artikelnr);
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 5. Update de order-status-trigger om fysiek_artikelnr te herberekenen
CREATE OR REPLACE FUNCTION update_reservering_bij_order_status()
RETURNS TRIGGER AS $$
DECLARE
    v_artikelnr TEXT;
    v_fysiek    TEXT;
BEGIN
  FOR v_artikelnr, v_fysiek IN
    SELECT DISTINCT artikelnr, fysiek_artikelnr
    FROM order_regels
    WHERE order_id = NEW.id
      AND artikelnr IS NOT NULL
  LOOP
    PERFORM herbereken_product_reservering(COALESCE(v_fysiek, v_artikelnr));
    IF v_fysiek IS NOT NULL AND v_fysiek IS DISTINCT FROM v_artikelnr THEN
      PERFORM herbereken_product_reservering(v_artikelnr);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Zorg dat triggers bestaan (CREATE OR REPLACE triggers bestaan niet in PG,
--    dus DROP IF EXISTS + CREATE)
DROP TRIGGER IF EXISTS trg_reservering_orderregel ON order_regels;
CREATE TRIGGER trg_reservering_orderregel
    AFTER INSERT OR UPDATE OR DELETE ON order_regels
    FOR EACH ROW
    EXECUTE FUNCTION update_reservering_bij_orderregel();

DROP TRIGGER IF EXISTS trg_reservering_order_status ON orders;
CREATE TRIGGER trg_reservering_order_status
    AFTER UPDATE ON orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION update_reservering_bij_order_status();
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with name `product_substitutie` and the SQL above.

- [ ] **Step 3: Verify migration applied**

Run via `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'order_regels'
  AND column_name IN ('fysiek_artikelnr', 'omstickeren');
```
Expected: 2 rows returned.

Then test the function:
```sql
-- Test met een willekeurig product dat in een collectie zit
SELECT * FROM zoek_equivalente_producten('526160132') LIMIT 5;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/025_product_substitutie.sql
git commit -m "feat: add product substitution columns and equivalence function"
```

---

## Task 2: Frontend Query — Equivalente producten ophalen

**Files:**
- Create: `frontend/src/lib/supabase/queries/product-equivalents.ts`

- [ ] **Step 1: Create the query function**

```typescript
// frontend/src/lib/supabase/queries/product-equivalents.ts
import { supabase } from '../client'

export interface EquivalentProduct {
  artikelnr: string
  karpi_code: string | null
  omschrijving: string
  kwaliteit_code: string
  kleur_code: string
  vrije_voorraad: number
  besteld_inkoop: number
  verkoopprijs: number | null
}

/** Fetch equivalent in-stock products for a given artikelnr */
export async function fetchEquivalenteProducten(
  artikelnr: string,
  minVoorraad: number = 1
): Promise<EquivalentProduct[]> {
  const { data, error } = await supabase.rpc('zoek_equivalente_producten', {
    p_artikelnr: artikelnr,
    p_min_voorraad: minVoorraad,
  })

  if (error) throw error
  return (data ?? []) as EquivalentProduct[]
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/supabase/queries/product-equivalents.ts
git commit -m "feat: add query function for equivalent products"
```

---

## Task 3: Substitution Picker Component

**Files:**
- Create: `frontend/src/components/orders/substitution-picker.tsx`

- [ ] **Step 1: Create the SubstitutionPicker component**

Dit component verschijnt wanneer een geselecteerd artikel vrije_voorraad <= 0 heeft en er equivalenten beschikbaar zijn.

```tsx
// frontend/src/components/orders/substitution-picker.tsx
import { useState, useEffect } from 'react'
import { ArrowRightLeft, Package } from 'lucide-react'
import { fetchEquivalenteProducten, type EquivalentProduct } from '@/lib/supabase/queries/product-equivalents'

interface SubstitutionPickerProps {
  artikelnr: string
  omschrijving: string
  onSelect: (equivalent: EquivalentProduct) => void
  onSkip: () => void
}

export function SubstitutionPicker({ artikelnr, omschrijving, onSelect, onSkip }: SubstitutionPickerProps) {
  const [equivalents, setEquivalents] = useState<EquivalentProduct[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchEquivalenteProducten(artikelnr)
      .then((data) => { if (!cancelled) setEquivalents(data) })
      .catch(() => { if (!cancelled) setEquivalents([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [artikelnr])

  if (loading) {
    return (
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-sm text-amber-700">
        Equivalente producten zoeken...
      </div>
    )
  }

  if (equivalents.length === 0) {
    return (
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-sm">
        <p className="text-amber-700 mb-2">
          <strong>{omschrijving}</strong> is niet op voorraad en er zijn geen equivalenten beschikbaar.
        </p>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-amber-600 underline hover:text-amber-800"
        >
          Toch toevoegen zonder voorraad
        </button>
      </div>
    )
  }

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-sm">
      <div className="flex items-center gap-2 text-amber-700 mb-3">
        <ArrowRightLeft size={14} />
        <span>
          <strong>{omschrijving}</strong> is niet op voorraad. 
          Kies een equivalent product om fysiek te leveren (wordt omgestickerd):
        </span>
      </div>

      <div className="space-y-1">
        {equivalents.map((eq) => (
          <button
            key={eq.artikelnr}
            type="button"
            onClick={() => onSelect(eq)}
            className="w-full text-left px-3 py-2 bg-white rounded border border-amber-100 hover:border-amber-300 hover:bg-amber-25 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-xs text-terracotta-500">{eq.artikelnr}</span>
                <span className="ml-2">{eq.omschrijving}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-xs text-emerald-600">
                  <Package size={10} className="inline mr-1" />
                  Vrij: {eq.vrije_voorraad}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onSkip}
        className="mt-2 text-xs text-amber-600 underline hover:text-amber-800"
      >
        Toch origineel toevoegen zonder voorraad
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/orders/substitution-picker.tsx
git commit -m "feat: add SubstitutionPicker component for equivalent products"
```

---

## Task 4: Extend ArticleSelector met substitutie-flow

**Files:**
- Modify: `frontend/src/components/orders/article-selector.tsx`

- [ ] **Step 1: Update SelectedArticle interface en callback**

Voeg substitutie-info toe aan `SelectedArticle` en een nieuwe callback voor wanneer het artikel geen voorraad heeft:

```typescript
// In article-selector.tsx — extend SelectedArticle
export interface SelectedArticle {
  artikelnr: string
  karpi_code: string | null
  omschrijving: string
  verkoopprijs: number | null
  gewicht_kg: number | null
  vrije_voorraad: number
  besteld_inkoop: number
  kwaliteit_code: string | null
}

// Nieuw: substitutie-info die meegegeven wordt bij selectie
export interface SubstitutionInfo {
  fysiek_artikelnr: string
  fysiek_omschrijving: string
  fysiek_karpi_code: string | null
  fysiek_vrije_voorraad: number
  omstickeren: true
}

interface ArticleSelectorProps {
  onSelect: (article: SelectedArticle, substitution?: SubstitutionInfo) => void
}
```

- [ ] **Step 2: Add substitution state and SubstitutionPicker**

Na het selecteren van een artikel met vrije_voorraad <= 0, toon de SubstitutionPicker:

```tsx
// In ArticleSelector component, add state:
const [pendingArticle, setPendingArticle] = useState<SelectedArticle | null>(null)

// Replace the existing onClick handler in the results list:
onClick={() => {
  if (article.vrije_voorraad <= 0) {
    // No stock → show substitution picker
    setPendingArticle(article)
    setSearch('')
    setOpen(false)
  } else {
    // In stock → direct select
    onSelect(article)
    setSearch('')
    setOpen(false)
  }
}}

// Add SubstitutionPicker below the search dropdown:
{pendingArticle && (
  <SubstitutionPicker
    artikelnr={pendingArticle.artikelnr}
    omschrijving={pendingArticle.omschrijving}
    onSelect={(equivalent) => {
      onSelect(pendingArticle, {
        fysiek_artikelnr: equivalent.artikelnr,
        fysiek_omschrijving: equivalent.omschrijving,
        fysiek_karpi_code: equivalent.karpi_code,
        fysiek_vrije_voorraad: equivalent.vrije_voorraad,
        omstickeren: true,
      })
      setPendingArticle(null)
    }}
    onSkip={() => {
      // Voeg origineel toe zonder substitutie
      onSelect(pendingArticle)
      setPendingArticle(null)
    }}
  />
)}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/orders/article-selector.tsx
git commit -m "feat: integrate substitution flow in ArticleSelector"
```

---

## Task 5: Extend OrderRegelFormData en OrderLineEditor

**Files:**
- Modify: `frontend/src/lib/supabase/queries/order-mutations.ts`
- Modify: `frontend/src/components/orders/order-line-editor.tsx`

- [ ] **Step 1: Add substitution fields to OrderRegelFormData**

In `order-mutations.ts`, extend the interface:

```typescript
export interface OrderRegelFormData {
  artikelnr?: string
  karpi_code?: string
  omschrijving: string
  omschrijving_2?: string
  orderaantal: number
  te_leveren: number
  prijs?: number
  korting_pct: number
  bedrag?: number
  gewicht_kg?: number
  // Display-only fields (not sent to RPC)
  vrije_voorraad?: number
  besteld_inkoop?: number
  klant_eigen_naam?: string
  klant_artikelnr?: string
  // Substitutie fields
  fysiek_artikelnr?: string
  fysiek_omschrijving?: string  // Display-only
  omstickeren?: boolean
}
```

- [ ] **Step 2: Pass substitution fields to RPC**

In `createOrder()` en `updateOrderWithLines()`, add to `p_regels` mapping:

```typescript
const p_regels = regels.map((r, i) => ({
  regelnummer: i + 1,
  artikelnr: r.artikelnr || null,
  karpi_code: r.karpi_code || null,
  omschrijving: r.omschrijving,
  omschrijving_2: r.omschrijving_2 || null,
  orderaantal: r.orderaantal,
  te_leveren: r.te_leveren,
  prijs: r.prijs ?? null,
  korting_pct: r.korting_pct,
  bedrag: r.bedrag ?? null,
  gewicht_kg: r.gewicht_kg ?? null,
  // Substitutie
  fysiek_artikelnr: r.fysiek_artikelnr || null,
  omstickeren: r.omstickeren ?? false,
}))
```

- [ ] **Step 3: Update OrderLineEditor to handle substitution**

In `order-line-editor.tsx`, update `addArticle` to accept SubstitutionInfo:

```tsx
import type { SubstitutionInfo } from './article-selector'

// Update addArticle signature:
const addArticle = async (article: SelectedArticle, substitution?: SubstitutionInfo) => {
  // ... existing price/klant lookup logic ...

  const newLine: OrderRegelFormData = {
    artikelnr: article.artikelnr,
    karpi_code: article.karpi_code ?? undefined,
    omschrijving: article.omschrijving,
    orderaantal: 1,
    te_leveren: 1,
    prijs: prijs ?? undefined,
    korting_pct: defaultKorting,
    gewicht_kg: article.gewicht_kg ?? undefined,
    bedrag: 0,
    vrije_voorraad: substitution ? substitution.fysiek_vrije_voorraad : article.vrije_voorraad,
    besteld_inkoop: article.besteld_inkoop,
    klant_eigen_naam,
    klant_artikelnr,
    // Substitutie
    fysiek_artikelnr: substitution?.fysiek_artikelnr,
    fysiek_omschrijving: substitution?.fysiek_omschrijving,
    omstickeren: substitution?.omstickeren,
  }
  newLine.bedrag = calcBedrag(newLine)
  onChange([...lines, newLine])
}
```

- [ ] **Step 4: Show substitution indicator in the order lines table**

In the `<tbody>` of the order lines table, after the artikelnr cell, add a substitution indicator:

```tsx
<td className="px-3 py-2">
  <div className="font-mono text-xs text-slate-500">
    {line.artikelnr ?? '—'}
  </div>
  {line.klant_artikelnr && (
    <div className="text-xs text-blue-500" title="Klant artikelnr">
      {line.klant_artikelnr}
    </div>
  )}
  {/* Substitutie indicator */}
  {line.omstickeren && line.fysiek_artikelnr && (
    <div className="text-xs text-amber-600 flex items-center gap-1 mt-0.5" title="Wordt omgestickerd">
      ↔ Fysiek: {line.fysiek_artikelnr}
    </div>
  )}
</td>

{/* In omschrijving cel, toon ook fysiek omschrijving */}
<td className="px-3 py-2">
  <input ... /> {/* bestaand */}
  {line.klant_eigen_naam && ( ... )} {/* bestaand */}
  {line.omstickeren && line.fysiek_omschrijving && (
    <div className="text-xs text-amber-600 mt-0.5">
      Omstickeren van: {line.fysiek_omschrijving}
    </div>
  )}
</td>
```

- [ ] **Step 5: Update ArticleSelector onSelect prop type**

The `ArticleSelector`'s `onSelect` prop now passes `SubstitutionInfo` as second arg. Update `OrderLineEditor` to thread this through:

```tsx
<ArticleSelector onSelect={addArticle} />
```

This already works because `addArticle` now accepts the second argument.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/supabase/queries/order-mutations.ts
git add frontend/src/components/orders/order-line-editor.tsx
git commit -m "feat: show substitution info in order lines and pass to RPC"
```

---

## Task 6: Update RPC functies voor substitutie-kolommen

**Files:**
- Create: `supabase/migrations/026_rpc_substitutie_kolommen.sql`

De bestaande `create_order_with_lines` en `update_order_with_lines` RPC's moeten de nieuwe kolommen `fysiek_artikelnr` en `omstickeren` uit de `p_regels` JSON extracten en inserten.

- [ ] **Step 1: Fetch current RPC source code**

Run via `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT proname, prosrc FROM pg_proc WHERE proname IN ('create_order_with_lines', 'update_order_with_lines');
```

This gives us the exact current function bodies. The RPCs accept `p_regels JSONB` and loop through the array, extracting fields with `regel->>'field_name'` syntax. We need to add `fysiek_artikelnr` and `omstickeren` to the INSERT column list and VALUES.

- [ ] **Step 2: Write the migration**

Based on the RPC source from Step 1, create `supabase/migrations/026_rpc_substitutie_kolommen.sql`. The migration must `CREATE OR REPLACE FUNCTION` for both RPCs, adding these to the INSERT on `order_regels`:

In the column list, add:
```sql
fysiek_artikelnr, omstickeren
```

In the VALUES, add:
```sql
(regel->>'fysiek_artikelnr')::TEXT,
COALESCE((regel->>'omstickeren')::BOOLEAN, false)
```

Also update `delete_order` to collect `fysiek_artikelnr` for reservation recalculation:
```sql
-- In delete_order, change the temp table to also collect fysiek_artikelnr:
CREATE TEMP TABLE _tmp_affected_artikels ON COMMIT DROP AS
    SELECT DISTINCT COALESCE(fysiek_artikelnr, artikelnr) AS artikelnr
    FROM order_regels
    WHERE order_id = p_order_id
      AND artikelnr IS NOT NULL
    UNION
    SELECT DISTINCT artikelnr
    FROM order_regels
    WHERE order_id = p_order_id
      AND fysiek_artikelnr IS NOT NULL
      AND fysiek_artikelnr IS DISTINCT FROM artikelnr;
```

- [ ] **Step 3: Apply migration**

Use `mcp__claude_ai_Supabase__apply_migration` with name `rpc_substitutie_kolommen`.

- [ ] **Step 4: Verify**

```sql
-- Controleer dat de RPC de nieuwe kolommen accepteert
SELECT prosrc FROM pg_proc WHERE proname = 'create_order_with_lines';
-- Zoek naar 'fysiek_artikelnr' in de output
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/026_rpc_substitutie_kolommen.sql
git commit -m "feat: update order RPCs to handle substitution columns"
```

---

## Task 7: Update fetchOrderRegels voor edit mode

**Files:**
- Modify: `frontend/src/lib/supabase/queries/orders.ts:39-56` (OrderRegel interface)
- Modify: `frontend/src/lib/supabase/queries/orders.ts:161-236` (fetchOrderRegels function)

Zonder deze wijziging wordt substitutie-data verloren bij het bewerken van een bestaande order.

- [ ] **Step 1: Add substitution fields to OrderRegel interface**

In `orders.ts`, extend the `OrderRegel` interface (line 39):

```typescript
export interface OrderRegel {
  id: number
  regelnummer: number
  artikelnr: string | null
  karpi_code: string | null
  omschrijving: string
  omschrijving_2: string | null
  orderaantal: number
  te_leveren: number
  backorder: number
  prijs: number | null
  korting_pct: number
  bedrag: number | null
  gewicht_kg: number | null
  vrije_voorraad: number | null
  klant_eigen_naam?: string | null
  klant_artikelnr?: string | null
  // Substitutie
  fysiek_artikelnr?: string | null
  omstickeren?: boolean
  fysiek_omschrijving?: string | null  // Enriched from producten join
}
```

- [ ] **Step 2: Add new columns to the select query**

In `fetchOrderRegels`, update the `.select()` call (line 171) to include the new columns:

```typescript
.select('id, regelnummer, artikelnr, karpi_code, omschrijving, omschrijving_2, orderaantal, te_leveren, backorder, prijs, korting_pct, bedrag, gewicht_kg, vrije_voorraad, fysiek_artikelnr, omstickeren, producten(kwaliteit_code)')
```

- [ ] **Step 3: Update toRegel mapping**

In the `toRegel` function (line 191), add the new fields:

```typescript
return {
  // ...existing fields...
  fysiek_artikelnr: row.fysiek_artikelnr ?? null,
  omstickeren: row.omstickeren ?? false,
  klant_eigen_naam: kwalCode && eigenNaamMap ? eigenNaamMap.get(kwalCode) ?? null : null,
  klant_artikelnr: row.artikelnr && klantArtMap ? klantArtMap.get(row.artikelnr) ?? null : null,
}
```

- [ ] **Step 4: Enrich fysiek_omschrijving for display**

After the existing klanteigen/klantart lookups, add a batch lookup for fysiek product descriptions:

```typescript
// Fetch omschrijving for substituted products
const fysiekeArtikelnrs = regels
  .map((r: any) => r.fysiek_artikelnr)
  .filter((a: string | null) => a != null) as string[]

let fysiekOmschMap = new Map<string, string>()
if (fysiekeArtikelnrs.length > 0) {
  const { data: fysiekData } = await supabase
    .from('producten')
    .select('artikelnr, omschrijving')
    .in('artikelnr', fysiekeArtikelnrs)
  fysiekOmschMap = new Map(
    (fysiekData ?? []).map((p: { artikelnr: string; omschrijving: string }) => [p.artikelnr, p.omschrijving])
  )
}
```

Then pass `fysiekOmschMap` to `toRegel` and add:
```typescript
fysiek_omschrijving: row.fysiek_artikelnr && fysiekOmschMap 
  ? fysiekOmschMap.get(row.fysiek_artikelnr) ?? null : null,
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/supabase/queries/orders.ts
git commit -m "feat: load substitution data in fetchOrderRegels for edit mode"
```

---

## Task 8: Update OrderForm handleArticleSelected

**Files:**
- Modify: `frontend/src/components/orders/order-form.tsx`

- [ ] **Step 1: Thread SubstitutionInfo through OrderForm**

De `onArticleSelected` callback in OrderForm doet price/klant lookups. Die hoeft niet te veranderen — de substitutie-info wordt al door ArticleSelector → OrderLineEditor afgehandeld.

Maar we moeten wel de `onArticleSelected` prop type updaten in `OrderLineEditorProps` zodat het compatible blijft:

Controleer dat `OrderLineEditor` de `onArticleSelected` callback correct doorgeeft aan `ArticleSelector`. De `addArticle` functie in `OrderLineEditor` ontvangt nu een optionele `SubstitutionInfo` parameter, maar de `onArticleSelected` callback (price lookup) ontvangt alleen het artikel.

Geen wijziging nodig als de architectuur klopt: `onArticleSelected` doet alleen prijs-lookup, substitutie wordt apart afgehandeld in `addArticle`.

- [ ] **Step 2: Verify the flow compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit (if changes needed)**

---

## Task 9: Documentatie bijwerken

**Files:**
- Modify: `docs/database-schema.md`
- Modify: `docs/changelog.md`

- [ ] **Step 1: Update database-schema.md**

Voeg toe bij `order_regels` tabel:

```markdown
| fysiek_artikelnr | TEXT FK → producten | Fysiek te leveren artikel bij substitutie (NULL = zelfde als artikelnr) |
| omstickeren      | BOOLEAN             | Product moet omgestickerd worden naar bestelde naam                      |
```

Voeg toe bij Functies sectie:

```markdown
### zoek_equivalente_producten(p_artikelnr TEXT, p_min_voorraad INTEGER)
Zoekt producten met dezelfde collectie + kleur_code die op voorraad zijn.
Gebruikt voor automatische substitutie-suggesties bij orderaanmaak.
```

- [ ] **Step 2: Update changelog.md**

```markdown
## 2026-04-03 — Product substitutie bij orderregels

- **Database:** `fysiek_artikelnr` en `omstickeren` kolommen op `order_regels`
- **Database:** `zoek_equivalente_producten()` functie voor equivalentie-lookup via collecties
- **Database:** Reserveringstrigger aangepast: reserveert op `fysiek_artikelnr` (indien gezet)
- **Frontend:** ArticleSelector toont automatisch substitutie-suggesties bij voorraad = 0
- **Frontend:** SubstitutionPicker component voor kiezen van equivalent product
- **Frontend:** Orderregels tonen substitutie-indicator (fysiek artikel + omstickeren badge)
- **Doel:** Klant bestelt product X (factuur), magazijn levert product Y (pakbon) en stickert om
```

- [ ] **Step 3: Commit**

```bash
git add docs/database-schema.md docs/changelog.md
git commit -m "docs: document product substitution feature"
```

---

## Aandachtspunten

1. **Reservering loopt op fysiek product** — De trigger `herbereken_product_reservering` is aangepast om `COALESCE(fysiek_artikelnr, artikelnr)` te gebruiken. Dit zorgt dat voorraad van het juiste product gereserveerd wordt.

2. **Pakbon-logica (toekomstig)** — De pakbon-module moet straks `fysiek_artikelnr` + `omstickeren` flag gebruiken om:
   - Het fysieke product op de picklijst te zetten
   - "Omstickeren naar [besteld product]" als instructie te tonen

3. **Edit mode** — Task 7 zorgt dat `fetchOrderRegels` de substitutie-kolommen laadt. Het order-edit formulier moet deze data doorgeven aan `OrderLineEditor` zodat de substitutie-indicator zichtbaar is bij bewerken.

4. **Prijslijst** — De prijs wordt opgezocht op basis van het *bestelde* artikelnr (niet het fysieke), want de klant betaalt voor wat hij besteld heeft.
