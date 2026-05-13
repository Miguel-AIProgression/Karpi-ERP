# Bundel-korting zichtbaarheid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maak op factuur én op order-detail zichtbaar wanneer de bundeling van zendingen leidt tot verzendkosten-korting voor de klant. Op factuur: 2-regel-vorm (`VERZEND € 35` + `BUNDELKORTING −€ 35`) bij drempel-gehaald. Op order-detail: banner in OrderFacturen-blok zodra factuur bestaat én >1 bron-order op die factuur staat.

**Architecture:** Drie lagen samen. (1) **SQL-laag**: deploy bestaande mig 252 + nieuwe mig 256 die `genereer_factuur_voor_bundel` uitbreidt met 2-regel-vorm voor `gratis_drempel`-status. (2) **Data-correctie**: bestaand merge-script op Concept-facturen + feitenlijst voor verzonden legacy-facturen (geen actie, E1-besluit). (3) **Frontend-laag**: detect-functie + hook + `BundelKortingBanner`-component in `OrderFacturen`.

Banner-detectie via `factuur_regels`: factuur is "bundel" wanneer >1 distinct `order_id` op product-regels staat. Sub-conditie "drempel-korting toegepast" wanneer een regel met `artikelnr='BUNDELKORTING'` aanwezig is. Geen aparte detectie-RPC nodig — gewone Supabase select.

**Tech Stack:**
- PostgreSQL 15 (Supabase, hosted) — migraties via SQL Editor (geen MCP-toegang, zie `reference_karpi_supabase_mcp.md`)
- React 18 + TypeScript + Vitest — frontend, queries & tests
- TanStack Query — caching/invalidation hook-laag
- TailwindCSS + shadcn/ui — banner-styling, consistent met `VoorgesteldeBundelInfo`

**Achtergrond-documenten:**
- [Grill-sessie samenvatting](../../../CLAUDE.md) — beslissingen D2/W3/X2/V2/L4/E1 (deze conversatie)
- [mig 234 `verzendkosten_voor_bundel` resolver](../../../supabase/migrations/234_verzendkosten_resolver_en_factuur_bundel_rpc.sql) — huidige RPC met 1-regel-vorm
- [mig 252 `enqueue_factuur_per_bundel_zending`](../../../supabase/migrations/252_enqueue_factuur_per_bundel_zending.sql) — nog niet gedeployed, fix per-bundel enqueue
- [scripts/merge-bestaande-bundel-facturen.sql](../../../scripts/merge-bestaande-bundel-facturen.sql) — Concept-facturen samenvoegen
- [OrderFacturen-component](../../../frontend/src/components/orders/order-facturen.tsx) — integratie-target voor banner (L4)
- [VoorgesteldeBundelInfo](../../../frontend/src/modules/magazijn/components/voorgestelde-bundel-info.tsx) — visuele referentie voor banner-styling

---

## File Structure

**Nieuwe bestanden:**

| Pad | Verantwoordelijkheid |
|---|---|
| `supabase/migrations/256_bundelkorting_2_regel_vorm.sql` | Past `genereer_factuur_voor_bundel` aan: bij `status='gratis_drempel'` 2 regels (VERZEND + BUNDELKORTING) in plaats van 1 regel met bedrag 0 |
| `scripts/check-legacy-dubbele-verzendkosten.sql` | Read-only feitenlijst van verzonden/betaalde facturen met >1 VERZEND-regel (E1: niets doen, alleen weten) |
| `frontend/src/components/orders/bundel-korting-banner.tsx` | V2-component met conditionele tekst per scenario (A: drempel-korting, B: gewone bundel) |
| `frontend/src/components/orders/__tests__/bundel-korting-banner.test.tsx` | Vitest unit tests: scenario A, scenario B, solo-factuur (no-render) |
| `frontend/src/modules/facturatie/__tests__/bundel-info.test.ts` | Vitest unit tests voor `fetchBundelInfoVoorFactuur` detect-logica |

**Te wijzigen bestanden:**

| Pad | Wat verandert |
|---|---|
| `frontend/src/modules/facturatie/queries/facturen.ts` | Voeg `BundelInfoVoorFactuur`-interface + `fetchBundelInfoVoorFactuur(factuurId)`-functie toe |
| `frontend/src/modules/facturatie/hooks/use-facturen.ts` | Voeg `useBundelInfoVoorFactuur`-hook toe (React Query) |
| `frontend/src/modules/facturatie/index.ts` | Barrel-export voor de nieuwe hook + type |
| `frontend/src/components/orders/order-facturen.tsx` | Render `BundelKortingBanner` per factuur-regel onder de Link |
| `docs/changelog.md` | Nieuwe sectie 2026-05-13: bundel-korting zichtbaarheid |
| `docs/architectuur.md` | Update facturatie-flow met BUNDELKORTING-artikelnr-conventie + banner-detectie |
| `docs/data-woordenboek.md` | Voeg term *Bundelkorting* toe |

---

## Deployment-volgorde — kritisch

Volgorde matters; verkeerd → dubbel werk of foute data.

1. **Eerst:** mig 252 deployen (stopt vervuiling — nieuwe queue-rijen krijgen `zending_id`)
2. **Daarna:** mig 256 deployen (RPC kan voortaan 2-regel-vorm uitgeven)
3. **Daarna:** feitenlijst legacy genereren (`check-legacy-dubbele-verzendkosten.sql`) — read-only
4. **Daarna:** merge-script runnen (`merge-bestaande-bundel-facturen.sql`) — pakt nu Concept-facturen op met 2-regel-vorm
5. **Daarna:** frontend deploy (banner-component)

