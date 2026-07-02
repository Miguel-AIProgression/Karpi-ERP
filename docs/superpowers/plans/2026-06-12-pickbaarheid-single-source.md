# Pickbaarheid Single-Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De view `orderregel_pickbaarheid` (+ nieuwe aggregaat-view `order_pickbaarheid`) wordt de enige plek waar pickbaarheid wordt afgeleid; de TS-laag filtert en groepeert alleen nog, en de stale contracttest (7/7 rood op main) pint weer het echte interface.

**Architecture:** Eén migratie (repo-nr 383) doet twee dingen: (1) `orderregel_pickbaarheid` v4 krijgt de generieke admin-pseudo-skip (ADR-0018, vervangt de 3× herhaalde TS VERZEND-skip én fixt de latente dropship-blokkade) + kolom `gewicht_kg`; (2) nieuwe view `order_pickbaarheid` levert het order-niveau-predicaat (`pick_ship_zichtbaar`, `alle_regels_pickbaar`) dat nu op twee TS-plekken wordt herafgeleid. Daarna wordt `pickbaarheid.ts` uitgedund (order-filter, VERZEND-skips, gewicht-query en dode fallback weg) en consumeert `start-pickrondes-button` het view-veld. De contracttest wordt éérst gerepareerd (groene baseline op huidige code) en beweegt daarna mee per slice.

**Tech Stack:** PostgreSQL views (Supabase), React/TypeScript, TanStack Query, Vitest (queue-based fake-Supabase).

---

## Bevindingen (verificatie van de review-vondst, 2026-06-12)

Alle drie de claims kloppen, plus één bonus:

1. **Dubbele afleiding.** De view ([mig 288](../../../supabase/migrations/288_orderregel_pickbaarheid_snijden_rang.sql), huidige definitie) leidt regel-niveau af (`is_pickbaar`, `wacht_op`, `bron`, locatie). De TS-laag leidt daarbovenop opnieuw af:
   - order-niveau-predicaat (alle regels pickbaar / ≥1 bij deelleveringen / geen regels) in [`pickbaarheid.ts:103-122`](../../../frontend/src/modules/magazijn/queries/pickbaarheid.ts) — **en nogmaals** in [`start-pickrondes-button.tsx:62-66`](../../../frontend/src/modules/logistiek/components/start-pickrondes-button.tsx);
   - VERZEND-skip 3× (`fetchPickbaarheidRegels`, `fetchFallbackOrderRegels`, `fetchTotaalGewichtPerOrder`);
   - een dode fallback (`fetchFallbackOrderRegels`, PGRST205-pad) die alle regels op `is_pickbaar=false` "afleidt".
   - Historisch bewijs van het twee-plekken-probleem: de mig 309/310-gates landden in view én TS en moesten op beide plekken weer teruggedraaid worden (frontend-filter + mig 316); de 1000-rows-cap-bug (91 van ~236 orders zichtbaar) was puur een TS-laag-artefact.
2. **Contracttest stale.** [`magazijn-pickbaarheid.contract.test.ts`](../../../frontend/src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts) queue't responses voor tabel `zendingen`, maar `fetchActievePickrondes` queryt sinds mig 242 `zending_orders` → de fake client reject → alle 7 scenario's falen pre-existing op main. Bevestigd door projectgeheugen én de comment in [`pickbaarheid-productie-only.test.ts:14-16`](../../../frontend/src/modules/magazijn/queries/__tests__/pickbaarheid-productie-only.test.ts).
3. **Bonus — latente dropship-blokkade.** De TS skipt alléén `VERZEND`; de view skipt helemaal geen pseudo-regels. `DROPSHIP-KLEIN`/`DROPSHIP-GROOT`-kostenregels (mig 353/370, `is_pseudo=TRUE`) krijgen géén voorraad-claims (allocator skipt admin-pseudo sinds mig 273) → in de view `is_pickbaar=false, wacht_op='inkoop'` → een dropship-order wordt nooit "alles pickbaar" en blijft uit Pick & Ship (of toont eeuwig "Wacht op inkoop" bij deelleveringen-klanten). Taak 8 verifieert dit op de live DB vóór en na de migratie.

**Buiten scope (bewust):** de dag-order-horizon (`werkdagMinN`, ADR 0014) blijft TS — die hangt af van de parameter `vandaag` en is een filter, geen afleiding. `start_pickronden` (SQL) leidt zelf geen pickbaarheid af (mig 373 is alleen de vervoerder-guard) — daar hoeft niets.

**Deploy-volgorde (kritiek):** na Taak 5 bestaat de PGRST205-fallback niet meer. **Mig 383 moet op de live DB staan vóórdat de frontend-bundel deployt**, anders faalt Pick & Ship hard i.p.v. stil. Zie Taak 8.

---

### Taak 0: Worktree + baseline

**Files:** geen wijzigingen, alleen omgeving.

- [ ] **Step 1: Maak worktree + branch** (projectafspraak: substantieel werk meteen in eigen worktree)

```powershell
git -C "c:\Users\migue\Documents\Karpi ERP" worktree add ..\karpi-pickbaarheid-single-source -b refactor/pickbaarheid-single-source
```

- [ ] **Step 2: Installeer frontend-dependencies in de worktree** (node_modules ontbreekt daar; in de hoofd-tree miste vitest ook al)

