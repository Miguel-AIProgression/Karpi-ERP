# Combi-levering pre-productie-fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De 4 blockers + hoog-bevindingen uit de pre-productie-audit van 02-07-2026 fixen zodat `feat/combi-levering` veilig naar `main`/productie kan.

**Architecture:** Alle fixes haken aan op de bestaande single-source-keten (`herbereken_wacht_status` → 5-arg `derive_wacht_status`, mig 564/565) en de view `combi_levering_status`. Géén nieuwe mechanismes — alleen ontbrekende aanroep-momenten dichten, één view-regressie herstellen en drie frontend-gaten sluiten. Migratie-nummers 570-574 zijn voorlopig: her-verifieer vlak vóór apply (parallelle sessies schrijven live nummers — zie geheugen-regel "Migratienummer-collisie bij merge").

**Tech Stack:** Supabase (PostgreSQL migraties, handmatig via SQL-editor — géén `db push`), React/TypeScript frontend (Vitest), edge function `stuur-orderbevestiging` (Supabase CLI deploy).

**Audit-referentie:** 24 bevestigde bevindingen (8-dimensie multi-agent review + adversariële verificatie, 02-07). Live-staat op moment van schrijven: mig 556-569 staan AL op productie, inclusief de mig 569-regressie (blocker 1). Er is al een echte combi-testgroep actief (orders 5062/5063, debiteur met drempel €500).

---

## Beslisboom — praktijkgedrag ná de fix

### 1. Wanneer doet een order mee aan Combi-levering?

```
Order van klant X naar adres A
│
├─ klant.combi_levering = UIT ────────────────► normaal pad: VERZEND-regel op de
│                                                order zelf als subtotaal < drempel
│                                                (bestaand gedrag, ongewijzigd)
├─ order.combi_levering_override = AAN ───────► direct pad: order ontsnapt uit de
│                                                groep, krijgt VERZEND-regel (trigger),
│                                                siblings herevalueren direct
├─ dropship-order ────────────────────────────► doet nooit mee (betaalt al eigen
│                                                verzending; krijgt óók nooit een
│                                                VERZEND-regel — fix Task 5)
├─ status Concept ────────────────────────────► telt niet mee (nog niet bevestigd;
│                                                telt pas mee ná bevestig_concept_order
│                                                — fix Task 1)
├─ alleen_productie (Basta) ──────────────────► telt niet mee (fix Task 1)
├─ status In pickronde / Deels verzonden /
│  Verzonden / Geannuleerd ───────────────────► al vertrokken: telt niet meer mee
│                                                in de groep (mig 561-gedrag hersteld
│                                                — fix Task 1)
└─ anders ────────────────────────────────────► LID van de wachtgroep
                                                 (groep = debiteur × genormaliseerd
                                                 afleveradres, over weken heen)
```

### 2. Wacht de groep, of mag hij door? (view `combi_levering_status`)

```
Groep (klant × adres) met leden zoals hierboven
│
├─ klant.gratis_verzending = AAN ─────────────► nooit wachten, geen verzendkosten
├─ SOM(subtotalen leden, excl. pseudo-regels)
│  < verzend_drempel (leeg veld → €500) ──────► HELE GROEP WACHT
│                                                → elke order krijgt status
│                                                  'Wacht op combi-levering'
│                                                → onzichtbaar in Pick & Ship
│                                                → géén VERZEND-regel (Anker 5)
│                                                → zichtbaar op commercie: eigen
│                                                  status-tab + groeps-badge (mig 569)
├─ drempel gehaald, maar ≥1 lid nog niet
│  pickbaar (voorraad/productie loopt) ───────► HELE GROEP WACHT (Anker 3:
│                                                "de hele groep of niemand")
└─ drempel gehaald + alle leden pickbaar ─────► HELE GROEP VRIJ
                                                 → alle leden naar 'Klaar voor picken'
                                                 → samen zichtbaar in Pick & Ship
```

### 3. Welke gebeurtenis herevalueert wat? (na de fix allemaal sluitend)

| Gebeurtenis | Wat gebeurt er met de groep |
|---|---|
| Order aangemaakt + bevestigd (`bevestig_concept_order`) | Order zelf krijgt wacht-/vrij-status; alle siblings herevalueren (bestaande keten) |
| Orderregel gewijzigd — óók alleen prijs/korting, regel verwijderd | `update_order_with_lines` eindigt met herbereken + cascade (**fix Task 3**) |
| Adres of debiteur van de order gewijzigd | Nieuwe groep herevalueert (bestaand) + OUDE groep herevalueert (**fix Task 3**) |
| Order geannuleerd | Cascade via bestaande `trg_order_status_herallocateer`-keten — siblings vallen terug in wacht als groep onder drempel zakt (geverifieerd, geen fix nodig) |
| Order verzonden | Zelfde keten — siblings herevalueren (geverifieerd, geen fix nodig) |
| Pickronde gestart voor deel van de groep | Achterblijvers vallen DIRECT terug naar 'Wacht op combi-levering' en verdwijnen uit Pick & Ship (**fix Task 2**; voorheen bleven ze stale 'Klaar voor picken') |
| Klant-toggle combi_levering aan/uit | Alle open orders van de klant: status + VERZEND-regel herwaardeerd (bestaand, mig 567) |
| Order-override aan/uit | Order ontsnapt/keert terug; VERZEND-regel + status + siblings (bestaand, mig 567) |
| "Zet in de wacht"-knop op order-detail | Klantbreed effect + nieuwe orderbevestiging met wacht-paragraaf (bestaand, mig 560) |
| Deelzending op wachtende order | **GEBLOKKEERD** met verwijzing naar de override (**fix Task 4**; was een stille omzeilroute) |

