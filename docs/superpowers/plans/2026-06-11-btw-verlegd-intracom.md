# BTW verlegd intracommunautair — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** EU-verlegd-klanten (Duitsland, België, …) krijgen 0% BTW op factuur en orderbevestiging met de wettelijke vermelding "BTW verlegd", met `debiteuren.btw_verlegd_intracom` als bron van waarheid.

**Architectuur:** Eén centrale regel (`verlegd → 0%, anders btw_percentage`) als SQL-helper + TS-seam (patroon `_shared/debiteur-matcher.ts`). Snapshot-kolom `facturen.btw_verlegd` zodat PDF's achteraf weten dat 0% "verlegd" betekent. Géén data-update: de vlag staat al correct bij alle Duitse/EU-debiteuren.

**Tech Stack:** Supabase (PostgreSQL-migratie, Deno edge functions), React/TypeScript/Vite frontend, Deno-tests + Vitest.

**Spec:** [docs/superpowers/specs/2026-06-11-btw-verlegd-intracom-design.md](../specs/2026-06-11-btw-verlegd-intracom-design.md) — lees die eerst.

**Werklocatie:** worktree `C:\Users\migue\Documents\Karpi ERP\.claude\worktrees\btw-verlegd-intracom`, branch `feat/btw-verlegd-intracom`. Alle paden hieronder zijn relatief t.o.v. die worktree-root. NIET in de hoofd-tree werken (parallelle sessies). Commits op deze branch; **niet** naar main mergen — dat doet Miguel op commando.

**Belangrijke context:**
- Alleen `genereer_factuur_voor_bundel` (laatste definitie mig 341) is live; `genereer_factuur`/`genereer_factuur_voor_week` zijn gedropt door mig 240. De legacy-fallback-paden in `factuur-verzenden` die ernaar verwijzen blijven buiten scope (kunnen alleen al falen).
- EDI (`_shared/transus-formats/factuur-mapper.ts`, `download-orderbev-xml.ts`) checkt de verlegd-vlag al en blijft ongewijzigd. `bouw-factuur-edi` leest `factuur_regels.btw_percentage` — die wordt vanzelf 0 bij verlegd, consistent.
- Migratienummer **369** is gebaseerd op laatste = 368 op origin/main d.d. 2026-06-11. **Her-verifieer vlak vóór commit** (`ls supabase/migrations | sort | tail -3`) — nummer-collisies bij parallelle branches zijn eerder voorgekomen; schuif zo nodig op en pas alle verwijzingen (bestandsnaam + commentaar + docs) aan.
- Deno-tests draaien met `npx deno test <pad> --no-check` (conventie uit eerdere plannen). Frontend: `cd frontend && npx vitest run <pad>` en `npm run typecheck`.
- PowerShell 5.1-valkuil: tekstwijzigingen ALTIJD via de Edit-tool, nooit via `Get-Content`/`-replace` (mojibake op BOM-loos UTF-8).

---

### Task 1: TS-helper `_shared/btw.ts` (TDD)

**Files:**
- Create: `supabase/functions/_shared/btw.ts`
- Test: `supabase/functions/_shared/btw.test.ts`

- [ ] **Step 1: Schrijf de failing test**

```ts
// supabase/functions/_shared/btw.test.ts
// Deno test: `npx deno test supabase/functions/_shared/btw.test.ts --no-check`
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { effectiefBtwPct, isBtwVerlegd } from './btw.ts'

Deno.test('verlegd → 0%, ook als btw_percentage 21 is', () => {
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: true, btw_percentage: 21 }), 0)
})

Deno.test('niet-verlegd → btw_percentage van de debiteur', () => {
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: false, btw_percentage: 21 }), 21)
})

Deno.test('btw_percentage als string (PostgREST NUMERIC) → genummerd', () => {
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: false, btw_percentage: '9.00' }), 9)
})

Deno.test('NULL btw_percentage → fallback 21 (zelfde default als SQL)', () => {
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: false, btw_percentage: null }), 21)
})

Deno.test('expliciet 0% zonder verlegd-vlag blijft 0 (export-klant)', () => {
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: false, btw_percentage: 0 }), 0)
})

Deno.test('null/undefined debiteur → fallback 21, niet verlegd', () => {
  assertEquals(effectiefBtwPct(null), 21)
  assertEquals(effectiefBtwPct(undefined), 21)
  assertEquals(isBtwVerlegd(null), false)
})

Deno.test('isBtwVerlegd: alleen expliciet TRUE telt', () => {
  assertEquals(isBtwVerlegd({ btw_verlegd_intracom: true }), true)
  assertEquals(isBtwVerlegd({ btw_verlegd_intracom: false }), false)
  assertEquals(isBtwVerlegd({ btw_verlegd_intracom: null }), false)
  assertEquals(isBtwVerlegd({}), false)
})
```

- [ ] **Step 2: Run de test — verwacht FAIL**

Run: `npx deno test supabase/functions/_shared/btw.test.ts --no-check`
Expected: FAIL — module `./btw.ts` bestaat niet.

- [ ] **Step 3: Schrijf de implementatie**

