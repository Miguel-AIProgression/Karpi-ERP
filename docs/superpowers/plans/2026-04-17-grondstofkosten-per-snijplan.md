# Grondstofkosten per Snijplan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bij elke rol-afsluiting opslaan hoeveel grondstofkosten (€) aan elk gesneden stuk zijn toe te rekenen, inclusief proportioneel afval, zodat we later exacte winstmarges per orderregel kunnen berekenen.

**Architecture:** Bij `voltooi_snijplan_rol` weten we definitief hoeveel m² als gesneden stuk, als reststuk (terug naar voorraad) en als afval (weggegooid) wordt afgerekend. We snapshotten `inkoopprijs_m2` uit de bronrol, alloceren afval pro rata over gesneden stukken op basis van hun m², en kennen reststukken hun correcte voorraadwaarde toe. Alle logica blijft in één PL/pgSQL-functie (RPC-aanroep vanuit frontend blijft ongewijzigd).

**Tech Stack:** PostgreSQL (PL/pgSQL), Supabase migrations, psql-smoke-test.

---

## File Structure

**Create:**
- `supabase/migrations/088_grondstofkosten_per_snijplan.sql` — kolommen op `snijplannen`, herschrijft `voltooi_snijplan_rol`, zet `waarde` op nieuwe reststuk-rollen
- `scripts/test-grondstofkosten-rpc.sql` — psql-smoke-test in BEGIN/ROLLBACK; checkt de formule end-to-end met fixtures

**Modify:**
- `docs/database-schema.md` — sectie `### snijplannen` uitbreiden met 3 kolommen; sectie `### rollen` toelichting op `waarde` voor reststukken
- `docs/changelog.md` — entry toevoegen

**Do NOT touch (uit scope):**
- Frontend (`productie-rol.tsx`, `use-snijplanning.ts`, queries) — RPC-signatuur blijft gelijk, velden worden transparent ingevuld
- Dashboard/rapportages — winstmarge-views komen in een vervolgplan
- Backfill oude reststuk-rollen zonder `waarde` — YAGNI, later als dashboard-accuracy ons dwingt

---

## Formules (referentie)

Gegeven bronrol met `oppervlak_m2 = O`, `waarde = W`:

```
prijs_per_m2 = W / O                                   (guard: als O NULL/0 of W NULL → 0)

voor nieuw aangemaakte reststuk-rol r:
  r.waarde = ROUND(r.oppervlak_m2 * prijs_per_m2, 2)

stuk_m2[i]   = snijplannen[i].lengte_cm * breedte_cm / 10000
gesneden_m2  = Σ stuk_m2[i]                             (alleen NU afgevinkte snijplannen)
reststuk_m2  = Σ nieuwe_reststuk.oppervlak_m2
afval_m2     = GREATEST(0, O - gesneden_m2 - reststuk_m2)

voor elk NU afgevinkt snijplan i:
  aandeel[i]                  = stuk_m2[i] / gesneden_m2            (als gesneden_m2 > 0)
  toegerekend_afval_m2[i]     = afval_m2 * aandeel[i]
  grondstofkosten_m2[i]       = stuk_m2[i] + toegerekend_afval_m2[i]
  inkoopprijs_m2[i]           = prijs_per_m2
  grondstofkosten[i]          = ROUND(grondstofkosten_m2[i] * prijs_per_m2, 2)
```

**Edge cases:**
- `O = 0/NULL` of `W = NULL`: laat de 3 kolommen op de snijplannen `NULL` staan (onbekend), zet reststuk.waarde op NULL. Niet faken met 0 — maakt later filteren mogelijk.
- `gesneden_m2 = 0` (bv. lege `p_snijplan_ids` array): niets te updaten, skip de kostenblok.
- Reststuk-rechthoek haalt drempel niet (< 70×140): wordt al overgeslagen in de bestaande loop — telt dus terecht als afval.

---

## Task 1: Schema migratie — kolommen + hulpveld voor reststuk-waarde

**Files:**
- Create: `supabase/migrations/088_grondstofkosten_per_snijplan.sql`

Deze taak voegt alléén de kolommen toe. Functie-wijziging volgt in Task 2 (zelfde migratiebestand, opgebouwd in stappen).

- [ ] **Step 1: Maak migratiebestand aan met kolom-definities**

