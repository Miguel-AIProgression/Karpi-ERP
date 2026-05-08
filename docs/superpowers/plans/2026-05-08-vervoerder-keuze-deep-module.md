# Vervoerder-Keuze als deep Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maak van vervoerder-keuze één deep Module met **per-orderregel als bron-van-waarheid** en ladder `override → regel-evaluator → geen`. Klant-fallback (de kolom `edi_handelspartner_config.vervoerder_code`) vervalt — bestaande klant-keuzes worden eenmalig gemigreerd naar `vervoerder_selectie_regels`. De UI-pill `VervoerderInlineSelect` schrijft via één bulk-override-RPC en toont een typed-error-toast bij faalmodi.

**Architecture:** Vier opeenvolgende DB-migraties (data-migratie → ladder versimpelen → kolom droppen + bulk-RPC → optionele alias) plus frontend-refactor in één feature-branch. Migratie-volgorde garandeert dat de DROP COLUMN pas valt nadat alle leeskanten zijn aangepast en de data is verhuisd. Frontend gaat van 5 hooks + 4 queries naar 3 hooks + 2 queries achter de barrel; verdwenen hooks zijn shallow wrappers die divergentie veroorzaakten.

**Tech Stack:** PostgreSQL 15 (Supabase), TypeScript 5, React 19, TanStack Query 5, Vitest 1.x. Tests: Vitest voor frontend (`npm test --prefix frontend`), pgTAP-style assertions in `_shared/db-helpers.ts` of inline plpgsql-assertions in migratie zelf voor DB-laag (Karpi heeft vandaag geen aparte SQL-test-runner; assertions binnen migraties + Vitest-integratietests via Supabase-client zijn de norm — zie `factuur-pdf.test.ts` als voorbeeld).

**Bron:** [ADR-0008](../../adr/0008-vervoerder-keuze-als-deep-module.md). Architectuur-onderzoek: zie grilling-loop in conversatie 2026-05-08.

---

## File Structure

### Nieuw

| Pad | Verantwoordelijkheid |
|---|---|
| `supabase/migrations/224_vervoerder_keuze_migreer_klant_fallback.sql` | Data-migratie: INSERT in `vervoerder_selectie_regels` voor elke niet-NULL `edi_handelspartner_config.vervoerder_code`. Idempotent. |
| `supabase/migrations/225_vervoerder_keuze_versimpel_ladder.sql` | Strip klant-fallback uit alle leeskanten: RPCs uit mig 210, 219; trigger uit mig 172; stats-query uit mig 174; afhaal-skip uit mig 205. Kolom blijft nog bestaan (backward-compat-window). |
| `supabase/migrations/227_vervoerder_keuze_drop_kolom_en_bulk_rpc.sql` | `ALTER TABLE edi_handelspartner_config DROP COLUMN vervoerder_code`. `DROP FUNCTION preview_vervoerder_voor_order`. `CREATE FUNCTION set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT)`. Optionele rename-alias. |
| `frontend/src/modules/logistiek/queries/vervoerder-keuze.ts` | Nieuwe query-laag: `setOrderregelVervoerderOverride`, `setOrderVervoerderOverride` (bulk), `aggregeerVervoerderKeuzeVoorOrder` (TS pure-function). |
| `frontend/src/modules/logistiek/hooks/use-vervoerder-keuze.ts` | Nieuwe hooks: `useVervoerderKeuzeVoorOrder` (afgeleide aggregatie), `useSetOrderVervoerderOverride` (bulk). Bestaande `useEffectieveVervoerderPerOrderregel` + `useUpdateOrderregelVervoerderOverride` blijven (eventueel hernoemd). |
| `frontend/src/modules/logistiek/queries/vervoerder-keuze.test.ts` | Vitest-unittest voor `aggregeerVervoerderKeuzeVoorOrder`. |

### Verwijderd

| Pad | Reden |
|---|---|
| `frontend/src/modules/logistiek/queries/vervoerder-config.ts` | Hele file vervalt: klant-fallback bestaat niet meer. |
| `frontend/src/modules/logistiek/hooks/use-vervoerder-config.ts` | Idem; alle exports verdwijnen of verhuizen naar `use-vervoerder-keuze.ts` voor `useVervoerders` (de master-list-hook blijft, andere weg). |
| `frontend/src/modules/logistiek/hooks/use-vervoerder-per-order.ts` | Vervangen door `useVervoerderKeuzeVoorOrder`. |
| `useVervoerderPreview` (in `frontend/src/modules/logistiek/hooks/use-verzendregels.ts`) | Vervangen — preview-RPC is gedropt. |

### Gewijzigd

| Pad | Wijziging |
|---|---|
| `frontend/src/modules/logistiek/queries/orderregel-vervoerder.ts:9-24` | Type `OrderregelVervoerder`: `klant_fallback_code`-veld weg. `bron`-union: `klant_fallback` weg. |
| `frontend/src/modules/logistiek/components/vervoerder-inline-select.tsx` | Schrijft via `useSetOrderVervoerderOverride` (bulk). Voegt `onError`-toast toe. "Geen regel"-state krijgt link naar `/verzendregels`. Klant-fallback-tak verdwijnt. |
| `frontend/src/modules/logistiek/components/vervoerder-orderregel-pill.tsx` | Verwijst naar nieuwe hook-locatie indien hernoemd; gedrag ongewijzigd. |
| `frontend/src/modules/logistiek/index.ts` (barrel) | 7 exports verwijderd, 4 nieuwe exports. |
| `frontend/src/modules/logistiek/queries/vervoerders.ts:146-147` | Comment-update: het filter is op `zendingen.vervoerder_code`, niet op de EDI-tabel. Geen code-wijziging. |
| `docs/changelog.md` | Entry 2026-05-08 met breaking-change-melding. |
| `docs/architectuur.md` | Logistiek-Module-sectie aanvullen. |
| `docs/database-schema.md` | `edi_handelspartner_config.vervoerder_code` weg; ladder bij `effectieve_vervoerder_per_orderregel` versimpeld. |

### Niet wijzigen (controle-files)

| Pad | Reden |
|---|---|
| `supabase/functions/factuur-verzenden/index.ts:392` | Leest `transus_actief`/`factuur_uit`, niet `vervoerder_code`. |
| `frontend/src/lib/supabase/queries/klanten.ts:115, 221` | Lezen andere EDI-velden. **Verifieer in Task 0**. |
| `frontend/src/modules/edi/queries/edi.ts:155, 167` | EDI-config beheer. **Verifieer in Task 0**. |

---

## Phase 0 — Voorbereiding

### Task 0.1: Verifieer welke files `vervoerder_code` (versus andere kolommen) lezen

**Files:** alleen lezen.

- [ ] **Stap 1: Grep specifiek op `vervoerder_code` in combinatie met `edi_handelspartner_config`**

Run:
```bash
git grep -n "edi_handelspartner_config" -- frontend/src/lib/supabase/queries/klanten.ts frontend/src/modules/edi/queries/edi.ts
```

Expected: alleen leeskanten op `transus_actief`, `order_in`, `orderbev_uit`, `factuur_uit`, `verzend_uit`, `test_modus`, `notities`, `orderbev_format`. **Geen** `vervoerder_code`.

- [ ] **Stap 2: Bevestig in plan**

Als wél `vervoerder_code` voorkomt in deze files: voeg ze toe aan "Gewijzigd" tabel boven en update Phase 5 met extra task. Anders: ga door.

- [ ] **Stap 3: Commit (geen wijzigingen — alleen verificatie)**

Geen commit; deze task is een checkpoint.

---

## Phase 1 — DB-migratie 224: data-migratie naar verzendregels

> **Migratie-nummering:** bezet zijn 220-223. Volgende vrije nummers zijn 224, 225, 226 — die deze keten gebruikt. Verifieer met `ls supabase/migrations/22[4-6]*.sql` voor je begint.

> **Canonieke huidige body van `effectieve_vervoerder_per_orderregel`** zit in [`221_orderregel_vervoerder_is_locked.sql`](../../../supabase/migrations/221_orderregel_vervoerder_is_locked.sql) — niet in mig 219. Mig 221 voegt het `is_locked BOOLEAN`-returnveld toe (UI-pill leest dit voor RESTRICT-trigger-feedback). Phase 2 moet die body als basis nemen en het `is_locked`-veld behouden.

### Task 1.1: Schrijf migratie 224 — auto-genereer `vervoerder_selectie_regels` uit klant-fallbacks

**Files:**
- Create: `supabase/migrations/224_vervoerder_keuze_migreer_klant_fallback.sql`

