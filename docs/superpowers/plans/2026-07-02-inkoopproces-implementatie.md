# Inkoopproces Volledig — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Volledig inkoopproces: transactioneel aanmaken (incl. stuks), wijzigen met Claim-vloer-guard, ontvangst met locatie + over-leveringsgrens, portal-huishouding en werkinstructie — zonder de HENAN-portal-koppeling of bestaande claims te breken.

**Architecture:** Alle writes via RPC's in de inkoop-module (ADR-0017). Nieuwe SQL-RPC's: `create_inkooporder`, `voeg_inkooporder_regel_toe`, `wijzig_inkooporder_regel`, `annuleer_inkooporder_regel`, `verwijder_inkooporder_regel`, helper `herbereken_inkooporder_status`; superset-herdefinitie van `boek_inkooporder_ontvangst_rollen` (locatie + 110%-grens). Frontend: bestaande module `frontend/src/modules/inkoop/` uitgebreid, dode React-portal verwijderd. De supplier-portal-edge-function en `update_regel_eta` blijven **ongewijzigd** — dat is de verbinding met portal.karpi.nl.

**Tech Stack:** Supabase (PostgreSQL/plpgsql, migraties handmatig via `supabase db query --linked -f`), React 18 + TypeScript + TanStack Query, Vitest.

**Spec:** `docs/superpowers/plans/2026-07-02-inkoopproces-volledig.md` (goedgekeurde besluiten 1-6). CONTEXT.md-termen **Claim-vloer** en **Leveranciersportal** zijn al vastgelegd.

**Vervallen t.o.v. de spec:** slice "ETA-herkomst-badge op Regeloverzicht" — bestaat al (kolom "Gewijzigd" in `inkoop-regel-overzicht-tab.tsx:264,321-339` toont datum + leverancier/Karpi). Geverifieerd 2026-07-02.

---

## Huisregels voor de uitvoerder (lees eerst)

1. **Migratienummers:** dit plan gebruikt werknummers **601-604** (ruim boven de live 575 van 02-07). Vóór Task 2: verifieer het hoogste nummer op origin/main én pas zo nodig alle nummers in dit plan aan (bekende parallelle-sessie-collisie, zie memory).
2. **SQL-bestanden altijd met de Write-tool schrijven** (nooit PowerShell `Set-Content -Encoding utf8` — BOM breekt `supabase db query`, geverifieerd deze sessie).
3. **Migraties draaien:** `supabase db query --linked -f supabase/migrations/<file>.sql` vanuit de worktree-root. `supabase db push` is verboden (memory).
4. **Typecheck:** `npx tsc --noEmit -p frontend/tsconfig.app.json` (de kale `-p .` is een no-op). Vóór push van gedeelde types: `cd frontend && npm run build`.
5. **Werk in de worktree, commit op de branch `feat/inkoopproces`** — controleer vóór elke commit met `git branch --show-current` (memory: subagent-commit-werkdir).
6. Geen nieuwe frontend-unit-tests: er komt geen nieuwe pure TS-logica bij (alle guards leven in SQL). De runnable checks zijn de gecommitte SQL-testscripts in `scripts/tests/inkoop/` + bestaande Vitest-suite + typecheck.

---

### Task 0: Worktree + nummer-verificatie

**Files:** geen (setup).

- [ ] **Step 1: Fetch + worktree aanmaken vanaf origin/main**

```powershell
git fetch origin
git worktree add .worktrees/inkoopproces -b feat/inkoopproces origin/main
```

- [ ] **Step 2: Hoogste migratienummer verifiëren**

```powershell
Get-ChildItem ".worktrees/inkoopproces/supabase/migrations" -Filter "*.sql" | Sort-Object Name | Select-Object -Last 3 -ExpandProperty Name
```

Expected: hoogste nummer ≤ 600. Is er al een `601_*.sql` of hoger op origin/main → hernummer 601-604 in dit plan naar de eerstvolgende vrije nummers (ook in de bestandsnamen hieronder).

- [ ] **Step 3: Frontend-dependencies + baseline groen**

```powershell
Set-Location ".worktrees/inkoopproces/frontend"; npm install; npx vitest run --reporter=dot
```

Expected: alle bestaande tests PASS. Werk vanaf nu uitsluitend in `.worktrees/inkoopproces/`.

---

### Task 1: TS-callers omzetten naar de nieuwe ontvangst-RPC-namen

De live UI roept nog de DEPRECATED wrappers `boek_ontvangst`/`boek_voorraad_ontvangst` aan (deadline 2026-07-13). De nieuwe namen (`boek_inkooporder_ontvangst_rollen`/`_stuks`, mig 271) bestaan al live — de switch kan dus direct.

**Files:**
- Modify: `frontend/src/modules/inkoop/queries/inkooporders.ts` (functies `boekOntvangst`, `boekVoorraadOntvangst`)
- Modify: `frontend/src/modules/inkoop/hooks/use-boek-ontvangst.ts` (verouderd Task-4-commentaar)

- [ ] **Step 1: RPC-namen omzetten in queries/inkooporders.ts**

Vervang de body van beide functies (de functienamen en signatures blijven gelijk — alle callers ongemoeid):

```typescript
export async function boekOntvangst(
  regel_id: number,
  rollen: OntvangstRol[],
  medewerker?: string,
): Promise<Array<{ rol_id: number; rolnummer: string }>> {
  const { data, error } = await supabase.rpc('boek_inkooporder_ontvangst_rollen', {
    p_regel_id: regel_id,
    p_rollen: rollen,
    p_medewerker: medewerker ?? null,
  })
  if (error) throw error
  return (data ?? []) as Array<{ rol_id: number; rolnummer: string }>
}

export async function boekVoorraadOntvangst(
  regel_id: number,
  aantal: number,
  medewerker?: string,
): Promise<void> {
  const { error } = await supabase.rpc('boek_inkooporder_ontvangst_stuks', {
    p_regel_id: regel_id,
    p_aantal: aantal,
    p_medewerker: medewerker ?? null,
  })
  if (error) throw error
}
```

- [ ] **Step 2: Verouderd commentaarblok in use-boek-ontvangst.ts vervangen**

Vervang de doc-comment (regels 9-21, "In Task 4 (mig 271)...") door:

```typescript
/**
 * RPC-wrapper voor de ontvangst-flow.
 * Roept de Inkoop-Module-RPC's aan: `boek_inkooporder_ontvangst_stuks`
 * (stuks-pad) en `boek_inkooporder_ontvangst_rollen` (rollen-pad, mig 271+).
 * Discriminator op input: `aantal` → stuks-pad; `rollen` → rollen-pad.
 */
```

- [ ] **Step 3: Verifieer dat de oude namen nergens meer in frontend/src voorkomen**

```powershell
Select-String -Path "frontend/src" -Pattern "'boek_ontvangst'|'boek_voorraad_ontvangst'" -SimpleMatch:$false -Recurse
```

(of Grep-tool op `'boek_ontvangst'|'boek_voorraad_ontvangst'` in `frontend/src`). Expected: 0 hits.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p frontend/tsconfig.app.json` — Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/inkoop/queries/inkooporders.ts frontend/src/modules/inkoop/hooks/use-boek-ontvangst.ts
git commit -m "refactor(inkoop): ontvangst-callers naar nieuwe RPC-namen (mig 271), weg van deprecated wrappers"
```

---

### Task 2: Migratie 601 — `create_inkooporder` (transactioneel aanmaken)

**Files:**
- Create: `supabase/migrations/601_create_inkooporder_rpc.sql`
- Create: `scripts/tests/inkoop/test_create_inkooporder.sql` (rolled-back regressiecheck)

- [ ] **Step 1: Schrijf de failing test (rolled-back, live DB)**

Create `scripts/tests/inkoop/test_create_inkooporder.sql`:

```sql
-- Regressiecheck create_inkooporder (rolled-back; veilig op live DB).
-- Draai: supabase db query --linked -f scripts/tests/inkoop/test_create_inkooporder.sql
BEGIN;

DO $$
DECLARE
  v_lev_id BIGINT;
  v_result RECORD;
  v_regels INTEGER;
BEGIN
  INSERT INTO leveranciers (naam) VALUES ('TEST create_inkooporder') RETURNING id INTO v_lev_id;

  -- Happy path: header + 2 regels (m + stuks) in één call
  SELECT * INTO v_result FROM create_inkooporder(
    jsonb_build_object('leverancier_id', v_lev_id, 'besteldatum', CURRENT_DATE::TEXT, 'opmerkingen', 'test'),
    jsonb_build_array(
      jsonb_build_object('karpi_code', 'TEST-CI-ROL', 'artikel_omschrijving', 'testrol', 'besteld_m', 50, 'inkoopprijs_eur', 9.5, 'eenheid', 'm'),
      jsonb_build_object('karpi_code', 'TEST-CI-VAST', 'besteld_m', 10, 'eenheid', 'stuks')
    )
  );
  ASSERT v_result.inkooporder_nr LIKE 'INK-%', 'inkooporder_nr niet toegekend';

  SELECT COUNT(*) INTO v_regels FROM inkooporder_regels WHERE inkooporder_id = v_result.inkooporder_id;
  ASSERT v_regels = 2, format('verwachtte 2 regels, kreeg %s', v_regels);
  ASSERT (SELECT status FROM inkooporders WHERE id = v_result.inkooporder_id) = 'Besteld', 'status niet Besteld';
  ASSERT (SELECT eenheid FROM inkooporder_regels WHERE inkooporder_id = v_result.inkooporder_id AND regelnummer = 2) = 'stuks', 'eenheid stuks niet doorgekomen';
  ASSERT (SELECT te_leveren_m FROM inkooporder_regels WHERE inkooporder_id = v_result.inkooporder_id AND regelnummer = 1) = 50, 'te_leveren_m niet gelijk aan besteld_m';

  -- Guard: 0 regels moet weigeren (transactie-atomair: géén order achterlaten)
  BEGIN
    PERFORM create_inkooporder(jsonb_build_object('leverancier_id', v_lev_id), '[]'::jsonb);
    RAISE EXCEPTION 'TEST FAILED: 0 regels werd geaccepteerd';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
  END;

  -- Guard: ongeldig artikelnr moet heldere melding geven
  BEGIN
    PERFORM create_inkooporder(
      jsonb_build_object('leverancier_id', v_lev_id),
      jsonb_build_array(jsonb_build_object('artikelnr', 'BESTAAT-NIET-XX', 'besteld_m', 1))
    );
    RAISE EXCEPTION 'TEST FAILED: onbekend artikelnr werd geaccepteerd';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'test_create_inkooporder: ALLE ASSERTS GESLAAGD';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run de test — verwacht falen (functie bestaat nog niet)**

Run: `supabase db query --linked -f scripts/tests/inkoop/test_create_inkooporder.sql`
Expected: FOUT `function create_inkooporder(jsonb, jsonb) does not exist`.

- [ ] **Step 3: Schrijf migratie 601**

Create `supabase/migrations/601_create_inkooporder_rpc.sql`:

```sql
-- Migratie 601: create_inkooporder(p_header, p_regels) — transactioneel aanmaken
--
-- Vervangt de 3-losse-inserts-flow in de frontend (volgend_nummer + header +
-- regels zonder rollback: een falende regel-insert liet een lege order achter)
-- én is het ene schrijfpad waar import/import_inkoopoverzicht.py's TODO al om
-- vroeg (ADR-0017: de Module is haar eigen enige writer).
-- Status altijd 'Besteld' — de Concept-fase is bewust ongebruikt (besluit
-- 2026-07-02, YAGNI). Bestaande triggers doen de rest: trg_sync_besteld_inkoop,
-- trg_io_regel_insert_swap_evaluate (swap-doelwit, mig 297/470).

CREATE OR REPLACE FUNCTION create_inkooporder(
  p_header JSONB,
  p_regels JSONB
) RETURNS TABLE(inkooporder_id BIGINT, inkooporder_nr TEXT) AS $$
DECLARE
  v_leverancier_id BIGINT := (p_header->>'leverancier_id')::BIGINT;
  v_nr TEXT;
  v_id BIGINT;
  v_regel JSONB;
  v_regelnummer INTEGER := 0;
  v_besteld NUMERIC;
  v_eenheid TEXT;
  v_artikelnr TEXT;