```powershell
Set-Location "c:\Users\migue\Documents\karpi-pickbaarheid-single-source\frontend"; npm install
```

- [ ] **Step 3: Baseline draaien** — verwacht: `pickbaarheid-productie-only.test.ts` groen, `magazijn-pickbaarheid.contract.test.ts` **7/7 rood** (pint de bevinding)

```powershell
npx vitest run src/modules/magazijn --reporter=basic
```

---

### Taak 1: Gedeelde fake-Supabase-testhelper extraheren

De productie-only-test heeft de betere fake (registreert én past `.eq`-filters toe). Extraheer die zodat beide testbestanden hem delen (DRY) en de contracttest-reparatie erop kan bouwen.

**Files:**
- Create: `frontend/src/modules/magazijn/__tests__/helpers/fake-supabase.ts`
- Modify: `frontend/src/modules/magazijn/queries/__tests__/pickbaarheid-productie-only.test.ts` (regels 20-80: lokale fake vervangen door import)

- [ ] **Step 1: Schrijf de helper**

```ts
// helpers/fake-supabase.ts — queue-based fake-Supabase voor magazijn-contracttests.
// Gedeeld door magazijn-pickbaarheid.contract.test.ts en
// pickbaarheid-productie-only.test.ts. Registreert toegepaste .eq-filters en
// past ze toe op array-data (PostgREST-simulatie). Embedded-resource-filters
// (kolomnaam met punt, bv. 'zendingen.status') worden NIET client-side
// toegepast — PostgREST filtert die server-side binnen de embed; de fixture
// moet zelf al gefilterde rijen aanleveren.

export type SupabaseResponse = {
  data: unknown
  error: { code?: string; message?: string } | null
}

const responses: Record<string, SupabaseResponse[]> = {}

/** Verzamelt per tabel de toegepaste `.eq(column, value)`-filters. */
export const appliedEqFilters: Record<string, Array<[string, unknown]>> = {}

export function queueResponse(table: string, response: SupabaseResponse) {
  if (!responses[table]) responses[table] = []
  responses[table].push(response)
}

export function resetQueues() {
  for (const k of Object.keys(responses)) delete responses[k]
  for (const k of Object.keys(appliedEqFilters)) delete appliedEqFilters[k]
}

function buildChain(table: string) {
  const eqFilters: Array<[string, unknown]> = []

  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      eqFilters.push([column, value])
      if (!appliedEqFilters[table]) appliedEqFilters[table] = []
      appliedEqFilters[table].push([column, value])
      return chain
    },
    neq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    update: () => chain,
    insert: () => chain,
    then: (
      resolve: (value: SupabaseResponse) => void,
      reject: (reason: unknown) => void
    ) => {
      const next = responses[table]?.shift()
      if (!next) {
        reject(new Error(`Geen response voor tabel "${table}" in test-queue`))
        return
      }
      const platteFilters = eqFilters.filter(([col]) => !col.includes('.'))
      if (next.error === null && Array.isArray(next.data) && platteFilters.length > 0) {
        const filtered = (next.data as Array<Record<string, unknown>>).filter((row) =>
          platteFilters.every(([col, val]) => row[col] === val)
        )
        resolve({ data: filtered, error: null })
        return
      }
      resolve(next)
    },
  }
  return chain
}

export const fakeSupabase = {
  from: (table: string) => buildChain(table),
  rpc: () => Promise.resolve({ data: 0, error: null }),
}
```

- [ ] **Step 2: Laat `pickbaarheid-productie-only.test.ts` de helper importeren** — verwijder de lokale `responses`/`appliedEqFilters`/`queueResponse`/`buildChain`/`fakeSupabase`-definities (regels ~24-80) en vervang door:

```ts
import {
  fakeSupabase,
  queueResponse,
  resetQueues,
  appliedEqFilters,
} from '../../__tests__/helpers/fake-supabase'
```

En vervang de bestaande `beforeEach`-opruimlogica door `beforeEach(() => resetQueues())`. De `vi.mock('@/lib/supabase/client', ...)`-regel blijft in het testbestand zelf staan (vi.mock hoist per bestand).

- [ ] **Step 3: Run — productie-only blijft groen**

```powershell
npx vitest run src/modules/magazijn/queries/__tests__/pickbaarheid-productie-only.test.ts --reporter=basic
```

Verwacht: PASS (alle tests).

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/modules/magazijn/__tests__/helpers/fake-supabase.ts frontend/src/modules/magazijn/queries/__tests__/pickbaarheid-productie-only.test.ts
git commit -m "test(magazijn): extraheer gedeelde fake-supabase-testhelper"
```

---

### Taak 2: Contracttest repareren — groene baseline op huidige code

Minimale reparatie: het mockt het verkeerde tabel-pad. `fetchActievePickrondes` queryt `zending_orders` (M2M, mig 242), de test queue't `zendingen`. Eerst groen krijgen op de HUIDIGE code, zodat de refactor straks tegen een werkende pin beweegt.

**Files:**
- Modify: `frontend/src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts`

- [ ] **Step 1: Vervang de lokale fake door de helper** (regels 17-67): verwijder `responses`/`queueResponse`/`buildChain`/`fakeSupabase` en importeer uit `./helpers/fake-supabase` (zelfde patroon als Taak 1 Step 2, incl. `beforeEach(() => resetQueues())`). De `vi.mock(...)`-regel en de `await import(...)`-truc blijven staan.

- [ ] **Step 2: Maak de fixture helper-compatibel.** De gedeelde helper past `.eq`-filters toe op array-data, en `fetchOpenOrderHeaders` filtert `.eq('alleen_productie', false)` (R1-guard, mig 345). De `makeOrderHeader`-factory in de contracttest mist dat veld → `undefined !== false` → álle headers zouden weggefilterd worden. Voeg toe aan de factory-defaults (regels ~127-138):

```ts
    afhalen: false,
    lever_type: 'week' as const,
    alleen_productie: false,   // ← nieuw: R1-guard-veld, helper filtert hierop
    ...overrides,
