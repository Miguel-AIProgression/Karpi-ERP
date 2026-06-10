# Order-status follow-ups: B3-refactor, EDI-'Nieuw'-regressie, enum-TS-single-source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. You have a fresh context window — this plan is self-contained; read it fully before starting.

**Goal:** De drie resterende order-status-follow-ups afronden: (1) `bevestig_concept_order` schrijft via `_apply_transitie` i.p.v. directe UPDATE (bevinding B3), (2) `create_edi_order` krijgt een schone herdefinitie die de mig 309/312-regressie fixt (EDI-orders landen nu live op dode status `'Nieuw'`) + herstel-backfill, (3) het TS-deel van de `order_status`-enum-single-source (module + golden + Vitest-contracttest, aansluitend op de bestaande SQL-set-assert van mig 350).

**Architecture:** Taak 1 en 2 zijn gedrags-behoudende refactors van bestaande RPC's via nieuwe migraties (repo-conventie: zelf-testende `DO`-asserties, RED→GREEN door de gebruiker in de SQL Editor — de agent heeft GEEN DB-toegang). Taak 3 volgt het Fase 1/2-patroon: import-vrije TS-module in `_shared/order-lifecycle/`, golden-fixture, Vitest-contracttest met cross-root import (precedent: `derive-status.test.ts`), géén nieuwe migratie (mig 350-assert bestaat al en is de DB-kant van het anker).

**Tech Stack:** Supabase/PostgreSQL (PL/pgSQL-migraties, handmatig toegepast), React/TypeScript + Vitest, Deno edge functions (`supabase/functions/_shared/`).

---

## Geverifieerde grond-waarheid (recon 2026-06-10, tegen `main` @ b132ca2)

**Reeds gedaan door parallelle sessies — NIET opnieuw doen:**
- Security re-pin `herbereken_wacht_status` (SECURITY DEFINER + `SET search_path = public`): mig 351 r130-131 én mig 352 r134-135, beide met zelf-test-assertie op `pg_get_functiondef`. **Klaar.**
- Lint-glob: [`scripts/lint-no-direct-orders-status-update.sh`](../../../scripts/lint-no-direct-orders-status-update.sh) scant nu `2*.sql` + `[3-9]*.sql`. Mig 330's directe UPDATE is vervangen door `_apply_transitie` + event-type `'maatwerk_afgerond'` (mig 347 = enum-waarde, mig 348-tijdperk = functie). Mig 308 en 330 staan in `ALLOWED_PATHS` als bevroren history. **Klaar — behalve bevinding B3 (zie Taak 1).**
- `order_status`-snapshot-assert: [`350_assert_order_status_enum_snapshot.sql`](../../../supabase/migrations/350_assert_order_status_enum_snapshot.sql) — **set-vergelijking** (gesorteerd, bewust géén volgorde: basis-`CREATE TYPE` zit niet in de repo en volgorde is niet betekenis-dragend). De 17 waarden staan daar. **De SQL-kant van Taak 3 bestaat dus al.**
- De ladder zelf: mig 352 voegde `'Maatwerk afgerond'` toe aan de guard-lijst van `derive_wacht_status` (nu 10 waarden) en hield TS-spiegel + golden-fixture (23 cases) + DO-assertie synchroon. **De ladder is buiten scope van dit plan — niet aanraken.**

**Open bevinding B3** (lint-whitelist-notitie "follow-up open"): de líve functie `bevestig_concept_order` ([`308_concept_order_status.sql`](../../../supabase/migrations/308_concept_order_status.sql) r109-137) doet `UPDATE orders SET status = 'Klaar voor picken'` + handmatige `order_events`-INSERT (event_type `'aangemaakt'`, kolom `actor`, geen `status_voor`/`status_na`) — buiten `_apply_transitie` om (ADR-0006-schending). Daarna roept hij `herbereken_wacht_status(p_order_id)` aan. Geen herdefinities ná mig 308 (geverifieerd: grep over mig 309-352).

