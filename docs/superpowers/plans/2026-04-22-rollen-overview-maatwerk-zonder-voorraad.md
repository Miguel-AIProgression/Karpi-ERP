# Rollen-overzicht: Placeholder-rollen voor ontbrekende maatwerk-paren + uitwissel-indicatie

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elke maatwerk (kwaliteit, kleur)-combi die géén rij in `rollen` heeft, krijgt een placeholder-rol (oppervlak = 0, status `beschikbaar`) zodat ze op de "Rollen & Reststukken"-pagina verschijnen. Voor paren die via `kwaliteit_kleur_uitwisselgroepen` wél leverbaar zijn, toont de UI een "Leverbaar via [KWAL kleur]"-badge.

**Architecture:** Minimale ingreep. (1) Data-migratie insert placeholder-rollen vanuit `maatwerk_m2_prijzen`, met `artikelnr` uit een matchend `producten`-record. (2) Lichte RPC `rollen_uitwissel_voorraad()` retourneert per (kwaliteit, kleur) de beste uitwissel-kandidaat — zelfde logica als migratie 105, maar cross-kwaliteit in één call. (3) `fetchRollenGegroepeerd` mergt equiv-data op groepen waar `totaal_m2 = 0`. (4) `RollenGroepRow` toont grijzige stijl + badge.

**Tech Stack:** PostgreSQL (Supabase), TypeScript, React + TanStack Query.

---

## Context & Referenties

