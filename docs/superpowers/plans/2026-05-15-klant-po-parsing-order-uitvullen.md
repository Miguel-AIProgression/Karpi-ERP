# Klant-PO parsen en order auto-uitvullen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eén klik op een gebufferd klant-PO-PDF op de order-aanmaakpagina parseert het document en vult de order-form vooraf met alleen de velden waarvan we zeker zijn.

**Architecture:** Edge function `parse-klant-po` stuurt de PDF naar de Claude API voor vormvrije ruwe-tekst-extractie, roept daarna de deterministische Postgres-RPC `match_klant_po` aan voor de koppeling (debiteur via btw/email/naam, kwaliteit via `resolve_klanteigen_naam`, artikel via `klant_artikelnummers`/`producten`), en geeft per veld een zekerheidslabel terug. De frontend mapt alleen `zeker`-velden naar `OrderForm.initialData` en hermount de form.

**Tech Stack:** Supabase Edge Function (Deno), Anthropic Messages API (PDF document block + prompt caching), PostgreSQL RPC (PL/pgSQL), React + TanStack Query + vitest, Deno std test.

**Spec:** `docs/superpowers/specs/2026-05-15-klant-po-parsing-order-uitvullen-design.md`

---

## File Structure

| Bestand | Verantwoordelijkheid |
|---|---|
| `supabase/functions/_shared/po-extract.ts` | Pure extractie-laag: types, system-prompt, request-builder, response-parser/validator (geen netwerk) |
| `supabase/functions/_shared/po-extract.test.ts` | Deno-tests voor de pure extractie-laag (gemockte Anthropic-JSON) |
| `supabase/functions/parse-klant-po/index.ts` | Orchestrator: CORS, Anthropic-fetch, `parsePoExtractie`, `match_klant_po`-RPC, response |
| `supabase/migrations/289_match_klant_po.sql` | RPC `match_klant_po(jsonb) → jsonb`: debiteur- + regelmatch met zekerheidslabels |
| `scripts/test-match-klant-po.sql` | Zelf-test SQL (seed + asserts + ROLLBACK) voor de match-RPC |
| `frontend/src/lib/orders/po-prefill.ts` | Pure mapping: match-resultaat → `{ client?, header, regels, samenvatting }`, alleen `zeker` |
| `frontend/src/lib/orders/po-prefill.test.ts` | Vitest unit-tests voor de mapping (4 voorbeeld-fixtures) |
| `frontend/src/lib/supabase/queries/po-parsing.ts` | `parseKlantPo(file)` (base64 + invoke) + `fetchSelectedClientVoorPrefill(nr)` |
| `frontend/src/hooks/use-po-parsing.ts` | TanStack mutation-wrapper |
| `frontend/src/components/documenten/documenten-buffer.tsx` | Optionele per-rij knop "📄 Order uitvullen" (alleen PDF) |
| `frontend/src/components/orders/po-prefill-banner.tsx` | Samenvattingsbanner boven de order-form |
| `frontend/src/pages/orders/order-create.tsx` | Bedrading: prefill-state, OrderForm `initialData` + remount-`key`, banner |
| `supabase/config.toml` | `[functions.parse-klant-po] verify_jwt = false` |

**Conventieafspraken (uit codebase):**
- Edge functions: `serve` uit `https://deno.land/std@0.168.0/http/server.ts`, `createClient` met `SUPABASE_SERVICE_ROLE_KEY`, inline `corsHeaders`, `jsonResponse`-helper — exact zoals `supabase/functions/check-levertijd/index.ts`.
- Deno-tests: `https://deno.land/std@0.168.0/testing/asserts.ts`, draaien met `deno test`.
- Frontend-tests: vitest, alleen onder `frontend/src/**/*.{test,spec}.{ts,tsx}`.
- Migraties zijn doorlopend genummerd; `288` is al bezet (`288_orderregel_pickbaarheid_snijden_rang.sql`). Nieuwe = `289`.
- Migraties worden **handmatig** toegepast (Supabase MCP heeft geen toegang tot het Karpi-project) — de RPC-test is daarom een SQL-script, geen geautomatiseerde test.
- Taal: code Engels, UI Nederlands.

---

## Task 1: Pure extractie-types + system-prompt + request-builder

**Files:**
- Create: `supabase/functions/_shared/po-extract.ts`
- Test: `supabase/functions/_shared/po-extract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/po-extract.test.ts`:

```ts
// Deno unit tests voor po-extract.ts
import { assertEquals, assert, assertThrows } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { buildAnthropicRequest, parsePoExtractie } from './po-extract.ts'

Deno.test('buildAnthropicRequest zet PDF als document-block + cache op system', () => {
  const req = buildAnthropicRequest('QkFTRTY0', 'order.pdf')
  assertEquals(req.model.startsWith('claude-'), true)
  const sys = req.system as Array<{ type: string; cache_control?: unknown }>
  assert(sys.some((b) => b.cache_control), 'system-prompt moet cache_control hebben')
  const content = req.messages[0].content as Array<{ type: string }>
  assert(content.some((c) => c.type === 'document'), 'document-block ontbreekt')
})

Deno.test('parsePoExtractie accepteert geldige Claude-respons', () => {
  const claudeJson = {
    content: [{ type: 'text', text: JSON.stringify({
      afzender: { naam: 'GERO MEUBELEN N.V.', email: 'info@geromeubelen.be', btw_nummer: 'BE0415070027', kvk: null, adres: null },
      klant_referentie: '06092093',
      leverdatum_tekst: 'zo snel mogelijk',
      spoed: true,
      afleveradres: { naam: 'MAGAZIJN SCHOLLEBEEK', adres: 'SCHOLLEBEEKSTRAAT 74', postcode: '2500', plaats: 'LIER', land: 'BE' },
      factuuradres: null,
      regels: [
        { aantal: 5, ruwe_omschrijving: 'PLUSH 100% POLYESTER: KUSSEN 45 X 45CM - KLEUR 13', kwaliteit_tekst: 'PLUSH', kleur_tekst: '13', lengte_cm: 45, breedte_cm: 45, vorm_tekst: null, klant_artikelnr: null, prijs: 15.7, korting_pct: 7 },
      ],
    }) }],
  }
  const out = parsePoExtractie(claudeJson)
  assertEquals(out.afzender.btw_nummer, 'BE0415070027')
  assertEquals(out.regels.length, 1)
  assertEquals(out.regels[0].aantal, 5)
  assertEquals(out.spoed, true)
})

Deno.test('parsePoExtractie verwerkt JSON in ```json fences', () => {
  const claudeJson = { content: [{ type: 'text', text: '```json\n{"afzender":{"naam":"X"},"klant_referentie":null,"leverdatum_tekst":null,"spoed":false,"afleveradres":null,"factuuradres":null,"regels":[]}\n```' }] }
  const out = parsePoExtractie(claudeJson)
  assertEquals(out.afzender.naam, 'X')
  assertEquals(out.regels.length, 0)
})