**Open regressie create_edi_order:** mig 275 r164-197 patchte de status-literal in `create_edi_order` van `'Nieuw'` naar `'Klaar voor picken'` via `pg_get_functiondef`+`REPLACE()`. Maar mig 309 (r39-202, status-literal `'Nieuw'` op r149) en mig 312 (r49-214, `'Nieuw'` op r161) herdefiniëren de functie NA mig 275 met de oude literal — de patch is dus ongedaan gemaakt. **Live worden EDI-orders sinds mig 309/312 aangemaakt met de dode status `'Nieuw'`.** Verzachtende factor: `'Nieuw'` zit in de wacht-lijst van `derive_wacht_status` (regel 5), dus zodra íets `herbereken_wacht_status` triggert (orderregel-trigger bij regel-inserts) wordt de status gecorrigeerd — maar `create_edi_order` zelf roept herbereken NIET aan (geverifieerd: grep mig 312), dus header-only of niet-getriggerde orders kunnen blijven hangen. Laatste volledige definitie = **mig 312 r49-214**, signatuur `create_edi_order(p_inkomend_bericht_id BIGINT, p_payload_parsed JSONB, p_debiteur_nr INTEGER) RETURNS BIGINT`.

**Ontbrekend TS-deel enum-single-source:** `supabase/functions/_shared/order-lifecycle/` bevat alleen `derive-status.ts` (+ `__tests__`). Er is geen TS-waardenlijst van `order_status`; ad-hoc herhalingen o.a. in `frontend/src/lib/utils/constants.ts` (`ORDER_STATUS_COLORS`), `frontend/src/components/orders/status-tabs.tsx`, `frontend/src/lib/supabase/queries/orders.ts`, `frontend/src/lib/supabase/queries/vertegenwoordigers.ts`. Mig 350 noemt `ORDER_STATUS_COLORS` expliciet als handmatige spiegel — die spiegel automatiseren we met de contracttest.

**`_apply_transitie`-signatuur** ([`218_order_lifecycle_module.sql`](../../../supabase/migrations/218_order_lifecycle_module.sql) r53-61):
```sql
_apply_transitie(p_order_id BIGINT, p_event_type order_event_type, p_status_na order_status,
                 p_actor_medewerker_id BIGINT DEFAULT NULL, p_actor_auth_user_id UUID DEFAULT NULL,
                 p_reden TEXT DEFAULT NULL, p_metadata JSONB DEFAULT NULL)
```
Het is SECURITY DEFINER (mig 218_z), idempotent (no-op bij status_na == status_voor), schrijft `status_voor`/`status_na` automatisch. `'aangemaakt'` is een bestaande `order_event_type`-waarde (mig 218 r16-21) — geen enum-uitbreiding nodig voor Taak 1.

**Migratienummers:** hoogste op `main` = **352**. Dit plan claimt **353** (Taak 1) en **354** (Taak 2). **VERIFIEER OPNIEUW bij branch-start** — nummers worden door parallelle worktrees ingepikt (incidenten 8/9/10 juni, tweemaal vandaag). Commando: `git ls-tree -r --name-only origin/main -- supabase/migrations/ | grep -oE '/[0-9]{3}' | grep -oE '[0-9]{3}' | sort -n | tail -3`. Bump bij collisie en pas álle nummer-referenties aan (bestandsnaam, header, NOTICE, changelog).

---

## Scope

**In scope:** mig 353 (`bevestig_concept_order` via `_apply_transitie`), mig 354 (schone `create_edi_order` met `'Klaar voor picken'` + herstel-backfill voor hangende `'Nieuw'`-orders), TS-module `order-status.ts` + golden + contracttest, docs (changelog + order-lifecycle.md + data-woordenboek).

**Expliciet buiten scope (met reden):**
- **De ladder (`derive_wacht_status`) wijzigen** — net gestabiliseerd (mig 346+352, 23-case-anker); deze taken raken hem niet.
- **De toegepaste migraties 275/308/309/312 bewerken** — bevroren history; nieuwe logica = nieuwe migratie.
- **De top-5 ad-hoc `order_status`-consumenten refactoren naar de nieuwe module** — opportunistisch later; de contracttest op `ORDER_STATUS_COLORS` is de eerste consument en bewijst het patroon. Forceer geen big-bang.
- **`import_productie_only_order` (mig 329) status-INSERT** — bewust patroon (ADR-0029), geen `UPDATE`, lint-clean.
- **Event-type van `bevestig_concept_order` veranderen** (bv. nieuw `'concept_bevestigd'`) — hergebruik `'aangemaakt'` houdt de refactor gedrags-identiek; een rijker event-type is een aparte beslissing.

