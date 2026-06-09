# HST-observability + altijd-een-vervoerder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De HST-verzendkoppeling productie-klaar maken vóór opschaling naar honderden orders/dag: fouten zichtbaar + zelfhelend maken, en garanderen dat elke niet-afhaal-order een vervoerder krijgt (HST als default binnen NL).

**Architecture:** Twee pijlers met één gedeeld scharnier. Pijler A (observability): HST-foutmeldingen correct parsen, een zelfhelende reaper voor vastgelopen rijen, een aggregaat-monitoringview + in-app overzichtspagina + rode badge/banner. Pijler B (altijd-een-vervoerder): een catch-all `vervoerder_selectie_regel` maakt HST de default binnen NL; buiten bereik blijft de order zichtbaar als "handmatig kiezen". Het scharnier is een pure, gedeelde pre-flight validator die HST's eisen (telefoon, adres, land) kent en zowel de UI-vlag als de laatste poort in `hst-send` voedt.

**Tech Stack:** Supabase Postgres (plpgsql migraties, idempotent), Deno edge functions (`hst-send`), React + TypeScript + TanStack Query + Tailwind frontend. Tests: `deno test` voor edge/`_shared`-logica, Vitest voor frontend.

---

## Omgeving & uitvoerings-conventies (LEES EERST)

- **Werkdirectory = de worktree:** `C:/Users/migue/Documents/karpi-hst-observability`, branch `feat/hst-observability-vervoerder-default`. Alle paden hieronder zijn relatief t.o.v. die map.
- **Migraties worden handmatig toegepast.** De Supabase-MCP heeft géén toegang tot dit project (zie projectgeheugen). De executie-agent **maakt** de migratiebestanden en levert per migratie een **verificatie-SQL**, maar het daadwerkelijk uitvoeren op de database doet Miguel (of de agent via `npx supabase db push` *alleen als hij expliciet geautoriseerd is en de CLI geauthenticeerd is*). Markeer elke migratie-apply als een checkpoint waarop je Miguel om bevestiging vraagt vóór je verdergaat met stappen die de DB-wijziging nodig hebben.
- **Migratienummering:** hoogste bestaande = `334`. Nieuwe migraties starten op `335` en lopen op in de hieronder vastgelegde volgorde.
- **Deno-tests draaien** vanuit de repo-root, bv. `deno test supabase/functions/hst-send/payload-builder.test.ts --allow-env`. Volg de invocatie van bestaande tests (`supabase/functions/_shared/debiteur-matcher.test.ts`) als referentie; voeg `--allow-env`/`--allow-net` alleen toe als de test ze nodig heeft.
- **Frontend-tests draaien** vanuit `frontend/`: `npm run test -- <pad>` (Vitest). Typecheck: `npm run build` of `npx tsc --noEmit` in `frontend/`.
- **Commit na elke taak.** Conventie: `type(scope): omschrijving` in het Nederlands, met trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Levende docs bijwerken** gebeurt in Slice 6 (niet vergeten — projectregel).

---

## File Structure

**Nieuw:**
- `supabase/migrations/335_zending_afl_telefoon.sql` — kolom + BEFORE INSERT-trigger die `zendingen.afl_telefoon` vult (order → fallback debiteur).
- `supabase/migrations/336_vervoerder_default_hst.sql` — `vervoerders.is_default` + catch-all HST-regel (`land=['NL']`).
- `supabase/migrations/337_herstel_vastgelopen_hst.sql` — reaper-RPC voor vastgelopen `Bezig`-rijen.
- `supabase/migrations/338_hst_verzend_monitor.sql` — aggregaat-view + `orders_zonder_vervoerder`-view.
- `supabase/functions/_shared/vervoerder-eisen.ts` — pure pre-flight validator (Deno/TS).
- `supabase/functions/_shared/vervoerder-eisen.test.ts` — deno-tests voor de validator.
- `frontend/src/lib/orders/vervoerder-eisen.ts` — frontend-spiegel van de validator (re-export/kopie van de pure functie).
- `frontend/src/modules/logistiek/queries/hst-monitor.ts` — query's: monitor-cijfers + tellers.
- `frontend/src/modules/logistiek/hooks/use-hst-monitor.ts` — TanStack-hooks.
- `frontend/src/modules/logistiek/pages/hst-monitor.tsx` — overzichtspagina `/logistiek/hst-monitor`.
- `frontend/src/modules/logistiek/components/hst-aandacht-banner.tsx` — rode badge/banner (EDI-patroon).

**Gewijzigd:**
- `supabase/functions/hst-send/hst-client.ts` — `extractErrorMsg` leest ook `ErrorMessage`.
- `supabase/functions/hst-send/types.ts` — `ZendingInput.afl_telefoon`.
- `supabase/functions/hst-send/payload-builder.ts` — `PhoneNumber` uit `afl_telefoon`.
- `supabase/functions/hst-send/payload-builder.test.ts` — test voor telefoon.
- `supabase/functions/hst-send/hst-client.test.ts` — (nieuw bestand of bestaand) test voor `ErrorMessage`.
- `supabase/functions/hst-send/index.ts` — `afl_telefoon` in de zending-select + reaper-aanroep + pre-flight-poort.
- `frontend/src/router.tsx` — route `logistiek/hst-monitor`.
- `frontend/src/modules/logistiek/index.ts` — export nieuwe page/hook/banner.
- `frontend/src/modules/magazijn/pages/...` (Pick & Ship-overzicht) — banner inhaken.
- Logistiek-navigatie (sidebar) — link + badge.
- `docs/*`, `CLAUDE.md`, `docs/adr/*`.

---

## SLICE 1 — Bugfix ErrorMessage + telefoonnummer in payload

Lost direct het ACCP-400-incident op: echte HST-foutmelding wordt zichtbaar én het telefoonnummer wordt meegestuurd.

### Task 1.1 — `extractErrorMsg` leest HST's `ErrorMessage`

**Files:**
- Modify: `supabase/functions/hst-send/hst-client.ts:131-148`
- Test: `supabase/functions/hst-send/hst-client.test.ts` (nieuw)

- [ ] **Step 1: Schrijf de falende test**

Maak `supabase/functions/hst-send/hst-client.test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { extractErrorMsgVoorTest } from './hst-client.ts';

Deno.test('extractErrorMsg leest HST PascalCase ErrorMessage', () => {
  const body = { Success: false, ErrorMessage: 'Bellen voor aflevering. Geef een telefoonnummer op.' };
  assertEquals(
    extractErrorMsgVoorTest(body, 400),
    'Bellen voor aflevering. Geef een telefoonnummer op.',
  );
});

Deno.test('extractErrorMsg valt terug op HTTP-code bij leeg body', () => {
  assertEquals(extractErrorMsgVoorTest(null, 503), 'HTTP 503');
});

Deno.test('extractErrorMsg leest lowercase message ook nog', () => {
  assertEquals(extractErrorMsgVoorTest({ message: 'kapot' }, 500), 'kapot');
});
```

