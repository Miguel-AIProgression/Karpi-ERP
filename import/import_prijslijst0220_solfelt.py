"""Import prijslijst0220 (SOLFELT) naar Supabase + koppel debiteur 601005."""
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import re

import openpyxl
from config import BASE_DIR
from lib.supabase_helpers import create_supabase_client, upsert_batch

MAATWERK_PATROON = re.compile(r'^([A-Z]+)([0-9]+)MAATWERK$')

sb = create_supabase_client()

FILE = BASE_DIR / "prijslijst0220_a.xlsx"
PRIJSLIJST_NR = "0220"
GELDIG_VANAF = "2026-06-18"

DEBITEUREN = [601005]


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
    print("=== Import prijslijst 0220 (SOLFELT) ===\n")

    wb = openpyxl.load_workbook(FILE, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    meta = rows[1]
    naam = str(meta[2]).strip() if meta[2] else "SOLFELT"
    print(f"  Naam: {naam}")
    print(f"  Bron-vlag: {meta[3]!r} (genegeerd op verzoek — lijst wordt actief gekoppeld)")
    print(f"  Geldig vanaf: {GELDIG_VANAF}")

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
            maatwerk_m = MAATWERK_PATROON.match(oms)
            if "BREED" in oms:
                ptype = "rol"
            elif "CA:" in oms:
                m = re.search(r'CA:\s*(\d+)\s*[xX]\s*(\d+)', oms)
                ptype = "staaltje" if m and int(m.group(1)) * int(m.group(2)) < 10000 else "vast"
            else:
                ptype = "overig"
            nieuw_product = {
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
            if maatwerk_m:
                # Trigger producten_karpi_code_guard (mig 359) leidt karpi_code af
                # uit kwaliteit_code + kleur_code voor het ^[A-Z]+[0-9]+MAATWERK$-patroon
                # (catalogus-conventie mig 356a) — zonder die twee codes weigert de insert.
                nieuw_product["kwaliteit_code"] = maatwerk_m.group(1)
                nieuw_product["kleur_code"] = maatwerk_m.group(2)
            nieuwe_producten.append(nieuw_product)

    print(f"  {len(regels)} prijslijst-regels gevonden")
    print(f"  {len(nieuwe_producten)} nieuwe producten aan te maken\n")

    # 1. Header
    upsert_batch(sb, "prijslijst_headers", [{
        "nr": PRIJSLIJST_NR,
        "naam": naam,
        "geldig_vanaf": GELDIG_VANAF,
        "actief": True,
    }], on_conflict="nr")

    # 2. Nieuwe producten
    if nieuwe_producten:
        upsert_batch(sb, "producten", nieuwe_producten, on_conflict="artikelnr")

    # 3. Prijslijst-regels
    upsert_batch(sb, "prijslijst_regels", regels, on_conflict="prijslijst_nr,artikelnr")

    # 4. Koppel debiteuren
    print(f"\n  Debiteuren koppelen aan prijslijst {PRIJSLIJST_NR}...")
    res = sb.table("debiteuren").select("debiteur_nr,naam,prijslijst_nr").in_("debiteur_nr", DEBITEUREN).execute()
    bestaand = {r["debiteur_nr"]: r for r in res.data}

    for nr in DEBITEUREN:
        if nr not in bestaand:
            print(f"  WAARSCHUWING: debiteur {nr} niet gevonden in DB — overgeslagen")
            continue
        d = bestaand[nr]
        if d["prijslijst_nr"] == PRIJSLIJST_NR:
            print(f"  {nr} ({d['naam']}) — al gekoppeld aan {PRIJSLIJST_NR}")
            continue
        sb.table("debiteuren").update({"prijslijst_nr": PRIJSLIJST_NR}).eq("debiteur_nr", nr).execute()
        print(f"  {nr} ({d['naam']}) {d['prijslijst_nr'] or 'geen'} -> {PRIJSLIJST_NR}")

    print("\nKlaar.")


if __name__ == "__main__":
    main()
