"""
Sync inkoopoverzicht 05-06-2026 naar DB.

Stappen:
  1. 66 nieuwe inkooporders importeren (excl. Team snijtafel, excl. historisch <2024)
  2. 99 vervallen IO's verwijderen (44 gesloten + 55 verdwenen)
     - reserveringen op die IO-regels eerst loskoppelen
     - daarna regels → orders verwijderen
  3. 21 leverweek-updates doorvoeren
  4. 13 te-leveren hoeveelheden bijwerken
  5. 8 geraakt verkooporder_regels herberekenen via herallocateer_orderregel()
"""
import sys, re, io
from pathlib import Path
from datetime import date
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import numpy as np
import pandas as pd
from supabase import create_client

sys.path.insert(0, str(Path(__file__).parent))
from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR
from lib.normalize import clean_value as _clean
from lib.supabase_helpers import batch_delete, batch_select

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

CSV_PATH   = BASE_DIR / 'Inkoopoverzicht 05-06-26.csv'
UITGESLOTEN_LEV = {20010}
MIN_JAAR   = 2024

# ── helpers ─────────────────────────────────────────────────────────────────

def _clean_prijs(v):
    """Converteert '15,6' of '15.6' naar float, geeft None bij lege waarde."""
    if v is None: return None
    if isinstance(v, (int, float)):
        if isinstance(v, float) and np.isnan(v): return None
        return float(v)
    s = str(v).strip().replace(',', '.')
    if not s: return None
    try: return float(s)
    except ValueError: return None

def parse_lw(lw):
    if not lw or (isinstance(lw, float) and pd.isna(lw)): return None
    s = str(lw).strip().lstrip("'")
    m = re.match(r'^(\d{1,2})/(\d{4})$', s)
    if not m: return None
    w, j = int(m.group(1)), int(m.group(2))
    if not (2024 <= j <= 2030 and 1 <= w <= 53): return None
    try: return date.fromisocalendar(j, w, 1).isoformat()
    except: return None

def bouw_ink_nr(onr):
    s = str(int(onr))
    jaar = 2000 + int(s[:2]) if len(s) >= 2 else 2026
    return f"INK-{jaar}-{s[-4:].zfill(4)}"

def bepaal_status(groep):
    tot_b = groep['_besteld'].sum()
    tot_g = groep['_gelev'].sum()
    tot_o = groep['_te_lev'].sum()
    if tot_o <= 0: return 'Ontvangen'
    if tot_g > 0 and tot_b > 0: return 'Deels ontvangen'
    return 'Besteld'

def eenheid_voor(ptype, omschr):
    if ptype == 'rol': return 'm'
    if ptype in ('vast', 'staaltje', 'overig'): return 'stuks'
    s = str(omschr or '').upper()
    if 'BREED' in s: return 'm'
    if 'CA:' in s or 'CA.' in s: return 'stuks'
    return 'm'

# ── laad CSV ────────────────────────────────────────────────────────────────

def laad_csv():
    df = pd.read_csv(CSV_PATH, sep=None, engine='python', encoding='latin-1')
    df['_status']  = pd.to_numeric(df['Status'],     errors='coerce').fillna(-1).astype(int)
    df['_te_lev']  = pd.to_numeric(df['Te leveren'], errors='coerce').fillna(0)
    df['_besteld'] = pd.to_numeric(df['Besteld'],    errors='coerce').fillna(0)
    df['_gelev']   = pd.to_numeric(df['Geleverd'],   errors='coerce').fillna(0)
    df['Ordernummer'] = pd.to_numeric(df['Ordernummer'], errors='coerce')
    df['Leverancier nr.'] = pd.to_numeric(df['Leverancier nr.'], errors='coerce')
    return df

def is_snijtafel(naam):
    return 'snijtafel' in str(naam).lower()

def jaar_uit(onr):
    s = str(int(onr))
    return 2000 + int(s[:2]) if len(s) >= 2 and s[:2].isdigit() else 0

# ── fetch DB staat ───────────────────────────────────────────────────────────

def fetch_db_orders():
    rows, offset = [], 0
    while True:
        res = sb.table('inkooporders').select(
            'id,oud_inkooporder_nr,inkooporder_nr,status,leverweek,verwacht_datum'
        ).range(offset, offset+999).execute()
        rows.extend(res.data)
        if len(res.data) < 1000: break
        offset += 1000
    return rows

