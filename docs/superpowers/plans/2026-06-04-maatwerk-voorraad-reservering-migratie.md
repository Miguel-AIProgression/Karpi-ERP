# Maatwerk-voorraad reservering-migratie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De nog-niet-gesneden op-maat orders uit het oude systeem als FIFO-lengteblokkering op de fysieke rollen vastleggen, zodat de maatwerkvoorraad die we naar het nieuwe systeem doorzetten klopt (geen dubbelverkoop van rollengte).

**Architecture:** Een eenmalig Python-migratiescript leest de rollenvoorraad (uit de DB) + de actieve op-maat planning (Excel) + de gesneden-historie (alle snijlijst-versies, union), filtert wat al gesneden is of "uit standaard karpet" wordt gesneden, en alloceert elk resterend stuk via de bedrijfs-snijmethodiek (breedte = max(A,B) moet op de rolbreedte passen, lengte verbruikt = min(A,B), FIFO op `in_magazijn_sinds`) als een **full-width lengtestrip** op een rol. Die strips worden weggeschreven in een nieuwe tabel `migratie_blokkering`. De packer in het nieuwe systeem ziet de strips als één virtuele bezette plaatsing onderaan de rol (via `fetchBezettePlaatsingen`) en plant er niet overheen; de voorraad-m² wordt navenant verlaagd (`voorraadposities`-RPC). Een dagelijks release-script zet blokkeringen op `vrijgegeven` zodra de bijbehorende order in een nieuwere snijlijst-versie als gesneden verschijnt.

**Tech Stack:** Python 3 (pandas niet nodig, wél `openpyxl` + `supabase-py`), pytest (nieuw voor `import/`), PostgreSQL-migraties (Supabase), TypeScript/Deno edge-functie (`auto-plan-groep` via `_shared/db-helpers.ts`).

---

## Achtergrond & datavalidatie (al uitgevoerd — niet opnieuw doen, alleen ter referentie)

Cijfers uit de aangeleverde bestanden (peildatum 2026-06-04):

| Metric | Waarde |
|---|---|
| Rollen in `Rollenvoorraad per 04062026.xlsx` | 1420 (lengte/breedte in **meters**, ×100 = cm; 777 rollen zijn 400cm breed) |
| Tabblad `Snijden Karpi op kwal` — totaal planning-regels mét ordernr | 1531 |
| → skip "uit NxN" (gesneden uit standaard karpet, opmerking-kolom) | 22 |
| → reeds gesneden (match op snijlijst-union) | 47 |
| → **ACTIEF te reserveren** | **1462** |
| Planning-regels zonder ordernr (tussen-/lege regels) | 37 (overslaan) |
| RND-stukken onder actief | 303 |
| Kwal+kleur-parse-fails (o.a. `KUNSTGRAS`, leeg) | 5 (→ ongedekt loggen) |
| Unieke gesneden `(ordernr, rgl)` in union (9 versies, ~477 sheets) | 11949 |

**Vier afwijkingen t.o.v. de oorspronkelijke probleemanalyse — verwerk deze, de spec was vereenvoudigd:**

1. **Snijlijst-versies verschillen NIET in de dag-sheets.** De sheets `01-06`/`02-06`/`03-06` zijn byte-identiek in alle 9 versiebestanden. De gesneden-historie zit in de **week-sheets**, met **wisselende kolom-layouts** (Gesneden-kolom op index 1, 2 of 3; Ordernr op index 12–17; Rgl op index 13–22). Hard-coded index 1/14/15 mist het overgrote deel. → **Detecteer de kolommen per sheet via de header-rij** (zoek de rij die "gesneden" bevat; vind daarin de "ordernr"/"verk.ordernr"-kolom en de "rgl"/"ordrgl"-kolom).
2. **De "snijden uit"-opmerking heet anders.** De echte tekst is bv. `uit 240x340 vrij wk 23` (patroon `uit\s*\d+\s*x\s*\d+`), niet "snijden uit". Staat in opmerking-kolom index 22 van `Snijden Karpi op kwal`.
3. **67 planning-regels hebben `Aantal` (index 9) > 1.** Reserveer `aantal×` losse stukken (elk een eigen strip, eigen `deel_index`).
4. **Reserveer-model = FIFO-lengtestrip, full-width** (door gebruiker bevestigd). Geen 2D-nesting: elk stuk neemt de volle rolbreedte × `min(A,B)` cm lengte. Ongedekte regels → loggen + overslaan, niet hard falen.

**Kolomindexen `Snijden Karpi op kwal` (0-based, data vanaf rij-index 2):**
| Index | Inhoud |
|---|---|
| 4 | Kwal+kleur-code (`AEST13` → kwal=`AEST`, kleur=`13`) |
| 7 | Maat 1 (cm) |
| 8 | Maat 2 (cm of `RND`) |
| 9 | Aantal |
| 10 | Verkoopordernummer |
| 15 | Orderregel (`Ordrgl`) |
| 22 | Opmerking |

**Snijmethodiek per stuk A×B cm** (A = maat1 index7, B = maat2 index8):
- `breedte_nodig = max(A, B)` — moet ≤ `rol.breedte_cm`.
- `lengte_verbruikt = min(A, B)` — zoveel cm wordt over de volle rolbreedte van de rol afgenomen.
- **RND** (B == `'RND'`): `breedte_nodig = lengte_verbruikt = A` (diameter).
- Match-groep: `(kwaliteit, genormaliseerde kleur)`; FIFO op `rol.in_magazijn_sinds` (oudste eerst, NULL achteraan).

---

## File Structure

**Nieuw:**
- `supabase/migrations/313_migratie_blokkering.sql` — tabel `migratie_blokkering` + index + RLS.
- `supabase/migrations/314_voorraadposities_blokkering.sql` — `CREATE OR REPLACE FUNCTION voorraadposities` met m²-aftrek van actieve blokkeringen.
- `import/lib/__init__.py` — leeg, maakt `lib` importeerbaar.
- `import/lib/snijlijst_parser.py` — pure rij-functies: key-normalisatie, kwal/kleur-parse, snijden-uit-detectie, gesneden-set-bouwer (header-detect), planning-parser. Geen Supabase-afhankelijkheid.
- `import/lib/strip_allocator.py` — pure FIFO-full-width allocator (dataclasses `Piece`/`Roll`/`Blokkering`/`Ongedekt`). Geen Supabase-afhankelijkheid.
- `import/reserveer_maatwerk_migratie.py` — eenmalig: leest DB-rollen + Excel, draait allocator, schrijft rapport-CSV's, `--commit` schrijft `migratie_blokkering`.
- `import/release_migratie_blokkeringen.py` — dagelijks: leest nieuwste snijlijst-versie, zet gesneden blokkeringen op `vrijgegeven`.
- `import/tests/__init__.py`, `import/tests/test_snijlijst_parser.py`, `import/tests/test_strip_allocator.py` — pytest unit-tests.
- `import/pytest.ini` — pytest-config (rootdir + testpaths).
- `docs/adr/0028-maatwerk-voorraad-reservering-migratie.md` — ADR.

**Gewijzigd:**
- `supabase/functions/_shared/db-helpers.ts` — `fetchBezettePlaatsingen` injecteert per geraakte rol één full-width strip-Placement uit `migratie_blokkering` (status `actief`).
- `docs/database-schema.md`, `docs/data-woordenboek.md`, `docs/architectuur.md`, `docs/changelog.md` — documentatie bijwerken.

**Read-only referentie (niet muteren):**
- `Rollenvoorraad per 04062026.xlsx`, `Prod planning wk 23-24-25-26  2026 per 03-06-2026.xlsx`, `Productieplanning Karpi 2026-4.xlsx` … `2026-12.xlsx` — staan in de projectroot na uitpakken van de ZIP.

---

## Task 1: ADR + DB-migratie `migratie_blokkering`

**Files:**
- Create: `docs/adr/0028-maatwerk-voorraad-reservering-migratie.md`
- Create: `supabase/migrations/313_migratie_blokkering.sql`

- [ ] **Step 1: Schrijf de ADR**

Maak `docs/adr/0028-maatwerk-voorraad-reservering-migratie.md`:

```markdown
# ADR-0028: Maatwerk-voorraad reservering bij migratie uit oud systeem

**Status:** Geaccepteerd — 2026-06-04

## Context
De standaardafmetingen-voorraad is 1-op-1 overgenomen uit het oude systeem. Voor
maatwerk geldt een probleem: in het oude systeem worden op-maat orders NIET op de
rol gereserveerd. Zetten we de rollenvoorraad 1-op-1 over, dan missen de nog te
snijden op-maat orders hun beslag op de rollengte → het nieuwe systeem zou die
lengte als vrij beschouwen en kan dubbel verkopen.

## Beslissing
Een eenmalig migratiescript legt elke nog-niet-gesneden op-maat order vast als een
**full-width FIFO-lengtestrip** op een fysieke rol, in een aparte tabel
`migratie_blokkering` (ontkoppeld van `order_reserveringen` — dit zijn oud-systeem
orders zonder new-system order_regel_id). Methodiek spiegelt het snijden:
`breedte_nodig = max(A,B)` moet op `rol.breedte_cm` passen, `lengte_verbruikt =
min(A,B)` wordt over de volle breedte afgenomen, FIFO op `in_magazijn_sinds`. Geen
2D-nesting (bewust conservatief: liever lengte overschatten dan dubbelverkopen).

De packer ziet de blokkering als één virtuele bezette plaatsing onderaan de rol
(`fetchBezettePlaatsingen`) en plant er niet overheen; `voorraadposities` trekt de
geblokkeerde m² af. Een dagelijks release-script zet een blokkering op
`vrijgegeven` zodra de order in een nieuwere snijlijst-versie als gesneden staat.

## Gevolgen
- Geen wijziging aan `fetchBeschikbareRollen`: de lengte-aftrek loopt volledig via
  de strip-Placement in `fetchBezettePlaatsingen`. Óók daar lengte aftrekken zou
  dubbel blokkeren (de packer leidt vrije ruimte af uit breedte×lengte minus
  bezette placements).
- `migratie_blokkering` is tijdelijk: zodra alle oude orders gesneden/vrijgegeven
  zijn, is de tabel leeg en kan ze gearchiveerd worden.
```

- [ ] **Step 2: Schrijf de migratie**

Maak `supabase/migrations/313_migratie_blokkering.sql`:

```sql
-- Migratie 313: migratie_blokkering
-- Eenmalige FIFO-lengteblokkering van oud-systeem maatwerk-orders op fysieke rollen.
-- Zie ADR-0028. Ontkoppeld van order_reserveringen (geen new-system order_regel_id).

CREATE TABLE migratie_blokkering (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rol_id                  BIGINT NOT NULL REFERENCES rollen(id) ON DELETE CASCADE,
  gereserveerde_lengte_cm INTEGER NOT NULL CHECK (gereserveerde_lengte_cm > 0),
  breedte_nodig_cm        INTEGER NOT NULL CHECK (breedte_nodig_cm > 0),
  oud_ordernr             TEXT NOT NULL,
  oud_orderregel          TEXT NOT NULL,
  deel_index              INTEGER NOT NULL DEFAULT 1,  -- 1..aantal voor regels met Aantal>1
  kwaliteit_code          TEXT,
  kleur_code              TEXT,
  status                  TEXT NOT NULL DEFAULT 'actief'
                            CHECK (status IN ('actief', 'vrijgegeven')),
  aangemaakt_op           TIMESTAMPTZ NOT NULL DEFAULT now(),
  vrijgegeven_op          TIMESTAMPTZ,
  -- idempotentie: een (order, regel, deel) wordt nooit dubbel geblokkeerd.
  UNIQUE (oud_ordernr, oud_orderregel, deel_index)
);

-- Hot path: fetchBezettePlaatsingen sommeert actieve blokkering per rol.
CREATE INDEX idx_migratie_blokkering_rol_actief
  ON migratie_blokkering (rol_id)
  WHERE status = 'actief';

-- Release-script zoekt op (ordernr, regel).
CREATE INDEX idx_migratie_blokkering_order
  ON migratie_blokkering (oud_ordernr, oud_orderregel);

COMMENT ON TABLE migratie_blokkering IS
  'Eenmalige FIFO-lengteblokkering van oud-systeem maatwerk-orders op rollen (ADR-0028). Tijdelijk; leeg zodra alle oude orders gesneden zijn.';

ALTER TABLE migratie_blokkering ENABLE ROW LEVEL SECURITY;

-- Lezen mag voor ingelogde gebruikers (edge-functies gebruiken service-role en
-- omzeilen RLS sowieso). Schrijven loopt uitsluitend via het service-role
-- migratiescript → geen INSERT/UPDATE-policy voor 'authenticated'.
CREATE POLICY migratie_blokkering_select
  ON migratie_blokkering FOR SELECT
  TO authenticated
  USING (true);
```

- [ ] **Step 3: Pas de migratie toe**

Karpi-MCP heeft geen toegang tot dit project (zie geheugen `reference_karpi_supabase_mcp`). Pas handmatig toe via de Supabase SQL-editor of CLI met de service-role-credentials uit `import/.env`. Verifieer daarna:

Run (in de SQL-editor):
```sql
SELECT to_regclass('public.migratie_blokkering');
```
Expected: `migratie_blokkering` (niet NULL).

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0028-maatwerk-voorraad-reservering-migratie.md supabase/migrations/313_migratie_blokkering.sql
git commit -m "feat(migratie): migratie_blokkering tabel + ADR-0028 voor maatwerk-reservering"
```

---

## Task 2: Pytest-setup + gedeelde snijlijst-parser

Pure, Supabase-vrije rij-functies. Alle Excel-IO wordt om dunne pure kernen heen gewikkeld zodat ze met literal-rijen testbaar zijn.

**Files:**
- Create: `import/pytest.ini`
- Create: `import/lib/__init__.py` (leeg)
- Create: `import/tests/__init__.py` (leeg)
- Create: `import/lib/snijlijst_parser.py`
- Test: `import/tests/test_snijlijst_parser.py`

- [ ] **Step 1: Maak pytest-config**

Maak `import/pytest.ini`:

```ini
[pytest]
testpaths = tests
python_files = test_*.py
```

- [ ] **Step 2: Maak lege package-bestanden**

Maak `import/lib/__init__.py` (leeg, 0 bytes) en `import/tests/__init__.py` (leeg, 0 bytes).

- [ ] **Step 3: Schrijf de failing tests**

Maak `import/tests/test_snijlijst_parser.py`:

```python
from lib.snijlijst_parser import (
    normaliseer_key,
    parse_kwal_kleur,
    is_snijden_uit,
    extract_gesneden_uit_rows,
    parse_planning_rij,
    breedte_lengte_uit_maten,
)


def test_normaliseer_key_strip_float_artefact():
    assert normaliseer_key("26536240.0") == "26536240"
    assert normaliseer_key(26536240) == "26536240"
    assert normaliseer_key(6.0) == "6"
    assert normaliseer_key("  26536240 ") == "26536240"


def test_normaliseer_key_leeg_is_none():
    assert normaliseer_key(None) is None
    assert normaliseer_key("") is None
    assert normaliseer_key("   ") is None


def test_normaliseer_key_niet_numeriek_blijft_string():
    assert normaliseer_key("FPNL130883") == "FPNL130883"


def test_parse_kwal_kleur_splitst_letters_en_cijfers():
    assert parse_kwal_kleur("AEST13") == ("AEST", "13")
    assert parse_kwal_kleur("MWDI99") == ("MWDI", "99")


def test_parse_kwal_kleur_faalt_op_niet_matchend():
    assert parse_kwal_kleur("KUNSTGRAS") is None
    assert parse_kwal_kleur("") is None
    assert parse_kwal_kleur(None) is None


def test_is_snijden_uit_herkent_uit_patroon():
    assert is_snijden_uit("uit 240x340 vrij wk 23") is True
    assert is_snijden_uit("UIT 200 x 290") is True
    assert is_snijden_uit("3 rl ma wk 24 Aalten 2026009") is False
    assert is_snijden_uit("") is False
    assert is_snijden_uit(None) is False


def test_breedte_lengte_recht_stuk():
    # A=290 (maat1), B=200 (maat2) -> breedte=max=290, lengte=min=200
    assert breedte_lengte_uit_maten("290", "200") == (290, 200)
    assert breedte_lengte_uit_maten("200", "290") == (290, 200)


def test_breedte_lengte_rond_stuk():
    # RND: diameter in maat1, beide = diameter
    assert breedte_lengte_uit_maten("300", "RND") == (300, 300)
    assert breedte_lengte_uit_maten("240", "rnd") == (240, 240)