BEGIN
  IF v_leverancier_id IS NULL THEN
    RAISE EXCEPTION 'leverancier_id is verplicht';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM leveranciers l WHERE l.id = v_leverancier_id) THEN
    RAISE EXCEPTION 'Leverancier % bestaat niet', v_leverancier_id;
  END IF;
  IF p_regels IS NULL OR jsonb_typeof(p_regels) <> 'array' OR jsonb_array_length(p_regels) = 0 THEN
    RAISE EXCEPTION 'Minimaal één regel is verplicht';
  END IF;

  v_nr := volgend_nummer('INK');

  INSERT INTO inkooporders (
    inkooporder_nr, leverancier_id, besteldatum, leverweek, verwacht_datum,
    status, bron, opmerkingen
  ) VALUES (
    v_nr,
    v_leverancier_id,
    NULLIF(p_header->>'besteldatum', '')::DATE,
    NULLIF(p_header->>'leverweek', ''),
    NULLIF(p_header->>'verwacht_datum', '')::DATE,
    'Besteld',
    COALESCE(NULLIF(p_header->>'bron', ''), 'handmatig'),
    NULLIF(p_header->>'opmerkingen', '')
  ) RETURNING id INTO v_id;

  FOR v_regel IN SELECT * FROM jsonb_array_elements(p_regels) LOOP
    v_regelnummer := v_regelnummer + 1;
    v_besteld  := (v_regel->>'besteld_m')::NUMERIC;
    v_eenheid  := COALESCE(NULLIF(v_regel->>'eenheid', ''), 'm');
    v_artikelnr := NULLIF(v_regel->>'artikelnr', '');

    IF v_besteld IS NULL OR v_besteld <= 0 THEN
      RAISE EXCEPTION 'Regel %: besteld_m moet > 0 zijn', v_regelnummer;
    END IF;
    IF v_eenheid NOT IN ('m', 'stuks') THEN
      RAISE EXCEPTION 'Regel %: eenheid moet ''m'' of ''stuks'' zijn (kreeg %)', v_regelnummer, v_eenheid;
    END IF;
    IF v_artikelnr IS NULL AND NULLIF(v_regel->>'karpi_code', '') IS NULL THEN
      RAISE EXCEPTION 'Regel %: artikelnr of karpi_code is verplicht', v_regelnummer;
    END IF;
    IF v_artikelnr IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM producten p WHERE p.artikelnr = v_artikelnr) THEN
      RAISE EXCEPTION 'Regel %: artikel % bestaat niet', v_regelnummer, v_artikelnr;
    END IF;

    INSERT INTO inkooporder_regels (
      inkooporder_id, regelnummer, artikelnr, karpi_code, artikel_omschrijving,
      inkoopprijs_eur, besteld_m, geleverd_m, te_leveren_m, eenheid
    ) VALUES (
      v_id, v_regelnummer, v_artikelnr,
      NULLIF(v_regel->>'karpi_code', ''),
      NULLIF(v_regel->>'artikel_omschrijving', ''),
      NULLIF(v_regel->>'inkoopprijs_eur', '')::NUMERIC,
      v_besteld, 0, v_besteld, v_eenheid
    );
  END LOOP;

  inkooporder_id := v_id;
  inkooporder_nr := v_nr;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_inkooporder(JSONB, JSONB) IS
  'Inkoop-Module (mig 601): transactioneel aanmaken van inkooporder + regels. '
  'Eén schrijfpad voor UI en (later) import-script. Status altijd Besteld. '
  'JSONB-valkuil: onbekende sleutels worden stil gedropt — kolomlijst hier '
  'compleet houden bij velduitbreiding.';

GRANT EXECUTE ON FUNCTION create_inkooporder(JSONB, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'Migratie 601 toegepast: create_inkooporder RPC.';
END $$;
```

- [ ] **Step 4: Apply migratie**

Run: `supabase db query --linked -f supabase/migrations/601_create_inkooporder_rpc.sql`
Expected: NOTICE "Migratie 601 toegepast".

- [ ] **Step 5: Run de test — verwacht slagen**

Run: `supabase db query --linked -f scripts/tests/inkoop/test_create_inkooporder.sql`
Expected: NOTICE `test_create_inkooporder: ALLE ASSERTS GESLAAGD`, daarna ROLLBACK.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/601_create_inkooporder_rpc.sql scripts/tests/inkoop/test_create_inkooporder.sql
git commit -m "feat(inkoop): create_inkooporder RPC — transactioneel aanmaken incl. stuks (mig 601)"
```

---

### Task 3: Frontend — aanmaken via RPC + eenheid-keuze per regel

**Files:**
- Modify: `frontend/src/modules/inkoop/queries/inkooporders.ts` (functie `createInkooporder`, regels 347-389)
- Modify: `frontend/src/modules/inkoop/components/inkooporder-form-dialog.tsx`

- [ ] **Step 1: `createInkooporder` herschrijven naar één RPC-call**

Vervang de volledige functie `createInkooporder` in `queries/inkooporders.ts` door:

```typescript
export async function createInkooporder(
  header: InkooporderFormData,
  regels: InkooporderRegelInput[],
): Promise<number> {
  // Eén transactionele RPC (mig 601) — geen half-aangemaakte orders meer.
  const { data, error } = await supabase.rpc('create_inkooporder', {
    p_header: {
      leverancier_id: header.leverancier_id,
      besteldatum: header.besteldatum ?? null,
      leverweek: header.leverweek ?? null,
      verwacht_datum: header.verwacht_datum ?? null,
      opmerkingen: header.opmerkingen ?? null,
    },
    p_regels: regels.map((r) => ({
      artikelnr: r.artikelnr,
      karpi_code: r.karpi_code ?? null,
      artikel_omschrijving: r.artikel_omschrijving ?? null,
      inkoopprijs_eur: r.inkoopprijs_eur ?? null,
      besteld_m: r.besteld_m,
      eenheid: r.eenheid ?? 'm',
    })),
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as { inkooporder_id: number }
  return Number(row.inkooporder_id)
}
```

- [ ] **Step 2: Eenheid-select toevoegen aan het formulier**

In `inkooporder-form-dialog.tsx`:

a) `RegelInput`-interface en `legeRegel` uitbreiden:

```typescript
interface RegelInput {
  artikelnr: string
  karpi_code: string
  artikel_omschrijving: string
  besteld_m: string
  inkoopprijs_eur: string
  eenheid: 'm' | 'stuks'
}

const legeRegel = (): RegelInput => ({
  artikelnr: '',
  karpi_code: '',
  artikel_omschrijving: '',
  besteld_m: '',
  inkoopprijs_eur: '',
  eenheid: 'm',
})
```

b) `wijzigRegel` blijft ongewijzigd werken (waarde is string; cast bij de select-onChange).

c) In de `<thead>` een kolom toevoegen tussen "Omschrijving" en "Besteld":

```tsx
<th className="text-left pb-2 font-medium w-28">Eenheid</th>
```

d) In de `<tbody>`-rij, tussen de omschrijving-`<td>` en de besteld-`<td>`:

```tsx
<td className="py-1 pr-2">
  <select
    value={r.eenheid}
    onChange={(e) => wijzigRegel(idx, 'eenheid', e.target.value)}
    className={`w-full ${inputClasses}`}
  >
    <option value="m">m² (rol)</option>
    <option value="stuks">stuks (vast)</option>
  </select>
</td>
```

e) In `handleSubmit`, `eenheid` meesturen in `geldig.push`:

```typescript
geldig.push({
  regelnummer: i + 1,
  artikelnr: r.artikelnr.trim() || null,
  karpi_code: r.karpi_code.trim() || null,
  artikel_omschrijving: r.artikel_omschrijving.trim() || null,
  besteld_m: besteld,
  inkoopprijs_eur: r.inkoopprijs_eur ? Number(r.inkoopprijs_eur) : null,
  eenheid: r.eenheid,
})
```

f) `wijzigRegel`'s type-signatuur aanpassen omdat `eenheid` geen vrije string is:

```typescript
const wijzigRegel = (idx: number, veld: keyof RegelInput, waarde: string) =>
  setRegels((r) => r.map((rx, i) => (i === idx ? { ...rx, [veld]: waarde as RegelInput[typeof veld] } : rx)))
```

- [ ] **Step 3: Typecheck + handmatige rooktest**

Run: `npx tsc --noEmit -p frontend/tsconfig.app.json` — Expected: exit 0.
Rooktest (dev-server of na deploy): nieuwe inkooporder met 1 stuks-regel aanmaken → detail toont "vast"-label en regel is `eenheid='stuks'`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/inkoop/queries/inkooporders.ts frontend/src/modules/inkoop/components/inkooporder-form-dialog.tsx
git commit -m "feat(inkoop): aanmaken via create_inkooporder RPC + eenheid-keuze (stuks-IOs eindelijk via UI, antislip-regel mig 408)"
```

---

### Task 4: Migratie 602 — wijzig-RPC's met Claim-vloer

**Files:**
- Create: `supabase/migrations/602_inkooporder_regel_mutaties.sql`
- Create: `scripts/tests/inkoop/test_regel_mutaties.sql`

- [ ] **Step 1: Schrijf de failing test**

Create `scripts/tests/inkoop/test_regel_mutaties.sql`:

```sql
-- Regressiecheck regel-mutatie-RPC's (rolled-back; veilig op live DB).
-- Draai: supabase db query --linked -f scripts/tests/inkoop/test_regel_mutaties.sql
BEGIN;

DO $$
DECLARE
  v_lev_id BIGINT;
  v_io RECORD;
  v_regel_m BIGINT;
  v_regel_stuks BIGINT;
  v_nieuwe_regel BIGINT;
  v_claim RECORD;
BEGIN
  INSERT INTO leveranciers (naam) VALUES ('TEST regel_mutaties') RETURNING id INTO v_lev_id;
  SELECT * INTO v_io FROM create_inkooporder(
    jsonb_build_object('leverancier_id', v_lev_id),
    jsonb_build_array(
      jsonb_build_object('karpi_code', 'TEST-RM-ROL', 'besteld_m', 50, 'eenheid', 'm'),
      jsonb_build_object('karpi_code', 'TEST-RM-VAST', 'besteld_m', 10, 'eenheid', 'stuks')
    )
  );
  SELECT id INTO v_regel_m     FROM inkooporder_regels WHERE inkooporder_id = v_io.inkooporder_id AND regelnummer = 1;
  SELECT id INTO v_regel_stuks FROM inkooporder_regels WHERE inkooporder_id = v_io.inkooporder_id AND regelnummer = 2;

  -- 1. Regel toevoegen → regelnummer = MAX+1
  v_nieuwe_regel := voeg_inkooporder_regel_toe(
    v_io.inkooporder_id,
    jsonb_build_object('karpi_code', 'TEST-RM-EXTRA', 'besteld_m', 5, 'eenheid', 'stuks')
  );
  ASSERT (SELECT regelnummer FROM inkooporder_regels WHERE id = v_nieuwe_regel) = 3, 'regelnummer niet MAX+1';

  -- 2. Prijs wijzigen — vrij
  PERFORM wijzig_inkooporder_regel(v_regel_m, NULL, 12.34, FALSE);
  ASSERT (SELECT inkoopprijs_eur FROM inkooporder_regels WHERE id = v_regel_m) = 12.34, 'prijs niet gewijzigd';

  -- 3. Besteld verhogen — vrij, te_leveren schuift mee
  PERFORM wijzig_inkooporder_regel(v_regel_m, 60, NULL, FALSE);
  ASSERT (SELECT te_leveren_m FROM inkooporder_regels WHERE id = v_regel_m) = 60, 'te_leveren niet meegeschoven';

  -- 4. Verlagen onder geleverd → weigeren
  UPDATE inkooporder_regels SET geleverd_m = 20, te_leveren_m = 40 WHERE id = v_regel_m;
  BEGIN
    PERFORM wijzig_inkooporder_regel(v_regel_m, 10, NULL, TRUE);
    RAISE EXCEPTION 'TEST FAILED: verlagen onder geleverd geaccepteerd';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
  END;

  -- 5. Claim-vloer m-regel: snijplan-claim (kolom gezet = claim aanwezig)
  UPDATE inkooporder_regels SET snijplan_gebruikte_lengte_cm = 800 WHERE id = v_regel_m;
  BEGIN
    PERFORM wijzig_inkooporder_regel(v_regel_m, 30, NULL, FALSE);
    RAISE EXCEPTION 'TEST FAILED: verlagen met snijplan-claim zonder vrijgeven geaccepteerd';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
    ASSERT SQLERRM LIKE 'Claim-vloer:%', format('verkeerde melding: %s', SQLERRM);
  END;
  -- ... mét vrijgeven: kolom terug naar 0 (snijplannen-UPDATE is no-op zonder rijen)
  PERFORM wijzig_inkooporder_regel(v_regel_m, 30, NULL, TRUE);
  ASSERT (SELECT snijplan_gebruikte_lengte_cm FROM inkooporder_regels WHERE id = v_regel_m) = 0, 'snijplan-cm niet teruggezet';
  ASSERT (SELECT besteld_m FROM inkooporder_regels WHERE id = v_regel_m) = 30, 'besteld niet verlaagd';

  -- 6. Claim-vloer stuks-regel met échte live claim (indien aanwezig)
  SELECT ors.inkooporder_regel_id AS regel_id, ir.besteld_m, ir.geleverd_m,
         (SELECT COALESCE(SUM(o2.aantal),0) FROM order_reserveringen o2
           WHERE o2.inkooporder_regel_id = ors.inkooporder_regel_id
             AND o2.bron='inkooporder_regel' AND o2.status='actief') AS geclaimd
    INTO v_claim
    FROM order_reserveringen ors
    JOIN inkooporder_regels ir ON ir.id = ors.inkooporder_regel_id
   WHERE ors.bron = 'inkooporder_regel' AND ors.status = 'actief' AND ir.eenheid = 'stuks'
   LIMIT 1;
  IF v_claim.regel_id IS NOT NULL THEN
    BEGIN
      PERFORM wijzig_inkooporder_regel(v_claim.regel_id, v_claim.geleverd_m, NULL, FALSE);
      RAISE EXCEPTION 'TEST FAILED: verlagen onder stuks-claim zonder vrijgeven geaccepteerd';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
      ASSERT SQLERRM LIKE 'Claim-vloer:%', format('verkeerde melding: %s', SQLERRM);
    END;
    -- mét vrijgeven: claims op deze regel zijn daarna ≤ nieuwe ruimte
    PERFORM wijzig_inkooporder_regel(v_claim.regel_id, v_claim.geleverd_m, NULL, TRUE);
    ASSERT (SELECT COALESCE(SUM(aantal),0) FROM order_reserveringen
             WHERE inkooporder_regel_id = v_claim.regel_id
               AND bron='inkooporder_regel' AND status='actief') = 0,
           'claims niet vrijgegeven na p_vrijgeven=TRUE';
  ELSE
    RAISE NOTICE 'SKIP: geen live actieve stuks-IO-claim gevonden — stap 6 overgeslagen';
  END IF;

  -- 7. Regel annuleren: besteld := geleverd, order-status herberekend
  PERFORM annuleer_inkooporder_regel(v_regel_stuks, FALSE);
  ASSERT (SELECT te_leveren_m FROM inkooporder_regels WHERE id = v_regel_stuks) = 0, 'annuleren zette te_leveren niet op 0';

  -- 8. Verwijderen: geleverd>0 weigeren; verse regel wél; laatste regel weigeren
  BEGIN
    PERFORM verwijder_inkooporder_regel(v_regel_m, TRUE);
    RAISE EXCEPTION 'TEST FAILED: verwijderen met geleverd>0 geaccepteerd';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
  END;
  PERFORM verwijder_inkooporder_regel(v_nieuwe_regel, FALSE);
  ASSERT NOT EXISTS (SELECT 1 FROM inkooporder_regels WHERE id = v_nieuwe_regel), 'regel niet verwijderd';

  -- 9. Status-herberekening: alle regels dicht → Ontvangen
  PERFORM annuleer_inkooporder_regel(v_regel_m, TRUE);
  ASSERT (SELECT status FROM inkooporders WHERE id = v_io.inkooporder_id) = 'Ontvangen',
         format('orderstatus niet Ontvangen maar %s', (SELECT status FROM inkooporders WHERE id = v_io.inkooporder_id));

  RAISE NOTICE 'test_regel_mutaties: ALLE ASSERTS GESLAAGD';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test — verwacht falen** (`function voeg_inkooporder_regel_toe ... does not exist`).

