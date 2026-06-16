"""Import prijslijst0209 (PMP per 27-1-2026) naar Supabase + koppel debiteur 631013.

MAATWERK-artikelen: de omschrijving in de prijslijst (kolom C) IS de karpi-code
(bijv. LOWL13MAATWERK). Die wordt als artikelnr gebruikt in producten + prijslijst_regels.
Kwaliteit + kleur worden geparsed uit de karpi-code (patroon: [A-Z]+[0-9]+MAATWERK).
"""
import sys
import re
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import openpyxl
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

sb = create_client(SUPABASE_URL, SUPABASE_KEY)
from lib.supabase_helpers import upsert_batch

FILE = BASE_DIR / "prijslijst0209_a.xlsx"
PRIJSLIJST_NR = "0209"

DEBITEUREN = [
    631013,
]

MAATWERK_PATTERN = re.compile(r'^([A-Z]+)(\d+)MAATWERK$')


def parse_maatwerk_code(karpi_code: str):
    """Extraheer kwaliteit_code en kleur_code uit bijv. LOWL13MAATWERK."""
    m = MAATWERK_PATTERN.match(karpi_code)
    if m:
        return m.group(1), m.group(2)
    return None, None


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
    print("=== Import prijslijst 0209 (PMP) ===\n")

    wb = openpyxl.load_workbook(FILE, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    meta = rows[1]
    naam = str(meta[2]).strip() if meta[2] else "PMP"
    geldig_m = re.search(r'(\d{1,2})-(\d{1,2})-(\d{4})', naam)
    if geldig_m:
        geldig_vanaf = f"{geldig_m.group(3)}-{geldig_m.group(2).zfill(2)}-{geldig_m.group(1).zfill(2)}"
    else:
        geldig_vanaf = "2026-01-27"

    print(f"  Naam: {naam}")
    print(f"  Geldig vanaf: {geldig_vanaf}")

    known = fetch_all_artikelnrs()
    print(f"  {len(known)} bekende artikelnrs in producten\n")

    regels = []
    nieuwe_producten = []

    for row in rows[3:]:
        if not row or row[0] is None:
            continue
        # Kolom C (index 2) = karpi-code / omschrijving (bijv. LOWL13MAATWERK)
        karpi_code = str(row[2]).strip() if row[2] else None
        if not karpi_code:
            continue

        # Gebruik karpi-code als artikelnr (DB-standaard voor MAATWERK)
        artikelnr = karpi_code

        ean = str(int(row[1])) if row[1] is not None else None
        omschrijving_2 = str(row[3]).strip() if row[3] else None  # bijv. "LOWLAND 13 MAATWERK"
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
            "omschrijving": omschrijving_2 or karpi_code,
            "omschrijving_2": None,
            "prijs": prijs,
            "gewicht": gewicht,
            "ean_code": ean,
        })

        if artikelnr not in known:
            kwaliteit_code, kleur_code = parse_maatwerk_code(karpi_code)
            # Omschrijving DB-stijl: "Maatwerk broadloom LOWL kleur 13"
            db_omschrijving = (
                f"Maatwerk broadloom {kwaliteit_code} kleur {kleur_code}"
                if kwaliteit_code else (omschrijving_2 or karpi_code)
            )
            product = {
                "artikelnr": artikelnr,
                "karpi_code": karpi_code,
                "omschrijving": db_omschrijving,
                "verkoopprijs": prijs,
                "gewicht_kg": gewicht,
                "voorraad": 0,
                "gereserveerd": 0,
                "vrije_voorraad": 0,
                "product_type": "rol",
                "actief": True,
            }
            if kwaliteit_code:
                product["kwaliteit_code"] = kwaliteit_code
            if kleur_code:
                product["kleur_code"] = kleur_code
            nieuwe_producten.append(product)

    print(f"  {len(regels)} prijslijst-regels gevonden")
    if nieuwe_producten:
        print("  Nieuwe producten:")
        for p in nieuwe_producten:
            print(f"    {p['artikelnr']} ({p.get('kwaliteit_code','-')}/{p.get('kleur_code','-')}) € {p['verkoopprijs']}")
    else:
        print("  Geen nieuwe producten")
    print()

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
        print(f"  {nr} ({d['naam']}) {d['prijslijst_nr'] or 'geen'} → {PRIJSLIJST_NR}")

    print("\nKlaar.")


if __name__ == "__main__":
    main()