```

- [ ] **Step 3: Hernoem in alle 7 scenario's de queue-regel** —

```ts
// OUD (7×):
queueResponse('zendingen', { data: [], error: null })
// NIEUW (7×):
queueResponse('zending_orders', { data: [], error: null })
```

Pas ook de comment bij scenario 1 aan: `// Mig 242: actieve Pickrondes per order via zending_orders M2M. Leeg = geen lopende pickronde.`

- [ ] **Step 4: Run — verwacht 7/7 groen**

```powershell
npx vitest run src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts --reporter=basic
```

Verwacht: PASS 7/7. Faalt er iets anders, dan eerst dáár kijken — niet doorbouwen op rood.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts
git commit -m "test(magazijn): repareer stale contracttest — mock zending_orders i.p.v. zendingen (7/7 rood op main)"
```

---

### Taak 3: Migratie 383 — view v4 + order-aggregaat-view

**Files:**
- Create: `supabase/migrations/383_pickbaarheid_single_source.sql`

- [ ] **Step 1: Controleer het eerstvolgende vrije repo-migratienummer** (projectgeheugen: nummer-collisies bij parallelle sessies — her-verifieer vlak vóór merge nogmaals)

```powershell
Get-ChildItem "supabase\migrations" | Sort-Object Name | Select-Object -Last 3 -ExpandProperty Name
```

Verwacht: `382_order_documenten_xml_mime.sql` als hoogste → repo-nummer 383. NB: het DB-nummer kan afwijken (repo 379-382 = DB 378-381); bij apply het eerstvolgende vrije DB-nummer gebruiken.

- [ ] **Step 2: Schrijf de migratie** — volledige inhoud:

```sql
-- Migratie 383: pickbaarheid single-source (consolidatie-review 2026-06-12)
--
-- Probleem: de pickbaarheids-afleiding leefde op drie plekken — de view
-- orderregel_pickbaarheid (regel-niveau, mig 170/288), fetchPickShipOrders
-- (order-niveau-predicaat + VERZEND-skip ×3 in TS) en isPickbaar() in
-- start-pickrondes-button (order-niveau nóg eens). Business-rule-wijzigingen
-- moesten op meerdere plekken landen (zie de mig 309/310→316 gate-omkering)
-- en de TS-laag introduceerde eigen bugs (1000-rows-cap, juni 2026).
--
-- Deel 1 — orderregel_pickbaarheid v4 (CREATE OR REPLACE):
--   a. Generieke admin-pseudo-skip (ADR-0018): WHERE NOT is_admin_pseudo(...).
--      Vervangt de VERZEND-specifieke .neq()-skip in TS én fixt een latente
--      bug: DROPSHIP-KLEIN/-GROOT-kostenregels (mig 353, is_pseudo=TRUE)
--      krijgen geen voorraad-claims (allocator skipt pseudo, mig 273) en
--      stonden dus als is_pickbaar=false / wacht_op='inkoop' in de view,
--      waardoor dropship-orders nooit "alles pickbaar" werden.
--   b. Nieuwe kolom gewicht_kg (achteraan — OR REPLACE eist bestaande
--      kolommen op hun plek): maakt de aparte gewicht-query in TS overbodig.
--   Verder identiek aan mig 288 (incl. de 'Snijden'-rang-fix).
--
-- Deel 2 — nieuwe view order_pickbaarheid: het order-niveau-predicaat als
--   data. pick_ship_zichtbaar = (alle regels pickbaar) OR (klant staat
--   deelleveringen toe AND >= 1 regel pickbaar). Orders zonder (niet-pseudo)
--   regels hebben geen rij — afwezigheid = niets te picken. De dag-order-
--   horizon (ADR 0014) blijft bewust client-side: die hangt af van 'vandaag'.

