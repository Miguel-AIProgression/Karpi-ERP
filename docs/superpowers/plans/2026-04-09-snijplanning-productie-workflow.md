# Snijplanning Productie Workflow — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab-filtering laten werken op de snijplanning overview, en een complete productie-workflow bouwen: gepland plan bekijken → per rol snijden → stickers printen met QR-code. QR-codes dienen als tracking door het hele proces (snijden → confectie → inpak).

**Architecture:** Client-side filtering op de `snijplanning_groepen` view (uitbreiden met per-status counts via een nieuwe migration). Productie-flow is een nieuwe pagina per rol waar de snijder het plan uitvoert en stickers print. Stickers worden herontworpen met Floorpassion logo, QR-code (via `qrcode` library), en alle vereiste velden. Status-transitie in V1 is `Gepland → Gesneden` (de tussenliggende status "In productie" wordt bewust niet gebruikt in V1 maar de tab blijft beschikbaar voor toekomstig gebruik).

**Tech Stack:** React, TypeScript, TanStack Query, Tailwind, shadcn/ui, `qrcode` (npm), Supabase RPC `voltooi_snijplan_rol`

**Aanname:** Een rol wordt altijd in zijn geheel gesneden (alle stukken tegelijk). Partial roll cutting is niet nodig in V1 — dit is fysiek logisch omdat je van één kant van de rol snijdt.

---

## Bestandsoverzicht

| Actie | Pad | Verantwoordelijkheid |
|-------|-----|----------------------|
| Create | `supabase/migrations/043_snijplanning_groepen_per_status.sql` | View uitbreiden met per-status counts |
| Modify | `frontend/src/lib/supabase/queries/snijplanning.ts` | `SnijGroepSummary` type + query updaten |
| Modify | `frontend/src/lib/types/productie.ts` | `rol_id` toevoegen aan `SnijplanRow` |
| Modify | `frontend/src/pages/snijplanning/snijplanning-overview.tsx` | Tab-filtering implementeren |
| Create | `frontend/src/lib/utils/snijplan-mapping.ts` | Gedeelde rotatie-inferentie utility |
| Modify | `frontend/src/components/snijplanning/groep-accordion.tsx` | Refactor naar gedeelde utility + header shortcuts |
| Create | `frontend/src/pages/snijplanning/productie-rol.tsx` | Productie-pagina per rol |
| Modify | `frontend/src/components/snijplanning/sticker-layout.tsx` | Herontwerp met QR-code + logo |
| Create | `frontend/src/pages/snijplanning/stickers-bulk.tsx` | Bulk sticker print pagina (meerdere stukken) |
| Modify | `frontend/src/router.tsx` | Nieuwe routes toevoegen |

---

## Task 0: Prerequisite — Verifieer `voltooi_snijplan_rol` RPC

De migrations 036-039 zijn verwijderd uit de repo, maar de RPC `voltooi_snijplan_rol` wordt aangeroepen in de productie-flow.

- [ ] **Step 1: Check of de RPC bestaat in de database**

```sql
SELECT proname FROM pg_proc WHERE proname = 'voltooi_snijplan_rol';
```

Run via `mcp__claude_ai_Supabase__execute_sql`.

Expected: 1 rij met `voltooi_snijplan_rol`. Als de functie niet bestaat, moet deze eerst aangemaakt worden (zie fallback hieronder).

- [ ] **Step 2: Als de RPC NIET bestaat, maak migration aan**

Alleen uitvoeren als Step 1 leeg terugkomt. Maak `supabase/migrations/043_voltooi_snijplan_rol.sql`:

```sql
CREATE OR REPLACE FUNCTION voltooi_snijplan_rol(p_rol_id BIGINT, p_gesneden_door TEXT DEFAULT NULL)
RETURNS TABLE(reststuk_id BIGINT, reststuk_rolnummer TEXT, reststuk_lengte_cm INTEGER) AS $$
DECLARE
  v_rol RECORD;
  v_gebruikte_lengte NUMERIC;
  v_rest_lengte INTEGER;
  v_reststuk_id BIGINT;
  v_reststuk_nr TEXT;
BEGIN
  -- Haal rol op
  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rol % niet gevonden', p_rol_id; END IF;

  -- Markeer alle geplande snijplannen op deze rol als gesneden
  UPDATE snijplannen
  SET status = 'Gesneden',
      gesneden_datum = CURRENT_DATE,
      gesneden_op = NOW(),
      gesneden_door = p_gesneden_door
  WHERE rol_id = p_rol_id
    AND status IN ('Gepland', 'In productie');

  -- Bereken gebruikte lengte
  SELECT COALESCE(MAX(positie_y_cm + CASE WHEN geroteerd THEN lengte_cm ELSE breedte_cm END), 0)
  INTO v_gebruikte_lengte
  FROM snijplannen WHERE rol_id = p_rol_id AND status = 'Gesneden';

  v_rest_lengte := GREATEST(0, v_rol.lengte_cm - CEIL(v_gebruikte_lengte));

  -- Update rol status
  UPDATE rollen SET status = 'gesneden' WHERE id = p_rol_id;

  -- Maak reststuk als er genoeg over is (>50cm)
  IF v_rest_lengte > 50 THEN
    v_reststuk_nr := v_rol.rolnummer || '-R';
    INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, kleur_code, lengte_cm, breedte_cm,
                        oppervlak_m2, status, oorsprong_rol_id, reststuk_datum)
    VALUES (v_reststuk_nr, v_rol.artikelnr, v_rol.kwaliteit_code, v_rol.kleur_code,
            v_rest_lengte, v_rol.breedte_cm,
            ROUND(v_rest_lengte * v_rol.breedte_cm / 10000.0, 2),
            'reststuk', p_rol_id, CURRENT_DATE)
    RETURNING id INTO v_reststuk_id;

    RETURN QUERY SELECT v_reststuk_id, v_reststuk_nr, v_rest_lengte;
  ELSE
    RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, NULL::INTEGER;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Pas de nummering aan als 043 al bezet is door de view migration (gebruik dan 044).

---

## Task 1: Database view uitbreiden met per-status counts

**Files:**
- Create: `supabase/migrations/043_snijplanning_groepen_per_status.sql` (of 044 als 043 al door Task 0 is bezet)

De huidige `snijplanning_groepen` view heeft `totaal_gepland` en `totaal_wacht` maar mist counts voor "In productie", "Gesneden", "In confectie", en "Gereed". We voegen die toe zodat client-side filtering per tab werkt.

- [ ] **Step 1: Schrijf de migration**

```sql
-- Migration 043: Voeg per-status counts toe aan snijplanning_groepen view
-- Nodig voor tab-filtering op de snijplanning overview pagina
-- Naamgeving: totaal_voorbij_snijfase = alle statussen na snijden (backward compat met bestaand gebruik)