```ts
// supabase/functions/_shared/btw.ts
// Eén bron-van-waarheid voor het effectieve BTW-percentage van een debiteur.
// Spiegelt de SQL-helper `effectief_btw_pct` (mig 369) — seam-patroon zoals
// _shared/debiteur-matcher.ts. De verlegd-vlag (intracommunautaire B2B-levering)
// wint altijd van het per-debiteur percentage; `btw_percentage` blijft het
// NL-tarief en wordt bij verlegd genegeerd.

export interface BtwDebiteur {
  btw_verlegd_intracom?: boolean | null
  btw_percentage?: number | string | null
}

export function isBtwVerlegd(deb: BtwDebiteur | null | undefined): boolean {
  return deb?.btw_verlegd_intracom === true
}

export function effectiefBtwPct(deb: BtwDebiteur | null | undefined): number {
  if (isBtwVerlegd(deb)) return 0
  if (deb?.btw_percentage == null) return 21
  const pct = Number(deb.btw_percentage)
  return Number.isFinite(pct) ? pct : 21
}
```

- [ ] **Step 4: Run de test — verwacht PASS**

Run: `npx deno test supabase/functions/_shared/btw.test.ts --no-check`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/btw.ts supabase/functions/_shared/btw.test.ts
git commit -m "feat(facturatie): TS-helper effectiefBtwPct/isBtwVerlegd (BTW verlegd intracom)"
```

---

### Task 2: Migratie 369 — SQL-helper + `facturen.btw_verlegd` + RPC

**Files:**
- Create: `supabase/migrations/369_btw_verlegd_facturatie.sql`

- [ ] **Step 1: Her-verifieer het migratienummer**

Run: `git fetch origin main --quiet; git show origin/main --stat --oneline -- supabase/migrations | head -5` en `ls supabase/migrations | sort | tail -3`
Expected: hoogste bestaande nummer 368 → dit bestand wordt 369. Bij collisie: hernummer en pas alle vermeldingen in deze plan-taak + docs aan.

- [ ] **Step 2: Schrijf de migratie**

De RPC-body is een exacte kopie van mig 341 met **drie wijzigingen**: (1) declaratie `v_btw_verlegd`, (2) `v_btw_pct` via de helper + vlag-snapshot, (3) `btw_verlegd` in de facturen-INSERT. Al het overige (kortingen, drempel, verzendkosten, betaaltermijn) blijft byte-voor-byte gelijk — kopieer uit `supabase/migrations/341_genereer_factuur_voor_bundel_betaaltermijn_helper.sql`.

```sql
-- Migratie 369: BTW verlegd intracommunautair in de facturatie-keten
--
-- Aanleiding: verzoek Marjon (2026-06-11) — Duitse klanten kregen 21% BTW op
-- facturen, terwijl debiteuren.btw_verlegd_intracom (mig 164) al correct op
-- TRUE staat. De factuur-RPC keek alleen naar debiteuren.btw_percentage.
-- EDI (factuur-mapper) checkte de vlag al → PDF en INVOIC spraken elkaar tegen.
--
-- Drie onderdelen:
--   1. effectief_btw_pct(verlegd, pct) — centrale regel, gespiegeld in
--      supabase/functions/_shared/btw.ts (seam-patroon debiteur-matcher).
--   2. facturen.btw_verlegd — snapshot op factuur-aanmaak-moment (zelfde
--      principe als facturen.btw_nummer, mig 125) zodat de PDF weet dat 0%
--      "verlegd" betekent en niet "0% tarief".
--   3. genereer_factuur_voor_bundel — enige live factuur-RPC (mig 240 dropte
--      genereer_factuur + genereer_factuur_voor_week) gebruikt de helper en
--      vult het snapshot. Body verder identiek aan mig 341.
--
-- Spec: docs/superpowers/specs/2026-06-11-btw-verlegd-intracom-design.md
-- Idempotent: CREATE OR REPLACE + ADD COLUMN IF NOT EXISTS.

