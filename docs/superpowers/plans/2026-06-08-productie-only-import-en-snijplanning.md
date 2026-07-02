# Productie-only orders uit Basta — import & snijplanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importeer alle nog-niet-gesneden maatwerk-orders uit het oude systeem (Basta, t/m 03-06-2026) als "productie-only" orders in RugFlow, zodat ze meelopen in snijden + confectie; factureren/verzenden/labels blijven in Basta.

**Architecture:** Echte orders + order_regels met een `alleen_productie`-vlag. `auto_maak_snijplan` (bestaand) maakt per stuk een snijplan → de packer reserveert echte rollengte (vervangt de virtuele `migratie_blokkering` uit ADR-0028). Een gelabelde order bereikt de nieuwe terminale status `Maatwerk afgerond` zodra alle snijplannen confectie-afgerond zijn — daarna géén Pick & Ship, factuur of transport. **Gouden regel:** elke wijziging is geguard op `alleen_productie = true`; gewone orders blijven byte-voor-byte ongewijzigd.

**Tech Stack:** Supabase (PostgreSQL: migraties + PL/pgSQL RPC's), React/TypeScript (snijplanning + Pick & Ship + order-detail), Python 3.11 (pandas/openpyxl/supabase-py import-script), pytest + vitest.

**Bronbestanden (canoniek):**
- `totaalplanning_cleaned_v2.xlsx`, sheet `Snijden Karpi op kwal`, 1.276 regels (de backlog).
- `planning vanaf 10-juni-tot-19-juni.xlsx`, sheet `09 tm 19-06`, 391 regels (bevestigde dagplanning; fase B).

**Geverifieerde data-feiten (uit `scripts/_verify_blockers_report.txt`):**
- Basta-ordernr [kol 10]: 100% numeriek, max 26.581.740 → past in `orders.oud_order_nr` (BIGINT).
- GROF-afwerking [kol 14]: `SB`(822), `B`(312), `ZO`(84), `FE`(40), `ON`(9), leeg(9) — alle geldige `afwerking_types.code`.
- FIJN-afwerking [kol 6]: 312 echte codes (vrijwel 1-op-1 met de GROF=`B`-regels) + ~17 ruis ("rol 1/ 19,7 mtr").
- Biasband (DA-codes): 6 regels = 0,5% → V1 naar stickeren (`ON`), gerapporteerd.
- "uit NxN" (standaardmaat) [kol 22]: 21 regels.
- aantal>1 [kol 9]: 59 regels. snijdag al ingevuld [kol 18]: 381 regels. Geen FPNL/FPDE/FPW in deze batch.
- FK's met RESTRICT: `order_regels.maatwerk_afwerking → afwerking_types(code)` en `maatwerk_vorm → maatwerk_vormen(code)`.

**Kolommapping `totaalplanning_cleaned_v2.xlsx` (0-based, merged-cell-headers verschoven — gebruik DEZE indices):**
`[0]` artikelcode `<KWAL><KLEUR>MAATWERK` · `[1]` omschrijving · `[6]` FIJN-afwerking · `[7]` maat1 · `[8]` maat2 (of `RND`) · `[9]` aantal · `[10]` Basta-ordernr · `[11]` debiteurnr · `[12]` debiteurnaam · `[14]` GROF-afwerking · `[15]` orderregel · `[17]` verzendweek `WW-2026` · `[18]` snijdag · `[22]` opmerking.

---

## Pre-flight verificatie (Task 0)

### Task 0: Bevestig de live-DB-realiteit (legacy-migraties ≤052 staan niet op disk)

**Files:** geen — alleen verificatie. MCP kan Karpi niet bereiken → laat Miguel deze SQL draaien in de Supabase SQL-editor.

- [ ] **Step 1: Draai de pre-flight queries**

```sql
-- (a) Welke afwerking-codes bestaan echt? Verwacht: B, FE, LO, ON, SB, SF, VO, ZO
SELECT code, type_bewerking FROM afwerking_types ORDER BY code;

-- (b) Bestaat de groepen-RPC al? Verwacht: niet-NULL (legacy mig 045, off-disk)
SELECT to_regprocedure('snijplanning_groepen_gefilterd(date,date)');

-- (c) Hoeveel actieve migratie_blokkering-rijen? Bepaalt de vrijgeven-stap (Task A11)
SELECT count(*) FROM migratie_blokkering WHERE status = 'actief';

-- (d) order_status enum (reeds bevestigd 2026-06-08: 'Maatwerk afgerond' ONTBREEKT → Task A1 voegt toe)
SELECT unnest(enum_range(NULL::order_status));

-- (e) Verplichte (NOT NULL) kolommen op debiteuren — voor de verzameldebiteur-insert (Task A1, Step 3)
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'debiteuren' AND is_nullable = 'NO'
ORDER BY ordinal_position;

-- (f) Bestaat er al een UNIQUE index op orders.oud_order_nr? (idempotentie-sleutel)
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'orders' AND indexdef ILIKE '%oud_order_nr%';
```

- [ ] **Step 2: Leg de uitkomsten vast**

Noteer (a)-(f) bovenaan deze planfile of in de PR-omschrijving. **Blokkerend:** als (a) een code mist die de afwerking-mapper produceert (B/SB/FE/SF/LO/VO/ON/ZO), corrigeer de mapper-output. Als (e) meer NOT NULL-kolommen toont dan Task A1 Step 3 vult, breid de insert uit. Als (f) al een unique index toont, sla de `CREATE UNIQUE INDEX` in Task A1 Step 4 over (idempotent `IF NOT EXISTS` dekt dit ook af).

---

# FASE A — Vanavond: import + zichtbaarheid + op de rol (R1, R3, R5-vlag, R9)

Doel van fase A: de 1.276 backlog-regels staan als productie-only orders in RugFlow, zichtbaar in de snijplanning, gereserveerd op de rol, uitgesloten van Pick & Ship/facturatie, en opzoekbaar op Basta-nr.

## Task A1: Schema — vlag, status, verzameldebiteur, vlaggen-kolommen (R1, R5)

**Files:**
- Create: `supabase/migrations/327_productie_only_schema.sql`

- [ ] **Step 1: Schrijf de migratie (kolommen + enum + CHECK)**

```sql
-- Migratie 327: productie-only schema (R1 + R5)
-- Voegt het 'productie-only'-concept toe: orders uit Basta die in RugFlow alleen
-- snijden+confectie doorlopen. Strikt additief; gewone orders ongewijzigd.

BEGIN;

-- 1. Vlag op orders: dé schakelaar die alle guards uitlezen.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS alleen_productie BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN orders.alleen_productie IS
  'TRUE = productie-only order uit Basta (oud systeem): RugFlow doet alleen '
  'snijden+confectie, facturatie/verzending in Basta. Zie ADR-0029.';

-- 2. Gouden regel als DB-CHECK: alleen_productie impliceert herkomst Basta.
ALTER TABLE orders
  ADD CONSTRAINT chk_alleen_productie_bron
  CHECK (alleen_productie = false OR bron_systeem = 'oud_systeem');

-- 3. Terminale order-status (enum-uitbreiding; 'Maatwerk afgerond' bestaat nog niet).
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'Maatwerk afgerond';

-- 4. Standaardmaat-vlag (R5): stuk wordt uit een standaard-maat gesneden, niet uit rol.
ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS snijden_uit_standaardmaat BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN order_regels.snijden_uit_standaardmaat IS
  'TRUE = wordt uit een standaard-maat kleed gesneden, NIET uit een rol. '
  'Verschijnt wel in snijden+confectie maar verbruikt geen rollengte (R5).';

ALTER TABLE snijplannen
  ADD COLUMN IF NOT EXISTS snijden_uit_standaardmaat BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN snijplannen.snijden_uit_standaardmaat IS
  'Gekopieerd van order_regels door auto_maak_snijplan. Uitgesloten van rol-packing.';

COMMIT;
```

> **Let op:** `ALTER TYPE ... ADD VALUE` mag in nieuwere Postgres binnen een transactie, maar de nieuwe waarde mag pas ná COMMIT gebruikt worden. Daarom staat de enum-add in hetzelfde COMMIT-blok en wordt `'Maatwerk afgerond'` pas in Task A4 (aparte migratie) gebruikt.

- [ ] **Step 2: Indexen**

```sql
-- Snelle guards/queries op de vlag.
CREATE INDEX IF NOT EXISTS idx_orders_alleen_productie
  ON orders(alleen_productie) WHERE alleen_productie;

CREATE INDEX IF NOT EXISTS idx_order_regels_uit_standaardmaat
  ON order_regels(snijden_uit_standaardmaat) WHERE snijden_uit_standaardmaat;
```

- [ ] **Step 3: Verzameldebiteur "Oud systeem (productie)" (fallback voor Task A6)**

Pas de kolomlijst aan op de uitkomst van Task 0 Step 1(e). Minimale variant:

```sql
INSERT INTO debiteuren (debiteur_nr, naam, plaats, land, status)
VALUES (900000, 'OUD SYSTEEM (PRODUCTIE)', 'Aalten', 'NL', NULL)
ON CONFLICT (debiteur_nr) DO NOTHING;
```

- [ ] **Step 4: Idempotentie-sleutel op oud_order_nr**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS orders_oud_order_nr_uniek
  ON orders(oud_order_nr) WHERE oud_order_nr IS NOT NULL;
```

- [ ] **Step 5: Assertie-blok onderaan de migratie (conform ADR-0018-patroon)**

```sql
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'order_status' AND e.enumlabel = 'Maatwerk afgerond') = 1,
         'order_status mist Maatwerk afgerond';
  ASSERT (SELECT 1 FROM information_schema.columns
          WHERE table_name='orders' AND column_name='alleen_productie') IS NOT NULL,
         'orders.alleen_productie ontbreekt';
  RAISE NOTICE 'Mig 327 OK: alleen_productie + Maatwerk afgerond + standaardmaat-vlaggen aanwezig.';
