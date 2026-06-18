# "Uw referentie:" (klant-eigennaam) op het verzendlabel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toon op elk verzendlabel een regel `Uw referentie: <eigennaam>` per colli, wanneer de klant een afwijkende naam voor de kwaliteit heeft (bron `klanteigen_namen`); anders ongewijzigd.

**Architecture:** Snapshot-aanpak, consistent met de bestaande colli-snapshots. Nieuwe kolom `zending_colli.klanteigen_naam_snapshot`, gevuld bij `genereer_zending_colli` via `resolve_klanteigen_naam(debiteur_nr, kwaliteit_code, kleur_code)` (op shipmoment bevroren) + backfill voor niet-verzonden zendingen. Query → `LabelItem` → de drie labelvarianten lezen puur het veld en renderen de regel.

**Tech Stack:** Supabase/PostgreSQL (PL/pgSQL migratie), React + TypeScript, Vitest. Spec: [docs/superpowers/specs/2026-06-18-label-uw-referentie-klanteigen-naam-design.md](../specs/2026-06-18-label-uw-referentie-klanteigen-naam-design.md).

**Werkomgeving:** worktree `.worktrees/label-uw-referentie`, branch `feat/label-uw-referentie`. Alle paden hieronder zijn relatief aan de worktree-root. Frontend-commando's draaien vanuit `frontend/`.

---

## File Structure

- **Create** `supabase/migrations/418_colli_klanteigen_naam_snapshot.sql` — kolom + `genereer_zending_colli`-superset + backfill.
- **Modify** `frontend/src/modules/logistiek/queries/zendingen.ts` — `ZendingPrintColli`-type + select-string.
- **Modify** `frontend/src/modules/logistiek/lib/printset.ts` — `LabelItem.klanteigenNaamSnapshot` + mapping in `bouwVerzenddocument`.
- **Modify** `frontend/src/modules/logistiek/lib/shipping-label-data.ts` — pure helper `klanteigenReferentie`.
- **Modify** `frontend/src/modules/logistiek/lib/printset.test.ts` — testdekking voor de doorgifte + helper.
- **Modify** `frontend/src/modules/logistiek/components/shipping-label.tsx` — prop + render (compact).
- **Modify** `frontend/src/modules/logistiek/components/shipping-label-tall.tsx` — render (staand).
- **Modify** `frontend/src/modules/logistiek/components/dpd-shipping-label.tsx` — prop + render (DPD).
- **Modify** `frontend/src/modules/logistiek/pages/zending-printset.tsx` + `bulk-printset.tsx` — prop doorgeven (4 render-sites).
- **Modify** `docs/changelog.md`, `docs/database-schema.md`, `CLAUDE.md` — documentatie.

---

## Task 1: Migratie 418 — kolom + genereer_zending_colli-superset + backfill

**Files:**
- Create: `supabase/migrations/418_colli_klanteigen_naam_snapshot.sql`

> **Migratienummer:** 417 is het hoogste in de repo bij het schrijven van dit plan. Her-verifieer vlak vóór merge t.o.v. `origin/main` (`ls supabase/migrations | grep -oE '^[0-9]+' | sort -n | tail -3`) en hernummer het bestand als 418 al geclaimd is — parallelle sessies claimen nummers (bekend collisierisico).

- [ ] **Step 1: Schrijf de migratie**

Maak `supabase/migrations/418_colli_klanteigen_naam_snapshot.sql` met exact deze inhoud. §2 is de **volledige mig 400-body** (gewicht-ladder + klant_omschrijving + lengte/breedte + de mig 400 product-join) met UITSLUITEND drie toevoegingen: `LEFT JOIN orders`, `kleur_code`-resolutie en de nieuwe `klanteigen_naam_snapshot`.

