"""
Correctie: 'overig'-getypeerde vaste maten -> product_type 'vast'
================================================================
AANLEIDING (diagnose 2026-06-09)
  De voorraad-import (update_voorraad.py) schrijft ALLEEN producten met
  product_type='vast' bij. ~1.200 producten met een echte vaste-maat-code
  (^[A-Z]{3,4}\\d{2}XX<maat>) staan echter als 'overig' in de DB en worden
  daardoor stilletjes overgeslagen -> voorraad blijft 0 (bv. SPLE12XX200290 = 9
  in de lijst, PROS64XX200RND = 3). 688 daarvan hebben echte voorraad
  (13.791 stuks "onzichtbaar"), vrijwel allemaal volledige vloerkleden.

WAT DIT SCRIPT DOET
  - Selecteert producten met product_type='overig' EN karpi_code die matcht op
    ^[A-Z]{3,4}\\d{2}XX EN een geldige maat-suffix heeft (XX###### of XX###RND).
    Codes zonder maat-suffix (de ~3 randgevallen) worden NIET geflipt.
  - Zet product_type -> 'vast'.
  - Backfilt lengte_cm/breedte_cm/vorm UITSLUITEND waar die nu NULL zijn
    (bestaande waarden worden nooit overschreven).
  - 'staaltje' wordt bewust NIET aangeraakt (aparte review-beslissing).

NA DIT SCRIPT (verplicht, in deze volgorde):
    python update_voorraad.py "..\\Voorraadlijst 08-6-2026 (1).xls" --commit
    python herallocateer_open_orders.py --commit

Gebruik:
  python fix_overig_naar_vast.py            # DRY-RUN (alleen lezen + rapport)
  python fix_overig_naar_vast.py --commit   # schrijft product_type + maten

Vereist: import/.env met SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
"""
import re
import sys
from collections import defaultdict

import pandas as pd
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

RAPPORT_DIR = BASE_DIR / "import" / "rapporten"

_VAST_RE = re.compile(r"^[A-Z]{3,4}\d{2}XX")
_MAAT_RECHT_RE = re.compile(r"XX(\d{3})(\d{3})$")
_MAAT_ROND_RE = re.compile(r"XX(\d{3})RND$")


def afmeting(code: str):
    """-> (lengte, breedte, vorm) of (None, None, None) als geen geldige suffix."""
    code = code or ""
    m = _MAAT_RECHT_RE.search(code)
    if m:
        return int(m.group(1)), int(m.group(2)), "rechthoek"
    m = _MAAT_ROND_RE.search(code)
    if m:
        d = int(m.group(1))
        return d, d, "rond"
    return None, None, None


def laad_producten(sb):
    out = []
    start = 0
    while True:
        r = (sb.table("producten")
             .select("artikelnr,karpi_code,product_type,lengte_cm,breedte_cm,vorm")
             .range(start, start + 999).execute())
        if not r.data:
            break
        out.extend(r.data)
        if len(r.data) < 1000:
            break
        start += 1000
    return out


def main():
    commit = "--commit" in sys.argv
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL/KEY ontbreekt in import/.env")
        sys.exit(1)
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("=" * 64)
    print(f"FIX overig->vast   ({'COMMIT' if commit else 'DRY-RUN'})")
    print("=" * 64)

    producten = laad_producten(sb)
    print(f"Producten gescand: {len(producten)}")

    kandidaten = []      # te flippen
    zonder_maat = []     # overig + VAST_RE maar geen geldige suffix -> NIET flippen
    for p in producten:
        if p.get("product_type") != "overig":
            continue
        code = str(p.get("karpi_code") or "")
        if not _VAST_RE.match(code):
            continue
        l, b, vorm = afmeting(code)
        if l is None:
            zonder_maat.append(p)
            continue
        kandidaten.append({**p, "_l": l, "_b": b, "_vorm": vorm})

    # Backfill alleen waar dims NULL zijn
    dims_nodig = [k for k in kandidaten
                  if k.get("lengte_cm") is None or k.get("breedte_cm") is None or not k.get("vorm")]

    print(f"\n--- SAMENVATTING ---")
    print(f"  overig + vaste-maat-code MET geldige suffix : {len(kandidaten)}  -> 'vast'")
    print(f"  overig + vaste-maat-code ZONDER suffix      : {len(zonder_maat)}  (overgeslagen, review)")
    print(f"  daarvan maten/vorm te backfillen (nu NULL)  : {len(dims_nodig)}")
    print(f"  voorbeelden:")
    for k in sorted(kandidaten, key=lambda d: d["karpi_code"])[:8]:
        print(f"    {k['artikelnr']:>12} {k['karpi_code']:<18} -> vast  "
              f"({k['_l']}x{k['_b']} {k['_vorm']}; dims_nu="
              f"{k.get('lengte_cm')}x{k.get('breedte_cm')}/{k.get('vorm')})")

    # Rapport
    RAPPORT_DIR.mkdir(exist_ok=True)
    rapport = RAPPORT_DIR / "fix_overig_naar_vast.xlsx"
    df_kand = pd.DataFrame([{
        "artikelnr": k["artikelnr"], "karpi_code": k["karpi_code"],
        "nieuwe_lengte": k["_l"], "nieuwe_breedte": k["_b"], "nieuwe_vorm": k["_vorm"],
        "dims_was_null": (k.get("lengte_cm") is None or k.get("breedte_cm") is None or not k.get("vorm")),
    } for k in kandidaten])
    df_skip = pd.DataFrame(zonder_maat)
    with pd.ExcelWriter(rapport, engine="openpyxl") as w:
        df_kand.to_excel(w, sheet_name="Te_flippen_naar_vast", index=False)
        if not df_skip.empty:
            df_skip.to_excel(w, sheet_name="Overig_zonder_maat_skip", index=False)
    print(f"\nRapport: {rapport.name}")

    if not commit:
        print("\nDRY-RUN: geen DB-wijzigingen. Draai met --commit om te schrijven.")
        print("Daarna: update_voorraad.py --commit + herallocateer_open_orders.py --commit")
        return

    # --- COMMIT ---
    print("\n--- SCHRIJVEN NAAR SUPABASE ---")
    CHUNK = 100

    # 1) product_type -> 'vast' (batch op gedeelde payload)
    artnrs = [k["artikelnr"] for k in kandidaten]
    for i in range(0, len(artnrs), CHUNK):
        sb.table("producten").update({"product_type": "vast"}).in_(
            "artikelnr", artnrs[i:i + CHUNK]).execute()
    print(f"  product_type='vast' gezet op {len(artnrs)} producten")

    # 2) maten/vorm backfillen waar NULL — groepeer op identieke (l,b,vorm)
    groepen = defaultdict(list)
    for k in dims_nodig:
        groepen[(k["_l"], k["_b"], k["_vorm"])].append(k["artikelnr"])
    gedaan = 0
    for (l, b, vorm), arts in groepen.items():
        for i in range(0, len(arts), CHUNK):
            sb.table("producten").update(
                {"lengte_cm": l, "breedte_cm": b, "vorm": vorm}).in_(
                "artikelnr", arts[i:i + CHUNK]).execute()
        gedaan += len(arts)
    print(f"  maten/vorm gebackfilld op {gedaan} producten (alleen waar NULL)")

    print("\nKLAAR. product_type gecorrigeerd.")
    print("VOLGENDE STAPPEN (verplicht):")
    print('  python update_voorraad.py "..\\Voorraadlijst 08-6-2026 (1).xls" --commit')
    print("  python herallocateer_open_orders.py --commit")


if __name__ == "__main__":
    main()