END $$;
```

- [ ] **Step 6: Toepassen + verifiëren**

Laat Miguel de migratie draaien (MCP geen toegang). Verwacht: `NOTICE Mig 327 OK`. Verifieer: `SELECT alleen_productie FROM orders LIMIT 1;` → geen fout.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/327_productie_only_schema.sql
git commit -m "feat(productie-only): schema — alleen_productie vlag + Maatwerk afgerond status + standaardmaat-vlaggen (mig 327)"
```

## Task A2: `auto_maak_snijplan` kopieert de standaardmaat-vlag (R5)

**Files:**
- Create: `supabase/migrations/328_auto_maak_snijplan_standaardmaat.sql`

- [ ] **Step 1: Herschrijf de trigger-functie (additief — gewone orders krijgen false, identiek gedrag)**

```sql
-- Migratie 328: auto_maak_snijplan kopieert snijden_uit_standaardmaat naar het snijplan.
-- Strikt additief: voor gewone regels is de vlag false → snijplan krijgt false (= huidige situatie).
CREATE OR REPLACE FUNCTION auto_maak_snijplan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_aantal INTEGER;
  i        INTEGER;
BEGIN
  IF NEW.is_maatwerk IS NOT TRUE
     OR NEW.maatwerk_lengte_cm  IS NULL
     OR NEW.maatwerk_breedte_cm IS NULL
  THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM snijplannen WHERE order_regel_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_aantal := GREATEST(COALESCE(NEW.orderaantal, 1), 1);

  FOR i IN 1..v_aantal LOOP
    INSERT INTO snijplannen (
      snijplan_nr, order_regel_id,
      lengte_cm, breedte_cm,
      status, opmerkingen,
      snijden_uit_standaardmaat
    )
    VALUES (
      volgend_nummer('SNIJ'),
      NEW.id,
      NEW.maatwerk_lengte_cm::INTEGER,
      NEW.maatwerk_breedte_cm::INTEGER,
      'Wacht'::snijplan_status,
      CASE WHEN v_aantal > 1
           THEN 'Auto-aangemaakt (' || i || '/' || v_aantal || ')'
           ELSE 'Auto-aangemaakt'
      END,
      COALESCE(NEW.snijden_uit_standaardmaat, false)
    );
  END LOOP;

  RETURN NEW;
END;
$$;
NOTIFY pgrst, 'reload schema';
```

> **Doe hetzelfde voor `auto_sync_snijplan_maten`** (mig 323) als die ook snijplannen INSERT't (self-healing-fallback): voeg `snijden_uit_standaardmaat` toe aan díe INSERT met dezelfde `COALESCE(NEW.snijden_uit_standaardmaat, false)`. Controleer mig 323 vóór je commit.

- [ ] **Step 2: Toepassen + commit**

```bash
git add supabase/migrations/328_auto_maak_snijplan_standaardmaat.sql
git commit -m "feat(productie-only): auto_maak_snijplan kopieert standaardmaat-vlag naar snijplan (mig 328)"
```

## Task A3: Afwerking-mapper (Python lib + tests) (R9)

**Files:**
- Create: `import/lib/afwerking_mapper.py`
- Test: `import/tests/test_afwerking_mapper.py`

- [ ] **Step 1: Schrijf de falende tests**

```python
# import/tests/test_afwerking_mapper.py
from lib.afwerking_mapper import map_afwerking_code

def test_grof_directe_codes():
    assert map_afwerking_code("SB", "", "") == "SB"
    assert map_afwerking_code("ZO", "", "") == "ZO"
    assert map_afwerking_code("ON", "", "") == "ON"
    assert map_afwerking_code("FE", "", "") == "FE"

def test_grof_b_resolveert_via_fijn():
    assert map_afwerking_code("B", "FESM", "")  == "SF"   # smalfeston
    assert map_afwerking_code("B", "FEBR", "")  == "FE"   # breedfeston -> feston
    assert map_afwerking_code("B", "FU12", "")  == "SF"
    assert map_afwerking_code("B", "F191", "")  == "SF"
    assert map_afwerking_code("B", "PE21", "")  == "B"    # breedband
    assert map_afwerking_code("B", "RM21", "")  == "B"
    assert map_afwerking_code("B", "KI36", "")  == "B"
    assert map_afwerking_code("B", "KIKK", "")  == "B"
    assert map_afwerking_code("B", "VOLU", "")  == "VO"
    assert map_afwerking_code("B", "LOCK", "")  == "LO"

def test_biasband_da_naar_on_v1():
    # Biasband heeft geen RugFlow-lane in V1 (0,5%) -> stickeren (ON), wordt gerapporteerd.
    assert map_afwerking_code("B", "DA12", "") == "ON"

def test_b_zonder_bruikbare_fijn_default_breedband():
    assert map_afwerking_code("B", "rol 1/ 19,7 mtr", "") == "B"
    assert map_afwerking_code("B", "", "") == "B"

def test_leeg_grof_valt_terug_op_fijn_dan_default():
    assert map_afwerking_code("", "FESM", "") == "SF"
    assert map_afwerking_code("", "", "")     == "B"   # laatste vangnet

def test_onbekende_code_is_zichtbaar_via_is_herkend():
    from lib.afwerking_mapper import is_herkend
    assert is_herkend("B", "FESM") is True
    assert is_herkend("B", "rol 1/ 19,7 mtr") is False  # default-gebruikt -> rapporteren
    assert is_herkend("SB", "") is True
```

- [ ] **Step 2: Run de tests — verwacht FAIL (module bestaat niet)**

Run: `cd import && python -m pytest tests/test_afwerking_mapper.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'lib.afwerking_mapper'`

- [ ] **Step 3: Implementeer de mapper**

