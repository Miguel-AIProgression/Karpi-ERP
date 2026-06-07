# Verbeterplan: gedeelde `import/lib/`-helpers (dedup Python import-scripts)

**Datum:** 2026-06-07
**Verbeterpunt:** #5 uit code-review — "Python import-helpers massaal gekopieerd"
**Status:** ✅ uitgevoerd 2026-06-07 (Fase 0–4; 51 unit-tests groen, alle 14 lokale `upsert_batch` weg)

---

## 1. Geverifieerde bevindingen (vs. oorspronkelijke claim)

De claim is **grotendeels correct**, met een paar belangrijke nuances. Geverifieerd tegen de echte scripts onder `import/`.

| Claim | Verdict | Geverifieerd feit |
|---|---|---|
| `upsert_batch()` ~13× | ✅ **bevestigd, eerder ~14×** | 14 lokale definities, geen enkele geïmporteerd uit gedeelde module |
| `reimport_orders_2026.py` gebruikt `.insert()` i.p.v. `.upsert()` | ✅ **bevestigd — grootste risico** | [`reimport_orders_2026.py:39`](../../import/reimport_orders_2026.py) — gelijke naam `upsert_batch`, mist `on_conflict`, roept `.insert()` aan |
| `norm()` 3× | ✅ **bevestigd** | 2 byte-identiek, 1 functioneel gelijk (andere implementatie) |
| `_clean()` 2× identiek | ⚠️ **deels onjuist** | Er zijn **3** `_clean`-definities; 2 byte-identiek, 1 cosmetisch anders |
| `clean()` 4× licht afwijkend | ✅ **bevestigd** | 3 zijn varianten (datum-formaat verschilt); de 4e is een ándere functie die toevallig `clean` heet |
| `clean_gln`, `clean_numpy` voorgesteld | ⚠️ **gemengd** | `clean_gln` bestaat 3× (alle 3 verschillend); `clean_numpy` **bestaat niet** — de logica heet `clean`/`_clean` |
| `batch_delete`, `batch_select` voorgesteld | ⚠️ **niet gedupliceerd** | Beide bestaan **1×** in [`sync_inkoopoverzicht_2026_06.py`](../../import/sync_inkoopoverzicht_2026_06.py); 0 dedup-winst nu, wél hergebruik-waarde |
| `import/lib/` ontbreekt | ❌ **onjuist** | `import/lib/` bestaat al (met `snijlijst_parser.py` + `strip_allocator.py`); `__init__.py` is leeg. Logische plek om uit te breiden |
| ~200 regels besparing | ⚠️ **optimistisch** | Realistisch netto **~130–150 regels** pure dedup; ~200 alleen als ook losse inline bulk-patronen meegemigreerd worden |

### Het echte risico: stille gedragsafwijking
[`reimport_orders_2026.py:39`](../../import/reimport_orders_2026.py) definieert `upsert_batch(table, records, batch_size=500)` maar voert `sb.table(table).insert(batch)` uit. Onder een naam die "upsert" belooft, doet dit een pure insert → bij her-import van bestaande sleutels een unique-conflict i.p.v. update. Dit is precies waarom één gedeelde, expliciete helper waardevoller is dan de regelbesparing zelf.

### Duplicatie-clusters van `upsert_batch` (14×)
- **Cluster A** (4×) — kwargs-dict + per-batch progress print: `import_orders_full.py:32`, `prijslijst_update_2026.py:43`, `prijslijst_import.py:38`, `supabase_import.py:67`
- **Cluster B** (6×) — ternary kwargs + totaal-print: `import_prijslijst0248/0219/0254/0253/0252.py`, `import_prijslijst0149_hornbach.py`
- **Cluster C** (3×) — getypeerd, module-constante `BATCH`: `import_prijslijsten_nieuw.py:170`, `import_prijslijst_hornbach.py:126`, `import_prijslijsten_aanvulling.py:171`
- **Afwijker** (1×) — `.insert()`: `reimport_orders_2026.py:39`

