# Combi-levering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klanten met de instelling "Combi-levering" laten hun onder-de-drempel-orders wachten met verzenden totdat het cumulatieve totaal van hun openstaande orders naar hetzelfde adres de vrachtvrije-drempel bereikt, en dan gezamenlijk in 1 zending verzenden.

**Architecture:** Zie [ADR-0039](../adr/0039-combi-levering-als-startbaarheid-gate.md). Kernpunt: dit is een extra blokkerende reden in de Startbaarheid-ladder (ADR-0037), géén nieuwe order-status en géén nieuwe bundel-mechaniek — de bestaande Bundel-Zending-groepering (`start_pickronden`, mig 403's verzendweek-clamp) bundelt vrijgegeven leden automatisch zodra ze samen gestart worden. Twee nieuwe booleans (`debiteuren.combi_levering`, `orders.combi_levering_override`), één nieuwe live SQL-view (`combi_levering_status`, naar het patroon van `voorgestelde_zending_bundels`/mig 229), en één nieuwe trigger-functie die de VERZEND-orderregel op het juiste moment toevoegt/verwijdert.

**Tech Stack:** Supabase Postgres (migraties, triggers, views), React/TypeScript (frontend, Vitest), Deno edge functions (orderbevestiging).

---

## Belangrijke voorwaarden vóór je begint

1. **Migratienummers zijn tentatief (485-488).** Dit project heeft een historie van migratienummer-collisies bij het mergen van parallelle branches (zie `docs/adr/` changelog-noten en projectmemo's). Controleer vóór het aanmaken van elk migratiebestand het hoogste nummer in `supabase/migrations/` op de live/`main`-branch en hernummer indien nodig — de inhoud van de migraties hieronder blijft ongewijzigd, alleen het bestandsnummer kan schuiven.
2. **Werk in de git-worktree `.worktrees/combi-levering` op branch `feat/combi-levering`** (al aangemaakt, gebaseerd op `main`). Commit daar; merge pas op expliciet commando.
3. **`ALTER TABLE`/`CREATE OR REPLACE FUNCTION`/`CREATE OR REPLACE VIEW`-migraties in dit plan zijn zorgvuldig ontworpen naar de bestaande patronen in deze codebase, maar niet tegen de live database getest** (deze sessie had geen DB-toegang). Elke migratie-taak heeft daarom een expliciete "test in een rolled-back transactie tegen de live DB"-stap — sla die niet over, dat is hier de eerste echte correctheids-check.
4. **Volgorde is belangrijk maar niet strikt sequentieel per Fase.** Fase 1 (Taken 1-8) is de kern: na afronding wacht een Combi-levering-order echt, en start hij pas samen met de rest van zijn groep. Fase 2 (Taken 9-11) is communicatie/operator-comfort — bouwt bovenop Fase 1, maar levert los toetsbare waarde op.

---

## Fase 1 — Datamodel + Startbaarheid-gate (kernmechanisme)

### Task 1: Migratie — nieuwe kolommen `debiteuren.combi_levering` + `orders.combi_levering_override`

**Files:**
- Create: `supabase/migrations/485_combi_levering_kolommen.sql`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 485: Combi-levering — twee nieuwe booleans (ADR-0039)
--
-- `debiteuren.combi_levering`: klant-instelling — wacht met verzenden tot de
-- gecombineerde openstaande orders naar hetzelfde adres de vrachtvrije-drempel
-- (verzend_drempel) bereiken, i.p.v. direct verzendkosten te rekenen op een
-- individuele order onder de drempel.
-- `orders.combi_levering_override`: order-niveau escape — klant wil dít
-- exemplaar toch los verzonden, met verzendkosten, ongeacht de klant-instelling.
--
-- Zie ADR-0039 (docs/adr/0039-combi-levering-als-startbaarheid-gate.md).

ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS combi_levering BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN debiteuren.combi_levering IS
  'Mig 485 (ADR-0039): klant wil wachten met verzenden tot de gecombineerde '
  'openstaande orders naar hetzelfde adres de vrachtvrije-drempel '
  '(verzend_drempel) bereiken. No-op als gratis_verzending al TRUE is.';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS combi_levering_override BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN orders.combi_levering_override IS
  'Mig 485 (ADR-0039): klant wil dít exemplaar toch los verzonden, met '
  'verzendkosten, ongeacht debiteuren.combi_levering. Analoog aan afhalen '
  '(mig 204) — instelbaar in het order-form.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Test in een rolled-back transactie tegen de live DB**

Via Supabase SQL-editor of `psql`:
```sql
BEGIN;
  \i supabase/migrations/485_combi_levering_kolommen.sql
  SELECT combi_levering FROM debiteuren LIMIT 1;
  SELECT combi_levering_override FROM orders LIMIT 1;
ROLLBACK;
```
Verwacht: beide SELECTs geven `false` terug voor bestaande rijen, geen fouten.

- [ ] **Step 3: Apply op de live DB en commit**

```bash
git add supabase/migrations/485_combi_levering_kolommen.sql
git commit -m "feat(combi-levering): kolommen debiteuren.combi_levering + orders.combi_levering_override"
```

---

### Task 2: Migratie — subtotaal-helper + view `combi_levering_status`

**Files:**
- Create: `supabase/migrations/486_combi_levering_status_view.sql`

Deze view is de nieuwe, live afgeleide bron voor "moet deze order wachten op zijn Combi-levering-groep". Groepeert op `(debiteur_nr, adres-norm)` — **zonder** vervoerder/verzendweek (anders dan de Bundel-Zending-sleutel, mig 228): het punt van deze feature is juist over meerdere weken heen te wachten.

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 486: Combi-levering-wachtgroep — live view (ADR-0039)
--
-- Puur lezend, geen state — herevalueert bij elke query, net als
-- voorgestelde_zending_bundels (mig 229). Sleutel is (debiteur_nr, adres-norm),
-- bewust zónder vervoerder/verzendweek: het punt is juist over meerdere weken
-- heen te wachten, en de vervoerder is sowieso een afgeleide van adres/gewicht
-- (land-gedreven selectieregels, ADR-0030) die pas bij pickronde-start
-- opnieuw bepaald wordt voor de dan-bekende gecombineerde zending.

CREATE OR REPLACE FUNCTION combi_levering_orderregel_subtotaal(p_order_id BIGINT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  -- Zelfde uitsluiting als voorgestelde_zending_bundels.bundel_subtotaal_excl
  -- (mig 229, regel ~90): VERZEND-pseudo-regel telt niet mee in de klantwaarde.
  SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
    FROM order_regels
   WHERE order_id = p_order_id
     AND COALESCE(artikelnr, '') <> 'VERZEND'
     AND COALESCE(orderaantal, 0) > 0;
$$;

COMMENT ON FUNCTION combi_levering_orderregel_subtotaal(BIGINT) IS
  'Mig 486: order-subtotaal excl. VERZEND, voor de Combi-levering-drempeltoets. '
  'Zelfde exclusie als voorgestelde_zending_bundels (mig 229) — geen tweede '
  'canonieke berekening.';

CREATE OR REPLACE VIEW combi_levering_status AS
WITH leden AS (
  -- Alle orders die ÜBERHAUPT in een Combi-levering-wachtgroep kunnen zitten:
  -- klant heeft de instelling aan, dit exemplaar is niet overruled, en het is
  -- geen dropshipment (die betaalt al voor eigen verzending, ADR-0018-patroon).
  SELECT
    o.id                                                               AS order_id,
    o.debiteur_nr,
    _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land) AS adres_norm,
    COALESCE(op.alle_regels_pickbaar, FALSE)                          AS alle_regels_pickbaar,
    combi_levering_orderregel_subtotaal(o.id)                         AS subtotaal
  FROM orders o
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  LEFT JOIN order_pickbaarheid op ON op.order_id = o.id
 WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
   AND o.combi_levering_override = FALSE
   AND d.combi_levering = TRUE
   AND NOT is_dropship_order(o.id)
),
groep AS (
  SELECT
    debiteur_nr,
    adres_norm,
    SUM(subtotaal)                 AS groep_subtotaal,
    bool_and(alle_regels_pickbaar) AS alle_leden_pickbaar
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
      (d.verzend_drempel IS NOT NULL AND g.groep_subtotaal < d.verzend_drempel)
      OR NOT g.alle_leden_pickbaar
    )
  ) AS wacht_op_combi_levering
FROM leden l
JOIN groep g ON g.debiteur_nr = l.debiteur_nr AND g.adres_norm = l.adres_norm
JOIN debiteuren d ON d.debiteur_nr = l.debiteur_nr;

COMMENT ON VIEW combi_levering_status IS
  'Mig 486 (ADR-0039): per order, alleen voor klanten met combi_levering=TRUE '
  'en niet-overruled/niet-dropshipment orders: wacht_op_combi_levering=TRUE '
  'zolang de (debiteur × adres-norm)-groep de vrachtvrije-drempel niet haalt, '
  'OF de drempel wel haalt maar niet al zijn leden individueel pickbaar zijn '
  '(ADR-0012-les: een groep die de drempel haalt wordt als 1 order behandeld, '
  'nooit deels los verzonden). Orders die niet in deze view voorkomen (want '
  'geen match op de WHERE in leden) zijn nooit geblokkeerd door Combi-levering '
  '— consumenten moeten LEFT JOIN + COALESCE(..., FALSE) gebruiken.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Test in een rolled-back transactie tegen de live DB**

```sql
BEGIN;
  \i supabase/migrations/485_combi_levering_kolommen.sql
  \i supabase/migrations/486_combi_levering_status_view.sql

  -- Fabriceer 2 orders van dezelfde klant naar hetzelfde adres, elk onder de
  -- drempel; zet combi_levering=TRUE; controleer dat allebei wacht_op_combi_levering=TRUE
  -- tonen zolang de som onder de drempel blijft, en beide FALSE zodra de som
  -- de drempel haalt EN alle_regels_pickbaar=TRUE voor beide.
  SELECT debiteur_nr, verzend_drempel FROM debiteuren WHERE verzend_drempel IS NOT NULL LIMIT 1;
  -- (kies een bestaande debiteur/order-paar uit de live data, of INSERT een
  -- testorder in dezelfde transactie, en vergelijk combi_levering_status.)
ROLLBACK;
```
Verwacht: `wacht_op_combi_levering` volgt exact de hierboven beschreven logica; geen fouten.

- [ ] **Step 3: Apply op de live DB en commit**

```bash
git add supabase/migrations/486_combi_levering_status_view.sql
git commit -m "feat(combi-levering): view combi_levering_status + subtotaal-helper"
```

---

### Task 3: Migratie — VERZEND-orderregel op het juiste moment (trigger)

**Files:**
- Create: `supabase/migrations/487_combi_levering_verzendregel_trigger.sql`

Kern van Anchor 5 uit ADR-0039: zolang een order wacht, komt er **geen** VERZEND-orderregel op te staan (die beslissing wordt uitgesteld). Zodra `orders.combi_levering_override` of `debiteuren.combi_levering` van waarde verandert, wordt die order (of alle open orders van de klant) herwaardeerd — exact de regel die `applyShippingLogic` client-side al toepast, alleen nu ook server-side getriggerd op deze twee momenten.

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 487: Combi-levering — VERZEND-orderregel-herwaardering (ADR-0039)
--
-- Zolang een order in een Combi-levering-wachtgroep zit, staat er GEEN
-- VERZEND-orderregel op — de drempel-beslissing wordt uitgesteld tot vrijgave.
-- Twee transitiemomenten kunnen dat veranderen:
--   1. orders.combi_levering_override wijzigt (klant wil dít exemplaar toch
--      los, of een eerder geforceerde order gaat weer wachten).
--   2. debiteuren.combi_levering wijzigt (klant zet de instelling aan/uit —
--      raakt ALLE openstaande orders van die klant, niet alleen de order
--      waarop de wijziging is getriggerd).
-- Buiten deze twee momenten verandert er niets: de normale, groepsgewijze
-- drempel-toets bij vrijgave/facturatie (bestaande verzendkosten_voor_bundel,
-- mig 234) blijft ongewijzigd en ongeraakt.

CREATE OR REPLACE FUNCTION herwaardeer_combi_levering_verzendregel(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_order              orders%ROWTYPE;
  v_debiteur           debiteuren%ROWTYPE;
  v_moet_wachten        BOOLEAN;
  v_subtotaal          NUMERIC;
  v_moet_verzendregel   BOOLEAN;
  v_bestaande_regel_id BIGINT;
  v_regelnummer        INTEGER;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = v_order.debiteur_nr;
  IF NOT FOUND THEN RETURN; END IF;

  v_moet_wachten := v_debiteur.combi_levering
    AND NOT v_order.combi_levering_override
    AND NOT is_dropship_order(p_order_id);

  SELECT id INTO v_bestaande_regel_id
    FROM order_regels
   WHERE order_id = p_order_id AND artikelnr = 'VERZEND'
   LIMIT 1;

  IF v_moet_wachten OR v_order.afhalen THEN
    -- Wachten (drempel-beslissing uitgesteld) of afhalen (nooit VERZEND):
    -- een eventuele bestaande VERZEND-regel moet weg.
    IF v_bestaande_regel_id IS NOT NULL THEN
      DELETE FROM order_regels WHERE id = v_bestaande_regel_id;
    END IF;
    RETURN;
  END IF;

  -- Normaal pad (override=TRUE, of combi_levering=FALSE): zelfde regel als
  -- frontend applyShippingLogic — voeg toe/verwijder op basis van het eigen
  -- ordersubtotaal t.o.v. de klant-drempel.
  v_subtotaal := combi_levering_orderregel_subtotaal(p_order_id);
  v_moet_verzendregel := NOT v_debiteur.gratis_verzending
    AND v_subtotaal < COALESCE(v_debiteur.verzend_drempel, 0);

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
  'Mig 487 (ADR-0039): voegt/verwijdert de VERZEND-orderregel op een order, '
  'rekening houdend met of de klant/order in een Combi-levering-wachtgroep '
  'zit. Idempotent — aanroepbaar vanuit triggers en handmatig.';

CREATE OR REPLACE FUNCTION trg_orders_combi_levering_override_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.combi_levering_override IS DISTINCT FROM OLD.combi_levering_override THEN
    PERFORM herwaardeer_combi_levering_verzendregel(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_combi_levering_override ON orders;
CREATE TRIGGER trg_orders_combi_levering_override
  AFTER UPDATE OF combi_levering_override ON orders
  FOR EACH ROW
  EXECUTE FUNCTION trg_orders_combi_levering_override_fn();

CREATE OR REPLACE FUNCTION trg_debiteuren_combi_levering_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_id BIGINT;
BEGIN
  IF NEW.combi_levering IS DISTINCT FROM OLD.combi_levering THEN
    FOR v_order_id IN
      SELECT id FROM orders
       WHERE debiteur_nr = NEW.debiteur_nr
         AND status NOT IN ('Verzonden', 'Geannuleerd')
    LOOP
      PERFORM herwaardeer_combi_levering_verzendregel(v_order_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debiteuren_combi_levering ON debiteuren;
CREATE TRIGGER trg_debiteuren_combi_levering
  AFTER UPDATE OF combi_levering ON debiteuren
  FOR EACH ROW
  EXECUTE FUNCTION trg_debiteuren_combi_levering_fn();

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Test in een rolled-back transactie tegen de live DB**

```sql
BEGIN;
  \i supabase/migrations/485_combi_levering_kolommen.sql
  \i supabase/migrations/486_combi_levering_status_view.sql
  \i supabase/migrations/487_combi_levering_verzendregel_trigger.sql

  -- Kies een bestaande, kleine order (subtotaal < verzend_drempel van zijn klant).
  -- 1) UPDATE debiteuren SET combi_levering = TRUE WHERE debiteur_nr = <die klant>;
  --    → order_regels voor die order mag GEEN VERZEND-regel (meer) hebben.
  -- 2) UPDATE orders SET combi_levering_override = TRUE WHERE id = <die order>;
  --    → order_regels moet nu WEL een VERZEND-regel hebben (subtotaal < drempel).
  -- 3) UPDATE orders SET combi_levering_override = FALSE WHERE id = <die order>;
  --    → VERZEND-regel moet weer verdwijnen (combi_levering staat nog aan op de klant).
ROLLBACK;
```
Verwacht: order_regels-VERZEND-rij verschijnt/verdwijnt exact zoals hierboven beschreven bij elke stap, geen fouten.

- [ ] **Step 3: Apply op de live DB en commit**

```bash
git add supabase/migrations/487_combi_levering_verzendregel_trigger.sql
git commit -m "feat(combi-levering): trigger voegt/verwijdert VERZEND-regel bij override/instelling-wissel"
```

---

### Task 4: `startbaarheid.ts` — nieuwe status `wacht_op_combi_levering`

**Files:**
- Modify: `frontend/src/modules/logistiek/lib/startbaarheid.ts`
- Test: `frontend/src/modules/logistiek/lib/startbaarheid.test.ts`

- [ ] **Step 1: Schrijf de falende tests**

Voeg `wacht_op_combi_levering: false` toe aan de `input()`-baseline (net na `geen_vervoerder: false`), en voeg deze tests toe (na de bestaande "geen_vervoerder is de laagste blokkade"-test):

```ts
it('wacht op combi-levering → wacht_op_combi_levering', () => {
  expect(status({ wacht_op_combi_levering: true })).toBe('wacht_op_combi_levering')
})

it('geen_vervoerder wint van wacht_op_combi_levering', () => {
  expect(
    status({ geen_vervoerder: true, wacht_op_combi_levering: true })
  ).toBe('geen_vervoerder')
})

it('wacht_op_combi_levering wint van startbaar (laagste prioriteit vóór startbaar)', () => {
  expect(status({ wacht_op_combi_levering: true })).not.toBe('startbaar')
})
```

- [ ] **Step 2: Run tests, verwacht FAIL**

Run: `npx vitest run frontend/src/modules/logistiek/lib/startbaarheid.test.ts`
Expected: FAIL — `wacht_op_combi_levering` bestaat nog niet op `StartbaarheidInput`, TypeScript-compilefout of `toBe('startbaar')` (want de ladder kent de nieuwe status nog niet).

- [ ] **Step 3: Implementeer de ladder-uitbreiding**

In `startbaarheid.ts`, voeg toe aan de `StartStatus`-union (na `geen_vervoerder`):
```ts
  | 'geen_vervoerder' // niet-afhaal + geen matchende actieve vervoerder (mig 373)
  | 'wacht_op_combi_levering' // klant wacht op vrachtvrije-drempel over meerdere orders (ADR-0039)
```

Voeg toe aan `StartbaarheidInput` (na `geen_vervoerder: boolean`):
```ts
  /** Mig 486/ADR-0039: de Combi-levering-wachtgroep van deze order (indien de
   *  klant de instelling aan heeft) heeft de drempel nog niet gehaald, of heeft
   *  ≥1 lid dat nog niet pickbaar is. */
  wacht_op_combi_levering: boolean
```

Voeg de nieuwe branch toe in `bepaalStartbaarheid` (tussen `geen_vervoerder` en de `else`):
```ts
  else if (o.geen_vervoerder) status = 'geen_vervoerder'
  else if (o.wacht_op_combi_levering) status = 'wacht_op_combi_levering'
  else status = 'startbaar'
```

- [ ] **Step 4: Run tests, verwacht PASS**

Run: `npx vitest run frontend/src/modules/logistiek/lib/startbaarheid.test.ts`
Expected: PASS, alle tests groen (incl. de bestaande).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/logistiek/lib/startbaarheid.ts frontend/src/modules/logistiek/lib/startbaarheid.test.ts
git commit -m "feat(combi-levering): wacht_op_combi_levering als laagste Startbaarheid-blokkade"
```

---

### Task 5: `PickShipOrder` + `use-pickbaarheid.ts` + query-wiring

**Files:**
- Modify: `frontend/src/modules/magazijn/lib/types.ts`
- Modify: `frontend/src/modules/magazijn/queries/pickbaarheid.ts`
- Modify: `frontend/src/modules/logistiek/hooks/use-pickbaarheid.ts`
- Test: `frontend/src/modules/logistiek/hooks/use-pickbaarheid.test.tsx` (bestaand karakteriseringstest-bestand, per project-conventie uitbreiden)

- [ ] **Step 1: Voeg het veld toe aan `PickShipOrder`**

In `frontend/src/modules/magazijn/lib/types.ts`, na het `prijs_ontbreekt_sinds`-veld (regel 89) en vóór `actieve_pickronde`:
```ts
  /** Mig 486/ADR-0039: TRUE zolang deze order in een Combi-levering-wachtgroep
   *  zit die de vrachtvrije-drempel nog niet gehaald heeft, of waarvan niet
   *  alle leden al pickbaar zijn. FALSE voor klanten zonder de instelling,
   *  dropshipment-orders, en orders met combi_levering_override=true. */
  wacht_op_combi_levering: boolean
```

- [ ] **Step 2: Voeg de fetch toe in `pickbaarheid.ts`**

Voeg na `fetchOrderPickbaarheid` (rond regel 288) een nieuwe functie toe, naar exact hetzelfde chunk-patroon:
```ts
async function fetchCombiLeveringStatus(
  orderIds: number[]
): Promise<Map<number, boolean>> {
  const map = new Map<number, boolean>()
  for (const ids of chunks(orderIds, 100)) {
    const { data, error } = await supabase
      .from('combi_levering_status')
      .select('order_id, wacht_op_combi_levering')
      .in('order_id', ids)
    if (error) throw error
    for (const row of (data ?? []) as Array<{ order_id: number; wacht_op_combi_levering: boolean }>) {
      map.set(row.order_id, row.wacht_op_combi_levering)
    }
  }
  return map
}
```

Wire 'm in `fetchPickShipOrders` (na de bestaande `fetchOrderPickbaarheid`-call op regel 52, en de vulling op regels 73-79):
```ts
  const orderPickbaarheid = await fetchOrderPickbaarheid(headers.map((h) => h.id))
  const combiLeveringStatus = await fetchCombiLeveringStatus(headers.map((h) => h.id))
```
en in de vul-loop (regels 73-79), voeg toe:
```ts
  for (const [orderId, opb] of orderPickbaarheid) {
    const order = perOrder.get(orderId)
    if (order) {
      order.alle_regels_pickbaar = opb.alle_regels_pickbaar
      order.heeft_gepland_zending = opb.heeft_gepland_zending
      order.wacht_op_combi_levering = combiLeveringStatus.get(orderId) ?? false
    }
  }
```

Controleer ook `initPickShipOrders` in `pick-ship-transform.ts` — die bouwt de initiële `PickShipOrder`-objecten met defaults; voeg daar `wacht_op_combi_levering: false` toe aan de default-object-literal (zelfde plek als `alle_regels_pickbaar: false`/`heeft_gepland_zending: false` nu staan).

- [ ] **Step 3: Wire door in `use-pickbaarheid.ts`**

In de `bepaalStartbaarheid(...)`-aanroep binnen de loop (rond regel 66-76), voeg toe:
```ts
  bepaalStartbaarheid({
    order_id: o.order_id,
    afhalen: o.afhalen,
    alle_regels_pickbaar: o.alle_regels_pickbaar,
    heeft_gepland_zending: o.heeft_gepland_zending,
    afl_adres_incompleet_sinds: o.afl_adres_incompleet_sinds,
    prijs_ontbreekt_sinds: o.prijs_ontbreekt_sinds,
    in_pickronde: o.actieve_pickronde !== null,
    geen_vervoerder: heeftGeenVervoerder(o.afhalen, regels),
    wacht_op_combi_levering: o.wacht_op_combi_levering,
  }).status,
```

Voeg in `PickbaarheidResultaat` (regels 24-40) een nieuw derived veld toe, naar het bestaande `geenVervoerderIds`/`aantalGeenVervoerder`-patroon:
```ts
  wachtOpCombiLeveringIds: Set<number>
  aantalWachtOpCombiLevering: number
```
en vul die in dezelfde reduce-pass (regels 90-100) en retourneer ze mee in de uiteindelijke `PickbaarheidResultaat` (regels 105-119), consistent met de bestaande drie tegenhangers.

- [ ] **Step 4: Run bestaande tests, verwacht PASS (regressie-check)**

Run: `npx vitest run frontend/src/modules/logistiek/hooks/use-pickbaarheid.test.tsx frontend/src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts`
Expected: PASS — dit is een additieve wijziging (nieuw veld, default `false`), bestaand gedrag verandert niet.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/magazijn/lib/types.ts frontend/src/modules/magazijn/queries/pickbaarheid.ts frontend/src/modules/logistiek/hooks/use-pickbaarheid.ts
git commit -m "feat(combi-levering): PickShipOrder + usePickbaarheid lezen combi_levering_status"
```

---

### Task 6: Klant-instelling — toggle op debiteur-detail

**Files:**
- Modify: `frontend/src/modules/debiteuren/queries/debiteuren.ts`
- Modify: `frontend/src/modules/debiteuren/pages/debiteur-detail.tsx`

- [ ] **Step 1: Voeg het veld toe aan `DebiteurDetail`**

In `frontend/src/modules/debiteuren/queries/debiteuren.ts`, na `tapijt_sticker_bij_standaard: boolean` (regel 67):
```ts
  /** Mig 485/ADR-0039: klant wil wachten met verzenden tot de gecombineerde
   *  openstaande orders naar hetzelfde adres de vrachtvrije-drempel bereiken. */
  combi_levering: boolean
```
Geen wijziging nodig aan `fetchDebiteurDetail` zelf — die doet `select('*')`, het nieuwe veld komt automatisch mee.

- [ ] **Step 2: Voeg de mutation + toggle toe op debiteur-detail**

In `frontend/src/modules/debiteuren/pages/debiteur-detail.tsx`, naast de bestaande `tapijtStickerMutation` (regels 173-185), voeg toe:
```ts
const combiLeveringMutation = useMutation({
  mutationFn: async (newValue: boolean) => {
    const { error } = await supabase
      .from('debiteuren')
      .update({ combi_levering: newValue })
      .eq('debiteur_nr', debiteurNr)
    if (error) throw error
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
  },
  onError: showError('Combi-levering'),
})
```

In de "Leveringen"-sectie (naast de `tapijt_sticker_bij_standaard`-toggle, regels 667-691), voeg een identiek gevormde toggle toe:
```tsx
{/* Combi-levering — mig 485/ADR-0039 */}
<div>
  <div className="text-xs text-slate-400 mb-1">Combi-levering (wacht op vrachtvrije drempel)</div>
  <div className="flex items-center gap-3">
    <button
      type="button"
      role="switch"
      aria-checked={klant.combi_levering}
      onClick={() => combiLeveringMutation.mutate(!klant.combi_levering)}
      disabled={combiLeveringMutation.isPending}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 disabled:opacity-50 ${
        klant.combi_levering ? 'bg-terracotta-500' : 'bg-slate-300'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
        klant.combi_levering ? 'translate-x-4' : 'translate-x-0.5'
      }`} />
    </button>
    <span className="text-slate-700">
      {klant.combi_levering ? 'Aan' : 'Uit'}
    </span>
  </div>
</div>
```

- [ ] **Step 3: Handmatige verificatie**

Start de dev-server (`npm run dev` in `frontend/`), open een klant-detail-pagina, klik de nieuwe toggle aan/uit, controleer in de Supabase-tabel-editor dat `debiteuren.combi_levering` meewisselt en dat de trigger uit Task 3 (indien die klant open orders heeft) de VERZEND-regels van die orders bijwerkt.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/debiteuren/queries/debiteuren.ts frontend/src/modules/debiteuren/pages/debiteur-detail.tsx
git commit -m "feat(combi-levering): klant-instelling toggle op debiteur-detail"
```

---

### Task 7: Order-form — `combi_levering_override`-toggle + `applyShippingLogic`-uitzondering

**Files:**
- Modify: `frontend/src/lib/orders/verzend-regel.ts`
- Modify: `frontend/src/lib/orders/__tests__/verzend-regel.test.ts`
- Modify: `frontend/src/lib/supabase/queries/order-mutations.ts`
- Modify: `frontend/src/components/orders/order-form.tsx`

- [ ] **Step 1: Schrijf de falende test voor de nieuwe uitzondering**

In `frontend/src/lib/orders/__tests__/verzend-regel.test.ts`, voeg toe (naast de bestaande dropship-test):
```ts
it('voegt geen VERZEND-regel toe zolang de klant op combi-levering wacht', () => {
  const regels: OrderRegelFormData[] = [
    { artikelnr: 'ART1', omschrijving: 'Test', orderaantal: 1, te_leveren: 1, prijs: 50, korting_pct: 0, bedrag: 50 },
  ]
  const client: KlantVerzendInfo = { gratis_verzending: false, verzendkosten: 15, verzend_drempel: 500 }
  const result = applyShippingLogic(regels, client, false, { wachtOpCombiLevering: true })
  expect(result.some((l) => l.artikelnr === 'VERZEND')).toBe(false)
})

it('voegt VERZEND-regel gewoon toe als de order een combi-levering-override heeft', () => {
  const regels: OrderRegelFormData[] = [
    { artikelnr: 'ART1', omschrijving: 'Test', orderaantal: 1, te_leveren: 1, prijs: 50, korting_pct: 0, bedrag: 50 },
  ]
  const client: KlantVerzendInfo = { gratis_verzending: false, verzendkosten: 15, verzend_drempel: 500 }
  const result = applyShippingLogic(regels, client, false, { wachtOpCombiLevering: false })
  expect(result.some((l) => l.artikelnr === 'VERZEND')).toBe(true)
})
```

- [ ] **Step 2: Run tests, verwacht FAIL**

Run: `npx vitest run frontend/src/lib/orders/__tests__/verzend-regel.test.ts`
Expected: FAIL — `applyShippingLogic` heeft nog geen 4e parameter.

- [ ] **Step 3: Implementeer de uitzondering**

In `frontend/src/lib/orders/verzend-regel.ts`, breid de signatuur uit:
```ts
export interface CombiLeveringOptions {
  /** TRUE zolang deze order op zijn Combi-levering-wachtgroep wacht — geen
   *  VERZEND-regel toevoegen, de beslissing wordt uitgesteld tot vrijgave. */
  wachtOpCombiLevering: boolean
}

export function applyShippingLogic(
  regels: OrderRegelFormData[],
  client: KlantVerzendInfo | null,
  afhalen: boolean,
  combiLevering: CombiLeveringOptions = { wachtOpCombiLevering: false },
): OrderRegelFormData[] {
  if (heeftDropshipRegel(regels) || afhalen) {
    return regels.filter((l) => l.artikelnr !== SHIPPING_PRODUCT_ID)
  }

  if (combiLevering.wachtOpCombiLevering) {
    // ADR-0039: de drempel-beslissing wordt uitgesteld tot de Combi-levering-
    // groep de drempel haalt (of de klant expliciet overrult) — geen
    // voorlopige VERZEND-regel die later weer verwijderd moet worden.
    return regels.filter((l) => l.artikelnr !== SHIPPING_PRODUCT_ID)
  }

  const subtotaal = regels
    // ... (ongewijzigd, rest van de functie blijft exact zoals het was)
```
(De rest van de functie-body — vanaf `const subtotaal = ...` t/m het einde — blijft ongewijzigd; alleen de signatuur en de nieuwe vroege `if`-tak zijn toegevoegd.)

- [ ] **Step 4: Run tests, verwacht PASS**

Run: `npx vitest run frontend/src/lib/orders/__tests__/verzend-regel.test.ts`
Expected: PASS.

- [ ] **Step 5: Voeg het order-niveau-veld toe aan `OrderFormData`**

In `frontend/src/lib/supabase/queries/order-mutations.ts`, na `afhalen?: boolean` (regel 31):
```ts
  /** Klant wil dít exemplaar toch los verzonden, met verzendkosten, ongeacht
   *  debiteuren.combi_levering. Mig 485/ADR-0039. */
  combi_levering_override?: boolean
```

In `createOrder()`'s `p_order`-literal, na `afhalen: order.afhalen ?? false,` (regel 204):
```ts
  combi_levering_override: order.combi_levering_override ?? false,
```
(`updateOrderWithLines` hoeft niet aangepast — die forwardt `header` in zijn geheel, zie Task 8.)

- [ ] **Step 6: Voeg de toggle toe in `order-form.tsx`**

Naast de bestaande `afhalen`-state (regel 89):
```ts
const [combiLeveringOverride, setCombiLeveringOverride] = useState<boolean>(
  initialData?.header?.combi_levering_override ?? false
)
```

Naast de `afhalen`-checkbox (regels 859-867), alleen zichtbaar als de gekozen klant `combi_levering=true` heeft (anders is de toggle betekenisloos):
```tsx
{client?.combi_levering && (
  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
    <input
      type="checkbox"
      checked={combiLeveringOverride}
      onChange={(e) => setCombiLeveringOverride(e.target.checked)}
      className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
    />
    Deze order toch los verzenden (met verzendkosten indien onder de drempel)
  </label>
)}
```
(`client.combi_levering` moet aan `SelectedClient`/`OrderFormData`-invoer worden toegevoegd — zie Task 8.)

Neem `combiLeveringOverride` mee in de header-payload vóór submit (naast de bestaande `afhalen` in de object-literal rond regels 575-578) en geef 'm door aan `applyShippingLogic` (in `handleAfhalenToggle`/waar de regels anders herberekend worden) als vierde argument `{ wachtOpCombiLevering: !!client?.combi_levering && !combiLeveringOverride }`.

- [ ] **Step 7: Run de volledige testsuite van de order-module, verwacht PASS**

Run: `npx vitest run frontend/src/lib/orders frontend/src/components/orders`
Expected: PASS, geen regressie op bestaande order-form-tests.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/orders/verzend-regel.ts frontend/src/lib/orders/__tests__/verzend-regel.test.ts frontend/src/lib/supabase/queries/order-mutations.ts frontend/src/components/orders/order-form.tsx
git commit -m "feat(combi-levering): order-form override-toggle + applyShippingLogic-uitzondering"
```

---

### Task 8: `create_order_with_lines`/`update_order_with_lines` — `combi_levering_override` in de RPC-laag

**Files:**
- Create: `supabase/migrations/488_combi_levering_override_rpc.sql`
- Modify: `frontend/src/components/orders/client-selector.tsx`
- Modify: `frontend/src/lib/supabase/queries/order-mutations.ts` (`fetchClientCommercialData`)
- Modify: `frontend/src/pages/orders/order-edit.tsx`

- [ ] **Step 1: Zoek de huidige, hoogst-genummerde definitie van beide RPC's**

Voordat je de migratie schrijft: `grep -rl "CREATE OR REPLACE FUNCTION.*create_order_with_lines(" supabase/migrations/` en idem voor `update_order_with_lines(` — neem de **hoogst-genummerde** treffer (op het moment van dit plan is dat mig 481, "order vereist prijslijst") en kopieer die volledige functie-body 1-op-1 als basis. Voeg daarin, naar het patroon van mig 204's `afhalen`-kolom (zie ADR-0039 Anchor 1 en het onderzoek in deze sessie):

Voor `create_order_with_lines`, in de INSERT-kolomlijst en waarde-lijst:
```sql
  combi_levering_override,
  -- ... overige kolommen ongewijzigd ...
```
```sql
  COALESCE((p_order->>'combi_levering_override')::BOOLEAN, false),
  -- ... overige waarden ongewijzigd ...
```

Voor `update_order_with_lines`, in de `UPDATE ... SET`-lijst:
```sql
  combi_levering_override = CASE
    WHEN p_header ? 'combi_levering_override'
      THEN COALESCE((p_header->>'combi_levering_override')::BOOLEAN, false)
    ELSE combi_levering_override
  END,
```

- [ ] **Step 2: Schrijf de migratie**

```sql
-- Migratie 488: combi_levering_override door in create/update_order_with_lines
-- (ADR-0039). CREATE OR REPLACE bevat de VOLLEDIGE, actuele body van beide
-- functies (hoogst-genummerde migratie vóór deze — controleer bij het
-- schrijven welke dat is) plus de twee toevoegingen uit Step 1 hierboven.
--
-- <<VOLLEDIGE FUNCTIE-BODY VAN create_order_with_lines HIER, MET DE TOEVOEGING>>
--
-- <<VOLLEDIGE FUNCTIE-BODY VAN update_order_with_lines HIER, MET DE TOEVOEGING>>

NOTIFY pgrst, 'reload schema';
```

**Let op:** dit is de enige plek in dit plan waar de exacte, volledige SQL-body niet vooraf is uitgeschreven — `create_order_with_lines`/`update_order_with_lines` zijn grote, zeer regelmatig gewijzigde functies (mig 166→204→...→481) en de laatste versie moet je **rechtstreeks uit de huidige `supabase/migrations/`-map** overnemen, niet reconstrueren uit dit plan. Kopieer 'm letterlijk, voeg alleen de twee bovenstaande toevoegingen toe, en laat verder niets anders wijzigen.

- [ ] **Step 3: Test in een rolled-back transactie tegen de live DB**

```sql
BEGIN;
  \i supabase/migrations/488_combi_levering_override_rpc.sql

  SELECT create_order_with_lines(
    '{"debiteur_nr": <bestaande testklant>, "combi_levering_override": true, ...}'::jsonb,
    '[...]'::jsonb
  );
  -- Verwacht: nieuwe order heeft combi_levering_override=true.

  SELECT update_order_with_lines(<order_id>, '{"combi_levering_override": false}'::jsonb, '[...]'::jsonb);
  -- Verwacht: combi_levering_override wisselt naar false, overige kolommen ongewijzigd.
ROLLBACK;
```

- [ ] **Step 4: Voeg `combi_levering` toe aan de klant-select-queries**

In `frontend/src/components/orders/client-selector.tsx`, voeg `combi_levering` toe aan de `.select(...)`-kolomlijst (regels 62-64) en aan `SelectedClient` (na `gratis_verzending`, regel 26).

In `frontend/src/lib/supabase/queries/order-mutations.ts`'s `fetchClientCommercialData` (regels 485-494), voeg `combi_levering` toe aan de `.select(...)`-string en aan het geretourneerde type.

In `frontend/src/pages/orders/order-edit.tsx` (regels 85-112), voeg `combi_levering: clientData?.combi_levering ?? false` toe aan de opgebouwde `SelectedClient`.

- [ ] **Step 5: Handmatige verificatie**

Maak in de dev-UI een order aan voor een klant met `combi_levering=true` en een subtotaal onder de drempel: order-form toont de nieuwe checkbox, en zonder 'm aan te vinken bevat de opgeslagen order geen VERZEND-regel. Vink 'm aan → order wordt met VERZEND-regel opgeslagen.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/488_combi_levering_override_rpc.sql frontend/src/components/orders/client-selector.tsx frontend/src/lib/supabase/queries/order-mutations.ts frontend/src/pages/orders/order-edit.tsx
git commit -m "feat(combi-levering): combi_levering_override door RPC-laag + klant-queries"
```

---

**Checkpoint Fase 1:** na Task 8 is het kernmechanisme volledig werkend en end-to-end testbaar: zet een klant op `combi_levering=true`, maak 2 kleine orders naar hetzelfde adres, zie ze beide als "wacht_op_combi_levering" in Pick & Ship staan totdat hun som de drempel haalt, en zie ze dan samen startbaar worden (en dankzij de bestaande `start_pickronden`-clamp, mig 403, automatisch in 1 zending bundelen zodra je ze samen start).

---

## Fase 2 — Communicatie & operator-UX

### Task 9: Orderbevestiging — paragraaf over het wachten

**Files:**
- Modify: `supabase/functions/stuur-orderbevestiging/index.ts`
- Modify: `supabase/functions/_shared/orderbevestiging-pdf.ts`

- [ ] **Step 1: Voeg `combi_levering` toe aan de debiteur-select**

In `stuur-orderbevestiging/index.ts`, breid de bestaande embedded debiteuren-select (regel 233) uit met `combi_levering`:
```ts
debiteuren!orders_debiteur_nr_fkey(naam, email_factuur, email_overig, email_2, betaalconditie, btw_percentage, btw_verlegd_intracom, combi_levering, verzend_drempel, gratis_verzending)
```

- [ ] **Step 2: Bepaal of de paragraaf moet verschijnen**

Na het bestaande fetchen van order + debiteur (rond regel 248), voeg toe:
```ts
const combiLeveringWacht =
  deb.combi_levering &&
  !order.combi_levering_override &&
  !heeftDropshipRegel(regels) && // regels is al gefetcht, zie regels 273-286
  !deb.gratis_verzending
```
(`order.combi_levering_override` moet aan de order-select op regel 226-236 toegevoegd worden.) Als striktere garantie gewenst is (alleen tonen als de groep de drempel ECHT nog niet haalt op het moment van versturen), query de `combi_levering_status`-view voor dit order_id en gebruik `wacht_op_combi_levering` rechtstreeks in plaats van dit lokaal te herberekenen:
```ts
const { data: combiStatus } = await supabase
  .from('combi_levering_status')
  .select('wacht_op_combi_levering')
  .eq('order_id', order.id)
  .maybeSingle()
const combiLeveringWacht = combiStatus?.wacht_op_combi_levering ?? false
```
Gebruik deze tweede variant — hij is de single source of truth (Task 2) en voorkomt drift tussen twee plekken die "moet deze order wachten" berekenen.

- [ ] **Step 3: Voeg de 4-talige teksten toe**

In `VERTALINGEN` (regels 41-152), voeg aan elk van de vier taalobjecten (`nl`/`de`/`fr`/`en`) een nieuwe sleutel toe, bijvoorbeeld voor `nl` (naast `disclaimer`, regel ~78):
```ts
combiLevering: 'Wij leveren pas zodra uw gecombineerde bestellingen de vrachtvrije-drempel bereiken. Wordt dit niet gehaald vóór de vermelde levering, dan schuift de leverdatum automatisch op. U kunt hiervoor zelf zorgen door voldoende te bestellen, of contact met ons opnemen om deze order alsnog — met verzendkosten — te laten verzenden.',
```
(analoge, vertaalde tekst voor `de`/`fr`/`en`).

- [ ] **Step 4: Splice de paragraaf in de HTML-body**

Bouw, naast de bestaande `afleveradresHtml`-constructie (regels 437-451), een nieuwe conditionele blok-variabele:
```ts
const combiLeveringHtml = combiLeveringWacht
  ? `<p>${v.combiLevering}</p>`
  : ''
```
en splice 'm in `htmlBody` direct na de intro-paragraaf (rond regel 456-464), bijvoorbeeld: `...${introHtml}${combiLeveringHtml}${afleveradresHtml}...`.

- [ ] **Step 5: Herhaal voor de PDF**

In `_shared/orderbevestiging-pdf.ts`: voeg `combiLeveringWacht: boolean` toe aan `OrderbevestigingInput` (regels 46-75), voeg de vertaalstring toe aan elk van de vier `PDF_VERTALINGEN`-blokken (regels 105-200), en voeg — naar het patroon van het bestaande "Opmerkingen"-blok (regels 553-563) — een nieuw conditioneel blok toe vóór of na dat blok:
```ts
if (input.combiLeveringWacht) {
  const lines = wrapText(t.combiLevering, fontR, 8, pageW - mL - mR)
  for (const line of lines) {
    drawText(page, line, mL, y, fontR, 8)
    y -= 11
  }
  y -= 4
}
```

- [ ] **Step 6: Handmatige verificatie**

Verstuur een test-orderbevestiging voor een order die op dit moment `wacht_op_combi_levering=true` heeft (via de bestaande "Bevestig order"-knop op order-detail) en controleer dat zowel de e-mailtekst als de PDF-bijlage de nieuwe paragraaf tonen, in de juiste taal voor die klant. Verstuur ook een controle-orderbevestiging voor een normale order en controleer dat de paragraaf daar **niet** verschijnt.

- [ ] **Step 7: Deploy + commit**

```bash
supabase functions deploy stuur-orderbevestiging --project-ref wqzeevfobwauxkalagtn
git add supabase/functions/stuur-orderbevestiging/index.ts supabase/functions/_shared/orderbevestiging-pdf.ts
git commit -m "feat(combi-levering): orderbevestiging-paragraaf (mail+PDF, 4-talig) bij wachten"
```

---

### Task 10: Order-detail — "zet in de wacht"-knop

**Files:**
- Create: `supabase/migrations/489_zet_order_in_combi_levering_wacht.sql`
- Create: `frontend/src/components/orders/combi-levering-in-wacht-knop.tsx`
- Modify: `frontend/src/components/orders/order-header.tsx` (of de plek waar andere order-detail-acties staan, bv. naast `EdiLeverweekBevestigen`/`DebiteurBevestigenWidget`)

Scenario (ADR-0039 Anchor 7): een klant die al een orderbevestiging kreeg, belt alsnog om te wachten i.p.v. verzendkosten te betalen. Één knop zet zowel de klant-instelling als deze order in de wacht, en verstuurt een nieuwe bevestiging.

- [ ] **Step 1: Schrijf de RPC**

```sql
-- Migratie 489: order-detail-knop "zet in de wacht voor Combi-levering" (ADR-0039)
--
-- Zet debiteuren.combi_levering=TRUE (raakt daardoor ALLE openstaande orders
-- van deze klant naar dit soort adressen, niet alleen p_order_id — bewuste
-- keuze, bevestigd tijdens de grilling-sessie: de klant schakelt hiermee
-- feitelijk helemaal over naar combi-levering-gedrag). De bestaande trigger
-- trg_debiteuren_combi_levering (mig 487) herwaardeert vanzelf de
-- VERZEND-regels van al die orders.

CREATE OR REPLACE FUNCTION zet_order_in_combi_levering_wacht(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_debiteur_nr INTEGER;
BEGIN
  SELECT debiteur_nr INTO v_debiteur_nr FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE debiteuren SET combi_levering = TRUE WHERE debiteur_nr = v_debiteur_nr;

  -- Deze ene order kan zelf al een override hebben staan (bv. eerder bewust
  -- los verzonden) — dat moet uit, anders doet de nieuwe klant-instelling
  -- voor DEZE order niets.
  UPDATE orders SET combi_levering_override = FALSE WHERE id = p_order_id;
END;
$$;

COMMENT ON FUNCTION zet_order_in_combi_levering_wacht(BIGINT) IS
  'Mig 489 (ADR-0039): order-detail-knop-RPC. Zet debiteuren.combi_levering=TRUE '
  '(klant-breed) en orders.combi_levering_override=FALSE voor deze order. '
  'Trigger mig 487 herwaardeert de VERZEND-regels van alle geraakte orders.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Test in een rolled-back transactie tegen de live DB**

```sql
BEGIN;
  \i supabase/migrations/489_zet_order_in_combi_levering_wacht.sql
  SELECT zet_order_in_combi_levering_wacht(<bestaande order_id>);
  SELECT combi_levering FROM debiteuren WHERE debiteur_nr = (SELECT debiteur_nr FROM orders WHERE id = <die order_id>);
  -- Verwacht: TRUE. Én: alle andere open orders van diezelfde klant/adres
  -- tonen nu ook wacht_op_combi_levering=TRUE in combi_levering_status.
ROLLBACK;
```

- [ ] **Step 3: Bouw de knop**

`frontend/src/components/orders/combi-levering-in-wacht-knop.tsx`:
```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { stuurOrderbevestiging } from '@/lib/supabase/queries/orderbevestiging'

interface Props {
  orderId: number
  orderNr: string
}

export function CombiLeveringInWachtKnop({ orderId, orderNr }: Props) {
  const [gedaan, setGedaan] = useState(false)
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('zet_order_in_combi_levering_wacht', {
        p_order_id: orderId,
      })
      if (error) throw error
      await stuurOrderbevestiging(orderId)
    },
    onSuccess: () => {
      setGedaan(true)
      queryClient.invalidateQueries({ queryKey: ['order', orderId] })
    },
  })

  if (gedaan) {
    return (
      <span className="text-sm text-emerald-700">
        Order {orderNr} staat nu in de wacht voor Combi-levering — nieuwe bevestiging verstuurd.
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="text-sm text-terracotta-500 hover:text-terracotta-700 font-medium disabled:opacity-50"
    >
      {mutation.isPending ? 'Bezig...' : 'Zet order in de wacht voor Combi-levering'}
    </button>
  )
}
```
(`stuurOrderbevestiging(orderId)` is de bestaande wrapper rond de `stuur-orderbevestiging`-edge-function-aanroep die de "Bevestig order"-knop ook al gebruikt — hergebruik die, zoek 'm op in `frontend/src/lib/supabase/queries/` naast waar `BevestigOrderDialog` 'm aanroept.)

- [ ] **Step 4: Plaats de knop op order-detail**

Voeg `<CombiLeveringInWachtKnop orderId={order.id} orderNr={order.order_nr} />` toe op order-detail, alleen zichtbaar als de order NIET al `wacht_op_combi_levering` is en de debiteur nog geen `combi_levering=true` heeft — naast de andere order-niveau-acties (`EdiLeverweekBevestigen`/`DebiteurBevestigenWidget`).

- [ ] **Step 5: Handmatige verificatie**

Klik de knop op een order van een klant zonder `combi_levering`; controleer dat de klant-instelling omslaat, de order + eventuele andere open orders van diezelfde klant/adres in Pick & Ship op "wacht_op_combi_levering" springen, en dat er een nieuwe orderbevestiging met de Task-9-paragraaf verstuurd wordt.

- [ ] **Step 6: Deploy + commit**

```bash
git add supabase/migrations/489_zet_order_in_combi_levering_wacht.sql frontend/src/components/orders/combi-levering-in-wacht-knop.tsx
git commit -m "feat(combi-levering): order-detail-knop zet klant+order in de wacht + herbevestigt"
```

---

### Task 11: Pick & Ship — waarschuwing bij achterblijven van een Combi-levering-lid

**Files:**
- Create: `frontend/src/modules/logistiek/lib/combi-levering-achtergebleven.ts`
- Create: `frontend/src/modules/logistiek/lib/combi-levering-achtergebleven.test.ts`
- Modify: `frontend/src/modules/logistiek/components/start-pickrondes-button.tsx`

De force-solo-dialoog uit ADR-0012 is nooit gebouwd (besluit 2026-06-17) — vandaag sluit een operator een order simpelweg uit door 'm niet aan te vinken in de Pick & Ship-multi-select. Deze taak voegt een waarschuwing toe wanneer dat "niet aanvinken" een Combi-levering-groep zou splitsen.

- [ ] **Step 1: Schrijf de falende test voor de pure detectie-functie**

```ts
// combi-levering-achtergebleven.test.ts
import { describe, it, expect } from 'vitest'
import { vindtAchtergeblevenCombiLeveringLeden } from './combi-levering-achtergebleven'
import type { PickShipOrder } from '../../magazijn/lib/types'

function order(overrides: Partial<PickShipOrder> = {}): PickShipOrder {
  return {
    order_id: 1, order_nr: 'ORD-1', status: 'Klaar voor picken', klant_naam: 'Test',
    debiteur_nr: 100, afl_naam: 'X', afl_adres: 'Straat 1', afl_postcode: '1234AB',
    afl_plaats: 'Stad', afl_land: 'NL', afleverdatum: '2026-08-01', afhalen: false,
    lever_type: 'week', bucket: 'wk_1', verzend_week_sleutel: '2026-W31',
    verzend_week_label: 'Verzendweek 31', verzend_week_kort: 'Wk 31', regels: [],
    totaal_m2: 0, totaal_gewicht_kg: 0, aantal_regels: 0, alle_regels_pickbaar: true,
    heeft_gepland_zending: false, afl_adres_incompleet_sinds: null,
    prijs_ontbreekt_sinds: null, actieve_pickronde: null, wacht_op_combi_levering: false,
    ...overrides,
  }
}

describe('vindtAchtergeblevenCombiLeveringLeden', () => {
  it('geeft leeg terug als er geen Combi-levering-orders in de startset zitten', () => {
    const alle = [order({ order_id: 1 }), order({ order_id: 2 })]
    expect(vindtAchtergeblevenCombiLeveringLeden([1], alle)).toEqual([])
  })

  it('detecteert een sibling-order (zelfde debiteur+adres, zelf niet geselecteerd) die nu startbaar is', () => {
    const alle = [
      order({ order_id: 1, debiteur_nr: 100, afl_adres: 'Straat 1', afl_postcode: '1234AB', afl_land: 'NL' }),
      order({ order_id: 2, debiteur_nr: 100, afl_adres: 'Straat 1', afl_postcode: '1234AB', afl_land: 'NL' }),
    ]
    expect(vindtAchtergeblevenCombiLeveringLeden([1], alle)).toEqual([2])
  })

  it('negeert een sibling naar een ander adres', () => {
    const alle = [
      order({ order_id: 1, debiteur_nr: 100, afl_adres: 'Straat 1' }),
      order({ order_id: 2, debiteur_nr: 100, afl_adres: 'Andere straat 9' }),
    ]
    expect(vindtAchtergeblevenCombiLeveringLeden([1], alle)).toEqual([])
  })

  it('negeert een sibling die zelf nog wacht_op_combi_levering=true heeft (nog niet startbaar)', () => {
    const alle = [
      order({ order_id: 1, debiteur_nr: 100, afl_adres: 'Straat 1' }),
      order({ order_id: 2, debiteur_nr: 100, afl_adres: 'Straat 1', wacht_op_combi_levering: true }),
    ]
    expect(vindtAchtergeblevenCombiLeveringLeden([1], alle)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, verwacht FAIL**

Run: `npx vitest run frontend/src/modules/logistiek/lib/combi-levering-achtergebleven.test.ts`
Expected: FAIL — module bestaat nog niet.

- [ ] **Step 3: Implementeer de pure functie**

```ts
// combi-levering-achtergebleven.ts
import type { PickShipOrder } from '../../magazijn/lib/types'
import { _normaliseerAfleveradres } from '@/lib/orders/normaliseer-adres'

/**
 * Geeft de order_ids terug die tot dezelfde (debiteur × adres-norm)-groep
 * horen als een order in `startOrderIds`, zelf nu ook startbaar zijn
 * (wacht_op_combi_levering=false) en toch NIET in `startOrderIds` zitten —
 * d.w.z. een Combi-levering-lid dat de operator op het punt staat achter te
 * laten door 'm niet aan te vinken. Pure functie, geen fetch.
 */
export function vindtAchtergeblevenCombiLeveringLeden(
  startOrderIds: number[],
  alleOrders: PickShipOrder[],
): number[] {
  const startSet = new Set(startOrderIds)
  const geselecteerd = alleOrders.filter((o) => startSet.has(o.order_id))
  const sleutels = new Set(
    geselecteerd.map((o) => `${o.debiteur_nr}|${_normaliseerAfleveradres(o.afl_adres, o.afl_postcode, o.afl_land)}`)
  )
  if (sleutels.size === 0) return []

  return alleOrders
    .filter((o) => !startSet.has(o.order_id))
    .filter((o) => !o.wacht_op_combi_levering)
    .filter((o) => sleutels.has(`${o.debiteur_nr}|${_normaliseerAfleveradres(o.afl_adres, o.afl_postcode, o.afl_land)}`))
    .map((o) => o.order_id)
}
```
(`_normaliseerAfleveradres` is de bestaande TS-spiegel van de SQL-functie — zoek 'm op naast `bundel-sleutel.ts`; gebruik dezelfde import die `voorgestelde-bundels.ts` al gebruikt.)

- [ ] **Step 4: Run tests, verwacht PASS**

Run: `npx vitest run frontend/src/modules/logistiek/lib/combi-levering-achtergebleven.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire de waarschuwing in `start-pickrondes-button.tsx`**

In `handleStart()` (regels 138-156), vóór de mutatie-aanroep:
```ts
const achtergebleven = vindtAchtergeblevenCombiLeveringLeden(
  pickbareOrders.map((o) => o.order_id),
  alleOrders, // volledige, ongefilterde Pick & Ship-lijst — moet als prop beschikbaar zijn
)
if (achtergebleven.length > 0 && !bevestigdAchterlaten) {
  setToonWaarschuwing(true)
  return
}
```
Toon bij `toonWaarschuwing===true` een amber-blok naar het `deelzending-dialog.tsx`-patroon (regels 230-248 daar), met een vaste audit-tekst i.p.v. vrije tekst:
```tsx
{toonWaarschuwing && (
  <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] px-3 py-2.5 space-y-2">
    <p className="text-sm text-amber-800 font-medium">
      {achtergebleven.length} andere order(s) van deze klant wachten nog op dezelfde Combi-levering-groep
    </p>
    <label className="flex items-start gap-2 text-xs text-amber-700 cursor-pointer">
      <input
        type="checkbox"
        checked={bevestigdAchterlaten}
        onChange={(e) => setBevestigdAchterlaten(e.target.checked)}
      />
      <span>Ik wil deze order(s) toch los starten, ook al betekent dit dat de klant de vrachtvrije-drempel mogelijk niet haalt.</span>
    </label>
  </div>
)}
```
en pas de daadwerkelijke `start_pickronden`-aanroep pas toe zodra `bevestigdAchterlaten===true`.

- [ ] **Step 6: Run de bestaande component-tests, verwacht PASS**

Run: `npx vitest run frontend/src/modules/logistiek/components/start-pickrondes-button.test.tsx` (of het dichtstbijzijnde bestaande testbestand voor dit component — als het niet bestaat, voeg een minimale test toe die bevestigt dat de waarschuwing verschijnt/verdwijnt op basis van `vindtAchtergeblevenCombiLeveringLeden`'s output).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/logistiek/lib/combi-levering-achtergebleven.ts frontend/src/modules/logistiek/lib/combi-levering-achtergebleven.test.ts frontend/src/modules/logistiek/components/start-pickrondes-button.tsx
git commit -m "feat(combi-levering): waarschuwing bij achterblijven van een combi-levering-lid in Pick & Ship"
```

---

## Self-Review (uitgevoerd tijdens het schrijven van dit plan)

- **Spec-coverage tegen de grilling-sessie:** klant-instelling (Task 6) ✓, order-niveau-override (Task 7-8) ✓, commercieel vasthouden zonder productie te raken (Task 1-5) ✓, Pick & Ship-bundeling zonder nieuwe bundel-code (bewust géén taak — hergebruikt `start_pickronden`/mig 403, zie ADR-0039 Anchor 4) ✓, groep-als-1-order + niet-splitsen zonder waarschuwing (Task 11) ✓, vangnet via bestaande "Verzendweek verstreken" (bewust géén taak — vereist alleen dat die branch losstaand gemerged wordt, zie ADR-0039's "Open kandidaten") ✓, orderbevestiging-paragraaf (Task 9) ✓, "zet in de wacht"-knop (Task 10) ✓.
- **Placeholder-scan:** Task 8's migratie is de enige plek met een expliciete "kopieer de actuele body" instructie i.p.v. volledig uitgeschreven SQL — bewust, want `create_order_with_lines`/`update_order_with_lines` zijn >100 regels en op het moment van schrijven van dit plan niet met zekerheid te reproduceren zonder de huidige hoogst-genummerde migratie te lezen; de instructie zelf is volledig en concreet (welke twee toevoegingen, waar), geen vage "handle edge cases"-taal.
- **Type-consistentie:** `wacht_op_combi_levering` heet overal exact zo (view-kolom, `PickShipOrder`-veld, `StartbaarheidInput`-veld) behalve in de klant-instelling zelf (`debiteuren.combi_levering`, zonder `wacht_op_`-prefix, want dat is de instelling niet de afgeleide status) en de order-override (`orders.combi_levering_override`) — bewust drie verschillende namen voor drie verschillende concepten, consistent doorgevoerd.
