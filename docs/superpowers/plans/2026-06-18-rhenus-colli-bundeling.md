# Colli-bundeling bij Rhenus — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een magazijnmedewerker kan binnen één Rhenus-zending meerdere colli handmatig samenpakken onder één nieuwe SSCC-sticker; alleen die bundel-SSCC + de niet-gebundelde colli worden bij Rhenus aangemeld.

**Architecture:** Een bundel is een extra rij in `zending_colli` met een eigen SSCC en een zelf-FK (`bundel_colli_id`) waarmee de gebundelde kind-colli naar de bundel-rij wijzen. Overal waar colli gelezen worden (carrier-XML-seam + label-expansie) geldt één filter: negeer rijen met `bundel_colli_id IS NOT NULL`. De Rhenus-aanmelding wordt na pickronde-voltooiing vastgehouden voor zendingen met ≥2 colli (data-vlag `vervoerders.handmatig_aanmelden`) tot de operator op zending-detail bundelt en "Aanmelden bij Rhenus" klikt.

**Tech Stack:** Supabase (PostgreSQL/plpgsql migraties, edge functions in Deno/TypeScript), React 18 + TypeScript + TanStack Query + Vitest, Deno-tests voor `_shared`.

**Spec:** [`docs/superpowers/specs/2026-06-17-rhenus-colli-bundeling-design.md`](../specs/2026-06-17-rhenus-colli-bundeling-design.md)

**Branch / worktree:** `feat/rhenus-colli-bundel` in `.worktrees/rhenus-colli-bundel` (al aangemaakt).

---

## Belangrijke context vóór je begint

- **Werk uitsluitend in de worktree** `.worktrees/rhenus-colli-bundel` (branch `feat/rhenus-colli-bundel`). Niet op `main` of in de hoofd-working-tree (daar lopen andere sessies).
- **Migraties worden handmatig toegepast** (project-conventie: `supabase db push` is gevaarlijk, MCP heeft geen toegang). De SQL-migratie krijgt daarom een ingebouwde `DO`-block-verifier die bij apply een `NOTICE` logt. Het daadwerkelijk *toepassen* op de DB is een **handmatige checkpoint** (de eigenaar draait de migratie via de Supabase SQL-editor of CLI). Schrijf het migratiebestand volledig; markeer apply als checkpoint.
- **Migratienummer:** dit plan gebruikt **420**. `origin/main` bevat al `417_hst_productie_cutover.sql`, dus 417 is bezet; 420 is het eerstvolgende vrije nummer. **Her-verifieer het nummer nogmaals vlak vóór merge** t.o.v. `origin/main` (parallelle sessies claimen nummers — bekende collisie-historie). Als 420 ondertussen bezet is: hernoem het bestand + de comment-header.
- **Em-dash valkuil:** de bundel-stickertekst bevat een em-dash (`—`, U+2014). Schrijf die als correcte UTF-8 via de Write/Edit-tool — **nooit** via een PowerShell `-replace` (mojibake-valkuil `â€"`).
- **Eén overload, niet twee:** `enqueue_zending_naar_vervoerder(BIGINT)` moet eerst ge-`DROP`t worden vóór je de 2-arg-versie maakt — anders blijft de oude 1-arg-overload bestaan en blijft de trigger díé (zonder hold-guard) aanroepen.

---

## Task 0: Worktree-dependencies installeren

De verse worktree heeft nog geen `node_modules`; Vitest/typecheck draaien anders niet.

**Files:** geen (alleen install)

- [ ] **Step 1: Installeer frontend-dependencies in de worktree**

Run (vanuit de worktree-root):
```bash
cd ".worktrees/rhenus-colli-bundel/frontend" && npm install
```
Expected: install voltooit zonder fouten (kan enkele minuten duren).

- [ ] **Step 2: Sanity-check dat de bestaande tests draaien**

Run (vanuit `.worktrees/rhenus-colli-bundel/frontend`):
```bash
npm run test:run -- src/modules/logistiek/lib/printset.test.ts
```
Expected: alle bestaande `printset.test.ts`-tests PASS (baseline vóór wijziging).

---

## Task 1: Migratie 420 — datamodel, hold-vlag, RPC's, hold-guard

Bouwt het volledige DB-fundament in één migratiebestand. Secties worden incrementeel toegevoegd; de migratie wordt als geheel gecommit en (handmatig) toegepast.

**Files:**
- Create: `supabase/migrations/420_rhenus_colli_bundeling.sql`

- [ ] **Step 1: Maak het migratiebestand met §1 (kolommen) + §2 (vlag)**

Create `supabase/migrations/420_rhenus_colli_bundeling.sql`:
```sql
-- Migratie 420: colli-bundeling bij Rhenus (ADR-volgt; spec 2026-06-17).
-- Binnen één zending meerdere colli samenpakken onder één nieuwe SSCC; alleen
-- die bundel-SSCC + de niet-gebundelde colli worden bij Rhenus aangemeld.
--
-- NIET te verwarren met zending-bundeling (orders -> 1 zending, mig 222) of de
-- bundel-sleutel (mig 228-230). Dit is COLLI-bundeling, alleen voor Rhenus.
--
-- Nummer 420: her-verifieer vlak vóór merge t.o.v. origin/main (collisie-historie).
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.

-- ============================================================================
-- §1. Schema: bundel-kolommen op zending_colli + hold-vlag op vervoerders
-- ============================================================================
-- bundel_colli_id: kind-colli wijzen naar hun bundel-rij. ON DELETE SET NULL zodat
-- een bundel-rij verwijderen de kinderen automatisch ontbundelt (geen cascade-delete!).
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS bundel_colli_id BIGINT
  REFERENCES zending_colli(id) ON DELETE SET NULL;
ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS is_bundel BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_zending_colli_bundel ON zending_colli (bundel_colli_id);

COMMENT ON COLUMN zending_colli.bundel_colli_id IS
  'Zelf-FK: kind-colli die in een bundel zitten wijzen naar de bundel-rij. '
  'NULL = niet gebundeld (normale colli of zelf een bundel-rij). Carrier-XML en '
  'label-expansie negeren rijen waar dit NOT NULL is.';
COMMENT ON COLUMN zending_colli.is_bundel IS
  'TRUE = synthetische bundel-rij (eigen SSCC, gewicht=som, maat=max van de kinderen). '
  'Alleen voor handmatig-aanmelden-vervoerders (Rhenus).';

-- Data-driven hold: een vervoerder met handmatig_aanmelden=TRUE meldt een
-- multi-colli-zending niet automatisch aan; de operator geeft handmatig vrij.
ALTER TABLE vervoerders ADD COLUMN IF NOT EXISTS handmatig_aanmelden BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN vervoerders.handmatig_aanmelden IS
  'TRUE = zending met >=2 colli wordt na pickronde-voltooiing vastgehouden op '
  '''Klaar voor verzending'' tot de operator handmatig vrijgeeft (colli-bundeling, '
  'spec 2026-06-17). 1-colli zendingen gaan altijd automatisch door.';

-- ============================================================================
-- §2. Zet de vlag voor Rhenus
-- ============================================================================
UPDATE vervoerders SET handmatig_aanmelden = TRUE WHERE code = 'rhenus_sftp';
```