-- 1. Centrale regel ---------------------------------------------------------
CREATE OR REPLACE FUNCTION effectief_btw_pct(p_verlegd BOOLEAN, p_btw_percentage NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN COALESCE(p_verlegd, FALSE) THEN 0::NUMERIC(5,2)
              ELSE COALESCE(p_btw_percentage, 21.00) END;
$$;

COMMENT ON FUNCTION effectief_btw_pct(BOOLEAN, NUMERIC) IS
  'Mig 369: effectief BTW-percentage voor een debiteur. Verlegd (intracom) '
  'wint altijd: 0%. Anders het per-debiteur percentage met fallback 21. '
  'Gespiegeld in supabase/functions/_shared/btw.ts (effectiefBtwPct).';

-- 2. Snapshot-kolom ---------------------------------------------------------
ALTER TABLE facturen ADD COLUMN IF NOT EXISTS btw_verlegd BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN facturen.btw_verlegd IS
  'Mig 369: snapshot van debiteuren.btw_verlegd_intracom op factuur-aanmaak. '
  'TRUE → 0% BTW met wettelijke vermelding "BTW verlegd" op de PDF.';

-- 3. RPC --------------------------------------------------------------------
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
  v_btw_verlegd          BOOLEAN := FALSE;
  v_betaaltermijn_dagen  INTEGER := 30;
  v_aantal_te_factureren INTEGER;
  v_order_ids            BIGINT[];
  v_subtotaal            NUMERIC(12,2);
  v_btw_bedrag           NUMERIC(12,2);
  v_totaal               NUMERIC(12,2);
  v_bundel_subtotaal     NUMERIC(12,2);
  v_is_afhalen           BOOLEAN;
  v_vk                   RECORD;
BEGIN
  -- [REGELS 34-61 VAN MIG 341 HIER ONGEWIJZIGD OVERNEMEN:
  --  p_zending_id-guard, zending-fetch, order_ids-verzameling,
  --  debiteur-grens-check, debiteur-fetch]

  v_btw_verlegd := COALESCE(v_debiteur.btw_verlegd_intracom, FALSE);
  v_btw_pct     := effectief_btw_pct(v_debiteur.btw_verlegd_intracom, v_debiteur.btw_percentage);
  v_betaaltermijn_dagen := betaaltermijn_dagen(v_debiteur.betaalconditie);

  -- [REGELS 66-76 VAN MIG 341: v_aantal_te_factureren-guard ONGEWIJZIGD]

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
    btw_verlegd
  ) VALUES (
    v_factuur_nr, v_debiteur.debiteur_nr, CURRENT_DATE,
    CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer,
    v_btw_verlegd
  ) RETURNING id INTO v_factuur_id;

  -- [REGELS 95-258 VAN MIG 341 HIER ONGEWIJZIGD OVERNEMEN:
  --  factuur_regels-INSERT, gefactureerd-UPDATE, verzendkosten/kortingen-blok,
  --  eindtotalen-UPDATE — v_btw_pct stroomt daar al doorheen]

  RETURN v_factuur_id;
END;
$$;

COMMENT ON FUNCTION genereer_factuur_voor_bundel(BIGINT) IS
  'Mig 369: BTW verlegd intracom — v_btw_pct via effectief_btw_pct() en '
  'btw_verlegd-snapshot op de factuur. Body verder identiek aan mig 341 '
  '(V2-layout, kortingen gespreid, betaaltermijn_dagen-helper).';

NOTIFY pgrst, 'reload schema';
```

**LET OP:** de `[REGELS x-y]`-markers zijn instructies aan jou, geen literale inhoud — vervang ze door de letterlijke blokken uit mig 341 zodat de functie compleet en draaibaar is. Verifieer dat het eindresultaat dezelfde regelstructuur heeft als mig 341 plus exact de drie genoemde wijzigingen (diff mig 341 ↔ 369 moet klein en leesbaar zijn).

- [ ] **Step 3: Syntax-sanity**

Run (alleen lezen, geen DB): controleer met `git diff --no-index supabase/migrations/341_genereer_factuur_voor_bundel_betaaltermijn_helper.sql supabase/migrations/369_btw_verlegd_facturatie.sql` dat het RPC-deel alleen de drie bedoelde afwijkingen heeft.
Expected: verschillen beperkt tot header-commentaar, helper + kolom-blok, `v_btw_verlegd`-declaratie/-toewijzing, facturen-INSERT en COMMENT.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/369_btw_verlegd_facturatie.sql
git commit -m "feat(facturatie): mig 369 — effectief_btw_pct, facturen.btw_verlegd, RPC verlegd-aware"
```

**NB:** de migratie wordt pas op de live DB toegepast in Task 10 (handmatig, projectconventie — `supabase db push` is verboden terrein).

---

### Task 3: `_shared/factuur-pdf.ts` — "BTW verlegd"-blok (TDD)

**Files:**
- Modify: `supabase/functions/_shared/factuur-pdf.ts` (interface `FactuurHeader` regel ~61-76, functie `drawBtwBlok` regel ~436-489)
- Test: `supabase/functions/_shared/factuur-pdf.test.ts`

- [ ] **Step 1: Schrijf de failing test (onderaan het bestaande testbestand toevoegen)**

```ts
Deno.test('genereerFactuurPDF: BTW verlegd — vermelding i.p.v. BTW-regel', async () => {
  const input: FactuurPDFInput = {
    ...MINIMAL_INPUT,
    factuur: {
      ...MINIMAL_INPUT.factuur,
      btw_percentage: 0,
      btw_bedrag: 0,
      totaal: 100,
      btw_verlegd: true,
      btw_nummer_afnemer: 'DE123456789',
    },
  }
  const bytes = await genereerFactuurPDF(input)
  assert(bytes.length > 500, 'PDF met BTW-verlegd-blok moet renderen')
})

Deno.test('genereerFactuurPDF: BTW verlegd zonder btw-nummer afnemer rendert ook', async () => {
  const input: FactuurPDFInput = {
    ...MINIMAL_INPUT,
    factuur: {
      ...MINIMAL_INPUT.factuur,
      btw_percentage: 0,
      btw_bedrag: 0,
      totaal: 100,
      btw_verlegd: true,
      btw_nummer_afnemer: null,
    },
  }
  const bytes = await genereerFactuurPDF(input)
  assert(bytes.length > 500)
})
```