Bestand `supabase/migrations/088_grondstofkosten_per_snijplan.sql`:

```sql
-- Migration 088: Grondstofkosten per snijplan bij rol-afsluiting
--
-- Context: bij het afsluiten van een rol (voltooi_snijplan_rol, migratie 066)
-- weten we definitief hoeveel materiaal is verbruikt per gesneden stuk,
-- hoeveel reststukken teruggaan naar voorraad, en hoeveel afval is.
-- We leggen per snijplan de toegerekende grondstofkosten vast, inclusief
-- proportioneel afval-aandeel, zodat latere winstmarge-berekening exact is.
--
-- Ook: nieuwe reststuk-rollen krijgen een waarde toegekend
-- (oppervlak_m2 × inkoopprijs_m2 van bronrol). Zonder dit telt de reststuk
-- voorraadwaarde niet mee in dashboard_stats.voorraadwaarde_inkoop.

ALTER TABLE snijplannen
  ADD COLUMN grondstofkosten     NUMERIC(12,2),
  ADD COLUMN grondstofkosten_m2  NUMERIC(10,4),
  ADD COLUMN inkoopprijs_m2      NUMERIC(10,2);

COMMENT ON COLUMN snijplannen.grondstofkosten IS
  'Toegerekende grondstofkosten in € voor dit gesneden stuk incl. proportioneel afval. Gezet bij voltooi_snijplan_rol. NULL als bronrol geen waarde/oppervlak had.';
COMMENT ON COLUMN snijplannen.grondstofkosten_m2 IS
  'Aan dit stuk toegerekend materiaaloppervlak in m² = stuk_m² + (aandeel × afval_m²). Snapshot.';
COMMENT ON COLUMN snijplannen.inkoopprijs_m2 IS
  'Inkoopprijs per m² van bronrol op moment van snijden. Snapshot: rol.waarde / rol.oppervlak_m2.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/088_grondstofkosten_per_snijplan.sql
git commit -m "feat(snijplan): kolommen voor toegerekende grondstofkosten per stuk"
```

---

## Task 2: Schrijf de smoke-test eerst (TDD)

**Files:**
- Create: `scripts/test-grondstofkosten-rpc.sql`

Test-driven: schrijf eerst een SQL-script dat de verwachte eindtoestand na `voltooi_snijplan_rol` asserteert. Run nu — moet falen (functie vult de 3 kolommen nog niet, reststukken hebben nog geen waarde).

Fixture: 1 rol van **320 cm × 1000 cm** (= 32 m²), `waarde = € 640,00` → prijs = € 20/m². 3 snijplannen die 270×270 (7,29 m²), 250×380 (9,50 m²), 200×350 (7,00 m²) snijden. 1 reststuk-rechthoek van 70×380 (2,66 m²). Afval = 32 − 23,79 − 2,66 = 5,55 m².

Verwachte grondstofkosten per snijplan:
- 270×270 (7,29 m²): aandeel 7,29/23,79 = 0,3065 → afval-aandeel 1,7011 m² → totaal 8,991 m² → **€ 179,83**
- 250×380 (9,50 m²): aandeel 9,50/23,79 = 0,3993 → afval-aandeel 2,2161 m² → totaal 11,716 m² → **€ 234,33**
- 200×350 (7,00 m²): aandeel 7,00/23,79 = 0,2942 → afval-aandeel 1,6330 m² → totaal 8,633 m² → **€ 172,66**

Som = € 586,82 + reststuk-waarde € 53,20 = € 640,02 ≈ € 640 (kleine rounding, acceptabel).

- [ ] **Step 1: Schrijf fixtures + assertions in SQL**

Bestand `scripts/test-grondstofkosten-rpc.sql`:

```sql
-- Smoke-test voor voltooi_snijplan_rol grondstofkosten-toerekening.
-- Run:  psql $SUPABASE_DB_URL -f scripts/test-grondstofkosten-rpc.sql
-- Slaagt: SELECT 1 aan het eind. Faalt: RAISE EXCEPTION met diff.

BEGIN;

-- Fixture: kwaliteit/product/rol
INSERT INTO kwaliteiten (code, naam) VALUES ('TEST', 'Test kwaliteit')
  ON CONFLICT (code) DO NOTHING;

INSERT INTO producten (artikelnr, naam, kwaliteit_code, standaard_breedte_cm)
VALUES ('TEST320', 'Test 320', 'TEST', 320)
  ON CONFLICT (artikelnr) DO NOTHING;

INSERT INTO rollen (id, rolnummer, artikelnr, kwaliteit_code, kleur_code,
                    lengte_cm, breedte_cm, oppervlak_m2, status, waarde)
VALUES (999001, 'TEST-ROL-01', 'TEST320', 'TEST', '00',
        1000, 320, 32.00, 'in_snijplan', 640.00);

-- 3 snijplannen direct op de rol (skip orders/order_regels via dummy)
-- We maken dummy order_regel voor FK.
INSERT INTO klanten (debiteur_nr, naam) VALUES (99901, 'Test klant')
  ON CONFLICT (debiteur_nr) DO NOTHING;

INSERT INTO orders (id, ordernummer, debiteur_nr, status)
VALUES (999001, 'TEST-ORD-01', 99901, 'Concept')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO order_regels (id, order_id, regelnummer, artikelnr, aantal)
VALUES (999001, 999001, 1, 'TEST320', 1),
       (999002, 999001, 2, 'TEST320', 1),
       (999003, 999001, 3, 'TEST320', 1)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO snijplannen (id, snijplan_nr, order_regel_id, rol_id,
                          lengte_cm, breedte_cm, status,
                          positie_x_cm, positie_y_cm, geroteerd)
VALUES (999001, 'TEST-SNIJ-01', 999001, 999001, 270, 270, 'Snijden', 0, 0, FALSE),
       (999002, 'TEST-SNIJ-02', 999002, 999001, 380, 250, 'Snijden', 0, 270, FALSE),
       (999003, 'TEST-SNIJ-03', 999003, 999001, 350, 200, 'Snijden', 0, 650, FALSE);

-- Call
PERFORM voltooi_snijplan_rol(
  p_rol_id => 999001,
  p_gesneden_door => 'test',
  p_reststukken => '[{"breedte_cm": 70, "lengte_cm": 380}]'::JSONB,
  p_snijplan_ids => ARRAY[999001::BIGINT, 999002, 999003]
);

-- Assertions
DO $$
DECLARE
  v_kosten_1 NUMERIC; v_kosten_2 NUMERIC; v_kosten_3 NUMERIC;
  v_reststuk_waarde NUMERIC;
BEGIN
  SELECT grondstofkosten INTO v_kosten_1 FROM snijplannen WHERE id = 999001;
  SELECT grondstofkosten INTO v_kosten_2 FROM snijplannen WHERE id = 999002;
  SELECT grondstofkosten INTO v_kosten_3 FROM snijplannen WHERE id = 999003;
  SELECT waarde INTO v_reststuk_waarde FROM rollen WHERE oorsprong_rol_id = 999001 LIMIT 1;

  IF ABS(v_kosten_1 - 179.83) > 0.50 THEN
    RAISE EXCEPTION 'snijplan 1 kosten: verwacht ~179.83, kreeg %', v_kosten_1;
  END IF;
  IF ABS(v_kosten_2 - 234.33) > 0.50 THEN
    RAISE EXCEPTION 'snijplan 2 kosten: verwacht ~234.33, kreeg %', v_kosten_2;
  END IF;
  IF ABS(v_kosten_3 - 172.66) > 0.50 THEN
    RAISE EXCEPTION 'snijplan 3 kosten: verwacht ~172.66, kreeg %', v_kosten_3;
  END IF;
  IF ABS(v_reststuk_waarde - 53.20) > 0.50 THEN
    RAISE EXCEPTION 'reststuk waarde: verwacht ~53.20, kreeg %', v_reststuk_waarde;
  END IF;
END $$;

SELECT 1 AS ok;

ROLLBACK;
```

- [ ] **Step 2: Run de test tegen een Supabase branch en verifieer dat hij faalt**

Run:
```bash
psql "$SUPABASE_DB_URL" -f scripts/test-grondstofkosten-rpc.sql
```
Expected: `ERROR: snijplan 1 kosten: verwacht ~179.83, kreeg <NULL>` (of soortgelijk — kolommen bestaan maar worden nog niet gevuld).

- [ ] **Step 3: Commit**

```bash
git add scripts/test-grondstofkosten-rpc.sql
git commit -m "test(snijplan): smoke-test voor grondstofkosten-toerekening (rood)"
```