- [ ] **Step 2: Voeg §3 toe — `maak_colli_bundel`**

Append to the file:
```sql
-- ============================================================================
-- §3. RPC: maak_colli_bundel — voeg N colli samen tot 1 bundel-rij (eigen SSCC)
-- ============================================================================
CREATE OR REPLACE FUNCTION maak_colli_bundel(
  p_zending_id BIGINT,
  p_colli_ids  BIGINT[],
  p_gewicht_kg NUMERIC DEFAULT NULL,
  p_lengte_cm  INTEGER DEFAULT NULL,
  p_breedte_cm INTEGER DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
  v_status          TEXT;
  v_vervoerder      TEXT;
  v_handmatig       BOOLEAN;
  v_aantal_kinderen INTEGER;
  v_valid_count     INTEGER;
  v_gewicht         NUMERIC;
  v_lengte          INTEGER;
  v_breedte         INTEGER;
  v_volgnr          INTEGER;
  v_bundel_id       BIGINT;
BEGIN
  SELECT z.status, z.vervoerder_code INTO v_status, v_vervoerder
    FROM zendingen z WHERE z.id = p_zending_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id; END IF;

  IF v_status <> 'Klaar voor verzending' THEN
    RAISE EXCEPTION 'Bundelen kan alleen bij status ''Klaar voor verzending'' (zending % staat op %)',
      p_zending_id, v_status;
  END IF;

  SELECT handmatig_aanmelden INTO v_handmatig FROM vervoerders WHERE code = v_vervoerder;
  IF NOT COALESCE(v_handmatig, FALSE) THEN
    RAISE EXCEPTION 'Colli-bundeling is alleen toegestaan voor handmatig-aanmelden-vervoerders (zending % -> %)',
      p_zending_id, COALESCE(v_vervoerder, '(geen)');
  END IF;

  v_aantal_kinderen := COALESCE(array_length(p_colli_ids, 1), 0);
  IF v_aantal_kinderen < 2 THEN
    RAISE EXCEPTION 'Een bundel vereist minstens 2 colli (gekregen: %)', v_aantal_kinderen;
  END IF;

  -- Alle opgegeven colli moeten bij deze zending horen, zelf geen bundel zijn en
  -- nog niet gebundeld zijn.
  SELECT COUNT(*) INTO v_valid_count
    FROM zending_colli
   WHERE id = ANY(p_colli_ids)
     AND zending_id = p_zending_id
     AND is_bundel = FALSE
     AND bundel_colli_id IS NULL;
  IF v_valid_count <> v_aantal_kinderen THEN
    RAISE EXCEPTION 'Niet alle colli zijn geldig (zending %, geen bundel, nog niet gebundeld): % van % geldig',
      p_zending_id, v_valid_count, v_aantal_kinderen;
  END IF;

  -- Gewicht = som, maat = max van de kinderen; expliciete parameters winnen.
  SELECT COALESCE(p_gewicht_kg, SUM(gewicht_kg)),
         COALESCE(p_lengte_cm,  MAX(lengte_cm)),
         COALESCE(p_breedte_cm, MAX(breedte_cm))
    INTO v_gewicht, v_lengte, v_breedte
    FROM zending_colli
   WHERE id = ANY(p_colli_ids);

  IF COALESCE(v_gewicht, 0) <= 0 THEN
    RAISE EXCEPTION 'Bundel-gewicht moet > 0 zijn (Rhenus-preflight); kreeg %', v_gewicht;
  END IF;
  IF COALESCE(v_lengte, 0) <= 0 THEN
    RAISE EXCEPTION 'Bundel-lengte moet > 0 zijn (Rhenus-preflight); kreeg %', v_lengte;
  END IF;

  SELECT COALESCE(MAX(colli_nr), 0) + 1 INTO v_volgnr
    FROM zending_colli WHERE zending_id = p_zending_id;

  INSERT INTO zending_colli (
    zending_id, colli_nr, order_regel_id, rol_id, sscc, gewicht_kg,
    omschrijving_snapshot, klant_omschrijving_snapshot, lengte_cm, breedte_cm, aantal, is_bundel
  ) VALUES (
    p_zending_id, v_volgnr, NULL, NULL, genereer_sscc(), v_gewicht,
    NULL, 'BUNDEL — ' || v_aantal_kinderen || ' colli', v_lengte, v_breedte, 1, TRUE
  ) RETURNING id INTO v_bundel_id;

  UPDATE zending_colli SET bundel_colli_id = v_bundel_id WHERE id = ANY(p_colli_ids);

  RETURN v_bundel_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION maak_colli_bundel(BIGINT, BIGINT[], NUMERIC, INTEGER, INTEGER) TO authenticated;

COMMENT ON FUNCTION maak_colli_bundel IS
  'Colli-bundeling (spec 2026-06-17): maakt 1 bundel-rij in zending_colli (eigen '
  'SSCC, is_bundel=TRUE) en zet bundel_colli_id op de gekozen kind-colli. Gewicht=som, '
  'maat=max (overschrijfbaar). Alleen status ''Klaar voor verzending'' + handmatig-'
  'aanmelden-vervoerder + >=2 nog-niet-gebundelde colli.';
```

- [ ] **Step 3: Voeg §4 toe — `verwijder_colli_bundel`**

Append:
```sql
-- ============================================================================
-- §4. RPC: verwijder_colli_bundel — ontbundel (kinderen weer los)
-- ============================================================================
-- Dankzij ON DELETE SET NULL op bundel_colli_id zet het verwijderen van de
-- bundel-rij automatisch de kinderen terug op bundel_colli_id=NULL.
CREATE OR REPLACE FUNCTION verwijder_colli_bundel(p_bundel_colli_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_zending_id BIGINT;
  v_is_bundel  BOOLEAN;
  v_status     TEXT;
BEGIN
  SELECT zending_id, is_bundel INTO v_zending_id, v_is_bundel
    FROM zending_colli WHERE id = p_bundel_colli_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colli % bestaat niet', p_bundel_colli_id; END IF;
  IF NOT COALESCE(v_is_bundel, FALSE) THEN
    RAISE EXCEPTION 'Colli % is geen bundel — ontbundelen kan niet', p_bundel_colli_id;
  END IF;

  SELECT status INTO v_status FROM zendingen WHERE id = v_zending_id;
  IF v_status <> 'Klaar voor verzending' THEN
    RAISE EXCEPTION 'Ontbundelen kan alleen bij status ''Klaar voor verzending'' (zending % staat op %)',
      v_zending_id, v_status;
  END IF;

  DELETE FROM zending_colli WHERE id = p_bundel_colli_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION verwijder_colli_bundel(BIGINT) TO authenticated;

COMMENT ON FUNCTION verwijder_colli_bundel IS
  'Ontbundelt: verwijdert de bundel-rij; de kinderen worden via ON DELETE SET NULL '
  'automatisch ontkoppeld. Alleen bij status ''Klaar voor verzending''.';
```