DROP VIEW IF EXISTS snijplanning_groepen CASCADE;

CREATE VIEW snijplanning_groepen AS
SELECT
  kwaliteit_code,
  kleur_code,
  COUNT(*)::INTEGER AS totaal_stukken,
  COUNT(DISTINCT order_id)::INTEGER AS totaal_orders,
  ROUND(SUM(snij_lengte_cm::NUMERIC * snij_breedte_cm::NUMERIC / 10000), 1)::FLOAT AS totaal_m2,
  -- Backward compat: totaal_gesneden telt alles voorbij snijfase (was al zo)
  COUNT(*) FILTER (WHERE status IN ('Gesneden', 'In confectie', 'Ingepakt', 'Gereed'))::INTEGER AS totaal_gesneden,
  MIN(afleverdatum) FILTER (WHERE status NOT IN ('Gesneden', 'In confectie', 'Ingepakt', 'Gereed', 'Geannuleerd')) AS vroegste_afleverdatum,
  -- Per-status counts voor tab-filtering
  COUNT(*) FILTER (WHERE status = 'Wacht')::INTEGER AS totaal_wacht,
  COUNT(*) FILTER (WHERE status = 'Gepland')::INTEGER AS totaal_gepland,
  COUNT(*) FILTER (WHERE status = 'In productie')::INTEGER AS totaal_in_productie,
  COUNT(*) FILTER (WHERE status = 'Gesneden')::INTEGER AS totaal_status_gesneden,
  COUNT(*) FILTER (WHERE status = 'In confectie')::INTEGER AS totaal_in_confectie,
  COUNT(*) FILTER (WHERE status IN ('Gereed', 'Ingepakt'))::INTEGER AS totaal_gereed
FROM snijplanning_overzicht
WHERE kwaliteit_code IS NOT NULL
GROUP BY kwaliteit_code, kleur_code
ORDER BY kwaliteit_code, kleur_code;
```

**Naamgeving verduidelijking:**
- `totaal_gesneden` = alles voorbij snijfase (backward compat, gebruikt in accordion badge)
- `totaal_status_gesneden` = alleen status 'Gesneden' (voor tab-filtering)
- `totaal_in_confectie` = aparte count (zodat items niet onzichtbaar zijn in tabs)

- [ ] **Step 2: Apply migration via Supabase MCP**

Run: `mcp__claude_ai_Supabase__apply_migration` met bovenstaande SQL.

- [ ] **Step 3: Verifieer dat de view werkt**

Run: `mcp__claude_ai_Supabase__execute_sql` met:
```sql
SELECT * FROM snijplanning_groepen LIMIT 5;
```
Expected: kolommen `totaal_in_productie`, `totaal_status_gesneden`, `totaal_in_confectie`, `totaal_gereed` zijn zichtbaar.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/043_snijplanning_groepen_per_status.sql
git commit -m "feat: snijplanning_groepen view uitbreiden met per-status counts"
```

---

## Task 2: Frontend types en query updaten

**Files:**
- Modify: `frontend/src/lib/supabase/queries/snijplanning.ts:14-24`
- Modify: `frontend/src/lib/types/productie.ts:29-46`

- [ ] **Step 1: Update `SnijGroepSummary` type**

In `frontend/src/lib/supabase/queries/snijplanning.ts`, voeg de nieuwe velden toe aan het `SnijGroepSummary` interface:

```typescript
export interface SnijGroepSummary {
  kwaliteit_code: string
  kleur_code: string
  totaal_stukken: number
  totaal_orders: number
  totaal_m2: number
  totaal_gesneden: number           // alles voorbij snijfase (backward compat)
  vroegste_afleverdatum: string | null
  totaal_gepland: number
  totaal_wacht: number
  totaal_in_productie: number       // tab-filtering
  totaal_status_gesneden: number    // alleen status 'Gesneden'
  totaal_in_confectie: number       // tab-filtering
  totaal_gereed: number             // tab-filtering
}
```

- [ ] **Step 2: Voeg `rol_id` toe aan `SnijplanRow`**

In `frontend/src/lib/types/productie.ts`, voeg `rol_id` toe aan het `SnijplanRow` interface. De `snijplanning_overzicht` view bevat dit veld al (gebruikt door `fetchRolSnijstukken`), maar het ontbreekt in het TypeScript type:

```typescript
// In SnijplanRow interface, bij "// Rol info" (na regel 45, vóór rolnummer):
  rol_id: number | null
  rolnummer: string | null
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/supabase/queries/snijplanning.ts frontend/src/lib/types/productie.ts
git commit -m "feat: SnijGroepSummary type uitbreiden met per-status counts + rol_id in SnijplanRow"
```

---

## Task 3: Tab-filtering implementeren op overview pagina

**Files:**
- Modify: `frontend/src/pages/snijplanning/snijplanning-overview.tsx`

Het kernprobleem: de `status` state wordt gezet bij tab-klik maar nooit gebruikt om `groepen` te filteren. We voegen client-side filtering toe op basis van de per-status counts uit de view.

- [ ] **Step 1: Voeg filter-logica toe**

