# Orders 2026 Re-import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leeg de `orders` + `order_regels` tabellen en herlaad ze uit `orders-2026.xlsx`, waarbij alleen orders met `Afleverdatum > 2026-04-15` (vandaag) worden geïmporteerd, zodat de testomgeving werkt met actuele, toekomstige leverdata.

**Architecture:** Python script in `import/` (hergebruikt pattern van [import_orders_full.py](import/import_orders_full.py)). Verschillen: (1) filter op toekomstige afleverdatum, (2) TRUNCATE ... CASCADE via RPC of via `supabase db` CLI vóór insert, (3) geen "missing-check" logica — altijd volledige insert van gefilterde set.

**Tech Stack:** Python 3, pandas, supabase-py, PostgreSQL (via Supabase). Klanten en producten staan al in DB — geen FK-backfill nodig.

**⚠️ Blast radius:** TRUNCATE op `orders` + `order_regels` triggert CASCADE naar downstream tabellen die `order_id` / `order_regel_id` gebruiken: **snijplannen, snijplan_groepen, snijplan_rollen, kleuren, confectie_planning, rollen (gebruik)**. Alle snij-/confectie-/productiedata verdwijnt. Dit is gewenst voor een testdata-refresh, maar bevestig vooraf dat dit geen productie-DB is.

---

## File Structure

- **Create:** `import/reimport_orders_2026.py` — hoofdscript dat filtert, trunceert, importeert
- **Create:** `supabase/migrations/068_truncate_orders_rpc.sql` — RPC-functie `admin_truncate_orders()` die `TRUNCATE orders, order_regels CASCADE` uitvoert (supabase-py kan geen raw DDL)
- **Reference (niet muteren):** [import/import_orders_full.py](import/import_orders_full.py), [import/config.py](import/config.py)
- **Docs:** `docs/changelog.md` bijwerken na afloop

---

## Task 1: TRUNCATE RPC migratie

**Files:**
- Create: `supabase/migrations/068_truncate_orders_rpc.sql`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migration 068: admin RPC om orders + order_regels te trunceren (testdata-refresh).
-- CASCADE verwijdert ook snijplannen, kleuren, confectie_planning, rol-koppelingen.
-- Alleen bedoeld voor testomgevingen.

CREATE OR REPLACE FUNCTION admin_truncate_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  TRUNCATE TABLE orders, order_regels RESTART IDENTITY CASCADE;
END;
$$;

COMMENT ON FUNCTION admin_truncate_orders IS
  'Leegt orders + order_regels (CASCADE). Alleen voor testdata-refresh.';
```

- [ ] **Step 2: Migratie toepassen via Supabase MCP**

Gebruik `mcp__claude_ai_Supabase__apply_migration` met `name: "068_truncate_orders_rpc"` en de SQL uit Step 1.
Verwacht: geen error, functie bestaat.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/068_truncate_orders_rpc.sql
git commit -m "feat: admin_truncate_orders RPC voor testdata-refresh"
```

---

## Task 2: Import-script skelet + Excel-filter

**Files:**
- Create: `import/reimport_orders_2026.py`

- [ ] **Step 1: Schrijf skelet met date-filter en dry-run print**

```python
"""Re-import orders-2026.xlsx: alleen orders met afleverdatum > vandaag.
WAARSCHUWING: trunceert orders + order_regels (CASCADE) voor de import.
"""
import pandas as pd
import numpy as np
import re
from datetime import date
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY

TODAY = date.today()  # 2026-04-15 tijdens uitvoering
EXCEL_PATH = '../orders-2026.xlsx'

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

def clean(val):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating,)):
        return float(val)
    if isinstance(val, pd.Timestamp):
        return val.strftime('%Y-%m-%d')
    return val

def clean_date(val):
    v = clean(val)
    if v is None:
        return None
    s = str(v)[:10]
    return s if re.match(r'^\d{4}-\d{2}-\d{2}$', s) else None

# Load + parse afleverdatum
df = pd.read_excel(EXCEL_PATH)
df['Afleverdatum'] = pd.to_datetime(df['Afleverdatum'], errors='coerce')
print(f"Totaal regels in Excel: {len(df)}, {df['Order'].nunique()} orders")

# Filter: behoud alleen orders waarvan ELKE regel afleverdatum > TODAY heeft
#   (we filteren op order-niveau zodat we geen gedeeltelijke orders importeren)
future_orders = df.groupby('Order')['Afleverdatum'].min()
keep_orders = future_orders[future_orders.dt.date > TODAY].index
df = df[df['Order'].isin(keep_orders)].copy()
print(f"Na filter (afleverdatum > {TODAY}): {len(df)} regels, {df['Order'].nunique()} orders")

if len(df) == 0:
    raise SystemExit("Geen orders met toekomstige afleverdatum — abort.")
```

