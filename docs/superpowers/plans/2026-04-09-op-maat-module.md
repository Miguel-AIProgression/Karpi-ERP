# Op Maat Module — Order Aanmaken Implementation Plan (v2 — herzien na 4-domein review)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voeg een "Op maat product" keuze toe aan het order-aanmaakproces, met configureerbare vormen (met toeslag), m²-prijsberekening, en instelbare afwerkingen met standaard per kwaliteit.

**Architecture:** Vier nieuwe database-tabellen + een DB-functie. De order-line-editor krijgt een toggle "Standaard / Op maat". Bij "Op maat" verschijnt een `OpMaatSelector` (opgesplitst in sub-componenten) met zoekbare kwaliteit-combobox → kleur → vorm → afmeting → afwerking, inclusief max-breedte validatie en gewichtberekening. Prijs op basis van instelbare m²-prijs per kwaliteit/kleur. Bestaand "rol-product" invoerpad redirectt naar OpMaatSelector.

**Tech Stack:** Supabase (PostgreSQL), React 18, TypeScript, TanStack Query, TailwindCSS, shadcn/ui patterns

**Fasering:**
- **Fase 1 (Tasks 1-8):** Werkend op-maat bestellen — database, queries, componenten, integratie
- **Fase 2 (Tasks 9-11):** Admin UI — instellingenpagina's voor vormen/afwerkingen, navigatie

---

## Review-bevindingen verwerkt

Deze v2 lost de volgende kritieke issues op (gevonden door 4 parallelle review-agents):

| # | Issue | Oplossing |
|---|-------|-----------|
| 1 | m²-prijs uit gemiddelde rollen-vvp is onbetrouwbaar | Nieuwe `maatwerk_m2_prijzen` tabel met instelbare prijs per kwaliteit/kleur |
| 2 | artikelnr=null breekt snijplanning grouping | Expliciete `kwaliteit_code` + `kleur_code` kolommen op `order_regels` |
| 3 | Kwaliteit-dropdown onbruikbaar (997 opties) | Zoekbare combobox (pattern uit ClientSelector) |
| 4 | Hardcoded vorm-checks in 8 snijplanning-bestanden | Nieuw Task voor fallback-handling + VORM_LABELS mapping |
| 5 | CHECK constraint blokkeert nieuwe afwerkingen | DROP CONSTRAINT in migratie |
| 6 | FK constraints ontbreken | `ON DELETE RESTRICT` voor vormen en afwerkingen |
| 7 | Max breedte niet gevalideerd | Validatie tegen rolbreedte uit voorraad |
| 8 | Gewicht ontbreekt bij op-maat regels | Berekening via gewicht/m² uit kwaliteit |
| 9 | OpMaatSelector te complex (10 useState) | Opsplitsen + useReducer |
| 10 | Twee invoerpaden creëren inconsistentie | Rol-producten redirecten naar OpMaatSelector |
| 11 | fetchKleurenVoorKwaliteit: 2 queries + client-join | DB-functie `kleuren_voor_kwaliteit()` |
| 12 | RLS policies ontbreken | Toegevoegd aan migratie |
| 13 | Responsive breakpoints ontbreken | `grid-cols-1 sm:grid-cols-X` pattern |
| 14 | Kostprijs nergens gevuld | Vul vanuit rollen inkoopprijs |

---

## File Structure

### Nieuwe bestanden:
| Bestand | Verantwoordelijkheid |
|---------|---------------------|
| `supabase/migrations/041_op_maat_configuratie.sql` | DB: 4 tabellen, kolommen, functie, DROP CHECK, FK constraints, RLS |
| `supabase/migrations/042_update_order_rpc_opmaat.sql` | RPC: maatwerk+prijsvelden in create/update order |
| `frontend/src/components/orders/op-maat-selector.tsx` | Container: useReducer + orchestratie |
| `frontend/src/components/orders/kwaliteit-kleur-selector.tsx` | Zoekbare kwaliteit + kleur selectie |
| `frontend/src/components/orders/vorm-afmeting-selector.tsx` | Vorm keuze + dynamische afmeting invoer + max-breedte |
| `frontend/src/components/orders/product-type-toggle.tsx` | Toggle "Standaard / Op maat" |
| `frontend/src/lib/supabase/queries/op-maat.ts` | Queries voor vormen, afwerkingen, m²-prijzen |
| `frontend/src/lib/utils/maatwerk-prijs.ts` | Pure functies: oppervlak, prijs, gewicht |
| `frontend/src/lib/utils/vorm-labels.ts` | VORM_LABELS mapping (vervangt hardcoded checks) |
| `frontend/src/pages/instellingen/vormen-beheer.tsx` | (Fase 2) CRUD vormen |
| `frontend/src/pages/instellingen/afwerkingen-beheer.tsx` | (Fase 2) CRUD afwerkingen |

### Bestaande bestanden die wijzigen:
| Bestand | Wijziging |
|---------|-----------|
| `frontend/src/components/orders/order-line-editor.tsx` | Toggle, OpMaatSelector, m²-weergave, redirect rol→opmaat |
| `frontend/src/components/orders/order-form.tsx` | Gewicht-berekening bij op-maat regels |
| `frontend/src/lib/supabase/queries/order-mutations.ts` | Nieuwe velden in interface + RPC mapping |
| `frontend/src/lib/types/productie.ts` | MaatwerkVorm → string |
| `frontend/src/components/snijplanning/snij-visualisatie.tsx` | Gebruik VORM_LABELS, fallback voor nieuwe vormen |
| `frontend/src/components/snijplanning/groep-accordion.tsx` | Gebruik VORM_LABELS |
| `frontend/src/components/snijplanning/sticker-layout.tsx` | Gebruik VORM_LABELS |
| `frontend/src/components/snijplanning/snijstukken-tabel.tsx` | Gebruik VORM_LABELS |
| `frontend/src/components/snijplanning/week-groep-accordion.tsx` | Gebruik VORM_LABELS |
| `frontend/src/components/orders/order-regels-table.tsx` | Gebruik VORM_LABELS |
| `frontend/src/pages/snijplanning/rol-snijvoorstel.tsx` | Default vorm fallback |
| `frontend/src/pages/snijplanning/snijvoorstel-review.tsx` | Default vorm fallback |
| `frontend/src/router.tsx` | (Fase 2) Routes voor beheer-pagina's |
| `docs/database-schema.md` | Nieuwe tabellen + kolommen |
| `docs/changelog.md` | Wijzigingen loggen |

