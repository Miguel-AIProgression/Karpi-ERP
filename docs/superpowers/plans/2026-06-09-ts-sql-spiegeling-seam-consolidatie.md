# TS↔SQL-spiegeling zonder seam — consolidatie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vervang de "lockstep-via-comment"-duplicatie (dezelfde domeinregel N keer overgeschreven, bewaakt door een comment i.p.v. afgedwongen) door bezittende modules met een afdwingbaar contract — beginnend met de enige live geld-bug (betaaltermijn), uitgerold naar de echte seams in ROI-volgorde.

**Architecture:** Per domeinregel één bezittende artefact (SQL-functie of framework-agnostische TS-module) + een dun, taal-neutraal contract (zelf-testende migratie of golden-fixture-JSON die TS én SQL toetst). Dit is **geen nieuw mechanisme**: de repo heeft het huis-patroon al (`scripts/lint-no-direct-*.sh` + `_apply_transitie` + de Vitest `*.contract.test.ts`/`fixture-NN`-conventie). We passen het consequent toe en hangen er een dun contract onder dat "TS ≡ SQL" van *belofte* naar *afdwinging* tilt.

**Tech Stack:** Supabase/PostgreSQL (PL/pgSQL-migraties, handmatig toegepast via SQL Editor — MCP heeft geen toegang tot het Karpi-project), React/TypeScript + Vitest, Deno edge functions (`supabase/functions/_shared/`).

---

## Bevindingen & besluiten (geverifieerd onderzoek — 8 agents)

Vijf instanties van de stelling zijn onderzocht (5 onderzoeks-agents), tegen elkaar afgewogen (voorstander/scepticus/pragmaticus) en op load-bearing punten zelf nageverifieerd. De stelling **klopt over het patroon**, maar de cijfers en prioriteiten zijn op drie punten gecorrigeerd:

| # | Instantie | Reviewclaim | Geverifieerde realiteit | Emmer |
|---|---|---|---|---|
| 1 | **Betaaltermijn** (Factuur) | "11× ingeplakt, 3 live RPC's, regex fout" | Regex `^(\d+)` pakt de **code** (`"02 - 30 dagen…"` → 2) i.p.v. de termijn (30) → FACT-2026-0021 vervaldatum +2. **Correctie: mig 240 dropt `genereer_factuur` én `genereer_factuur_voor_week`; na mig 240 draagt alléén `genereer_factuur_voor_bundel` (mig 268) de bug nog.** Correcte parser bestaat al in `betaalcondities.dagen` (mig 202/203). ADR-0022 schreef helper `betaaltermijn_dagen()` vóór — nooit gebouwd (migratienr 287 ingenomen door FIFO-feature). **SQL↔SQL, geen TS-spiegel.** | **A — fix nu** |
| 2 | **Order-status** (Orders) | "3× gekopieerd (runtime + 2 backfills)" | Bevestigd; runtime 5× herschreven (mig 218→258→269→273→275). mig 275:15-19 geeft de regressie schriftelijk toe (verloren `Wacht op maatwerk`-tak + dode status `'Nieuw'`, orders 2063-2067 uit beeld). Lockstep via `pg_get_functiondef`+`REPLACE()`-string-substitutie (mig 275:160-194). ADR-0006 beloofde pure TS-functie — ontbreekt. Seam bestaat half al (`_apply_transitie` + `lint-no-direct-orders-status-update.sh`). | **B — bouw seam** |
| 3 | **Snijplan-status** (Productie) | "magic strings over 27 frontend-bestanden + `Gereed`/`Ingepakt`-drift" | **Correctie: ~18 echte bestanden (niet 27 — enum-waarden overlappen met andere enums).** Centraal type `SnijplanStatus` bestaat al maar is **gedrift** (mist `Wacht`+`In productie`; `Gereed` dubbel in snijplan- én confectie-betekenis); 2 divergerende `SNIJPLAN_STATUS_COLORS`-maps. VERR130-overlap-voedingsbodem (mig 301) — operationeel al door de mig 301-guard afgedekt. Geen DB-migratie nodig. | **B — bouw seam** |
| 4 | **Packing-geometrie** (Productie) | "3× gekopieerd, 4-plek-lockstep" | 4 plekken, **allen TS** (geen SQL — bewust V2-uitstel). Benchmark-port (`vergelijk-snijalgoritmes.mjs`, géén productiepad) al gedivergeerd (mist ADR-0025 `√(short/long)`-bias). 2 onderhouden reststuk-kopieën nog synchroon (parity-tests bestaan). Bundeling haalbaar. **Botst met in-flight branch `feat/organische-vormen-maatwerk` (347 regels packer-churn).** | **B — bouw seam (gated)** |
| 5A | **Bundel-sleutel** TS+SQL | mirror zonder afdwinging | Bevestigd, functioneel synchroon, geen bewezen bug, geen test. Goedkope golden-fixture-demo. | **B — laag-prio** |
| 5B | **Verzendkosten** "4 niveaus" | "bewezen divergentie, meest urgent" | **Correctie/framing-fout: de divergerende `genereer_factuur_voor_week` (mig 232) is gedropt door mig 240. De resolver `verzendkosten_voor_bundel` (mig 234) is al de enige live bron.** De "divergentie" zit in dode code. | **C — buiten scope** |
| 5C | **Werkagenda** "triple mirror" | 3 kopieën | **Correctie: SQL-ground-truth (mig 279) heeft NUL callers = dode code.** Feitelijk 2 levende TS-runtimes (UI + Deno) met al-uiteengelopen interfaces. **Uitgevoerd 2026-06-12** — zie plan 2026-06-12-werkagenda-een-bron.md (kernel-consolidatie + mig 383). | **C — dode SQL schrappen** |
| 5D | **vrije_voorraad** "3×" | 3 kopieën | **Correctie: formule 2× in SQL (mig 149→154, 154 is live), TS consumeert alleen.** Cosmetisch. | **C — meeliften** |