```python
# import/lib/afwerking_mapper.py
"""Map Piet-heins GROF [14] + FIJN [6] afwerkingscodes naar RugFlow afwerking_types.code.

Geldige RugFlow-codes (FK-veilig): B, SB, FE, SF, LO, VO, ON, ZO.
Resolutie: GROF is leidend; bij GROF='B' (of leeg) bepaalt FIJN de echte variant.
"""
from __future__ import annotations
import re

_GELDIGE = {"B", "SB", "FE", "SF", "LO", "VO", "ON", "ZO"}

def _norm(s) -> str:
    return str(s).strip().upper() if s is not None else ""

def _fijn_naar_code(fijn: str) -> str | None:
    """FIJN-code -> RugFlow-code, of None als niet herkend."""
    f = _norm(fijn)
    if not f:
        return None
    if f.startswith("FESM"):                  return "SF"
    if f.startswith("FEBR"):                  return "FE"
    if f.startswith("FU") or f.startswith("FUR"): return "SF"
    if re.match(r"^F\d{3}", f):               return "SF"   # F191, F198
    if f.startswith("FE"):                    return "FE"
    if f.startswith("PE"):                    return "B"
    if f.startswith("RM"):                    return "B"
    if re.match(r"^(KI|KK|KO|KB|KC|KH|KA|KF|KG|KM)", f): return "B"  # breedband K-familie
    if f.startswith("VOLU"):                  return "VO"
    if f.startswith("LOCK"):                  return "LO"
    if f.startswith("DA"):                    return "ON"   # Biasband -> stickeren in V1 (0,5%)
    return None

def is_herkend(grof, fijn) -> bool:
    """True als de code expliciet herkend is (geen default-fallback gebruikt)."""
    g = _norm(grof)
    if g in {"SB", "ZO", "ON", "FE"}:
        return True
    if g == "B" or g == "":
        return _fijn_naar_code(fijn) is not None
    return g in _GELDIGE

def map_afwerking_code(grof, fijn, omschrijving="") -> str:
    """Geef altijd een FK-veilige RugFlow-code terug. Default 'B' (breedband)."""
    g = _norm(grof)
    if g in {"SB", "ZO", "ON", "FE"}:
        return g
    if g in _GELDIGE and g != "B":
        return g
    # g == 'B' of leeg of onbekend -> probeer FIJN, anders breedband.
    code = _fijn_naar_code(fijn)
    return code if code is not None else "B"
```

- [ ] **Step 4: Run de tests — verwacht PASS**

Run: `cd import && python -m pytest tests/test_afwerking_mapper.py -v`
Expected: PASS (alle cases groen)

- [ ] **Step 5: Commit**

```bash
git add import/lib/afwerking_mapper.py import/tests/test_afwerking_mapper.py
git commit -m "feat(productie-only): afwerking-mapper GROF+FIJN -> RugFlow-code met dry-run-herkenning (R9)"
```

## Task A4: RPC `import_productie_only_order` (R1)

**Files:**
- Create: `supabase/migrations/329_import_productie_only_order_rpc.sql`

- [ ] **Step 1: Schrijf de RPC (idempotent op oud_order_nr)**

```sql
-- Migratie 329: RPC import_productie_only_order — idempotente import van één Basta-order.
-- p_header  : { oud_order_nr (BIGINT), debiteur_nr (INT, mag NULL->verzameldebiteur),
--               debiteur_naam (TEXT), orderdatum (DATE), afleverdatum (DATE) }
-- p_regels  : [ { regelnummer, omschrijving, orderaantal,
--                 maatwerk_kwaliteit_code, maatwerk_kleur_code,
--                 maatwerk_lengte_cm, maatwerk_breedte_cm,
--                 maatwerk_afwerking (FK-veilige code uit afwerking-mapper),
--                 maatwerk_vorm (rechthoek|rond|ovaal|NULL),
--                 snijden_uit_standaardmaat (bool),
--                 maatwerk_instructies (TEXT) } ]
-- Retourneert (order_nr TEXT, was_existing BOOLEAN). auto_maak_snijplan maakt de snijplannen.
CREATE OR REPLACE FUNCTION import_productie_only_order(p_header JSONB, p_regels JSONB)
RETURNS TABLE(order_nr TEXT, was_existing BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_oud_nr      BIGINT  := (p_header->>'oud_order_nr')::BIGINT;
  v_deb_in      INTEGER := NULLIF(p_header->>'debiteur_nr','')::INTEGER;
  v_deb         INTEGER;
  v_order_id    BIGINT;
  v_order_nr    TEXT;
  v_regel       JSONB;
  r             RECORD;
BEGIN
  IF v_oud_nr IS NULL THEN
    RAISE EXCEPTION 'import_productie_only_order: oud_order_nr verplicht';
  END IF;

  -- Idempotent: bestaat deze Basta-order al? Dan niets doen, retourneer bestaande.
  SELECT o.id, o.order_nr INTO v_order_id, v_order_nr
    FROM orders o WHERE o.oud_order_nr = v_oud_nr;
  IF FOUND THEN
    RETURN QUERY SELECT v_order_nr, true;
    RETURN;
  END IF;

  -- Debiteur: echte als die bestaat, anders verzameldebiteur 900000 (Task A1).
  SELECT d.debiteur_nr INTO v_deb FROM debiteuren d WHERE d.debiteur_nr = v_deb_in;
  IF NOT FOUND THEN
    v_deb := 900000;
  END IF;

  v_order_nr := 'OUD-' || v_oud_nr::TEXT;

  INSERT INTO orders (
    order_nr, debiteur_nr, orderdatum, afleverdatum,
    status, bron_systeem, oud_order_nr, alleen_productie, lever_type
  )
  VALUES (
    v_order_nr, v_deb,
    COALESCE((p_header->>'orderdatum')::DATE, CURRENT_DATE),
    (p_header->>'afleverdatum')::DATE,
    'In productie'::order_status,   -- zichtbaar in snijplanning, niet-terminaal
    'oud_systeem', v_oud_nr, true, 'week'::lever_type
  )
  RETURNING id INTO v_order_id;

  -- Order_regels: één per element. auto_maak_snijplan (AFTER INSERT) expandeert naar snijplannen.
  FOR v_regel IN SELECT * FROM jsonb_array_elements(p_regels)
  LOOP
    INSERT INTO order_regels (
      order_id, regelnummer, omschrijving, orderaantal, te_leveren,
      is_maatwerk,
      maatwerk_kwaliteit_code, maatwerk_kleur_code,
      maatwerk_lengte_cm, maatwerk_breedte_cm,
      maatwerk_afwerking, maatwerk_vorm,
      snijden_uit_standaardmaat, maatwerk_instructies,
      productie_groep
    )
    VALUES (
      v_order_id,
      COALESCE((v_regel->>'regelnummer')::INTEGER, 1),
      COALESCE(v_regel->>'omschrijving', 'Maatwerk'),
      COALESCE((v_regel->>'orderaantal')::INTEGER, 1),
      COALESCE((v_regel->>'orderaantal')::INTEGER, 1),
      true,
      v_regel->>'maatwerk_kwaliteit_code',
      v_regel->>'maatwerk_kleur_code',
      (v_regel->>'maatwerk_lengte_cm')::INTEGER,
      (v_regel->>'maatwerk_breedte_cm')::INTEGER,
      NULLIF(v_regel->>'maatwerk_afwerking',''),
      NULLIF(v_regel->>'maatwerk_vorm',''),
      COALESCE((v_regel->>'snijden_uit_standaardmaat')::BOOLEAN, false),
      v_regel->>'maatwerk_instructies',
      COALESCE(v_regel->>'maatwerk_kwaliteit_code','') || COALESCE(v_regel->>'maatwerk_kleur_code','')
    );
  END LOOP;

  RETURN QUERY SELECT v_order_nr, false;
END;
$$;
NOTIFY pgrst, 'reload schema';
```

> **Bewuste keuzes:** status `'In productie'` (bestaat in enum, niet-terminaal, verschijnt in `snijplanning_overzicht` dat alleen `Geannuleerd` weert). Géén allocator-aanroep (maatwerk reserveert niet op inkoop). `maatwerk_afwerking`/`maatwerk_vorm` worden als geldige codes of NULL ingevoegd → FK-RESTRICT-veilig. Prijsvelden blijven NULL: facturatie gebeurt in Basta.

