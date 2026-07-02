"""Fix EDI-koppeling Hornbach NL (debiteur 361208), berichten 102/109.

Bron: Transus-adresboek "Hornbach Nederland B.V." (22 NL-vestigingen, 8717056...).
A. Zet vestiging-GLN op 16 bestaande afleveradressen (expliciete id->GLN, op postcode geverifieerd).
B. Maak 2 nieuwe afleveradressen (Beuningen, Eindhoven — niet in 361208).
C. Koppel de 2 vastgelopen EDI-berichten via koppel_edi_afleveradres (zet GLN + maakt order).
   #102 -> Wiebachstraat 77C Kerkrade (id 3786);  #109 -> Kelvinring 60 Alblasserdam (id 3767)

4 afleveradressen hebben al een GLN (3773/3774/3777/3779) -> overgeslagen.
Dry-run default; voeg --apply toe om te schrijven.
"""
import sys
from config import SUPABASE_URL, SUPABASE_KEY
from supabase import create_client

APPLY = "--apply" in sys.argv
sb = create_client(SUPABASE_URL, SUPABASE_KEY)
DEB = 361208

# A: bestaande afleveradres-id -> vestiging-GLN (uit NL-adresboek)
ATTACH = {
    3780: "8717056697239",  # Berchvliet 14, Amsterdam
    3785: "8717056697277",  # De Voorwaarts 750, Apeldoorn
    3778: "8717056697215",  # Einighauserweg 101, Geleen
    3769: "8717056697147",  # Groningerweg 45/2, Groningen
    3783: "8717056696539",  # Grootslag 1-5, Houten
    3772: "8717056697116",  # Hestiastraat 1, Tilburg
    3788: "8717056697291",  # Wendelring 3 / "Hornbach Nijmegen 729", Nijmegen (pc 6515AN)
    3782: "8717056697253",  # Katwolderweg 6, Zwolle
    3767: "8717056697185",  # Kelvinring 60, Alblasserdam        (#109)
    3768: "8717056697192",  # Konijnenberg 33, Breda
    3784: "8717056697260",  # Nieuwgraaf 18, Duiven
    3770: "8717056697123",  # Roda J.C. Ring 4, Kerkrade
    3781: "8717056697246",  # Singel 115, Den Haag
    3771: "8717056697154",  # Veldwade 3, Nieuwegein
    3786: "8717056693200",  # Wiebachstraat 77C, Kerkrade        (#102)
    3787: "8717056697284",  # Zuiderval 175, Enschede
}
# B: nieuwe rijen (vestiging niet aanwezig in 361208)
NIEUW = [
    {"gln": "8717056693217", "adres": "CLAUDIUSLAAN 62", "postcode": "6642AG",
     "plaats": "BEUNINGEN GLD", "land": "NEDERLAND", "naam": "HORNBACH BEUNINGEN"},
    {"gln": "8717056694542", "adres": "DE SCHAKEL 39-41", "postcode": "5651GH",
     "plaats": "EINDHOVEN", "land": "NEDERLAND", "naam": "HORNBACH EINDHOVEN"},
]
# C: bericht -> afleveradres-id
KOPPEL = [(102, 3786), (109, 3767)]

# --- Veiligheidscheck + plan tonen: adres bij elk id ophalen ---
ids = list(ATTACH.keys())
rows = {r["id"]: r for r in sb.table("afleveradressen").select(
    "id,adres,postcode,plaats,gln_afleveradres").in_("id", ids).execute().data}

print(f"=== PLAN (debiteur {DEB})  {'APPLY' if APPLY else 'DRY-RUN'} ===\n")
print("A. GLN op bestaand afleveradres:")
abort = False
for aid, g in ATTACH.items():
    r = rows.get(aid, {})
    huidig = r.get("gln_afleveradres")
    waarsch = ""
    if huidig and huidig != g:
        waarsch = f"  !! HEEFT AL GLN {huidig}"; abort = True
    print(f"     id={aid}  <- {g}   ({r.get('adres')} / {r.get('postcode')} {r.get('plaats')}){waarsch}")
print("B. Nieuw afleveradres aanmaken:")
for n in NIEUW:
    print(f"     {n['gln']}  {n['adres']} / {n['plaats']}")
print("C. EDI-bericht koppelen + order aanmaken:")
for bid, aid in KOPPEL:
    print(f"     bericht #{bid} -> adres id={aid}")

if abort:
    sys.exit("\nAFGEBROKEN: een doel-adres heeft al een afwijkende GLN — controleer mapping.")

if not APPLY:
    print("\n(DRY-RUN — niets geschreven. Voeg --apply toe.)")
    sys.exit(0)

print("\n--- A. GLN's op bestaande afleveradressen ---")
for aid, g in ATTACH.items():
    sb.table("afleveradressen").update({"gln_afleveradres": g}).eq("id", aid).execute()
    print(f"   id={aid} <- {g}")

print("--- B. Nieuwe afleveradressen ---")
maxadr = max([a["adres_nr"] or 0 for a in
              sb.table("afleveradressen").select("adres_nr").eq("debiteur_nr", DEB).execute().data], default=0)
for n in NIEUW:
    maxadr += 1
    sb.table("afleveradressen").insert({
        "debiteur_nr": DEB, "adres_nr": maxadr, "naam": n["naam"], "gln_afleveradres": n["gln"],
        "adres": n["adres"], "postcode": n["postcode"], "plaats": n["plaats"], "land": n["land"],
    }).execute()
    print(f"   adres_nr={maxadr}  {n['gln']}  {n['adres']}")

print("--- C. Berichten koppelen (koppel_edi_afleveradres) ---")
for bid, aid in KOPPEL:
    r = sb.rpc("koppel_edi_afleveradres", {
        "p_bericht_id": bid, "p_debiteur_nr": DEB, "p_afleveradres_id": aid
    }).execute()
    print(f"   bericht #{bid} -> order_id={r.data}")

print("\nKlaar.")