### 4. Vrijgave → verzending (het "doorzetten bij de limiet")

```
Groep haalt drempel + alle leden pickbaar
│
├─ Alle leden → 'Klaar voor picken', verschijnen samen in Pick & Ship
├─ Operator selecteert de hele groep → start_pickronden bundelt op
│   (debiteur × adres × vervoerder): ÉÉN zending, één pakbon, één label-set
│   (bestaande bundel-mechaniek, geen nieuwe code — Anker 4)
├─ Operator start tóch een subset → amber waarschuwing + bevestig-vinkje;
│   bevestigt hij, dan vallen de achterblijvers direct terug in de wacht
│   (fix Task 2) en wachten op nieuw volume
├─ Geen VERZEND-regel op geen van de leden (drempel is immers gehaald)
└─ Facturatie: bestaand pad (1 zending → 1 factuur, 2u-concept-venster)
```

### 5. Ontsnappingsroutes (klant wil tóch niet wachten)

```
├─ Order-override aanzetten (order-form of order-bewerken)
│   → order verlaat de groep, VERZEND-regel komt automatisch terug,
│     siblings herevalueren. DE bedoelde route ("verstuur toch, met kosten").
├─ Klant-toggle uitzetten (debiteur-detail)
│   → alle orders van de klant terug naar het normale pad.
└─ Deelzending: NIET meer mogelijk op een wachtende order (Task 4) —
    foutmelding verwijst naar de override.
```

---

## Vooraf: coördinatie (LEES DIT EERST)

1. Er werkt mogelijk een **tweede Claude-sessie** in deze worktree (mig 569 kwam 02-07 08:50 binnen tijdens de audit). Stem af / verifieer met `git log --oneline -3` en `git status` dat je niet door lopend werk heen schrijft.
2. Het **niet-gecommitte ADR-0040-werk** (mig 562-568, status-laag-frontend, docs) moet gecommit zijn vóór deze fixes — de fixes bouwen erop voort.
3. **Migraties handmatig toepassen** via het Supabase SQL-dashboard (project `wqzeevfobwauxkalagtn`) — nooit `supabase db push` (geheugen-regel). Elke migratie eerst in een rolled-back transactie testen (`BEGIN; ... ROLLBACK;`), daarna definitief.
4. Mig 556-569 staan al live: van dit plan hoeven alleen 570-574 nog naar de DB.

---

### Task 0: Werkboom vastleggen + migratienummers verifiëren

**Files:** geen wijzigingen — alleen git/verificatie.

- [ ] **Step 1: Controleer de staat**

Run (in de worktree `C:/Users/migue/Documents/Karpi ERP/.worktrees/combi-levering`):
```bash
git log --oneline -3 && git status --short | head -40 && ls supabase/migrations | tail -5
```
Expected: laatste commit `495af08e` (of nieuwer), uncommitted ADR-0040-bestanden zichtbaar, hoogste migratienummer bepaalt de nummering hieronder (plan gaat uit van 569 → nieuwe reeks 570-574; schuif op als er al hogere nummers zijn).

- [ ] **Step 2: Commit het openstaande ADR-0040-werk** (alleen als de andere sessie dat niet al deed — stem af bij twijfel)

```bash
git add docs/adr/0040-combi-levering-als-order-status.md supabase/migrations/55[6-9]_*.sql supabase/migrations/56[0-2]_*.sql supabase/functions/_shared/combi-levering-tekst.ts
git add -u
git commit -m "feat(combi-levering): ADR-0040 — 'Wacht op combi-levering' als echte order_status (mig 562-568)"
```

- [ ] **Step 3: Draai de suite als nulmeting**

```bash
cd frontend && npx vitest run --reporter=dot 2>&1 | tail -3 && npx tsc -b --noEmit && echo TSC-OK
```
Expected: `850 passed` (of meer), `TSC-OK`.

---

### Task 1 — BLOCKER 1: mig 570 herstelt de view-regressie van mig 569

Mig 569 herbouwde `combi_levering_status` vanaf de verouderde mig 557-body: de uitsluiting van `'In pickronde'`/`'Deels verzonden'` (mig 561) en de `COALESCE(verzend_drempel, 500)`-fallback (mig 562) verdwenen — **en dit staat al live**. Deze migratie zet de mig 562-semantiek terug MET de mig 569-kolommen, en sluit meteen `'Concept'` (onbevestigde intake hoort de groep niet te sturen — zelfde filosofie als de Concept-intake-gate, mig 540-542) en `alleen_productie` (Basta-orders, ADR-0029: geen prijzen in RugFlow, verzending buiten RugFlow om) uit.