Run: `supabase db query --linked -f scripts/tests/inkoop/test_regel_mutaties.sql`

- [ ] **Step 3: Schrijf migratie 602**

Create `supabase/migrations/602_inkooporder_regel_mutaties.sql`:

```sql
-- Migratie 602: regel-mutatie-RPC's met Claim-vloer (besluit 2026-07-02)
--
-- Wijzigen van een bestaande inkooporder bestond niet (alleen ETA + hele-order-
-- annuleren). Vijf mutaties, allemaal via RPC (ADR-0017), met de Claim-vloer
-- als guard (CONTEXT.md): verlagen/verwijderen mag nooit stil onder
-- geleverd + actieve verkooporder-claims + snijplan-'Wacht op inkoop'-claims.
-- Eronder vereist p_vrijgeven=TRUE: snijplan-stukken terug naar 'Wacht'
-- (per-regel-variant van release_wacht_op_inkoop_stukken mig 445 — het
-- cm-aggregaat is per regel, dus 0 terugzetten is exact) en verkooporder-
-- claims via release_claims_voor_io_regel → herallocateer (mig 145): getroffen
-- orders vallen zichtbaar terug naar 'Wacht op inkoop', nooit stil.
-- NB: de FK snijplannen.verwacht_inkooporder_regel_id is ON DELETE SET NULL —
-- daarom is een kale DELETE op inkooporder_regels verboden terrein en loopt
-- verwijderen ALTIJD via verwijder_inkooporder_regel.

-- ---------------------------------------------------------------------------
-- Helper: order-status herafleiden uit de regels (zelfde CASE als de
-- ontvangst-RPC's mig 281, nu herbruikbaar voor alle mutaties)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION herbereken_inkooporder_status(p_inkooporder_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_status inkooporder_status;
  v_regels INTEGER;
  v_open INTEGER;
  v_geleverd NUMERIC;
BEGIN
  SELECT status INTO v_status FROM inkooporders WHERE id = p_inkooporder_id FOR UPDATE;
  IF NOT FOUND OR v_status = 'Geannuleerd' THEN RETURN; END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE te_leveren_m > 0),
         COALESCE(SUM(geleverd_m), 0)
    INTO v_regels, v_open, v_geleverd
    FROM inkooporder_regels
   WHERE inkooporder_id = p_inkooporder_id;

  IF v_regels = 0 THEN RETURN; END IF;

  IF v_open = 0 THEN
    UPDATE inkooporders SET status = 'Ontvangen'
     WHERE id = p_inkooporder_id AND status <> 'Ontvangen';
  ELSIF v_geleverd > 0 THEN
    UPDATE inkooporders SET status = 'Deels ontvangen'
     WHERE id = p_inkooporder_id AND status <> 'Deels ontvangen';
  ELSE
    UPDATE inkooporders SET status = 'Besteld'
     WHERE id = p_inkooporder_id AND status NOT IN ('Concept', 'Besteld');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Regel toevoegen
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION voeg_inkooporder_regel_toe(
  p_inkooporder_id BIGINT,
  p_regel JSONB
) RETURNS BIGINT AS $$
DECLARE
  v_status inkooporder_status;
  v_besteld NUMERIC := (p_regel->>'besteld_m')::NUMERIC;
  v_eenheid TEXT := COALESCE(NULLIF(p_regel->>'eenheid', ''), 'm');
  v_artikelnr TEXT := NULLIF(p_regel->>'artikelnr', '');
  v_nieuw_id BIGINT;
BEGIN
  SELECT status INTO v_status FROM inkooporders WHERE id = p_inkooporder_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder % niet gevonden', p_inkooporder_id;
  END IF;
  IF v_status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Inkooporder is geannuleerd — geen regels meer toe te voegen';
  END IF;
  IF v_besteld IS NULL OR v_besteld <= 0 THEN
    RAISE EXCEPTION 'besteld_m moet > 0 zijn';
  END IF;
  IF v_eenheid NOT IN ('m', 'stuks') THEN
    RAISE EXCEPTION 'eenheid moet ''m'' of ''stuks'' zijn (kreeg %)', v_eenheid;
  END IF;
  IF v_artikelnr IS NULL AND NULLIF(p_regel->>'karpi_code', '') IS NULL THEN
    RAISE EXCEPTION 'artikelnr of karpi_code is verplicht';
  END IF;
  IF v_artikelnr IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM producten p WHERE p.artikelnr = v_artikelnr) THEN
    RAISE EXCEPTION 'Artikel % bestaat niet', v_artikelnr;
  END IF;

  INSERT INTO inkooporder_regels (
    inkooporder_id, regelnummer, artikelnr, karpi_code, artikel_omschrijving,
    inkoopprijs_eur, besteld_m, geleverd_m, te_leveren_m, eenheid
  )
  SELECT p_inkooporder_id,
         COALESCE(MAX(r.regelnummer), 0) + 1,
         v_artikelnr,
         NULLIF(p_regel->>'karpi_code', ''),
         NULLIF(p_regel->>'artikel_omschrijving', ''),
         NULLIF(p_regel->>'inkoopprijs_eur', '')::NUMERIC,
         v_besteld, 0, v_besteld, v_eenheid
    FROM inkooporder_regels r
   WHERE r.inkooporder_id = p_inkooporder_id
  RETURNING id INTO v_nieuw_id;

  -- trg_io_regel_insert_swap_evaluate (mig 297/470) en trg_sync_besteld_inkoop
  -- vuren vanzelf op deze INSERT.
  PERFORM herbereken_inkooporder_status(p_inkooporder_id);
  RETURN v_nieuw_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Aantal en/of prijs wijzigen (de kern-RPC; annuleren/verwijderen delegeren)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wijzig_inkooporder_regel(
  p_regel_id BIGINT,
  p_besteld NUMERIC DEFAULT NULL,
  p_inkoopprijs_eur NUMERIC DEFAULT NULL,
  p_vrijgeven BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
  v_order_status inkooporder_status;
  v_geclaimd NUMERIC := 0;
  v_snijplan_cm INTEGER := 0;
  v_onder_vloer BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_regel FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;
  SELECT status INTO v_order_status FROM inkooporders WHERE id = v_regel.inkooporder_id FOR UPDATE;
  IF v_order_status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Inkooporder is geannuleerd — regels niet meer wijzigbaar';
  END IF;

  IF p_inkoopprijs_eur IS NOT NULL THEN
    UPDATE inkooporder_regels SET inkoopprijs_eur = p_inkoopprijs_eur WHERE id = p_regel_id;
  END IF;

  IF p_besteld IS NULL OR p_besteld = v_regel.besteld_m THEN
    RETURN;
  END IF;

  IF p_besteld < v_regel.geleverd_m THEN
    RAISE EXCEPTION 'Besteld (%) kan niet lager dan al geleverd (%)', p_besteld, v_regel.geleverd_m;
  END IF;

  IF p_besteld < v_regel.besteld_m THEN
    SELECT COALESCE(SUM(aantal), 0) INTO v_geclaimd
      FROM order_reserveringen
     WHERE inkooporder_regel_id = p_regel_id
       AND bron = 'inkooporder_regel' AND status = 'actief';
    v_snijplan_cm := COALESCE(v_regel.snijplan_gebruikte_lengte_cm, 0);

    v_onder_vloer :=
         (v_regel.eenheid = 'stuks' AND p_besteld < v_regel.geleverd_m + v_geclaimd)
      OR (v_regel.eenheid = 'm'     AND v_snijplan_cm > 0);

    IF v_onder_vloer AND NOT p_vrijgeven THEN
      RAISE EXCEPTION 'Claim-vloer: op deze regel rusten beloftes (verkooporder-claims: % stuks, snijplanning: % cm). Verlagen vereist expliciet vrijgeven — getroffen orders vallen dan zichtbaar terug naar "Wacht op inkoop".',
        v_geclaimd, v_snijplan_cm;
    END IF;
  END IF;

  UPDATE inkooporder_regels
     SET besteld_m = p_besteld,
         te_leveren_m = GREATEST(p_besteld - geleverd_m, 0)
   WHERE id = p_regel_id;

  IF v_onder_vloer AND p_vrijgeven THEN
    -- Snijplan-claims op DEZE regel loslaten. Stukken gaan terug naar 'Wacht'
    -- (trigger snijplan_wacht_naar_snijden normaliseert verder, zelfde patroon
    -- als mig 445); auto-plan-groep plant ze bij de volgende run opnieuw in —
    -- werkinstructie: draai "Auto-plan opnieuw" voor de groep na vrijgeven.
    UPDATE snijplannen
       SET status = 'Wacht', verwacht_inkooporder_regel_id = NULL
     WHERE verwacht_inkooporder_regel_id = p_regel_id
       AND status = 'Wacht op inkoop';
    UPDATE inkooporder_regels SET snijplan_gebruikte_lengte_cm = 0 WHERE id = p_regel_id;

    -- Verkooporder-claims: herallocateer alle claimende orderregels. De
    -- allocator ziet de al-verlaagde ruimte en dekt elders — of laat de order
    -- zichtbaar terugvallen naar 'Wacht op inkoop' (derive_wacht_status).
    PERFORM release_claims_voor_io_regel(p_regel_id);

    -- Defensief: blijven er claims boven de nieuwe ruimte staan (bv. door een
    -- pad dat de allocator bewust niet loslaat), dan hard falen i.p.v. een
    -- stille overclaim op een verkleinde regel.
    IF (SELECT COALESCE(SUM(aantal), 0) FROM order_reserveringen
         WHERE inkooporder_regel_id = p_regel_id
           AND bron = 'inkooporder_regel' AND status = 'actief')
       > GREATEST(p_besteld - v_regel.geleverd_m, 0) THEN
      RAISE EXCEPTION 'Vrijgeven onvolledig: er blijven claims boven de nieuwe ruimte op deze regel — los ze eerst op via de claim-uitsplitsing op order-detail';
    END IF;
  END IF;

  PERFORM herbereken_inkooporder_status(v_regel.inkooporder_id);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Regel annuleren: "de rest komt niet meer" — besteld := geleverd
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION annuleer_inkooporder_regel(
  p_regel_id BIGINT,
  p_vrijgeven BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
DECLARE
  v_geleverd NUMERIC;
BEGIN
  SELECT geleverd_m INTO v_geleverd FROM inkooporder_regels WHERE id = p_regel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;
  PERFORM wijzig_inkooporder_regel(p_regel_id, v_geleverd, NULL, p_vrijgeven);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Regel verwijderen: alleen zonder ontvangsten; nooit de laatste regel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verwijder_inkooporder_regel(
  p_regel_id BIGINT,
  p_vrijgeven BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
BEGIN
  SELECT * INTO v_regel FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;
  IF v_regel.geleverd_m > 0
     OR EXISTS (SELECT 1 FROM rollen r WHERE r.inkooporder_regel_id = p_regel_id) THEN
    RAISE EXCEPTION 'Regel heeft al ontvangsten — gebruik "Regel annuleren" i.p.v. verwijderen';
  END IF;
  IF (SELECT COUNT(*) FROM inkooporder_regels
       WHERE inkooporder_id = v_regel.inkooporder_id) = 1 THEN
    RAISE EXCEPTION 'Laatste regel van de order — annuleer de hele inkooporder i.p.v. de regel te verwijderen';
  END IF;

  -- Zelfde Claim-vloer + vrijgeef-mechaniek als verlagen-naar-0; de check op
  -- resterende claims beschermt de ON DELETE RESTRICT-FK van order_reserveringen.
  PERFORM wijzig_inkooporder_regel(p_regel_id, 0, NULL, p_vrijgeven);
  DELETE FROM inkooporder_regels WHERE id = p_regel_id;
  PERFORM herbereken_inkooporder_status(v_regel.inkooporder_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION herbereken_inkooporder_status(BIGINT) IS
  'Inkoop-Module (mig 602): status herafleiden uit regels (Ontvangen/Deels ontvangen/Besteld). No-op bij Geannuleerd of 0 regels.';
COMMENT ON FUNCTION voeg_inkooporder_regel_toe(BIGINT, JSONB) IS
  'Inkoop-Module (mig 602): regel toevoegen aan bestaande order, regelnummer=MAX+1. Swap-evaluatie + besteld_inkoop-sync via bestaande triggers.';
COMMENT ON FUNCTION wijzig_inkooporder_regel(BIGINT, NUMERIC, NUMERIC, BOOLEAN) IS
  'Inkoop-Module (mig 602): aantal/prijs wijzigen met Claim-vloer-guard (CONTEXT.md). p_vrijgeven=TRUE releaset snijplan- en verkooporder-claims expliciet en zichtbaar.';
COMMENT ON FUNCTION annuleer_inkooporder_regel(BIGINT, BOOLEAN) IS
  'Inkoop-Module (mig 602): rest van de regel komt niet meer — besteld := geleverd. Delegeert naar wijzig_inkooporder_regel.';
COMMENT ON FUNCTION verwijder_inkooporder_regel(BIGINT, BOOLEAN) IS
  'Inkoop-Module (mig 602): regel verwijderen, alleen zonder ontvangsten en nooit de laatste regel. Kale DELETE is verboden (FK snijplannen ON DELETE SET NULL laat anders stille wezen achter).';

GRANT EXECUTE ON FUNCTION herbereken_inkooporder_status(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION voeg_inkooporder_regel_toe(BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION wijzig_inkooporder_regel(BIGINT, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION annuleer_inkooporder_regel(BIGINT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION verwijder_inkooporder_regel(BIGINT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'Migratie 602 toegepast: regel-mutatie-RPC''s met Claim-vloer.';
END $$;
```

