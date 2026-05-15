# Handmatige rol-/reststuk-CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Op de Rollen & Reststukken-pagina kun je rollen/reststukken handmatig toevoegen, bewerken en verwijderen via een veilige Postgres RPC-laag met audittrail, zonder de operationele integriteit (snijplannen, FIFO) te breken.

**Architecture:** Drie `SECURITY DEFINER` RPC's (`rol_handmatig_toevoegen`, `rol_handmatig_bewerken`, `rol_verwijderen`) zijn het enige mutatiepad; elk doet validatie + mutatie + auditregel in een nieuwe `rol_mutaties`-tabel in één transactie. Geen `producten.voorraad`-koppeling: de pagina telt rollen live op via de bestaande `voorraadposities`-RPC. Frontend krijgt drie dialogen (useState-form + useMutation, invalidate `['voorraadposities']`) gewired in `rollen-groep-row.tsx`.

**Tech Stack:** PostgreSQL (Supabase migrations, plpgsql), React 18 + TypeScript, TanStack Query, Vitest, TailwindCSS.

**Spec:** `docs/superpowers/specs/2026-05-15-handmatige-rol-crud-design.md`

---

## Belangrijke context voor de uitvoerder

- **Geen lokale/MCP test-DB.** Karpi-migraties worden handmatig in de Supabase SQL-editor toegepast. SQL-zelftests volgen het patroon van `scripts/test-match-klant-po.sql`: `BEGIN; … DO $$ … ASSERT … RAISE NOTICE 'ALLE TESTS GESLAAGD'; $$; ROLLBACK;`. "Test draaien" voor SQL = de gebruiker draait het script in de SQL-editor en verwacht alle `OK`-notices + geen exception.
- **Migratie-nummering:** mig 289 is al dubbel gebruikt (`289_confectie_buffer_default_nul.sql` + `289_match_klant_po.sql`). Begin bij **290**.
- **`oppervlak_m2`-formule (codebase-conventie, mig 281):** `ROUND((lengte_cm * breedte_cm) / 10000.0, 2)`.
- **Gedenormaliseerde rol-velden bij INSERT** komen uit `producten` (zie mig 281 regels 44-49 / 78-84): `karpi_code`, `omschrijving`, `vvp_m2 = producten.verkoopprijs`, `kwaliteit_code`, `kleur_code`, `zoeksleutel`.
- **`rol_type` ENUM-waarden:** `'volle_rol' | 'aangebroken' | 'reststuk'`. Een bestaande trigger `bereken_rol_type` kan `rol_type` bij INSERT/UPDATE herklassificeren — dat is correct en verwacht gedrag; niet tegenwerken.
- **`status`-waarden (TEXT):** `'beschikbaar','gereserveerd','verkocht','gesneden','reststuk','in_snijplan'`.
- **NOOIT** `--no-verify` bij commits; laat hooks draaien.
- Commit-footer (verplicht in deze repo):
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

## File Structure