```sql
-- Migratie 418: klant-eigennaam voor de kwaliteit op het verzendlabel.
--
-- Sommige klanten hanteren een eigen naam voor een kwaliteit (bv. debiteur
-- noemt BEAC intern "BREDA"). Het oude systeem toonde die als regel
-- "Uw referentie: <naam>" op de verzendsticker, direct onder de kwaliteitscode.
-- Deze migratie bevriest die naam per colli zodat het label hem puur kan lezen
-- (zelfde snapshot-patroon als omschrijving_snapshot/lengte_cm).
--
-- Bron: tabel klanteigen_namen (mig 199/200) via resolve_klanteigen_naam(
--   debiteur_nr, kwaliteit_code, kleur_code) — exact dezelfde resolutie als de
-- maatwerk-sticker (mig 295, view snijplan_sticker_data). NULL = geen
-- afwijkende naam → het label toont geen "Uw referentie"-regel.
--
-- SUPERSET-DRIFT: §2 doet CREATE OR REPLACE genereer_zending_colli en is de
-- SUPERSET van mig 400 (= superset van 399 → 390 → 387). De complete mig
-- 400-body is hieronder overgenomen; toegevoegd zijn UITSLUITEND:
--   * LEFT JOIN orders o (voor o.debiteur_nr),
--   * kleur_code via COALESCE(ore.maatwerk_kleur_code, p.kleur_code),
--   * de nieuwe kolom klanteigen_naam_snapshot in de INSERT.
-- Verifieer bij apply met pg_get_functiondef dat de live-body exact deze
-- superset is.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + herhaalbare backfill.

-- ============================================================================
-- §1. Kolom
-- ============================================================================
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS klanteigen_naam_snapshot TEXT;

-- ============================================================================
-- §2. genereer_zending_colli — mig 400-superset + klant-eigennaam-snapshot
-- ============================================================================
CREATE OR REPLACE FUNCTION genereer_zending_colli(p_zending_id BIGINT)
RETURNS INTEGER AS $$
DECLARE
  v_aantal_aangemaakt INTEGER := 0;
  v_volgnr            INTEGER := 0;
  r                   RECORD;
  i                   INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM zendingen WHERE id = p_zending_id) THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  -- Skip als al colli's bestaan
  IF EXISTS (SELECT 1 FROM zending_colli WHERE zending_id = p_zending_id) THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT
      zr.id              AS zending_regel_id,
      zr.order_regel_id,
      zr.artikelnr,
      zr.rol_id,
      zr.aantal,
      ore.is_maatwerk,
      ore.maatwerk_lengte_cm::INTEGER  AS maatwerk_lengte_cm,
      ore.maatwerk_breedte_cm::INTEGER AS maatwerk_breedte_cm,
      ore.maatwerk_afwerking,
      ore.omschrijving    AS regel_omschrijving,
      ore.omschrijving_2  AS regel_omschrijving_2,
      p.omschrijving      AS product_naam,
      p.lengte_cm         AS prod_lengte_cm,
      p.breedte_cm        AS prod_breedte_cm,
      p.gewicht_kg        AS prod_gewicht_kg,
      ore.gewicht_kg      AS regel_gewicht_kg,
      COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code) AS kwaliteit_code,
      k.omschrijving      AS kwaliteit_naam,
      -- Mig 418: klant-eigennaam voor de kwaliteit, bevroren op shipmoment.
      -- NULL als de klant geen afwijkende naam heeft. Kwaliteit/kleur volgen
      -- dezelfde maatwerk→product-fallback als kwaliteit_code hierboven (en als
      -- snijplan_sticker_data, mig 295).
      resolve_klanteigen_naam(
        o.debiteur_nr,
        COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code),
        COALESCE(ore.maatwerk_kleur_code, p.kleur_code)
      ) AS klanteigen_naam
    FROM zending_regels zr
    LEFT JOIN order_regels ore ON ore.id = zr.order_regel_id
    -- Mig 418: orders erbij voor debiteur_nr (klant-eigennaam-resolve).
    LEFT JOIN orders o         ON o.id = ore.order_id
    -- Mig 400: join via het order_regel-artikel (zr.artikelnr is altijd NULL).
    LEFT JOIN producten p     ON p.artikelnr = COALESCE(ore.artikelnr, zr.artikelnr)
    LEFT JOIN kwaliteiten k   ON k.code = COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code)
    WHERE zr.zending_id = p_zending_id
    ORDER BY zr.id
  LOOP
    FOR i IN 1..GREATEST(r.aantal, 1) LOOP
      v_volgnr := v_volgnr + 1;
      INSERT INTO zending_colli (
        zending_id, colli_nr, order_regel_id, rol_id,
        sscc, gewicht_kg, omschrijving_snapshot, klant_omschrijving_snapshot,
        lengte_cm, breedte_cm, klanteigen_naam_snapshot, aantal
      ) VALUES (
        p_zending_id,
        v_volgnr,
        r.order_regel_id,
        r.rol_id,
        genereer_sscc(),
        -- Mig 387 gewicht-ladder: regel-cache (respecteert eventuele
        -- handmatige correctie; 0 = ontbreekt) → live resolver (vorm-aware,
        -- ook maatwerk) → product-cache als laatste vangnet.
        COALESCE(
          NULLIF(r.regel_gewicht_kg, 0),
          bereken_orderregel_gewicht_kg(r.order_regel_id),
          NULLIF(r.prod_gewicht_kg, 0)
        ),
        compose_colli_omschrijving(
          r.is_maatwerk, r.kwaliteit_code, r.kwaliteit_naam,
          r.maatwerk_lengte_cm, r.maatwerk_breedte_cm, r.maatwerk_afwerking,
          r.product_naam, r.prod_lengte_cm, r.prod_breedte_cm
        ),
        -- Mig 390: bevroren klant-omschrijving (single source voor label/pakbon).
        compose_klant_omschrijving(r.regel_omschrijving, r.regel_omschrijving_2),
        -- Mig 399/400: bevroren afmetingen (single source voor Rhenus/Verhoek) —
        -- carrier-ladder maatwerk → product, nu met werkende product-join.
        COALESCE(r.maatwerk_lengte_cm,  r.prod_lengte_cm),
        COALESCE(r.maatwerk_breedte_cm, r.prod_breedte_cm),
        -- Mig 418: bevroren klant-eigennaam voor de kwaliteit (of NULL).
        r.klanteigen_naam,
        1
      );
      v_aantal_aangemaakt := v_aantal_aangemaakt + 1;
    END LOOP;
  END LOOP;

  UPDATE zendingen SET aantal_colli = v_aantal_aangemaakt WHERE id = p_zending_id;

  RETURN v_aantal_aangemaakt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION genereer_zending_colli(BIGINT) TO authenticated;

COMMENT ON FUNCTION genereer_zending_colli(BIGINT) IS
  'Mig 418 (superset van mig 400 → 399 → 390 → 387): gewicht-ladder + '
  'klant_omschrijving_snapshot + lengte_cm/breedte_cm + klanteigen_naam_snapshot '
  '(klant-eigennaam voor de kwaliteit via resolve_klanteigen_naam). 1 colli per '
  'stuk, idempotent, SSCC + alle snapshots per colli — single source voor label, '
  'pakbon en carrier-XML.';

-- ============================================================================
-- §3. Backfill — klant-eigennaam voor niet-verzonden zendingen
-- ============================================================================
-- Alleen de nieuwe kolom; lengte/omschrijving zijn al correct uit mig 400.
-- Verzonden/afgeleverde zendingen bewust ongemoeid: historie zoals verzonden
-- (die hadden de regel nooit als snapshot).
UPDATE zending_colli zc
SET klanteigen_naam_snapshot = resolve_klanteigen_naam(
      o.debiteur_nr,
      COALESCE(ore.maatwerk_kwaliteit_code, p.kwaliteit_code),
      COALESCE(ore.maatwerk_kleur_code, p.kleur_code)
    )
FROM zending_regels zr
JOIN order_regels ore  ON ore.id = zr.order_regel_id
JOIN orders o          ON o.id = ore.order_id
LEFT JOIN producten p  ON p.artikelnr = COALESCE(ore.artikelnr, zr.artikelnr)
JOIN zendingen z       ON z.id = zr.zending_id
WHERE zr.zending_id = zc.zending_id
  AND zr.order_regel_id = zc.order_regel_id
  AND z.status NOT IN ('Onderweg', 'Afgeleverd');

-- ============================================================================
-- §4. Verifier-rapport
-- ============================================================================
DO $$
DECLARE
  v_met_naam INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_met_naam
  FROM zending_colli
  WHERE klanteigen_naam_snapshot IS NOT NULL;
  RAISE NOTICE 'Mig 418: colli met een klant-eigennaam-snapshot: % (0 is OK als geen niet-verzonden zending een klanteigen_namen-match heeft)', v_met_naam;
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verifieer de migratie tegen mig 400 (drift-check op papier)**

Run (vanuit de worktree-root): `git diff --no-index supabase/migrations/400_colli_artikelnr_join_fix.sql supabase/migrations/418_colli_klanteigen_naam_snapshot.sql`

(of open beide bestanden naast elkaar.) Bevestig dat het verschil in de `genereer_zending_colli`-functie UITSLUITEND bestaat uit: de `LEFT JOIN orders o`-regel, de `resolve_klanteigen_naam(...) AS klanteigen_naam`-SELECT-kolom, en de `klanteigen_naam_snapshot`-kolom + `r.klanteigen_naam`-waarde in de INSERT. Geen enkele andere regel van de gewicht-/omschrijving-/afmeting-logica mag afwijken.

Expected: alleen de drie genoemde toevoegingen verschillen.

> **Apply naar de live DB gebeurt handmatig bij deploy** (db push is in dit project bewust gevaarlijk — migraties worden los toegepast). Niet in deze taak; dit is een code-only artefact. Bij apply: draai `pg_get_functiondef('genereer_zending_colli'::regproc)` en vergelijk met §2.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/418_colli_klanteigen_naam_snapshot.sql
git commit -m "feat(label): mig 418 — klanteigen_naam_snapshot op zending_colli"
```