---

## Task 3: Update `voltooi_snijplan_rol` — vul kosten in

**Files:**
- Modify: `supabase/migrations/088_grondstofkosten_per_snijplan.sql` (append)

De strategie: we verweven NIET met de bestaande logica (te risicovol om 066 te refactoren). In plaats daarvan: **`CREATE OR REPLACE FUNCTION voltooi_snijplan_rol` met volledige body van migratie 066, plus aan het einde een nieuwe kosten-blok vóór het `END $$`.**

- [ ] **Step 1: Append `CREATE OR REPLACE FUNCTION` aan migratie 088**

Kopieer de volledige functie uit `supabase/migrations/066_voltooi_snijplan_rol_partial.sql` (regels 26–189) naar het einde van `supabase/migrations/088_grondstofkosten_per_snijplan.sql`. Vervang de `BEGIN` … `END $$` body door de uitgebreide versie hieronder. **Voor de eenvoud: vervang alleen (a) de reststuk-INSERT om `waarde` mee te nemen en (b) voeg één nieuw blok toe vóór `END`.**

Concreet: zoek in de gekopieerde functiebody de twee `INSERT INTO rollen (..., status, oorsprong_rol_id, reststuk_datum) VALUES (...)` (regels 128–134 en 170–176 in migratie 066). Verander elk naar:

```sql
INSERT INTO rollen (rolnummer, artikelnr, kwaliteit_code, kleur_code,
                    lengte_cm, breedte_cm, oppervlak_m2, waarde, status,
                    oorsprong_rol_id, reststuk_datum)
VALUES (v_reststuk_nr, v_rol.artikelnr, v_rol.kwaliteit_code, v_rol.kleur_code,
        v_rect_lengte, v_rect_breedte,
        ROUND(v_rect_lengte * v_rect_breedte / 10000.0, 2),
        CASE
          WHEN v_rol.waarde IS NOT NULL AND v_rol.oppervlak_m2 > 0
          THEN ROUND((v_rect_lengte * v_rect_breedte / 10000.0)
                     * (v_rol.waarde / v_rol.oppervlak_m2), 2)
          ELSE NULL
        END,
        'beschikbaar', p_rol_id, CURRENT_DATE)
RETURNING id INTO v_reststuk_id;
```

(Voor de fallback-INSERT met `v_rest_lengte`/`v_rol.breedte_cm` idem: vervang `ROUND(v_rect_lengte * v_rect_breedte / ...)` door `ROUND(v_rest_lengte * v_rol.breedte_cm / ...)` op beide plekken.)

- [ ] **Step 2: Voeg kostentoerekening-blok toe vóór `END`**

Direct na de bestaande `RETURN NEXT;` / `RETURN;`-statements en vóór `END;`: plaats dit blok. Plaats hem zodat hij altijd draait (dus buiten de IF/ELSE structuren voor reststukken). Declareer extra variabelen bovenaan de functie:

```sql
DECLARE
  ... -- bestaande declaraties laten staan
  v_prijs_per_m2   NUMERIC;
  v_gesneden_m2    NUMERIC;
  v_reststuk_m2    NUMERIC;
  v_afval_m2       NUMERIC;
```