**Aanmaken:**
- `supabase/migrations/290_rol_mutaties_tabel.sql` — audittabel.
- `supabase/migrations/291_rol_handmatig_toevoegen.sql` — toevoeg-RPC.
- `supabase/migrations/292_rol_handmatig_bewerken.sql` — bewerk-RPC.
- `supabase/migrations/293_rol_verwijderen.sql` — verwijder-RPC.
- `scripts/test-rol-crud.sql` — SQL-zelftest (alle drie RPC's, één bestand).
- `frontend/src/components/rollen/rol-toevoegen-dialog.tsx` — toevoeg-modal.
- `frontend/src/components/rollen/rol-bewerken-dialog.tsx` — bewerk-modal.
- `frontend/src/components/rollen/rol-verwijderen-dialog.tsx` — verwijder-modal.
- `frontend/src/components/rollen/__tests__/rol-crud-queries.contract.test.ts` — contract-test query-laag.
- `docs/adr/0023-handmatige-rol-crud-rpc-laag.md` — ADR.

**Wijzigen:**
- `frontend/src/lib/supabase/queries/rollen.ts` — `rolToevoegen` / `rolBewerken` / `rolVerwijderen` + types toevoegen.
- `frontend/src/components/rollen/rollen-groep-row.tsx` — knoppen + dialog-state bedraden.
- `docs/database-schema.md`, `docs/data-woordenboek.md`, `docs/changelog.md`, `CLAUDE.md` — documentatie.

Elk dialoog-bestand is één concern (≤200 regels) conform CLAUDE.md.

---

## Task 1: Migratie 290 — `rol_mutaties` audittabel

**Files:**
- Create: `supabase/migrations/290_rol_mutaties_tabel.sql`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 290: rol_mutaties — audittrail voor handmatige rol-CRUD
--
-- Context: handmatige voorraadcorrecties (rol toevoegen/bewerken/verwijderen)
-- vereisen een verplichte reden + een audit-regel die een VERWIJDERDE rol
-- overleeft. Het bestaande voorraad_mutaties kan dit structureel niet
-- (rol_id NOT NULL + FK, geen reden-kolom — zie mig 148 + database-schema.md).
-- Daarom een dedicated tabel; voorraad_mutaties blijft ongemoeid.

CREATE TABLE IF NOT EXISTS rol_mutaties (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rol_id              BIGINT,                       -- geen FK: rol kan weg zijn
  rolnummer           TEXT,
  artikelnr           TEXT,
  actie               TEXT NOT NULL
                        CHECK (actie IN ('toevoegen','bewerken','verwijderen')),
  oppervlak_delta_m2  NUMERIC(10,2),
  oud_json            JSONB,
  nieuw_json          JSONB,
  reden               TEXT NOT NULL,
  medewerker          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rol_mutaties_rol_id ON rol_mutaties (rol_id);
CREATE INDEX IF NOT EXISTS idx_rol_mutaties_created_at ON rol_mutaties (created_at DESC);

COMMENT ON TABLE rol_mutaties IS
  'Audittrail voor handmatige rol-CRUD (voorraadcorrectie/inventarisatie). '
  'rol_id heeft bewust GEEN FK zodat de audit-regel een verwijderde rol '
  'overleeft. reden is verplicht. Mig 290.';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 290 toegepast: rol_mutaties audittabel aangemaakt.';
END $$;
```

- [ ] **Step 2: Toepassen + verifiëren (handmatig in Supabase SQL-editor)**

Plak de migratie in de Supabase SQL-editor en draai. Verwacht: `NOTICE: Migratie 290 toegepast: rol_mutaties audittabel aangemaakt.` en geen fout. Verifieer:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'rol_mutaties' ORDER BY ordinal_position;
```
Verwacht: 11 kolommen, `reden` `is_nullable = NO`, `rol_id` `is_nullable = YES`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/290_rol_mutaties_tabel.sql
git commit -m "feat(rol-crud): mig 290 rol_mutaties audittabel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migratie 291 — `rol_handmatig_toevoegen` RPC

**Files:**
- Create: `supabase/migrations/291_rol_handmatig_toevoegen.sql`
- Create: `scripts/test-rol-crud.sql` (eerste testblok)

- [ ] **Step 1: Schrijf het falende zelftest-script (toevoeg-deel)**

Maak `scripts/test-rol-crud.sql`:

```sql
-- Zelf-test voor handmatige rol-CRUD (mig 291-293). Draai in de Supabase
-- SQL-editor. Verwacht: alle RAISE NOTICE eindigen op "OK", dan
-- "ALLE TESTS GESLAAGD". ROLLBACK aan het eind — geen data-mutatie.
BEGIN;

-- Seed: een rol-product (eenheid m). Hergebruik een bestaand artikel als het
-- er is; anders minimaal record. We gebruiken een vast test-artikelnr.
INSERT INTO producten (artikelnr, karpi_code, omschrijving, verkoopprijs,
                       kwaliteit_code, kleur_code, zoeksleutel, product_type, actief)
VALUES ('TESTROLCRUD01', 'TESTROLCRUD01', 'TEST ROL CRUD', 10.00,
        'TST', '99', 'TST_99', 'rol', true)
ON CONFLICT (artikelnr) DO NOTHING;

DO $$
DECLARE
  v_rol_id BIGINT;
  v_rolnr  TEXT;
  v_opp    NUMERIC;
  v_audit  RECORD;
BEGIN
  -- 1. Toevoegen met expliciete in_magazijn_sinds + auto rolnummer.
  SELECT rol_id, rolnummer INTO v_rol_id, v_rolnr
  FROM rol_handmatig_toevoegen(
    'TESTROLCRUD01', 'volle_rol'::rol_type, 1500, 400, NULL,
    DATE '2025-01-10', NULL, 'inventarisatie telfout', 'tester');
  ASSERT v_rol_id IS NOT NULL, 'toevoegen gaf geen rol_id';
  ASSERT v_rolnr LIKE 'CORR-TESTROLCRUD01-%', 'auto-rolnummer onverwacht: ' || v_rolnr;

  SELECT oppervlak_m2, in_magazijn_sinds INTO v_opp, v_audit
  FROM rollen WHERE id = v_rol_id;
  ASSERT v_opp = ROUND(1500*400/10000.0, 2), 'oppervlak onjuist: ' || v_opp;
  RAISE NOTICE 'toevoegen-basis: OK';

  -- 2. in_magazijn_sinds exact opgeslagen.
  ASSERT (SELECT in_magazijn_sinds FROM rollen WHERE id = v_rol_id) = DATE '2025-01-10',
    'in_magazijn_sinds niet opgeslagen';
  RAISE NOTICE 'toevoegen-fifo-datum: OK';

  -- 3. Auditregel aanwezig met juiste delta.
  SELECT * INTO v_audit FROM rol_mutaties
  WHERE rol_id = v_rol_id AND actie = 'toevoegen';
  ASSERT v_audit.id IS NOT NULL, 'geen auditregel voor toevoegen';
  ASSERT v_audit.oppervlak_delta_m2 = v_opp, 'audit-delta onjuist';
  ASSERT v_audit.reden = 'inventarisatie telfout', 'audit-reden onjuist';
  RAISE NOTICE 'toevoegen-audit: OK';

  -- 4. Lege reden geweigerd.
  BEGIN
    PERFORM rol_handmatig_toevoegen('TESTROLCRUD01','volle_rol'::rol_type,
      100,100,NULL,NULL,NULL,'   ','tester');
    RAISE EXCEPTION 'lege reden had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%reden%', 'verkeerde fout bij lege reden: ' || SQLERRM;
  END;
  RAISE NOTICE 'toevoegen-lege-reden-geweigerd: OK';

  -- 5. Onbekend artikelnr geweigerd.
  BEGIN
    PERFORM rol_handmatig_toevoegen('BESTAATNIET','volle_rol'::rol_type,
      100,100,NULL,NULL,NULL,'x','tester');
    RAISE EXCEPTION 'onbekend artikel had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%TESTROLCRUD%' OR SQLERRM LIKE '%artikel%',
      'verkeerde fout bij onbekend artikel: ' || SQLERRM;
  END;
  RAISE NOTICE 'toevoegen-onbekend-artikel-geweigerd: OK';

  RAISE NOTICE 'TASK2 TESTS GESLAAGD';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Draai het script — verwacht FAIL**

Draai `scripts/test-rol-crud.sql` in de Supabase SQL-editor.
Verwacht: fout `function rol_handmatig_toevoegen(...) does not exist` (RPC bestaat nog niet).

- [ ] **Step 3: Schrijf de migratie**

Maak `supabase/migrations/291_rol_handmatig_toevoegen.sql`:

```sql
-- Migratie 291: rol_handmatig_toevoegen — handmatige rol/reststuk-correctie
--
-- Voorraadcorrectie/inventarisatie. GEEN inkooporder-koppeling, GEEN
-- producten.voorraad-mutatie (pagina is live-correct via SUM(rollen)).
-- Gedenormaliseerde velden uit producten (zelfde bron als mig 281).
-- Schrijft een rol_mutaties-auditregel (verplichte reden).

CREATE OR REPLACE FUNCTION rol_handmatig_toevoegen(
  p_artikelnr         TEXT,
  p_rol_type          rol_type,
  p_lengte_cm         INTEGER,
  p_breedte_cm        INTEGER,
  p_locatie_id        BIGINT,
  p_in_magazijn_sinds DATE,
  p_rolnummer         TEXT,
  p_reden             TEXT,
  p_medewerker        TEXT DEFAULT NULL
) RETURNS TABLE(rol_id BIGINT, rolnummer TEXT)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product   RECORD;
  v_opp       NUMERIC;
  v_rolnr     TEXT;
  v_seq       INTEGER := 1;
  v_nieuw_id  BIGINT;
BEGIN
  IF p_reden IS NULL OR TRIM(p_reden) = '' THEN
    RAISE EXCEPTION 'Reden is verplicht bij een handmatige rol-correctie.';
  END IF;
  IF p_lengte_cm IS NULL OR p_lengte_cm <= 0 THEN
    RAISE EXCEPTION 'Ongeldige lengte: %', p_lengte_cm;
  END IF;
  IF p_breedte_cm IS NULL OR p_breedte_cm <= 0 THEN
    RAISE EXCEPTION 'Ongeldige breedte: %', p_breedte_cm;
  END IF;

  SELECT p.karpi_code, p.omschrijving, p.verkoopprijs AS vvp_m2,
         p.kwaliteit_code, p.kleur_code, p.zoeksleutel
    INTO v_product
  FROM producten p WHERE p.artikelnr = p_artikelnr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onbekend artikelnr: %', p_artikelnr;
  END IF;

  IF p_locatie_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM magazijn_locaties WHERE id = p_locatie_id) THEN
    RAISE EXCEPTION 'Onbekende locatie-id: %', p_locatie_id;
  END IF;

  v_rolnr := NULLIF(TRIM(COALESCE(p_rolnummer, '')), '');
  IF v_rolnr IS NULL THEN
    LOOP
      v_rolnr := 'CORR-' || p_artikelnr || '-' || v_seq;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM rollen r WHERE r.rolnummer = v_rolnr);
      v_seq := v_seq + 1;
    END LOOP;
  ELSIF EXISTS (SELECT 1 FROM rollen r WHERE r.rolnummer = v_rolnr) THEN
    RAISE EXCEPTION 'Rolnummer % bestaat al.', v_rolnr;
  END IF;

  v_opp := ROUND((p_lengte_cm * p_breedte_cm) / 10000.0, 2);

  INSERT INTO rollen (
    rolnummer, artikelnr, karpi_code, omschrijving,
    lengte_cm, breedte_cm, oppervlak_m2, vvp_m2,
    kwaliteit_code, kleur_code, zoeksleutel,
    status, rol_type, locatie_id, reststuk_datum, in_magazijn_sinds
  ) VALUES (
    v_rolnr, p_artikelnr, v_product.karpi_code, v_product.omschrijving,
    p_lengte_cm, p_breedte_cm, v_opp, v_product.vvp_m2,
    v_product.kwaliteit_code, v_product.kleur_code, v_product.zoeksleutel,
    'beschikbaar', p_rol_type, p_locatie_id, NOW(),
    COALESCE(p_in_magazijn_sinds, CURRENT_DATE)
  )
  RETURNING id INTO v_nieuw_id;

  INSERT INTO rol_mutaties (
    rol_id, rolnummer, artikelnr, actie, oppervlak_delta_m2,
    oud_json, nieuw_json, reden, medewerker
  ) VALUES (
    v_nieuw_id, v_rolnr, p_artikelnr, 'toevoegen', v_opp,
    NULL,
    jsonb_build_object('lengte_cm', p_lengte_cm, 'breedte_cm', p_breedte_cm,
      'oppervlak_m2', v_opp, 'rol_type', p_rol_type, 'status', 'beschikbaar',
      'in_magazijn_sinds', COALESCE(p_in_magazijn_sinds, CURRENT_DATE),
      'locatie_id', p_locatie_id),
    TRIM(p_reden), p_medewerker
  );

  rol_id := v_nieuw_id;
  rolnummer := v_rolnr;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rol_handmatig_toevoegen(TEXT,rol_type,INTEGER,INTEGER,BIGINT,DATE,TEXT,TEXT,TEXT) IS
  'Handmatige rol/reststuk-correctie (voorraadcorrectie/inventarisatie). '
  'Geen IO-koppeling, geen producten.voorraad-mutatie. Audit in rol_mutaties. '
  'Mig 291. Spec 2026-05-15-handmatige-rol-crud.';