- [ ] **Step 2: Run test → faalt**

Run: `deno test supabase/functions/hst-send/hst-client.test.ts`
Expected: FAIL — `extractErrorMsgVoorTest` bestaat niet (niet geëxporteerd).

- [ ] **Step 3: Pas `extractErrorMsg` aan + exporteer test-alias**

In `hst-client.ts`, vervang de functie `extractErrorMsg` (regels ~131-148) door:

```ts
// deno-lint-ignore no-explicit-any
function extractErrorMsg(body: any, status: number): string {
  if (body && typeof body === 'object') {
    return (
      body.ErrorMessage ??   // HST gebruikt dit veld (PascalCase) — zónder dit kreeg de operator kaal "HTTP 400"
      body.message ??
      body.Message ??
      body.error ??
      body.Error ??
      body.detail ??
      body.errorMessage ??
      `HTTP ${status}`
    );
  }
  if (typeof body === 'string' && body.trim().length > 0) {
    return body.slice(0, 500);
  }
  return `HTTP ${status}`;
}

// Test-alias: extractErrorMsg is bewust module-privé; deze export ontsluit 'm
// puur voor de unit-test zonder de publieke API te vergroten.
export function extractErrorMsgVoorTest(body: unknown, status: number): string {
  // deno-lint-ignore no-explicit-any
  return extractErrorMsg(body as any, status);
}
```

- [ ] **Step 4: Run test → slaagt**

Run: `deno test supabase/functions/hst-send/hst-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hst-send/hst-client.ts supabase/functions/hst-send/hst-client.test.ts
git commit -m "fix(hst): parse HST ErrorMessage-veld i.p.v. kaal HTTP-statuscode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.2 — Migratie 335: `zendingen.afl_telefoon` + vul-trigger

**Files:**
- Create: `supabase/migrations/335_zending_afl_telefoon.sql`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 335: zendingen.afl_telefoon (leveringscontact voor HST) + vul-trigger
--
-- HST eist een telefoonnummer voor "bellen voor aflevering". De payload-builder
-- stuurde dit veld altijd leeg → ACCP-afkeuring 2026-06-09. We snapshotten het
-- leveringstelefoonnummer op de zending zodat hst-send het meestuurt.
--
-- Bron-ladder: orders.afl_telefoon (leveringscontact) → fallback debiteuren.telefoon.
-- Via BEFORE INSERT-trigger zodat élke zending-aanmaakroute (start_pickronden,
-- create_zending_voor_order, bundel) hem vult zonder die functies te herschrijven.
--
-- Idempotent.

ALTER TABLE zendingen ADD COLUMN IF NOT EXISTS afl_telefoon TEXT;

COMMENT ON COLUMN zendingen.afl_telefoon IS
  'Snapshot leveringstelefoonnummer voor de vervoerder (HST belt vóór aflevering). '
  'Gevuld door trg_zending_fill_telefoon: orders.afl_telefoon → fallback debiteuren.telefoon.';

CREATE OR REPLACE FUNCTION fn_zending_fill_telefoon() RETURNS TRIGGER AS $$
BEGIN
  IF NULLIF(TRIM(COALESCE(NEW.afl_telefoon, '')), '') IS NOT NULL THEN
    RETURN NEW;  -- expliciet gezet → respecteren
  END IF;

  SELECT NULLIF(TRIM(COALESCE(o.afl_telefoon, '')), '')
    INTO NEW.afl_telefoon
    FROM orders o
   WHERE o.id = NEW.order_id;

  IF NULLIF(TRIM(COALESCE(NEW.afl_telefoon, '')), '') IS NULL THEN
    SELECT NULLIF(TRIM(COALESCE(d.telefoon, '')), '')
      INTO NEW.afl_telefoon
      FROM orders o
      JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
     WHERE o.id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_zending_fill_telefoon ON zendingen;
CREATE TRIGGER trg_zending_fill_telefoon
  BEFORE INSERT ON zendingen
  FOR EACH ROW EXECUTE FUNCTION fn_zending_fill_telefoon();

-- Backfill: bestaande zendingen die nog niet verstuurd zijn, alsnog vullen.
UPDATE zendingen z
   SET afl_telefoon = COALESCE(
         NULLIF(TRIM(COALESCE(o.afl_telefoon, '')), ''),
         NULLIF(TRIM(COALESCE(d.telefoon, '')), '')
       )
  FROM orders o
  LEFT JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
 WHERE o.id = z.order_id
   AND NULLIF(TRIM(COALESCE(z.afl_telefoon, '')), '') IS NULL
   AND z.status NOT IN ('Onderweg', 'Afgeleverd');

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verificatie-SQL (na apply door Miguel)**

```sql
-- Kolom bestaat:
SELECT column_name FROM information_schema.columns
 WHERE table_name='zendingen' AND column_name='afl_telefoon';
-- Trigger bestaat:
SELECT tgname FROM pg_trigger WHERE tgname='trg_zending_fill_telefoon';
-- Smoke: maak in een testorder een zending en check dat afl_telefoon gevuld is.
```

- [ ] **Step 3: Checkpoint** — vraag Miguel de migratie toe te passen vóór Task 1.4 (de edge function leest deze kolom).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/335_zending_afl_telefoon.sql
git commit -m "feat(hst): zendingen.afl_telefoon + vul-trigger (order > debiteur)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.3 — Payload-builder stuurt `PhoneNumber` mee

**Files:**
- Modify: `supabase/functions/hst-send/types.ts:18-29` (ZendingInput)
- Modify: `supabase/functions/hst-send/payload-builder.ts:112-127` (bouwAddressUitZending)
- Test: `supabase/functions/hst-send/payload-builder.test.ts`

- [ ] **Step 1: Voeg `afl_telefoon` toe aan `ZendingInput`**

In `types.ts`, binnen `interface ZendingInput` (na `afl_land`):

```ts
  afl_land: string | null;
  afl_telefoon: string | null;
