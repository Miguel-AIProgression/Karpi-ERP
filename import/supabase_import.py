"""
RugFlow ERP  Data Import Script
Importeert alle data uit Excel bronbestanden naar Supabase.
Volgorde respecteert FK dependencies.
"""
import sys
import pandas as pd
import numpy as np
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY, DEBITEUREN_FILE, VOORRAAD_FILE

# --- Init ---
if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Supabase URL/Key niet gevonden. Check frontend/.env")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

def clean(val):
    """Convert NaN/NaT to None for JSON serialization"""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating,)):
        return float(val)
    if isinstance(val, pd.Timestamp):
        return val.isoformat()
    return val

def to_records(df):
    """Convert DataFrame to list of dicts with clean values"""
    records = []
    for _, row in df.iterrows():
        records.append({k: clean(v) for k, v in row.items()})
    return records

def upsert_batch(table, records, batch_size=500, on_conflict=None):
    """Upsert records in batches"""
    total = len(records)
    for i in range(0, total, batch_size):
        batch = records[i:i+batch_size]
        kwargs = {}
        if on_conflict:
            kwargs['on_conflict'] = on_conflict
        sb.table(table).upsert(batch, **kwargs).execute()
        print(f"  {table}: {min(i+batch_size, total)}/{total}")
    print(f"   {table}: {total} rijen")

# --- Load Excel ---
print(" Excel bestanden laden...")
deb_xl = pd.ExcelFile(DEBITEUREN_FILE)
df_debiteuren = pd.read_excel(deb_xl, "Debiteuren")
df_afleveradressen = pd.read_excel(deb_xl, "Afleveradressen")
df_klanteigen = pd.read_excel(deb_xl, "Klanteigen_namen")
df_klantartikelnrs = pd.read_excel(deb_xl, "Klantartikelnummers")
df_prijslijsten = pd.read_excel(deb_xl, "Prijslijsten")

vrd_xl = pd.ExcelFile(VOORRAAD_FILE)
df_producten = pd.read_excel(vrd_xl, "Producten")
df_rollen = pd.read_excel(vrd_xl, "Rollen")

print(f"  Debiteuren: {len(df_debiteuren)}, Afleveradressen: {len(df_afleveradressen)}")
print(f"  Producten: {len(df_producten)}, Rollen: {len(df_rollen)}")
print(f"  Klanteigen namen: {len(df_klanteigen)}, Klantartikelnrs: {len(df_klantartikelnrs)}")
print(f"  Prijslijsten: {len(df_prijslijsten)}")

# ============================================================
# STAP 1: Vertegenwoordigers
# ============================================================
print("\n1  Vertegenwoordigers...")
vertw = df_debiteuren['Vertegenwoordiger'].dropna().unique()
vertw_records = [{"code": str(i+1), "naam": str(v)} for i, v in enumerate(vertw) if str(v).strip()]
upsert_batch("vertegenwoordigers", vertw_records, on_conflict="code")

# Build lookup: naam -> code
vertw_map = {r["naam"]: r["code"] for r in vertw_records}

# ============================================================
# STAP 2: Kwaliteiten (geen collecties voor nu)
# ============================================================
print("\n2  Kwaliteiten...")
kwal_producten = set(df_producten['Kwaliteit_code'].dropna().unique())
kwal_klanteigen = set(df_klanteigen['Kwaliteit'].dropna().unique())
alle_kwaliteiten = kwal_producten | kwal_klanteigen

kwal_records = [{"code": str(k)} for k in sorted(alle_kwaliteiten) if str(k).strip()]
print(f"  {len(kwal_records)} unieke kwaliteitscodes")
upsert_batch("kwaliteiten", kwal_records, on_conflict="code")

# ============================================================
# STAP 3: Prijslijst headers
# ============================================================
print("\n3  Prijslijst headers...")
# Collect from prijslijsten tab
pls = df_prijslijsten[['_Prijslijst_nr', '_Prijslijst_naam']].drop_duplicates()
pl_header_records = {
    str(row['_Prijslijst_nr']).strip(): {"nr": str(row['_Prijslijst_nr']).strip(), "naam": clean(row['_Prijslijst_naam'])}
    for _, row in pls.iterrows()
    if str(row['_Prijslijst_nr']).strip()
}
# Also collect from debiteuren (many more prijslijst nrs)
for _, r in df_debiteuren.iterrows():
    if pd.notna(r['Prijslijst']):
        pnr = str(r['Prijslijst']).strip()[:4]
        if pnr and pnr not in pl_header_records:
            pl_header_records[pnr] = {"nr": pnr, "naam": str(r['Prijslijst']).strip()}

