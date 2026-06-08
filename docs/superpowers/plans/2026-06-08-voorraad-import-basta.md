# Voorraad-import Basta (rollen + vaste maten) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De actuele fysieke voorraad uit het oude systeem (Basta) in RugFlow laden — vaste maten (stuks) én rollen (broadloom, m²) — en RugFlow's eigen open orders zich daar automatisch van laten reserveren, zodat de vrije voorraad in RugFlow gelijk wordt aan *fysiek − onze orders*.

**Architecture:** Twee gescheiden bron-bestanden mappen op twee voorraad-modellen. (1) `Voorraadlijst <datum>.xls` → `producten.voorraad` voor `product_type='vast'` (wekelijks terugkerend). (2) `Rollenvoorraad <datum>.xlsx` → individuele rijen in tabel `rollen` (éénmalige go-live nulstand). Na het laden van vaste-maten-voorraad draait een idempotente herallocatie van alle open orderregels (RPC `herallocateer_orderregel`), waarna de DB-triggers `gereserveerd` + `vrije_voorraad` herberekenen. Alles loopt via bestaande Python-importscripts (supabase-py + service_role key), dry-run-first, met een veiligheids-snapshot vooraf.

**Tech Stack:** Python 3.11, pandas, openpyxl (.xlsx), xlrd 2.0 (.xls), supabase-py; PostgreSQL RPC's (`herallocateer_orderregel`, `herbereken_product_reservering`); pytest voor pure helpers.

---

## Achtergrond & vastgelegde beslissingen (afgestemd met Karpi, 2026-06-08)

| Onderwerp | Beslissing |
|-----------|-----------|
| **Voorraad-bron vaste maten** | **Kolom D `Voorraad`** (fysiek), NIET kolom H `Vrije voorraad`. RugFlow trekt de orders zelf af → geen dubbel-aftrekken. |
| **Orders eraf halen** | Via RugFlow's eigen allocator (`herallocateer_orderregel`) over alle open orderregels — alleen vaste maten/stuks. |
| **Rollen-bron** | `Rollenvoorraad 08-06-2026 (1).xlsx`: 1.410 rollen, 420 artikelen, 62.766 m². |
| **Rollen-frequentie** | **Éénmalig** (go-live nulstand). Maatwerk-orders worden via een andere route geladen → rollen worden hierna NIET opnieuw geïmporteerd. |
| **Rollen-reserveringen** | Alle rollen uit het bestand komen schoon binnen als `status='beschikbaar'` (bestaande reservering/snijplan-holds worden gewist). |
| **Vaste-maten-frequentie** | Wekelijks terugkerend (zelfde script-vorm als bestaande `update_voorraad.py`). |
| **Ontbrekende rol-producten** | Aanmaken als `product_type='rol'` + rapporteren (geen rol mag wegvallen door een FK-fout). |

### Bron-bestand kolommen (geverifieerd)

**`Voorraadlijst 08-6-2026 (1).xls`** (1 tab `Blad1`, header op rij-index 1, data vanaf rij 2):
`A=Artikelnr · B=Karpi-code · C=Omschrijving · D=Voorraad · E=Backorder · F=Gereserveerd · G=Besteld(ink) · H=Vrije voorraad · …`
Som kolom D (Voorraad) = **122.260**; som H (Vrije voorraad) = **109.881**; 2.203 regels waar D≠H (= waar Basta al reserveringen aftrok).

**`Rollenvoorraad 08-06-2026 (1).xlsx`** (1 tab `arollen260608`, pandas leest op kolomnaam):
`Artikelnr · Karpi-code · Omschrijving · VVP m2 · Rolnummer · Volgnr. · Lengte (m) · Breedte (m) · Ltste Wijz · Oppervlak · Waarde`
`Ltste Wijz` = `YYYYMMDD` (bijv. `20260602`) → bron voor `rollen.in_magazijn_sinds` (FIFO, ADR-0021).

---

## Beslissing (bevestigd 2026-06-08): snijplannen óók wissen

Alle reserveringen gaan weg, **met inbegrip van de snijplannen**. De bestaande productie-keten (snijplannen + afhankelijke tabellen) wordt in één transactie geleegd en alle betrokken rollen komen vrij; de maatwerk-route bouwt de snijplannen daarna opnieuw op. Dit is een **go-live-eenmalige** actie (**Task 5**), uit te voeren ná de snapshot (Task 1) en vóór de rollen-import (Spoor B, Task 4).

> Let op: een directe `DELETE FROM snijplannen` triggert de rol-vrijgave (`trg_order_events_snijplan_release`, mig 290) **niet** — die hangt aan een `order_events`-event. Daarom reset de wis-stap de rollen **expliciet** naar `beschikbaar`/`reststuk`. Spoor B (Task 4) herbevestigt daarna de status van de rollen uit het bestand.

---

## File Structure

| Bestand | Rol | Actie |
|---------|-----|-------|
| `import/snapshot_basta_voorraad.py` | Read-only snapshot van `producten` + `rollen` naar timestamped CSV (rollback-vangnet). | **Create** |
| `import/update_voorraad.py` | Vaste-maten voorraad-update. Wijzigt bronkolom H→D. | **Modify** |
| `import/herallocateer_open_orders.py` | Loopt over alle open orderregels en roept `herallocateer_orderregel` aan. | **Create** |
| `import/import_rollen_golive.py` | Éénmalige rollen-nulstand: missende producten aanmaken, rollen schoon inladen als `beschikbaar`, in_magazijn_sinds uit `Ltste Wijz`. | **Create** |
| `import/tests/test_rollen_golive.py` | Unit tests voor pure helpers van de rollen-import. | **Create** |
| `scripts/2026-06-08_wipe-snijplannen-golive.sql` | Éénmalig: productie-keten (snijplannen + afhankelijke) wissen + rollen vrijgeven, in één transactie. | **Create** |
| `docs/changelog.md` | Logboek-regel voor deze import-flow. | **Modify** |

