# Dashboard KPI's — Voorraadwaarde (inkoop) + Omzet excl. verzendkosten — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pas de `dashboard_stats` view aan zodat `voorraadwaarde_inkoop` de som is van `waarde` over **alle** rollen in de database, en `voorraadwaarde_verkoop` de som is van `orders.totaal_bedrag` minus de verzendkosten-regels (`artikelnr = 'VERZEND'`).

**Architecture:** Een enkele nieuwe SQL-migratie `083_dashboard_stats_nieuwe_voorraadwaarden.sql` die de view herdefinieert. De frontend (`dashboard.ts` query + `dashboard.tsx` kaarten) blijft ongewijzigd — kolomnamen in de view behouden we, alleen de *betekenis* (en dus de SUM-formule) verandert. Geen code in TS/React hoeft aangepast.

**Tech Stack:** Supabase (PostgreSQL view), optionele verificatie via Supabase MCP / Studio SQL-editor. Documentatie in Markdown.

---

## Confirmation gate — BEVESTIG DEZE TWEE KEUZES VÓÓR UITVOERING

De rest van het plan hangt af van hoe je onderstaande twee vragen beantwoordt. Defaults hieronder volgen Miguel's letterlijke formulering; pas aan als de semantiek anders bedoeld is.

### Gate 1 — Welke rollen tellen mee voor `voorraadwaarde_inkoop`?
- **Default (letterlijk):** *alle* rollen, ongeacht `status` — inclusief `verkocht`, `gesneden`, `reststuk`, `gereserveerd`, `beschikbaar`.
- **Alternatief (fysiek aanwezig):** `status IN ('beschikbaar', 'gereserveerd', 'reststuk')` — verkochte/gesneden rollen zijn geen voorraad meer.
- **Risico bij default:** inkoopwaarde stijgt mee met historische verkopen en blijft groeien; "voorraad" is dan eigenlijk "cumulatief ooit-gekocht".