- [ ] **Step 2: Run — verwacht FAIL (type-error op onbekende velden is bij `--no-check` géén fail, dus draai deze test mét check)**

Run: `npx deno test supabase/functions/_shared/factuur-pdf.test.ts --no-check`
Expected: tests draaien; omdat `--no-check` types negeert kunnen ze al slagen op rendering. Dat is acceptabel — de echte verificatie is Step 4 + de type-check in Step 5.

- [ ] **Step 3: Implementeer**

In `FactuurHeader` (na `totaal_gewicht_kg?: number`):

```ts
  // Mig 369: intracommunautaire verlegging. TRUE → geen BTW-regel maar de
  // wettelijke vermelding "BTW verlegd" + btw-nummer van de afnemer.
  btw_verlegd?: boolean
  btw_nummer_afnemer?: string | null
```

In `drawBtwBlok`, vervang het blok vanaf `// Header row: labels` t/m de values-row (regels ~464-480) door:

```ts
  // Header row: labels
  const SIZE_BOLD = 9
  const SIZE = 10
  if (factuur.btw_verlegd) {
    // Intracommunautaire verlegging: geen BTW-kolommen, wel de wettelijk
    // vereiste vermelding + btw-nummer van de afnemer.
    drawText(page, 'Grondsl.', MARGIN_L, y, bold, SIZE_BOLD)
    drawTextRight(page, 'Te Betalen', COL_BEDRAG, y, bold, SIZE_BOLD)

    y -= 1 * MM
    drawHLine(page, y)
    y -= LINE_H

    drawText(page, formatBedrag(factuur.subtotaal), MARGIN_L, y, regular, SIZE)
    drawTextRight(page, `${formatBedrag(factuur.totaal)} EUR`, COL_BEDRAG, y, regular, SIZE)
    y -= LINE_H

    const verlegdTekst = factuur.btw_nummer_afnemer
      ? `BTW verlegd — btw-nr afnemer: ${factuur.btw_nummer_afnemer}`
      : 'BTW verlegd'
    drawText(page, verlegdTekst, MARGIN_L, y, bold, SIZE_BOLD)
  } else {
    drawText(page, 'Grondsl.', MARGIN_L, y, bold, SIZE_BOLD)
    drawText(page, 'BTW %', MARGIN_L + 30 * MM, y, bold, SIZE_BOLD)
    drawText(page, 'BTWbedrag', MARGIN_L + 50 * MM, y, bold, SIZE_BOLD)
    drawTextRight(page, 'Te Betalen', COL_BEDRAG, y, bold, SIZE_BOLD)

    y -= 1 * MM
    drawHLine(page, y)
    y -= LINE_H

    drawText(page, formatBedrag(factuur.subtotaal), MARGIN_L, y, regular, SIZE)
    drawText(page, `${factuur.btw_percentage}`, MARGIN_L + 30 * MM, y, regular, SIZE)
    drawText(page, formatBedrag(factuur.btw_bedrag), MARGIN_L + 50 * MM, y, regular, SIZE)
    drawTextRight(page, `${formatBedrag(factuur.totaal)} EUR`, COL_BEDRAG, y, regular, SIZE)
  }
```

Let op: de oorspronkelijke `const SIZE = 10` stond ná de values-header — die declaratie is nu naar boven getrokken; verwijder de oude regel zodat er geen dubbele declaratie ontstaat. De afsluitende `y -= LINE_H`-regels en `Betalingscond.`-regel blijven ongewijzigd ná het if/else-blok.

- [ ] **Step 4: Run alle factuur-pdf-tests**

Run: `npx deno test supabase/functions/_shared/factuur-pdf.test.ts --no-check`
Expected: alle tests (8 bestaand + 2 nieuw) PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/factuur-pdf.ts supabase/functions/_shared/factuur-pdf.test.ts
git commit -m "feat(facturatie): factuur-PDF toont 'BTW verlegd' + btw-nr afnemer i.p.v. BTW-regel"
```

---

### Task 4: `factuur-verzenden` — snapshot doorgeven aan de PDF

**Files:**
- Modify: `supabase/functions/factuur-verzenden/index.ts` (interface `FactuurRow` regel ~44-59, PDF-bouw regel ~278-291)

- [ ] **Step 1: Breid `FactuurRow` uit** — voeg ná `totaal: number | string` toe:

```ts
  btw_verlegd: boolean | null