### Sleutelbesluiten die de fasering sturen
1. **Bug-fix vóór seam-bouw.** Betaaltermijn is een live geld-bug met een al-bestaande bron-van-waarheid (`betaalcondities.dagen`) en een al-uitgeschreven helper-ontwerp (ADR-0022 + plan 2026-05-15). Fix 'm nu, zónder cross-runtime-infra. Dit is de "goedkoopste eerste zet".
2. **Geen nieuw test-framework.** Pure-SQL-helpers → **zelf-testende migratie** (`DO $$ … RAISE EXCEPTION $$`, draait al in de deploy). TS↔SQL- of TS↔TS-spiegels → **golden-fixture-JSON** binnen de bestaande Vitest-conventie. Geen pgTAP, geen aparte Deno-CI.
3. **Eén seam = één branch.** Er draaien meerdere Claude-sessies in dezelfde working tree (collisie-incident 7 juni) en er zijn ≥8 actieve worktrees. Strikt gefaseerd, packer-fase hard gated achter `organische-vormen`.
4. **Migratienummer-discipline.** Hoogste bestaande migratie = **332**. Dit plan claimt 333/334 — maar verifieer bij branch-start opnieuw (`ls supabase/migrations/ | tail`) en bump bij collisie. Dit is exact hoe de helper de eerste keer verdween (nr 287 werd ingepikt).
5. **Buiten scope:** verzendkosten-"divergentie" (dode code), een generieke cross-runtime-harness (over-engineering), vrije_voorraad als eigen fase (cosmetisch).

### Fasering (ROI-volgorde)
| Fase | Instantie | Emmer | Omvang | Branch | Gate |
|---|---|---|---|---|---|
| **0** | Betaaltermijn-helper | A | Klein | `fix/betaaltermijn-dagen-helper` | — (start hier) |
| 1 | Snijplan-status enum-seam | B | Middel | `refactor/snijplan-status-enum` | coördineer met `organische-vormen` |
| 2 | Order-status backfill→single-source | B | Middel | `refactor/order-status-single-source` | na Fase 0 (factuur-migraties niet tegelijk) |
| 3 | Packing-geometrie bundeling | B | Groot | `refactor/packing-geometry-seam` | **hard na merge `organische-vormen`** |
| — | Werkagenda dode-SQL drop | C | Triviaal | meeliften / los | — |
| — | Bundel-sleutel golden-fixture | B (laag) | Klein | optioneel (convention-demo) | — |