def fetch_product_info(artikelnrs):
    known = {}
    arts = sorted({str(int(a)) for a in artikelnrs if a is not None and not pd.isna(a)})
    for i in range(0, len(arts), 500):
        res = sb.table('producten').select('artikelnr,product_type').in_('artikelnr', arts[i:i+500]).execute()
        for r in res.data: known[r['artikelnr']] = r.get('product_type')
    return known

# ════════════════════════════════════════════════════════════════════════════
# STAP 1 – Nieuwe orders importeren
# ════════════════════════════════════════════════════════════════════════════

def stap1_importeer(df, db_alle_nrs, nieuw_nrs):
    print(f"\n=== STAP 1: {len(nieuw_nrs)} nieuwe orders importeren ===")

    open_df = df[df['Ordernummer'].isin(nieuw_nrs)].copy()
    product_info = fetch_product_info(open_df['Artikelnummer'].dropna().unique())

    # Leveranciers upsert
    levs = (open_df[['Leverancier nr.','Naam','Woonplaats']]
            .dropna(subset=['Leverancier nr.','Naam'])
            .drop_duplicates(subset=['Leverancier nr.'])
            .sort_values('Leverancier nr.'))
    lev_payload = [{'leverancier_nr': int(r['Leverancier nr.']),
                    'naam': str(r['Naam']).strip(),
                    'woonplaats': _clean(r['Woonplaats']), 'actief': True}
                   for _, r in levs.iterrows()]

    alle_lev_nrs = [p['leverancier_nr'] for p in lev_payload]
    res = batch_select(sb, 'leveranciers', 'id,leverancier_nr', 'leverancier_nr', alle_lev_nrs)
    lev_map = {r['leverancier_nr']: r['id'] for r in res}

    nieuwe_levs = [p for p in lev_payload if p['leverancier_nr'] not in lev_map]
    if nieuwe_levs:
        res2 = sb.table('leveranciers').insert(nieuwe_levs).execute()
        for r in (res2.data or []): lev_map[r['leverancier_nr']] = r['id']
    print(f"  Leveranciers: {len(lev_map)} ({len(nieuwe_levs)} nieuw)")

    # Inkooporders insert
    io_payload = []
    for onr, groep in open_df.groupby('Ordernummer'):
        eerste = groep.iloc[0]
        lev_nr = _clean(eerste['Leverancier nr.'])
        lev_id = lev_map.get(lev_nr) if lev_nr else None
        lw_raw = str(eerste.get('Leverweek') or '').strip().lstrip("'") or None
        dat = eerste.get('Datum')
        besteldatum = pd.Timestamp(dat).date().isoformat() if pd.notna(dat) else None
        io_payload.append({
            'inkooporder_nr':     bouw_ink_nr(onr),
            'oud_inkooporder_nr': int(onr),
            'leverancier_id':     lev_id,
            'besteldatum':        besteldatum,
            'leverweek':          lw_raw,
            'verwacht_datum':     parse_lw(lw_raw),
            'status':             bepaal_status(groep),
            'bron':               'import',
        })

    inserted_orders = 0
    order_map = {}
    for i in range(0, len(io_payload), 500):
        res = sb.table('inkooporders').insert(io_payload[i:i+500]).execute()
        for r in (res.data or []):
            order_map[r['oud_inkooporder_nr']] = r['id']
            inserted_orders += 1
    print(f"  Inkooporders ingevoegd: {inserted_orders}")

    # Regels insert
    regel_payload = []
    onbekend = 0
    for _, row in open_df.iterrows():
        onr = int(row['Ordernummer'])
        io_id = order_map.get(onr)
        if io_id is None: continue
        art = _clean(row['Artikelnummer'])
        art_str = str(int(art)) if art is not None else None
        ptype = product_info.get(art_str) if art_str else None
        if art_str and ptype is None: onbekend += 1; art_str = None
        regel_payload.append({
            'inkooporder_id':      io_id,
            'regelnummer':         int(row['Regel']) if pd.notna(row['Regel']) else 1,
            'artikelnr':           art_str,
            'artikel_omschrijving':_clean(row.get('Omschrijving 1')),
            'karpi_code':          _clean(row.get('Omschrijving')),
            'inkoopprijs_eur':     _clean_prijs(row.get('Inkoopprijs EUR.')),
            'besteld_m':           float(row['_besteld']),
            'geleverd_m':          float(row['_gelev']),
            'te_leveren_m':        float(row['_te_lev']),
            'eenheid':             eenheid_voor(ptype, row.get('Omschrijving 1')),
            'status_excel':        int(row['_status']),
        })

    inserted_regels = 0
    for i in range(0, len(regel_payload), 500):
        res = sb.table('inkooporder_regels').insert(regel_payload[i:i+500]).execute()
        inserted_regels += len(res.data or [])
    print(f"  IO-regels ingevoegd: {inserted_regels}  (onbekend artikel: {onbekend})")