GRANT EXECUTE ON FUNCTION rol_handmatig_toevoegen(TEXT,rol_type,INTEGER,INTEGER,BIGINT,DATE,TEXT,TEXT,TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 291 toegepast: rol_handmatig_toevoegen aangemaakt.';
END $$;
```

- [ ] **Step 4: Pas mig 291 toe + draai het zelftest-script — verwacht PASS**

Plak mig 291 in de SQL-editor en draai (verwacht NOTICE mig 291). Draai daarna `scripts/test-rol-crud.sql` opnieuw.
Verwacht: `toevoegen-basis: OK` … `toevoegen-onbekend-artikel-geweigerd: OK`, `TASK2 TESTS GESLAAGD`, geen exception, `ROLLBACK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/291_rol_handmatig_toevoegen.sql scripts/test-rol-crud.sql
git commit -m "feat(rol-crud): mig 291 rol_handmatig_toevoegen + zelftest

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Migratie 292 — `rol_handmatig_bewerken` RPC

**Files:**
- Create: `supabase/migrations/292_rol_handmatig_bewerken.sql`
- Modify: `scripts/test-rol-crud.sql` (tweede testblok toevoegen)

- [ ] **Step 1: Voeg het falende bewerk-testblok toe aan `scripts/test-rol-crud.sql`**

Voeg, **direct vóór de regel `ROLLBACK;`**, dit blok toe:

```sql
DO $$
DECLARE
  v_rol_id BIGINT;
  v_opp_voor NUMERIC;
  v_opp_na   NUMERIC;
  v_audit  RECORD;
BEGIN
  SELECT rol_id INTO v_rol_id FROM rol_handmatig_toevoegen(
    'TESTROLCRUD01','volle_rol'::rol_type, 1000, 400, NULL,
    NULL, NULL, 'seed voor bewerken', 'tester');
  SELECT oppervlak_m2 INTO v_opp_voor FROM rollen WHERE id = v_rol_id;

  -- 1. Afmeting wijzigen herberekent oppervlak + auditregel met delta.
  PERFORM rol_handmatig_bewerken(v_rol_id, 1200, 400, NULL, 'beschikbaar',
    'meting gecorrigeerd', 'tester');
  SELECT oppervlak_m2 INTO v_opp_na FROM rollen WHERE id = v_rol_id;
  ASSERT v_opp_na = ROUND(1200*400/10000.0,2), 'oppervlak na bewerken onjuist';
  SELECT * INTO v_audit FROM rol_mutaties
  WHERE rol_id = v_rol_id AND actie = 'bewerken';
  ASSERT v_audit.oppervlak_delta_m2 = v_opp_na - v_opp_voor, 'bewerk-delta onjuist';
  ASSERT v_audit.oud_json IS NOT NULL AND v_audit.nieuw_json IS NOT NULL,
    'oud/nieuw_json ontbreekt';
  RAISE NOTICE 'bewerken-afmeting+audit: OK';

  -- 2. Negatieve delta (kleiner maken).
  PERFORM rol_handmatig_bewerken(v_rol_id, 800, 400, NULL, 'beschikbaar',
    'krimp', 'tester');
  ASSERT (SELECT oppervlak_m2 FROM rollen WHERE id = v_rol_id)
       = ROUND(800*400/10000.0,2), 'negatieve delta onjuist';
  RAISE NOTICE 'bewerken-negatieve-delta: OK';

  -- 3. Status naar in_snijplan geweigerd.
  BEGIN
    PERFORM rol_handmatig_bewerken(v_rol_id, 800, 400, NULL, 'in_snijplan',
      'mag niet', 'tester');
    RAISE EXCEPTION 'status in_snijplan had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%in_snijplan%' OR SQLERRM LIKE '%status%',
      'verkeerde fout: ' || SQLERRM;
  END;
  RAISE NOTICE 'bewerken-status-geweigerd: OK';

  -- 4. Bewerken van een gereserveerde rol geweigerd.
  UPDATE rollen SET status = 'gereserveerd' WHERE id = v_rol_id;
  BEGIN
    PERFORM rol_handmatig_bewerken(v_rol_id, 900, 400, NULL, 'beschikbaar',
      'mag niet', 'tester');
    RAISE EXCEPTION 'bewerken gereserveerde rol had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%gereserveerd%' OR SQLERRM LIKE '%snijplan%'
        OR SQLERRM LIKE '%niet bewerk%', 'verkeerde fout: ' || SQLERRM;
  END;
  RAISE NOTICE 'bewerken-gereserveerde-rol-geweigerd: OK';

  RAISE NOTICE 'TASK3 TESTS GESLAAGD';
END $$;
```

- [ ] **Step 2: Draai het script — verwacht FAIL op het nieuwe blok**

Draai `scripts/test-rol-crud.sql`. Verwacht: fout `function rol_handmatig_bewerken(...) does not exist`.

- [ ] **Step 3: Schrijf de migratie**

Maak `supabase/migrations/292_rol_handmatig_bewerken.sql`:

```sql
-- Migratie 292: rol_handmatig_bewerken — afmetingen/locatie/status corrigeren
--
-- Weigert wijziging op rollen die aan een snijplan/claim hangen
-- (status gereserveerd/in_snijplan/verkocht/gesneden) en weigert status-doel
-- gereserveerd/in_snijplan. Geen producten.voorraad-mutatie. Audit in rol_mutaties.

CREATE OR REPLACE FUNCTION rol_handmatig_bewerken(
  p_rol_id     BIGINT,
  p_lengte_cm  INTEGER,
  p_breedte_cm INTEGER,
  p_locatie_id BIGINT,
  p_status     TEXT,
  p_reden      TEXT,
  p_medewerker TEXT DEFAULT NULL
) RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol     rollen%ROWTYPE;
  v_opp_na  NUMERIC;
  v_delta   NUMERIC;
BEGIN
  IF p_reden IS NULL OR TRIM(p_reden) = '' THEN
    RAISE EXCEPTION 'Reden is verplicht bij een handmatige rol-correctie.';
  END IF;
  IF p_lengte_cm IS NULL OR p_lengte_cm <= 0
     OR p_breedte_cm IS NULL OR p_breedte_cm <= 0 THEN
    RAISE EXCEPTION 'Ongeldige afmetingen: % x %', p_lengte_cm, p_breedte_cm;
  END IF;
  IF p_status IN ('gereserveerd','in_snijplan') THEN
    RAISE EXCEPTION 'Status % mag niet handmatig gezet worden (claim-integriteit).',
      p_status;
  END IF;

  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rol % niet gevonden.', p_rol_id;
  END IF;

  IF v_rol.status IN ('gereserveerd','in_snijplan','verkocht','gesneden') THEN
    RAISE EXCEPTION
      'Rol % kan niet bewerkt worden: status is % (hangt aan snijplan/claim).',
      v_rol.rolnummer, v_rol.status;
  END IF;

  IF p_locatie_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM magazijn_locaties WHERE id = p_locatie_id) THEN
    RAISE EXCEPTION 'Onbekende locatie-id: %', p_locatie_id;
  END IF;

  v_opp_na := ROUND((p_lengte_cm * p_breedte_cm) / 10000.0, 2);
  v_delta  := v_opp_na - COALESCE(v_rol.oppervlak_m2, 0);

  UPDATE rollen
  SET lengte_cm   = p_lengte_cm,
      breedte_cm  = p_breedte_cm,
      oppervlak_m2 = v_opp_na,
      locatie_id  = p_locatie_id,
      status      = p_status
  WHERE id = p_rol_id;

  INSERT INTO rol_mutaties (
    rol_id, rolnummer, artikelnr, actie, oppervlak_delta_m2,
    oud_json, nieuw_json, reden, medewerker
  ) VALUES (
    p_rol_id, v_rol.rolnummer, v_rol.artikelnr, 'bewerken', v_delta,
    jsonb_build_object('lengte_cm', v_rol.lengte_cm, 'breedte_cm', v_rol.breedte_cm,
      'oppervlak_m2', v_rol.oppervlak_m2, 'status', v_rol.status,
      'locatie_id', v_rol.locatie_id),
    jsonb_build_object('lengte_cm', p_lengte_cm, 'breedte_cm', p_breedte_cm,
      'oppervlak_m2', v_opp_na, 'status', p_status, 'locatie_id', p_locatie_id),
    TRIM(p_reden), p_medewerker
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rol_handmatig_bewerken(BIGINT,INTEGER,INTEGER,BIGINT,TEXT,TEXT,TEXT) IS
  'Handmatige rol-correctie: afmetingen/locatie/status. Weigert mutatie op '
  'rollen die aan snijplan/claim hangen. Geen producten.voorraad-mutatie. '
  'Audit in rol_mutaties. Mig 292.';

GRANT EXECUTE ON FUNCTION rol_handmatig_bewerken(BIGINT,INTEGER,INTEGER,BIGINT,TEXT,TEXT,TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 292 toegepast: rol_handmatig_bewerken aangemaakt.';
END $$;
```

- [ ] **Step 4: Pas mig 292 toe + draai het zelftest-script — verwacht PASS**

Draai mig 292, dan `scripts/test-rol-crud.sql`.
Verwacht: `TASK2 TESTS GESLAAGD` én `TASK3 TESTS GESLAAGD`, geen exception.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/292_rol_handmatig_bewerken.sql scripts/test-rol-crud.sql
git commit -m "feat(rol-crud): mig 292 rol_handmatig_bewerken + zelftest

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Migratie 293 — `rol_verwijderen` RPC

**Files:**
- Create: `supabase/migrations/293_rol_verwijderen.sql`
- Modify: `scripts/test-rol-crud.sql` (derde testblok toevoegen)

- [ ] **Step 1: Voeg het falende verwijder-testblok toe aan `scripts/test-rol-crud.sql`**

Voeg, **direct vóór de regel `ROLLBACK;`**, dit blok toe:

```sql
DO $$
DECLARE
  v_rol_id BIGINT;
  v_audit  RECORD;
BEGIN
  -- 1. Beschikbare rol mag verwijderd; auditregel blijft (rol_id behouden).
  SELECT rol_id INTO v_rol_id FROM rol_handmatig_toevoegen(
    'TESTROLCRUD01','volle_rol'::rol_type, 1000, 400, NULL,
    NULL, NULL, 'seed voor verwijderen', 'tester');
  PERFORM rol_verwijderen(v_rol_id, 'fysiek verlies', 'tester');
  ASSERT NOT EXISTS (SELECT 1 FROM rollen WHERE id = v_rol_id),
    'rol niet verwijderd';
  SELECT * INTO v_audit FROM rol_mutaties
  WHERE rol_id = v_rol_id AND actie = 'verwijderen';
  ASSERT v_audit.id IS NOT NULL, 'geen auditregel voor verwijderen';
  ASSERT v_audit.oud_json IS NOT NULL, 'oud_json ontbreekt bij verwijderen';
  RAISE NOTICE 'verwijderen-beschikbaar+audit: OK';

  -- 2. Gereserveerde rol geweigerd.
  SELECT rol_id INTO v_rol_id FROM rol_handmatig_toevoegen(
    'TESTROLCRUD01','volle_rol'::rol_type, 1000, 400, NULL,
    NULL, NULL, 'seed gereserveerd', 'tester');
  UPDATE rollen SET status = 'gereserveerd' WHERE id = v_rol_id;
  BEGIN
    PERFORM rol_verwijderen(v_rol_id, 'mag niet', 'tester');
    RAISE EXCEPTION 'verwijderen gereserveerde rol had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%gereserveerd%' OR SQLERRM LIKE '%niet verwijderd%',
      'verkeerde fout: ' || SQLERRM;
  END;
  RAISE NOTICE 'verwijderen-gereserveerd-geweigerd: OK';

  -- 3. Los reststuk (status reststuk) zonder snijplan mag verwijderd.
  SELECT rol_id INTO v_rol_id FROM rol_handmatig_toevoegen(
    'TESTROLCRUD01','reststuk'::rol_type, 80, 400, NULL,
    NULL, NULL, 'seed reststuk', 'tester');
  UPDATE rollen SET status = 'reststuk' WHERE id = v_rol_id;
  PERFORM rol_verwijderen(v_rol_id, 'reststuk opgeruimd', 'tester');
  ASSERT NOT EXISTS (SELECT 1 FROM rollen WHERE id = v_rol_id),
    'los reststuk niet verwijderd';
  RAISE NOTICE 'verwijderen-los-reststuk: OK';

  -- 4. Lege reden geweigerd.
  SELECT rol_id INTO v_rol_id FROM rol_handmatig_toevoegen(
    'TESTROLCRUD01','volle_rol'::rol_type, 500, 400, NULL,
    NULL, NULL, 'seed lege reden', 'tester');
  BEGIN
    PERFORM rol_verwijderen(v_rol_id, '  ', 'tester');
    RAISE EXCEPTION 'lege reden had geweigerd moeten worden';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%reden%', 'verkeerde fout: ' || SQLERRM;
  END;
  RAISE NOTICE 'verwijderen-lege-reden-geweigerd: OK';

  RAISE NOTICE 'ALLE TESTS GESLAAGD';
END $$;
```

- [ ] **Step 2: Draai het script — verwacht FAIL op het nieuwe blok**

Draai `scripts/test-rol-crud.sql`. Verwacht: fout `function rol_verwijderen(...) does not exist`.

- [ ] **Step 3: Schrijf de migratie**

Maak `supabase/migrations/293_rol_verwijderen.sql`:

```sql
-- Migratie 293: rol_verwijderen — handmatige rol-verwijdering met guard
--
-- Toegestaan: status='beschikbaar', of los reststuk (rol_type='reststuk' en
-- status NOT IN gereserveerd/in_snijplan/verkocht/gesneden). Geweigerd als de
-- rol aan een snijplan hangt. Auditregel WORDT EERST geschreven (rol_id blijft
-- als getal bewaard, geen FK) zodat de audit de verwijdering overleeft.

CREATE OR REPLACE FUNCTION rol_verwijderen(
  p_rol_id     BIGINT,
  p_reden      TEXT,
  p_medewerker TEXT DEFAULT NULL
) RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol rollen%ROWTYPE;
BEGIN
  IF p_reden IS NULL OR TRIM(p_reden) = '' THEN
    RAISE EXCEPTION 'Reden is verplicht bij een handmatige rol-correctie.';
  END IF;

  SELECT * INTO v_rol FROM rollen WHERE id = p_rol_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rol % niet gevonden.', p_rol_id;
  END IF;

  IF NOT (
        v_rol.status = 'beschikbaar'
     OR (v_rol.rol_type = 'reststuk'
         AND v_rol.status NOT IN
             ('gereserveerd','in_snijplan','verkocht','gesneden'))
  ) THEN
    RAISE EXCEPTION
      'Rol % kan niet verwijderd worden: status is %.',
      v_rol.rolnummer, v_rol.status;
  END IF;

  IF EXISTS (SELECT 1 FROM snijplannen WHERE rol_id = p_rol_id) THEN
    RAISE EXCEPTION
      'Rol % kan niet verwijderd worden: zit in een snijplan.',
      v_rol.rolnummer;
  END IF;

  INSERT INTO rol_mutaties (
    rol_id, rolnummer, artikelnr, actie, oppervlak_delta_m2,
    oud_json, nieuw_json, reden, medewerker
  ) VALUES (
    p_rol_id, v_rol.rolnummer, v_rol.artikelnr, 'verwijderen',
    -COALESCE(v_rol.oppervlak_m2, 0),
    jsonb_build_object('lengte_cm', v_rol.lengte_cm, 'breedte_cm', v_rol.breedte_cm,
      'oppervlak_m2', v_rol.oppervlak_m2, 'status', v_rol.status,
      'rol_type', v_rol.rol_type, 'locatie_id', v_rol.locatie_id,
      'in_magazijn_sinds', v_rol.in_magazijn_sinds),
    NULL, TRIM(p_reden), p_medewerker
  );

  BEGIN
    DELETE FROM rollen WHERE id = p_rol_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION
      'Rol % kan niet hard verwijderd worden: er zijn historische '
      'voorraad-mutaties of koppelingen aan deze rol.', v_rol.rolnummer;
  END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rol_verwijderen(BIGINT,TEXT,TEXT) IS
  'Handmatige rol-verwijdering met guard (alleen beschikbaar of los reststuk, '
  'niet in snijplan). Auditregel vooraf in rol_mutaties (overleeft DELETE). '
  'Geen producten.voorraad-mutatie. Mig 293.';

GRANT EXECUTE ON FUNCTION rol_verwijderen(BIGINT,TEXT,TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 293 toegepast: rol_verwijderen aangemaakt.';
END $$;
```

- [ ] **Step 4: Pas mig 293 toe + draai het zelftest-script — verwacht PASS**

Draai mig 293, dan `scripts/test-rol-crud.sql`.
Verwacht: `TASK2 TESTS GESLAAGD`, `TASK3 TESTS GESLAAGD`, alle `verwijderen-*: OK`, en als slotregel `ALLE TESTS GESLAAGD`. Geen exception; `ROLLBACK` aan het eind (geen blijvende data).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/293_rol_verwijderen.sql scripts/test-rol-crud.sql
git commit -m "feat(rol-crud): mig 293 rol_verwijderen + complete zelftest

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend query-laag — `rolToevoegen` / `rolBewerken` / `rolVerwijderen`

**Files:**
- Modify: `frontend/src/lib/supabase/queries/rollen.ts`
- Create: `frontend/src/components/rollen/__tests__/rol-crud-queries.contract.test.ts`

- [ ] **Step 1: Schrijf de falende contract-test**

Maak `frontend/src/components/rollen/__tests__/rol-crud-queries.contract.test.ts` (patroon: `frontend/src/modules/inkoop/lib/__tests__/boek-ontvangst-contract.test.ts`):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcCalls: Array<{ fn: string; args: unknown }> = []
let nextRpcResponse: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(nextRpcResponse)
    },
  },
}))

