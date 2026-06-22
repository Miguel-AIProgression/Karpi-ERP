# Pick-backorder bij niet-gevonden colli — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een colli die tijdens een Pickronde niet fysiek gevonden wordt blokkeert niet langer de hele order — de niet-gevonden regel gaat naar een **Pick-backorder**-omgeving (tab op orders-overzicht), de rest wordt verzonden en voltooid, en de operator kan de backorder-regel later **annuleren** of **opnieuw versturen**.

**Architecture:** Volgt het bestaande nullable-timestamp-gate-patroon (mig 326/395/396): twee gate-kolommen op `order_regels` + één pure predikaat-seam `frontend/src/lib/orders/pick-backorder.ts` (`isPickBackorder` client-side + `filterPickBackorder` PostgREST), 1:1 gespiegeld op de bestaande `intake-predicaten.ts`. De afsplits-en-voltooi-logica hergebruikt de bestaande `voltooi_pickronde` (mig 413) — geen duplicaat. De overbodig geworden `'splits'`-modus uit `markeer_colli_niet_gevonden` (mig 211) + de twee-keuze "Niet gevonden"-dialog worden verwijderd (ponytail-versimpeling).

**Tech Stack:** Supabase/PostgreSQL (plpgsql RPC's, SQL views), React 18 + TypeScript + TanStack Query, Vitest.

**Branch:** `feat/niet-gevonden-backorder` (eigen branch, merge pas op commando).

---

## Domeintaal (CONTEXT.md)

Nieuwe term, toe te voegen aan `CONTEXT.md` onder "Magazijn & verzending":

> **Pick-backorder**:
> Een Orderregel die tijdens een [[Pickronde]] niet fysiek gevonden is (operator zet de colli op "Niet gevonden"). Bij voltooien wordt de regel afgesplitst van de verzonden rest en gemarkeerd met de gate `order_regels.pick_backorder_sinds`; tot beoordeling verdwijnt hij uit [[Pickbaarheid]] zodat geen tweede picker hem tevergeefs zoekt. De operator beoordeelt hem op de **Backorder**-tab van het orders-overzicht en kiest tussen *annuleren* (`pick_backorder_geannuleerd_op` gezet, claim vrij, regel telt niet meer mee voor de order-status) of *opnieuw versturen* (gate gewist → terug in Pick & Ship). Het is een eigenschap van de **Orderregel tegenover de fysieke pick-uitkomst**, daarom leeft het predikaat op één plek (`frontend/src/lib/orders/pick-backorder.ts`), zelfde patroon als de intake-gates. Niet te verwarren met `producten.backorder` (voorraad-tekort, mig 149) of de order-niveau status `Deels verzonden`.
> _Avoid_: niet-gevonden-stapel, pick-fout (te vaag — het is één regel-gate)

---

## File Structure

**Backend (migraties — volgende vrije nummer = 454; verifieer vlak vóór uitvoering, zie mig-collisie-memory):**
- Create `supabase/migrations/454_pick_backorder.sql` — gate-kolommen, `voltooi_pickronde`-uitbreiding (afsplitsen niet-gevonden → backorder), `orderregel_pickbaarheid`-uitsluiting, RPC's `backorder_opnieuw_versturen` + `annuleer_pick_backorder`, opschoon van de overbodige `'splits'`-modus.

**Frontend (seam + UI):**
- Create `frontend/src/lib/orders/pick-backorder.ts` — pure predikaat-seam (`isPickBackorder` + `filterPickBackorder`).
- Create `frontend/src/lib/orders/__tests__/pick-backorder.test.ts` — pure-functie-test.
- Create `frontend/src/modules/orders/queries/backorder.ts` — fetch backorder-regels + de twee actie-mutaties.
- Create `frontend/src/modules/orders/hooks/use-backorder.ts` — TanStack-hooks.
- Create `frontend/src/modules/orders/components/backorder-tab.tsx` — de tab-inhoud (lijst + acties).
- Modify `frontend/src/lib/supabase/queries/orders.ts` — `fetchOrders`/`fetchStatusCounts`: backorder-tab + teller (spiegelt `filterDebiteurTeBevestigen`).
- Modify `frontend/src/pages/orders/orders-overview.tsx` — registreer de "Backorder"-tab + banner.
- Modify `frontend/src/modules/logistiek/components/colli-pick-vinkjes.tsx` — verwijder twee-keuze-dialog, enkel "Niet gevonden"-toggle + herstel-knop.
- Modify `frontend/src/modules/logistiek/components/voltooi-pickronde-knop.tsx` — niet meer disablen bij niet-gevonden; label/tekst aanpassen.
- Modify `frontend/src/modules/magazijn/queries/pickronde.ts` — `markeerColliNietGevonden` vereenvoudigen (één modus), `herstelColli` toevoegen.
- Modify `frontend/src/modules/magazijn/components/pick-problemen-banner.tsx` — verwijst naar Backorder-tab i.p.v. "chef lost op".

**Docs:**
- Modify `CONTEXT.md`, `CLAUDE.md`, `docs/changelog.md`, `docs/order-lifecycle.md`, `docs/database-schema.md`.

---

## Architectuur-keuzes vooraf (lees vóór je begint)

1. **Twee gate-kolommen, geen status-enum.** `pick_backorder_sinds` (op de tab + uit pickbaarheid) en `pick_backorder_geannuleerd_op` (afgehandeld, telt niet mee voor order-status). Beide los `IS NULL`-filterbaar via PostgREST (mig 326 koos bewust tegen kolom-vs-kolom-vergelijkingen). "Opnieuw versturen" wist `pick_backorder_sinds`; "Annuleren" zet `pick_backorder_geannuleerd_op`.

2. **`voltooi_pickronde` doet de afsplitsing, niet een nieuwe RPC.** Bestaande RPC blokkeert nu hard op `niet_gevonden` (mig 413 r402-405). We vervangen die guard door: markeer de niet-gevonden colli's hun orderregel als backorder, splits ze af (zelfde verlaag-zending_regels/verwijder-colli als de oude `'splits'`-tak, mig 211 r199-217, **zonder** deelleveringen-gate), en val dan in de bestaande voltooi-flow. Een orderregel zonder zending telt al als "onverzonden" → order wordt `Deels verzonden` (mig 413 r457-471). **Lege-zending-edge case** (alle colli niet gevonden, bv. ZEND-2026-0093): na afsplitsen 0 colli over → géén status-flip naar `Klaar voor verzending` (anders lege zending naar de vervoerder); verwijder de zending-rij (zoals `annuleer_pickronde`, mig 398 r72-75) en laat de order via de backorder-tab opgepakt worden.

3. **Annuleren = claim vrij + order-status herwaarderen.** `annuleer_pick_backorder` zet `pick_backorder_geannuleerd_op`, zet `te_leveren=0`, releaset de claim via `herallocateer_orderregel` (mig 154 — releaset niet-handmatige claims; met `te_leveren=0` blijft niets gealloceerd), logt een `order_event`, en flipt de order naar `Verzonden` als er geen onverzonden, niet-geannuleerde regels meer zijn. De onverzonden-telling in `voltooi_pickronde` krijgt daarom een extra `AND oreg.pick_backorder_geannuleerd_op IS NULL`.

4. **Ponytail-deletes (in deze migratie + frontend):** de `'splits'`-modus van `markeer_colli_niet_gevonden` en het `p_modus`-argument vervallen — de functie wordt een kale "zet colli op niet_gevonden". De `NietGevondenDialog` met twee knoppen wordt een simpele markeer-actie + herstel-knop.

---

## Task 1: Gate-kolommen op order_regels

**Files:**
- Create: `supabase/migrations/454_pick_backorder.sql` (deel 1)

- [ ] **Step 1: Verifieer het volgende vrije migratienummer**

Run: `ls supabase/migrations/ | sort | tail -5`
Expected: hoogste nummer is `453_*`. Als er al een `454_*` staat (parallelle sessie), gebruik het eerstvolgende vrije nummer en pas de bestandsnaam + alle interne verwijzingen aan.

- [ ] **Step 2: Schrijf deel 1 — kolommen**

```sql
-- Migratie 454: Pick-backorder — niet-gevonden colli gaat naar backorder i.p.v.
-- de pickronde te blokkeren. Twee nullable gate-kolommen (patroon mig 326/395/396).
-- Idempotent.

ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS pick_backorder_sinds       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pick_backorder_reden       TEXT,
  ADD COLUMN IF NOT EXISTS pick_backorder_geannuleerd_op TIMESTAMPTZ;

COMMENT ON COLUMN order_regels.pick_backorder_sinds IS
  'Mig 454: gezet door voltooi_pickronde als de colli van deze regel niet gevonden '
  'werd. NOT NULL = staat op de Backorder-tab + uitgesloten uit pickbaarheid. '
  'backorder_opnieuw_versturen wist dit weer.';
COMMENT ON COLUMN order_regels.pick_backorder_reden IS
  'Mig 454: operator-opmerking bij niet-gevonden (overgenomen uit zending_colli.pick_opmerking).';
COMMENT ON COLUMN order_regels.pick_backorder_geannuleerd_op IS
  'Mig 454: gezet door annuleer_pick_backorder. NOT NULL = regel definitief niet '
  'geleverd; telt niet meer mee voor de order-status (Verzonden-afleiding).';

CREATE INDEX IF NOT EXISTS idx_order_regels_pick_backorder
  ON order_regels (pick_backorder_sinds)
  WHERE pick_backorder_sinds IS NOT NULL AND pick_backorder_geannuleerd_op IS NULL;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/454_pick_backorder.sql
git commit -m "feat(backorder): gate-kolommen pick_backorder op order_regels"
```

---

## Task 2: voltooi_pickronde — niet-gevonden → backorder + afsplitsen

**Files:**
- Modify: `supabase/migrations/454_pick_backorder.sql` (deel 2)

**Referentie:** lees eerst de huidige body van `voltooi_pickronde(BIGINT, BIGINT)` in `supabase/migrations/413_deelzending_rpc.sql:370-499`. We vervangen alleen het blok dat hard blokkeert (r398-405) door de afsplits-logica; de rest van de body (status-flip, bundel-orders, Deels-verzonden/Verzonden-afleiding) blijft identiek — neem die ongewijzigd over.

- [ ] **Step 1: Schrijf de nieuwe voltooi_pickronde**

```sql
-- ============================================================================
-- voltooi_pickronde — niet-gevonden colli's gaan naar backorder i.p.v. blokkeren.
-- Vervangt de harde guard (mig 413). Splitst niet-gevonden colli's af, markeert
-- hun orderregel als backorder, voltooit de rest. Lege zending na afsplitsen →
-- verwijder de zending (geen lege verzending naar de vervoerder).
-- ============================================================================
CREATE OR REPLACE FUNCTION voltooi_pickronde(
  p_zending_id BIGINT,
  p_picker_id  BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_huidig             zending_status;
  v_order_id           BIGINT;
  v_open_zendingen     INTEGER;
  v_verzonden_zend     INTEGER;
  v_onverzonde_regels  INTEGER;
  v_bundel_orders      BIGINT[];
  v_resterend_colli    INTEGER;
  v_ng                 RECORD;
BEGIN
  PERFORM _valideer_picker(p_picker_id);

  SELECT status INTO v_huidig FROM zendingen WHERE id = p_zending_id;
  IF v_huidig IS NULL THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;
  IF v_huidig <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde voor zending % is niet actief (status=%)',
      p_zending_id, v_huidig;
  END IF;

  -- Niet-gevonden colli's → markeer orderregel als backorder + splits af.
  FOR v_ng IN
    SELECT zc.id AS colli_id, zc.order_regel_id, zc.pick_opmerking
      FROM zending_colli zc
     WHERE zc.zending_id = p_zending_id
       AND zc.pick_uitkomst = 'niet_gevonden'
  LOOP
    UPDATE order_regels
       SET pick_backorder_sinds = now(),
           pick_backorder_reden = v_ng.pick_opmerking,
           pick_backorder_geannuleerd_op = NULL
     WHERE id = v_ng.order_regel_id;

    -- Splits af: verlaag zending_regels-aantal, verwijder lege regel + de colli.
    UPDATE zending_regels
       SET aantal = aantal - 1
     WHERE zending_id = p_zending_id
       AND order_regel_id = v_ng.order_regel_id
       AND aantal > 0;
    DELETE FROM zending_regels
     WHERE zending_id = p_zending_id
       AND order_regel_id = v_ng.order_regel_id
       AND COALESCE(aantal, 0) = 0;
    DELETE FROM zending_colli WHERE id = v_ng.colli_id;
  END LOOP;

  UPDATE zendingen
     SET aantal_colli = (SELECT COUNT(*) FROM zending_colli
                          WHERE zending_id = p_zending_id AND is_bundel = FALSE)
   WHERE id = p_zending_id;

  -- Lege zending (alle colli niet gevonden)? Geen verzending — verwijder de zending.
  SELECT COUNT(*) INTO v_resterend_colli
    FROM zending_colli WHERE zending_id = p_zending_id AND is_bundel = FALSE;

  SELECT array_agg(order_id) INTO v_bundel_orders
    FROM zending_orders WHERE zending_id = p_zending_id;
  IF v_bundel_orders IS NULL THEN
    SELECT ARRAY[order_id] INTO v_bundel_orders FROM zendingen WHERE id = p_zending_id;
  END IF;

  IF v_resterend_colli = 0 THEN
    DELETE FROM zending_colli  WHERE zending_id = p_zending_id;
    DELETE FROM zending_regels WHERE zending_id = p_zending_id;
    DELETE FROM zending_orders WHERE zending_id = p_zending_id;
    DELETE FROM zendingen      WHERE id = p_zending_id;
    -- Order-status herwaarderen: de backorder-regel houdt 'm uit Pick & Ship.
    IF v_bundel_orders IS NOT NULL THEN
      FOREACH v_order_id IN ARRAY v_bundel_orders LOOP
        PERFORM herbereken_wacht_status(v_order_id);
      END LOOP;
    END IF;
    RETURN p_zending_id;
  END IF;

  -- Resterende colli: voltooi normaal (identiek aan mig 413 vanaf hier).
  UPDATE zending_colli
     SET pick_uitkomst   = 'gepickt',
         gepickt_at      = now(),
         gepickt_door_id = p_picker_id
   WHERE zending_id = p_zending_id
     AND pick_uitkomst = 'open';

  UPDATE zendingen
     SET status    = 'Klaar voor verzending',
         picker_id = COALESCE(picker_id, p_picker_id)
   WHERE id = p_zending_id;

  FOREACH v_order_id IN ARRAY v_bundel_orders LOOP
    SELECT COUNT(*) INTO v_open_zendingen
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
             UNION SELECT id FROM zendingen WHERE order_id = v_order_id)
       AND z.status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    SELECT COUNT(*) INTO v_verzonden_zend
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
             UNION SELECT id FROM zendingen WHERE order_id = v_order_id)
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    IF EXISTS (SELECT 1 FROM orders WHERE id = v_order_id
                AND status IN ('Verzonden', 'Geannuleerd')) THEN CONTINUE; END IF;

    IF v_open_zendingen = 0 THEN
      -- Tel niet-gezende, niet-geannuleerde regels (backorder-regels tellen mee
      -- → order blijft Deels verzonden tot ze afgehandeld zijn).
      SELECT COUNT(*) INTO v_onverzonde_regels
        FROM order_regels ore
       WHERE ore.order_id = v_order_id
         AND NOT is_admin_pseudo(ore.artikelnr)
         AND ore.pick_backorder_geannuleerd_op IS NULL
         AND NOT EXISTS (SELECT 1 FROM zending_regels zr WHERE zr.order_regel_id = ore.id);

      IF v_onverzonde_regels > 0 THEN
        PERFORM markeer_deels_verzonden(v_order_id, p_picker_id);
      ELSE
        PERFORM markeer_verzonden(v_order_id, p_picker_id);
      END IF;
    ELSIF v_verzonden_zend >= 1 THEN
      PERFORM markeer_deels_verzonden(v_order_id, p_picker_id);
    END IF;
  END LOOP;

  RETURN p_zending_id;
END;
$$;

GRANT EXECUTE ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) TO authenticated;

COMMENT ON FUNCTION voltooi_pickronde(BIGINT, BIGINT) IS
  'Mig 454: niet-gevonden colli''s gaan naar Pick-backorder (order_regels.pick_backorder_sinds) '
  'i.p.v. de pickronde te blokkeren. Splitst ze af, voltooit de rest → Deels verzonden. '
  'Lege zending na afsplitsen → zending verwijderd (geen lege verzending). '
  'Onverzonden-telling negeert pick_backorder_geannuleerd_op-regels.';
```

- [ ] **Step 2: Verifieer dat de signatuur de oude vervangt**

`voltooi_pickronde(BIGINT, BIGINT)` heeft exact dezelfde signatuur als mig 413 → `CREATE OR REPLACE` vervangt 'm in-place. De 1-argument-variant (mig 211) is al dood (mig 413 verving 'm). Controleer met:

Run: `grep -rn "voltooi_pickronde(p_zending_id)" frontend/ supabase/functions/`
Expected: geen treffers (alle callers gebruiken de 2-argument-variant via `voltooiPickronde`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/454_pick_backorder.sql
git commit -m "feat(backorder): voltooi_pickronde splitst niet-gevonden af naar backorder"
```

---

## Task 3: orderregel_pickbaarheid sluit open backorder-regels uit

**Files:**
- Modify: `supabase/migrations/454_pick_backorder.sql` (deel 3)

**Referentie:** de huidige view staat in `supabase/migrations/386_pickbaarheid_single_source.sql:32-123`. We voegen één conditie toe aan de slot-`WHERE` (r122-123); neem de rest van de view byte-identiek over (de OR-REPLACE eist exact dezelfde kolommen op hun plek).

- [ ] **Step 1: Herschrijf de view met de extra uitsluiting**

Neem de volledige view uit mig 386 over en wijzig **alleen** de afsluitende WHERE:

```sql
WHERE o.status NOT IN ('Verzonden', 'Geannuleerd')
  AND NOT is_admin_pseudo(oreg.artikelnr)
  AND oreg.pick_backorder_sinds IS NULL;  -- mig 454: open backorder uit Pick & Ship
```

(De volledige `CREATE OR REPLACE VIEW orderregel_pickbaarheid AS ...`-body identiek aan mig 386, met deze WHERE.) Een geannuleerde backorder-regel heeft `te_leveren=0` en geen claim → was sowieso al `is_pickbaar=false`; de `pick_backorder_sinds IS NULL`-conditie dekt de open backorder.

```sql
COMMENT ON VIEW orderregel_pickbaarheid IS
  'Mig 386 + mig 454: open Pick-backorder-regels (pick_backorder_sinds NOT NULL) '
  'uitgesloten — uit Pick & Ship tot beoordeeld op de Backorder-tab. Verder '
  'identiek aan mig 386.';

NOTIFY pgrst, 'reload schema';
```

`order_pickbaarheid` (de aggregaat-view, mig 386 r132-150) leest `orderregel_pickbaarheid` en hoeft **niet** gewijzigd: een order met enkel een backorder-regel heeft 0 rijen → geen `pick_ship_zichtbaar`-rij → niet in Pick & Ship. Correct.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/454_pick_backorder.sql
git commit -m "feat(backorder): orderregel_pickbaarheid sluit open backorder uit"
```

---

## Task 4: RPC's backorder_opnieuw_versturen + annuleer_pick_backorder

**Files:**
- Modify: `supabase/migrations/454_pick_backorder.sql` (deel 4)

- [ ] **Step 1: Schrijf beide RPC's**

```sql
-- ============================================================================
-- backorder_opnieuw_versturen: wis de gate → regel komt terug in Pick & Ship.
-- ============================================================================
CREATE OR REPLACE FUNCTION backorder_opnieuw_versturen(p_order_regel_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order_id BIGINT;
BEGIN
  SELECT order_id INTO v_order_id FROM order_regels WHERE id = p_order_regel_id;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Orderregel % bestaat niet', p_order_regel_id USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE order_regels
     SET pick_backorder_sinds = NULL,
         pick_backorder_reden = NULL
   WHERE id = p_order_regel_id;

  INSERT INTO order_events (order_id, event_type, payload)
  VALUES (v_order_id, 'backorder_opnieuw_versturen',
          jsonb_build_object('order_regel_id', p_order_regel_id));

  -- Order terug naar pickbaar-afleiding (komt weer in Pick & Ship als pickbaar).
  PERFORM herbereken_wacht_status(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION backorder_opnieuw_versturen(BIGINT) TO authenticated;

-- ============================================================================
-- annuleer_pick_backorder: regel definitief niet leveren. Claim vrij, gate
-- afgehandeld, order naar Verzonden als dit de laatste open regel was.
-- ============================================================================
CREATE OR REPLACE FUNCTION annuleer_pick_backorder(
  p_order_regel_id BIGINT,
  p_reden          TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id          BIGINT;
  v_onverzonde_regels INTEGER;
  v_open_zendingen    INTEGER;
BEGIN
  SELECT order_id INTO v_order_id FROM order_regels WHERE id = p_order_regel_id;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Orderregel % bestaat niet', p_order_regel_id USING ERRCODE = 'no_data_found';
  END IF;

  -- te_leveren=0 + herallocateer → releaset niet-handmatige claims (mig 154).
  UPDATE order_regels
     SET te_leveren = 0,
         pick_backorder_geannuleerd_op = now()
   WHERE id = p_order_regel_id;
  PERFORM herallocateer_orderregel(p_order_regel_id);

  INSERT INTO order_events (order_id, event_type, payload)
  VALUES (v_order_id, 'backorder_geannuleerd',
          jsonb_build_object('order_regel_id', p_order_regel_id, 'reden', p_reden));

  -- Order naar Verzonden als er geen open zendingen én geen onverzonden,
  -- niet-geannuleerde regels meer zijn (spiegelt voltooi_pickronde-afleiding).
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_order_id
                  AND status IN ('Verzonden', 'Geannuleerd')) THEN
    SELECT COUNT(*) INTO v_open_zendingen
      FROM zendingen z
     WHERE z.id IN (SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order_id
                    UNION SELECT id FROM zendingen WHERE order_id = v_order_id)
       AND z.status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    SELECT COUNT(*) INTO v_onverzonde_regels
      FROM order_regels ore
     WHERE ore.order_id = v_order_id
       AND NOT is_admin_pseudo(ore.artikelnr)
       AND ore.pick_backorder_geannuleerd_op IS NULL
       AND NOT EXISTS (SELECT 1 FROM zending_regels zr WHERE zr.order_regel_id = ore.id);

    IF v_open_zendingen = 0 AND v_onverzonde_regels = 0 THEN
      PERFORM markeer_verzonden(v_order_id, NULL);
    ELSE
      PERFORM herbereken_wacht_status(v_order_id);
    END IF;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION annuleer_pick_backorder(BIGINT, TEXT) TO authenticated;
```

- [ ] **Step 2: Voeg de order_event-types toe**

Bovenaan deel 4, vóór de RPC's (ADD VALUE moet buiten een functie-body die de literal compile-time resolvet — volg het mig 398-patroon):

```sql
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'backorder_opnieuw_versturen';
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'backorder_geannuleerd';
```

**Let op:** een nieuwe enum-waarde kan niet in dezelfde transactie gebruikt worden als hij wordt aangemaakt. Zet de twee `ALTER TYPE`-statements in een **apart migratiebestand** dat vóór `454` draait, óf splits `454` in `454a_enum` + `454b_rpc`. Volg hier exact het patroon van mig 398 (die zette de ADD VALUE bovenaan en gebruikte 'm in een plpgsql-body — dat werkt omdat plpgsql de literal pas bij uitvoering resolvet; deze RPC's gebruiken de waarde óók in een plpgsql-body via `INSERT`, dus één bestand kan, mits de `ALTER TYPE` vóór de `CREATE FUNCTION` staat en niet in dezelfde expliciete transactie-block). Verifieer op staging dat `backorder_opnieuw_versturen` zonder `unsafe use of new value` draait; zo niet, splits het enum-deel af.

- [ ] **Step 3: Verifieer order_event_type-naam**

Run: `grep -rn "order_event_type" supabase/migrations/ | grep "CREATE TYPE\|ADD VALUE" | head`
Expected: bevestig dat het type `order_event_type` heet en dat `order_events` een kolom `event_type order_event_type` + `payload jsonb` heeft (zie mig 413 r173-184 voor de INSERT-vorm — `status_voor`/`status_na` zijn nullable, hier weggelaten).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/454_pick_backorder.sql
git commit -m "feat(backorder): RPC's opnieuw-versturen + annuleren"
```

---

## Task 5: Opschonen markeer_colli_niet_gevonden (ponytail-delete)

**Files:**
- Modify: `supabase/migrations/454_pick_backorder.sql` (deel 5)

De `'splits'`-modus is overbodig (backorder vervangt 'm). Vereenvoudig de RPC tot een kale "zet colli op niet_gevonden" — geen `p_modus`, geen deelleveringen-gate.

- [ ] **Step 1: Herschrijf de RPC**

```sql
-- ============================================================================
-- markeer_colli_niet_gevonden (mig 454): vereenvoudigd. Zet één colli op
-- 'niet_gevonden' + opmerking. De 'splits'-modus is vervallen — afsplitsen naar
-- backorder gebeurt nu bij voltooi_pickronde. Oude 3-arg-signatuur gedropt.
-- ============================================================================
DROP FUNCTION IF EXISTS markeer_colli_niet_gevonden(BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS markeer_colli_niet_gevonden(BIGINT, TEXT, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION markeer_colli_niet_gevonden(
  p_zending_colli_id BIGINT,
  p_opmerking        TEXT DEFAULT NULL,
  p_picker_id        BIGINT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_zending_st zending_status;
BEGIN
  SELECT z.status INTO v_zending_st
    FROM zending_colli zc JOIN zendingen z ON z.id = zc.zending_id
   WHERE zc.id = p_zending_colli_id;
  IF v_zending_st IS NULL THEN
    RAISE EXCEPTION 'zending_colli % bestaat niet', p_zending_colli_id;
  END IF;
  IF v_zending_st <> 'Picken' THEN
    RAISE EXCEPTION 'Pickronde niet actief (status=%)', v_zending_st;
  END IF;

  UPDATE zending_colli
     SET pick_uitkomst = 'niet_gevonden', pick_opmerking = p_opmerking, gepickt_at = NULL
   WHERE id = p_zending_colli_id;
END;
$$;
GRANT EXECUTE ON FUNCTION markeer_colli_niet_gevonden(BIGINT, TEXT, BIGINT) TO authenticated;

-- Herstel-actie: zet een per ongeluk gemarkeerde colli terug naar 'open'.
CREATE OR REPLACE FUNCTION herstel_colli_pick(p_zending_colli_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_zending_st zending_status;
BEGIN
  SELECT z.status INTO v_zending_st
    FROM zending_colli zc JOIN zendingen z ON z.id = zc.zending_id
   WHERE zc.id = p_zending_colli_id;
  IF v_zending_st IS DISTINCT FROM 'Picken' THEN
    RAISE EXCEPTION 'Pickronde niet actief (status=%)', v_zending_st;
  END IF;
  UPDATE zending_colli SET pick_uitkomst = 'open', pick_opmerking = NULL
   WHERE id = p_zending_colli_id AND pick_uitkomst = 'niet_gevonden';
END;
$$;
GRANT EXECUTE ON FUNCTION herstel_colli_pick(BIGINT) TO authenticated;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/454_pick_backorder.sql
git commit -m "refactor(backorder): vereenvoudig markeer_colli_niet_gevonden + herstel-RPC"
```

---

## Task 6: Pure predikaat-seam pick-backorder.ts (TDD)

**Files:**
- Create: `frontend/src/lib/orders/pick-backorder.ts`
- Test: `frontend/src/lib/orders/__tests__/pick-backorder.test.ts`

**Referentie:** spiegelt `frontend/src/lib/orders/intake-predicaten.ts` exact (zelfde `PostgrestEqOrNeq`-cast-truc tegen TS2589).

- [ ] **Step 1: Schrijf de failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { isPickBackorder } from '../pick-backorder'

describe('isPickBackorder', () => {
  it('true bij open backorder', () => {
    expect(isPickBackorder({ pick_backorder_sinds: '2026-06-22T10:00:00Z', pick_backorder_geannuleerd_op: null })).toBe(true)
  })
  it('false als niet in backorder', () => {
    expect(isPickBackorder({ pick_backorder_sinds: null, pick_backorder_geannuleerd_op: null })).toBe(false)
  })
  it('false als al geannuleerd (afgehandeld)', () => {
    expect(isPickBackorder({ pick_backorder_sinds: '2026-06-22T10:00:00Z', pick_backorder_geannuleerd_op: '2026-06-22T11:00:00Z' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run — verwacht FAIL**

Run: `cd frontend && npx vitest run src/lib/orders/__tests__/pick-backorder.test.ts`
Expected: FAIL — module bestaat niet.

- [ ] **Step 3: Schrijf de seam**

```typescript
// Bron van waarheid voor het 'Pick-backorder'-predicaat (mig 454): orderregels
// die tijdens een Pickronde niet gevonden zijn en wachten op beoordeling op de
// Backorder-tab. Open = pick_backorder_sinds gezet EN nog niet geannuleerd.
// Twee adapters, exact dezelfde voorwaarde (patroon intake-predicaten.ts):
//   - isPickBackorder(regel): client-side check.
//   - filterPickBackorder(query): PostgREST-filterketen (fetchOrders + count).

export interface PickBackorderVelden {
  pick_backorder_sinds?: string | null
  pick_backorder_geannuleerd_op?: string | null
}

export function isPickBackorder(regel: PickBackorderVelden): boolean {
  return regel.pick_backorder_sinds != null && regel.pick_backorder_geannuleerd_op == null
}

interface PostgrestIs {
  not(column: string, op: string, value: unknown): PostgrestIs
  is(column: string, value: unknown): PostgrestIs
}

/** Filtert order_regels op open backorder. */
export function filterPickBackorder<Q>(query: Q): Q {
  return (query as unknown as PostgrestIs)
    .not('pick_backorder_sinds', 'is', null)
    .is('pick_backorder_geannuleerd_op', null) as unknown as Q
}
```

- [ ] **Step 4: Run — verwacht PASS**

Run: `cd frontend && npx vitest run src/lib/orders/__tests__/pick-backorder.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/orders/pick-backorder.ts frontend/src/lib/orders/__tests__/pick-backorder.test.ts
git commit -m "feat(backorder): pure predikaat-seam pick-backorder.ts"
```

---

## Task 7: Backorder-queries + hooks

**Files:**
- Create: `frontend/src/modules/orders/queries/backorder.ts`
- Create: `frontend/src/modules/orders/hooks/use-backorder.ts`

**Referentie:** `frontend/src/modules/magazijn/queries/pickronde.ts` (de `toError`-helper + RPC-aanroep-vorm) en `use-pickronde.ts` (hook-vorm).

- [ ] **Step 1: Schrijf de query-laag**

```typescript
// frontend/src/modules/orders/queries/backorder.ts
import { supabase } from '@/lib/supabase/client'
import { filterPickBackorder } from '@/lib/orders/pick-backorder'

export interface BackorderRegel {
  order_regel_id: number
  order_id: number
  order_nr: string
  klant_naam: string | null
  omschrijving: string | null
  orderaantal: number | null
  pick_backorder_sinds: string
  pick_backorder_reden: string | null
}

export async function fetchBackorderRegels(): Promise<BackorderRegel[]> {
  // Gebruik de gedeelde seam (Task 6) zodat de open-backorder-definitie op één
  // plek leeft — niet inline gedupliceerd (deletion test: de seam moet echt zijn).
  const { data, error } = await filterPickBackorder(
    supabase
      .from('order_regels')
      .select(`
        id, order_id, omschrijving, orderaantal, pick_backorder_sinds, pick_backorder_reden,
        orders!order_regels_order_id_fkey!inner (
          order_nr,
          debiteuren:debiteuren!orders_debiteur_nr_fkey ( naam )
        )
      `)
  ).order('pick_backorder_sinds', { ascending: true })

  if (error) throw new Error(`Backorder ophalen mislukt: ${error.message}`)
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as {
      id: number; order_id: number; omschrijving: string | null; orderaantal: number | null
      pick_backorder_sinds: string; pick_backorder_reden: string | null
      orders: { order_nr: string; debiteuren?: { naam: string | null } | null }
    }
    return {
      order_regel_id: r.id, order_id: r.order_id, order_nr: r.orders.order_nr,
      klant_naam: r.orders.debiteuren?.naam ?? null, omschrijving: r.omschrijving,
      orderaantal: r.orderaantal, pick_backorder_sinds: r.pick_backorder_sinds,
      pick_backorder_reden: r.pick_backorder_reden,
    }
  })
}

export async function backorderOpnieuwVersturen(orderRegelId: number): Promise<void> {
  const { error } = await supabase.rpc('backorder_opnieuw_versturen', { p_order_regel_id: orderRegelId })
  if (error) throw new Error(`Opnieuw versturen mislukt: ${error.message}`)
}

export async function annuleerPickBackorder(orderRegelId: number, reden: string | null): Promise<void> {
  const { error } = await supabase.rpc('annuleer_pick_backorder', { p_order_regel_id: orderRegelId, p_reden: reden })
  if (error) throw new Error(`Annuleren mislukt: ${error.message}`)
}
```

- [ ] **Step 2: Schrijf de hooks**

```typescript
// frontend/src/modules/orders/hooks/use-backorder.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { annuleerPickBackorder, backorderOpnieuwVersturen, fetchBackorderRegels } from '../queries/backorder'

export function useBackorderRegels() {
  return useQuery({ queryKey: ['backorder'], queryFn: fetchBackorderRegels, staleTime: 30_000 })
}

function useBackorderMutatie(fn: (id: number, reden: string | null) => Promise<void>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderRegelId, reden }: { orderRegelId: number; reden?: string | null }) =>
      fn(orderRegelId, reden ?? null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backorder'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
    },
  })
}

