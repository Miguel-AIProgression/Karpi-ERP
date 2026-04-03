"""
Check welke artikelnrs uit prijslijst Excel bestanden ontbreken in de producten tabel.
Draait voor alle prijslijsten of 1 specifieke (via CLI arg).
"""
import sys
import io
import openpyxl
from pathlib import Path
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

sb = create_client(SUPABASE_URL, SUPABASE_KEY)
EXTRACT_DIR = BASE_DIR / "supabase" / ".temp" / "prijslijsten" / "wetransfer_prijslijst_2025-11-19_1107"


def fetch_all_artikelnrs():
    """Fetch all artikelnr from producten table."""
    all_data = []
    offset = 0
    while True:
        result = sb.table("producten").select("artikelnr").range(offset, offset + 999).execute()
        all_data.extend(r["artikelnr"] for r in result.data)
        if len(result.data) < 1000:
            break
        offset += 1000
    return set(all_data)


def read_artikels_from_excel(filepath):
    """Read artikelnr + omschrijving from a prijslijst Excel."""
    wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
    ws = wb.active
    all_rows = list(ws.iter_rows(values_only=True))
    wb.close()

    naam = str(all_rows[1][1]).strip() if len(all_rows) > 1 and all_rows[1][1] else "?"

    artikels = []
    for row in all_rows[3:]:
        if not row or row[0] is None:
            continue
        try:
            artikelnr = str(int(row[0]))
        except (ValueError, TypeError):
            continue
        omschrijving = str(row[1]).strip() if row[1] else ""
        omschrijving_2 = str(row[2]).strip() if row[2] else ""
        prijs = 0.0
        try:
            prijs = float(row[3]) if row[3] is not None else 0.0
        except (ValueError, TypeError):
            pass
        gewicht = None
        if len(row) > 5 and row[5] is not None:
            try:
                gewicht = float(row[5])
            except (ValueError, TypeError):
                pass
        artikels.append({
            "artikelnr": artikelnr,
            "omschrijving": omschrijving,
            "omschrijving_2": omschrijving_2,
            "prijs": prijs,
            "gewicht": gewicht,
        })
    return naam, artikels


def main():
    filter_name = sys.argv[1].lower() if len(sys.argv) > 1 else None

    print("Ophalen bekende artikelnrs uit producten tabel...")
    known = fetch_all_artikelnrs()
    print(f"  {len(known)} producten in database\n")

    xlsx_files = sorted(f for f in EXTRACT_DIR.glob("*.xlsx") if not f.name.startswith("~$"))

    if filter_name:
        xlsx_files = [f for f in xlsx_files if filter_name in f.name.lower()]
        print(f"Filter: '{filter_name}' → {len(xlsx_files)} bestanden\n")

    grand_total_excel = 0
    grand_total_missing = 0

    for filepath in xlsx_files:
        naam, artikels = read_artikels_from_excel(filepath)
        excel_nrs = set(a["artikelnr"] for a in artikels)
        missing_nrs = excel_nrs - known

        grand_total_excel += len(excel_nrs)
        grand_total_missing += len(missing_nrs)

        print(f"{'─' * 60}")
        print(f"Bestand:  {filepath.name}")
        print(f"Naam:     {naam}")
        print(f"Artikels: {len(excel_nrs)} in Excel, {len(missing_nrs)} ontbreken in producten")

        if missing_nrs:
            # Show first 15 missing
            missing_details = [a for a in artikels if a["artikelnr"] in missing_nrs]
            missing_details.sort(key=lambda x: x["artikelnr"])
            for a in missing_details[:15]:
                print(f"  ONTBREEKT: {a['artikelnr']:>10}  {a['omschrijving'][:50]}")
            if len(missing_details) > 15:
                print(f"  ... en {len(missing_details) - 15} meer")
        print()

    print(f"{'═' * 60}")
    print(f"TOTAAL: {grand_total_excel} artikels in Excel, {grand_total_missing} ontbreken in producten")


if __name__ == "__main__":
    main()