```

- [ ] **Step 2: Schrijf de falende test**

Voeg toe aan `payload-builder.test.ts` (gebruik de bestaande imports/fixture-stijl in dat bestand; onderstaande test is zelfstandig leesbaar):

```ts
Deno.test('bouwTransportOrderPayload zet ToAddress.PhoneNumber uit afl_telefoon', () => {
  const payload = bouwTransportOrderPayload({
    zending: {
      zending_nr: 'ZEND-2026-9999', afl_naam: 'Klant', afl_adres: 'Teststraat 1',
      afl_postcode: '1111AA', afl_plaats: 'Diemen', afl_land: 'NL',
      afl_telefoon: '0612345678', totaal_gewicht_kg: 5, aantal_colli: 1,
      opmerkingen: null, verzenddatum: '2026-06-09',
    },
    order: { order_nr: 'ORD-2026-9999' },
    bedrijf: {
      bedrijfsnaam: 'Karpi B.V.', adres: 'Tweede Broekdijk 10', postcode: '7122LB',
      plaats: 'Aalten', land: 'NL', telefoon: '0543476116', email: 'info@karpi.nl',
    },
    hstCustomerId: '038267',
    colli: [{ colli_nr: 1, sscc: '087159540000000632', gewicht_kg: 5, omschrijving_snapshot: 'Tapijt' }],
  });
  assertEquals(payload.ToAddress.PhoneNumber, '0612345678');
});
```

- [ ] **Step 3: Run test → faalt**

Run: `deno test supabase/functions/hst-send/payload-builder.test.ts`
Expected: FAIL — `PhoneNumber` is `''` (en/of type-fout op ontbrekend `afl_telefoon`).

- [ ] **Step 4: Vul `PhoneNumber` in `bouwAddressUitZending`**

In `payload-builder.ts`, in `bouwAddressUitZending`, vervang `PhoneNumber: '',` door:

```ts
    PhoneNumber: zending.afl_telefoon ?? '',
```

- [ ] **Step 5: Run test → slaagt**

Run: `deno test supabase/functions/hst-send/payload-builder.test.ts`
Expected: PASS (incl. bestaande tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/hst-send/types.ts supabase/functions/hst-send/payload-builder.ts supabase/functions/hst-send/payload-builder.test.ts
git commit -m "feat(hst): stuur leveringstelefoonnummer mee in ToAddress.PhoneNumber

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.4 — `hst-send` haalt `afl_telefoon` op

**Files:**
- Modify: `supabase/functions/hst-send/index.ts:130-137` (zending-select)

- [ ] **Step 1: Voeg `afl_telefoon` toe aan de zending-select**

In `index.ts`, in `verwerkRow`, breid de select-string uit:

```ts
    .select(
      'zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, ' +
        'afl_telefoon, totaal_gewicht_kg, aantal_colli, opmerkingen, verzenddatum',
    )
```

- [ ] **Step 2: Typecheck**

Run: `deno check supabase/functions/hst-send/index.ts`
Expected: geen type-fouten (de cast `zending as ZendingInput` dekt het nieuwe veld nu).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/hst-send/index.ts
git commit -m "feat(hst): lees zendingen.afl_telefoon mee in hst-send

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## SLICE 2 — Pre-flight validator-seam

Pure, gedeelde validator die HST's eisen kent. Twee aanroep-punten: hst-send (laatste poort) en frontend (UI-vlag, ingehaakt in Slice 3/5).

### Task 2.1 — Gedeelde validator `vervoerder-eisen.ts`

**Files:**
- Create: `supabase/functions/_shared/vervoerder-eisen.ts`
- Test: `supabase/functions/_shared/vervoerder-eisen.test.ts`

- [ ] **Step 1: Schrijf de falende tests**

`supabase/functions/_shared/vervoerder-eisen.test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { valideerVoorVervoerder } from './vervoerder-eisen.ts';

const basis = {
  vervoerder_code: 'hst_api',
  afl_land: 'NL', afl_telefoon: '0612345678',
  afl_naam: 'Klant', afl_adres: 'Teststraat 1', afl_postcode: '1111 AA', afl_plaats: 'Diemen',
};

Deno.test('valideerVoorVervoerder: complete order is ok', () => {
  const r = valideerVoorVervoerder(basis);
  assertEquals(r.ok, true);
  assertEquals(r.problemen.length, 0);
});

Deno.test('valideerVoorVervoerder: ontbrekend telefoonnummer faalt', () => {
  const r = valideerVoorVervoerder({ ...basis, afl_telefoon: null });
  assertEquals(r.ok, false);
  assertEquals(r.problemen[0].code, 'TELEFOON_ONTBREEKT');
});

Deno.test('valideerVoorVervoerder: te kort telefoonnummer faalt', () => {
  const r = valideerVoorVervoerder({ ...basis, afl_telefoon: '0612' });
  assertEquals(r.problemen[0].code, 'TELEFOON_ONTBREEKT');
});

Deno.test('valideerVoorVervoerder: land buiten bereik faalt', () => {
  const r = valideerVoorVervoerder({ ...basis, afl_land: 'BE' });
  assertEquals(r.ok, false);
  assertEquals(r.problemen.some((p) => p.code === 'LAND_BUITEN_BEREIK'), true);
});

Deno.test('valideerVoorVervoerder: leeg adres faalt op velden', () => {
  const r = valideerVoorVervoerder({ ...basis, afl_adres: '', afl_plaats: '' });
  assertEquals(r.ok, false);
  assertEquals(r.problemen.some((p) => p.code === 'ADRESVELD_LEEG'), true);
});

Deno.test('valideerVoorVervoerder: niet-HST vervoerder wordt overgeslagen', () => {
  const r = valideerVoorVervoerder({ ...basis, vervoerder_code: 'edi_partner_a', afl_telefoon: null });
  assertEquals(r.ok, true); // alleen HST-regels in v1
});
```

- [ ] **Step 2: Run → faalt**

Run: `deno test supabase/functions/_shared/vervoerder-eisen.test.ts`
Expected: FAIL — module bestaat niet.

- [ ] **Step 3: Schrijf de validator**

`supabase/functions/_shared/vervoerder-eisen.ts`:

```ts
// Gedeelde pre-flight validator: kent de eisen van de logistieke partijen vóór
// verzending. V1 dekt alleen HST (enige actieve API-vervoerder). Puur — geen
// DB/secrets — zodat zowel de edge function (laatste poort) als de frontend
// (waarschuwingsvlag) dezelfde uitkomst gebruiken. Spiegelt de seam-aanpak van
// _shared/debiteur-matcher.ts.

export interface VerzendContext {
  vervoerder_code: string;
  afl_land: string | null;
  afl_telefoon: string | null;
  afl_naam: string | null;
  afl_adres: string | null;
  afl_postcode: string | null;
  afl_plaats: string | null;
}

export interface VerzendProbleem {
  code: 'TELEFOON_ONTBREEKT' | 'ADRESVELD_LEEG' | 'ADRES_ONSPLITSBAAR' | 'LAND_BUITEN_BEREIK';
  veld: string;
  melding: string;
}

export interface VerzendValidatie {
  ok: boolean;
  problemen: VerzendProbleem[];
}

