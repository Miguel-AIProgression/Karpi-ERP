"""Naam-regel polish voor EDI-vestigingen: zet `naam` van '<plaats>' naar '<keten> <plaats>'.

Het Transus-adresboek levert geen filiaalnaam; de importer zette daarom naam = plaats.
Dit script vervangt dat door een leesbare '<keten> <plaats>'-kop op:
  1. afleveradressen-rijen waar norm(naam) == norm(plaats) (de EDI-vestigingen), per
     debiteur in KETEN — future-proof voor alle vestigingen van die ketens.
  2. orders.afl_naam van EDI-orders van die debiteuren waar norm(afl_naam) == norm(afl_plaats)
     (de 26 orders), idempotent (alleen waar verschillend).

Dry-run default; voeg --apply toe om te schrijven.
"""
import sys
from config import SUPABASE_URL, SUPABASE_KEY
from supabase import create_client

# debiteur_nr -> ketennaam (de '<keten>' in '<keten> <plaats>')
KETEN = {
    150761: "SB-Möbel BOSS",   # SB MÖBEL BOSS
    600556: "XXXlutz",         # BDSK / XXXLutz (centrale facturatie)
    630859: "Porta Möbel",     # FUG WEST
    630861: "Porta Möbel",     # FUG MITTE
    630862: "Porta Möbel",     # FUG OST
}

from lib.normalize import norm

def keten_naam(keten, plaats):
    return f"{keten} {(plaats or '').strip()}".strip()

def main():
    APPLY = "--apply" in sys.argv
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    adr_updates, ord_updates = [], []

    for deb, keten in KETEN.items():
        # 1) afleveradressen waar naam == plaats
        afl = sb.table("afleveradressen").select(
            "id,adres_nr,naam,plaats,gln_afleveradres").eq("debiteur_nr", deb).execute().data
        for a in afl:
            if a["naam"] and a["plaats"] and norm(a["naam"]) == norm(a["plaats"]):
                nieuw = keten_naam(keten, a["plaats"])
                if nieuw != a["naam"]:
                    adr_updates.append((deb, a, nieuw))

        # 2) orders waar afl_naam == afl_plaats
        ords = sb.table("orders").select(
            "id,order_nr,afl_naam,afl_plaats").eq("bron_systeem", "edi").eq(
            "debiteur_nr", deb).not_.is_("afleveradres_gln", "null").execute().data
        for o in ords:
            if o["afl_naam"] and o["afl_plaats"] and norm(o["afl_naam"]) == norm(o["afl_plaats"]):
                nieuw = keten_naam(keten, o["afl_plaats"])
                if nieuw != o["afl_naam"]:
                    ord_updates.append((deb, o, nieuw))

    print(f"Afleveradressen te updaten (naam=plaats -> keten plaats): {len(adr_updates)}")
    for deb, a, nieuw in adr_updates[:60]:
        print(f"   deb {deb}  adres_nr {a['adres_nr']}  '{a['naam']}' -> '{nieuw}'")
    print(f"\nOrders te updaten (afl_naam=afl_plaats -> keten plaats): {len(ord_updates)}")
    for deb, o, nieuw in ord_updates[:60]:
        print(f"   deb {deb}  {o['order_nr']}  '{o['afl_naam']}' -> '{nieuw}'")

    if not APPLY:
        print("\n(DRY-RUN — niets geschreven. Voeg --apply toe.)")
        return

    for deb, a, nieuw in adr_updates:
        sb.table("afleveradressen").update({"naam": nieuw}).eq("id", a["id"]).execute()
    for deb, o, nieuw in ord_updates:
        sb.table("orders").update({"afl_naam": nieuw}).eq("id", o["id"]).execute()
    print(f"\nGeschreven: {len(adr_updates)} afleveradressen, {len(ord_updates)} orders.")

if __name__ == "__main__":
    main()