Frontend-banner mag eerder; hij rendert simpelweg niets als er geen multi-order-factuur is.

---

## Task 1: Migratie 256 — 2-regel-vorm in `genereer_factuur_voor_bundel`

**Files:**
- Create: `supabase/migrations/256_bundelkorting_2_regel_vorm.sql`

- [ ] **Step 1.1: Maak migratie-bestand met header**

Bestand: `supabase/migrations/256_bundelkorting_2_regel_vorm.sql`

```sql
-- Migratie 256: BUNDELKORTING — 2-regel-vorm bij drempel-gehaald
--
-- Grill-besluit D2: factuur toont bij `gratis_drempel`-status 2 regels:
--   1. VERZEND      € 35,00  (volle verzendkosten zoals het hoort)
--   2. BUNDELKORTING −€ 35,00 (korting, saldo wordt € 0)
--
-- Doel: klant ziet zwart-op-wit dat we verzendkosten wegstrepen als
-- service. Auditeerbaar (twee aparte boekingsregels) en EDI-vriendelijk
-- (AllowanceCharge mappt 1-op-1 naar de KORTING-regel).
--
-- Voor `betaald` / `gratis_afhalen` / `gratis_klantafspraak` blijft het
-- 1-regel-vorm zoals mig 234. Alleen `gratis_drempel` splitst.
--
-- BTW: de KORTING-regel krijgt hetzelfde percentage als de VERZEND-regel,
-- met negatief bedrag. Saldo: € 0 ex + € 0 BTW.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- VOORWAARDE: mig 234 (resolver + RPC bestaan) en mig 252 (queue-rijen
-- hebben zending_id).
```

- [ ] **Step 1.2: Voeg CREATE OR REPLACE met de aangepaste RPC toe**

Plak achter de header (de hele body — vergelijk met mig 234 om te zien wat behouden blijft):