**Dit plan specificeert Fase 0 volledig (shippable, lost de live geld-bug op). Fase 1–3 staan als gescopete vervolgfasen onderaan — elk verdient een eigen detailplan vóór uitvoering (afzonderlijke subsystemen).**

---

## Fase 0 — Betaaltermijn-helper (de shippable slice)

**Waarom dit eerst:** het is de enige instantie met een geverifieerde **live geld-bug** (verkeerde vervaldatum op echte facturen via het actieve bundel-pad), de bron-van-waarheid bestaat al (`betaalcondities.dagen`), de helper-body is al ontworpen, en het raakt na mig 240 nog maar **één** live functie → conflictvrij met al het in-flight UI/packer-werk.

**Branch-setup (vóór Task 1):**

- [ ] **Maak de branch aan**

```bash
git checkout main
git pull --ff-only
git checkout -b fix/betaaltermijn-dagen-helper
```

- [ ] **Verifieer dat 333/334 nog vrije migratienummers zijn**

```bash
ls supabase/migrations/ | grep -E '^33[0-9]_' | sort
```
Expected: hoogste is `332_*`. Als 333 of 334 al bestaat (een andere branch heeft ze gepakt) → gebruik de eerstvolgende twee vrije nummers en pas de bestandsnamen in dit plan consequent aan.

---

### Task 1: `betaaltermijn_dagen()`-helper als bron-van-waarheid

De helper centraliseert de betaaltermijn-lookup met fallback. De ingebouwde `DO`-assertie is de "test" (TDD voor SQL-helpers, conform repo-conventie): draai eerst alléén het assertie-blok → faalt want de functie bestaat niet; pas dan de hele migratie toe → asserties slagen.

**Files:**
- Create: `supabase/migrations/333_betaaltermijn_helper.sql`

- [ ] **Step 1: Schrijf de migratie met de helper + ingebouwde asserties**

Maak `supabase/migrations/333_betaaltermijn_helper.sql`:

```sql
-- Migratie 333: betaaltermijn_dagen — single source of truth (ADR-0022)
--
-- Probleem: de factuur-RPC parst de betaaltermijn met
-- `regexp_match(betaalconditie, '^(\d+)')`. debiteuren.betaalconditie heeft
-- formaat "{code} - {naam}" (mig 202), dus dat pakt de CODE, niet de termijn
-- (FACT-2026-0021: "02 - 30 dagen netto" → vervaldatum +2 i.p.v. +30).
-- Sinds mig 202/203 bestaat betaalcondities.dagen (correct geparsed). Deze
-- functie centraliseert de lookup met fallback 30. Na mig 240 (drop van
-- genereer_factuur + genereer_factuur_voor_week) draagt alleen nog
-- genereer_factuur_voor_bundel de foute regex — die zet Task 2 om.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION betaaltermijn_dagen(p_betaalconditie TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE(
    -- Standaard-formaat "{code} - {naam}": match op betaalcondities.code
    (SELECT bc.dagen
       FROM betaalcondities bc
      WHERE p_betaalconditie ~ '^\s*[^-]+\s*-'
        AND trim(split_part(p_betaalconditie, '-', 1)) = bc.code
        AND bc.dagen IS NOT NULL
      LIMIT 1),
    -- Vangnet: vrije tekst met "<n> dagen/tage/days" erin
    NULLIF((regexp_match(p_betaalconditie, '\b(\d+)\s*(?:dagen|tage|days|tag|day)\b', 'i'))[1], '')::INTEGER,
    -- Default conform mig 202-comment
    30
  );
$$;

COMMENT ON FUNCTION betaaltermijn_dagen(TEXT) IS
  'Mig 333 (ADR-0022): betaaltermijn in dagen uit debiteuren.betaalconditie. '
  'Primair: code-prefix -> betaalcondities.dagen. Vangnet: "<n> dagen" in vrije '
  'tekst. Default 30. Vervangt de foute regexp_match(..., ''^(\d+)'')-parse in '
  'genereer_factuur_voor_bundel.';

GRANT EXECUTE ON FUNCTION betaaltermijn_dagen(TEXT) TO authenticated, service_role;

-- Assertie ("test"): vóór CREATE faalt dit blok; erna moet het slagen.
DO $$
BEGIN
  -- Code-prefix wint van het leidende getal (de bug-case TRENDHOPPER "02").
  IF betaaltermijn_dagen('02 - 30 dagen netto, 8 dagen 2%') <> 30 THEN
    RAISE EXCEPTION 'FAAL: "02 - 30 dagen..." moet 30 geven, gaf %',
      betaaltermijn_dagen('02 - 30 dagen netto, 8 dagen 2%');
  END IF;
  -- Code == termijn (MEUBILEX "30"): blijft 30.
  IF betaaltermijn_dagen('30 - 30 dagen netto') <> 30 THEN
    RAISE EXCEPTION 'FAAL: "30 - 30 dagen netto" moet 30 geven';
  END IF;
  -- NULL / lege / onbekende -> default 30.
  IF betaaltermijn_dagen(NULL) <> 30 OR betaaltermijn_dagen('') <> 30 THEN
    RAISE EXCEPTION 'FAAL: NULL/leeg moet 30 geven';
  END IF;
  -- Vrije tekst zonder code-formaat.
  IF betaaltermijn_dagen('Betaling binnen 14 dagen') <> 14 THEN
    RAISE EXCEPTION 'FAAL: vrije tekst "14 dagen" moet 14 geven';
  END IF;
  RAISE NOTICE 'Mig 333: alle betaaltermijn_dagen-asserties geslaagd';
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verifieer dat de assertie faalt zonder de functie (RED)**

In de Supabase SQL Editor: kopieer **alléén** het `DO $$ … END $$;`-assertieblok en draai het.
Expected: `ERROR: function betaaltermijn_dagen(unknown) does not exist`.

- [ ] **Step 3: Pas de volledige migratie toe (GREEN)**

Draai het hele bestand `333_betaaltermijn_helper.sql` in de SQL Editor.
Expected: `NOTICE: Mig 333: alle betaaltermijn_dagen-asserties geslaagd`, geen error.

- [ ] **Step 4: Edge-case-check tegen echte data**

Run in de SQL Editor:
```sql
SELECT DISTINCT d.betaalconditie, betaaltermijn_dagen(d.betaalconditie) AS dagen
  FROM debiteuren d
 WHERE d.betaalconditie IS NOT NULL
 ORDER BY 2, 1;
```
Expected: geen rij met `dagen` gelijk aan een duidelijke code (bv. 2, 3, 31) tenzij dat toevallig de echte termijn is. Onverwachte waarden = een `betaalcondities`-rij met `dagen IS NULL` → vul aan via de instellingen-UI (`/instellingen/betaalcondities`) of een losse `UPDATE betaalcondities SET dagen=…`, en herhaal deze check. Noteer eventuele orphans in de commit-message.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/333_betaaltermijn_helper.sql
git commit -m "feat(factuur): centrale betaaltermijn_dagen-helper (ADR-0022, mig 333)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `genereer_factuur_voor_bundel` omzetten naar de helper

Dit is de enige live RPC die de foute regex nog draagt (mig 268 = laatste definitie; `genereer_factuur` en `genereer_factuur_voor_week` zijn door mig 240 gedropt). Een PL/pgSQL-functie kun je niet regel-voor-regel patchen — je herdefinieert de hele functie met `CREATE OR REPLACE`. We nemen de **volledige huidige body verbatim uit mig 268** over en wijzigen exact één blok.

**Files:**
- Create: `supabase/migrations/334_genereer_factuur_voor_bundel_betaaltermijn_helper.sql`
- Referentie (verbatim overnemen): `supabase/migrations/268_factuur_korting_per_order_gespreid.sql`

- [ ] **Step 1: Schrijf de verificatie-query eerst (RED)**

Bewaar deze check; draai 'm ná Task 1 maar vóór Task 2's migratie. Hij bewijst dat de live functie de foute regex nog bevat:
```sql
SELECT
  pg_get_functiondef('genereer_factuur_voor_bundel(bigint)'::regprocedure) LIKE '%regexp_match(v_debiteur.betaalconditie%' AS heeft_nog_foute_regex,
  pg_get_functiondef('genereer_factuur_voor_bundel(bigint)'::regprocedure) LIKE '%betaaltermijn_dagen(%' AS gebruikt_helper;
