# Order-status ladder → single-source (Fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. You have a fresh context window — this plan is self-contained; read it fully before starting.

**Goal:** De order-status-afleidingsladder (de IF/CASE die `orders.status` kiest) extraheren naar één **pure functie** — in SQL én als TS-spiegel — met een golden-fixture en een zelf-testende migratie die SQL ≡ TS borgen, zodat de volgende herschrijving van de ladder niet meer geruisloos kan regresseren (zoals de mig 269/273 `Nieuw`/`Wacht op maatwerk`-regressie die mig 275 moest herstellen).

**Architecture:** Vandaag leeft de beslissingslogica inline in de PL/pgSQL-runtime `herbereken_wacht_status` (mig 275). We splitsen *data-verzameling* (de drie `EXISTS`-queries, blijven in `herbereken_wacht_status`) van *beslissing* (de IF/CASE → verhuist naar een nieuwe `IMMUTABLE` SQL-functie `derive_wacht_status(huidig, io, tekort, maatwerk)`). Een framework-agnostische TS-functie `deriveWachtStatus(...)` spiegelt 'm. Drie ankers binden alles: een golden-fixture-truthtable (combinaties → verwachte status), een Vitest-contracttest (TS ≡ fixture) en een zelf-testende migratie (SQL ≡ fixture). Dit is **geen nieuw mechanisme** — het is exact het Fase 1-patroon (golden-fixture + zelf-testende migratie + bestaande `_apply_transitie`/lint-seam), nu toegepast op gedrag i.p.v. een enum.

**Tech Stack:** Supabase/PostgreSQL (PL/pgSQL-migraties, **handmatig** toegepast via de SQL Editor — de agent heeft GEEN DB-toegang), React/TypeScript + Vitest, Deno edge functions (`supabase/functions/_shared/`).

---

## Geverifieerde grond-waarheid (recon 2026-06-10, tegen `main`)

**Huidige runtime-ladder:** `herbereken_wacht_status(p_order_id BIGINT)` — laatste definitie in [`supabase/migrations/275_nieuw_status_deprecate_klaar_voor_picken.sql`](../../../supabase/migrations/275_nieuw_status_deprecate_klaar_voor_picken.sql) r214-293. Keten van herdefinities: mig 218 → 258 → 269 → 273 → **275 (live)**. De exacte huidige body staat hieronder in Task 1 verbatim.

> **⚠️ UPDATE 2026-06-10 (na de merge van dit plan als mig 346):** de
> `derive_wacht_status`-guard zoals in mig 346 gemerged miste de terminale
> status `'Maatwerk afgerond'` (mig 327 — regressie-bug B13: een afgeronde
> productie-only order heeft per definitie `maatwerk=true`, dus tak 4 zette
> hem terug naar `'Wacht op maatwerk'`; de truthtable pinde alleen de
> all-false-combinatie). Bovendien zette mig 346 SECURITY DEFINER +
> search_path niet terug na de CREATE OR REPLACE (218_z-les), en is de
> delegatie in de DB tijdelijk overschreven door mig 351 (parallel toegepast).
> **Mig 352 is de geldende eindvorm**: delegatie hersteld, `'Maatwerk
> afgerond'` in de pure functie, TS-spiegel + golden-fixture bijgewerkt.
> Zie `docs/order-lifecycle.md` §4 + §11/B13.

**De ladder-logica (mig 275, eerste match wint):**
1. `v_huidig ∈ {Verzonden, Geannuleerd, Klaar voor verzending, In productie, In snijplan, Deels gereed, Wacht op picken, In pickronde, Deels verzonden}` → **no-op** (commands/legacy beheren die).
2. ≥1 actieve IO-claim → `Wacht op inkoop`
3. ≥1 vaste-maten-regel met tekort (niet-maatwerk, niet-admin-pseudo, `te_leveren > Σ actieve claims`) → `Wacht op voorraad`
4. ≥1 maatwerk-regel zónder snijplan in status `Ingepakt` → `Wacht op maatwerk`
5. `v_huidig ∈ {Wacht op inkoop, Wacht op voorraad, Wacht op maatwerk, Nieuw}` → `Klaar voor picken`
6. anders → **no-op**