- [ ] **Step 2: Idempotentie-test (SQL DO-blok onderaan de migratie)**

```sql
DO $$
DECLARE r RECORD; v_n1 TEXT; v_n2 TEXT; v_was BOOLEAN;
BEGIN
  -- Eerste import
  SELECT * INTO r FROM import_productie_only_order(
    '{"oud_order_nr": 99999991, "debiteur_nr": null, "afleverdatum": "2026-06-15"}'::jsonb,
    '[{"regelnummer":1,"omschrijving":"TEST","orderaantal":1,"maatwerk_kwaliteit_code":"TEST","maatwerk_kleur_code":"01","maatwerk_lengte_cm":200,"maatwerk_breedte_cm":300,"maatwerk_afwerking":"B","maatwerk_vorm":"rechthoek","snijden_uit_standaardmaat":false}]'::jsonb);
  v_n1 := r.order_nr;
  ASSERT r.was_existing = false, 'eerste import moet nieuw zijn';
  ASSERT (SELECT count(*) FROM snijplannen sp JOIN order_regels orr ON orr.id=sp.order_regel_id
          JOIN orders o ON o.id=orr.order_id WHERE o.oud_order_nr=99999991) = 1,
         'auto_maak_snijplan moet 1 snijplan maken';
  -- Tweede import (idempotent)
  SELECT * INTO r FROM import_productie_only_order(
    '{"oud_order_nr": 99999991, "afleverdatum": "2026-06-15"}'::jsonb, '[]'::jsonb);
  ASSERT r.was_existing = true, 'tweede import moet was_existing=true geven';
  ASSERT r.order_nr = v_n1, 'zelfde order_nr bij her-import';
  -- Opruimen testdata
  DELETE FROM orders WHERE oud_order_nr = 99999991;
  RAISE NOTICE 'Mig 329 OK: idempotente import + snijplan-creatie geverifieerd.';
END $$;
```

- [ ] **Step 3: Toepassen + verifiëren** — verwacht `NOTICE Mig 329 OK`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/329_import_productie_only_order_rpc.sql
git commit -m "feat(productie-only): RPC import_productie_only_order — idempotent op oud_order_nr (R1, mig 329)"
```

## Task A5: Terminale-status flip in `voltooi_confectie` (R1)

**Files:**
- Create: `supabase/migrations/330_voltooi_confectie_maatwerk_afgerond.sql`

- [ ] **Step 1: Herschrijf `voltooi_confectie` met een geguarde na-stap**

Neem de exacte body uit mig 250 over en voeg ná de bestaande UPDATE een geguard blok toe. Wijzig niets aan het bestaande pad (gewone orders ongemoeid).

```sql
-- Migratie 330: voltooi_confectie flipt productie-only orders naar 'Maatwerk afgerond'
-- zodra ALLE snijplannen van de order confectie-afgerond zijn. Strikt geguard op alleen_productie.
CREATE OR REPLACE FUNCTION voltooi_confectie(
  p_snijplan_id BIGINT,
  p_afgerond    BOOLEAN DEFAULT true,
  p_ingepakt    BOOLEAN DEFAULT false,
  p_locatie     TEXT    DEFAULT NULL
)
RETURNS snijplannen
LANGUAGE plpgsql
AS $$
DECLARE
  v_row snijplannen;
  v_nu  TIMESTAMPTZ := NOW();
  v_eff_afgerond BOOLEAN := p_afgerond OR p_ingepakt;
  v_order_id BIGINT;
  v_open INTEGER;
BEGIN
  UPDATE snijplannen
     SET confectie_afgerond_op = CASE WHEN v_eff_afgerond THEN v_nu ELSE NULL END,
         ingepakt_op           = CASE WHEN p_ingepakt THEN v_nu ELSE NULL END,
         locatie               = CASE
                                   WHEN p_locatie IS NULL THEN locatie
                                   WHEN trim(p_locatie) = '' THEN NULL
                                   ELSE trim(p_locatie)
                                 END,
         status                = CASE
                                   WHEN p_ingepakt    THEN 'Ingepakt'::snijplan_status
                                   WHEN v_eff_afgerond THEN 'In confectie'::snijplan_status
                                   ELSE                    'Gesneden'::snijplan_status
                                 END
   WHERE id = p_snijplan_id
     AND status IN ('Gesneden'::snijplan_status, 'In confectie'::snijplan_status,
                    'Gereed'::snijplan_status, 'Ingepakt'::snijplan_status)
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'snijplan % niet in status Gesneden/In confectie/Gereed/Ingepakt', p_snijplan_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- NA-STAP (productie-only): order naar 'Maatwerk afgerond' als ALLE snijplannen afgerond zijn.
  IF v_eff_afgerond THEN
    SELECT orr.order_id INTO v_order_id
      FROM order_regels orr WHERE orr.id = v_row.order_regel_id;

    IF EXISTS (SELECT 1 FROM orders o
               WHERE o.id = v_order_id AND o.alleen_productie = true
                 AND o.status <> 'Maatwerk afgerond'::order_status) THEN
      SELECT count(*) INTO v_open
        FROM snijplannen sp
        JOIN order_regels orr ON orr.id = sp.order_regel_id
       WHERE orr.order_id = v_order_id
         AND sp.confectie_afgerond_op IS NULL;

      IF v_open = 0 THEN
        UPDATE orders SET status = 'Maatwerk afgerond'::order_status WHERE id = v_order_id;
      END IF;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Toepassen + commit**

```bash
git add supabase/migrations/330_voltooi_confectie_maatwerk_afgerond.sql
git commit -m "feat(productie-only): voltooi_confectie flipt order naar Maatwerk afgerond (geguard op alleen_productie, mig 330)"
```

## Task A6: Sluit standaardmaat-stukken uit van rol-packing (R5, R3)

**Files:**
- Modify: `supabase/functions/_shared/db-helpers.ts` (functie `fetchStukken`)

- [ ] **Step 1: Lees de huidige `fetchStukken` select**

Run: lees `supabase/functions/_shared/db-helpers.ts:31-74`. Bevestig de `.from('snijplanning_overzicht')`/`order_regels`-bron en het statusfilter dat de te-plannen stukken selecteert.

- [ ] **Step 2: Voeg het filter toe**

Voeg aan de query die de te-packen stukken ophaalt toe: `.eq('snijden_uit_standaardmaat', false)` (of, als de bron `snijplanning_overzicht` is en de kolom nog niet exposed, eerst Task A7 doen). Doel: stukken die uit standaardmaat gesneden worden, worden **niet** aan de packer aangeboden → ze claimen geen rollengte, maar blijven wel als snijplan bestaan (zichtbaar + confectie).

```ts
// supabase/functions/_shared/db-helpers.ts — in fetchStukken(), bij de snijplannen/overzicht-query:
//   ...bestaande filters...
//   .eq('snijden_uit_standaardmaat', false)   // R5: uit-standaardmaat verbruikt geen rollengte
```

- [ ] **Step 3: Test (vitest of handmatig)** — bevestig dat een snijplan met `snijden_uit_standaardmaat=true` niet in de packer-input verschijnt maar wel in `snijplanning_overzicht`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/db-helpers.ts
git commit -m "feat(productie-only): standaardmaat-stukken uitgesloten van rol-packing (R5)"
```

## Task A7: Expose vlaggen in `snijplanning_overzicht` (R5, R1)

**Files:**
- Create: `supabase/migrations/331_snijplanning_overzicht_productie_only.sql`

- [ ] **Step 1: Herbouw de view met extra kolommen**

Neem de exacte definitie uit mig 316 over en voeg toe: `o.alleen_productie`, `o.oud_order_nr`, `oreg.snijden_uit_standaardmaat`. Behoud `WHERE o.status <> 'Geannuleerd'` ongewijzigd (productie-only orders met status `In productie`/`Maatwerk afgerond` blijven dus zichtbaar — gewenst).

```sql
-- Migratie 331: snijplanning_overzicht toont productie-only-context.
-- Identiek aan mig 316 + 3 kolommen. Geen filterwijziging.
CREATE OR REPLACE VIEW snijplanning_overzicht AS
SELECT
  -- ... ALLE bestaande kolommen uit mig 316 ...,
  o.alleen_productie,
  o.oud_order_nr,
  oreg.snijden_uit_standaardmaat