# ════════════════════════════════════════════════════════════════════════════
# STAP 2 – Vervallen IO's verwijderen
# ════════════════════════════════════════════════════════════════════════════

def stap2_verwijder(te_verwijderen_nrs, db_open):
    print(f"\n=== STAP 2: {len(te_verwijderen_nrs)} IO's verwijderen ===")

    io_ids = [db_open[onr]['id'] for onr in te_verwijderen_nrs if onr in db_open]

    # IO-regel IDs ophalen
    io_regel_ids = [r['id'] for r in batch_select(sb, 'inkooporder_regels','id','inkooporder_id', io_ids)]
    print(f"  IO-regels te verwijderen: {len(io_regel_ids)}")

    # Reserveringen loskoppelen (order_reserveringen.inkooporder_regel_id → NULL)
    if io_regel_ids:
        rv_rows = batch_select(sb, 'order_reserveringen','id,order_regel_id','inkooporder_regel_id', io_regel_ids)
        rv_ids  = [r['id'] for r in rv_rows]
        if rv_ids:
            for i in range(0, len(rv_ids), 200):
                sb.table('order_reserveringen').delete().in_('id', rv_ids[i:i+200]).execute()
            print(f"  Reserveringen verwijderd: {len(rv_ids)}")
        geraakt_regelids = {r['order_regel_id'] for r in rv_rows}
    else:
        geraakt_regelids = set()

    # IO-regels verwijderen
    if io_regel_ids:
        batch_delete(sb, 'inkooporder_regels', 'id', io_regel_ids)
        print(f"  IO-regels verwijderd: {len(io_regel_ids)}")

    # Inkooporders verwijderen
    if io_ids:
        batch_delete(sb, 'inkooporders', 'id', io_ids)
        print(f"  Inkooporders verwijderd: {len(io_ids)}")

    return geraakt_regelids


# ════════════════════════════════════════════════════════════════════════════
# STAP 3 – Leverweek updates
# ════════════════════════════════════════════════════════════════════════════

def stap3_leverweek(lw_changes):
    print(f"\n=== STAP 3: {len(lw_changes)} leverweek-updates ===")
    for onr, (io_id, oud_lw, nieuw_lw) in lw_changes.items():
        verwacht = parse_lw(nieuw_lw)
        sb.table('inkooporders').update({
            'leverweek':     nieuw_lw,
            'verwacht_datum': verwacht,
        }).eq('id', io_id).execute()
        print(f"  {onr}  {oud_lw} → {nieuw_lw}  (verwacht: {verwacht})")


# ════════════════════════════════════════════════════════════════════════════
# STAP 4 – Te-leveren updates
# ════════════════════════════════════════════════════════════════════════════

def stap4_te_leveren(te_lev_changes):
    print(f"\n=== STAP 4: {len(te_lev_changes)} te-leveren updates ===")
    geraakt = set()
    for (regel_id, oud, nieuw, onr) in te_lev_changes:
        sb.table('inkooporder_regels').update({'te_leveren_m': nieuw}).eq('id', regel_id).execute()
        # Claims op deze regel ophalen voor herberekening
        res = sb.table('order_reserveringen').select('order_regel_id').eq('inkooporder_regel_id', regel_id).execute()
        for r in (res.data or []): geraakt.add(r['order_regel_id'])
        delta = nieuw - oud
        print(f"  IO {onr} regel {regel_id}: {oud:.1f} → {nieuw:.1f}  (Δ{delta:+.1f})")
    return geraakt


# ════════════════════════════════════════════════════════════════════════════
# STAP 5 – Herberekenen geraakt verkooporders
# ════════════════════════════════════════════════════════════════════════════