def test_extract_gesneden_dag_layout():
    # Dag-sheet: header rij-index 1, Gesneden=1, Ordernr=14, Rgl=15.
    rows = [
        ["", "", "", "", "", "", "", "TITEL", "", "", "", "", "", "", "", "", "", ""],
        ["Niet snijden", "Gesneden", "Ingepakt", "Bin", "M", "", "", "#",
         "Basis", "Oms", "Stuks", "Afw", "Groep", "Deb", "Ordernr.", "Rgl", "Vw", "v"],
        ["False", "True", "True", "True", "JA", "26031068.0", "1.0", "1.0",
         "AEST13", "oms", "1.0", "B", "Sm", "HEADLAM", "26536240.0", "6.0", "21-2026", ""],
        ["False", "False", "False", "False", "JA", "26031418.0", "2.0", "2.0",
         "AEST13", "oms", "1.0", "B", "Sm", "JANSEN", "26550330.0", "1.0", "23-2026", ""],
    ]
    assert extract_gesneden_uit_rows(rows) == {("26536240", "6")}


def test_extract_gesneden_week_layout_andere_kolommen():
    # Week-sheet: Gesneden=2, Verk.ordernr.=16, Rgl=21 (data-index varieert).
    rows = [
        ["", "True", "", "", "", "", "", "", "Planning", "", "", "", "", "", "", "", "", ""],
        ["", "Niet produceren", "Gesneden", "Ingepakt", "Bin", "Marjolein",
         "Ink.order:", "I.rg", "Kwaliteit:", "Dag", "", "", "", "", "", "",
         "Verk.ordernr.:", "Deb.nr."],
        ["", "False", "True", "True", "True", "ja", "26032079.0", "1.0",
         "Chester 15", "", "", "", "", "200.0", "290.0", "1.0", "26570480.0", ""],
    ]
    # ordernr-kolom 16, rgl-kolom 7 (I.rg)? Nee: rgl moet 'rgl'/'ordrgl' header zijn.
    # Deze week-layout heeft GEEN 'rgl'-header -> sheet wordt overgeslagen.
    assert extract_gesneden_uit_rows(rows) == set()


def test_extract_gesneden_skip_sheet_zonder_gesneden():
    rows = [["a", "b", "c"], ["x", "y", "z"]]
    assert extract_gesneden_uit_rows(rows) == set()


def test_parse_planning_rij_actief_recht():
    # 0-based kolommen; index4 kwal+kleur, 7 maat1, 8 maat2, 9 aantal,
    # 10 ordernr, 15 rgl, 22 opmerking.
    rij = [""] * 25
    rij[4] = "AEST14"; rij[7] = "400"; rij[8] = "175"; rij[9] = 1
    rij[10] = "26475680"; rij[15] = "1"; rij[22] = ""
    pr = parse_planning_rij(rij)
    assert pr is not None
    assert pr.oud_ordernr == "26475680"
    assert pr.oud_orderregel == "1"
    assert pr.kwaliteit == "AEST14"[:4] or pr.kwaliteit == "AEST"
    assert pr.kwaliteit == "AEST"
    assert pr.kleur == "14"
    assert pr.breedte_nodig_cm == 400
    assert pr.lengte_verbruikt_cm == 175
    assert pr.aantal == 1


def test_parse_planning_rij_zonder_ordernr_is_none():
    rij = [""] * 25
    rij[4] = "AEST14"; rij[7] = "400"; rij[8] = "175"
    pr = parse_planning_rij(rij)
    assert pr is None


def test_parse_planning_rij_aantal_default_1():
    rij = [""] * 25
    rij[4] = "AEST13"; rij[7] = "300"; rij[8] = "RND"
    rij[10] = "26568720"; rij[15] = "1"; rij[9] = ""
    pr = parse_planning_rij(rij)
    assert pr.aantal == 1
    assert pr.breedte_nodig_cm == 300
    assert pr.lengte_verbruikt_cm == 300