- [ ] **Step 4: Apply migratie**

Run: `supabase db query --linked -f supabase/migrations/602_inkooporder_regel_mutaties.sql`
Expected: NOTICE "Migratie 602 toegepast".

- [ ] **Step 5: Run test — verwacht slagen**

Run: `supabase db query --linked -f scripts/tests/inkoop/test_regel_mutaties.sql`
Expected: `test_regel_mutaties: ALLE ASSERTS GESLAAGD` (eventueel met de SKIP-notice bij stap 6 als er geen live stuks-claim bestaat — meld dat in de taak-samenvatting).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/602_inkooporder_regel_mutaties.sql scripts/tests/inkoop/test_regel_mutaties.sql
git commit -m "feat(inkoop): regel-mutatie-RPC's met Claim-vloer-guard (mig 602)"
```

---

### Task 5: Frontend — queries + hooks voor regel-mutaties

**Files:**
- Create: `frontend/src/modules/inkoop/queries/regel-mutaties.ts`
- Create: `frontend/src/modules/inkoop/hooks/use-regel-mutaties.ts`
- Modify: `frontend/src/modules/inkoop/index.ts` (barrel-exports)

- [ ] **Step 1: Query-functies schrijven**

Create `frontend/src/modules/inkoop/queries/regel-mutaties.ts`:

```typescript
import { supabase } from '@/lib/supabase/client'
import type { InkooporderRegelInput } from './inkooporders'

/**
 * Regel-mutaties op een bestaande inkooporder (mig 602, besluit 2026-07-02).
 * Alle guards (Claim-vloer, geleverd-ondergrens, laatste-regel) leven
 * server-side; een 'Claim-vloer:'-fout betekent: opnieuw aanroepen met
 * vrijgeven=true nadat de operator expliciet bevestigd heeft.
 */

export function isClaimVloerFout(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('Claim-vloer:')
}

export async function voegInkooporderRegelToe(
  inkooporderId: number,
  regel: Omit<InkooporderRegelInput, 'regelnummer'>,
): Promise<number> {
  const { data, error } = await supabase.rpc('voeg_inkooporder_regel_toe', {
    p_inkooporder_id: inkooporderId,
    p_regel: {
      artikelnr: regel.artikelnr,
      karpi_code: regel.karpi_code ?? null,
      artikel_omschrijving: regel.artikel_omschrijving ?? null,
      inkoopprijs_eur: regel.inkoopprijs_eur ?? null,
      besteld_m: regel.besteld_m,
      eenheid: regel.eenheid ?? 'm',
    },
  })
  if (error) throw new Error(error.message)
  return Number(data)
}

export async function wijzigInkooporderRegel(opts: {
  regelId: number
  besteld?: number | null
  inkoopprijsEur?: number | null
  vrijgeven?: boolean
}): Promise<void> {
  const { error } = await supabase.rpc('wijzig_inkooporder_regel', {
    p_regel_id: opts.regelId,
    p_besteld: opts.besteld ?? null,
    p_inkoopprijs_eur: opts.inkoopprijsEur ?? null,
    p_vrijgeven: opts.vrijgeven ?? false,
  })
  if (error) throw new Error(error.message)
}

export async function annuleerInkooporderRegel(
  regelId: number,
  vrijgeven = false,
): Promise<void> {
  const { error } = await supabase.rpc('annuleer_inkooporder_regel', {
    p_regel_id: regelId,
    p_vrijgeven: vrijgeven,
  })
  if (error) throw new Error(error.message)
}

export async function verwijderInkooporderRegel(
  regelId: number,
  vrijgeven = false,
): Promise<void> {
  const { error } = await supabase.rpc('verwijder_inkooporder_regel', {
    p_regel_id: regelId,
    p_vrijgeven: vrijgeven,
  })
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 2: Hooks schrijven**

Create `frontend/src/modules/inkoop/hooks/use-regel-mutaties.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  annuleerInkooporderRegel,
  verwijderInkooporderRegel,
  voegInkooporderRegelToe,
  wijzigInkooporderRegel,
} from '../queries/regel-mutaties'
import type { InkooporderRegelInput } from '../queries/inkooporders'
import { invalidateNaInkoopMutatie } from '../cache'

export function useVoegRegelToe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ inkooporderId, regel }: { inkooporderId: number; regel: Omit<InkooporderRegelInput, 'regelnummer'> }) =>
      voegInkooporderRegelToe(inkooporderId, regel),
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}

export function useWijzigRegel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: wijzigInkooporderRegel,
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}

export function useAnnuleerRegel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ regelId, vrijgeven }: { regelId: number; vrijgeven?: boolean }) =>
      annuleerInkooporderRegel(regelId, vrijgeven ?? false),
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}

export function useVerwijderRegel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ regelId, vrijgeven }: { regelId: number; vrijgeven?: boolean }) =>
      verwijderInkooporderRegel(regelId, vrijgeven ?? false),
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}
```

- [ ] **Step 3: Barrel-exports toevoegen**

In `frontend/src/modules/inkoop/index.ts`, na het `useBoekOntvangst`-exportblok (regel 39) toevoegen:

```typescript
export {
  useVoegRegelToe,
  useWijzigRegel,
  useAnnuleerRegel,
  useVerwijderRegel,
} from './hooks/use-regel-mutaties'
export { isClaimVloerFout } from './queries/regel-mutaties'
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p frontend/tsconfig.app.json` — Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/inkoop/queries/regel-mutaties.ts frontend/src/modules/inkoop/hooks/use-regel-mutaties.ts frontend/src/modules/inkoop/index.ts
git commit -m "feat(inkoop): queries + hooks voor regel-mutaties (mig 602)"
```

---

### Task 6: Frontend — wijzig-UI op inkooporder-detail

**Files:**
- Create: `frontend/src/modules/inkoop/components/regel-bewerken-dialog.tsx`
- Create: `frontend/src/modules/inkoop/components/regel-toevoegen-dialog.tsx`
- Modify: `frontend/src/modules/inkoop/pages/inkooporder-detail.tsx`
- Modify: `frontend/src/modules/inkoop/index.ts`

- [ ] **Step 1: Bewerk-dialog (aantal/prijs/annuleren/verwijderen, met Claim-vloer-bevestiging)**

Create `frontend/src/modules/inkoop/components/regel-bewerken-dialog.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useAnnuleerRegel, useVerwijderRegel, useWijzigRegel } from '../hooks/use-regel-mutaties'
import { isClaimVloerFout } from '../queries/regel-mutaties'
import type { InkooporderRegel } from '../queries/inkooporders'

export type RegelBewerkModus = 'bewerken' | 'annuleren' | 'verwijderen'

interface Props {
  regel: InkooporderRegel
  modus: RegelBewerkModus
  onClose: () => void
}

const TITELS: Record<RegelBewerkModus, string> = {
  bewerken: 'Regel bewerken',
  annuleren: 'Regel annuleren (rest komt niet meer)',
  verwijderen: 'Regel verwijderen',
}

/**
 * Eén dialog voor de drie regel-mutaties. Server-side guards (mig 602) zijn
 * leidend: een 'Claim-vloer:'-fout wordt hier omgezet in een expliciete
 * bevestigings-checkbox (vrijgeven) i.p.v. een dead-end-foutmelding.
 */
export function RegelBewerkenDialog({ regel, modus, onClose }: Props) {
  const [besteld, setBesteld] = useState(String(regel.besteld_m))
  const [prijs, setPrijs] = useState(regel.inkoopprijs_eur != null ? String(regel.inkoopprijs_eur) : '')
  const [error, setError] = useState<string | null>(null)
  const [claimVloerMelding, setClaimVloerMelding] = useState<string | null>(null)
  const [vrijgevenBevestigd, setVrijgevenBevestigd] = useState(false)

  const wijzig = useWijzigRegel()
  const annuleer = useAnnuleerRegel()
  const verwijder = useVerwijderRegel()
  const isPending = wijzig.isPending || annuleer.isPending || verwijder.isPending

  const voerUit = async (vrijgeven: boolean) => {
    if (modus === 'bewerken') {
      const b = Number(besteld)
      if (!Number.isFinite(b) || b <= 0) throw new Error('Besteld moet > 0 zijn')
      await wijzig.mutateAsync({
        regelId: regel.id,
        besteld: b !== regel.besteld_m ? b : null,
        inkoopprijsEur: prijs === '' ? null : Number(prijs),
        vrijgeven,
      })
    } else if (modus === 'annuleren') {
      await annuleer.mutateAsync({ regelId: regel.id, vrijgeven })
    } else {
      await verwijder.mutateAsync({ regelId: regel.id, vrijgeven })
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await voerUit(claimVloerMelding != null && vrijgevenBevestigd)
      onClose()
    } catch (err) {
      if (isClaimVloerFout(err)) {
        setClaimVloerMelding((err as Error).message)
      } else {
        setError(err instanceof Error ? err.message : 'Mutatie mislukt')
      }
    }
  }

  const eh = regel.eenheid === 'stuks' ? 'st.' : 'm²'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-md">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">{TITELS[modus]}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-500">
            Regel {regel.regelnummer} · {regel.karpi_code ?? regel.artikelnr ?? '-'} · besteld{' '}
            {regel.besteld_m} {eh}, geleverd {regel.geleverd_m} {eh}
          </p>

          {modus === 'bewerken' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block mb-1 text-slate-600">Besteld ({eh})</span>
                <input
                  type="number"
                  value={besteld}
                  onChange={(e) => setBesteld(e.target.value)}
                  className={inputClasses}
                  step="0.01"
                  min="0.01"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="block mb-1 text-slate-600">Prijs (€)</span>
                <input
                  type="number"
                  value={prijs}
                  onChange={(e) => setPrijs(e.target.value)}
                  className={inputClasses}
                  step="0.01"
                  min="0"
                />
              </label>
            </div>
          )}

          {modus === 'annuleren' && (
            <p className="text-sm text-slate-700">
              Besteld wordt teruggezet naar wat al geleverd is ({regel.geleverd_m} {eh}); de
              openstaande {regel.te_leveren_m} {eh} vervalt.
            </p>
          )}
          {modus === 'verwijderen' && (
            <p className="text-sm text-slate-700">
              De regel wordt definitief verwijderd. Kan alleen zolang er niets op ontvangen is.
            </p>
          )}

          {claimVloerMelding && (
            <div className="text-sm bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] px-3 py-2 space-y-2">
              <p className="text-amber-800">{claimVloerMelding}</p>
              <label className="flex items-start gap-2 text-amber-900 font-medium">
                <input
                  type="checkbox"
                  checked={vrijgevenBevestigd}
                  onChange={(e) => setVrijgevenBevestigd(e.target.checked)}
                  className="mt-0.5"
                />
                Beloftes vrijgeven en doorgaan — getroffen orders vallen terug naar
                &ldquo;Wacht op inkoop&rdquo;
              </label>
            </div>
          )}

          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
              Sluiten
            </button>
            <button
              type="submit"
              disabled={isPending || (claimVloerMelding != null && !vrijgevenBevestigd)}
              className={`px-4 py-2 text-white rounded-[var(--radius-sm)] text-sm font-medium disabled:opacity-50 ${
                modus === 'bewerken' ? 'bg-terracotta-500 hover:bg-terracotta-600' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {isPending ? 'Bezig…' : TITELS[modus]}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'
```

- [ ] **Step 2: Toevoegen-dialog**

Create `frontend/src/modules/inkoop/components/regel-toevoegen-dialog.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useVoegRegelToe } from '../hooks/use-regel-mutaties'

interface Props {
  inkooporderId: number
  onClose: () => void
}

export function RegelToevoegenDialog({ inkooporderId, onClose }: Props) {
  const [artikelnr, setArtikelnr] = useState('')
  const [karpiCode, setKarpiCode] = useState('')
  const [omschrijving, setOmschrijving] = useState('')
  const [besteld, setBesteld] = useState('')
  const [prijs, setPrijs] = useState('')
  const [eenheid, setEenheid] = useState<'m' | 'stuks'>('m')
  const [error, setError] = useState<string | null>(null)

  const voegToe = useVoegRegelToe()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const b = Number(besteld)
    if (!Number.isFinite(b) || b <= 0) {
      setError('Besteld moet > 0 zijn')
      return
    }
    if (!artikelnr.trim() && !karpiCode.trim()) {
      setError('Geef artikelnr of karpi-code op')
      return
    }
    try {
      await voegToe.mutateAsync({
        inkooporderId,
        regel: {
          artikelnr: artikelnr.trim() || null,
          karpi_code: karpiCode.trim() || null,
          artikel_omschrijving: omschrijving.trim() || null,
          besteld_m: b,
          inkoopprijs_eur: prijs ? Number(prijs) : null,
          eenheid,
        },
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Regel toevoegen mislukt')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-md">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">Regel toevoegen</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3">
          <label className="block text-sm">
            <span className="block mb-1 text-slate-600">Artikelnr</span>
            <input type="text" value={artikelnr} onChange={(e) => setArtikelnr(e.target.value)} className={inputClasses} />
          </label>
          <label className="block text-sm">
            <span className="block mb-1 text-slate-600">Karpi-code</span>
            <input type="text" value={karpiCode} onChange={(e) => setKarpiCode(e.target.value)} className={inputClasses} placeholder="bijv. TWIS15400VIL" />
          </label>
          <label className="block text-sm">
            <span className="block mb-1 text-slate-600">Omschrijving</span>
            <input type="text" value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} className={inputClasses} />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="block mb-1 text-slate-600">Eenheid</span>
              <select value={eenheid} onChange={(e) => setEenheid(e.target.value as 'm' | 'stuks')} className={inputClasses}>
                <option value="m">m² (rol)</option>
                <option value="stuks">stuks</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-slate-600">Besteld</span>
              <input type="number" value={besteld} onChange={(e) => setBesteld(e.target.value)} className={inputClasses} step="0.01" min="0.01" required />
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-slate-600">Prijs (€)</span>
              <input type="number" value={prijs} onChange={(e) => setPrijs(e.target.value)} className={inputClasses} step="0.01" min="0" />
            </label>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
              Annuleren
            </button>
            <button
              type="submit"
              disabled={voegToe.isPending}
              className="px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50"
            >
              {voegToe.isPending ? 'Bezig…' : 'Regel toevoegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'
```

- [ ] **Step 3: Barrel-exports**

In `frontend/src/modules/inkoop/index.ts`, bij de component-exports toevoegen:

```typescript
export { RegelBewerkenDialog, type RegelBewerkModus } from './components/regel-bewerken-dialog'
export { RegelToevoegenDialog } from './components/regel-toevoegen-dialog'
```

- [ ] **Step 4: Detail-pagina uitbreiden**

In `frontend/src/modules/inkoop/pages/inkooporder-detail.tsx`:

a) Imports uitbreiden (regel 4 en het `@/modules/inkoop`-import-blok):