- [ ] **Step 4: Voeg §5 toe — `enqueue_zending_naar_vervoerder` met hold-guard (DROP + recreate)**

Append (let op: volledige functie-body uit mig 380 + de twee nieuwe stukken; de oude 1-arg-versie wordt eerst gedropt):
```sql
-- ============================================================================
-- §5. Hold-guard in de dispatch. DROP de 1-arg versie zodat de trigger de nieuwe
--     2-arg versie (met default) aanroept. Body = mig 380 + handmatig_aanmelden-
--     lookup + hold-guard. Géén andere wijzigingen aan de dispatch-logica.
-- ============================================================================
DROP FUNCTION IF EXISTS enqueue_zending_naar_vervoerder(BIGINT);

CREATE OR REPLACE FUNCTION enqueue_zending_naar_vervoerder(
  p_zending_id BIGINT,
  p_handmatig  BOOLEAN DEFAULT FALSE
) RETURNS TEXT AS $$
DECLARE
  v_order_id        BIGINT;
  v_debiteur_nr     INTEGER;
  v_vervoerder_code TEXT;
  v_service_code    TEXT;
  v_keuze_uitleg    JSONB;
  v_actief          BOOLEAN;
  v_type            TEXT;
  v_handmatig_verv  BOOLEAN;
  v_aantal_colli    INTEGER;
  v_is_test         BOOLEAN := FALSE;
  v_afhalen         BOOLEAN;
BEGIN
  SELECT z.order_id, o.debiteur_nr, o.afhalen, z.vervoerder_code, z.service_code
    INTO v_order_id, v_debiteur_nr, v_afhalen, v_vervoerder_code, v_service_code
    FROM zendingen z JOIN orders o ON o.id = z.order_id
   WHERE z.id = p_zending_id;
  IF v_debiteur_nr IS NULL THEN RETURN 'no_debiteur'; END IF;

  IF COALESCE(v_afhalen, FALSE) THEN
    RETURN 'afhalen_geen_vervoerder';
  END IF;

  IF v_vervoerder_code IS NULL THEN
    SELECT s.gekozen_vervoerder_code, s.gekozen_service_code, s.keuze_uitleg
      INTO v_vervoerder_code, v_service_code, v_keuze_uitleg
      FROM selecteer_vervoerder_voor_zending(p_zending_id) s;

    UPDATE zendingen
       SET vervoerder_code            = v_vervoerder_code,
           service_code               = v_service_code,
           vervoerder_selectie_uitleg = v_keuze_uitleg
     WHERE id = p_zending_id;

    IF v_vervoerder_code IS NULL THEN
      RETURN COALESCE(v_keuze_uitleg->>'reden', 'no_vervoerder_gekozen');
    END IF;
  END IF;

  SELECT actief, type, handmatig_aanmelden INTO v_actief, v_type, v_handmatig_verv
    FROM vervoerders WHERE code = v_vervoerder_code;
  IF v_actief IS NULL OR v_actief = FALSE THEN RETURN 'vervoerder_inactief'; END IF;

  -- HOLD-GUARD (colli-bundeling): een handmatig-aanmelden-vervoerder houdt een
  -- multi-colli-zending vast tot de operator vrijgeeft (p_handmatig=TRUE). Een
  -- 1-colli-zending kan niet gebundeld worden -> gaat altijd automatisch door.
  IF NOT p_handmatig AND COALESCE(v_handmatig_verv, FALSE) THEN
    -- Tel alleen niet-gebundelde colli (bundel_colli_id IS NULL): bij de auto-trigger
    -- bestaan er nog geen bundels, dus dit = het fysieke aantal; de filter maakt de
    -- intentie expliciet en is defensief tegen een eventuele her-trigger na bundeling.
    SELECT COUNT(*) INTO v_aantal_colli
      FROM zending_colli WHERE zending_id = p_zending_id AND bundel_colli_id IS NULL;
    IF v_aantal_colli >= 2 THEN
      RETURN 'held_handmatig';
    END IF;
  END IF;

  CASE v_type
    WHEN 'api' THEN
      CASE v_vervoerder_code
        WHEN 'hst_api' THEN
          PERFORM enqueue_hst_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_hst';
        ELSE
          RAISE NOTICE 'API-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
          RETURN 'no_adapter_voor_' || v_vervoerder_code;
      END CASE;

    WHEN 'sftp' THEN
      CASE v_vervoerder_code
        WHEN 'verhoek_sftp' THEN
          PERFORM enqueue_verhoek_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_verhoek';
        WHEN 'rhenus_sftp' THEN
          PERFORM enqueue_rhenus_transportorder(p_zending_id, v_debiteur_nr, v_is_test);
          RETURN 'enqueued_rhenus';
        ELSE
          RAISE NOTICE 'SFTP-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
          RETURN 'no_adapter_voor_' || v_vervoerder_code;
      END CASE;

    WHEN 'edi' THEN
      RAISE NOTICE 'EDI-vervoerder % heeft nog geen adapter-RPC', v_vervoerder_code;
      RETURN 'no_adapter_voor_' || v_vervoerder_code;

    WHEN 'print' THEN
      PERFORM genereer_zending_colli(p_zending_id);
      RETURN 'enqueued_print';

    ELSE
      RAISE NOTICE 'Onbekend vervoerder-type %', v_type;
      RETURN 'onbekend_type_' || v_type;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION enqueue_zending_naar_vervoerder(BIGINT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION enqueue_zending_naar_vervoerder IS
  'SWITCH-POINT + hold-guard. Sinds mig 420: 2-arg (p_handmatig). Een vervoerder '
  'met handmatig_aanmelden houdt een >=2-colli-zending vast (RETURN ''held_handmatig'') '
  'tot de operator vrijgeeft (p_handmatig=TRUE, via meld_zending_handmatig_aan). '
  'De trigger roept de 1-arg-vorm aan -> resolved naar deze functie met default FALSE.';
```

- [ ] **Step 5: Voeg §6 toe — `meld_zending_handmatig_aan` (vrijgave-wrapper)**

Append:
```sql
-- ============================================================================
-- §6. RPC: meld_zending_handmatig_aan — de "Aanmelden bij Rhenus"-knop
-- ============================================================================
CREATE OR REPLACE FUNCTION meld_zending_handmatig_aan(p_zending_id BIGINT)
RETURNS TEXT AS $$
DECLARE
  v_status     TEXT;
  v_vervoerder TEXT;
  v_handmatig  BOOLEAN;
BEGIN
  SELECT z.status, z.vervoerder_code INTO v_status, v_vervoerder
    FROM zendingen z WHERE z.id = p_zending_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id; END IF;

  IF v_status <> 'Klaar voor verzending' THEN
    RAISE EXCEPTION 'Aanmelden kan alleen bij status ''Klaar voor verzending'' (zending % staat op %)',
      p_zending_id, v_status;
  END IF;

  SELECT handmatig_aanmelden INTO v_handmatig FROM vervoerders WHERE code = v_vervoerder;
  IF NOT COALESCE(v_handmatig, FALSE) THEN
    RAISE EXCEPTION 'Handmatig aanmelden is niet van toepassing op vervoerder % (zending %)',
      COALESCE(v_vervoerder, '(geen)'), p_zending_id;
  END IF;

  RETURN enqueue_zending_naar_vervoerder(p_zending_id, TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION meld_zending_handmatig_aan(BIGINT) TO authenticated;

COMMENT ON FUNCTION meld_zending_handmatig_aan IS
  'Vrijgave-knop: meldt een vastgehouden handmatig-aanmelden-zending alsnog aan bij '
  'de vervoerder (enqueue met p_handmatig=TRUE). Alleen bij ''Klaar voor verzending''.';
```