```

(De fetch is `select('*')` — geen query-wijziging nodig; `btw_nummer` zit al in de interface.)

- [ ] **Step 2: Geef de velden door in de PDF-bouw** — in het `factuur:`-object (na `totaal: Number(factuur.totaal),`):

```ts
          btw_verlegd: factuur.btw_verlegd === true,
          btw_nummer_afnemer: factuur.btw_nummer ?? null,
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/factuur-verzenden/index.ts
git commit -m "feat(facturatie): factuur-verzenden geeft btw_verlegd-snapshot door aan PDF"
```

---

### Task 5: `factuur-pdf` preview-function — zelfde doorgifte

**Files:**
- Modify: `supabase/functions/factuur-pdf/index.ts` (interface `FactuurRow` regel ~13-26, PDF-bouw regel ~318-333)

- [ ] **Step 1: Breid `FactuurRow` uit** — voeg ná `totaal: number | string` toe:

```ts
  btw_nummer: string | null
  btw_verlegd: boolean | null
```

(Fetch is `select('*')` op regel ~125 — geen query-wijziging.)

- [ ] **Step 2: Geef door in het `factuur:`-object** (na `totaal_gewicht_kg: ...`):

```ts
        btw_verlegd: factuur.btw_verlegd === true,
        btw_nummer_afnemer: factuur.btw_nummer ?? null,
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/factuur-pdf/index.ts
git commit -m "feat(facturatie): factuur-pdf preview rendert BTW-verlegd-vermelding"
```

---

### Task 6: Orderbevestiging — e-mail én PDF-bijlage verlegd-aware

**Files:**
- Modify: `supabase/functions/stuur-orderbevestiging/index.ts` (import-blok regel ~17, `VERTALINGEN`-type+4 talen regel ~45-140, debiteuren-select regel ~238, deb-type regel ~251, BTW-berekening regel ~306-313, PDF-aanroep regel ~359-382, HTML-tabel regel ~443-446)
- Modify: `supabase/functions/_shared/orderbevestiging-pdf.ts` (input-interface regel ~57-60, totaalblok regel ~370-372)

- [ ] **Step 1: Import de helper** (bij de bestaande `_shared`-imports):

```ts
import { effectiefBtwPct, isBtwVerlegd } from '../_shared/btw.ts'
```

- [ ] **Step 2: Select + type uitbreiden**

Regel ~238, voeg `btw_verlegd_intracom` toe aan de embedded debiteuren-select:

```ts
      debiteuren!orders_debiteur_nr_fkey(naam, email_factuur, email_overig, email_2, betaalconditie, btw_percentage, btw_verlegd_intracom)
```

In het deb-type (regel ~251, naast `btw_percentage: number | string | null`):

```ts
    btw_verlegd_intracom: boolean | null
```

- [ ] **Step 3: Vervang de BTW-berekening** (regels ~306-313):

```ts
  // BTW: zelfde bron-van-waarheid als genereer_factuur_voor_bundel (mig 369) —
  // verlegd-vlag wint, anders debiteuren.btw_percentage met fallback 21. Zo
  // lopen orderbevestiging en factuur niet uit elkaar.
  const btwVerlegd = isBtwVerlegd(deb)
  const btwPercentage = effectiefBtwPct(deb)
  const { subtotaal, btw_bedrag: btwBedrag, totaal } = berekenFactuurTotalen(
    regels.map((r) => ({ bedrag: r.bedrag ?? 0 })),
    btwPercentage,
  )
```

- [ ] **Step 4: `btwVerlegd`-vertaling toevoegen**

In het `VERTALINGEN`-type (na `btwOver: ...`):

```ts
  btwVerlegd: string
```

Per taal (na de `btwOver`-regel):

```ts
// nl:
    btwVerlegd: 'BTW verlegd',
// de:
    btwVerlegd: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)',
// fr:
    btwVerlegd: 'Autoliquidation de la TVA',
// en:
    btwVerlegd: 'VAT reverse charged',
```

- [ ] **Step 5: HTML-rij conditioneel maken** (regels ~443-446):

```ts
    <tr>
      <td style="padding: 6px 8px; text-align: right;" colspan="2">${btwVerlegd ? v.btwVerlegd : v.btwOver(formatBtwPercentage(btwPercentage), formatBedrag(subtotaal))}</td>
      <td style="padding: 6px 8px; text-align: right; white-space: nowrap;">${formatBedrag(btwBedrag)}</td>
    </tr>
```

- [ ] **Step 6: PDF-aanroep uitbreiden** — in de `genereerOrderbevestigingPDF({...})`-call (na `btw_percentage: btwPercentage,`):

```ts
    btw_verlegd: btwVerlegd,
```

- [ ] **Step 7: `orderbevestiging-pdf.ts` aanpassen**

Input-interface (na `btw_percentage: number`):

```ts
  btw_verlegd?: boolean
```

Totaalblok (regel ~370-372) — vervang de drie `drawTotaalRegel`-regels door:

```ts
  drawTotaalRegel('Totaalbedrag excl. btw', input.subtotaal, fontR, 8)
  if (input.btw_verlegd) {
    // Intracommunautaire verlegging: wettelijke vermelding i.p.v. BTW-regel.
    drawText(page, 'BTW verlegd', totaalLabelX, y, fontR, 8)
    y -= 11
  } else {
    drawTotaalRegel(`${formatBtwPercentage(input.btw_percentage)}% btw over ${formatBedrag(input.subtotaal)}`, input.btw_bedrag, fontR, 8)
  }
  drawTotaalRegel('Totaalbedrag incl. btw', input.totaal, fontB, 9)
