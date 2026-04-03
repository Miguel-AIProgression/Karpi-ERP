"""
Fix vertegenwoordiger codes.

Problem: supabase_import.py assigned sequential codes (1,2,3...) via enumerate()
to vertegenwoordiger names, while import_orders_full.py used the REAL codes from
the old system. Result: 99.8% of orders have mismatched vertegenw_code.

Fix: re-map vertegenwoordigers to old-system codes and update debiteuren accordingly.
Orders already have correct codes.
"""

import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import pandas as pd
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY

sb = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_all(table, columns):
    """Fetch all rows with pagination (Supabase default limit = 1000)."""
    all_data = []
    page_size = 1000
    offset = 0
    while True:
        res = sb.table(table).select(columns).range(offset, offset + page_size - 1).execute()
        all_data.extend(res.data)
        if len(res.data) < page_size:
            break
        offset += page_size
    return all_data


# --- Step 1: Build correct code->name mapping from cross-referencing Excel files ---
df_deb = pd.read_excel('../brondata/debiteuren/Karpi_Debiteuren_Import.xlsx')
df_ord = pd.read_excel('../Orders per 11-3-2026 (1).xlsx')

# Cross-reference: debiteur_nr links name (debiteuren) to code (orders)
deb_vert = df_deb[['Debiteur', 'Vertegenwoordiger']].dropna(subset=['Vertegenwoordiger']).drop_duplicates()
ord_vert = df_ord[['Debiteur', 'Vert.']].dropna(subset=['Vert.']).drop_duplicates()
ord_vert_mode = ord_vert.groupby('Debiteur')['Vert.'].agg(lambda x: x.mode().iloc[0]).reset_index()
merged = deb_vert.merge(ord_vert_mode, on='Debiteur', how='inner')

# Most common code per name
from collections import Counter
name_to_code = {}
for _, row in merged.iterrows():
    name = row['Vertegenwoordiger']
    code = int(row['Vert.'])
    name_to_code.setdefault(name, []).append(code)

correct_name_to_code = {}
for name, codes in name_to_code.items():
    correct_name_to_code[name] = Counter(codes).most_common(1)[0][0]

print("Verified mappings (name -> old-system code):")
for name, code in sorted(correct_name_to_code.items(), key=lambda x: x[1]):
    print(f"  {code:>2} = {name}")

# --- Step 2: Assign codes to unmapped names (no orders exist) ---
all_names = set(df_deb['Vertegenwoordiger'].dropna().unique())
mapped_names = set(correct_name_to_code.keys())
unmapped_names = sorted(all_names - mapped_names)

# Codes already used by old system (from orders)
used_codes = set(df_ord['Vert.'].dropna().astype(int).unique()) | set(correct_name_to_code.values())
next_code = 1

print(f"\nAssigning codes to {len(unmapped_names)} names without orders:")
for name in unmapped_names:
    while next_code in used_codes:
        next_code += 1
    correct_name_to_code[name] = next_code
    print(f"  {next_code:>2} = {name} (new)")
    used_codes.add(next_code)
    next_code += 1

# Also keep codes that appear in orders but have no debiteur name match (14, 25)
all_order_codes = set(df_ord['Vert.'].dropna().astype(int).unique())
codes_with_names = set(correct_name_to_code.values())
orphan_codes = all_order_codes - codes_with_names
if orphan_codes:
    print(f"\nOrphan codes in orders (keeping generic names): {sorted(orphan_codes)}")

# --- Step 3: Build complete code->name for vertegenwoordigers table ---
code_to_name = {code: name for name, code in correct_name_to_code.items()}
# Add orphan codes with generic names
for code in orphan_codes:
    if code not in code_to_name:
        code_to_name[code] = f"Vertegenwoordiger {code}"

print(f"\n{'='*50}")
print(f"Complete vertegenwoordigers table ({len(code_to_name)} records):")
for code in sorted(code_to_name.keys()):
    print(f"  {code:>2} = {code_to_name[code]}")

# --- Step 4: Apply fixes to database ---
input("\nPress Enter to apply fixes to database...")