---

## FASE 1: Kernfunctionaliteit

---

## Task 1: Database migratie — Configuratie + constraints

**Files:**
- Create: `supabase/migrations/041_op_maat_configuratie.sql`

- [ ] **Step 1: Schrijf de migratie SQL**

```sql
-- Migration 041: Op Maat configuratie
-- Nieuwe tabellen, kolommen, functies, constraints, RLS

-- ============================================================
-- 1. Maatwerk Vormen
-- ============================================================
CREATE TABLE maatwerk_vormen (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  naam TEXT NOT NULL,
  afmeting_type TEXT NOT NULL DEFAULT 'lengte_breedte'
    CHECK (afmeting_type IN ('lengte_breedte', 'diameter')),
  toeslag NUMERIC(10,2) NOT NULL DEFAULT 0,
  actief BOOLEAN NOT NULL DEFAULT true,
  volgorde INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO maatwerk_vormen (code, naam, afmeting_type, toeslag, volgorde) VALUES
  ('rechthoek',      'Rechthoek',              'lengte_breedte', 0,     1),
  ('rond',           'Rond',                   'diameter',       0,     2),
  ('ovaal',          'Ovaal',                  'lengte_breedte', 0,     3),
  ('organisch_a',    'Organisch A',            'lengte_breedte', 20.00, 4),
  ('organisch_b_sp', 'Organisch B gespiegeld', 'lengte_breedte', 20.00, 5);

-- ============================================================
-- 2. Afwerking Types (vervangt hardcoded CHECK constraint)
-- ============================================================
CREATE TABLE afwerking_types (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  naam TEXT NOT NULL,
  prijs NUMERIC(10,2) NOT NULL DEFAULT 0,
  heeft_band_kleur BOOLEAN NOT NULL DEFAULT false,
  actief BOOLEAN NOT NULL DEFAULT true,
  volgorde INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO afwerking_types (code, naam, prijs, heeft_band_kleur, volgorde) VALUES
  ('B',  'Breedband',        0, true,  1),
  ('FE', 'Feston',           0, false, 2),
  ('LO', 'Locken',           0, false, 3),
  ('ON', 'Onafgewerkt',      0, false, 4),
  ('SB', 'Smalband',         0, true,  5),
  ('SF', 'Smalfeston',       0, false, 6),
  ('VO', 'Volume afwerking', 0, false, 7),
  ('ZO', 'Zonder afwerking', 0, false, 8);

-- ============================================================
-- 3. Standaard afwerking per kwaliteit
-- ============================================================
CREATE TABLE kwaliteit_standaard_afwerking (
  kwaliteit_code TEXT NOT NULL REFERENCES kwaliteiten(code) ON DELETE CASCADE,
  afwerking_code TEXT NOT NULL REFERENCES afwerking_types(code) ON DELETE CASCADE,
  PRIMARY KEY (kwaliteit_code)
);

CREATE INDEX idx_ksa_afwerking ON kwaliteit_standaard_afwerking(afwerking_code);

-- ============================================================
-- 4. Instelbare m2-prijzen per kwaliteit/kleur
-- ============================================================
CREATE TABLE maatwerk_m2_prijzen (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kwaliteit_code TEXT NOT NULL REFERENCES kwaliteiten(code) ON DELETE CASCADE,
  kleur_code TEXT NOT NULL,
  verkoopprijs_m2 NUMERIC(10,2) NOT NULL,
  kostprijs_m2 NUMERIC(10,2),
  gewicht_per_m2_kg NUMERIC(8,3),   -- voor gewichtberekening op-maat regels
  max_breedte_cm INTEGER,            -- max rolbreedte (validatie in frontend)
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (kwaliteit_code, kleur_code)
);

-- Seed met bestaande vvp_m2 uit rollen (als startwaarden)
INSERT INTO maatwerk_m2_prijzen (kwaliteit_code, kleur_code, verkoopprijs_m2, kostprijs_m2, gewicht_per_m2_kg, max_breedte_cm)
SELECT
  r.kwaliteit_code,
  r.kleur_code,
  ROUND(AVG(r.vvp_m2)::NUMERIC, 2),
  ROUND(AVG(p.inkoopprijs / NULLIF(r.oppervlak_m2, 0))::NUMERIC, 2),
  ROUND(AVG(p.gewicht_kg / NULLIF(r.oppervlak_m2, 0))::NUMERIC, 3),
  MAX(r.breedte_cm)
FROM rollen r
JOIN producten p ON p.artikelnr = r.artikelnr
WHERE r.kwaliteit_code IS NOT NULL
  AND r.kleur_code IS NOT NULL
  AND r.vvp_m2 > 0
  AND r.status IN ('beschikbaar', 'gereserveerd')
GROUP BY r.kwaliteit_code, r.kleur_code;

-- ============================================================
-- 5. Extra kolommen op order_regels
-- ============================================================
ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS maatwerk_m2_prijs NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS maatwerk_kostprijs_m2 NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS maatwerk_oppervlak_m2 NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS maatwerk_vorm_toeslag NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maatwerk_afwerking_prijs NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maatwerk_diameter_cm INTEGER,
  ADD COLUMN IF NOT EXISTS maatwerk_kwaliteit_code TEXT,
  ADD COLUMN IF NOT EXISTS maatwerk_kleur_code TEXT;

-- ============================================================
-- 6. DROP oude CHECK constraint, voeg FK constraints toe
-- ============================================================
ALTER TABLE order_regels DROP CONSTRAINT IF EXISTS order_regels_maatwerk_afwerking_check;

-- FK naar afwerking_types (ON DELETE RESTRICT: kan niet verwijderen als orders bestaan)
ALTER TABLE order_regels
  ADD CONSTRAINT fk_order_regels_afwerking
  FOREIGN KEY (maatwerk_afwerking) REFERENCES afwerking_types(code)
  ON DELETE RESTRICT;

-- FK naar maatwerk_vormen (ON DELETE RESTRICT)
ALTER TABLE order_regels
  ADD CONSTRAINT fk_order_regels_vorm
  FOREIGN KEY (maatwerk_vorm) REFERENCES maatwerk_vormen(code)
  ON DELETE RESTRICT;

-- ============================================================
-- 7. DB-functie: kleuren voor kwaliteit (vervangt 2 client-side queries)
-- ============================================================
CREATE OR REPLACE FUNCTION kleuren_voor_kwaliteit(p_kwaliteit TEXT)
RETURNS TABLE(
  kleur_code TEXT,
  omschrijving TEXT,
  verkoopprijs_m2 NUMERIC,
  kostprijs_m2 NUMERIC,
  gewicht_per_m2_kg NUMERIC,
  max_breedte_cm INTEGER
) AS $$
  SELECT
    mp.kleur_code,
    MIN(p.omschrijving),
    mp.verkoopprijs_m2,
    mp.kostprijs_m2,
    mp.gewicht_per_m2_kg,
    mp.max_breedte_cm
  FROM maatwerk_m2_prijzen mp
  JOIN producten p ON p.kwaliteit_code = mp.kwaliteit_code
    AND p.kleur_code = mp.kleur_code AND p.actief = true
  WHERE mp.kwaliteit_code = p_kwaliteit
  GROUP BY mp.kleur_code, mp.verkoopprijs_m2, mp.kostprijs_m2,
           mp.gewicht_per_m2_kg, mp.max_breedte_cm
  ORDER BY mp.kleur_code;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- 8. RLS policies (V1: volledige toegang, consistent met bestaand beleid)
-- ============================================================
ALTER TABLE maatwerk_vormen ENABLE ROW LEVEL SECURITY;
ALTER TABLE afwerking_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE kwaliteit_standaard_afwerking ENABLE ROW LEVEL SECURITY;
ALTER TABLE maatwerk_m2_prijzen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon full access" ON maatwerk_vormen FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access" ON afwerking_types FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access" ON kwaliteit_standaard_afwerking FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access" ON maatwerk_m2_prijzen FOR ALL TO anon USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Pas de migratie toe op Supabase**

Via Supabase MCP tool of CLI.

- [ ] **Step 3: Update changelog.md**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/041_op_maat_configuratie.sql docs/changelog.md
git commit -m "feat: database tabellen voor op-maat configuratie (vormen, afwerkingen, m²-prijzen, constraints)"
```