**Files:**
- Create: `supabase/migrations/564_combi_levering_view_herstel.sql`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 570: herstel combi_levering_status — mig 569 herbouwde de view
-- vanaf de pre-561/562-body en liet daarmee twee al-gefixte bugs terugkeren:
--   (1) 'In pickronde'/'Deels verzonden' telden weer mee in het groep-subtotaal
--       (mig 561-fix weg) — een achterblijver toonde "drempel gehaald" terwijl
--       zijn maat al vertrokken was;
--   (2) NULL verzend_drempel gold weer als "geen drempel = altijd gehaald"
--       (mig 562-fix weg) — feature stil buiten werking voor die klanten.
-- Deze body = mig 562-semantiek + de mig 569-kolommen (aantal_orders/order_ids).
-- Nieuw t.o.v. 562 (audit 02-07): 'Concept' en alleen_productie uitgesloten —
-- een onbevestigde Concept-order (mig 540-542) mag het groepssubtotaal niet
-- vullen en de groep niet blokkeren; Basta-orders (ADR-0029) hebben geen
-- RugFlow-prijzen en verzenden buiten RugFlow om.

CREATE OR REPLACE VIEW combi_levering_status AS
WITH leden AS (
  SELECT
    o.id                                                               AS order_id,
    o.debiteur_nr,
    _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land) AS adres_norm,
    COALESCE(op.alle_regels_pickbaar, FALSE)                          AS alle_regels_pickbaar,
    combi_levering_orderregel_subtotaal(o.id)                         AS subtotaal
  FROM orders o
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  LEFT JOIN order_pickbaarheid op ON op.order_id = o.id
 WHERE o.status NOT IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden', 'Concept')
   AND o.combi_levering_override = FALSE
   AND COALESCE(o.alleen_productie, FALSE) = FALSE
   AND d.combi_levering = TRUE
   AND NOT is_dropship_order(o.id)
),
groep AS (
  SELECT
    debiteur_nr,
    adres_norm,
    SUM(subtotaal)                        AS groep_subtotaal,
    bool_and(alle_regels_pickbaar)        AS alle_leden_pickbaar,
    array_agg(order_id ORDER BY order_id) AS order_ids,
    count(*)::INTEGER                     AS aantal_orders
  FROM leden
  GROUP BY debiteur_nr, adres_norm
)
SELECT
  l.order_id,
  g.groep_subtotaal,
  d.verzend_drempel,
  d.gratis_verzending,
  g.alle_leden_pickbaar,
  (
    NOT d.gratis_verzending
    AND (
      g.groep_subtotaal < COALESCE(d.verzend_drempel, 500)
      OR NOT g.alle_leden_pickbaar
    )
  ) AS wacht_op_combi_levering,
  g.aantal_orders,
  g.order_ids
FROM leden l
JOIN groep g ON g.debiteur_nr = l.debiteur_nr AND g.adres_norm = l.adres_norm
JOIN debiteuren d ON d.debiteur_nr = l.debiteur_nr;

COMMENT ON VIEW combi_levering_status IS
  'Mig 557/561/562/569/570 (ADR-0039/0040): per order, alleen voor klanten met '
  'combi_levering=TRUE en niet-overruled/niet-dropshipment/nog-niet-gestarte, '
  'bevestigde (non-Concept), niet-alleen_productie orders: '
  'wacht_op_combi_levering=TRUE zolang de (debiteur x adres-norm)-groep de '
  'vrachtvrije-drempel (NULL -> 500, = frontend SHIPPING_THRESHOLD) niet haalt, '
  'OF de drempel haalt maar niet alle leden pickbaar zijn. '
  'aantal_orders/order_ids (mig 569) voeden de groeps-badge. '
  'Mig 570: herstel van de mig 569-regressie (561/562-fixes terug) + Concept/'
  'alleen_productie-uitsluiting.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Test rolled-back op de live DB** (Supabase SQL-editor)

```sql
BEGIN;
-- (plak hier de volledige CREATE OR REPLACE VIEW uit step 1)
-- Verificatie 1: testgroep 5062/5063 geeft nog steeds een consistente rij
SELECT order_id, groep_subtotaal, wacht_op_combi_levering, aantal_orders
  FROM combi_levering_status WHERE order_id IN (5062, 5063);
-- Verificatie 2: geen enkel lid heeft nog status In pickronde/Deels verzonden/Concept
SELECT count(*) FROM combi_levering_status cls
  JOIN orders o ON o.id = cls.order_id
 WHERE o.status IN ('In pickronde','Deels verzonden','Concept');  -- verwacht: 0
ROLLBACK;
```
Expected: rij(en) voor 5062/5063 met dezelfde kolommen als nu, tweede query `0`.