```

- [ ] **Step 8: Draai bestaande deno-tests als regressiecheck**

Run: `npx deno test supabase/functions/_shared/ --no-check`
Expected: alles PASS (geen bestaande test raakt deze interface verplicht).

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/stuur-orderbevestiging/index.ts supabase/functions/_shared/orderbevestiging-pdf.ts
git commit -m "feat(orders): orderbevestiging (mail + PDF) toont BTW verlegd voor intracom-klanten"
```

---

### Task 7: Frontend — verlegd-toggle op klant-facturering-tab (TDD op de query)

**Files:**
- Modify: `frontend/src/modules/facturatie/queries/klant-factuur-instellingen.ts`
- Modify: `frontend/src/modules/debiteuren/components/klant-facturering-tab.tsx`
- Test: `frontend/src/modules/facturatie/__tests__/klant-factuur-instellingen.contract.test.ts`

- [ ] **Step 1: Pas de contract-test aan (failing first)** — vervang de bestaande fetch-test door:

```ts
describe('fetchKlantFactuurInstellingen', () => {
  it('selecteert btw_percentage + btw_verlegd_intracom + email_factuur uit debiteuren op debiteur_nr', async () => {
    nextResponse = {
      data: { btw_percentage: 21, btw_verlegd_intracom: true, email_factuur: 'a@b.nl' },
      error: null,
    }
    const r = await fetchKlantFactuurInstellingen(123)
    expect(supabaseCalls[0]).toMatchObject({
      op: 'select',
      table: 'debiteuren',
      cols: 'btw_percentage, btw_verlegd_intracom, email_factuur',
      col: 'debiteur_nr',
      val: 123,
    })
    expect(r).toEqual({ btw_percentage: 21, btw_verlegd_intracom: true, email_factuur: 'a@b.nl' })
  })
})
```

En voeg in de update-describe een test toe:

```ts
  it('kan btw_verlegd_intracom patchen', async () => {
    await updateKlantFactuurInstellingen(123, { btw_verlegd_intracom: false })
    expect(supabaseCalls[0]).toMatchObject({
      op: 'update',
      table: 'debiteuren',
      patch: { btw_verlegd_intracom: false },
      col: 'debiteur_nr',
      val: 123,
    })
  })
```

- [ ] **Step 2: Run — verwacht FAIL**

Run: `cd frontend; npx vitest run src/modules/facturatie/__tests__/klant-factuur-instellingen.contract.test.ts`
Expected: FAIL op `cols`-mismatch.

- [ ] **Step 3: Query uitbreiden** — in `klant-factuur-instellingen.ts`:

```ts
export interface KlantFactuurInstellingen {
  btw_percentage: number
  btw_verlegd_intracom: boolean | null
  email_factuur: string | null
}
```

en de select:

```ts
    .select('btw_percentage, btw_verlegd_intracom, email_factuur')
```

- [ ] **Step 4: Run — verwacht PASS**

Run: `cd frontend; npx vitest run src/modules/facturatie/__tests__/klant-factuur-instellingen.contract.test.ts`
Expected: PASS.

- [ ] **Step 5: UI-toggle + waarschuwing in `klant-facturering-tab.tsx`**

Destructuring (regel ~26-27) wordt:

```tsx
  const { email_factuur: emailFactuur, btw_percentage: btwPercentage } = instellingen
  const verlegd = instellingen.btw_verlegd_intracom === true
  const btwWaarschuwing = (btwPercentage === 0 || verlegd) && !btwNummer
```

Voeg een nieuwe sectie toe **vóór** de bestaande "BTW-percentage"-sectie:

```tsx
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">BTW verlegd (intracommunautair)</h3>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={verlegd}
            disabled={updateMut.isPending}
            onChange={(e) => patch({ btw_verlegd_intracom: e.currentTarget.checked })}
            className="h-4 w-4 rounded border-slate-300 accent-terracotta-500"
          />
          <span>BTW verleggen naar afnemer (EU B2B) — factuur en orderbevestiging rekenen 0%</span>
        </label>
        {verlegd && (
          <p className="mt-1 text-xs text-slate-400">
            Effectief tarief: <strong>0%</strong> met vermelding &ldquo;BTW verlegd&rdquo; op de factuur.
            Het BTW-percentage hieronder is het NL-tarief en wordt genegeerd zolang verlegd aan staat.
          </p>
        )}
      </section>
```

**Verplaats** de bestaande waarschuwing-paragraaf (nu regel ~126-131, onderaan de BTW-percentage-sectie) naar het einde van de nieuwe checkbox-sectie (direct na de `{verlegd && ...}`-paragraaf, binnen dezelfde `<section>`), met deze inhoud — één plek, niet dubbel tonen:

```tsx
        {btwWaarschuwing && (
          <p className="mt-2 text-xs text-amber-700">
            Let op: {verlegd ? 'BTW verlegd' : '0% BTW'} zonder btw-nummer. Intracommunautaire
            verlegging vereist een geldig btw-nummer bij de afnemer — vul dat in op de Info-tab.
          </p>
        )}
```