---

## Task 2: Update RPC functies

**Files:**
- Create: `supabase/migrations/042_update_order_rpc_opmaat.sql`

> **Kritiek:** Zonder deze update worden maatwerk-velden niet opgeslagen bij order create/edit. De bestaande RPC functies INSERT alleen: artikelnr, karpi_code, omschrijving, orderaantal, te_leveren, prijs, korting_pct, bedrag, gewicht_kg, fysiek_artikelnr, omstickeren. Alle maatwerk-velden ontbreken.

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migration 042: Update order RPC functies met maatwerk + prijsvelden
-- De signatuur (JSONB parameters) verandert niet — alleen de INSERT kolommen.

CREATE OR REPLACE FUNCTION create_order_with_lines(p_order JSONB, p_regels JSONB)
RETURNS JSONB AS $$
DECLARE
    v_order_nr TEXT;
    v_order_id BIGINT;
BEGIN
    v_order_nr := volgend_nummer('ORD');

    INSERT INTO orders (
        order_nr, debiteur_nr, orderdatum, afleverdatum, klant_referentie,
        week, vertegenw_code, betaler, inkooporganisatie,
        fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
        afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
        status
    ) VALUES (
        v_order_nr,
        (p_order->>'debiteur_nr')::INTEGER,
        COALESCE((p_order->>'orderdatum')::DATE, CURRENT_DATE),
        (p_order->>'afleverdatum')::DATE,
        p_order->>'klant_referentie',
        p_order->>'week',
        p_order->>'vertegenw_code',
        (p_order->>'betaler')::INTEGER,
        p_order->>'inkooporganisatie',
        p_order->>'fact_naam', p_order->>'fact_adres',
        p_order->>'fact_postcode', p_order->>'fact_plaats', p_order->>'fact_land',
        p_order->>'afl_naam', p_order->>'afl_naam_2',
        p_order->>'afl_adres', p_order->>'afl_postcode',
        p_order->>'afl_plaats', p_order->>'afl_land',
        'Nieuw'
    ) RETURNING id INTO v_order_id;

    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        -- Maatwerk velden
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies,
        -- Op-maat prijsvelden (nieuw)
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code
    )
    SELECT
        v_order_id,
        (r->>'regelnummer')::INTEGER,
        r->>'artikelnr',
        r->>'karpi_code',
        r->>'omschrijving',
        r->>'omschrijving_2',
        (r->>'orderaantal')::INTEGER,
        (r->>'te_leveren')::INTEGER,
        (r->>'prijs')::NUMERIC,
        COALESCE((r->>'korting_pct')::NUMERIC, 0),
        (r->>'bedrag')::NUMERIC,
        (r->>'gewicht_kg')::NUMERIC,
        r->>'fysiek_artikelnr',
        COALESCE((r->>'omstickeren')::BOOLEAN, false),
        -- Maatwerk
        COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        r->>'maatwerk_vorm',
        (r->>'maatwerk_lengte_cm')::INTEGER,
        (r->>'maatwerk_breedte_cm')::INTEGER,
        r->>'maatwerk_afwerking',
        r->>'maatwerk_band_kleur',
        r->>'maatwerk_instructies',
        -- Op-maat prijs
        (r->>'maatwerk_m2_prijs')::NUMERIC,
        (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        (r->>'maatwerk_diameter_cm')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code'
    FROM jsonb_array_elements(p_regels) AS r;

    RETURN jsonb_build_object('id', v_order_id, 'order_nr', v_order_nr);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION update_order_with_lines(p_order_id BIGINT, p_header JSONB, p_regels JSONB)
RETURNS VOID AS $$
BEGIN
    UPDATE orders SET
        klant_referentie = p_header->>'klant_referentie',
        afleverdatum = (p_header->>'afleverdatum')::DATE,
        week = p_header->>'week',
        vertegenw_code = p_header->>'vertegenw_code',
        betaler = (p_header->>'betaler')::INTEGER,
        inkooporganisatie = p_header->>'inkooporganisatie',
        fact_naam = p_header->>'fact_naam', fact_adres = p_header->>'fact_adres',
        fact_postcode = p_header->>'fact_postcode', fact_plaats = p_header->>'fact_plaats',
        fact_land = p_header->>'fact_land',
        afl_naam = p_header->>'afl_naam', afl_naam_2 = p_header->>'afl_naam_2',
        afl_adres = p_header->>'afl_adres', afl_postcode = p_header->>'afl_postcode',
        afl_plaats = p_header->>'afl_plaats', afl_land = p_header->>'afl_land'
    WHERE id = p_order_id;

    DELETE FROM order_regels WHERE order_id = p_order_id;

    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code
    )
    SELECT
        p_order_id,
        (r->>'regelnummer')::INTEGER,
        r->>'artikelnr',
        r->>'karpi_code',
        r->>'omschrijving',
        r->>'omschrijving_2',
        (r->>'orderaantal')::INTEGER,
        (r->>'te_leveren')::INTEGER,
        (r->>'prijs')::NUMERIC,
        COALESCE((r->>'korting_pct')::NUMERIC, 0),
        (r->>'bedrag')::NUMERIC,
        (r->>'gewicht_kg')::NUMERIC,
        r->>'fysiek_artikelnr',
        COALESCE((r->>'omstickeren')::BOOLEAN, false),
        COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        r->>'maatwerk_vorm',
        (r->>'maatwerk_lengte_cm')::INTEGER,
        (r->>'maatwerk_breedte_cm')::INTEGER,
        r->>'maatwerk_afwerking',
        r->>'maatwerk_band_kleur',
        r->>'maatwerk_instructies',
        (r->>'maatwerk_m2_prijs')::NUMERIC,
        (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        (r->>'maatwerk_diameter_cm')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code'
    FROM jsonb_array_elements(p_regels) AS r;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Pas de migratie toe**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/042_update_order_rpc_opmaat.sql
git commit -m "feat: update order RPC functies met alle maatwerk + prijsvelden"
```

---

## Task 3: Query-laag + prijsberekening + types

**Files:**
- Create: `frontend/src/lib/supabase/queries/op-maat.ts`
- Create: `frontend/src/lib/utils/maatwerk-prijs.ts`
- Create: `frontend/src/lib/utils/vorm-labels.ts`
- Modify: `frontend/src/lib/supabase/queries/order-mutations.ts`
- Modify: `frontend/src/lib/types/productie.ts`

- [ ] **Step 1: Schrijf op-maat queries**

Bestand `frontend/src/lib/supabase/queries/op-maat.ts`:

```typescript
import { supabase } from '../client'

// === Vormen ===

export interface MaatwerkVormRow {
  id: number
  code: string
  naam: string
  afmeting_type: 'lengte_breedte' | 'diameter'
  toeslag: number
  actief: boolean
  volgorde: number
}

export async function fetchVormen(): Promise<MaatwerkVormRow[]> {
  const { data, error } = await supabase
    .from('maatwerk_vormen')
    .select('*')
    .eq('actief', true)
    .order('volgorde')
  if (error) throw error
  return data ?? []
}

export async function fetchAlleVormen(): Promise<MaatwerkVormRow[]> {
  const { data, error } = await supabase
    .from('maatwerk_vormen')
    .select('*')
    .order('volgorde')
  if (error) throw error
  return data ?? []
}

export async function upsertVorm(vorm: Omit<MaatwerkVormRow, 'id'> & { id?: number }) {
  const { error } = vorm.id
    ? await supabase.from('maatwerk_vormen').update(vorm).eq('id', vorm.id)
    : await supabase.from('maatwerk_vormen').insert(vorm)
  if (error) throw error
}

// === Afwerkingen ===

export interface AfwerkingTypeRow {
  id: number
  code: string
  naam: string
  prijs: number
  heeft_band_kleur: boolean
  actief: boolean
  volgorde: number
}

export async function fetchAfwerkingTypes(): Promise<AfwerkingTypeRow[]> {
  const { data, error } = await supabase
    .from('afwerking_types')
    .select('*')
    .eq('actief', true)
    .order('volgorde')
  if (error) throw error
  return data ?? []
}

export async function fetchAlleAfwerkingTypes(): Promise<AfwerkingTypeRow[]> {
  const { data, error } = await supabase
    .from('afwerking_types')
    .select('*')
    .order('volgorde')
  if (error) throw error
  return data ?? []
}

export async function upsertAfwerkingType(at: Omit<AfwerkingTypeRow, 'id'> & { id?: number }) {
  const { error } = at.id
    ? await supabase.from('afwerking_types').update(at).eq('id', at.id)
    : await supabase.from('afwerking_types').insert(at)
  if (error) throw error
}

// === Standaard afwerking per kwaliteit ===

export async function fetchStandaardAfwerking(kwaliteitCode: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('kwaliteit_standaard_afwerking')
    .select('afwerking_code')
    .eq('kwaliteit_code', kwaliteitCode)
    .maybeSingle()
  if (error) throw error
  return data?.afwerking_code ?? null
}

export async function setStandaardAfwerking(kwaliteitCode: string, afwerkingCode: string) {
  const { error } = await supabase
    .from('kwaliteit_standaard_afwerking')
    .upsert({ kwaliteit_code: kwaliteitCode, afwerking_code: afwerkingCode })
  if (error) throw error
}

// === Kwaliteiten (voor zoekbare combobox) ===

export interface KwaliteitOptie {
  code: string
  omschrijving: string
}

export async function fetchKwaliteiten(): Promise<KwaliteitOptie[]> {
  const { data, error } = await supabase
    .from('kwaliteiten')
    .select('code, omschrijving')
    .order('code')
  if (error) throw error
  return data ?? []
}

// === Kleuren via DB-functie (één query, geen client-side join) ===

export interface KleurOptie {
  kleur_code: string
  omschrijving: string
  verkoopprijs_m2: number | null
  kostprijs_m2: number | null
  gewicht_per_m2_kg: number | null
  max_breedte_cm: number | null
}

export async function fetchKleurenVoorKwaliteit(kwaliteitCode: string): Promise<KleurOptie[]> {
  const { data, error } = await supabase.rpc('kleuren_voor_kwaliteit', {
    p_kwaliteit: kwaliteitCode,
  })
  if (error) throw error
  return (data ?? []) as KleurOptie[]
}
```

- [ ] **Step 2: Schrijf prijsberekeningsfuncties**

Bestand `frontend/src/lib/utils/maatwerk-prijs.ts`:

```typescript
/**
 * Bereken het PRIJS-oppervlak in m² (= materiaalverbruik).
 * Rond = diameter² (omsluitend vierkant, industrie-standaard).
 */
export function berekenPrijsOppervlakM2(
  vorm: string,
  lengteCm?: number,
  breedteCm?: number,
  diameterCm?: number
): number {
  if (vorm === 'rond' && diameterCm) {
    return (diameterCm * diameterCm) / 10000
  }
  if (lengteCm && breedteCm) {
    return (lengteCm * breedteCm) / 10000
  }
  return 0
}

/** Bereken totaalprijs voor een op-maat orderregel */
export function berekenMaatwerkPrijs(params: {
  oppervlakM2: number
  m2Prijs: number
  vormToeslag: number
  afwerkingPrijs: number
  korting_pct: number
}): number {
  const { oppervlakM2, m2Prijs, vormToeslag, afwerkingPrijs, korting_pct } = params
  const basis = oppervlakM2 * m2Prijs
  const subtotaal = basis + vormToeslag + afwerkingPrijs
  const netto = subtotaal * (1 - korting_pct / 100)
  return Math.round(netto * 100) / 100
}

/** Bereken gewicht op basis van oppervlak en gewicht/m² */
export function berekenMaatwerkGewicht(oppervlakM2: number, gewichtPerM2Kg: number | null): number | undefined {
  if (!gewichtPerM2Kg || oppervlakM2 <= 0) return undefined
  return Math.round(oppervlakM2 * gewichtPerM2Kg * 100) / 100
}
```

- [ ] **Step 3: Schrijf vorm-labels mapping**

Bestand `frontend/src/lib/utils/vorm-labels.ts`:

```typescript
/**
 * Centrale mapping van vorm-code → display label + kleur.
 * Wordt gebruikt door snijplanning, stickers, order-regels, etc.
 * Valt terug op de code zelf als de vorm onbekend is.
 */

interface VormDisplay {
  label: string
  kort: string        // korte weergave voor tabellen
  bg: string           // badge achtergrond
  text: string         // badge tekstkleur
  isRond: boolean      // true = cirkel-visualisatie in snijplanning
}

const BEKENDE_VORMEN: Record<string, VormDisplay> = {
  rechthoek:      { label: 'Rechthoek',              kort: 'RECHT',  bg: 'bg-slate-100',  text: 'text-slate-600',  isRond: false },
  rond:           { label: 'Rond',                   kort: 'ROND',   bg: 'bg-purple-100', text: 'text-purple-700', isRond: true },
  ovaal:          { label: 'Ovaal',                  kort: 'OVAAL',  bg: 'bg-pink-100',   text: 'text-pink-700',   isRond: false },
  organisch_a:    { label: 'Organisch A',            kort: 'ORG-A',  bg: 'bg-amber-100',  text: 'text-amber-700',  isRond: false },
  organisch_b_sp: { label: 'Organisch B gespiegeld', kort: 'ORG-B',  bg: 'bg-amber-100',  text: 'text-amber-700',  isRond: false },
}

const FALLBACK: VormDisplay = {
  label: 'Onbekend', kort: '???', bg: 'bg-gray-100', text: 'text-gray-500', isRond: false,
}

export function getVormDisplay(vormCode: string | null | undefined): VormDisplay {
  if (!vormCode) return BEKENDE_VORMEN.rechthoek
  return BEKENDE_VORMEN[vormCode] ?? { ...FALLBACK, label: vormCode, kort: vormCode.toUpperCase().slice(0, 6) }
}

/** Check of een vorm als cirkel gevisualiseerd moet worden */
export function isRondeVorm(vormCode: string | null | undefined): boolean {
  return getVormDisplay(vormCode).isRond
}
```

- [ ] **Step 4: Breid OrderRegelFormData uit**

In `frontend/src/lib/supabase/queries/order-mutations.ts`, voeg toe aan de interface + beide p_regels mappings:

```typescript
// In OrderRegelFormData interface:
  maatwerk_m2_prijs?: number
  maatwerk_kostprijs_m2?: number
  maatwerk_oppervlak_m2?: number
  maatwerk_vorm_toeslag?: number
  maatwerk_afwerking_prijs?: number
  maatwerk_diameter_cm?: number
  maatwerk_kwaliteit_code?: string
  maatwerk_kleur_code?: string

// In BEIDE p_regels mappings (createOrder + updateOrderWithLines):
    is_maatwerk: r.is_maatwerk ?? false,
    maatwerk_vorm: r.maatwerk_vorm || null,
    maatwerk_lengte_cm: r.maatwerk_lengte_cm ?? null,
    maatwerk_breedte_cm: r.maatwerk_breedte_cm ?? null,
    maatwerk_afwerking: r.maatwerk_afwerking || null,
    maatwerk_band_kleur: r.maatwerk_band_kleur || null,
    maatwerk_instructies: r.maatwerk_instructies || null,
    maatwerk_m2_prijs: r.maatwerk_m2_prijs ?? null,
    maatwerk_kostprijs_m2: r.maatwerk_kostprijs_m2 ?? null,
    maatwerk_oppervlak_m2: r.maatwerk_oppervlak_m2 ?? null,
    maatwerk_vorm_toeslag: r.maatwerk_vorm_toeslag ?? null,
    maatwerk_afwerking_prijs: r.maatwerk_afwerking_prijs ?? null,
    maatwerk_diameter_cm: r.maatwerk_diameter_cm ?? null,
    maatwerk_kwaliteit_code: r.maatwerk_kwaliteit_code || null,
    maatwerk_kleur_code: r.maatwerk_kleur_code || null,
```

- [ ] **Step 5: Update MaatwerkVorm type**

In `frontend/src/lib/types/productie.ts`, verander:

```typescript
// Was: export type MaatwerkVorm = 'rechthoek' | 'rond' | 'ovaal'
export type MaatwerkVorm = string  // Nu configureerbaar via maatwerk_vormen tabel
```

> Alle consumenten (SnijplanRow, SnijStuk, ConfectieRow) accepteren `string` als breder type.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/supabase/queries/op-maat.ts frontend/src/lib/utils/maatwerk-prijs.ts frontend/src/lib/utils/vorm-labels.ts frontend/src/lib/supabase/queries/order-mutations.ts frontend/src/lib/types/productie.ts
git commit -m "feat: query-laag, prijsberekening en vorm-labels voor op-maat module"
```

---

## Task 4: Hardcoded vorm-checks vervangen in snijplanning

**Files:** 8 bestanden met totaal 22 hardcoded referenties.

> Dit moet VOOR de frontend-componenten gedaan worden, anders breken nieuwe vormen de visualisatie.

- [ ] **Step 1: Update snij-visualisatie.tsx**

Vervang alle `stuk.vorm === 'rond'` checks door `isRondeVorm(stuk.vorm)`:

```typescript
import { isRondeVorm, getVormDisplay } from '@/lib/utils/vorm-labels'

// Line 83: s.vorm === 'rond' → isRondeVorm(s.vorm)
// Line 169: stuk.vorm === 'rond' → isRondeVorm(stuk.vorm)
// Line 195: stuk.vorm !== 'rond' → !isRondeVorm(stuk.vorm)
// Line 339: stuk.vorm !== 'rechthoek' → stuk.vorm !== 'rechthoek' (tooltip, OK om te houden)
```

- [ ] **Step 2: Update groep-accordion.tsx**

```typescript
import { getVormDisplay } from '@/lib/utils/vorm-labels'

// Line 319-320: Vervang ternary door:
// const vormDisplay = getVormDisplay(stuk.maatwerk_vorm)
// className={`${vormDisplay.bg} ${vormDisplay.text}`}
```

- [ ] **Step 3: Update sticker-layout.tsx**

```typescript
import { getVormDisplay } from '@/lib/utils/vorm-labels'

// Line 18-20: Vervang hardcoded Record door:
// const vormLabel = getVormDisplay(snijplan.maatwerk_vorm).label
```

- [ ] **Step 4: Update snijstukken-tabel.tsx**

```typescript
import { getVormDisplay } from '@/lib/utils/vorm-labels'

// Line 66: Vervang door: getVormDisplay(stuk.vorm).kort
```

- [ ] **Step 5: Update week-groep-accordion.tsx**

```typescript
import { getVormDisplay } from '@/lib/utils/vorm-labels'

// Line 114: Vervang ternary door getVormDisplay(stuk.vorm).bg/text
```

- [ ] **Step 6: Update order-regels-table.tsx**

```typescript
import { getVormDisplay } from '@/lib/utils/vorm-labels'

// Line 90: Vervang 'rechthoek' check door getVormDisplay(regel.maatwerk_vorm).label
```

- [ ] **Step 7: Update defaults in rol-snijvoorstel.tsx en snijvoorstel-review.tsx**

```typescript
// rol-snijvoorstel.tsx line 23: ?? 'rechthoek' → OK (fallback is prima)
// snijvoorstel-review.tsx line 33: ?? 'rechthoek' → OK
// snijvoorstel-review.tsx line 112: 'rechthoek' as const → 'rechthoek'
```

- [ ] **Step 8: Update order-line-editor.tsx hardcoded opties**

Vervang de hardcoded `<option>` values in MaatwerkLineRow (regels 160-164) door een query naar actieve vormen, of laat dit over aan Task 7 (integratie).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/snijplanning/ frontend/src/components/orders/order-regels-table.tsx frontend/src/pages/snijplanning/
git commit -m "refactor: vervang hardcoded vorm-checks door centraal vorm-labels systeem"
```

---

## Task 5: Product-type toggle + KwaliteitKleurSelector

**Files:**
- Create: `frontend/src/components/orders/product-type-toggle.tsx`
- Create: `frontend/src/components/orders/kwaliteit-kleur-selector.tsx`

- [ ] **Step 1: Schrijf ProductTypeToggle**

```typescript
interface ProductTypeToggleProps {
  value: 'standaard' | 'op_maat'
  onChange: (type: 'standaard' | 'op_maat') => void
}

export function ProductTypeToggle({ value, onChange }: ProductTypeToggleProps) {
  // Twee knoppen: terracotta actief voor standaard, purple voor op-maat
  // Zelfde pattern als planning_modus in productie-instellingen.tsx
}
```

- [ ] **Step 2: Schrijf KwaliteitKleurSelector (zoekbare combobox)**

Een zoekbare kwaliteit-combobox (pattern uit `ClientSelector`/`ArticleSelector`): tekstveld → debounced filter → dropdown met resultaten. Na kwaliteit-selectie: kleur-dropdown met m²-prijs en max-breedte.

```typescript
import { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchKwaliteiten, fetchKleurenVoorKwaliteit, type KleurOptie } from '@/lib/supabase/queries/op-maat'
import { formatCurrency } from '@/lib/utils/formatters'

interface KwaliteitKleurSelectorProps {
  onSelect: (data: {
    kwaliteitCode: string
    kwaliteitNaam: string
    kleurCode: string
    kleurOmschrijving: string
    verkoopprijsM2: number
    kostprijsM2: number | null
    gewichtPerM2Kg: number | null
    maxBreedteCm: number | null
  }) => void
}

export function KwaliteitKleurSelector({ onSelect }: KwaliteitKleurSelectorProps) {
  const [search, setSearch] = useState('')
  const [selectedKwaliteit, setSelectedKwaliteit] = useState<{ code: string; omschrijving: string } | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data: kwaliteiten = [] } = useQuery({
    queryKey: ['kwaliteiten'],
    queryFn: fetchKwaliteiten,
  })

  const { data: kleuren = [] } = useQuery({
    queryKey: ['kleuren', selectedKwaliteit?.code],
    queryFn: () => fetchKleurenVoorKwaliteit(selectedKwaliteit!.code),
    enabled: !!selectedKwaliteit,
  })

  // Filter kwaliteiten op zoekterm (code of omschrijving)
  const filtered = search.length >= 1
    ? kwaliteiten.filter(k =>
        k.code.toLowerCase().includes(search.toLowerCase()) ||
        k.omschrijving.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 30)
    : []

  // Click-outside handler (zelfde pattern als ArticleSelector)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Render: zoekbaar tekstveld + dropdown + kleur-selectie
  // Na kwaliteit selectie: toon kleur-dropdown met prijs/m² en max_breedte
  // Na kleur selectie: roep onSelect() aan
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/orders/product-type-toggle.tsx frontend/src/components/orders/kwaliteit-kleur-selector.tsx
git commit -m "feat: product-type toggle en zoekbare kwaliteit/kleur selector"
```

---

## Task 6: OpMaatSelector + VormAfmetingSelector

**Files:**
- Create: `frontend/src/components/orders/vorm-afmeting-selector.tsx`
- Create: `frontend/src/components/orders/op-maat-selector.tsx`

- [ ] **Step 1: Schrijf VormAfmetingSelector**

Component voor vorm-keuze + dynamische afmeting-invoer + afwerking. Ontvangt `maxBreedteCm` voor validatie.

```typescript
interface VormAfmetingSelectorProps {
  vormen: MaatwerkVormRow[]
  afwerkingen: AfwerkingTypeRow[]
  standaardAfwerking: string | null
  maxBreedteCm: number | null
  onChange: (data: VormAfmetingData) => void
}

interface VormAfmetingData {
  vormCode: string
  lengteCm?: number
  breedteCm?: number
  diameterCm?: number
  afwerkingCode: string
  bandKleur: string
  instructies: string
}

// - Vorm dropdown (uit DB, met toeslag)
// - Dynamische afmeting: lengte+breedte of diameter
// - Max-breedte waarschuwing: als breedte > maxBreedteCm → rode waarschuwing
// - Afwerking dropdown (uit DB, met prijs), standaard vooringevuld
// - Bandkleur input (conditioneel op heeft_band_kleur)
// - Instructies tekstveld
// - Responsive: grid-cols-1 sm:grid-cols-3
```

- [ ] **Step 2: Schrijf OpMaatSelector (orchestratie met useReducer)**

```typescript
import { useReducer } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KwaliteitKleurSelector } from './kwaliteit-kleur-selector'
import { VormAfmetingSelector } from './vorm-afmeting-selector'
import { fetchVormen, fetchAfwerkingTypes, fetchStandaardAfwerking } from '@/lib/supabase/queries/op-maat'
import { berekenPrijsOppervlakM2, berekenMaatwerkPrijs, berekenMaatwerkGewicht } from '@/lib/utils/maatwerk-prijs'
import { formatCurrency } from '@/lib/utils/formatters'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

