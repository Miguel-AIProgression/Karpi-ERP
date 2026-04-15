"""
Sync rollen-tabel in Supabase met actuele fysieke voorraad uit Excel-snapshot.

Draai standaard in dry-run:  python sync_rollen_voorraad.py
Schrijf wijzigingen:          python sync_rollen_voorraad.py --apply
"""
import argparse
import numpy as np
import pandas as pd
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY, ROLLEN_SYNC_FILE


def _clean(v):
    if v is None:
        return None
    if isinstance(v, float) and np.isnan(v):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    return v


def bouw_insert_record(r):
    return {
        'rolnummer': str(r['rolnummer']),
        'artikelnr': _clean(r['artikelnr']),
        'karpi_code': _clean(r['karpi_code']),
        'omschrijving': _clean(r['omschrijving']),
        'lengte_cm': int(r['lengte_cm']) if pd.notna(r['lengte_cm']) else None,
        'breedte_cm': int(r['breedte_cm']) if pd.notna(r['breedte_cm']) else None,
        'oppervlak_m2': _clean(r['oppervlak_m2']),
        'vvp_m2': _clean(r['vvp_m2']),
        'waarde': _clean(r['waarde']),
        'kwaliteit_code': _clean(r['kwaliteit_code']),
        'kleur_code': _clean(r['kleur_code']),
        'zoeksleutel': _clean(r['zoeksleutel']),
        'status': 'beschikbaar',
    }


def bouw_update_record(r):
    return {
        'lengte_cm': int(r['lengte_cm']) if pd.notna(r['lengte_cm']) else None,
        'breedte_cm': int(r['breedte_cm']) if pd.notna(r['breedte_cm']) else None,
        'oppervlak_m2': _clean(r['oppervlak_m2']),
        'vvp_m2': _clean(r['vvp_m2']),
        'waarde': _clean(r['waarde']),
    }


def parse_karpi_code(code):
    """Karpi-code -> (kwaliteit_code, kleur_code, zoeksleutel).

    Eerste aaneengesloten letters = kwaliteit_code.
    Eerste 2 cijfers daarna = kleur_code.
    """
    if code is None or (isinstance(code, float) and pd.isna(code)):
        return None, None, None
    s = str(code).strip()
    i = 0
    while i < len(s) and s[i].isalpha():
        i += 1
    kwaliteit = s[:i] or None
    rest = s[i:]
    j = 0
    while j < len(rest) and rest[j].isdigit():
        j += 1
    kleur = rest[:2] if j >= 2 else None
    zoek = f"{kwaliteit}_{kleur}" if kwaliteit and kleur else None
    return kwaliteit, kleur, zoek


def load_bron(path):
    df = pd.read_excel(path)
    df = df.rename(columns={
        'Artikelnr': 'artikelnr',
        'Karpi-code': 'karpi_code',
        'Omschrijving': 'omschrijving',
        'VVP m2': 'vvp_m2',
        'Rolnummer': 'rolnummer',
        'Lengte (m)': 'lengte_m',
        'Breedte (m)': 'breedte_m',
        'Oppervlak': 'oppervlak_m2',
        'Waarde': 'waarde',
    })
    df['rolnummer'] = df['rolnummer'].astype(str).str.strip()
    df['artikelnr'] = df['artikelnr'].apply(
        lambda v: str(int(v)) if pd.notna(v) else None
    )
    df['lengte_cm'] = (df['lengte_m'] * 100).round().astype('Int64')
    df['breedte_cm'] = (df['breedte_m'] * 100).round().astype('Int64')
    parsed = df['karpi_code'].apply(parse_karpi_code)
    df['kwaliteit_code'] = parsed.apply(lambda t: t[0])
    df['kleur_code'] = parsed.apply(lambda t: t[1])
    df['zoeksleutel'] = parsed.apply(lambda t: t[2])
    df = df.drop_duplicates(subset=['rolnummer'], keep='first')
    return df


def fetch_huidige(sb):
    huidige = []
    page = 0
    while True:
        resp = sb.table('rollen').select(
            'id,rolnummer,artikelnr,lengte_cm,breedte_cm,oppervlak_m2,vvp_m2,waarde,status'
        ).range(page * 1000, (page + 1) * 1000 - 1).execute()
        huidige.extend(resp.data)
        if len(resp.data) < 1000:
            break
        page += 1
    return huidige


PROTECTED_STATUSSEN = {'in_snijplan', 'gereserveerd', 'gesneden'}
AFVOER_BARE_STATUSSEN = {'beschikbaar', 'reststuk', ''}


def _neq_int(a, b):
    if pd.isna(a) and b is None:
        return False
    if pd.isna(a) or b is None:
        return True
    return int(a) != int(b)