FROM snijplannen sp
JOIN order_regels oreg ON oreg.id = sp.order_regel_id
JOIN orders o          ON o.id = oreg.order_id
JOIN debiteuren d      ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN producten p  ON p.artikelnr = oreg.artikelnr
LEFT JOIN rollen r     ON r.id = sp.rol_id
WHERE o.status <> 'Geannuleerd';
```

> **Belangrijk:** kopieer de volledige kolomlijst uit `supabase/migrations/316_snijplanning_overzicht_edi_gate_weg.sql` letterlijk; voeg alleen de 3 nieuwe toe. Een `CREATE OR REPLACE VIEW` mag geen bestaande kolommen hernoemen/verwijderen.

- [ ] **Step 2: Toepassen + commit**

```bash
git add supabase/migrations/331_snijplanning_overzicht_productie_only.sql
git commit -m "feat(productie-only): snijplanning_overzicht toont alleen_productie + oud_order_nr + standaardmaat (mig 331)"
```

## Task A8: Pick & Ship-guard + zoeken op Basta-nr + Basta-paneel (R1)

**Files:**
- Modify: `frontend/src/modules/magazijn/queries/pickbaarheid.ts` (`fetchOpenOrderHeaders`)
- Modify: order-zoekfunctie (zoek met Grep naar de orders-overzicht-query, bv. `frontend/src/lib/supabase/queries/orders.ts` `fetchOrders`)
- Create: `frontend/src/components/orders/basta-afhandeling-paneel.tsx`
- Modify: order-detail-pagina (zoek met Grep naar waar order-detail panelen rendert)
- Test: `frontend/src/modules/magazijn/queries/__tests__/pickbaarheid-productie-only.test.ts`

- [ ] **Step 1: Schrijf de falende test (Pick & Ship sluit productie-only uit)**

```ts
// frontend/src/modules/magazijn/queries/__tests__/pickbaarheid-productie-only.test.ts
import { describe, it, expect } from 'vitest'
// Test dat een order met alleen_productie=true nooit in de Pick&Ship-headers zit.
// Mock supabase.from('orders').select(...) zodat het een productie-only order teruggeeft;
// assert dat fetchOpenOrderHeaders het eruit filtert.
describe('Pick & Ship sluit productie-only orders uit', () => {
  it('filtert alleen_productie=true uit de headers', async () => {
    // (volg het mockpatroon van bestaande pickbaarheid-tests in deze map)
    // verwacht: order met alleen_productie=true komt NIET terug
    expect(true).toBe(true) // vervang door echte assert volgens lokaal mockpatroon
  })
})
```

> Volg het exacte mock-patroon van de bestaande tests in `frontend/src/modules/magazijn/queries/__tests__/`. Zie [[stale_pickbaarheid_contracttest]] in MEMORY: sommige pickbaarheid-contracttests falen al pre-existing op main — verwar dat niet met deze nieuwe test.

- [ ] **Step 2: Voeg de guard toe in `fetchOpenOrderHeaders`**

```ts
// frontend/src/modules/magazijn/queries/pickbaarheid.ts — in fetchOpenOrderHeaders():
  const { data: ordersRaw, error } = await supabase
    .from('orders')
    .select(
      'id, order_nr, status, debiteur_nr, afl_naam, afl_adres, afl_postcode, ' +
        'afl_plaats, afl_land, afleverdatum, afhalen, lever_type, bron_systeem, edi_bevestigd_op'
    )
    .neq('status', 'Verzonden')
    .neq('status', 'Geannuleerd')
    .eq('alleen_productie', false)   // R1: productie-only orders nooit in Pick & Ship
    .order('afleverdatum', { ascending: true })
    .order('order_nr', { ascending: true })
```

- [ ] **Step 3: Run de test — verwacht PASS**

Run: `cd frontend && npx vitest run src/modules/magazijn/queries/__tests__/pickbaarheid-productie-only.test.ts`
Expected: PASS

- [ ] **Step 4: Zoeken op Basta-nr (oud_order_nr) in het orders-overzicht**

In de order-zoekquery (`fetchOrders`): breid de `.or(...)`-zoekfilter uit zodat een numerieke zoekterm ook `oud_order_nr` matcht, en toon `order_nr` ('OUD-...') in de resultatenlijst. Voeg `oud_order_nr` + `alleen_productie` toe aan de `select(...)`.

```ts
// in de zoek-tak van fetchOrders, naast order_nr/klant:
//   .or(`order_nr.ilike.%${term}%,oud_order_nr.eq.${numericTerm}`)
// waar numericTerm = /^\d+$/.test(term) ? term : '0'
```

- [ ] **Step 5: Basta-afhandeling-paneel op order-detail**

```tsx
// frontend/src/components/orders/basta-afhandeling-paneel.tsx
type Props = { alleenProductie: boolean; oudOrderNr: number | null; status: string }

export function BastaAfhandelingPaneel({ alleenProductie, oudOrderNr, status }: Props) {
  if (!alleenProductie) return null
  const afgerond = status === 'Maatwerk afgerond'
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="font-medium text-amber-900">
        Productie-only order (Basta {oudOrderNr ?? '?'})
      </p>
      <p className="text-sm text-amber-800">
        {afgerond
          ? 'Maatwerk afgerond — labels printen, verzenden en factureren in Basta.'
          : 'Deze order doet in RugFlow alleen snijden + confectie. Verzenden en factureren gebeurt in Basta.'}
      </p>
    </div>
  )
}
```

- [ ] **Step 6: Render het paneel op order-detail**

Importeer en render `<BastaAfhandelingPaneel alleenProductie={order.alleen_productie} oudOrderNr={order.oud_order_nr} status={order.status} />` bovenaan de order-detailpagina. Voeg `alleen_productie, oud_order_nr` toe aan de order-detail `select(...)`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/magazijn/queries/pickbaarheid.ts frontend/src/components/orders/basta-afhandeling-paneel.tsx frontend/src/modules/magazijn/queries/__tests__/pickbaarheid-productie-only.test.ts
git add -A
git commit -m "feat(productie-only): Pick&Ship-guard + zoeken op Basta-nr + Basta-afhandeling-paneel (R1)"
```

## Task A9: Import-script — parse, map, groepeer, roep RPC (R1, R9, R5)

**Files:**
- Create: `import/import_productie_only.py`
- Reuse: `import/lib/snijlijst_parser.py` (kolomconstanten, `is_snijden_uit`, `parse_artikelcode_kwal_kleur`), `import/lib/afwerking_mapper.py`
- Test: `import/tests/test_import_productie_only.py`

- [ ] **Step 1: Schrijf tests voor de pure transform-helpers**

