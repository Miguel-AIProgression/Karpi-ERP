# Factuur: betaaltermijn + bundel-verzendkosten — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elke factuur (legacy of bundel) krijgt de correcte betaaltermijn uit `betaalcondities`, exact één drempel-getoetste `VERZEND`-regel per bundel, en bestaande foute concept-facturen worden geremedieerd.

**Architecture:** Eén pure SQL-helper `betaaltermijn_dagen()` als single source of truth, geconsumeerd door alle vier factuur-RPC's. Het legacy `genereer_factuur`-pad krijgt hetzelfde VERZEND-/drempelgedrag als `genereer_factuur_voor_bundel` (mig 234) zodat correctheid pad-onafhankelijk is. Een diagnose-fase stelt eerst de werkelijke productie-migratie-staat vast (geen MCP-toegang — handmatige SQL).

**Tech Stack:** Supabase PostgreSQL (plpgsql RPC's, idempotente `CREATE OR REPLACE`-migraties), Deno edge function `factuur-verzenden`, docs in `docs/`. Verificatie via `DO $$ … RAISE EXCEPTION`-asserties (repo-conventie; geen pgTAP).

**Referentie-ADR:** [docs/adr/0022-betaaltermijn-en-per-zending-factuur-volgt-bundel-rpc.md](../../adr/0022-betaaltermijn-en-per-zending-factuur-volgt-bundel-rpc.md)

**Migratie-nummering:** volgende vrije nummer = **287** (laatste is 286). ADR = 0022.

---

## File Structure

| Pad | Verantwoordelijkheid | Actie |
|---|---|---|
| `supabase/migrations/287_betaaltermijn_helper.sql` | Pure helper `betaaltermijn_dagen(TEXT)` + SQL-asserties | Create |
| `supabase/migrations/288_factuur_rpcs_betaaltermijn_helper.sql` | 4 RPC's omzetten naar helper | Create |
| `supabase/migrations/289_genereer_factuur_bundel_vangnet.sql` | Legacy `genereer_factuur`: strip VERZEND + resolver | Create |
| `supabase/migrations/290_factuur_queue_zending_backfill.sql` | `factuur_queue.zending_id` backfill (conditioneel op fase 0) | Create |
| `supabase/migrations/291_remediatie_foute_concept_facturen.sql` | Herzie bestaande foute concept-facturen (achter bevestiging) | Create |
| `docs/changelog.md` | Chronologisch logboek | Modify |
| `docs/database-schema.md` | Nieuwe functie + gewijzigde RPC's | Modify |
| `docs/data-woordenboek.md` | Begrip "betaaltermijn" vs "betaalconditie-code" | Modify |
| `docs/adr/0022-*.md` | Status → Geaccepteerd | Modify |
| `CLAUDE.md` | Bedrijfsregel factuur-betaaltermijn + per_zending-bundel | Modify |

DRY: alle termijn-logica in één functie. YAGNI: geen drop van legacy-RPC's (cutover blijft uitgesteld). Frequent commits: één commit per taak.

---

## Task 0: Fase 0 — Diagnose productie-migratie-staat

**Files:** geen code; resultaten vastleggen in het commit-bericht van Task 1 en in `docs/changelog.md`.

**Waarom eerst:** de codebase bevat de fix voor issues 2+3 al (mig 234/252). De waargenomen factuur draait legacy. We moeten weten welke migraties productie écht heeft vóór we Task 5/6 vormgeven.

- [ ] **Step 1: Lever de diagnose-query aan de gebruiker**

De gebruiker draait dit in de Supabase SQL Editor (productie) en plakt de output terug:

```sql
-- A. Bestaat de bundel-RPC en de zending_id-kolom?
SELECT
  to_regprocedure('genereer_factuur_voor_bundel(bigint)') IS NOT NULL AS heeft_bundel_rpc,
  to_regprocedure('verzendkosten_voor_bundel(integer,numeric,boolean)') IS NOT NULL AS heeft_resolver,
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_name='factuur_queue' AND column_name='zending_id') AS heeft_zending_id_kol;

-- B. Welke enqueue-trigger-body draait er nu?
SELECT prosrc LIKE '%zending_orders%' AS enqueue_is_bundel_aware
  FROM pg_proc WHERE proname='enqueue_factuur_voor_event';

-- C. Hoeveel recente queue-rijen hebben zending_id NULL?
SELECT type, (zending_id IS NULL) AS zending_id_null, COUNT(*)
  FROM factuur_queue
 WHERE created_at > now() - interval '14 days'
 GROUP BY 1,2 ORDER BY 1,2;

-- D. Foute concept-facturen: vervaldatum < factuurdatum + 5 dagen
SELECT factuur_nr, debiteur_nr, factuurdatum, vervaldatum,
       (vervaldatum - factuurdatum) AS termijn_dagen
  FROM facturen
 WHERE status='Concept' AND (vervaldatum - factuurdatum) < 5
 ORDER BY factuur_nr;

-- E. betaalcondities-dekking: codes zonder dagen
SELECT code, naam, dagen FROM betaalcondities WHERE dagen IS NULL ORDER BY code;
```

- [ ] **Step 2: Classificeer de staat**

Noteer expliciet één van twee scenario's:
- **Scenario A (legacy actief):** `heeft_zending_id_kol=false` OF `enqueue_is_bundel_aware=false` OF veel `zending_id_null=true`. → Task 5 backfillt + (her)apply 234/252 is nodig.
- **Scenario B (bundel actief, alleen betaaltermijn-bug):** alles `true`, weinig NULL. → Task 5 vervalt grotendeels (alleen betaaltermijn + remediatie).

- [ ] **Step 3: Leg resultaat vast**

Schrijf de query-output + scenario-classificatie als notitie onderaan `docs/changelog.md` onder een datumkop `## 2026-05-15 — Diagnose factuur-migratie-staat`. Commit nog niet (gebeurt in Task 1).

---

## Task 1: Centrale helper `betaaltermijn_dagen(TEXT)`

**Files:**
- Create: `supabase/migrations/287_betaaltermijn_helper.sql`

- [ ] **Step 1: Schrijf de migratie met ingebouwde falende assertie eerst**

Maak `supabase/migrations/287_betaaltermijn_helper.sql`. De `DO`-assertie onderaan is onze "test": draai 'm mentaal/in SQL Editor vóór de functie bestaat → faalt met "function betaaltermijn_dagen does not exist".

```sql
-- Migratie 287: betaaltermijn_dagen — single source of truth (ADR-0022)
--
-- Probleem: alle factuur-RPC's (mig 119/227/232/234) parsen de betaaltermijn
-- met `regexp_match(betaalconditie, '^(\d+)')`. debiteuren.betaalconditie heeft
-- formaat "{code} - {naam}" (mig 202), dus dat pakt de CODE, niet de termijn.
-- Sinds mig 202/203 bestaat betaalcondities.dagen (correct geparsed). Deze
-- functie centraliseert de lookup met fallback 30.
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
  'Mig 287 (ADR-0022): betaaltermijn in dagen uit debiteuren.betaalconditie. '
  'Primair: code-prefix → betaalcondities.dagen. Vangnet: "<n> dagen" in vrije '
  'tekst. Default 30. Vervangt de foute regexp_match(..., ''^(\d+)'')-parse in '
  'alle factuur-RPC''s.';

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
  -- NULL / lege / onbekende → default 30.
  IF betaaltermijn_dagen(NULL) <> 30 OR betaaltermijn_dagen('') <> 30 THEN
    RAISE EXCEPTION 'FAAL: NULL/leeg moet 30 geven';
  END IF;
  -- Vrije tekst zonder code-formaat.
  IF betaaltermijn_dagen('Betaling binnen 14 dagen') <> 14 THEN
    RAISE EXCEPTION 'FAAL: vrije tekst "14 dagen" moet 14 geven';
  END IF;
  RAISE NOTICE 'Mig 287: alle betaaltermijn_dagen-asserties geslaagd';
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verifieer dat de assertie faalt zonder de functie**

In Supabase SQL Editor: kopieer alléén het `DO $$ … END $$;`-blok en draai het.
Expected: `ERROR: function betaaltermijn_dagen(unknown) does not exist`.

- [ ] **Step 3: Pas de volledige migratie toe**

Draai het hele bestand `287_betaaltermijn_helper.sql` in de SQL Editor.
Expected: `NOTICE: Mig 287: alle betaaltermijn_dagen-asserties geslaagd`, geen error.

- [ ] **Step 4: Edge-case-check tegen echte data**

Run:
```sql
SELECT DISTINCT d.betaalconditie, betaaltermijn_dagen(d.betaalconditie) AS dagen
  FROM debiteuren d
 WHERE d.betaalconditie IS NOT NULL
 ORDER BY 2, 1;
```
Expected: geen enkele rij met `dagen` gelijk aan een duidelijke code (bv. 2, 3, 31, 50) tenzij die toevallig de echte termijn is. Onverwachte waarden = aanvullen in `betaalcondities` (Task 1 raakt dat niet; los het op via de instellingen-UI of een aparte UPDATE en herhaal).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/287_betaaltermijn_helper.sql docs/changelog.md
git commit -m "feat(factuur): centrale betaaltermijn_dagen-helper + fase-0 diagnose (ADR-0022)"
```

---

## Task 2: Vier factuur-RPC's omzetten naar de helper

**Files:**
- Create: `supabase/migrations/288_factuur_rpcs_betaaltermijn_helper.sql`

Achtergrond: `genereer_factuur` (huidige body = mig 227), `genereer_factuur_voor_week` (mig 232), `genereer_factuur_voor_bundel` (mig 234). De helper vervangt in elk exact dit blok:

```sql
IF v_debiteur.betaalconditie ~ '^\d+' THEN
  v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
END IF;
```
door
```sql
v_betaaltermijn_dagen := betaaltermijn_dagen(v_debiteur.betaalconditie);
```

- [ ] **Step 1: Schrijf migratie 288**

`CREATE OR REPLACE FUNCTION` van de drie RPC's, telkens de **volledige bestaande body** uit mig 227/232/234 overgenomen met alléén de betaaltermijn-regel vervangen. Kopieer de bodies letterlijk uit:
- `genereer_factuur` ← `supabase/migrations/227_genereer_factuur_no_op_guard.sql:19-118`
- `genereer_factuur_voor_week` ← `supabase/migrations/232_genereer_factuur_voor_week.sql`
- `genereer_factuur_voor_bundel` ← `supabase/migrations/234_verzendkosten_resolver_en_factuur_bundel_rpc.sql:256-428`

Header van het bestand:

```sql
-- Migratie 288: factuur-RPC's gebruiken betaaltermijn_dagen() (ADR-0022)
--
-- Vervangt in genereer_factuur (mig 227), genereer_factuur_voor_week (mig 232)
-- en genereer_factuur_voor_bundel (mig 234) de foute
-- `regexp_match(betaalconditie, '^(\d+)')`-parse door de centrale helper uit
-- mig 287. Bodies verder ongewijzigd overgenomen (CREATE OR REPLACE).
--
-- Idempotent.
```

Voor elke functie: plak de volledige body, vervang het `IF v_debiteur.betaalconditie ~ '^\d+' ...`-blok (resp. `v_betaaltermijn_dagen := …`-init) door:
```sql
  v_betaaltermijn_dagen := betaaltermijn_dagen(v_debiteur.betaalconditie);
```
Laat de `v_betaaltermijn_dagen INTEGER := 30;`-declaratie staan (onschadelijk; helper overschrijft altijd).

Sluit af met een assertie-blok:

```sql
DO $$
DECLARE
  v_src TEXT;
BEGIN
  FOR v_src IN
    SELECT prosrc FROM pg_proc
     WHERE proname IN ('genereer_factuur','genereer_factuur_voor_week','genereer_factuur_voor_bundel')
  LOOP
    IF v_src LIKE '%regexp_match(%betaalconditie%^(\\d+)%' THEN
      RAISE EXCEPTION 'FAAL: een factuur-RPC bevat nog de oude betaalconditie-regex';
    END IF;
    IF v_src NOT LIKE '%betaaltermijn_dagen(%' THEN
      RAISE EXCEPTION 'FAAL: een factuur-RPC roept betaaltermijn_dagen() niet aan';
    END IF;
  END LOOP;
  RAISE NOTICE 'Mig 288: alle factuur-RPC''s gebruiken de helper';
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verifieer dat de assertie faalt vóór toepassing**

Draai alléén het `DO`-blok in SQL Editor (vóór de `CREATE OR REPLACE`s).
Expected: `ERROR: FAAL: een factuur-RPC bevat nog de oude betaalconditie-regex`.

- [ ] **Step 3: Pas migratie 288 toe**

Draai het hele bestand.
Expected: `NOTICE: Mig 288: alle factuur-RPC's gebruiken de helper`.

- [ ] **Step 4: Functionele dubbelcheck**

```sql
-- Simuleer: welke vervaldatum zou TRENDHOPPER (debiteur 803741) nu krijgen?
SELECT CURRENT_DATE AS factuurdatum,
       CURRENT_DATE + betaaltermijn_dagen(betaalconditie) AS vervaldatum,
       betaalconditie
  FROM debiteuren WHERE debiteur_nr = 803741;
```
Expected: `vervaldatum = factuurdatum + 30`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/288_factuur_rpcs_betaaltermijn_helper.sql
git commit -m "fix(factuur): betaaltermijn uit betaalcondities i.p.v. code-prefix (ADR-0022 issue 1)"
```

---

## Task 3: Legacy `genereer_factuur` — VERZEND-vangnet + drempel-resolver

**Files:**
- Create: `supabase/migrations/289_genereer_factuur_bundel_vangnet.sql`

Doel: zolang het legacy-pad bereikbaar is (Scenario A uit Task 0), mag het geen dubbele `VERZEND` of ontbrekende drempel meer produceren. We brengen `genereer_factuur` gedragsmatig in lijn met `genereer_factuur_voor_bundel`.

- [ ] **Step 1: Schrijf migratie 289**

Neem de body van `genereer_factuur` zoals net in mig 288 vastgelegd en pas drie dingen aan:
1. De product-regel-`INSERT … SELECT` en de `UPDATE order_regels SET gefactureerd` krijgen beide de extra conditie `AND COALESCE(orr.artikelnr,'') <> 'VERZEND'` (zoals mig 234 r363/r370).
2. Ná de product-regels: bereken `v_bundel_subtotaal`, bepaal `v_is_afhalen` via `BOOL_OR(orders.afhalen)` over `p_order_ids`, roep `verzendkosten_voor_bundel(debiteur, subtotaal, afhalen)` aan en voeg exact één `VERZEND`-factuurregel toe (kopieer het `INSERT INTO factuur_regels (… 'VERZEND' …)`-blok 1-op-1 uit mig 234 r395-414, met `v_order_ids` vervangen door `p_order_ids`).
3. De no-op-guard (`v_aantal_te_factureren`) krijgt ook `AND COALESCE(orr.artikelnr,'') <> 'VERZEND'`.

Header:

```sql
-- Migratie 289: genereer_factuur — bundel-conform vangnet (ADR-0022 issue 2+3)
--
-- Zolang de legacy per_zending-dispatch bereikbaar is (queue-rij zonder
-- zending_id), mag genereer_factuur geen per-order VERZEND meer kopiëren en
-- geen drempel meer overslaan. Brengt het gedrag in lijn met
-- genereer_factuur_voor_bundel (mig 234): strip VERZEND-orderregels, voeg
-- exact één resolver-getoetste VERZEND-regel toe. Betaaltermijn al via
-- mig 288-helper. Idempotent: CREATE OR REPLACE.
```

Sluit af met assertie:

```sql
DO $$
DECLARE v_src TEXT;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname='genereer_factuur';
  IF v_src NOT LIKE '%verzendkosten_voor_bundel(%' THEN
    RAISE EXCEPTION 'FAAL: genereer_factuur roept de resolver niet aan';
  END IF;
  IF v_src NOT LIKE '%<> ''VERZEND''%' THEN
    RAISE EXCEPTION 'FAAL: genereer_factuur stript VERZEND-orderregels niet';
  END IF;
  RAISE NOTICE 'Mig 289: genereer_factuur is bundel-conform';
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verifieer dat de assertie faalt vóór toepassing**

Draai alléén het `DO`-blok.
Expected: `ERROR: FAAL: genereer_factuur roept de resolver niet aan`.

- [ ] **Step 3: Pas migratie 289 toe**

Draai het hele bestand.
Expected: `NOTICE: Mig 289: genereer_factuur is bundel-conform`.

- [ ] **Step 4: Droogtest op de probleem-orders (read-only transactie)**

```sql
BEGIN;
-- Reset gefactureerd zodat de RPC iets te doen heeft (alleen in deze TX)
UPDATE order_regels SET gefactureerd = 0
 WHERE order_id IN (SELECT id FROM orders WHERE order_nr IN ('ORD-2026-2051','ORD-2026-2052'));
SELECT genereer_factuur(
  (SELECT array_agg(id) FROM orders WHERE order_nr IN ('ORD-2026-2051','ORD-2026-2052'))
) AS factuur_id \gset
SELECT artikelnr, omschrijving, bedrag
  FROM factuur_regels WHERE factuur_id = :factuur_id ORDER BY regelnummer;
ROLLBACK;
```
Expected: exact **één** `VERZEND`-regel; bij bundel-subtotaal € 839,76 ≥ drempel € 500 is `bedrag = 0` met reden "Gratis vanaf €500.00". `ROLLBACK` maakt alles ongedaan.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/289_genereer_factuur_bundel_vangnet.sql
git commit -m "fix(factuur): legacy genereer_factuur strip VERZEND + drempel-resolver (ADR-0022 issue 2+3)"
```

---

## Task 4: Backfill `factuur_queue.zending_id` (conditioneel — Scenario A)

**Files:**
- Create: `supabase/migrations/290_factuur_queue_zending_backfill.sql`

**Alleen uitvoeren als Task 0 Scenario A opleverde.** Bij Scenario B: maak het bestand met enkel een toelichtende header + `RAISE NOTICE 'Scenario B: backfill niet nodig'` en commit dat, zodat de migratie-keten compleet blijft.

- [ ] **Step 1: Schrijf migratie 290**

```sql
-- Migratie 290: factuur_queue.zending_id backfill (ADR-0022, Scenario A)
--
-- Open queue-rijen (pending/processing) met NULL zending_id terwijl hun
-- order(s) wél in een zending zitten → vul zending_id zodat de drain naar
-- genereer_factuur_voor_bundel dispatcht i.p.v. legacy genereer_factuur.
-- Idempotent: WHERE zending_id IS NULL.

UPDATE factuur_queue q
   SET zending_id = zo.zending_id
  FROM zending_orders zo
 WHERE q.zending_id IS NULL
   AND q.status IN ('pending','processing')
   AND zo.order_id = ANY(q.order_ids)
   -- Alleen als alle orders in q.order_ids in exact dezelfde zending zitten
   AND (SELECT COUNT(DISTINCT zo2.zending_id)
          FROM zending_orders zo2 WHERE zo2.order_id = ANY(q.order_ids)) = 1;

DO $$
DECLARE v_rest INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_rest FROM factuur_queue
   WHERE zending_id IS NULL AND status IN ('pending','processing');
  RAISE NOTICE 'Mig 290: resterende open queue-rijen zonder zending_id: %', v_rest;
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Pas toe en inspecteer**

Draai het bestand. Lees de NOTICE: bij `> 0` resterende rijen → handmatig inspecteren (multi-zending-order of verweesde rij) en in changelog noteren; niet blind forceren.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/290_factuur_queue_zending_backfill.sql
git commit -m "fix(factuur): backfill factuur_queue.zending_id naar bundel-RPC-pad (ADR-0022)"
```

---

## Task 5: Remediatie bestaande foute concept-facturen

**Files:**
- Create: `supabase/migrations/291_remediatie_foute_concept_facturen.sql`

**Achter expliciete bevestiging** — muteert `order_regels.gefactureerd`. Alleen `status='Concept'`-facturen (niet `Verstuurd`). Aanpak: maak de foute factuur ongedaan (verwijder regels + header, zet `gefactureerd` terug), zodat de bestaande/nieuwe queue-flow 'm correct hergenereert.

- [ ] **Step 1: Toon de impactlijst aan de gebruiker, vraag bevestiging**

```sql
SELECT f.factuur_nr, f.debiteur_nr, f.factuurdatum, f.vervaldatum,
       (f.vervaldatum - f.factuurdatum) AS termijn,
       COUNT(fr.id) FILTER (WHERE fr.artikelnr='VERZEND') AS verzend_regels,
       f.totaal
  FROM facturen f
  LEFT JOIN factuur_regels fr ON fr.factuur_id = f.id
 WHERE f.status='Concept'
   AND ((f.vervaldatum - f.factuurdatum) < 5
        OR (SELECT COUNT(*) FROM factuur_regels x
             WHERE x.factuur_id=f.id AND x.artikelnr='VERZEND') > 1)
 GROUP BY f.id ORDER BY f.factuur_nr;
```
Vraag de gebruiker via `AskUserQuestion` of deze exacte lijst hersteld mag worden. **Niet doorgaan zonder ja.**

- [ ] **Step 2: Schrijf migratie 291 (parametriseerbaar via tijdvenster)**

```sql
-- Migratie 291: remediatie foute concept-facturen (ADR-0022)
--
-- Reversed alleen status='Concept'-facturen met te-korte betaaltermijn
-- (< 5 dagen) of >1 VERZEND-regel. Per factuur: gefactureerd-reset op de
-- gekoppelde order_regels, verwijder factuur_regels + factuur. De
-- enqueue/drain-flow hergenereert correct (mig 288/289). Idempotent: na
-- run matchen geen rijen meer op het filter.
--
-- VEILIGHEID: raakt nooit status='Verstuurd'/'Betaald'. Geen Concept buiten
-- het filter. Draai binnen één transactie.

BEGIN;

CREATE TEMP TABLE _te_herstellen ON COMMIT DROP AS
SELECT DISTINCT f.id AS factuur_id
  FROM facturen f
 WHERE f.status='Concept'
   AND ( (f.vervaldatum - f.factuurdatum) < 5
        OR (SELECT COUNT(*) FROM factuur_regels x
             WHERE x.factuur_id=f.id AND x.artikelnr='VERZEND') > 1 );

-- 1. gefactureerd terugzetten op de bron-orderregels
UPDATE order_regels orr
   SET gefactureerd = 0
  FROM factuur_regels fr
 WHERE fr.factuur_id IN (SELECT factuur_id FROM _te_herstellen)
   AND fr.order_regel_id = orr.id;

-- 2. regels + headers verwijderen
DELETE FROM factuur_regels WHERE factuur_id IN (SELECT factuur_id FROM _te_herstellen);
DELETE FROM facturen        WHERE id        IN (SELECT factuur_id FROM _te_herstellen);

-- 3. queue-rijen die naar deze facturen wezen terug op pending zetten zodat
--    de drain hergenereert (factuur_id wordt door drain opnieuw gezet)
UPDATE factuur_queue
   SET status='pending', factuur_id=NULL, attempts=0, last_error=NULL,
       processing_started_at=NULL
 WHERE factuur_id IS NOT NULL
   AND factuur_id NOT IN (SELECT id FROM facturen);

DO $$
DECLARE v_n INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_n FROM facturen
   WHERE status='Concept' AND (vervaldatum - factuurdatum) < 5;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FAAL: na remediatie nog % foute concept-facturen', v_n;
  END IF;
  RAISE NOTICE 'Mig 291: remediatie voltooid';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Pas toe binnen transactie, verifieer**

Draai het bestand. Expected: `NOTICE: Mig 291: remediatie voltooid`, geen error.

- [ ] **Step 4: Trigger de drain en controleer de hergenereerde facturen**

De gebruiker roept de `factuur-verzenden` edge function aan (cron-tik of handmatig). Daarna:
```sql
SELECT factuur_nr, factuurdatum, vervaldatum, (vervaldatum-factuurdatum) AS termijn, totaal
  FROM facturen WHERE status='Concept' ORDER BY factuur_nr DESC LIMIT 10;
```
Expected: termijn = werkelijke betaaltermijn (bv. 30); per bundel-factuur exact 1 VERZEND-regel; drempel toegepast waar subtotaal ≥ `verzend_drempel`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/291_remediatie_foute_concept_facturen.sql
git commit -m "fix(factuur): remedieer foute concept-facturen (vervaldatum + dubbel VERZEND) (ADR-0022)"
```

---

## Task 6: Documentatie + CLAUDE.md

**Files:**
- Modify: `docs/changelog.md`, `docs/database-schema.md`, `docs/data-woordenboek.md`, `docs/adr/0022-*.md`, `CLAUDE.md`

- [ ] **Step 1: changelog.md** — voeg onder de fase-0-diagnose-notitie een entry toe: datum 2026-05-15, "Factuur betaaltermijn + bundel-verzendkosten", wat (mig 287-291), waarom (ADR-0022), met de drie issues benoemd.

- [ ] **Step 2: database-schema.md** — documenteer functie `betaaltermijn_dagen(TEXT)` bij de functies-sectie; noteer bij `genereer_factuur` / `genereer_factuur_voor_week` / `genereer_factuur_voor_bundel` dat de betaaltermijn via de helper loopt en dat `genereer_factuur` sinds mig 289 bundel-conform VERZEND afhandelt.

- [ ] **Step 3: data-woordenboek.md** — voeg begrip toe: **betaalconditie-code** (prefix in `debiteuren.betaalconditie`, géén dagen) vs **betaaltermijn** (`betaalcondities.dagen`, het werkelijke aantal dagen). Expliciet de val-kuil benoemen.

- [ ] **Step 4: ADR-0022** — wijzig `- **Status:** Voorgesteld` → `- **Status:** Geaccepteerd` en voeg onderaan een "Implementatie"-regel toe die naar mig 287-291 verwijst.

- [ ] **Step 5: CLAUDE.md** — voeg onder "Bedrijfsregels" een regel toe:

> **Factuur-betaaltermijn & per_zending-bundel (ADR-0022, mig 287-291):** vervaldatum = factuurdatum + `betaaltermijn_dagen(debiteuren.betaalconditie)` — die functie is de single source of truth (code-prefix → `betaalcondities.dagen`, fallback 30). Nooit het leidende getal uit `betaalconditie` als dagen gebruiken (dat is de code). Alle factuur-RPC's (`genereer_factuur`, `_voor_week`, `_voor_bundel`) consumeren de helper. `genereer_factuur` (legacy per_zending-pad) is sinds mig 289 bundel-conform: stript `VERZEND`-orderregels en voegt exact één `verzendkosten_voor_bundel`-getoetste regel toe — gedrag is dus pad-onafhankelijk. Event-driven facturen horen via `zending_id` → `genereer_factuur_voor_bundel` te lopen; queue-rijen zonder `zending_id` vallen terug op het (nu correcte) legacy-pad.

- [ ] **Step 6: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs(factuur): ADR-0022 geaccepteerd + schema/woordenboek/changelog/CLAUDE bijgewerkt"
```

---

## Self-Review

- **Spec coverage:** Issue 1 → Task 1+2 (helper + RPC's) + Task 5 (remediatie bestaande). Issue 2 (dubbel VERZEND) → Task 3 (legacy vangnet) + Task 4 (routing naar bundel-RPC) + Task 5. Issue 3 (drempel) → idem Task 3/4/5. Onbekende prod-staat → Task 0. Docs/ADR-pairing → Task 6. ✔ Alle drie issues + ADR gedekt.
- **Placeholder-scan:** geen TBD/TODO; alle SQL volledig uitgeschreven; bodies-overname expliciet met bronregelverwijzing (geen "similar to"). ✔
- **Type-consistentie:** `betaaltermijn_dagen(TEXT) → INTEGER` consistent gebruikt in Task 1/2/6; `verzendkosten_voor_bundel(INTEGER,NUMERIC,BOOLEAN)`-signature gelijk aan mig 234. Migratienummers 287→291 oplopend en uniek. ✔
- **Open afhankelijkheid:** Task 4 en de exacte vorm van Task 5 hangen op Task 0-uitkomst (Scenario A/B) — expliciet zo gemarkeerd, geen verborgen aanname.