```sql
CREATE OR REPLACE FUNCTION genereer_factuur_voor_bundel(p_zending_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_factuur_id           BIGINT;
  v_factuur_nr           TEXT;
  v_zending              zendingen%ROWTYPE;
  v_debiteur             debiteuren%ROWTYPE;
  v_btw_pct              NUMERIC(5,2);
  v_betaaltermijn_dagen  INTEGER := 30;
  v_aantal_te_factureren INTEGER;
  v_order_ids            BIGINT[];
  v_subtotaal            NUMERIC(12,2);
  v_btw_bedrag           NUMERIC(12,2);
  v_totaal               NUMERIC(12,2);
  v_volgnr               INTEGER;
  v_bundel_subtotaal     NUMERIC(12,2);
  v_is_afhalen           BOOLEAN;
  v_vk                   RECORD;
  v_verzend_omschrijving TEXT;
BEGIN
  IF p_zending_id IS NULL THEN
    RAISE EXCEPTION 'p_zending_id is verplicht';
  END IF;

  SELECT * INTO v_zending FROM zendingen WHERE id = p_zending_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  SELECT array_agg(zo.order_id ORDER BY zo.order_id)
    INTO v_order_ids
    FROM zending_orders zo
   WHERE zo.zending_id = p_zending_id;

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Zending % heeft geen gekoppelde orders', p_zending_id;
  END IF;

  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(v_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Bundel-zending % kruist debiteur-grens (orders %)',
      p_zending_id, v_order_ids;
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren
   WHERE debiteur_nr = (SELECT DISTINCT debiteur_nr FROM orders WHERE id = ANY(v_order_ids));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Geen debiteur voor orders %', v_order_ids;
  END IF;

  v_btw_pct := COALESCE(v_debiteur.btw_percentage, 21.00);
  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND COALESCE(orr.artikelnr, '') <> 'VERZEND';

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Zending % heeft geen te-factureren regels', p_zending_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer
  ) VALUES (
    v_factuur_nr, v_debiteur.debiteur_nr, CURRENT_DATE,
    CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer
  ) RETURNING id INTO v_factuur_id;

  -- Product-regels (ongewijzigd t.o.v. mig 234).
  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.klant_referentie, o.order_nr,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(v_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
    AND COALESCE(orr.artikelnr, '') <> 'VERZEND'
  ORDER BY orr.order_id, orr.regelnummer;

  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND COALESCE(artikelnr, '') <> 'VERZEND';

  -- Verzendkosten via resolver — single source of truth (mig 234).
  SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
    INTO v_bundel_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;

  SELECT BOOL_OR(COALESCE(o.afhalen, FALSE))
    INTO v_is_afhalen
    FROM orders o
   WHERE o.id = ANY(v_order_ids);

  SELECT * INTO v_vk
    FROM verzendkosten_voor_bundel(v_debiteur.debiteur_nr, v_bundel_subtotaal, v_is_afhalen);

  SELECT COALESCE(MAX(regelnummer), 0) INTO v_volgnr
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_volgnr := v_volgnr + 1;

  -- Rich-omschrijving consistent met mig 234.
  v_verzend_omschrijving := format('Verzendkosten week %s (%s, %s order%s) — %s',
    COALESCE(v_zending.verzendweek, 'onbekend'),
    CASE WHEN v_is_afhalen THEN 'AFHAAL' ELSE COALESCE(v_zending.vervoerder_code, 'GEEN') END,
    array_length(v_order_ids, 1),
    CASE WHEN array_length(v_order_ids, 1) = 1 THEN '' ELSE 's' END,
    v_vk.reden);

  IF v_vk.status = 'gratis_drempel' THEN
    -- 2-regel-vorm: volle verzendkosten + tegenboeking als BUNDELKORTING.
    -- Mig 256 (D2-keuze): klant ziet wat hij bespaart i.p.v. enkel een 0-regel.
    INSERT INTO factuur_regels (
      factuur_id, order_id, order_regel_id, regelnummer,
      artikelnr, omschrijving,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_factuur_id, v_order_ids[1], NULL, v_volgnr,
      'VERZEND', v_verzend_omschrijving,
      1, COALESCE(v_debiteur.verzendkosten, 0), 0, COALESCE(v_debiteur.verzendkosten, 0), v_btw_pct
    );

    v_volgnr := v_volgnr + 1;

    INSERT INTO factuur_regels (
      factuur_id, order_id, order_regel_id, regelnummer,
      artikelnr, omschrijving,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_factuur_id, v_order_ids[1], NULL, v_volgnr,
      'BUNDELKORTING',
      format('Bundelkorting verzending — %s', v_vk.reden),
      1, -COALESCE(v_debiteur.verzendkosten, 0), 0, -COALESCE(v_debiteur.verzendkosten, 0), v_btw_pct
    );
  ELSE
    -- 1-regel-vorm zoals mig 234 (betaald / gratis_afhalen / gratis_klantafspraak).
    INSERT INTO factuur_regels (
      factuur_id, order_id, order_regel_id, regelnummer,
      artikelnr, omschrijving,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_factuur_id, v_order_ids[1], NULL, v_volgnr,
      'VERZEND', v_verzend_omschrijving,
      1, v_vk.te_betalen, 0, v_vk.te_betalen, v_btw_pct
    );
  END IF;

  -- Eindtotalen.
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$$;

COMMENT ON FUNCTION genereer_factuur_voor_bundel(BIGINT) IS
  'Mig 256 (D2): bij gratis_drempel-status 2 regels (VERZEND + BUNDELKORTING) '
  'i.p.v. 1 regel met bedrag 0. Andere statussen ongewijzigd. Doel: klant '
  'ziet wat hij bespaart als service.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 1.3: Voeg verificatie-queries als comment onderaan toe**

```sql
-- Verificatie (run in SQL Editor na deploy):
--
-- 1. Drempel-gehaald → 2 regels:
--    SELECT factuur_id, artikelnr, prijs, bedrag
--      FROM factuur_regels
--     WHERE factuur_id = (
--       SELECT id FROM facturen
--        WHERE debiteur_nr = <test_klant_met_drempel>
--        ORDER BY id DESC LIMIT 1
--     )
--       AND artikelnr IN ('VERZEND', 'BUNDELKORTING');
--    -- Verwacht: 2 rijen — VERZEND +€ X en BUNDELKORTING −€ X
--
-- 2. Drempel niet gehaald → 1 regel met betaald bedrag:
--    -- Idem, met klant onder de drempel
--    -- Verwacht: 1 rij VERZEND, geen BUNDELKORTING
--
-- 3. Gratis klantafspraak → 1 regel met € 0:
--    -- Idem, met debiteur.gratis_verzending = TRUE
--    -- Verwacht: 1 rij VERZEND € 0,00
```

- [ ] **Step 1.4: Commit migratie 254**

```bash
git add supabase/migrations/256_bundelkorting_2_regel_vorm.sql
git commit -m "feat(facturatie): mig 256 — BUNDELKORTING 2-regel-vorm bij drempel-gehaald (D2)"
```

---

## Task 2: Legacy-feitenlijst SQL-script (E1)

**Files:**
- Create: `scripts/check-legacy-dubbele-verzendkosten.sql`

- [ ] **Step 2.1: Maak read-only feitenlijst-script**

Bestand: `scripts/check-legacy-dubbele-verzendkosten.sql`

```sql
-- Read-only feitenlijst: verzonden/betaalde facturen met >1 VERZEND-regel.
--
-- Grill-besluit E1: we doen NIETS met deze facturen (juridisch netjes),
-- maar willen wel weten HOEVEEL en WELKE. Resultaat informeert eventueel
-- reactief handelen op klantvraag.
--
-- Veilig: alleen SELECT, geen DML.
--
-- Run dit in Supabase SQL Editor na deploy van mig 256 + run van het
-- merge-script. Output: 0 rijen = schoon; N rijen = bewaren als naslag.

SELECT
  f.factuur_nr,
  f.debiteur_nr,
  d.naam                                            AS klant_naam,
  f.status,
  f.factuurdatum,
  f.verstuurd_op,
  f.totaal,
  COUNT(*) FILTER (WHERE fr.artikelnr = 'VERZEND')  AS aantal_verzend_regels,
  SUM(fr.bedrag) FILTER (WHERE fr.artikelnr = 'VERZEND') AS verzend_totaal
FROM facturen f
JOIN factuur_regels fr ON fr.factuur_id = f.id
JOIN debiteuren d      ON d.debiteur_nr = f.debiteur_nr
WHERE f.status IN ('Verstuurd', 'Betaald', 'Herinnering', 'Aanmaning')
GROUP BY f.id, f.factuur_nr, f.debiteur_nr, d.naam, f.status,
         f.factuurdatum, f.verstuurd_op, f.totaal
HAVING COUNT(*) FILTER (WHERE fr.artikelnr = 'VERZEND') > 1
ORDER BY f.factuurdatum DESC;
```

- [ ] **Step 2.2: Commit script**

```bash
git add scripts/check-legacy-dubbele-verzendkosten.sql
git commit -m "chore(facturatie): legacy-feitenlijst dubbele verzendkosten (E1)"
```

---

## Task 3: Detect-functie `fetchBundelInfoVoorFactuur`

**Files:**
- Modify: `frontend/src/modules/facturatie/queries/facturen.ts`
- Create: `frontend/src/modules/facturatie/__tests__/bundel-info.test.ts`

- [ ] **Step 3.1: Schrijf failing test voor solo-factuur (geen bundel)**

Bestand: `frontend/src/modules/facturatie/__tests__/bundel-info.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