- [ ] **Step 2: Dry-run uitvoeren (géén DB writes)**

```bash
cd import && python reimport_orders_2026.py
```

Verwacht: print met filtertotalen, script stopt of valt uit (rest nog niet geschreven). Geen DB-wijzigingen.

---

## Task 3: TRUNCATE aanroep + bevestiging

**Files:**
- Modify: `import/reimport_orders_2026.py`

- [ ] **Step 1: Voeg interactieve bevestiging + RPC-call toe onderaan het script**

```python
# --- TRUNCATE: vraag expliciete bevestiging ---
print(f"\n⚠️  Dit TRUNCEERT orders + order_regels (CASCADE).")
print(f"    Downstream wipe: snijplannen, kleuren, confectie_planning, rol-koppelingen.")
if input("Typ 'WIS' om door te gaan: ").strip() != "WIS":
    raise SystemExit("Afgebroken.")

sb.rpc("admin_truncate_orders").execute()
print("✓ Tabellen geleegd.")
```

- [ ] **Step 2: Niet uitvoeren** — verifieer alleen dat het bestand geldig Python is.

```bash
cd import && python -c "import ast; ast.parse(open('reimport_orders_2026.py').read()); print('OK')"
```
Verwacht: `OK`.

---

## Task 4: Orders + order_regels opbouwen en inserten

**Files:**
- Modify: `import/reimport_orders_2026.py`

- [ ] **Step 1: Voeg insert-blok toe (naar model van import_orders_full.py:81-197)**

```python
def upsert_batch(table, records, batch_size=500):
    for i in range(0, len(records), batch_size):
        sb.table(table).insert(records[i:i+batch_size]).execute()
        print(f"  {table}: {min(i+batch_size, len(records))}/{len(records)}")

# Bestaande vertegenwoordiger-codes (voor FK-validatie)
res = sb.table("vertegenwoordigers").select("code").execute()
existing_codes = set(r['code'] for r in res.data)
res = sb.table("debiteuren").select("debiteur_nr").execute()
existing_debs = set(r['debiteur_nr'] for r in res.data)
res = sb.table("producten").select("artikelnr").limit(30000).execute()
existing_arts = set(r['artikelnr'] for r in res.data)

# --- Build orders ---
print("Bouw orders...")
order_records = []
oud_to_new_ordernr = {}
for order_nr, group in df.groupby('Order'):
    oud_nr = int(order_nr)
    first = group.iloc[0]
    debnr = int(first['Debiteur'])
    if debnr not in existing_debs:
        print(f"  skip order {oud_nr}: debiteur {debnr} onbekend")
        continue

    vcode = str(int(first['Vert.'])) if pd.notna(first['Vert.']) and first['Vert.'] != 0 else None
    if vcode and vcode not in existing_codes:
        vcode = None

    betaler = None
    if pd.notna(first['Betaler']):
        digits = ''.join(c for c in str(first['Betaler']).split('-')[0] if c.isdigit())
        if digits and int(digits) in existing_debs:
            betaler = int(digits)

    new_order_nr = f"IMP-{oud_nr}"
    oud_to_new_ordernr[oud_nr] = new_order_nr
    order_records.append({
        "order_nr": new_order_nr,
        "oud_order_nr": oud_nr,
        "debiteur_nr": debnr,
        "klant_referentie": clean(first['Klantref.']),
        "orderdatum": clean_date(first['Orderdatum']),
        "afleverdatum": clean_date(first['Afleverdatum']),
        "week": clean(first['Week']),
        "fact_naam": clean(first['Fct.naam']),
        "fact_adres": clean(first['Fct.adres']),
        "fact_postcode": clean(first['Fct.postc']),
        "fact_plaats": clean(first['Fct.Plaats']),
        "fact_land": clean(first['Fact.Land']),
        "afl_naam": clean(first['Afl.naam']),
        "afl_naam_2": clean(first['Naam2']),
        "afl_adres": clean(first['Afl.adres']),
        "afl_postcode": clean(first['Afl.Postcd']),
        "afl_plaats": clean(first['Afl.Plaats']),
        "afl_land": clean(first['Afl.land']),
        "betaler": betaler,
        "vertegenw_code": vcode,
        "inkooporganisatie": clean(first['Ink.Org']),
        "status": "Nieuw",
        "compleet_geleverd": str(first.get('Compl.Lev.','')).strip().upper() == 'J',
    })
print(f"  {len(order_records)} orders")
upsert_batch("orders", order_records)

# --- Fetch nieuwe order IDs ---
order_id_map = {}
for offset in range(0, 10000, 1000):
    res = sb.table("orders").select("id, oud_order_nr").not_.is_("oud_order_nr", "null").range(offset, offset+999).execute()
    for r in res.data:
        order_id_map[r['oud_order_nr']] = r['id']
    if len(res.data) < 1000:
        break

# --- Build order_regels ---
print("Bouw order_regels...")
regel_records = []
for order_nr, group in df.groupby('Order'):
    oud_nr = int(order_nr)
    if oud_nr not in order_id_map:
        continue
    oid = order_id_map[oud_nr]
    for _, r in group.iterrows():
        artnr = str(int(r['Artikelnr'])) if pd.notna(r['Artikelnr']) else None
        if artnr and artnr not in existing_arts:
            artnr = None
        regel_records.append({
            "order_id": oid,
            "regelnummer": int(r['Regel']),
            "artikelnr": artnr,
            "karpi_code": clean(r['Karpi-code']),
            "omschrijving": clean(r['Omschrijving']) or "Onbekend",
            "omschrijving_2": clean(r['Omschrijving 2']),
            "orderaantal": int(r['Orderaantal']) if pd.notna(r['Orderaantal']) else 1,
            "te_leveren": int(r['Te lev.']) if pd.notna(r['Te lev.']) else 0,
            "backorder": int(r['Backorder']) if pd.notna(r['Backorder']) else 0,
            "te_factureren": int(r['Te fact.']) if pd.notna(r['Te fact.']) else 0,
            "gefactureerd": int(r['Gefact.']) if pd.notna(r['Gefact.']) else 0,
            "prijs": float(r['Prijs']) if pd.notna(r['Prijs']) else None,
            "korting_pct": float(r['Kort.%']) if pd.notna(r['Kort.%']) else 0,
            "bedrag": float(r['Bedrag']) if pd.notna(r['Bedrag']) else None,
            "gewicht_kg": float(r['Gewicht']) if pd.notna(r['Gewicht']) else None,
            "is_inkooporder": str(r.get('Inkooporder J/N','N')).strip().upper() == 'J',
            "oud_inkooporder_nr": int(r['Nummer inkooporder']) if pd.notna(r.get('Nummer inkooporder')) else None,
            "vrije_voorraad": float(r['VrijVoorr.']) if pd.notna(r.get('VrijVoorr.')) else None,
            "verwacht_aantal": float(r['Verwacht aantal']) if pd.notna(r.get('Verwacht aantal')) else None,
            "volgende_ontvangst": clean_date(r.get('Volg.ontvangst')),
            "laatste_bon": clean_date(r.get('Ltste bon')),
        })
print(f"  {len(regel_records)} regels")
upsert_batch("order_regels", regel_records)

print("\n✓ Klaar.")
```