- [ ] **Step 3: Pas definitief toe** (zelfde SQL zonder BEGIN/ROLLBACK) en draai verificatie 2 nogmaals.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/564_combi_levering_view_herstel.sql
git commit -m "fix(combi-levering): mig 570 — herstel view-regressie uit mig 569 + Concept/alleen_productie-uitsluiting"
```

---

### Task 2 — BLOCKER 2: mig 571 laat pickronde-start de achterblijvers herevalueren

`markeer_pickronde_gestart` (mig 258) doet een kale statuswissel; `trg_order_status_herallocateer` vuurt alleen op Geannuleerd/Verzonden-transities. Gevolg: start je een subset van een vrijgegeven groep, dan blijven de achterblijvers stale `'Klaar voor picken'` (zichtbaar, startbaar, zonder VERZEND-regel) tot de gestarte order verzonden wordt. Eén extra `PERFORM` sluit dit: de eigen order is `'In pickronde'` (no-touch → no-op), de cascade (default `TRUE`) herevalueert de siblings. Voor niet-combi-klanten is de cascade een lege, goedkope query (filter `d2.combi_levering = TRUE`).

**Files:**
- Create: `supabase/migrations/565_pickronde_start_combi_cascade.sql`

- [ ] **Step 1: Schrijf de migratie** (volledige body = mig 258 + één PERFORM)

```sql
-- Migratie 571: markeer_pickronde_gestart herevalueert nu ook de Combi-
-- levering-siblings (ADR-0040, audit-blocker 02-07). Tot nu toe bleven
-- achterblijvers van een deels gestarte groep stale op 'Klaar voor picken'
-- (zichtbaar in Pick & Ship, zonder VERZEND-regel) totdat de gestarte order
-- 'Verzonden' werd. Body = mig 258 + PERFORM herbereken_wacht_status ná de
-- transitie: voor de eigen order een no-op ('In pickronde' is no-touch), de
-- groep-cascade (mig 565, default TRUE) demoveert de siblings direct terug
-- naar 'Wacht op combi-levering' als de rest-groep onder de drempel zakt.
-- Niet-combi-klanten: sibling-query matcht niets (d2.combi_levering=TRUE).

CREATE OR REPLACE FUNCTION markeer_pickronde_gestart(
  p_order_id            BIGINT,
  p_actor_medewerker_id BIGINT DEFAULT NULL,
  p_actor_auth_user_id  UUID   DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_huidig IN ('Verzonden', 'Geannuleerd') THEN
    RAISE EXCEPTION 'Order % staat op % — kan geen pickronde meer starten', p_order_id, v_huidig
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_huidig IN ('In pickronde', 'Deels verzonden') THEN
    RETURN;
  END IF;

  PERFORM _apply_transitie(
    p_order_id            := p_order_id,
    p_event_type          := 'pickronde_gestart',
    p_status_na           := 'In pickronde',
    p_actor_medewerker_id := p_actor_medewerker_id,
    p_actor_auth_user_id  := p_actor_auth_user_id
  );

  -- Mig 571 (ADR-0040): eigen order = no-op (no-touch), maar de groep-cascade
  -- herevalueert de Combi-levering-siblings die zonder deze order mogelijk
  -- weer onder de vrachtvrije-drempel zakken.
  PERFORM herbereken_wacht_status(p_order_id);
END;
$$;

COMMENT ON FUNCTION markeer_pickronde_gestart IS
  'Mig 258 (ADR-0016): zet orders.status=''In pickronde'' + audit-event. '
  'Idempotent: no-op op In pickronde/Deels verzonden; faalt op Verzonden/'
  'Geannuleerd. Mig 571 (ADR-0040): herevalueert na de transitie de Combi-'
  'levering-siblings via de herbereken_wacht_status-groep-cascade (mig 565).';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Test rolled-back op de live DB**

```sql
BEGIN;
-- (plak de CREATE OR REPLACE uit step 1)
-- Uitgangssituatie: 5062+5063 samen >= 500, apart eronder.
SELECT id, status FROM orders WHERE id IN (5062, 5063);
SELECT markeer_pickronde_gestart(5062);
-- Verwacht: 5062 -> 'In pickronde'; 5063 -> 'Wacht op combi-levering'
-- (mits 5063 solo onder de drempel zit en geen andere blokkade heeft)
SELECT id, status FROM orders WHERE id IN (5062, 5063);
ROLLBACK;
```
Expected: sibling 5063 demoveert. (Zit 5063 solo tóch boven de drempel, fabriceer dan in dezelfde transactie een kleinere testgroep — de ROLLBACK ruimt alles op.)

- [ ] **Step 3: Pas definitief toe.**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/565_pickronde_start_combi_cascade.sql
git commit -m "fix(combi-levering): mig 571 — pickronde-start demoveert achterblijvende siblings direct"
```

---

### Task 3 — BLOCKER 3: mig 572 herberekent na élke order-edit (incl. prijs & oude adres-groep)

`trg_orderregel_herallocateer` (mig 146) vuurt alleen op `artikelnr`/`te_leveren`/`is_maatwerk`. Een prijs-/korting-edit of regel-DELETE via `update_order_with_lines` wijzigt dus het groepssubtotaal zonder herberekening. Ook: bij een adres-/debiteurwijziging herevalueert alleen de NIEUWE groep (de order zelf draagt het nieuwe adres); de OUDE groep blijft stale. Fix: helper `herbereken_combi_groep` + twee toevoegingen aan `update_order_with_lines`.

**Files:**
- Create: `supabase/migrations/566_order_edit_combi_herbereken.sql`

- [ ] **Step 1: Haal de actuele live body van `update_order_with_lines` op** (project-precedent mig 488/559 — de live DB is bron, niet het migratiebestand):

```sql
SELECT pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'update_order_with_lines';
```

- [ ] **Step 2: Schrijf de migratie.** Deel 1 is compleet hieronder; deel 2 = de opgehaalde body + de twee gemarkeerde inserties.

```sql
-- Migratie 572: order-edits herberekenen voortaan de Combi-levering-status
-- (audit-blocker 02-07). trg_orderregel_herallocateer (mig 146) vuurt alleen
-- op artikelnr/te_leveren/is_maatwerk — een prijs-/korting-edit of regel-
-- verwijdering wijzigde het groepssubtotaal zonder status-herberekening, en
-- een adreswijziging liet de OUDE groep stale achter.

-- Deel 1: herbereken_combi_groep — herevalueer alle leden van één groep.
-- Zelfde predicaten als de sibling-cascade in herbereken_wacht_status
-- (mig 565); cascade=FALSE want deze loop bezoekt zelf al elk lid.
CREATE OR REPLACE FUNCTION herbereken_combi_groep(
  p_debiteur_nr INTEGER,
  p_adres_norm  TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_id BIGINT;
BEGIN
  IF p_debiteur_nr IS NULL THEN RETURN; END IF;
  FOR v_order_id IN
    SELECT o.id
      FROM orders o
      JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
     WHERE o.debiteur_nr = p_debiteur_nr
       AND _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land) = p_adres_norm
       AND o.status NOT IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden')
       AND o.combi_levering_override = FALSE
       AND d.combi_levering = TRUE
       AND NOT is_dropship_order(o.id)
  LOOP
    PERFORM herbereken_wacht_status(v_order_id, FALSE);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION herbereken_combi_groep(INTEGER, TEXT) IS
  'Mig 572 (ADR-0040): herevalueert alle Combi-levering-leden van één '
  '(debiteur x adres-norm)-groep. Consument: update_order_with_lines voor de '
  'OUDE groep na een adres-/debiteurwijziging (de order zelf zit dan al in de '
  'nieuwe groep en kan de oude niet meer via de normale cascade bereiken).';

-- Deel 2: update_order_with_lines — volledige actuele live body
-- (pg_get_functiondef, zie plan-step 1) met exact twee inserties:
--
-- (a) In de DECLARE-sectie extra variabelen:
--       v_oud_debiteur_nr INTEGER;
--       v_oud_adres_norm  TEXT;
--     En direct ná de bestaande "order bestaat"-lookup, vóór de orders-UPDATE:
--       SELECT o.debiteur_nr,
--              _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land)
--         INTO v_oud_debiteur_nr, v_oud_adres_norm
--         FROM orders o WHERE o.id = p_order_id;
--
-- (b) Als allerlaatste statements vóór de afsluitende RETURN:
--       -- Mig 572: élke edit (ook prijs-only/regel-delete) herevalueert de
--       -- eigen status + de (nieuwe) groep...
--       PERFORM herbereken_wacht_status(p_order_id);
--       -- ...en bij een groeps-verhuizing ook de achtergelaten oude groep.
--       IF v_oud_debiteur_nr IS DISTINCT FROM (SELECT debiteur_nr FROM orders WHERE id = p_order_id)
--          OR v_oud_adres_norm IS DISTINCT FROM (
--            SELECT _normaliseer_afleveradres(afl_adres, afl_postcode, afl_land)
--              FROM orders WHERE id = p_order_id)
--       THEN
--         PERFORM herbereken_combi_groep(v_oud_debiteur_nr, v_oud_adres_norm);
--       END IF;
--
-- (plak hier de volledige, aangepaste CREATE OR REPLACE FUNCTION-body)

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Test rolled-back op de live DB** — prijs-edit-scenario:

```sql
BEGIN;
-- (plak deel 1 + deel 2)
-- Neem de testgroep: verlaag de prijs van een regel van 5063 zodanig dat de
-- groep onder de drempel zakt, via update_order_with_lines (zelfde jsonb-vorm
-- als de frontend stuurt), en controleer dat BEIDE orders naar
-- 'Wacht op combi-levering' gaan. Daarna ROLLBACK.
ROLLBACK;
```
Expected: beide orders demoveren na de prijs-edit; vóór de fix bleef de status ongewijzigd.

- [ ] **Step 4: Pas definitief toe. Commit:**

```bash
git add supabase/migrations/566_order_edit_combi_herbereken.sql
git commit -m "fix(combi-levering): mig 572 — order-edit (incl. prijs) en adreswijziging herevalueren de wachtgroep(en)"
```

---

### Task 4 — BLOCKER 4: mig 573 blokkeert deelzendingen op wachtende orders + verbergt de knop

`start_deelzending` blokkeert alleen Verzonden/Geannuleerd; een deelzending op een `'Wacht op combi-levering'`-order maakt een 'Gepland'-zending, waardoor de order via de actieve-zending-OR-tak weer in Pick & Ship opduikt en zonder drempeltoets/VERZEND-regel/reden-audit verzonden wordt — precies de stille omzeiling die ADR-0039 Anker 4 verbiedt. De nette route bestaat al: order-override.

**Files:**
- Create: `supabase/migrations/567_deelzending_combi_guard.sql`
- Modify: `frontend/src/components/orders/order-regels-table.tsx:699` (knop-conditie)

- [ ] **Step 1: Schrijf de migratie.** Haal de actuele live body op (zelfde `pg_get_functiondef`-query als Task 3, `proname = 'start_deelzending'`) en voeg direct ná de bestaande eindstatus-guard (`IF v_order.status IN ('Verzonden', 'Geannuleerd') THEN ... END IF;`) toe:

```sql
  -- Mig 573 (ADR-0040/Anker 4): een Combi-levering-wachtende order mag niet
  -- via een deelzending stilletjes ontsnappen — de bedoelde route is de
  -- order-override ("Toch verzenden met verzendkosten"), die de status, de
  -- VERZEND-regel én de siblings netjes herwaardeert (mig 567).
  IF v_order.status = 'Wacht op combi-levering' THEN
    RAISE EXCEPTION 'Order % wacht op Combi-levering (vrachtvrije drempel nog niet gehaald). Zet eerst "Toch verzenden met verzendkosten" (combi-levering-override) aan op de order voordat je een deelzending start.', v_order.order_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
```

Migratie-bestand = kop-commentaar + volledige `CREATE OR REPLACE FUNCTION`-body met deze insertie + `NOTIFY pgrst, 'reload schema';`.

- [ ] **Step 2: Verberg de knop in de frontend.** In [order-regels-table.tsx](frontend/src/components/orders/order-regels-table.tsx), regel 699:

```tsx
  // Mig 573: wachtende Combi-levering-order → geen deelzending (gebruik de
  // combi-levering-override op de order; zie ook de server-side guard).
  const wachtOpCombiLevering = orderStatus === 'Wacht op combi-levering'
  const heeftDeelzendingKandidaat = !isEindstatus && !wachtOpCombiLevering && orderVerzendweek != null && regels.some(
```
(de bestaande `regels.some(...)`-body blijft ongewijzigd.)

- [ ] **Step 3: Test rolled-back op de live DB**

```sql
BEGIN;
-- (plak de nieuwe start_deelzending)
UPDATE orders SET status = 'Wacht op combi-levering' WHERE id = 5063;  -- forceer testtoestand
SELECT start_deelzending(5063, ARRAY[]::bigint[]);  -- gebruik de echte signatuur uit de body
ROLLBACK;
```
Expected: `EXCEPTION ... wacht op Combi-levering ...`.

- [ ] **Step 4: Typecheck + commit**

```bash
cd frontend && npx tsc -b --noEmit && cd ..
git add supabase/migrations/567_deelzending_combi_guard.sql frontend/src/components/orders/order-regels-table.tsx
git commit -m "fix(combi-levering): mig 573 — deelzending geblokkeerd op wachtende order (server-guard + knop)"
```

---

### Task 5 — HOOG: mig 574 — dropship-order krijgt nooit een VERZEND-regel via de combi-trigger

In `herwaardeer_combi_levering_verzendregel` (mig 562-body) telt `is_dropship_order` alleen mee in `v_moet_wachten`. Een dropship-order van een combi-klant valt daardoor in het "normale" pad en krijgt bij een klant-toggle een VERZEND-regel toegevoegd — terwijl de dropship-kostenregel al de verzendcomponent ís (projectregel: `applyShippingLogic` weigert VERZEND bij dropship).

**Files:**
- Create: `supabase/migrations/568_combi_verzendregel_dropship_guard.sql`

- [ ] **Step 1: Schrijf de migratie** (volledige body = mig 562 + dropship in het normale pad):