// HST bedient in V1 alleen NL. Uitbreiden = land toevoegen (en de catch-all-regel
// in mig 336 meegroeien). Centrale lijst zodat UI en edge gelijk lopen.
export const HST_LANDEN_BEREIK = ['NL'];

function leeg(s: string | null | undefined): boolean {
  return !s || s.trim().length === 0;
}

function telefoonGeldig(tel: string | null | undefined): boolean {
  if (leeg(tel)) return false;
  const cijfers = (tel as string).replace(/\D/g, '');
  return cijfers.length >= 10 && cijfers.length <= 15;
}

export function valideerVoorVervoerder(ctx: VerzendContext): VerzendValidatie {
  const problemen: VerzendProbleem[] = [];

  // V1: alleen HST heeft eisen. Andere vervoerders → geen pre-flight (ok).
  if (ctx.vervoerder_code !== 'hst_api') {
    return { ok: true, problemen };
  }

  if (!telefoonGeldig(ctx.afl_telefoon)) {
    problemen.push({
      code: 'TELEFOON_ONTBREEKT',
      veld: 'afl_telefoon',
      melding: 'Telefoonnummer (10–15 cijfers) ontbreekt — HST belt vóór aflevering.',
    });
  }

  if (leeg(ctx.afl_naam) || leeg(ctx.afl_adres) || leeg(ctx.afl_postcode) || leeg(ctx.afl_plaats)) {
    problemen.push({
      code: 'ADRESVELD_LEEG',
      veld: 'afl_adres',
      melding: 'Naam, adres, postcode of plaats is leeg.',
    });
  }

  const land = (ctx.afl_land ?? '').trim().toUpperCase();
  if (!HST_LANDEN_BEREIK.includes(land)) {
    problemen.push({
      code: 'LAND_BUITEN_BEREIK',
      veld: 'afl_land',
      melding: `HST bedient ${land || '(leeg)'} niet — kies handmatig een vervoerder.`,
    });
  }

  return { ok: problemen.length === 0, problemen };
}
```

- [ ] **Step 4: Run → slaagt**

Run: `deno test supabase/functions/_shared/vervoerder-eisen.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/vervoerder-eisen.ts supabase/functions/_shared/vervoerder-eisen.test.ts
git commit -m "feat(vervoerder): gedeelde pre-flight validator (HST-eisen v1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2.2 — Poort in `hst-send` vóór de POST

**Files:**
- Modify: `supabase/functions/hst-send/index.ts` (import + check in `verwerkRow`, vóór `postTransportOrder`)

- [ ] **Step 1: Importeer de validator**

Boven in `index.ts` bij de imports:

```ts
import { valideerVoorVervoerder } from '../_shared/vervoerder-eisen.ts';
```

- [ ] **Step 2: Voeg de poort toe vóór stap 3 (de POST)**

In `verwerkRow`, ná het bouwen van `payload` (stap 2) en vóór `postTransportOrder` (stap 3), voeg in:

```ts
  // Pre-flight: kies geen kansloze POST. Faalt een vervoerder-eis → direct als
  // Fout wegschrijven met heldere reden, zónder HST te bellen.
  const preflight = valideerVoorVervoerder({
    vervoerder_code: 'hst_api',
    afl_land: zending.afl_land,
    afl_telefoon: (zending as { afl_telefoon?: string | null }).afl_telefoon ?? null,
    afl_naam: zending.afl_naam,
    afl_adres: zending.afl_adres,
    afl_postcode: zending.afl_postcode,
    afl_plaats: zending.afl_plaats,
  });
  if (!preflight.ok) {
    const reden = 'Pre-flight: ' + preflight.problemen.map((p) => p.melding).join(' | ');
    await markFout(supabase, row.id, reden);
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: 'preflight' });
    return;
  }
```

- [ ] **Step 3: Typecheck**

Run: `deno check supabase/functions/hst-send/index.ts`
Expected: geen fouten.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/hst-send/index.ts
git commit -m "feat(hst): pre-flight-poort in hst-send blokkeert kansloze POST

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## SLICE 3 — Pijler B: altijd een vervoerder (HST default binnen NL)

### Task 3.1 — Migratie 336: `is_default` + catch-all HST-regel

**Files:**
- Create: `supabase/migrations/336_vervoerder_default_hst.sql`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 336: HST als default-vervoerder binnen NL
--
-- ADR: altijd-een-vervoerder. Een niet-afhaal-order zonder matchende regel bleef
-- als 'bron=geen' liggen en ging nooit de deur uit. Zolang HST de enige koppeling
-- is, wordt HST de default — maar alleen binnen z'n bereik (NL). Buiten NL blijft
-- 'bron=geen' → zichtbaar als "handmatig vervoerder kiezen" (geen stille HST-toewijzing).
--
-- Mechanisme: catch-all vervoerder_selectie_regel met laagste prio en conditie
-- {land:['NL']}. De bestaande ladder (mig 225: override > regel > geen) levert dan
-- vanzelf HST binnen NL via de regel-evaluator. Specifieke regels (lagere prio)
-- winnen nog steeds. Plus is_default-vlag als toekomst-marker (2e vervoerder = vlag om).
--
-- Idempotent.

ALTER TABLE vervoerders ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN vervoerders.is_default IS
  'Markeert de huidige default-vervoerder. Hooguit één TRUE (partial unique index). '
  'Catch-all selectie-regel verwijst hiernaar conceptueel; bij 2e vervoerder vlag omzetten.';

-- Hooguit één default tegelijk.
CREATE UNIQUE INDEX IF NOT EXISTS uk_vervoerders_is_default
  ON vervoerders (is_default) WHERE is_default = TRUE;

UPDATE vervoerders SET is_default = TRUE
 WHERE code = 'hst_api'
   AND NOT EXISTS (SELECT 1 FROM vervoerders WHERE is_default = TRUE);

-- Catch-all HST-regel (NL). Alleen toevoegen als er nog geen default-NL-regel staat,
-- zodat re-apply geen duplicaat maakt.
INSERT INTO vervoerder_selectie_regels (vervoerder_code, prio, conditie, service_code, notitie)
SELECT 'hst_api', 99999, jsonb_build_object('land', ARRAY['NL']), NULL,
       'Default-vervoerder binnen NL (mig 336) — laagste prio, specifieke regels winnen.'
 WHERE EXISTS (SELECT 1 FROM vervoerders WHERE code = 'hst_api' AND actief = TRUE)
   AND NOT EXISTS (
     SELECT 1 FROM vervoerder_selectie_regels
      WHERE vervoerder_code = 'hst_api' AND prio = 99999
        AND conditie = jsonb_build_object('land', ARRAY['NL'])
   );

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verificatie-SQL (na apply)**