```
Expected vóór Task 2: `heeft_nog_foute_regex = true`, `gebruikt_helper = false`.

- [ ] **Step 2: Bouw migratie 334 — kopieer mig 268 verbatim, wijzig één blok**

Maak `supabase/migrations/334_genereer_factuur_voor_bundel_betaaltermijn_helper.sql`. Begin met deze header, gevolgd door de **volledige** `CREATE OR REPLACE FUNCTION genereer_factuur_voor_bundel(...)`-definitie zoals die nu in `supabase/migrations/268_factuur_korting_per_order_gespreid.sql` staat (kopieer het hele `CREATE OR REPLACE FUNCTION … $$ LANGUAGE plpgsql;`-blok ongewijzigd over), met daarin exact deze ene wijziging:

**Verwijder** (mig 268:72-74):
```sql
  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;
```
**Vervang door** (één regel):
```sql
  v_betaaltermijn_dagen := betaaltermijn_dagen(v_debiteur.betaalconditie);
```

De `v_betaaltermijn_dagen INTEGER := 30;`-declaratie bovenaan de functie blijft staan (de helper levert nooit NULL, dus de default is verder onschadelijk). Laat al het andere in de functie-body byte-voor-byte ongemoeid.

Header bovenaan migratie 334:
```sql
-- Migratie 334: genereer_factuur_voor_bundel consumeert betaaltermijn_dagen
--
-- Vervangt het foute `regexp_match(betaalconditie, '^(\d+)')`-blok (dat de
-- code i.p.v. de termijn pakte) door een aanroep van de mig-333-helper.
-- Body verder identiek aan mig 268. Dit is de enige live factuur-RPC die de
-- bug nog droeg (genereer_factuur + genereer_factuur_voor_week zijn door
-- mig 240 gedropt).
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
```
En sluit het bestand af met:
```sql
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Pas migratie 334 toe**

Draai `334_genereer_factuur_voor_bundel_betaaltermijn_helper.sql` in de SQL Editor.
Expected: `Success. No rows returned` (geen error).

- [ ] **Step 4: Verifieer dat de regex weg is en de helper gebruikt wordt (GREEN)**

Draai de query uit Step 1 opnieuw.
Expected: `heeft_nog_foute_regex = false`, `gebruikt_helper = true`.

- [ ] **Step 5: End-to-end-bewijs op de bug-case**

Controleer dat een debiteur met code-formaat-betaalconditie nu de juiste termijn oplevert via de live functie-helper. Run:
```sql
-- Pak een echte debiteur met "code - naam"-formaat (bv. de FACT-0021-klasse).
SELECT d.debiteur_nr, d.betaalconditie,
       betaaltermijn_dagen(d.betaalconditie) AS dagen,
       CURRENT_DATE AS factuurdatum,
       CURRENT_DATE + betaaltermijn_dagen(d.betaalconditie) AS vervaldatum
  FROM debiteuren d
 WHERE d.betaalconditie ~ '^\s*\d+\s*-\s*30\s'   -- "xx - 30 dagen ..."
 LIMIT 5;
```
Expected: `dagen = 30` en `vervaldatum = factuurdatum + 30` voor elke rij — niet +2/+3.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/334_genereer_factuur_voor_bundel_betaaltermijn_helper.sql
git commit -m "fix(factuur): genereer_factuur_voor_bundel gebruikt betaaltermijn_dagen i.p.v. foute regex (mig 334)

Lost FACT-2026-0021-klasse op: vervaldatum was +2 i.p.v. +30 omdat
de regex de betaalconditie-code pakte i.p.v. de dagen.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Documentatie bijwerken (levende docs — verplicht)

CLAUDE.md eist dat de levende docs na elke significante wijziging bijgewerkt worden.

**Files:**
- Modify: `docs/changelog.md` (nieuwe entry bovenaan)
- Modify: `docs/adr/0022-betaaltermijn-en-per-zending-factuur-volgt-bundel-rpc.md` (status → Geaccepteerd/Uitgevoerd)