---

## Task 2: Query — ZendingPrintColli-type + select

**Files:**
- Modify: `frontend/src/modules/logistiek/queries/zendingen.ts` (interface `ZendingPrintColli` ~regel 93-104; select ~regel 299)

- [ ] **Step 1: Voeg het veld toe aan de interface**

Vervang in `frontend/src/modules/logistiek/queries/zendingen.ts` het einde van de `ZendingPrintColli`-interface:

```ts
  /** Mig 388: bevroren, ontdubbelde klant-omschrijving (order_regels.omschrijving
   *  + _2). Single source voor de klant-naam op label/pakbon — niet meer live. */
  klant_omschrijving_snapshot: string | null
}
```

door:

```ts
  /** Mig 388: bevroren, ontdubbelde klant-omschrijving (order_regels.omschrijving
   *  + _2). Single source voor de klant-naam op label/pakbon — niet meer live. */
  klant_omschrijving_snapshot: string | null
  /** Mig 418: klant-eigennaam voor de kwaliteit (bv. "BREDA"), bevroren via
   *  resolve_klanteigen_naam. null = geen afwijkende naam → geen "Uw referentie"-regel. */
  klanteigen_naam_snapshot: string | null
}
```

- [ ] **Step 2: Voeg het veld toe aan de select**