def _neq_float(a, b, tol=0.01):
    if pd.isna(a) and b is None:
        return False
    if pd.isna(a) or b is None:
        return True
    return abs(float(a) - float(b)) > tol


def diff(df_bron, huidige):
    """Return (nieuw, update, afvoeren, beschermd_weg).

    - nieuw: list of pd.Series from bron (rolnummer niet in DB)
    - update: list of (db_id, bron_series) waar dimensies/waarde veranderd zijn
    - afvoeren: list of db-dicts (status -> 'verkocht')
    - beschermd_weg: list of db-dicts (niet in bron, workflow-status, waarschuwen)
    """
    bron_map = {r['rolnummer']: r for _, r in df_bron.iterrows()}
    huidig_map = {h['rolnummer']: h for h in huidige}

    nieuw, update, afvoeren, beschermd_weg = [], [], [], []

    for rolnr, bron in bron_map.items():
        db = huidig_map.get(rolnr)
        if db is None:
            nieuw.append(bron)
            continue
        if (_neq_int(bron['lengte_cm'], db.get('lengte_cm'))
                or _neq_int(bron['breedte_cm'], db.get('breedte_cm'))
                or _neq_float(bron['oppervlak_m2'], db.get('oppervlak_m2'))
                or _neq_float(bron['vvp_m2'], db.get('vvp_m2'))
                or _neq_float(bron['waarde'], db.get('waarde'))):
            update.append((db['id'], bron))

    for rolnr, db in huidig_map.items():
        if rolnr in bron_map:
            continue
        status = (db.get('status') or '').lower()
        if status in AFVOER_BARE_STATUSSEN:
            afvoeren.append(db)
        else:
            beschermd_weg.append(db)

    return nieuw, update, afvoeren, beschermd_weg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true',
                    help='Daadwerkelijk schrijven (default: dry-run)')
    args = ap.parse_args()

    print(f"Laden: {ROLLEN_SYNC_FILE}")
    df = load_bron(ROLLEN_SYNC_FILE)
    print(f"  {len(df)} unieke rollen in bron")

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("Huidige rollen ophalen uit Supabase...")
    huidige = fetch_huidige(sb)
    print(f"  {len(huidige)} rollen in database")

    nieuw, update, afvoeren, beschermd_weg = diff(df, huidige)
    print("\n=== DIFF RAPPORT ===")
    print(f"  Toevoegen:                      {len(nieuw)}")
    print(f"  Updaten (dims/waarde):          {len(update)}")
    print(f"  Afvoeren (-> verkocht):         {len(afvoeren)}")
    print(f"  Beschermd (workflow-actief):    {len(beschermd_weg)}")

    if beschermd_weg:
        print("\n  Eerste 10 beschermde rollen (niet in bron, workflow-status):")
        for d in beschermd_weg[:10]:
            print(f"    {d['rolnummer']} status={d.get('status')}")

    if update:
        print("\n  Voorbeeld update (eerste 3):")
        huidig_by_id = {h['id']: h for h in huidige}
        for rol_id, bron in update[:3]:
            db = huidig_by_id[rol_id]
            print(f"    {db['rolnummer']}: "
                  f"{db.get('lengte_cm')}x{db.get('breedte_cm')} -> "
                  f"{int(bron['lengte_cm']) if pd.notna(bron['lengte_cm']) else None}x"
                  f"{int(bron['breedte_cm']) if pd.notna(bron['breedte_cm']) else None}")

    if not args.apply:
        print("\nDry-run. Draai opnieuw met --apply om te schrijven.")
        return

    print("\n>>> Schrijven naar Supabase...")

    if nieuw:
        records = [bouw_insert_record(r) for r in nieuw]
        for i in range(0, len(records), 500):
            batch = records[i:i + 500]
            sb.table('rollen').insert(batch).execute()
            print(f"  insert: {min(i + 500, len(records))}/{len(records)}")

    if update:
        for idx, (rol_id, r) in enumerate(update, 1):
            sb.table('rollen').update(bouw_update_record(r)).eq('id', rol_id).execute()
            if idx % 50 == 0:
                print(f"  update: {idx}/{len(update)}")
        print(f"  update: {len(update)}/{len(update)}")

    if afvoeren:
        ids = [d['id'] for d in afvoeren]
        for i in range(0, len(ids), 500):
            batch = ids[i:i + 500]
            sb.table('rollen').update({'status': 'verkocht'}).in_('id', batch).execute()
            print(f"  afvoeren: {min(i + 500, len(ids))}/{len(ids)}")

    print("\nKlaar.")


if __name__ == '__main__':
    main()