Deno.test('parsePoExtractie gooit bij niet-parseerbare respons', () => {
  assertThrows(() => parsePoExtractie({ content: [{ type: 'text', text: 'geen json hier' }] }))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/po-extract.test.ts`
Expected: FAIL — `Module not found "./po-extract.ts"`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/po-extract.ts`:

```ts
// Pure extractie-laag voor klant-PO parsing.
// Geen netwerk-IO hier — alleen request-bouw + respons-parsing/-validatie,
// zodat dit deterministisch te testen is (zie po-extract.test.ts).

/** Ruwe, vormvrije extractie zoals Claude die teruggeeft. Geen koppeling. */
export interface PoAfzender {
  naam: string | null
  email: string | null
  btw_nummer: string | null
  kvk: string | null
  adres: string | null
}
export interface PoAdres {
  naam: string | null
  adres: string | null
  postcode: string | null
  plaats: string | null
  land: string | null
}
export interface PoRuweRegel {
  aantal: number | null
  ruwe_omschrijving: string | null
  kwaliteit_tekst: string | null
  kleur_tekst: string | null
  lengte_cm: number | null
  breedte_cm: number | null
  vorm_tekst: string | null
  klant_artikelnr: string | null
  prijs: number | null
  korting_pct: number | null
}
export interface PoRuwExtractie {
  afzender: PoAfzender
  klant_referentie: string | null
  leverdatum_tekst: string | null
  spoed: boolean
  afleveradres: PoAdres | null
  factuuradres: PoAdres | null
  regels: PoRuweRegel[]
}

// Sonnet is ruim voldoende voor gestructureerde extractie en goedkoper per
// call — kosten doen er hier toe (1 call per expliciete klik).
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096

const SYSTEM_PROMPT = `Je bent een extractie-engine voor inkooporders/bestelbonnen van een tapijtgroothandel (Karpi).
Je krijgt één PDF van een klant-bestelling. Haal UITSLUITEND de letterlijk aanwezige gegevens eruit.
Verzin of koppel NIETS — geen artikelnummers, geen kwaliteitscodes. Laat onbekend = null.

Belangrijk:
- Een "klantnummer"/"leverancier nr." op de bon verwijst naar KARPI in het systeem van de klant — NIET overnemen als afzender-id.
- afzender = het bedrijf dat de bestelling plaatst (logo/briefhoofd/BTW/e-mail).
- klant_referentie = ordernummer/onze-referentie; voeg een eventuele commissienaam toe als "<ordernr> | Commissie <naam>".
- leverdatum_tekst = letterlijke leverweek/-datum-tekst ("29-2026", "ASAP", "zo snel mogelijk") of null.
- spoed = true bij "SPOED", "SUPER SPOED", "Urgent", "ASAP", "zo snel/spoedig mogelijk".
- Per regel: aantal, ruwe_omschrijving (volledige regeltekst), kwaliteit_tekst (productnaam zoals PLUSH/Luxury/Cavaro/Vernon), kleur_tekst (zoals "13", "Plush 11", "Iron Grey 15"), lengte_cm/breedte_cm uit de maat (bv. 160 x 230 → 160/230), vorm_tekst (Rechthoekig/Rond/...), klant_artikelnr (alleen als de klant een eigen artikelnr noemt), prijs (eenheidsprijs), korting_pct.

Antwoord met UITSLUITEND één JSON-object, exact dit schema, geen uitleg:
{"afzender":{"naam":string|null,"email":string|null,"btw_nummer":string|null,"kvk":string|null,"adres":string|null},"klant_referentie":string|null,"leverdatum_tekst":string|null,"spoed":boolean,"afleveradres":{"naam":string|null,"adres":string|null,"postcode":string|null,"plaats":string|null,"land":string|null}|null,"factuuradres":{...zelfde...}|null,"regels":[{"aantal":number|null,"ruwe_omschrijving":string|null,"kwaliteit_tekst":string|null,"kleur_tekst":string|null,"lengte_cm":number|null,"breedte_cm":number|null,"vorm_tekst":string|null,"klant_artikelnr":string|null,"prijs":number|null,"korting_pct":number|null}]}`

export interface AnthropicRequest {
  model: string
  max_tokens: number
  system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>
  messages: Array<{ role: 'user'; content: unknown[] }>
}

/** Bouwt de Anthropic Messages-request. Prompt-caching op het vaste system-blok. */
export function buildAnthropicRequest(pdfBase64: string, bestandsnaam: string): AnthropicRequest {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: `Extraheer de bestelling uit "${bestandsnaam}". Antwoord met alleen het JSON-object.` },
        ],
      },
    ],
  }
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}
function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim()
  return null
}
function adres(v: unknown): PoAdres | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  return {
    naam: str(o.naam), adres: str(o.adres), postcode: str(o.postcode),
    plaats: str(o.plaats), land: str(o.land),
  }
}

/** Pakt de JSON-tekst uit een Anthropic-respons en valideert tegen het schema. */
export function parsePoExtractie(anthropicJson: unknown): PoRuwExtractie {
  const root = anthropicJson as { content?: Array<{ type?: string; text?: string }> }
  const text = (root.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
  let raw = text.trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  else {
    const first = raw.indexOf('{')
    const last = raw.lastIndexOf('}')
    if (first >= 0 && last > first) raw = raw.slice(first, last + 1)
  }
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw)
  } catch {
    throw new Error('Kon de extractie-respons niet als JSON lezen')
  }
  const af = (obj.afzender ?? {}) as Record<string, unknown>
  const regelsIn = Array.isArray(obj.regels) ? obj.regels : []
  return {
    afzender: {
      naam: str(af.naam), email: str(af.email), btw_nummer: str(af.btw_nummer),
      kvk: str(af.kvk), adres: str(af.adres),
    },
    klant_referentie: str(obj.klant_referentie),
    leverdatum_tekst: str(obj.leverdatum_tekst),
    spoed: obj.spoed === true,
    afleveradres: adres(obj.afleveradres),
    factuuradres: adres(obj.factuuradres),
    regels: regelsIn.map((r) => {
      const o = (r ?? {}) as Record<string, unknown>
      return {
        aantal: num(o.aantal),
        ruwe_omschrijving: str(o.ruwe_omschrijving),
        kwaliteit_tekst: str(o.kwaliteit_tekst),
        kleur_tekst: str(o.kleur_tekst),
        lengte_cm: num(o.lengte_cm),
        breedte_cm: num(o.breedte_cm),
        vorm_tekst: str(o.vorm_tekst),
        klant_artikelnr: str(o.klant_artikelnr),
        prijs: num(o.prijs),
        korting_pct: num(o.korting_pct),
      }
    }),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/_shared/po-extract.test.ts`
Expected: PASS — 4 tests ok.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/po-extract.ts supabase/functions/_shared/po-extract.test.ts
git commit -m "feat(po-parsing): pure extractie-laag (prompt + parser) met Deno-tests"
```

---

## Task 2: Match-RPC `match_klant_po` (migratie 289)

**Files:**
- Create: `supabase/migrations/289_match_klant_po.sql`
- Create: `scripts/test-match-klant-po.sql`

De RPC krijgt de ruwe extractie als `jsonb` en geeft per veld een waarde + `zeker` (boolean) terug. Deterministisch, geen LLM.

- [ ] **Step 1: Write the RPC migration**

Create `supabase/migrations/289_match_klant_po.sql`:

```sql
-- Migratie 289: match_klant_po
-- Deterministische koppel-laag voor klant-PO parsing (ADR-loze utility-RPC).
-- Input  = ruwe extractie (jsonb) zoals po-extract.ts die produceert.
-- Output = voorgestelde order-velden met per stuk een zekerheidslabel.
-- "zeker" = true betekent: frontend mag dit voorvullen.

CREATE OR REPLACE FUNCTION match_klant_po(p_extractie jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_afzender        jsonb := p_extractie->'afzender';
  v_btw             text  := upper(regexp_replace(coalesce(p_extractie#>>'{afzender,btw_nummer}',''), '[^A-Za-z0-9]', '', 'g'));
  v_email           text  := lower(trim(coalesce(p_extractie#>>'{afzender,email}','')));
  v_email_domein    text;
  v_naam_norm       text  := upper(regexp_replace(coalesce(p_extractie#>>'{afzender,naam}',''), '\s+', ' ', 'g'));
  v_debiteur_nr     integer;
  v_debiteur_zeker  boolean := false;
  v_cnt             integer;
  v_regel           jsonb;
  v_regels_out      jsonb := '[]'::jsonb;
  v_kwaliteit       text;
  v_kleur           text;
  v_artikelnr       text;
  v_is_maatwerk     boolean;
  v_regel_zeker     boolean;
BEGIN
  IF position('@' in v_email) > 0 THEN
    v_email_domein := split_part(v_email, '@', 2);
  END IF;

  -- ---- Debiteur: btw > e-maildomein > exacte naam, telkens precies 1 hit ----
  IF v_btw <> '' THEN
    SELECT debiteur_nr INTO v_debiteur_nr
    FROM debiteuren
    WHERE upper(regexp_replace(coalesce(btw_nummer,''), '[^A-Za-z0-9]', '', 'g')) = v_btw
    LIMIT 2;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt = 1 THEN v_debiteur_zeker := true; END IF;
  END IF;

  IF NOT v_debiteur_zeker AND v_email_domein IS NOT NULL AND v_email_domein <> '' THEN
    SELECT count(*), min(debiteur_nr) INTO v_cnt, v_debiteur_nr
    FROM debiteuren
    WHERE lower(coalesce(email_factuur,'')) LIKE '%@'||v_email_domein
       OR lower(coalesce(email_overig,''))  LIKE '%@'||v_email_domein
       OR lower(coalesce(email_2,''))       LIKE '%@'||v_email_domein;
    IF v_cnt = 1 THEN v_debiteur_zeker := true; ELSE v_debiteur_nr := NULL; END IF;
  END IF;

  IF NOT v_debiteur_zeker AND v_naam_norm <> '' THEN
    SELECT count(*), min(debiteur_nr) INTO v_cnt, v_debiteur_nr
    FROM debiteuren
    WHERE upper(regexp_replace(coalesce(naam,''), '\s+', ' ', 'g')) = v_naam_norm;
    IF v_cnt = 1 THEN v_debiteur_zeker := true; ELSE v_debiteur_nr := NULL; END IF;
  END IF;

  -- ---- Regels ----
  FOR v_regel IN SELECT * FROM jsonb_array_elements(coalesce(p_extractie->'regels','[]'::jsonb))
  LOOP
    v_kwaliteit := NULL; v_kleur := NULL; v_artikelnr := NULL;
    v_is_maatwerk := false; v_regel_zeker := false;

    -- Kleurcode = numeriek deel uit kleur_tekst ("Iron Grey 15" -> 15).
    v_kleur := nullif((regexp_match(coalesce(v_regel->>'kleur_tekst',''), '(\d{1,3})\s*$'))[1], '');

    -- 1. Klant-artikelnr (gescoped op debiteur).
    IF v_debiteur_zeker AND coalesce(v_regel->>'klant_artikelnr','') <> '' THEN
      SELECT artikelnr INTO v_artikelnr
      FROM klant_artikelnummers
      WHERE debiteur_nr = v_debiteur_nr
        AND lower(trim(klant_artikel)) = lower(trim(v_regel->>'klant_artikelnr'))
      LIMIT 1;
      IF v_artikelnr IS NOT NULL THEN v_regel_zeker := true; END IF;
    END IF;

    -- 2. Kwaliteit via klanteigen naam (debiteur-scope) of exacte kwaliteitsnaam.
    IF v_artikelnr IS NULL AND coalesce(v_regel->>'kwaliteit_tekst','') <> '' THEN
      IF v_debiteur_zeker THEN
        SELECT kn.kwaliteit_code INTO v_kwaliteit
        FROM klanteigen_namen kn
        WHERE kn.debiteur_nr = v_debiteur_nr
          AND lower(trim(kn.benaming)) = lower(trim(v_regel->>'kwaliteit_tekst'))
          AND (kn.kleur_code IS NULL OR kn.kleur_code = v_kleur)
        ORDER BY kn.kleur_code NULLS LAST
        LIMIT 1;
      END IF;
      IF v_kwaliteit IS NULL THEN
        SELECT k.code INTO v_kwaliteit
        FROM kwaliteiten k
        WHERE lower(trim(k.omschrijving)) = lower(trim(v_regel->>'kwaliteit_tekst'))
        LIMIT 1;
      END IF;
    END IF;

    -- 3. Catalogus-product op (kwaliteit, kleur, maat) -> artikelnr; anders maatwerk.
    IF v_artikelnr IS NULL AND v_kwaliteit IS NOT NULL AND v_kleur IS NOT NULL THEN
      SELECT p.artikelnr INTO v_artikelnr
      FROM producten p
      WHERE p.kwaliteit_code = v_kwaliteit
        AND p.kleur_code = v_kleur
        AND p.actief = true
        AND p.lengte_cm = nullif(v_regel->>'lengte_cm','')::int
        AND p.breedte_cm = nullif(v_regel->>'breedte_cm','')::int
      LIMIT 1;
      IF v_artikelnr IS NOT NULL THEN
        v_regel_zeker := true;
      ELSIF (v_regel->>'lengte_cm') IS NOT NULL AND (v_regel->>'breedte_cm') IS NOT NULL THEN
        v_is_maatwerk := true;
        v_regel_zeker := true;  -- maatwerk-specs zijn zeker (kw+kl+maat resolved)
      END IF;
    END IF;

    v_regels_out := v_regels_out || jsonb_build_object(
      'aantal',            v_regel->'aantal',
      'ruwe_omschrijving', v_regel->>'ruwe_omschrijving',
      'artikelnr',         v_artikelnr,
      'is_maatwerk',       v_is_maatwerk,
      'maatwerk_kwaliteit_code', CASE WHEN v_is_maatwerk THEN v_kwaliteit END,
      'maatwerk_kleur_code',     CASE WHEN v_is_maatwerk THEN v_kleur END,
      'lengte_cm',         v_regel->'lengte_cm',
      'breedte_cm',        v_regel->'breedte_cm',
      'vorm_tekst',        v_regel->>'vorm_tekst',
      'prijs',             v_regel->'prijs',
      'korting_pct',       v_regel->'korting_pct',
      'zeker',             v_regel_zeker
    );
  END LOOP;

  RETURN jsonb_build_object(
    'debiteur', jsonb_build_object('debiteur_nr', v_debiteur_nr, 'zeker', v_debiteur_zeker),
    'klant_referentie', p_extractie->>'klant_referentie',
    'leverdatum_tekst', p_extractie->>'leverdatum_tekst',
    'spoed', coalesce((p_extractie->>'spoed')::boolean, false),
    'afleveradres', p_extractie->'afleveradres',
    'factuuradres', p_extractie->'factuuradres',
    'regels', v_regels_out
  );
END;
$$;

GRANT EXECUTE ON FUNCTION match_klant_po(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION match_klant_po(jsonb) IS
  'Klant-PO parsing: deterministische koppel-laag. Input = ruwe extractie (po-extract.ts), output = order-velden met per stuk zekerheidslabel. Zie docs/superpowers/specs/2026-05-15-klant-po-parsing-order-uitvullen-design.md';
```

- [ ] **Step 2: Write the self-test SQL script**

Create `scripts/test-match-klant-po.sql` (volgt het patroon van `scripts/test-grondstofkosten-rpc.sql`: transactie + asserts + ROLLBACK):

```sql
-- Zelf-test voor match_klant_po. Draai in de Supabase SQL-editor.
-- Verwacht: alle RAISE NOTICE-regels eindigen op "OK". ROLLBACK aan het eind.
BEGIN;

-- Seed een testdebiteur met uniek BTW-nr.
INSERT INTO debiteuren (debiteur_nr, naam, status, btw_nummer, email_overig, korting_pct, btw_percentage)
VALUES (999001, 'TESTKLANT PO BV', 'Actief', 'NL999000001B01', 'orders@testklant-po.nl', 0, 21)
ON CONFLICT (debiteur_nr) DO NOTHING;

DO $$
DECLARE r jsonb;
BEGIN
  -- 1. Debiteur-match op btw -> zeker.
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object('naam','TESTKLANT PO BV','email',NULL,'btw_nummer','NL 9990 0000 1B01','kvk',NULL,'adres',NULL),
    'klant_referentie','PO-1','leverdatum_tekst','29-2026','spoed',false,
    'afleveradres',NULL,'factuuradres',NULL,'regels','[]'::jsonb));
  ASSERT (r#>>'{debiteur,debiteur_nr}')::int = 999001, 'btw-match faalt';
  ASSERT (r#>>'{debiteur,zeker}')::boolean = true, 'btw-zeker faalt';
  RAISE NOTICE 'btw-match: OK';

  -- 2. Debiteur-match op e-maildomein -> zeker.
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object('naam','onbekend','email','iemand@testklant-po.nl','btw_nummer',NULL,'kvk',NULL,'adres',NULL),
    'klant_referentie',NULL,'leverdatum_tekst',NULL,'spoed',false,
    'afleveradres',NULL,'factuuradres',NULL,'regels','[]'::jsonb));
  ASSERT (r#>>'{debiteur,debiteur_nr}')::int = 999001, 'email-match faalt';
  RAISE NOTICE 'email-match: OK';

  -- 3. Onbekende afzender -> onzeker, geen debiteur.
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object('naam','VOLSTREKT ONBEKEND XYZ','email',NULL,'btw_nummer',NULL,'kvk',NULL,'adres',NULL),
    'klant_referentie',NULL,'leverdatum_tekst',NULL,'spoed',false,
    'afleveradres',NULL,'factuuradres',NULL,'regels','[]'::jsonb));
  ASSERT (r#>>'{debiteur,zeker}')::boolean = false, 'onbekend-onzeker faalt';
  ASSERT (r#>>'{debiteur,debiteur_nr}') IS NULL, 'onbekend moet NULL debiteur geven';
  RAISE NOTICE 'onbekend-afzender: OK';

  -- 4. Kleurcode-extractie uit "Iron Grey 15".
  r := match_klant_po(jsonb_build_object(
    'afzender', jsonb_build_object('naam','TESTKLANT PO BV'),
    'klant_referentie',NULL,'leverdatum_tekst',NULL,'spoed',false,
    'afleveradres',NULL,'factuuradres',NULL,
    'regels', jsonb_build_array(jsonb_build_object(
      'aantal',1,'ruwe_omschrijving','Cavaro 240x330','kwaliteit_tekst','ONBEKEND_KW',
      'kleur_tekst','Iron Grey 15','lengte_cm',240,'breedte_cm',330,'vorm_tekst',NULL,
      'klant_artikelnr',NULL,'prijs',NULL,'korting_pct',NULL))));
  ASSERT (r#>>'{regels,0,zeker}')::boolean = false, 'onresolvebare kwaliteit moet onzeker zijn';
  RAISE NOTICE 'kleur-extractie + onzeker-regel: OK';

  RAISE NOTICE 'ALLE TESTS GESLAAGD';
END $$;

ROLLBACK;
```

- [ ] **Step 3: Apply migration manually + run self-test**

Pas `supabase/migrations/289_match_klant_po.sql` handmatig toe op het Karpi-project (Supabase SQL-editor — MCP heeft geen toegang). Draai daarna `scripts/test-match-klant-po.sql` in dezelfde editor.
Expected: laatste melding `ALLE TESTS GESLAAGD`, geen `ASSERT`-fouten.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/289_match_klant_po.sql scripts/test-match-klant-po.sql
git commit -m "feat(po-parsing): match_klant_po RPC (mig 289) + zelf-test SQL"
```

---

## Task 3: Edge function `parse-klant-po`

**Files:**
- Create: `supabase/functions/parse-klant-po/index.ts`
- Modify: `supabase/config.toml` (functions-blok)

- [ ] **Step 1: Register the function in config.toml**

Open `supabase/config.toml`, zoek het blok met de andere `[functions.*]`-secties (bv. `[functions.factuur-verzenden]`). Voeg eronder toe:

```toml
[functions.parse-klant-po]
verify_jwt = false
```

- [ ] **Step 2: Write the edge function**

Create `supabase/functions/parse-klant-po/index.ts`:

```ts
// Supabase Edge Function: parse-klant-po
// Parseert een klant-PO-PDF: Claude-extractie + deterministische match-RPC.
// verify_jwt = false (zie config.toml) — gebruikt SERVICE_ROLE voor DB.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildAnthropicRequest, parsePoExtractie } from '../_shared/po-extract.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!apiKey) {
    return jsonResponse({ error: 'ANTHROPIC_API_KEY ontbreekt in de functie-omgeving' }, 500)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    const body = await req.json() as { pdf_base64?: string; bestandsnaam?: string }
    if (!body.pdf_base64) {
      return jsonResponse({ error: 'pdf_base64 is verplicht' }, 400)
    }
    const bestandsnaam = body.bestandsnaam ?? 'order.pdf'

    // ---- 1. Claude-extractie ----
    const anthropicReq = buildAnthropicRequest(body.pdf_base64, bestandsnaam)
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicReq),
    })
    if (!aiRes.ok) {
      const detail = await aiRes.text()
      return jsonResponse({ error: `Claude-extractie mislukt (${aiRes.status})`, detail }, 502)
    }
    const aiJson = await aiRes.json()
    const extractie = parsePoExtractie(aiJson)

    // ---- 2. Deterministische match ----
    const { data: match, error: rpcErr } = await supabase.rpc('match_klant_po', {
      p_extractie: extractie,
    })
    if (rpcErr) {
      return jsonResponse({ error: `match_klant_po fout: ${rpcErr.message}` }, 500)
    }

    return jsonResponse({ extractie, match }, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('parse-klant-po error:', message)
    return jsonResponse({ error: `Parse-fout: ${message}` }, 500)
  }
})
```

- [ ] **Step 3: Type-check the function**

Run: `deno check supabase/functions/parse-klant-po/index.ts`
Expected: geen type-fouten.

- [ ] **Step 4: Document the required secret**

Voeg onderaan `supabase/functions/parse-klant-po/index.ts` géén secret toe. In plaats daarvan: noteer in de commit-body dat de secret gezet moet worden met
`supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` (en in de Supabase Dashboard → Edge Functions → Secrets voor productie).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/parse-klant-po/index.ts supabase/config.toml
git commit -m "feat(po-parsing): edge function parse-klant-po (Claude + match-RPC)

Vereist secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-..."
```

---

## Task 4: Pure prefill-mapping (frontend, alleen `zeker`)

**Files:**
- Create: `frontend/src/lib/orders/po-prefill.ts`
- Test: `frontend/src/lib/orders/po-prefill.test.ts`

Pure functie: match-resultaat → `OrderForm.initialData`-vorm (`header`/`regels`) + een
mensvriendelijke samenvatting. Vult **alleen** velden met `zeker=true`. De `client`
(SelectedClient) wordt los opgehaald (Task 5) en hoeft hier niet.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/orders/po-prefill.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapMatchNaarPrefill, type PoMatchResultaat } from './po-prefill'

const baseMatch: PoMatchResultaat = {
  debiteur: { debiteur_nr: null, zeker: false },
  klant_referentie: '06092093',
  leverdatum_tekst: '29-2026',
  spoed: false,
  afleveradres: { naam: 'MAGAZIJN', adres: 'STRAAT 1', postcode: '2500', plaats: 'LIER', land: 'BE' },
  factuuradres: null,
  regels: [],
}

describe('mapMatchNaarPrefill', () => {
  it('zet klant_referentie altijd in header', () => {
    const p = mapMatchNaarPrefill(baseMatch)
    expect(p.header.klant_referentie).toBe('06092093')
  })

  it('parset leverweek "29-2026" naar week', () => {
    const p = mapMatchNaarPrefill(baseMatch)
    expect(p.header.week).toBe('29')
  })

  it('laat week leeg bij niet-weekteksten', () => {
    const p = mapMatchNaarPrefill({ ...baseMatch, leverdatum_tekst: 'zo snel mogelijk' })
    expect(p.header.week).toBeUndefined()
  })

  it('vult afleveradres als concept (altijd)', () => {
    const p = mapMatchNaarPrefill(baseMatch)
    expect(p.header.afl_plaats).toBe('LIER')
    expect(p.header.afl_land).toBe('BE')
  })

  it('neemt alleen regels met zeker=true over als gematchte regel', () => {
    const m: PoMatchResultaat = {
      ...baseMatch,
      regels: [
        { aantal: 1, ruwe_omschrijving: 'Cavaro 240x330', artikelnr: 'ART1', is_maatwerk: false, maatwerk_kwaliteit_code: null, maatwerk_kleur_code: null, lengte_cm: 240, breedte_cm: 330, vorm_tekst: null, prijs: 100, korting_pct: 0, zeker: true },
        { aantal: 2, ruwe_omschrijving: 'Onbekend', artikelnr: null, is_maatwerk: false, maatwerk_kwaliteit_code: null, maatwerk_kleur_code: null, lengte_cm: null, breedte_cm: null, vorm_tekst: null, prijs: null, korting_pct: null, zeker: false },
      ],
    }
    const p = mapMatchNaarPrefill(m)
    expect(p.regels).toHaveLength(2)
    expect(p.regels[0].artikelnr).toBe('ART1')
    expect(p.regels[1].artikelnr).toBeUndefined()
    expect(p.samenvatting.regelsGematcht).toBe(1)
    expect(p.samenvatting.regelsConcept).toBe(1)
  })

  it('zet maatwerk-velden bij zekere maatwerk-regel', () => {
    const m: PoMatchResultaat = {
      ...baseMatch,
      regels: [{ aantal: 1, ruwe_omschrijving: 'Luxury 450x250', artikelnr: null, is_maatwerk: true, maatwerk_kwaliteit_code: 'LUX', maatwerk_kleur_code: '13', lengte_cm: 450, breedte_cm: 250, vorm_tekst: 'Rechthoekig', prijs: null, korting_pct: null, zeker: true }],
    }
    const p = mapMatchNaarPrefill(m)
    expect(p.regels[0].is_maatwerk).toBe(true)
    expect(p.regels[0].maatwerk_kwaliteit_code).toBe('LUX')
    expect(p.regels[0].maatwerk_lengte_cm).toBe(450)
  })

  it('telt debiteur in samenvatting', () => {
    const p = mapMatchNaarPrefill({ ...baseMatch, debiteur: { debiteur_nr: 280822, zeker: true } })
    expect(p.samenvatting.debiteurZeker).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/orders/po-prefill.test.ts`
Expected: FAIL — kan `./po-prefill` niet resolven.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/orders/po-prefill.ts`:

```ts
import type { OrderFormData, OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

/** Eén regel zoals match_klant_po die teruggeeft. */
export interface PoMatchRegel {
  aantal: number | null
  ruwe_omschrijving: string | null
  artikelnr: string | null
  is_maatwerk: boolean
  maatwerk_kwaliteit_code: string | null
  maatwerk_kleur_code: string | null
  lengte_cm: number | null
  breedte_cm: number | null
  vorm_tekst: string | null
  prijs: number | null
  korting_pct: number | null
  zeker: boolean
}

export interface PoMatchAdres {
  naam: string | null
  adres: string | null
  postcode: string | null
  plaats: string | null
  land: string | null
}

export interface PoMatchResultaat {
  debiteur: { debiteur_nr: number | null; zeker: boolean }
  klant_referentie: string | null
  leverdatum_tekst: string | null
  spoed: boolean
  afleveradres: PoMatchAdres | null
  factuuradres: PoMatchAdres | null
  regels: PoMatchRegel[]
}

export interface PoPrefillSamenvatting {
  debiteurZeker: boolean
  debiteurNr: number | null
  regelsGematcht: number
  regelsConcept: number
  weekBekend: boolean
  spoed: boolean
}

export interface PoPrefill {
  header: Partial<OrderFormData>
  regels: OrderRegelFormData[]
  samenvatting: PoPrefillSamenvatting
}

/** "29-2026" of "2026-29" -> "29". Anders null. */
function parseWeek(tekst: string | null): string | null {
  if (!tekst) return null
  const m = tekst.match(/\b(\d{1,2})\s*-\s*(20\d{2})\b/) || tekst.match(/\b(20\d{2})\s*-\s*(\d{1,2})\b/)
  if (!m) return null
  const week = m[2].length === 4 ? m[1] : m[2]
  const n = Number(week)
  return n >= 1 && n <= 53 ? String(n) : null
}

export function mapMatchNaarPrefill(match: PoMatchResultaat): PoPrefill {
  const header: Partial<OrderFormData> = {}

  if (match.klant_referentie) header.klant_referentie = match.klant_referentie

  const week = parseWeek(match.leverdatum_tekst)
  if (week) header.week = week

  // Afleveradres is altijd vrije tekst -> als concept voorvullen.
  if (match.afleveradres) {
    if (match.afleveradres.naam) header.afl_naam = match.afleveradres.naam
    if (match.afleveradres.adres) header.afl_adres = match.afleveradres.adres
    if (match.afleveradres.postcode) header.afl_postcode = match.afleveradres.postcode
    if (match.afleveradres.plaats) header.afl_plaats = match.afleveradres.plaats
    if (match.afleveradres.land) header.afl_land = match.afleveradres.land
  }
  if (match.factuuradres) {
    if (match.factuuradres.naam) header.fact_naam = match.factuuradres.naam
    if (match.factuuradres.adres) header.fact_adres = match.factuuradres.adres
    if (match.factuuradres.postcode) header.fact_postcode = match.factuuradres.postcode
    if (match.factuuradres.plaats) header.fact_plaats = match.factuuradres.plaats
    if (match.factuuradres.land) header.fact_land = match.factuuradres.land
  }

  let gematcht = 0
  let concept = 0
  const regels: OrderRegelFormData[] = match.regels.map((r) => {
    const aantal = r.aantal ?? 1
    const basis: OrderRegelFormData = {
      omschrijving: r.ruwe_omschrijving ?? '',
      orderaantal: aantal,
      te_leveren: aantal,
      korting_pct: r.korting_pct ?? 0,
    }
    if (r.prijs != null) basis.prijs = r.prijs

    if (r.zeker && r.artikelnr) {
      gematcht++
      return { ...basis, artikelnr: r.artikelnr }
    }
    if (r.zeker && r.is_maatwerk) {
      gematcht++
      return {
        ...basis,
        is_maatwerk: true,
        maatwerk_kwaliteit_code: r.maatwerk_kwaliteit_code ?? undefined,
        maatwerk_kleur_code: r.maatwerk_kleur_code ?? undefined,
        maatwerk_lengte_cm: r.lengte_cm ?? undefined,
        maatwerk_breedte_cm: r.breedte_cm ?? undefined,
      }
    }
    // Niet-gematcht: concept-regel (aantal + omschrijving), geen artikelnr.
    concept++
    return basis
  })

  return {
    header,
    regels,
    samenvatting: {
      debiteurZeker: match.debiteur.zeker,
      debiteurNr: match.debiteur.debiteur_nr,
      regelsGematcht: gematcht,
      regelsConcept: concept,
      weekBekend: !!week,
      spoed: match.spoed,
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/orders/po-prefill.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/orders/po-prefill.ts frontend/src/lib/orders/po-prefill.test.ts
git commit -m "feat(po-parsing): pure prefill-mapping (alleen zekere velden) + tests"
```

---

## Task 5: Frontend query + hook

**Files:**
- Create: `frontend/src/lib/supabase/queries/po-parsing.ts`
- Create: `frontend/src/hooks/use-po-parsing.ts`

- [ ] **Step 1: Write the query module**

Create `frontend/src/lib/supabase/queries/po-parsing.ts`:

```ts
import { supabase } from '../client'
import type { SelectedClient } from '@/components/orders/client-selector'
import type { PoMatchResultaat } from '@/lib/orders/po-prefill'

/** File -> base64 (zonder data:-prefix). */
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export interface ParseKlantPoResultaat {
  match: PoMatchResultaat
}

export async function parseKlantPo(file: File): Promise<ParseKlantPoResultaat> {
  const pdf_base64 = await fileToBase64(file)
  const { data, error } = await supabase.functions.invoke('parse-klant-po', {
    body: { pdf_base64, bestandsnaam: file.name },
  })
  if (error) {
    let msg = error.message
    try {
      const ctx = (error as Record<string, unknown>).context as Response | undefined
      if (ctx?.json) {
        const parsed = await ctx.json()
        if (parsed?.error) msg = parsed.error
      }
    } catch { /* fallback */ }
    throw new Error(msg)
  }
  return { match: (data as { match: PoMatchResultaat }).match }
}

/**
 * Haalt de volledige SelectedClient op bij een debiteur_nr. Spiegelt exact de
 * select + mapping van ClientSelector (frontend/src/components/orders/client-selector.tsx)
 * zodat prijslijst/korting/adres-logica in OrderForm identiek werkt.
 */
export async function fetchSelectedClientVoorPrefill(
  debiteurNr: number,
): Promise<SelectedClient | null> {
  const { data, error } = await supabase
    .from('debiteuren')
    .select(
      'debiteur_nr, naam, adres, postcode, plaats, land, fact_naam, fact_adres, fact_postcode, fact_plaats, email_factuur, email_overig, vertegenw_code, prijslijst_nr, korting_pct, betaler, inkoopgroepen(naam), gratis_verzending, standaard_maat_werkdagen, maatwerk_weken, deelleveringen_toegestaan, default_lever_type',
    )
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const { inkoopgroepen, ...rest } = data as Record<string, unknown> & {
    inkoopgroepen: { naam: string } | null
  }
  return {
    ...(rest as unknown as Omit<SelectedClient, 'inkooporganisatie'>),
    inkooporganisatie: inkoopgroepen?.naam ?? null,
  } as SelectedClient
}
```

- [ ] **Step 2: Verify the ClientSelector select-string still matches**

Run: `grep -n "from('debiteuren')" -A1 frontend/src/components/orders/client-selector.tsx`
Expected: de `.select(...)`-kolomlijst is identiek aan die in `fetchSelectedClientVoorPrefill`. Als ClientSelector afwijkt: kopieer diens exacte lijst hierheen. (Dit is een bewuste duplicatie omdat ClientSelector de select inline houdt; toekomstige refactor kan dit extraheren.)

- [ ] **Step 3: Write the hook**

Create `frontend/src/hooks/use-po-parsing.ts`:

```ts
import { useMutation } from '@tanstack/react-query'
import { parseKlantPo } from '@/lib/supabase/queries/po-parsing'

export function usePoParsing() {
  return useMutation({
    mutationFn: (file: File) => parseKlantPo(file),
  })
}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: geen fouten.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/supabase/queries/po-parsing.ts frontend/src/hooks/use-po-parsing.ts
git commit -m "feat(po-parsing): frontend query (invoke + base64) + mutation-hook"
```

---

## Task 6: "Order uitvullen"-knop in DocumentenBuffer

**Files:**
- Modify: `frontend/src/components/documenten/documenten-buffer.tsx`

Voeg een optionele `onParse`-prop toe; render per **PDF**-rij een knop. Geen gedragswijziging als de prop niet wordt meegegeven (de inkooporder-buffer e.d. blijven onaangetast).

- [ ] **Step 1: Extend the Props interface**

In `frontend/src/components/documenten/documenten-buffer.tsx`, vervang het `interface Props`-blok (regels 19-24) door:

```tsx
interface Props {
  docs: BufferedDoc[]
  onChange: (docs: BufferedDoc[]) => void
  title?: string
  className?: string
  /** Indien gezet: toont per PDF-rij een "Order uitvullen"-knop. */
  onParse?: (doc: BufferedDoc) => void
  /** id van de doc die nu geparsed wordt (spinner-state). */
  parsingId?: string | null
}
```

- [ ] **Step 2: Destructure the new props**

Vervang de functie-signatuur (regel 30):

```tsx
export function DocumentenBuffer({ docs, onChange, title = 'Documenten', className, onParse, parsingId }: Props) {
```

- [ ] **Step 3: Add the import for the icon**

In de `lucide-react`-import bovenaan, voeg `Sparkles` toe aan de bestaande lijst:

```tsx
import {
  Paperclip,
  Upload,
  Trash2,
  FileText,
  Image as ImageIcon,
  X,
  ExternalLink,
  Eye,
  Sparkles,
} from 'lucide-react'
```

- [ ] **Step 4: Render the button per PDF row**

In de `<li>`-map (binnen `docs.map((d) => (...))`), direct vóór de `canPreview(d.file) && (...)`-previewknop, voeg toe:

```tsx
{onParse && (d.file.type === 'application/pdf' || d.file.name.toLowerCase().endsWith('.pdf')) && (
  <button
    type="button"
    onClick={() => onParse(d)}
    disabled={parsingId === d.id}
    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-terracotta-50 text-terracotta-700 hover:bg-terracotta-100 rounded disabled:opacity-50 shrink-0"
    title="Vul de order automatisch uit dit document"
  >
    <Sparkles size={13} />
    {parsingId === d.id ? 'Bezig…' : 'Order uitvullen'}
  </button>
)}
```

- [ ] **Step 5: Type-check + lint**

Run: `cd frontend && npx tsc -b --noEmit && npx eslint src/components/documenten/documenten-buffer.tsx`
Expected: geen fouten.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/documenten/documenten-buffer.tsx
git commit -m "feat(po-parsing): optionele 'Order uitvullen'-knop per PDF in DocumentenBuffer"
```

---

## Task 7: Samenvattingsbanner

**Files:**
- Create: `frontend/src/components/orders/po-prefill-banner.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/orders/po-prefill-banner.tsx`:

```tsx
import { CheckCircle2, AlertTriangle, Zap, X } from 'lucide-react'
import type { PoPrefillSamenvatting } from '@/lib/orders/po-prefill'

interface Props {
  bestandsnaam: string
  samenvatting: PoPrefillSamenvatting
  onClose: () => void
}

export function PoPrefillBanner({ bestandsnaam, samenvatting: s, onClose }: Props) {
  return (
    <div className="mb-4 rounded-[var(--radius)] border border-terracotta-200 bg-terracotta-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <CheckCircle2 size={18} className="text-terracotta-600 mt-0.5 shrink-0" />
        <div className="flex-1 text-sm text-slate-700">
          <div className="font-medium text-slate-900">
            Order voorgevuld uit “{bestandsnaam}”
          </div>
          <ul className="mt-1 space-y-0.5">
            <li>
              Debiteur:{' '}
              {s.debiteurZeker
                ? `herkend (#${s.debiteurNr})`
                : 'niet zeker — kies handmatig'}
            </li>
            <li>
              Regels: {s.regelsGematcht} gematcht
              {s.regelsConcept > 0 && `, ${s.regelsConcept} als concept (controleer artikel)`}
            </li>
            <li>Leverweek: {s.weekBekend ? 'overgenomen' : 'onbekend — vul handmatig'}</li>
            {s.spoed && (
              <li className="flex items-center gap-1 text-amber-700 font-medium">
                <Zap size={13} /> Spoed gedetecteerd — zet de spoed-toggle aan indien nodig
              </li>
            )}
            {!s.debiteurZeker && (
              <li className="flex items-center gap-1 text-amber-700">
                <AlertTriangle size={13} /> Controleer alle voorgevulde velden vóór opslaan
              </li>
            )}
          </ul>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-slate-700 rounded shrink-0"
          title="Sluiten"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: geen fouten.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/orders/po-prefill-banner.tsx
git commit -m "feat(po-parsing): samenvattingsbanner voor voorgevulde order"
```

---

## Task 8: Bedrading in OrderCreatePage

**Files:**
- Modify: `frontend/src/pages/orders/order-create.tsx`

Hier komt alles samen: parse-knop → query → mapping → `OrderForm` hermount met
`initialData` + `key`. `OrderForm` initialiseert state uit `initialData` (regels 61-63),
dus een nieuwe `key` forceert een verse mount met de voorgevulde data.

- [ ] **Step 1: Replace the page implementation**

Vervang de volledige inhoud van `frontend/src/pages/orders/order-create.tsx` door:

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrderForm } from '@/components/orders/order-form'
import { PoPrefillBanner } from '@/components/orders/po-prefill-banner'
import {
  DocumentenBuffer,
  type BufferedDoc,
} from '@/components/documenten/documenten-buffer'
import { uploadDocument } from '@/lib/supabase/queries/documenten'
import { usePoParsing } from '@/hooks/use-po-parsing'
import { fetchSelectedClientVoorPrefill } from '@/lib/supabase/queries/po-parsing'
import { mapMatchNaarPrefill, type PoPrefill } from '@/lib/orders/po-prefill'
import type { SelectedClient } from '@/components/orders/client-selector'

export function OrderCreatePage() {
  const [bufferedDocs, setBufferedDocs] = useState<BufferedDoc[]>([])
  const [formKey, setFormKey] = useState(0)
  const [prefill, setPrefill] = useState<PoPrefill | null>(null)
  const [prefillClient, setPrefillClient] = useState<SelectedClient | null>(null)
  const [prefillBron, setPrefillBron] = useState<string>('')
  const [parsingId, setParsingId] = useState<string | null>(null)
  const [parseFout, setParseFout] = useState<string | null>(null)

  const poParsing = usePoParsing()

  async function uploadBufferedDocs(orderIds: number[]) {
    if (bufferedDocs.length === 0) return
    for (const orderId of orderIds) {
      for (const d of bufferedDocs) {
        await uploadDocument('order', orderId, d.file, d.omschrijving)
      }
    }
  }

  async function handleParse(doc: BufferedDoc) {
    setParseFout(null)
    setParsingId(doc.id)
    try {
      const { match } = await poParsing.mutateAsync(doc.file)
      const mapped = mapMatchNaarPrefill(match)
      let client: SelectedClient | null = null
      if (mapped.samenvatting.debiteurZeker && mapped.samenvatting.debiteurNr != null) {
        client = await fetchSelectedClientVoorPrefill(mapped.samenvatting.debiteurNr)
      }
      setPrefill(mapped)
      setPrefillClient(client)
      setPrefillBron(doc.file.name)
      setFormKey((k) => k + 1)
    } catch (err) {
      setParseFout(err instanceof Error ? err.message : 'Parsen mislukt')
    } finally {
      setParsingId(null)
    }
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/orders"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Terug naar orders
        </Link>
      </div>

      <PageHeader title="Nieuwe order" />

      {parseFout && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-[var(--radius-sm)]">
          {parseFout}
        </div>
      )}

      {prefill && (
        <PoPrefillBanner
          bestandsnaam={prefillBron}
          samenvatting={prefill.samenvatting}
          onClose={() => setPrefill(null)}
        />
      )}

      <OrderForm
        key={formKey}
        mode="create"
        onAfterCreate={uploadBufferedDocs}
        initialData={
          prefill
            ? {
                orderId: 0,
                client: prefillClient,
                header: prefill.header,
                regels: prefill.regels,
              }
            : undefined
        }
      />

      <div className="mt-6">
        <DocumentenBuffer
          docs={bufferedDocs}
          onChange={setBufferedDocs}
          title="Documenten (klant-PO, bevestiging, bijlagen)"
          onParse={handleParse}
          parsingId={parsingId}
        />
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify OrderForm accepts initialData in create mode**

Run: `grep -n "initialData?\|orderId: number\|mode === 'create'\|deleteOrder(initialData" frontend/src/components/orders/order-form.tsx | head`
Expected: `initialData` is optioneel en wordt in create-mode alleen gelezen voor `client/header/regels` (regels 61-63). `deleteOrder(initialData!.orderId)` en `initialData!.orderId` worden alleen in de edit-tak (`mode === 'edit'`) bereikt. `orderId: 0` is daardoor veilig als sentinel in create-mode. Als deze aanname niet klopt: stop en meld het — dan is een kleine guard in `order-form.tsx` nodig (`mode === 'create'` mag `initialData.orderId` nooit gebruiken).

- [ ] **Step 3: Type-check + lint + run tests**

Run: `cd frontend && npx tsc -b --noEmit && npx eslint src/pages/orders/order-create.tsx && npx vitest run src/lib/orders/po-prefill.test.ts`
Expected: geen fouten; po-prefill-tests groen.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/orders/order-create.tsx
git commit -m "feat(po-parsing): bedrading OrderCreatePage (parse -> prefill -> remount form)"
```

---

## Task 9: Documentatie bijwerken

**Files:**
- Modify: `docs/changelog.md`
- Modify: `docs/architectuur.md`
- Modify: `docs/database-schema.md`

- [ ] **Step 1: Changelog**

Voeg bovenaan de meest recente sectie in `docs/changelog.md` een datumregel `2026-05-15` toe (volg het bestaande format in dat bestand):

```markdown
### 2026-05-15 — Klant-PO parsen en order auto-uitvullen
- Edge function `parse-klant-po`: Claude-extractie (PDF) + deterministische match-RPC.
- Migratie 289: RPC `match_klant_po(jsonb)` — debiteur via btw/email/naam, kwaliteit via
  `resolve_klanteigen_naam`, artikel via `klant_artikelnummers`/`producten`; per veld een
  zekerheidslabel. Alleen `zeker`-velden worden in de order-form voorgevuld.
- UI: "📄 Order uitvullen"-knop per PDF in `DocumentenBuffer` + samenvattingsbanner.
- Vereist secret `ANTHROPIC_API_KEY` op de edge-functie-omgeving.
- Spec: `docs/superpowers/specs/2026-05-15-klant-po-parsing-order-uitvullen-design.md`.
```

- [ ] **Step 2: Architectuur**

Voeg in `docs/architectuur.md` in de sectie over edge functions (zoek op `check-levertijd` of `Edge Function`) een alinea toe:

```markdown
### parse-klant-po (klant-PO parsing)
Upload van een klant-PO op de order-aanmaakpagina → edge function `parse-klant-po`.
Twee-laags: (1) Claude Messages-API extraheert vormvrije ruwe tekst uit de PDF
(`_shared/po-extract.ts`, pure + getest), (2) RPC `match_klant_po` (mig 289) koppelt
deterministisch tegen `debiteuren`/`klanteigen_namen`/`klant_artikelnummers`/`producten`
en labelt per veld `zeker`. De frontend (`@/lib/orders/po-prefill`) vult alleen
`zeker`-velden voor en hermount `OrderForm` via een `key`. Geen auto-opslag.
Secret: `ANTHROPIC_API_KEY`.
```

- [ ] **Step 3: Database-schema**

Voeg in `docs/database-schema.md` in de functies/RPC-sectie (zoek op `### Functies` of een bestaande RPC-opsomming) toe:

```markdown
- `match_klant_po(p_extractie jsonb) → jsonb` (mig 289) — Klant-PO parsing: deterministische
  koppel-laag. Debiteur-match btw → e-maildomein → exacte naam (telkens precies 1 hit = `zeker`);
  per regel klant-artikelnr → kwaliteit (`resolve_klanteigen_naam`/`kwaliteiten`) + kleur (numeriek
  suffix) → catalogus-`producten` of maatwerk-specs. STABLE, geen side-effects.
```

- [ ] **Step 4: Commit**

```bash
git add docs/changelog.md docs/architectuur.md docs/database-schema.md
git commit -m "docs(po-parsing): changelog + architectuur + schema bijgewerkt"
```

---

## Task 10: End-to-end handmatige verificatie

**Files:** (geen — verificatiestap)

- [ ] **Step 1: Set the secret**

Run: `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` (of via Supabase Dashboard → Edge Functions → Secrets). Bevestig dat de secret bestaat: `supabase secrets list` toont `ANTHROPIC_API_KEY`.

- [ ] **Step 2: Deploy de edge function + migratie**

Migratie 289 is in Task 2 al handmatig toegepast. Deploy de functie:
Run: `supabase functions deploy parse-klant-po`
Expected: deploy succesvol, functie verschijnt in de lijst.

- [ ] **Step 3: Manuele test met de 4 voorbeeld-PO's**

Open de order-aanmaakpagina in de app. Voor elk van de 4 voorbeeld-PDF's (Gero, Zitmaxx,
Room108, De Groot — uit de brainstorm):
1. Sleep het PDF in de DocumentenBuffer.
2. Klik "📄 Order uitvullen".
3. Controleer de banner-samenvatting en de voorgevulde velden.

Verwacht (acceptatiecriteria uit de spec):
- Klant-referentie altijd ingevuld (06092093 / 6062843474 / I26007566 | Commissie … / 247768 | Commissie Beek).
- De Groot: leverweek **29** ingevuld.
- Geen onzekere gokjes: niet-herkende kwaliteiten → concept-regel zonder artikelnr, géén fout artikel.
- Niets opgeslagen tot de gebruiker zelf op opslaan klikt; PDF blijft in de buffer en wordt bij opslaan als orderdocument gekoppeld (bestaande flow).
- Bij een Claude-/parse-fout: rode melding, form blijft bruikbaar.

- [ ] **Step 4: Commit (alleen indien fixes nodig)**

Als stap 3 issues blootlegt: fix per betrokken Task-bestand, herhaal de bijbehorende test-commando's, commit met een `fix(po-parsing): …`-bericht. Geen functionele wijzigingen = geen commit.

---

## Self-Review (uitgevoerd)

**Spec-dekking:**
- Architectuur/flow → Task 3 (edge), Task 2 (RPC), Task 4/8 (frontend mapping + remount). ✓
- Extractie-laag (LLM, schema, prompt-caching) → Task 1. ✓
- Match-laag (btw→email→naam; klant-artikelnr→kwaliteit→catalogus/maatwerk; kleur numeriek suffix) → Task 2 RPC + self-test. ✓
- "Alleen `zeker` voorvullen" → Task 4 mapping + tests; debiteur-fetch alleen bij `zeker` → Task 8. ✓
- UX (knop per PDF, banner, geen auto-opslag, PDF blijft hangen) → Task 6, 7, 8. ✓
- Foutafhandeling (niet-blokkerend, melding, form blijft leeg/bruikbaar) → Task 3 (502/500), Task 8 (`parseFout`). ✓
- Kosten/security (1 call per klik, key server-side, verify_jwt=false) → Task 3 + config.toml. ✓
- Scope-grens (geen auto-aanmaken/EDI/batch/leerloop) → niet geïmplementeerd, conform YAGNI. ✓
- Testing (4 fixtures e2e, RPC SQL-test, extractie Deno-test, mapping vitest) → Task 1, 2, 4, 10. ✓
- Docs bijwerken → Task 9. ✓

**Placeholder-scan:** geen TBD/TODO; alle code-stappen bevatten volledige code.

**Type-consistentie:** `PoRuwExtractie` (Task 1) ↔ RPC-input (Task 2) ↔ `PoMatchResultaat`/`PoMatchRegel` (Task 4) ↔ query-return (Task 5) ↔ `mapMatchNaarPrefill` (Task 4) ↔ OrderCreatePage (Task 8) sluiten op elkaar aan. `OrderRegelFormData`/`OrderFormData` hergebruikt uit `@/lib/supabase/queries/order-mutations`. Banner gebruikt `PoPrefillSamenvatting` uit Task 4.