- Pagina: [rollen-overview.tsx](frontend/src/pages/rollen/rollen-overview.tsx)
- Groep-row: [rollen-groep-row.tsx](frontend/src/components/rollen/rollen-groep-row.tsx)
- Query: [rollen.ts](frontend/src/lib/supabase/queries/rollen.ts#L99-L170)
- Hook: [use-rollen.ts](frontend/src/hooks/use-rollen.ts#L24-L29)
- Type `RolGroep`: [productie.ts](frontend/src/lib/types/productie.ts#L195-L205)
- Referentie-logica uitwisselgroep: [105_kleuren_voor_kwaliteit_uitwisselbaar.sql](supabase/migrations/105_kleuren_voor_kwaliteit_uitwisselbaar.sql)
- Rollen-schema: [database-schema.md:206-228](docs/database-schema.md#L206-L228)
- Maatwerk-prijzen: [database-schema.md:630-641](docs/database-schema.md#L630-L641)

## Design-besluiten (vastgelegd)

1. **"Leeg/Op"-placeholder = `oppervlak_m2 = 0`, `lengte_cm = 0`, `breedte_cm = 0`, `status = 'beschikbaar'`** — gebruiker-bevestigd (zie ook stat-card "Leeg/Op 260" in UI). `rollen_stats` classificeert op oppervlak=0 — hoeft niet aangeraakt.
2. **Bron van paren = `maatwerk_m2_prijzen`** — de canonieke lijst van maatwerk-combos. Niet `producten`, want producten bevat ook niet-maatwerk varianten. Als later blijkt dat er maatwerk-paren in `producten` zijn zonder prijs-rij: aparte follow-up.
3. **Artikelnr lookup = 1e `producten` met `product_type='overig'`, 2e `karpi_code ILIKE '%maatwerk%'`, 3e `omschrijving ILIKE '%maatwerk%'`, als tiebreaker laagste artikelnr** — dezelfde volgorde als migratie 105's `uit_maatwerk_artikel` CTE.
4. **Rollen zonder matchend `producten`-record worden overgeslagen** (FK `rollen.artikelnr` is NOT NULL). Een `NOTICE` logt hoeveel paren geskipt zijn zodat je ze handmatig kunt afhandelen.
5. **Rolnummer-conventie: `PH-{KWAL}-{KLEUR}`** (PH = placeholder). Uniek via bestaande `rollen_rolnummer_key` constraint. Migratie is idempotent via `ON CONFLICT (rolnummer) DO NOTHING`.
6. **Uitwissel-info live uit DB, niet opgeslagen in placeholder-rol.** Voorraad van de uitwisselbare kwaliteit verandert continu — stale tekst in `omschrijving` zou misleidend zijn. Daarom aparte RPC die op-render-tijd berekent.
7. **Geen wijziging aan `rollen_stats`, `auto_maak_snijplan`, of andere triggers.** Placeholder-rollen met oppervlak=0 verstoren snijplanning niet (beschikbaar, maar 0 m² is onbruikbaar).
8. **Commits: direct naar `main`** (`feedback_git_workflow.md`).

## File Structure

- **Create:** `supabase/migrations/110_rollen_placeholder_maatwerk.sql` — bevat zowel de `INSERT` voor placeholder-rollen als de nieuwe RPC `rollen_uitwissel_voorraad()`.
- **Modify:** `frontend/src/lib/types/productie.ts:195-205` — `RolGroep` uitgebreid met equiv-velden.
- **Modify:** `frontend/src/lib/supabase/queries/rollen.ts:99-170` — `fetchRollenGegroepeerd` mergt equiv-data op groepen met `totaal_m2 = 0`.
- **Modify:** `frontend/src/components/rollen/rollen-groep-row.tsx:233-290` — grijzige header + "Leverbaar via …"-badge als de groep alleen placeholder-rollen bevat.
- **Modify:** `docs/database-schema.md` — Functies-sectie uitgebreid.
- **Modify:** `docs/changelog.md` — entry 2026-04-22.

---

## Task 1: SQL-migratie 110 — placeholder-rollen + uitwissel-RPC

**Files:**
- Create: `supabase/migrations/110_rollen_placeholder_maatwerk.sql`

- [ ] **Step 1.1: Pre-check — welke maatwerk-paren missen een rol?**

Via Supabase MCP `execute_sql` (read-only — geen migratie nog):

```sql
SELECT COUNT(*) AS missend
FROM maatwerk_m2_prijzen mp
WHERE NOT EXISTS (
  SELECT 1 FROM rollen r
  WHERE r.kwaliteit_code = mp.kwaliteit_code
    AND r.kleur_code = mp.kleur_code
    AND r.status NOT IN ('verkocht', 'gesneden')
);
```

Noteer het getal. Verwacht: >0 (bv. ergens rond de enkele tientallen tot honderdtallen).

- [ ] **Step 1.2: Pre-check — hoeveel hebben een matchend producten-record?**

```sql
WITH missend AS (
  SELECT mp.kwaliteit_code, mp.kleur_code
  FROM maatwerk_m2_prijzen mp
  WHERE NOT EXISTS (
    SELECT 1 FROM rollen r
    WHERE r.kwaliteit_code = mp.kwaliteit_code
      AND r.kleur_code = mp.kleur_code
      AND r.status NOT IN ('verkocht', 'gesneden')
  )
)
SELECT
  COUNT(*) FILTER (WHERE p.artikelnr IS NOT NULL) AS met_artikel,
  COUNT(*) FILTER (WHERE p.artikelnr IS NULL)     AS zonder_artikel
FROM missend m
LEFT JOIN LATERAL (
  SELECT pr.artikelnr
  FROM producten pr
  WHERE pr.kwaliteit_code = m.kwaliteit_code
    AND pr.kleur_code = m.kleur_code
    AND pr.actief = true
  ORDER BY (CASE WHEN pr.product_type = 'overig'         THEN 0
                 WHEN pr.karpi_code   ILIKE '%maatwerk%' THEN 1
                 WHEN pr.omschrijving ILIKE '%maatwerk%' THEN 2
                 ELSE 3 END),
           pr.artikelnr
  LIMIT 1
) p ON true;
```

Verwacht: `zonder_artikel` moet laag zijn (liefst 0). Als het groot is, meld het terug voor we de migratie draaien — dan missen er artikelen in `producten` die we apart moeten aanmaken.

- [ ] **Step 1.3: Schrijf migratie 110**

Maak `supabase/migrations/110_rollen_placeholder_maatwerk.sql`:

```sql
-- Migration 110: placeholder-rollen voor maatwerk-paren zonder eigen voorraad
--
-- Achtergrond: bij de import van "rollenvoorraad per 15-04-2026" zijn alleen
-- rollen aangemaakt voor kwaliteiten waar daadwerkelijk voorraad van was.
-- Daardoor ontbreken maatwerk (kwaliteit, kleur) paren zoals CISC 15 volledig
-- op de Rollen & Reststukken-pagina, ook als ze via kwaliteit_kleur_uitwissel-
-- groepen leverbaar zijn via een andere kwaliteit (bv. CISC 16).
--
-- Fix, twee onderdelen:
--   1. Idempotente INSERT die voor elk (kwaliteit, kleur)-paar in maatwerk_
--      m2_prijzen zonder actieve rol een placeholder-rol aanmaakt (oppervlak=0,
--      status='beschikbaar'). Rolnummer: 'PH-{KWAL}-{KLEUR}'.
--   2. RPC rollen_uitwissel_voorraad() die per (onze_kwal, onze_kleur) de
--      beste uitwissel-kandidaat retourneert (meeste beschikbare m²) uit
--      kwaliteit_kleur_uitwisselgroepen. Frontend mergt dit op groepen waar
--      eigen voorraad 0 is, zodat de "Leverbaar via"-badge gerenderd kan worden.
--
-- Herhaalbaar: de INSERT gebruikt ON CONFLICT DO NOTHING op rolnummer; paren
-- die nu een matchend product krijgen, kunnen bij een tweede run worden
-- toegevoegd.

-- ────────────────────────────────────────────────────────────────────────
-- Deel 1: placeholder-rollen inserten
-- ────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_ingevoegd  INTEGER;
  v_geskipt    INTEGER;
BEGIN
  -- Paren zonder matchend producten-record: we loggen ze, we inserten ze niet
  -- (rollen.artikelnr is NOT NULL + FK). Na de run kun je handmatig bekijken.
  SELECT COUNT(*) INTO v_geskipt
  FROM maatwerk_m2_prijzen mp
  WHERE NOT EXISTS (
    SELECT 1 FROM rollen r
    WHERE r.kwaliteit_code = mp.kwaliteit_code
      AND r.kleur_code = mp.kleur_code
      AND r.status NOT IN ('verkocht', 'gesneden')
  )
  AND NOT EXISTS (
    SELECT 1 FROM producten pr
    WHERE pr.kwaliteit_code = mp.kwaliteit_code
      AND pr.kleur_code = mp.kleur_code
      AND pr.actief = true
  );

  INSERT INTO rollen (
    rolnummer,
    artikelnr,
    kwaliteit_code,
    kleur_code,
    lengte_cm,
    breedte_cm,
    oppervlak_m2,
    status,
    omschrijving
  )
  SELECT
    'PH-' || mp.kwaliteit_code || '-' || REPLACE(mp.kleur_code, '.0', '') AS rolnummer,
    p.artikelnr,
    mp.kwaliteit_code,
    mp.kleur_code,
    0,
    0,
    0,
    'beschikbaar',
    'Placeholder — geen eigen voorraad'
  FROM maatwerk_m2_prijzen mp
  CROSS JOIN LATERAL (
    SELECT pr.artikelnr
    FROM producten pr
    WHERE pr.kwaliteit_code = mp.kwaliteit_code
      AND pr.kleur_code = mp.kleur_code
      AND pr.actief = true
    ORDER BY (CASE WHEN pr.product_type = 'overig'         THEN 0
                   WHEN pr.karpi_code   ILIKE '%maatwerk%' THEN 1
                   WHEN pr.omschrijving ILIKE '%maatwerk%' THEN 2
                   ELSE 3 END),
             pr.artikelnr
    LIMIT 1
  ) p
  WHERE NOT EXISTS (
    SELECT 1 FROM rollen r
    WHERE r.kwaliteit_code = mp.kwaliteit_code
      AND r.kleur_code = mp.kleur_code
      AND r.status NOT IN ('verkocht', 'gesneden')
  )
  ON CONFLICT (rolnummer) DO NOTHING;

  GET DIAGNOSTICS v_ingevoegd = ROW_COUNT;

  RAISE NOTICE 'Placeholder-rollen: % ingevoegd, % geskipt (geen matchend actief product)',
    v_ingevoegd, v_geskipt;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- Deel 2: RPC rollen_uitwissel_voorraad
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rollen_uitwissel_voorraad()
RETURNS TABLE(
  kwaliteit_code       TEXT,
  kleur_code           TEXT,
  equiv_kwaliteit_code TEXT,
  equiv_kleur_code     TEXT,
  equiv_rollen         INTEGER,
  equiv_m2             NUMERIC
) AS $$
WITH
-- Voor elk (kwaliteit, kleur) in een uitwisselgroep: alle andere leden van
-- dezelfde groep (basis_code + variant_nr).
koppel AS (
  SELECT u1.kwaliteit_code AS onze_kwaliteit,
         u1.kleur_code     AS onze_kleur,
         u2.kwaliteit_code AS uit_kwaliteit,
         u2.kleur_code     AS uit_kleur
  FROM kwaliteit_kleur_uitwisselgroepen u1
  JOIN kwaliteit_kleur_uitwisselgroepen u2
    ON u2.basis_code = u1.basis_code
   AND u2.variant_nr = u1.variant_nr
   AND (u2.kwaliteit_code <> u1.kwaliteit_code OR u2.kleur_code <> u1.kleur_code)
),
-- Beschikbare m² en aantal rollen per uitwissel-lid (excl. placeholders).
agg AS (
  SELECT k.onze_kwaliteit,
         k.onze_kleur,
         k.uit_kwaliteit,
         k.uit_kleur,
         COUNT(r.id) FILTER (WHERE r.oppervlak_m2 > 0)::INTEGER          AS aantal,
         COALESCE(SUM(r.oppervlak_m2) FILTER (WHERE r.oppervlak_m2 > 0), 0)::NUMERIC AS m2
  FROM koppel k
  LEFT JOIN rollen r
    ON r.kwaliteit_code = k.uit_kwaliteit
   AND r.kleur_code = k.uit_kleur
   AND r.status = 'beschikbaar'
  GROUP BY k.onze_kwaliteit, k.onze_kleur, k.uit_kwaliteit, k.uit_kleur
)
SELECT DISTINCT ON (a.onze_kwaliteit, a.onze_kleur)
  a.onze_kwaliteit,
  a.onze_kleur,
  a.uit_kwaliteit,
  a.uit_kleur,
  a.aantal,
  a.m2
FROM agg a
WHERE a.aantal > 0
ORDER BY a.onze_kwaliteit, a.onze_kleur, a.m2 DESC, a.uit_kwaliteit;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION rollen_uitwissel_voorraad() IS
  'Voor elk (kwaliteit, kleur) in kwaliteit_kleur_uitwisselgroepen: beste '
  'uitwissel-kandidaat (meeste beschikbare m² in rollen met status=beschikbaar '
  'en oppervlak_m2>0). Gebruikt door Rollen & Reststukken-pagina om '
  '"Leverbaar via"-badge te tonen op groepen zonder eigen voorraad.';
```

- [ ] **Step 1.4: Apply migratie via Supabase MCP**

```
mcp__claude_ai_Supabase__apply_migration
  name: rollen_placeholder_maatwerk
  query: <inhoud van 110_rollen_placeholder_maatwerk.sql>
```

Verwacht: geen error. Supabase logt de `RAISE NOTICE` met aantal ingevoegd/geskipt.

- [ ] **Step 1.5: Verifieer de insert — CISC 15 heeft nu een placeholder**

```sql
SELECT id, rolnummer, kwaliteit_code, kleur_code, oppervlak_m2, status, omschrijving
FROM rollen
WHERE rolnummer = 'PH-CISC-15';
```

Verwacht: 1 rij. `oppervlak_m2 = 0`, `status = 'beschikbaar'`.

- [ ] **Step 1.6: Verifieer de RPC — CISC 15 heeft (bv.) CISC 16 als uitwissel**

```sql
SELECT * FROM rollen_uitwissel_voorraad()
WHERE kwaliteit_code = 'CISC' AND kleur_code IN ('15', '16');
```

Verwacht: als CISC 15 in een uitwisselgroep met een voorraad-houdende kwaliteit zit, zie je een rij met gevulde `equiv_*`. Anders 0 rijen voor CISC 15 (= geen badge).

- [ ] **Step 1.7: Verifieer rollen_stats cijfers**

```sql
SELECT * FROM rollen_stats();
```

Verwacht: `leeg_op` is gestegen met het aantal ingevoegde placeholders; `totaal` idem. Overige cijfers (`volle_rollen`, `aangebroken`, `reststukken`) ongewijzigd.

- [ ] **Step 1.8: Commit**

```bash
git add supabase/migrations/110_rollen_placeholder_maatwerk.sql
git commit -m "feat(rollen): placeholder-rollen voor maatwerk-paren + rollen_uitwissel_voorraad RPC"
```

---

## Task 2: `RolGroep` type uitbreiden

**Files:**
- Modify: `frontend/src/lib/types/productie.ts:195-205`

- [ ] **Step 2.1: Voeg equiv-velden toe**

Vervang het bestaande `RolGroep`-blok door:

```typescript
export interface RolGroep {
  kwaliteit_code: string
  kleur_code: string
  product_naam: string
  rollen: RolRow[]
  totaal_rollen: number
  totaal_m2: number
  volle_rollen: number
  aangebroken: number
  reststukken: number
  /** Beste uitwisselbare kwaliteit+kleur met beschikbare voorraad, NULL als er geen is. */
  equiv_kwaliteit_code: string | null
  equiv_kleur_code: string | null
  equiv_rollen: number
  equiv_m2: number
}
```

- [ ] **Step 2.2: TypeScript-check**

```bash
cd frontend && npx tsc --noEmit
```

Verwacht: compiler klaagt alleen op plekken waar `RolGroep` wordt *gebouwd* (niet gelezen). Dat is de to-do voor Task 3.

- [ ] **Step 2.3: Commit**

```bash
git add frontend/src/lib/types/productie.ts
git commit -m "feat(rollen): RolGroep uitgebreid met equiv-velden"
```

---

## Task 3: `fetchRollenGegroepeerd` mergt equiv-data

**Files:**
- Modify: `frontend/src/lib/supabase/queries/rollen.ts:99-170`

- [ ] **Step 3.1: Pas `fetchRollenGegroepeerd` aan**

Vervang de hele functie (inclusief de `buildQuery`-helper erin) door:

```typescript
interface UitwisselRow {
  kwaliteit_code: string
  kleur_code: string
  equiv_kwaliteit_code: string
  equiv_kleur_code: string
  equiv_rollen: number
  equiv_m2: number
}

/** Fetch rollen grouped by kwaliteit_code + kleur_code, met equiv-info
 *  op groepen zonder eigen voorraad (via rollen_uitwissel_voorraad RPC). */
export async function fetchRollenGegroepeerd(
  search?: string,
  kwaliteitFilter?: string,
  kleurFilter?: string,
): Promise<RolGroep[]> {
  const buildQuery = () => {
    let q = supabase
      .from('rollen')
      .select('*')
      .not('status', 'in', '("verkocht","gesneden")')
      .order('kwaliteit_code', { ascending: true })
      .order('kleur_code', { ascending: true })

    if (kwaliteitFilter) {
      q = q.eq('kwaliteit_code', kwaliteitFilter)
    }
    if (kleurFilter) {
      q = q.eq('kleur_code', kleurFilter.replace(/\.0+$/, ''))
    }
    if (search && !kwaliteitFilter) {
      const s = sanitizeSearch(search)
      if (s) {
        q = q.or(
          `rolnummer.ilike.%${s}%,kwaliteit_code.ilike.%${s}%,kleur_code.ilike.%${s}%,omschrijving.ilike.%${s}%`,
        )
      }
    }
    return q
  }

  const PAGE_SIZE = 1000
  const rows: RolRow[] = []
  let offset = 0
  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...(data as RolRow[]))
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  const groupMap = new Map<string, RolGroep>()
  for (const rol of rows) {
    const key = `${rol.kwaliteit_code}|${rol.kleur_code}`
    let group = groupMap.get(key)
    if (!group) {
      group = {
        kwaliteit_code: rol.kwaliteit_code,
        kleur_code: rol.kleur_code,
        product_naam: `${rol.kwaliteit_code} ${rol.kleur_code}`,
        rollen: [],
        totaal_rollen: 0,
        totaal_m2: 0,
        volle_rollen: 0,
        aangebroken: 0,
        reststukken: 0,
        equiv_kwaliteit_code: null,
        equiv_kleur_code: null,
        equiv_rollen: 0,
        equiv_m2: 0,
      }
      groupMap.set(key, group)
    }
    group.rollen.push(rol)
    group.totaal_rollen++
    group.totaal_m2 += Number(rol.oppervlak_m2) || 0
    if (rol.rol_type === 'volle_rol') group.volle_rollen++
    else if (rol.rol_type === 'aangebroken') group.aangebroken++
    else if (rol.rol_type === 'reststuk') group.reststukken++
  }

  // Uitwissel-info ophalen en mergen op groepen met totaal_m2 = 0
  const { data: uitwisselData, error: uitwisselError } = await supabase.rpc(
    'rollen_uitwissel_voorraad',
  )
  if (uitwisselError) throw uitwisselError

  const normKleur = (k: string) => k.replace(/\.0+$/, '')
  const uitwisselMap = new Map<string, UitwisselRow>()
  for (const row of (uitwisselData ?? []) as UitwisselRow[]) {
    const key = `${row.kwaliteit_code}|${normKleur(row.kleur_code)}`
    uitwisselMap.set(key, row)
  }

  for (const g of groupMap.values()) {
    if (g.totaal_m2 > 0) continue // alleen lege groepen krijgen equiv-info
    const key = `${g.kwaliteit_code}|${normKleur(g.kleur_code)}`
    const eq = uitwisselMap.get(key)
    if (!eq) continue
    g.equiv_kwaliteit_code = eq.equiv_kwaliteit_code
    g.equiv_kleur_code = normKleur(eq.equiv_kleur_code)
    g.equiv_rollen = Number(eq.equiv_rollen) || 0
    g.equiv_m2 = Number(eq.equiv_m2) || 0
  }

  return Array.from(groupMap.values())
}
```

- [ ] **Step 3.2: TypeScript-check**

```bash
cd frontend && npx tsc --noEmit
```

Verwacht: groen.

- [ ] **Step 3.3: Smoke-test — CISC 15 zichtbaar in UI**

`cd frontend && npm run dev`, open `/rollen`, zoek op `cisc 15`.

Verwacht: rij "CISC 15" is zichtbaar (dankzij placeholder-rol). Visueel nog ongewijzigd t.o.v. andere groepen — Task 4 maakt het gedimd + badge.

- [ ] **Step 3.4: Commit**

```bash
git add frontend/src/lib/supabase/queries/rollen.ts
git commit -m "feat(rollen): merge equiv-voorraad op lege groepen in fetchRollenGegroepeerd"
```

---

## Task 4: UI — grijze stijl + "Leverbaar via …"-badge

**Files:**
- Modify: `frontend/src/components/rollen/rollen-groep-row.tsx:233-290`

- [ ] **Step 4.1: Vervang `RollenGroepRow`-functie**

Vervang de `RollenGroepRow`-functie (regels 233-290) door:

```tsx
export function RollenGroepRow({ groep }: RollenGroepRowProps) {
  const [open, setOpen] = useState(false)

  const isEmpty = groep.totaal_m2 === 0
  const heeftEquiv = !!groep.equiv_kwaliteit_code && groep.equiv_rollen > 0

  const vollePct = groep.totaal_rollen > 0
    ? Math.round((groep.volle_rollen / groep.totaal_rollen) * 100)
    : 0

  return (
    <div
      className={cn(
        'bg-white rounded-[var(--radius)] border overflow-hidden',
        isEmpty ? 'border-slate-200/70' : 'border-slate-200',
      )}
    >
      <button
        onClick={() => !isEmpty && setOpen(!open)}
        disabled={isEmpty}
        className={cn(
          'w-full flex items-center justify-between px-4 py-3 text-left transition-colors',
          isEmpty ? 'cursor-default' : 'hover:bg-slate-50',
        )}
      >
        <div className="flex items-center gap-3 flex-wrap">
          {isEmpty ? (
            <span className="w-4" />
          ) : open ? (
            <ChevronDown size={16} className="text-slate-400" />
          ) : (
            <ChevronRight size={16} className="text-slate-400" />
          )}
          <span className={cn('font-medium', isEmpty ? 'text-slate-500' : 'text-slate-900')}>
            {groep.product_naam}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {isEmpty ? (
              heeftEquiv ? (
                <Link
                  to={`/rollen?kwaliteit=${encodeURIComponent(groep.equiv_kwaliteit_code!)}&kleur=${encodeURIComponent(groep.equiv_kleur_code ?? '')}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700 hover:bg-blue-100"
                >
                  Leverbaar via {groep.equiv_kwaliteit_code} {groep.equiv_kleur_code}
                  {' — '}
                  {groep.equiv_rollen} {groep.equiv_rollen === 1 ? 'rol' : 'rollen'}
                  {', '}
                  {groep.equiv_m2.toFixed(1)} m&sup2;
                </Link>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500">
                  Geen voorraad
                </span>
              )
            ) : (
              <>
                <StatusBadge rolType="volle_rol" count={groep.volle_rollen} />
                <StatusBadge rolType="aangebroken" count={groep.aangebroken} />
                <StatusBadge rolType="reststuk" count={groep.reststukken} />
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <span className="text-xs text-slate-500">
            {groep.totaal_rollen} {groep.totaal_rollen === 1 ? 'rol' : 'rollen'}
          </span>
          <div className="flex items-center gap-2 min-w-[140px]">
            <span
              className={cn(
                'text-sm font-medium whitespace-nowrap',
                isEmpty ? 'text-slate-400' : 'text-slate-700',
              )}
            >
              {groep.totaal_m2.toFixed(1)} m&sup2;
            </span>
            <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: `${vollePct}%` }}
              />
            </div>
          </div>
        </div>
      </button>

      {open && !isEmpty && (
        <div className="border-t border-slate-100 px-2 py-2">
          <RolTabel rollen={groep.rollen} />
        </div>
      )}
    </div>
  )
}
```

Opmerkingen:
- Dim-state bepaalt op `totaal_m2 === 0`, dus ook een groep met alleen reststukken van 0 m² (onwaarschijnlijk) zou dim worden. Als dat onbedoeld is: filter op `groep.rollen.every(r => Number(r.oppervlak_m2) === 0)`.
- De "Leverbaar via"-badge is een `<Link>` met `stopPropagation`. Als de URL-filter `?kleur=` nog niet wordt gelezen in [rollen-overview.tsx:15](frontend/src/pages/rollen/rollen-overview.tsx#L15) (kijk bij Step 4.2), is dat al voorzien — de parameter-reader staat er.

- [ ] **Step 4.2: Verifieer dat `?kleur=`-filter werkt**

Open [rollen-overview.tsx:15](frontend/src/pages/rollen/rollen-overview.tsx#L15). Check dat `kleurFilter = params.get('kleur') || undefined` wordt doorgegeven aan `useRollenGegroepeerd`. Ja: regel 23. Goed zo — `?kleur=X` filtert al.

- [ ] **Step 4.3: Smoke-test — UI-gedrag**

`cd frontend && npm run dev`, open `/rollen`.

Verwacht bij search op "cisc 15":
- Rij **CISC 15** zichtbaar, gedimd (lichtere border + grijze tekst).
- Geen chevron, klik doet niets.
- Blauwe badge "Leverbaar via CISC 16 — 3 rollen, 138.0 m²" (of vergelijkbaar, afhankelijk van live voorraad).
- Klik op badge: URL wordt `/rollen?kwaliteit=CISC&kleur=16`, filter-banner verschijnt, CISC 16 is expanded-ready.

Verwacht bij search op een kwaliteit met alleen eigen voorraad (bv. "cisc 21"):
- Gedrag onveranderd: chevron, uitklap, tabel werkt.

- [ ] **Step 4.4: Commit**

```bash
git add frontend/src/components/rollen/rollen-groep-row.tsx
git commit -m "feat(rollen): dim-state + Leverbaar-via-badge voor lege maatwerk-groepen"
```

---

## Task 5: Documentatie bijwerken

**Files:**
- Modify: `docs/database-schema.md` (Functies-sectie)
- Modify: `docs/changelog.md`

- [ ] **Step 5.1: Voeg RPC toe aan database-schema.md**

In `docs/database-schema.md`, sectie "Functies" (rond regel 709-715, onder `kleuren_voor_kwaliteit`): voeg toe:

```markdown
| `rollen_uitwissel_voorraad()` | Voor elk (kwaliteit, kleur) in `kwaliteit_kleur_uitwisselgroepen`: beste uitwissel-kandidaat (meeste beschikbare m² in rollen met `status=beschikbaar` en `oppervlak_m2>0`). Gebruikt door Rollen & Reststukken-pagina voor "Leverbaar via"-badge. |
```

- [ ] **Step 5.2: Changelog-entry**

In `docs/changelog.md` bovenaan (nieuwste-boven):

```markdown
### 2026-04-22 — Rollen-overzicht: placeholder-rollen voor ontbrekende maatwerk-paren