- [ ] **Stap 1: Schrijf migratie-bestand**

```sql
-- Migratie 224: vervoerder-keuze — migreer klant-fallback naar verzendregels
--
-- ADR-0008: klant-fallback vervalt; regel-engine wordt leidend.
--
-- Voor elke debiteur met een niet-NULL `edi_handelspartner_config.vervoerder_code`
-- maken we één rij in `vervoerder_selectie_regels` met conditie
-- `{debiteur_nrs: [debiteur_nr]}` en prio 9000 (laag — specifiekere regels op
-- land/gewicht/inkoopgroep gaan voor; klant-default is laatste keuze voor regel
-- "matcht").
--
-- Idempotent: gebruikt unieke notitie-marker om dubbele inserts te voorkomen
-- bij hertesten of als migratie meerdere keren draait.
--
-- Geen schema-wijziging in deze migratie — kolom `vervoerder_code` blijft nog
-- bestaan tot migratie 225.

DO $$
DECLARE
  v_aantal INTEGER;
BEGIN
  -- Voorwaarde: tabellen + kolommen bestaan (idempotent guard).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'edi_handelspartner_config'
       AND column_name = 'vervoerder_code'
  ) THEN
    RAISE NOTICE 'Mig 224: kolom edi_handelspartner_config.vervoerder_code bestaat niet meer — migratie wordt overgeslagen';
    RETURN;
  END IF;

  -- Auto-genereer regels uit niet-NULL klant-fallbacks die nog niet zijn gemigreerd.
  INSERT INTO vervoerder_selectie_regels (vervoerder_code, prio, conditie, actief, notitie, service_code)
  SELECT
    ehc.vervoerder_code,
    9000,
    jsonb_build_object('debiteur_nrs', jsonb_build_array(ehc.debiteur_nr)),
    TRUE,
    'Auto-gemigreerd uit klant-fallback (ADR-0008, mig 224) — debiteur ' || ehc.debiteur_nr,
    NULL
  FROM edi_handelspartner_config ehc
  JOIN vervoerders v ON v.code = ehc.vervoerder_code
  WHERE ehc.vervoerder_code IS NOT NULL
    -- Idempotentie: zoek bestaande regel met exact deze conditie + notitie-marker.
    AND NOT EXISTS (
      SELECT 1 FROM vervoerder_selectie_regels vsr
       WHERE vsr.vervoerder_code = ehc.vervoerder_code
         AND vsr.conditie = jsonb_build_object('debiteur_nrs', jsonb_build_array(ehc.debiteur_nr))
         AND vsr.notitie LIKE 'Auto-gemigreerd uit klant-fallback%'
    );

  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RAISE NOTICE 'Mig 224: % verzendregels aangemaakt uit klant-fallbacks', v_aantal;
END
$$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Stap 2: Apply migratie lokaal (Supabase CLI of via MCP) en verifieer ROW_COUNT**

Run:
```bash
# Of via supabase CLI
supabase db push --include-all
# Verifieer:
psql "$KARPI_DB_URL" -c "SELECT COUNT(*) FROM vervoerder_selectie_regels WHERE notitie LIKE 'Auto-gemigreerd uit klant-fallback%';"
```

Expected: count gelijk aan `SELECT COUNT(*) FROM edi_handelspartner_config WHERE vervoerder_code IS NOT NULL`.

- [ ] **Stap 3: Idempotentie-test — geautomatiseerd binnen de migratie zelf**

Voeg onderaan de migratie een assertion-blok toe (DO-block met RAISE EXCEPTION als invariant breekt). Dit zorgt dat herhaling van mig 224 in welke omgeving dan ook geen duplicaten oplevert:

```sql
-- Idempotentie-assertie: aantal auto-gemigreerde regels mag MAX 1× per debiteur zijn.
DO $$
DECLARE
  v_dups INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dups FROM (
    SELECT conditie->'debiteur_nrs', vervoerder_code, COUNT(*) AS n
      FROM vervoerder_selectie_regels
     WHERE notitie LIKE 'Auto-gemigreerd uit klant-fallback%'
     GROUP BY 1, 2
    HAVING COUNT(*) > 1
  ) sub;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'Mig 224: idempotentie-fout — % duplicaat-rijen in vervoerder_selectie_regels', v_dups;
  END IF;
END
$$;
```

Run mig 224 opnieuw via `psql -f` of `supabase db push`. Expected: tweede run = 0 nieuwe rijen, geen exception. Als exception wel valt: er is iets mis met de NOT EXISTS-guard in de hoofd-INSERT.

- [ ] **Stap 4: Verifieer dat `effectieve_vervoerder_per_orderregel` nu via regels matcht**

Pak één debiteur uit de gemigreerde set die geen andere matchende regels heeft. Roep:
```sql
SELECT * FROM effectieve_vervoerder_per_orderregel(
  (SELECT id FROM orders WHERE debiteur_nr = <X> AND status NOT IN ('Verzonden','Geannuleerd') LIMIT 1)
);
```

Expected: `bron = 'regel'` met `evaluator_code` gelijk aan de gemigreerde vervoerder. (Vóór mig 224: dit is via klant-fallback nóg dezelfde uitkomst — beide takken werken nu, regel komt eerst.)

- [ ] **Stap 5: Commit**

```bash
git add supabase/migrations/224_vervoerder_keuze_migreer_klant_fallback.sql
git commit -m "feat(vervoerder-keuze): mig 224 — migreer klant-fallback naar verzendregels (ADR-0008)"
```

---

## Phase 2 — DB-migratie 225: ladder versimpelen in alle leeskanten

### Task 2.1: Schrijf migratie 225 — strip klant-fallback uit RPCs en triggers

**Files:**
- Create: `supabase/migrations/225_vervoerder_keuze_versimpel_ladder.sql`

- [ ] **Stap 1: Lees de huidige bodies van de te wijzigen RPCs**

> **Belangrijk:** de canonieke body van `effectieve_vervoerder_per_orderregel` zit in **mig 221** — niet in mig 219. Mig 221 doet `DROP FUNCTION` + `CREATE OR REPLACE` met een extra `is_locked BOOLEAN`-returnveld. Neem mig 221 als startpunt; behoud `is_locked` in de signature en in elk `RETURN QUERY SELECT`.

Files om te lezen:
- [`supabase/migrations/221_orderregel_vervoerder_is_locked.sql`](../../../supabase/migrations/221_orderregel_vervoerder_is_locked.sql) **(canonieke body — primaire bron)**
- [`supabase/migrations/210_selecteer_vervoerder_via_regels.sql`](../../../supabase/migrations/210_selecteer_vervoerder_via_regels.sql) — `selecteer_vervoerder_voor_zending`
- [`supabase/migrations/172_zending_trigger.sql`](../../../supabase/migrations/172_zending_trigger.sql) — zending-trigger
- [`supabase/migrations/174_vervoerder_instellingen.sql`](../../../supabase/migrations/174_vervoerder_instellingen.sql) — stats-query/view
- [`supabase/migrations/205_afhalen_skip_vervoerder.sql`](../../../supabase/migrations/205_afhalen_skip_vervoerder.sql) — afhaal-skip
- (Mig 219 als historische referentie; mig 221 vervangt die volledig.)

Voor elke: noteer welke regels lezen uit `edi_handelspartner_config.vervoerder_code` of `ehc.vervoerder_code`.

**Files die NIET wijzigen** (verifieer met `git grep "ehc.vervoerder_code\|edi_handelspartner_config.*vervoerder_code"` na lezen):
- `supabase/migrations/222_zending_bundeling_op_adres.sql` — bundelt op adres+vervoerder via `zendingen.vervoerder_code`, leest geen ehc.
- `supabase/migrations/223_facturatie_event_listener.sql` — facturatie-trigger, raakt geen vervoerder-keuze.
- `supabase/functions/factuur-verzenden/index.ts:392` — leest `transus_actief`/`factuur_uit`, niet `vervoerder_code`.

- [ ] **Stap 2: Schrijf migratie-bestand met `CREATE OR REPLACE` voor elke geraakte RPC**

```sql
-- Migratie 225: vervoerder-keuze — versimpel ladder (klant-fallback weg)
--
-- ADR-0008: vervoerder-keuze leeft per orderregel; ladder wordt
--   override → regel-evaluator → geen
-- Klant-fallback (kolom `edi_handelspartner_config.vervoerder_code`) wordt na
-- mig 224 gedupliceerd in `vervoerder_selectie_regels` en kan dus uit alle
-- leeskanten weg. De kolom zelf blijft nog bestaan; dropt pas in mig 227.
--
-- Geraakte RPCs/triggers (CREATE OR REPLACE — geen schema-wijziging):
--   1. selecteer_vervoerder_voor_zending (mig 210)
--   2. effectieve_vervoerder_per_orderregel (mig 219)
--   3. zending-trigger uit mig 172 (als die klant-fallback leest)
--   4. vervoerder-stats-query uit mig 174
--   5. afhaal-skip uit mig 205 (als die klant-fallback leest)