```tsx
import { ArrowLeft, PackageCheck, Ban, Printer, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  useInkooporderDetail,
  useUpdateInkooporderStatus,
  InkooporderStatusBadge,
  OntvangstBoekenDialog,
  VoorraadOntvangstDialog,
  IORegelClaimsPopover,
  EtaEditCell,
  RegelBewerkenDialog,
  RegelToevoegenDialog,
  type RegelBewerkModus,
  type InkooporderRegel,
} from '@/modules/inkoop'
```

b) State toevoegen naast `ontvangstRegel` (regel 43):

```tsx
const [bewerkRegel, setBewerkRegel] = useState<{ regel: InkooporderRegel; modus: RegelBewerkModus } | null>(null)
const [toonRegelToevoegen, setToonRegelToevoegen] = useState(false)
```

c) Afgeleide vlag naast `kanAnnuleren` (regel 69):

```tsx
const kanWijzigen = order.status !== 'Geannuleerd'
```

d) "Regel toevoegen"-knop in de Regels-sectie-header (vervang het bestaande `<div className="flex items-center justify-between mb-3">`-blok, regels 138-143):

```tsx
<div className="flex items-center justify-between mb-3">
  <h2 className="font-medium">Regels ({regels.length})</h2>
  <div className="flex items-center gap-3">
    <span className="text-sm text-slate-500">
      Nog te leveren: <strong>{totaalLabel}</strong>
    </span>
    {kanWijzigen && (
      <button
        onClick={() => setToonRegelToevoegen(true)}
        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-terracotta-50 text-terracotta-700 hover:bg-terracotta-100 rounded-[var(--radius-sm)]"
      >
        <Plus size={13} />
        Regel toevoegen
      </button>
    )}
  </div>
</div>
```

e) Actie-knoppen per regel: in de laatste `<td>` (regels 217-247), vóór de bestaande Ontvangst/Stickers-logica een klein knoppenrijtje toevoegen — vervang de hele `<td className="py-2 text-right">…</td>` door:

```tsx
<td className="py-2 text-right">
  <div className="flex items-center justify-end gap-1">
    {kanWijzigen && (
      <>
        <button
          onClick={() => setBewerkRegel({ regel: r, modus: 'bewerken' })}
          title="Aantal of prijs wijzigen"
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
        >
          <Pencil size={13} />
        </button>
        {r.te_leveren_m > 0 && (
          <button
            onClick={() => setBewerkRegel({ regel: r, modus: 'annuleren' })}
            title="Regel annuleren (rest komt niet meer)"
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
          >
            <Ban size={13} />
          </button>
        )}
        {r.geleverd_m === 0 && regels.length > 1 && (
          <button
            onClick={() => setBewerkRegel({ regel: r, modus: 'verwijderen' })}
            title="Regel verwijderen"
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
          >
            <Trash2 size={13} />
          </button>
        )}
      </>
    )}
    {r.te_leveren_m > 0 ? (
      <button
        onClick={() => setOntvangstRegel(r)}
        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-[var(--radius-sm)]"
      >
        <PackageCheck size={13} />
        Ontvangst
      </button>
    ) : (
      (() => {
        const ids = rolIdsPerRegel.get(r.id) ?? []
        if (ids.length === 0) return null
        return (
          <button
            onClick={() =>
              window.open(`/rollen/stickers?ids=${ids.join(',')}`, '_blank', 'noopener,noreferrer')
            }
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-[var(--radius-sm)]"
          >
            <Printer size={13} />
            Stickers
          </button>
        )
      })()
    )}
  </div>
</td>
```

f) Dialog-rendering onderaan, naast de bestaande ontvangst-dialogs (na regel 272):

```tsx
{bewerkRegel && (
  <RegelBewerkenDialog
    regel={bewerkRegel.regel}
    modus={bewerkRegel.modus}
    onClose={() => setBewerkRegel(null)}
  />
)}
{toonRegelToevoegen && (
  <RegelToevoegenDialog inkooporderId={order.id} onClose={() => setToonRegelToevoegen(false)} />
)}
```

- [ ] **Step 5: Typecheck + Vitest**

Run: `npx tsc --noEmit -p frontend/tsconfig.app.json` en `cd frontend && npx vitest run --reporter=dot` — Expected: beide groen.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/inkoop/components/regel-bewerken-dialog.tsx frontend/src/modules/inkoop/components/regel-toevoegen-dialog.tsx frontend/src/modules/inkoop/pages/inkooporder-detail.tsx frontend/src/modules/inkoop/index.ts
git commit -m "feat(inkoop): wijzig-UI op inkooporder-detail — regel toevoegen/bewerken/annuleren/verwijderen met Claim-vloer-bevestiging"
```

---

### Task 7: Migratie 603 — ontvangst met locatie + over-leveringsgrens

**Files:**
- Create: `supabase/migrations/603_ontvangst_locatie_overlevering.sql`
- Create: `scripts/tests/inkoop/test_ontvangst_locatie.sql`

**Superset-regel:** deze migratie bevat de complete mig-281-body + de wijzigingen. Bij een latere wijziging aan deze functie: complete 603-body meenemen (drift-check `pg_get_functiondef`).

- [ ] **Step 1: Schrijf de failing test**

Create `scripts/tests/inkoop/test_ontvangst_locatie.sql`:

```sql
-- Regressiecheck ontvangst met locatie + 110%-grens (rolled-back).
-- Draai: supabase db query --linked -f scripts/tests/inkoop/test_ontvangst_locatie.sql
BEGIN;

DO $$
DECLARE
  v_lev_id BIGINT;
  v_io RECORD;
  v_regel BIGINT;
  v_rol RECORD;
  v_locatie_id BIGINT;
BEGIN
  INSERT INTO leveranciers (naam) VALUES ('TEST ontvangst_locatie') RETURNING id INTO v_lev_id;
  SELECT * INTO v_io FROM create_inkooporder(
    jsonb_build_object('leverancier_id', v_lev_id),
    jsonb_build_array(jsonb_build_object('karpi_code', 'TEST-OL-ROL', 'besteld_m', 100, 'eenheid', 'm'))
  );
  SELECT id INTO v_regel FROM inkooporder_regels WHERE inkooporder_id = v_io.inkooporder_id;

  -- 1. Ontvangst mét locatie → rollen.locatie_id gevuld
  SELECT * INTO v_rol FROM boek_inkooporder_ontvangst_rollen(
    v_regel,
    jsonb_build_array(jsonb_build_object('lengte_cm', 2000, 'breedte_cm', 400, 'locatie', 'test.z9')),
    'test'
  ) LIMIT 1;
  SELECT locatie_id INTO v_locatie_id FROM rollen WHERE id = v_rol.rol_id;
  ASSERT v_locatie_id IS NOT NULL, 'locatie_id niet gevuld';
  ASSERT (SELECT code FROM magazijn_locaties WHERE id = v_locatie_id) = 'TEST.Z9',
         'locatie-code niet ge-uppercased/gekoppeld';

  -- 2. Ontvangst zónder locatie blijft werken (locatie_id NULL)
  SELECT * INTO v_rol FROM boek_inkooporder_ontvangst_rollen(
    v_regel,
    jsonb_build_array(jsonb_build_object('lengte_cm', 500, 'breedte_cm', 400)),
    'test'
  ) LIMIT 1;
  ASSERT (SELECT locatie_id FROM rollen WHERE id = v_rol.rol_id) IS NULL, 'locatie_id moest NULL blijven';

  -- 3. Over-levering >110% zonder vlag → weigeren (100 m² besteld, 80+20=100 al geboekt;
  --    nog eens 20 m² erbij = 120 > 110)
  BEGIN
    PERFORM boek_inkooporder_ontvangst_rollen(
      v_regel,
      jsonb_build_array(jsonb_build_object('lengte_cm', 500, 'breedte_cm', 400)),
      'test'
    );
    RAISE EXCEPTION 'TEST FAILED: over-levering >110%% werd geaccepteerd';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF;
    ASSERT SQLERRM LIKE 'Over-levering:%', format('verkeerde melding: %s', SQLERRM);
  END;

  -- 4. Zelfde boeking mét vlag → geaccepteerd
  PERFORM boek_inkooporder_ontvangst_rollen(
    v_regel,
    jsonb_build_array(jsonb_build_object('lengte_cm', 500, 'breedte_cm', 400)),
    'test',
    TRUE
  );
  ASSERT (SELECT geleverd_m FROM inkooporder_regels WHERE id = v_regel) = 120, 'geleverd_m niet 120 na bevestigde over-levering';

  RAISE NOTICE 'test_ontvangst_locatie: ALLE ASSERTS GESLAAGD';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test — verwacht falen** op assert 1 (`locatie_id niet gevuld`) of op de 4-arg call.

- [ ] **Step 3: Schrijf migratie 603**

Create `supabase/migrations/603_ontvangst_locatie_overlevering.sql`:

