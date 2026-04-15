"""Re-import orders-2026.xlsx: alleen orders met afleverdatum > vandaag.
WAARSCHUWING: trunceert orders + order_regels (CASCADE) voor de import.
Downstream wipe: snijplannen, kleuren, confectie_planning, rol-koppelingen.
Alleen bedoeld voor testomgevingen.
"""
import pandas as pd
import numpy as np
import re
from datetime import date
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY

TODAY = date.today()
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


def upsert_batch(table, records, batch_size=500):
    total = len(records)
    for i in range(0, total, batch_size):
        batch = records[i:i + batch_size]
        sb.table(table).insert(batch).execute()
        print(f"  {table}: {min(i + batch_size, total)}/{total}")


# --- Load + parse ---
print(f"Laden: {EXCEL_PATH}")
df = pd.read_excel(EXCEL_PATH)
df['Afleverdatum'] = pd.to_datetime(df['Afleverdatum'], errors='coerce')
print(f"Totaal regels in Excel: {len(df)}, {df['Order'].nunique()} orders")

# --- Filter: behoud alleen orders waarvan min(Afleverdatum) > TODAY ---
future_orders = df.groupby('Order')['Afleverdatum'].min()
keep_orders = future_orders[future_orders.dt.date > TODAY].index
df = df[df['Order'].isin(keep_orders)].copy()
print(f"Na filter (afleverdatum > {TODAY}): {len(df)} regels, {df['Order'].nunique()} orders")

if len(df) == 0:
    raise SystemExit("Geen orders met toekomstige afleverdatum — abort.")

# --- TRUNCATE: vraag expliciete bevestiging ---
print(f"\n⚠️  Dit TRUNCEERT orders + order_regels (CASCADE).")
print(f"    Downstream wipe: snijplannen, kleuren, confectie_planning, rol-koppelingen.")
if input("Typ 'WIS' om door te gaan: ").strip() != "WIS":
    raise SystemExit("Afgebroken.")

sb.rpc("admin_truncate_orders").execute()
print("✓ Tabellen geleegd.")

# --- Haal referentiedata op ---
res = sb.table("vertegenwoordigers").select("code").execute()
existing_codes = set(r['code'] for r in res.data)

res = sb.table("debiteuren").select("debiteur_nr").execute()
existing_debs = set(r['debiteur_nr'] for r in res.data)

res = sb.table("producten").select("artikelnr").limit(30000).execute()
existing_arts = set(r['artikelnr'] for r in res.data)

# --- Build orders ---
print("Bouw orders...")
order_records = []
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

print(f"  {len(order_records)} orders")
if order_records:
    upsert_batch("orders", order_records)

# --- Fetch nieuwe order IDs met paginatie ---
print("Ophalen order IDs...")
order_id_map = {}
for offset in range(0, 10000, 1000):
    res = (
        sb.table("orders")
        .select("id, oud_order_nr")
        .not_.is_("oud_order_nr", "null")
        .range(offset, offset + 999)
        .execute()
    )
    for r in res.data:
        order_id_map[r['oud_order_nr']] = r['id']
    if len(res.data) < 1000:
        break
print(f"  {len(order_id_map)} orders gevonden in DB")

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
            "is_inkooporder": str(r.get('Inkooporder J/N', 'N')).strip().upper() == 'J',
            "oud_inkooporder_nr": int(r['Nummer inkooporder']) if pd.notna(r.get('Nummer inkooporder')) else None,
            "vrije_voorraad": float(r['VrijVoorr.']) if pd.notna(r.get('VrijVoorr.')) else None,
            "verwacht_aantal": float(r['Verwacht aantal']) if pd.notna(r.get('Verwacht aantal')) else None,
            "volgende_ontvangst": clean_date(r.get('Volg.ontvangst')),
            "laatste_bon": clean_date(r.get('Ltste bon')),
        })

print(f"  {len(regel_records)} regels")
if regel_records:
    upsert_batch("order_regels", regel_records)

print(f"\n✓ Klaar. {len(order_records)} orders en {len(regel_records)} regels geimporteerd.")