pl_records_headers = list(pl_header_records.values())
upsert_batch("prijslijst_headers", pl_records_headers, on_conflict="nr")

# ============================================================
# STAP 4: Debiteuren
# ============================================================
print("\n4  Debiteuren...")
deb_records = []
for _, r in df_debiteuren.iterrows():
    # Extract prijslijst nr (first 4 chars)
    pnr = str(r['Prijslijst']).strip()[:4] if pd.notna(r['Prijslijst']) else None
    # Match vertegenwoordiger naam to code
    vcode = vertw_map.get(str(r['Vertegenwoordiger']).strip()) if pd.notna(r['Vertegenwoordiger']) else None

    deb_records.append({
        "debiteur_nr": int(r['Debiteur']),
        "naam": clean(r['Naam']),
        "status": clean(r['Status']),
        "adres": clean(r['Standaard-adres']),
        "postcode": clean(r['Postcd']),
        "plaats": clean(r['Plaats']),
        "land": clean(r['Land']),
        "telefoon": clean(r['Tel.']),
        "fact_naam": clean(r['Naam (fact.adres)']),
        "fact_adres": clean(r['Adres (fact)']),
        "fact_postcode": clean(r['Postc.']),
        "fact_plaats": clean(r['Plaats (fact)']),
        "email_factuur": clean(r['Mailadres (Fact.)']),
        "email_overig": clean(r['Mailadres (overig)']),
        "email_2": clean(r['Mail-2']),
        "fax": clean(r['Fax']),
        "inkooporganisatie": clean(r['Inkooporg.']),
        "betaler": int(''.join(c for c in str(r['Betaler']).split('-')[0].split(' ')[0] if c.isdigit()) or '0') if pd.notna(r['Betaler']) else None,
        "vertegenw_code": vcode,
        "route": clean(r['Route']),
        "rayon": clean(r['Rayon']),
        "rayon_naam": clean(r['Rayonnaam']),
        "prijslijst_nr": pnr,
        "korting_pct": float(r['% Deb.kort']) if pd.notna(r['% Deb.kort']) else 0,
        "betaalconditie": clean(r['Conditie']),
        "btw_nummer": clean(r['BTW-nummer']),
        "gln_bedrijf": clean(r['GLN_bedrijf']),
    })

# First insert without betaler (self-reference FK)
betaler_map = {}
for rec in deb_records:
    if rec["betaler"]:
        betaler_map[rec["debiteur_nr"]] = rec["betaler"]
        rec["betaler"] = None

upsert_batch("debiteuren", deb_records, on_conflict="debiteur_nr")

# Then update betaler references
if betaler_map:
    print(f"  Updating {len(betaler_map)} betaler references...")
    for debnr, betaler in betaler_map.items():
        try:
            sb.table("debiteuren").update({"betaler": betaler}).eq("debiteur_nr", debnr).execute()
        except Exception:
            pass  # Skip if betaler doesn't exist as debiteur

# Set of all imported debiteur_nrs (for FK validation later)
debnr_set = set(r["debiteur_nr"] for r in deb_records)

# ============================================================
# STAP 5: Afleveradressen
# ============================================================
print("\n5  Afleveradressen...")
afl_records = []
for _, r in df_afleveradressen.iterrows():
    afl_records.append({
        "debiteur_nr": int(r['Debnr']),
        "adres_nr": int(r['Adresnr']),
        "naam": clean(r['Naam']),
        "naam_2": clean(r['Naam 2']),
        "gln_afleveradres": clean(r['GLN_afleveradres']),
        "adres": clean(r['Adres']),
        "postcode": clean(r['Postcd']),
        "plaats": clean(r['Plaats']),
        "land": clean(r['Land']),
        "telefoon": clean(r['Telef.']),
        "email": clean(r['Mailadres']),
        "email_2": clean(r['Mail-2']),
        "route": clean(r['Route']),
        "vertegenw_code": None,  # Not in this export
    })

