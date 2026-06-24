"""Import prijslijst0192 (HACO C.I.V. per 1-1-26) naar Supabase +
koppel debiteur 330011."""
import sys
import re
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import openpyxl
from config import BASE_DIR
from lib.supabase_helpers import create_supabase_client, upsert_batch

sb = create_supabase_client()

FILE = BASE_DIR / "HACO PRIJSLIJST 192.xlsx"
PRIJSLIJST_NR = "0192"
DEBITEUR_NR = 330011

# Enige artikelnr in dit bestand dat nog niet in producten staat — wél een
# bekende kwaliteit/kleur (BANGKOK kleur 12 had nog geen MAATWERK-variant,
# vergelijk bestaande BANG21MAATWERK/572219999). Expliciet ingevuld i.p.v.
# de generieke nieuwe-producten-fallback, voor correcte kwaliteit_code/
# kleur_code/zoeksleutel (nodig voor uitwisselbaarheid/voorraadpositie).
HANDMATIGE_PRODUCT_OVERRIDES = {
    "572129999": {"kwaliteit_code": "BANG", "kleur_code": "12", "zoeksleutel": "BANG_12"},
}


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
    print("=== Import prijslijst 0192 (HACO C.I.V.) ===\n")

    wb = openpyxl.load_workbook(FILE, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    meta = rows[1]
    naam = str(meta[2]).strip() if meta[2] else "HACO PER 1-1-26 (PRIJSLIJST 153)"
    # "1-1-26" — dag-maand-2cijferig jaar
    geldig_m = re.search(r'(\d{1,2})-(\d{1,2})-(\d{2,4})', naam)
    if geldig_m:
        jaar = geldig_m.group(3)
        jaar = f"20{jaar}" if len(jaar) == 2 else jaar
        geldig_vanaf = f"{jaar}-{geldig_m.group(2).zfill(2)}-{geldig_m.group(1).zfill(2)}"
    else:
        geldig_vanaf = "2026-01-01"

    print(f"  Naam: {naam}")
    print(f"  Geldig vanaf: {geldig_vanaf}")

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
            nieuw = {
                "artikelnr": artikelnr,
                "omschrijving": omschrijving or "Onbekend product",
                "verkoopprijs": prijs,
                "gewicht_kg": gewicht,
                "voorraad": 0,
                "gereserveerd": 0,
                "vrije_voorraad": 0,
                "product_type": ptype,
                "actief": True,
            }
            nieuw.update(HANDMATIGE_PRODUCT_OVERRIDES.get(artikelnr, {}))
            nieuwe_producten.append(nieuw)

    print(f"  {len(regels)} prijslijst-regels gevonden")
    print(f"  {len(nieuwe_producten)} nieuwe producten aan te maken\n")

    # 1. Header
    upsert_batch(sb, "prijslijst_headers", [{
        "nr": PRIJSLIJST_NR,
        "naam": naam,
        "geldig_vanaf": geldig_vanaf,
        "actief": True,
    }], on_conflict="nr")

    # 2. Nieuwe producten
    if nieuwe_producten:
        upsert_batch(sb, "producten", nieuwe_producten, on_conflict="artikelnr")

    # 3. Prijslijst-regels
    upsert_batch(sb, "prijslijst_regels", regels, on_conflict="prijslijst_nr,artikelnr")

    # 4. Koppel debiteur
    print(f"\n  Debiteur {DEBITEUR_NR} koppelen aan prijslijst {PRIJSLIJST_NR}...")
    result = sb.table("debiteuren").update({"prijslijst_nr": PRIJSLIJST_NR}).eq("debiteur_nr", DEBITEUR_NR).execute()
    if result.data:
        print(f"  Debiteur {DEBITEUR_NR} ({result.data[0].get('naam', '?')}) → prijslijst {PRIJSLIJST_NR}")
    else:
        print(f"  WAARSCHUWING: debiteur {DEBITEUR_NR} niet gevonden")

    print("\nKlaar.")


if __name__ == "__main__":
    main()