// --- Reducer ---
type State = {
  kwaliteitCode: string
  kwaliteitNaam: string
  kleurCode: string
  kleurOmschrijving: string
  verkoopprijsM2: number
  kostprijsM2: number | null
  gewichtPerM2Kg: number | null
  maxBreedteCm: number | null
  vormCode: string
  lengteCm?: number
  breedteCm?: number
  diameterCm?: number
  afwerkingCode: string
  bandKleur: string
  instructies: string
}

type Action =
  | { type: 'KWALITEIT_KLEUR_SELECTED'; payload: { /* all fields from KwaliteitKleurSelector */ } }
  | { type: 'VORM_AFMETING_CHANGED'; payload: VormAfmetingData }
  | { type: 'RESET' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'KWALITEIT_KLEUR_SELECTED':
      return { ...initialState, ...action.payload, vormCode: 'rechthoek' }
    case 'VORM_AFMETING_CHANGED':
      return { ...state, ...action.payload }
    case 'RESET':
      return initialState
  }
}

// Component: toont KwaliteitKleurSelector → VormAfmetingSelector → prijsoverzicht → Toevoegen knop
// Na "Toevoegen": bouwt OrderRegelFormData met alle velden incl. gewicht, stuurt naar parent, dispatcht RESET
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/orders/vorm-afmeting-selector.tsx frontend/src/components/orders/op-maat-selector.tsx
git commit -m "feat: OpMaatSelector met useReducer, vorm/afmeting/afwerking selectie"
```

---

## Task 7: Integratie in OrderLineEditor

**Files:**
- Modify: `frontend/src/components/orders/order-line-editor.tsx`

- [ ] **Step 1: Voeg imports en toggle-state toe**

```typescript
import { useState } from 'react'
import { ProductTypeToggle } from './product-type-toggle'
import { OpMaatSelector } from './op-maat-selector'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
```

- [ ] **Step 2: Redirect rol-producten naar OpMaatSelector**

In `addArticle()` (regel 246-305), wanneer `isMaatwerk` true is: in plaats van direct een regel toe te voegen, switch naar de op-maat modus:

```typescript
if (isMaatwerk) {
  // Redirect naar op-maat flow — gebruiker moet kwaliteit/kleur/vorm/afmeting invullen
  setProductType('op_maat')
  return  // Voeg niet direct toe
}
```

- [ ] **Step 3: Vervang article-invoer sectie door toggle + conditie**

```tsx
<div className="px-5 py-3 border-b border-slate-100 space-y-3">
  <ProductTypeToggle value={productType} onChange={setProductType} />
  {productType === 'standaard' ? (
    <ArticleSelector onSelect={addArticle} />
  ) : (
    <OpMaatSelector
      defaultKorting={defaultKorting}
      onAdd={(line) => {
        onChange([...lines, line])
        setProductType('standaard')  // Reset na toevoegen
      }}
    />
  )}