import { rolToevoegen, rolBewerken, rolVerwijderen } from '@/lib/supabase/queries/rollen'

beforeEach(() => {
  rpcCalls.length = 0
  nextRpcResponse = { data: null, error: null }
})

describe('rol-crud query-laag contract', () => {
  it('rolToevoegen roept rol_handmatig_toevoegen met juiste param-shape', async () => {
    nextRpcResponse = { data: [{ rol_id: 1, rolnummer: 'CORR-X-1' }], error: null }
    await rolToevoegen({
      artikelnr: 'X', rol_type: 'volle_rol', lengte_cm: 1500, breedte_cm: 400,
      locatie_id: null, in_magazijn_sinds: '2025-01-10', rolnummer: null,
      reden: 'telfout', medewerker: 'm',
    })
    expect(rpcCalls[0].fn).toBe('rol_handmatig_toevoegen')
    expect(rpcCalls[0].args).toEqual({
      p_artikelnr: 'X', p_rol_type: 'volle_rol', p_lengte_cm: 1500,
      p_breedte_cm: 400, p_locatie_id: null, p_in_magazijn_sinds: '2025-01-10',
      p_rolnummer: null, p_reden: 'telfout', p_medewerker: 'm',
    })
  })

  it('rolBewerken roept rol_handmatig_bewerken met juiste param-shape', async () => {
    await rolBewerken({
      rol_id: 7, lengte_cm: 1200, breedte_cm: 400, locatie_id: 3,
      status: 'beschikbaar', reden: 'meting', medewerker: 'm',
    })
    expect(rpcCalls[0].fn).toBe('rol_handmatig_bewerken')
    expect(rpcCalls[0].args).toEqual({
      p_rol_id: 7, p_lengte_cm: 1200, p_breedte_cm: 400, p_locatie_id: 3,
      p_status: 'beschikbaar', p_reden: 'meting', p_medewerker: 'm',
    })
  })

  it('rolVerwijderen roept rol_verwijderen met juiste param-shape', async () => {
    await rolVerwijderen({ rol_id: 9, reden: 'verlies', medewerker: 'm' })
    expect(rpcCalls[0].fn).toBe('rol_verwijderen')
    expect(rpcCalls[0].args).toEqual({
      p_rol_id: 9, p_reden: 'verlies', p_medewerker: 'm',
    })
  })

  it('propageert Supabase-fout als Error', async () => {
    nextRpcResponse = { data: null, error: { message: 'Rolnummer X bestaat al.' } }
    await expect(
      rolVerwijderen({ rol_id: 1, reden: 'x', medewerker: 'm' }),
    ).rejects.toThrow('Rolnummer X bestaat al.')
  })
})
```

- [ ] **Step 2: Draai de test — verwacht FAIL**

Run: `cd frontend && npx vitest run src/components/rollen/__tests__/rol-crud-queries.contract.test.ts`
Expected: FAIL — `rolToevoegen` / `rolBewerken` / `rolVerwijderen` niet geëxporteerd.

- [ ] **Step 3: Voeg de query-functies toe aan `rollen.ts`**

Voeg onderaan `frontend/src/lib/supabase/queries/rollen.ts` toe:

```ts
import type { RolType } from '@/lib/types/productie'