-- ============================================================================
-- 1. effectieve_vervoerder_per_orderregel — `klant_fallback_code` veld + tak weg
--    BEHOUD: `is_locked BOOLEAN` (mig 221). DROP+CREATE want return-shape wijzigt.
-- ============================================================================
DROP FUNCTION IF EXISTS effectieve_vervoerder_per_orderregel(BIGINT);

CREATE OR REPLACE FUNCTION effectieve_vervoerder_per_orderregel(p_order_id BIGINT)
RETURNS TABLE (
  orderregel_id        BIGINT,
  override_code        TEXT,
  evaluator_code       TEXT,
  evaluator_service    TEXT,
  effectief_code       TEXT,
  effectief_service    TEXT,
  bron                 TEXT,
  is_locked            BOOLEAN,
  uitleg               JSONB
) AS $$
DECLARE
  v_afhalen          BOOLEAN;
  v_debiteur_nr      INTEGER;
  v_regel            RECORD;
  v_attr             RECORD;
  v_match_regel      RECORD;
  v_eval_uitleg      JSONB;
  v_eval_code        TEXT;
  v_eval_service     TEXT;
  v_is_locked        BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  SELECT o.afhalen, o.debiteur_nr
    INTO v_afhalen, v_debiteur_nr
    FROM orders o WHERE o.id = p_order_id;

  -- Afhalen-orders: geen vervoerder, ongeacht override of evaluator.
  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN QUERY
    SELECT
      ore.id,
      ore.vervoerder_code,
      NULL::TEXT, NULL::TEXT,
      NULL::TEXT, NULL::TEXT,
      'afhalen'::TEXT,
      EXISTS (SELECT 1 FROM zending_regel zr WHERE zr.order_regel_id = ore.id),
      jsonb_build_object('reden', 'afhalen')
    FROM order_regels ore
    WHERE ore.order_id = p_order_id
      AND COALESCE(ore.orderaantal, 0) > 0
      AND COALESCE(ore.artikelnr, '') <> 'VERZEND';
    RETURN;
  END IF;

  FOR v_regel IN
    SELECT id, vervoerder_code
      FROM order_regels
     WHERE order_id = p_order_id
       AND COALESCE(orderaantal, 0) > 0
       AND COALESCE(artikelnr, '') <> 'VERZEND'
     ORDER BY id
  LOOP
    -- Lock-status: regel zit al in een zending (RESTRICT-trigger blokkeert update).
    SELECT EXISTS (SELECT 1 FROM zending_regel zr WHERE zr.order_regel_id = v_regel.id)
      INTO v_is_locked;
    SELECT * INTO v_attr
      FROM evalueer_orderregel_attributes(v_regel.id);

    v_eval_code := NULL;
    v_eval_service := NULL;
    v_eval_uitleg := jsonb_build_object(
      'strategie',         'regels_v2_per_orderregel',
      'orderregel_id',     v_regel.id,
      'land',              v_attr.afl_land,
      'kleinste_zijde_cm', v_attr.kleinste_zijde_cm,
      'totaal_gewicht_kg', v_attr.totaal_gewicht_kg,
      'debiteur_nr',       v_attr.debiteur_nr,
      'inkoopgroep',       v_attr.inkoopgroep_code
    );

    FOR v_match_regel IN
      SELECT vsr.id, vsr.vervoerder_code, vsr.prio, vsr.conditie,
             vsr.service_code, vsr.notitie
        FROM vervoerder_selectie_regels vsr
        JOIN vervoerders v ON v.code = vsr.vervoerder_code
       WHERE vsr.actief = TRUE
         AND v.actief    = TRUE
       ORDER BY vsr.prio ASC, vsr.id ASC
    LOOP
      IF matcht_regel(
           v_match_regel.conditie,
           v_attr.afl_land,
           v_attr.kleinste_zijde_cm,
           v_attr.totaal_gewicht_kg,
           v_attr.debiteur_nr,
           v_attr.inkoopgroep_code
         )
      THEN
        v_eval_code := v_match_regel.vervoerder_code;
        v_eval_service := v_match_regel.service_code;
        v_eval_uitleg := v_eval_uitleg || jsonb_build_object(
          'match_regel_id', v_match_regel.id,
          'match_prio',     v_match_regel.prio,
          'match_conditie', v_match_regel.conditie,
          'match_notitie',  v_match_regel.notitie
        );
        EXIT;
      END IF;
    END LOOP;

    IF v_eval_code IS NULL THEN
      v_eval_uitleg := v_eval_uitleg || jsonb_build_object('reden', 'geen_matchende_regel');
    END IF;

    -- Effectieve keuze + bron-bepaling — KLANT-FALLBACK-TAK WEG.
    IF v_regel.vervoerder_code IS NOT NULL THEN
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_regel.vervoerder_code, NULL::TEXT,
        'override'::TEXT,
        v_is_locked,
        v_eval_uitleg || jsonb_build_object('bron', 'override');
    ELSIF v_eval_code IS NOT NULL THEN
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        v_eval_code, v_eval_service,
        'regel'::TEXT,
        v_is_locked,
        v_eval_uitleg || jsonb_build_object('bron', 'regel');
    ELSE
      RETURN QUERY SELECT
        v_regel.id,
        v_regel.vervoerder_code,
        v_eval_code, v_eval_service,
        NULL::TEXT, NULL::TEXT,
        'geen'::TEXT,
        v_is_locked,
        v_eval_uitleg || jsonb_build_object('bron', 'geen');
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION effectieve_vervoerder_per_orderregel(BIGINT) TO authenticated;

COMMENT ON FUNCTION effectieve_vervoerder_per_orderregel(BIGINT) IS
  'Mig 224 (na ADR-0008): per-orderregel-resolver. Ladder: override > regel > '
  'geen. Klant-fallback bestaat niet meer als aparte ladder-bron — bestaande '
  'klant-keuzes leven sinds mig 224 als verzendregels met conditie '
  '{debiteur_nrs: [X]} en prio 9000.';

-- ============================================================================
-- 2. selecteer_vervoerder_voor_zending — klant-fallback-tak weg
-- ============================================================================
-- [Lezer: voer hier `CREATE OR REPLACE` uit op basis van de huidige body in
-- mig 210, met de klant-fallback-SELECT en bijbehorende IF-tak verwijderd.
-- Houd de signature en de regel-loop intact.]

-- ============================================================================
-- 3. zending-trigger uit mig 172 — als die ehc.vervoerder_code leest
-- ============================================================================
-- [Lezer: zelfde patroon — CREATE OR REPLACE FUNCTION ... met klant-fallback
-- weg. Als die niets leest uit ehc.vervoerder_code: skip en notuleer.]

-- ============================================================================
-- 4. vervoerder-stats uit mig 174
-- ============================================================================
-- [Lezer: pas de stats-query/view aan zodat hij niet meer JOINt op
-- ehc.vervoerder_code. In plaats daarvan: tel zendingen per
-- vervoerder via zendingen.vervoerder_code, of tel actieve verzendregels
-- per vervoerder.]

-- ============================================================================
-- 5. afhaal-skip uit mig 205 — als die ehc.vervoerder_code leest
-- ============================================================================
-- [Lezer: vermoedelijk leest mig 205 alleen orders.afhalen om de zending te
-- skippen. Verifieer; als ehc.vervoerder_code wel gelezen wordt: strip de
-- referentie. Anders: skip in deze migratie.]