---

## File Structure

**Nieuw:**
- `supabase/migrations/353_bevestig_concept_order_via_apply_transitie.sql`
- `supabase/migrations/354_create_edi_order_klaar_voor_picken_herdefinitie.sql`
- `supabase/functions/_shared/order-lifecycle/order-status.ts` — canonieke waardenlijst + type (import-vrij)
- `supabase/functions/_shared/order-lifecycle/__tests__/order-status.golden.json`
- `frontend/src/lib/orders/__tests__/order-status.contract.test.ts`

**Gewijzigd:**
- `supabase/functions/_shared/order-lifecycle/derive-status.ts` — interne lijsten typo-proofen met `satisfies`
- `docs/changelog.md`, `docs/order-lifecycle.md`, `docs/data-woordenboek.md`

---

## Task 1: `bevestig_concept_order` via `_apply_transitie` (mig 353, bevinding B3)

Gedrags-behoudende refactor: zelfde guard, zelfde doelstatus, zelfde `herbereken`-vervolgaanroep; het event wordt rijker (`status_voor`/`status_na` nu gevuld; `actor` verhuist naar metadata omdat `_apply_transitie` geen vrije `actor`-TEXT-parameter heeft).

**Files:**
- Create: `supabase/migrations/353_bevestig_concept_order_via_apply_transitie.sql`
- Reference: `supabase/migrations/308_concept_order_status.sql` r109-143 (huidige body)

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 353: bevestig_concept_order schrijft via _apply_transitie (bevinding B3)
--
-- Probleem: de mig 308-versie doet een directe UPDATE orders SET status +
-- handmatige order_events-INSERT (zonder status_voor/status_na) — buiten het
-- ADR-0006-schrijfpad om. De lint-whitelist (mig 308 als bevroren history)
-- markeerde dit als "follow-up open"; dit is die follow-up.
--
-- Gedrag identiek: zelfde Concept-guard, zelfde doelstatus, zelfde
-- herbereken_wacht_status-vervolgaanroep. Verschil: het event krijgt nu
-- status_voor='Concept'/status_na='Klaar voor picken' (was NULL/NULL) en
-- current_user staat in metadata.actor i.p.v. de actor-kolom.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION bevestig_concept_order(p_order_id BIGINT)
RETURNS TABLE(order_nr TEXT, status order_status)
LANGUAGE plpgsql
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % niet gevonden', p_order_id;
  END IF;

  IF v_order.status <> 'Concept' THEN
    RAISE EXCEPTION 'Order % heeft status %, verwacht Concept', p_order_id, v_order.status;
  END IF;

  -- ADR-0006: enige schrijfpad naar orders.status. Schrijft ook het
  -- order_events-rij (event_type 'aangemaakt', zoals de mig 308-versie).
  PERFORM _apply_transitie(
    p_order_id   := p_order_id,
    p_event_type := 'aangemaakt',
    p_status_na  := 'Klaar voor picken',
    p_metadata   := jsonb_build_object(
      'bron', 'bevestig_concept_order',
      'vorige_status', 'Concept',
      'actor', current_user::text
    )
  );

  -- Reserveringen en wacht-status herberekenen
  PERFORM herbereken_wacht_status(p_order_id);

  RETURN QUERY SELECT v_order.order_nr, 'Klaar voor picken'::order_status;
END;
$$;

GRANT EXECUTE ON FUNCTION bevestig_concept_order(BIGINT) TO authenticated, service_role;

ALTER FUNCTION bevestig_concept_order(BIGINT) SET search_path = public;

COMMENT ON FUNCTION bevestig_concept_order IS
  'Mig 308+353: promoveert een Concept-order naar Klaar voor picken via '
  '_apply_transitie (ADR-0006, bevinding B3 gesloten). Triggert daarna '
  'herbereken_wacht_status zodat reserveringen en wacht-status direct actief worden.';