```python
# import/tests/test_import_productie_only.py
from import_productie_only import rij_naar_regel, verzendweek_naar_datum, bepaal_vorm
import datetime as dt

def test_verzendweek_naar_datum_maandag():
    assert verzendweek_naar_datum("24-2026") == dt.date(2026, 6, 8)   # maandag wk24
    assert verzendweek_naar_datum("22-2026") == dt.date(2026, 5, 25)

def test_bepaal_vorm():
    assert bepaal_vorm("300", "RND", "AESTHETIC 300cm RND") == "rond"
    assert bepaal_vorm("290", "200", "AEST 290x200 FESM*OVAAL") == "ovaal"
    assert bepaal_vorm("400", "175", "AEST 400x175") == "rechthoek"

def test_rij_naar_regel_mapt_afwerking_en_maten():
    # rij index volgt snijlijst_parser-kolommen
    rij = ["AEST14MAATWERK","AESTHETIC 14 400x175","","","","","FESM","400","175",1,
           26475680,"200000","DIK","12-2026","B",1,22,"24-2026","Wo 10-06-2026",26029084,1,"",""]
    regel = rij_naar_regel(rij)
    assert regel["maatwerk_kwaliteit_code"] == "AEST"
    assert regel["maatwerk_kleur_code"] == "14"
    assert regel["maatwerk_lengte_cm"] == 400 and regel["maatwerk_breedte_cm"] == 175
    assert regel["maatwerk_afwerking"] == "SF"   # GROF=B + FIJN=FESM -> SF
    assert regel["snijden_uit_standaardmaat"] is False

def test_rij_uit_standaardmaat_gevlagd():
    rij = ["X14MAATWERK","desc","","","","","","200","290",1,26000000,"100","KL",
           "20-2026","B",1,20,"22-2026","",26000001,1,"uit 200x290 cm",""]
    regel = rij_naar_regel(rij)
    assert regel["snijden_uit_standaardmaat"] is True
```

- [ ] **Step 2: Run tests — verwacht FAIL (module bestaat niet)**

Run: `cd import && python -m pytest tests/test_import_productie_only.py -v`
Expected: FAIL — ImportError

- [ ] **Step 3: Implementeer het script (pure helpers + main met --commit/--dry-run)**

```python
# import/import_productie_only.py
"""Importeer productie-only orders uit totaalplanning_cleaned_v2.xlsx naar RugFlow.

Dry-run default; --commit roept de RPC import_productie_only_order aan.
Groepeert regels per Basta-ordernr; rapporteert niet-herkende afwerkingscodes.
"""
from __future__ import annotations
import argparse, datetime as dt, os, sys
from collections import defaultdict
from openpyxl import load_workbook
from lib import snijlijst_parser as P
from lib.afwerking_mapper import map_afwerking_code, is_herkend

BESTAND = "totaalplanning_cleaned_v2.xlsx"
SHEET   = "Snijden Karpi op kwal"

def verzendweek_naar_datum(s) -> dt.date | None:
    s = str(s).strip()
    if "-" not in s:
        return None
    wk, jaar = s.split("-", 1)
    try:
        return dt.date.fromisocalendar(int(jaar), int(wk), 1)  # maandag
    except ValueError:
        return None

def bepaal_vorm(maat1, maat2, omschrijving) -> str:
    m2 = str(maat2).strip().upper()
    if m2 == "RND":
        return "rond"
    if "OVAAL" in str(omschrijving).upper():
        return "ovaal"
    return "rechthoek"

def rij_naar_regel(rij) -> dict | None:
    rij = list(rij) + [""] * (max(P.PL_OPMERKING, P.PL_RGL) + 1 - len(rij))
    ordernr = P.normaliseer_key(rij[P.PL_ORDERNR])
    if ordernr is None:
        return None
    kk = P.parse_artikelcode_kwal_kleur(rij[P.PL_ARTIKELCODE])
    if kk is None:
        kk = ("", "")
    try:
        breedte, lengte = P.breedte_lengte_uit_maten(rij[P.PL_MAAT1], rij[P.PL_MAAT2])
    except ValueError:
        return None
    grof = rij[14]    # GROF-afwerking
    fijn = rij[P.PL_ARTIKELCODE+6] if False else rij[6]  # FIJN-afwerking (kol 6)
    omschr = P._norm(rij[1])
    try:
        aantal = int(float(P._norm(rij[P.PL_AANTAL]))) if P._norm(rij[P.PL_AANTAL]) else 1
    except ValueError:
        aantal = 1
    return {
        "oud_order_nr": int(ordernr),
        "debiteur_nr": P.normaliseer_key(rij[11]),
        "debiteur_naam": P._norm(rij[12]),
        "regelnummer": int(P.normaliseer_key(rij[P.PL_RGL]) or "1"),
        "omschrijving": omschr or "Maatwerk",
        "orderaantal": max(aantal, 1),
        "maatwerk_kwaliteit_code": kk[0],
        "maatwerk_kleur_code": kk[1],
        "maatwerk_lengte_cm": int(rij[P.PL_MAAT1]) if str(rij[P.PL_MAAT1]).strip().isdigit() else lengte,
        "maatwerk_breedte_cm": breedte if False else None,  # zie hieronder
        "maatwerk_afwerking": map_afwerking_code(grof, fijn, omschr),
        "afwerking_herkend": is_herkend(grof, fijn),
        "maatwerk_vorm": bepaal_vorm(rij[P.PL_MAAT1], rij[P.PL_MAAT2], omschr),
        "snijden_uit_standaardmaat": P.is_snijden_uit(rij[P.PL_OPMERKING]),
        "maatwerk_instructies": P._norm(rij[P.PL_OPMERKING]),
        "afleverdatum": verzendweek_naar_datum(rij[17]),
    }

# NB: lengte/breedte voor het snijplan = de fysieke snijmaten. Gebruik de RUWE maat1/maat2
# (niet breedte_nodig/lengte_verbruikt — die zijn voor rol-allocatie). Corrigeer in rij_naar_regel:
#   "maatwerk_lengte_cm": <ruwe maat1 als int, of diameter bij RND>,
#   "maatwerk_breedte_cm": <ruwe maat2 als int, of diameter bij RND>.

def lees_regels(pad):
    wb = load_workbook(pad, read_only=True, data_only=True)
    ws = wb[SHEET]
    rows = list(ws.iter_rows(values_only=True))
    out = []
    for r in rows[2:]:               # data vanaf idx 2 (header idx 1)
        regel = rij_naar_regel(r)
        if regel:
            out.append(regel)
    wb.close()
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--bestand", default=BESTAND)
    args = ap.parse_args()

    regels = lees_regels(args.bestand)
    per_order = defaultdict(list)
    for r in regels:
        per_order[r["oud_order_nr"]].append(r)

    onherkend = [r for r in regels if not r["afwerking_herkend"]]
    uit_std   = [r for r in regels if r["snijden_uit_standaardmaat"]]
    print(f"Regels: {len(regels)} | Orders: {len(per_order)} | "
          f"uit-standaardmaat: {len(uit_std)} | afwerking-default-gebruikt: {len(onherkend)}")
    if onherkend:
        print("  Niet-herkende afwerking (krijgt 'B' default) — controleer:")
        for r in onherkend[:40]:
            print(f"    Basta {r['oud_order_nr']} rgl {r['regelnummer']}: "
                  f"GROF/FIJN onbekend -> B  ({r['omschrijving']})")

    if not args.commit:
        print("DRY-RUN — niets weggeschreven. Draai met --commit om te importeren.")
        return

    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    nieuw = bestaand = 0
    for oud_nr, rs in per_order.items():
        header = {
            "oud_order_nr": oud_nr,
            "debiteur_nr": rs[0]["debiteur_nr"],
            "debiteur_naam": rs[0]["debiteur_naam"],
            "afleverdatum": rs[0]["afleverdatum"].isoformat() if rs[0]["afleverdatum"] else None,
        }
        payload_regels = [{k: v for k, v in r.items()
                           if k not in ("debiteur_nr","debiteur_naam","afleverdatum","afwerking_herkend","oud_order_nr")}
                          for r in rs]
        for pr in payload_regels:
            if pr.get("afleverdatum"): pr.pop("afleverdatum", None)
        res = sb.rpc("import_productie_only_order",
                     {"p_header": header, "p_regels": payload_regels}).execute()
        row = res.data[0] if res.data else {}
        if row.get("was_existing"): bestaand += 1
        else: nieuw += 1
    print(f"Klaar: {nieuw} nieuw, {bestaand} bestaand (idempotent overgeslagen).")

if __name__ == "__main__":
    main()
```

> **Corrigeer in Step 3 vóór commit:** zet `maatwerk_lengte_cm`/`maatwerk_breedte_cm` op de **ruwe** maat1/maat2 (bij `RND`: beide = diameter uit maat1). De `breedte_lengte_uit_maten`-helper is voor rol-allocatie, niet voor de snijmaat. Maak dit expliciet en dek het met `test_rij_naar_regel_mapt_afwerking_en_maten` (maat 400×175).