### Gate 2 — Welke orders tellen mee voor `voorraadwaarde_verkoop`?
- **Default:** alle orders **behalve** `status = 'Geannuleerd'`. Consistent met de bestaande view `klant_omzet_ytd` (zie [docs/2026-04-01-rugflow-erp-database-en-frontend.md:1589-1591](docs/2026-04-01-rugflow-erp-database-en-frontend.md#L1589-L1591)).
- **Alternatief (strikt letterlijk):** ALLE orders — dus ook geannuleerde. Vrijwel zeker niet bedoeld.

Als beide defaults akkoord zijn, begin bij Task 1.

---

## Geverifieerde aannames (geen gate nodig)

1. **Kolom `order_regels.bedrag` bestaat** — `NUMERIC(12,2)`, zie [docs/2026-04-01-rugflow-erp-database-en-frontend.md:1011](docs/2026-04-01-rugflow-erp-database-en-frontend.md#L1011).
2. **`orders.totaal_bedrag = SUM(order_regels.bedrag)`** via trigger `update_order_totalen()` ([regel 1054-1055](docs/2026-04-01-rugflow-erp-database-en-frontend.md#L1054-L1055)) — inclusief de VERZEND-regel. Daarom is de aftrek correct: (bruto-omzet uit `totaal_bedrag`) − (som van VERZEND-regels) = omzet excl. verzend.
3. **Verzendkosten-marker** = `order_regels.artikelnr = 'VERZEND'`. Zie [frontend/src/lib/constants/shipping.ts](frontend/src/lib/constants/shipping.ts) en changelog-entry van 2026-04-03.
4. **`gemiddelde_marge_pct`** blijft ongewijzigd (nog steeds gebaseerd op `beschikbare` rollen). De huidige margeformule wordt nonsensisch als we hem koppelen aan de nieuwe inkoop/verkoop definities, en Miguel heeft niet gevraagd die aan te passen. Flag: overweeg deze KPI later apart te herdefiniëren of van het dashboard te halen.
5. **Kolomnamen in view blijven gelijk** (`voorraadwaarde_inkoop`, `voorraadwaarde_verkoop`) om frontend-breek te vermijden. In [dashboard.tsx:42-44](frontend/src/pages/dashboard.tsx#L42-L44) staat het label "Voorraadwaarde (verkoop)" — dat dekt semantisch de lading niet meer (het is nu orderomzet excl. verzend). We hernoemen het label als laatste optionele taak; niet het kolomcontract.
6. **Alle 10 kolommen uit de originele view worden behouden** (aantal_producten, beschikbare_rollen, voorraadwaarde_inkoop, voorraadwaarde_verkoop, gemiddelde_marge_pct, open_orders, actie_vereist_orders, actieve_klanten, in_productie, actieve_collecties). Alleen de twee voorraadwaarde-formules wijzigen; de rest blijft byte-voor-byte gelijk (geverifieerd tegen [docs/2026-04-01-rugflow-erp-database-en-frontend.md:1546-1576](docs/2026-04-01-rugflow-erp-database-en-frontend.md#L1546-L1576)).

---

## File Structure

**Nieuw:**
- [supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql](supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql) — `CREATE OR REPLACE VIEW public.dashboard_stats` met nieuwe formules.

**Aangepast:**
- [docs/database-schema.md](docs/database-schema.md) — view-beschrijving updaten (sectie "Views").
- [docs/changelog.md](docs/changelog.md) — nieuwe entry bovenaan met datum 2026-04-17.
- (optioneel) [frontend/src/pages/dashboard.tsx:43](frontend/src/pages/dashboard.tsx#L43) — label "Voorraadwaarde (verkoop)" → "Omzet (excl. verzendkosten)".

**Onaangeroerd:**
- [frontend/src/lib/supabase/queries/dashboard.ts](frontend/src/lib/supabase/queries/dashboard.ts) — kolomnamen blijven gelijk.
- [frontend/src/hooks/use-dashboard.ts](frontend/src/hooks/use-dashboard.ts) — geen wijziging.

---

## Task 1: Nieuwe migratie — `dashboard_stats` view herdefiniëren

**Files:**
- Create: `supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql`

- [ ] **Step 0: Capture de huidige view-definitie + opties** (sanity check)

Voer in Supabase SQL-editor uit om te zien of er `security_invoker` of andere view-opties zijn die we moeten behouden:

```sql
-- View-definitie + opties tonen
SELECT pg_get_viewdef('public.dashboard_stats', true) AS definition;

SELECT c.relname, c.reloptions
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'dashboard_stats';
```

Noteer de output. Als `reloptions` niet-leeg is (bijv. `{security_invoker=true}`), moet de nieuwe DDL dezelfde opties opnieuw zetten via `ALTER VIEW ... SET (...)` direct na de `CREATE OR REPLACE VIEW`. Default (`reloptions IS NULL`): geen extra actie nodig, `CREATE OR REPLACE VIEW` behoudt bestaande grants automatisch.

- [ ] **Step 1: Maak de migratiefile**

Schrijf `supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql` met deze inhoud:

```sql
-- =============================================================
-- Migratie 083: dashboard_stats — nieuwe voorraadwaarden
-- =============================================================
-- voorraadwaarde_inkoop  = SUM(rollen.waarde) over ALLE rollen (alle statussen)
-- voorraadwaarde_verkoop = SUM(orders.totaal_bedrag) - SUM(order_regels.bedrag
--                          WHERE artikelnr = 'VERZEND'), excl. Geannuleerd.
-- gemiddelde_marge_pct   blijft ongewijzigd (gebaseerd op beschikbare rollen).
-- =============================================================

CREATE OR REPLACE VIEW public.dashboard_stats AS
SELECT
    -- Voorraad (aantallen ongewijzigd)
    (SELECT COUNT(*) FROM producten WHERE actief = true)                         AS aantal_producten,
    (SELECT COUNT(*) FROM rollen WHERE status = 'beschikbaar')                   AS beschikbare_rollen,

    -- NIEUW: som van waarde over ALLE rollen (ongeacht status)
    (SELECT COALESCE(SUM(waarde), 0) FROM rollen)                                AS voorraadwaarde_inkoop,

    -- NIEUW: totaal orderomzet minus verzendkosten, excl. geannuleerde orders
    (
        SELECT COALESCE(SUM(o.totaal_bedrag), 0)
                - COALESCE((
                    SELECT SUM(orl.bedrag)
                    FROM order_regels orl
                    JOIN orders o2 ON o2.id = orl.order_id
                    WHERE orl.artikelnr = 'VERZEND'
                      AND o2.status != 'Geannuleerd'
                  ), 0)
        FROM orders o
        WHERE o.status != 'Geannuleerd'
    )                                                                            AS voorraadwaarde_verkoop,

    -- Berekende marge (ONGEWIJZIGD; baseert op beschikbare rollen)
    CASE
        WHEN (SELECT SUM(oppervlak_m2 * vvp_m2) FROM rollen WHERE status = 'beschikbaar') > 0
        THEN ROUND(
            (1 - (SELECT SUM(waarde) FROM rollen WHERE status = 'beschikbaar')
                / (SELECT SUM(oppervlak_m2 * vvp_m2) FROM rollen WHERE status = 'beschikbaar')
            ) * 100, 1
        )
        ELSE 0
    END                                                                          AS gemiddelde_marge_pct,

    -- Orders
    (SELECT COUNT(*) FROM orders WHERE status NOT IN ('Verzonden', 'Geannuleerd')) AS open_orders,
    (SELECT COUNT(*) FROM orders WHERE status = 'Actie vereist')                   AS actie_vereist_orders,

    -- Klanten
    (SELECT COUNT(*) FROM debiteuren WHERE status = 'Actief')                      AS actieve_klanten,

    -- Productie
    (SELECT COUNT(*) FROM snijplannen WHERE status IN ('Gepland', 'In productie')) AS in_productie,

    -- Collecties
    (SELECT COUNT(*) FROM collecties WHERE actief = true)                          AS actieve_collecties;

COMMENT ON VIEW public.dashboard_stats IS
  'Dashboard KPI-view. voorraadwaarde_inkoop = SUM(rollen.waarde) over ALLE rollen. '
  'voorraadwaarde_verkoop = SUM(orders.totaal_bedrag) minus VERZEND-regels, excl. Geannuleerd.';
```

- [ ] **Step 2: Toepassen van de migratie via Supabase MCP**

Voer uit (gebruik de `wqzeevfobwauxkalagtn`-Karpi-Supabase; de MCP kent dit project niet direct — gebruik Studio SQL-editor of de [supabase CLI](supabase/migrations) als MCP hem niet ziet):

```bash
# Via Supabase CLI (indien gekoppeld):
npx supabase db push

# Of handmatig: plak de SQL in Studio SQL-editor en voer uit.
```

Verwacht: `CREATE VIEW` (1 row) zonder foutmeldingen.

- [ ] **Step 3: Verifieer nieuwe KPI-waarden**

Voer in SQL-editor uit:

```sql
SELECT voorraadwaarde_inkoop, voorraadwaarde_verkoop, gemiddelde_marge_pct
FROM dashboard_stats;
```

Verwacht: twee getallen in euro's die *hoger* zijn dan voorheen voor inkoop (want alle rollen i.p.v. alleen `beschikbaar`). Voor verkoop: een waarde die ongeveer overeenkomt met `SUM(totaal_bedrag)` over niet-geannuleerde orders minus de `VERZEND`-bedragen.

Cross-check query:

```sql
-- Verwachte verkoop-waarde
SELECT
  COALESCE(SUM(o.totaal_bedrag), 0) AS bruto_omzet,
  COALESCE((
    SELECT SUM(orl.bedrag)
    FROM order_regels orl
    JOIN orders o2 ON o2.id = orl.order_id
    WHERE orl.artikelnr = 'VERZEND' AND o2.status != 'Geannuleerd'
  ), 0) AS totaal_verzendkosten,
  COALESCE(SUM(o.totaal_bedrag), 0)
    - COALESCE((
        SELECT SUM(orl.bedrag) FROM order_regels orl
        JOIN orders o2 ON o2.id = orl.order_id
        WHERE orl.artikelnr = 'VERZEND' AND o2.status != 'Geannuleerd'
      ), 0) AS verwacht_voorraadwaarde_verkoop
FROM orders o
WHERE o.status != 'Geannuleerd';

-- Verwachte inkoop-waarde
SELECT COALESCE(SUM(waarde), 0) AS verwacht_voorraadwaarde_inkoop FROM rollen;
```

Vergelijk met wat `dashboard_stats` teruggeeft — moet exact matchen.

- [ ] **Step 3b: Bewijs dat `totaal_bedrag` VERZEND-regels bevat** (één orderserieel)

Dit verifieert de trigger-afhankelijkheid in aanname 2. Pak één niet-geannuleerde order met een VERZEND-regel:

```sql
SELECT
  o.id,
  o.order_nr,
  o.totaal_bedrag,
  (SELECT SUM(bedrag) FROM order_regels WHERE order_id = o.id) AS som_regels,
  (SELECT SUM(bedrag) FROM order_regels WHERE order_id = o.id AND artikelnr = 'VERZEND') AS verzend_regel_bedrag
FROM orders o
WHERE o.status != 'Geannuleerd'
  AND EXISTS (SELECT 1 FROM order_regels orl WHERE orl.order_id = o.id AND orl.artikelnr = 'VERZEND')
LIMIT 1;
```

Verwacht: `totaal_bedrag = som_regels` (binnen ±0.01 afrondingsmarge). Zo niet → STOP en onderzoek; de aftrek-logica klopt dan niet voor deze dataset.

- [ ] **Step 3c: Controleer de performance-relevante index**

```sql
SELECT indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'order_regels';
```

Verwacht: ten minste een index op `order_id` (`idx_order_regels_order`). Een index op `artikelnr` is niet vereist maar versnelt de VERZEND-filter op grote sets. Niet bloccerend voor deze migratie.

- [ ] **Step 4: Verifieer in de UI**

Start dev-server en ga naar het dashboard:

```bash
cd frontend && npm run dev
```

Navigeer naar `/` of `/dashboard`. Controleer:
- Kaart "Voorraadwaarde (inkoop)" toont het nieuwe (doorgaans hogere) bedrag.
- Kaart "Voorraadwaarde (verkoop)" toont de orderomzet minus verzendkosten.
- Geen console-errors, geen "…"-loader die blijft hangen.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql
git commit -m "feat(dashboard): voorraadwaarde (inkoop) over alle rollen + verkoop = orderomzet excl. verzendkosten"
```

---

## Task 2: Documentatie bijwerken

**Files:**
- Modify: `docs/database-schema.md` (view-sectie "dashboard_stats")
- Modify: `docs/changelog.md` (nieuwe entry bovenaan)

- [ ] **Step 1: Werk database-schema.md bij**

`dashboard_stats` komt in [docs/database-schema.md](docs/database-schema.md) **exact één keer** voor, op regel 664 (geverifieerd via grep). Vervang die regel 1-op-1 door:

```markdown
| dashboard_stats | Aggregaties: producten, rollen (aantal), **voorraadwaarde_inkoop = SUM(rollen.waarde) over alle rollen**, **voorraadwaarde_verkoop = SUM(orders.totaal_bedrag) - SUM(VERZEND-regels), excl. Geannuleerd**, marge (op beschikbare rollen), open orders, klanten |
```

Geen andere beschrijvingen elders in dit bestand — geen extra edits nodig.

- [ ] **Step 2: Voeg changelog-entry toe**

Plaats bovenaan [docs/changelog.md](docs/changelog.md), direct na de `# Changelog — RugFlow ERP`-titel, deze entry:

```markdown
### 2026-04-17 — Dashboard KPI's: voorraadwaarde (inkoop) over alle rollen + verkoop = orderomzet excl. verzend
- **Wat:** Nieuwe migratie [083_dashboard_stats_nieuwe_voorraadwaarden.sql](supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql) herdefinieert twee kolommen in `dashboard_stats`: `voorraadwaarde_inkoop` sommeert nu `rollen.waarde` over **alle** rollen (ongeacht status), en `voorraadwaarde_verkoop` is `SUM(orders.totaal_bedrag) - SUM(order_regels.bedrag WHERE artikelnr='VERZEND')` over niet-geannuleerde orders. Frontend ongewijzigd; dezelfde kolomnamen, andere betekenis.
- **Waarom:** De oorspronkelijke view rapporteerde alleen voorraadwaarden van rollen met `status='beschikbaar'` en gebruikte `oppervlak * vvp` als verkoopwaarde — beide geven een vertekend beeld. Miguel wil (a) inkoopwaarde van alle tapijten in de database zien en (b) de daadwerkelijke gerealiseerde orderomzet zonder verzendkosten.
- **Files:** [supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql](supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql), [docs/database-schema.md](docs/database-schema.md).
```

- [ ] **Step 3: JSDoc op de TypeScript-interface**

In [frontend/src/lib/supabase/queries/dashboard.ts](frontend/src/lib/supabase/queries/dashboard.ts) staat `DashboardStats`. Voeg kort boven de twee velden een comment toe zodat lezers snappen waarom de kolomnaam de lading niet meer dekt:

```ts
export interface DashboardStats {
  aantal_producten: number
  beschikbare_rollen: number
  /** SUM(rollen.waarde) over alle rollen (ongeacht status). Zie migratie 083. */
  voorraadwaarde_inkoop: number
  /** Orderomzet excl. verzendkosten: SUM(totaal_bedrag) − SUM(VERZEND-regels), excl. Geannuleerd. Zie migratie 083. */
  voorraadwaarde_verkoop: number
  // ...rest ongewijzigd
}
```

- [ ] **Step 4: Commit docs + TS-comment**

```bash
git add docs/database-schema.md docs/changelog.md frontend/src/lib/supabase/queries/dashboard.ts
git commit -m "docs: update dashboard_stats view-semantiek (inkoop/verkoop)"
```

---

## Task 3 (optioneel): Label-update op dashboard-kaart

**Files:**
- Modify: `frontend/src/pages/dashboard.tsx:43`

Alleen uitvoeren als Miguel het label wil veranderen; default: overslaan. Het woord "Voorraadwaarde" dekt de nieuwe waarde (orderomzet) niet.

- [ ] **Step 1: Pas het label aan**

In [frontend/src/pages/dashboard.tsx:43](frontend/src/pages/dashboard.tsx#L43) vervang:

```tsx
<StatCard
  label="Voorraadwaarde (verkoop)"
  value={statsLoading ? '...' : formatCurrency(stats?.voorraadwaarde_verkoop ?? 0)}
/>
```

door:

```tsx
<StatCard
  label="Omzet (excl. verzendkosten)"
  value={statsLoading ? '...' : formatCurrency(stats?.voorraadwaarde_verkoop ?? 0)}
/>
```

- [ ] **Step 2: Verifieer in browser**

Herlaad het dashboard — kaart toont nu "Omzet (excl. verzendkosten)".

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/dashboard.tsx
git commit -m "chore(dashboard): hernoem 'Voorraadwaarde (verkoop)' → 'Omzet (excl. verzendkosten)'"
```

---

## Verificatiematrix vóór afsluiten

| Check | Verwachte uitkomst |
|---|---|
| `SELECT voorraadwaarde_inkoop FROM dashboard_stats;` | ≈ `SELECT SUM(waarde) FROM rollen` |
| `SELECT voorraadwaarde_verkoop FROM dashboard_stats;` | ≈ `SUM(orders.totaal_bedrag) − SUM(VERZEND-regels)` (beide excl. Geannuleerd) |
| Dashboard toont geen 0 / NaN / lege waarde | Getallen renderen in €-formaat |
| Overige KPI's (open orders, actieve klanten, …) onveranderd | Dezelfde getallen als vóór migratie |
| `docs/database-schema.md` en `docs/changelog.md` bijgewerkt | Nieuwe beschrijving/entry zichtbaar |