- [ ] **Step 6: Typecheck + volledige frontend-tests**

Run: `cd frontend; npm run typecheck; npx vitest run`
Expected: typecheck schoon; alle tests PASS behalve de **bekende pre-existing failure** `magazijn-pickbaarheid.contract.test.ts` (7/7, faalt ook op main — negeren).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/facturatie/queries/klant-factuur-instellingen.ts frontend/src/modules/facturatie/__tests__/klant-factuur-instellingen.contract.test.ts frontend/src/modules/debiteuren/components/klant-facturering-tab.tsx
git commit -m "feat(debiteuren): BTW-verlegd-toggle + waarschuwing op klant-facturering-tab"
```

---

### Task 8: Lijstje ontbrekende BTW-nummers voor Marjon

**Files:**
- Create: `import/check_verlegd_zonder_btw_nummer.py`

- [ ] **Step 1: Schrijf het script**

```python
"""Overzicht voor sales: actieve verlegd-debiteuren zonder btw-nummer.

BTW verleggen (intracommunautair, mig 369) vereist formeel een geldig
btw-nummer van de afnemer. Dit script print de actieve debiteuren met
btw_verlegd_intracom=TRUE waar dat nummer ontbreekt, zodat sales ze kan
aanvullen op de Info-tab van de klant.

Draaien vanuit de hoofd-tree (import/.env aanwezig): python check_verlegd_zonder_btw_nummer.py
"""
from config import SUPABASE_URL, SUPABASE_KEY
from supabase import create_client


def main() -> None:
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    rows = (
        sb.table('debiteuren')
        .select('debiteur_nr,naam,land,btw_nummer,status')
        .eq('btw_verlegd_intracom', True)
        .or_('status.is.null,status.neq.Inactief')  # actief = niet expliciet Inactief
        .execute()
        .data
    )
    zonder = [r for r in rows if not (r.get('btw_nummer') or '').strip()]
    print(f"Actieve verlegd-debiteuren zonder btw-nummer: {len(zonder)}")
    print(f"{'nr':>8}  {'land':<16} naam")
    for r in sorted(zonder, key=lambda r: ((r.get('land') or ''), r['debiteur_nr'])):
        print(f"{r['debiteur_nr']:>8}  {(r.get('land') or ''):<16} {r['naam']}")


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Draai het script**

LET OP: `import/config.py` leest een `.env` die **alleen in de hoofd-tree** staat (`C:\Users\migue\Documents\Karpi ERP\import`), niet in de worktree. Kopieer het script tijdelijk daarheen of draai het vanuit de hoofd-tree met expliciet pad.

Run: `cd "C:\Users\migue\Documents\Karpi ERP\import"; python "C:\Users\migue\Documents\Karpi ERP\.claude\worktrees\btw-verlegd-intracom\import\check_verlegd_zonder_btw_nummer.py"` — werkt niet direct omdat `config` via cwd geïmporteerd wordt; eenvoudigst: kopieer het bestand naar de hoofd-tree-`import/`, draai daar, verwijder de kopie.
Expected: ~19 rijen (17 DE + 1 BE + 1 DK, peildatum 2026-06-11). Bewaar de output voor in het eindrapport (dit lijstje gaat naar Marjon).

- [ ] **Step 3: Commit**

```bash
git add import/check_verlegd_zonder_btw_nummer.py
git commit -m "chore(debiteuren): script lijstje verlegd-debiteuren zonder btw-nummer"
```

---

### Task 9: Documentatie

**Files:**
- Modify: `docs/database-schema.md` (facturen-tabel + functies-sectie)
- Modify: `docs/changelog.md` (nieuwe entry bovenaan)
- Modify: `CLAUDE.md` (nieuwe bedrijfsregel-bullet)
- Modify: `docs/data-woordenboek.md` (begrip "BTW verlegd")

- [ ] **Step 1: database-schema.md** — bij de `facturen`-tabel de kolom toevoegen:

```markdown
| btw_verlegd | BOOLEAN | NOT NULL DEFAULT FALSE | Mig 369: snapshot van debiteuren.btw_verlegd_intracom op factuur-aanmaak. TRUE → 0% BTW + vermelding "BTW verlegd" op PDF. |
```

En bij de functies-lijst:

```markdown
- `effectief_btw_pct(p_verlegd BOOLEAN, p_btw_percentage NUMERIC) → NUMERIC` — mig 369: verlegd → 0, anders COALESCE(pct, 21). Gespiegeld in `supabase/functions/_shared/btw.ts`.
```

Volg de bestaande opmaak van het document (kijk hoe andere kolommen/functies er staan en sluit daarbij aan).

- [ ] **Step 2: changelog.md** — entry toevoegen volgens bestaand formaat (datum 2026-06-11):