let nextResponse: any = { data: null, error: null }

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: any) => Promise.resolve(nextResponse),
      }),
    }),
  },
}))

import { fetchBundelInfoVoorFactuur } from '../queries/facturen'

beforeEach(() => {
  nextResponse = { data: null, error: null }
})

describe('fetchBundelInfoVoorFactuur', () => {
  it('returns isBundel=false voor solo-factuur (1 order, 1 VERZEND)', async () => {
    nextResponse = {
      data: [
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'SANDRO', bedrag: 200 },
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'VERZEND', bedrag: 35 },
      ],
      error: null,
    }
    const info = await fetchBundelInfoVoorFactuur(1)
    expect(info.isBundel).toBe(false)
    expect(info.heeftDrempelKorting).toBe(false)
    expect(info.andereOrders).toEqual([])
  })
})
```

- [ ] **Step 3.2: Run test — verwacht falen op "function not defined"**

```bash
cd frontend && npx vitest run src/modules/facturatie/__tests__/bundel-info.test.ts
```

Expected: FAIL — `fetchBundelInfoVoorFactuur is not defined`.

- [ ] **Step 3.3: Voeg interface + functie toe aan `facturen.ts`**

Voeg toe in [frontend/src/modules/facturatie/queries/facturen.ts](frontend/src/modules/facturatie/queries/facturen.ts), na de bestaande `fetchFacturenVoorOrders`:

```typescript
export interface BundelInfoVoorFactuur {
  isBundel: boolean
  heeftDrempelKorting: boolean
  verzendkostenBedrag: number
  andereOrders: Array<{ id: number; nr: string }>
}

export async function fetchBundelInfoVoorFactuur(
  factuurId: number,
): Promise<BundelInfoVoorFactuur> {
  const { data, error } = await supabase
    .from('factuur_regels')
    .select('order_id, order_nr, artikelnr, bedrag')
    .eq('factuur_id', factuurId)
  if (error) throw error

  const rows = (data ?? []) as Array<{
    order_id: number
    order_nr: string | null
    artikelnr: string | null
    bedrag: number
  }>

  const productRegels = rows.filter(
    (r) => r.artikelnr !== 'VERZEND' && r.artikelnr !== 'BUNDELKORTING',
  )
  const heeftDrempelKorting = rows.some((r) => r.artikelnr === 'BUNDELKORTING')
  const verzendRegel = rows.find((r) => r.artikelnr === 'VERZEND')

  const ordersMap = new Map<number, string>()
  for (const r of productRegels) {
    if (!ordersMap.has(r.order_id)) {
      ordersMap.set(r.order_id, r.order_nr ?? `#${r.order_id}`)
    }
  }

  const orders = Array.from(ordersMap, ([id, nr]) => ({ id, nr }))

  return {
    isBundel: orders.length > 1,
    heeftDrempelKorting,
    verzendkostenBedrag: verzendRegel ? Math.abs(Number(verzendRegel.bedrag)) : 0,
    andereOrders: orders,
  }
}
```

- [ ] **Step 3.4: Run test — verwacht slagen**

```bash
cd frontend && npx vitest run src/modules/facturatie/__tests__/bundel-info.test.ts
```

Expected: PASS — `isBundel=false`-test groen.

- [ ] **Step 3.5: Voeg test toe voor scenario A (bundel + BUNDELKORTING)**

In hetzelfde testbestand, na de eerste `it`:

```typescript
it('detecteert scenario A: multi-order met BUNDELKORTING', async () => {
  nextResponse = {
    data: [
      { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'SANDRO', bedrag: 200 },
      { order_id: 101, order_nr: 'ORD-2026-0101', artikelnr: 'SANDRO', bedrag: 300 },
      { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'VERZEND', bedrag: 35 },
      { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'BUNDELKORTING', bedrag: -35 },
    ],
    error: null,
  }
  const info = await fetchBundelInfoVoorFactuur(1)
  expect(info.isBundel).toBe(true)
  expect(info.heeftDrempelKorting).toBe(true)
  expect(info.verzendkostenBedrag).toBe(35)
  expect(info.andereOrders).toHaveLength(2)
  expect(info.andereOrders.map((o) => o.id).sort()).toEqual([100, 101])
})
```

- [ ] **Step 3.6: Voeg test toe voor scenario B (bundel zonder BUNDELKORTING)**

```typescript
it('detecteert scenario B: multi-order zonder BUNDELKORTING', async () => {
  nextResponse = {
    data: [
      { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'SANDRO', bedrag: 100 },
      { order_id: 101, order_nr: 'ORD-2026-0101', artikelnr: 'SANDRO', bedrag: 100 },
      { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'VERZEND', bedrag: 35 },
    ],
    error: null,
  }
  const info = await fetchBundelInfoVoorFactuur(1)
  expect(info.isBundel).toBe(true)
  expect(info.heeftDrempelKorting).toBe(false)
  expect(info.verzendkostenBedrag).toBe(35)
  expect(info.andereOrders).toHaveLength(2)
})
```

- [ ] **Step 3.7: Run alle tests**

```bash
cd frontend && npx vitest run src/modules/facturatie/__tests__/bundel-info.test.ts
```

Expected: PASS — alle 3 tests groen.

- [ ] **Step 3.8: Commit detect-functie + tests**

```bash
git add frontend/src/modules/facturatie/queries/facturen.ts \
        frontend/src/modules/facturatie/__tests__/bundel-info.test.ts