```sql
-- Vlag gezet:
SELECT code, is_default FROM vervoerders WHERE is_default = TRUE;  -- verwacht: hst_api
-- Catch-all bestaat:
SELECT id, prio, conditie FROM vervoerder_selectie_regels WHERE prio = 99999;
-- Gedrag: pak een NL-order zonder specifieke regel en controleer dat
-- effectieve_vervoerder_per_orderregel nu 'hst_api' (bron='regel') geeft:
SELECT orderregel_id, effectief_code, bron
  FROM effectieve_vervoerder_per_orderregel(<NL_ORDER_ID>);
-- En een BE-order blijft bron='geen':
SELECT orderregel_id, effectief_code, bron
  FROM effectieve_vervoerder_per_orderregel(<BE_ORDER_ID>);
```

- [ ] **Step 3: Checkpoint** — Miguel past toe; bevestig de verificatie-uitkomst (NL→hst_api, BE→geen) vóór Task 3.2.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/336_vervoerder_default_hst.sql
git commit -m "feat(vervoerder): HST default binnen NL via catch-all regel + is_default

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 3.2 — Teller `orders_zonder_vervoerder` (in mig 338, samen met monitor)

> De view voor "orders die handmatig een vervoerder nodig hebben" hoort thuis bij de monitoring-migratie (338, Slice 5) zodat alle observability-views in één migratie staan. De frontend-vlag/banner ervan komt in Slice 5 (Task 5.5). **Geen aparte stap hier** — dit blokje documenteert alleen de bewuste keuze om DB-werk te bundelen.

---

## SLICE 4 — Reaper voor vastgelopen `Bezig`-rijen

### Task 4.1 — Migratie 337: `herstel_vastgelopen_hst()`

**Files:**
- Create: `supabase/migrations/337_herstel_vastgelopen_hst.sql`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 337: reaper voor vastgelopen HST-transportorders
--
-- claim_volgende_hst_transportorder (mig 171) zet status='Bezig'. Crasht/timeout't
-- de edge function vóór markeer_hst_verstuurd/fout, dan blijft de rij eeuwig
-- 'Bezig' — nooit opnieuw geclaimd (claim pakt alleen 'Wachtrij'), nooit gealerteerd.
-- Deze RPC zet stale 'Bezig'-rijen terug op 'Wachtrij' zodat de volgende cron-run
-- ze oppakt. Zelfhelend; aangeroepen boven in hst-send (geen extra cron).
--
-- Idempotent.

CREATE OR REPLACE FUNCTION herstel_vastgelopen_hst(p_minuten INTEGER DEFAULT 10)
RETURNS INTEGER AS $$
DECLARE
  v_aantal INTEGER;
BEGIN
  UPDATE hst_transportorders
     SET status = 'Wachtrij'
   WHERE status = 'Bezig'
     AND updated_at < now() - make_interval(mins => p_minuten);
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RETURN v_aantal;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION herstel_vastgelopen_hst(INTEGER) TO authenticated;

COMMENT ON FUNCTION herstel_vastgelopen_hst IS
  'Reaper (mig 337): zet HST-transportorders die >p_minuten in Bezig hangen terug '
  'op Wachtrij. Aangeroepen boven in hst-send elke run; ook handmatig bruikbaar.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verificatie-SQL (na apply)**

```sql
-- Forceer een stale Bezig-rij en herstel 'm:
-- (op testdata) UPDATE hst_transportorders SET status='Bezig', updated_at=now()-interval '20 min' WHERE id=<X>;
SELECT herstel_vastgelopen_hst();   -- verwacht: >=1
SELECT status FROM hst_transportorders WHERE id=<X>;  -- verwacht: Wachtrij
```

- [ ] **Step 3: Checkpoint** — Miguel past toe.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/337_herstel_vastgelopen_hst.sql
git commit -m "feat(hst): reaper-RPC herstel_vastgelopen_hst voor stale Bezig-rijen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 4.2 — `hst-send` roept de reaper aan

**Files:**
- Modify: `supabase/functions/hst-send/index.ts` (begin van de `Deno.serve`-handler, ná `supabase`-client, vóór de claim-loop)

- [ ] **Step 1: Voeg de reaper-aanroep toe**

In `index.ts`, ná `const supabase = createClient(...)` en vóór `const summary` (of vóór de `for`-loop), voeg in:

```ts
  // Zelfhelend: herstel rijen die in een vorige run vastliepen in 'Bezig'
  // (crash/timeout vóór markeer-*). Best-effort — mag de run niet blokkeren.
  try {
    const { data: hersteld } = await supabase.rpc('herstel_vastgelopen_hst', { p_minuten: 10 });
    if (hersteld && Number(hersteld) > 0) {
      console.log(`[hst-send] reaper: ${hersteld} vastgelopen Bezig-rij(en) teruggezet naar Wachtrij`);
    }
  } catch (e) {
    console.warn(`[hst-send] reaper faalde: ${String(e)}`);
  }
```

- [ ] **Step 2: Typecheck**

Run: `deno check supabase/functions/hst-send/index.ts`
Expected: geen fouten.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/hst-send/index.ts
git commit -m "feat(hst): roep reaper aan bovenin elke hst-send-run

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## SLICE 5 — Monitoring: view + overzichtspagina + badge/banner

### Task 5.1 — Migratie 338: `hst_verzend_monitor` + `orders_zonder_vervoerder`

**Files:**
- Create: `supabase/migrations/338_hst_verzend_monitor.sql`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 338: observability-views voor HST-verzending
--
-- hst_verzend_monitor: één rij met vandaag-tellingen per status + de leeftijd
-- van de oudste Wachtrij/Bezig-rij. Die leeftijden zijn het cron-health-signaal:
-- loopt oudste_wachtrij_minuten op boven de drempel (UI: 5 min) → cron staat stil.
--
-- orders_zonder_vervoerder: niet-afhaal-orders met >=1 regel zonder vervoerder
-- (bron='geen', buiten HST-bereik). Voedt de "handmatig kiezen"-teller.
--
-- Idempotent.

CREATE OR REPLACE VIEW hst_verzend_monitor AS
SELECT
  COUNT(*) FILTER (WHERE status = 'Verstuurd' AND sent_at::date = CURRENT_DATE)::INT AS verstuurd_vandaag,
  COUNT(*) FILTER (WHERE status = 'Fout')::INT                                       AS fout_open,
  COUNT(*) FILTER (WHERE status = 'Wachtrij')::INT                                   AS wachtrij,
  COUNT(*) FILTER (WHERE status = 'Bezig')::INT                                      AS bezig,
  COALESCE(
    EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'Wachtrij'))) / 60,
    0)::INT                                                                          AS oudste_wachtrij_minuten,
  COALESCE(
    EXTRACT(EPOCH FROM (now() - MIN(updated_at) FILTER (WHERE status = 'Bezig'))) / 60,
    0)::INT                                                                          AS oudste_bezig_minuten