NOTIFY pgrst, 'reload schema';
```

> **Implementatie-instructie:** in stap 2 zijn de RPCs onder `2.`, `3.`, `4.`, `5.` **placeholder-blokken** — je MOET de huidige body uit de genoemde migraties lezen voordat je hier het CREATE OR REPLACE schrijft. Strip elke regel die `ehc.vervoerder_code` leest of `klant_fallback`-vars zet/leest. Behoud overige logica letterlijk.
>
> **Tip voor bite-size:** behandel elke RPC (1, 2, 3, 4, 5) als losse mentale sub-task — lees die body, schrijf de gestripte versie, run typecheck-equivalent (`supabase db reset` of `psql -c \\df+`). Commit pas aan eind van stap 5 zodat de migratie atomair landt.

- [ ] **Stap 2b: Schrijf de placeholders uit op basis van actuele bodies**

Lees in volgorde:
1. `supabase/migrations/210_selecteer_vervoerder_via_regels.sql` — vind de body van `selecteer_vervoerder_voor_zending`. Verwijder klant-fallback-SELECT (vermoedelijk `SELECT vervoerder_code INTO v_klant_fallback FROM edi_handelspartner_config WHERE debiteur_nr = ...`) en de bijbehorende `ELSIF v_klant_fallback IS NOT NULL THEN ...`-tak. Plak resultaat in plaats van placeholder.
2. `supabase/migrations/172_zending_trigger.sql` — controleer of trigger ehc.vervoerder_code leest. Zo ja: strip. Zo nee: zet een commentaar `-- Mig 172-trigger leest geen vervoerder_code → geen wijziging in deze migratie`.
3. `supabase/migrations/174_vervoerder_instellingen.sql` — vermoedelijk een view of RPC die `aantal_klanten` per vervoerder telt via `edi_handelspartner_config.vervoerder_code`. Vervang door een count uit `vervoerder_selectie_regels` (waar `conditie ? 'debiteur_nrs'` AND `vervoerder_code = X`) — of laat `aantal_klanten`-veld vervallen als de stats-pagina het niet meer toont. Beslis op basis van actuele view-body.
4. `supabase/migrations/205_afhalen_skip_vervoerder.sql` — verifieer en strip indien nodig.

- [ ] **Stap 3: Apply migratie + run de bestaande integration-paden**

Run:
```bash
supabase db push
# Smoke-test: roep effectieve-RPC voor een order, controleer dat bron-veld
# nooit meer 'klant_fallback' is.
psql "$KARPI_DB_URL" -c "
  SELECT DISTINCT bron FROM (
    SELECT (effectieve_vervoerder_per_orderregel(o.id)).bron
      FROM orders o
     WHERE status NOT IN ('Verzonden','Geannuleerd')
     LIMIT 200
  ) sub;
"
```

Expected: `bron`-waardes alleen uit `{override, regel, afhalen, geen}`. Geen `klant_fallback`.

- [ ] **Stap 4: Verifieer dat de uitkomst voor vroegere klant-fallback-orders nu via regel komt**

Pak dezelfde test-order uit Task 1.1 stap 4. Roep:
```sql
SELECT bron, evaluator_code, effectief_code FROM effectieve_vervoerder_per_orderregel(<order_id>);
```

Expected: `bron = 'regel'`, `evaluator_code` is de oude klant-fallback-vervoerder.

- [ ] **Stap 5: Commit**

```bash
git add supabase/migrations/225_vervoerder_keuze_versimpel_ladder.sql
git commit -m "refactor(vervoerder-keuze): mig 225 — strip klant-fallback uit RPCs (ADR-0008)"
```

---

## Phase 3 — DB-migratie 227: drop kolom + nieuwe bulk-RPC

> **Mig-nummer-shift:** mig 226 was bezet door een uncommitted facturatie-drain-cron-hotfix op dezelfde branch. De vervoerder-keuze-slot-migratie kreeg daarom 227. Keten loopt nu: mig 224 (data-migratie) → mig 225 (ladder versimpelen) → **mig 227** (drop kolom + bulk-RPC).

### Task 3.0: Verificatie-checkpoint — geen lezer meer op `ehc.vervoerder_code`

> **Veiligheids-gate:** voer deze task **vóór** mig 227 toe te passen. Als nog ergens iets leest, faalt mig 227 of breekt productie.

- [ ] **Stap 1: Grep over álle code-locaties die runnen tegen de database**

```bash
git grep -nE "edi_handelspartner_config.*vervoerder_code|ehc\.vervoerder_code" \
  -- supabase/migrations/ supabase/functions/ frontend/src/
```

Expected: **alleen** treffers in mig 224 (data-migratie WHERE-clause met `IS NOT NULL`-guard) en mig 225 (geen — daar moeten alle leeskanten gestripped zijn) en deze plan-file. Anders: stop, voeg ontbrekende strip toe in mig 225.

- [ ] **Stap 2: Run de bestaande test-suite tegen de huidige DB-state**

```bash
npm run test:run --prefix frontend
```

Expected: groen. Als één test faalt op een impliciete leeskant (bv. een view die `ehc.vervoerder_code` JOINt): los op vóór door te gaan.

- [ ] **Stap 3: Geen commit (verificatie-checkpoint)**

### Task 3.1: Schrijf migratie 227 — DROP COLUMN + bulk-override-RPC + drop preview-RPC

**Files:**
- Create: `supabase/migrations/227_vervoerder_keuze_drop_kolom_en_bulk_rpc.sql`

- [ ] **Stap 1: Schrijf migratie-bestand**

```sql
-- Migratie 227: vervoerder-keuze — drop klant-fallback-kolom + bulk-override-RPC
--
-- ADR-0008. Volgt op mig 224 (data-migratie) en mig 225 (ladder versimpelen).
-- Pas op DIT moment is het veilig om de kolom te droppen — alle leeskanten
-- gebruiken sinds mig 225 geen ehc.vervoerder_code meer.
--
-- LOCK-WAARSCHUWING: ALTER TABLE … DROP COLUMN pakt een AccessExclusiveLock op
-- edi_handelspartner_config voor de duur van de operatie. De tabel is klein
-- (39 partner-rijen) dus de DROP zelf is sub-seconde, maar tijdens busy hours
-- (EDI-poll-cycli) kan een korte wachtrij ontstaan. Optionele veiligheidsklep:
-- zet eerst `SET LOCAL lock_timeout = '3s'` zodat we falen ipv hangen als
-- iemand een lange transactie heeft openstaan.
--
-- Stappen:
--   1. DROP de oude index + kolom edi_handelspartner_config.vervoerder_code
--   2. DROP function preview_vervoerder_voor_order (mig 215) — vervangen door
--      frontend-aggregatie van effectieve_vervoerder_per_orderregel
--   3. CREATE function set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT)
--      — bulk-override met respect voor lock-trigger uit mig 219; returnt typed
--      info over geblokkeerde regels.

-- ============================================================================
-- 1. Drop kolom + index — met lock_timeout-veiligheidsklep
-- ============================================================================
SET LOCAL lock_timeout = '3s';

DROP INDEX IF EXISTS idx_edi_handelspartner_vervoerder;

ALTER TABLE edi_handelspartner_config
  DROP COLUMN IF EXISTS vervoerder_code;

-- ============================================================================
-- 2. Drop preview-RPC
-- ============================================================================
DROP FUNCTION IF EXISTS preview_vervoerder_voor_order(BIGINT);

-- ============================================================================
-- 3. Bulk-override-RPC voor de inline-pill op order-niveau
-- ============================================================================
CREATE OR REPLACE FUNCTION set_orderregel_vervoerder_override_voor_order(
  p_order_id        BIGINT,
  p_vervoerder_code TEXT
)
RETURNS TABLE (
  orderregel_id BIGINT,
  resultaat     TEXT,  -- 'gezet' | 'geblokkeerd_door_zending' | 'overgeslagen_afhalen'
  reden         TEXT
) AS $$
DECLARE
  v_afhalen      BOOLEAN;
  v_regel        RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Order % bestaat niet', p_order_id;
  END IF;

  -- Validatie: vervoerder bestaat (als niet-NULL).
  IF p_vervoerder_code IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM vervoerders WHERE code = p_vervoerder_code) THEN
    RAISE EXCEPTION 'Vervoerder % bestaat niet', p_vervoerder_code;
  END IF;

  SELECT o.afhalen INTO v_afhalen FROM orders o WHERE o.id = p_order_id;
  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN QUERY SELECT
      NULL::BIGINT, 'overgeslagen_afhalen'::TEXT, 'Order is afhalen — geen vervoerder zetten'::TEXT;
    RETURN;
  END IF;

  -- Per-regel: probeer override te zetten; trigger blokkeert geblokkeerde regels.
  FOR v_regel IN
    SELECT id FROM order_regels
     WHERE order_id = p_order_id
       AND COALESCE(orderaantal, 0) > 0
       AND COALESCE(artikelnr, '') <> 'VERZEND'
     ORDER BY id
  LOOP
    BEGIN
      UPDATE order_regels
         SET vervoerder_code = p_vervoerder_code
       WHERE id = v_regel.id;
      orderregel_id := v_regel.id;
      resultaat     := 'gezet';
      reden         := NULL;
      RETURN NEXT;
    EXCEPTION
      WHEN restrict_violation THEN
        orderregel_id := v_regel.id;
        resultaat     := 'geblokkeerd_door_zending';
        reden         := SQLERRM;
        RETURN NEXT;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT) TO authenticated;