git commit -m "feat(facturatie): fetchBundelInfoVoorFactuur detect-functie + 3 tests"
```

---

## Task 4: React Query hook `useBundelInfoVoorFactuur`

**Files:**
- Modify: `frontend/src/modules/facturatie/hooks/use-facturen.ts`
- Modify: `frontend/src/modules/facturatie/index.ts`

- [ ] **Step 4.1: Voeg `fetchBundelInfoVoorFactuur` toe aan de BESTAANDE import-regel**

In [frontend/src/modules/facturatie/hooks/use-facturen.ts](frontend/src/modules/facturatie/hooks/use-facturen.ts) bestaat al een import-blok op regel 2-8:

```typescript
import {
  fetchFacturen,
  fetchFactuurDetail,
  fetchFacturenVoorOrder,
  fetchFacturenVoorOrders,
  zetFactuurOpBetaald,
  fetchBundelInfoVoorFactuur,  // ← deze regel toevoegen
} from '../queries/facturen'
```

**Belangrijk:** NIET een tweede `import { fetchBundelInfoVoorFactuur } from '../queries/facturen'` onderaan plakken. Dat geeft een dubbele-import-fout.

- [ ] **Step 4.2: Voeg hook onderaan `use-facturen.ts` toe**

```typescript
export function useBundelInfoVoorFactuur(factuurId: number | null | undefined) {
  return useQuery({
    queryKey: ['bundel-info-factuur', factuurId],
    queryFn: () => fetchBundelInfoVoorFactuur(factuurId as number),
    enabled: Boolean(factuurId),
    staleTime: 60_000,
  })
}
```

(`useQuery` is al geïmporteerd op regel 1 — geen extra import nodig.)

- [ ] **Step 4.3: Voeg barrel-type-export toe**

`useBundelInfoVoorFactuur` wordt al automatisch geëxporteerd door de bestaande regel `export * from './hooks/use-facturen'` ([index.ts:18](frontend/src/modules/facturatie/index.ts#L18)). Voeg dus ALLEEN het type expliciet toe — bij de andere `export type`-regel rond regel 21:

```typescript
// Types (for external consumers)
export type { FactuurVoorOrder, BundelInfoVoorFactuur } from './queries/facturen'
```

**Belangrijk:** NIET `export { useBundelInfoVoorFactuur }` opnieuw exporteren — dat geeft "Module has already exported a member"-conflict met de wildcard.

- [ ] **Step 4.4: Run typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: geen errors gerelateerd aan de nieuwe symbols.

- [ ] **Step 4.5: Commit hook + barrel**

```bash
git add frontend/src/modules/facturatie/hooks/use-facturen.ts \
        frontend/src/modules/facturatie/index.ts
git commit -m "feat(facturatie): useBundelInfoVoorFactuur hook + barrel-export"
```

---

## Task 5: Component `BundelKortingBanner`

**Files:**
- Create: `frontend/src/components/orders/bundel-korting-banner.tsx`
- Create: `frontend/src/components/orders/__tests__/bundel-korting-banner.test.tsx`

- [ ] **Step 5.1: Schrijf failing test voor solo-factuur (banner rendert niet)**

Bestand: `frontend/src/components/orders/__tests__/bundel-korting-banner.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/modules/facturatie', () => ({
  useBundelInfoVoorFactuur: vi.fn(),
}))

import { useBundelInfoVoorFactuur } from '@/modules/facturatie'
import { BundelKortingBanner } from '../bundel-korting-banner'

const mockedHook = vi.mocked(useBundelInfoVoorFactuur)

function renderBanner(orderId: number, factuurId: number, factuurNr: string) {
  return render(
    <MemoryRouter>
      <BundelKortingBanner orderId={orderId} factuurId={factuurId} factuurNr={factuurNr} />
    </MemoryRouter>,
  )
}

describe('BundelKortingBanner', () => {
  it('rendert niets voor solo-factuur (geen bundel)', () => {
    mockedHook.mockReturnValue({
      data: {
        isBundel: false,
        heeftDrempelKorting: false,
        verzendkostenBedrag: 35,
        andereOrders: [{ id: 100, nr: 'ORD-2026-0100' }],
      },
      isLoading: false,
    } as any)
    const { container } = renderBanner(100, 1, 'FACT-2026-0017')
    expect(container.textContent).toBe('')
  })
})
```

- [ ] **Step 5.2: Run test — verwacht falen op "Cannot find module"**

```bash
cd frontend && npx vitest run src/components/orders/__tests__/bundel-korting-banner.test.tsx
```

Expected: FAIL — module niet gevonden.

- [ ] **Step 5.3: Maak minimal component dat niets rendert**

Bestand: `frontend/src/components/orders/bundel-korting-banner.tsx`

```typescript
import { useBundelInfoVoorFactuur } from '@/modules/facturatie'

interface BundelKortingBannerProps {
  orderId: number
  factuurId: number
  factuurNr: string
}

