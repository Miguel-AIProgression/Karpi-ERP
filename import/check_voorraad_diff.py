"""
Voorraad-VERGELIJKING (read-only) — oude systeem-lijst vs RugFlow
=================================================================
Zet een Karpi-export "Ovz. vrije voorraad" af tegen de voorraad in het
nieuwe systeem, ZONDER iets te schrijven. Context: orders die alleen in
RugFlow bestaan zijn in het oude systeem onbekend, dus de verwachting is:

  FYSIEK : producten.voorraad        == lijst kolom D 'Voorraad'
           (fysieke voorraad beweegt pas bij verzending; afwijking =
            verzonden in RugFlow sinds de lijst-datum, of echte drift)
  VRIJ   : producten.vrije_voorraad  == lijst kolom D − gereserveerd RugFlow
           ("oude voorraad minus actuele bestellingen in het nieuwe systeem")

Zelfde spelregels als update_voorraad.py:
  - Scope: ALLEEN product_type='vast'.
  - Uitsluitlijst (voorraad_uitsluiten.csv ∪ rode regels nu) -> verwacht 0.
  - MAATWERK-regels uit de lijst genegeerd.
  - 'vast' in DB maar niet in actieve lijst -> verwacht 0.
  - Negatieve lijst-voorraad geclampt naar 0 (zo importeren we ook).

Gebruik:
  python check_voorraad_diff.py "..\\Voorraadlijst 9-6-2026.xls"

Output: console-samenvatting + import/rapporten/voorraad_diff_<stem>.xlsx
"""
import re
import sys
from pathlib import Path

import pandas as pd
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR
from update_voorraad import lees_lijst, lees_bestaande_uitsluitlijst, is_vaste_maat

RAPPORT_DIR = BASE_DIR / "import" / "rapporten"


def parse_args(argv):
    paden = [a for a in argv[1:] if not a.startswith("--")]
    if not paden:
        print("GEBRUIK: python check_voorraad_diff.py \"<pad naar .xls>\"")
        sys.exit(1)
    pad = Path(paden[0])
    if not pad.is_absolute():
        pad = (Path.cwd() / pad).resolve()
    if not pad.exists():
        print(f"ERROR: bestand niet gevonden: {pad}")
        sys.exit(1)
    return pad


def laad_db_producten(sb):
    """artikelnr -> dict met voorraad-velden voor ALLE producten (paginated)."""
    out = {}
    start = 0
    while True:
        r = (sb.table("producten")
             .select("artikelnr,karpi_code,omschrijving,product_type,"
                     "voorraad,gereserveerd,backorder,vrije_voorraad")
             .range(start, start + 999).execute())
        if not r.data:
            break
        for x in r.data:
            out[str(x["artikelnr"])] = x
        if len(r.data) < 1000:
            break
        start += 1000
    return out