**De toegegeven regressie** (waar Fase 2 een structureel vangnet voor bouwt) — [`mig 275`](../../../supabase/migrations/275_nieuw_status_deprecate_klaar_voor_picken.sql) r1-23: mig 269/273 introduceerden het admin-pseudo-filter maar lieten de ADR-0016-takken (`Wacht op maatwerk` + `Klaar voor picken`-target) vallen → orders 2063-2067 bleven geruisloos op de dode status `Nieuw` staan. Geen test ving dit; mig 275 herstelde het met de hand.

**De "kopieën" — BELANGRIJK, leest scope-bepalend:**
- Backfill B = [`mig 258`](../../../supabase/migrations/258_order_status_transities_backfill.sql) r590-649 (inline fase-logica voor `Nieuw`-orders).
- Backfill C = [`mig 275`](../../../supabase/migrations/275_nieuw_status_deprecate_klaar_voor_picken.sql) r321-415 (inline fase-logica + IO/admin-filter).
- **Deze twee zijn REEDS TOEGEPASTE, eenmalige migraties — bevroren history. Je kunt ze NIET retroactief bewerken of consolideren** (een toegepaste migratie aanpassen breekt de deploy-keten en doet niets aan de al-gedraaide DB). De "3 kopieën → 1" uit het hoofdplan is daarom **niet** "edit de backfills", maar: vanaf nu leeft de ladder op één plek (`derive_wacht_status`), zodat de *volgende* schrijver niet opnieuw inline kopieert. De backfills blijven staan zoals ze zijn.

**Bestaande seam-helft (hergebruiken, niet opnieuw bouwen):**
- `_apply_transitie(p_order_id, p_event_type, p_status_na, ...)` ([`mig 218`](../../../supabase/migrations/218_order_lifecycle_module.sql) r53-96) = het **enige** schrijfpad naar `orders.status` (+ `order_events`-audit). `herbereken_wacht_status` schrijft hier doorheen — dat blijft zo.
- [`scripts/lint-no-direct-orders-status-update.sh`](../../../scripts/lint-no-direct-orders-status-update.sh) dwingt dat af (whitelist: alleen de mig 218-bestanden).
- Contracttests bestaan voor de RPC-*wrappers* ([`frontend/src/modules/orders-lifecycle/__tests__/transities.contract.test.ts`](../../../frontend/src/modules/orders-lifecycle/__tests__/transities.contract.test.ts)) maar **NIET voor de state-machine-logica zelf** — die is DB-only en daardoor niet DB-loos te unit-testen. Dat gat dicht Fase 2.

**ADR-0006** ([`docs/adr/0006-*.md`](../../../docs/adr/)) belooft expliciet "de pure state-machine als TS-functie + contract-tests" in `supabase/functions/_shared/order-lifecycle/`. **Die ontbreekt** — Fase 2 levert 'm.

**Order-status enum** bevat o.a. de spook-waarden `Nieuw` en `Klaar voor verzending` (geen writers meer, alleen in WHERE/guards). We laten de enum ongemoeid (Postgres staat geen DROP VALUE toe); de pure functie reproduceert de guard-lijst verbatim.

**Volatiliteits-/gedragsdetail (load-bearing):** de huidige runtime roept `_apply_transitie` aan zodra een tak `v_doel` zet — óók als `v_doel == v_huidig` (bv. al `Wacht op inkoop` en nog steeds IO-claim → her-apply met dezelfde status). De NULL-uitkomst van `derive_wacht_status` representeert **exact** de twee `RETURN`-paden (eindstatus-guard + de finale `ELSE`). De refactor moet dus zijn: `IF v_doel IS NOT NULL THEN PERFORM _apply_transitie(...)` — **geen** extra `AND v_doel <> v_huidig`-guard, anders verandert het event-schrijfgedrag.

---

## Scope

**In scope:** pure `derive_wacht_status` SQL-functie + refactor van `herbereken_wacht_status` om die te gebruiken (gedrags-identiek) + zelf-testende migratie + pure TS-spiegel `deriveWachtStatus` + golden-fixture + Vitest-contracttest + docs.

**Expliciet buiten scope (met reden):**
- **De toegepaste backfills (mig 258/275) bewerken** — bevroren history (zie boven).
- **De `pg_get_functiondef`+`REPLACE()`-truc in mig 275 r164-197** (die `edi_create_order` patcht van `Nieuw` → `Klaar voor picken`). Dat is óók toegepaste history; de DB heeft de gepatchte functie al. Een schone herdefinitie van `edi_create_order` is een aparte opruiming — **noteer als follow-up**, niet hier (raakt EDI-order-aanmaak, eigen testbehoefte).
- **`order_status`-enum als TS single-source** (Fase 1-stijl voor orders) — nuttige toekomstige uitbreiding, maar niet nodig om de ladder te consolideren. De TS-spiegel gebruikt string-literals. Noteer als optionele vervolgstap.
- **Spook-statussen (`Nieuw`, `Klaar voor verzending`) verwijderen** — kan niet (enum), en niet nodig.