export function BundelKortingBanner({
  orderId,
  factuurId,
  factuurNr,
}: BundelKortingBannerProps) {
  const { data: info } = useBundelInfoVoorFactuur(factuurId)
  if (!info || !info.isBundel) return null
  return null // placeholder — wordt in stap 5.5 vervangen
}
```

- [ ] **Step 5.4: Run test — verwacht slagen**

```bash
cd frontend && npx vitest run src/components/orders/__tests__/bundel-korting-banner.test.tsx
```

Expected: PASS.

- [ ] **Step 5.5: Voeg tests + render-logica toe voor scenario A (drempel-korting)**

Voeg test toe aan testbestand:

```typescript
it('rendert scenario A: drempel-korting met "weggestreept"-framing', () => {
  mockedHook.mockReturnValue({
    data: {
      isBundel: true,
      heeftDrempelKorting: true,
      verzendkostenBedrag: 35,
      andereOrders: [
        { id: 100, nr: 'ORD-2026-2057' },
        { id: 101, nr: 'ORD-2026-2058' },
      ],
    },
    isLoading: false,
  } as any)
  const { getByText } = renderBanner(100, 1, 'FACT-2026-0017')
  expect(getByText(/Bundel-korting toegepast/i)).toBeTruthy()
  expect(getByText(/ORD-2026-2058/)).toBeTruthy()
  expect(getByText(/weggestreept/i)).toBeTruthy()
  expect(getByText(/€\s*35/)).toBeTruthy()
  // Factuur-link moet expliciet zichtbaar zijn (anders weet je niet dat de link rendert).
  expect(getByText(/FACT-2026-0017/)).toBeTruthy()
})
```

Run test → verwacht falen (component rendert nog `null`).

- [ ] **Step 5.6: Implementeer V2-render voor scenario A**

Vervang het lichaam van `BundelKortingBanner` in `bundel-korting-banner.tsx`:

```typescript
import { Link } from 'react-router-dom'
import { Package } from 'lucide-react'
import { useBundelInfoVoorFactuur } from '@/modules/facturatie'
import { formatCurrency } from '@/lib/utils/formatters'

interface BundelKortingBannerProps {
  orderId: number
  factuurId: number
  factuurNr: string
}