```

- [ ] **Step 4: Run de tests om falen te bevestigen**

Run: `cd import && python -m pytest tests/test_snijlijst_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'lib.snijlijst_parser'`.

- [ ] **Step 5: Schrijf de implementatie**

Maak `import/lib/snijlijst_parser.py`:

```python
"""Pure parser-helpers voor de maatwerk-reservering-migratie.

Geen Supabase-afhankelijkheid: alle functies werken op losse waarden of op
lijsten-van-rijen (zoals openpyxl `iter_rows(values_only=True)` ze oplevert),
zodat ze met literal-fixtures testbaar zijn.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# Kolomindexen van tabblad 'Snijden Karpi op kwal' (0-based, data vanaf rij 2).
PL_KWALKLEUR = 4
PL_MAAT1 = 7
PL_MAAT2 = 8
PL_AANTAL = 9
PL_ORDERNR = 10
PL_RGL = 15
PL_OPMERKING = 22

_KWALKLEUR_RE = re.compile(r"^([A-Za-z]+)(\d+)$")
_SNIJDEN_UIT_RE = re.compile(r"uit\s*\d+\s*x\s*\d+", re.IGNORECASE)


def _norm(cell) -> str:
    return str(cell).strip() if cell is not None else ""


def normaliseer_key(cell) -> str | None:
    """Normaliseer een ordernr/rgl-sleutel: '26536240.0' -> '26536240'.

    Excel levert getallen vaak als float (.0-artefact). Niet-numerieke waarden
    blijven ongewijzigd (bv. webshop-codes 'FPNL130883'). Leeg -> None.
    """
    s = _norm(cell)
    if s == "":
        return None
    try:
        return str(int(float(s)))
    except ValueError:
        return s


def parse_kwal_kleur(code) -> tuple[str, str] | None:
    """'AEST13' -> ('AEST', '13'). Niet-matchend (KUNSTGRAS, leeg) -> None."""
    s = _norm(code)
    m = _KWALKLEUR_RE.match(s)
    if not m:
        return None
    return m.group(1), m.group(2)


def is_snijden_uit(opmerking) -> bool:
    """True als de opmerking 'uit NxN' bevat (wordt uit standaard karpet gesneden)."""
    return bool(_SNIJDEN_UIT_RE.search(_norm(opmerking)))


def normaliseer_kleur(kleur) -> str:
    """Strip het '.0'-Excel-artefact van een kleurcode: '13.0' -> '13'."""
    return re.sub(r"\.0+$", "", _norm(kleur))


def breedte_lengte_uit_maten(maat1, maat2) -> tuple[int, int]:
    """Geef (breedte_nodig_cm, lengte_verbruikt_cm) volgens de snijmethodiek.

    Recht stuk A×B: breedte = max(A,B), lengte = min(A,B).
    RND (maat2 == 'RND'): diameter in maat1, beide = diameter.
    """
    a = int(float(_norm(maat1)))
    m2 = _norm(maat2)
    if m2.upper() == "RND":
        return a, a
    b = int(float(m2))
    return max(a, b), min(a, b)


@dataclass
class PlanningRegel:
    oud_ordernr: str
    oud_orderregel: str
    kwaliteit: str
    kleur: str
    breedte_nodig_cm: int
    lengte_verbruikt_cm: int
    aantal: int
    opmerking: str
    rauwe_kwalkleur: str


def parse_planning_rij(rij) -> PlanningRegel | None:
    """Parse één rij van 'Snijden Karpi op kwal'. None als geen bruikbare regel.

    None bij: ontbrekend ordernr, of niet-parsebare maten. Kwal/kleur-parse-fails
    leveren wel een regel (kwaliteit/kleur leeg) zodat de allocator ze als
    'ongedekt' kan rapporteren.
    """
    rij = list(rij) + [""] * (max(PL_OPMERKING, PL_RGL) + 1 - len(rij))
    ordernr = normaliseer_key(rij[PL_ORDERNR])
    if ordernr is None:
        return None
    try:
        breedte, lengte = breedte_lengte_uit_maten(rij[PL_MAAT1], rij[PL_MAAT2])
    except ValueError:
        return None
    rgl = normaliseer_key(rij[PL_RGL]) or "1"
    try:
        aantal = int(float(_norm(rij[PL_AANTAL]))) if _norm(rij[PL_AANTAL]) else 1
    except ValueError:
        aantal = 1
    if aantal < 1:
        aantal = 1
    kk = parse_kwal_kleur(rij[PL_KWALKLEUR])
    kwaliteit, kleur = (kk if kk else ("", ""))
    return PlanningRegel(
        oud_ordernr=ordernr,
        oud_orderregel=rgl,
        kwaliteit=kwaliteit,
        kleur=kleur,
        breedte_nodig_cm=breedte,
        lengte_verbruikt_cm=lengte,
        aantal=aantal,
        opmerking=_norm(rij[PL_OPMERKING]),
        rauwe_kwalkleur=_norm(rij[PL_KWALKLEUR]),
    )


def _vind_kolommen(rows) -> tuple[int, dict] | tuple[None, None]:
    """Zoek in de eerste 3 rijen de header met 'gesneden' en map de kolommen.

    Returns (header_rij_index, {'gesn','ordernr','rgl'}) of (None, None).
    Vereist alle drie de kolommen, anders wordt de sheet overgeslagen.
    """
    for ri, r in enumerate(rows[:3]):
        if not any("gesneden" in _norm(c).lower() for c in r):
            continue
        cols: dict = {}
        for ci, c in enumerate(r):
            n = _norm(c).lower()
            if "gesneden" in n and "gesn" not in cols:
                cols["gesn"] = ci
            if ("ordernr" in n or "verk.order" in n) and "ordernr" not in cols:
                cols["ordernr"] = ci
            if n in ("rgl", "ordrgl") and "rgl" not in cols:
                cols["rgl"] = ci
        if all(k in cols for k in ("gesn", "ordernr", "rgl")):
            return ri, cols
        return None, None
    return None, None


def extract_gesneden_uit_rows(rows) -> set[tuple[str, str]]:
    """Bouw de set (ordernr, rgl) van gesneden regels uit één sheet.

    Detecteert de kolommen via de header (robuust tegen de wisselende
    week/dag-layouts). Sheets zonder volledige (gesneden, ordernr, rgl)-kolom
    leveren een lege set.
    """
    hi, cols = _vind_kolommen(rows)
    if cols is None:
        return set()
    maxc = max(cols.values())
    out: set[tuple[str, str]] = set()
    for r in rows[hi + 1:]:
        if len(r) <= maxc:
            continue
        if _norm(r[cols["gesn"]]).lower() != "true":
            continue
        o = normaliseer_key(r[cols["ordernr"]])
        rg = normaliseer_key(r[cols["rgl"]])
        if o and rg:
            out.add((o, rg))
    return out
```

- [ ] **Step 6: Run de tests om te bevestigen dat ze slagen**

Run: `cd import && python -m pytest tests/test_snijlijst_parser.py -v`
Expected: PASS (alle tests groen).

- [ ] **Step 7: Commit**

```bash
git add import/pytest.ini import/lib/__init__.py import/tests/__init__.py import/lib/snijlijst_parser.py import/tests/test_snijlijst_parser.py
git commit -m "feat(migratie): gedeelde snijlijst-parser + pytest-setup"
```

---

## Task 3: FIFO-full-width strip-allocator

Pure allocatie-logica, los testbaar met synthetische rollen en stukken.

**Files:**
- Create: `import/lib/strip_allocator.py`
- Test: `import/tests/test_strip_allocator.py`

- [ ] **Step 1: Schrijf de failing tests**

Maak `import/tests/test_strip_allocator.py`:

```python
from lib.strip_allocator import Piece, Roll, alloceer


def _roll(rid, breedte, lengte, sinds, kwal="AEST", kleur="13"):
    return Roll(id=rid, breedte_cm=breedte, lengte_cm=lengte,
                kwaliteit=kwal, kleur=kleur, in_magazijn_sinds=sinds)


def _piece(ordernr, rgl, breedte, lengte, aantal=1, kwal="AEST", kleur="13"):
    return Piece(oud_ordernr=ordernr, oud_orderregel=rgl, kwaliteit=kwal,
                 kleur=kleur, breedte_nodig_cm=breedte,
                 lengte_verbruikt_cm=lengte, aantal=aantal)


def test_alloceer_enkel_stuk_op_passende_rol():
    rollen = [_roll(1, 400, 1500, "2025-01-01")]
    blok, ongedekt = alloceer([_piece("A", "1", 290, 200)], rollen)
    assert ongedekt == []
    assert len(blok) == 1
    assert blok[0].rol_id == 1
    assert blok[0].gereserveerde_lengte_cm == 200
    assert blok[0].breedte_nodig_cm == 290
    assert blok[0].deel_index == 1


def test_alloceer_fifo_kiest_oudste_rol():
    rollen = [
        _roll(1, 400, 1500, "2025-06-01"),
        _roll(2, 400, 1500, "2025-01-01"),  # ouder -> eerst
    ]
    blok, _ = alloceer([_piece("A", "1", 290, 200)], rollen)
    assert blok[0].rol_id == 2


def test_alloceer_fifo_null_sinds_achteraan():
    rollen = [
        _roll(1, 400, 1500, None),
        _roll(2, 400, 1500, "2025-06-01"),
    ]
    blok, _ = alloceer([_piece("A", "1", 290, 200)], rollen)
    assert blok[0].rol_id == 2


def test_alloceer_breedte_te_groot_is_ongedekt():
    rollen = [_roll(1, 250, 1500, "2025-01-01")]
    blok, ongedekt = alloceer([_piece("A", "1", 290, 200)], rollen)
    assert blok == []
    assert len(ongedekt) == 1
    assert "breedte" in ongedekt[0].reden.lower()


def test_alloceer_geen_kwal_kleur_match_is_ongedekt():
    rollen = [_roll(1, 400, 1500, "2025-01-01", kwal="AEST", kleur="13")]
    blok, ongedekt = alloceer([_piece("A", "1", 290, 200, kwal="VELV", kleur="24")], rollen)
    assert blok == []
    assert len(ongedekt) == 1


def test_alloceer_full_width_verbruikt_lengte_lineair():
    # 2 stukken van 200 op een rol van 1500 -> beide passen, rol houdt 1100 over.
    rollen = [_roll(1, 400, 1500, "2025-01-01")]
    pieces = [_piece("A", "1", 290, 200), _piece("B", "1", 290, 200)]
    blok, ongedekt = alloceer(pieces, rollen)
    assert ongedekt == []
    assert {b.rol_id for b in blok} == {1}
    assert sum(b.gereserveerde_lengte_cm for b in blok) == 400


def test_alloceer_loopt_over_naar_volgende_rol():
    rollen = [
        _roll(1, 400, 300, "2025-01-01"),
        _roll(2, 400, 1500, "2025-02-01"),
    ]
    pieces = [_piece("A", "1", 290, 200), _piece("B", "1", 290, 200)]
    blok, ongedekt = alloceer(pieces, rollen)
    assert ongedekt == []
    # eerste stuk past op rol 1 (300>=200), tweede niet (100<200) -> rol 2
    assert blok[0].rol_id == 1
    assert blok[1].rol_id == 2


def test_alloceer_aantal_maakt_meerdere_delen():
    rollen = [_roll(1, 400, 1500, "2025-01-01")]
    blok, ongedekt = alloceer([_piece("A", "1", 290, 200, aantal=3)], rollen)
    assert ongedekt == []
    assert len(blok) == 3
    assert sorted(b.deel_index for b in blok) == [1, 2, 3]
    assert sum(b.gereserveerde_lengte_cm for b in blok) == 600


def test_alloceer_rond_stuk_full_width():
    rollen = [_roll(1, 400, 1500, "2025-01-01")]
    blok, ongedekt = alloceer([_piece("A", "1", 300, 300)], rollen)
    assert ongedekt == []
    assert blok[0].gereserveerde_lengte_cm == 300
    assert blok[0].breedte_nodig_cm == 300
```

- [ ] **Step 2: Run de tests om falen te bevestigen**

Run: `cd import && python -m pytest tests/test_strip_allocator.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'lib.strip_allocator'`.

- [ ] **Step 3: Schrijf de implementatie**

Maak `import/lib/strip_allocator.py`:

```python
"""FIFO-full-width strip-allocator voor de maatwerk-reservering-migratie.

Per (kwaliteit, kleur)-groep worden stukken op rollen gelegd: elk stuk neemt de
volle rolbreedte × lengte_verbruikt_cm. FIFO op in_magazijn_sinds (oudste eerst,
NULL achteraan). Geen 2D-nesting (bewust conservatief). Pure logica, geen IO.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Roll:
    id: int
    breedte_cm: int
    lengte_cm: int
    kwaliteit: str
    kleur: str               # genormaliseerd (zonder .0)
    in_magazijn_sinds: str | None
    resterend_cm: int = field(default=0)

    def __post_init__(self):
        if not self.resterend_cm:
            self.resterend_cm = self.lengte_cm


