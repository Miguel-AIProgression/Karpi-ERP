"""Import prijslijst0252_a.xlsx naar Supabase."""
import sys
import re
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import openpyxl
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

FILE = BASE_DIR / "prijslijst0252_a.xlsx"
PRIJSLIJST_NR = "0252"


def upsert_batch(table, records, batch_size=500, on_conflict=None):
    total = len(records)
    for i in range(0, total, batch_size):
        batch = records[i:i + batch_size]
        kwargs = {"on_conflict": on_conflict} if on_conflict else {}
        sb.table(table).upsert(batch, **kwargs).execute()
    print(f"  {table}: {total} rijen")


def fetch_all_artikelnrs():
    all_data = []
    offset = 0
    while True:
        result = sb.table("producten").select("artikelnr").range(offset, offset + 999).execute()
        all_data.extend(result.data)
        if len(result.data) < 1000:
            break
        offset += 1000
    return set(r["artikelnr"] for r in all_data)


def main():
    print("=== Import prijslijst 0252 ===\n")

    wb = openpyxl.load_workbook(FILE, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    # Rij 1: metadata
    meta = rows[1]
    naam = str(meta[2]).strip() if meta[2] else "CLEANWALK"
    geldig_m = re.search(r'(\d{1,2})-(\d{1,2})-(\d{4})', naam)
    if geldig_m:
        geldig_vanaf = f"{geldig_m.group(3)}-{geldig_m.group(2).zfill(2)}-{geldig_m.group(1).zfill(2)}"
    else:
        geldig_vanaf = None

    print(f"  Naam: {naam}")
    print(f"  Geldig vanaf: {geldig_vanaf}")

    # Bekende artikelnrs ophalen
    known = fetch_all_artikelnrs()
    print(f"  {len(known)} bekende artikelnrs in producten\n")

    regels = []
    nieuwe_producten = []
    for row in rows[3:]:
        if not row or row[0] is None:
            continue
        try:
            artikelnr = str(int(row[0]))
        except (ValueError, TypeError):
            continue

        ean = str(int(row[1])) if row[1] is not None else None
        omschrijving = str(row[2]).strip() if row[2] else None
        omschrijving_2 = str(row[3]).strip() if row[3] else None
        try:
            prijs = float(row[4]) if row[4] is not None else 0.0
        except (ValueError, TypeError):
            prijs = 0.0
        try:
            gewicht = float(row[6]) if len(row) > 6 and row[6] is not None else None
        except (ValueError, TypeError):
            gewicht = None

        regels.append({
            "prijslijst_nr": PRIJSLIJST_NR,
            "artikelnr": artikelnr,
            "omschrijving": omschrijving,
            "omschrijving_2": omschrijving_2,
            "prijs": prijs,
            "gewicht": gewicht,
            "ean_code": ean,
        })

        if artikelnr not in known:
            oms = (omschrijving or "").upper()
            if "BREED" in oms:
                ptype = "rol"
            elif "CA:" in oms:
                m = re.search(r'CA:\s*(\d+)\s*[xX]\s*(\d+)', oms)
                ptype = "staaltje" if m and int(m.group(1)) * int(m.group(2)) < 10000 else "vast"
            else:
                ptype = "overig"
            nieuwe_producten.append({
                "artikelnr": artikelnr,
                "omschrijving": omschrijving or "Onbekend product",
                "verkoopprijs": prijs,
                "gewicht_kg": gewicht,
                "voorraad": 0,
                "gereserveerd": 0,
                "vrije_voorraad": 0,
                "product_type": ptype,
                "actief": True,
            })

    print(f"  {len(regels)} prijslijst-regels gevonden")
    print(f"  {len(nieuwe_producten)} nieuwe producten aan te maken\n")

    # Header upsert
    upsert_batch("prijslijst_headers", [{
        "nr": PRIJSLIJST_NR,
        "naam": naam,
        "geldig_vanaf": geldig_vanaf,
        "actief": True,
    }], on_conflict="nr")

    # Nieuwe producten aanmaken
    if nieuwe_producten:
        upsert_batch("producten", nieuwe_producten, on_conflict="artikelnr")

    # Regels upsert
    upsert_batch("prijslijst_regels", regels, on_conflict="prijslijst_nr,artikelnr")

    print("\nKlaar.")


if __name__ == "__main__":
    main()
