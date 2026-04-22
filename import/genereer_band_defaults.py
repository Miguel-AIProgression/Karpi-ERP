#!/usr/bin/env python3
"""
Genereer maatwerk_band_defaults uit Smalbandafw Collectie 2024 - juli 2025.xlsx.
Kolommen zijn kwaliteitnamen, rijen zijn PIERO-codes, cellen bevatten kleurnummers.
"""
import pandas as pd, re

NAAM_NAAR_CODE = {
    # SB tuft
    'Birma': ['BIRM'],
    'Cachet': ['CACH'],
    'Cisco/VELV': ['CISC', 'VELV'],
    'Elias': ['ELIA'],
    'Frisco': ['FRIS'],
    'Leslie / Galaxy': ['LESL', 'GALA'],
    'Loranda       tbv Dld': ['LORA'],
    'Louvre': ['LOUV'],
    'Magic': ['MAGI'],
    'Marich': ['MARI'],
    'Plush': ['PLUS'],
    'Rich': ['RICH'],
    'Splendid': ['SPLE'],
    'VERI': ['VERI', 'LAMI', 'LAGO'],
    'VEMI': ['VEMI'],
    'Vernon/ Luxury': ['VERR', 'LUXR'],
    'Destiny': ['DYST'],
    # SB sisal
    'S.Gold': ['GOLD', 'GOKI'],
    'Radius': ['RADI', 'RADS'],
    'Matric': ['MATR'],
    'Marly': ['MARL'],
    'Ramses': ['RAMS'],
    # SB uit coll
    'Bergamo': ['BERG'],
    'Berko': ['BERK'],
    'Blanche': ['BLAN'],
    'Calida': ['CALI'],
    'Coral uni': ['CORU'],
    'Diego': ['DIEG'],
    'Jumbo': ['JUMB'],
    'Lucia': ['LUCI'],
    'Motion': ['MOTI'],
    'Pearl': ['PEAR'],
    'Pisa': ['PISA'],
    'Residence': ['RESI'],
    'Salsa': ['SALS'],
    'Spaghetti': ['SPAG'],
    'Verona': ['VERO'],
}

sb_rows = []

def parse(df, header_row, data_start, col_start=2):
    header = df.iloc[header_row]
    for col_idx in range(col_start, len(df.columns)):
        naam = str(header.iloc[col_idx]).strip() if pd.notna(header.iloc[col_idx]) else ''
        kwals = NAAM_NAAR_CODE.get(naam, [])
        if not kwals:
            continue
        for row_idx in range(data_start, len(df)):
            piero = str(df.iat[row_idx, 0]).strip() if pd.notna(df.iat[row_idx, 0]) else ''
            omschr = str(df.iat[row_idx, 1]).strip() if pd.notna(df.iat[row_idx, 1]) else ''
            cell = str(df.iat[row_idx, col_idx]).strip() if pd.notna(df.iat[row_idx, col_idx]) else ''
            if not piero or not cell or cell == 'nan' or not re.match(r'^\d', piero):
                continue
            piero = piero.split('.')[0]
            omschr_clean = re.sub(r'[^a-zA-Z. ]', '', omschr).strip()
            for kleur in re.findall(r'\d+', cell):
                for kwal in kwals:
                    sb_rows.append((kwal, kleur, piero, omschr_clean))

xl = pd.ExcelFile('/Users/pd/Desktop/claude/Karpi-ERP/op maat productie /Smalbandafw Collectie 2024 - juli 2025.xlsx')
parse(pd.read_excel(xl, 'SB tuft',     header=None, dtype=str), 3, 4)
parse(pd.read_excel(xl, 'SB sisal',    header=None, dtype=str), 4, 5)
parse(pd.read_excel(xl, 'SB uit coll', header=None, dtype=str), 2, 3)

# Eerste PIERO per kwal+kleur (de meest specifieke)
seen = {}
for kwal, kleur, piero, omschr in sb_rows:
    key = (kwal, kleur)
    if key not in seen:
        seen[key] = (piero, omschr)

# B breedband bandcodes uit Art + aliassen
df_art = pd.read_excel(
    '/Users/pd/Desktop/claude/Karpi-ERP/op maat productie /Art + aliassen + afwerking 22-04-2026.xlsx',
    header=None, dtype=str
)
df_art = df_art[1:].reset_index(drop=True)
df_art.columns = ['artikel', 'type', 'num', 'kwal_kleur', 'afw', 'afw2', 'opm1', 'opm2']

b_band = {}
for _, row in df_art[(df_art['afw'] == 'B') & df_art['opm2'].notna()].iterrows():
    kwal_kleur = str(row['kwal_kleur']).strip()
    opm = str(row['opm2']).strip()
    m = re.match(r'^([A-Z]{4})(\d{2})', kwal_kleur)
    if not m:
        continue
    kwal, kleur = m.group(1), m.group(2)
    code_m = re.search(r'\b([A-Z]{2,3}\d{2})\b', opm)
    if code_m:
        b_band[(kwal, kleur)] = (code_m.group(1), opm)

# Bouw SQL
sql_parts = []
for (kwal, kleur), (piero, omschr) in sorted(seen.items()):
    omschr_safe = omschr.replace("'", "''")
    sql_parts.append("  ('{}', '{}', '{}', '{}')".format(kwal, kleur, piero, omschr_safe))
for (kwal, kleur), (band_code, opm) in sorted(b_band.items()):
    if (kwal, kleur) not in seen:  # SB heeft prioriteit
        opm_safe = opm.replace("'", "''")
        sql_parts.append("  ('{}', '{}', '{}', '{}')".format(kwal, kleur, band_code, opm_safe))

values = ",\n".join(sql_parts)

sql = """-- Standaard bandkleur per kwaliteit + kleur — volledig hergenereerd.
-- Bronnen: Smalbandafw Collectie 2024 - juli 2025.xlsx (SB/sisal/uit-coll)
--          Art + aliassen + afwerking 22-04-2026.xlsx (B breedband)

CREATE TABLE IF NOT EXISTS maatwerk_band_defaults (
  kwaliteit_code    TEXT NOT NULL,
  kleur_code        TEXT NOT NULL,
  band_kleur        TEXT NOT NULL,
  band_omschrijving TEXT,
  PRIMARY KEY (kwaliteit_code, kleur_code)
);

INSERT INTO maatwerk_band_defaults (kwaliteit_code, kleur_code, band_kleur, band_omschrijving)
VALUES
{values}
ON CONFLICT (kwaliteit_code, kleur_code)
  DO UPDATE SET
    band_kleur        = EXCLUDED.band_kleur,
    band_omschrijving = EXCLUDED.band_omschrijving;
""".format(values=values)

out = '/Users/pd/Desktop/claude/Karpi-ERP/supabase/migrations/108_band_defaults_volledig.sql'
with open(out, 'w') as f:
    f.write(sql)

print("SB rijen: {}  B rijen: {}  Totaal: {}".format(len(seen), len(b_band), len(seen)+len(b_band)))
print("Opgeslagen:", out)

# Toon nieuwe kwaliteiten tov vorige run
prev = {'BIRM','CACH','CISC','VELV','ELIA','FRIS','LESL','GALA','LORA','LOUV','MAGI','MARI','PLUS','SPLE',
        'VERI','LAMI','LAGO','VEMI','VERR','LUXR','DYST','GOLD','GOKI','BERG','BLAN','CORU','MOTI','SPAG','BERM'}
new_kwals = {k for k,_ in seen.keys()} - prev
print("Nieuwe kwaliteiten:", sorted(new_kwals))