---

## 2. Doel & scope

**Doel:** één bron van waarheid voor batch-/normalisatie-gedrag in import-scripts, met de `.insert`-vs-`.upsert`-afwijking zichtbaar i.p.v. verstopt.

**In scope (geverifieerde duplicatie):**
- `upsert_batch` → `import/lib/supabase_helpers.py`
- `norm`, `clean`/`_clean` (numpy-opschoning), `clean_gln` → `import/lib/normalize.py`
- `batch_delete`/`batch_select` → meeverhuizen voor hergebruik (geen dedup-winst, wél centraal)
- Supabase-client-init + env-validatie (nu ~13× herhaald) → `create_supabase_client()`

**Buiten scope (script-specifieke domeinlogica — NIET delen):**
- `_clean_prijs` (komma-decimaal), `clean_postcode`, `normalise_inkc`, `normalize_naam`, `keten_naam`, `build_*_map`, gepagineerde `fetch_*` met afwijkende velden/tabellen.

---

## 3. Ontwerp van de gedeelde module

```
import/lib/
  __init__.py            ← exporteer publieke helpers
  supabase_helpers.py    ← create_supabase_client, upsert_batch, insert_batch, batch_delete, batch_select
  normalize.py           ← norm, clean_value, clean_gln
  snijlijst_parser.py    ← (bestaat al)
  strip_allocator.py     ← (bestaat al)
```

### `supabase_helpers.py`
```python
def upsert_batch(sb, table, records, batch_size=500, on_conflict=None, *, mode="upsert"):
    """Schrijf records in batches. mode='upsert' (default) of 'insert'."""
    total = len(records)
    for i in range(0, total, batch_size):
        batch = records[i:i + batch_size]
        q = sb.table(table)
        if mode == "insert":
            q.insert(batch).execute()
        else:
            kwargs = {"on_conflict": on_conflict} if on_conflict else {}
            q.upsert(batch, **kwargs).execute()
        print(f"  {table}: {min(i + batch_size, total)}/{total}")
```
- `sb` wordt **expliciet eerste parameter** (geen verborgen globale) — sluit aan op Cluster C / aanvulling-variant en is testbaar.
- `reimport_orders_2026.py` roept voortaan aan met `mode="insert"` → het afwijkende gedrag is nu **expliciet en zichtbaar**, geen stille verrassing.
- `batch_delete(sb, table, field, ids, size=200)` en `batch_select(sb, table, cols, in_field, ids, size=200)` één-op-één overgenomen uit `sync_inkoopoverzicht_2026_06.py`.

### `normalize.py`
```python
def norm(s):
    """Trim, collapse interne whitespace, uppercase, None-safe."""
    return re.sub(r"\s+", " ", (s or "").strip().upper())

def clean_value(v, *, date_fmt=None):
    """numpy/NaN/NaT → Python-scalar of None. date_fmt='%Y-%m-%d' of 'iso' optioneel."""
    ...

def clean_gln(g, *, strict=False):
    """Strip Excel '.0'-artefact. strict=True verwijdert óók alle niet-cijfers (Transus)."""
    ...
```
- `clean_gln(strict=...)` overbrugt de 3 divergente varianten met één gedragsschakelaar i.p.v. een geforceerde merge.
- `clean_value(date_fmt=...)` parametriseert het enige echte verschil tussen de `clean`-varianten (date-only vs isoformat vs geen).

---

## 4. Gefaseerde uitvoering (risico-gestuurd, verticaal)

Elke fase is op zichzelf werkend en testbaar. Volgorde op risico/winst, niet alfabetisch.