Pure logica (datum-parsing, ontbrekende-producten-detectie, record-bouw) zit in losse functies zodat ze los van Supabase getest kunnen worden. DB-schrijvende paden zijn dry-run-first en worden geverifieerd via SQL-spotchecks (geen live-DB-mocks — past bij de bestaande import-scripts).

---

## Task 0: Branch + plan vastleggen

**Files:**
- Create: `docs/superpowers/plans/2026-06-08-voorraad-import-basta.md` (dit bestand)

- [ ] **Step 1: Maak de feature-branch**

```bash
git checkout -b feat/voorraad-import-basta
```

- [ ] **Step 2: Commit het plan**

```bash
git add docs/superpowers/plans/2026-06-08-voorraad-import-basta.md
git commit -m "docs: plan voor Basta voorraad-import (rollen + vaste maten)"
```

---

## Task 1: Veiligheids-snapshot (rollback-vangnet)

**Files:**
- Create: `import/snapshot_basta_voorraad.py`

Read-only dump van de huidige staat naar `import/snapshots/`, zodat een import 1-op-1 terugdraaibaar is. Geen tests nodig (read-only); verificatie = bestanden bestaan en bevatten rijen.

- [ ] **Step 1: Schrijf het snapshot-script**

Create `import/snapshot_basta_voorraad.py`:

```python
"""
Veiligheids-snapshot vóór een Basta-voorraad-import.

Dumpt de huidige producten- en rollen-staat naar timestamped CSV's in
import/snapshots/ zodat een import terugdraaibaar is. Read-only: raakt de DB
niet aan.

Gebruik:
  python snapshot_basta_voorraad.py
"""
from datetime import datetime
import csv

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

SNAPSHOT_DIR = BASE_DIR / "import" / "snapshots"


def _dump(sb, tabel, kolommen, pad):
    rows = []
    start = 0
    while True:
        r = sb.table(tabel).select(",".join(kolommen)).range(start, start + 999).execute()
        if not r.data:
            break
        rows.extend(r.data)
        if len(r.data) < 1000:
            break
        start += 1000
    with open(pad, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=kolommen, delimiter=";")
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k) for k in kolommen})
    return len(rows)


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("ERROR: import/.env met SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ontbreekt.")
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    p_prod = SNAPSHOT_DIR / f"producten_{ts}.csv"
    p_rol = SNAPSHOT_DIR / f"rollen_{ts}.csv"
    p_snij = SNAPSHOT_DIR / f"snijplannen_{ts}.csv"

    n_prod = _dump(
        sb, "producten",
        ["artikelnr", "product_type", "voorraad", "gereserveerd", "backorder", "vrije_voorraad"],
        p_prod,
    )
    n_rol = _dump(
        sb, "rollen",
        ["id", "rolnummer", "artikelnr", "status", "lengte_cm", "breedte_cm",
         "oppervlak_m2", "in_magazijn_sinds", "snijden_gestart_op"],
        p_rol,
    )
    n_snij = _dump(
        sb, "snijplannen",
        ["id", "snijplan_nr", "order_regel_id", "rol_id", "status",
         "lengte_cm", "breedte_cm", "afleverdatum"],
        p_snij,
    )
    print(f"Snapshot geschreven:")
    print(f"  {p_prod.name} ({n_prod} producten)")
    print(f"  {p_rol.name} ({n_rol} rollen)")
    print(f"  {p_snij.name} ({n_snij} snijplannen)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Draai het snapshot-script**

Run (vanuit de map `import/`):
```bash
python snapshot_basta_voorraad.py
```
Expected: drie CSV's in `import/snapshots/` (`producten_*`, `rollen_*`, `snijplannen_*`), met `producten_*` ≫ 0 rijen en `rollen_*` ≫ 0 rijen. Print toont aantallen. Dit is óók het enige vangnet vóór de snijplannen-wis (Task 5).

- [ ] **Step 3: Commit**

```bash
git add import/snapshot_basta_voorraad.py
git commit -m "feat(import): read-only voorraad-snapshot als rollback-vangnet"
```

---

## Task 2: Spoor A — vaste-maten voorraad uit kolom D (Voorraad)

**Files:**
- Modify: `import/update_voorraad.py`

Wijzig de bronkolom van H (`Vrije voorraad`) naar D (`Voorraad`, fysiek). De in-memory rij-sleutel `vrije_voorraad` wordt hernoemd naar `voorraad`; de DB-payload-kolommen (`voorraad`, `vrije_voorraad`, `gereserveerd`, `backorder`) blijven ongewijzigd als **baseline** — Spoor C herstelt daarna `gereserveerd`/`vrije_voorraad` voor producten met orders.

- [ ] **Step 1: Werk de docstring-beslissingen bij**

In `import/update_voorraad.py`, vervang in de docstring (regel ~11-12):

```python
  - Sleutel: kolom A 'Artikelnr' -> producten.artikelnr (PK).
  - Waarde:  kolom H 'Vrije voorraad'. Backorder/gereserveerd op 0.
```

door:

```python
  - Sleutel: kolom A 'Artikelnr' -> producten.artikelnr (PK).
  - Waarde:  kolom D 'Voorraad' (FYSIEK). Backorder/gereserveerd als baseline
    op 0; gereserveerd/vrije_voorraad worden voor producten MET open orders
    daarna hersteld door herallocateer_open_orders.py (RugFlow trekt de orders
    zelf af -> geen dubbel-aftrekken).
```

- [ ] **Step 2: Wijzig de kolom-constante**

Vervang regel 47:
```python
COL_VRIJE_VOORRAAD = 7
```
door:
```python
COL_VOORRAAD = 3  # kolom D 'Voorraad' (FYSIEK) — bewust NIET H 'Vrije voorraad' (7)
```

- [ ] **Step 3: Lees kolom D als `voorraad` in `lees_lijst`**

Vervang in `lees_lijst` (regel ~125):
```python
            "vrije_voorraad": num(sh.cell(r, COL_VRIJE_VOORRAAD).value),