-- Zelf-test: de body bevat geen directe UPDATE meer en delegeert aan _apply_transitie.
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('bevestig_concept_order(bigint)'::regprocedure);
BEGIN
  IF v_def LIKE '%UPDATE orders%' THEN
    RAISE EXCEPTION 'Mig 353: bevestig_concept_order bevat nog een directe UPDATE orders';
  END IF;
  IF v_def NOT LIKE '%_apply_transitie(%' THEN
    RAISE EXCEPTION 'Mig 353: bevestig_concept_order delegeert niet aan _apply_transitie';
  END IF;
  RAISE NOTICE 'Mig 353: bevestig_concept_order schrijft via _apply_transitie';
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Update de lint-whitelist-notitie**

In `scripts/lint-no-direct-orders-status-update.sh`, wijzig de comment-regel bij ALLOWED_PATHS:

```bash
  # 308: bevestig_concept_order directe UPDATE (bevinding B3, follow-up open)
```
wordt:
```bash
  # 308: bevestig_concept_order directe UPDATE — runtime vervangen door mig 353 (_apply_transitie)
```
(Het pad zelf blijft in de whitelist staan — het migratiebestand is bevroren history.)

- [ ] **Step 3: Run de lint**

Run: `bash scripts/lint-no-direct-orders-status-update.sh` (vanuit repo-root, Git Bash)
Expected: `OK: geen directe UPDATE orders SET status buiten Module-allowlist`

- [ ] **Step 4: Lever de migratie aan de gebruiker (RED → GREEN)**

GEEN DB-toegang. Vraag de gebruiker:
1. Eerst alléén het `DO $$ … END $$;`-zelf-test-blok → verwacht **RED**: `EXCEPTION 'Mig 353: bevestig_concept_order bevat nog een directe UPDATE orders'` (de live mig 308-body bevat die UPDATE).
2. Dan het hele bestand → verwacht **GREEN**: `NOTICE: Mig 353: bevestig_concept_order schrijft via _apply_transitie`.
Wacht op terugkoppeling vóór commit.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/353_bevestig_concept_order_via_apply_transitie.sql scripts/lint-no-direct-orders-status-update.sh
git commit -m "fix(orders): bevestig_concept_order via _apply_transitie (bevinding B3, mig 353)"
```

---

## Task 2: Schone herdefinitie `create_edi_order` + herstel-backfill (mig 354)

Fixt de mig 309/312-regressie (status-literal `'Nieuw'` terug na de mig 275-patch) met een schone, volledige herdefinitie — geen `pg_get_functiondef`+`REPLACE()`-truc meer. Plus een eenmalige backfill die eventueel hangende `'Nieuw'`-EDI-orders door de ladder haalt.

**Files:**
- Create: `supabase/migrations/354_create_edi_order_klaar_voor_picken_herdefinitie.sql`
- Reference (verbatim basis): `supabase/migrations/312_edi_afleveradres_gln_fix.sql` r49-214

- [ ] **Step 1: Stel eerst de schade vast (gebruiker, SQL Editor)**

Vraag de gebruiker deze query te draaien vóór je de migratie schrijft (bepaalt of de backfill iets te doen heeft; het antwoord komt in de changelog):

```sql
SELECT count(*) AS hangende_nieuw_edi,
       array_agg(order_nr ORDER BY id) AS orders
  FROM orders
 WHERE status = 'Nieuw' AND bron_systeem = 'edi';
```

- [ ] **Step 2: Schrijf de migratie**

Bouw het bestand als volgt op:

**(a) Header-comment:**
```sql
-- Migratie 354: schone herdefinitie create_edi_order — status 'Klaar voor picken'
--
-- Regressie: mig 275 patchte de status-literal 'Nieuw' -> 'Klaar voor picken'
-- via pg_get_functiondef+REPLACE; mig 309 en 312 herdefinieerden de functie
-- daarna met de OUDE literal terug -> EDI-orders landen sinds mig 309/312 op de
-- dode status 'Nieuw'. Zelf-helend zodra een orderregel-trigger
-- herbereken_wacht_status aanroept (ladder-regel 5 kent 'Nieuw'), maar
-- create_edi_order zelf doet dat niet -> orders kunnen blijven hangen.
--
-- Fix: volledige herdefinitie (body = mig 312 r49-214, één regel gewijzigd) +
-- eenmalige backfill die hangende 'Nieuw'-EDI-orders door de ladder haalt.
-- Geen REPLACE-truc meer: de volgende herdefinieerder ziet de juiste literal
-- gewoon in dit bestand staan.
--
-- Idempotent: CREATE OR REPLACE; backfill is no-op als er niets hangt.
```

**(b) De functie:** kopieer de VOLLEDIGE `CREATE OR REPLACE FUNCTION create_edi_order(...)`-definitie uit `supabase/migrations/312_edi_afleveradres_gln_fix.sql` regels 49-214 **byte-voor-byte**, met exact één wijziging — regel 161:
```sql
    'edi', v_transactie_id, 'Nieuw'