```sql
-- Migratie 574: herwaardeer_combi_levering_verzendregel — dropship-guard ook
-- in het "normale" (niet-wachtende) pad (audit 02-07). De dropship-kostenregel
-- ís de verzendcomponent (mig 353/370); een VERZEND-regel erbovenop is fout.
-- Body = mig 562 + v_is_dropship in beide beslispunten. Superset-keten:
-- élke volgende CREATE OR REPLACE moet deze volledige body als basis nemen.

CREATE OR REPLACE FUNCTION herwaardeer_combi_levering_verzendregel(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_order              orders%ROWTYPE;
  v_debiteur           debiteuren%ROWTYPE;
  v_is_dropship        BOOLEAN;
  v_moet_wachten        BOOLEAN;
  v_subtotaal          NUMERIC;
  v_moet_verzendregel   BOOLEAN;
  v_bestaande_regel_id BIGINT;
  v_regelnummer        INTEGER;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_order.status IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden') THEN
    RETURN;
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = v_order.debiteur_nr;
  IF NOT FOUND THEN RETURN; END IF;

  v_is_dropship := is_dropship_order(p_order_id);

  v_moet_wachten := v_debiteur.combi_levering
    AND NOT v_order.combi_levering_override
    AND NOT v_is_dropship;

  SELECT id INTO v_bestaande_regel_id
    FROM order_regels
   WHERE order_id = p_order_id AND artikelnr = 'VERZEND'
   LIMIT 1;

  -- Mig 574: een dropship-order krijgt via dit mechanisme NOOIT een
  -- VERZEND-regel — de dropship-kostenregel is al de verzendcomponent.
  IF v_moet_wachten OR v_order.afhalen OR v_is_dropship THEN
    IF v_bestaande_regel_id IS NOT NULL AND (v_moet_wachten OR v_order.afhalen) THEN
      DELETE FROM order_regels WHERE id = v_bestaande_regel_id;
    END IF;
    RETURN;
  END IF;

  v_subtotaal := combi_levering_orderregel_subtotaal(p_order_id);
  v_moet_verzendregel := NOT v_debiteur.gratis_verzending
    AND v_subtotaal < COALESCE(v_debiteur.verzend_drempel, 500);

  IF v_moet_verzendregel AND v_bestaande_regel_id IS NULL THEN
    SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_regelnummer
      FROM order_regels WHERE order_id = p_order_id;

    INSERT INTO order_regels (
      order_id, regelnummer, artikelnr, omschrijving,
      orderaantal, te_leveren, prijs, korting_pct, bedrag
    ) VALUES (
      p_order_id, v_regelnummer, 'VERZEND', 'Verzendkosten',
      1, 1, COALESCE(v_debiteur.verzendkosten, 0), 0, COALESCE(v_debiteur.verzendkosten, 0)
    );
  ELSIF NOT v_moet_verzendregel AND v_bestaande_regel_id IS NOT NULL THEN
    DELETE FROM order_regels WHERE id = v_bestaande_regel_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION herwaardeer_combi_levering_verzendregel(BIGINT) IS
  'Mig 558/561/562/574 (ADR-0039/0040): voegt/verwijdert de VERZEND-orderregel, '
  'Combi-levering-bewust. Idempotent. No-op op vertrokken/eindstatus-orders. '
  'NULL verzend_drempel -> 500 (SHIPPING_THRESHOLD). Mig 574: dropship-orders '
  'krijgen nooit een VERZEND-regel via dit pad (kostenregel is al verzending); '
  'een al-bestaande VERZEND-regel op een dropship-order wordt bewust niet '
  'stilzwijgend verwijderd (handmatige beoordeling).';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Test rolled-back** — dropship-order van combi-klant + klant-toggle → geen VERZEND-INSERT (query `order_regels WHERE artikelnr='VERZEND'` vóór/na). **Step 3: Pas toe. Step 4: Commit** (`fix(combi-levering): mig 574 — dropship nooit VERZEND via combi-trigger`).

---

### Task 6 — HOOG: PO-prefill kent `combi_levering` niet

**Files:**
- Modify: `frontend/src/lib/supabase/queries/po-parsing.ts:66`

- [ ] **Step 1:** Voeg in de select-string van `fetchSelectedClientVoorPrefill` achteraan toe, exact zoals [client-selector.tsx:78](frontend/src/components/orders/client-selector.tsx#L78) (de docstring eist een 1-op-1-spiegel): vervang `..., factuurvoorkeur'` door `..., factuurvoorkeur, combi_levering'`.

- [ ] **Step 2:** `cd frontend && npx tsc -b --noEmit` → OK. **Step 3: Commit** (`fix(combi-levering): po-prefill spiegelt combi_levering in client-select`).

---

### Task 7 — HOOG: vertegenwoordiger-gates op knop en toggle

Een externe rep kan nu de in-wacht-knop klikken: de RLS-policies (mig 494) filteren de UPDATEs stil naar 0 rijen, maar de RPC meldt succes en **de klant-e-mail wordt écht verstuurd**. De combi-toggle op debiteur-detail is het enige schrijf-element op die pagina zonder `{!isExternRep && ...}`-wrapper.

**Files:**
- Modify: `frontend/src/components/orders/combi-levering-in-wacht-knop.tsx:37-38,83`
- Modify: `frontend/src/modules/debiteuren/pages/debiteur-detail.tsx:742-758`

- [ ] **Step 1: Knop.** In `combi-levering-in-wacht-knop.tsx`: voeg de import + guard toe:

```tsx
import { useAuth } from '@/hooks/use-auth'
```
en in de component, direct na `const [gedaan, setGedaan] = useState(false)`:
```tsx
  // Mig 494/audit 02-07: externe vertegenwoordiger is read-only — RLS blokkeert
  // de UPDATEs stil (0 rijen), maar de klant-mail zou wél echt vertrekken.
  const { isExternRep } = useAuth()
```
en breid de bestaande verberg-conditie op regel 83 uit:
```tsx
  if (isExternRep || !data || data.debiteuren?.combi_levering || GEEN_COMBI_LEVERING_KNOP_STATUSSEN.has(data.status)) {
    return null
  }
```

- [ ] **Step 2: Toggle.** In `debiteur-detail.tsx`, in het Combi-levering-blok (regel ~742): wrap de `<button role="switch" ...>` in dezelfde conditie als de 14 andere schrijf-elementen:

```tsx
              {!isExternRep && (
                <button
                  type="button"
                  role="switch"
                  ...bestaande props ongewijzigd...
                </button>
              )}
```
(het `Aan`/`Uit`-label eronder blijft altijd zichtbaar — reps mogen de stand zien.)

- [ ] **Step 3:** `npx tsc -b --noEmit` → OK. **Step 4: Commit** (`fix(combi-levering): rep-gates op in-wacht-knop en klant-toggle`).

---

### Task 8 — HOOG/MIDDEL: teksten naar het ADR-0040-model

**Files:**
- Modify: `frontend/src/modules/logistiek/components/start-pickrondes-button.tsx:249-256`
- Modify: `frontend/src/components/orders/combi-levering-in-wacht-knop.tsx:90`

- [ ] **Step 1: Waarschuwing bij subset-start.** Vervang de twee tekstblokken in de amber-waarschuwing:

```tsx
          <p className="text-sm text-amber-800 font-medium">
            {achtergebleven.length} andere order(s) van deze Combi-levering-groep start je nu niet mee
          </p>
```
en de checkbox-label:
```tsx
            <span>Ik start deze selectie toch los — de overige order(s) vallen direct terug in de wacht (verdwijnen uit Pick &amp; Ship) totdat de groep de vrachtvrije-drempel opnieuw haalt.</span>