def main():
    pad = parse_args(sys.argv)
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Supabase URL/Key ontbreekt (import/.env)")
        sys.exit(1)
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("=" * 64)
    print(f"VOORRAAD-DIFF (read-only)  bestand: {pad.name}")
    print("=" * 64)

    rijen = lees_lijst(pad)
    print(f"Lijst gelezen: {len(rijen)} data-rijen")

    bestaand = lees_bestaande_uitsluitlijst()
    rood_nu = {x["artikelnr"] for x in rijen if x["is_red"]}
    exclude_artnr = set(bestaand) | rood_nu
    print(f"  uitsluitlijst csv: {len(bestaand)} | rood in lijst: {len(rood_nu)} "
          f"| union: {len(exclude_artnr)}")

    # Actieve lijst-regels: niet uitgesloten, geen maatwerk; dubbelen -> eerste
    actief = {}
    for x in rijen:
        if x["artikelnr"] in exclude_artnr or x["is_maatwerk"]:
            continue
        actief.setdefault(x["artikelnr"], x)

    db = laad_db_producten(sb)
    vast = {a: p for a, p in db.items() if p["product_type"] == "vast"}
    print(f"DB geladen: {len(db)} producten, waarvan {len(vast)} 'vast'")

    def n(v):
        return int(v or 0)

    diffs = []          # alle vergeleken vast-artikelen met een afwijking
    ok = 0
    for artnr, p in vast.items():
        if artnr in exclude_artnr:
            verwacht = 0
            bron = "uitgesloten (rood/csv)"
            lijst_vrd = n(actief.get(artnr, {}).get("voorraad"))
        elif artnr in actief:
            lijst_vrd = max(0, n(actief[artnr]["voorraad"]))
            verwacht = lijst_vrd
            bron = "lijst"
        else:
            verwacht = 0
            bron = "niet in lijst"
            lijst_vrd = 0

        db_vrd = n(p["voorraad"])
        db_res = n(p["gereserveerd"])
        db_bo = n(p["backorder"])
        db_vrij = n(p["vrije_voorraad"])
        verwacht_vrij = verwacht - db_res - db_bo

        d_fysiek = db_vrd - verwacht
        d_vrij = db_vrij - verwacht_vrij
        if d_fysiek == 0 and d_vrij == 0:
            ok += 1
            continue
        diffs.append({
            "artikelnr": artnr,
            "karpi_code": p.get("karpi_code") or "",
            "omschrijving": (p.get("omschrijving") or "")[:60],
            "bron": bron,
            "lijst_voorraad_D": lijst_vrd,
            "db_voorraad": db_vrd,
            "delta_fysiek": d_fysiek,
            "db_gereserveerd": db_res,
            "db_backorder": db_bo,
            "db_vrije_voorraad": db_vrij,
            "verwacht_vrij": verwacht_vrij,
            "delta_vrij": d_vrij,
        })

    # Lijst-artikelen die in DB ontbreken (zelfde filter als import)
    nieuw_alle = [x for a, x in actief.items() if a not in db]
    mist_vast = [x for x in nieuw_alle
                 if is_vaste_maat(x["karpi_code"]) and x["voorraad"] > 0]
    mist_broadloom = [x for x in nieuw_alle if not is_vaste_maat(x["karpi_code"])]

    diffs.sort(key=lambda d: -abs(d["delta_fysiek"]))
    d_pos = [d for d in diffs if d["delta_fysiek"] > 0]
    d_neg = [d for d in diffs if d["delta_fysiek"] < 0]
    d_alleen_vrij = [d for d in diffs if d["delta_fysiek"] == 0]

    print("\n--- RESULTAAT ---")
    print(f"  vast-artikelen vergeleken          : {len(vast)}")
    print(f"  exact gelijk (fysiek én vrij)      : {ok}")
    print(f"  afwijkend totaal                   : {len(diffs)}")
    print(f"    fysiek RugFlow > lijst           : {len(d_pos)} "
          f"(som +{sum(d['delta_fysiek'] for d in d_pos)})")
    print(f"    fysiek RugFlow < lijst           : {len(d_neg)} "
          f"(som {sum(d['delta_fysiek'] for d in d_neg)})")
    print(f"    alleen vrije-voorraad wijkt af   : {len(d_alleen_vrij)}")
    print(f"  in lijst (vast, vrd>0) niet in DB  : {len(mist_vast)} "
          f"(som {sum(x['voorraad'] for x in mist_vast)})")
    print(f"  in lijst broadloom (genegeerd)     : {len(mist_broadloom)}")

    if diffs:
        print("\n  TOP 25 grootste fysieke afwijkingen (db - lijst):")
        print(f"  {'artikelnr':>10} {'karpi_code':<18} {'lijst':>5} {'db':>5} "
              f"{'Δfys':>5} {'res':>4} {'vrij':>5} {'Δvrij':>5}  bron")
        for d in diffs[:25]:
            print(f"  {d['artikelnr']:>10} {d['karpi_code']:<18} "
                  f"{d['lijst_voorraad_D']:>5} {d['db_voorraad']:>5} "
                  f"{d['delta_fysiek']:>+5} {d['db_gereserveerd']:>4} "
                  f"{d['db_vrije_voorraad']:>5} {d['delta_vrij']:>+5}  {d['bron']}")

    # Rapport
    RAPPORT_DIR.mkdir(exist_ok=True)
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", pad.stem).strip("_")
    rapport = RAPPORT_DIR / f"voorraad_diff_{stem}.xlsx"
    df_sum = pd.DataFrame([
        {"Categorie": "bestand", "Waarde": pad.name},
        {"Categorie": "vast vergeleken", "Waarde": len(vast)},
        {"Categorie": "exact gelijk", "Waarde": ok},
        {"Categorie": "afwijkend totaal", "Waarde": len(diffs)},
        {"Categorie": "fysiek db>lijst", "Waarde": len(d_pos)},
        {"Categorie": "fysiek db<lijst", "Waarde": len(d_neg)},
        {"Categorie": "alleen vrij afwijkend", "Waarde": len(d_alleen_vrij)},
        {"Categorie": "in lijst niet in DB (vast,vrd>0)", "Waarde": len(mist_vast)},
    ])
    with pd.ExcelWriter(rapport, engine="openpyxl") as w:
        df_sum.to_excel(w, sheet_name="Samenvatting", index=False)
        if diffs:
            pd.DataFrame(diffs).to_excel(w, sheet_name="Afwijkingen", index=False)
        if mist_vast:
            pd.DataFrame(mist_vast).to_excel(w, sheet_name="Lijst_niet_in_DB", index=False)
    print(f"\nRapport: {rapport}")


if __name__ == "__main__":
    main()