COMMENT ON FUNCTION set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT) IS
  'Mig 225 (ADR-0008): bulk-override van vervoerder voor alle regels van een '
  'order in één transactie. Respecteert lock-trigger uit mig 219 — geblokkeerde '
  'regels worden teruggegeven met resultaat=''geblokkeerd_door_zending'', niet '
  'als exception. UI gebruikt dit om de operator te tonen welke regels niet '
  'konden (al in een open zending). NULL als p_vervoerder_code wist de '
  'override (terug naar regel-evaluator).';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Stap 2: Apply migratie + smoke-test bulk-RPC happy path**

Run:
```bash
supabase db push
psql "$KARPI_DB_URL" -c "
  -- Pak een test-order zonder open zending
  SELECT * FROM set_orderregel_vervoerder_override_voor_order(
    (SELECT id FROM orders
       WHERE status = 'Nieuw'
         AND afhalen = FALSE
         AND id IN (SELECT order_id FROM order_regels GROUP BY order_id HAVING COUNT(*) > 0)
       LIMIT 1),
    'DPD'
  );
"
```

Expected: een rij per orderregel met `resultaat = 'gezet'`. Daarna:
```sql
SELECT vervoerder_code FROM order_regels WHERE order_id = <order_id>;
```

Expected: alle regels op `'DPD'`.

- [ ] **Stap 3: Smoke-test geblokkeerde-regel-pad**

```sql
-- Pak een orderregel die in een open zending zit
SELECT * FROM set_orderregel_vervoerder_override_voor_order(
  (SELECT order_id FROM zending_regel zr
     JOIN zendingen z ON z.id = zr.zending_id
    WHERE z.status IN ('Picken','Ingepakt','Klaar voor verzending')
    LIMIT 1),
  'UPS'
);
```

Expected: minimaal één rij met `resultaat = 'geblokkeerd_door_zending'` en niet-lege `reden`. Geen exception.

- [ ] **Stap 4: Verifieer dat preview-RPC weg is**

```sql
SELECT proname FROM pg_proc WHERE proname = 'preview_vervoerder_voor_order';
```

Expected: 0 rijen.

- [ ] **Stap 5: Verifieer dat kolom weg is**

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'edi_handelspartner_config'
   AND column_name = 'vervoerder_code';
```

Expected: 0 rijen.

- [ ] **Stap 6: Commit**

```bash
git add supabase/migrations/227_vervoerder_keuze_drop_kolom_en_bulk_rpc.sql
git commit -m "feat(vervoerder-keuze): mig 227 — drop klant-fallback-kolom, bulk-override-RPC (ADR-0008)"
```

---

## Phase 4 — Frontend types + queries

### Task 4.1: Update type `OrderregelVervoerder` — `klant_fallback_code` veld weg

**Files:**
- Modify: `frontend/src/modules/logistiek/queries/orderregel-vervoerder.ts:9-24`

- [ ] **Stap 1: Verwijder `klant_fallback_code` uit interface en `klant_fallback` uit bron-union**

> **Behoud `is_locked: boolean`** — dat veld is in mig 221 aan de RPC toegevoegd en wordt door mig 225 behouden. Niet weghalen.

Edit:
```typescript
// orderregel-vervoerder.ts (ca. regel 9-26)
export interface OrderregelVervoerder {
  orderregel_id: number
  override_code: string | null
  evaluator_code: string | null
  evaluator_service: string | null
  effectief_code: string | null
  effectief_service: string | null
  bron: 'override' | 'regel' | 'geen' | 'afhalen'
  is_locked: boolean
  uitleg: Record<string, unknown> | null
}
```

Wijzigingen t.o.v. huidige versie: regel `klant_fallback_code: string | null` verwijderen, en `'klant_fallback'` uit de bron-union halen. **`is_locked: boolean` moet blijven staan.**

- [ ] **Stap 2: TypeCheck draaien**

Run:
```bash
npm run typecheck --prefix frontend
```

Expected: errors in alle files die `klant_fallback_code` of `bron === 'klant_fallback'` raken. Noteer de lijst — die behandel je in Phase 5/6.

- [ ] **Stap 3: Commit**

Nog niet committen — wacht tot Phase 5/6 de TS-fouten zijn opgeruimd, dan in één samenhangende commit. Tot die tijd lokaal blijven.

### Task 4.2: Maak nieuwe query-laag `vervoerder-keuze.ts`

**Files:**
- Create: `frontend/src/modules/logistiek/queries/vervoerder-keuze.ts`

- [ ] **Stap 1: Schrijf de write-functie + aggregatie-helper**

```typescript
// frontend/src/modules/logistiek/queries/vervoerder-keuze.ts
import { supabase } from '@/lib/supabase/client'
import type { OrderregelVervoerder } from './orderregel-vervoerder'

export interface BulkOverrideResultaat {
  orderregel_id: number | null
  resultaat: 'gezet' | 'geblokkeerd_door_zending' | 'overgeslagen_afhalen'
  reden: string | null
}

/**
 * Zet de override-vervoerder op alle regels van een order in één transactie.
 * NULL als `vervoerderCode` wist de override (terug naar regel-evaluator).
 *
 * Returnt per regel of het gelukt is. Geblokkeerde regels (al in een open
 * zending) komen terug als `resultaat='geblokkeerd_door_zending'` — geen
 * exception. UI moet die rijen aan de operator tonen.
 */
export async function setOrderVervoerderOverride(
  orderId: number,
  vervoerderCode: string | null,
): Promise<BulkOverrideResultaat[]> {
  const { data, error } = await supabase.rpc('set_orderregel_vervoerder_override_voor_order', {
    p_order_id: orderId,
    p_vervoerder_code: vervoerderCode,
  })
  if (error) throw error
  return (data ?? []) as BulkOverrideResultaat[]
}

/**
 * Aggregatie-helper: leid de order-niveau "vervoerder-keuze" af uit de
 * per-orderregel-uitkomsten. Pure functie — testbaar zonder DB.
 *
 * - Alle regels gelijk (incl. NULL → NULL) → `'uniform'` met die code
 * - Mix van codes (incl. NULL) → `'mix'` met de unieke codes erbij
 * - Geen regels → `'leeg'`
 */
export type OrderVervoerderAggregaat =
  | { soort: 'leeg' }
  | { soort: 'uniform'; code: string | null; bron: OrderregelVervoerder['bron'] }
  | { soort: 'mix'; codes: Array<string | null> }

export function aggregeerVervoerderKeuzeVoorOrder(
  perRegel: OrderregelVervoerder[],
): OrderVervoerderAggregaat {
  if (perRegel.length === 0) return { soort: 'leeg' }
  const codes = Array.from(new Set(perRegel.map((r) => r.effectief_code)))
  if (codes.length === 1) {
    return { soort: 'uniform', code: codes[0], bron: perRegel[0].bron }
  }
  return { soort: 'mix', codes }
}
```

- [ ] **Stap 2: Run typecheck**

Run: `npm run typecheck --prefix frontend`

Expected: deze file alleen — geen import-errors.

### Task 4.3: Schrijf unittest voor `aggregeerVervoerderKeuzeVoorOrder`

> **TDD-volgorde:** strikt genomen had de test vóór de implementatie in Task 4.2 moeten staan. Pragmatische correctie: voer dit als sub-stap **vóór** Task 4.2-stap-1 uit (test bestaat → faalt met "module niet gevonden") en verifieer dat na Task 4.2-stap-1 de test slaagt. Als je dit lineair leest, draai gewoon eerst de test-file aan zonder implementatie en bevestig FAIL.

**Files:**
- Create: `frontend/src/modules/logistiek/queries/vervoerder-keuze.test.ts`

- [ ] **Stap 0: Verifieer dat test FAALT zonder implementatie**

Run (vóór Task 4.2 commit): `npm test --prefix frontend -- vervoerder-keuze.test`

Expected: FAIL met `Cannot find module './vervoerder-keuze'` of `aggregeerVervoerderKeuzeVoorOrder is not a function`. Daarna ga je terug naar Task 4.2 om de implementatie te schrijven.

- [ ] **Stap 1: Schrijf failing test**

```typescript
// frontend/src/modules/logistiek/queries/vervoerder-keuze.test.ts
import { describe, expect, it } from 'vitest'
import { aggregeerVervoerderKeuzeVoorOrder } from './vervoerder-keuze'
import type { OrderregelVervoerder } from './orderregel-vervoerder'