- [ ] **Step 6: Voeg §7 toe — verifier + schema-reload**

Append:
```sql
-- ============================================================================
-- §7. Verifier-rapport + PostgREST schema-reload
-- ============================================================================
DO $$
DECLARE
  v_flag BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'zending_colli' AND column_name = 'bundel_colli_id') THEN
    RAISE EXCEPTION 'Mig 420: kolom zending_colli.bundel_colli_id ontbreekt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'zending_colli' AND column_name = 'is_bundel') THEN
    RAISE EXCEPTION 'Mig 420: kolom zending_colli.is_bundel ontbreekt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'vervoerders' AND column_name = 'handmatig_aanmelden') THEN
    RAISE EXCEPTION 'Mig 420: kolom vervoerders.handmatig_aanmelden ontbreekt';
  END IF;
  SELECT handmatig_aanmelden INTO v_flag FROM vervoerders WHERE code = 'rhenus_sftp';
  RAISE NOTICE 'Mig 420 verifier: rhenus_sftp.handmatig_aanmelden = % (verwacht TRUE)', v_flag;
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 7: Commit het migratiebestand**

```bash
git add supabase/migrations/420_rhenus_colli_bundeling.sql
git commit -m "feat(rhenus): mig 420 colli-bundeling — schema, RPC's, hold-guard"
```

- [ ] **Step 8: CHECKPOINT (handmatig) — migratie toepassen + verifiëren**

De eigenaar past de migratie toe via de Supabase SQL-editor of CLI (project-conventie: handmatig). Verifieer:
- De `DO`-block geeft `NOTICE: Mig 420 verifier: rhenus_sftp.handmatig_aanmelden = t (verwacht TRUE)`.
- `SELECT handmatig_aanmelden FROM vervoerders WHERE code='rhenus_sftp';` → `t`.
- `\d zending_colli` toont `bundel_colli_id` + `is_bundel`.

Pas de volgende frontend/edge-taken bouwen de UI; die werkt pas end-to-end na deze apply.

---

## Task 2: Edge — colli-seam negeert gebundelde kinderen

De Rhenus-XML wordt gevoed door `fetchZendingColli`. Eén filter daar (`bundel_colli_id IS NULL`) zorgt dat de kinderen uit het bericht vallen en de bundel-rij (eigen SSCC) als 1 collo meegaat. De XML-builder zelf verandert niet (telt gewoon de aangeleverde colli).

**Files:**
- Modify: `supabase/functions/_shared/vervoerders/fetch-zending-colli.ts`
- Test: `supabase/functions/_shared/vervoerders/fetch-zending-colli.test.ts`

- [ ] **Step 1: Breid de test uit — mock ondersteunt `.is`, en assert de filter**

In `fetch-zending-colli.test.ts`, wijzig de mock zodat `is` een geregistreerde chain-method is. Vervang de regel:
```ts
  for (const m of ['select', 'eq', 'order']) b[m] = chain(m);
```
door:
```ts
  for (const m of ['select', 'eq', 'is', 'order']) b[m] = chain(m);
```

Voeg in de eerste test (`bevraagt de canonieke snapshot-kolommen + embed, gefilterd en gesorteerd`), ná de bestaande `assertEquals(argOf(ops, 'eq'), ['zending_id', 42]);`, toe:
```ts
  // Mig 420: gebundelde kind-colli (bundel_colli_id NOT NULL) vallen uit het
  // carrier-bericht; alleen losse colli + bundel-rijen blijven over.
  assertEquals(argOf(ops, 'is'), ['bundel_colli_id', null]);
```

- [ ] **Step 2: Run de test — verwacht FAIL**

Run (vanuit repo-root in de worktree):
```bash
deno test supabase/functions/_shared/vervoerders/fetch-zending-colli.test.ts
```
Expected: FAIL op de nieuwe assert (`is`-op niet gevonden / lege args), want de seam roept `.is()` nog niet aan.

- [ ] **Step 3: Voeg de filter toe aan de seam**

In `fetch-zending-colli.ts`, in `fetchZendingColli`, voeg `.is('bundel_colli_id', null)` toe ná `.eq('zending_id', zendingId)`:
```ts
  const { data, error } = await supabase
    .from('zending_colli')
    .select(COLLI_SELECT)
    .eq('zending_id', zendingId)
    // Mig 420: gebundelde kind-colli horen niet in het carrier-bericht; alleen
    // losse colli + bundel-rijen (die hun eigen SSCC dragen).
    .is('bundel_colli_id', null)
    .order('colli_nr', { ascending: true });
```

Werk ook de module-docstring bovenaan bij met één regel (na de bestaande achtergrond-alinea):
```ts
// Mig 420: filtert bundel_colli_id IS NULL — gebundelde kind-colli (Rhenus
// colli-bundeling) vallen uit het bericht; de bundel-rij gaat als 1 collo mee.
```

- [ ] **Step 4: Run de test — verwacht PASS**

Run:
```bash
deno test supabase/functions/_shared/vervoerders/fetch-zending-colli.test.ts
```
Expected: alle tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/vervoerders/fetch-zending-colli.ts supabase/functions/_shared/vervoerders/fetch-zending-colli.test.ts
git commit -m "feat(rhenus): colli-seam negeert gebundelde kind-colli (mig 420)"
```

> **Geen edge-deploy nu.** `rhenus-send`/`verhoek-send`/`hst-send` importeren deze seam; ze worden pas herdeployed bij de uiteindelijke uitrol (samen met de overige edge-functies). Verhoek/HST zien nooit bundels (geen `handmatig_aanmelden`), dus de filter is voor hen een no-op.

---

## Task 3: Frontend — label-expansie negeert gebundelde kinderen

`bouwVerzenddocument` voedt de geprinte labels. Dezelfde filter als de seam, plus de query haalt de twee nieuwe kolommen op.

**Files:**
- Modify: `frontend/src/modules/logistiek/queries/zendingen.ts`
- Modify: `frontend/src/modules/logistiek/lib/printset.ts`
- Test: `frontend/src/modules/logistiek/lib/printset.test.ts`

- [ ] **Step 1: Breid het type + de query uit**

In `queries/zendingen.ts`, voeg aan `interface ZendingPrintColli` (ná `klant_omschrijving_snapshot`) toe:
```ts
  /** Mig 420: zelf-FK naar de bundel-rij. NOT NULL = dit colli zit in een bundel
   *  en valt uit labels/carrier-bericht. */
  bundel_colli_id: number | null
  /** Mig 420: TRUE = synthetische bundel-rij (eigen SSCC, "BUNDEL — N colli"). */
  is_bundel: boolean
```