</div>
```

- [ ] **Step 4: Update MaatwerkLineRow**

- Vervang hardcoded vorm-opties door query-data of VORM_LABELS
- Voeg m²-prijsweergave toe wanneer `maatwerk_m2_prijs` beschikbaar is
- Toon diameter ipv lengte+breedte wanneer `maatwerk_diameter_cm` ingevuld

```tsx
{line.maatwerk_m2_prijs && (
  <span className="text-purple-600 text-xs">
    {line.maatwerk_oppervlak_m2?.toFixed(2)} m² x {formatCurrency(line.maatwerk_m2_prijs)}/m²
    {(line.maatwerk_vorm_toeslag ?? 0) > 0 && ` + ${formatCurrency(line.maatwerk_vorm_toeslag)} vorm`}
    {(line.maatwerk_afwerking_prijs ?? 0) > 0 && ` + ${formatCurrency(line.maatwerk_afwerking_prijs)} afwerking`}
  </span>
)}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/orders/order-line-editor.tsx
git commit -m "feat: integratie toggle + OpMaatSelector + rol-redirect in order-line-editor"
```

---

## Task 8: Documentatie Fase 1

**Files:**
- Modify: `docs/database-schema.md`
- Modify: `docs/changelog.md`
- Modify: `docs/architectuur.md`

- [ ] **Step 1: Update database-schema.md**

Voeg de 4 nieuwe tabellen toe (`maatwerk_vormen`, `afwerking_types`, `kwaliteit_standaard_afwerking`, `maatwerk_m2_prijzen`), de DB-functie `kleuren_voor_kwaliteit()`, en de nieuwe kolommen op `order_regels`.

- [ ] **Step 2: Update architectuur.md**

Documenteer:
- Op-maat invoerpatroon: toggle → KwaliteitKleurSelector → VormAfmetingSelector → prijsberekening
- `vorm-labels.ts` als centraal systeem voor vorm-weergave
- m²-prijs bron: `maatwerk_m2_prijzen` tabel (admin-instelbaar)

- [ ] **Step 3: Update changelog.md**

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: documentatie bijgewerkt voor op-maat module fase 1"
```