FROM hst_transportorders;

COMMENT ON VIEW hst_verzend_monitor IS
  'Mig 338: aggregaat-observability voor HST-verzending. oudste_wachtrij_minuten = '
  'cron-health-signaal (hoog = cron staat stil). Eén rij, geen state.';

GRANT SELECT ON hst_verzend_monitor TO authenticated;

CREATE OR REPLACE VIEW orders_zonder_vervoerder AS
SELECT DISTINCT o.id AS order_id, o.order_nr, o.debiteur_nr, o.afl_land, o.afl_plaats
  FROM orders o
 WHERE COALESCE(o.afhalen, FALSE) = FALSE
   AND o.status NOT IN ('Geannuleerd', 'Verzonden', 'Concept')
   AND EXISTS (
     SELECT 1
       FROM effectieve_vervoerder_per_orderregel(o.id) e
      WHERE e.bron = 'geen'
   );

COMMENT ON VIEW orders_zonder_vervoerder IS
  'Mig 338: niet-afhaal-orders met >=1 regel zonder vervoerder (buiten HST-bereik). '
  'Voedt de "handmatig vervoerder kiezen"-teller/banner.';

GRANT SELECT ON orders_zonder_vervoerder TO authenticated;

NOTIFY pgrst, 'reload schema';
```

> **Let op (executie):** controleer vóór apply de exacte set order-statussen in jouw schema (enum `order_status`). Pas de `NOT IN (...)`-lijst aan als 'Concept'/'Verzonden' anders heten. Verifieer met `SELECT DISTINCT status FROM orders;`.

- [ ] **Step 2: Verificatie-SQL (na apply)**

```sql
SELECT * FROM hst_verzend_monitor;          -- één rij, plausibele tellingen
SELECT COUNT(*) FROM orders_zonder_vervoerder;  -- aantal handmatig-nodig-orders
```

- [ ] **Step 3: Checkpoint** — Miguel past toe.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/338_hst_verzend_monitor.sql
git commit -m "feat(hst): observability-views hst_verzend_monitor + orders_zonder_vervoerder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5.2 — Query's + hooks

**Files:**
- Create: `frontend/src/modules/logistiek/queries/hst-monitor.ts`
- Create: `frontend/src/modules/logistiek/hooks/use-hst-monitor.ts`

- [ ] **Step 1: Schrijf de query's**

`frontend/src/modules/logistiek/queries/hst-monitor.ts`:

```ts
import { supabase } from '@/lib/supabase/client'

export interface HstMonitor {
  verstuurd_vandaag: number
  fout_open: number
  wachtrij: number
  bezig: number
  oudste_wachtrij_minuten: number
  oudste_bezig_minuten: number
}

export interface HstFoutRij {
  id: number
  zending_id: number
  zending_nr: string | null
  error_msg: string | null
  response_http_code: number | null
  retry_count: number
  updated_at: string
}

const CRON_STIL_DREMPEL_MIN = 5

export async function fetchHstMonitor(): Promise<HstMonitor> {
  const { data, error } = await supabase.from('hst_verzend_monitor').select('*').single()
  if (error) throw error
  return data as HstMonitor
}

/** True als de cron vermoedelijk stilstaat (oudste wachtrij/bezig boven drempel). */
export function cronVermoedelijkStil(m: HstMonitor): boolean {
  return m.oudste_wachtrij_minuten > CRON_STIL_DREMPEL_MIN || m.oudste_bezig_minuten > CRON_STIL_DREMPEL_MIN
}

/** Aantal items dat aandacht vraagt: open fouten + (cron stil ? 1). Eén bron-van-waarheid voor badge/banner. */
export function telHstAandacht(m: HstMonitor): number {
  return m.fout_open + (cronVermoedelijkStil(m) ? 1 : 0)
}

export async function fetchHstFouten(): Promise<HstFoutRij[]> {
  const { data, error } = await supabase
    .from('hst_transportorders')
    .select('id, zending_id, error_msg, response_http_code, retry_count, updated_at, zendingen(zending_nr)')
    .eq('status', 'Fout')
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw error
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id, zending_id: r.zending_id, zending_nr: r.zendingen?.zending_nr ?? null,
    error_msg: r.error_msg, response_http_code: r.response_http_code,
    retry_count: r.retry_count, updated_at: r.updated_at,
  }))
}