CREATE OR REPLACE VIEW orderregel_pickbaarheid AS
WITH maatwerk_aggr AS (
  SELECT
    sp.order_regel_id,
    COUNT(*)                                          AS totaal_stuks,
    COUNT(*) FILTER (WHERE sp.status = 'Ingepakt')    AS pickbaar_stuks,
    MIN(sp.locatie) FILTER (WHERE sp.status = 'Ingepakt') AS locatie,
    MIN(
      CASE sp.status
        WHEN 'Wacht'        THEN 1
        WHEN 'Gepland'      THEN 2
        WHEN 'Snijden'      THEN 2
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
  CASE
    WHEN oreg.is_maatwerk THEN
      COALESCE(ma.pickbaar_stuks = ma.totaal_stuks AND ma.totaal_stuks > 0, false)
    ELSE
      COALESCE(vc.aantal_actief > 0, false)
  END AS is_pickbaar,
  CASE
    WHEN oreg.is_maatwerk         THEN 'snijplan'
    WHEN rl.code IS NOT NULL      THEN 'rol'
    WHEN p.locatie IS NOT NULL    THEN 'producten_default'
    ELSE NULL
  END AS bron,
  CASE
    WHEN oreg.is_maatwerk THEN ma.locatie
    ELSE COALESCE(rl.code, p.locatie)
  END AS fysieke_locatie,
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
  END AS wacht_op,
  oreg.gewicht_kg
FROM order_regels oreg
JOIN orders o            ON o.id = oreg.order_id
LEFT JOIN producten p    ON p.artikelnr = oreg.artikelnr
LEFT JOIN maatwerk_aggr ma   ON ma.order_regel_id = oreg.id
LEFT JOIN voorraad_claim vc  ON vc.order_regel_id = oreg.id
LEFT JOIN rol_locatie_per_artikel rl ON rl.artikelnr = oreg.artikelnr
WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
  AND NOT is_admin_pseudo(oreg.artikelnr);

COMMENT ON VIEW orderregel_pickbaarheid IS
  'Per orderregel: is_pickbaar, fysieke_locatie, bron (snijplan|rol|producten_default), '
  'wacht_op (snijden|confectie|inpak|inkoop|null), gewicht_kg. Verenigt maatwerk- en '
  'standaard-paden. Mig 170; mig 288: ''Snijden''-rang; mig 383: admin-pseudo-regels '
  '(ADR-0018, o.a. VERZEND en DROPSHIP-*) uitgesloten + gewicht_kg toegevoegd — '
  'single source voor Pick & Ship, de TS-laag leidt niets meer af.';

CREATE VIEW order_pickbaarheid AS
SELECT
  op.order_id,
  COUNT(*)::int                                        AS totaal_regels,
  (COUNT(*) FILTER (WHERE op.is_pickbaar))::int        AS pickbare_regels,
  COUNT(*) FILTER (WHERE op.is_pickbaar) = COUNT(*)    AS alle_regels_pickbaar,
  COUNT(*) FILTER (WHERE op.is_pickbaar) > 0           AS heeft_pickbare_regel,
  COALESCE(d.deelleveringen_toegestaan, FALSE)         AS deelleveringen_toegestaan,
  (
    COUNT(*) FILTER (WHERE op.is_pickbaar) = COUNT(*)
    OR (
      COALESCE(d.deelleveringen_toegestaan, FALSE)
      AND COUNT(*) FILTER (WHERE op.is_pickbaar) > 0
    )
  ) AS pick_ship_zichtbaar
FROM orderregel_pickbaarheid op
JOIN orders o        ON o.id = op.order_id
LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
GROUP BY op.order_id, d.deelleveringen_toegestaan;

COMMENT ON VIEW order_pickbaarheid IS
  'Order-niveau-pickbaarheid (mig 383), aggregaat over orderregel_pickbaarheid. '
  'pick_ship_zichtbaar = alle regels pickbaar OF (deelleveringen toegestaan EN '
  '>=1 pickbaar). Geen rij = geen (niet-pseudo) regels = niets te picken. '
  'Single source voor het Pick & Ship-orderfilter en de pick-start-knop; '
  'alleen de dag-order-horizon (ADR 0014) blijft client-side.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Commit** (apply op live DB gebeurt pas in Taak 8 — vóór frontend-deploy)

```powershell
git add supabase/migrations/383_pickbaarheid_single_source.sql
git commit -m "feat(magazijn): mig 383 — pickbaarheid single-source: pseudo-skip + gewicht in regel-view, nieuwe order_pickbaarheid-view"
```

---

### Taak 4: TS — order-filter uit de view consumeren

**Files:**
- Modify: `frontend/src/modules/magazijn/queries/pickbaarheid.ts` (fetchPickShipOrders regels 49-127, fetchOpenOrderHeaders regels 129-185)
- Modify: `frontend/src/modules/magazijn/queries/pick-ship-transform.ts` (OrderHeaderRij regels 35-61, nieuw type)
- Modify: `frontend/src/modules/magazijn/lib/types.ts` (PickShipOrder)
- Test: `frontend/src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts`

- [ ] **Step 1: Breid de contracttest uit (rood eerst)** — voeg een fixture-factory toe en queue per scenario een `order_pickbaarheid`-response. Factory bovenin bij de andere factories:

```ts
function makeOrderPickbaarheidRow(overrides: Partial<{
  order_id: number
  totaal_regels: number
  pickbare_regels: number
  alle_regels_pickbaar: boolean
  heeft_pickbare_regel: boolean
  deelleveringen_toegestaan: boolean
  pick_ship_zichtbaar: boolean
}> = {}) {
  return {
    order_id: 100,
    totaal_regels: 1,
    pickbare_regels: 1,
    alle_regels_pickbaar: true,
    heeft_pickbare_regel: true,
    deelleveringen_toegestaan: false,
    pick_ship_zichtbaar: true,
    ...overrides,
  }
}
```

Per scenario, direct ná de `orderregel_pickbaarheid`-queue:

```ts
// Scenario 1 (gemengd, deelleveringen=true → zichtbaar via deellevering):
queueResponse('order_pickbaarheid', {
  data: [makeOrderPickbaarheidRow({
    totaal_regels: 2, pickbare_regels: 1, alle_regels_pickbaar: false,
    heeft_pickbare_regel: true, deelleveringen_toegestaan: true, pick_ship_zichtbaar: true,
  })],
  error: null,
})
// Scenario 2 en 4 (geen regels → geen rij):
queueResponse('order_pickbaarheid', { data: [], error: null })
// Scenario 3 (fallback-pad, vervalt in Taak 5 — voor nu): geen extra queue nodig
// zolang de fallback vóór de order_pickbaarheid-fetch faalt; queue voor de
// zekerheid wél een lege response zodat de FIFO klopt:
queueResponse('order_pickbaarheid', { data: [], error: null })
// Scenario 5 (onpickbaar + geen deelleveringen):
queueResponse('order_pickbaarheid', {
  data: [makeOrderPickbaarheidRow({
    totaal_regels: 2, pickbare_regels: 1, alle_regels_pickbaar: false,
    heeft_pickbare_regel: true, deelleveringen_toegestaan: false, pick_ship_zichtbaar: false,
  })],
  error: null,
})
// Scenario 6 (alles wacht + deelleveringen):
queueResponse('order_pickbaarheid', {
  data: [makeOrderPickbaarheidRow({
    totaal_regels: 1, pickbare_regels: 0, alle_regels_pickbaar: false,
    heeft_pickbare_regel: false, deelleveringen_toegestaan: true, pick_ship_zichtbaar: false,
  })],
  error: null,
})
// Scenario 7 (wacht op inkoop, geen deelleveringen):
queueResponse('order_pickbaarheid', {
  data: [makeOrderPickbaarheidRow({
    totaal_regels: 1, pickbare_regels: 0, alle_regels_pickbaar: false,
    heeft_pickbare_regel: false, deelleveringen_toegestaan: false, pick_ship_zichtbaar: false,
  })],
  error: null,
})
```

Voeg in scenario 1 ook een assert op het nieuwe order-veld toe:

```ts
expect(order.alle_regels_pickbaar).toBe(false)
```

**Ook `pickbaarheid-productie-only.test.ts` raakt dit:** de tweede test ("geeft een order met alleen_productie=true NIET terug") roept `fetchPickShipOrders` aan en heeft na deze taak een `order_pickbaarheid`-queue nodig. Voeg toe direct ná de `orderregel_pickbaarheid`-queue (regel ~201):

```ts
// Mig 383: order-niveau-predicaat uit view order_pickbaarheid. Alleen order
// 100 — order 200 is door de R1-guard al SQL-zijde weggefilterd.
queueResponse('order_pickbaarheid', {
  data: [{
    order_id: 100,
    totaal_regels: 1,
    pickbare_regels: 1,
    alle_regels_pickbaar: true,
    heeft_pickbare_regel: true,
    deelleveringen_toegestaan: false,
    pick_ship_zichtbaar: true,
  }],
  error: null,
})
```

(De eerste test in dat bestand queue't `orders` als `[]` → early return → geen verdere queues nodig.)

- [ ] **Step 2: Run — verwacht rood** (huidige code queryt `order_pickbaarheid` nog niet; minimaal de nieuwe assert faalt)

```powershell
npx vitest run src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts --reporter=basic
```

- [ ] **Step 3: Implementeer.** In `pick-ship-transform.ts`, naast `PickbaarheidRij`:

```ts
/** Rij uit view `order_pickbaarheid` (mig 383): het order-niveau-predicaat.
 *  Geen rij voor een order = geen (niet-pseudo) regels = niets te picken. */
export interface OrderPickbaarheidRij {
  order_id: number
  totaal_regels: number
  pickbare_regels: number
  alle_regels_pickbaar: boolean
  heeft_pickbare_regel: boolean
  deelleveringen_toegestaan: boolean
  pick_ship_zichtbaar: boolean
}
```

In `types.ts`, `PickShipOrder` na `aantal_regels`:

```ts
  /** Mig 383: order-niveau-predicaat uit view `order_pickbaarheid`. Bron voor
   *  de pick-start-knop (StartPickrondesButton) — niet client-side herleiden. */
  alle_regels_pickbaar: boolean
```

In `pick-ship-transform.ts` `initPickShipOrders` (regel ~91, naast `aantal_regels: 0`): `alle_regels_pickbaar: false,`.

In `pickbaarheid.ts`, nieuwe fetch (naast `fetchActievePickrondes`):

```ts
async function fetchOrderPickbaarheid(
  orderIds: number[]
): Promise<Map<number, OrderPickbaarheidRij>> {
  const map = new Map<number, OrderPickbaarheidRij>()
  for (const ids of chunks(orderIds, 100)) {
    const { data, error } = await supabase
      .from('order_pickbaarheid')
      .select(
        'order_id, totaal_regels, pickbare_regels, alle_regels_pickbaar, ' +
          'heeft_pickbare_regel, deelleveringen_toegestaan, pick_ship_zichtbaar'
      )
      .in('order_id', ids)
    if (error) throw error
    for (const row of (data ?? []) as unknown as OrderPickbaarheidRij[]) {
      map.set(row.order_id, row)
    }
  }
  return map
}
```

(import `OrderPickbaarheidRij` toevoegen aan de bestaande import uit `./pick-ship-transform`.)

In `fetchPickShipOrders`: voeg ná de `karpiNamen`-fetch toe:

```ts
  const orderPickbaarheid = await fetchOrderPickbaarheid(headers.map((h) => h.id))
```

Ná de gewicht-loop (`for (const [orderId, kg] of gewichtPerOrder)`, die in Taak 5 verdwijnt):

```ts
  for (const [orderId, opb] of orderPickbaarheid) {
    const order = perOrder.get(orderId)
    if (order) order.alle_regels_pickbaar = opb.alle_regels_pickbaar
  }
```

Vervang het `alleen_pickbaar`-filter (regels 87-89):

```ts
  if (alleen_pickbaar) {
    result = result.filter((o) => orderPickbaarheid.get(o.order_id)?.heeft_pickbare_regel ?? false)
  }
```

Vervang het volledige order-filter (regels 90-122, inclusief het comment-blok) door:

```ts
  // Pickbaarheids-gate: het order-niveau-predicaat (alle regels pickbaar, of
  // ≥1 pickbare regel als de klant deelleveringen toestaat, en überhaupt
  // regels) komt sinds mig 383 volledig uit view `order_pickbaarheid`
  // (pick_ship_zichtbaar) — de view skipt ook admin-pseudo-regels (ADR-0018).
  // TS filtert hier alleen nog. Enige client-side uitzondering: de dag-order-
  // horizon (ADR 0014 / mig 244), omdat die van `vandaag` afhangt — een
  // dag-order verschijnt pas vanaf werkdagMinN(afleverdatum, 1).
  // NB de bewuste keuze van 2026-06-04 blijft staan: een onbevestigde
  // EDI-leverweek (mig 309/316) blokkeert Pick & Ship NIET.
  const vandaagIso = isoLokaal(vandaag)
  result = result.filter((o) => {
    const opb = orderPickbaarheid.get(o.order_id)
    if (!opb) return false // geen (niet-pseudo) regels → niets te picken
    const header = headerMap.get(o.order_id)
    if (header?.lever_type === 'datum' && header.afleverdatum) {
      const horizon = werkdagMinN(header.afleverdatum, 1)
      if (vandaagIso < horizon) return false
    }
    return opb.pick_ship_zichtbaar
  })
```

In `fetchOpenOrderHeaders`: `deelleveringen_toegestaan` is niet langer nodig (de view draagt het predicaat). Versimpel de klantMap tot alleen namen:

```ts
  const klantMap = new Map<number, string>()

  if (debiteurNrs.length > 0) {
    const { data: debs, error: derr } = await supabase
      .from('debiteuren')
      .select('debiteur_nr, naam')
      .in('debiteur_nr', debiteurNrs)
    if (derr) throw derr
    for (const d of (debs ?? []) as Array<{ debiteur_nr: number; naam: string }>) {
      klantMap.set(d.debiteur_nr, d.naam)
    }
  }

  return ordersBase.map((o) => ({
    ...o,
    klant_naam: klantMap.get(o.debiteur_nr) ?? null,
  }))
```

En verwijder in `pick-ship-transform.ts` het veld `deelleveringen_toegestaan` (incl. docstring, regels 48-52) uit `OrderHeaderRij`; pas de `Omit<...>`-cast in `fetchOpenOrderHeaders` aan naar `Omit<OrderHeaderRij, 'klant_naam'>`.

- [ ] **Step 4: Run — contracttest + productie-only groen, typecheck schoon**

```powershell
npx vitest run src/modules/magazijn --reporter=basic; npm run typecheck
```

Verwacht: PASS + exit 0. (De `makeDebiteur`-fixtures mogen `deelleveringen_toegestaan` blijven meegeven — extra velden zijn onschadelijk.)

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/modules/magazijn frontend/src/modules/magazijn/lib/types.ts
git commit -m "refactor(magazijn): Pick & Ship-orderfilter uit view order_pickbaarheid — TS filtert alleen nog"
```

---

### Taak 5: TS — VERZEND-skips, gewicht-query en dode fallback verwijderen

**Files:**
- Modify: `frontend/src/modules/magazijn/queries/pickbaarheid.ts`
- Modify: `frontend/src/modules/magazijn/queries/pick-ship-transform.ts` (PickbaarheidRij)
- Test: `frontend/src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts`

- [ ] **Step 1: Test eerst.** Pas de contracttest aan op het nieuwe interface:

a. `makePickbaarheidRow`-factory: voeg `gewicht_kg: 4.5,` toe als default (en aan het `PickbaarheidRowFixture`-interface: `gewicht_kg: number | null`).

b. Scenario 1: geef de maatwerk-regel `gewicht_kg: 7.0` mee in de overrides, en **verwijder** de `order_regels`-gewichtqueue (regels 190-196). De gewicht-assert blijft: `4.5×2 + 7.0×1 = 16`:

```ts
expect(order.totaal_gewicht_kg).toBe(16)
```

c. Verwijder álle overige `queueResponse('order_regels', ...)`-regels (scenario's 2, 4, 5, 6, 7 — die voedden alleen de gewicht-query).

d. Vervang scenario 3 (fallback) volledig door een hard-error-test:

```ts
it('scenario 3: view-query faalt → fout propageert (geen stille fallback meer)', async () => {
  // De PGRST205-fallback op order_regels is verwijderd (mig 383 is een
  // deploy-voorwaarde). Een ontbrekende view moet hard en zichtbaar falen,
  // niet stil een lege Pick & Ship opleveren.
  queueResponse('orders', { data: [makeOrderHeader({ id: 100 })], error: null })
  queueResponse('debiteuren', { data: [makeDebiteur(5001, 'Klantnaam BV')], error: null })
  queueResponse('orderregel_pickbaarheid', {
    data: null,
    error: { code: 'PGRST205', message: "Could not find the table 'public.orderregel_pickbaarheid'" },
  })
  await expect(
    fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })
  ).rejects.toMatchObject({ code: 'PGRST205' })
})
```

e. **`pickbaarheid-productie-only.test.ts`:** verwijder in de tweede test de `queueResponse('order_regels', ...)`-regels (regels ~206-212 — die voedden alleen de verdwenen gewicht-query) en voeg `gewicht_kg: 4.5,` toe aan de `makePickbaarheidRow`-factory daar (regel ~126-145), zodat de fixture het view-interface blijft spiegelen.

- [ ] **Step 2: Run — verwacht rood** (gewicht komt nog uit `order_regels`-query; fallback bestaat nog)

```powershell
npx vitest run src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts --reporter=basic
```

- [ ] **Step 3: Implementeer.** In `pick-ship-transform.ts`, `PickbaarheidRij` na `wacht_op`:

```ts
  /** Mig 383: gewicht per stuk uit order_regels, via de view — vervangt de
   *  aparte gewicht-query. */
  gewicht_kg: number | null
```

In `pickbaarheid.ts`:

a. `fetchPickbaarheidRegels`: voeg `gewicht_kg` toe aan de select-string en **verwijder** de `.neq('artikelnr', SHIPPING_PRODUCT_ID)`-regel + het bijbehorende VERZEND-comment (de view skipt nu generiek admin-pseudo, ADR-0018). Verwijder ook het `if (isMissingPickbaarheidViewError(error)) ...`-blok — gewoon `if (error) throw error`.

```ts
      .select(
        'order_regel_id, order_id, regelnummer, artikelnr, is_maatwerk, ' +
          'orderaantal, maatwerk_lengte_cm, maatwerk_breedte_cm, omschrijving, ' +
          'maatwerk_kwaliteit_code, maatwerk_kleur_code, totaal_stuks, ' +
          'pickbaar_stuks, is_pickbaar, bron, fysieke_locatie, wacht_op, gewicht_kg'
      )
```

b. Verwijder volledig: `fetchFallbackOrderRegels`, `FallbackOrderRegelRij`, `isMissingPickbaarheidViewError`, `fetchTotaalGewichtPerOrder` (incl. doc-comment) en de imports die daardoor ongebruikt raken (`SHIPPING_PRODUCT_ID`).

c. In `fetchPickShipOrders`: verwijder de regel `const gewichtPerOrder = await fetchTotaalGewichtPerOrder(...)` en de `for (const [orderId, kg] of gewichtPerOrder)`-loop. Bereken het gewicht in de bestaande regel-loop:

```ts
  for (const r of regels) {
    const h = headerMap.get(r.order_id)
    const order = perOrder.get(r.order_id)
    if (!h || !order) continue

    const karpiNaam = r.artikelnr ? karpiNamen.get(r.artikelnr) ?? null : null
    const regel = mapPickbaarheidRegel(r, karpiNaam)
    order.regels.push(regel)
    order.totaal_m2 = Math.round((order.totaal_m2 + regel.m2) * 100) / 100
    order.totaal_gewicht_kg =
      Math.round((order.totaal_gewicht_kg + (r.gewicht_kg ?? 0) * (r.orderaantal ?? 0)) * 100) / 100
    order.aantal_regels = order.regels.length
  }
```

- [ ] **Step 4: Run — alles groen + typecheck**

```powershell
npx vitest run src/modules/magazijn --reporter=basic; npm run typecheck
```

Verwacht: PASS + exit 0.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/modules/magazijn
git commit -m "refactor(magazijn): VERZEND-skips, gewicht-query en PGRST205-fallback weg — view is single source"
```

---

### Taak 6: StartPickrondesButton consumeert het view-veld

**Files:**
- Modify: `frontend/src/modules/logistiek/components/start-pickrondes-button.tsx:62-66`

- [ ] **Step 1: Vervang de herafleiding**

```ts
// OUD:
function isPickbaar(o: PickShipOrder): boolean {
  if (o.regels.length === 0) return false
  if (o.actieve_pickronde) return false
  return o.regels.every((r) => r.is_pickbaar)
}
// NIEUW:
function isPickbaar(o: PickShipOrder): boolean {
  if (o.actieve_pickronde) return false
  // Order-niveau-predicaat uit view `order_pickbaarheid` (mig 383) — niet
  // client-side herleiden uit regels. False dekt ook "geen regels".
  return o.alle_regels_pickbaar
}
```

- [ ] **Step 2: Typecheck + volledige magazijn-tests**

```powershell
npm run typecheck; npx vitest run src/modules/magazijn --reporter=basic
```

Verwacht: exit 0 + PASS.

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/modules/logistiek/components/start-pickrondes-button.tsx
git commit -m "refactor(logistiek): pick-start-predicaat uit order_pickbaarheid-view i.p.v. client-side every()"
```

---

### Taak 7: Levende documentatie + projectgeheugen

**Files:**
- Modify: `docs/database-schema.md` (views-sectie)
- Modify: `docs/changelog.md`
- Modify: `docs/order-lifecycle.md` (pickbaarheids-gate)
- Modify: `CLAUDE.md` (bullet "Pick & Ship pickbaarheidsfilter")

- [ ] **Step 1: database-schema.md** — werk `orderregel_pickbaarheid` bij (v4: admin-pseudo-skip + `gewicht_kg`) en voeg `order_pickbaarheid` toe met kolommen `order_id, totaal_regels, pickbare_regels, alle_regels_pickbaar, heeft_pickbare_regel, deelleveringen_toegestaan, pick_ship_zichtbaar` en de semantiek "geen rij = geen (niet-pseudo) regels".

- [ ] **Step 2: changelog.md** — entry 2026-06-12: "Pickbaarheid single-source (mig 383): order-niveau-predicaat + admin-pseudo-skip + gewicht naar SQL-views; TS-laag filtert alleen nog; stale contracttest gerepareerd (mockte `zendingen` i.p.v. `zending_orders`, 7/7 rood); latente dropship-blokkade in Pick & Ship gefixt (DROPSHIP-regels stonden als wacht_op='inkoop' in de view)."

- [ ] **Step 3: order-lifecycle.md** — bij de Pick & Ship-gate noteren dat het zichtbaarheids-predicaat sinds mig 383 uit `order_pickbaarheid.pick_ship_zichtbaar` komt; dag-order-horizon blijft client-side (ADR 0014).

- [ ] **Step 4: CLAUDE.md** — herschrijf de bullet "**Pick & Ship pickbaarheidsfilter**": predicaat komt uit view `order_pickbaarheid` (mig 383, `pick_ship_zichtbaar`); de view skipt admin-pseudo generiek (ADR-0018) i.p.v. de oude TS VERZEND-skip; chunk-per-order_id-uitleg (1000-rows-cap) blijft staan; `StartPickrondesButton` leest `alle_regels_pickbaar`; PGRST205-fallback bestaat niet meer → mig 383 is deploy-voorwaarde voor de frontend.

- [ ] **Step 5: Commit**

```powershell
git add docs/database-schema.md docs/changelog.md docs/order-lifecycle.md CLAUDE.md
git commit -m "docs: pickbaarheid single-source (mig 383) — schema, changelog, lifecycle, CLAUDE.md"
```

---

### Taak 8: Apply + live verificatie (handmatig, op commando)

> Volgorde is hier de essentie: **eerst mig 383 op de live DB, dán pas frontend-deploy** — de PGRST205-fallback is weg, dus een frontend zonder view faalt hard. Merge naar main pas op expliciet commando van Miguel (projectafspraak); her-verifieer het migratienummer vlak vóór merge (collisie-geheugen).

- [ ] **Step 1: Bewijs de latente dropship-blokkade (vóór apply)** — draai op de live DB:

```sql
SELECT o.order_nr, op.artikelnr, op.is_pickbaar, op.wacht_op
FROM orderregel_pickbaarheid op
JOIN orders o   ON o.id = op.order_id
JOIN producten p ON p.artikelnr = op.artikelnr
WHERE p.is_pseudo;
```

Verwacht: rijen met `VERZEND` en (bij open dropship-orders) `DROPSHIP-*` met `wacht_op='inkoop'` — het bewijs. Bewaar de output in de PR/commit-notitie.

- [ ] **Step 2: Apply mig 383** op de live DB (Supabase SQL-editor / gebruikelijke route; `db push` niet gebruiken). Let op: het DB-volgnummer kan afwijken van het repo-nummer (precedent: repo 379-382 = DB 378-381).

- [ ] **Step 3: Verifieer na apply**

```sql
-- 1. Pseudo-regels weg uit de regel-view (verwacht: 0 rijen):
SELECT COUNT(*) FROM orderregel_pickbaarheid op
JOIN producten p ON p.artikelnr = op.artikelnr WHERE p.is_pseudo;

-- 2. Order-view consistent met de oude TS-logica (steekproef):
SELECT * FROM order_pickbaarheid ORDER BY order_id DESC LIMIT 20;

-- 3. Aantal zichtbare Pick & Ship-orders vóór/na vergelijkbaar
--    (verschil = precies de orders die door pseudo-regels geblokkeerd werden):
SELECT COUNT(*) FILTER (WHERE pick_ship_zichtbaar) AS zichtbaar, COUNT(*) AS totaal
FROM order_pickbaarheid;
```

- [ ] **Step 4: Frontend-deploy** volgens de gebruikelijke route, daarna Pick & Ship visueel controleren: ordertelling plausibel, dropship-orders nu zichtbaar/pickbaar, gewichtskolom gevuld.

- [ ] **Step 5: Projectgeheugen bijwerken** — `reference_stale_pickbaarheid_contracttest.md` markeren als opgelost (test gerepareerd in deze branch) zodra gemerged.