export interface RolToevoegenInput {
  artikelnr: string
  rol_type: RolType
  lengte_cm: number
  breedte_cm: number
  locatie_id: number | null
  in_magazijn_sinds: string | null
  rolnummer: string | null
  reden: string
  medewerker: string | null
}

export interface RolBewerkenInput {
  rol_id: number
  lengte_cm: number
  breedte_cm: number
  locatie_id: number | null
  status: string
  reden: string
  medewerker: string | null
}

export interface RolVerwijderenInput {
  rol_id: number
  reden: string
  medewerker: string | null
}

/** Handmatig een rol/reststuk toevoegen (voorraadcorrectie). RPC mig 291. */
export async function rolToevoegen(
  i: RolToevoegenInput,
): Promise<{ rol_id: number; rolnummer: string }> {
  const { data, error } = await supabase.rpc('rol_handmatig_toevoegen', {
    p_artikelnr: i.artikelnr,
    p_rol_type: i.rol_type,
    p_lengte_cm: i.lengte_cm,
    p_breedte_cm: i.breedte_cm,
    p_locatie_id: i.locatie_id,
    p_in_magazijn_sinds: i.in_magazijn_sinds,
    p_rolnummer: i.rolnummer,
    p_reden: i.reden,
    p_medewerker: i.medewerker,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  return row as { rol_id: number; rolnummer: string }
}

/** Handmatig een rol bewerken (afmeting/locatie/status). RPC mig 292. */
export async function rolBewerken(i: RolBewerkenInput): Promise<void> {
  const { error } = await supabase.rpc('rol_handmatig_bewerken', {
    p_rol_id: i.rol_id,
    p_lengte_cm: i.lengte_cm,
    p_breedte_cm: i.breedte_cm,
    p_locatie_id: i.locatie_id,
    p_status: i.status,
    p_reden: i.reden,
    p_medewerker: i.medewerker,
  })
  if (error) throw new Error(error.message)
}

/** Handmatig een rol verwijderen (met guard). RPC mig 293. */
export async function rolVerwijderen(i: RolVerwijderenInput): Promise<void> {
  const { error } = await supabase.rpc('rol_verwijderen', {
    p_rol_id: i.rol_id,
    p_reden: i.reden,
    p_medewerker: i.medewerker,
  })
  if (error) throw new Error(error.message)
}
```

> Let op: `import { RolType }` bovenaan het bestand bestaat al (`import type { RolRow, RolType }`). Voeg geen dubbele import toe — gebruik de bestaande. Verwijder de losse `import type { RolType }`-regel hierboven als die al geïmporteerd is.

- [ ] **Step 4: Draai de test — verwacht PASS**

Run: `cd frontend && npx vitest run src/components/rollen/__tests__/rol-crud-queries.contract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: geen errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/supabase/queries/rollen.ts frontend/src/components/rollen/__tests__/rol-crud-queries.contract.test.ts
git commit -m "feat(rol-crud): query-laag rolToevoegen/rolBewerken/rolVerwijderen + contract-test

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `RolToevoegenDialog` component

**Files:**
- Create: `frontend/src/components/rollen/rol-toevoegen-dialog.tsx`

- [ ] **Step 1: Schrijf het component**

Maak `frontend/src/components/rollen/rol-toevoegen-dialog.tsx` (patroon: `debiteur-edit-dialog.tsx` — `useState`-form + `useMutation` + `useQueryClient`):

```tsx
import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { rolToevoegen } from '@/lib/supabase/queries/rollen'
import type { RolType } from '@/lib/types/productie'

interface Props {
  artikelnr: string
  productLabel: string
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

function vandaag(): string {
  return new Date().toISOString().slice(0, 10)
}

export function RolToevoegenDialog({ artikelnr, productLabel, onClose }: Props) {
  const qc = useQueryClient()
  const [rolType, setRolType] = useState<RolType>('volle_rol')
  const [lengte, setLengte] = useState('')
  const [breedte, setBreedte] = useState('')
  const [locatieId, setLocatieId] = useState('')
  const [binnenSinds, setBinnenSinds] = useState(vandaag())
  const [rolnummer, setRolnummer] = useState('')
  const [reden, setReden] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: locaties } = useQuery({
    queryKey: ['magazijn-locaties-actief'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('magazijn_locaties')
        .select('id, code, omschrijving')
        .eq('actief', true)
        .order('code')
      if (error) throw error
      return data as { id: number; code: string; omschrijving: string | null }[]
    },
  })

  const l = Number(lengte)
  const b = Number(breedte)
  const oppervlak = l > 0 && b > 0 ? (l * b) / 10000 : 0

  const save = useMutation({
    mutationFn: async () => {
      if (l <= 0 || b <= 0) throw new Error('Lengte en breedte moeten groter dan 0 zijn')
      if (reden.trim() === '') throw new Error('Reden is verplicht')
      return rolToevoegen({
        artikelnr,
        rol_type: rolType,
        lengte_cm: l,
        breedte_cm: b,
        locatie_id: locatieId === '' ? null : Number(locatieId),
        in_magazijn_sinds: binnenSinds || null,
        rolnummer: rolnummer.trim() === '' ? null : rolnummer.trim(),
        reden: reden.trim(),
        medewerker: null,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voorraadposities'] })
      onClose()
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Onbekende fout'),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    save.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-[var(--radius)] w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-medium text-slate-900">Rol toevoegen — {productLabel}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="px-5 py-4 space-y-3">
          <label className="block text-sm">
            <span className="text-slate-600">Type</span>
            <select className={inputClasses} value={rolType}
              onChange={(e) => setRolType(e.target.value as RolType)}>
              <option value="volle_rol">Volle rol</option>
              <option value="reststuk">Reststuk</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">Lengte (cm)</span>
              <input className={inputClasses} type="number" value={lengte}
                onChange={(e) => setLengte(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Breedte (cm)</span>
              <input className={inputClasses} type="number" value={breedte}
                onChange={(e) => setBreedte(e.target.value)} />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Oppervlak: <span className="font-medium">{oppervlak.toFixed(2)} m²</span>
          </p>
          <label className="block text-sm">
            <span className="text-slate-600">Locatie</span>
            <select className={inputClasses} value={locatieId}
              onChange={(e) => setLocatieId(e.target.value)}>
              <option value="">— geen —</option>
              {(locaties ?? []).map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code}{loc.omschrijving ? ` (${loc.omschrijving})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">In magazijn sinds</span>
            <input className={inputClasses} type="date" value={binnenSinds}
              onChange={(e) => setBinnenSinds(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Rolnummer (leeg = automatisch)</span>
            <input className={inputClasses} placeholder="auto" value={rolnummer}
              onChange={(e) => setRolnummer(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Reden *</span>
            <input className={inputClasses} value={reden} required
              onChange={(e) => setReden(e.target.value)} />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
              Annuleren
            </button>
            <button type="submit" disabled={save.isPending}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white hover:bg-terracotta-600 disabled:opacity-50">
              {save.isPending ? 'Bezig…' : 'Toevoegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: geen errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/rollen/rol-toevoegen-dialog.tsx
git commit -m "feat(rol-crud): RolToevoegenDialog component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `RolBewerkenDialog` component

**Files:**
- Create: `frontend/src/components/rollen/rol-bewerken-dialog.tsx`

- [ ] **Step 1: Schrijf het component**

Maak `frontend/src/components/rollen/rol-bewerken-dialog.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { rolBewerken } from '@/lib/supabase/queries/rollen'
import type { RolRow } from '@/lib/types/productie'

interface Props {
  rol: RolRow
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

// status-opties zonder gereserveerd/in_snijplan (claim-integriteit, mig 292)
const STATUS_OPTIES = ['beschikbaar', 'reststuk', 'verkocht', 'gesneden'] as const

export function RolBewerkenDialog({ rol, onClose }: Props) {
  const qc = useQueryClient()
  const [lengte, setLengte] = useState(String(rol.lengte_cm))
  const [breedte, setBreedte] = useState(String(rol.breedte_cm))
  const [locatieId, setLocatieId] = useState('')
  const [status, setStatus] = useState(rol.status)
  const [reden, setReden] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: locaties } = useQuery({
    queryKey: ['magazijn-locaties-actief'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('magazijn_locaties')
        .select('id, code, omschrijving')
        .eq('actief', true)
        .order('code')
      if (error) throw error
      return data as { id: number; code: string; omschrijving: string | null }[]
    },
  })

  const l = Number(lengte)
  const b = Number(breedte)
  const oppervlakNa = l > 0 && b > 0 ? (l * b) / 10000 : 0
  const delta = oppervlakNa - Number(rol.oppervlak_m2)

  const save = useMutation({
    mutationFn: async () => {
      if (l <= 0 || b <= 0) throw new Error('Lengte en breedte moeten groter dan 0 zijn')
      if (reden.trim() === '') throw new Error('Reden is verplicht')
      return rolBewerken({
        rol_id: rol.id,
        lengte_cm: l,
        breedte_cm: b,
        locatie_id: locatieId === '' ? null : Number(locatieId),
        status,
        reden: reden.trim(),
        medewerker: null,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voorraadposities'] })
      onClose()
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Onbekende fout'),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    save.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-[var(--radius)] w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-medium text-slate-900">Rol bewerken — {rol.rolnummer}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">Lengte (cm)</span>
              <input className={inputClasses} type="number" value={lengte}
                onChange={(e) => setLengte(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Breedte (cm)</span>
              <input className={inputClasses} type="number" value={breedte}
                onChange={(e) => setBreedte(e.target.value)} />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Oppervlak: <span className="font-medium">{oppervlakNa.toFixed(2)} m²</span>
            {delta !== 0 && (
              <span className={delta > 0 ? 'text-emerald-600' : 'text-red-600'}>
                {' '}({delta > 0 ? '+' : ''}{delta.toFixed(2)} m²)
              </span>
            )}
          </p>
          <label className="block text-sm">
            <span className="text-slate-600">Locatie</span>
            <select className={inputClasses} value={locatieId}
              onChange={(e) => setLocatieId(e.target.value)}>
              <option value="">— ongewijzigd / geen —</option>
              {(locaties ?? []).map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code}{loc.omschrijving ? ` (${loc.omschrijving})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Status</span>
            <select className={inputClasses} value={status}
              onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Reden *</span>
            <input className={inputClasses} value={reden} required
              onChange={(e) => setReden(e.target.value)} />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
              Annuleren
            </button>
            <button type="submit" disabled={save.isPending}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white hover:bg-terracotta-600 disabled:opacity-50">
              {save.isPending ? 'Bezig…' : 'Opslaan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: geen errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/rollen/rol-bewerken-dialog.tsx
git commit -m "feat(rol-crud): RolBewerkenDialog component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `RolVerwijderenDialog` component

**Files:**
- Create: `frontend/src/components/rollen/rol-verwijderen-dialog.tsx`

- [ ] **Step 1: Schrijf het component**

Maak `frontend/src/components/rollen/rol-verwijderen-dialog.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { rolVerwijderen } from '@/lib/supabase/queries/rollen'
import type { RolRow } from '@/lib/types/productie'

interface Props {
  rol: RolRow
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/30 focus:border-red-400'

export function RolVerwijderenDialog({ rol, onClose }: Props) {
  const qc = useQueryClient()
  const [reden, setReden] = useState('')
  const [error, setError] = useState<string | null>(null)

  const verwijder = useMutation({
    mutationFn: async () => {
      if (reden.trim() === '') throw new Error('Reden is verplicht')
      return rolVerwijderen({ rol_id: rol.id, reden: reden.trim(), medewerker: null })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voorraadposities'] })
      onClose()
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Onbekende fout'),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    verwijder.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-[var(--radius)] w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-medium text-slate-900">Rol verwijderen</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-2 text-sm text-slate-600">
            <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <p>
              Rol <span className="font-mono">{rol.rolnummer}</span>{' '}
              ({Number(rol.oppervlak_m2).toFixed(2)} m²) wordt definitief verwijderd.
              De voorraad op deze pagina daalt direct met dit oppervlak.
            </p>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">Reden *</span>
            <input className={inputClasses} value={reden} required
              onChange={(e) => setReden(e.target.value)} />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
              Annuleren
            </button>
            <button type="submit" disabled={verwijder.isPending}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
              {verwijder.isPending ? 'Bezig…' : 'Verwijderen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: geen errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/rollen/rol-verwijderen-dialog.tsx
git commit -m "feat(rol-crud): RolVerwijderenDialog component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Knoppen + dialog-state in `rollen-groep-row.tsx`

**Files:**
- Modify: `frontend/src/components/rollen/rollen-groep-row.tsx`

Doel: "+ Rol toevoegen"-knop in de uitgeklapte groep; potlood + prullenbak per rol-rij; conditioneel uitgeschakeld + uitleg op niet-bewerkbare/verwijderbare rollen.

- [ ] **Step 1: Imports + helper toevoegen (bovenin het bestand)**

Vervang de bestaande icon-import-regel
`import { ChevronDown, ChevronRight, Loader2, Truck } from 'lucide-react'`
door:

```tsx
import { ChevronDown, ChevronRight, Loader2, Truck, Plus, Pencil, Trash2 } from 'lucide-react'
```

Voeg ná de bestaande imports toe:

```tsx
import { RolToevoegenDialog } from './rol-toevoegen-dialog'
import { RolBewerkenDialog } from './rol-bewerken-dialog'
import { RolVerwijderenDialog } from './rol-verwijderen-dialog'

// Een rol mag handmatig bewerkt/verwijderd worden zolang hij niet aan een
// snijplan/claim hangt (mig 292/293). 'reststuk' is bewerkbaar/verwijderbaar.
function isMuteerbaar(status: string): boolean {
  return status === 'beschikbaar' || status === 'reststuk'
}
```

- [ ] **Step 2: Rij-acties toevoegen aan `RolTabel`**

In `RolTabel`, voeg state toe bovenin de functie (naast `expandedRolId`):

```tsx
  const [bewerkRol, setBewerkRol] = useState<RolRow | null>(null)
  const [verwijderRol, setVerwijderRol] = useState<RolRow | null>(null)
```

Voeg een extra `<th>` toe als laatste kolom in de `thead`-rij (na "Locatie"):

```tsx
          <th className="py-2 px-3 font-medium text-right">Acties</th>
```

Voeg vóór de afsluitende `</tr>` van de databron-rij (na de Locatie-`<td>`,
dus na `<td className="py-2 px-3 text-slate-500">{rol.locatie ?? '—'}</td>`)
een acties-cel toe:

```tsx
                <td className="py-2 px-3 text-right whitespace-nowrap">
                  <button
                    onClick={(e) => { e.stopPropagation(); setBewerkRol(rol) }}
                    disabled={!isMuteerbaar(rol.status)}
                    title={isMuteerbaar(rol.status)
                      ? 'Bewerken'
                      : `Niet bewerkbaar: status ${rol.status}`}
                    className="p-1 text-slate-400 hover:text-terracotta-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setVerwijderRol(rol) }}
                    disabled={!isMuteerbaar(rol.status)}
                    title={isMuteerbaar(rol.status)
                      ? 'Verwijderen'
                      : `Niet verwijderbaar: status ${rol.status}`}
                    className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
```

Pas de bestaande details-rij `colSpan` aan van `6` naar `7`:

```tsx
                  <td colSpan={7} className="p-0">
```

Voeg, direct vóór de afsluitende `</table>` (ná `</tbody>`), de dialogen toe —
plaats ze als siblings ná de tabel door de return te wrappen. Vervang
`return (\n    <table className="w-full text-sm">` door:

```tsx
  return (
    <>
    <table className="w-full text-sm">
```

en vervang het afsluitende `</table>\n  )` door:

```tsx
    </table>
    {bewerkRol && (
      <RolBewerkenDialog rol={bewerkRol} onClose={() => setBewerkRol(null)} />
    )}
    {verwijderRol && (
      <RolVerwijderenDialog rol={verwijderRol} onClose={() => setVerwijderRol(null)} />
    )}
    </>
  )
```

- [ ] **Step 3: "+ Rol toevoegen"-knop in de uitgeklapte groep**

In `RollenGroepRow`, voeg state toe bovenin (naast `const [open, setOpen]`):

```tsx
  const [toevoegOpen, setToevoegOpen] = useState(false)
  const artikelnr = positie.rollen[0]?.artikelnr ?? null
```

Vervang het uitgeklapte blok:

```tsx
      {open && !isEmpty && (
        <div className="border-t border-slate-100 px-2 py-2">
          <RolTabel rollen={positie.rollen} />
        </div>
      )}
```

door:

```tsx
      {open && !isEmpty && (
        <div className="border-t border-slate-100 px-2 py-2">
          {artikelnr && (
            <div className="flex justify-end px-3 pb-2">
              <button
                onClick={() => setToevoegOpen(true)}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-[var(--radius-sm)] border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <Plus size={13} /> Rol toevoegen
              </button>
            </div>
          )}
          <RolTabel rollen={positie.rollen} />
        </div>
      )}
      {toevoegOpen && artikelnr && (
        <RolToevoegenDialog
          artikelnr={artikelnr}
          productLabel={productLabel}
          onClose={() => setToevoegOpen(false)}
        />
      )}
```

- [ ] **Step 4: Typecheck + bestaande tests**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: geen errors.

Run: `cd frontend && npx vitest run src/components/rollen src/modules/voorraadpositie`
Expected: alle bestaande + nieuwe tests groen.

- [ ] **Step 5: Visuele rooktest (handmatig)**

Run: `cd frontend && npm run dev` — open `/rollen`, klap een groep met rollen open. Verifieer: "+ Rol toevoegen" zichtbaar; potlood/prullenbak per rol; uitgeschakeld + tooltip op een rol met status ≠ beschikbaar/reststuk; toevoegen → rij verschijnt na sluiten (query invalidate); verwijderen van een `gereserveerd` rol toont de RPC-foutmelding inline.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/rollen/rollen-groep-row.tsx
git commit -m "feat(rol-crud): toevoegen/bewerken/verwijderen-acties in Rollen-pagina

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Documentatie + ADR

**Files:**
- Create: `docs/adr/0023-handmatige-rol-crud-rpc-laag.md`
- Modify: `docs/database-schema.md`, `docs/data-woordenboek.md`, `docs/changelog.md`, `CLAUDE.md`

- [ ] **Step 1: Schrijf de ADR**

Maak `docs/adr/0023-handmatige-rol-crud-rpc-laag.md`:

```markdown
# 0023 — Handmatige rol-CRUD via RPC-laag, géén producten.voorraad-koppeling

**Status:** Geaccepteerd · 2026-05-15

## Context
De Rollen & Reststukken-pagina was read-only. Karpi wil rollen/reststukken
handmatig kunnen toevoegen/bewerken/verwijderen voor voorraadcorrectie en
inventarisatie.

## Beslissing
Drie `SECURITY DEFINER` RPC's (`rol_handmatig_toevoegen`,
`rol_handmatig_bewerken`, `rol_verwijderen`, mig 291-293) zijn het enige
mutatiepad. Elke RPC valideert, muteert en schrijft een auditregel in de nieuwe
tabel `rol_mutaties` (mig 290) in één transactie. Verwijderen heeft een guard
(alleen `beschikbaar` of los reststuk, niet in snijplan).

**Géén `producten.voorraad`-koppeling.** Geverifieerd in de code:
- de pagina toont m²-totalen live via `SUM(rollen.oppervlak_m2)`
  (`voorraadposities`-RPC, mig 179/180);
- de order-allocator/`order_reserveringen` is alleen voor `eenheid='stuks'`
  (mig 145) — rol-producten doen daar niet aan mee;
- geen RPC/trigger onderhoudt `producten.voorraad` vanuit rollen voor
  rol-artikelen.
Koppelen zou een legacy-kolom muteren die voor rollen nergens gelezen wordt.

## Alternatieven (verworpen)
- **B — directe table-writes vanuit frontend:** niet atomair, race-condities,
  wijkt af van het RPC-mutatiepatroon. Verworpen.
- **C — `producten.voorraad` volledig afleiden uit `SUM(rollen)` via trigger:**
  grote ingreep die alle bestaande ontvangst-/snij-RPC's raakt. Buiten scope;
  eigen traject.
- **`voorraad_mutaties` hergebruiken i.p.v. `rol_mutaties`:** kan niet —
  `rol_id` is `NOT NULL` met FK (overleeft delete niet) en er is geen
  verplichte-`reden`-kolom (mig 148 + database-schema.md ⚠️-noot).

## Gevolgen
Pagina is na elke mutatie automatisch correct. Volledige audittrail. Mogelijke
drift van de legacy `producten.voorraad` voor rol-artikelen blijft bestaan maar
is functioneel irrelevant (niemand leest het voor rollen).
```

- [ ] **Step 2: Werk `docs/database-schema.md` bij**

Voeg in de tabellen-sectie (alfabetisch/logisch nabij `voorraad_mutaties`) een
`### rol_mutaties`-blok toe met de 11 kolommen uit Task 1 en de notitie
"rol_id bewust GEEN FK (overleeft delete); reden verplicht; mig 290".

Voeg in de functie-tabel (rond regel 1272-1282) drie regels toe:

```markdown
| `rol_handmatig_toevoegen(p_artikelnr TEXT, p_rol_type rol_type, p_lengte_cm INT, p_breedte_cm INT, p_locatie_id BIGINT, p_in_magazijn_sinds DATE, p_rolnummer TEXT, p_reden TEXT, p_medewerker TEXT) → TABLE(rol_id BIGINT, rolnummer TEXT)` | Handmatige rol/reststuk-correctie (voorraadcorrectie/inventarisatie). Geen IO-koppeling, geen producten.voorraad-mutatie. Audit in `rol_mutaties`. Mig 291 (ADR-0023). |
| `rol_handmatig_bewerken(p_rol_id BIGINT, p_lengte_cm INT, p_breedte_cm INT, p_locatie_id BIGINT, p_status TEXT, p_reden TEXT, p_medewerker TEXT) → VOID` | Corrigeer afmetingen/locatie/status. Weigert mutatie op rollen die aan snijplan/claim hangen. Mig 292 (ADR-0023). |
| `rol_verwijderen(p_rol_id BIGINT, p_reden TEXT, p_medewerker TEXT) → VOID` | Verwijder rol met guard (alleen beschikbaar of los reststuk, niet in snijplan). Auditregel vooraf. Mig 293 (ADR-0023). |
```

- [ ] **Step 3: Werk `docs/data-woordenboek.md` bij**

Voeg een begrip toe:

```markdown
### Voorraadcorrectie (handmatige rol-mutatie)
Handmatig toevoegen/bewerken/verwijderen van een rol of reststuk op de Rollen &
Reststukken-pagina, voor inventarisatie of het rechtzetten van telfouten,
historische rollen, beginvoorraad of fysiek verlies. Loopt via de RPC's
`rol_handmatig_toevoegen` / `_bewerken` / `rol_verwijderen` (mig 291-293) en
wordt gelogd in `rol_mutaties` met verplichte reden. Raakt `producten.voorraad`
bewust niet (ADR-0023).
```

- [ ] **Step 4: Werk `docs/changelog.md` bij**

Voeg bovenaan een datum-entry toe:

```markdown
## 2026-05-15 — Handmatige rol-/reststuk-CRUD
- Rollen & Reststukken-pagina: rollen/reststukken toevoegen, bewerken,
  verwijderen via RPC-laag (mig 291-293) + audittabel `rol_mutaties` (mig 290).
- Verwijder-guard: alleen `beschikbaar`/los reststuk, niet in snijplan.
- **Herziene aanname:** `producten.voorraad` wordt bewust NIET gekoppeld — de
  pagina is live-correct via `SUM(rollen)`; voor rol-artikelen is
  `producten.voorraad` legacy/ongelezen (zie ADR-0023).
```

- [ ] **Step 5: Werk `CLAUDE.md` bij**

Voeg onder de bedrijfsregels-lijst een bullet toe:

```markdown
- **Handmatige rol-/reststuk-CRUD (ADR-0023, mig 290-293):** rollen/reststukken handmatig toevoegen/bewerken/verwijderen op de Rollen & Reststukken-pagina loopt uitsluitend via RPC's `rol_handmatig_toevoegen` / `rol_handmatig_bewerken` / `rol_verwijderen` met verplichte `reden` en audittrail in `rol_mutaties`. **Géén `producten.voorraad`-koppeling** — de pagina is live-correct via `SUM(rollen)` (`voorraadposities`-RPC); voor rol-artikelen is `producten.voorraad` legacy/ongelezen. Verwijder-guard: alleen `status='beschikbaar'` of los reststuk zonder snijplan-koppeling; gereserveerd/in_snijplan/verkocht/gesneden geblokkeerd.
```

- [ ] **Step 6: Commit**

```bash
git add docs/adr/0023-handmatige-rol-crud-rpc-laag.md docs/database-schema.md docs/data-woordenboek.md docs/changelog.md CLAUDE.md
git commit -m "docs(rol-crud): ADR-0023 + schema/woordenboek/changelog/CLAUDE.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Definition of Done

- [ ] Mig 290-293 toegepast op Karpi-Supabase; `scripts/test-rol-crud.sql` eindigt op `ALLE TESTS GESLAAGD` zonder exception (en `ROLLBACK`).
- [ ] `cd frontend && npx tsc -b --noEmit` schoon.
- [ ] `cd frontend && npx vitest run src/components/rollen src/modules/voorraadpositie` groen.
- [ ] Handmatige rooktest op `/rollen`: toevoegen/bewerken/verwijderen werkt; pagina-m² beweegt mee; guard-foutmelding inline zichtbaar bij niet-verwijderbare rol.
- [ ] Docs + ADR-0023 + CLAUDE.md bijgewerkt en gecommit.

## Self-Review (uitgevoerd bij opstellen)

- **Spec-dekking:** alle spec-secties gedekt — `rol_mutaties` (T1), 3 RPC's (T2-T4), query-laag (T5), 3 dialogen (T6-T8), UI-bedrading (T9), foutafhandeling (RPC `RAISE EXCEPTION` + inline `error`-state in dialogen), tests (SQL-zelftest + contract-test), docs/ADR (T10). Voorraad-koppeling bewust afwezig conform herziene spec.
- **Placeholder-scan:** geen TBD/TODO; alle code-stappen bevatten volledige code.
- **Type-consistentie:** RPC-parameternamen (`p_*`) identiek tussen migratie, query-laag (T5) en contract-test (T5). `RolToevoegenInput`/`RolBewerkenInput`/`RolVerwijderenInput` consistent gebruikt in T5-T8. `rol_type` ENUM-waarden (`volle_rol`/`reststuk`) consistent. `colSpan` 6→7 en `<th>`-toevoeging consistent in T9.
- **Aandachtspunt voor uitvoerder:** in T5 staat een losse `import type { RolType }`-regel die in `rollen.ts` al via de bestaande `import type { RolRow, RolType }` aanwezig is — gebruik de bestaande import, voeg geen dubbele toe (expliciet vermeld in de stap).