function maakRegel(over: Partial<OrderregelVervoerder> = {}): OrderregelVervoerder {
  return {
    orderregel_id: 1,
    override_code: null,
    evaluator_code: null,
    evaluator_service: null,
    effectief_code: null,
    effectief_service: null,
    bron: 'geen',
    uitleg: null,
    ...over,
  }
}

describe('aggregeerVervoerderKeuzeVoorOrder', () => {
  it('returnt soort=leeg voor 0 regels', () => {
    expect(aggregeerVervoerderKeuzeVoorOrder([])).toEqual({ soort: 'leeg' })
  })

  it('returnt soort=uniform als alle regels dezelfde code hebben', () => {
    const regels = [
      maakRegel({ orderregel_id: 1, effectief_code: 'DPD', bron: 'regel' }),
      maakRegel({ orderregel_id: 2, effectief_code: 'DPD', bron: 'regel' }),
    ]
    expect(aggregeerVervoerderKeuzeVoorOrder(regels)).toEqual({
      soort: 'uniform',
      code: 'DPD',
      bron: 'regel',
    })
  })

  it('returnt soort=uniform met code=null als alle regels NULL effectief hebben', () => {
    const regels = [
      maakRegel({ orderregel_id: 1, effectief_code: null, bron: 'geen' }),
      maakRegel({ orderregel_id: 2, effectief_code: null, bron: 'geen' }),
    ]
    expect(aggregeerVervoerderKeuzeVoorOrder(regels)).toEqual({
      soort: 'uniform',
      code: null,
      bron: 'geen',
    })
  })

  it('returnt soort=mix met unieke codes als regels verschillen', () => {
    const regels = [
      maakRegel({ orderregel_id: 1, effectief_code: 'DPD', bron: 'regel' }),
      maakRegel({ orderregel_id: 2, effectief_code: 'UPS', bron: 'regel' }),
      maakRegel({ orderregel_id: 3, effectief_code: 'DPD', bron: 'regel' }),
    ]
    const result = aggregeerVervoerderKeuzeVoorOrder(regels)
    expect(result.soort).toBe('mix')
    if (result.soort === 'mix') {
      expect(result.codes.sort()).toEqual(['DPD', 'UPS'])
    }
  })

  it('returnt soort=mix als deel NULL en deel een code heeft', () => {
    const regels = [
      maakRegel({ orderregel_id: 1, effectief_code: 'DPD', bron: 'regel' }),
      maakRegel({ orderregel_id: 2, effectief_code: null, bron: 'geen' }),
    ]
    const result = aggregeerVervoerderKeuzeVoorOrder(regels)
    expect(result.soort).toBe('mix')
  })
})
```

- [ ] **Stap 2: Run test, verwacht PASS**

Run: `npm test --prefix frontend -- vervoerder-keuze.test`

Expected: 5 PASS.

- [ ] **Stap 3: Commit**

```bash
git add frontend/src/modules/logistiek/queries/vervoerder-keuze.ts \
        frontend/src/modules/logistiek/queries/vervoerder-keuze.test.ts \
        frontend/src/modules/logistiek/queries/orderregel-vervoerder.ts
git commit -m "feat(vervoerder-keuze): query-laag + aggregatie-helper + tests (ADR-0008)"
```

---

## Phase 5 — Frontend hooks

### Task 5.1: Maak nieuwe hooks `use-vervoerder-keuze.ts`

**Files:**
- Create: `frontend/src/modules/logistiek/hooks/use-vervoerder-keuze.ts`

- [ ] **Stap 1: Schrijf de hooks**

```typescript
// frontend/src/modules/logistiek/hooks/use-vervoerder-keuze.ts
import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  aggregeerVervoerderKeuzeVoorOrder,
  setOrderVervoerderOverride,
  type BulkOverrideResultaat,
} from '../queries/vervoerder-keuze'
import { useEffectieveVervoerderPerOrderregel } from './use-orderregel-vervoerder'

/**
 * Order-niveau "vervoerder-keuze" — afgeleide aggregatie van per-regel-resolver.
 * Geen eigen netwerk-call: hergebruikt query-key van per-regel-hook (cache-deelt).
 */
export function useVervoerderKeuzeVoorOrder(orderId: number | null | undefined) {
  const perRegel = useEffectieveVervoerderPerOrderregel(orderId)
  const aggregaat = useMemo(
    () => aggregeerVervoerderKeuzeVoorOrder(perRegel.data ?? []),
    [perRegel.data],
  )
  return {
    ...perRegel,
    aggregaat,
  }
}

/**
 * Bulk-override: zet de vervoerder op alle regels van een order tegelijk.
 * Roept de DB-RPC aan; per-regel-resultaten worden teruggegeven (geblokkeerde
 * regels komen als typed resultaat, niet als exception).
 */
export function useSetOrderVervoerderOverride() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      orderId,
      vervoerderCode,
    }: {
      orderId: number
      vervoerderCode: string | null
    }) => setOrderVervoerderOverride(orderId, vervoerderCode),
    onSuccess: (_data, vars) => {
      // Alle "vervoerder-views" verversen — één centrale invalidator.
      qc.invalidateQueries({ queryKey: ['logistiek', 'orderregel-vervoerder', vars.orderId] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'orderregel-vervoerder'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'zending-printset'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'zending'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
    },
  })
}