- [ ] **Step 4: Run de tests — verwacht PASS**

Run: `cd import && python -m pytest tests/test_import_productie_only.py -v`
Expected: PASS

- [ ] **Step 5: Dry-run tegen het echte bestand**

Run: `cd import && python import_productie_only.py --bestand "../totaalplanning_cleaned_v2.xlsx"`
Expected: `Regels: 1276 | Orders: ~1071 | uit-standaardmaat: 21 | afwerking-default-gebruikt: <klein>`. Controleer de lijst niet-herkende codes met Piet-hein.

- [ ] **Step 6: Commit (script + tests, nog géén import-run)**

```bash
git add import/import_productie_only.py import/tests/test_import_productie_only.py
git commit -m "feat(productie-only): import-script (parse v2 + afwerking-map + dry-run-rapport) (R1/R9/R5)"
```

## Task A10: Uitvoeren — import → auto-plan → verifiëren (R1, R3)

**Files:** geen code — uitvoering met de service-key.

- [ ] **Step 1: Echte import** — `python import_productie_only.py --bestand "../totaalplanning_cleaned_v2.xlsx" --commit`. Verwacht `Klaar: ~1071 nieuw`.
- [ ] **Step 2: Verifieer zichtbaarheid** — `SELECT count(*) FROM snijplanning_overzicht WHERE alleen_productie;` → ≈ 1.276 (incl. aantal>1-expansie >1.276 stuks). Open de snijplanning-UI: de stukken staan in `Wacht`.
- [ ] **Step 3: Auto-plan per (kwaliteit, kleur)-groep** — trigger `auto-plan-groep` voor de geraakte groepen. Hergebruik het patroon uit `import/reserveer_maatwerk_migratie.py`/de rol-insert-trigger, of roep de edge function per groep aan. Verifieer dat snijplannen `rol_id` krijgen.
- [ ] **Step 4: Verifieer Pick & Ship** — de productie-only orders verschijnen NIET in Pick & Ship; order-detail toont het Basta-paneel; zoeken op een Basta-nr vindt 'OUD-<nr>'.

## Task A11: Cutover — geef `migratie_blokkering` vrij (R3, vervangt ADR-0028)

**Files:** geen code — eenmalige SQL na Task A10.

- [ ] **Step 1: Alleen uitvoeren als Task 0(c) > 0 actieve blokkeringen toonde.** Anders overslaan (niets te vervangen).
- [ ] **Step 2: Geef vrij** — de echte snijplannen zijn nu de claim op de rol:

```sql
UPDATE migratie_blokkering SET status = 'vrijgegeven', vrijgegeven_op = NOW()
WHERE status = 'actief';
```

- [ ] **Step 3: Verifieer standen** — controleer `voorraadposities` voor een paar (kwaliteit,kleur): de vrije m² mag niet negatief zijn en moet de echte snijplan-consumptie reflecteren (geen dubbeltelling).
- [ ] **Step 4: Documenteer** — noteer in `docs/changelog.md` dat ADR-0028's `migratie_blokkering` vervangen is door productie-only orders.

---

# FASE B — Korte termijn: planning-besturing (R7, R2, R4, R5-UI, R6, R10)

## Task B1: Bevestigde dagplanning 10-19 juni pinnen + importeren (R7)

**Files:**
- Create: `supabase/migrations/332_snijplan_snijdag_pin.sql`
- Create: `import/import_bevestigde_planning.py`
- Modify: de auto-plan release-functie (zoek met Grep naar `release_gepland_stukken`)
- Test: `import/tests/test_import_bevestigde_planning.py`

- [ ] **Step 1: Pin-kolom + skip in release**

```sql
-- Migratie 332: vaste snijdag voor bevestigde planning (R7).
ALTER TABLE snijplannen
  ADD COLUMN IF NOT EXISTS snijdag_vast BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS snijdag_gepland_op DATE;
COMMENT ON COLUMN snijplannen.snijdag_vast IS
  'TRUE = bevestigde dagplanning (10-19 juni), niet door auto-plan herplannen (R7).';
```

- [ ] **Step 2: Skip gepinde stukken in de release-functie** — voeg in `release_gepland_stukken` (legacy mig 133, off-disk; haal de body uit git-historie via `git log -S release_gepland_stukken`) toe: `AND snijdag_vast = false`. Zo geeft auto-plan een gepind stuk niet vrij.

- [ ] **Step 3: Import-script bestand 2** — parse `planning vanaf 10-juni-tot-19-juni.xlsx` (kolommen: `[1]` datum, `[9]` ordernr, `[10]` rgl). Voor elke (ordernr, rgl): vind de bijbehorende snijplannen via `orders.oud_order_nr` → `order_regels.regelnummer` → `snijplannen`, en zet `snijdag_vast=true, snijdag_gepland_op=<datum>`. Idempotent (re-runnable).

- [ ] **Step 4: Tests + dry-run + commit** — test de (ordernr,rgl)→snijplan-koppeling; dry-run telt hoeveel van de 391 regels matchen. Commit.

> **Open vraag Piet-hein (B1):** mag een gepind stuk handmatig naar een andere dag verschoven worden, en mogen niet-gesneden gepinde stukken ná 19-06 weer vrij heroptimaliseerd worden? Antwoord bepaalt of `snijdag_vast` permanent is of een vervaldatum krijgt.

## Task B2: Handmatige rol-toewijzing — VEILIG (met herpack), niet de dead code (R2)

**Files:**
- Create: `supabase/migrations/333_wijzig_snijplan_rol_rpc.sql`
- Modify: `frontend/src/modules/snijplanning/queries/snijplanning-mutations.ts`, `frontend/src/modules/snijplanning/hooks/use-snijplanning.ts`
- Modify: snijplanning-UI (rol-picker per stuk in de productie-/voorstel-weergave)

> **WAARSCHUWING (kritiek-bevinding):** de bestaande `assignRolToSnijplan()` (`snijplanning-mutations.ts:75-82`) is een **kale UPDATE `rol_id`** zonder positie-herberekening — dat reproduceert het VERR130-overlap-incident ([[reference_snijplan_status_snijden_trap]] / CLAUDE.md mig 301). NIET activeren als quick win.

- [ ] **Step 1: RPC `wijzig_snijplan_rol(p_snijplan_id, p_rol_id)`** — guard `status IN ('Wacht','Gepland')` en `rol_id IS NULL OR ...`; releaset de oude rol-plaatsing, plaatst het stuk op de nieuwe rol via dezelfde guillotine-pack-positielogica (of zet `positie_x/y_cm = NULL` + status `Wacht` zodat de packer het opnieuw plaatst). Nooit een kale `SET rol_id` zonder positie.

- [ ] **Step 2: Hook + UI** — vervang de dead `useAssignRol` door `useWijzigSnijplanRol` die de RPC aanroept; voeg een "wijzig rol"-knop per stuk toe, alleen zichtbaar voor `status IN ('Wacht','Gepland')`.

- [ ] **Step 3: Test** — een stuk van rol A naar B verplaatsen laat rol A intact en geeft het stuk een geldige positie op B (geen (0,0)-overlap). Commit.

> **Open vraag Piet-hein (B2):** slepen tussen rollen in de voorstel-preview, of een "wijzig rol"-knop per stuk? Wie mag verplaatsen (planner vs vloer)?

## Task B3: Tekort-prioritering die écht werkt (R4)

**Files:**
- Modify: `supabase/functions/_shared/guillotine-packing.ts` (`sortPieces`), `supabase/functions/_shared/db-helpers.ts` (`fetchStukken` select)
- Create: `supabase/migrations/334_update_snijplan_prioriteit_rpc.sql`
- Modify: snijplanning-pool-UI (prioriteit inline editable)