Vervang in dezelfde file de `zending_colli`-select-regel:

```ts
      zending_colli ( id, colli_nr, sscc, order_regel_id, omschrijving_snapshot, klant_omschrijving_snapshot )
```

door:

```ts
      zending_colli ( id, colli_nr, sscc, order_regel_id, omschrijving_snapshot, klant_omschrijving_snapshot, klanteigen_naam_snapshot )
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/logistiek/queries/zendingen.ts
git commit -m "feat(label): lees klanteigen_naam_snapshot in de zending-printset-query"
```

---

## Task 3: Data-laag — LabelItem + bouwVerzenddocument + helper (TDD)

**Files:**
- Modify: `frontend/src/modules/logistiek/lib/printset.test.ts`
- Modify: `frontend/src/modules/logistiek/lib/printset.ts` (`LabelItem` ~regel 23-47; `bouwVerzenddocument` colli-map ~regel 180-192 en legacy-map ~regel 204-213)
- Modify: `frontend/src/modules/logistiek/lib/shipping-label-data.ts`

- [ ] **Step 1: Schrijf de falende tests**

In `frontend/src/modules/logistiek/lib/printset.test.ts`:

(a) breid de `maakColli`-helper uit met het nieuwe veld. Vervang:

```ts
function maakColli(overrides: Partial<ZendingPrintColli> = {}): ZendingPrintColli {
  return {
    id: 1,
    colli_nr: 1,
    sscc: '087159540000000656',
    order_regel_id: 10,
    omschrijving_snapshot: null,
    klant_omschrijving_snapshot: null,
    ...overrides,
  }
}
```

door:

```ts
function maakColli(overrides: Partial<ZendingPrintColli> = {}): ZendingPrintColli {
  return {
    id: 1,
    colli_nr: 1,
    sscc: '087159540000000656',
    order_regel_id: 10,
    omschrijving_snapshot: null,
    klant_omschrijving_snapshot: null,
    klanteigen_naam_snapshot: null,
    ...overrides,
  }
}
```

(b) voeg de `klanteigenReferentie`-import toe. Vervang de import-block:

```ts
import {
  labelDatumKort,
  labelReferentie,
  productMaat,
  productNamen,
} from './shipping-label-data'
```

door:

```ts
import {
  klanteigenReferentie,
  labelDatumKort,
  labelReferentie,
  productMaat,
  productNamen,
} from './shipping-label-data'
```

(c) voeg dit nieuwe `describe`-blok onderaan het bestand toe:

```ts
// Mig 418: klant-eigennaam voor de kwaliteit ("Uw referentie") — bevroren in
// zending_colli.klanteigen_naam_snapshot, puur doorgegeven aan het label.
describe('expandLabels — klant-eigennaam-snapshot (Uw referentie)', () => {
  it('draagt de klanteigen-naam door op het LabelItem', () => {
    const zending = maakZending({
      zending_regels: [maakRegel()],
      zending_colli: [maakColli({ klanteigen_naam_snapshot: 'BREDA' })],
    })

    const [label] = expandLabels(zending)

    expect(label.klanteigenNaamSnapshot).toBe('BREDA')
  })

  it('colli zonder eigennaam → null (geen Uw-referentie-regel)', () => {
    const zending = maakZending({
      zending_regels: [maakRegel()],
      zending_colli: [maakColli()],
    })

    const [label] = expandLabels(zending)

    expect(label.klanteigenNaamSnapshot).toBeNull()
  })

  it('legacy-zending zonder colli-rijen → klanteigenNaamSnapshot null', () => {
    const zending = maakZending({
      zending_regels: [maakRegel()],
      zending_colli: [],
    })

    const [label] = expandLabels(zending)

    expect(label.klanteigenNaamSnapshot).toBeNull()
  })

  it('klanteigenReferentie: leeg/whitespace → null, anders getrimd', () => {
    expect(klanteigenReferentie(null)).toBeNull()
    expect(klanteigenReferentie('')).toBeNull()
    expect(klanteigenReferentie('   ')).toBeNull()
    expect(klanteigenReferentie('  BREDA  ')).toBe('BREDA')
  })
})
```

- [ ] **Step 2: Run de tests — verifieer falen**

Run (vanuit `frontend/`): `npx vitest run src/modules/logistiek/lib/printset.test.ts`
Expected: FAIL — `klanteigenReferentie` is geen export, en `label.klanteigenNaamSnapshot` bestaat niet (TS/property-fouten).

- [ ] **Step 3: Voeg de helper toe aan shipping-label-data.ts**

Voeg onderaan `frontend/src/modules/logistiek/lib/shipping-label-data.ts` toe:

```ts
/**
 * Klant-eigennaam voor de kwaliteit (bv. "BREDA"), bevroren in
 * `zending_colli.klanteigen_naam_snapshot` (mig 418). Leeg/whitespace → null
 * zodat de "Uw referentie"-regel alleen verschijnt bij een echte afwijkende
 * naam. Eén plek voor de niet-leeg-check, gedeeld door de drie labelvarianten.
 */
export function klanteigenReferentie(snapshot: string | null | undefined): string | null {
  const v = (snapshot ?? '').trim()
  return v === '' ? null : v
}
```

- [ ] **Step 4: Voeg het veld toe aan LabelItem**

In `frontend/src/modules/logistiek/lib/printset.ts`, vervang het einde van de `LabelItem`-interface:

```ts
  /** Bron-order (uit `order_regels.order_id`, fallback de primaire order) —
   * voedt de pakbon-groepering per bron-order (mig 222). */
  orderId: number | null
}
```

door:

```ts
  /** Bron-order (uit `order_regels.order_id`, fallback de primaire order) —
   * voedt de pakbon-groepering per bron-order (mig 222). */
  orderId: number | null
  /** Mig 418: bevroren klant-eigennaam voor de kwaliteit ("Uw referentie" op
   * het label). `null` = geen afwijkende naam / legacy-colli. */
  klanteigenNaamSnapshot: string | null
}
```

- [ ] **Step 5: Map het veld in bouwVerzenddocument (colli-pad)**

In `frontend/src/modules/logistiek/lib/printset.ts`, vervang in de colli-map (binnen `if (colli.length > 0)`):

```ts
        orderId: orderIdVoor(regel),
        omschrijvingSnapshot: c.omschrijving_snapshot,
        klantOmschrijvingSnapshot: c.klant_omschrijving_snapshot,
      }
    })
```

door:

```ts
        orderId: orderIdVoor(regel),
        omschrijvingSnapshot: c.omschrijving_snapshot,
        klantOmschrijvingSnapshot: c.klant_omschrijving_snapshot,
        klanteigenNaamSnapshot: c.klanteigen_naam_snapshot,
      }
    })
```

- [ ] **Step 6: Map het veld in bouwVerzenddocument (legacy-pad)**

In dezelfde file, vervang in de legacy-map (binnen de `else`-tak):

```ts
      orderRegelId: regel?.order_regel_id ?? null,
      orderId: orderIdVoor(regel),
      omschrijvingSnapshot: null,
      klantOmschrijvingSnapshot: null,
    }))
```

door:

```ts
      orderRegelId: regel?.order_regel_id ?? null,
      orderId: orderIdVoor(regel),
      omschrijvingSnapshot: null,
      klantOmschrijvingSnapshot: null,
      klanteigenNaamSnapshot: null,
    }))
```

- [ ] **Step 7: Run de tests — verifieer slagen**