@dataclass
class Piece:
    oud_ordernr: str
    oud_orderregel: str
    kwaliteit: str
    kleur: str               # genormaliseerd
    breedte_nodig_cm: int
    lengte_verbruikt_cm: int
    aantal: int = 1


@dataclass
class Blokkering:
    rol_id: int
    oud_ordernr: str
    oud_orderregel: str
    deel_index: int
    gereserveerde_lengte_cm: int
    breedte_nodig_cm: int
    kwaliteit: str
    kleur: str


@dataclass
class Ongedekt:
    oud_ordernr: str
    oud_orderregel: str
    deel_index: int
    kwaliteit: str
    kleur: str
    breedte_nodig_cm: int
    lengte_verbruikt_cm: int
    reden: str


_VER_TOEKOMST = "9999-12-31"


def _fifo_key(rol: Roll):
    return (rol.in_magazijn_sinds or _VER_TOEKOMST, rol.id)


def alloceer(pieces: list[Piece], rollen: list[Roll]):
    """Alloceer stukken op rollen. Returns (list[Blokkering], list[Ongedekt]).

    Muteert `rollen[*].resterend_cm` in-place. Sorteer-stabiel: FIFO op sinds.
    """
    # Groepeer rollen per (kwaliteit, kleur), FIFO-gesorteerd.
    per_groep: dict[tuple[str, str], list[Roll]] = {}
    for rol in rollen:
        per_groep.setdefault((rol.kwaliteit, rol.kleur), []).append(rol)
    for groep in per_groep.values():
        groep.sort(key=_fifo_key)

    blok: list[Blokkering] = []
    ongedekt: list[Ongedekt] = []

    for piece in pieces:
        for deel in range(1, piece.aantal + 1):
            if not piece.kwaliteit or not piece.kleur:
                ongedekt.append(_ongedekt(piece, deel, "geen kwal/kleur-parse"))
                continue
            kandidaten = per_groep.get((piece.kwaliteit, piece.kleur), [])
            if not kandidaten:
                ongedekt.append(_ongedekt(piece, deel, "geen rol in deze kwal/kleur"))
                continue
            gekozen = _kies_rol(kandidaten, piece)
            if gekozen is None:
                # Onderscheid: bestaat er wél een rol breed genoeg maar te kort?
                breed_genoeg = any(
                    r.breedte_cm >= piece.breedte_nodig_cm for r in kandidaten
                )
                reden = ("geen rol met genoeg restlengte"
                         if breed_genoeg
                         else "geen rol breedte-passend")
                ongedekt.append(_ongedekt(piece, deel, reden))
                continue
            gekozen.resterend_cm -= piece.lengte_verbruikt_cm
            blok.append(Blokkering(
                rol_id=gekozen.id,
                oud_ordernr=piece.oud_ordernr,
                oud_orderregel=piece.oud_orderregel,
                deel_index=deel,
                gereserveerde_lengte_cm=piece.lengte_verbruikt_cm,
                breedte_nodig_cm=piece.breedte_nodig_cm,
                kwaliteit=piece.kwaliteit,
                kleur=piece.kleur,
            ))
    return blok, ongedekt


def _kies_rol(kandidaten: list[Roll], piece: Piece) -> Roll | None:
    """Eerste FIFO-rol die breed genoeg is én genoeg restlengte heeft."""
    for rol in kandidaten:
        if (rol.breedte_cm >= piece.breedte_nodig_cm
                and rol.resterend_cm >= piece.lengte_verbruikt_cm):
            return rol
    return None


def _ongedekt(piece: Piece, deel: int, reden: str) -> Ongedekt:
    return Ongedekt(
        oud_ordernr=piece.oud_ordernr,
        oud_orderregel=piece.oud_orderregel,
        deel_index=deel,
        kwaliteit=piece.kwaliteit,
        kleur=piece.kleur,
        breedte_nodig_cm=piece.breedte_nodig_cm,
        lengte_verbruikt_cm=piece.lengte_verbruikt_cm,
        reden=reden,
    )
```

- [ ] **Step 4: Run de tests om te bevestigen dat ze slagen**

Run: `cd import && python -m pytest tests/test_strip_allocator.py -v`
Expected: PASS (alle tests groen).

- [ ] **Step 5: Commit**

```bash
git add import/lib/strip_allocator.py import/tests/test_strip_allocator.py
git commit -m "feat(migratie): FIFO-full-width strip-allocator"
```

---

## Task 4: Eenmalig migratiescript `reserveer_maatwerk_migratie.py`

Bedraadt de libs met Supabase + Excel. Default = dry-run (rapporteert, schrijft niet). `--commit` schrijft `migratie_blokkering`.

**Files:**
- Create: `import/reserveer_maatwerk_migratie.py`

- [ ] **Step 1: Schrijf het script**

Maak `import/reserveer_maatwerk_migratie.py`:

```python
"""EENMALIG: reserveer nog-niet-gesneden oud-systeem maatwerk-orders op rollen.

Default = DRY-RUN: leest alles, draait de allocator, schrijft rapport-CSV's naar
import/rapporten/, maar schrijft NIETS naar de database. Gebruik --commit om de
migratie_blokkering-rijen daadwerkelijk weg te schrijven.

Aanroep:
    python reserveer_maatwerk_migratie.py            # dry-run + rapporten
    python reserveer_maatwerk_migratie.py --commit   # schrijf weg

Zie ADR-0028.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import openpyxl
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY
from lib.snijlijst_parser import (
    extract_gesneden_uit_rows,
    is_snijden_uit,
    normaliseer_kleur,
    parse_planning_rij,
)
from lib.strip_allocator import Piece, Roll, alloceer

BASE = Path(__file__).parent.parent
PLANNING_FILE = BASE / "Prod planning wk 23-24-25-26  2026 per 03-06-2026.xlsx"
PLANNING_SHEET = "Snijden Karpi op kwal"
VERSIE_GLOB = "Productieplanning Karpi 2026-*.xlsx"
RAPPORT_DIR = Path(__file__).parent / "rapporten"

# Snijplan-statussen die fysiek lengte op een rol verbruiken.
ACTIEVE_SNIJPLAN_STATUS = ("Gepland", "Snijden", "Gesneden")


def bouw_gesneden_set(versie_paths: list[Path]) -> set[tuple[str, str]]:
    """Union van alle (ordernr, rgl) die in ENIGE versie/sheet gesneden zijn."""
    gesneden: set[tuple[str, str]] = set()
    for fn in versie_paths:
        wb = openpyxl.load_workbook(fn, read_only=True, data_only=True)
        try:
            for sh in wb.sheetnames:
                rows = list(wb[sh].iter_rows(values_only=True))
                if rows:
                    gesneden |= extract_gesneden_uit_rows(rows)
        finally:
            wb.close()
    return gesneden


def laad_planning() -> list:
    wb = openpyxl.load_workbook(PLANNING_FILE, read_only=True, data_only=True)
    try:
        ws = wb[PLANNING_SHEET]
        rows = list(ws.iter_rows(values_only=True))[2:]  # data vanaf rij-index 2
    finally:
        wb.close()
    regels = []
    for r in rows:
        pr = parse_planning_rij(r)
        if pr is not None:
            regels.append(pr)
    return regels


def _fetch_alle(sb, tabel, kolommen, filters=None):
    """Paginerende fetch (Supabase-default limiet is 1000 rijen)."""
    out = []
    start = 0
    page = 1000
    while True:
        q = sb.table(tabel).select(kolommen).range(start, start + page - 1)
        if filters:
            q = filters(q)
        data = q.execute().data or []
        out.extend(data)
        if len(data) < page:
            break
        start += page
    return out


def laad_rollen(sb) -> list[Roll]:
    rows = _fetch_alle(
        sb, "rollen",
        "id, breedte_cm, lengte_cm, kwaliteit_code, kleur_code, status, in_magazijn_sinds",
        lambda q: q.in_("status", ["beschikbaar", "reststuk", "in_snijplan"]),
    )
    # Reeds door snijplannen verbruikte lengte per rol aftrekken (conservatief).
    snij = _fetch_alle(
        sb, "snijplannen",
        "rol_id, lengte_cm, breedte_cm, geroteerd, status",
        lambda q: q.in_("status", list(ACTIEVE_SNIJPLAN_STATUS)).not_.is_("rol_id", "null"),
    )
    verbruikt: dict[int, int] = {}
    for s in snij:
        if s["rol_id"] is None:
            continue
        # Y-as-verbruik = breedte_cm (niet-geroteerd) of lengte_cm (geroteerd).
        y = s["lengte_cm"] if s.get("geroteerd") else s["breedte_cm"]
        verbruikt[s["rol_id"]] = verbruikt.get(s["rol_id"], 0) + int(y or 0)

    rollen = []
    for r in rows:
        if not r["breedte_cm"] or not r["lengte_cm"]:
            continue  # placeholder-rollen (PH-*) overslaan
        rest = int(r["lengte_cm"]) - verbruikt.get(r["id"], 0)
        if rest <= 0:
            continue
        rollen.append(Roll(
            id=r["id"],
            breedte_cm=int(r["breedte_cm"]),
            lengte_cm=rest,
            kwaliteit=(r["kwaliteit_code"] or "").strip(),
            kleur=normaliseer_kleur(r["kleur_code"]),
            in_magazijn_sinds=r["in_magazijn_sinds"],
        ))
    return rollen


def regels_naar_pieces(regels, gesneden) -> tuple[list[Piece], dict]:
    """Filter planning-regels en zet ze om naar Piece's. Returns (pieces, stats)."""
    stats = {"totaal": 0, "snijuit": 0, "gesneden": 0, "actief": 0}
    pieces = []
    for pr in regels:
        stats["totaal"] += 1
        if is_snijden_uit(pr.opmerking):
            stats["snijuit"] += 1
            continue
        if (pr.oud_ordernr, pr.oud_orderregel) in gesneden:
            stats["gesneden"] += 1
            continue
        stats["actief"] += 1
        pieces.append(Piece(
            oud_ordernr=pr.oud_ordernr,
            oud_orderregel=pr.oud_orderregel,
            kwaliteit=pr.kwaliteit,
            kleur=pr.kleur,
            breedte_nodig_cm=pr.breedte_nodig_cm,
            lengte_verbruikt_cm=pr.lengte_verbruikt_cm,
            aantal=pr.aantal,
        ))
    return pieces, stats