# 4a. Get current vertegenwoordigers
current = sb.table("vertegenwoordigers").select("code, naam").execute().data
current_codes = {r['code'] for r in current}
print(f"\nCurrent vertegenwoordigers: {len(current)} records")

# 4b. Ensure all target codes exist in vertegenwoordigers table FIRST
print("\nEnsuring all vertegenwoordiger codes exist...")
for code, name in sorted(code_to_name.items()):
    str_code = str(code)
    if str_code not in current_codes:
        sb.table("vertegenwoordigers").insert({
            "code": str_code,
            "naam": name
        }).execute()
        print(f"  Inserted: {code} = {name}")
    else:
        existing_name = next((r['naam'] for r in current if r['code'] == str_code), None)
        if existing_name != name:
            sb.table("vertegenwoordigers").update({
                "naam": name
            }).eq("code", str_code).execute()
            print(f"  Updated: {str_code}: '{existing_name}' -> '{name}'")

# 4c. Update ALL debiteuren (with pagination)
print("\nFetching all debiteuren...")
debiteuren = fetch_all("debiteuren", "debiteur_nr, vertegenw_code")
print(f"  Fetched {len(debiteuren)} debiteuren")

# Build debiteur_nr -> name from Excel
deb_name_map = {}
for _, row in df_deb.iterrows():
    if pd.notna(row['Vertegenwoordiger']):
        deb_name_map[int(row['Debiteur'])] = row['Vertegenwoordiger']

updates = []
for deb in debiteuren:
    name = deb_name_map.get(deb['debiteur_nr'])
    if name and name in correct_name_to_code:
        new_code = str(correct_name_to_code[name])
        if deb['vertegenw_code'] != new_code:
            updates.append({
                'debiteur_nr': deb['debiteur_nr'],
                'new_code': new_code,
            })

print(f"  {len(updates)} debiteuren to update")

# Apply updates
print("\nApplying debiteur updates...")
for i in range(0, len(updates), 50):
    batch = updates[i:i+50]
    for u in batch:
        sb.table("debiteuren").update({
            "vertegenw_code": u['new_code']
        }).eq("debiteur_nr", u['debiteur_nr']).execute()
    done = min(i+50, len(updates))
    if done % 500 == 0 or done == len(updates):
        print(f"  Updated {done}/{len(updates)}")

# 4d. Clean up unused vertegenwoordiger codes
print("\nCleaning up unused vertegenwoordiger codes...")
all_used_codes = set()
for deb in fetch_all("debiteuren", "vertegenw_code"):
    if deb['vertegenw_code']:
        all_used_codes.add(deb['vertegenw_code'])
for o in fetch_all("orders", "vertegenw_code"):
    if o['vertegenw_code']:
        all_used_codes.add(o['vertegenw_code'])

current_after = sb.table("vertegenwoordigers").select("code, naam").execute().data
for r in current_after:
    if r['code'] not in all_used_codes and int(r['code']) not in code_to_name:
        sb.table("vertegenwoordigers").delete().eq("code", r['code']).execute()
        print(f"  Deleted unused: {r['code']} = {r['naam']}")

# --- Step 5: Verify ---
print(f"\n{'='*50}")
print("VERIFICATION")

orders = fetch_all("orders", "order_nr,vertegenw_code,debiteur_nr")
deb_map = {d['debiteur_nr']: d['vertegenw_code'] for d in fetch_all("debiteuren", "debiteur_nr,vertegenw_code")}

total = 0
mismatches = 0
for o in orders:
    deb_code = deb_map.get(o['debiteur_nr'])
    if deb_code is not None and o['vertegenw_code'] is not None:
        total += 1
        if deb_code != o['vertegenw_code']:
            mismatches += 1

print(f"  Orders with comparable codes: {total}")
if total > 0:
    print(f"  Matches: {total - mismatches} ({100*(total-mismatches)/total:.1f}%)")
    print(f"  Legitimate mismatches: {mismatches} ({100*mismatches/total:.1f}%)")
    print("  (Some mismatches expected: vertegenwoordiger may have changed since order was placed)")
print("\nDone!")