export async function countOrdersZonderVervoerder(): Promise<number> {
  const { count, error } = await supabase
    .from('orders_zonder_vervoerder')
    .select('order_id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}
```

- [ ] **Step 2: Schrijf de hooks**

`frontend/src/modules/logistiek/hooks/use-hst-monitor.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { fetchHstMonitor, fetchHstFouten, countOrdersZonderVervoerder } from '@/modules/logistiek/queries/hst-monitor'

export function useHstMonitor() {
  return useQuery({ queryKey: ['hst-monitor'], queryFn: fetchHstMonitor, refetchInterval: 30_000 })
}
export function useHstFouten() {
  return useQuery({ queryKey: ['hst-fouten'], queryFn: fetchHstFouten, refetchInterval: 30_000 })
}
export function useOrdersZonderVervoerderCount() {
  return useQuery({ queryKey: ['orders-zonder-vervoerder-count'], queryFn: countOrdersZonderVervoerder, refetchInterval: 60_000 })
}
```

- [ ] **Step 3: Typecheck**

Run (in `frontend/`): `npx tsc --noEmit`
Expected: geen fouten. (Controleer dat het import-pad `@/lib/supabase/client` klopt met bestaande query-bestanden, bv. `frontend/src/modules/edi/queries/edi.ts`.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/logistiek/queries/hst-monitor.ts frontend/src/modules/logistiek/hooks/use-hst-monitor.ts
git commit -m "feat(logistiek): query's + hooks voor HST-monitoring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5.3 — Overzichtspagina

**Files:**
- Create: `frontend/src/modules/logistiek/pages/hst-monitor.tsx`

- [ ] **Step 1: Schrijf de pagina**

`frontend/src/modules/logistiek/pages/hst-monitor.tsx` (volgt de stijl van `zending-detail.tsx`: `PageHeader`, `Section`, Tailwind-kaarten):

```tsx
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/page-header'
import { useHstMonitor, useHstFouten } from '@/modules/logistiek/hooks/use-hst-monitor'
import { cronVermoedelijkStil } from '@/modules/logistiek/queries/hst-monitor'
import { useVerstuurZendingOpnieuw } from '@/modules/logistiek/hooks/use-zendingen'

export function HstMonitorPage() {
  const { data: m, isLoading } = useHstMonitor()
  const { data: fouten = [] } = useHstFouten()
  const retry = useVerstuurZendingOpnieuw()

  if (isLoading || !m) return <div className="p-8 text-slate-500">Laden…</div>

  const cronStil = cronVermoedelijkStil(m)

  return (
    <>
      <PageHeader title="HST-verzendmonitor" description="Live status van de HST-koppeling." />

      {cronStil && (
        <div className="mb-4 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="font-semibold">Let op:</span> de wachtrij loopt op
          (oudste {m.oudste_wachtrij_minuten} min) — de verzend-cron staat mogelijk stil.
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Verstuurd vandaag" waarde={m.verstuurd_vandaag} kleur="groen" />
        <Kpi label="Open fouten" waarde={m.fout_open} kleur={m.fout_open > 0 ? 'rood' : 'grijs'} />
        <Kpi label="In wachtrij" waarde={m.wachtrij} kleur="grijs" />
        <Kpi label="Bezig" waarde={m.bezig} kleur="grijs" />
      </div>

      <div className="rounded-[var(--radius)] border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Open fouten ({fouten.length})</h3>
        {fouten.length === 0 ? (
          <div className="text-sm text-slate-400">Geen open fouten. 🎉</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Zending</th>
                <th className="px-3 py-2 text-left font-medium">Fout</th>
                <th className="px-3 py-2 text-right font-medium">HTTP</th>
                <th className="px-3 py-2 text-right font-medium">Retries</th>
                <th className="px-3 py-2 text-right font-medium">Actie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fouten.map((f) => (
                <tr key={f.id}>
                  <td className="px-3 py-2">
                    <Link to={`/logistiek/${f.zending_nr ?? ''}`} className="text-terracotta-600 hover:underline">
                      {f.zending_nr ?? `#${f.zending_id}`}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{f.error_msg ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{f.response_http_code ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{f.retry_count}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => retry.mutate(f.id)}
                      disabled={retry.isPending}
                      className="rounded-[var(--radius-sm)] bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      Opnieuw
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function Kpi({ label, waarde, kleur }: { label: string; waarde: number; kleur: 'groen' | 'rood' | 'grijs' }) {
  const ring = kleur === 'rood' ? 'border-rose-200 bg-rose-50' : kleur === 'groen' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
  return (
    <div className={`rounded-[var(--radius)] border p-4 ${ring}`}>
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-800">{waarde}</div>
    </div>
  )
}
```

> **Executie-noot:** verifieer de exacte naam/handtekening van `useVerstuurZendingOpnieuw` in `frontend/src/modules/logistiek/hooks/use-zendingen.ts` (gebruikt in `zending-detail.tsx`). Past het mutatie-argument (transportorder-`id`) bij wat `fetchHstFouten` teruggeeft (`f.id` = hst_transportorders.id)? Zo niet, lever de juiste id mee.

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` in `frontend/`. Expected: geen fouten.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/logistiek/pages/hst-monitor.tsx
git commit -m "feat(logistiek): HST-verzendmonitor-overzichtspagina

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5.4 — Route + module-export + navigatie

**Files:**
- Modify: `frontend/src/modules/logistiek/index.ts` (export `HstMonitorPage` + hooks/banner)
- Modify: `frontend/src/router.tsx` (route + import)
- Modify: sidebar/navigatie (zoek het bestand dat de Logistiek-nav rendert)

- [ ] **Step 1: Exporteer de pagina uit de module**

In `frontend/src/modules/logistiek/index.ts`, voeg toe bij de exports:

```ts
export { HstMonitorPage } from './pages/hst-monitor'
```

- [ ] **Step 2: Voeg de route toe**

In `frontend/src/router.tsx`: voeg `HstMonitorPage` toe aan de bestaande `} from '@/modules/logistiek'`-import (regel ~56), en voeg de route toe ná `logistiek/vervoerders/:code` (regel ~119):

```tsx
      { path: 'logistiek/hst-monitor', element: <HstMonitorPage /> },
```

- [ ] **Step 3: Navigatie-link + badge**

Zoek het navigatiebestand: `grep -rl "Logistiek" frontend/src/components/layout frontend/src/components`. Voeg onder het bestaande "Logistiek"-nav-item een sub-link "HST-monitor" toe naar `/logistiek/hst-monitor`, met een rood badge-getal uit `telHstAandacht`. Volg het bestaande nav-item-patroon in dat bestand (kopieer de markup van een naburig item en pas `to`/label aan). Gebruik:

```tsx
import { useHstMonitor } from '@/modules/logistiek/hooks/use-hst-monitor'
import { telHstAandacht } from '@/modules/logistiek/queries/hst-monitor'
// in de component:
const { data: hstM } = useHstMonitor()
const hstAandacht = hstM ? telHstAandacht(hstM) : 0
// render naast het label: {hstAandacht > 0 && <span className="ml-auto rounded-full bg-rose-600 px-1.5 text-xs text-white">{hstAandacht}</span>}
```

- [ ] **Step 4: Typecheck + handmatige check**

Run (in `frontend/`): `npx tsc --noEmit` → geen fouten.
Handmatig: start de app (`npm run dev`), open `/logistiek/hst-monitor` → pagina rendert; nav toont de link.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/logistiek/index.ts frontend/src/router.tsx frontend/src/components
git commit -m "feat(logistiek): route + nav-link + aandacht-badge voor HST-monitor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5.5 — Banner op Pick & Ship (fouten + handmatig-vervoerder)

**Files:**
- Create: `frontend/src/modules/logistiek/components/hst-aandacht-banner.tsx`
- Modify: het Pick & Ship-overzicht (`frontend/src/modules/magazijn/pages/...` — de pagina achter route `pick-ship` → `MagazijnOverviewPage`)

- [ ] **Step 1: Schrijf de banner (EDI-patroon)**

`frontend/src/modules/logistiek/components/hst-aandacht-banner.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { AlertTriangle, Truck } from 'lucide-react'
import { useHstMonitor, useOrdersZonderVervoerderCount } from '@/modules/logistiek/hooks/use-hst-monitor'
import { telHstAandacht } from '@/modules/logistiek/queries/hst-monitor'

/**
 * Proactieve waarschuwing op Pick & Ship: open HST-fouten / stilstaande cron, én
 * orders die handmatig een vervoerder nodig hebben (buiten HST-bereik). Onzichtbaar
 * als er niets aan de hand is. Spiegelt EdiTeKoppelenBanner.
 */
export function HstAandachtBanner() {
  const { data: m } = useHstMonitor()
  const { data: zonderVervoerder = 0 } = useOrdersZonderVervoerderCount()
  const aandacht = m ? telHstAandacht(m) : 0

  if (aandacht === 0 && zonderVervoerder === 0) return null

  return (
    <div className="mb-4 space-y-2">
      {aandacht > 0 && (
        <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 px-4 py-3">
          <AlertTriangle size={18} className="shrink-0 text-rose-600" />
          <div className="flex-1 text-sm text-rose-800">
            <span className="font-semibold">{m?.fout_open ?? 0} HST-verzendfout(en)</span>
            {m && (m.oudste_wachtrij_minuten > 5 || m.oudste_bezig_minuten > 5) ? ' — en de verzend-cron loopt achter.' : ' — bekijk en verstuur opnieuw.'}
          </div>
          <Link to="/logistiek/hst-monitor" className="shrink-0 rounded-[var(--radius-sm)] bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700">
            Bekijk
          </Link>
        </div>
      )}
      {zonderVervoerder > 0 && (
        <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 px-4 py-3">
          <Truck size={18} className="shrink-0 text-amber-600" />
          <div className="flex-1 text-sm text-amber-800">
            <span className="font-semibold">{zonderVervoerder} order(s) zonder vervoerder</span> — buiten HST-bereik; kies handmatig een vervoerder.
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Exporteer + haak in**

Voeg export toe in `frontend/src/modules/logistiek/index.ts`:

```ts
export { HstAandachtBanner } from './components/hst-aandacht-banner'
```

Render `<HstAandachtBanner />` bovenaan de Pick & Ship-pagina (zoek de component achter route `pick-ship`: `grep -rl "MagazijnOverviewPage" frontend/src/modules/magazijn`), direct ná de `PageHeader`, net zoals `EdiTeKoppelenBanner` op het orders-overzicht staat.

- [ ] **Step 3: Typecheck + handmatige check** — `npx tsc --noEmit`; open Pick & Ship en bevestig dat de banner verschijnt zodra er een fout/handmatig-order is, en verdwijnt als alles schoon is.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/logistiek/components/hst-aandacht-banner.tsx frontend/src/modules/logistiek/index.ts frontend/src/modules/magazijn
git commit -m "feat(logistiek): HST-aandacht-banner op Pick & Ship (fouten + handmatig-vervoerder)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## SLICE 6 — Documentatie + ADR + CLAUDE.md

### Task 6.1 — ADR + levende docs

**Files:**
- Create: `docs/adr/ADR-00XX-altijd-een-vervoerder-default-hst.md` (volgnummer = hoogste bestaande +1; check `ls docs/adr/`)
- Modify: `docs/changelog.md`, `docs/architectuur.md`, `docs/database-schema.md`, `CLAUDE.md`

- [ ] **Step 1: Schrijf de ADR**

Volg het format van een bestaande ADR in `docs/adr/`. Kerninhoud:
- **Context:** orders zonder matchende vervoerder-regel bleven liggen; HST is enige koppeling.
- **Besluit:** HST = default binnen NL via catch-all `vervoerder_selectie_regel` (prio 99999, `{land:['NL']}`) + `vervoerders.is_default`-vlag; buiten bereik → `bron='geen'` blijft zichtbaar als "handmatig kiezen". Pre-flight validator als gedeelde seam. Raakt ADR-0008 (vervoerder-ladder).
- **Gevolgen:** 2e vervoerder = eigen regels + vlag omzetten, geen code-edit aan de resolver.

- [ ] **Step 2: changelog.md** — datum-entry 2026-06-09 met de zes slices (wat + waarom).

- [ ] **Step 3: database-schema.md** — documenteer `zendingen.afl_telefoon`, `vervoerders.is_default`, views `hst_verzend_monitor` + `orders_zonder_vervoerder`, RPC `herstel_vastgelopen_hst`.

- [ ] **Step 4: architectuur.md** — sectie over de HST-observability-keten + pre-flight-seam (verwijs naar `_shared/vervoerder-eisen.ts`).

- [ ] **Step 5: CLAUDE.md** — voeg een bedrijfsregel toe onder "Bedrijfsregels":
  - Default-vervoerder: HST binnen NL via catch-all-regel + `is_default`; buiten bereik handmatig.
  - Pre-flight validator-seam `_shared/vervoerder-eisen.ts` (gespiegeld in `frontend/src/lib/orders/`), aangeroepen in hst-send + Pick & Ship.
  - Reaper `herstel_vastgelopen_hst` + monitoring-views; `oudste_wachtrij_minuten` = cron-health-signaal.

- [ ] **Step 6: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs(hst): ADR + changelog/architectuur/schema/CLAUDE voor HST-observability + default-vervoerder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (uitgevoerd bij het schrijven)

**Spec-dekking:** Alle spec-secties hebben een taak — ErrorMessage-fix (1.1), afl_telefoon-snapshot (1.2/1.4), PhoneNumber (1.3), validator-seam (2.1/2.2), is_default + catch-all NL (3.1), reaper (4.1/4.2), monitor-view + cron-health (5.1), overzichtspagina (5.3), badge/banner (5.4/5.5), orders_zonder_vervoerder (5.1/5.5), docs+ADR (6.1). ✔

**Afwijking van spec (bewust, genoteerd):** de telefoon-snapshot loopt via een BEFORE INSERT-trigger op `zendingen` i.p.v. het bewerken van `start_pickronden`/`create_zending_voor_order` — robuuster (één plek, dekt alle aanmaakroutes) en vermijdt het reproduceren van grote functies die mig 334 al raakte.

**Correctie t.o.v. spec:** conditie-sleutel is `land` (TEXT[]), niet `landen` — de spec-tekst is hierop bijgewerkt.

**Placeholder-scan:** geen TBD/TODO; elke code-stap bevat volledige code. UI-stappen die naar bestaande patronen verwijzen (nav-item, Pick & Ship-inhaak) geven exacte zoekcommando's + de in te voegen code. ✔

**Type-consistentie:** `valideerVoorVervoerder`/`VerzendContext`/`VerzendProbleem` identiek in 2.1 en gebruikt in 2.2. `HstMonitor`-velden uit 5.1-view matchen 5.2-interface en 5.3/5.5-gebruik. `telHstAandacht`/`cronVermoedelijkStil` consistent in 5.2/5.3/5.4/5.5. ✔

**Open verificatiepunten voor de uitvoerder (geen blockers):** exacte order-status-enumwaarden (5.1), handtekening `useVerstuurZendingOpnieuw` (5.3), het navigatie-bestand (5.4) en de Pick & Ship-paginacomponent (5.5) — elk met een `grep`-aanwijzing in de stap.