export function useBackorderOpnieuwVersturen() {
  return useBackorderMutatie((id) => backorderOpnieuwVersturen(id))
}
export function useAnnuleerPickBackorder() {
  return useBackorderMutatie(annuleerPickBackorder)
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/orders/queries/backorder.ts frontend/src/modules/orders/hooks/use-backorder.ts
git commit -m "feat(backorder): queries + hooks"
```

---

## Task 8: Backorder-tab component

**Files:**
- Create: `frontend/src/modules/orders/components/backorder-tab.tsx`

**Referentie:** lees `frontend/src/modules/magazijn/components/pick-problemen-banner.tsx` voor de lijst-render-stijl en een bestaande order-detail-widget (bv. `frontend/src/components/orders/debiteur-bevestigen-widget.tsx`) voor de actie-knop-stijl.

- [ ] **Step 1: Schrijf de component**

```tsx
// frontend/src/modules/orders/components/backorder-tab.tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PackageX, RotateCcw, XCircle, ExternalLink } from 'lucide-react'
import { useAnnuleerPickBackorder, useBackorderOpnieuwVersturen, useBackorderRegels } from '../hooks/use-backorder'

export function BackorderTab() {
  const { data: regels = [], isLoading } = useBackorderRegels()
  const opnieuw = useBackorderOpnieuwVersturen()
  const annuleer = useAnnuleerPickBackorder()
  const [annuleerId, setAnnuleerId] = useState<number | null>(null)
  const [reden, setReden] = useState('')

  if (isLoading) return <div className="text-sm text-slate-500">Backorder laden…</div>
  if (regels.length === 0)
    return (
      <div className="rounded-[var(--radius)] border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        <PackageX className="mx-auto mb-2 text-slate-300" size={28} />
        Geen backorder-regels. Alles wat tijdens het picken niet gevonden werd verschijnt hier.
      </div>
    )

  return (
    <div className="space-y-2">
      {regels.map((r) => (
        <div key={r.order_regel_id} className="flex items-center gap-3 rounded-[var(--radius)] border border-amber-200 bg-amber-50/50 px-4 py-3">
          <PackageX size={18} className="shrink-0 text-amber-600" />
          <Link to={`/orders/${r.order_nr}`} className="inline-flex shrink-0 items-center gap-1 font-medium text-amber-800 hover:underline">
            {r.order_nr}<ExternalLink size={11} />
          </Link>
          {r.klant_naam && <span className="shrink-0 text-sm text-slate-600">· {r.klant_naam}</span>}
          <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{r.omschrijving ?? '—'}</span>
          {r.pick_backorder_reden && <span className="shrink-0 text-xs text-rose-600">⚠ {r.pick_backorder_reden}</span>}
          <button
            onClick={() => opnieuw.mutate({ orderRegelId: r.order_regel_id })}
            disabled={opnieuw.isPending}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <RotateCcw size={13} /> Opnieuw versturen
          </button>
          <button
            onClick={() => { setAnnuleerId(r.order_regel_id); setReden('') }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
          >
            <XCircle size={13} /> Annuleren
          </button>
        </div>
      ))}

      {annuleerId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6">
            <h3 className="mb-2 text-lg font-semibold">Backorder-regel annuleren</h3>
            <p className="mb-3 text-sm text-slate-600">
              De regel wordt definitief niet geleverd. De voorraad-claim komt vrij en de order
              kan settelen naar Verzonden als dit de laatste open regel was.
            </p>
            <textarea
              value={reden} onChange={(e) => setReden(e.target.value)} rows={2}
              placeholder="Reden (optioneel) — bv. niet meer leverbaar"
              className="mb-3 w-full rounded border border-slate-200 p-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setAnnuleerId(null)} className="text-sm text-slate-600 hover:text-slate-900">Terug</button>
              <button
                onClick={() => annuleer.mutate(
                  { orderRegelId: annuleerId, reden: reden || null },
                  { onSuccess: () => setAnnuleerId(null) },
                )}
                disabled={annuleer.isPending}
                className="rounded-[var(--radius-sm)] bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                Definitief annuleren
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verifieer de order-detail-route**

Run: `grep -rn "path.*orders/:" frontend/src/`
Expected: bevestig het route-patroon voor order-detail (bv. `/orders/:order_nr`) zodat de `Link` klopt. Pas `to={...}` aan indien het patroon afwijkt.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/orders/components/backorder-tab.tsx
git commit -m "feat(backorder): backorder-tab component"
```

---

## Task 9: Tab + teller op orders-overzicht

**Files:**
- Modify: `frontend/src/lib/supabase/queries/orders.ts`
- Modify: `frontend/src/pages/orders/orders-overview.tsx`

**Referentie:** zoek in `orders.ts` naar `filterDebiteurTeBevestigen` / `countTeBevestigenDebiteurOrders` en in `orders-overview.tsx` naar de tab-registratie van 'Debiteur te bevestigen' — spiegel dat exact voor 'Backorder'. **Belangrijk verschil:** de backorder-gate zit op `order_regels`, niet op `orders`. De teller telt **distinct orders** met ≥1 open backorder-regel.

- [ ] **Step 1: Voeg de teller-query toe in orders.ts**

```typescript
import { filterPickBackorder } from '@/lib/orders/pick-backorder'

// Bij de andere intake-tellers. Telt orders met >=1 open backorder-regel.
// Via dezelfde seam als fetchBackorderRegels — geen tweede inline filter-kopie.
export async function countBackorderOrders(): Promise<number> {
  const { data, error } = await filterPickBackorder(
    supabase.from('order_regels').select('order_id')
  )
  if (error) throw new Error(`Backorder-teller mislukt: ${error.message}`)
  return new Set((data ?? []).map((r) => (r as { order_id: number }).order_id)).size
}
```

- [ ] **Step 2: Registreer de tab in orders-overview.tsx**

Voeg een tab "Backorder" toe naast de bestaande intake-tabs (zelfde structuur als 'Debiteur te bevestigen'), met de teller uit `countBackorderOrders` en als inhoud `<BackorderTab />`. Volg de exacte tab-array-vorm die het bestand al gebruikt — lees die eerst. De tab is status-overstijgend: hij toont `<BackorderTab />` i.p.v. de gefilterde orderlijst (omdat het regel-niveau is).

```tsx
import { BackorderTab } from '@/modules/orders/components/backorder-tab'
import { countBackorderOrders } from '@/lib/supabase/queries/orders'
// ... in de tab-definitie-array, naar het patroon van de bestaande tabs:
// { key: 'backorder', label: 'Backorder', count: backorderCount, render: () => <BackorderTab /> }
// en de count via dezelfde useQuery-aanpak als de andere tellers:
// const { data: backorderCount = 0 } = useQuery({ queryKey: ['backorder-count'], queryFn: countBackorderOrders, staleTime: 30_000 })
```

- [ ] **Step 3: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: geen errors (let op de `tsc -b`-valkuil uit de memory — build compileert testprojecten).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/supabase/queries/orders.ts frontend/src/pages/orders/orders-overview.tsx
git commit -m "feat(backorder): tab + teller op orders-overzicht"
```

---

## Task 10: Pickronde-UI — niet meer blokkeren, dialog vereenvoudigen

**Files:**
- Modify: `frontend/src/modules/magazijn/queries/pickronde.ts`
- Modify: `frontend/src/modules/logistiek/components/colli-pick-vinkjes.tsx`
- Modify: `frontend/src/modules/logistiek/components/voltooi-pickronde-knop.tsx`
- Modify: `frontend/src/modules/magazijn/components/pick-problemen-banner.tsx`

- [ ] **Step 1: Vereenvoudig de pickronde-queries**

In `pickronde.ts`: vervang `markeerColliNietGevonden` (verwijder `NietGevondenModus`/`modus`) en voeg `herstelColli` toe.

```typescript
export async function markeerColliNietGevonden(args: { colliId: number; opmerking?: string | null; pickerId: number | null }): Promise<void> {
  const { error } = await supabase.rpc('markeer_colli_niet_gevonden', {
    p_zending_colli_id: args.colliId, p_opmerking: args.opmerking ?? null, p_picker_id: args.pickerId,
  })
  if (error) throw toError(error, 'Markeren niet-gevonden mislukt')
}

export async function herstelColli(colliId: number): Promise<void> {
  const { error } = await supabase.rpc('herstel_colli_pick', { p_zending_colli_id: colliId })
  if (error) throw toError(error, 'Herstellen mislukt')
}
```

Update `useMarkeerColliNietGevonden` in `use-pickronde.ts` naar de nieuwe args en voeg `useHerstelColli` toe (zelfde mutatie-vorm, invalidate `['pickronde']`).

- [ ] **Step 2: Vereenvoudig colli-pick-vinkjes.tsx**

Vervang de `NietGevondenDialog` (twee knoppen) door één directe markeer-actie met optionele opmerking, en geef een `niet_gevonden`-colli een **herstel-knop** ("Toch gevonden") i.p.v. een dode rode X. De tekst onder de lijst-kop wordt: "Markeer een colli die je niet kunt vinden — bij voltooien gaat die regel naar de Backorder-tab, de rest wordt verzonden." Verwijder de `leverModus`-prop (geen splits meer).

```tsx
// Vervang regels 93-100 (de 'Niet gevonden'-knop alleen op open) door beide acties:
{isNietGevonden ? (
  <button onClick={onHerstel} className="text-xs text-slate-500 hover:text-emerald-600">Toch gevonden</button>
) : isOpen ? (
  <button onClick={onMarkeer} className="text-xs text-slate-500 hover:text-rose-600">Niet gevonden</button>
) : null}
```

De markeer-flow wordt een lichte prompt voor de opmerking (of direct markeren met lege opmerking — kies de simpelste: één `window.prompt` of een kleine inline-textarea is acceptabel; geen twee-keuze-modal meer).

- [ ] **Step 3: Voltooi-knop niet meer disablen op niet-gevonden**

In `voltooi-pickronde-knop.tsx`: verwijder de `aantalNietGevonden > 0`-disable. Toon in plaats daarvan, als er niet-gevonden colli's zijn, een aangepast label/tooltip:

```tsx
const aantalNietGevonden = colli.filter((c) => c.pick_uitkomst === 'niet_gevonden').length
const disabled = mutate.isPending  // niet meer geblokkeerd op niet-gevonden
const label = aantalNietGevonden > 0 ? `Verzend rest & ${aantalNietGevonden} naar backorder` : 'Voltooi pickronde'
const tooltip = aantalNietGevonden > 0
  ? `${aantalNietGevonden} niet-gevonden regel(s) gaan naar de Backorder-tab; de rest wordt verzonden`
  : 'Markeer alle colli als gepickt en sluit de pickronde'
```

Gebruik `label` als knop-tekst i.p.v. de harde "Voltooi pickronde".

- [ ] **Step 4: Pick-problemen-banner verwijst naar Backorder**

In `pick-problemen-banner.tsx`: de tekst/link verwijst niet meer naar "de chef lost het op de printset-pagina op" maar naar de Backorder-tab (`/orders?tab=backorder` of de route die orders-overview gebruikt). Optioneel: deze banner kan zelfs verwijderd worden nu niet-gevonden niet meer blokkeert — maar laat 'm als zachte attentie staan en herricht de tekst.

- [ ] **Step 5: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: geen errors. Fix call-sites van de oude `markeerColliNietGevonden`-signatuur en de verwijderde `leverModus`-prop in `zending-printset.tsx` (r281-285).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/magazijn/queries/pickronde.ts frontend/src/modules/magazijn/hooks/use-pickronde.ts frontend/src/modules/logistiek/components/colli-pick-vinkjes.tsx frontend/src/modules/logistiek/components/voltooi-pickronde-knop.tsx frontend/src/modules/magazijn/components/pick-problemen-banner.tsx frontend/src/modules/logistiek/pages/zending-printset.tsx
git commit -m "feat(backorder): pickronde-UI blokkeert niet meer, vereenvoudigde dialog"
```

---

## Task 11: Documentatie

**Files:**
- Modify: `CONTEXT.md`, `CLAUDE.md`, `docs/changelog.md`, `docs/order-lifecycle.md`, `docs/database-schema.md`

- [ ] **Step 1: CONTEXT.md** — voeg de "Pick-backorder"-glossarium-term toe (zie boven, sectie Domeintaal).

- [ ] **Step 2: CLAUDE.md** — voeg een bullet onder Bedrijfsregels toe: niet-gevonden colli → Pick-backorder (mig 454), tab op orders-overzicht, twee gate-kolommen, `voltooi_pickronde` splitst af, `'splits'`-modus verwijderd. Verwijs naar dit plan.

- [ ] **Step 3: docs/changelog.md** — datum-entry met wat + waarom (de WhatsApp-melding 22-06: Richard's niet-gevonden-order liep vast).

- [ ] **Step 4: docs/order-lifecycle.md** — werk de niet-gevonden-paragraaf (r382) bij: het oude drieluik (blokkeer/splits) → nu backorder-flow.

- [ ] **Step 5: docs/database-schema.md** — voeg de drie `order_regels`-kolommen toe (r430-omgeving) + de nieuwe RPC's.

- [ ] **Step 6: Commit**

```bash
git add CONTEXT.md CLAUDE.md docs/
git commit -m "docs(backorder): CONTEXT/CLAUDE/changelog/lifecycle/schema"
```

---

## Self-Review checklist (uitvoerder draait dit na Task 11)

1. **Spec coverage:** niet-gevonden → backorder (T2), rest verzenden (T2), tab op orders-overzicht (T8/T9), annuleren (T4/T8), opnieuw versturen (T4/T8), uit Pick & Ship tot beoordeeld (T3). ✓
2. **Edge case lege zending** (alle colli niet gevonden, ZEND-2026-0093): T2 step 1 verwijdert de zending i.p.v. te flippen. ✓
3. **Type-consistentie:** `pick_backorder_sinds`/`pick_backorder_geannuleerd_op`/`pick_backorder_reden` overal identiek (DB-kolom, seam, query, RPC-param `p_order_regel_id`). ✓
4. **Deploy-volgorde:** mig 454 vóór de frontend (views + RPC's moeten live zijn). Edge functions: geen — puur DB + frontend.
5. **Enum-valkuil:** controleer de `order_event_type ADD VALUE`-transactie (T4 step 2) op staging.

---

## Openstaande aandachtspunten (niet in scope, bewust)

- **`herbereken_wacht_status` bestaan/gedrag:** geverifieerd aanwezig (mig 346/351); als de exacte naam afwijkt op de live DB, gebruik de status-afleiding die `annuleer_pickronde` (mig 398 r103) ook aanroept.
- **In-één-keer-klant-belofte:** bewust genegeerd — niet-gevonden verzendt altijd de rest (gebruikerskeuze 22-06).
- **Pakbon/factuur van de deels-verzonden zending:** ongewijzigd — de bestaande deelzending-machinerie (mig 413) dekt dit al; de backorder-regel zit niet in de zending dus niet op pakbon/factuur.