```
door:
```python
            "voorraad": num(sh.cell(r, COL_VOORRAAD).value),
```

- [ ] **Step 4: Hernoem de rij-sleutel-reads (5 plekken)**

Vervang regel 225:
```python
            updates.append((artnr, max(0, actief[artnr]["vrije_voorraad"])))
```
door:
```python
            updates.append((artnr, max(0, actief[artnr]["voorraad"])))
```

Vervang regels 231-232:
```python
    nieuw = [x for x in nieuw_vast_alle if x["vrije_voorraad"] > 0]
    nieuw_vast_leeg = [x for x in nieuw_vast_alle if x["vrije_voorraad"] <= 0]
```
door:
```python
    nieuw = [x for x in nieuw_vast_alle if x["voorraad"] > 0]
    nieuw_vast_leeg = [x for x in nieuw_vast_alle if x["voorraad"] <= 0]
```

Vervang regel 268 (binnen `df_nieuw`):
```python
        "omschrijving": x["omschrijving"], "voorraad": x["vrije_voorraad"],
```
door:
```python
        "omschrijving": x["omschrijving"], "voorraad": x["voorraad"],
```

Vervang regel 272 (binnen `df_broadloom`):
```python
        "omschrijving": x["omschrijving"], "voorraad_meters": x["vrije_voorraad"],
```
door:
```python
        "omschrijving": x["omschrijving"], "voorraad_meters": x["voorraad"],
```

Vervang regel 346 (binnen `rec_new`):
```python
            "voorraad": x["vrije_voorraad"], "vrije_voorraad": x["vrije_voorraad"],
```
door:
```python
            "voorraad": x["voorraad"], "vrije_voorraad": x["voorraad"],
```

> Let op: de DB-payload op regel ~316 (`{"voorraad": v, "vrije_voorraad": v, "backorder": 0, "gereserveerd": 0}`) blijft ongewijzigd — dat zijn DB-kolomnamen, niet de rij-sleutel.

- [ ] **Step 5: Voeg een herallocatie-reminder toe aan het einde van `main`**

Vervang de laatste regel van `main` (regel 360):
```python
    print("\nKLAAR. DB bijgewerkt.")
```
door:
```python
    print("\nKLAAR. DB bijgewerkt.")
    print("LET OP: draai nu  python herallocateer_open_orders.py --commit")
    print("        zodat open orders zich opnieuw tegen de nieuwe voorraad reserveren.")
```

- [ ] **Step 6: Regressie-check op de kolom-constante**

Run (vanuit de map `import/`):
```bash
python -c "import update_voorraad as u; assert u.COL_VOORRAAD == 3; print('COL_VOORRAAD OK')"
```
Expected: `COL_VOORRAAD OK` (geen AttributeError, geen oude `COL_VRIJE_VOORRAAD`-referentie meer).

- [ ] **Step 7: Dry-run tegen het echte bestand**

Run (vanuit de map `import/`):
```bash
python update_voorraad.py "..\Voorraadlijst 08-6-2026 (1).xls"
```
Expected: geen crash; print toont `Lijst gelezen: 27489 data-rijen`; `--- SAMENVATTING ---` met `vast geupdatet (uit lijst)` > 0; rapport geschreven in `import/rapporten/`. Open het rapport-tabblad `Nieuw_vaste_maat` en controleer dat `voorraad` nu fysieke aantallen toont (kolom D), niet de lagere vrije-voorraad-waarden.

- [ ] **Step 8: Commit**

```bash
git add import/update_voorraad.py
git commit -m "feat(import): vaste-maten voorraad uit kolom D (fysiek) i.p.v. kolom H"
```

---

## Task 3: Spoor C — herallocatie van alle open orderregels

**Files:**
- Create: `import/herallocateer_open_orders.py`

`herallocateer_orderregel(p_order_regel_id)` is idempotent en slaat zelf maatwerk, admin-pseudo, `te_leveren<=0` en eind-status-orders over (mig 145/272). We hoeven die exclusielogica dus NIET in Python te dupliceren — alleen een goedkope voorfilter om het aantal RPC-calls te beperken.

- [ ] **Step 1: Schrijf het herallocatie-script**

Create `import/herallocateer_open_orders.py`:

```python
"""
Heralloceer alle OPEN orderregels zodat ze zich opnieuw tegen de actuele
voorraad reserveren. Draai NA een voorraad-update (update_voorraad.py).

De RPC herallocateer_orderregel is idempotent en slaat zelf maatwerk,
admin-pseudo, te_leveren<=0 en eind-status-orders over (mig 145/272). De
DB-triggers herberekenen daarna producten.gereserveerd + vrije_voorraad.

Gebruik:
  python herallocateer_open_orders.py            # DRY-RUN (telt alleen)
  python herallocateer_open_orders.py --commit   # roept de RPC per regel aan
"""
import sys

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

EINDSTATUSSEN = {"Verzonden", "Geannuleerd", "Klaar voor verzending"}


def fetch_open_order_ids(sb):
    """Order-id's die NIET in een eindstatus staan."""
    ids = []
    start = 0
    while True:
        r = sb.table("orders").select("id,status").range(start, start + 999).execute()
        if not r.data:
            break
        ids += [o["id"] for o in r.data if (o["status"] or "") not in EINDSTATUSSEN]
        if len(r.data) < 1000:
            break
        start += 1000
    return ids


def fetch_te_herallocateren_regels(sb, open_order_ids):
    """Orderregel-id's met te_leveren>0, een artikelnr en geen maatwerk."""
    regel_ids = []
    for i in range(0, len(open_order_ids), 100):
        chunk = open_order_ids[i:i + 100]
        r = (sb.table("order_regels")
             .select("id,artikelnr,te_leveren,is_maatwerk")
             .in_("order_id", chunk).gt("te_leveren", 0).execute())
        for x in r.data:
            if x.get("artikelnr") and not x.get("is_maatwerk"):
                regel_ids.append(x["id"])
    return regel_ids