---

## FASE 2: Admin UI (kan later, seed data werkt als tussenoplossing)

---

## Task 9: Instellingen — Vormen beheer

**Files:**
- Create: `frontend/src/pages/instellingen/vormen-beheer.tsx`
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Schrijf vormen beheer pagina**

CRUD-pagina (pattern uit `productie-instellingen.tsx`). Tabel met:
- Kolommen: Volgorde | Code | Naam | Afmeting type | Toeslag | Actief | Opslaan
- "Nieuwe vorm" knop → lege rij
- Inline editing + per-rij opslaan via `upsertVorm()`
- Per-rij error state met feedback
- **Soft delete:** actief=false toggle, niet echte DELETE (ON DELETE RESTRICT voorkomt dit ook)

- [ ] **Step 2: Voeg route toe**

```typescript
{ path: 'instellingen/vormen', element: <VormenBeheerPage /> },
```

- [ ] **Step 3: Commit**

---

## Task 10: Instellingen — Afwerkingen beheer

**Files:**
- Create: `frontend/src/pages/instellingen/afwerkingen-beheer.tsx`
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Schrijf afwerkingen beheer pagina**

Twee secties:
1. **Afwerking types tabel:** Code | Naam | Prijs | Bandkleur vereist | Actief
2. **Standaard per kwaliteit:** Zoekbare kwaliteiten-lijst met afwerking-dropdown per rij