export type { BulkOverrideResultaat }
```

- [ ] **Stap 2: Run typecheck**

Run: `npm run typecheck --prefix frontend`

Expected: alleen import-errors uit oude consumers (Phase 6 ruimt die op).

- [ ] **Stap 3: Verifieer dat de hardcoded cache-key-lijst compleet is**

> Originele bug: cache-invalidatie was incompleet. Voorkom regressie.

Run:
```bash
git grep -nE "queryKey:\s*\[\s*'(logistiek|pick-ship)'" -- frontend/src/ | grep -E "vervoerder|orderregel-vervoerder|zending|pick-ship" | sort -u
```

Vergelijk de output met de 6 invalidatie-keys in `useSetOrderVervoerderOverride.onSuccess`. Elke gevonden key die "vervoerder-data" toont in de UI **moet** worden geinvalideerd. Voeg ontbrekende toe.

Expected (minimaal): `['logistiek', 'orderregel-vervoerder']`, `['logistiek', 'zending-printset']`, `['logistiek', 'zending']`, `['logistiek', 'zendingen']`, `['pick-ship']`. Plus de batch-key `['logistiek', 'vervoerder-config-batch', ...]` als die hook nog bestaat.

### Task 5.2: Verwijder `use-vervoerder-config.ts` en `use-vervoerder-per-order.ts`

**Files:**
- Delete: `frontend/src/modules/logistiek/hooks/use-vervoerder-config.ts`
- Delete: `frontend/src/modules/logistiek/hooks/use-vervoerder-per-order.ts`
- Delete: `frontend/src/modules/logistiek/queries/vervoerder-config.ts`

- [ ] **Stap 1: Lees beide files volledig om callers te identificeren**

Run:
```bash
git grep -nE "useKlantVervoerderConfig|useUpsertKlantVervoerderConfig|useVervoerderPerOrder|useVervoerders[^F]|fetchKlantVervoerderConfig|upsertKlantVervoerderConfig|updateZendingVervoerderVoorOrder" -- frontend/src/
```

Expected: een lijst met callers — `vervoerder-inline-select.tsx`, `bulk-verzendset-button.tsx`, `vervoerder-orderregel-pill.tsx`, eventueel andere. Noteer ze allemaal.

- [ ] **Stap 2: Verifieer dat `useVervoerders` (master-list) ook in `use-vervoerders.ts` bestaat**

Run:
```bash
git grep -n "export.*useVervoerders" -- frontend/src/modules/logistiek/hooks/
```

Expected: bestaat in zowel `use-vervoerder-config.ts` (te verwijderen versie) als in `use-vervoerders.ts` (Fase A — mig 174-versie). Beide retourneren ongeveer dezelfde lijst maar de mig 174-versie is vollediger. Plan: het volledigere `use-vervoerders.ts` blijft canoniek.

- [ ] **Stap 3: Verwijder de drie files**

Run:
```bash
rm frontend/src/modules/logistiek/hooks/use-vervoerder-config.ts
rm frontend/src/modules/logistiek/hooks/use-vervoerder-per-order.ts
rm frontend/src/modules/logistiek/queries/vervoerder-config.ts
```

- [ ] **Stap 4: TypeCheck — verwacht een lijst aan errors voor callers**

Run: `npm run typecheck --prefix frontend`

Expected: errors voor alle callers uit stap 1. Phase 6 ruimt ze op.

- [ ] **Stap 5: Verwijder `useVervoerderPreview` uit `use-verzendregels.ts`**

Edit `frontend/src/modules/logistiek/hooks/use-verzendregels.ts` — verwijder de hele export van `useVervoerderPreview` (~regels 70-78). De hook hoort daar conceptueel niet meer thuis nu de preview-RPC weg is.

- [ ] **Stap 6: Run typecheck opnieuw**

Run: `npm run typecheck --prefix frontend`

Expected: extra errors voor callers van `useVervoerderPreview`. Hoofdcaller: `vervoerder-inline-select.tsx`.

Geen commit nu — wacht op Phase 6.

---

## Phase 6 — Frontend components refactor

### Task 6.1: Refactor `VervoerderInlineSelect` — bulk-override + onError-toast + "Geen regel"-affordance

**Files:**
- Modify: `frontend/src/modules/logistiek/components/vervoerder-inline-select.tsx`

- [ ] **Stap 1: Lees de huidige file integraal en herstructureer**

Vervang de hele body. Sleutel-wijzigingen t.o.v. huidige versie:

1. **Props**: `debiteurNr` parameter wordt **optioneel** (alleen nog gebruikt voor "afhalen-detectie via order"; eigenlijk pak je dat al via order-data — overweeg helemaal weg). `orderId` wordt **verplicht** (geen klant-default-modus meer).
2. **Effectieve-keuze-bron**: gebruikt `useVervoerderKeuzeVoorOrder(orderId)`. De ladder `regel-preview > klant > globaal-actief` wordt: `aggregaat van per-regel`.
3. **Pill-label**:
   - `aggregaat.soort === 'uniform'` met `code !== null` → toon vervoerder-naam (`getVervoerderDef(code).displayNaam`).
   - `aggregaat.soort === 'uniform'` met `code === null` → toon "Geen regel" + waarschuwingsicoon (amber); klikbaar om bulk-override te zetten.
   - `aggregaat.soort === 'mix'` → toon "Mix · {3-letter-codes joined met '+'}", paarse-tint achtergrond.
   - `aggregaat.soort === 'leeg'` → toon "—" (order zonder regels).
4. **Klik → bulk-override**: `handleKies(code)` roept `useSetOrderVervoerderOverride().mutate({ orderId, vervoerderCode: code })`.
5. **`onError`**: toon **inline foutbanner** onder de pill (de codebase heeft géén toast-library — bevestigd via `git grep -lE "toast|Toast|sonner" frontend/src/`). Gebruik lokale state `const [foutmelding, setFoutmelding] = useState<string | null>(null)` en render een `<div role="alert" className="absolute mt-1 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{foutmelding}</div>` die na 5s zichzelf wist (`useEffect` met `setTimeout`). Geen externe dependency. **Hard-eis** voor de bug-fix: zonder zichtbare foutmelding zwaluwt de DPD-bug terug.
6. **Geblokkeerde-regel-feedback**: na success-mutation, als response array rijen bevat met `resultaat === 'geblokkeerd_door_zending'`, zet `foutmelding` op `"${N} regels konden niet — staan al in open zending"`. Inline waarschuwing met amber-styling i.p.v. rood.
7. **Dropdown-content**: vervang "Klant-fallback (gebruikt bij geen regel-match)" door "Bulk-override op alle regels". Verwijder de "Geen voorkeur (regels gebruiken)"-sectie en vervang door "Override wissen (terug naar regels)" → roept bulk-override met `null`.
8. **"Regel-keuze"-banner bovenin de dropdown**: blijft, maar gevuld vanuit `aggregaat` als die `soort === 'uniform'` && `bron === 'regel'`.
9. **"Geen regel matcht"-banner**: blijft, met link naar `/verzendregels` (al aanwezig).

Schrijf de nieuwe component-body in deze stap.

- [ ] **Stap 2: Run typecheck**

Run: `npm run typecheck --prefix frontend`

Expected: alleen errors uit andere callers van verwijderde hooks (geen errors meer in deze file).

### Task 6.2: Update `VervoerderOrderregelPill` — nieuwe hook-import-paden

**Files:**
- Modify: `frontend/src/modules/logistiek/components/vervoerder-orderregel-pill.tsx`

- [ ] **Stap 1: Lees huidige file en update imports**

Geen functionele wijziging — alleen imports updaten als het type `OrderregelVervoerder` of de hook hernoemd is. `klant_fallback`-bron-tak (als die in UI bestaat) verwijderen.

- [ ] **Stap 2: Run typecheck**

Expected: file is clean.

### Task 6.3: Update `bulk-verzendset-button.tsx` als die `useVervoerderPerOrder` gebruikte

**Files:**
- Modify (mogelijk): `frontend/src/modules/logistiek/components/bulk-verzendset-button.tsx`

- [ ] **Stap 1: Vervang `useVervoerderPerOrder` door `useVervoerderKeuzeVoorOrder` of een batch-equivalent**

Voor de bulk-knop: was de oude hook batch (één call voor N orders)? Zo ja: maak een eenvoudige helper die N keer `useVervoerderKeuzeVoorOrder` aanroept of doe één DB-call die per order de aggregatie doet (later optimaliseren). Voor V1 acceptabel: per-order TS-aggregatie via N hook-instances.

Als bulk-knop alleen aantal-zending-preview toont → gebruik `aggregaat.soort` + `codes.length` voor preview.

- [ ] **Stap 2: Run typecheck**

Expected: clean.

### Task 6.4: Run alle frontend-tests

- [ ] **Stap 1: Run hele suite**

```bash
npm run test:run --prefix frontend
```

Expected: 0 failures. Snapshot-tests of integration-tests die "vervoerder_code" of "klant-fallback" controleren moeten gefixt zijn — als er nog falen, los op of update snapshot in dezelfde commit.

- [ ] **Stap 2: Run typecheck + lint**

```bash
npm run typecheck --prefix frontend
npm run lint --prefix frontend
```

Expected: 0 errors.

- [ ] **Stap 3: Commit Phase 4-6 als één samenhangende refactor**

```bash
git add frontend/src/modules/logistiek/
git commit -m "refactor(vervoerder-keuze): frontend — bulk-override hook + pill-refactor (ADR-0008)

- Verwijder useKlantVervoerderConfig/useUpsertKlantVervoerderConfig/
  useVervoerderPerOrder/useVervoerderPreview (shallow wrappers).
- Nieuwe hooks: useVervoerderKeuzeVoorOrder (afgeleide aggregatie),
  useSetOrderVervoerderOverride (bulk-RPC).
- VervoerderInlineSelect schrijft via bulk-override met typed-error feedback;
  'Geen regel'-state met link naar /verzendregels; 'Mix'-state voor
  multi-vervoerder-orders (geen liegende pill meer).
- aggregeerVervoerderKeuzeVoorOrder als pure functie + Vitest-tests.

Ref ADR-0008."
```

---

## Phase 7 — Module-barrel + cleanup

### Task 7.1: Update `modules/logistiek/index.ts`

**Files:**
- Modify: `frontend/src/modules/logistiek/index.ts`

- [ ] **Stap 1: Verwijder verwijderde exports en voeg nieuwe toe**

```typescript
// Verwijderen uit barrel:
//   - fetchKlantVervoerderConfig, upsertKlantVervoerderConfig
//   - useKlantVervoerderConfig, useUpsertKlantVervoerderConfig
//   - useVervoerders (uit use-vervoerder-config — useVervoerdersFull blijft als
//     canoniek master-list)
//   - useVervoerderPerOrder, OrderMinimaalVoorVervoerder, ResolvedVervoerder
//
// Toevoegen aan barrel:
//   - useVervoerderKeuzeVoorOrder, useSetOrderVervoerderOverride
//   - aggregeerVervoerderKeuzeVoorOrder (pure helper, optional export)
//   - BulkOverrideResultaat (type)
//   - OrderVervoerderAggregaat (type)
```

- [ ] **Stap 2: Hernoem `useVervoerdersFull` → `useVervoerders` (optioneel)**

Als de "Full"-suffix bedoeld was om naam-conflict met de oude shallow-versie te vermijden: nu de oude weg is, kan de canonieke hook gewoon `useVervoerders` heten. Doe dit in een aparte commit zodat de rename-impact zichtbaar is.

- [ ] **Stap 3: Run typecheck + tests**

```bash
npm run typecheck --prefix frontend
npm run test:run --prefix frontend
```