upsert_batch("afleveradressen", afl_records, on_conflict="debiteur_nr,adres_nr")

# ============================================================
# STAP 6: Producten
# ============================================================
print("\n6  Producten...")
prod_records = []
for _, r in df_producten.iterrows():
    # Bepaal product_type op basis van omschrijving/karpi_code
    oms = str(r['Omschrijving']) if pd.notna(r['Omschrijving']) else ''
    kcode = str(r['Karpi-code']) if pd.notna(r['Karpi-code']) else ''
    if 'BREED' in oms.upper() or 'BREED' in kcode.upper():
        ptype = 'rol'
    elif 'CA:' in oms.upper():
        import re
        m = re.search(r'(?i)CA:\s*(\d+)\s*[xX]\s*(\d+)', oms)
        if m and int(m.group(1)) * int(m.group(2)) < 10000:
            ptype = 'staaltje'
        else:
            ptype = 'vast'
    else:
        ptype = 'overig'

    prod_records.append({
        "artikelnr": str(int(r['Artikelnr'])) if pd.notna(r['Artikelnr']) else None,
        "karpi_code": clean(r['Karpi-code']),
        "ean_code": clean(r['EAN-code']),
        "omschrijving": clean(r['Omschrijving']) or "Onbekend",
        "vervolgomschrijving": clean(r['Vervolgoms.']),
        "voorraad": int(r['Voorraad']) if pd.notna(r['Voorraad']) else 0,
        "backorder": int(r['Backorder']) if pd.notna(r['Backorder']) else 0,
        "gereserveerd": int(r['Gereserveerd']) if pd.notna(r['Gereserveerd']) else 0,
        "besteld_inkoop": int(r['Besteld (ink)']) if pd.notna(r['Besteld (ink)']) else 0,
        "vrije_voorraad": int(r['Vrije voorraad']) if pd.notna(r['Vrije voorraad']) else 0,
        "kwaliteit_code": clean(r['Kwaliteit_code']),
        "kleur_code": clean(r['Kleur_code']),
        "zoeksleutel": clean(r['Zoeksleutel']),
        "product_type": ptype,
    })

# Filter out records without artikelnr
prod_records = [p for p in prod_records if p["artikelnr"]]
upsert_batch("producten", prod_records, on_conflict="artikelnr")

# ============================================================
# STAP 7: Rollen
# ============================================================
print("\n7  Rollen...")
rol_records = []
for _, r in df_rollen.iterrows():
    rol_records.append({
        "rolnummer": str(r['Rolnummer']),
        "artikelnr": str(int(r['Artikelnr'])) if pd.notna(r['Artikelnr']) else None,
        "karpi_code": clean(r['Karpi-code']),
        "omschrijving": clean(r['Omschrijving']),
        "vvp_m2": float(r['VVP_m2']) if pd.notna(r['VVP_m2']) else None,
        "lengte_cm": int(r['Lengte_cm']) if pd.notna(r['Lengte_cm']) else None,
        "breedte_cm": int(r['Breedte_cm']) if pd.notna(r['Breedte_cm']) else None,
        "oppervlak_m2": float(r['Oppervlak']) if pd.notna(r['Oppervlak']) else None,
        "waarde": float(r['Waarde']) if pd.notna(r['Waarde']) else None,
        "kwaliteit_code": clean(r['Kwaliteit_code']),
        "kleur_code": clean(r['Kleur_code']),
        "zoeksleutel": clean(r['Zoeksleutel']),
        "status": "beschikbaar",
    })

# Deduplicate on rolnummer (keep first occurrence)
seen_rollen = set()
rol_unique = []
for rec in rol_records:
    if rec["rolnummer"] not in seen_rollen:
        seen_rollen.add(rec["rolnummer"])
        rol_unique.append(rec)
print(f"  {len(rol_records)} rollen, {len(rol_records) - len(rol_unique)} duplicaten verwijderd")
upsert_batch("rollen", rol_unique, on_conflict="rolnummer")

# ============================================================
# STAP 8: Prijslijst regels
# ============================================================
print("\n8  Prijslijst regels...")
# Only insert regels for articles that exist in producten
product_nrs = set(p["artikelnr"] for p in prod_records)