- [ ] **Step 1: Voeg een changelog-entry toe**

Voeg bovenaan de chronologische lijst in `docs/changelog.md` toe (pas de datum-/sectiestijl aan de bestaande entries aan):

```markdown
### 2026-06-09 — Betaaltermijn als bron-van-waarheid (ADR-0022, mig 333-334)

Foute `regexp_match(betaalconditie, '^(\d+)')` in `genereer_factuur_voor_bundel`
pakte de betaalconditie-**code** (bv. "02") i.p.v. het aantal **dagen** (30) →
vervaldatum +2 i.p.v. +30 (FACT-2026-0021-klasse). Opgelost met centrale SQL-
helper `betaaltermijn_dagen(TEXT)` (mig 333) die de code-prefix opzoekt in
`betaalcondities.dagen` (mig 202/203) met vangnet "<n> dagen" en default 30;
`genereer_factuur_voor_bundel` consumeert die nu (mig 334). De andere historische
kopieën (`genereer_factuur`, `genereer_factuur_voor_week`) waren al door mig 240
gedropt — dit was de laatste live drager. Self-testing migratie borgt de bug-case.
```

- [ ] **Step 2: Werk de ADR-status bij**

Open `docs/adr/0022-betaaltermijn-en-per-zending-factuur-volgt-bundel-rpc.md` en zet de status-regel (bovenaan, nu "Voorgesteld") op:
```markdown
**Status:** Geaccepteerd — uitgevoerd 2026-06-09 (mig 333-334). Punt 1 (betaaltermijn-helper) gerealiseerd; verzendkosten-punten zijn door mig 240 achterhaald (genereer_factuur_voor_week gedropt).
```

- [ ] **Step 3: Commit**