def stap5_herbereken(geraakt_regel_ids):
    if not geraakt_regel_ids:
        print("\n=== STAP 5: geen geraakt verkooporder_regels ===")
        return

    print(f"\n=== STAP 5: {len(geraakt_regel_ids)} verkooporder_regels herberekenen ===")
    fouten = []
    for regel_id in sorted(geraakt_regel_ids):
        try:
            sb.rpc('herallocateer_orderregel', {'p_order_regel_id': regel_id}).execute()
            print(f"  ✓ orderregel {regel_id} herberekend")
        except Exception as e:
            fouten.append((regel_id, str(e)))
            print(f"  ✗ orderregel {regel_id}: {e}")

    if fouten:
        print(f"\n  ⚠ {len(fouten)} fouten bij herberekening")


# ════════════════════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════════════════════

def main():
    print("Laad CSV...")
    df = laad_csv()
    alle_csv_nrs = set(df['Ordernummer'].dropna().astype(int).unique())

    open_csv = df[
        df['_status'].isin({0,1}) & (df['_te_lev'] > 0) &
        ~df['Leverancier nr.'].isin(UITGESLOTEN_LEV)
    ].copy()
    open_csv['Ordernummer'] = open_csv['Ordernummer'].astype(int)
    csv_orders = set(open_csv['Ordernummer'].unique())
    csv_per_ord = open_csv.groupby('Ordernummer')

    print("Laad DB...")
    db_rows = fetch_db_orders()
    db_open = {r['oud_inkooporder_nr']: r for r in db_rows if r['status'] in ('Besteld','Deels ontvangen')}
    db_alle = {r['oud_inkooporder_nr']: r for r in db_rows}

    # Nieuw: 2024+, geen snijtafel, niet in DB
    nieuw_nrs = {
        onr for onr in (csv_orders - set(db_alle.keys()))
        if jaar_uit(onr) >= MIN_JAAR and
        not is_snijtafel(open_csv[open_csv['Ordernummer']==onr]['Naam'].iloc[0])
    }

    # Te verwijderen
    te_verwijderen = set(db_open.keys()) - csv_orders

    # Leverweek wijzigingen
    lw_changes = {}
    for onr, dbo in db_open.items():
        if onr not in csv_orders: continue
        g = open_csv[open_csv['Ordernummer']==onr]
        csv_lw = str(g.iloc[0]['Leverweek']).strip().lstrip("'") if pd.notna(g.iloc[0]['Leverweek']) else None
        db_lw  = dbo.get('leverweek') or ''
        if csv_lw and db_lw and csv_lw != db_lw:
            lw_changes[onr] = (dbo['id'], db_lw, csv_lw)

    # Te-leveren wijzigingen (per IO-regel)
    db_ids_open = [r['id'] for r in db_rows if r['status'] in ('Besteld','Deels ontvangen')]
    db_regels = batch_select(sb, 'inkooporder_regels',
                             'id,inkooporder_id,regelnummer,te_leveren_m',
                             'inkooporder_id', db_ids_open)
    db_id2oud = {r['id']: r['oud_inkooporder_nr'] for r in db_rows}
    db_reg_per_ord = defaultdict(list)
    for r in db_regels:
        oud = db_id2oud.get(r['inkooporder_id'])
        if oud: db_reg_per_ord[oud].append(r)

    te_lev_changes = []
    for onr in csv_orders & set(db_open.keys()):
        csv_g = open_csv[open_csv['Ordernummer']==onr]
        csv_per_rule = {int(row['Regel']): float(row['_te_lev'])
                        for _, row in csv_g.iterrows() if pd.notna(row['Regel'])}
        for db_regel in db_reg_per_ord[onr]:
            csv_tl = csv_per_rule.get(db_regel['regelnummer'])
            if csv_tl is not None and abs((db_regel['te_leveren_m'] or 0) - csv_tl) > 0.1:
                te_lev_changes.append((db_regel['id'], db_regel['te_leveren_m'], csv_tl, onr))

    print(f"\nPlan:")
    print(f"  Nieuwe orders:          {len(nieuw_nrs)}")
    print(f"  Te verwijderen IO's:    {len(te_verwijderen)}")
    print(f"  Leverweek updates:      {len(lw_changes)}")
    print(f"  Te-leveren updates:     {len(te_lev_changes)}")

    # Uitvoeren
    stap1_importeer(df, set(db_alle.keys()), nieuw_nrs)
    geraakt_a = stap2_verwijder(te_verwijderen, db_open)
    stap3_leverweek(lw_changes)
    geraakt_b = stap4_te_leveren(te_lev_changes)

    alle_geraakt = geraakt_a | geraakt_b
    stap5_herbereken(alle_geraakt)

    print("\n=== KLAAR ===")


if __name__ == '__main__':
    main()
