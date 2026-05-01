# Pick & Ship — Magazijn samenvoegen tot order-pickpagina

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voeg de sidebar-tabs "Magazijn" en "Pick & Ship" samen tot één pagina `/pick-ship` die per dag/week toont welke orders gepickt moeten worden, met locatie per stuk/rol.

**Architecture:** Vervang de stuks-georiënteerde Magazijn-pagina door een order-georiënteerde Pick & Ship-pagina. Data: query op snijplannen met status `Ingepakt` (uit view `snijplanning_overzicht`), gegroepeerd per orderregel → order, gebucketed per afleverdatum (Achterstallig / Vandaag / Morgen / Deze week / Volgende week / Later). Per order-card: alle te picken regels met scancode + locatie + maat + status. Locatie inline editeerbaar op het snijplan (`snijplannen.locatie`). DB-migratie voegt alleen `sp.locatie AS snijplan_locatie` toe aan de view (de bestaande `locatie`-alias is al `producten.locatie` voor voorraad-rollen — we voegen nu de magazijn-locatie van het ingepakte stuk toe). Sidebar consolideert tot één item. Oude magazijn-page/query/hook worden verwijderd.

**Tech Stack:** React + TypeScript + Vite, TanStack Query, Supabase (PostgreSQL view), TailwindCSS, shadcn/ui, Vitest.

---

## Context & Referenties