def schrijf_rapporten(blok, ongedekt):
    RAPPORT_DIR.mkdir(exist_ok=True)
    with (RAPPORT_DIR / "migratie_gedekt.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["rol_id", "oud_ordernr", "oud_orderregel", "deel_index",
                    "gereserveerde_lengte_cm", "breedte_nodig_cm", "kwaliteit", "kleur"])
        for b in blok:
            w.writerow([b.rol_id, b.oud_ordernr, b.oud_orderregel, b.deel_index,
                        b.gereserveerde_lengte_cm, b.breedte_nodig_cm, b.kwaliteit, b.kleur])
    with (RAPPORT_DIR / "migratie_ongedekt.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["oud_ordernr", "oud_orderregel", "deel_index", "kwaliteit",
                    "kleur", "breedte_nodig_cm", "lengte_verbruikt_cm", "reden"])
        for o in ongedekt:
            w.writerow([o.oud_ordernr, o.oud_orderregel, o.deel_index, o.kwaliteit,
                        o.kleur, o.breedte_nodig_cm, o.lengte_verbruikt_cm, o.reden])


def schrijf_naar_db(sb, blok):
    records = [{
        "rol_id": b.rol_id,
        "gereserveerde_lengte_cm": b.gereserveerde_lengte_cm,
        "breedte_nodig_cm": b.breedte_nodig_cm,
        "oud_ordernr": b.oud_ordernr,
        "oud_orderregel": b.oud_orderregel,
        "deel_index": b.deel_index,
        "kwaliteit_code": b.kwaliteit,
        "kleur_code": b.kleur,
        "status": "actief",
    } for b in blok]
    for i in range(0, len(records), 500):
        sb.table("migratie_blokkering").upsert(
            records[i:i + 500],
            on_conflict="oud_ordernr,oud_orderregel,deel_index",
        ).execute()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true",
                    help="Schrijf migratie_blokkering weg (anders dry-run).")
    args = ap.parse_args()

    versie_paths = sorted(BASE.glob(VERSIE_GLOB))
    if not versie_paths:
        sys.exit(f"Geen versiebestanden gevonden ({VERSIE_GLOB}) in {BASE}")

    print("Gesneden-union bouwen uit", len(versie_paths), "versiebestanden ...")
    gesneden = bouw_gesneden_set(versie_paths)
    print("  unieke gesneden (ordernr,rgl):", len(gesneden))

    regels = laad_planning()
    pieces, stats = regels_naar_pieces(regels, gesneden)
    print("Planning:", stats)

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    rollen = laad_rollen(sb)
    print("Rollen in pool:", len(rollen))

    blok, ongedekt = alloceer(pieces, rollen)
    print("Gedekt (blokkeringen):", len(blok))
    print("Ongedekt (stuks):", len(ongedekt))

    schrijf_rapporten(blok, ongedekt)
    print("Rapporten in:", RAPPORT_DIR)

    if args.commit:
        print("Wegschrijven naar migratie_blokkering ...")
        schrijf_naar_db(sb, blok)
        print("Klaar:", len(blok), "blokkeringen weggeschreven.")
    else:
        print("DRY-RUN — niets weggeschreven. Gebruik --commit om te schrijven.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verifieer dat de DB-credentials staan**

Run: `cd import && python -c "from config import SUPABASE_URL, SUPABASE_KEY; print('url:', bool(SUPABASE_URL), 'key:', bool(SUPABASE_KEY))"`
Expected: `url: True key: True`. Zo niet: vul `import/.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).

- [ ] **Step 3: Draai de dry-run en controleer de cijfers**

Run: `cd import && python reserveer_maatwerk_migratie.py`
Expected (orde-van-grootte, exacte aantallen mogen iets afwijken door DB-stand):
```
  unieke gesneden (ordernr,rgl): 11949
Planning: {'totaal': 1531, 'snijuit': 22, 'gesneden': 47, 'actief': 1462}
Rollen in pool: ~1400
Gedekt (blokkeringen): <hoog, ~1400+>
Ongedekt (stuks): <laag — bekijk import/rapporten/migratie_ongedekt.csv>
```
Open `import/rapporten/migratie_ongedekt.csv` en beoordeel of de ongedekte regels verklaarbaar zijn (KUNSTGRAS/parse-fails, of kwaliteiten zonder voorraad). Dit is de handmatige go/no-go.

- [ ] **Step 4: Commit (script + rapporten nog niet committen)**

```bash
git add import/reserveer_maatwerk_migratie.py
git commit -m "feat(migratie): eenmalig reserveer_maatwerk_migratie script (dry-run default)"
```

> NB: `import/rapporten/` niet committen tenzij gewenst — voeg eventueel `import/rapporten/` toe aan `.gitignore`.

- [ ] **Step 5: (Pas uitvoeren na akkoord op de dry-run) Commit de blokkeringen**

Run: `cd import && python reserveer_maatwerk_migratie.py --commit`
Expected: `Klaar: <N> blokkeringen weggeschreven.`

Verifieer in de SQL-editor:
```sql
SELECT status, COUNT(*) FROM migratie_blokkering GROUP BY status;
```
Expected: één rij `actief` met het aantal uit Step 3.

---

## Task 5: Dagelijks release-script `release_migratie_blokkeringen.py`

**Files:**
- Create: `import/release_migratie_blokkeringen.py`

- [ ] **Step 1: Schrijf het script**

Maak `import/release_migratie_blokkeringen.py`:

```python
"""DAGELIJKS: geef migratie-blokkeringen vrij waarvan de order inmiddels gesneden is.

Leest de nieuwste snijlijst-versie(s), bouwt de gesneden-set en zet bijbehorende
migratie_blokkering-rijen op status='vrijgegeven'. Idempotent: raakt alleen
status='actief'-rijen aan.

Aanroep:
    python release_migratie_blokkeringen.py            # dry-run (toont aantal)
    python release_migratie_blokkeringen.py --commit   # voer release uit
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY
from reserveer_maatwerk_migratie import BASE, VERSIE_GLOB, bouw_gesneden_set


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    versie_paths = sorted(BASE.glob(VERSIE_GLOB))
    if not versie_paths:
        sys.exit(f"Geen versiebestanden gevonden ({VERSIE_GLOB}) in {BASE}")
    gesneden = bouw_gesneden_set(versie_paths)
    print("Gesneden in snijlijsten:", len(gesneden))

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    actief = sb.table("migratie_blokkering").select(
        "id, oud_ordernr, oud_orderregel").eq("status", "actief").execute().data or []

    vrij_ids = [
        rij["id"] for rij in actief
        if (rij["oud_ordernr"], rij["oud_orderregel"]) in gesneden
    ]
    print(f"Vrij te geven: {len(vrij_ids)} van {len(actief)} actieve blokkeringen")

    if not args.commit:
        print("DRY-RUN — niets gewijzigd. Gebruik --commit.")
        return

    for i in range(0, len(vrij_ids), 500):
        batch = vrij_ids[i:i + 500]
        sb.table("migratie_blokkering").update(
            {"status": "vrijgegeven", "vrijgegeven_op": "now()"}
        ).in_("id", batch).execute()
    print("Klaar:", len(vrij_ids), "vrijgegeven.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Draai de dry-run**

Run: `cd import && python release_migratie_blokkeringen.py`
Expected: `Vrij te geven: <N> van <M> actieve blokkeringen` + `DRY-RUN`. Met de huidige snijlijst-stand kan `N` 0 zijn (de blokkeringen zijn juist de nog-niet-gesneden orders) — dat is correct.

- [ ] **Step 3: Commit**

```bash
git add import/release_migratie_blokkeringen.py
git commit -m "feat(migratie): dagelijks release_migratie_blokkeringen script"
```

---

## Task 6: Edge-functie — strip-injectie in `fetchBezettePlaatsingen`

De packer moet de blokkering zien als één full-width plaatsing onderaan elke geraakte rol. `fetchBezettePlaatsingen` (enige caller: `auto-plan-groep/index.ts:155`) levert de `bezetteMap` die de packer gebruikt (`ffdh-packing.ts:487` → `bezetteMap.get(roll.id)`).

**Oriëntatie (bevestigd via `guillotine-packing.test.ts`):** `computeFreeRects(rollWidth, rollLength, placements)` met `rollWidth = rol.breedte_cm` (X-as), `rollLength = rol.lengte_cm` (Y-as). Een `Placement` bezet X-extent = `lengte_cm` en Y-extent = `breedte_cm`. Een **full-width bodemstrip** is dus: `positie_x_cm=0, positie_y_cm=0, lengte_cm = rol.breedte_cm` (volle breedte over X), `breedte_cm = gereserveerde_lengte` (verbruikte Y), `geroteerd=false`.

**Files:**
- Modify: `supabase/functions/_shared/db-helpers.ts` (binnen `fetchBezettePlaatsingen`, na de bestaande snijplan-loop, vóór `return map`)
- Test: `supabase/functions/_shared/guillotine-packing.test.ts` (extra Deno-test voor strip-gedrag)

- [ ] **Step 1: Bevestig de oriëntatie in de packer**

Run: `grep -n "computeFreeRects(400, 1500" supabase/functions/_shared/guillotine-packing.test.ts`
Expected: een regel met `computeFreeRects(400, 1500, [placement(1, 0, 0, 240, 340)])` — bevestigt rollWidth=400(breedte), rollLength=1500(lengte) en `placement(id, x, y, lengte, breedte)`.

- [ ] **Step 2: Voeg de strip-injectie toe**

In `supabase/functions/_shared/db-helpers.ts`, vervang het einde van `fetchBezettePlaatsingen` (de regel `  return map\n}` aan het eind van de functie, rond regel 334) door onderstaande blok. Dit voegt ná de bestaande snijplan-loop de migratie-strips toe:

```typescript
  // ---------------------------------------------------------------------------
  // Migratie-blokkeringen (ADR-0028, mig 313): oud-systeem maatwerk-orders die
  // nog gesneden moeten worden, beslaan FIFO-lengte op rollen. We injecteren per
  // geraakte rol één full-width bodemstrip zodat de packer er niet overheen
  // plant. Let op: deze rollen hebben status 'beschikbaar'/'reststuk' (NIET
  // 'in_snijplan'), dus de in_snijplan-restrictie hierboven mist ze — aparte
  // query op de hele kwaliteit/kleur-groep.
  // ---------------------------------------------------------------------------
  const { data: groepRollen, error: groepError } = await supabase
    .from('rollen')
    .select('id, breedte_cm, lengte_cm')
    .in('status', ['beschikbaar', 'reststuk', 'in_snijplan'])
    .or(orClause)
  if (groepError) throw groepError

  const rolMeta = new Map<number, { breedte: number; lengte: number }>()
  for (const r of (groepRollen ?? []) as Array<Record<string, unknown>>) {
    rolMeta.set(r.id as number, {
      breedte: Number(r.breedte_cm ?? 0),
      lengte: Number(r.lengte_cm ?? 0),
    })
  }

  const groepRolIds = [...rolMeta.keys()]
  if (groepRolIds.length > 0) {
    const { data: blok, error: blokError } = await supabase
      .from('migratie_blokkering')
      .select('rol_id, gereserveerde_lengte_cm')
      .eq('status', 'actief')
      .in('rol_id', groepRolIds)
    if (blokError) throw blokError

    const lengtePerRol = new Map<number, number>()
    for (const b of (blok ?? []) as Array<Record<string, unknown>>) {
      const rolId = b.rol_id as number
      lengtePerRol.set(
        rolId,
        (lengtePerRol.get(rolId) ?? 0) + Number(b.gereserveerde_lengte_cm),
      )
    }

    for (const [rolId, lengte] of lengtePerRol) {
      const meta = rolMeta.get(rolId)
      if (!meta || meta.breedte <= 0 || meta.lengte <= 0) continue
      // Strip nooit groter dan de rol zelf (defensief tegen overgeboekte data).
      const stripY = Math.min(lengte, meta.lengte)
      const strip: Placement = {
        snijplan_id: -rolId, // negatief: geen botsing met echte snijplan-ids
        positie_x_cm: 0,
        positie_y_cm: 0,
        lengte_cm: meta.breedte, // X-extent = volle rolbreedte
        breedte_cm: stripY, // Y-extent = verbruikte lengte
        geroteerd: false,
      }
      const arr = map.get(rolId) ?? []
      arr.push(strip)
      map.set(rolId, arr)
    }
  }

  return map
}
```

- [ ] **Step 3: Schrijf een Deno-test voor het strip-gedrag**

Voeg onderaan `supabase/functions/_shared/guillotine-packing.test.ts` toe (gebruik de bestaande `computeFreeRects`-import en `placement`-helper uit dat bestand):

```typescript
Deno.test('migratie-strip: full-width bodemstrip laat alleen ruimte erboven', () => {
  // Rol 400 breed × 1500 lang; strip beslaat 0..400 (X) × 0..300 (Y).
  // placement(id, x, y, lengte=X-extent, breedte=Y-extent)
  const strip = placement(-1, 0, 0, 400, 300)
  const free = computeFreeRects(400, 1500, [strip])
  // Eén vrije rechthoek: volle breedte, vanaf y=300 tot 1500 (1200 hoog).
  assertEquals(free.length, 1)
  assertEquals(free[0].x, 0)
  assertEquals(free[0].y, 300)
  assertEquals(free[0].width, 400)
  assertEquals(free[0].height, 1200)
})
```

> Als de `placement`-helper of `assertEquals` nog niet in scope is: kopieer ze uit de bestaande tests bovenaan het bestand (zelfde patroon als `computeFreeRects: met één bezette placement in hoek`).

- [ ] **Step 4: Run de Deno-tests**

Run: `cd supabase/functions/_shared && deno test guillotine-packing.test.ts`
Expected: alle tests PASS, inclusief de nieuwe `migratie-strip`-test.

- [ ] **Step 5: Commit + deploy-notitie**

```bash
git add supabase/functions/_shared/db-helpers.ts supabase/functions/_shared/guillotine-packing.test.ts
git commit -m "feat(snijplanning): packer respecteert migratie_blokkering als full-width strip"
```

> Deploy handmatig: `supabase functions deploy auto-plan-groep` (deelt `_shared`). Edge-deploy gebeurt niet automatisch in deze repo.

---

## Task 7: `voorraadposities`-RPC trekt geblokkeerde m² af

De voorraad-m² per (kwaliteit, kleur) moet de actieve migratie-blokkering aftrekken, zodat de voorraadpagina de werkelijke vrije meters toont.

**Files:**
- Create: `supabase/migrations/314_voorraadposities_blokkering.sql`

- [ ] **Step 1: Haal de huidige functiebody op**

Run: `sed -n '38,200p' supabase/migrations/179_voorraadposities_rpc.sql`
Bekijk de `eigen_totaal_m2`-berekening (CTE die `SUM(r.oppervlak_m2)` per `(kwaliteit_code, genormaliseerde kleur)` aggregeert).

- [ ] **Step 2: Schrijf de overschrijf-migratie**

Maak `supabase/migrations/314_voorraadposities_blokkering.sql`. Kopieer de **volledige** `CREATE OR REPLACE FUNCTION voorraadposities(...)`-body uit mig 179 en pas twee dingen aan:

1. Voeg vlak vóór de bestaande eigen-voorraad-aggregatie een CTE toe:

```sql
  -- Actieve migratie-blokkering per (kwaliteit, genormaliseerde kleur), in m².
  -- Strip = volle rolbreedte × gereserveerde_lengte_cm. m² = breedte_cm/100 * lengte_cm/100.
  geblokkeerd AS (
    SELECT
      mb.kwaliteit_code,
      regexp_replace(mb.kleur_code, '\.0+$', '') AS norm_kleur,
      SUM(r.breedte_cm::numeric / 100 * mb.gereserveerde_lengte_cm::numeric / 100) AS m2
    FROM migratie_blokkering mb
    JOIN rollen r ON r.id = mb.rol_id
    WHERE mb.status = 'actief'
    GROUP BY mb.kwaliteit_code, regexp_replace(mb.kleur_code, '\.0+$', '')
  )
```

2. In de finale `SELECT` die `eigen_totaal_m2` teruggeeft, trek het geblokkeerde m² af met een `LEFT JOIN geblokkeerd` op `(kwaliteit_code, norm_kleur)` en `GREATEST(0, eigen.eigen_totaal_m2 - COALESCE(geblokkeerd.m2, 0))`. Voorbeeld van de aangepaste expressie:

```sql
    GREATEST(0, eigen.eigen_totaal_m2 - COALESCE(geblokkeerd.m2, 0)) AS eigen_totaal_m2,
```

met in de `FROM`/`JOIN`:

```sql
    LEFT JOIN geblokkeerd
      ON geblokkeerd.kwaliteit_code = eigen.kwaliteit_code
     AND geblokkeerd.norm_kleur = eigen.norm_kleur
```

> Pas de exacte alias-namen aan op wat mig 179 gebruikt (controleer in Step 1). De kern: `eigen_totaal_m2` wordt verlaagd met het actieve blokkering-m², ondergrens 0.

- [ ] **Step 3: Pas de migratie toe en verifieer**

Pas handmatig toe (SQL-editor / CLI). Verifieer dat de functie nog draait en de aftrek werkt:

```sql
-- Kies een (kwaliteit, kleur) die in migratie_blokkering voorkomt:
SELECT kwaliteit_code, kleur_code, eigen_totaal_m2
FROM voorraadposities()
WHERE kwaliteit_code = '<KWAL>' AND kleur_code = '<KLEUR>';
```
Expected: `eigen_totaal_m2` ligt lager dan vóór de migratie met ongeveer het geblokkeerde m² voor die combinatie.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/314_voorraadposities_blokkering.sql
git commit -m "feat(voorraad): voorraadposities trekt actieve migratie_blokkering m2 af"
```

---

## Task 8: Documentatie bijwerken

**Files:**
- Modify: `docs/database-schema.md`
- Modify: `docs/data-woordenboek.md`
- Modify: `docs/architectuur.md`
- Modify: `docs/changelog.md`

- [ ] **Step 1: database-schema.md — nieuwe tabel**

Voeg een sectie `migratie_blokkering` toe onder de tabellen, met alle kolommen uit mig 313 (rol_id FK→rollen, gereserveerde_lengte_cm, breedte_nodig_cm, oud_ordernr, oud_orderregel, deel_index, kwaliteit_code, kleur_code, status enum actief/vrijgegeven, aangemaakt_op, vrijgegeven_op; UNIQUE (oud_ordernr, oud_orderregel, deel_index)) en de twee indexen. Vermeld dat de tabel tijdelijk is (ADR-0028).

- [ ] **Step 2: data-woordenboek.md — begrip migratie-blokkering**

Voeg toe: *"Migratie-blokkering — eenmalige FIFO-lengtereservering van een nog-niet-gesneden oud-systeem maatwerk-order op een fysieke rol, full-width (volle rolbreedte × min(A,B) cm). Voorkomt dat de overgenomen voorraad dubbel wordt verkocht. Vervalt zodra de order gesneden is (status vrijgegeven). Zie ADR-0028."*

- [ ] **Step 3: architectuur.md — bedrijfsregel/ADR-verwijzing**

Voeg een korte alinea (in de stijl van de bestaande bedrijfsregels) toe die de migratie-blokkering beschrijft: bron `migratie_blokkering` (mig 313), packer-injectie via één full-width strip in `fetchBezettePlaatsingen`, m²-aftrek in `voorraadposities` (mig 314), release via dagelijks script, snijmethodiek (breedte=max, lengte=min, FIFO op `in_magazijn_sinds`, geen 2D-nesting). Verwijs naar dit planbestand en ADR-0028.

- [ ] **Step 4: changelog.md — datumregel**

Voeg bovenaan toe:
```markdown
## 2026-06-04 — Maatwerk-voorraad reservering-migratie (ADR-0028, mig 313-314)
- Nieuwe tabel `migratie_blokkering`: FIFO-full-width lengteblokkering van nog-niet-gesneden
  oud-systeem maatwerk-orders op fysieke rollen, zodat de overgenomen voorraad klopt.
- Eenmalig script `import/reserveer_maatwerk_migratie.py` (alloceert ~1462 actieve op-maat
  stuks; gesneden-historie uit de union van alle snijlijst-versies, header-detect per sheet).
- Dagelijks `import/release_migratie_blokkeringen.py` geeft blokkeringen vrij zodra gesneden.
- Packer (`auto-plan-groep`/`fetchBezettePlaatsingen`) plant niet over de strip; `voorraadposities`
  trekt geblokkeerde m² af.
```

- [ ] **Step 5: Commit**

```bash
git add docs/database-schema.md docs/data-woordenboek.md docs/architectuur.md docs/changelog.md
git commit -m "docs(migratie): documenteer migratie_blokkering + ADR-0028"
```

---

## Self-Review (uitgevoerd bij het schrijven van dit plan)

**Spec-dekking:**
- Eenmalig script `reserveer_maatwerk_migratie.py` → Task 4. ✅
- Dagelijks `release_migratie_blokkeringen.py` → Task 5. ✅
- Gesneden-set uit alle versies, union → `bouw_gesneden_set` (Task 4) + `extract_gesneden_uit_rows` (Task 2). ✅ (+ correctie: header-detect i.p.v. vaste index; week-sheets meegenomen).
- Filter "snijden uit" → `is_snijden_uit` (Task 2). ✅ (+ correctie: patroon `uit \d+x\d+`).
- Snijmethodiek (breedte=max, lengte=min, RND, FIFO) → `breedte_lengte_uit_maten` + `strip_allocator` (Task 2/3). ✅
- Tabel `migratie_blokkering` → Task 1. ✅
- `fetchBeschikbareRollen` aftrek → **bewust niet** apart geïmplementeerd; aftrek loopt via de strip-Placement (Task 6), dubbel aftrekken vermeden — gemotiveerd in ADR-0028 en Task 6. ✅
- `fetchBezettePlaatsingen` virtuele plaatsing → Task 6. ✅
- `voorraadposities` m²-aftrek → Task 7. ✅
- `aantal>1` → `deel_index` in allocator + tabel (Task 1/3/4). ✅
- Ongedekt loggen + overslaan → `migratie_ongedekt.csv` (Task 4). ✅

**Placeholder-scan:** geen TBD/TODO; alle code volledig uitgeschreven; SQL-functie-edit (Task 7) verwijst expliciet naar de bron-body met concrete CTE + JOIN-snippet (de enige plek waar de bestaande body wordt hergebruikt i.p.v. herhaald, omdat die >150 regels is).

**Type-consistentie:** `Roll`/`Piece`/`Blokkering`/`Ongedekt`-velden consistent tussen `strip_allocator.py`, tests en `reserveer_maatwerk_migratie.py`. `PlanningRegel`-velden consistent tussen parser, tests en migratiescript. `Placement`-shape (`snijplan_id, positie_x_cm, positie_y_cm, lengte_cm, breedte_cm, geroteerd`) consistent met `db-helpers.ts`. Kolomindexen (`PL_*`) één bron in `snijlijst_parser.py`.