- [ ] **Step 2: Uitvoeren tegen Supabase**

```bash
cd import && python reimport_orders_2026.py
```
Typ `WIS` wanneer gevraagd.
Verwacht: aantallen matchen met filter-output uit Task 2. Script eindigt met `✓ Klaar.`

- [ ] **Step 3: Verifieer in DB**

Via `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT COUNT(*) AS orders,
       MIN(afleverdatum) AS vroegste,
       MAX(afleverdatum) AS laatste
FROM orders;
SELECT COUNT(*) FROM order_regels;
```
Verwacht: `vroegste > 2026-04-15`, aantallen komen overeen met script-output.

---

## Task 5: Docs bijwerken + commit

**Files:**
- Modify: `docs/changelog.md`

- [ ] **Step 1: Voeg changelog entry toe (bovenaan)**

```markdown
## 2026-04-15 — Testdata refresh: orders-2026
- Migratie 068: `admin_truncate_orders()` RPC toegevoegd
- Script `import/reimport_orders_2026.py`: importeert orders-2026.xlsx, alleen orders met afleverdatum > vandaag
- orders + order_regels en downstream (snijplannen, kleuren, confectie_planning) geleegd en herladen
```

- [ ] **Step 2: Commit**

```bash
git add import/reimport_orders_2026.py docs/changelog.md
git commit -m "feat: re-import orders-2026 met toekomstige afleverdatum-filter"
```

---

## Remember
- DRY: hergebruik patterns uit [import_orders_full.py](import/import_orders_full.py) — niet copy-paste zonder nadenken.
- YAGNI: geen "delta/upsert"-modus; dit is een full-refresh script.
- Bevestig vooraf dat de Supabase-omgeving een testomgeving is vóór Task 4 Step 2.