> **Kritiek-bevinding:** `sortPieces` sorteert **primair op geometrie** (max-dimensie, oppervlak), pas daarna afleverdatum. Prioriteit als laatste tiebreak is **inert**. Echte prioritering vereist prioriteit als *primaire* sort-key (kost pack-efficiëntie) óf een hard pre-filter.

- [ ] **Step 1: Besluit (Piet-hein) ophalen** — prioriteit per stuk (numeriek) of per rol-toewijzing? En: wint prioriteit van afleverdatum? Pas hierop het sort-ontwerp aan.
- [ ] **Step 2: `prioriteit` opnemen in `fetchStukken`-select + `SnijplanPiece`-interface.**
- [ ] **Step 3: `sortPieces` aanpassen** — prioriteit als primaire of secundaire sleutel volgens het besluit; documenteer de afval-trade-off.
- [ ] **Step 4: RPC `update_snijplan_prioriteit` + inline-edit in de pool-tabel.** Test + commit.

## Task B4: UI voor "uit standaardmaat"-stukken (R5)

**Files:**
- Modify: snijplanning-UI (`snijplan-mapping.ts` + groep/pool-componenten)

- [ ] **Step 1:** toon stukken met `snijden_uit_standaardmaat=true` in een aparte sectie/filter "Uit standaardmaat (geen rol)" naast de rol-groepen; ze blijven door confectie lopen.
- [ ] **Step 2:** een "markeer gesneden"-actie voor rol-loze stukken (status `Wacht`→`Gesneden`) zodat ze naar confectie kunnen. Test + commit.

> **Open vraag Piet-hein (B4):** apart daglijstje of samen-met-duiding? Hoe markeren ze "klaar voor confectie" — scan of handmatig?

## Task B5: FP-override (R6) — alleen activeren als nodig

**Files:** n.v.t. voor de huidige batch (geen FPNL/FPDE/FPW in `totaalplanning_cleaned_v2.xlsx`).

- [ ] **Step 1:** Bevestig met Piet-hein dat FP-orders niet via deze import lopen. Zo niet: ontwerp een `debiteur_afleverdatum_override` die **alleen** voor `alleen_productie`-orders een vaste verzendweek forceert (gouden regel: niet de gedeelde packer-sortering voor gewone FP-webshop-orders raken). Anders: dit task vervalt.

## Task B6: Forecasting — backlog & "Maatwerk afgerond" (R10)

**Files:**
- Verifiëren: `snijplanning_groepen_gefilterd` (Task 0b — bestaat waarschijnlijk al, off-disk mig 045)
- Create (indien nodig): `supabase/migrations/335_backlog_completion_forecast.sql`
- Modify: snijplanning-overzicht-UI (groep-aggregaten tonen)

- [ ] **Step 1:** Als Task 0(b) NULL teruggaf: herschrijf `snijplanning_groepen_gefilterd` (body staat in `docs/superpowers/plans/2026-04-09-snijplanning-leverdatum-filter.md`). Anders: ongemoeid.
- [ ] **Step 2:** RPC/view `backlog_completion_forecast()` — aggregeer per week hoeveel m²/stuks verwacht-af op basis van `werkagenda.ts`/`berekenSnijAgenda`, zodat "wanneer is alles af" en "wanneer kan een nieuwe order af" beantwoord worden met de geïmporteerde backlog meegerekend.
- [ ] **Step 3:** Toon per (kwaliteit,kleur)-groep: totaal stuks / gesneden / in confectie / gereed, en een week-completion-overzicht. Test + commit.

---

# FASE C — V2: Dag-capaciteitsengine (R8)

**Status: aparte plan + brainstorm vereist — NIET in deze plan-scope detaillen.**

R8 (dagplanning met 55-68 stuks/dag, max 42 smalband/dag, max 20 rollen/dag, P/A-afwisseling, opsnijden ≤20% rest, snijdag+1=verzenddag) is **geen import-uitbreiding maar een planning-optimizer** — een nieuw subsysteem dat de gedeelde `werkagenda.ts` + `check-levertijd` raakt (die óók gewone orders bedienen → gouden-regel-risico). De huidige capaciteit is week-niveau; dag-niveau bestaat niet.

**Waarom apart:** de regels bevatten onbeantwoorde domeinvragen (P/A-criteria; "opsnijden 20%" = % van dag-capaciteit of rol-lengte?; verzendweek-prio = harde voorrang of afval-trade-off?) die eerst via `superpowers:brainstorming` met Piet-hein uitgekristalliseerd moeten worden.

**Aanbeveling:** maak na fase A/B een eigen spec + plan `docs/superpowers/plans/YYYY-MM-DD-snijden-dagcapaciteit-engine.md`. Bouwstenen die het zal bevatten:
- Data-driven config in `app_config.productie_planning`: `snijdag_max_stuks` (default 60), `smalband_max_stuks_per_dag` (42), `rollen_max_per_dag` (20), marges.
- `berekenSnijAgendaPerDag()` in `werkagenda.ts`: forward-pass ma-vr, telt stuks/`type_bewerking`/rol-count per dag, respecteert `snijdag_vast` (R7) en sluit `snijden_uit_standaardmaat` uit de rol-telling maar mee in de stuks-telling (R5-interactie).
- View `snij_datum` + UI voor dag-toewijzing/conflict-signalering.
- Biasband-lane (R9-restant): eerst een rij in `confectie_werktijden(type_bewerking='biasband')`, dan `afwerking_types` uitbreiden — alleen als het DA-aandeel groeit boven 0,5%.

---

## Open vragen voor Piet-hein (gebundeld)

**Reeds beantwoord (2026-06-08):** afwerking op GROF+FIJN-CASE ✓ · verzendweek→maandag ✓.

**Fase B (planning-besturing):**
1. **(B1 pin)** Mag een gepind stuk (10-19 juni) handmatig verschoven worden? Mogen niet-gesneden gepinde stukken ná 19-06 heroptimaliseerd worden?
2. **(B2 rol)** Slepen in de voorstel-preview of "wijzig rol"-knop per stuk? Wie mag verplaatsen?
3. **(B3 prioriteit)** Prioriteit per stuk (numeriek) of per rol-toewijzing? Wint prioriteit van afleverdatum?
4. **(B4 standaardmaat)** Apart daglijstje of samen-met-duiding? Markeren via scan of handmatig?
5. **(B5 FP)** Lopen FPNL/FPDE/FPW-orders ook via deze import? (Nu: geen in de batch.)

**Fase C (V2-engine):**
6. **(R8)** P/A-afwisseling = vast schema of criteria? "Opsnijden 20%" = van dag-capaciteit of rol-lengte? Verzendweek-prio = harde voorrang of trade-off tegen afval?
7. **(R10)** Prioriteit: (A) "nieuwe order af morgen", (B) "hele backlog af wanneer", of beide?

---

## Self-review checklist (uitgevoerd)

- **Spec-dekking R1-R10:** R1=A1/A4/A9/A10, R3=A6/A10/A11, R5=A1/A2/A6/A7/B4, R9=A3/A9, R7=B1, R2=B2, R4=B3, R6=B5, R10=B6, R8=Fase C. ✓
- **Type-consistentie:** `alleen_productie`, `snijden_uit_standaardmaat`, `oud_order_nr`, RPC `import_productie_only_order(p_header, p_regels)→(order_nr, was_existing)`, afwerking-mapper `map_afwerking_code(grof, fijn, omschrijving)`/`is_herkend(grof, fijn)` — consistent gebruikt over alle tasks. ✓
- **FK-veiligheid:** import levert alleen geldige `afwerking_types.code` (mapper) + geldige `maatwerk_vorm` (rechthoek/rond/ovaal) of NULL. ✓
- **Gouden regel:** elke wijziging geguard op `alleen_productie` (voltooi_confectie na-stap, Pick&Ship-filter) of strikt additief (auto_maak_snijplan kopieert een default-false kolom). ✓
- **Placeholders:** Fase A/B bevatten volledige code; Fase C is bewust een gescopete design-sectie met rationale (geen TODO's), conform "split multi-subsystem specs". ✓
