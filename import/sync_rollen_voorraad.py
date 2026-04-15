"""
Sync rollen-tabel in Supabase met actuele fysieke voorraad uit Excel-snapshot.

Draai standaard in dry-run:  python sync_rollen_voorraad.py
Schrijf wijzigingen:          python sync_rollen_voorraad.py --apply
"""
import argparse
import pandas as pd
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY, ROLLEN_SYNC_FILE


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

    # TODO Task 2: diff + rapport
    # TODO Task 3: apply
    print("(skeleton — diff/apply komt in Task 2/3)")


if __name__ == '__main__':
    main()