In `snijplanning-overview.tsx`, voeg na regel 14 (`useSnijplanningGroepen`) een `filteredGroepen` memo toe:

```typescript
import { useState, useMemo } from 'react'
// ... bestaande imports ...

export function SnijplanningOverviewPage() {
  const [status, setStatus] = useState('Alle')
  const [search, setSearch] = useState('')

  const { data: groepen, isLoading } = useSnijplanningGroepen(search || undefined)
  const { data: statusCounts } = useSnijplanningStatusCounts()
  const { data: dashboard } = useProductieDashboard()

  // Client-side filtering op basis van per-status counts
  const filteredGroepen = useMemo(() => {
    if (!groepen || status === 'Alle') return groepen ?? []
    return groepen.filter((g) => {
      switch (status) {
        case 'Wacht': return (g.totaal_wacht ?? 0) > 0
        case 'Gepland': return (g.totaal_gepland ?? 0) > 0
        case 'In productie': return (g.totaal_in_productie ?? 0) > 0
        case 'Gesneden': return (g.totaal_status_gesneden ?? 0) > 0
        case 'Gereed': return (g.totaal_gereed ?? 0) > 0
        default: return true
      }
    })
  }, [groepen, status])

  // ... rest van component, maar gebruik filteredGroepen i.p.v. groepen ...
```

- [ ] **Step 2: Update de description en groepen-lijst**

Vervang `groepen` door `filteredGroepen` in de JSX:
- In de `PageHeader` description: `${filteredGroepen.length ?? 0} kwaliteit/kleur groepen`
- In de lege-staat check: `!filteredGroepen || filteredGroepen.length === 0`
- In de `.map()`: `filteredGroepen.map((g) => ...)`

- [ ] **Step 3: Handmatig testen**

Open `/snijplanning` in de browser:
1. Klik op "Gepland" tab → alleen groepen met geplande items zichtbaar
2. Klik op "Wacht" tab → alleen groepen met wachtende items zichtbaar
3. Klik op "Alle" tab → alle groepen weer zichtbaar
4. Combineer met zoekbalk → beide filters werken samen

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/snijplanning/snijplanning-overview.tsx
git commit -m "fix: tab-filtering implementeren op snijplanning overview"
```

---

## Task 4: QR-code library installeren

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Installeer qrcode library**

```bash
cd frontend && npm install qrcode @types/qrcode
```

Dit is een kleine, populaire library voor het genereren van QR-codes als SVG/data-URL. Wordt gebruikt in de sticker-layout.

- [ ] **Step 2: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: qrcode library toevoegen voor sticker QR-codes"
```

---

## Task 5: Sticker-layout herontwerpen met QR-code en logo

**Files:**
- Modify: `frontend/src/components/snijplanning/sticker-layout.tsx`

Herontwerp de sticker op basis van het Floorpassion-voorbeeld:
- Floorpassion logo bovenaan (SVG inline of als asset)
- Horizontale lijn
- Links: Kwaliteit, Kleur, Afmeting (met "ca." prefix)
- Rechts: QR-code met scancode (synchroon SVG, geen flash bij printen)
- Onderaan links: snijplan_nr, onderaan rechts: order_nr

Extra velden conform specificatie:
- Vorm (via bestaande `formatVorm` helper), Afwerking, Klant naam

- [ ] **Step 1: Herschrijf de StickerLayout component**

```tsx
import { useMemo } from 'react'
import QRCode from 'qrcode'
import type { SnijplanRow } from '@/lib/types/productie'
import { AFWERKING_MAP } from '@/lib/utils/constants'

interface StickerLayoutProps {
  snijplan: SnijplanRow
  label?: string
}

function formatMaat(row: SnijplanRow): string {
  const b = row.maatwerk_breedte_cm ?? row.snij_breedte_cm
  const l = row.maatwerk_lengte_cm ?? row.snij_lengte_cm
  return `ca. ${b} × ${l} cm.`
}

function formatVorm(row: SnijplanRow): string {
  if (!row.maatwerk_vorm) return '-'
  const labels: Record<string, string> = {
    rechthoek: 'Rechthoek',
    rond: 'Rond',
    ovaal: 'Ovaal',
  }
  return labels[row.maatwerk_vorm] ?? row.maatwerk_vorm
}

function formatAfwerking(row: SnijplanRow): string {
  if (!row.maatwerk_afwerking) return 'Geen'
  const info = AFWERKING_MAP[row.maatwerk_afwerking]
  const base = info ? `${info.code} ${info.label}` : row.maatwerk_afwerking
  if ((row.maatwerk_afwerking === 'B' || row.maatwerk_afwerking === 'SB') && row.maatwerk_band_kleur) {
    return `${base} - ${row.maatwerk_band_kleur}`
  }
  return base
}

/** Genereer QR SVG string synchroon — geen flash bij eerste render/print */
function useQrSvg(text: string): string {
  return useMemo(() => {
    if (!text) return ''
    try {
      // QRCode.toString is sync wanneer geen callback wordt meegegeven (returns string)
      let svg = ''
      QRCode.toString(text, { type: 'svg', width: 96, margin: 1, errorCorrectionLevel: 'M' },
        (err, str) => { if (!err && str) svg = str })
      return svg
    } catch {
      return ''
    }
  }, [text])
}

export function StickerLayout({ snijplan, label }: StickerLayoutProps) {
  const qrSvg = useQrSvg(snijplan.scancode)

  return (
    <div
      className="sticker-label border border-dashed border-slate-300 bg-white box-border p-4 flex flex-col justify-between"
      style={{ width: '100mm', height: '60mm' }}
    >
      {label && (
        <div className="text-[8px] text-slate-400 mb-0.5 print:hidden">{label}</div>
      )}

      {/* Header: Logo */}
      <div className="flex items-center gap-2 mb-1">
        <FloorpassionLogo />
      </div>

      <hr className="border-slate-300 mb-2" />

      {/* Body: info + QR */}
      <div className="flex justify-between flex-1">
        {/* Left: Product details */}
        <div className="flex flex-col gap-0.5 text-[11px] leading-snug">
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Kwaliteit</span>
            <span className="font-semibold">: {snijplan.kwaliteit_code}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Kleur</span>
            <span className="font-semibold">: {snijplan.kleur_code}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Afmeting</span>
            <span className="font-semibold">: {formatMaat(snijplan)}</span>
          </div>
          {snijplan.maatwerk_vorm && snijplan.maatwerk_vorm !== 'rechthoek' && (
            <div className="flex gap-2">
              <span className="text-terracotta-500 w-16">Vorm</span>
              <span className="font-semibold">: {formatVorm(snijplan)}</span>
            </div>
          )}
          {snijplan.maatwerk_afwerking && (
            <div className="flex gap-2">
              <span className="text-terracotta-500 w-16">Afwerking</span>
              <span className="font-semibold">: {formatAfwerking(snijplan)}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Klant</span>
            <span className="font-semibold">: {snijplan.klant_naam}</span>
          </div>
        </div>

        {/* Right: QR code (synchroon SVG — altijd beschikbaar bij print) */}
        <div className="flex flex-col items-center justify-center">
          {qrSvg ? (
            <div className="w-20 h-20" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <div className="w-20 h-20 bg-slate-100 flex items-center justify-center text-[8px] text-slate-400">
              QR
            </div>
          )}
          <span className="text-[9px] text-slate-500 mt-0.5">{snijplan.scancode}</span>
        </div>
      </div>

      {/* Footer: snijplan_nr + order_nr */}
      <div className="flex justify-between items-end mt-1 pt-1">
        <span className="text-xs font-bold">{snijplan.snijplan_nr}</span>
        <span className="text-xs text-slate-500">{snijplan.order_nr}</span>
      </div>
    </div>
  )
}

/** Inline SVG Floorpassion logo — simpele tekst-versie.
 *  Vervang door echte SVG/asset wanneer beschikbaar. */
function FloorpassionLogo() {
  return (
    <div className="flex items-center gap-1.5">
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="4" y="4" width="16" height="16" rx="1" transform="rotate(45 12 12)" />
        <text x="12" y="14" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none" fontWeight="bold">FP</text>
      </svg>
      <span className="text-sm font-bold tracking-tight">FLOORPASSION.</span>
    </div>
  )
}
```