def main():
    commit = "--commit" in sys.argv
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("ERROR: import/.env ontbreekt (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).")
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    open_ids = fetch_open_order_ids(sb)
    regel_ids = fetch_te_herallocateren_regels(sb, open_ids)
    print(f"Open orders: {len(open_ids)}  |  te herallokeren orderregels: {len(regel_ids)}")

    if not commit:
        print("DRY-RUN: geen RPC-aanroepen. Draai met --commit om te schrijven.")
        return

    fouten = 0
    for n, rid in enumerate(regel_ids, 1):
        try:
            sb.rpc("herallocateer_orderregel", {"p_order_regel_id": rid}).execute()
        except Exception as e:  # noqa: BLE001 — best-effort, log en ga door
            fouten += 1
            print(f"  FOUT regel {rid}: {e}")
        if n % 100 == 0:
            print(f"  {n}/{len(regel_ids)}")
    print(f"KLAAR. {len(regel_ids) - fouten} ok, {fouten} fouten.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Dry-run**

Run (vanuit de map `import/`):
```bash
python herallocateer_open_orders.py
```
Expected: print toont `Open orders: N  |  te herallokeren orderregels: M` met plausibele aantallen; geen crash; meldt DRY-RUN.

- [ ] **Step 3: Commit**

```bash
git add import/herallocateer_open_orders.py
git commit -m "feat(import): herallocatie van open orderregels na voorraad-update"
```

---

## Task 4: Spoor B — éénmalige rollen-nulstand (go-live)

**Files:**
- Create: `import/import_rollen_golive.py`
- Test: `import/tests/test_rollen_golive.py`

Bouwt voort op de bewezen kolom-mapping van `sync_rollen_voorraad.py` (importeert `parse_karpi_code`), maar voegt toe: (a) bestandspad als CLI-argument, (b) `in_magazijn_sinds` uit `Ltste Wijz`, (c) ontbrekende rol-producten aanmaken, (d) alle bestands-rollen forceren naar `status='beschikbaar'` (reserveringen wissen), (e) veiligheidscheck op `app_config.snijplanning.auto_planning.enabled`.

### Pure helpers eerst (TDD)

- [ ] **Step 1: Schrijf de falende tests**

Create `import/tests/test_rollen_golive.py`:

```python
import pandas as pd

from import_rollen_golive import (
    parse_in_magazijn_sinds,
    bouw_insert_record,
    bepaal_ontbrekende_producten,
)


# ── parse_in_magazijn_sinds ────────────────────────────────────────────────

def test_parse_in_magazijn_sinds_geldig():
    assert parse_in_magazijn_sinds(20260602) == "2026-06-02"
    assert parse_in_magazijn_sinds("20251027") == "2025-10-27"
    assert parse_in_magazijn_sinds(20260602.0) == "2026-06-02"  # excel float


def test_parse_in_magazijn_sinds_leeg_of_ongeldig():
    assert parse_in_magazijn_sinds(None) is None
    assert parse_in_magazijn_sinds(float("nan")) is None
    assert parse_in_magazijn_sinds(0) is None
    assert parse_in_magazijn_sinds("") is None
    assert parse_in_magazijn_sinds("2026") is None        # te kort
    assert parse_in_magazijn_sinds(20261302) is None      # maand 13 -> ongeldig


# ── bouw_insert_record ─────────────────────────────────────────────────────

def test_bouw_insert_record_status_en_velden():
    r = pd.Series({
        "rolnummer": "AEST13 01", "artikelnr": "1487001",
        "karpi_code": "AEST13400SYN", "omschrijving": "AESTHETIC KLEUR 13 400",
        "lengte_cm": 1500, "breedte_cm": 400, "oppervlak_m2": 60.0,
        "vvp_m2": 34.67, "waarde": 2080.2,
        "kwaliteit_code": "AEST", "kleur_code": "13", "zoeksleutel": "AEST_13",
        "in_magazijn_sinds": "2026-06-02",
    })
    rec = bouw_insert_record(r)
    assert rec["status"] == "beschikbaar"
    assert rec["rolnummer"] == "AEST13 01"
    assert rec["artikelnr"] == "1487001"
    assert rec["lengte_cm"] == 1500
    assert rec["breedte_cm"] == 400
    assert rec["in_magazijn_sinds"] == "2026-06-02"
    assert "rol_type" not in rec  # wordt door DB-trigger gezet


# ── bepaal_ontbrekende_producten ───────────────────────────────────────────

def test_bepaal_ontbrekende_producten_filtert_en_dedupt():
    df = pd.DataFrame([
        {"artikelnr": "111", "karpi_code": "AAA10400SYN", "omschrijving": "A",
         "kwaliteit_code": "AAA", "kleur_code": "10", "zoeksleutel": "AAA_10",
         "vvp_m2": 1.0},
        {"artikelnr": "111", "karpi_code": "AAA10400SYN", "omschrijving": "A",
         "kwaliteit_code": "AAA", "kleur_code": "10", "zoeksleutel": "AAA_10",
         "vvp_m2": 1.0},  # dubbel artikelnr -> 1x
        {"artikelnr": "222", "karpi_code": "BBB20400SYN", "omschrijving": "B",
         "kwaliteit_code": "BBB", "kleur_code": "20", "zoeksleutel": "BBB_20",
         "vvp_m2": 2.0},
    ])
    bestaande = {"222"}  # 222 bestaat al
    ontbrekend = bepaal_ontbrekende_producten(df, bestaande)
    assert [p["artikelnr"] for p in ontbrekend] == ["111"]
```

- [ ] **Step 2: Draai de tests om te zien dat ze falen**

Run (vanuit de map `import/`):
```bash
python -m pytest tests/test_rollen_golive.py -v
```
Expected: FAIL met `ModuleNotFoundError: No module named 'import_rollen_golive'`.

### Implementatie

- [ ] **Step 3: Schrijf het rollen-go-live-script**

Create `import/import_rollen_golive.py`:

```python
"""
ÉÉNMALIGE rollen-nulstand (go-live) — fysieke rollen uit Basta inladen.

Leest 'Rollenvoorraad <datum>.xlsx' en zet tabel `rollen` gelijk aan de
fysieke werkelijkheid:
  - missende rol-producten worden aangemaakt (product_type='rol') + gerapporteerd;
  - elke rol uit het bestand komt binnen als status='beschikbaar' (bestaande
    reservering/snijplan-holds worden gewist — maatwerk wordt via een aparte
    route herladen);
  - in_magazijn_sinds wordt uit 'Ltste Wijz' (YYYYMMDD) gezet (FIFO, ADR-0021);
  - rollen die NIET in het bestand staan worden afgevoerd (status='verkocht').

VEILIGHEID: een INSERT/status->beschikbaar op rollen triggert auto-planning
(mig 100/111) ALS app_config.snijplanning.auto_planning.enabled aan staat.
Het script weigert te schrijven als dat zo is, tenzij --force-auto-plan.

Gebruik:
  python import_rollen_golive.py "..\\Rollenvoorraad 08-06-2026 (1).xlsx"
  python import_rollen_golive.py "..\\Rollenvoorraad 08-06-2026 (1).xlsx" --apply
"""
import argparse
from datetime import date
from pathlib import Path

import pandas as pd
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY
from sync_rollen_voorraad import parse_karpi_code
from lib.normalize import clean_value as _clean


# ── pure helpers ───────────────────────────────────────────────────────────

def parse_in_magazijn_sinds(v):
    """Ltste Wijz (YYYYMMDD als getal/tekst) -> 'YYYY-MM-DD' of None."""
    if v is None:
        return None
    if isinstance(v, float):
        if pd.isna(v):
            return None
        v = int(v)
    s = str(v).strip().split(".")[0]
    if len(s) != 8 or not s.isdigit():
        return None
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:8])).isoformat()
    except ValueError:
        return None


def bouw_insert_record(r):
    return {
        "rolnummer": str(r["rolnummer"]),
        "artikelnr": _clean(r["artikelnr"]),
        "karpi_code": _clean(r["karpi_code"]),
        "omschrijving": _clean(r["omschrijving"]),
        "lengte_cm": int(r["lengte_cm"]) if pd.notna(r["lengte_cm"]) else None,
        "breedte_cm": int(r["breedte_cm"]) if pd.notna(r["breedte_cm"]) else None,
        "oppervlak_m2": _clean(r["oppervlak_m2"]),
        "vvp_m2": _clean(r["vvp_m2"]),
        "waarde": _clean(r["waarde"]),
        "kwaliteit_code": _clean(r["kwaliteit_code"]),
        "kleur_code": _clean(r["kleur_code"]),
        "zoeksleutel": _clean(r["zoeksleutel"]),
        "in_magazijn_sinds": r["in_magazijn_sinds"],
        "status": "beschikbaar",
    }


def bouw_update_record(r):
    """Update bestaande rol: dims/waarde verversen EN reservering wissen."""
    return {
        "lengte_cm": int(r["lengte_cm"]) if pd.notna(r["lengte_cm"]) else None,
        "breedte_cm": int(r["breedte_cm"]) if pd.notna(r["breedte_cm"]) else None,
        "oppervlak_m2": _clean(r["oppervlak_m2"]),
        "vvp_m2": _clean(r["vvp_m2"]),
        "waarde": _clean(r["waarde"]),
        "in_magazijn_sinds": r["in_magazijn_sinds"],
        "status": "beschikbaar",
        "snijden_gestart_op": None,
    }


def bepaal_ontbrekende_producten(df, bestaande_artnr):
    """Rol-artikelen uit de bron die nog niet in producten staan (dedup)."""
    out = {}
    for _, r in df.iterrows():
        a = r["artikelnr"]
        if a and a not in bestaande_artnr and a not in out:
            out[a] = {
                "artikelnr": a,
                "karpi_code": _clean(r["karpi_code"]),
                "omschrijving": _clean(r["omschrijving"]),
                "kwaliteit_code": r["kwaliteit_code"],
                "kleur_code": r["kleur_code"],
                "zoeksleutel": r["zoeksleutel"],
                "vvp_m2": _clean(r["vvp_m2"]),
            }
    return list(out.values())


# ── bron + DB ──────────────────────────────────────────────────────────────

def load_bron(path):
    df = pd.read_excel(path)
    df = df.rename(columns={
        "Artikelnr": "artikelnr", "Karpi-code": "karpi_code",
        "Omschrijving": "omschrijving", "VVP m2": "vvp_m2",
        "Rolnummer": "rolnummer", "Lengte (m)": "lengte_m",
        "Breedte (m)": "breedte_m", "Oppervlak": "oppervlak_m2",
        "Waarde": "waarde", "Ltste Wijz": "ltste_wijz",
    })
    df["rolnummer"] = df["rolnummer"].astype(str).str.strip()
    df["artikelnr"] = df["artikelnr"].apply(lambda v: str(int(v)) if pd.notna(v) else None)
    df["lengte_cm"] = (df["lengte_m"] * 100).round().astype("Int64")
    df["breedte_cm"] = (df["breedte_m"] * 100).round().astype("Int64")
    df["in_magazijn_sinds"] = df["ltste_wijz"].apply(parse_in_magazijn_sinds)
    parsed = df["karpi_code"].apply(parse_karpi_code)
    df["kwaliteit_code"] = parsed.apply(lambda t: t[0])
    df["kleur_code"] = parsed.apply(lambda t: t[1])
    df["zoeksleutel"] = parsed.apply(lambda t: t[2])
    df = df.drop_duplicates(subset=["rolnummer"], keep="first")
    return df


def _fetch_kolomset(sb, tabel, kol, extra_select=None):
    out = set()
    start = 0
    sel = kol if extra_select is None else f"{kol},{extra_select}"
    while True:
        r = sb.table(tabel).select(sel).range(start, start + 999).execute()
        if not r.data:
            break
        out.update(str(x[kol]) for x in r.data if x[kol] is not None)
        if len(r.data) < 1000:
            break
        start += 1000
    return out


def fetch_huidige_rollen(sb):
    rows = []
    start = 0
    while True:
        r = (sb.table("rollen")
             .select("id,rolnummer,status").range(start, start + 999).execute())
        if not r.data:
            break
        rows.extend(r.data)
        if len(r.data) < 1000:
            break
        start += 1000
    return {h["rolnummer"]: h for h in rows}


def auto_planning_aan(sb):
    r = (sb.table("app_config").select("waarde")
         .eq("sleutel", "snijplanning.auto_planning").execute())
    if not r.data:
        return False
    return bool((r.data[0].get("waarde") or {}).get("enabled"))


def maak_rol_producten(sb, ontbrekend, geldige_kwal):
    records = []
    for p in ontbrekend:
        kwal = p["kwaliteit_code"] if p["kwaliteit_code"] in geldige_kwal else None
        records.append({
            "artikelnr": p["artikelnr"], "karpi_code": p["karpi_code"],
            "omschrijving": p["omschrijving"] or p["karpi_code"],
            "voorraad": 0, "vrije_voorraad": 0, "backorder": 0, "gereserveerd": 0,
            "kwaliteit_code": kwal, "kleur_code": p["kleur_code"],
            "zoeksleutel": p["zoeksleutel"],
            "product_type": "rol", "actief": True,
        })
    for i in range(0, len(records), 500):
        sb.table("producten").insert(records[i:i + 500]).execute()
    return records


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bestand", help="pad naar Rollenvoorraad <datum>.xlsx")
    ap.add_argument("--apply", action="store_true", help="daadwerkelijk schrijven")
    ap.add_argument("--force-auto-plan", action="store_true",
                    help="schrijf ook als auto-planning aan staat (NIET aanbevolen)")
    args = ap.parse_args()

    pad = Path(args.bestand)
    if not pad.is_absolute():
        pad = (Path.cwd() / pad).resolve()
    if not pad.exists():
        raise SystemExit(f"ERROR: bestand niet gevonden: {pad}")
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("ERROR: import/.env ontbreekt (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).")

    print("=" * 64)
    print(f"ROLLEN GO-LIVE  ({'APPLY' if args.apply else 'DRY-RUN'})")
    print(f"Bestand: {pad.name}")
    print("=" * 64)

    df = load_bron(pad)
    print(f"Bron: {len(df)} unieke rollen, {df['artikelnr'].nunique()} artikelen")

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    bestaande_artnr = _fetch_kolomset(sb, "producten", "artikelnr")
    geldige_kwal = _fetch_kolomset(sb, "kwaliteiten", "code")
    ontbrekend = bepaal_ontbrekende_producten(df, bestaande_artnr)
    zonder_kwal = [p for p in ontbrekend if p["kwaliteit_code"] not in geldige_kwal]

    huidig = fetch_huidige_rollen(sb)
    bron_rolnrs = set(df["rolnummer"])
    nieuw = [r for _, r in df.iterrows() if r["rolnummer"] not in huidig]
    bestaat = [r for _, r in df.iterrows() if r["rolnummer"] in huidig]
    afvoeren = [h for rolnr, h in huidig.items() if rolnr not in bron_rolnrs]

    print("\n--- SAMENVATTING ---")
    print(f"  ontbrekende rol-producten aanmaken : {len(ontbrekend)}"
          f"  (zonder geldige kwaliteit: {len(zonder_kwal)})")
    print(f"  rollen NIEUW (insert)              : {len(nieuw)}")
    print(f"  rollen BESTAAND (refresh+reset)    : {len(bestaat)}")
    print(f"  rollen AFVOEREN (-> verkocht)      : {len(afvoeren)}")

    if not args.apply:
        print("\nDRY-RUN: geen DB-wijzigingen. Draai met --apply om te schrijven.")
        return

    if auto_planning_aan(sb) and not args.force_auto_plan:
        raise SystemExit(
            "GESTOPT: app_config.snijplanning.auto_planning.enabled staat AAN.\n"
            "Een bulk-insert/status-reset zou auto-planning triggeren (mig 100/111).\n"
            "Zet 'enabled' op false vóór de import, of draai met --force-auto-plan."
        )

    print("\n--- SCHRIJVEN NAAR SUPABASE ---")

    if ontbrekend:
        maak_rol_producten(sb, ontbrekend, geldige_kwal)
        print(f"  rol-producten aangemaakt: {len(ontbrekend)}")

    if nieuw:
        records = [bouw_insert_record(r) for r in nieuw]
        for i in range(0, len(records), 500):
            sb.table("rollen").insert(records[i:i + 500]).execute()
            print(f"  insert rollen: {min(i + 500, len(records))}/{len(records)}")

    for idx, r in enumerate(bestaat, 1):
        sb.table("rollen").update(bouw_update_record(r)).eq(
            "rolnummer", str(r["rolnummer"])).execute()
        if idx % 100 == 0:
            print(f"  refresh rollen: {idx}/{len(bestaat)}")

    if afvoeren:
        ids = [h["id"] for h in afvoeren]
        for i in range(0, len(ids), 500):
            sb.table("rollen").update({"status": "verkocht"}).in_(
                "id", ids[i:i + 500]).execute()
            print(f"  afvoeren: {min(i + 500, len(ids))}/{len(ids)}")

    print("\nKLAAR. Rollen-nulstand toegepast.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Draai de tests om te zien dat ze slagen**

Run (vanuit de map `import/`):
```bash
python -m pytest tests/test_rollen_golive.py -v
```
Expected: PASS (3 tests: `test_parse_in_magazijn_sinds_geldig`, `test_parse_in_magazijn_sinds_leeg_of_ongeldig`, `test_bouw_insert_record_status_en_velden`, `test_bepaal_ontbrekende_producten_filtert_en_dedupt`).

- [ ] **Step 5: Dry-run tegen het echte bestand**

Run (vanuit de map `import/`):
```bash
python import_rollen_golive.py "..\Rollenvoorraad 08-06-2026 (1).xlsx"
```
Expected: print `Bron: 1410 unieke rollen, 420 artikelen`; `--- SAMENVATTING ---` met plausibele aantallen voor aanmaken/insert/refresh/afvoeren; meldt DRY-RUN. Noteer hoeveel ontbrekende rol-producten en hoeveel "zonder geldige kwaliteit" — dat is de match-rapportage die aan de gebruiker beloofd is.

- [ ] **Step 6: Commit**

```bash
git add import/import_rollen_golive.py import/tests/test_rollen_golive.py
git commit -m "feat(import): eenmalige rollen-nulstand (go-live) met productie-aanmaak + FIFO-datum"
```

---

## Task 5: Snijplannen-keten wissen + rollen vrijgeven (go-live, éénmalig)

**Files:**
- Create: `scripts/2026-06-08_wipe-snijplannen-golive.sql`

Wist in één transactie de hele productie-keten en geeft betrokken rollen vrij, zodat alle reserveringen weg zijn (inclusief snijplannen). Delete-volgorde gespiegeld van [`supabase/scripts/2026-05-31_cleanup_testdata.sql`](../../supabase/scripts/2026-05-31_cleanup_testdata.sql) regels 109-114. Raakt orders/facturen/zendingen NIET aan. Draai dit ná Task 1 (snapshot) en vóór Task 4 (`--apply`).

- [ ] **Step 1: Schrijf het wis-script**

Create `scripts/2026-06-08_wipe-snijplannen-golive.sql`:

```sql
-- ============================================================================
-- GO-LIVE EENMALIG (2026-06-08): productie-keten wissen + rollen vrijgeven.
--   Onderdeel van de Basta voorraad-import (rollen-nulstand). Wist ALLE
--   snijplannen + afhankelijke tabellen en zet betrokken rollen terug op
--   'beschikbaar'/'reststuk'. De maatwerk-route herbouwt snijplannen daarna.
--
--   Delete-volgorde gespiegeld van supabase/scripts/2026-05-31_cleanup_testdata.sql:109-114
--   (snijplannen.order_regel_id én .rol_id zijn ON DELETE RESTRICT; kind-tabellen
--   confectie_orders / snijvoorstel_plaatsingen dus EERST). Orders/facturen/
--   zendingen blijven ongemoeid.
--
--   Een directe DELETE FROM snijplannen triggert de rol-vrijgave (mig 290) NIET
--   (die hangt aan order_events) -> rollen worden hier EXPLICIET gereset.
--
--   Draai bij voorkeur in psql; controleer de NA-tellingen vóór COMMIT.
-- ============================================================================

-- COUNT VOOR
SELECT 'VOOR' AS fase, tabel, aantal FROM (
  SELECT 'snijplannen' AS tabel, COUNT(*) AS aantal FROM snijplannen
  UNION ALL SELECT 'confectie_orders', COUNT(*) FROM confectie_orders
  UNION ALL SELECT 'snijvoorstel_plaatsingen', COUNT(*) FROM snijvoorstel_plaatsingen
  UNION ALL SELECT 'snijvoorstellen', COUNT(*) FROM snijvoorstellen
  UNION ALL SELECT 'rollen_bezet',
       COUNT(*) FROM rollen
       WHERE status IN ('in_snijplan','gesneden','gereserveerd')
          OR snijden_gestart_op IS NOT NULL
) t ORDER BY tabel;

BEGIN;

-- 1. Productie-keten (kind -> ouder)
DELETE FROM confectie_orders;
DELETE FROM snijvoorstel_plaatsingen;
DELETE FROM snijvoorstellen;
DELETE FROM snijplannen;
DELETE FROM snijplan_groep_locks;
DELETE FROM scan_events;

-- 2. Rollen expliciet vrijgeven
UPDATE rollen
SET status = CASE WHEN rol_type = 'reststuk' THEN 'reststuk' ELSE 'beschikbaar' END,
    snijden_gestart_op   = NULL,
    snijden_voltooid_op  = NULL,
    snijden_gestart_door = NULL
WHERE status IN ('in_snijplan','gesneden','gereserveerd')
   OR snijden_gestart_op IS NOT NULL;

-- COUNT NA (binnen de transactie — alles 0 verwacht)
SELECT 'NA' AS fase, tabel, aantal FROM (
  SELECT 'snijplannen' AS tabel, COUNT(*) AS aantal FROM snijplannen
  UNION ALL SELECT 'confectie_orders', COUNT(*) FROM confectie_orders
  UNION ALL SELECT 'snijvoorstel_plaatsingen', COUNT(*) FROM snijvoorstel_plaatsingen
  UNION ALL SELECT 'rollen_bezet',
       COUNT(*) FROM rollen
       WHERE status IN ('in_snijplan','gesneden','gereserveerd')
          OR snijden_gestart_op IS NOT NULL
) t ORDER BY tabel;

COMMIT;
-- Tellingen NIET 0 of onverwacht? Vervang COMMIT door ROLLBACK en onderzoek.
```

- [ ] **Step 2: Uitvoeren (na bevestiging) en NA-tellingen controleren**

Draai het script in psql/Supabase SQL-editor tegen de Karpi-DB. Expected: de `NA`-tellingen voor `snijplannen`, `confectie_orders`, `snijvoorstel_plaatsingen` en `rollen_bezet` zijn allemaal **0**. Bij een FK-fout: transactie rolt terug — onderzoek welke tabel nog naar `snijplannen` verwijst en voeg die als eerdere DELETE toe.

- [ ] **Step 3: Commit het script**

```bash
git add scripts/2026-06-08_wipe-snijplannen-golive.sql
git commit -m "feat(scripts): go-live wis-script productie-keten + rollen vrijgeven"
```

---

## Task 6: Runbook + verificatie + docs

**Files:**
- Modify: `docs/changelog.md`

Geen nieuwe code — dit legt de uitvoervolgorde en de na-controle vast, en werkt het levende changelog bij (CLAUDE.md-verplichting).

- [ ] **Step 1: Voeg een runbook toe aan de changelog**

In `docs/changelog.md`, voeg bovenaan (onder de meest recente datum-kop, of een nieuwe `## 2026-06-08`-kop) toe:

```markdown
## 2026-06-08 — Basta voorraad-import (rollen + vaste maten)

Eénmalige go-live nulstand + wekelijkse vaste-maten-update vanuit Basta-exports.
Scripts in `import/`. Uitvoervolgorde (eerst dry-run, dan --apply/--commit):

1. `python snapshot_basta_voorraad.py`                                  (rollback-vangnet, ook vóór snijplannen-wis)
2. `scripts/2026-06-08_wipe-snijplannen-golive.sql`                     (éénmalig; productie-keten leeg + rollen vrij)
3. `python import_rollen_golive.py "..\Rollenvoorraad 08-06-2026 (1).xlsx" --apply`
   - éénmalig; vereist app_config.snijplanning.auto_planning.enabled = false
4. `python update_voorraad.py "..\Voorraadlijst 08-6-2026 (1).xls" --commit`  (wekelijks)
5. `python herallocateer_open_orders.py --commit`                       (orders trekken zich af)

Beslissingen: vaste maten uit kolom D (fysiek), niet H; rollen schoon als
'beschikbaar' (alle reserveringen gewist, **incl. snijplannen** — maatwerk via
aparte route); ontbrekende rol-producten auto-aangemaakt als product_type='rol'.
```

- [ ] **Step 2: Verificatie-spotchecks na een echte `--apply`/`--commit`-run**

Draai deze controles (via Supabase SQL-editor of `psql`) ná stap 2-4 van het runbook. Documenteer de uitkomsten:

```sql
-- A. Rollen-totaal moet matchen met de bron (~1410 rollen, ~62.766 m²).
SELECT COUNT(*) AS rollen, ROUND(SUM(oppervlak_m2), 1) AS m2
FROM rollen WHERE status NOT IN ('verkocht', 'gesneden');

-- B. Geen rol meer zonder in_magazijn_sinds onder de zojuist geladen set.
SELECT COUNT(*) FROM rollen
WHERE status = 'beschikbaar' AND in_magazijn_sinds IS NULL;

-- C. Vrije voorraad-formule klopt voor een steekproef vaste maten met orders.
SELECT artikelnr, voorraad, gereserveerd, backorder, vrije_voorraad
FROM producten
WHERE product_type = 'vast' AND gereserveerd > 0
ORDER BY gereserveerd DESC LIMIT 10;
-- Verwacht: vrije_voorraad = voorraad - gereserveerd - backorder.

-- D. gereserveerd op producten == SUM actieve voorraad-claims (geen drift).
SELECT p.artikelnr, p.gereserveerd,
       COALESCE(SUM(r.aantal), 0) AS claim_som
FROM producten p
LEFT JOIN order_reserveringen r
  ON r.fysiek_artikelnr = p.artikelnr AND r.bron = 'voorraad' AND r.status = 'actief'
WHERE p.product_type = 'vast'
GROUP BY p.artikelnr, p.gereserveerd
HAVING p.gereserveerd <> COALESCE(SUM(r.aantal), 0)
LIMIT 20;
-- Verwacht: 0 rijen (gereserveerd in sync met claims).
```

Expected: A ≈ bron-totalen; B = 0; C bevestigt de formule; D geeft 0 rijen.

- [ ] **Step 3: Commit**

```bash
git add docs/changelog.md
git commit -m "docs(changelog): runbook + verificatie voor Basta voorraad-import"
```

---

## Self-Review (uitgevoerd)

**Spec-dekking:**
- Vaste maten fysiek (kolom D) inladen → Task 2. ✅
- Orders eraf halen (herallocatie) → Task 3 + runbook stap 4. ✅
- Rollen éénmalig schoon als 'beschikbaar', reserveringen gewist → Task 4 (`bouw_update_record` forceert status + `snijden_gestart_op=NULL`). ✅
- Alle reserveringen weg **incl. snijplannen** → Task 5 (productie-keten leeg + expliciete rollen-reset). ✅
- Ontbrekende rol-producten aanmaken + rapporteren → Task 4 (`bepaal_ontbrekende_producten` + `maak_rol_producten`, dry-run print). ✅
- in_magazijn_sinds uit Ltste Wijz → Task 4 (`parse_in_magazijn_sinds`). ✅
- Terugkerend (vaste maten) vs éénmalig (rollen) → Task 2 ongewijzigd herbruikbaar; Task 4 go-live. ✅
- Veiligheid/terugdraaibaarheid → Task 1 snapshot. ✅
- Artikelnr-match-rapportage (belofte aan gebruiker) → Task 4 dry-run print "ontbrekende rol-producten". ✅

**Type-consistentie:** `parse_in_magazijn_sinds`, `bouw_insert_record`, `bepaal_ontbrekende_producten` identiek gebruikt in tests (Task 4 Step 1) en implementatie (Step 3). RPC-naam `herallocateer_orderregel` met param `p_order_regel_id` consistent met mig 145. `COL_VOORRAAD` consistent in Task 2.

**Placeholder-scan:** geen TBD/TODO; alle code volledig uitgeschreven.

**Beslissing verwerkt:** snijplannen-opruim is nu Task 5 (bevestigd: alle reserveringen weg incl. snijplannen). Runbook-volgorde: snapshot → snijplannen-wis → rollen go-live → vaste maten → herallocatie → verificatie.