- Bestaande pagina (te vervangen): [magazijn-overview.tsx](frontend/src/pages/magazijn/magazijn-overview.tsx)
- Bestaande hook: [use-magazijn.ts](frontend/src/hooks/use-magazijn.ts)
- Bestaande query: [magazijn.ts](frontend/src/lib/supabase/queries/magazijn.ts)
- View die we uitbreiden: [143_snijplanning_overzicht_marge_geroteerd.sql](supabase/migrations/143_snijplanning_overzicht_marge_geroteerd.sql)
- Sidebar config: [constants.ts:91-147](frontend/src/lib/utils/constants.ts#L91-L147)
- Router: [router.tsx](frontend/src/router.tsx)
- Types-bestand voor productie/magazijn: [productie.ts:235-250](frontend/src/lib/types/productie.ts#L235-L250)
- Schema snijplannen: [database-schema.md:440-466](docs/database-schema.md#L440-L466) (kolom `locatie` = magazijnlocatie ingepakt stuk)
- Schema orders: [database-schema.md:261-285](docs/database-schema.md#L261-L285) (`afleverdatum`, `lever_modus`)
- Enums: [database-schema.md:809-810](docs/database-schema.md#L809-L810) (`order_status`, `snijplan_status='Ingepakt'`)
- Voorbeeldplan-stijl: [2026-04-22-rollen-overview-maatwerk-zonder-voorraad.md](docs/superpowers/plans/2026-04-22-rollen-overview-maatwerk-zonder-voorraad.md)
- Vitest-voorbeeld: [confectie-forward-planner.test.ts](frontend/src/lib/utils/__tests__/confectie-forward-planner.test.ts)

## Design-besluiten (vastgelegd)

1. **Eén route + één sidebar-item.** `/magazijn` verdwijnt als tab. Pad `/magazijn` blijft als HTTP-redirect bestaan naar `/pick-ship` zodat oude bookmarks/links blijven werken; de sidebar toont alleen "Pick & Ship" (icon `PackageCheck`, groep "Operationeel"). Het Magazijn-icoon (`Warehouse`) wordt niet meer gebruikt — geen aparte plek voor het "magazijn" als concept; de pickpagina toont per definitie wat in het magazijn ligt.

2. **Order-georiënteerd, niet stuk-georiënteerd.** De huidige Magazijn-tabel toont één rij per snijplan-stuk. De nieuwe pagina toont één **kaart per order**, met daarbinnen alle te-picken regels. Reden: een picker werkt per order, niet per stuk — alle stuks van een order moeten samen op de paklijst.

3. **Scope V1 = alleen op-maat snijplan-stuks (status `Ingepakt`).** Voorraad-orderregels (standaard rollen) blijven V2: die hebben geen "ingepakt"-moment in de data — ze worden direct uit voorraad gepickt. We tonen ze nog niet als pick-regels. Filter-pillen in de tabbalk dus alleen: `Alles` / `Vandaag` / `Morgen` / `Deze week` / `Volgende week` / `Later` / `Achterstallig`. Geen `Op maat` / `Standaard` filter — dat hoort op stukniveau, niet op orderniveau.

4. **Bucketing op `orders.afleverdatum`.** Bron is `o.afleverdatum` zoals al in `snijplanning_overzicht` zit. Buckets:
   - **Achterstallig** = `afleverdatum < vandaag`
   - **Vandaag** = `afleverdatum = vandaag`
   - **Morgen** = `afleverdatum = vandaag + 1`
   - **Deze week** = `afleverdatum > vandaag + 1` én ISO-week == ISO-week(vandaag)
   - **Volgende week** = ISO-week == ISO-week(vandaag) + 1
   - **Later** = alles erna
   - `afleverdatum IS NULL` → bucket "Geen datum" (apart kopje onderaan)

5. **Locatie-bron = `snijplannen.locatie`.** De huidige view aliast `producten.locatie AS locatie` (voor voorraad-rollen). Migratie 168 voegt **een nieuwe kolom** `snijplan_locatie` (`sp.locatie`) toe aan `snijplanning_overzicht` zonder de bestaande `locatie` te wijzigen — backward compat met snijplanning- en rol-uitvoer-modal. De Pick & Ship-pagina toont alleen `snijplan_locatie`.

6. **Locatie inline editeerbaar.** Klik-tap-zone op de regel: leeg → input verschijnt; gevuld → klik om aan te passen. Mutatie via directe `UPDATE snijplannen SET locatie = $1 WHERE id = $2`. Geen aparte RPC nodig — locatie is vrije tekst (zie schema-kolom-comment).

7. **Geen workflow-acties op order-niveau in V1.** Dus géén "markeer order verzonden", "print paklijst", "klaar voor verzending". Alleen viewer + locatie-bewerking. Dat opent de deur voor een latere V2 met zending-tabel-koppeling.

8. **Bestandsstructuur volgt RugFlow-conventie:** queries in `queries/`, hooks in `hooks/`, page in `pages/pick-ship/`, components in `components/pick-ship/`. Geen `modules/`-structuur — die wordt alleen voor EDI gebruikt; rest van het project zit nog niet op modules.

9. **Bestanden klein.** Mocht een component >250 regels worden, splitsen. Voor de page mikken we op <120 regels door order-card te extracten.

10. **Tests:** alleen pure logica (bucket-helper) krijgt unit-tests via Vitest. Geen tests voor Supabase-queries of React-components in V1 — dat is consistent met de rest van de codebase (zie test-bestand-glob: alleen pure helpers + EDI-formats hebben tests).

11. **Commits:** klein en frequent, direct naar de feature-branch. Conform `feedback_git_workflow.md`: na merge direct op main.

12. **Docs:** `docs/architectuur.md` (sectie "Operationele modules") en `docs/changelog.md` bijwerken na implementatie. `docs/database-schema.md` bijwerken voor de view-aanvulling.

---

## File Structure

### Create

- `supabase/migrations/168_snijplanning_overzicht_snijplan_locatie.sql` — voegt `sp.locatie AS snijplan_locatie` (positie 42) toe aan view.
- `frontend/src/lib/supabase/queries/pick-ship.ts` — `fetchPickShipOrders`, `fetchPickShipStats`, `updateSnijplanLocatie`.
- `frontend/src/hooks/use-pick-ship.ts` — `usePickShipOrders`, `usePickShipStats`, `useUpdateSnijplanLocatie`.
- `frontend/src/lib/utils/pick-ship-buckets.ts` — pure functie `bucketVoor(afleverdatum, vandaag) → BucketKey`, `LABEL_PER_BUCKET`.
- `frontend/src/lib/utils/__tests__/pick-ship-buckets.test.ts` — Vitest unit-tests.
- `frontend/src/lib/types/pick-ship.ts` — `PickShipRegel`, `PickShipOrder`, `BucketKey`, `BUCKET_VOLGORDE`.
- `frontend/src/components/pick-ship/order-pick-card.tsx` — kaart per order met regels-lijst.
- `frontend/src/components/pick-ship/locatie-edit.tsx` — inline-edit input voor `snijplannen.locatie`.
- `frontend/src/pages/pick-ship/pick-ship-overview.tsx` — pagina-component (stat cards + filter-tabs + gebucketede orderlijst).

### Modify

- `frontend/src/router.tsx` — `/magazijn` route → `<Navigate to="/pick-ship" replace />`; `/pick-ship` route → `<PickShipOverviewPage />` (i.p.v. `<PlaceholderPage>`).
- `frontend/src/lib/utils/constants.ts:117-126` — sidebargroep "Operationeel": vervang regels "Magazijn" + "Pick & Ship" door één regel `{ label: 'Pick & Ship', path: '/pick-ship', icon: 'PackageCheck' }`.
- `frontend/src/lib/types/productie.ts:235-250` — verwijder `MagazijnItem` interface (niet meer gebruikt).
- `docs/architectuur.md` — sectie "Operationele modules": vervang Magazijn + Pick & Ship door één Pick & Ship sectie (3-5 regels).
- `docs/database-schema.md:826-844` — view-tabel: regel `snijplanning_overzicht` aanvullen met "+ migratie 168: `snijplan_locatie`".
- `docs/changelog.md` — top-of-file entry voor 2026-05-01.

### Delete

- `frontend/src/pages/magazijn/magazijn-overview.tsx`
- `frontend/src/hooks/use-magazijn.ts`
- `frontend/src/lib/supabase/queries/magazijn.ts`

> Verifieer met `Grep` dat geen ander bestand `useMagazijn`, `MagazijnItem`, of `fetchMagazijn*` importeert vóór delete (zou alleen de drie te-verwijderen files mogen zijn — gecontroleerd, klopt op het moment van schrijven).

---

## Implementatie

### Task 1: DB-migratie — `snijplan_locatie` toevoegen aan view

**Files:**
- Create: `supabase/migrations/168_snijplanning_overzicht_snijplan_locatie.sql`

Karpi-MCP heeft géén toegang tot de productie-Supabase (zie memory `reference_karpi_supabase_mcp.md`). Migratie wordt handmatig toegepast door de gebruiker via de Supabase SQL editor. Het migratiebestand moet idempotent zijn.

- [ ] **Stap 1: Schrijf migratiebestand**

```sql
-- Migration 168: snijplanning_overzicht uitbreiden met snijplan_locatie
--
-- Context: Pick & Ship-pagina toont per ingepakt snijplan-stuk de magazijn-
-- locatie waar het ligt (snijplannen.locatie, vrije tekst bv. "A-12").
-- De huidige `locatie`-kolom in de view is `producten.locatie` (locatie van
-- voorraad-rollen) en blijft ongewijzigd voor backward compat met de rol-
-- uitvoer modal en snijplanning-pagina's.
--
-- Migratie 143 zette `marge_cm` op positie 41. We APPENDEN op positie 42.

CREATE OR REPLACE VIEW snijplanning_overzicht AS
SELECT
  sp.id,                                                                       -- 1
  sp.snijplan_nr,                                                              -- 2
  sp.scancode,                                                                 -- 3
  sp.status,                                                                   -- 4
  sp.rol_id,                                                                   -- 5
  sp.lengte_cm    AS snij_lengte_cm,                                           -- 6
  sp.breedte_cm   AS snij_breedte_cm,                                          -- 7
  sp.prioriteit,                                                               -- 8
  sp.planning_week,                                                            -- 9
  sp.planning_jaar,                                                            -- 10
  o.afleverdatum,                                                              -- 11
  sp.positie_x_cm,                                                             -- 12
  sp.positie_y_cm,                                                             -- 13
  sp.geroteerd,                                                                -- 14
  sp.gesneden_datum,                                                           -- 15
  sp.gesneden_op,                                                              -- 16
  sp.gesneden_door,                                                            -- 17
  r.rolnummer,                                                                 -- 18
  r.breedte_cm    AS rol_breedte_cm,                                           -- 19
  r.lengte_cm     AS rol_lengte_cm,                                            -- 20
  r.oppervlak_m2  AS rol_oppervlak_m2,                                         -- 21
  r.status        AS rol_status,                                               -- 22
  p.locatie       AS locatie,                                                  -- 23 (producten.locatie — voorraad)
  COALESCE(r.kwaliteit_code, p.kwaliteit_code, oreg.maatwerk_kwaliteit_code) AS kwaliteit_code,  -- 24
  COALESCE(r.kleur_code,     p.kleur_code,     oreg.maatwerk_kleur_code)     AS kleur_code,      -- 25
  oreg.artikelnr,                                                              -- 26
  p.omschrijving  AS product_omschrijving,                                     -- 27
  p.karpi_code,                                                                -- 28
  oreg.maatwerk_vorm,                                                          -- 29
  oreg.maatwerk_lengte_cm,                                                     -- 30
  oreg.maatwerk_breedte_cm,                                                    -- 31
  oreg.maatwerk_afwerking,                                                     -- 32
  oreg.maatwerk_band_kleur,                                                    -- 33
  oreg.maatwerk_instructies,                                                   -- 34
  oreg.orderaantal,                                                            -- 35
  oreg.id         AS order_regel_id,                                           -- 36
  o.id            AS order_id,                                                 -- 37
  o.order_nr,                                                                  -- 38
  o.debiteur_nr,                                                               -- 39
  d.naam          AS klant_naam,                                               -- 40
  stuk_snij_marge_cm(oreg.maatwerk_afwerking, oreg.maatwerk_vorm) AS marge_cm, -- 41
  sp.locatie      AS snijplan_locatie                                          -- 42 NIEUW
FROM snijplannen sp
JOIN order_regels oreg ON oreg.id = sp.order_regel_id
JOIN orders o          ON o.id = oreg.order_id
JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN producten p  ON p.artikelnr = oreg.artikelnr
LEFT JOIN rollen r     ON r.id = sp.rol_id;

COMMENT ON VIEW snijplanning_overzicht IS
  'Snijplanning-overzicht: snijplannen + rol + order_regels + order + klant. '
  'Migratie 143 voegt marge_cm toe. Migratie 168 voegt snijplan_locatie toe '
  '(sp.locatie = magazijnlocatie ingepakt stuk; los van locatie = '
  'producten.locatie voor voorraad).';
```

- [ ] **Stap 2: Toepassen migratie**

Karpi-MCP heeft geen toegang. Vraag de gebruiker de migratie via Supabase SQL Editor uit te voeren, of toepassen via lokale `supabase db push` wanneer een lokale dev-instance draait.

Verifieer in Supabase Studio:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'snijplanning_overzicht'
  AND column_name IN ('locatie', 'snijplan_locatie');
-- Verwacht: 2 rijen
```

- [ ] **Stap 3: Commit**

```bash
git add supabase/migrations/168_snijplanning_overzicht_snijplan_locatie.sql
git commit -m "feat(db): voeg snijplan_locatie toe aan snijplanning_overzicht view"
```

---

### Task 2: Domeintypes Pick & Ship

**Files:**
- Create: `frontend/src/lib/types/pick-ship.ts`

- [ ] **Stap 1: Schrijf types**

```ts
// frontend/src/lib/types/pick-ship.ts

export type BucketKey =
  | 'achterstallig'
  | 'vandaag'
  | 'morgen'
  | 'deze_week'
  | 'volgende_week'
  | 'later'
  | 'geen_datum'

export const BUCKET_VOLGORDE: BucketKey[] = [
  'achterstallig',
  'vandaag',
  'morgen',
  'deze_week',
  'volgende_week',
  'later',
  'geen_datum',
]

export const BUCKET_LABEL: Record<BucketKey, string> = {
  achterstallig: 'Achterstallig',
  vandaag: 'Vandaag',
  morgen: 'Morgen',
  deze_week: 'Deze week',
  volgende_week: 'Volgende week',
  later: 'Later',
  geen_datum: 'Geen datum',
}

export interface PickShipRegel {
  snijplan_id: number
  snijplan_nr: string
  scancode: string | null
  product: string
  kleur: string | null
  maat_cm: string
  m2: number
  status: string
  locatie: string | null
}

export interface PickShipOrder {
  order_id: number
  order_nr: string
  klant_naam: string
  debiteur_nr: number
  afl_naam: string | null
  afl_plaats: string | null
  afleverdatum: string | null // ISO YYYY-MM-DD
  bucket: BucketKey
  regels: PickShipRegel[]
  totaal_m2: number
  aantal_regels: number
}
```

- [ ] **Stap 2: Commit**

```bash
git add frontend/src/lib/types/pick-ship.ts
git commit -m "feat(pick-ship): voeg domein-types toe"
```

---

### Task 3: Bucket-helper + Vitest unit-tests (TDD)

**Files:**
- Create: `frontend/src/lib/utils/pick-ship-buckets.ts`
- Test: `frontend/src/lib/utils/__tests__/pick-ship-buckets.test.ts`

- [ ] **Stap 1: Schrijf falende tests eerst**

```ts
// frontend/src/lib/utils/__tests__/pick-ship-buckets.test.ts
import { describe, it, expect } from 'vitest'
import { bucketVoor } from '../pick-ship-buckets'

describe('bucketVoor', () => {
  // Vaste referentiedatum: woensdag 2026-05-06 (ISO-week 19, 2026)
  const vandaag = new Date('2026-05-06T12:00:00Z')

  it('NULL afleverdatum → geen_datum', () => {
    expect(bucketVoor(null, vandaag)).toBe('geen_datum')
  })

  it('afleverdatum gisteren → achterstallig', () => {
    expect(bucketVoor('2026-05-05', vandaag)).toBe('achterstallig')
  })

  it('afleverdatum vandaag → vandaag', () => {
    expect(bucketVoor('2026-05-06', vandaag)).toBe('vandaag')
  })

  it('afleverdatum morgen → morgen', () => {
    expect(bucketVoor('2026-05-07', vandaag)).toBe('morgen')
  })

  it('afleverdatum vrijdag deze week → deze_week', () => {
    expect(bucketVoor('2026-05-08', vandaag)).toBe('deze_week')
  })

  it('afleverdatum zondag deze week (einde ISO-week) → deze_week', () => {
    expect(bucketVoor('2026-05-10', vandaag)).toBe('deze_week')
  })

  it('afleverdatum maandag volgende week → volgende_week', () => {
    expect(bucketVoor('2026-05-11', vandaag)).toBe('volgende_week')
  })

  it('afleverdatum zondag volgende week → volgende_week', () => {
    expect(bucketVoor('2026-05-17', vandaag)).toBe('volgende_week')
  })

  it('afleverdatum over 2 weken → later', () => {
    expect(bucketVoor('2026-05-20', vandaag)).toBe('later')
  })

  it('jaarwisseling: vandaag = 2026-12-30 (wo, ISO-week 53), 2027-01-04 → volgende_week', () => {
    const jaarwissel = new Date('2026-12-30T12:00:00Z')
    expect(bucketVoor('2027-01-04', jaarwissel)).toBe('volgende_week')
  })
})
```

- [ ] **Stap 2: Run tests, verwacht falen**

```bash
cd frontend && npx vitest run src/lib/utils/__tests__/pick-ship-buckets.test.ts
```
Expected: FAIL — module bestaat nog niet.

- [ ] **Stap 3: Schrijf minimal implementatie**

```ts
// frontend/src/lib/utils/pick-ship-buckets.ts
import type { BucketKey } from '@/lib/types/pick-ship'

/** Geeft maandag van de ISO-week waarin `d` valt (lokale tijd, midnacht). */
function isoMaandag(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dag = x.getDay() // 0 = zo, 1 = ma, ..., 6 = za
  const offset = dag === 0 ? -6 : 1 - dag
  x.setDate(x.getDate() + offset)
  return x
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function diffDagen(a: Date, b: Date): number {
  const ms = startOfDay(a).getTime() - startOfDay(b).getTime()
  return Math.round(ms / 86_400_000)
}

/**
 * Bepaalt in welke pick-ship-bucket een afleverdatum valt t.o.v. vandaag.
 * - achterstallig: < vandaag
 * - vandaag: = vandaag
 * - morgen: = vandaag + 1
 * - deze_week: rest van ISO-week van vandaag
 * - volgende_week: ISO-week + 1
 * - later: alles erna
 * - geen_datum: NULL afleverdatum
 */
export function bucketVoor(
  afleverdatumIso: string | null,
  vandaag: Date = new Date()
): BucketKey {
  if (!afleverdatumIso) return 'geen_datum'
  const al = new Date(afleverdatumIso + 'T00:00:00')
  const v = startOfDay(vandaag)
  const d = diffDagen(al, v)
  if (d < 0) return 'achterstallig'
  if (d === 0) return 'vandaag'
  if (d === 1) return 'morgen'

  const maandagDezeWeek = isoMaandag(v)
  const maandagVolgendeWeek = new Date(maandagDezeWeek)
  maandagVolgendeWeek.setDate(maandagDezeWeek.getDate() + 7)
  const maandagOverVolgende = new Date(maandagDezeWeek)
  maandagOverVolgende.setDate(maandagDezeWeek.getDate() + 14)

  if (al < maandagVolgendeWeek) return 'deze_week'
  if (al < maandagOverVolgende) return 'volgende_week'
  return 'later'
}
```

- [ ] **Stap 4: Run tests, verwacht slagen**

```bash
cd frontend && npx vitest run src/lib/utils/__tests__/pick-ship-buckets.test.ts
```
Expected: PASS — 10 tests slagen.

- [ ] **Stap 5: Commit**

```bash
git add frontend/src/lib/utils/pick-ship-buckets.ts frontend/src/lib/utils/__tests__/pick-ship-buckets.test.ts
git commit -m "feat(pick-ship): bucket-helper + tests"
```

---

### Task 4: Supabase queries

**Files:**
- Create: `frontend/src/lib/supabase/queries/pick-ship.ts`

- [ ] **Stap 1: Schrijf query-module**

```ts
// frontend/src/lib/supabase/queries/pick-ship.ts
import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import { bucketVoor } from '@/lib/utils/pick-ship-buckets'
import type {
  BucketKey,
  PickShipOrder,
  PickShipRegel,
} from '@/lib/types/pick-ship'

export interface PickShipParams {
  /** Optioneel: alleen orders in dit bucket. `undefined` = alle. */
  bucket?: BucketKey
  search?: string
  vandaag?: Date
}

export interface PickShipStats {
  totaal_orders: number
  totaal_stuks: number
  totaal_m2: number
  per_bucket: Record<BucketKey, number>
}

/** Haalt alle ingepakte snijplan-stuks en groepeert ze per order. */
export async function fetchPickShipOrders(
  params: PickShipParams = {}
): Promise<PickShipOrder[]> {
  const { search, bucket, vandaag = new Date() } = params

  let query = supabase
    .from('snijplanning_overzicht')
    .select(
      'id, snijplan_nr, scancode, status, snij_lengte_cm, snij_breedte_cm, ' +
        'product_omschrijving, kleur_code, snijplan_locatie, ' +
        'order_id, order_nr, debiteur_nr, klant_naam, afleverdatum'
    )
    .eq('status', 'Ingepakt')
    .order('afleverdatum', { ascending: true, nullsFirst: false })

  if (search) {
    const s = sanitizeSearch(search)
    if (s) {
      query = query.or(
        `snijplan_nr.ilike.%${s}%,scancode.ilike.%${s}%,order_nr.ilike.%${s}%,klant_naam.ilike.%${s}%`
      )
    }
  }

  const { data, error } = await query
  if (error) throw error

  // Haal afl_naam/afl_plaats apart op (niet in view) — één extra query op orders.
  const orderIds = Array.from(new Set((data ?? []).map((r) => r.order_id as number)))
  let orderMeta = new Map<number, { afl_naam: string | null; afl_plaats: string | null }>()
  if (orderIds.length > 0) {
    const { data: ord, error: oerr } = await supabase
      .from('orders')
      .select('id, afl_naam, afl_plaats')
      .in('id', orderIds)
    if (oerr) throw oerr
    orderMeta = new Map(
      (ord ?? []).map((o) => [
        o.id as number,
        { afl_naam: (o.afl_naam as string) ?? null, afl_plaats: (o.afl_plaats as string) ?? null },
      ])
    )
  }

  // Groepeer per order
  const perOrder = new Map<number, PickShipOrder>()
  for (const row of data ?? []) {
    const orderId = row.order_id as number
    const lengte = Number(row.snij_lengte_cm) || 0
    const breedte = Number(row.snij_breedte_cm) || 0
    const m2 = Math.round(((lengte * breedte) / 10000) * 100) / 100

    const regel: PickShipRegel = {
      snijplan_id: row.id as number,
      snijplan_nr: row.snijplan_nr as string,
      scancode: (row.scancode as string) ?? null,
      product: (row.product_omschrijving as string) ?? '',
      kleur: (row.kleur_code as string) ?? null,
      maat_cm: `${lengte} x ${breedte}`,
      m2,
      status: row.status as string,
      locatie: (row.snijplan_locatie as string) ?? null,
    }

    let order = perOrder.get(orderId)
    if (!order) {
      const meta = orderMeta.get(orderId) ?? { afl_naam: null, afl_plaats: null }
      const afleverdatum = (row.afleverdatum as string) ?? null
      order = {
        order_id: orderId,
        order_nr: row.order_nr as string,
        klant_naam: row.klant_naam as string,
        debiteur_nr: row.debiteur_nr as number,
        afl_naam: meta.afl_naam,
        afl_plaats: meta.afl_plaats,
        afleverdatum,
        bucket: bucketVoor(afleverdatum, vandaag),
        regels: [],
        totaal_m2: 0,
        aantal_regels: 0,
      }
      perOrder.set(orderId, order)
    }
    order.regels.push(regel)
    order.totaal_m2 = Math.round((order.totaal_m2 + m2) * 100) / 100
    order.aantal_regels = order.regels.length
  }

  let result = Array.from(perOrder.values())
  if (bucket) result = result.filter((o) => o.bucket === bucket)
  return result
}

/** Aggregaten voor stat cards. */
export async function fetchPickShipStats(vandaag: Date = new Date()): Promise<PickShipStats> {
  const orders = await fetchPickShipOrders({ vandaag })
  const stats: PickShipStats = {
    totaal_orders: orders.length,
    totaal_stuks: orders.reduce((s, o) => s + o.aantal_regels, 0),
    totaal_m2: Math.round(orders.reduce((s, o) => s + o.totaal_m2, 0) * 100) / 100,
    per_bucket: {
      achterstallig: 0,
      vandaag: 0,
      morgen: 0,
      deze_week: 0,
      volgende_week: 0,
      later: 0,
      geen_datum: 0,
    },
  }
  for (const o of orders) stats.per_bucket[o.bucket] += 1
  return stats
}

/** Bewerk locatie van een snijplan-stuk. */
export async function updateSnijplanLocatie(
  snijplanId: number,
  locatie: string | null
): Promise<void> {
  const { error } = await supabase
    .from('snijplannen')
    .update({ locatie: locatie === '' ? null : locatie })
    .eq('id', snijplanId)
  if (error) throw error
}
```

- [ ] **Stap 2: Commit**

```bash
git add frontend/src/lib/supabase/queries/pick-ship.ts
git commit -m "feat(pick-ship): supabase queries voor orders/stats/locatie"
```

---

### Task 5: TanStack Query hooks

**Files:**
- Create: `frontend/src/hooks/use-pick-ship.ts`

- [ ] **Stap 1: Schrijf hooks**

```ts
// frontend/src/hooks/use-pick-ship.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchPickShipOrders,
  fetchPickShipStats,
  updateSnijplanLocatie,
  type PickShipParams,
} from '@/lib/supabase/queries/pick-ship'

export function usePickShipOrders(params: PickShipParams = {}) {
  return useQuery({
    queryKey: ['pick-ship', 'orders', params],
    queryFn: () => fetchPickShipOrders(params),
  })
}

export function usePickShipStats() {
  return useQuery({
    queryKey: ['pick-ship', 'stats'],
    queryFn: () => fetchPickShipStats(),
  })
}

export function useUpdateSnijplanLocatie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ snijplanId, locatie }: { snijplanId: number; locatie: string | null }) =>
      updateSnijplanLocatie(snijplanId, locatie),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
    },
  })
}
```

- [ ] **Stap 2: Commit**

```bash
git add frontend/src/hooks/use-pick-ship.ts
git commit -m "feat(pick-ship): TanStack Query hooks"
```

---

### Task 6: Locatie inline-edit component

**Files:**
- Create: `frontend/src/components/pick-ship/locatie-edit.tsx`

- [ ] **Stap 1: Schrijf component**

```tsx
// frontend/src/components/pick-ship/locatie-edit.tsx
import { useState } from 'react'
import { Check, X, Pencil } from 'lucide-react'
import { useUpdateSnijplanLocatie } from '@/hooks/use-pick-ship'