```sql
-- Migratie 603: boek_inkooporder_ontvangst_rollen — locatie per rol +
-- over-leveringsgrens 110% (besluit 2026-07-02).
--
-- Superset van mig 281 (in_magazijn_sinds) → 271 → 136/135/133/127.
-- Nieuw: (1) optioneel 'locatie' per rol in p_rollen → create_or_get_magazijn_locatie
-- (mig 169) → rollen.locatie_id; (2) pre-pass die de totale payload-m² telt en
-- >110% van besteld weigert tenzij p_sta_overlevering_toe=TRUE (over-levering
-- is normaal in tapijt — meters zijn nooit exact — maar een tikfout van 10×
-- de bestelling mag niet stil doorglippen).
-- Signature wijzigt (4e param) → DROP vereist; de deprecated wrapper
-- boek_ontvangst (mig 271) resolvet zijn 3-arg-call daarna op de DEFAULT.

DROP FUNCTION IF EXISTS boek_inkooporder_ontvangst_rollen(BIGINT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION boek_inkooporder_ontvangst_rollen(
  p_regel_id BIGINT,
  p_rollen JSONB,
  p_medewerker TEXT DEFAULT NULL,
  p_sta_overlevering_toe BOOLEAN DEFAULT FALSE
) RETURNS TABLE(rol_id BIGINT, rolnummer TEXT) AS $$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
  v_order inkooporders%ROWTYPE;
  v_product RECORD;
  v_rol JSONB;
  v_lengte_cm INTEGER;
  v_breedte_cm INTEGER;
  v_oppervlak_m2 NUMERIC;
  v_rolnummer TEXT;
  v_nieuw_id BIGINT;
  v_totaal_geleverd_m2 NUMERIC := 0;
  v_open_regels INTEGER;
  v_locatie_code TEXT;
  v_locatie_id BIGINT;
  v_payload_m2 NUMERIC := 0;
BEGIN
  SELECT * INTO v_regel FROM inkooporder_regels WHERE id = p_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_regel_id;
  END IF;

  SELECT * INTO v_order FROM inkooporders WHERE id = v_regel.inkooporder_id FOR UPDATE;
  IF v_order.status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Order % is geannuleerd, kan geen ontvangst boeken', v_order.inkooporder_nr;
  END IF;

  IF v_regel.eenheid <> 'm' THEN
    RAISE EXCEPTION 'Regel % heeft eenheid %. Rol-ontvangst is alleen voor eenheid ''m''. Gebruik boek_inkooporder_ontvangst_stuks voor vaste producten.',
      v_regel.regelnummer, v_regel.eenheid;
  END IF;

  -- Pre-pass (mig 603): valideer maten + tel de payload-m² VÓÓR er iets
  -- geïnsert wordt, zodat de over-leveringsgrens atomair kan weigeren.
  FOR v_rol IN SELECT * FROM jsonb_array_elements(COALESCE(p_rollen, '[]'::jsonb)) LOOP
    v_lengte_cm := (v_rol->>'lengte_cm')::INTEGER;
    v_breedte_cm := (v_rol->>'breedte_cm')::INTEGER;
    IF v_lengte_cm IS NULL OR v_lengte_cm <= 0 THEN
      RAISE EXCEPTION 'Ongeldige lengte_cm in rol: %', v_rol;
    END IF;
    IF v_breedte_cm IS NULL OR v_breedte_cm <= 0 THEN
      RAISE EXCEPTION 'Ongeldige breedte_cm in rol: %', v_rol;
    END IF;
    v_payload_m2 := v_payload_m2 + ROUND((v_lengte_cm * v_breedte_cm) / 10000.0, 2);
  END LOOP;

  IF NOT p_sta_overlevering_toe
     AND v_regel.besteld_m > 0
     AND v_regel.geleverd_m + v_payload_m2 > v_regel.besteld_m * 1.10 THEN
    RAISE EXCEPTION 'Over-levering: totaal geleverd wordt % m² op % m² besteld (meer dan 110%%). Bevestig expliciet als de levering echt zo groot is.',
      ROUND(v_regel.geleverd_m + v_payload_m2, 2), v_regel.besteld_m;
  END IF;

  IF v_regel.artikelnr IS NOT NULL THEN
    SELECT p.karpi_code, p.kwaliteit_code, p.kleur_code, p.zoeksleutel, p.omschrijving,
           p.verkoopprijs AS vvp_m2
      INTO v_product
    FROM producten p
    WHERE p.artikelnr = v_regel.artikelnr;
  END IF;

  FOR v_rol IN SELECT * FROM jsonb_array_elements(COALESCE(p_rollen, '[]'::jsonb)) LOOP
    v_lengte_cm := (v_rol->>'lengte_cm')::INTEGER;
    v_breedte_cm := (v_rol->>'breedte_cm')::INTEGER;
    v_rolnummer := NULLIF(TRIM(COALESCE(v_rol->>'rolnummer', '')), '');

    -- Locatie (mig 603): optioneel per rol; vindt-of-maakt de magazijnlocatie.
    v_locatie_code := NULLIF(TRIM(COALESCE(v_rol->>'locatie', '')), '');
    v_locatie_id := NULL;
    IF v_locatie_code IS NOT NULL THEN
      v_locatie_id := create_or_get_magazijn_locatie(v_locatie_code);
    END IF;

    IF v_rolnummer IS NULL THEN
      LOOP
        v_rolnummer := volgend_nummer('R');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM rollen r WHERE r.rolnummer = v_rolnummer);
      END LOOP;
    END IF;

    v_oppervlak_m2 := ROUND((v_lengte_cm * v_breedte_cm) / 10000.0, 2);

    INSERT INTO rollen (
      rolnummer, artikelnr, karpi_code, omschrijving,
      lengte_cm, breedte_cm, oppervlak_m2, vvp_m2,
      kwaliteit_code, kleur_code, zoeksleutel,
      status, inkooporder_regel_id, reststuk_datum, in_magazijn_sinds, locatie_id
    ) VALUES (
      v_rolnummer, v_regel.artikelnr,
      COALESCE(v_product.karpi_code, v_regel.karpi_code),
      COALESCE(v_product.omschrijving, v_regel.artikel_omschrijving),
      v_lengte_cm, v_breedte_cm, v_oppervlak_m2,
      v_product.vvp_m2,
      v_product.kwaliteit_code, v_product.kleur_code, v_product.zoeksleutel,
      'beschikbaar', p_regel_id, NOW(), CURRENT_DATE, v_locatie_id
    )
    RETURNING id INTO v_nieuw_id;

    INSERT INTO voorraad_mutaties (
      rol_id, type, lengte_cm, breedte_cm,
      referentie_id, referentie_type, notitie, aangemaakt_door
    )
    VALUES (
      v_nieuw_id, 'inkoop', v_lengte_cm, v_breedte_cm,
      p_regel_id, 'inkooporder_regel',
      'Ontvangst inkooporder ' || v_order.inkooporder_nr || ' regel ' || v_regel.regelnummer,
      p_medewerker
    );

    v_totaal_geleverd_m2 := v_totaal_geleverd_m2 + v_oppervlak_m2;
    rol_id := v_nieuw_id;
    rolnummer := v_rolnummer;
    RETURN NEXT;
  END LOOP;

  UPDATE inkooporder_regels
  SET geleverd_m = geleverd_m + v_totaal_geleverd_m2,
      te_leveren_m = GREATEST(besteld_m - (geleverd_m + v_totaal_geleverd_m2), 0)
  WHERE id = p_regel_id;

  SELECT COUNT(*) INTO v_open_regels
  FROM inkooporder_regels
  WHERE inkooporder_id = v_order.id AND te_leveren_m > 0;

  IF v_open_regels = 0 THEN
    UPDATE inkooporders SET status = 'Ontvangen' WHERE id = v_order.id;
  ELSE
    UPDATE inkooporders SET status = 'Deels ontvangen'
    WHERE id = v_order.id AND status IN ('Concept', 'Besteld');
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION boek_inkooporder_ontvangst_rollen(BIGINT, JSONB, TEXT, BOOLEAN) IS
  'Inkoop-Module: boek rollen-ontvangst op een eenheid=m IO-regel. Superset-keten '
  '281→603: mig 603 voegt per-rol ''locatie'' (→ rollen.locatie_id via '
  'create_or_get_magazijn_locatie) en de 110%%-over-leveringsgrens toe '
  '(p_sta_overlevering_toe). Geen claim-consume (claims zijn alleen op eenheid=stuks).';

GRANT EXECUTE ON FUNCTION boek_inkooporder_ontvangst_rollen(BIGINT, JSONB, TEXT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'Migratie 603 toegepast: ontvangst met locatie + over-leveringsgrens.';
END $$;
```

- [ ] **Step 4: Apply + test**

Run: `supabase db query --linked -f supabase/migrations/603_ontvangst_locatie_overlevering.sql`
Run: `supabase db query --linked -f scripts/tests/inkoop/test_ontvangst_locatie.sql`
Expected: `test_ontvangst_locatie: ALLE ASSERTS GESLAAGD`.

- [ ] **Step 5: Regressie — bestaande rollen-ontvangst-test (mig 281-gedrag) via de oude 3-arg-aanroepvorm**

De test dekt dit al (stap 2 gebruikt 3 args). Extra check dat de deprecated wrapper nog werkt tot Task 11:

```sql
-- eenmalige check (niet committen): SELECT proname FROM pg_proc WHERE proname = 'boek_ontvangst';
```

Expected: 1 rij (wrapper bestaat nog; verwijdering volgt in Task 11).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/603_ontvangst_locatie_overlevering.sql scripts/tests/inkoop/test_ontvangst_locatie.sql
git commit -m "feat(inkoop): ontvangst met magazijnlocatie per rol + 110%-over-leveringsgrens (mig 603)"
```

---

### Task 8: Frontend — locatie-veld + over-leveringsbevestiging in de ontvangst-dialog

**Files:**
- Modify: `frontend/src/modules/inkoop/queries/inkooporders.ts` (`OntvangstRol`, `boekOntvangst`)
- Modify: `frontend/src/modules/inkoop/hooks/use-boek-ontvangst.ts` (`BoekOntvangstRollenInput`)
- Modify: `frontend/src/modules/inkoop/components/ontvangst-boeken-dialog.tsx`

- [ ] **Step 1: Types + query uitbreiden**

In `queries/inkooporders.ts`:

```typescript
export interface OntvangstRol {
  rolnummer?: string | null
  lengte_cm: number
  breedte_cm: number
  /** Mig 603: optionele magazijnlocatie-code (bv. "A.01.L") — wordt server-side
   *  gekoppeld via create_or_get_magazijn_locatie. */
  locatie?: string | null
}

