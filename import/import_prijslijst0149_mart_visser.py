"""
Voeg Mart Visser collectie toe aan prijslijst 0149 (Hornbach).

Leest 'prijslijst mart visser.xlsx' en voegt alle 304 artikelen toe
aan prijslijst_regels met prijslijst_nr='0149'.
Maakt nieuwe producten aan in `producten` als ze er nog niet in staan.
Herprijst GEEN open orders (prijzen gelden voor nieuwe regels).
"""
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import openpyxl
from supabase import create_client

sys.path.insert(0, str(Path(__file__).parent))
from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR
from lib.supabase_helpers import upsert_batch

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

FILE          = BASE_DIR / "prijslijst mart visser.xlsx"
PRIJSLIJST_NR = "0149"


def fetch_bestaande_artikelnrs():
    rows, offset = [], 0
    while True:
        res = sb.table("producten").select("artikelnr").range(offset, offset + 999).execute()
        rows.extend(res.data)
        if len(res.data) < 1000:
            break
        offset += 1000
    return {r["artikelnr"] for r in rows}


def parse_artikelnr(val):
    try:
        return str(int(val))
    except (ValueError, TypeError):
        return None


def main():
    print("=== Mart Visser collectie → prijslijst 0149 (Hornbach) ===\n")

    wb = openpyxl.load_workbook(FILE, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    # Rij 1 bevat de naam van de prijslijst
    meta_naam = str(rows[1][2]).strip() if rows[1][2] else "ALLEEN MART VISSER COLLECTIE 2022"
    print(f"  Bron:         {FILE.name}")
    print(f"  Omschrijving: {meta_naam}")
    print(f"  Totaal rijen in bestand: {len(rows) - 3}\n")

    bestaande = fetch_bestaande_artikelnrs()

    prijsregels   = []
    nieuwe_prod   = []
    overgeslagen  = 0

    for row in rows[3:]:
        if not row or row[0] is None:
            continue
        artikelnr = parse_artikelnr(row[0])
        if not artikelnr:
            overgeslagen += 1
            continue

        ean            = str(int(row[1])) if row[1] is not None else None
        omschrijving   = str(row[2]).strip() if row[2] else None
        omschrijving_2 = str(row[3]).strip() if row[3] else None
        try:
            prijs = float(row[4]) if row[4] is not None else 0.0
        except (ValueError, TypeError):
            prijs = 0.0
        try:
            gewicht = float(row[6]) if len(row) > 6 and row[6] is not None else None
        except (ValueError, TypeError):
            gewicht = None

        prijsregels.append({
            "prijslijst_nr":  PRIJSLIJST_NR,
            "artikelnr":      artikelnr,
            "omschrijving":   omschrijving,
            "omschrijving_2": omschrijving_2,
            "prijs":          prijs,
            "gewicht":        gewicht,
            "ean_code":       ean,
        })

        if artikelnr not in bestaande:
            oms_upper = (omschrijving or "").upper()
            if "MAATWERK" in oms_upper:
                ptype = "vast"
            elif "CA:" in oms_upper:
                ptype = "vast"
            else:
                ptype = "overig"
            # Maatwerk_vorm_code afleiden (spiegelt mig 190 + mig 414)
            if "CONTOUR" in oms_upper:
                vorm_code = "contour"
            elif "ORGANISCH" in oms_upper:
                vorm_code = "organisch_a"
            elif "PEBBLE" in oms_upper:
                vorm_code = "pebble"
            elif "ELLIPS" in oms_upper:
                vorm_code = "ellips"
            elif "AFGEROND" in oms_upper:
                vorm_code = "afgeronde_hoeken"
            else:
                vorm_code = None

            nieuwe_prod.append({
                "artikelnr":           artikelnr,
                "omschrijving":        omschrijving or "Onbekend product",
                "omschrijving_2":      omschrijving_2,
                "verkoopprijs":        prijs,
                "gewicht_kg":          gewicht,
                "voorraad":            0,
                "gereserveerd":        0,
                "vrije_voorraad":      0,
                "product_type":        ptype,
                "maatwerk_vorm_code":  vorm_code,
                "actief":              True,
            })

    print(f"  Prijslijst-regels gevonden: {len(prijsregels)}")
    print(f"  Nieuwe producten:           {len(nieuwe_prod)}")
    if overgeslagen:
        print(f"  Overgeslagen rijen:         {overgeslagen}")

    # 1. Nieuwe producten aanmaken
    if nieuwe_prod:
        print(f"\n  Nieuwe producten toevoegen...")
        upsert_batch(sb, "producten", nieuwe_prod, on_conflict="artikelnr")
        print(f"  ✓ {len(nieuwe_prod)} producten aangemaakt/bijgewerkt")

    # 2. Prijsregels upserten in prijslijst 0149
    print(f"\n  Prijsregels toevoegen aan 0149...")
    upsert_batch(sb, "prijslijst_regels", prijsregels, on_conflict="prijslijst_nr,artikelnr")
    print(f"  ✓ {len(prijsregels)} regels toegevoegd aan prijslijst 0149")

    print(f"\n=== KLAAR ===")
    print(f"  Prijslijst 0149 uitgebreid met {len(prijsregels)} Mart Visser artikelen.")
    print(f"  Hornbach (#361208) was al gekoppeld aan prijslijst 0149 — geen wijziging nodig.")


if __name__ == "__main__":
    main()