- [ ] **Step 2: Voeg route toe**

- [ ] **Step 3: Commit**

---

## Task 11: Navigatie + m²-prijzen beheer

**Files:**
- Modify: `frontend/src/lib/utils/constants.ts` (NAV_GROUPS)
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Update navigatie sidebar**

Voeg sub-items toe onder Systeem:

```typescript
{
  label: 'Systeem',
  items: [
    { label: 'Instellingen', path: '/instellingen', icon: 'Settings' },
    { label: 'Vormen', path: '/instellingen/vormen', icon: 'Shapes' },
    { label: 'Afwerkingen', path: '/instellingen/afwerkingen', icon: 'Paintbrush' },
    { label: 'Productie', path: '/instellingen/productie', icon: 'Factory' },
  ],
},
```

- [ ] **Step 2: m²-prijzen beheer**

Overweeg een pagina of sectie in afwerkingen-beheer voor het bewerken van `maatwerk_m2_prijzen` (verkoopprijs/m² per kwaliteit+kleur). Alternatiief: een knop "Prijzen bijwerken" op de instellingen-pagina die de seed-query opnieuw uitvoert.

- [ ] **Step 3: Commit**

---

## Samenvatting

### Fase 1 (werkend op-maat bestellen)

| Task | Omschrijving | Bestanden |
|------|-------------|-----------|
| 1 | DB migratie: 4 tabellen, kolommen, FK, CHECK drop, RLS, DB-functie | `041_op_maat_configuratie.sql` |
| 2 | RPC update: alle maatwerk+prijsvelden in create/update order | `042_update_order_rpc_opmaat.sql` |
| 3 | Query-laag, prijsberekening, vorm-labels, types | `op-maat.ts`, `maatwerk-prijs.ts`, `vorm-labels.ts`, `order-mutations.ts`, `productie.ts` |
| 4 | Hardcoded vorm-checks vervangen in 8 bestanden | snijplanning + orders componenten |
| 5 | ProductTypeToggle + zoekbare KwaliteitKleurSelector | `product-type-toggle.tsx`, `kwaliteit-kleur-selector.tsx` |
| 6 | OpMaatSelector (useReducer) + VormAfmetingSelector | `op-maat-selector.tsx`, `vorm-afmeting-selector.tsx` |
| 7 | Integratie in OrderLineEditor + rol-redirect | `order-line-editor.tsx` |
| 8 | Documentatie fase 1 | `database-schema.md`, `architectuur.md`, `changelog.md` |

### Fase 2 (admin UI)

| Task | Omschrijving | Bestanden |
|------|-------------|-----------|
| 9 | Vormen beheer pagina | `vormen-beheer.tsx` |
| 10 | Afwerkingen beheer pagina | `afwerkingen-beheer.tsx` |
| 11 | Navigatie + m²-prijzen beheer | `constants.ts`, `router.tsx` |