```bash
git add docs/changelog.md docs/adr/0022-betaaltermijn-en-per-zending-factuur-volgt-bundel-rpc.md
git commit -m "docs(factuur): changelog + ADR-0022 status na betaaltermijn-helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Meld klaar voor merge**

Fase 0 is een zelfstandig shippable geheel. Meld aan de gebruiker dat `fix/betaaltermijn-dagen-helper` klaar is en wacht op expliciete "merge naar main" (CLAUDE.md git-workflow — niet automatisch mergen). Vermeld eventuele `betaalcondities`-orphans uit Task 1 Step 4 die handmatig `dagen` nodig hebben.

---

## Vervolgfasen (gescopet — elk verdient een eigen detailplan)

Onderstaande fasen zijn **afzonderlijke subsystemen**. Conform de writing-plans Scope Check: maak per fase een eigen detailplan (`docs/superpowers/plans/YYYY-MM-DD-<naam>.md`) met bite-sized TDD-taken vóór uitvoering. Hieronder staat per fase genoeg om dat detailplan te starten: doel, scope, bestanden, aanpak, contract-vorm en gates.

### Fase 1 — Snijplan-status enum-seam (Productie) · branch `refactor/snijplan-status-enum`

**Doel:** één centrale, niet-gedrifte snijplan-status-enum (TS) gespiegeld aan de DB-enum, met afgedwongen volledigheid en een ESLint-vangnet tegen losse magic strings.

**Kernbestanden:**
- `frontend/src/lib/types/productie.ts` (r5-18: `SnijplanStatus` mist `Wacht`+`In productie`; `Gereed` dubbel snijplan/confectie)
- `frontend/src/lib/utils/constants.ts` (`SNIJPLAN_STATUS_COLORS` map A) + `frontend/src/components/rollen/rollen-groep-row.tsx` (r220-228, divergerende map B — verwijderen)
- `supabase/functions/_shared/db-helpers.ts` (r162-189: hardcoded `['Snijden','Gesneden']`-set → importeer een gedeelde `ROL_FYSIEK_BEZET`)
- De ~18 consumenten (lijst in onderzoeksrapport): `lib/utils/order-lock.ts`, `components/snijplanning/*`, `components/confectie/*`, `pages/confectie/*`, `pages/snijplanning/*`, `modules/snijplanning/queries/*`, `pages/scanstation/*`

**Aanpak (contract-test eerst ROOD):**
1. Schrijf eerst een Vitest-contract-test die `SNIJPLAN_STATUSSEN` toetst tegen `enum_range('snijplan_status')` (genereer Supabase-types of query de enum). Faalt nu → lokaliseert de drift, inclusief de `Gereed`-dubbelzinnigheid, vóór je iets aanraakt.
2. Splits `SnijplanStatus` (snijden-pijplijn) van `ConfectieStatus` (confectie-pijplijn) — nu verkeerd samengevoegd. **Per `Gereed`/`Ingepakt`-call-site een semantische keuze** (snijden-`Gereed` vs confectie-eindstatus) — géén blinde find-replace.
3. Eén `Record<SnijplanStatus, BadgeKleur>`-kleurmap (compiler dwingt volledigheid af); verwijder map B.
4. Semantische groepen als gedeelde constanten: `TE_SNIJDEN`, `ROL_FYSIEK_BEZET` (= de db-helpers-set), `PICKBAAR`. Spiegel naar `_shared/` zodat packer + frontend één definitie delen.
5. ESLint `no-restricted-syntax`-regel naar model van `scripts/lint-no-hardcoded-admin-pseudo-strings.sh`.

**Gate:** raakt productie-bestanden die ook in `feat/organische-vormen-maatwerk` bewegen — check bestand-overlap (`git log feat/organische-vormen-maatwerk --stat`); bij overlap ná diens merge. Geen DB-migratie nodig.

**Omvang:** Middel (~18 bestanden, mechanisch behalve de `Gereed`/`Ingepakt`-keuzes).

### Fase 2 — Order-status backfill → single-source (Orders) · branch `refactor/order-status-single-source`

**Doel:** de 3 SQL-kopieën van de status-ladder terugbrengen naar 1; de in mig 275 toegegeven regressie structureel onmogelijk maken.

**Kernbestanden:**
- `supabase/migrations/275_nieuw_status_deprecate_klaar_voor_picken.sql` (runtime `herbereken_wacht_status` + backfill B; de `pg_get_functiondef`+`REPLACE()`-substitutie is het te verwijderen symptoom)
- `supabase/migrations/258_order_status_transities_backfill.sql` (backfill C)
- Bestaande seam-helft: `_apply_transitie` + `scripts/lint-no-direct-orders-status-update.sh`

**Aanpak:**
1. Quick-win: vervang de 2 backfill-`DO`-blokken door een `PERFORM herbereken_wacht_status(id)`-loop over de doelorders → 3 kopieën meteen naar 1 runtime-ladder.
2. Zelf-testende migratie: seed een fixture-order met maatwerk + IO-claim, draai `herbereken_wacht_status`, assert de eindstatus (incl. de historisch-verloren `Wacht op maatwerk`-tak en een expliciete "nooit `'Nieuw'`"-assertie). Neem de legacy enum-waarden + de `'Snijden'`-valkuil mee in de fixture.
3. Optioneel (groter): materialiseer de ADR-0006-belofte als pure TS-functie `_shared/order-lifecycle/derive-status.ts` + golden-fixture — alleen als de waarde de nieuwe infra rechtvaardigt; anders volstaan SQL-regressietests.

**Gate:** na Fase 0 (geen twee factuur-/order-migraties tegelijk open i.v.m. migratienummer-races). Repo heeft nog geen SQL-test-harness → houd het bij de zelf-testende migratie.

**Omvang:** Middel.

### Fase 3 — Packing-geometrie bundeling (Productie) · branch `refactor/packing-geometry-seam`

**Doel:** 4× TS-geometrie → één framework-agnostische `geometry/free-rect.ts`, met golden-fixture die elke coördinaat-/afrondings-divergentie rood maakt (de VERR130-risicoklasse).

**Kernbestanden:**
- `supabase/functions/_shared/guillotine-packing.ts` (bron + contract-comment r53-66)
- `supabase/functions/_shared/compute-reststukken.ts` + `frontend/src/modules/snijplanning/lib/compute-reststukken.ts` (kopieën)
- `scripts/vergelijk-snijalgoritmes.mjs` (benchmark-port — al gedivergeerd, mist `√(short/long)`)
- Bestaande tests: `guillotine-packing.test.ts`, `guillotine-fifo.test.ts`, `compute-reststukken.test.ts`

**Aanpak (sub-volgorde):** extraheer pure kern (`intersects`/`contains`/`subtractRect`/`removeDominated`/`computeFreeRects`/`guillotineSplit`/`reststukScore` + constanten) → Vite-alias + Deno-re-export-shim (patroon bestaat al in repo) → golden-fixture JSON (`{rol, bezette, pieces} → verwachte placements`) → bedraad benchmark om (dicht de `√`-divergentie) → reststuk-kopieën → packer-adapter als laatste, achter de fixture als vangnet.

**Gate:** **HARD na merge van `feat/organische-vormen-maatwerk`** (347 regels packer-churn — extractie nu = gegarandeerd merge-conflict op het hart van het algoritme). Worktree: `C:\Users\migue\Documents\.worktrees\organische-vormen`.

**Omvang:** Groot.

### Losse opruimingen (emmer C — meeliften, geen eigen fase)
- **Werkagenda dode SQL (mig 279):** `DROP FUNCTION werkdag_min_n / werkdag_offset_n / werkdag_plus_n / werkagenda_kalender` — eerst caller-count bevestigen (`grep` buiten mig 279 = 0). Verlaagt "triple mirror" gratis naar 2 levende TS-runtimes. Triviale losse migratie. **Uitgevoerd 2026-06-12 (mig 383, plan 2026-06-12-werkagenda-een-bron).**
- **Bundel-sleutel golden-fixture (5A):** optionele convention-demo — `frontend/src/lib/orders/__tests__/golden/bundel-sleutel.golden.json` getoetst door zowel `bundel-sleutel.ts` (Vitest) als `bundel_sleutel()` (DO-assert-migratie). Goedkoop, geen bug, doe wanneer de golden-fixture-conventie tóch gevestigd wordt.
- **vrije_voorraad (5D):** alleen meeliften als een reserverings-/voorraad-migratie het bestand tóch opent (helper `bereken_vrije_voorraad(voorraad, gereserveerd, backorder)`); geen eigen werk.

### Expliciet buiten scope
- **Verzendkosten-"divergentie" (5B):** `genereer_factuur_voor_week` (mig 232) is door mig 240 gedropt; de resolver `verzendkosten_voor_bundel` (mig 234) is al de enige live bron. Geen levende geld-divergentie — niet behandelen als urgente instantie.
- **Generieke cross-runtime test-harness (pgTAP / aparte Deno-CI):** over-engineering in een Windows-Vitest-repo met meerdere worktrees. De zelf-testende migratie + golden-fixture-conventie dekken alle behoeften.

---

## Self-Review

**1. Spec-dekking:** Alle 5 onderzochte instanties hebben een plaats: betaaltermijn (Fase 0, volledig), snijplan-status (Fase 1), order-status (Fase 2), packing (Fase 3), logistiek-mirrors (5B buiten scope met reden, 5C/5D/5A als opruiming). De drie geverifieerde correcties (mig 240 dropt 2 RPC's; 27→18 bestanden; werkagenda-SQL dood) zijn elk in de bevindingen-tabel én in de betreffende fase verwerkt.

**2. Placeholder-scan:** Fase 0 bevat volledige, geverifieerde SQL (helper-body uit het bestaande ontwerp; call-site-wijziging als exact before/after-blok met expliciete provenance = mig 268 verbatim). Geen "TBD"/"handle edge cases". De vervolgfasen zijn bewust scope-niveau (geen bite-sized stappen) en expliciet gemarkeerd als "eigen detailplan vereist" — dat is Scope-Check-conform, geen placeholder.

**3. Type-consistentie:** Functiesignatuur `betaaltermijn_dagen(TEXT) RETURNS INTEGER` is identiek in Task 1 (definitie), Task 2 (aanroep `betaaltermijn_dagen(v_debiteur.betaalconditie)`) en de docs. De verificatie-query in Task 2 (`genereer_factuur_voor_bundel(bigint)`) matcht de bestaande functiesignatuur. Migratienummers 333/334 zijn consistent door alle taken + branch-setup heen, met een collisie-guard vooraan.

---

## Execution Handoff

Zie onderaan dit gesprek voor de keuze tussen subagent-driven en inline executie.