```
wordt:
```sql
    'edi', v_transactie_id, 'Klaar voor picken'  -- mig 275-intentie hersteld (mig 354)
```
Verifieer met `git diff --no-index` of een handmatige vergelijking dat er verder GEEN verschillen zijn met de mig 312-body (zelfde signatuur, zelfde GRANTs als mig 312 ze had). Neem ook de GRANT- en COMMENT-statements van mig 312 over; breid de COMMENT uit met `' Mig 354: status-literal definitief Klaar voor picken (regressie mig 309/312 hersteld).'`.

**(c) Zelf-test + backfill:**
```sql
-- Zelf-test: de dode literal is weg, de juiste staat erin.
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('create_edi_order(bigint, jsonb, integer)'::regprocedure);
BEGIN
  IF v_def LIKE $marker$%'edi', v_transactie_id, 'Nieuw'%$marker$ THEN
    RAISE EXCEPTION 'Mig 354: create_edi_order bevat nog de dode status-literal Nieuw';
  END IF;
  IF v_def NOT LIKE $marker$%'edi', v_transactie_id, 'Klaar voor picken'%$marker$ THEN
    RAISE EXCEPTION 'Mig 354: create_edi_order bevat de Klaar voor picken-literal niet';
  END IF;
  RAISE NOTICE 'Mig 354: create_edi_order zet Klaar voor picken';
END $$;

-- Eenmalige backfill: haal hangende 'Nieuw'-EDI-orders door de ladder
-- (ladder-regel 5: 'Nieuw' zonder blokkades -> 'Klaar voor picken'; met
-- claims/tekorten -> passende wacht-status). Via herbereken_wacht_status,
-- dus door _apply_transitie met audit-trail.
DO $$
DECLARE
  v_id BIGINT;
  v_n  INTEGER := 0;