```
(feitelijk juist dankzij Task 2 — de oude tekst beschreef het ADR-0039-model.)

- [ ] **Step 2: Succesmelding knop.** Regel 90: vervang de claim door een feitelijk juiste:

```tsx
        Combi-levering staat nu aan voor deze klant — openstaande orders naar dit adres wachten voortaan tot de vrachtvrije-drempel gehaald is
```
(de order zelf kan immers al boven de drempel zitten; "staat nu in de wacht" was dan onjuist.)

- [ ] **Step 3:** `npx tsc -b --noEmit` → OK. **Step 4: Commit** (`fix(combi-levering): teksten volgen ADR-0040-gedrag`).

---

### Task 9 — MIDDEL: golden fixture voor `combiLeveringOverride=true`

**Files:**
- Modify: `frontend/src/lib/orders/__tests__/order-commit.fixtures.ts` (rond regel 106, naast de bestaande header-fixtures)
- Test: `frontend/src/lib/orders/__tests__/order-commit.test.ts` (bestaande runner leest de fixtures)

- [ ] **Step 1:** Voeg een fixture toe die een gemengde order (standaard + maatwerk, dus een split) met `combiLeveringOverride: true` door `bouwOrderCommit` haalt en assert dat **beide** sub-order-headers `combi_levering_override: true` dragen. Volg exact de vorm van de bestaande fixtures in dat bestand (zelfde factory + expectation-patroon).
- [ ] **Step 2:** `npx vitest run src/lib/orders/__tests__/order-commit.test.ts` → PASS (nieuwe case groen, bestaande onaangeroerd).
- [ ] **Step 3: Commit** (`test(combi-levering): golden fixture combiLeveringOverride bij order-split`).

---

### Task 10: Eindcontrole + docs

- [ ] **Step 1:** Volledige suite + typecheck:
```bash
cd frontend && npx vitest run --reporter=dot 2>&1 | tail -3 && npx tsc -b --noEmit && echo OK
```
Expected: alles groen.
- [ ] **Step 2:** Docs bijwerken: `docs/changelog.md` (entry 02-07: audit + fixes 570-574), `docs/order-lifecycle.md` (pickronde-start-cascade + deelzending-guard), CLAUDE.md-bedrijfsregel-bullet Combi-levering aanvullen met de fix-nummers. `docs/database-schema.md` alleen als kolommen wijzigden (n.v.t.).
- [ ] **Step 3: Commit** (`docs(combi-levering): changelog + order-lifecycle na pre-prod-fixes`).

---

### Task 11: Deploy-runbook (naar productie)

- [ ] **Step 1 — DB (kan vóór de merge, mig 570 is urgent):** mig 570 → 571 → 572 → 573 → 574 in die volgorde toepassen via het Supabase SQL-dashboard, elk eerst rolled-back getest (zie de tasks). 556-569 staan al live.
- [ ] **Step 2 — Nummer-collisie-check vlak vóór merge:** `git fetch && git log origin/main --oneline -5` + check dat 570-574 niet inmiddels op main bestaan; hernummer anders (geheugen-regel).
- [ ] **Step 3 — Merge naar main** via push van de branch naar origin (`git push origin feat/combi-levering:main` ná fast-forward-verificatie, of regulier merge-commando volgens de CLAUDE.md-git-workflow). Vercel deployt de frontend automatisch — **niet** ook handmatig deployen.
- [ ] **Step 4 — Edge function:** `supabase functions deploy stuur-orderbevestiging --project-ref wqzeevfobwauxkalagtn` (enige function met gewijzigde `_shared`-afhankelijkheden: `combi-levering-tekst.ts` + `orderbevestiging-pdf.ts`).
- [ ] **Step 5 — Handmatige verificatie (alleen-mens):**
  - Échte testmail van een wachtende order → 4-talige wacht-paragraaf zichtbaar in mail + PDF.
  - Pick & Ship met de testgroep: beide orders zichtbaar zodra drempel gehaald; subset starten → waarschuwing → achterblijver verdwijnt direct; deelzending-knop onzichtbaar op een wachtende order.
  - Als externe rep (incognito): geen toggle op klantkaart, geen in-wacht-knop.
- [ ] **Step 6 — Rollback-route (mocht het misgaan):** feature is data-gedreven — zet `debiteuren.combi_levering = FALSE` voor alle klanten (de triggers herstellen status + VERZEND-regels automatisch). De enum-waarde kan niet verwijderd worden maar is dan onbereikbaar en onschadelijk.

---

## Bewust buiten scope (vervolgtickets, geen prod-blokkers)

- Performance-indexen op de view (`debiteuren.combi_levering`-partial, functionele adres-norm-index) — huidige volumes (handvol combi-klanten) rechtvaardigen dit nog niet.
- `zet_order_in_combi_levering_wacht` naar het SECURITY DEFINER-patroon — SECURITY INVOKER is hier mét RLS juist veiliger; gedocumenteerd, niet gewijzigd.
- PDF-opmaak van de wacht-paragraaf (visuele nadruk) — cosmetisch.
- View-laag-contracttest voor de mig 566-guard — vereist DB-fixtures; de SQL-verificaties in Task 1/2 dekken het gedrag nu; structurele testinfra is een eigen klus.
- Badge tonen voor al-vertrokken groepsleden (mig 569 nam ze impliciet mee; na Task 1 toont de badge alleen actieve leden — als Miguel vertrokken leden in de badge wil, is dat een aparte, bewuste view-uitbreiding).