Run (vanuit `frontend/`): `npx vitest run src/modules/logistiek/lib/printset.test.ts`
Expected: PASS — alle bestaande + 4 nieuwe assertions groen.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/logistiek/lib/printset.ts frontend/src/modules/logistiek/lib/shipping-label-data.ts frontend/src/modules/logistiek/lib/printset.test.ts
git commit -m "feat(label): klanteigen-naam-snapshot op LabelItem + helper (TDD)"
```

---

## Task 4: Label-componenten — prop + render in 3 varianten + callers

**Files:**
- Modify: `frontend/src/modules/logistiek/components/shipping-label.tsx`
- Modify: `frontend/src/modules/logistiek/components/shipping-label-tall.tsx`
- Modify: `frontend/src/modules/logistiek/components/dpd-shipping-label.tsx`
- Modify: `frontend/src/modules/logistiek/pages/zending-printset.tsx`
- Modify: `frontend/src/modules/logistiek/pages/bulk-printset.tsx`

- [ ] **Step 1: Voeg de prop toe aan ShippingLabelProps (shipping-label.tsx)**

In `frontend/src/modules/logistiek/components/shipping-label.tsx`, vervang in de `ShippingLabelProps`-interface:

```ts
  omschrijvingSnapshot: string | null
  klantOmschrijvingSnapshot: string | null
  labelFormaat?: LabelFormaat
}
```

door:

```ts
  omschrijvingSnapshot: string | null
  klantOmschrijvingSnapshot: string | null
  /** Mig 418: klant-eigennaam voor de kwaliteit (`zending_colli.klanteigen_naam_snapshot`).
   * null/leeg → geen "Uw referentie"-regel. */
  klanteigenNaamSnapshot: string | null
  labelFormaat?: LabelFormaat
}
```

- [ ] **Step 2: Importeer de helper + render in het compacte label (shipping-label.tsx)**

(a) Vervang de import uit shipping-label-data:

```ts
import {
  labelDatumKort,
  labelReferentie,
  productMaat,
  productNamen,
} from '@/modules/logistiek/lib/shipping-label-data'
```

door:

```ts
import {
  klanteigenReferentie,
  labelDatumKort,
  labelReferentie,
  productMaat,
  productNamen,
} from '@/modules/logistiek/lib/shipping-label-data'
```

(b) Voeg `klanteigenNaamSnapshot` toe aan de destructuring van `ShippingLabelCompact`. Vervang:

```ts
  sscc,
  omschrijvingSnapshot,
  klantOmschrijvingSnapshot,
  breedteMm,
  hoogteMm,
}: ShippingLabelProps & { breedteMm: number; hoogteMm: number }) {
  const order = zending.orders
  const snapshot = { omschrijvingSnapshot, klantOmschrijvingSnapshot }
  const namen = productNamen(regel, snapshot)
```

door:

```ts
  sscc,
  omschrijvingSnapshot,
  klantOmschrijvingSnapshot,
  klanteigenNaamSnapshot,
  breedteMm,
  hoogteMm,
}: ShippingLabelProps & { breedteMm: number; hoogteMm: number }) {
  const order = zending.orders
  const snapshot = { omschrijvingSnapshot, klantOmschrijvingSnapshot }
  const namen = productNamen(regel, snapshot)
  const uwReferentie = klanteigenReferentie(klanteigenNaamSnapshot)
```

(c) Render de regel direct onder de vetgedrukte kwaliteitscode. Vervang:

```tsx
          {namen.klantNaam}
          {maat ? ` - ${maat}` : ''}
        </div>
        {toonKarpi && (
          <div
            style={{
              fontSize: fz(6),
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {namen.karpiNaam}
          </div>
        )}
```

door:

```tsx
          {namen.klantNaam}
          {maat ? ` - ${maat}` : ''}
        </div>
        {uwReferentie && (
          <div
            style={{
              fontSize: fz(6),
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Uw referentie: {uwReferentie}
          </div>
        )}
        {toonKarpi && (
          <div
            style={{
              fontSize: fz(6),
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {namen.karpiNaam}
          </div>
        )}
```

- [ ] **Step 3: Render in het staande label (shipping-label-tall.tsx)**

(a) Vervang de import uit shipping-label-data:

```ts
import {
  labelDatumKort,
  labelReferentie,
  productMaat,
  productNamen,
} from '@/modules/logistiek/lib/shipping-label-data'
```

door:

```ts
import {
  klanteigenReferentie,
  labelDatumKort,
  labelReferentie,
  productMaat,
  productNamen,
} from '@/modules/logistiek/lib/shipping-label-data'
```

(b) Voeg `klanteigenNaamSnapshot` toe aan de destructuring + bereken `uwReferentie`. Vervang:

```ts
  sscc,
  omschrijvingSnapshot,
  klantOmschrijvingSnapshot,
  breedteMm,
  hoogteMm,
}: ShippingLabelProps & { breedteMm: number; hoogteMm: number }) {
  const order = zending.orders
  const snapshot = { omschrijvingSnapshot, klantOmschrijvingSnapshot }
  const namen = productNamen(regel, snapshot)
```

door:

```ts
  sscc,
  omschrijvingSnapshot,
  klantOmschrijvingSnapshot,
  klanteigenNaamSnapshot,
  breedteMm,
  hoogteMm,
}: ShippingLabelProps & { breedteMm: number; hoogteMm: number }) {
  const order = zending.orders
  const snapshot = { omschrijvingSnapshot, klantOmschrijvingSnapshot }
  const namen = productNamen(regel, snapshot)
  const uwReferentie = klanteigenReferentie(klanteigenNaamSnapshot)
```

(c) Render de regel onder de vetgedrukte kwaliteitscode in rij 2. Vervang:

```tsx
          {namen.klantNaam}
          {maat ? ` - ${maat}` : ''}
        </div>
        {toonKarpi && (
          <div
            style={{
              fontSize: '9px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {namen.karpiNaam}
          </div>
        )}
```

door:

```tsx
          {namen.klantNaam}
          {maat ? ` - ${maat}` : ''}
        </div>
        {uwReferentie && (
          <div
            style={{
              fontSize: '9px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Uw referentie: {uwReferentie}
          </div>
        )}
        {toonKarpi && (
          <div
            style={{
              fontSize: '9px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {namen.karpiNaam}
          </div>
        )}
```

- [ ] **Step 4: Render in het DPD-label (dpd-shipping-label.tsx)**

(a) Vervang de import uit shipping-label-data:

```ts
import {
  labelDatumKort,
  labelReferentie,
  productNamen,
} from '@/modules/logistiek/lib/shipping-label-data'
```

door:

```ts
import {
  klanteigenReferentie,
  labelDatumKort,
  labelReferentie,
  productNamen,
} from '@/modules/logistiek/lib/shipping-label-data'
```

(b) Voeg de prop toe aan de `Props`-interface. Vervang:

```ts
  omschrijvingSnapshot: string | null
  klantOmschrijvingSnapshot: string | null
}
```

door:

```ts
  omschrijvingSnapshot: string | null
  klantOmschrijvingSnapshot: string | null
  /** Mig 418: klant-eigennaam voor de kwaliteit. null/leeg → geen "Uw referentie"-regel. */
  klanteigenNaamSnapshot: string | null
}
```

(c) Voeg `klanteigenNaamSnapshot` toe aan de destructuring + bereken `uwReferentie`. Vervang:

```ts
  sscc,
  omschrijvingSnapshot,
  klantOmschrijvingSnapshot,
}: Props) {
  const order = zending.orders
  // Single source (mig 388): één omschrijving-bron, gelijk aan label/pakbon/
  // vervoerder — geen eigen DPD-afleiding meer.
  const namen = productNamen(regel, { omschrijvingSnapshot, klantOmschrijvingSnapshot })
```

door:

```ts
  sscc,
  omschrijvingSnapshot,
  klantOmschrijvingSnapshot,
  klanteigenNaamSnapshot,
}: Props) {
  const order = zending.orders
  // Single source (mig 388): één omschrijving-bron, gelijk aan label/pakbon/
  // vervoerder — geen eigen DPD-afleiding meer.
  const namen = productNamen(regel, { omschrijvingSnapshot, klantOmschrijvingSnapshot })
  const uwReferentie = klanteigenReferentie(klanteigenNaamSnapshot)
```

(d) Render de regel onder de klantnaam. Vervang:

```tsx
            <div className="mt-0.5 text-[8px] font-semibold leading-snug">
              {namen.klantNaam}
            </div>
            {toonKarpi && (
              <div className="text-[7px] leading-snug">{namen.karpiNaam}</div>
            )}
```

door:

```tsx
            <div className="mt-0.5 text-[8px] font-semibold leading-snug">
              {namen.klantNaam}
            </div>
            {uwReferentie && (
              <div className="text-[7px] font-semibold leading-snug">Uw referentie: {uwReferentie}</div>
            )}
            {toonKarpi && (
              <div className="text-[7px] leading-snug">{namen.karpiNaam}</div>
            )}
```

- [ ] **Step 5: Geef de prop door op alle 4 render-sites**

In `frontend/src/modules/logistiek/pages/zending-printset.tsx` én `frontend/src/modules/logistiek/pages/bulk-printset.tsx` staat zowel een `<DpdShippingLabel ...>` als een `<ShippingLabel ...>`. In elk van de 4 gevallen staat de regel:

```tsx
                klantOmschrijvingSnapshot={label.klantOmschrijvingSnapshot}
```

Voeg er telkens direct ná toe:

```tsx
                klanteigenNaamSnapshot={label.klanteigenNaamSnapshot}
```

(Let op de inspringing: in `bulk-printset.tsx` is dat 16 spaties, in `zending-printset.tsx` 16 spaties — neem de bestaande inspringing van de `klantOmschrijvingSnapshot`-regel ernaast over.)

- [ ] **Step 6: Typecheck**

Run (vanuit `frontend/`): `npm run typecheck`
Expected: PASS — geen ontbrekende-prop-fouten (alle 4 render-sites leveren nu `klanteigenNaamSnapshot`).

- [ ] **Step 7: Run de testsuite van de module**

Run (vanuit `frontend/`): `npx vitest run src/modules/logistiek/`
Expected: PASS — printset.test.ts + pakbon-document.test.tsx ongewijzigd groen (de pakbon raakt het veld niet).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/logistiek/components/shipping-label.tsx frontend/src/modules/logistiek/components/shipping-label-tall.tsx frontend/src/modules/logistiek/components/dpd-shipping-label.tsx frontend/src/modules/logistiek/pages/zending-printset.tsx frontend/src/modules/logistiek/pages/bulk-printset.tsx
git commit -m "feat(label): toon 'Uw referentie' (klant-eigennaam) op alle drie labelvarianten"
```

---

## Task 5: Documentatie + finale verificatie

**Files:**
- Modify: `docs/changelog.md`
- Modify: `docs/database-schema.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: changelog.md**

Voeg bovenaan de chronologische lijst in `docs/changelog.md` een entry toe (volg het bestaande format van de andere entries — datum 2026-06-18, wat + waarom):

```markdown
## 2026-06-18 — "Uw referentie" (klant-eigennaam) op verzendlabel
- `zending_colli.klanteigen_naam_snapshot` (mig 418): klant-eigennaam voor de
  kwaliteit, bevroren bij `genereer_zending_colli` via `resolve_klanteigen_naam`
  (bron `klanteigen_namen`, mig 199/200). De drie labelvarianten tonen een regel
  "Uw referentie: <naam>" onder de kwaliteitscode, alleen als de klant een
  afwijkende naam heeft. Snapshot-aanpak zoals omschrijving_snapshot; reeds
  verzonden zendingen ongemoeid (backfill alleen niet-verzonden).
```

- [ ] **Step 2: database-schema.md**

Zoek in `docs/database-schema.md` de tabel `zending_colli` op en voeg de kolom `klanteigen_naam_snapshot` (TEXT, nullable — "klant-eigennaam voor de kwaliteit, mig 418") toe aan de kolomlijst, in de stijl van de andere kolommen daar (controleer hoe `omschrijving_snapshot`/`lengte_cm` genoteerd staan en spiegel dat).

- [ ] **Step 3: CLAUDE.md-bullet**

Breid in `CLAUDE.md` de bestaande bullet **"Colli-omschrijving + afmetingen = `zending_colli`-snapshot"** uit met één zin over mig 418: dat `klanteigen_naam_snapshot` óók in `genereer_zending_colli` bevroren wordt (superset-keten 400→418), via `resolve_klanteigen_naam`, en de drie labelvarianten een "Uw referentie"-regel tonen onder de kwaliteitscode. Houd het kort en in de stijl van de omliggende bullets.

- [ ] **Step 4: Finale verificatie**

Run (vanuit `frontend/`): `npm run typecheck && npx vitest run src/modules/logistiek/`
Expected: PASS — typecheck schoon, alle logistiek-tests groen.

- [ ] **Step 5: Commit**

```bash
git add docs/changelog.md docs/database-schema.md CLAUDE.md
git commit -m "docs(label): mig 418 klanteigen_naam_snapshot + 'Uw referentie'-regel"
```

---

## Na implementatie (buiten de taken)

- **Print-test door de gebruiker:** de visuele plaatsing + marges van de "Uw referentie"-regel op de drie fysieke labelformaten worden door Miguel via een echte print geverifieerd vóór merge/deploy (de assistent claimt dit niet zelf als "geverifieerd" — print-marge-valkuil).
- **Deploy-volgorde:** mig 418 op de live DB toepassen (handmatig) vóór de frontend-deploy — de printset-query leest de nieuwe kolom. Bij apply: `pg_get_functiondef`-drift-check op `genereer_zending_colli`.
- **Merge:** pas naar `main` op expliciet commando van Miguel.
```