BEGIN
  FOR v_id IN SELECT id FROM orders WHERE status = 'Nieuw' AND bron_systeem = 'edi'
  LOOP
    PERFORM herbereken_wacht_status(v_id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'Mig 354: % hangende Nieuw-EDI-order(s) herberekend', v_n;
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Lever de migratie aan de gebruiker (RED → GREEN)**

1. Eerst alléén het eerste `DO`-zelf-test-blok → verwacht **RED**: `EXCEPTION 'Mig 354: create_edi_order bevat nog de dode status-literal Nieuw'`.
2. Dan het hele bestand → verwacht **GREEN**: beide NOTICEs (`zet Klaar voor picken` + `N hangende Nieuw-EDI-order(s) herberekend`).
3. Na-verificatie:
```sql
SELECT count(*) AS resterende_nieuw_edi FROM orders WHERE status = 'Nieuw' AND bron_systeem = 'edi';
```
Verwacht: `0`. Wacht op terugkoppeling vóór commit.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/354_create_edi_order_klaar_voor_picken_herdefinitie.sql
git commit -m "fix(edi): create_edi_order definitief Klaar voor picken + backfill (regressie mig 309/312, mig 354)"
```

---

## Task 3: `order_status` TS-single-source (module + golden + contracttest)

De SQL-kant (mig 350-set-assert) bestaat al. Dit levert de TS-kant: één waardenlijst die de ad-hoc herhalingen kan vervangen, geankerd aan dezelfde 17 waarden, met `ORDER_STATUS_COLORS` als eerste geautomatiseerde spiegel. Set-semantiek, net als mig 350 (volgorde niet betekenis-dragend).

**Files:**
- Create: `supabase/functions/_shared/order-lifecycle/order-status.ts`
- Create: `supabase/functions/_shared/order-lifecycle/__tests__/order-status.golden.json`
- Create: `frontend/src/lib/orders/__tests__/order-status.contract.test.ts`
- Modify: `supabase/functions/_shared/order-lifecycle/derive-status.ts`

- [ ] **Step 1: Schrijf de golden-fixture** `supabase/functions/_shared/order-lifecycle/__tests__/order-status.golden.json` — DEZELFDE 17 waarden als mig 350 (canoniek + legacy, in dezelfde groepering):

```json
{
  "_bron": "order_status-enum — set-anker met mig 350 (assert) en order-status.ts. Set-semantiek: volgorde niet betekenis-dragend (basis-CREATE TYPE pre-migratie-tijdperk).",
  "canoniek": [
    "Concept", "Klaar voor picken", "Wacht op voorraad", "Wacht op inkoop",
    "Wacht op maatwerk", "In pickronde", "Deels verzonden", "Verzonden",
    "Geannuleerd", "Maatwerk afgerond"
  ],
  "legacy": [
    "Nieuw", "Actie vereist", "Wacht op picken", "In snijplan",
    "In productie", "Deels gereed", "Klaar voor verzending"
  ]
}
```

- [ ] **Step 2: Schrijf de module** `supabase/functions/_shared/order-lifecycle/order-status.ts`:

```ts
// Canonieke order_status-waardenlijst — TS-kant van het enum-anker.
// SQL-kant: mig 350 (set-assert tegen de live enum). Golden-fixture:
// __tests__/order-status.golden.json. Bij een enum-wijziging (ALTER TYPE
// order_status ADD VALUE) MOETEN alle drie in één commit mee — de Vitest-
// contracttest en de mig 350-opvolger-assert dwingen dat af.
// LET OP: géén Deno-only imports (npm:/jsr:/https://) — dit bestand wordt
// direct door frontend-Vitest geïmporteerd (zelfde seam als derive-status.ts).
// Set-semantiek: volgorde is NIET betekenis-dragend (mig 350-keuze).

/** Statussen die actief geschreven worden (ADR-0016 + mig 308/327). */
export const ORDER_STATUSSEN_CANONIEK = [
  'Concept', 'Klaar voor picken', 'Wacht op voorraad', 'Wacht op inkoop',
  'Wacht op maatwerk', 'In pickronde', 'Deels verzonden', 'Verzonden',
  'Geannuleerd', 'Maatwerk afgerond',
] as const

/** Bestaan nog in de enum maar worden niet meer geschreven ('In productie' hergebruikt door mig 329). */
export const ORDER_STATUSSEN_LEGACY = [
  'Nieuw', 'Actie vereist', 'Wacht op picken', 'In snijplan',
  'In productie', 'Deels gereed', 'Klaar voor verzending',
] as const

/** Alle enum-waarden (canoniek + legacy) — spiegelt enum_range(NULL::order_status) als set. */
export const ORDER_STATUSSEN = [
  ...ORDER_STATUSSEN_CANONIEK, ...ORDER_STATUSSEN_LEGACY,
] as const

export type OrderStatus = (typeof ORDER_STATUSSEN)[number]
```

- [ ] **Step 3: Schrijf de falende contracttest (RED)** `frontend/src/lib/orders/__tests__/order-status.contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import golden from '../../../../../supabase/functions/_shared/order-lifecycle/__tests__/order-status.golden.json'
import {
  ORDER_STATUSSEN,
  ORDER_STATUSSEN_CANONIEK,
  ORDER_STATUSSEN_LEGACY,
} from '../../../../../supabase/functions/_shared/order-lifecycle/order-status'
import { ORDER_STATUS_COLORS } from '@/lib/utils/constants'

const asSortedSet = (xs: readonly string[]) => [...new Set(xs)].sort()

describe('order_status contract: TS ≡ golden (set-semantiek, mirrort mig 350)', () => {
  it('canoniek dekt exact golden.canoniek', () => {
    expect(asSortedSet(ORDER_STATUSSEN_CANONIEK)).toEqual(asSortedSet(golden.canoniek))
  })

  it('legacy dekt exact golden.legacy', () => {
    expect(asSortedSet(ORDER_STATUSSEN_LEGACY)).toEqual(asSortedSet(golden.legacy))
  })

  it('totaal = 17 waarden, geen dubbelen, geen overlap canoniek/legacy', () => {
    expect(ORDER_STATUSSEN).toHaveLength(17)
    expect(asSortedSet(ORDER_STATUSSEN)).toHaveLength(17)
  })

  it('ORDER_STATUS_COLORS dekt exact alle enum-waarden (mig 350-spiegel geautomatiseerd)', () => {
    expect(asSortedSet(Object.keys(ORDER_STATUS_COLORS))).toEqual(asSortedSet(ORDER_STATUSSEN))
  })
})
```

> **Let op bij Step 3:** controleer eerst hoe `ORDER_STATUS_COLORS` in `frontend/src/lib/utils/constants.ts` heet en geëxporteerd wordt (named export? exact die naam?) en pas de import aan de werkelijkheid aan. Dekt `ORDER_STATUS_COLORS` niet alle 17 waarden, dan is dat een ECHTE vondst: vul de ontbrekende kleuren daar aan (kies kleuren consistent met de bestaande badge-stijl) — verwijder geen test-assertie om hem groen te krijgen.

- [ ] **Step 4: Run RED**

Run: `cd frontend && npx vitest run src/lib/orders/__tests__/order-status.contract.test.ts`
Expected: FAIL — module `order-status` bestaat nog niet (als je Step 2 ná Step 3 uitvoert) of een asserter-mismatch. Toon de fail, schrijf/fix dan de module.

- [ ] **Step 5: Run GREEN + typo-proof `derive-status.ts`**

Run dezelfde test → alle 4 pass. Wijzig daarna in `supabase/functions/_shared/order-lifecycle/derive-status.ts` de twee set-declaraties zodat lijst-leden compile-time tegen de enum getypt zijn (import is relatief en import-vrij — Deno-veilig):

```ts
import type { OrderStatus } from './order-status'
```
en:
```ts
const EINDSTATUS_OF_PICKRONDE: ReadonlySet<string> = new Set([
  'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
  'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
  'In pickronde', 'Deels verzonden', 'Maatwerk afgerond',
] as const satisfies readonly OrderStatus[])
```
(idem voor `HERBEREKENBARE_WACHT` met `satisfies readonly OrderStatus[]`). **Neem de lijst-INHOUD letterlijk over uit de huidige `derive-status.ts` op `main`** (mig 352 voegde `'Maatwerk afgerond'` aan de guard toe — verifieer de actuele inhoud, verander er NIETS aan; alleen de `satisfies`-typing is nieuw). Werk de header-comment-regel "dat kan omdat dit bestand import-vrij is" bij naar: "dat kan omdat dit bestand alleen relatieve, import-vrije imports heeft".

- [ ] **Step 6: Run volledige verificatie**

```bash
cd frontend && npx vitest run src/lib/orders/__tests__/   # order-status 4 pass + derive-status blijft groen (24 tests)
cd frontend && npm run typecheck                          # schoon
```

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/order-lifecycle/ frontend/src/lib/orders/__tests__/order-status.contract.test.ts frontend/src/lib/utils/constants.ts
git commit -m "feat(orders): order_status als TS-single-source + ORDER_STATUS_COLORS-contracttest"
```
(Laat `constants.ts` weg uit de add als er geen kleuren aangevuld hoefden te worden.)

---

## Task 4: Levende docs

**Files:**
- Modify: `docs/changelog.md` (entry bovenaan, match bestaande stijl)
- Modify: `docs/order-lifecycle.md` (CLAUDE.md: verplicht bijwerken bij wijzigingen aan intake/statusflow — Taak 1 en 2 raken intake-RPC's)
- Modify: `docs/data-woordenboek.md` (alleen als de Order-status-ladder-rij verwijst naar verouderde feiten — anders overslaan)

- [ ] **Step 1: Changelog-entry** (herformuleer naar huisstijl; neem het Step-1-resultaat van Taak 2 — het aantal hangende orders — op):

```markdown
## 2026-06-10 — Order-status follow-ups: B3 gesloten, EDI-'Nieuw'-regressie hersteld, enum-TS-single-source

Drie restpunten uit de order-status-consolidatie. (1) `bevestig_concept_order`
schrijft via `_apply_transitie` i.p.v. directe UPDATE + handmatige event-INSERT
(mig 353; bevinding B3 uit de lint-verbreding — event krijgt nu status_voor/na,
actor in metadata). (2) `create_edi_order` definitief op `'Klaar voor picken'`:
mig 309/312 hadden de mig 275-patch ongedaan gemaakt waardoor EDI-orders op de
dode status `'Nieuw'` landden; mig 354 herdefinieert schoon (geen
pg_get_functiondef+REPLACE-truc meer) en backfillt hangende orders door de
ladder (N stuks — vul in uit Taak 2 Step 1/3). (3) `order_status` is nu ook in
TS single-source: `_shared/order-lifecycle/order-status.ts` (canoniek+legacy,
set-semantiek) ⇄ golden-fixture ⇄ mig 350-assert, met een contracttest die
`ORDER_STATUS_COLORS` als eerste spiegel automatiseert en `satisfies`-typing op
de derive-status-lijsten.
```

- [ ] **Step 2: order-lifecycle.md** — lees het document eerst; werk de RPC→migratie-tabel bij (`bevestig_concept_order` → mig 353, `create_edi_order` → mig 354) en sluit bevinding B3 in de bevindingen-triage af als die daar staat. Vermeld dat EDI-intake nu direct op `'Klaar voor picken'` landt.

- [ ] **Step 3: data-woordenboek** — check de Order-status-ladder-rij; voeg hooguit één verwijzing toe naar `order-status.ts` als enum-waardenlijst-bron. Geen herschrijving.

- [ ] **Step 4: Commit + klaar melden**

```bash
git add docs/changelog.md docs/order-lifecycle.md docs/data-woordenboek.md
git commit -m "docs(orders): changelog + order-lifecycle + data-woordenboek na status-follow-ups"
```
Meld aan de gebruiker: branch klaar; mig 353 én 354 moeten elk RED→GREEN in de SQL Editor (in nummervolgorde); wacht op expliciet "merge naar main".

---

## Self-Review

**1. Spec-dekking:** B3 = Taak 1; EDI-regressie + dataherstel = Taak 2; enum-TS-deel (het enige nog ontbrekende stuk van follow-up 4) = Taak 3; docs = Taak 4. De al-gedane follow-ups (security-pin mig 351/352, lint-glob + 330-refactor mig 347/348, SQL-set-assert mig 350) staan onder "Reeds gedaan" zodat niemand ze dubbel doet.

**2. Placeholder-scan:** Taak 1 bevat de volledige nieuwe functie-body. Taak 2 verwijst voor de 165-regel-body naar een exacte bron (mig 312 r49-214) met een exacte één-regel-transformatie en byte-vergelijkings-instructie — bewust geen duplicatie van 165 regels in het plan. Taak 3 bevat module, fixture en test volledig; de `ORDER_STATUS_COLORS`-naamcheck is een gerichte verificatiestap met instructie wat te doen bij mismatch.

**3. Type-/gedrag-consistentie:** `_apply_transitie`-aanroep in Taak 1 gebruikt de geverifieerde signatuur (named args, bestaand event-type `'aangemaakt'`). Taak 3's 17 waarden zijn byte-gelijk aan mig 350 r29-37. De `satisfies`-edit in Step 5 verandert de lijst-inhoud expliciet NIET (mig 352-stand is leidend; instructie zegt actuele bron lezen). Migratienummers 353/354 consequent; her-verificatie-instructie bovenaan.

---

## Kritische uitvoer-context

1. **Geen DB-toegang** — mig 353/354 levert de agent aan de gebruiker (SQL Editor, RED→GREEN, in nummervolgorde), inclusief de schade-query vóóraf (Taak 2 Step 1) en de na-verificatie.
2. **Migratienummers 353/354 her-verifiëren bij branch-start** (zie boven) — vandaag al tweemaal een collisie gehad.
3. **Eigen branch + worktree** (`fix/order-status-followups` o.i.d.); merge alleen op expliciet commando.
4. **De ladder niet aanraken** — `derive_wacht_status`/`herbereken_wacht_status` zijn net gestabiliseerd; Taak 3 Step 5 voegt alléén typing toe, geen inhoudelijke lijst-wijziging.
5. **`bron_systeem`-kolomnaam in Taak 2 verifiëren** — de queries nemen aan dat EDI-orders herkenbaar zijn aan `orders.bron_systeem = 'edi'` (zoals de "Te bevestigen"-chip gebruikt). Klopt dat niet (check kolom + waarde met een grep op `bron_systeem` in migraties), pas de WHERE-clausules consistent aan in schade-query, backfill én na-verificatie.