- [ ] **Step 2: Verifieer in browser**

Open `/snijplanning/:id/stickers` voor een bestaand snijplan. Controleer:
- QR-code is meteen zichtbaar (geen flash/flicker)
- Layout matcht het Floorpassion voorbeeld
- Vorm-label toont "Rond" (niet "rond")
- Alle velden zijn gevuld

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/snijplanning/sticker-layout.tsx
git commit -m "feat: sticker-layout herontwerpen met QR-code en Floorpassion branding"
```

---

## Task 6: Bulk sticker print pagina

**Files:**
- Create: `frontend/src/pages/snijplanning/stickers-bulk.tsx`
- Modify: `frontend/src/router.tsx`

Pagina om alle stickers van een kwaliteit+kleur groep of een hele rol tegelijk te printen. Elk stuk krijgt 2 stickers (1 voor tapijt, 1 voor orderdossier).

- [ ] **Step 1: Maak de bulk sticker pagina**

```tsx
import { useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { StickerLayout } from '@/components/snijplanning/sticker-layout'
import { useSnijplannenVoorGroep, useRolSnijstukken } from '@/hooks/use-snijplanning'

export function StickersBulkPage() {
  const [params] = useSearchParams()
  const kwaliteit = params.get('kwaliteit') ?? ''
  const kleur = params.get('kleur') ?? ''
  const rolParam = params.get('rol')
  const rolId = rolParam && Number.isFinite(Number(rolParam)) ? Number(rolParam) : null
  const statusFilter = params.get('status') // optioneel: alleen stickers voor bepaalde status

  // Haal stukken op: per groep OF per rol (niet beide)
  const { data: groepStukken } = useSnijplannenVoorGroep(kwaliteit, kleur, !rolId && !!kwaliteit && !!kleur)
  const { data: rolStukken } = useRolSnijstukken(rolId)

  const alleStukken = rolStukken ?? groepStukken ?? []
  const stukken = statusFilter
    ? alleStukken.filter(s => s.status === statusFilter)
    : alleStukken

  const title = rolId
    ? `Stickers — Rol`
    : `Stickers — ${kwaliteit} ${kleur}`

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={title}
          description={`${stukken.length} stukken × 2 stickers = ${stukken.length * 2} stickers`}
          actions={
            <div className="flex items-center gap-3">
              <Link
                to="/snijplanning"
                className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-sm)] text-sm text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <ArrowLeft size={16} />
                Terug
              </Link>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 transition-colors"
              >
                <Printer size={16} />
                Alles printen ({stukken.length * 2} stickers)
              </button>
            </div>
          }
        />
      </div>

      {/* Stickers grid — 2 per stuk */}
      <div className="sticker-print-area">
        {stukken.map((stuk) => (
          <div key={stuk.id} className="mb-4 print:mb-0">
            <div className="text-xs text-slate-400 mb-1 print:hidden">
              {stuk.snijplan_nr} — {stuk.klant_naam}
            </div>
            <div className="flex flex-col items-start gap-2 print:gap-0">
              <StickerLayout snijplan={stuk} label="Sticker tapijt" />
              <StickerLayout snijplan={stuk} label="Sticker orderdossier" />
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .sticker-print-area,
          .sticker-print-area * { visibility: visible; }
          .sticker-print-area {
            position: absolute;
            top: 0;
            left: 0;
          }
          .sticker-label {
            page-break-after: always;
            margin: 0;
            border: none;
          }
          @page {
            size: 100mm 60mm;
            margin: 0;
          }
        }
      `}</style>
    </>
  )
}
```

- [ ] **Step 2: Route toevoegen**

In `frontend/src/router.tsx`, voeg toe:

```typescript
import { StickersBulkPage } from '@/pages/snijplanning/stickers-bulk'

// In routes array, na de bestaande sticker route:
{ path: 'snijplanning/stickers', element: <StickersBulkPage /> },
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/snijplanning/stickers-bulk.tsx frontend/src/router.tsx
git commit -m "feat: bulk sticker print pagina voor hele groep of rol"
```

---

## Task 7: Gedeelde snijplan-mapping utility extraheren

**Files:**
- Create: `frontend/src/lib/utils/snijplan-mapping.ts`
- Modify: `frontend/src/components/snijplanning/groep-accordion.tsx`

De rotatie-inferentie logica in `groep-accordion.tsx:buildPlanFromStukken()` moet hergebruikt worden op de productie-pagina. Extraheer naar een gedeelde utility.

- [ ] **Step 1: Maak de utility**

```typescript
// frontend/src/lib/utils/snijplan-mapping.ts
import type { SnijplanRow, SnijStuk, SnijvoorstelResponse, SnijvoorstelRol } from '@/lib/types/productie'

/**
 * Map SnijplanRow items naar SnijStuk array met correcte rotatie-inferentie.
 *
 * Optimizer convention: lengte_cm = X (across roll width), breedte_cm = Y (along roll length).
 * Raw piece data (snij_lengte_cm/snij_breedte_cm) has no rotation info.
 * We infer rotation by checking which orientation fits the stored shelf position.
 */
export function mapSnijplannenToStukken(
  stukken: SnijplanRow[],
  rolBreedte: number,
  rolLengte: number,
): { snijStukken: SnijStuk[]; gebruikteLengte: number; afvalPct: number; reststukBruikbaar: boolean } {
  const placed = stukken.filter(s => s.positie_x_cm != null && s.positie_y_cm != null)

  // Determine shelf heights from Y positions for rotation inference
  const uniqueYs = [...new Set(placed.map(s => s.positie_y_cm!))].sort((a, b) => a - b)
  const shelfHeightAt = new Map<number, number>()
  for (let i = 0; i < uniqueYs.length; i++) {
    const nextY = i + 1 < uniqueYs.length ? uniqueYs[i + 1] : rolLengte
    shelfHeightAt.set(uniqueYs[i], nextY - uniqueYs[i])
  }

  const snijStukken: SnijStuk[] = placed.map(s => {
    const x = s.positie_x_cm!
    const y = s.positie_y_cm!
    const shelfH = shelfHeightAt.get(y) ?? rolLengte

    // Pick orientation whose Y-extent fits the shelf height
    // Default (not rotated): X = snij_lengte, Y = snij_breedte
    // Rotated: X = snij_breedte, Y = snij_lengte
    const defaultYFits = s.snij_breedte_cm <= shelfH && x + s.snij_lengte_cm <= rolBreedte
    const rotatedYFits = s.snij_lengte_cm <= shelfH && x + s.snij_breedte_cm <= rolBreedte
    const isRotated = !defaultYFits && rotatedYFits

    const lengte_cm = isRotated ? s.snij_breedte_cm : s.snij_lengte_cm  // X dimension
    const breedte_cm = isRotated ? s.snij_lengte_cm : s.snij_breedte_cm // Y dimension

    return {
      snijplan_id: s.id,
      order_regel_id: s.order_regel_id,
      order_nr: s.order_nr,
      klant_naam: s.klant_naam,
      lengte_cm,
      breedte_cm,
      vorm: s.maatwerk_vorm ?? 'rechthoek',
      afwerking: s.maatwerk_afwerking,
      x_cm: x,
      y_cm: y,
      geroteerd: isRotated,
      afleverdatum: s.afleverdatum,
    }
  })

  // Calculate stats
  const gebruikteLengte = snijStukken.length > 0
    ? Math.max(...snijStukken.map(s => s.y_cm + s.breedte_cm))
    : 0
  const usedArea = rolBreedte * gebruikteLengte
  const pieceArea = snijStukken.reduce((sum, p) => sum + p.lengte_cm * p.breedte_cm, 0)
  const afvalPct = usedArea > 0 ? Math.round((1 - pieceArea / usedArea) * 1000) / 10 : 0
  const restLengte = rolLengte - gebruikteLengte
  const reststukBruikbaar = restLengte > 100

  return { snijStukken, gebruikteLengte, afvalPct, reststukBruikbaar }
}

/**
 * Reconstruct a SnijvoorstelResponse from loaded snijplannen data.
 * Fallback when no approved voorstel record exists.
 */
export function buildPlanFromStukken(stukken: SnijplanRow[]): SnijvoorstelResponse | null {
  const gepland = stukken.filter(s => s.status === 'Gepland' && s.rolnummer)
  if (gepland.length === 0) return null

  const rolMap = new Map<string, { stukken: SnijplanRow[]; rol_lengte_cm: number; rol_breedte_cm: number; rol_status: string }>()
  for (const s of gepland) {
    const key = s.rolnummer!
    if (!rolMap.has(key)) {
      rolMap.set(key, {
        stukken: [],
        rol_lengte_cm: s.rol_lengte_cm ?? 0,
        rol_breedte_cm: s.rol_breedte_cm ?? 0,
        rol_status: s.rol_status ?? 'in_snijplan',
      })
    }
    rolMap.get(key)!.stukken.push(s)
  }

  const rollen: SnijvoorstelRol[] = Array.from(rolMap.entries()).map(([rolnummer, info]) => {
    const { snijStukken, gebruikteLengte, afvalPct } = mapSnijplannenToStukken(
      info.stukken, info.rol_breedte_cm, info.rol_lengte_cm,
    )

    const plaatsingen = snijStukken.map(s => ({
      snijplan_id: s.snijplan_id!,
      positie_x_cm: s.x_cm,
      positie_y_cm: s.y_cm,
      lengte_cm: s.lengte_cm,
      breedte_cm: s.breedte_cm,
      geroteerd: s.geroteerd ?? false,
    }))

    return {
      rol_id: 0,
      rolnummer,
      rol_lengte_cm: info.rol_lengte_cm,
      rol_breedte_cm: info.rol_breedte_cm,
      rol_status: info.rol_status as SnijvoorstelRol['rol_status'],
      plaatsingen,
      gebruikte_lengte_cm: gebruikteLengte,
      afval_percentage: afvalPct,
      restlengte_cm: info.rol_lengte_cm - gebruikteLengte,
    }
  })

  const totaalGeplaatst = rollen.reduce((s, r) => s + r.plaatsingen.length, 0)
  const totaalM2Gebruikt = rollen.reduce((s, r) => s + (r.rol_breedte_cm * r.gebruikte_lengte_cm) / 10000, 0)
  const totaalM2Afval = rollen.reduce((s, r) => {
    const used = (r.rol_breedte_cm * r.gebruikte_lengte_cm) / 10000
    return s + used * (r.afval_percentage / 100)
  }, 0)
  const gemAfval = rollen.length > 0
    ? Math.round(rollen.reduce((s, r) => s + r.afval_percentage, 0) / rollen.length * 10) / 10
    : 0

  return {
    voorstel_id: 0,
    voorstel_nr: 'Huidig plan',
    rollen,
    niet_geplaatst: [],
    samenvatting: {
      totaal_stukken: gepland.length,
      geplaatst: totaalGeplaatst,
      niet_geplaatst: 0,
      totaal_rollen: rollen.length,
      gemiddeld_afval_pct: gemAfval,
      totaal_m2_gebruikt: Math.round(totaalM2Gebruikt * 10) / 10,
      totaal_m2_afval: Math.round(totaalM2Afval * 10) / 10,
    },
  }
}
```

- [ ] **Step 2: Refactor groep-accordion.tsx**

Verwijder de inline `buildPlanFromStukken` functie (regels 17-113) en importeer uit de utility:

```typescript
import { buildPlanFromStukken } from '@/lib/utils/snijplan-mapping'
```

- [ ] **Step 3: Verifieer dat "Bekijk plan" nog werkt**

Open de snijplanning, klik "Bekijk plan" op een groep met geplande items. De visualisatie moet identiek zijn aan voor de refactor.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/utils/snijplan-mapping.ts frontend/src/components/snijplanning/groep-accordion.tsx
git commit -m "refactor: extracteer snijplan-mapping utility voor hergebruik"
```

---

## Task 8: Productie-pagina per rol

**Files:**
- Create: `frontend/src/pages/snijplanning/productie-rol.tsx`
- Modify: `frontend/src/router.tsx`

Dit is de kernpagina voor de productiemedewerker. Per rol ziet hij:
1. De rol-visualisatie met alle te snijden stukken (met correcte rotatie)
2. Een tabel met details per stuk
3. Knop "Rol gesneden" → markeert alle stukken als gesneden via `voltooi_snijplan_rol` RPC
4. Na het snijden: automatisch stickers tonen/printen

**Depends on:** Task 7 (snijplan-mapping utility)

- [ ] **Step 1: Maak de productie-rol pagina**

```tsx
import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Scissors, Printer, CheckCircle2, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { SnijVisualisatie } from '@/components/snijplanning/snij-visualisatie'
import { StickerLayout } from '@/components/snijplanning/sticker-layout'
import { useRolSnijstukken, useVoltooiSnijplanRol } from '@/hooks/use-snijplanning'
import { mapSnijplannenToStukken } from '@/lib/utils/snijplan-mapping'
import { cn } from '@/lib/utils/cn'
import { AFWERKING_MAP } from '@/lib/utils/constants'

export function ProductieRolPage() {
  const { rolId } = useParams<{ rolId: string }>()
  const navigate = useNavigate()
  // NaN guard: Number(undefined) = NaN, hook heeft enabled: !!rolId
  const rolIdNum = rolId ? Number(rolId) : null
  const { data: stukken, isLoading } = useRolSnijstukken(
    rolIdNum && Number.isFinite(rolIdNum) ? rolIdNum : null
  )
  const voltooiRol = useVoltooiSnijplanRol()
  const [voltooid, setVoltooid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showStickers, setShowStickers] = useState(false)

  if (isLoading) {
    return <PageHeader title="Laden..." />
  }

  if (!stukken || stukken.length === 0) {
    return (
      <>
        <PageHeader title="Geen stukken gevonden" />
        <Link to="/snijplanning" className="text-terracotta-500 hover:underline">
          Terug naar snijplanning
        </Link>
      </>
    )
  }

  const eerste = stukken[0]
  const rolnummer = eerste.rolnummer ?? 'Onbekend'
  const rolBreedte = eerste.rol_breedte_cm ?? 400
  const rolLengte = eerste.rol_lengte_cm ?? 2000
  const kwaliteit = eerste.kwaliteit_code ?? ''
  const kleur = eerste.kleur_code ?? ''

  // Filter op relevante statussen voor productie
  const teSnijden = stukken.filter(s => s.status === 'Gepland' || s.status === 'In productie')
  const alGesneden = stukken.filter(s => s.status === 'Gesneden' || s.status === 'In confectie' || s.status === 'Gereed')

  // Map met correcte rotatie-inferentie via gedeelde utility
  const { snijStukken, gebruikteLengte, afvalPct, reststukBruikbaar } =
    mapSnijplannenToStukken(stukken, rolBreedte, rolLengte)

  const restLengte = rolLengte - gebruikteLengte

  const handleVoltooiRol = () => {
    if (!rolIdNum) return
    setError(null)
    voltooiRol.mutate(
      { rolId: rolIdNum },
      {
        onSuccess: () => {
          setVoltooid(true)
          setShowStickers(true)
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Onbekende fout'),
      },
    )
  }

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Productie — ${rolnummer}`}
          description={`${kwaliteit} ${kleur} · ${teSnijden.length} te snijden · ${alGesneden.length} gesneden`}
          actions={
            <div className="flex items-center gap-3">
              <Link
                to="/snijplanning"
                className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-sm)] text-sm text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <ArrowLeft size={16} />
                Terug
              </Link>
              {!voltooid && teSnijden.length > 0 && (
                <button
                  onClick={handleVoltooiRol}
                  disabled={voltooiRol.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  {voltooiRol.isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Scissors size={16} />
                  )}
                  Rol gesneden ({teSnijden.length} stuks)
                </button>
              )}
              {/* Stickers alleen na snijden prominent tonen */}
              {(voltooid || alGesneden.length > 0) && (
                <button
                  onClick={() => setShowStickers(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm hover:bg-slate-50 transition-colors"
                >
                  <Printer size={16} />
                  Stickers
                </button>
              )}
            </div>
          }
        />

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-[var(--radius-sm)] text-sm text-red-700">
            {error}
          </div>
        )}

        {voltooid && (
          <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-[var(--radius-sm)] text-sm text-emerald-700 flex items-center gap-2">
            <CheckCircle2 size={16} />
            Rol is gesneden! Stukken zijn gemarkeerd als "Gesneden". Print de stickers hieronder.
          </div>
        )}

        {/* Rol visualisatie */}
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-4">
          <h2 className="text-sm font-medium text-slate-700 mb-3">
            Snijplan — {rolnummer} ({rolBreedte} × {rolLengte} cm)
          </h2>
          <div className="flex justify-center">
            <SnijVisualisatie
              rolBreedte={rolBreedte}
              rolLengte={rolLengte}
              stukken={snijStukken}
              restLengte={restLengte}
              afvalPct={afvalPct}
              reststukBruikbaar={reststukBruikbaar}
              className="max-w-3xl"
            />
          </div>
        </div>

        {/* Stukken tabel */}
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
          <h2 className="text-sm font-medium text-slate-700 mb-3">
            Stukken ({stukken.length})
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                <th className="py-2 pr-3">Nr</th>
                <th className="py-2 pr-3">Maat</th>
                <th className="py-2 pr-3">Klant</th>
                <th className="py-2 pr-3">Order</th>
                <th className="py-2 pr-3">Afwerking</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Sticker</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stukken.map((stuk) => (
                <tr key={stuk.id} className="hover:bg-slate-50">
                  <td className="py-2 pr-3 text-xs text-slate-500">{stuk.snijplan_nr}</td>
                  <td className="py-2 pr-3 font-medium">
                    {stuk.snij_breedte_cm}×{stuk.snij_lengte_cm} cm
                  </td>
                  <td className="py-2 pr-3">{stuk.klant_naam}</td>
                  <td className="py-2 pr-3">
                    <Link to={`/orders/${stuk.order_id}`} className="text-terracotta-600 hover:underline">
                      {stuk.order_nr}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    {stuk.maatwerk_afwerking && AFWERKING_MAP[stuk.maatwerk_afwerking] ? (
                      <span className={cn('text-xs px-1.5 py-0.5 rounded', AFWERKING_MAP[stuk.maatwerk_afwerking].bg, AFWERKING_MAP[stuk.maatwerk_afwerking].text)}>
                        {stuk.maatwerk_afwerking}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded',
                      stuk.status === 'Gepland' ? 'bg-blue-100 text-blue-700'
                        : stuk.status === 'In productie' ? 'bg-indigo-100 text-indigo-700'
                        : stuk.status === 'Gesneden' ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    )}>
                      {stuk.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <Link
                      to={`/snijplanning/${stuk.id}/stickers`}
                      className="text-xs text-terracotta-500 hover:underline"
                    >
                      Print
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stickers sectie */}
      {showStickers && (
        <div className="print:hidden mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-slate-700">
              Stickers ({stukken.length * 2})
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigate(`/snijplanning/stickers?kwaliteit=${kwaliteit}&kleur=${kleur}&rol=${rolIdNum}`)
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm hover:bg-terracotta-600 transition-colors"
              >
                <Printer size={14} />
                Print alle stickers
              </button>
              <button
                onClick={() => setShowStickers(false)}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                Verbergen
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stukken.slice(0, 4).map((stuk) => (
              <StickerLayout key={stuk.id} snijplan={stuk} />
            ))}
          </div>
          {stukken.length > 4 && (
            <p className="text-xs text-slate-400 mt-2">
              + {stukken.length - 4} meer stickers. Klik "Print alle stickers" om alles te printen.
            </p>
          )}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Route toevoegen**

In `frontend/src/router.tsx`, voeg toe:

```typescript
import { ProductieRolPage } from '@/pages/snijplanning/productie-rol'

// In routes array:
{ path: 'snijplanning/productie/:rolId', element: <ProductieRolPage /> },
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/snijplanning/productie-rol.tsx frontend/src/router.tsx
git commit -m "feat: productie-pagina per rol met snij-flow en sticker integratie"
```

---

## Task 9: Shortcuts in groep-accordion header + sticker link

**Files:**
- Modify: `frontend/src/components/snijplanning/groep-accordion.tsx`

Twee verbeteringen:
1. **Header shortcut:** "Snijden" knop naast "Bekijk plan" — linkt naar productie-pagina van de eerste rol
2. **Printer icon:** Wrap in Link naar bulk sticker pagina
3. **Rol-kolom in tabel:** Link naar productie-pagina per rol (alleen als `rol_id` truthy)

- [ ] **Step 1: Voeg "Snijden" knop toe in de header**

In `groep-accordion.tsx`, voeg een import toe voor `Link` en `PlayCircle` (of hergebruik `Scissors`).

In de header buttons (na "Bekijk plan" knop), voeg toe:

```tsx
{/* Snijden shortcut — linkt naar productie van eerste rol */}
{heeftGepland && stukken && stukken.some(s => s.rol_id) && (
  <Link
    to={`/snijplanning/productie/${stukken.find(s => s.rol_id)?.rol_id}`}
    onClick={(e) => e.stopPropagation()}
    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white rounded-[var(--radius-sm)] text-xs font-medium hover:bg-emerald-600 transition-colors"
  >
    <Scissors size={14} />
    Snijden
  </Link>
)}
```

**Nota:** Deze knop laadt `stukken` data — de hook `useSnijplannenVoorGroep` is al enabled wanneer `open || showPlan` is true. Om de knop ook zonder expanderen te tonen, moet de hook ook vuren als `heeftGepland` true is. Wijzig:

```typescript
const { data: stukken, isLoading } = useSnijplannenVoorGroep(
  kwaliteitCode, kleurCode, open || showPlan || heeftGepland
)
```

- [ ] **Step 2: Wrap Printer icon in Link**

Vervang de losse `<Printer>` icon door:

```tsx
<Link
  to={`/snijplanning/stickers?kwaliteit=${kwaliteitCode}&kleur=${kleurCode}&status=Gepland`}
  onClick={(e) => e.stopPropagation()}
  className="text-slate-400 hover:text-slate-600"
  title="Stickers printen"
>
  <Printer size={16} />
</Link>
```

- [ ] **Step 3: Voeg Rol-kolom toe in stukken-tabel**

Extra header:
```tsx
<th className="py-2 pr-3">Rol</th>
```

Extra cel in `StukRow` (alleen linken als `rol_id` truthy):
```tsx
<td className="py-2 pr-3">
  {stuk.rolnummer && stuk.rol_id ? (
    <Link
      to={`/snijplanning/productie/${stuk.rol_id}`}
      className="text-terracotta-600 hover:underline text-xs"
    >
      {stuk.rolnummer}
    </Link>
  ) : '—'}
</td>
```

- [ ] **Step 4: Verifieer**

1. Open snijplanning met "Gepland" tab
2. Groep met geplande items moet "Snijden" knop in header tonen
3. Klik "Snijden" → navigeert naar productie-pagina
4. Klik printer icon → navigeert naar bulk sticker pagina
5. Expand accordion → rol-kolom toont links

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/snijplanning/groep-accordion.tsx
git commit -m "feat: snijden-shortcut en sticker-link in groep accordion header"
```

---

## Task 10: Documentatie bijwerken

**Files:**
- Modify: `docs/changelog.md`
- Modify: `docs/architectuur.md`

- [ ] **Step 1: Changelog bijwerken**

Voeg toe aan `docs/changelog.md`:

```markdown
## 2026-04-09 — Snijplanning productie workflow

### Tab-filtering
- Tabs op snijplanning overview filteren nu daadwerkelijk de groepen
- View `snijplanning_groepen` uitgebreid met per-status counts (incl. `totaal_in_confectie`)
- Naamgeving: `totaal_status_gesneden` (enkel status) vs `totaal_gesneden` (voorbij snijfase)

### Productie-flow
- Nieuwe pagina `/snijplanning/productie/:rolId` voor productie per rol
- Rol-visualisatie met correcte rotatie-inferentie (gedeelde utility)
- "Rol gesneden" knop markeert alle stukken als gesneden via RPC `voltooi_snijplan_rol`
- Sticker preview na het snijden
- "Snijden" shortcut knop in accordion header
- V1 aanname: hele rol wordt in één keer gesneden, geen partial cutting
- Status-transitie V1: Gepland → Gesneden (tussenliggende "In productie" status niet gebruikt)

### Stickers
- Herontwerp met Floorpassion branding en QR-code (synchroon SVG, geen flash)
- QR-codes dienen als tracking door het hele proces (snijden → confectie → inpak)
- Bulk sticker print pagina `/snijplanning/stickers`
- Per regel of bulk (hele groep/rol) printen
- 2 stickers per stuk: tapijt + orderdossier
```

- [ ] **Step 2: Architectuur bijwerken**

Voeg de nieuwe routes toe aan `docs/architectuur.md`:
- `/snijplanning/productie/:rolId` — Productie-pagina per rol
- `/snijplanning/stickers` — Bulk sticker print (query params: kwaliteit, kleur, rol, status)

Voeg toe onder utils:
- `frontend/src/lib/utils/snijplan-mapping.ts` — Gedeelde rotatie-inferentie + plan-reconstructie

- [ ] **Step 3: Commit**

```bash
git add docs/changelog.md docs/architectuur.md
git commit -m "docs: snijplanning productie workflow documentatie"
```

---

## Samenvatting flow

```
Snijplanning Overview (tabs filteren groepen)
  ├─ Tab "Wacht" → groepen met wachtende stukken
  │   └─ Genereren → optimizer → snijvoorstel → goedkeuren
  ├─ Tab "Gepland" → groepen met geplande stukken
  │   ├─ Bekijk plan → snijvoorstel modal (read-only)
  │   ├─ "Snijden" knop (header) → /snijplanning/productie/:rolId
  │   ├─ Klik op rolnummer (tabel) → /snijplanning/productie/:rolId
  │   │   ├─ Rol visualisatie (met correcte rotatie + afval%)
  │   │   ├─ "Rol gesneden" → RPC voltooi_snijplan_rol → Gepland→Gesneden
  │   │   └─ Stickers preview → bulk print
  │   └─ Printer icon → /snijplanning/stickers?kwaliteit=X&kleur=Y
  ├─ Tab "In productie" → (V1: leeg, beschikbaar voor toekomstig gebruik)
  ├─ Tab "Gesneden" → groepen met gesneden stukken
  └─ Tab "Gereed" → groepen met gereedgemelde stukken

QR-code flow: scancode op sticker → scanstation (inpak) → status update
```

## V1 bewuste beperkingen

1. **Geen "In productie" transitie** — V1 springt direct van Gepland naar Gesneden. De tab blijft zichtbaar voor toekomstig gebruik.
2. **Geen partial roll cutting** — Een rol wordt altijd in zijn geheel gesneden. Fysiek logisch.
3. **QR-scan = inpak bevestiging** — Het bestaande scanstation bevestigt inpak, niet snijden. Snij-bevestiging gaat via de "Rol gesneden" knop.
