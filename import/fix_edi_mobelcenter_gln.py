"""Fix EDI-koppeling Möbelcenter Biller (debiteur 132002), berichten 111/112/113.

A. Repareer gln_bedrijf 132002: 426008649003.0 (kapot, 12 cijfers) -> 4260086490003.
B. Zet vestiging-GLN op de 4 bestaande afleveradressen.
C. Maak 2 nieuwe afleveradressen voor de tweede-GLN-per-adres uit het adresboek.
D. Koppel de 3 vastgelopen EDI-berichten via koppel_edi_afleveradres (zet GLN + maakt order).

Dry-run default; voeg --apply toe om te schrijven.
"""
import sys
from config import SUPABASE_URL, SUPABASE_KEY
from supabase import create_client

APPLY = "--apply" in sys.argv
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

DEB = 132002
GLN_BEDRIJF_OUD = "426008649003.0"
GLN_BEDRIJF_NIEUW = "4260086490003"

# B: bestaande afleveradres-id -> GLN (uit adresboek-screenshot)
ATTACH = {
    215: "4260086490010",  # Am Moos 17, Eching        (#111)
    216: "4260086490614",  # An den Mühlwiesen 2, Hof   (#112)
    217: "4260086490560",  # Fedor-Schnorr-Straße 31, Plauen
    218: "4260086490515",  # Rosa-Luxemburg-Platz 7, Plauen (#113)
}
# C: nieuwe rijen (tweede GLN op zelfde fysieke adres)
NIEUW = [
    {"gln": "4260086490621", "adres": "AN DEN MUEHLENWIESEN 2", "postcode": "95032",
     "plaats": "HOF/MOSCHENDORF", "land": "DEUTSCHLAND", "naam": "MOEBELCENTER BILLER"},
    {"gln": "4260086490522", "adres": "ROSA-LUXEMBURG-PLATZ 7", "postcode": "8523",
     "plaats": "PLAUEN", "land": "DEUTSCHLAND", "naam": "MOEBELCENTER BILLER"},
]
# D: bericht -> afleveradres-id
KOPPEL = [(111, 215), (112, 216), (113, 218)]

print(f"=== PLAN (debiteur {DEB})  {'APPLY' if APPLY else 'DRY-RUN'} ===\n")
print(f"A. gln_bedrijf: {GLN_BEDRIJF_OUD!r} -> {GLN_BEDRIJF_NIEUW!r}")
print("B. GLN op bestaand afleveradres:")
for aid, g in ATTACH.items():
    print(f"     adres id={aid}  <- {g}")
print("C. Nieuw afleveradres aanmaken:")
for n in NIEUW:
    print(f"     {n['gln']}  {n['adres']} / {n['plaats']}")
print("D. EDI-bericht koppelen + order aanmaken:")
for bid, aid in KOPPEL:
    print(f"     bericht #{bid} -> adres id={aid}")

if not APPLY:
    print("\n(DRY-RUN — niets geschreven. Voeg --apply toe.)")
    sys.exit(0)

print("\n--- A. gln_bedrijf repareren ---")
sb.table("debiteuren").update({"gln_bedrijf": GLN_BEDRIJF_NIEUW}).eq("debiteur_nr", DEB).execute()
print("   ok")

print("--- B. GLN's op bestaande afleveradressen ---")
for aid, g in ATTACH.items():
    sb.table("afleveradressen").update({"gln_afleveradres": g}).eq("id", aid).execute()
    print(f"   id={aid} <- {g}")

print("--- C. Nieuwe afleveradressen ---")
maxadr = max([a["adres_nr"] or 0 for a in
              sb.table("afleveradressen").select("adres_nr").eq("debiteur_nr", DEB).execute().data], default=0)
for n in NIEUW:
    maxadr += 1
    sb.table("afleveradressen").insert({
        "debiteur_nr": DEB, "adres_nr": maxadr, "naam": n["naam"], "gln_afleveradres": n["gln"],
        "adres": n["adres"], "postcode": n["postcode"], "plaats": n["plaats"], "land": n["land"],
    }).execute()
    print(f"   adres_nr={maxadr}  {n['gln']}  {n['adres']}")

print("--- D. Berichten koppelen (koppel_edi_afleveradres) ---")
for bid, aid in KOPPEL:
    r = sb.rpc("koppel_edi_afleveradres", {
        "p_bericht_id": bid, "p_debiteur_nr": DEB, "p_afleveradres_id": aid
    }).execute()
    print(f"   bericht #{bid} -> order_id={r.data}")

print("\nKlaar.")