interface Props {
  snijplanId: number
  locatie: string | null
}

export function LocatieEdit({ snijplanId, locatie }: Props) {
  const [bewerken, setBewerken] = useState(false)
  const [waarde, setWaarde] = useState(locatie ?? '')
  const mut = useUpdateSnijplanLocatie()

  if (!bewerken) {
    if (locatie) {
      return (
        <button
          onClick={() => {
            setWaarde(locatie)
            setBewerken(true)
          }}
          className="inline-flex items-center gap-1 text-slate-700 hover:text-terracotta-600 group"
        >
          <span>{locatie}</span>
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
    await mut.mutateAsync({ snijplanId, locatie: waarde.trim() || null })
    setBewerken(false)
  }

  return (
    <div className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={waarde}
        onChange={(e) => setWaarde(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') opslaan()
          if (e.key === 'Escape') setBewerken(false)
        }}
        placeholder="A-12"
        className="w-20 px-1.5 py-0.5 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-terracotta-400"
      />
      <button
        onClick={opslaan}
        disabled={mut.isPending}
        className="text-emerald-600 hover:text-emerald-700"
      >
        <Check size={14} />
      </button>
      <button onClick={() => setBewerken(false)} className="text-slate-400 hover:text-slate-600">
        <X size={14} />
      </button>
    </div>
  )
}
```

- [ ] **Stap 2: Commit**

```bash
git add frontend/src/components/pick-ship/locatie-edit.tsx
git commit -m "feat(pick-ship): inline edit voor snijplan locatie"
```

---

### Task 7: Order pick-card component

**Files:**
- Create: `frontend/src/components/pick-ship/order-pick-card.tsx`

- [ ] **Stap 1: Schrijf component**

```tsx
// frontend/src/components/pick-ship/order-pick-card.tsx
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { LocatieEdit } from './locatie-edit'
import { formatDateNL } from '@/lib/utils/format'
import type { PickShipOrder } from '@/lib/types/pick-ship'

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
              → {order.afl_naam}
              {order.afl_plaats ? `, ${order.afl_plaats}` : ''}
            </div>
          )}
        </div>
        <div className="text-right text-sm">
          <div className="text-slate-700 font-medium">
            {order.afleverdatum ? formatDateNL(order.afleverdatum) : '—'}
          </div>
          <div className="text-xs text-slate-500">
            {order.aantal_regels} stuk{order.aantal_regels === 1 ? '' : 's'} · {order.totaal_m2.toFixed(2)} m²
          </div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
            <th className="py-1.5 px-3 font-medium">Sticker</th>
            <th className="py-1.5 px-3 font-medium">Product</th>
            <th className="py-1.5 px-3 font-medium">Maat (cm)</th>
            <th className="py-1.5 px-3 font-medium text-right">m²</th>
            <th className="py-1.5 px-3 font-medium">Locatie</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {order.regels.map((r) => (
            <tr key={r.snijplan_id} className="hover:bg-slate-50">
              <td className="py-2 px-3 font-mono text-xs">{r.scancode ?? r.snijplan_nr}</td>
              <td className="py-2 px-3">
                <span className="text-slate-700">{r.product}</span>
                {r.kleur && <span className="text-slate-400 ml-1 text-xs">({r.kleur})</span>}
              </td>
              <td className="py-2 px-3 text-slate-600">{r.maat_cm}</td>
              <td className="py-2 px-3 text-right">{r.m2.toFixed(2)}</td>
              <td className="py-2 px-3">
                <LocatieEdit snijplanId={r.snijplan_id} locatie={r.locatie} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

> Verifieer met `Grep "formatDateNL" frontend/src/lib/utils/format.ts` dat deze helper bestaat. Zo niet, gebruik dan `new Date(iso).toLocaleDateString('nl-NL')`.

- [ ] **Stap 2: Commit**

```bash
git add frontend/src/components/pick-ship/order-pick-card.tsx
git commit -m "feat(pick-ship): order pick-card component"
```

---

### Task 8: Pick & Ship overzichtspagina

**Files:**
- Create: `frontend/src/pages/pick-ship/pick-ship-overview.tsx`

- [ ] **Stap 1: Schrijf page**

```tsx
// frontend/src/pages/pick-ship/pick-ship-overview.tsx
import { useMemo, useState } from 'react'
import { Search, Package, AlertTriangle, Calendar } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrderPickCard } from '@/components/pick-ship/order-pick-card'
import { usePickShipOrders, usePickShipStats } from '@/hooks/use-pick-ship'
import { cn } from '@/lib/utils/cn'
import {
  BUCKET_LABEL,
  BUCKET_VOLGORDE,
  type BucketKey,
} from '@/lib/types/pick-ship'

type FilterTab = 'alles' | BucketKey

export function PickShipOverviewPage() {
  const [filter, setFilter] = useState<FilterTab>('alles')
  const [search, setSearch] = useState('')

  const { data: stats } = usePickShipStats()
  const { data: orders, isLoading } = usePickShipOrders({
    search: search || undefined,
  })

  const gefilterd = useMemo(() => {
    if (!orders) return []
    if (filter === 'alles') return orders
    return orders.filter((o) => o.bucket === filter)
  }, [orders, filter])

  const perBucket = useMemo(() => {
    const m = new Map<BucketKey, typeof gefilterd>()
    for (const k of BUCKET_VOLGORDE) m.set(k, [])
    for (const o of gefilterd) m.get(o.bucket)!.push(o)
    return m
  }, [gefilterd])

  const statCards = [
    {
      label: 'Te picken orders',
      value: stats?.totaal_orders ?? 0,
      icon: Package,
      color: 'text-teal-600',
    },
    {
      label: 'Achterstallig',
      value: stats?.per_bucket.achterstallig ?? 0,
      icon: AlertTriangle,
      color: 'text-rose-600',
    },
    {
      label: 'Vandaag + morgen',
      value: (stats?.per_bucket.vandaag ?? 0) + (stats?.per_bucket.morgen ?? 0),
      icon: Calendar,
      color: 'text-amber-600',
    },
  ]

  const tabs: { key: FilterTab; label: string; aantal: number }[] = [
    { key: 'alles', label: 'Alles', aantal: stats?.totaal_orders ?? 0 },
    ...BUCKET_VOLGORDE.map((k) => ({
      key: k,
      label: BUCKET_LABEL[k],
      aantal: stats?.per_bucket[k] ?? 0,
    })),
  ]

  return (
    <>
      <PageHeader
        title="Pick & Ship"
        description="Te picken orders — gegroepeerd op afleverdatum"
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon size={16} className={s.color} />
              <span className="text-sm text-slate-500">{s.label}</span>
            </div>
            <p className="text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => {
            const isActive = filter === t.key
            return (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-terracotta-500 text-white font-medium'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                )}
              >
                {t.label}
                <span
                  className={cn(
                    'text-xs px-1.5 py-0.5 rounded-full',
                    isActive ? 'bg-white/20' : 'bg-slate-200'
                  )}
                >
                  {t.aantal}
                </span>
              </button>
            )
          })}
        </div>
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op sticker, order, klant..."
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Pick & Ship laden...
        </div>
      ) : gefilterd.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Geen orders te picken
        </div>
      ) : filter !== 'alles' ? (
        <div className="space-y-3">
          {gefilterd.map((o) => (
            <OrderPickCard key={o.order_id} order={o} />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {BUCKET_VOLGORDE.map((bucket) => {
            const lijst = perBucket.get(bucket) ?? []
            if (lijst.length === 0) return null
            return (
              <section key={bucket}>
                <h3 className="text-sm font-semibold text-slate-700 mb-2 px-1">
                  {BUCKET_LABEL[bucket]}{' '}
                  <span className="text-slate-400 font-normal">({lijst.length})</span>
                </h3>
                <div className="space-y-3">
                  {lijst.map((o) => (
                    <OrderPickCard key={o.order_id} order={o} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
```

- [ ] **Stap 2: Commit**

```bash
git add frontend/src/pages/pick-ship/pick-ship-overview.tsx
git commit -m "feat(pick-ship): overzichtspagina met buckets en filters"
```

---

### Task 9: Sidebar consolideren

**Files:**
- Modify: `frontend/src/lib/utils/constants.ts`

- [ ] **Stap 1: Vervang twee items door één**

In [constants.ts:117-126](frontend/src/lib/utils/constants.ts#L117-L126), groep "Operationeel": vervang de twee aparte regels:

```ts
{ label: 'Magazijn', path: '/magazijn', icon: 'Warehouse' },
{ label: 'Pick & Ship', path: '/pick-ship', icon: 'PackageCheck' },
```

door één regel:

```ts
{ label: 'Pick & Ship', path: '/pick-ship', icon: 'PackageCheck' },
```

- [ ] **Stap 2: Commit**

```bash
git add frontend/src/lib/utils/constants.ts
git commit -m "feat(sidebar): consolideer Magazijn + Pick & Ship in één item"
```

---

### Task 10: Router aanpassen

**Files:**
- Modify: `frontend/src/router.tsx`

- [ ] **Stap 1: Update imports**

Verwijder import van `MagazijnOverviewPage`:

```diff
-import { MagazijnOverviewPage } from '@/pages/magazijn/magazijn-overview'
```

Voeg toe (naast bestaande imports):

```ts
import { Navigate } from 'react-router-dom'
import { PickShipOverviewPage } from '@/pages/pick-ship/pick-ship-overview'
```

- [ ] **Stap 2: Update routes**

Vervang regel 78:
```diff
-{ path: 'magazijn', element: <MagazijnOverviewPage /> },
+{ path: 'magazijn', element: <Navigate to="/pick-ship" replace /> },
```

Vervang regel 88:
```diff
-{ path: 'pick-ship', element: <PlaceholderPage title="Pick & Ship" /> },
+{ path: 'pick-ship', element: <PickShipOverviewPage /> },
```

- [ ] **Stap 3: Verifieer build**

```bash
cd frontend && npm run build
```
Expected: build slaagt zonder TypeScript-fouten.

- [ ] **Stap 4: Commit**

```bash
git add frontend/src/router.tsx
git commit -m "feat(router): /pick-ship live, /magazijn redirect"
```

---

### Task 11: Cleanup oude magazijn-files

**Files:**
- Delete: `frontend/src/pages/magazijn/magazijn-overview.tsx`
- Delete: `frontend/src/hooks/use-magazijn.ts`
- Delete: `frontend/src/lib/supabase/queries/magazijn.ts`
- Modify: `frontend/src/lib/types/productie.ts:235-250` — verwijder `MagazijnItem` interface

- [ ] **Stap 1: Verifieer dat niets nog naar deze symbols verwijst**

```bash
cd frontend && grep -rE "MagazijnItem|use-magazijn|fetchMagazijn|magazijn-overview" src/
```
Expected: alleen de drie te-verwijderen bestanden + `productie.ts:237` (definitie zelf).

- [ ] **Stap 2: Verwijder bestanden + interface**

Delete de drie bestanden. In `frontend/src/lib/types/productie.ts:235-250`, verwijder de hele `// === Magazijn types ===`-sectie incl. `MagazijnItem` interface.

- [ ] **Stap 3: Build-check**

```bash
cd frontend && npm run build
```
Expected: build slaagt.

- [ ] **Stap 4: Lege map opruimen**

```bash
cd frontend && rmdir src/pages/magazijn 2>/dev/null || true
```

- [ ] **Stap 5: Commit**

```bash
git add -A frontend/src/pages/magazijn frontend/src/hooks/use-magazijn.ts frontend/src/lib/supabase/queries/magazijn.ts frontend/src/lib/types/productie.ts
git commit -m "refactor: verwijder oude magazijn-pagina (vervangen door pick-ship)"
```

---

### Task 12: Documentatie bijwerken

**Files:**
- Modify: `docs/architectuur.md`
- Modify: `docs/database-schema.md`
- Modify: `docs/changelog.md`

- [ ] **Stap 1: Update `docs/architectuur.md`**

Zoek de sectie waar Magazijn / Pick & Ship beschreven worden (zo niet aanwezig: voeg een korte sectie toe in "Operationele modules"). Vervang door:

```markdown
### Pick & Ship
Order-georiënteerde pickpagina (`/pick-ship`). Bron: `snijplanning_overzicht` view, gefilterd op `status='Ingepakt'`. Stuks worden gegroepeerd per `order_id` en gebucketed op `orders.afleverdatum` (Achterstallig / Vandaag / Morgen / Deze week / Volgende week / Later / Geen datum). Per regel: scancode + product + maat + locatie (`snijplannen.locatie`, inline editeerbaar).
```

- [ ] **Stap 2: Update `docs/database-schema.md`**

In de View-tabel (regel ~833): voeg toe aan de toelichting van `snijplanning_overzicht`:
> Migratie 168 voegt `snijplan_locatie` (`sp.locatie`) toe — magazijnlocatie van het ingepakte stuk; los van `locatie` (= `producten.locatie` voor voorraad-rollen).

- [ ] **Stap 3: Update `docs/changelog.md`**

Voeg bovenaan toe (boven de meest recente entry):

```markdown
## 2026-05-01 — Pick & Ship samengevoegd met Magazijn
- Sidebar: "Magazijn" + "Pick & Ship" gecombineerd tot één item "Pick & Ship".
- Nieuwe order-pickpagina op `/pick-ship`: orders gegroepeerd per afleverdatum-bucket, locatie inline editeerbaar.
- Migratie 168: `snijplanning_overzicht` view uitgebreid met `snijplan_locatie`.
- Verwijderd: `pages/magazijn/`, `hooks/use-magazijn.ts`, `queries/magazijn.ts`, `MagazijnItem` type.
- `/magazijn` route blijft bestaan als redirect naar `/pick-ship`.
```

- [ ] **Stap 4: Commit**

```bash
git add docs/architectuur.md docs/database-schema.md docs/changelog.md
git commit -m "docs: pick-ship pagina + migratie 168"
```

---

### Task 13: Smoke test in browser

- [ ] **Stap 1: Start dev-server**

```bash
cd frontend && npm run dev
```

- [ ] **Stap 2: Verifieer in browser**

1. Open `http://localhost:5173`.
2. Sidebar → groep "Operationeel": **alleen** "Pick & Ship" zichtbaar (geen "Magazijn" meer).
3. Klik "Pick & Ship" → pagina laadt zonder errors in console.
4. Stat cards tonen aantallen (kunnen 0 zijn als er geen ingepakte snijplannen zijn).
5. Filter-tabs tonen elk een aantal-badge.
6. Als er ingepakte stuks zijn: order-cards verschijnen, gegroepeerd onder bucket-koppen.
7. Klik order-nr → opent order-detail.
8. Klik locatie-veld → input verschijnt, typ "TEST", druk Enter → waarde slaat op en is na refresh nog zichtbaar in DB (`SELECT id, locatie FROM snijplannen WHERE id = …`).
9. Bezoek `http://localhost:5173/magazijn` → redirect naar `/pick-ship`.

- [ ] **Stap 3: Documenteer eventuele follow-up**

Als de smoke test issues ontdekt die niet binnen-scope zijn (bv. ontbrekende voorraad-stukken, paklijst-print), noteer ze in een nieuw bestand `docs/superpowers/plans/2026-05-01-pick-ship-followups.md` of als TODO bovenin de page-component (één regel).

---

## Verificatie

Aan het eind moet gelden:
1. `npm run build` in `frontend/` slaagt zonder fouten.
2. `npx vitest run src/lib/utils/__tests__/pick-ship-buckets.test.ts` toont alle tests groen.
3. Sidebar toont één item "Pick & Ship" in groep "Operationeel".
4. `/pick-ship` rendert order-cards gegroepeerd per bucket.
5. `/magazijn` redirect naar `/pick-ship`.
6. `snijplanning_overzicht` view bevat kolom `snijplan_locatie` (productie-DB).
7. Locatie inline-edit persisteert naar `snijplannen.locatie`.
8. Geen import-errors of type-errors in TypeScript.
9. Documentatie up-to-date: changelog, architectuur, database-schema.

---

## Niet in scope (V2-backlog)

- Voorraad-orderregels (standaard rollen) als pick-regels weergeven — vereist nieuwe data-bron want een voorraad-rol heeft geen "Ingepakt"-moment.
- Paklijst-print per order.
- "Markeer als verzonden" knop + zending-tabel-koppeling.
- Multi-select / bulk-actie op orders.
- Routes/route-optimalisatie tussen locaties.
- Mobiele scan-flow (al deels gedekt door Scanstation).
- Filter op klant of regio.
- Sortering binnen bucket (bv. per locatie A→Z om looplijn te optimaliseren).
