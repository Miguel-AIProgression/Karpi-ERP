"""Import ALL orders: add missing debiteuren first, then orders + lines."""
import pandas as pd
import numpy as np
import re
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY

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
    if isinstance(val, type(pd.NaT)):
        return None
    return val

def clean_date(val):
    v = clean(val)
    if v is None:
        return None
    s = str(v)
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s
    return None

def upsert_batch(table, records, batch_size=500, on_conflict=None):
    total = len(records)
    for i in range(0, total, batch_size):
        batch = records[i:i+batch_size]
        kwargs = {}
        if on_conflict:
            kwargs['on_conflict'] = on_conflict
        sb.table(table).upsert(batch, **kwargs).execute()
        print(f"  {table}: {min(i+batch_size, total)}/{total}")

# Load
df = pd.read_excel('../Orders per 11-3-2026 (1).xlsx')
print(f"Loaded {len(df)} regels, {df['Order'].nunique()} orders")

# --- Step 1: Add missing debiteuren ---
res = sb.table("debiteuren").select("debiteur_nr").execute()
existing_debnrs = set(r['debiteur_nr'] for r in res.data)

order_debnrs = set(int(d) for d in df['Debiteur'].unique())
missing = order_debnrs - existing_debnrs
print(f"Missing debiteuren: {len(missing)}")

if missing:
    new_debs = []
    for debnr in missing:
        rows = df[df['Debiteur'] == debnr]
        first = rows.iloc[0]
        new_debs.append({
            "debiteur_nr": int(debnr),
            "naam": clean(first['Fct.naam']) or clean(first['Afl.naam']) or f"Debiteur {debnr}",
            "status": "Actief",
            "adres": clean(first['Fct.adres']),
            "postcode": clean(first['Fct.postc']),
            "plaats": clean(first['Fct.Plaats']),
            "land": clean(first['Fact.Land']),
        })
    upsert_batch("debiteuren", new_debs, on_conflict="debiteur_nr")
    existing_debnrs.update(missing)

# --- Step 2: Get existing data ---
res = sb.table("orders").select("oud_order_nr").not_.is_("oud_order_nr", "null").execute()
existing_orders = set(r['oud_order_nr'] for r in res.data)

res = sb.table("producten").select("artikelnr").limit(30000).execute()
existing_arts = set(r['artikelnr'] for r in res.data)

res = sb.table("vertegenwoordigers").select("code").execute()
existing_codes = set(r['code'] for r in res.data)

# --- Step 3: Build missing orders ---
print("Building orders...")
order_records = []
for order_nr, group in df.groupby('Order'):
    oud_nr = int(order_nr)
    if oud_nr in existing_orders:
        continue

    first = group.iloc[0]
    debnr = int(first['Debiteur'])
    vcode = str(int(first['Vert.'])) if pd.notna(first['Vert.']) and first['Vert.'] != 0 else None
    if vcode and vcode not in existing_codes:
        vcode = None

    betaler = None
    if pd.notna(first['Betaler']):
        bet_digits = ''.join(c for c in str(first['Betaler']).split('-')[0] if c.isdigit())
        if bet_digits:
            bet_val = int(bet_digits)
            if bet_val in existing_debnrs:
                betaler = bet_val

    order_records.append({
        "order_nr": f"IMP-{oud_nr}",
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
        "compleet_geleverd": str(first.get('Compl.Lev.', '')).strip().upper() == 'J',
    })

print(f"  {len(order_records)} new orders")
if order_records:
    upsert_batch("orders", order_records, on_conflict="oud_order_nr")

# --- Step 4: Fetch all order IDs ---
print("Fetching order IDs...")
order_id_map = {}
for offset in range(0, 5000, 1000):
    res = sb.table("orders").select("id, oud_order_nr").not_.is_("oud_order_nr", "null").range(offset, offset + 999).execute()
    for r in res.data:
        order_id_map[r['oud_order_nr']] = r['id']
    if len(res.data) < 1000:
        break
print(f"  {len(order_id_map)} orders in DB")

# --- Step 5: Build missing lines ---
print("Checking existing lines...")
existing_lines = set()
for offset in range(0, 10000, 1000):
    res = sb.table("order_regels").select("order_id, regelnummer").range(offset, offset + 999).execute()
    for r in res.data:
        existing_lines.add((r['order_id'], r['regelnummer']))
    if len(res.data) < 1000:
        break
print(f"  {len(existing_lines)} existing lines")

regel_records = []
for order_nr, group in df.groupby('Order'):
    oud_nr = int(order_nr)
    if oud_nr not in order_id_map:
        continue
    order_id = order_id_map[oud_nr]

    for _, r in group.iterrows():
        regelnr = int(r['Regel'])
        if (order_id, regelnr) in existing_lines:
            continue

        artnr = str(int(r['Artikelnr'])) if pd.notna(r['Artikelnr']) else None
        if artnr and artnr not in existing_arts:
            artnr = None

        regel_records.append({
            "order_id": order_id,
            "regelnummer": regelnr,
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
            "is_inkooporder": str(r.get('Inkooporder J/N', 'N')).strip().upper() == 'J',
            "oud_inkooporder_nr": int(r['Nummer inkooporder']) if pd.notna(r.get('Nummer inkooporder')) else None,
            "vrije_voorraad": float(r['VrijVoorr.']) if pd.notna(r.get('VrijVoorr.')) else None,
            "verwacht_aantal": float(r['Verwacht aantal']) if pd.notna(r.get('Verwacht aantal')) else None,
            "volgende_ontvangst": clean_date(r.get('Volg.ontvangst')),
            "laatste_bon": clean_date(r.get('Ltste bon')),
        })

print(f"  {len(regel_records)} new lines")
if regel_records:
    upsert_batch("order_regels", regel_records, on_conflict="order_id,regelnummer")

print("\nDone!")
