"""
Import kwaliteit-aliassen (uitwisselbare groepen) uit Excel naar Supabase.
Bron: "Kwaliteit lijsten aliassen 26-08-2024.xlsx"

1. Upsert collecties (56 groepen)
2. Update kwaliteiten.collectie_id voor alle gekoppelde codes
"""
import sys
import openpyxl
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

ALIASSEN_FILE = BASE_DIR / "Kwaliteit lijsten aliassen 26-08-2024.xlsx"

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Supabase URL/Key niet gevonden. Check import/.env")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- Load Excel ---
print(f"Laden: {ALIASSEN_FILE.name}")
wb = openpyxl.load_workbook(ALIASSEN_FILE, read_only=True)
ws = wb["Blad1"]

groepen = []
for row in ws.iter_rows(values_only=True):
    groep_code = str(row[0]).strip() if row[0] else None
    naam = str(row[1]).strip() if row[1] else None
    codes = [str(c).strip().upper() for c in row[2:] if c is not None and str(c).strip()]
    if groep_code and naam and codes:
        # Normalize groep_code (some rows have "42" instead of "x42")
        if not groep_code.startswith("x"):
            groep_code = f"x{groep_code}"
        groepen.append({"groep_code": groep_code, "naam": naam, "codes": codes})

print(f"  {len(groepen)} groepen gevonden, {sum(len(g['codes']) for g in groepen)} kwaliteitscodes totaal")

# --- Stap 1: Upsert collecties ---
print("\n1. Collecties upserten...")
collectie_records = [
    {"groep_code": g["groep_code"], "naam": g["naam"], "actief": True}
    for g in groepen
]
sb.table("collecties").upsert(collectie_records, on_conflict="groep_code").execute()
print(f"   {len(collectie_records)} collecties")

# --- Stap 2: Fetch collectie IDs ---
print("\n2. Collectie IDs ophalen...")
result = sb.table("collecties").select("id, groep_code").execute()
id_map = {r["groep_code"]: r["id"] for r in result.data}

# --- Stap 3: Reset alle collectie_id's (clean start) ---
print("\n3. Bestaande koppelingen resetten...")
sb.table("kwaliteiten").update({"collectie_id": None}).not_.is_("collectie_id", "null").execute()

# --- Stap 4: Update kwaliteiten met collectie_id ---
print("\n4. Kwaliteiten koppelen aan collecties...")
gekoppeld = 0
niet_gevonden = []

for g in groepen:
    collectie_id = id_map.get(g["groep_code"])
    if not collectie_id:
        print(f"   WARN: collectie {g['groep_code']} niet gevonden in database")
        continue

    for code in g["codes"]:
        # Check if kwaliteit exists
        check = sb.table("kwaliteiten").select("code").eq("code", code).execute()
        if check.data:
            sb.table("kwaliteiten").update({"collectie_id": collectie_id}).eq("code", code).execute()
            gekoppeld += 1
        else:
            # Create kwaliteit if it doesn't exist
            sb.table("kwaliteiten").upsert(
                {"code": code, "collectie_id": collectie_id},
                on_conflict="code"
            ).execute()
            gekoppeld += 1
            niet_gevonden.append(code)

print(f"   {gekoppeld} kwaliteiten gekoppeld aan collecties")
if niet_gevonden:
    print(f"   {len(niet_gevonden)} nieuwe kwaliteiten aangemaakt: {niet_gevonden}")

# --- Verificatie ---
print("\n5. Verificatie...")
result = sb.table("collecties").select("id", count="exact").execute()
print(f"   Collecties: {result.count}")
result = sb.table("kwaliteiten").select("code", count="exact").not_.is_("collectie_id", "null").execute()
print(f"   Kwaliteiten met collectie: {result.count}")
result = sb.table("kwaliteiten").select("code", count="exact").execute()
print(f"   Kwaliteiten totaal: {result.count}")

print("\nKlaar!")