In `fetchZendingPrintSet`, breid de `zending_colli (...)`-select uit:
```ts
      zending_colli ( id, colli_nr, sscc, order_regel_id, omschrijving_snapshot, klant_omschrijving_snapshot, bundel_colli_id, is_bundel )
```

- [ ] **Step 2: Werk de testfixture + voeg tests toe (verwacht FAIL)**

In `printset.test.ts`, breid de `maakColli`-helper-defaults uit (ná `klant_omschrijving_snapshot: null,`):
```ts
    bundel_colli_id: null,
    is_bundel: false,
```

Voeg binnen `describe('expandLabels — SSCC-bron-van-waarheid', ...)` deze test toe:
```ts
  it('mig 420: gebundelde kind-colli vallen weg; alleen losse colli + bundel-rij krijgen een label', () => {
    const zending = maakZending({
      zending_regels: [
        maakRegel({ id: 1, order_regel_id: 10, artikelnr: 'ART-A' }),
        maakRegel({ id: 2, order_regel_id: 20, artikelnr: 'ART-B' }),
        maakRegel({ id: 3, order_regel_id: 30, artikelnr: 'ART-C' }),
      ],
      zending_colli: [
        // c1 + c2 zitten in bundel 99; c3 los; 99 = de bundel-rij
        maakColli({ id: 1, colli_nr: 1, sscc: '087159540000000656', order_regel_id: 10, bundel_colli_id: 99 }),
        maakColli({ id: 2, colli_nr: 2, sscc: '087159540000000663', order_regel_id: 20, bundel_colli_id: 99 }),
        maakColli({ id: 3, colli_nr: 3, sscc: '087159540000000670', order_regel_id: 30 }),
        maakColli({
          id: 99, colli_nr: 4, sscc: '087159540000000687', order_regel_id: null,
          is_bundel: true, klant_omschrijving_snapshot: 'BUNDEL — 2 colli',
        }),
      ],
    })

    const labels = expandLabels(zending)

    // c3 (los) + bundel-rij; de twee kinderen vallen weg.
    expect(labels.map((l) => l.sscc)).toEqual([
      '087159540000000670',
      '087159540000000687',
    ])
    const bundel = labels.find((l) => l.sscc === '087159540000000687')
    expect(bundel?.klantOmschrijvingSnapshot).toBe('BUNDEL — 2 colli')
    expect(bundel?.regel).toBeNull()
  })
```