pl_records = []
for _, r in df_prijslijsten.iterrows():
    artnr = str(int(r['Artikelnr'])) if pd.notna(r['Artikelnr']) else None
    if not artnr or artnr not in product_nrs:
        continue
    pnr = str(r['_Prijslijst_nr']).strip()
    pl_records.append({
        "prijslijst_nr": pnr,
        "artikelnr": artnr,
        "ean_code": clean(r['EAN code']),
        "omschrijving": clean(r['Omschrijving']),
        "omschrijving_2": clean(r['Omschr.2']),
        "prijs": float(r['Prijs']) if pd.notna(r['Prijs']) else 0,
        "gewicht": float(r['Gewicht']) if pd.notna(r['Gewicht']) else None,
    })

upsert_batch("prijslijst_regels", pl_records, on_conflict="prijslijst_nr,artikelnr")

# ============================================================
# STAP 9: Klanteigen namen
# ============================================================
print("\n9  Klanteigen namen...")
# Parse debiteur_nr from "Klant/Inkoopcomb." column (format: "100004/BEAC" or just number)
kn_records = []
kwal_set = set(k["code"] for k in kwal_records)

for _, r in df_klanteigen.iterrows():
    klant_str = str(r['Klant/Inkoopcomb.']).strip()
    # Extract debiteur_nr (digits at start)
    debnr_str = ''.join(c for c in klant_str.split('/')[0] if c.isdigit())
    if not debnr_str:
        continue
    debnr = int(debnr_str)
    kwal = clean(r['Kwaliteit'])
    if not kwal or kwal not in kwal_set:
        continue
    if debnr not in debnr_set:
        continue  # Skip orphaned references

    kn_records.append({
        "debiteur_nr": debnr,
        "kwaliteit_code": kwal,
        "benaming": clean(r['Benaming']) or "",
        "omschrijving": clean(r['Omschrijving']),
        "leverancier": clean(r['Leverancier']),
    })

# Deduplicate on (debiteur_nr, kwaliteit_code)
seen = set()
kn_unique = []
for rec in kn_records:
    key = (rec["debiteur_nr"], rec["kwaliteit_code"])
    if key not in seen:
        seen.add(key)
        kn_unique.append(rec)

upsert_batch("klanteigen_namen", kn_unique, on_conflict="debiteur_nr,kwaliteit_code")

# ============================================================
# STAP 10: Klant artikelnummers
# ============================================================
print("\n Klant artikelnummers...")
ka_records = []
for _, r in df_klantartikelnrs.iterrows():
    debnr = int(r['Debiteur']) if pd.notna(r['Debiteur']) else None
    artnr = str(int(r['Artikel'])) if pd.notna(r['Artikel']) else None
    if not debnr or not artnr or artnr not in product_nrs or debnr not in debnr_set:
        continue

    ka_records.append({
        "debiteur_nr": debnr,
        "artikelnr": artnr,
        "klant_artikel": clean(r['Klant-artikel']) or "",
        "omschrijving": clean(r['Omschrijving']),
        "vervolg": clean(r['Vervolg']),
    })

# Deduplicate
seen = set()
ka_unique = []
for rec in ka_records:
    key = (rec["debiteur_nr"], rec["artikelnr"])
    if key not in seen:
        seen.add(key)
        ka_unique.append(rec)

upsert_batch("klant_artikelnummers", ka_unique, on_conflict="debiteur_nr,artikelnr")

# ============================================================
# DONE
# ============================================================
print("\n Import compleet!")
print(f"  Vertegenwoordigers: {len(vertw_records)}")
print(f"  Kwaliteiten: {len(kwal_records)}")
print(f"  Prijslijst headers: {len(pl_records)}")
print(f"  Debiteuren: {len(deb_records)}")
print(f"  Afleveradressen: {len(afl_records)}")
print(f"  Producten: {len(prod_records)}")
print(f"  Rollen: {len(rol_records)}")
print(f"  Prijslijst regels: {len(pl_records)}")
print(f"  Klanteigen namen: {len(kn_unique)}")
print(f"  Klant artikelnummers: {len(ka_unique)}")