- **Wat:** "Rollen & Reststukken" toont nu álle maatwerk (kwaliteit, kleur) paren uit `maatwerk_m2_prijzen`, ook als er geen eigen voorraad is (bv. CISC 15). Lege groepen krijgen een "Leverbaar via [KWAL kleur] — N rollen, M m²"-badge wanneer `kwaliteit_kleur_uitwisselgroepen` een alternatief met voorraad aanwijst.
- **Waarom:** import van rollenvoorraad sloeg kwaliteiten zonder eigen voorraad over, waardoor leverbare maatwerk-varianten onzichtbaar waren.
- **Hoe:** migratie [110_rollen_placeholder_maatwerk.sql](../supabase/migrations/110_rollen_placeholder_maatwerk.sql) — (a) idempotente INSERT van placeholder-rollen (`rolnummer = 'PH-{KWAL}-{KLEUR}'`, `oppervlak_m2 = 0`, `status = 'beschikbaar'`), (b) RPC `rollen_uitwissel_voorraad()` voor equiv-info. Frontend `fetchRollenGegroepeerd` mergt equiv op lege groepen; `RollenGroepRow` toont dim-state + badge.
- **Impact:** `leeg_op` stat-card stijgt met het aantal ingevoegde placeholders. Overige cijfers ongewijzigd. Geen snijplanning-impact (oppervlak=0 is onbruikbaar maar geldig).
```

- [ ] **Step 5.3: Commit (docs)**

```bash
git add docs/database-schema.md docs/changelog.md
git commit -m "docs: 2026-04-22 placeholder-rollen + rollen_uitwissel_voorraad"
```

---

## Einde-verificatie

- [ ] `cd frontend && npx tsc --noEmit` — groen
- [ ] Pagina `/rollen` zonder filter: groep-count is duidelijk hoger dan vóór de migratie (alle maatwerk-paren zichtbaar).
- [ ] Zoek "cisc 15" → rij verschijnt, gedimd, met blauwe badge (of "Geen voorraad" als er echt geen alternatief is).
- [ ] Badge-klik navigeert naar `/rollen?kwaliteit=…&kleur=…` en filter-banner is actief.
- [ ] Stat-card "Leeg/Op" is gestegen met het aantal ingevoegde placeholders; "Totaal op voorraad" idem; "Volle/Aangebroken/Reststukken" ongewijzigd.
- [ ] Bestaande groepen met voorraad (bv. CISC 21) werken nog als voorheen (chevron, uitklap, rollen-tabel).

## Rollback-pad

- Migratie 110:
  - Data: `DELETE FROM rollen WHERE rolnummer LIKE 'PH-%';`
  - RPC: `DROP FUNCTION rollen_uitwissel_voorraad();`
- Frontend: `git revert` van de commits in Task 2-4.

## Out-of-scope (niet in dit plan)

- Maatwerk-paren die alleen in `producten` staan maar niet in `maatwerk_m2_prijzen`: follow-up zodra gesignaleerd.
- Paren zonder matchend `producten`-record: de migratie logt dit; handmatige aanmaak van artikelen is een losse taak.
- Automatisch refresh van placeholder-rollen als nieuwe `maatwerk_m2_prijzen`-rijen worden toegevoegd (nu: migratie opnieuw draaien, idempotent).
- Sorteren/filteren "alleen met voorraad" / "alleen zonder voorraad" in de UI.