Run (verwacht FAIL — de filter bestaat nog niet, kinderen krijgen nog labels):
```bash
npm run test:run -- src/modules/logistiek/lib/printset.test.ts
```
Expected: de nieuwe test FAALT (labels bevatten 4 i.p.v. 2 sscc's).

- [ ] **Step 3: Voeg de filter toe in `bouwVerzenddocument`**

In `printset.ts`, in `bouwVerzenddocument`, vervang het opbouwen van de colli-lijst. Zoek:
```ts
  // ── colliRijen (labels) ──────────────────────────────────────────────────
  const colli = [...(zending.zending_colli ?? [])].sort((a, b) => a.colli_nr - b.colli_nr)
```
Vervang door:
```ts
  // ── colliRijen (labels) ──────────────────────────────────────────────────
  // Mig 420: gebundelde kind-colli (bundel_colli_id != null) vallen weg uit de
  // labels — die zitten fysiek in de zak onder de bundel-sticker. De bundel-rij
  // zelf (is_bundel) draagt zijn eigen SSCC en wordt wél geprint.
  const colli = [...(zending.zending_colli ?? [])]
    .filter((c) => c.bundel_colli_id == null)
    .sort((a, b) => a.colli_nr - b.colli_nr)
```

> De `snapshotPerOrderRegel`-map (een paar regels eerder) blijft over **alle** colli lopen (`zending.zending_colli ?? []`), zodat de pakbon per orderregel zijn snapshot blijft vinden — kind-colli dragen die regel-snapshot. Niet aanpassen.

- [ ] **Step 4: Run de tests — verwacht PASS**

Run:
```bash
npm run test:run -- src/modules/logistiek/lib/printset.test.ts
```
Expected: alle tests PASS (incl. de bestaande — geen regressie).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/logistiek/queries/zendingen.ts frontend/src/modules/logistiek/lib/printset.ts frontend/src/modules/logistiek/lib/printset.test.ts
git commit -m "feat(rhenus): label-expansie negeert gebundelde kind-colli (mig 420)"
```

---

## Task 4: Frontend — bundelsticker apart printen (?colli-filter)

De operator print ná het bundelen één nieuwe sticker (de bundel-rij), niet de hele set. De printset-pagina krijgt een optionele `?colli=<colli_nr>`-filter.

**Files:**
- Modify: `frontend/src/modules/logistiek/pages/zending-printset.tsx`

- [ ] **Step 1: Lees de query-param en filter de labels**

In `zending-printset.tsx`:

Voeg `useSearchParams` toe aan de react-router-dom-import:
```ts
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
```

Voeg ná `const navigate = useNavigate()` toe:
```ts
  const [searchParams] = useSearchParams()
  // Mig 420: bundel-sticker apart printen — filter op één colli_nr (de bundel-rij).
  const colliFilter = searchParams.get('colli')
```

Vervang de `labels`-useMemo:
```ts
  const labels = useMemo(() => (zending ? expandLabels(zending) : []), [zending])
```
door:
```ts
  const labels = useMemo(() => {
    const alle = zending ? expandLabels(zending) : []
    return colliFilter ? alle.filter((l) => String(l.colliNr) === colliFilter) : alle
  }, [zending, colliFilter])
```

- [ ] **Step 2: Typecheck**

Run (vanuit `frontend`):
```bash
npm run typecheck
```
Expected: geen type-fouten.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/logistiek/pages/zending-printset.tsx
git commit -m "feat(rhenus): printset ?colli-filter voor losse bundelsticker (mig 420)"
```

---

## Task 5: Frontend — queries + hooks voor colli-bundeling

**Files:**
- Create: `frontend/src/modules/logistiek/queries/colli-bundel.ts`
- Create: `frontend/src/modules/logistiek/hooks/use-colli-bundel.ts`

- [ ] **Step 1: Maak de queries**

Create `frontend/src/modules/logistiek/queries/colli-bundel.ts`:
```ts
import { supabase } from '@/lib/supabase/client'

/** Eén colli-rij voor de bundel-sectie (incl. bundel-velden + maten). */
export interface ColliBundelRij {
  id: number
  colli_nr: number
  sscc: string | null
  gewicht_kg: number | null
  lengte_cm: number | null
  breedte_cm: number | null
  omschrijving_snapshot: string | null
  klant_omschrijving_snapshot: string | null
  order_regel_id: number | null
  bundel_colli_id: number | null
  is_bundel: boolean
}

/** Actieve aanmelding bij Rhenus (om dubbel-aanmelden/bundelen-na-aanmelden te tonen). */
export interface RhenusAanmeldStatus {
  status: string
}

export async function fetchZendingColliVoorBundel(zendingId: number): Promise<ColliBundelRij[]> {
  const { data, error } = await supabase
    .from('zending_colli')
    .select(
      'id, colli_nr, sscc, gewicht_kg, lengte_cm, breedte_cm, omschrijving_snapshot, ' +
        'klant_omschrijving_snapshot, order_regel_id, bundel_colli_id, is_bundel',
    )
    .eq('zending_id', zendingId)
    .order('colli_nr', { ascending: true })
  if (error) throw error
  return (data ?? []) as ColliBundelRij[]
}

/** Laatste actieve Rhenus-transportorder (Wachtrij/Bezig/Verstuurd), of null. */
export async function fetchRhenusAanmelding(zendingId: number): Promise<RhenusAanmeldStatus | null> {
  const { data, error } = await supabase
    .from('rhenus_transportorders')
    .select('status')
    .eq('zending_id', zendingId)
    .in('status', ['Wachtrij', 'Bezig', 'Verstuurd'])
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as RhenusAanmeldStatus | null) ?? null
}

export async function maakColliBundel(p: {
  zendingId: number
  colliIds: number[]
  gewichtKg?: number | null
  lengteCm?: number | null
  breedteCm?: number | null
}): Promise<number> {
  const { data, error } = await supabase.rpc('maak_colli_bundel', {
    p_zending_id: p.zendingId,
    p_colli_ids: p.colliIds,
    p_gewicht_kg: p.gewichtKg ?? null,
    p_lengte_cm: p.lengteCm ?? null,
    p_breedte_cm: p.breedteCm ?? null,
  })
  if (error) throw error
  return data as number
}

export async function verwijderColliBundel(bundelColliId: number): Promise<void> {
  const { error } = await supabase.rpc('verwijder_colli_bundel', {
    p_bundel_colli_id: bundelColliId,
  })
  if (error) throw error
}

export async function meldZendingHandmatigAan(zendingId: number): Promise<string> {
  const { data, error } = await supabase.rpc('meld_zending_handmatig_aan', {
    p_zending_id: zendingId,
  })
  if (error) throw error
  return data as string
}
```

- [ ] **Step 2: Maak de hooks**

Create `frontend/src/modules/logistiek/hooks/use-colli-bundel.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchRhenusAanmelding,
  fetchZendingColliVoorBundel,
  maakColliBundel,
  meldZendingHandmatigAan,
  verwijderColliBundel,
} from '../queries/colli-bundel'

export function useZendingColliVoorBundel(zendingId: number | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'colli-bundel', zendingId],
    queryFn: () => fetchZendingColliVoorBundel(zendingId!),
    enabled: !!zendingId,
  })
}

export function useRhenusAanmelding(zendingId: number | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'rhenus-aanmelding', zendingId],
    queryFn: () => fetchRhenusAanmelding(zendingId!),
    enabled: !!zendingId,
  })
}

function useInvalidateBundel(zendingId: number | undefined) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['logistiek', 'colli-bundel', zendingId] })
    qc.invalidateQueries({ queryKey: ['logistiek', 'rhenus-aanmelding', zendingId] })
    qc.invalidateQueries({ queryKey: ['logistiek', 'zending'] })
    qc.invalidateQueries({ queryKey: ['logistiek', 'zending-printset'] })
  }
}

export function useMaakColliBundel(zendingId: number | undefined) {
  const invalidate = useInvalidateBundel(zendingId)
  return useMutation({
    mutationFn: (p: {
      colliIds: number[]
      gewichtKg?: number | null
      lengteCm?: number | null
      breedteCm?: number | null
    }) => maakColliBundel({ zendingId: zendingId!, ...p }),
    onSuccess: invalidate,
  })
}

export function useVerwijderColliBundel(zendingId: number | undefined) {
  const invalidate = useInvalidateBundel(zendingId)
  return useMutation({
    mutationFn: (bundelColliId: number) => verwijderColliBundel(bundelColliId),
    onSuccess: invalidate,
  })
}

export function useMeldZendingHandmatigAan(zendingId: number | undefined) {
  const invalidate = useInvalidateBundel(zendingId)
  return useMutation({
    mutationFn: () => meldZendingHandmatigAan(zendingId!),
    onSuccess: invalidate,
  })
}
```

- [ ] **Step 3: Typecheck + commit**

Run (vanuit `frontend`):
```bash
npm run typecheck
```
Expected: geen fouten.

```bash
git add frontend/src/modules/logistiek/queries/colli-bundel.ts frontend/src/modules/logistiek/hooks/use-colli-bundel.ts
git commit -m "feat(rhenus): queries + hooks voor colli-bundeling (mig 420)"
```

---

## Task 6: Frontend — colli-bundel-sectie + inhaken in zending-detail

De zichtbare UI: een sectie op zending-detail (alleen Rhenus + 'Klaar voor verzending' + ≥2 colli) met colli-lijst, bundelen, ontbundelen, bundelsticker printen en "Aanmelden bij Rhenus".

**Files:**
- Create: `frontend/src/modules/logistiek/components/colli-bundel-sectie.tsx`
- Modify: `frontend/src/modules/logistiek/pages/zending-detail.tsx`

- [ ] **Step 1: Maak de sectie-component**

Create `frontend/src/modules/logistiek/components/colli-bundel-sectie.tsx`:
```tsx
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, Printer, Send, Undo2 } from 'lucide-react'
import {
  useMaakColliBundel,
  useMeldZendingHandmatigAan,
  useRhenusAanmelding,
  useVerwijderColliBundel,
  useZendingColliVoorBundel,
} from '@/modules/logistiek/hooks/use-colli-bundel'
import type { ColliBundelRij } from '@/modules/logistiek/queries/colli-bundel'

// Alleen Rhenus kent handmatige aanmelding/colli-bundeling (mig 420). De DB-RPC's
// dwingen dit hard af; deze constant stuurt alleen de zichtbaarheid van de sectie.
const HANDMATIG_VERVOERDER = 'rhenus_sftp'

interface Props {
  zendingId: number
  zendingNr: string
  vervoerderCode: string | null
  status: string
  aantalColli: number | null
}

export function ColliBundelSectie({ zendingId, zendingNr, vervoerderCode, status, aantalColli }: Props) {
  const zichtbaar =
    vervoerderCode === HANDMATIG_VERVOERDER &&
    status === 'Klaar voor verzending' &&
    (aantalColli ?? 0) >= 2

  if (!zichtbaar) return null
  return (
    <ColliBundelSectieInner zendingId={zendingId} zendingNr={zendingNr} />
  )
}

function ColliBundelSectieInner({ zendingId, zendingNr }: { zendingId: number; zendingNr: string }) {
  const { data: colli = [], isLoading } = useZendingColliVoorBundel(zendingId)
  const { data: aanmelding } = useRhenusAanmelding(zendingId)
  const maak = useMaakColliBundel(zendingId)
  const verwijder = useVerwijderColliBundel(zendingId)
  const meldAan = useMeldZendingHandmatigAan(zendingId)

  const [geselecteerd, setGeselecteerd] = useState<Set<number>>(new Set())

  const losseColli = colli.filter((c) => !c.is_bundel && c.bundel_colli_id == null)
  const bundels = colli.filter((c) => c.is_bundel)
  const kinderenVan = (bundelId: number) => colli.filter((c) => c.bundel_colli_id === bundelId)

  // Voorgevulde maten/gewicht uit de selectie (Σ gewicht, MAX maat).
  const defaults = useMemo(() => {
    const sel = colli.filter((c) => geselecteerd.has(c.id))
    return {
      gewicht: sel.reduce((s, c) => s + (c.gewicht_kg ?? 0), 0),
      lengte: sel.reduce((m, c) => Math.max(m, c.lengte_cm ?? 0), 0),
      breedte: sel.reduce((m, c) => Math.max(m, c.breedte_cm ?? 0), 0),
    }
  }, [colli, geselecteerd])

  const [gewicht, setGewicht] = useState('')
  const [lengte, setLengte] = useState('')
  const [breedte, setBreedte] = useState('')

  const aangemeld = !!aanmelding
  const kanBundelen = geselecteerd.size >= 2 && !aangemeld

  function toggle(id: number) {
    setGeselecteerd((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function bundel() {
    maak.mutate(
      {
        colliIds: [...geselecteerd],
        gewichtKg: gewicht === '' ? defaults.gewicht : Number(gewicht),
        lengteCm: lengte === '' ? defaults.lengte : Number(lengte),
        breedteCm: breedte === '' ? defaults.breedte : Number(breedte),
      },
      {
        onSuccess: () => {
          setGeselecteerd(new Set())
          setGewicht(''); setLengte(''); setBreedte('')
        },
      },
    )
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-terracotta-200 p-5 mb-6">
      <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
        <Boxes size={16} className="text-terracotta-600" /> Colli bundelen (Rhenus)
      </h3>

      {aangemeld ? (
        <p className="text-sm text-emerald-700 mb-2">
          Aangemeld bij Rhenus (status: {aanmelding!.status}). Bundelen is niet meer mogelijk.
        </p>
      ) : (
        <p className="text-xs text-slate-500 mb-3">
          Pak een paar colli samen in één zak: vink ze aan → <strong>Bundelen</strong> → print de
          nieuwe sticker en plak die op de zak. Klik tot slot <strong>Aanmelden bij Rhenus</strong>.
          Geen bundel nodig? Klik meteen op Aanmelden.
        </p>
      )}

      {isLoading ? (
        <div className="text-sm text-slate-400">Colli laden…</div>
      ) : (
        <>
          {/* Bestaande bundels */}
          {bundels.length > 0 && (
            <div className="mb-4 space-y-2">
              {bundels.map((b) => (
                <div key={b.id} className="rounded-[var(--radius-sm)] border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-700">
                      {b.klant_omschrijving_snapshot ?? 'Bundel'}{' '}
                      <span className="font-mono text-xs text-slate-500">{b.sscc}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/logistiek/${zendingNr}/printset?colli=${b.colli_nr}`}
                        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        <Printer size={13} /> Bundelsticker
                      </Link>
                      {!aangemeld && (
                        <button
                          onClick={() => verwijder.mutate(b.id)}
                          disabled={verwijder.isPending}
                          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                        >
                          <Undo2 size={13} /> Ontbundelen
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {kinderenVan(b.id).map((k) => k.omschrijving_snapshot ?? `Colli ${k.colli_nr}`).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Losse colli met checkboxes */}
          {!aangemeld && (
            <div className="space-y-1.5">
              {losseColli.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={geselecteerd.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <span className="font-mono text-xs text-slate-400 w-8">#{c.colli_nr}</span>
                  <span className="flex-1">{c.omschrijving_snapshot ?? `Colli ${c.colli_nr}`}</span>
                  <span className="text-xs text-slate-400">
                    {c.gewicht_kg != null ? `${c.gewicht_kg} kg` : '—'}
                  </span>
                </label>
              ))}
              {losseColli.length === 0 && (
                <div className="text-sm text-slate-400">Geen losse colli meer om te bundelen.</div>
              )}
            </div>
          )}

          {/* Bundel-formulier (≥2 geselecteerd) */}
          {kanBundelen && (
            <div className="mt-4 rounded-[var(--radius-sm)] border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-600 mb-2">
                {geselecteerd.size} colli bundelen — controleer gewicht/maat van de zak:
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <MaatVeld label="Gewicht (kg)" value={gewicht} ph={String(round1(defaults.gewicht))} onChange={setGewicht} />
                <MaatVeld label="Lengte (cm)" value={lengte} ph={String(defaults.lengte)} onChange={setLengte} />
                <MaatVeld label="Breedte (cm)" value={breedte} ph={String(defaults.breedte)} onChange={setBreedte} />
                <button
                  onClick={bundel}
                  disabled={maak.isPending}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-terracotta-600 px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-700 disabled:opacity-50"
                >
                  <Boxes size={15} /> Bundel maken
                </button>
              </div>
            </div>
          )}

          {maak.isError && (
            <div className="mt-2 text-xs text-rose-600">Bundelen mislukt: {(maak.error as Error).message}</div>
          )}
          {verwijder.isError && (
            <div className="mt-2 text-xs text-rose-600">Ontbundelen mislukt: {(verwijder.error as Error).message}</div>
          )}

          {/* Aanmelden bij Rhenus */}
          {!aangemeld && (
            <div className="mt-4 flex items-center justify-end gap-3 border-t border-slate-100 pt-3">
              <button
                onClick={() => meldAan.mutate()}
                disabled={meldAan.isPending}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Send size={15} /> Aanmelden bij Rhenus
              </button>
            </div>
          )}
          {meldAan.isError && (
            <div className="mt-2 text-xs text-rose-600 text-right">
              Aanmelden mislukt: {(meldAan.error as Error).message}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function MaatVeld({
  label, value, ph, onChange,
}: { label: string; value: string; ph: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        placeholder={ph}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 rounded-[var(--radius-sm)] border border-slate-300 px-2 py-1.5 text-sm"
      />
    </div>
  )
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
```

> **Tailwind-kleur-check:** `terracotta-*` en `emerald-*` worden elders in dit project gebruikt (o.a. `zending-detail.tsx`, Pick & Ship). Als `terracotta-200`/`terracotta-700` niet bestaan in de Tailwind-config, val terug op `terracotta-300`/`terracotta-600`. Verifieer met `npm run typecheck` + visuele check; pas klassen aan indien nodig.

- [ ] **Step 2: Haak de sectie in op zending-detail**

In `zending-detail.tsx`:

Voeg de import toe (bij de andere component-imports):
```ts
import { ColliBundelSectie } from '@/modules/logistiek/components/colli-bundel-sectie'
```

Plaats de sectie ná "Sectie 1 — zending-info" (vóór "Sectie 2 — order-koppeling"). Zoek de afsluiting van Sectie 1 (`</Section>` direct ná het `grid`-blok met de velden) en voeg er ná toe:
```tsx
      {/* Colli-bundeling (mig 420) — alleen Rhenus + 'Klaar voor verzending' + >=2 colli. */}
      <ColliBundelSectie
        zendingId={z.id}
        zendingNr={z.zending_nr}
        vervoerderCode={z.vervoerder_code}
        status={z.status}
        aantalColli={z.aantal_colli}
      />
```

- [ ] **Step 3: Typecheck**

Run (vanuit `frontend`):
```bash
npm run typecheck
```
Expected: geen fouten. (Lost eventuele ontbrekende Tailwind-kleurklassen of import-paden hier op.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/logistiek/components/colli-bundel-sectie.tsx frontend/src/modules/logistiek/pages/zending-detail.tsx
git commit -m "feat(rhenus): colli-bundel-sectie op zending-detail (mig 420)"
```

---

## Task 7: Documentatie bijwerken

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/changelog.md`

- [ ] **Step 1: Voeg een bedrijfsregel-bullet toe aan CLAUDE.md**

Voeg onder de bedrijfsregels (bij de andere verzend-/colli-bullets, bv. ná de "Verzendlabel-SSCC"-bullet) toe:
```markdown
- **Colli-bundeling bij Rhenus (mig 420):** binnen één Rhenus-zending kan de operator handmatig meerdere colli samenpakken onder één nieuwe SSCC-sticker; alleen die bundel-SSCC + de niet-gebundelde colli worden aangemeld, de onderliggende stickers genegeerd. Datamodel: een bundel = extra `zending_colli`-rij (`is_bundel=TRUE`, eigen `genereer_sscc()`, gewicht=Σ, maat=MAX) waarnaar de kind-colli wijzen via zelf-FK `bundel_colli_id` (`ON DELETE SET NULL`). **Eén filter-predicaat overal:** `bundel_colli_id IS NULL` in de colli-seam ([`fetch-zending-colli.ts`](supabase/functions/_shared/vervoerders/fetch-zending-colli.ts)) én in [`bouwVerzenddocument`](frontend/src/modules/logistiek/lib/printset.ts) → de bundel-rij telt als 1 collo in de Rhenus-XML/labels. **Hold-mechaniek:** data-vlag `vervoerders.handmatig_aanmelden` (TRUE voor `rhenus_sftp`); `enqueue_zending_naar_vervoerder(p_zending_id, p_handmatig)` houdt een ≥2-colli-zending vast op `'Klaar voor verzending'` (`RETURN 'held_handmatig'`) tot de operator vrijgeeft via `meld_zending_handmatig_aan` (de "Aanmelden bij Rhenus"-knop in [`colli-bundel-sectie.tsx`](frontend/src/modules/logistiek/components/colli-bundel-sectie.tsx)). 1-colli Rhenus-zendingen gaan altijd automatisch door; HST/Verhoek/NL ongewijzigd (vlag FALSE). RPC's `maak_colli_bundel`/`verwijder_colli_bundel`. **Niet te verwarren** met zending-bundeling (mig 222) of de bundel-sleutel (mig 228-230). Spec: [`docs/superpowers/specs/2026-06-17-rhenus-colli-bundeling-design.md`](docs/superpowers/specs/2026-06-17-rhenus-colli-bundeling-design.md).
```

- [ ] **Step 2: Voeg een changelog-entry toe**

Voeg bovenaan `docs/changelog.md` (bij de meest recente entries) toe:
```markdown
## 2026-06-18 — Colli-bundeling bij Rhenus (mig 420)

Magazijn kan binnen één Rhenus-zending colli samenpakken onder één nieuwe
SSCC-sticker (1× betalen i.p.v. per collo). Bundel = extra `zending_colli`-rij
met zelf-FK `bundel_colli_id`; carrier-seam + label-expansie negeren de kinderen.
Rhenus-aanmelding van ≥2-colli-zendingen wordt vastgehouden (`vervoerders.handmatig_aanmelden`)
tot de operator op zending-detail bundelt en "Aanmelden bij Rhenus" klikt.
1-colli Rhenus + alle andere vervoerders ongewijzigd. Spec: docs/superpowers/specs/2026-06-17-rhenus-colli-bundeling-design.md.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/changelog.md
git commit -m "docs(rhenus): colli-bundeling in CLAUDE.md + changelog (mig 420)"
```

---

## Eindcheck vóór merge

- [ ] **Migratie toegepast** op de live DB (Task 1, Step 8) + verifier-NOTICE gezien.
- [ ] **Edge-functies herdeployen** die de colli-seam delen (`rhenus-send`, `verhoek-send`, `hst-send`) — de seam-filter zit in `_shared`, dus alle drie opnieuw uitrollen:
  ```bash
  supabase functions deploy rhenus-send verhoek-send hst-send --project-ref wqzeevfobwauxkalagtn
  ```
- [ ] **Migratienummer her-verifiëren** t.o.v. `origin/main` (hernoem 420 indien bezet).
- [ ] **Volledige test-suite groen:**
  ```bash
  deno test supabase/functions/_shared/vervoerders/fetch-zending-colli.test.ts
  cd frontend && npm run test:run -- src/modules/logistiek && npm run typecheck
  ```
- [ ] **Handmatige rondreis (na merge/deploy):** maak een test-Rhenus-zending met ≥3 colli → pickronde voltooien → controleer dat de zending op 'Klaar voor verzending' blijft (niet auto-aangemeld) → bundel er 2 → print bundelsticker (1 label, eigen SSCC) → "Aanmelden bij Rhenus" → controleer dat de Rhenus-XML `totalPackageQuantity` = effectief aantal toont en de bundel-SSCC bevat, niet de kind-SSCC's.

---

## Buiten scope (bewust)

- **"Wacht op vrijgave"-teller op de Rhenus-monitor.** De vastgehouden zending is zichtbaar op zending-detail (de bundel-sectie verschijnt) en in het logistiek-overzicht ('Klaar voor verzending'). Een aparte count op `rhenus_verzend_monitor` is een latere verbetering — vereist een eigen subquery op `zendingen` (held-zendingen hebben nog geen `rhenus_transportorders`-rij).
- **Bundelen ná aanmelden.** Zolang de cron de XML nog niet verstuurd heeft, staat de zending nog op 'Klaar voor verzending' en zou een nieuwe bundel de RPC-guards passeren. De UI verbergt de bundel-acties zodra er een actieve `rhenus_transportorders`-rij bestaat (`aangemeld`), wat dit in de praktijk afdekt. Een harde DB-guard (geen mutatie na enqueue) staat op de backlog.
- **Bundelen over meerdere zendingen.** Een bundel zit per definitie binnen één zending (één transportinstructie). Cross-zending-bundeling is niet voorzien.
- **`zendingen.aantal_colli` blijft het fysieke aantal.** Bundelen werkt dit veld bewust niet bij — het is een display-/hold-teller (de hold-guard telt fysieke colli vóór bundeling). De Rhenus-XML gebruikt de *effectieve* telling via de seam (`bundel_colli_id IS NULL`), dus `totalPackageQuantity` klopt los van `aantal_colli`.
```