```markdown
## 2026-06-11 — BTW verlegd intracommunautair (mig 369)
Duitse (en alle EU-verlegd-)klanten kregen 21% BTW op factuur en orderbevestiging terwijl `debiteuren.btw_verlegd_intracom` al correct stond (verzoek Marjon). De vlag is nu bron van waarheid: SQL-helper `effectief_btw_pct` + TS-seam `_shared/btw.ts`, snapshot `facturen.btw_verlegd`, factuur-PDF en orderbevestiging (mail + PDF, 4-talig) tonen "BTW verlegd" + btw-nr afnemer i.p.v. een BTW-regel. UI: verlegd-toggle op klant-facturering-tab. Geen data-update nodig; bestaande facturen (3) waren niet fout.
```

- [ ] **Step 3: CLAUDE.md** — bullet toevoegen aan "Bedrijfsregels":

```markdown
- **BTW verlegd intracommunautair (mig 369):** `debiteuren.btw_verlegd_intracom` (mig 164, staat correct bij alle DE/EU-debiteuren) is bron van waarheid voor het BTW-tarief: verlegd → 0%, anders `debiteuren.btw_percentage` (NL-tarief, blijft 21). Centrale regel: SQL `effectief_btw_pct(verlegd, pct)` ↔ TS [`_shared/btw.ts`](supabase/functions/_shared/btw.ts) (`effectiefBtwPct`/`isBtwVerlegd`, seam-patroon debiteur-matcher). `genereer_factuur_voor_bundel` (enige live factuur-RPC, mig 240 dropte de rest) schrijft snapshot `facturen.btw_verlegd`; factuur-PDF + orderbevestiging (mail + PDF) tonen dan "BTW verlegd — btw-nr afnemer: X" i.p.v. een BTW-regel. Ontbrekend btw-nummer blokkeert NIET (bewuste keuze) — amber waarschuwing op klant-facturering-tab + script `import/check_verlegd_zonder_btw_nummer.py`. EDI-factuur-mapper checkte de vlag al (ongewijzigd). `debiteuren.btw_percentage` op 0 zetten is NIET meer de route voor EU-klanten — gebruik de verlegd-toggle.
```

- [ ] **Step 4: data-woordenboek.md** — begrip toevoegen volgens bestaand formaat:

```markdown
### BTW verlegd (intracommunautair)
Bij B2B-levering aan een afnemer in een ander EU-land wordt de BTW "verlegd" naar de afnemer: Karpi factureert 0% en vermeldt "BTW verlegd" + het btw-nummer van de afnemer op de factuur; de klant draagt zelf BTW af in eigen land. Vlag: `debiteuren.btw_verlegd_intracom`; snapshot per factuur: `facturen.btw_verlegd`. Vereist formeel een geldig btw-nummer van de afnemer (`debiteuren.btw_nummer`) — ontbreekt dat, dan waarschuwt de klant-facturering-tab maar blokkeert niets.
```

- [ ] **Step 5: Commit**

```bash
git add docs/database-schema.md docs/changelog.md CLAUDE.md docs/data-woordenboek.md
git commit -m "docs: BTW verlegd intracommunautair (mig 369) — schema, changelog, bedrijfsregel, woordenboek"
```

---

### Task 10: Eindverificatie + uitrol-instructies (uitrol pas op commando Miguel)

- [ ] **Step 1: Volledige testronde**

```bash
npx deno test supabase/functions/_shared/ --no-check
cd frontend; npm run typecheck; npx vitest run; cd ..
```

Expected: deno alles PASS; typecheck schoon; vitest alles PASS m.u.v. pre-existing `magazijn-pickbaarheid.contract.test.ts` (7 failures, ook op main).

- [ ] **Step 2: Branch pushen**

```bash
git push -u origin feat/btw-verlegd-intracom
```

- [ ] **Step 3: Rapporteer aan Miguel** — met daarin:
  1. Het lijstje uit Task 8 (verlegd-debiteuren zonder btw-nummer) voor Marjon.
  2. De uitrol-volgorde ná zijn merge-akkoord (NIET zelf uitvoeren zonder akkoord):
     - **Eerst** migratie 369 handmatig toepassen (Supabase SQL editor / dashboard — projectconventie, `db push` niet gebruiken). De kolom moet bestaan vóór de functions deployen.
     - **Dan** edge functions deployen: `supabase functions deploy factuur-verzenden --project-ref wqzeevfobwauxkalagtn`, idem `factuur-pdf` en `stuur-orderbevestiging`.
     - Frontend gaat mee met de reguliere build na merge.
  3. Verificatie-recept na uitrol: maak voor een Duitse test-debiteur een factuur-preview (factuur-pdf function) en een orderbevestiging; check "BTW verlegd" + totaal == subtotaal; check NL-klant ongewijzigd 21%.

---

## Buiten scope (bewust)

- Legacy-fallback-paden in `factuur-verzenden` naar gedropte RPC's (mig 240) — kunnen alleen falen, opruimen is een aparte techdebt-taak.
- EDI factuur-mapper omhangen naar het `facturen.btw_verlegd`-snapshot — backlog (zie spec §7).
- Automatische land→verlegd-afleiding bij nieuwe debiteuren — afgewezen (YAGNI).
- Reparatie van bestaande facturen/orders — niets te repareren (3 facturen, geen één fout).