**Migratienummer:** hoogste op `origin/main` = **344** (Fase 1's assertie). Dit plan claimt **345**. **VERIFIEER OPNIEUW bij branch-start** — `main` beweegt snel en migratienummers worden door parallelle worktrees ingepikt (collisie-incidenten 8/9/10 juni; Fase 1 moest van 342→344 hernummeren tijdens de merge). Commando staat in de branch-setup. Bump bij collisie en pas de bestandsnaam + alle `345`-referenties consequent aan.

---

## File Structure

**Nieuw:**
- `supabase/migrations/345_derive_wacht_status_single_source.sql` — pure `derive_wacht_status`-functie + herdefinitie van `herbereken_wacht_status` die 'm aanroept + ingebouwde `DO`-assertie (truthtable). (nr. verifiëren/bumpen)
- `supabase/functions/_shared/order-lifecycle/derive-status.ts` — pure TS-spiegel `deriveWachtStatus` + types.
- `supabase/functions/_shared/order-lifecycle/__tests__/derive-status.golden.json` — golden truthtable (combinaties → verwachte status). Eén bron voor de TS-test; de migratie-assertie spiegelt dezelfde combinaties.
- `supabase/functions/_shared/order-lifecycle/__tests__/derive-status.test.ts` — Vitest-contracttest (TS ≡ golden).

**Gewijzigd:**
- `docs/changelog.md` — entry.
- `docs/adr/0006-*.md` — status-regel: pure TS-functie nu geleverd.
- `docs/data-woordenboek.md` — order-status-ladder als single-source documenteren.

> **Deno↔Vite-detail:** `_shared/` is Deno (edge), maar Vitest (frontend) moet de TS-test draaien. Volg het bestaande patroon: schrijf `derive-status.ts` als plain TS zonder Deno-only imports (geen `https://`-imports in het bron-bestand), zodat zowel Vitest als Deno 'm kunnen importeren. De test gebruikt Vitest-syntax (`import { describe, it, expect } from 'vitest'`). Controleer hoe bestaande `_shared/*.test.ts` (bv. `snij-marges.test.ts`) draaien — als die Deno-tests zijn, plaats de TS-contracttest dan onder `frontend/src/lib/orders/__tests__/` en importeer het bron-bestand via een relatief pad of alias. **Beslis dit in Task 2 Step 0 op basis van wat er feitelijk in de repo staat; rapporteer de keuze.**

---

## Task 1: Pure `derive_wacht_status` SQL-functie + refactor runtime + zelf-test

De beslissingsladder verhuist naar een `IMMUTABLE` functie op primitieve inputs; `herbereken_wacht_status` behoudt de data-verzameling en delegeert de beslissing. Gedrags-identiek aan mig 275. De ingebouwde `DO`-assertie is de "test" (TDD voor SQL-helpers, repo-conventie).

**Files:**
- Create: `supabase/migrations/345_derive_wacht_status_single_source.sql`
- Reference (verbatim begin-vorm): `supabase/migrations/275_nieuw_status_deprecate_klaar_voor_picken.sql` r214-293

- [ ] **Step 1: Schrijf de migratie**

Maak `supabase/migrations/345_derive_wacht_status_single_source.sql`:

```sql
-- Migratie 345: order-status-ladder als single-source (ADR-0006)
--
-- Probleem: de beslissingslogica die orders.status kiest leeft inline in de
-- PL/pgSQL-runtime herbereken_wacht_status en is sinds mig 218 vijf keer
-- herschreven (218->258->269->273->275). Bij 269/273 vielen de ADR-0016-takken
-- (Wacht op maatwerk / Klaar voor picken-target) geruisloos weg -> orders
-- 2063-2067 bleven op de dode status 'Nieuw' (mig 275 r1-23). Geen test ving dit.
--
-- Fix: splits BESLISSING van DATA-VERZAMELING. derive_wacht_status() bevat alleen
-- de ladder (pure, IMMUTABLE, op primitieve inputs); herbereken_wacht_status
-- verzamelt de claim-/snijplan-state en delegeert. De ingebouwde DO-assertie
-- borgt de truthtable (incl. de regressie-cases). Gedrag identiek aan mig 275.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

-- 1) Pure beslissingsfunctie. NULL = "niet wijzigen" (reproduceert beide RETURNs
--    uit mig 275: de eindstatus-guard en de finale ELSE).
CREATE OR REPLACE FUNCTION derive_wacht_status(
  p_huidig         order_status,
  p_heeft_io_claim BOOLEAN,
  p_heeft_tekort   BOOLEAN,
  p_heeft_maatwerk BOOLEAN
) RETURNS order_status
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    -- 1) Eindstatussen + pickronde-fases: door commands/legacy beheerd -> no-op.
    WHEN p_huidig IN (
      'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
      'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
      'In pickronde', 'Deels verzonden'
    ) THEN NULL
    -- 2) Inkoop-claim
    WHEN p_heeft_io_claim   THEN 'Wacht op inkoop'::order_status
    -- 3) Vaste-maten-tekort
    WHEN p_heeft_tekort     THEN 'Wacht op voorraad'::order_status
    -- 4) Maatwerk nog niet pickbaar
    WHEN p_heeft_maatwerk   THEN 'Wacht op maatwerk'::order_status
    -- 5) Wacht-staat (of legacy 'Nieuw') zonder open blokkades -> pickbaar
    WHEN p_huidig IN ('Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk', 'Nieuw')
                            THEN 'Klaar voor picken'::order_status
    -- 6) anders: niets te doen (bv. al 'Klaar voor picken')
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION derive_wacht_status(order_status, BOOLEAN, BOOLEAN, BOOLEAN) IS
  'Mig 345 (ADR-0006): pure order-status-ladder. NULL = niet wijzigen. '
  'Single-source van de beslissing die voorheen inline in herbereken_wacht_status '
  'stond (mig 275). Gespiegeld in _shared/order-lifecycle/derive-status.ts.';

GRANT EXECUTE ON FUNCTION derive_wacht_status(order_status, BOOLEAN, BOOLEAN, BOOLEAN)
  TO authenticated, service_role;

-- 2) Runtime: verzamel state, delegeer beslissing. Body identiek aan mig 275 r214-293
--    behalve dat de IF/ELSIF-ladder is vervangen door derive_wacht_status().
CREATE OR REPLACE FUNCTION herbereken_wacht_status(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig         order_status;
  v_heeft_io_claim BOOLEAN;
  v_heeft_tekort   BOOLEAN;
  v_heeft_maatwerk BOOLEAN;
  v_doel           order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;

  -- 1) Inkoop-claim
  SELECT EXISTS (
    SELECT 1 FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    WHERE oreg.order_id = p_order_id
      AND r.bron = 'inkooporder_regel'
      AND r.status = 'actief'
  ) INTO v_heeft_io_claim;

  -- 2) Voorraad-tekort (alleen vaste-maten, geen admin-pseudo's)
  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = false
      AND oreg.artikelnr IS NOT NULL
      AND NOT is_admin_pseudo(oreg.artikelnr)
      AND oreg.te_leveren > COALESCE((
        SELECT SUM(aantal) FROM order_reserveringen r
        WHERE r.order_regel_id = oreg.id AND r.status = 'actief'
      ), 0)
  ) INTO v_heeft_tekort;

  -- 3) Maatwerk-regel zonder ingepakt snijplan = nog niet pickbaar.
  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = true
      AND NOT EXISTS (
        SELECT 1 FROM snijplannen sp
        WHERE sp.order_regel_id = oreg.id
          AND sp.status = 'Ingepakt'
      )
  ) INTO v_heeft_maatwerk;

  -- Beslissing via single-source. NULL = niet wijzigen (zowel de eindstatus-guard
  -- als de "niets te doen"-tak uit mig 275 vallen hieronder).
  v_doel := derive_wacht_status(v_huidig, v_heeft_io_claim, v_heeft_tekort, v_heeft_maatwerk);

  IF v_doel IS NOT NULL THEN
    PERFORM _apply_transitie(
      p_order_id   := p_order_id,
      p_event_type := 'wacht_status_herberekend',
      p_status_na  := v_doel
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION herbereken_wacht_status(BIGINT) TO authenticated;

COMMENT ON FUNCTION herbereken_wacht_status IS
  'Mig 218+258+272/273+275+345: verzamelt claim-/snijplan-state en delegeert de '
  'statuskeuze aan derive_wacht_status() (single-source). Schrijft via '
  '_apply_transitie. Gedrag identiek aan mig 275.';

-- 3) Assertie ("test"): de truthtable. Vóór CREATE faalt dit; erna moet het slagen.
--    Dezelfde combinaties staan in derive-status.golden.json (TS-spiegel).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- huidig,               io,    tekort, maatwerk, verwacht (NULL = no-op)
      ('Nieuw'::order_status,            false, false, false, 'Klaar voor picken'::order_status), -- regressie-case 2063-2067
      ('Nieuw'::order_status,            false, false, true,  'Wacht op maatwerk'::order_status), -- verloren ADR-0016-tak
      ('Nieuw'::order_status,            true,  false, false, 'Wacht op inkoop'::order_status),
      ('Nieuw'::order_status,            false, true,  false, 'Wacht op voorraad'::order_status),
      ('Nieuw'::order_status,            true,  true,  true,  'Wacht op inkoop'::order_status),   -- prioriteit io > tekort > maatwerk
      ('Wacht op maatwerk'::order_status,false, false, false, 'Klaar voor picken'::order_status), -- maatwerk opgelost
      ('Wacht op inkoop'::order_status,  true,  false, false, 'Wacht op inkoop'::order_status),   -- her-apply zelfde status
      ('Klaar voor picken'::order_status,false, false, false, NULL::order_status),                -- no-op
      ('Verzonden'::order_status,        true,  true,  true,  NULL::order_status),                -- eindstatus-guard wint
      ('In pickronde'::order_status,     true,  false, false, NULL::order_status),
      ('Geannuleerd'::order_status,      false, false, false, NULL::order_status)
    ) AS t(huidig, io, tekort, maatwerk, verwacht)
  LOOP
    IF derive_wacht_status(r.huidig, r.io, r.tekort, r.maatwerk) IS DISTINCT FROM r.verwacht THEN
      RAISE EXCEPTION 'FAAL: derive_wacht_status(%, %, %, %) gaf % maar verwacht %',
        r.huidig, r.io, r.tekort, r.maatwerk,
        derive_wacht_status(r.huidig, r.io, r.tekort, r.maatwerk), r.verwacht;
    END IF;
  END LOOP;
  RAISE NOTICE 'Mig 345: alle derive_wacht_status-asserties geslaagd';
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Lever de migratie aan de gebruiker (RED → GREEN)**

De agent heeft GEEN DB-toegang. Vraag de gebruiker eerst **alleen het `DO $$ … END $$;`-assertieblok** in de SQL Editor te draaien → verwacht `ERROR: function derive_wacht_status(...) does not exist` (RED). Daarna het hele bestand → verwacht `NOTICE: Mig 345: alle derive_wacht_status-asserties geslaagd` (GREEN). Wacht op terugkoppeling.

- [ ] **Step 3: Bewijs dat de live runtime nu de single-source gebruikt**

Vraag de gebruiker deze query te draaien (na toepassing):
```sql
SELECT
  pg_get_functiondef('herbereken_wacht_status(bigint)'::regprocedure) LIKE '%derive_wacht_status(%' AS gebruikt_single_source,
  pg_get_functiondef('herbereken_wacht_status(bigint)'::regprocedure) LIKE '%ELSIF v_heeft_tekort%' AS heeft_nog_inline_ladder;
```
Verwacht: `gebruikt_single_source = true`, `heeft_nog_inline_ladder = false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/345_derive_wacht_status_single_source.sql
git commit -m "feat(orders): order-status-ladder als single-source derive_wacht_status (ADR-0006, mig 345)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Pure TS-spiegel `deriveWachtStatus` + golden-fixture + Vitest

Vervult de ADR-0006-belofte: de ladder DB-loos unit-testbaar. De golden-fixture is de gedeelde truthtable; de TS-test toetst TS ≡ fixture, de mig-345-assertie toetst SQL ≡ dezelfde combinaties.

**Files:**
- Create: `supabase/functions/_shared/order-lifecycle/derive-status.ts`
- Create: `supabase/functions/_shared/order-lifecycle/__tests__/derive-status.golden.json`
- Create: het Vitest-testbestand (locatie bepaald in Step 0)

- [ ] **Step 0: Bepaal de test-locatie (Deno↔Vite)**

Lees hoe bestaande `_shared/*.test.ts` draaien (bv. `supabase/functions/_shared/snij-marges.test.ts`, `snijplan-status.test.ts`) en of de frontend Vitest `supabase/functions/_shared/**` include't (`frontend/vite.config.ts`/`vitest`-config). Kies:
- **Optie A** (voorkeur als Vitest `_shared` niet ziet): bron in `_shared/order-lifecycle/derive-status.ts`, Vitest-test in `frontend/src/lib/orders/__tests__/derive-status.test.ts` die het bron-bestand via relatief pad importeert. Golden-JSON naast de bron.
- **Optie B**: test naast de bron onder `_shared/order-lifecycle/__tests__/` als Vitest dat oppakt.
Rapporteer je keuze + waarom. Houd `derive-status.ts` vrij van Deno-only (`https://`) imports zodat beide runtimes 'm kunnen laden.

- [ ] **Step 1: Schrijf de golden-fixture** `…/derive-status.golden.json` — DEZELFDE combinaties als de mig-345-`DO`-assertie (houd ze synchroon):

```json
{
  "_bron": "truthtable van derive_wacht_status — gespiegeld in mig 345 DO-assertie. null = no-op (niet wijzigen).",
  "cases": [
    { "huidig": "Nieuw",              "io": false, "tekort": false, "maatwerk": false, "verwacht": "Klaar voor picken" },
    { "huidig": "Nieuw",              "io": false, "tekort": false, "maatwerk": true,  "verwacht": "Wacht op maatwerk" },
    { "huidig": "Nieuw",              "io": true,  "tekort": false, "maatwerk": false, "verwacht": "Wacht op inkoop" },
    { "huidig": "Nieuw",              "io": false, "tekort": true,  "maatwerk": false, "verwacht": "Wacht op voorraad" },
    { "huidig": "Nieuw",              "io": true,  "tekort": true,  "maatwerk": true,  "verwacht": "Wacht op inkoop" },
    { "huidig": "Wacht op maatwerk",  "io": false, "tekort": false, "maatwerk": false, "verwacht": "Klaar voor picken" },
    { "huidig": "Wacht op inkoop",    "io": true,  "tekort": false, "maatwerk": false, "verwacht": "Wacht op inkoop" },
    { "huidig": "Klaar voor picken",  "io": false, "tekort": false, "maatwerk": false, "verwacht": null },
    { "huidig": "Verzonden",          "io": true,  "tekort": true,  "maatwerk": true,  "verwacht": null },
    { "huidig": "In pickronde",       "io": true,  "tekort": false, "maatwerk": false, "verwacht": null },
    { "huidig": "Geannuleerd",        "io": false, "tekort": false, "maatwerk": false, "verwacht": null }
  ]
}
```

- [ ] **Step 2: Schrijf de pure TS-spiegel** `…/order-lifecycle/derive-status.ts`:

```ts
// Pure order-status-ladder — TS-spiegel van de SQL-functie derive_wacht_status
// (mig 345). null = "niet wijzigen" (no-op). Gedrag MOET identiek zijn aan de
// SQL-functie; de gedeelde golden-fixture (derive-status.golden.json) borgt dat
// via de Vitest-contracttest, de mig-345-DO-assertie borgt de SQL-kant.
// ADR-0006: dit is de beloofde pure state-machine-functie.

export type OrderWachtStatus = string  // order_status enum-waarde (DB-canoniek)

const EINDSTATUS_OF_PICKRONDE: ReadonlySet<string> = new Set([
  'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
  'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
  'In pickronde', 'Deels verzonden',
])

const HERBEREKENBARE_WACHT: ReadonlySet<string> = new Set([
  'Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk', 'Nieuw',
])

export interface WachtStatusInput {
  huidig: OrderWachtStatus
  heeftIoClaim: boolean
  heeftTekort: boolean
  heeftMaatwerk: boolean
}

/** Spiegelt SQL derive_wacht_status(). Geeft de doelstatus of null (= no-op). */
export function deriveWachtStatus(input: WachtStatusInput): OrderWachtStatus | null {
  const { huidig, heeftIoClaim, heeftTekort, heeftMaatwerk } = input
  if (EINDSTATUS_OF_PICKRONDE.has(huidig)) return null      // 1
  if (heeftIoClaim) return 'Wacht op inkoop'                // 2
  if (heeftTekort) return 'Wacht op voorraad'               // 3
  if (heeftMaatwerk) return 'Wacht op maatwerk'             // 4
  if (HERBEREKENBARE_WACHT.has(huidig)) return 'Klaar voor picken' // 5
  return null                                               // 6
}
```

- [ ] **Step 3: Schrijf de falende contracttest (RED)** op de in Step 0 gekozen locatie:

```ts
import { describe, it, expect } from 'vitest'
import golden from '<relatief pad>/derive-status.golden.json'
import { deriveWachtStatus } from '<relatief pad>/derive-status'

describe('order-status ladder: TS ≡ golden truthtable', () => {
  for (const c of golden.cases) {
    it(`${c.huidig} | io=${c.io} tekort=${c.tekort} mw=${c.maatwerk} -> ${c.verwacht ?? 'no-op'}`, () => {
      expect(
        deriveWachtStatus({
          huidig: c.huidig,
          heeftIoClaim: c.io,
          heeftTekort: c.tekort,
          heeftMaatwerk: c.maatwerk,
        }),
      ).toBe(c.verwacht)
    })
  }
})
```

- [ ] **Step 4: Run RED → implement is al gedaan (Step 2) → GREEN**

Run (pas pad/commando aan): `cd frontend && npx vitest run <pad>/derive-status.test.ts`.
Volgorde-discipline: maak eerst de test (Step 3) zonder `derive-status.ts` → RED (module mist) is aangetoond als je Step 2 even uitstelt; in de praktijk schrijf je beide en draait de test → **GREEN, alle cases pass**. Bevestig dat de TS-output per case de `verwacht`-waarde matcht (incl. de `null`/no-op-cases).

- [ ] **Step 5: Verifieer TS ≡ SQL-truthtable handmatig**

De fixture (Step 1) en de mig-345-`DO`-assertie (Task 1) bevatten dezelfde 11 combinaties met dezelfde verwachte uitkomsten — vergelijk ze regel-voor-regel en bevestig dat ze identiek zijn. Wijkt er één af → corrigeer zodat beide exact gelijk zijn (dat is de hele bindende waarde van het anker).

- [ ] **Step 6: typecheck + commit**

```bash
cd frontend && npm run typecheck   # mag geen nieuwe fouten geven
cd .. && git add supabase/functions/_shared/order-lifecycle/ frontend/src/lib/orders/__tests__/derive-status.test.ts
# (pas paden aan je Step 0-keuze aan)
git commit -m "feat(orders): pure TS-spiegel deriveWachtStatus + golden-fixture (ADR-0006)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Levende docs

**Files:**
- Modify: `docs/changelog.md` (entry bovenaan, level-2 `## YYYY-MM-DD — …`)
- Modify: `docs/adr/0006-*.md` (status: pure TS-functie geleverd)
- Modify: `docs/data-woordenboek.md` (order-status-ladder single-source)

- [ ] **Step 1: Changelog** — voeg bovenaan toe (match de bestaande stijl):

```markdown
## 2026-06-10 — Order-status-ladder als single-source (Fase 2, ADR-0006)

De beslissingsladder die `orders.status` kiest stond inline in de PL/pgSQL-runtime
`herbereken_wacht_status` en was sinds mig 218 vijfmaal herschreven; bij mig 269/273
vielen de ADR-0016-takken (`Wacht op maatwerk`/`Klaar voor picken`) geruisloos weg
(orders 2063-2067 bleven op dode status `Nieuw`, mig 275 herstelde met de hand, geen
test ving het). Geconsolideerd naar één pure functie `derive_wacht_status(huidig, io,
tekort, maatwerk)` (SQL, mig 345) + TS-spiegel `deriveWachtStatus`
(`_shared/order-lifecycle/derive-status.ts`, ADR-0006-belofte ingelost). Twee ankers
binden ze: een golden-fixture-truthtable (Vitest, TS ≡ fixture) en een zelf-testende
migratie (SQL ≡ dezelfde combinaties, incl. de regressie-cases). `herbereken_wacht_status`
verzamelt nog steeds de claim-/snijplan-state en delegeert nu de beslissing — gedrag
identiek aan mig 275. De toegepaste backfills (mig 258/275) zijn bevroren history en
blijven ongemoeid.
```

- [ ] **Step 2: ADR-0006** — zet de relevante status/sectie op "pure TS-functie geleverd (mig 345 + `_shared/order-lifecycle/derive-status.ts`, 2026-06-10)". Pas de exacte status-regel aan de bestaande ADR-structuur aan.

- [ ] **Step 3: Data-woordenboek** — voeg/ą werk een begrip bij: de order-status-ladder is single-source via `derive_wacht_status` (SQL) ⇄ `deriveWachtStatus` (TS); noem de 6 ladder-regels en dat `_apply_transitie` het enige schrijfpad blijft.

- [ ] **Step 4: Commit + meld klaar voor merge**

```bash
git add docs/changelog.md docs/adr/ docs/data-woordenboek.md
git commit -m "docs(orders): changelog + ADR-0006 + data-woordenboek na order-status single-source

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Meld aan de gebruiker dat de branch klaar is, dat mig 345 nog door de gebruiker in de SQL Editor gedraaid moet worden (RED→GREEN + de Step-3-verificatiequery), en wacht op expliciete "merge naar main" (niet automatisch mergen).

---

## Self-Review

**1. Spec-dekking:** De ladder-consolidatie (doel) = Task 1 (pure SQL + refactor). ADR-0006 pure TS-functie = Task 2. Regressie-vangnet = de truthtable in mig 345 (`DO`-assertie, incl. de `Nieuw`→`Klaar voor picken`- en `Nieuw`+maatwerk→`Wacht op maatwerk`-cases) + de Vitest-contracttest. Docs = Task 3. De bevroren backfills + de `edi_create_order`-patch + enum-TS-single-source zijn expliciet buiten scope met reden.

**2. Placeholder-scan:** Task 1 bevat de volledige, verbatim-afgeleide SQL (data-verzameling letterlijk uit mig 275 r238-273; beslissing 1-op-1 omgezet naar de CASE; gedrags-detail `IF v_doel IS NOT NULL` expliciet onderbouwd). Geen "TBD". Task 2 Step 0 vraagt bewust om een repo-feitelijke beslissing (Deno↔Vite test-locatie) i.p.v. te gokken — dat is geen placeholder maar een gerichte verificatie-stap met twee uitgewerkte opties.

**3. Type-/gedrag-consistentie:** `derive_wacht_status(order_status, bool, bool, bool) → order_status` (NULL=no-op) is identiek in de definitie (Task 1), de aanroep in `herbereken_wacht_status` (Task 1) en de TS-spiegel-signatuur (Task 2). De truthtable-combinaties zijn byte-voor-byte gelijk tussen de mig-345-`DO`-assertie en `derive-status.golden.json` (Task 2 Step 5 dwingt die controle af). De eindstatus-guardlijst (9 waarden) is verbatim overgenomen uit mig 275 r230-234.

---

## Kritische uitvoer-context (lees vóór je begint)

1. **Geen DB-toegang.** De agent kan migraties NIET draaien (Supabase-MCP heeft geen toegang tot het Karpi-project). Lever de SQL aan de gebruiker voor de SQL Editor en wacht op de `NOTICE`/resultaten. Dit geldt voor Task 1 Step 2-3.
2. **Migratienummer 345 verifiëren.** `ls supabase/migrations/ | tail` (of `git ls-tree -r --name-only origin/main -- supabase/migrations/ | grep -oE '[0-9]{3,}' | sort -n | tail`) bij branch-start. Hoogste bekend = 344. Bump bij collisie en pas álle `345`-referenties aan (bestandsnaam + header + NOTICE + Step-3-query + changelog).
3. **Eigen branch.** Begin op een verse branch vanaf `main`: `git checkout main && git pull --ff-only && git checkout -b refactor/order-status-single-source`. Overweeg een eigen git-worktree (parallelle sessies wisselen de gedeelde main-tree van branch — collisie-incidenten juni). Merge pas naar `main` op expliciet commando van de gebruiker.
4. **Gedrag MOET identiek blijven aan mig 275.** Dit is een refactor, geen gedragswijziging. De `DO`-assertie + de Step-3-`pg_get_functiondef`-check zijn je bewijs. Verander de ladder-uitkomsten NIET (ook niet "verbeteringen" — die horen in een aparte change met eigen review).
5. **Raak de toegepaste backfills (mig 258/275) NIET aan** en bewerk geen andere reeds-toegepaste migratie. Nieuwe logica = nieuwe migratie.