export function BundelKortingBanner({
  orderId,
  factuurId,
  factuurNr,
}: BundelKortingBannerProps) {
  const { data: info } = useBundelInfoVoorFactuur(factuurId)
  if (!info || !info.isBundel) return null

  const andere = info.andereOrders.filter((o) => o.id !== orderId)
  // Edge-case: als de huidige order de enige is in `andereOrders` (data-inconsistentie),
  // hebben we niets te tonen. Beter niets dan "Verzonden samen met . Verzendkosten…".
  if (andere.length === 0) return null

  const titel = info.heeftDrempelKorting ? 'Bundel-korting toegepast' : 'Gebundelde zending'
  const kostenLabel = formatCurrency(info.verzendkostenBedrag)
  const factuurLink = (
    <Link
      to={`/facturatie/${factuurId}`}
      className="font-mono text-terracotta-500 hover:underline"
    >
      {factuurNr}
    </Link>
  )

  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 mt-2 text-xs text-slate-700">
      <div className="flex items-center gap-1 font-medium text-emerald-700 mb-1">
        <Package size={12} aria-hidden />
        {titel}
      </div>
      <div className="text-slate-600 leading-relaxed">
        Verzonden samen met{' '}
        {andere.map((o, i) => (
          <span key={o.id}>
            {i > 0 && ', '}
            <Link
              to={`/orders/${o.id}`}
              className="font-mono text-terracotta-500 hover:underline"
            >
              {o.nr}
            </Link>
          </span>
        ))}
        .{' '}
        {info.heeftDrempelKorting ? (
          <>
            Verzendkosten ({kostenLabel}) weggestreept op {factuurLink}.
          </>
        ) : (
          <>
            1× verzendkosten i.p.v. {andere.length + 1}× — bespaart {kostenLabel} op {factuurLink}.
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5.7: Voeg test toe voor scenario B (geen drempel)**

```typescript
it('rendert scenario B: bundel zonder drempel-korting', () => {
  mockedHook.mockReturnValue({
    data: {
      isBundel: true,
      heeftDrempelKorting: false,
      verzendkostenBedrag: 35,
      andereOrders: [
        { id: 100, nr: 'ORD-2026-2057' },
        { id: 101, nr: 'ORD-2026-2058' },
      ],
    },
    isLoading: false,
  } as any)
  const { getByText } = renderBanner(100, 1, 'FACT-2026-0017')
  expect(getByText(/Gebundelde zending/i)).toBeTruthy()
  expect(getByText(/i\.p\.v\./)).toBeTruthy()
  expect(getByText(/bespaart/i)).toBeTruthy()
})
```

- [ ] **Step 5.8: Run alle component-tests**

```bash
cd frontend && npx vitest run src/components/orders/__tests__/bundel-korting-banner.test.tsx
```

Expected: PASS — alle 3 tests groen.

- [ ] **Step 5.9: Commit component + tests**

```bash
git add frontend/src/components/orders/bundel-korting-banner.tsx \
        frontend/src/components/orders/__tests__/bundel-korting-banner.test.tsx
git commit -m "feat(orders): BundelKortingBanner V2 — conditioneel per scenario (A/B)"
```

---

## Task 6: Integratie in `OrderFacturen`

**Files:**
- Modify: `frontend/src/components/orders/order-facturen.tsx`

- [ ] **Step 6.1: Voeg banner-render toe per factuur-rij (L4-locatie)**

In [frontend/src/components/orders/order-facturen.tsx](frontend/src/components/orders/order-facturen.tsx), import + render:

```typescript
import { BundelKortingBanner } from './bundel-korting-banner'
```

Wijzig de `<li>`-content van per-factuur-rij:

```tsx
<li key={f.id}>
  <Link
    to={`/facturatie/${f.id}`}
    className="flex items-center justify-between py-2 -mx-2 px-2 rounded hover:bg-slate-50 transition-colors"
  >
    <div className="flex items-center gap-3">
      <span className="font-mono text-sm text-terracotta-500">{f.factuur_nr}</span>
      <StatusBadge status={f.status} type="factuur" />
      <span className="text-xs text-slate-400">{formatDate(f.factuurdatum)}</span>
    </div>
    <span className="text-sm font-medium text-slate-700">
      {formatCurrency(f.totaal)}
    </span>
  </Link>
  <BundelKortingBanner
    orderId={orderId}
    factuurId={f.id}
    factuurNr={f.factuur_nr}
  />
</li>
```

- [ ] **Step 6.2: Run typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: geen errors.

- [ ] **Step 6.3: Run full vitest suite in deze modules**

```bash
cd frontend && npx vitest run src/components/orders/ src/modules/facturatie/
```

Expected: alle tests groen, geen regressies.

- [ ] **Step 6.4: Commit integratie**

```bash
git add frontend/src/components/orders/order-facturen.tsx
git commit -m "feat(orders): integreer BundelKortingBanner in OrderFacturen (L4)"
```

---

## Task 7: Documentatie bijwerken

**Files:**
- Modify: `docs/changelog.md`
- Modify: `docs/architectuur.md`
- Modify: `docs/data-woordenboek.md`

- [ ] **Step 7.1: Voeg changelog-sectie toe**

Bovenaan [docs/changelog.md](docs/changelog.md) een nieuwe sectie:

```markdown
## 2026-05-13 — Bundel-korting zichtbaarheid

**Waarom:** Bij bundeling van zendingen werd de verzendkosten-besparing
niet zichtbaar voor de klant — factuur toonde alleen € 0 of stilzwijgend
1 i.p.v. 2 verzend-regels. Behoefte: communiceer als service.

**Wat:**
- Mig 256: `genereer_factuur_voor_bundel` splitst bij drempel-gehaald in
  2 factuurregels: `VERZEND € X` + `BUNDELKORTING −€ X` (D2-vorm).
  BTW: zelfde % met negatief bedrag. Saldo blijft € 0.
- Nieuw artikelnr-conventie: `BUNDELKORTING` voor de tegenboeking.
- Frontend: `BundelKortingBanner` in `OrderFacturen` toont per factuur
  een groene info-strip met scenario-specifieke tekst:
  - A (drempel-korting): "Verzendkosten weggestreept op FACT-X"
  - B (multi-order zonder drempel): "1× i.p.v. 2× — bespaart € X"
- Banner verschijnt pas vanaf factuur-bestaan (W3-besluit) — niet bij
  voorgestelde bundels die nog kunnen veranderen.
- Legacy verstuurde facturen met dubbele VERZEND-regels: niets doen
  (E1). Script `check-legacy-dubbele-verzendkosten.sql` produceert
  feitenlijst voor naslag.

**Deployment-volgorde:** mig 252 → mig 256 → feitenlijst → merge-script
→ frontend.
```

- [ ] **Step 7.2: Update architectuur.md — facturatie-flow**

Zoek eerst de juiste locatie:

```bash
grep -n "ADR-0010\|bundel-zending\|genereer_factuur_voor_bundel" docs/architectuur.md
```

Voeg het onderstaande blok toe direct na de eerste match (de bestaande
ADR-0010/bundel-zending-uitleg). Als geen match: voeg het toe in een
nieuwe sectie "### Bundel-korting" onderaan de facturatie-flow-paragraaf.

```markdown
### BUNDELKORTING-artikelnr (mig 256)

Bij `gratis_drempel`-status splitst de factuur in 2 regels:
- `VERZEND` met volle verzendkosten (positief)
- `BUNDELKORTING` met tegenboeking (negatief)

Bron-van-waarheid voor "factuur is bundel-factuur" is `factuur_regels`:
factuur met >1 distinct `order_id` op product-regels (exclusief
VERZEND/BUNDELKORTING). Frontend detecteert via `fetchBundelInfoVoorFactuur`.
```

- [ ] **Step 7.3: Voeg term toe aan data-woordenboek**

In [docs/data-woordenboek.md](docs/data-woordenboek.md), op alfabetische plek:

```markdown
**Bundelkorting** — Service-korting die we toepassen wanneer een
bundel-zending (mig 222) tegelijk de verzendkosten-drempel van de klant
overschrijdt. Op factuur 2 regels: volle VERZEND + tegenboeking
BUNDELKORTING (artikelnr-conventie sinds mig 256). Saldo verzendkosten
voor de klant: € 0. Communiceert het cadeau zichtbaar; alleen 1 regel
met € 0 zou de service verbergen.
```

- [ ] **Step 7.4: Commit docs**

```bash
git add docs/changelog.md docs/architectuur.md docs/data-woordenboek.md
git commit -m "docs(facturatie): bundel-korting zichtbaarheid — changelog + architectuur + woordenboek"
```

---

## Task 8: Handmatige deploy + verificatie

Deze stappen voer je uit in Supabase Dashboard (geen MCP-toegang voor dit project — zie [reference_karpi_supabase_mcp.md](C:/Users/migue/.claude/projects/c--Users-migue-Documents-Karpi-ERP/memory/reference_karpi_supabase_mcp.md)).

- [ ] **Step 8.1: Deploy mig 252 in Supabase SQL Editor**

Kopieer inhoud van [supabase/migrations/252_enqueue_factuur_per_bundel_zending.sql](supabase/migrations/252_enqueue_factuur_per_bundel_zending.sql) naar SQL Editor en run.

Verifieer:
```sql
SELECT tgname, proname FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE tgname = 'trg_enqueue_factuur_op_event';
-- Verwacht: 1 rij met proname='enqueue_factuur_voor_event'
```

- [ ] **Step 8.2: Deploy mig 256**

Kopieer inhoud van `supabase/migrations/256_bundelkorting_2_regel_vorm.sql` naar SQL Editor en run.

Verifieer:
```sql
SELECT pg_get_functiondef('genereer_factuur_voor_bundel(BIGINT)'::regprocedure)
  LIKE '%BUNDELKORTING%' AS heeft_bundelkorting_logica;
-- Verwacht: true
```

- [ ] **Step 8.3: Run feitenlijst-script**

Kopieer inhoud van `scripts/check-legacy-dubbele-verzendkosten.sql` naar SQL Editor en run.

Bewaar output (screenshot of CSV) als naslag — niets doen met deze
facturen (E1-besluit).

- [ ] **Step 8.4: Run merge-script — éérst dry-run**

Kopieer inhoud van [scripts/merge-bestaande-bundel-facturen.sql](scripts/merge-bestaande-bundel-facturen.sql) naar SQL Editor en run.

Het script eindigt met open transaction. Bekijk de `NOTICE`-rapportage
en de SELECT-output:
- Aantal te mergen zendingen
- Welke oude factuur-nummers verwijderd worden
- Welke totalen verwacht zijn

Als alles klopt: `COMMIT;`. Anders: `ROLLBACK;`.

- [ ] **Step 8.5: Verifieer dat een gemergde factuur nu 2-regel-vorm heeft**

Vul de placeholder in voor de factuur die je net hebt gemerged (uit de
NOTICE-output van het merge-script of de nieuwste FACT van een
multi-order-debiteur):

```sql
-- Vervang '<FACTUUR_NR>' door bv. 'FACT-2026-0017' of de nieuwste:
--   (SELECT factuur_nr FROM facturen
--    WHERE debiteur_nr = <debiteur> ORDER BY id DESC LIMIT 1)
SELECT factuur_id, regelnummer, artikelnr, bedrag
  FROM factuur_regels
 WHERE factuur_id = (SELECT id FROM facturen WHERE factuur_nr = '<FACTUUR_NR>')
 ORDER BY regelnummer;
-- Verwacht (mits drempel gehaald):
--   ... product-regels ...
--   VERZEND        +35.00
--   BUNDELKORTING  -35.00
-- Saldo verzending: 0
```

Als een factuur **net was verstuurd vóór deploy**: hij valt onder E1 —
verschijnt op de feitenlijst, niet automatisch gerepareerd.

- [ ] **Step 8.6: Visuele verificatie in browser**

Start frontend dev-server:

```bash
cd frontend && npm run dev
```

Open een order van een (na deploy) gemergde factuur in browser. Verifieer:
- Banner zichtbaar in OrderFacturen-blok onderaan
- Klikbare order-nrs van bundle-partners
- Klikbare factuur-nr
- Tekst klopt voor het scenario (A of B)

- [ ] **Step 8.7: Geen commit nodig** — alleen handmatige deploy-actie.

---

## Wrap-up

Na alle taken:

- [ ] **Run finale typecheck + tests**

```bash
cd frontend && npx tsc --noEmit && npx vitest run
```

- [ ] **Push branch + open PR**

```bash
git push -u origin <branch-naam>
gh pr create --title "feat: bundel-korting zichtbaarheid op factuur en order-detail" \
  --body "$(cat <<'EOF'
## Summary
- Mig 256: `genereer_factuur_voor_bundel` produceert 2-regel-vorm (VERZEND + BUNDELKORTING) bij drempel-gehaald
- Frontend: `BundelKortingBanner` in OrderFacturen-blok, conditioneel per scenario
- Legacy verstuurde facturen: E1 (geen actie, alleen feitenlijst-script)

## Test plan
- [ ] Vitest groen
- [ ] Typecheck schoon
- [ ] Mig 252 + 254 + merge-script handmatig gedeployed in Supabase
- [ ] Feitenlijst-script run; output bewaard
- [ ] Visuele check banner in browser op gemergde Floorpassion-factuur
EOF
)"
```

---

## Edge-cases die het plan covert (uit grill-sessie)

| Edge-case | Gedrag |
|---|---|
| Order op meerdere facturen (split over vervoerders) | Per factuur een eigen banner — volgt uit L4 |
| Bundel valt uitelkaar vóór pickronde-voltooid | Geen banner, geen DB-rommel — volgt uit W3 |
| Wekelijkse facturatie-klanten | Banner verschijnt pas na maandag-cron — volgt uit W3 |
| Race: user op order-detail tijdens factuur-creatie | TanStack Query refetcht `useFacturenVoorOrder` bij window-focus; `useBundelInfoVoorFactuur` triggert pas wanneer factuur-id verschijnt. Geen real-time subscription nodig — banner verschijnt bij volgende refetch (max 60s via `staleTime`) |
| Klant met `gratis_verzending=TRUE` (klantafspraak) | Nooit banner (X2-redenering) — `heeftDrempelKorting=false` + 1-order factuur = geen multi-order |
| Solo-order op factuur | `isBundel=false` → banner rendert niets |
| Legacy verstuurde factuur met dubbele VERZEND | Detect zou per ongeluk `isBundel=true` zeggen — mitigatie: feitenlijst-script identificeert ze; in praktijk lopen ze niet door naar nieuwe weergave omdat ze niet via mig 256 zijn gemaakt |