Expected: 0 errors, 0 failures.

- [ ] **Stap 4: Commit**

```bash
git add frontend/src/modules/logistiek/index.ts
git commit -m "refactor(vervoerder-keuze): barrel-update — verwijder shallow exports (ADR-0008)"
```

### Task 7.2: Comment-fix in `vervoerders.ts:146-147`

**Files:**
- Modify: `frontend/src/modules/logistiek/queries/vervoerders.ts:144-150`

- [ ] **Stap 1: Vervang misleidende comment**

```typescript
/**
 * Recente zendingen die via deze vervoerder lopen.
 *
 * Bron: filter direct op `zendingen.vervoerder_code`. (Vóór ADR-0008 stond hier
 * een opmerking over een join via edi_handelspartner_config — die kolom
 * bestaat niet meer; de query gebruikt sinds altijd zendingen-direct.)
 */
```

- [ ] **Stap 2: Commit**

```bash
git add frontend/src/modules/logistiek/queries/vervoerders.ts
git commit -m "docs(vervoerder-keuze): correctie comment vervoerders.ts (ADR-0008)"
```

---

## Phase 8 — Documentatie

### Task 8.1: Changelog-entry

**Files:**
- Modify: `docs/changelog.md`

- [ ] **Stap 1: Voeg entry voor 2026-05-08 toe (boven aan)**

```markdown
## 2026-05-08 — Vervoerder-Keuze als deep Module (ADR-0008)

**Migraties 224-226** + frontend-refactor.

- **Klant-fallback vervalt**: kolom `edi_handelspartner_config.vervoerder_code`
  gedropt. Bestaande klant-keuzes auto-gemigreerd naar `vervoerder_selectie_regels`
  met conditie `{debiteur_nrs: [X]}` en prio 9000.
- **Ladder versimpeld**: `override → regel-evaluator → geen` (was: 4 niveaus
  met klant-fallback). RPCs `effectieve_vervoerder_per_orderregel` (mig 219),
  `selecteer_vervoerder_voor_zending` (mig 210) en de stats-query uit mig 174
  gestripped.
- **Nieuwe RPC**: `set_orderregel_vervoerder_override_voor_order(BIGINT, TEXT)`
  voor bulk-override op alle regels van een order; respecteert lock-trigger uit
  mig 219 en returnt typed feedback over geblokkeerde regels.
- **Preview-RPC weg**: `preview_vervoerder_voor_order` (mig 215) gedropt;
  vervangen door TS-aggregatie van per-regel-resolver — geen "liegende pill"
  meer bij multi-vervoerder-orders.
- **Frontend**: `VervoerderInlineSelect` schrijft nu via bulk-RPC met
  error-toast en "Geen regel"-affordance. 4 shallow hooks verwijderd
  (`useKlantVervoerderConfig`, `useUpsertKlantVervoerderConfig`,
  `useVervoerderPerOrder`, `useVervoerderPreview`). 2 nieuwe hooks toegevoegd
  (`useVervoerderKeuzeVoorOrder`, `useSetOrderVervoerderOverride`).

**Breaking change** in publieke barrel `@/modules/logistiek` — zie ADR-0008
voor volledige in/out-lijst.
```

### Task 8.2: Architectuur-doc bijwerken

**Files:**
- Modify: `docs/architectuur.md`

- [ ] **Stap 1: Logistiek-Module-sectie aanvullen**

Zoek de sectie over `modules/logistiek/` (vermoedelijk een lijst Modules met hun publieke interface). Voeg toe:

> **Vervoerder-Keuze (sub-domein van Logistiek-Module)** — bron-van-waarheid is `order_regels.vervoerder_code` (override) + `vervoerder_selectie_regels` (regel-engine). Order-niveau is een afgeleide aggregatie. Centraal RPC `effectieve_vervoerder_per_orderregel`. Zie ADR-0008.

### Task 8.3: Database-schema bijwerken

**Files:**
- Modify: `docs/database-schema.md`

- [ ] **Stap 1: Verwijder `vervoerder_code` uit `edi_handelspartner_config`-tabel-beschrijving**

- [ ] **Stap 2: Update beschrijving van `effectieve_vervoerder_per_orderregel` — ladder is 3-niveau, geen `klant_fallback_code`-veld meer**

- [ ] **Stap 3: Voeg `set_orderregel_vervoerder_override_voor_order` toe aan RPC-overzicht**

- [ ] **Stap 4: Verwijder `preview_vervoerder_voor_order` uit RPC-overzicht**

- [ ] **Stap 5: Commit alle docs in één commit**

```bash
git add docs/changelog.md docs/architectuur.md docs/database-schema.md
git commit -m "docs(vervoerder-keuze): changelog + architectuur + schema (ADR-0008)"
```

---

## Phase 9 — Eind-verificatie + integratie-test

### Task 9.1: End-to-end smoke-test in dev-omgeving

- [ ] **Stap 1: Start dev-server**

```bash
npm run dev --prefix frontend
```

- [ ] **Stap 2: Reproduceer originele bug-scenario**

In browser:
1. Ga naar `/pick-ship` of equivalent (de pagina met OrderPickCard).
2. Pak een order met "Kies"-pill (FLOORPASSION WEBSHOP / SB MÖBEL BOSS / vergelijkbaar zonder regel-match).
3. Klik pill → kies DPD.
4. Verifieer dat:
   - Pill-label binnen 1s wijzigt naar "DPD".
   - Bij re-render (page reload) nog steeds "DPD" toont.
   - Bij uitklappen van de order alle regels op DPD staan in de orderregel-pill.

- [ ] **Stap 3: Test geblokkeerde-regel-pad**

1. Pak een order die al in een open zending zit (status `Picken` of `Klaar voor verzending`).
2. Klik pill → kies een andere vervoerder.
3. Verifieer toast met "X regels konden niet worden bijgewerkt".
4. Verifieer dat de niet-geblokkeerde regels wél zijn bijgewerkt.

- [ ] **Stap 4: Test "Geen regel"-affordance**

1. Pak een order zonder matchende regel én zonder gemigreerde klant-regel.
2. Verifieer pill toont "Geen regel" (amber).
3. Klik link "naar verzendregels" — ga naar `/verzendregels`.
4. Voeg regel toe; ga terug; verifieer dat pill nu de nieuwe regel-keuze toont.

- [ ] **Stap 5: Test multi-vervoerder-order ("Mix"-state)**

Indien er een order is met regels die verschillende vervoerders matchen (bv. één klein pakje + één pallet):
1. Verifieer pill toont "Mix · {codes}".
2. Verifieer dat `start_pickronden_voor_order` (verzendset-knop) twee aparte zendingen aanmaakt — één per code.

### Task 9.2: Final commit + branch-status

- [ ] **Stap 1: Run alle tests + lint + typecheck nog één keer**

```bash
npm run test:run --prefix frontend
npm run typecheck --prefix frontend
npm run lint --prefix frontend
```

Expected: alles groen.

- [ ] **Stap 2: Verifieer git-status schoon en migraties op volgorde**

```bash
git status
git log --oneline main..HEAD
ls supabase/migrations/22[4-6]*.sql
```

Expected: schoon werkdir, commit-historie matched de phases, mig 224 → 225 → 226 in volgorde.

- [ ] **Stap 3: Update `MEMORY.md` (auto-memory) als de architectuur-keuze waardevol is voor toekomstige sessies**

(De ADR is canoniek. Memory-entry is alleen nuttig als de werkstijl-conclusie ("regels leidend, klant-fallback vervallen") zelf een terugkerende voorkeur is. Skip als geen patroon.)

---

## Buiten scope (backlog)

- Service-keuze (`gekozen_service_code`) als eigen bulk-override-RPC. Vandaag wordt service alleen tijdens zending-aanmaak vastgesteld via de regel-evaluator; aparte ADR als operators ook handmatig service willen overrulen.
- Zending-niveau "wisselen van vervoerder na pickronde-start". Lock-trigger uit mig 219 blokkeert dit nu hard. Aparte ADR als operator dat in V2 wel wil kunnen (waarschijnlijk met annulering + nieuwe pickronde-flow).
- Hernoemen `effectieve_vervoerder_per_orderregel` → `vervoerder_keuze_per_orderregel` voor lexicale consistentie. Niet load-bearing; uitvoerbaar als losse PR met DB-alias + frontend-rename.
- Cache-invalidatie via één centrale helper (`invalidateVervoerderViews(qc, orderId)`) i.p.v. inline lijst in elke mutation. Pas relevant als er een derde mutation-hook bijkomt.
