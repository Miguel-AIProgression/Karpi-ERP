#!/usr/bin/env python3
"""
Genereer maatwerk_band_defaults uit smalband.xlsx (nieuw formaat).
Formaat: elke rij = één bandcode, cellen bevatten 'kwaliteitnaam kleurnummer'-paren.
Kolom 0 = merk (Piero, Florence, ...), kolom 1 = code, kolom 2 = omschrijving.
"""
import pandas as pd, re

NAAM_NAAR_CODE = {
    'birma':    ['BIRM'],
    'cachet':   ['CACH'],
    'cisco':    ['CISC', 'VELV'],   # VELV is uitwisselbaar met CISC
    'ciso':     ['CISC', 'VELV'],   # typfout in bronbestand
    'elias':    ['ELIA'],
    'galaxy':   ['GALA'],
    'lonrda':   ['LORA'],           # typfout in bronbestand
    'lorand':   ['LORA'],
    'loranda':  ['LORA'],
    'louvre':   ['LOUV'],
    'luxury':   ['LUXR', 'VERR'],   # VERR (Vernon) is uitwisselbaar met LUXR
    'magic':    ['MAGI'],
    'marich':   ['MARI'],
    'plush':    ['PLUS'],
    'rich':     ['RICH'],
    'splendid': ['SPLE'],
    'vemi':     ['VEMI', 'LAMI'],   # LAMI is uitwisselbaar met VEMI
    'veri':     ['VERI', 'LAGO'],   # LAGO is uitwisselbaar met VERI
}

BEKENDE_MERKEN = {'Piero', 'Florence'}

xl = pd.ExcelFile('/Users/pd/Desktop/claude/Karpi-ERP/op maat productie /smalband.xlsx')
df = pd.read_excel(xl, 'Blad1', header=None, dtype=str)

sb_rows = []   # (kwal_code, kleur_code, merk, band_code, omschr)

for _, row in df.iterrows():
    merk = str(row.iloc[0]).strip()
    if merk not in BEKENDE_MERKEN:
        continue
    band_code = str(row.iloc[1]).strip().split('.')[0]
    omschr = str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else ''
    if not band_code or band_code == 'nan':
        continue

    for col in range(3, len(row)):
        cell = str(row.iloc[col]).strip() if pd.notna(row.iloc[col]) else ''
        if not cell or cell == 'nan':
            continue
        # Verwijder toelichting tussen haakjes
        cell_clean = re.sub(r'\s*\(.*?\)', '', cell).strip()
        m = re.match(r'^([A-Za-z]+)\s+(\d+)', cell_clean)
        if not m:
            continue
        naam = m.group(1).lower()
        kleur = m.group(2)
        kwals = NAAM_NAAR_CODE.get(naam)
        if not kwals:
            print(f"ONBEKENDE NAAM: '{naam}' in cel '{cell}'")
            continue
        for kwal in kwals:
            sb_rows.append((kwal, kleur, merk, band_code, omschr))

# Eerste match per kwal+kleur (Piero heeft prioriteit boven Florence)
seen = {}
piero_rows = [(kwal, kleur, merk, code, omschr) for kwal, kleur, merk, code, omschr in sb_rows if merk == 'Piero']
other_rows = [(kwal, kleur, merk, code, omschr) for kwal, kleur, merk, code, omschr in sb_rows if merk != 'Piero']
for kwal, kleur, merk, code, omschr in piero_rows + other_rows:
    key = (kwal, kleur)
    if key not in seen:
        seen[key] = (merk, code, omschr)

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
for (kwal, kleur), (merk, band_code, omschr) in sorted(seen.items()):
    merk_safe = merk.replace("'", "''")
    omschr_safe = omschr.replace("'", "''")
    sql_parts.append("  ('{}', '{}', '{}', '{}', '{}')".format(kwal, kleur, merk_safe, band_code, omschr_safe))
for (kwal, kleur), (band_code, opm) in sorted(b_band.items()):
    if (kwal, kleur) not in seen:  # SB heeft prioriteit
        opm_safe = opm.replace("'", "''")
        sql_parts.append("  ('{}', '{}', 'Piero', '{}', '{}')".format(kwal, kleur, band_code, opm_safe))

values = ",\n".join(sql_parts)

sql = """-- Standaard bandkleur per kwaliteit + kleur — volledig hergenereerd.
-- Bron: smalband.xlsx (rij=merk+code, cellen=kwaliteit+kleur)
--       Art + aliassen + afwerking 22-04-2026.xlsx (B breedband)

CREATE TABLE IF NOT EXISTS maatwerk_band_defaults (
  kwaliteit_code    TEXT NOT NULL,
  kleur_code        TEXT NOT NULL,
  band_merk         TEXT NOT NULL DEFAULT 'Piero',
  band_kleur        TEXT NOT NULL,
  band_omschrijving TEXT,
  PRIMARY KEY (kwaliteit_code, kleur_code)
);

ALTER TABLE maatwerk_band_defaults
  ADD COLUMN IF NOT EXISTS band_merk TEXT NOT NULL DEFAULT 'Piero';

INSERT INTO maatwerk_band_defaults (kwaliteit_code, kleur_code, band_merk, band_kleur, band_omschrijving)
VALUES
{values}
ON CONFLICT (kwaliteit_code, kleur_code)
  DO UPDATE SET
    band_merk         = EXCLUDED.band_merk,
    band_kleur        = EXCLUDED.band_kleur,
    band_omschrijving = EXCLUDED.band_omschrijving;
""".format(values=values)

out = '/Users/pd/Desktop/claude/Karpi-ERP/supabase/migrations/111_band_defaults_met_merk.sql'
with open(out, 'w') as f:
    f.write(sql)

sb_count = len(seen)
b_count = sum(1 for k in b_band if k not in seen)
print("SB rijen: {}  B rijen: {}  Totaal: {}".format(sb_count, b_count, sb_count + b_count))
print("Merken:", sorted({m for m, _, _ in seen.values()}))
print("Kwaliteiten gedekt:", sorted({k for k, _ in seen.keys()}))
print("Opgeslagen:", out)