export async function boekOntvangst(
  regel_id: number,
  rollen: OntvangstRol[],
  medewerker?: string,
  staOverleveringToe = false,
): Promise<Array<{ rol_id: number; rolnummer: string }>> {
  const { data, error } = await supabase.rpc('boek_inkooporder_ontvangst_rollen', {
    p_regel_id: regel_id,
    p_rollen: rollen,
    p_medewerker: medewerker ?? null,
    p_sta_overlevering_toe: staOverleveringToe,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{ rol_id: number; rolnummer: string }>
}
```

- [ ] **Step 2: Hook-input uitbreiden**

In `use-boek-ontvangst.ts`:

```typescript
export interface BoekOntvangstRollenInput {
  ioRegelId: number
  rollen: OntvangstRol[]
  medewerker?: string
  staOverleveringToe?: boolean
}
```

en in de `mutationFn` het rollen-pad:

```typescript
const rollen = await boekOntvangst(input.ioRegelId, input.rollen, input.medewerker, input.staOverleveringToe ?? false)
```

- [ ] **Step 3: Dialog — locatie-input per rol + over-leveringsbevestiging**

In `ontvangst-boeken-dialog.tsx`:

a) `RolInput` uitbreiden + state:

```typescript
interface RolInput {
  strekkende_m: string
  breedte_cm_manueel: string
  locatie: string
}
```

Alle drie de plekken waar `{ strekkende_m: '', breedte_cm_manueel: '' }` staat (regels 30-32 en 56-57) worden `{ strekkende_m: '', breedte_cm_manueel: '', locatie: '' }`.

Nieuwe state naast `error` (regel 33):

```typescript
const [overleveringMelding, setOverleveringMelding] = useState<string | null>(null)
const [overleveringBevestigd, setOverleveringBevestigd] = useState(false)
```

b) In de rollen-rij (na het breedte-input-blok, vóór de verwijder-knop):

```tsx
<input
  type="text"
  value={r.locatie}
  onChange={(e) => wijzigRol(idx, 'locatie', e.target.value)}
  placeholder="Locatie (bv. A.01.L)"
  className={`w-36 ${inputClasses}`}
/>
```

c) `payload.push` uitbreiden:

```typescript
payload.push({
  lengte_cm: Math.round(strekkende * 100),
  breedte_cm: breedte,
  locatie: r.locatie.trim() || null,
})
```

d) `handleSubmit`'s try/catch: over-levering afvangen en als bevestiging tonen:

```typescript
try {
  const result = await boek.mutateAsync({
    ioRegelId: regel.id,
    rollen: payload,
    medewerker: medewerker ?? undefined,
    staOverleveringToe: overleveringMelding != null && overleveringBevestigd,
  })
  if (result.kind === 'rollen') {
    setToegekend(result.rollen)
  }
} catch (err) {
  console.error('boek_inkooporder_ontvangst_rollen RPC error:', err)
  const msg = err instanceof Error ? err.message : ''
  if (msg.startsWith('Over-levering:')) {
    setOverleveringMelding(msg)
    return
  }
  const e = err as { message?: string; details?: string; hint?: string; code?: string }
  const parts = [e?.message, e?.details, e?.hint].filter(Boolean)
  setError(parts.length ? parts.join(' · ') : JSON.stringify(err))
}
```

e) Bevestigings-blok in het formulier, direct boven het bestaande `{error && …}`-blok:

```tsx
{overleveringMelding && (
  <div className="text-sm bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] px-3 py-2 space-y-2">
    <p className="text-amber-800">{overleveringMelding}</p>
    <label className="flex items-start gap-2 text-amber-900 font-medium">
      <input
        type="checkbox"
        checked={overleveringBevestigd}
        onChange={(e) => setOverleveringBevestigd(e.target.checked)}
        className="mt-0.5"
      />
      De levering is echt zo groot — boek de over-levering
    </label>
  </div>
)}
```

f) Submit-knop disabled-conditie uitbreiden:

```tsx
disabled={boek.isPending || (overleveringMelding != null && !overleveringBevestigd)}
```

- [ ] **Step 4: Typecheck + Vitest**

Run: `npx tsc --noEmit -p frontend/tsconfig.app.json` en `cd frontend && npx vitest run --reporter=dot` — Expected: groen.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/inkoop/queries/inkooporders.ts frontend/src/modules/inkoop/hooks/use-boek-ontvangst.ts frontend/src/modules/inkoop/components/ontvangst-boeken-dialog.tsx
git commit -m "feat(inkoop): locatie-invoer per rol + over-leveringsbevestiging in ontvangst-dialog"
```

---

### Task 9: Portal-huishouding — dode React-portal verwijderen

Geverifieerd 2026-07-02: portal.karpi.nl serveert de statische `docs/portal/index.html`; `leverancier-detail.tsx` linkt via `VITE_PORTAL_HTML_URL` uitsluitend daarnaartoe; de React-routes worden nergens vandaan gelinkt.

**Files:**
- Delete: `frontend/src/pages/portal/portal-login.tsx`
- Delete: `frontend/src/pages/portal/supplier-portal.tsx`
- Modify: `frontend/src/router.tsx` (regels 59-60 imports, regels 66-67 routes)

- [ ] **Step 1: Routes + imports verwijderen**

In `frontend/src/router.tsx` verwijder exact deze vier regels:

```tsx
import { SupplierPortalPage } from '@/pages/portal/supplier-portal'
import { PortalLoginPage } from '@/pages/portal/portal-login'
```

```tsx
  { path: 'portal/login', element: <PortalLoginPage /> },
  { path: 'portal/:token', element: <SupplierPortalPage /> },
```

- [ ] **Step 2: Bestanden verwijderen**

```powershell
Remove-Item "frontend/src/pages/portal" -Recurse -Force
```

- [ ] **Step 3: Verifieer dat niets meer verwijst**

Grep op `pages/portal` in `frontend/src` — Expected: 0 hits.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit -p frontend/tsconfig.app.json` en `cd frontend && npm run build` — Expected: groen (build vangt ook de testprojecten, memory tsc-noEmit-mist-tests).

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/pages/portal frontend/src/router.tsx
git commit -m "chore(portal): dode React-portal verwijderd — portal.karpi.nl (statische versie) is de enige implementatie"
```

---

### Task 10: Lint-whitelist bijvangst — `sync_inkoopoverzicht_2026_06.py`

**Files:**
- Modify: `scripts/lint-no-direct-inkooporder-regel-write.sh` (regels 39-41)

- [ ] **Step 1: Vaststellen of het script eenmalig was**

Lees de kop van `import/sync_inkoopoverzicht_2026_06.py` (eerste ~30 regels). Het is een gedateerde ad-hoc sync (juni 2026) met directe table-writes — het blijft in de repo als referentie maar hoort in de whitelist mét kanttekening, anders faalt de lint bij elke run.

- [ ] **Step 2: Whitelist uitbreiden**

In `scripts/lint-no-direct-inkooporder-regel-write.sh`:

```bash
ALLOWED_PYTHON_PATHS=(
  'import/import_inkoopoverzicht.py'
  # Eenmalige ad-hoc sync juni 2026 (referentie). Nieuw sync-werk: gebruik
  # create_inkooporder (mig 601) + de regel-mutatie-RPC's (mig 602).
  'import/sync_inkoopoverzicht_2026_06.py'
)
```

- [ ] **Step 3: Lint draaien**

```bash
bash scripts/lint-no-direct-inkooporder-regel-write.sh
```

Expected: exit 0, geen FAIL-regels.

- [ ] **Step 4: Commit**

```bash
git add scripts/lint-no-direct-inkooporder-regel-write.sh
git commit -m "chore(inkoop): sync_inkoopoverzicht_2026_06.py in lint-whitelist (eenmalig script, handhavingsgat)"
```

---

### Task 11: Migratie 604 — deprecated wrappers droppen (⚠ apply-timing!)

**Deadline 2026-07-13.** De migratie wordt nu geschreven en gecommit, maar **pas op de live DB gedraaid ná merge naar main + Vercel-deploy van Task 1** (de live frontend roept tot die deploy nog `boek_ontvangst` aan).

**Files:**
- Create: `supabase/migrations/604_drop_deprecated_ontvangst_wrappers.sql`

- [ ] **Step 1: Caller-check in de DB**

Schrijf en draai (Write-tool, dan `supabase db query --linked -f`):

```sql
-- Check: verwijst nog een functie-body naar de oude namen?
SELECT proname FROM pg_proc
WHERE prosrc ILIKE '%boek_ontvangst(%' OR prosrc ILIKE '%boek_voorraad_ontvangst(%';
```

Expected: alleen de twee wrappers zelf (die delegeren naar de nieuwe namen). Verschijnt er een ándere functie → STOP en meld het.

- [ ] **Step 2: Schrijf migratie 604**

Create `supabase/migrations/604_drop_deprecated_ontvangst_wrappers.sql`:

```sql
-- Migratie 604: DROP deprecated ontvangst-wrappers (mig 271, deadline 2026-07-13)
--
-- boek_ontvangst / boek_voorraad_ontvangst waren thin wrappers rond
-- boek_inkooporder_ontvangst_rollen / _stuks. De laatste caller (frontend
-- use-boek-ontvangst) is omgezet (Task 1 van dit plan).
-- ⚠ APPLY-VOORWAARDE: pas draaien NA merge naar main + Vercel-deploy — de
-- oude live frontend roept de wrappers anders nog aan.

DROP FUNCTION IF EXISTS boek_ontvangst(BIGINT, JSONB, TEXT);
DROP FUNCTION IF EXISTS boek_voorraad_ontvangst(BIGINT, INTEGER, TEXT);

NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'Migratie 604 toegepast: deprecated ontvangst-wrappers verwijderd.';
END $$;
```

- [ ] **Step 3: Backlog-doc bijwerken**

In `docs/backlog/inkoop-module-followups.md`: markeer de wrapper-opruiming als afgerond per mig 604 (verwijs naar dit plan).

- [ ] **Step 4: Commit (nog NIET apply'en)**

```bash
git add supabase/migrations/604_drop_deprecated_ontvangst_wrappers.sql docs/backlog/inkoop-module-followups.md
git commit -m "chore(inkoop): mig 604 — deprecated ontvangst-wrappers droppen (apply pas na merge+deploy)"
```

---

### Task 12: E2E-portal-rondreis met testleverancier

Bewijst dat de portal-verbinding (HENAN's werkwijze) intact blijft ná alle wijzigingen. **Niet rolled-back** — echte testdata, daarna opgeruimd. Gebruik NOOIT HENAN's echte leverancier (id 9).

**Files:**
- Create (tijdelijk, scratchpad — niet committen): setup/cleanup-SQL + curl-calls.

- [ ] **Step 1: Testleverancier + credentials + testorder (live, klein)**

SQL via Write-tool + `supabase db query --linked -f`:

```sql
-- setup_e2e_portal.sql
DO $$
DECLARE
  v_lev_id BIGINT;
  v_io RECORD;
BEGIN
  INSERT INTO leveranciers (naam) VALUES ('ZZ-TEST PORTAL RONDREIS') RETURNING id INTO v_lev_id;
  PERFORM stel_portal_credentials_in(v_lev_id::INTEGER, 'portal-e2e-test@karpi.nl', 'Test-Rondreis-2026!');
  SELECT * INTO v_io FROM create_inkooporder(
    jsonb_build_object('leverancier_id', v_lev_id, 'opmerkingen', 'E2E portal-rondreis — wordt opgeruimd'),
    jsonb_build_array(jsonb_build_object('karpi_code', 'ZZ-TEST-E2E', 'besteld_m', 40, 'eenheid', 'm'))
  );
  RAISE NOTICE 'leverancier_id=%, inkooporder=%', v_lev_id, v_io.inkooporder_nr;
END $$;
SELECT id AS leverancier_id, portal_token FROM leveranciers WHERE naam = 'ZZ-TEST PORTAL RONDREIS';
SELECT r.id AS regel_id FROM inkooporder_regels r
  JOIN inkooporders i ON i.id = r.inkooporder_id
  JOIN leveranciers l ON l.id = i.leverancier_id
 WHERE l.naam = 'ZZ-TEST PORTAL RONDREIS';
```

Noteer `portal_token` en `regel_id` uit de output.

- [ ] **Step 2: Login via de edge function (zoals de portal doet)**

```powershell
$body = '{"email":"portal-e2e-test@karpi.nl","wachtwoord":"Test-Rondreis-2026!"}'
Invoke-RestMethod -Method Post -Uri "https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/supplier-portal" -ContentType "application/json" -Body $body
```

Expected: JSON met `portal_token` (gelijk aan de DB-waarde) en `leverancier_naam`.

- [ ] **Step 3: Regels ophalen (GET) + ETA zetten (PATCH)**

```powershell
Invoke-RestMethod -Uri "https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/supplier-portal?token=<PORTAL_TOKEN>"
$patch = '{"token":"<PORTAL_TOKEN>","regel_id":<REGEL_ID>,"verwacht_datum":"2026-08-15","notitie":"e2e test note"}'
Invoke-RestMethod -Method Patch -Uri "https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/supplier-portal" -ContentType "application/json" -Body $patch
```

Expected: GET toont de testregel; PATCH retourneert success.

- [ ] **Step 4: DB-assertie herkomst**

```sql
SELECT verwacht_datum, eta_bijgewerkt_door, leverancier_notitie
  FROM inkooporder_regels WHERE id = <REGEL_ID>;
```

Expected: `2026-08-15`, `'leverancier'`, `'e2e test note'`. (Dit is exact wat het Regeloverzicht als blauwe "Leverancier"-herkomst toont.)

- [ ] **Step 5: Ontvangst met locatie boeken + assertie**

```sql
SELECT * FROM boek_inkooporder_ontvangst_rollen(
  <REGEL_ID>,
  '[{"lengte_cm": 1000, "breedte_cm": 400, "locatie": "ZZ.E2E"}]'::jsonb,
  'e2e-test'
);
SELECT r.rolnummer, r.status, ml.code AS locatie, i.status AS order_status
  FROM rollen r
  LEFT JOIN magazijn_locaties ml ON ml.id = r.locatie_id
  JOIN inkooporder_regels ir ON ir.id = r.inkooporder_regel_id
  JOIN inkooporders i ON i.id = ir.inkooporder_id
 WHERE r.inkooporder_regel_id = <REGEL_ID>;
```

Expected: rol `beschikbaar` op locatie `ZZ.E2E`; order-status `Ontvangen`.

- [ ] **Step 6: Opruimen (volgorde: rol → voorraad_mutaties → order → credentials → leverancier)**

```sql
DO $$
DECLARE
  v_lev_id BIGINT;
BEGIN
  SELECT id INTO v_lev_id FROM leveranciers WHERE naam = 'ZZ-TEST PORTAL RONDREIS';
  DELETE FROM voorraad_mutaties WHERE rol_id IN (
    SELECT r.id FROM rollen r JOIN inkooporder_regels ir ON ir.id = r.inkooporder_regel_id
    JOIN inkooporders i ON i.id = ir.inkooporder_id WHERE i.leverancier_id = v_lev_id);
  DELETE FROM rollen WHERE inkooporder_regel_id IN (
    SELECT ir.id FROM inkooporder_regels ir JOIN inkooporders i ON i.id = ir.inkooporder_id
    WHERE i.leverancier_id = v_lev_id);
  DELETE FROM inkooporders WHERE leverancier_id = v_lev_id;  -- regels cascaden
  PERFORM verwijder_portal_toegang(v_lev_id::INTEGER);
  DELETE FROM leveranciers WHERE id = v_lev_id;
  DELETE FROM magazijn_locaties WHERE code = 'ZZ.E2E' AND NOT EXISTS (
    SELECT 1 FROM rollen WHERE locatie_id = magazijn_locaties.id);
  RAISE NOTICE 'E2E testdata opgeruimd';
END $$;
```

Verifieer: `SELECT COUNT(*) FROM leveranciers WHERE naam LIKE 'ZZ-TEST%';` → 0.

- [ ] **Step 7: Rapporteer de rondreis-uitkomst** in de taak-samenvatting (login ok / GET ok / PATCH ok / herkomst ok / ontvangst+locatie ok / cleanup ok). Miguel kan desgewenst zelf nogmaals door portal.karpi.nl klikken als acceptatie.

---

### Task 13: Werkinstructie `docs/werkwijze-inkoop.md`

**Files:**
- Create: `docs/werkwijze-inkoop.md`

- [ ] **Step 1: Schrijf de werkinstructie**

Create `docs/werkwijze-inkoop.md` met exact deze inhoud:

```markdown
# Werkwijze Inkoop — bestellen, verwachten, ontvangen, wijzigen

_Voor operators. Laatste update: 2026-07 (plan inkoopproces-volledig)._

## 1. Bestellen (inkooporder aanmaken)

- **Waar:** `/inkoop` → knop "Nieuwe inkooporder".
- Kies leverancier, vul per regel artikelnr óf karpi-code, **eenheid** en aantal:
  - **m² (rol)** — broadloom/rollen, geleverd als fysieke rollen.
  - **stuks (vast)** — vaste maten en antislip. ⚠ **Antislip altijd op het
    stuks-artikel bestellen, nooit op het doos-artikel** — anders ziet het
    systeem de bestelling niet als dekking voor klantorders (koppeltabel mig 408).
- Opslaan is alles-of-niets: bij een foutmelding is er géén halve order aangemaakt.
- Direct na opslaan kan het systeem wachtende klantorders automatisch aan de
  nieuwe regels koppelen (claim-swap) — dat is de bedoeling.

## 2. Verwachten (wanneer komt het?)

- **Hét scherm van de inkoper:** `/inkoop` → tab **Regeloverzicht**. Per open
  regel: ETA (inline aanpasbaar), wie de ETA het laatst bijwerkte
  (blauw = leverancier via de portal, grijs = Karpi) en wanneer, plus de
  leverancier-notitie.
- **Rood** = ETA verstreken; **"⚠ blokkeert snijplanning"** = er wachten
  maatwerk-snijplannen op deze levering — eerst bellen/mailen.
- Een ETA-wijziging (door jou óf de leverancier) schuift automatisch de
  afleverdatum van gekoppelde klantorders mee. Verschuift de leverWEEK, dan
  verschijnt de order in de tab "Levertijd gewijzigd" op het orderoverzicht —
  informeer de klant en vink af ("herbevestigd").

## 3. Leveranciersportal (portal.karpi.nl)

- Leveranciers werken zelf hun ETA's + notities bij. Schrijfrechten zijn
  bewust beperkt tot ETA + notitie — aantallen/prijzen wijzigt alleen Karpi.
- Meldt een leverancier via de notitie "we kunnen maar 40m leveren"? Verwerk
  dat zelf via Regel bewerken/annuleren (zie §5).
- **Nieuwe leverancier aansluiten** (nu nog niet actief uitrollen — besluit 02-07):
  1. Leverancier-detailpagina → sectie "Portal toegang" → e-mail + wachtwoord instellen.
  2. Mail de link https://portal.karpi.nl + inloggegevens (Engels; de portal is Engelstalig).
  3. Controleer na een week of er ingelogd is; zo niet: bellen.
- Leveranciers zonder portal: jij voert de ETA zelf in op het Regeloverzicht.

## 4. Ontvangen (binnenboeken → voorraad)

- **Waar:** inkooporder-detail → knop "Ontvangst" per regel, bij fysieke binnenkomst.
- **Rollen (m²):** vul per fysieke rol lengte (m) en zo nodig breedte in, plus
  de **magazijnlocatie** (bv. `A.01.L`) waar de rol komt te liggen. Na boeken:
  **stickers printen en direct op de rollen plakken.**
- **Stuks:** vul het ontvangen aantal in. Wachtende klantorders worden
  automatisch beleverd (claims → voorraad) en klappen om naar leverbaar.
- **Afwijkingen:**
  - _Minder geleverd, rest komt later_ → boek wat er is; de regel blijft open
    ("Deels ontvangen").
  - _Minder geleverd, rest komt nóóit_ → boek wat er is, daarna **Regel
    annuleren** (§5).
  - _Meer geleverd_ → gewoon boeken. Boven de 110% van het bestelde vraagt het
    systeem een expliciete bevestiging (tikfout-vangnet).
  - _Verkeerde kwaliteit/kleur geleverd_ → NIET op deze regel boeken. Gebruik
    "Rol handmatig toevoegen" op de Rollen & Reststukken-pagina (met reden,
    audit) en annuleer/verlaag de inkoopregel na afstemming met de leverancier.

## 5. Wijzigen van een bestaande inkooporder

Op inkooporder-detail, per regel (potlood/verbod/prullenbak-icoontjes):

| Situatie | Actie |
|---|---|
| Extra artikel bijbestellen bij dezelfde order | **Regel toevoegen** |
| Prijs correctie | **Regel bewerken** → prijs |
| Leverancier levert minder dan besteld | **Regel bewerken** → aantal verlagen, of **Regel annuleren** ("rest komt niet meer") |
| Regel was een vergissing (nog niets ontvangen) | **Regel verwijderen** |
| Hele order vervalt | Order **Annuleren** (bestaande knop) |

**De Claim-vloer:** zodra klantorders of snijplanning op een inkoopregel
rekenen, weigert verlagen/verwijderen eerst — met een melding wat erop rust.
Vink je "Beloftes vrijgeven en doorgaan" aan, dan vallen de getroffen
klantorders zichtbaar terug naar **"Wacht op inkoop"** (nooit stil). Draai
daarna voor maatwerk-groepen zo nodig "Auto-plan opnieuw" op de
Snijplanning-pagina, en bestel het tekort opnieuw in.
```

- [ ] **Step 2: Commit**

```bash
git add docs/werkwijze-inkoop.md
git commit -m "docs: werkinstructie inkoopproces (bestellen/verwachten/portal/ontvangen/wijzigen)"
```

---

### Task 14: Levende docs + eindverificatie

**Files:**
- Modify: `docs/database-schema.md` (functies-tabel: 6 nieuwe/gewijzigde RPC's)
- Modify: `docs/data-woordenboek.md` (Inkoop-sectie: Claim-vloer + mutatie-RPC's + werkwijze-verwijzing)
- Modify: `docs/changelog.md` (entry 2026-07-XX)
- Modify: `CLAUDE.md` (bedrijfsregel-bullet)

- [ ] **Step 1: database-schema.md — functies-tabel aanvullen**

Voeg toe aan de RPC-tabel (zelfde format als bestaande rijen):

```markdown
| `create_inkooporder(p_header JSONB, p_regels JSONB) → TABLE(inkooporder_id, inkooporder_nr)` | **Inkoop-Module (mig 601)**: transactioneel aanmaken van order + regels (status altijd 'Besteld'). Eén schrijfpad voor UI en import. |
| `herbereken_inkooporder_status(p_inkooporder_id)` | Mig 602: status herafleiden uit regels (Ontvangen/Deels ontvangen/Besteld); no-op bij Geannuleerd/0 regels. |
| `voeg_inkooporder_regel_toe(p_inkooporder_id, p_regel JSONB) → BIGINT` | Mig 602: regel toevoegen, regelnummer=MAX+1; swap-evaluatie via bestaande INSERT-trigger. |
| `wijzig_inkooporder_regel(p_regel_id, p_besteld, p_inkoopprijs_eur, p_vrijgeven)` | Mig 602: aantal/prijs wijzigen met **Claim-vloer**-guard (CONTEXT.md). p_vrijgeven releaset snijplan- + verkooporder-claims expliciet (orders vallen zichtbaar terug naar 'Wacht op inkoop'). |
| `annuleer_inkooporder_regel(p_regel_id, p_vrijgeven)` | Mig 602: "rest komt niet" — besteld := geleverd; delegeert naar wijzig_inkooporder_regel. |
| `verwijder_inkooporder_regel(p_regel_id, p_vrijgeven)` | Mig 602: alleen zonder ontvangsten, nooit de laatste regel. Kale DELETE verboden (FK snijplannen ON DELETE SET NULL). |
```

En werk de bestaande `boek_inkooporder_ontvangst_rollen`-rij bij: signature + "mig 603: per-rol `locatie` → `rollen.locatie_id`; over-leveringsgrens 110% (`p_sta_overlevering_toe`)". Verwijder de rijen van `boek_ontvangst`/`boek_voorraad_ontvangst` (gedropt in mig 604).

- [ ] **Step 2: data-woordenboek.md — Inkoop-sectie aanvullen**

Onder `## Inkoop` toevoegen:

```markdown
- **Claim-vloer**: ondergrens waaronder een inkooporderregel niet verlaagd/verwijderd mag: `geleverd + actieve verkooporder-claims + snijplan-claims ('Wacht op inkoop')`. Eronder vereist expliciet vrijgeven (mig 602) — getroffen orders vallen zichtbaar terug naar 'Wacht op inkoop'. Zie CONTEXT.md.
- **Regel-mutaties**: toevoegen/bewerken/annuleren/verwijderen van inkooporderregels loopt uitsluitend via de mig-602-RPC's; werkinstructie: `docs/werkwijze-inkoop.md`.
```

- [ ] **Step 3: changelog.md — entry toevoegen** (bovenaan, huidige datum):

```markdown
## 2026-07-XX — Volledig inkoopproces: transactioneel aanmaken, regel-mutaties met Claim-vloer, ontvangst met locatie, portal-huishouding

- **Mig 601 `create_inkooporder`**: transactioneel aanmaken (header+regels in één RPC) — de oude 3-losse-inserts-flow kon een lege order achterlaten. UI kan nu ook `eenheid='stuks'`-regels maken (antislip-regel mig 408 was via de UI onbereikbaar).
- **Mig 602 regel-mutaties**: `voeg_inkooporder_regel_toe`/`wijzig_inkooporder_regel`/`annuleer_inkooporder_regel`/`verwijder_inkooporder_regel` + helper `herbereken_inkooporder_status`, met **Claim-vloer**-guard (CONTEXT.md): verlagen/verwijderen onder de beloftes vereist expliciet vrijgeven; getroffen orders vallen zichtbaar terug naar 'Wacht op inkoop'. UI: bewerk-/annuleer-/verwijder-knoppen + "Regel toevoegen" op inkooporder-detail.
- **Mig 603 ontvangst**: per-rol magazijnlocatie (→ `rollen.locatie_id`) + over-leveringsgrens 110% met expliciete bevestiging. Superset-keten 281→603.
- **Mig 604**: deprecated wrappers `boek_ontvangst`/`boek_voorraad_ontvangst` gedropt (deadline 13-07); frontend-callers omgezet naar de mig-271-namen.
- **Portal**: dode React-portal (`/portal/*`) verwijderd — portal.karpi.nl (statische `docs/portal/index.html`) is de enige implementatie. Uitrol naar meer leveranciers: opt-in, later (besluit 02-07).
- **Werkinstructie**: `docs/werkwijze-inkoop.md` (bestellen/verwachten/portal/ontvangen/wijzigen).
- E2E-portal-rondreis met testleverancier geslaagd (login → GET → PATCH ETA → herkomst 'leverancier' → ontvangst met locatie → cleanup).
```

- [ ] **Step 4: CLAUDE.md — bedrijfsregel-bullet toevoegen** (in de Bedrijfsregels-sectie):

```markdown
- **Inkooporder wijzigen = RPC's met Claim-vloer (mig 601-604, 2026-07):** aanmaken via `create_inkooporder` (transactioneel, ook stuks); regel-mutaties via `voeg_/wijzig_/annuleer_/verwijder_inkooporder_regel` — nooit directe writes (ADR-0017). **Claim-vloer** (CONTEXT.md): verlagen/verwijderen onder `geleverd + verkooporder-claims + snijplan-'Wacht op inkoop'-claims` vereist expliciet `p_vrijgeven=TRUE`; de RPC releaset dan snijplan-stukken (per-regel-variant van mig 445) + verkooporder-claims (`release_claims_voor_io_regel`) zodat orders zíchtbaar terugvallen naar 'Wacht op inkoop'. Kale DELETE op `inkooporder_regels` is verboden terrein: de FK `snijplannen.verwacht_inkooporder_regel_id` is ON DELETE SET NULL en laat anders stille wezen achter. Ontvangst (mig 603, superset 281): per-rol `locatie` → `rollen.locatie_id`, over-levering >110% vereist bevestiging. Werkinstructie: `docs/werkwijze-inkoop.md`. Leveranciersportal blijft ETA+notitie-only (portal.karpi.nl = statische `docs/portal/index.html`; de React-portal-routes zijn verwijderd).
```

- [ ] **Step 5: Eindverificatie**

```powershell
npx tsc --noEmit -p frontend/tsconfig.app.json
Set-Location frontend; npm run build; npx vitest run --reporter=dot
bash scripts/lint-no-direct-inkooporder-regel-write.sh
```

Expected: alles groen. Draai ook de drie SQL-testscripts nog één keer (alle drie `ALLE ASSERTS GESLAAGD`).

- [ ] **Step 6: Commit**

```bash
git add docs/database-schema.md docs/data-woordenboek.md docs/changelog.md CLAUDE.md
git commit -m "docs: levende docs bijgewerkt voor inkoopproces (mig 601-604)"
```

---

## Deploy-volgorde (na "merge maar" van Miguel)

1. Migraties 601-603 zijn al live gedraaid tijdens de bouw (Tasks 2/4/7).
2. Merge `feat/inkoopproces` → main (push branch → origin, memory merge-race) → Vercel deployt de frontend automatisch.
3. **Dán pas** mig 604 draaien (`supabase db query --linked -f supabase/migrations/604_drop_deprecated_ontvangst_wrappers.sql`) — vóór 2026-07-13.
4. Geen edge-function-deploys nodig (supplier-portal ongewijzigd).
5. Worktree + branch opruimen conform CLAUDE.md-workflow.

## Self-review (uitgevoerd bij het schrijven)

- **Spec-dekking:** besluit 1 → Tasks 4-6; besluit 2 → Task 9 + 12 + 13 §3; besluit 3 → Tasks 7-8 + 13 §4; besluit 4 → Tasks 2-3; besluit 5 → vervallen (bestond al, zie kop); besluit 6 → Task 9. Wrappers-deadline → Tasks 1 + 11. Testdraaiboek → SQL-tests (Tasks 2/4/7) + e2e (Task 12).
- **Type-consistentie:** `OntvangstRol.locatie` (Task 8) matcht het JSONB-veld `locatie` (Task 7); `isClaimVloerFout` matcht de `Claim-vloer:`-prefix in mig 602; `RegelBewerkModus` wordt in Task 6 zowel geëxporteerd als geconsumeerd; de 4e RPC-param heet overal `p_sta_overlevering_toe`.
- **Bekende beperking (bewust):** de stuks-claim-test (Task 4, stap 6) skipt als er toevallig geen live actieve stuks-IO-claim bestaat — meld het in de samenvatting zodat de reviewer het weet.