### Fase 0 — Fundament (klein, geen gedragswijziging)
1. Maak `import/lib/supabase_helpers.py` + `import/lib/normalize.py` met de canonieke functies.
2. Vul `import/lib/__init__.py` met expliciete exports.
3. Schrijf **unit-tests** voor de pure helpers in `import/tests/` (sluit aan op bestaande `test_snijlijst_parser.py`-conventie): `norm`, `clean_value` (incl. NaN/NaT/numpy-int/float + beide date-formats), `clean_gln` (strict aan/uit). `upsert_batch` met een mock-`sb` om upsert-vs-insert-pad te bewijzen.

### Fase 1 — De `.insert`-afwijker eerst (hoogste risico)
4. Migreer [`reimport_orders_2026.py`](../../import/reimport_orders_2026.py) naar `upsert_batch(sb, ..., mode="insert")`. Verifieer dat het gedrag identiek blijft, maar nu expliciet. **Win:** de stille afwijking is weg.

### Fase 2 — Cluster A & B (de schone dedup, 10 bestanden)
5. Vervang de lokale `upsert_batch` in de 10 prijslijst-/orders-scripts door een import uit `lib`. Per script: verwijder lokale def, voeg `from lib.supabase_helpers import upsert_batch` toe, pas call-sites aan naar expliciete `sb`-arg.
6. Idem voor `norm` (3 EDI/Transus-scripts) en `clean`/`_clean` (numpy-opschoning).

### Fase 3 — Cluster C + GLN-divergentie (vergt gedragskeuze)
7. Migreer Cluster C (`import_prijslijsten_nieuw/aanvulling`, `import_prijslijst_hornbach`).
8. Consolideer de 3 `clean_gln`-varianten naar `clean_gln(strict=...)`; per call-site de juiste schakelaar kiezen (Transus → `strict=True`).

### Fase 4 — Init & bulk-patronen (hergebruik, optioneel)
9. `create_supabase_client()` met env-validatie → vervang de ~13 herhaalde init-blokken.
10. Verhuis `batch_delete`/`batch_select` naar `lib`; migreer waar zinvol losse inline bulk-delete/select-loops (afwijkende velden) — alleen waar 1-op-1 mogelijk, anders laten staan.

---

## 5. Import-mechaniek (let op)

Scripts draaien los vanuit `import/`. `reserveer_maatwerk_migratie.py` importeert al succesvol via `from lib.snijlijst_parser import ...`, dus het patroon werkt zolang het script vanuit `import/` als working dir draait. 3 scripts gebruiken `sys.path.insert(0, str(Path(__file__).parent))` — die manier blijft werken. **Geen `__init__.py`-pakket-installatie nodig**; volg het bestaande `from lib.x import y`-patroon.

## 6. Verwachte opbrengst

- **Netto regelbesparing:** ~130–150 regels (geverifieerd; niet de geclaimde 200).
- **Belangrijker dan regels:** één plek voor batch-/normalisatie-gedrag; de `.insert`-vs-`.upsert`-afwijking wordt expliciet; nieuwe import-scripts importeren i.p.v. kopiëren.
- **Test-dekking** op de gedeelde kern (was er niet voor deze helpers).

## 7. Risico's & mitigatie

| Risico | Mitigatie |
|---|---|
| Gedragswijziging bij migratie (vooral `reimport`) | Fase 1 apart + mock-test op insert/upsert-pad vóór migratie |
| `clean_gln`-merge verandert GLN-uitkomst | Behoud beide gedragingen via `strict`-param; per call-site bewust kiezen |
| Scripts draaien vanuit verkeerde working dir → import-fout | Volg bestaand `from lib.x`-patroon; documenteer "draai vanuit `import/`" |
| Onvolledige migratie laat mix van oud/nieuw achter | Per fase volledig afronden + grep-check dat geen lokale `def upsert_batch` resteert |

## 8. Documentatie (verplicht na uitvoering)
- `docs/architectuur.md` → noteer `import/lib/`-conventie voor gedeelde import-helpers.
- `docs/changelog.md` → datum + wat + waarom (incl. de `.insert`-afwijking-fix).
