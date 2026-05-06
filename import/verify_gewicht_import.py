"""Snelle verificatie na kwaliteit-gewicht-import."""
import sys
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# 1. Kwaliteiten met gewicht
res = sb.table("kwaliteiten").select("code", count="exact").not_.is_("gewicht_per_m2_kg", "null").execute()
print(f"[1] Kwaliteiten met gewicht_per_m2_kg ingevuld: {res.count}")

res2 = sb.table("kwaliteiten").select("code", count="exact").is_("gewicht_per_m2_kg", "null").execute()
print(f"    Zonder gewicht: {res2.count}")

# 2. Producten met gewicht_uit_kwaliteit = true
res3 = sb.table("producten").select("artikelnr", count="exact").eq("gewicht_uit_kwaliteit", True).execute()
print(f"[2] Producten met gederiveerd gewicht (uit kwaliteit): {res3.count}")

res4 = sb.table("producten").select("artikelnr", count="exact").eq("gewicht_uit_kwaliteit", False).in_("product_type", ["vast", "staaltje"]).execute()
print(f"    Vast/staaltje-producten nog op legacy gewicht: {res4.count}")

# 3. Spot-check: 3 willekeurige kwaliteiten + bijbehorend product
print("\n[3] Spot-check (3 kwaliteiten):")
for code in ["MIRA", "BEAC", "CISC"]:
    kw = sb.table("kwaliteiten").select("code, omschrijving, gewicht_per_m2_kg").eq("code", code).execute()
    if kw.data:
        row = kw.data[0]
        print(f"    {row['code']} ({row['omschrijving']}): {row['gewicht_per_m2_kg']} kg/m2")
        # 1 product van die kwaliteit
        p = sb.table("producten").select("artikelnr, lengte_cm, breedte_cm, gewicht_kg, gewicht_uit_kwaliteit") \
            .eq("kwaliteit_code", code).eq("gewicht_uit_kwaliteit", True).limit(1).execute()
        if p.data:
            pr = p.data[0]
            verwacht = round((pr["lengte_cm"] * pr["breedte_cm"] / 10000) * float(row["gewicht_per_m2_kg"]), 2) if pr["lengte_cm"] and pr["breedte_cm"] else None
            print(f"      voorbeeld: {pr['artikelnr']} {pr['lengte_cm']}x{pr['breedte_cm']} cm = {pr['gewicht_kg']} kg  (verwacht: {verwacht})")