En het kosten-blok (plaats vóór `END;`, achter alle bestaande logica en RETURN NEXT paden — dus moet uitgevoerd worden vóór het einde van de functie. Dit vereist refactor: verwijder de `RETURN;`-statements in de reststuk-flows, gebruik in plaats daarvan `GOTO`/label of refactor naar continue. Eenvoudiger: verplaats de kostenblok naar **vóór** de reststuk-flows? Nee, we hebben reststuk_m2 nodig. Simpelste fix: bereken kosten in een losse helper-call na `RETURN QUERY` — maar we gebruiken RETURN NEXT…

**Pragmatisch:** herstructureer naar één exit-pad. Vervang alle `RETURN NEXT; RETURN;` door `v_done := TRUE; EXIT;` of laat alle paden doorlopen naar onderstaande finalisering. Concrete aanpak: wrap reststuk-logica in een BEGIN…END blok dat altijd doorgaat, daarna de kostencalc, daarna één `RETURN;`:

Herstructureer het onderste deel (na de partial-completion IF, vanaf regel 107 van migratie 066) naar:

```sql
  -- [bestaande reststuk JSONB-flow, maar zonder RETURN NEXT / RETURN]
  -- Reststuk-rows worden verzameld in een temp tabel
  CREATE TEMP TABLE IF NOT EXISTS _reststuk_out (
    reststuk_id BIGINT, reststuk_rolnummer TEXT, reststuk_lengte_cm INTEGER
  ) ON COMMIT DROP;
  DELETE FROM _reststuk_out;

  IF p_reststukken IS NOT NULL AND jsonb_array_length(p_reststukken) > 0 THEN
    -- ... bestaande FOR-loop ...
    -- vervang 'RETURN NEXT' door:
    INSERT INTO _reststuk_out VALUES (v_reststuk_id, v_reststuk_nr, v_rect_lengte);
    -- na de loop, als v_created = 0, insert één NULL-rij
  ELSE
    -- ... bestaande fallback ...
    INSERT INTO _reststuk_out VALUES (v_reststuk_id, v_reststuk_nr, v_rest_lengte);
    -- of met NULLs in de else-tak
  END IF;

  -- ------ NIEUW: grondstofkosten toerekenen ------
  IF v_rol.oppervlak_m2 IS NOT NULL AND v_rol.oppervlak_m2 > 0
     AND v_rol.waarde IS NOT NULL THEN

    v_prijs_per_m2 := v_rol.waarde / v_rol.oppervlak_m2;

    SELECT COALESCE(SUM(lengte_cm * breedte_cm / 10000.0), 0)
    INTO v_gesneden_m2
    FROM snijplannen
    WHERE rol_id = p_rol_id
      AND status = 'Gesneden'
      AND gesneden_op >= NOW() - INTERVAL '5 seconds';

    SELECT COALESCE(SUM(oppervlak_m2), 0)
    INTO v_reststuk_m2
    FROM rollen
    WHERE oorsprong_rol_id = p_rol_id
      AND reststuk_datum = CURRENT_DATE;

    v_afval_m2 := GREATEST(0, v_rol.oppervlak_m2 - v_gesneden_m2 - v_reststuk_m2);

    IF v_gesneden_m2 > 0 THEN
      UPDATE snijplannen sp
      SET grondstofkosten_m2 = ROUND(
            (sp.lengte_cm * sp.breedte_cm / 10000.0)
            + v_afval_m2 * ((sp.lengte_cm * sp.breedte_cm / 10000.0) / v_gesneden_m2),
            4),
          inkoopprijs_m2 = v_prijs_per_m2,
          grondstofkosten = ROUND(
            ((sp.lengte_cm * sp.breedte_cm / 10000.0)
             + v_afval_m2 * ((sp.lengte_cm * sp.breedte_cm / 10000.0) / v_gesneden_m2))
            * v_prijs_per_m2,
            2)
      WHERE sp.rol_id = p_rol_id
        AND sp.status = 'Gesneden'
        AND sp.gesneden_op >= NOW() - INTERVAL '5 seconds';
    END IF;
  END IF;

  -- ------ Return collected reststukken ------
  RETURN QUERY SELECT * FROM _reststuk_out;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Belangrijk bij kopiëren:** behoud het `LANGUAGE plpgsql SECURITY DEFINER` en de exacte parameter-signatuur (anders breekt de RPC-aanroep).

- [ ] **Step 3: Run de smoke-test opnieuw, moet groen zijn**

```bash
psql "$SUPABASE_DB_URL" -f scripts/test-grondstofkosten-rpc.sql
```
Expected: eindigt met `ok | 1`, transactie rolt terug (geen fixture-residu).

- [ ] **Step 4: Run ook met `p_reststukken = NULL` — fallback pad**

Voeg tijdelijk een 2e testcase toe aan het script (of draai handmatig) waarbij `p_reststukken` weggelaten wordt: verwachting is dat de fallback end-of-roll-reststuk berekening hetzelfde resultaat geeft voor een rol zonder verlies. Verifieer dat `grondstofkosten` ook dan worden gevuld.

- [ ] **Step 5: Edge-case: rol zonder waarde**

Voeg nog een fixture-case toe: rol met `waarde = NULL`. Verwachting: `grondstofkosten`, `grondstofkosten_m2`, `inkoopprijs_m2` blijven NULL op de snijplannen; reststuk.waarde blijft NULL.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/088_grondstofkosten_per_snijplan.sql scripts/test-grondstofkosten-rpc.sql
git commit -m "feat(snijplan): bereken en sla grondstofkosten op bij rol-afsluiting"
```

---

## Task 4: Docs bijwerken

**Files:**
- Modify: `docs/database-schema.md`
- Modify: `docs/changelog.md`

- [ ] **Step 1: Werk `database-schema.md` bij**

In sectie `### snijplannen` (rond regel 372), voeg na de bestaande kolommen toe:

```markdown
| grondstofkosten | NUMERIC(12,2) | Toegerekende inkoopkosten in € incl. proportioneel afval. Gezet bij voltooi_snijplan_rol. NULL = bronrol had geen waarde/oppervlak. Zie migratie 088. |
| grondstofkosten_m2 | NUMERIC(10,4) | Aan dit stuk toegerekend oppervlak in m² = stuk_m² + aandeel × afval_m². Snapshot. |
| inkoopprijs_m2 | NUMERIC(10,2) | Snapshot van rol.waarde / rol.oppervlak_m2 op moment van snijden. |
```

In sectie `### rollen` rond regel 216 (`waarde`): update de toelichting naar:

```markdown
| waarde | NUMERIC(12,2) | Totale inkoopwaarde van de rol. Voor reststuk-rollen: oppervlak_m2 × bronrol.inkoopprijs_m2 (gezet in voltooi_snijplan_rol vanaf migratie 088). Oude reststuk-rollen aangemaakt vóór 086 kunnen NULL zijn. |
```

- [ ] **Step 2: Werk `changelog.md` bij**

Voeg bovenaan toe (na de laatste 2026-04-17 entry):

```markdown
## 2026-04-17 — Grondstofkosten per snijplan

**Wat:** `snijplannen` krijgt 3 kolommen (`grondstofkosten`, `grondstofkosten_m2`, `inkoopprijs_m2`) die worden gevuld bij `voltooi_snijplan_rol`. Reststuk-rollen krijgen voortaan een `waarde` toegekend op basis van bronrol-inkoopprijs. Afval wordt proportioneel over gesneden stukken verdeeld.

**Waarom:** Nodig voor exacte winstmarge-berekening per orderregel: het weggegooide materiaal drukt op de stukken die op deze rol zijn gesneden, niet op toekomstige stukken uit reststukken.

**Migratie:** `088_grondstofkosten_per_snijplan.sql`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/database-schema.md docs/changelog.md
git commit -m "docs: grondstofkosten-kolommen + reststuk-waarde in schema en changelog"
```

---

## Task 5: Deploy naar branch + smoke-test in echte omgeving

- [ ] **Step 1: Deploy migratie via Supabase branch**

```bash
supabase db push --linked
# Of via MCP: mcp__claude_ai_Supabase__apply_migration
```

- [ ] **Step 2: Handmatige eindtest in frontend**

Ga naar `/snijplanning/productie-rol/:rol_id` voor een rol met waarde > 0, vink stukken af, klik **"Rol afsluiten"**. Controleer via SQL:

```sql
SELECT id, grondstofkosten, grondstofkosten_m2, inkoopprijs_m2
FROM snijplannen
WHERE rol_id = <net-afgesloten-rol-id>;
```

Verwachting: kolommen gevuld, totaal komt binnen ±1% op `rol.waarde`.

- [ ] **Step 3: Bij groen — geen actie. Bij rood — rollback**

Er is geen data-loss risico (alleen nieuwe kolommen), maar als berekening verkeerd staat: maak migratie 089 die de functie terugzet naar de exacte body van 066 plus een simpele `UPDATE snijplannen SET grondstofkosten_m2 = ...` zonder afval-allocatie als interim.

---

## Out-of-scope (expliciet, voor latere plannen)

1. **UI:** grondstofkosten tonen in productie-rol modal, in order-detail, in dashboard.
2. **Winstmarge-view:** SQL view die per orderregel `verkoopprijs − SUM(grondstofkosten snijplannen)` toont.
3. **Backfill:** oude reststuk-rollen zonder `waarde`, en oude snijplannen zonder `grondstofkosten`. Pas doen als dashboard-accuracy daarom vraagt.
4. **Confectie-kosten:** afwerking/arbeid toevoegen aan kostprijs. Dit plan dekt alleen de grondstof (tapijt-materiaal).
