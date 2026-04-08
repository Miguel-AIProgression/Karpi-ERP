"""
RugFlow ERP — Prijslijst Update April 2026

Volgorde:
1. Klant-referenties loskoppelen (NULL zetten) voor te verwijderen prijslijsten
2. Nieuwe prijslijsten importeren (210-217) — headers moeten bestaan voor FK
3. Klant-koppelingen updaten: 0150->0210, 0151->0211, 0152->0212, 0153->0213
4. Oude prijslijsten verwijderen (behalve Floorpassion 0145 + nieuwe 0210-0217)

Nieuw Excel formaat:
  Row 2: (nr, _, naam) — nr in col A, naam in col C
  Row 3: kolom headers
  Row 4+: A=artikelnr, B=EAN, C=omschrijving, D=omschrijving_2, E=prijs
"""
import sys
import re
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import openpyxl
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Supabase URL/Key niet gevonden. Check import/.env")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

EXTRACT_DIR = BASE_DIR / "supabase" / ".temp" / "prijslijsten" / "fwdprijlijsten"
KEEP_NR = "0145"  # Floorpassion
KLANT_MAPPING = {
    "0150": "0210",
    "0151": "0211",
    "0152": "0212",
    "0153": "0213",
}
AUTO_CREATE_MISSING_PRODUCTS = True


def upsert_batch(table, records, batch_size=500, on_conflict=None):
    total = len(records)
    for i in range(0, total, batch_size):
        batch = records[i:i + batch_size]
        kwargs = {}
        if on_conflict:
            kwargs['on_conflict'] = on_conflict
        sb.table(table).upsert(batch, **kwargs).execute()
        print(f"  {table}: {min(i + batch_size, total)}/{total}")
    print(f"  -> {table}: {total} rijen")


def fetch_all_rows(table, select_cols):
    all_data = []
    offset = 0
    page_size = 1000
    while True:
        result = sb.table(table).select(select_cols).range(offset, offset + page_size - 1).execute()
        all_data.extend(result.data)
        if len(result.data) < page_size:
            break
        offset += page_size
    return all_data


def parse_filename(filename):
    m = re.search(r'[Pp]rijslijst\s+(\d+)', filename)
    if not m:
        return None
    return m.group(1).zfill(4)


def parse_date_from_naam(naam):
    m = re.search(r'(\d{1,2})[.\-](\d{1,2})[.\-](\d{2,4})', naam)
    if not m:
        return None
    day, month, year = m.group(1), m.group(2), m.group(3)
    if len(year) == 2:
        year = '20' + year
    try:
        from datetime import datetime
        dt = datetime(int(year), int(month), int(day))
        return dt.strftime('%Y-%m-%d')
    except ValueError:
        return None


def read_new_excel(filepath, expected_nr=None):
    try:
        wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
        ws = wb.active
        all_rows = list(ws.iter_rows(values_only=True))
        wb.close()
    except Exception as e:
        print(f"  FOUT bij lezen '{filepath.name}': {e}")
        return None

    if len(all_rows) < 4:
        return None

    meta_row = all_rows[1]
    naam = None
    for cell in meta_row[1:]:
        if cell and isinstance(cell, str) and len(cell) > 3:
            naam = cell.strip()
            break
    if not naam:
        naam = str(meta_row[1]).strip() if meta_row[1] else ""

    if expected_nr and meta_row[0] is not None:
        try:
            excel_nr = str(int(meta_row[0])).zfill(4)
            if excel_nr != expected_nr:
                print(f"  WAARSCHUWING: bestandsnaam zegt {expected_nr}, Excel zegt {excel_nr}")
        except (ValueError, TypeError):
            pass

    geldig_vanaf = parse_date_from_naam(naam)
    if not geldig_vanaf:
        geldig_vanaf = parse_date_from_naam(filepath.name)

    rows = []
    for row in all_rows[3:]:
        if not row or row[0] is None:
            continue
        try:
            artikelnr = str(int(row[0]))
        except (ValueError, TypeError):
            continue

        ean_code = None
        if len(row) > 1 and row[1] is not None:
            try:
                ean_code = str(int(row[1]))
            except (ValueError, TypeError):
                ean_code = str(row[1]).strip() if row[1] else None

        omschrijving = str(row[2]).strip() if len(row) > 2 and row[2] else None
        omschrijving_2 = str(row[3]).strip() if len(row) > 3 and row[3] else None

        prijs = 0.0
        if len(row) > 4 and row[4] is not None:
            try:
                prijs = float(row[4])
            except (ValueError, TypeError):
                prijs = 0.0

        rows.append({
            "artikelnr": artikelnr,
            "ean_code": ean_code,
            "omschrijving": omschrijving,
            "omschrijving_2": omschrijving_2,
            "prijs": prijs,
        })

    return naam, geldig_vanaf, rows


# ============================================================
# STAP 1: Klant-referenties loskoppelen
# ============================================================
def step1_clear_old_klant_references():
    print("STAP 1: Oude klant-referenties loskoppelen\n")

    headers = fetch_all_rows("prijslijst_headers", "nr")
    delete_nrs = set(h["nr"] for h in headers if h["nr"] != KEEP_NR)
    remap_nrs = set(KLANT_MAPPING.keys())
    null_nrs = delete_nrs - remap_nrs

    all_klanten = fetch_all_rows("debiteuren", "debiteur_nr, naam, prijslijst_nr")
    to_null = [k for k in all_klanten if k.get("prijslijst_nr") in null_nrs]

    if not to_null:
        print("  Geen klanten om los te koppelen (al gedaan?).\n")
        return

    for k in to_null:
        sb.table("debiteuren").update({"prijslijst_nr": None}).eq("debiteur_nr", k["debiteur_nr"]).execute()

    print(f"  {len(to_null)} klanten losgekoppeld van oude prijslijsten")
    for k in to_null[:5]:
        print(f"    {k['naam']} (#{k['debiteur_nr']}): {k['prijslijst_nr']} -> NULL")
    if len(to_null) > 5:
        print(f"    ... en {len(to_null) - 5} meer")
    print()


# ============================================================
# STAP 2: Nieuwe prijslijsten importeren (headers + regels)
# ============================================================
def step2_import_new_prijslijsten():
    print("STAP 2: Nieuwe prijslijsten importeren (210-217)\n")

    xlsx_files = sorted([
        f for f in EXTRACT_DIR.glob("*.xlsx")
        if not f.name.startswith('~$')
    ])
    print(f"  {len(xlsx_files)} Excel bestanden gevonden\n")

    if not xlsx_files:
        print("ERROR: Geen xlsx bestanden gevonden.")
        return

    known_artikelnrs = set(r["artikelnr"] for r in fetch_all_rows("producten", "artikelnr"))
    print(f"  {len(known_artikelnrs)} bekende artikelnrs in producten\n")

    all_headers = []
    all_regels = []
    all_missing_products = {}

    for filepath in xlsx_files:
        prijslijst_nr = parse_filename(filepath.name)
        if not prijslijst_nr:
            print(f"  SKIP: '{filepath.name}'")
            continue

        result = read_new_excel(filepath, expected_nr=prijslijst_nr)
        if result is None:
            print(f"  SKIP: kan '{filepath.name}' niet lezen")
            continue

        naam, geldig_vanaf, rows = result

        all_headers.append({
            "nr": prijslijst_nr,
            "naam": naam,
            "geldig_vanaf": geldig_vanaf,
            "actief": True,
        })

        unknown_count = 0
        for row in rows:
            if row["artikelnr"] not in known_artikelnrs:
                unknown_count += 1
                if AUTO_CREATE_MISSING_PRODUCTS and row["artikelnr"] not in all_missing_products:
                    all_missing_products[row["artikelnr"]] = {
                        "omschrijving": row["omschrijving"],
                        "omschrijving_2": row["omschrijving_2"],
                        "prijs": row["prijs"],
                    }

            all_regels.append({
                "prijslijst_nr": prijslijst_nr,
                "artikelnr": row["artikelnr"],
                "ean_code": row["ean_code"],
                "omschrijving": row["omschrijving"],
                "omschrijving_2": row["omschrijving_2"],
                "prijs": row["prijs"],
                "gewicht": None,
            })

        print(f"  {prijslijst_nr} — {naam} — {len(rows)} regels, {unknown_count} onbekend, geldig: {geldig_vanaf or '?'}")

    # Auto-create missing products
    if AUTO_CREATE_MISSING_PRODUCTS and all_missing_products:
        print(f"\n  {len(all_missing_products)} ontbrekende producten aanmaken...\n")
        new_products = []
        for artikelnr, info in all_missing_products.items():
            oms = (info["omschrijving"] or "").upper()
            if "BREED" in oms:
                ptype = "rol"
            elif "CA:" in oms:
                ptype = "vast"
            else:
                ptype = "overig"
            new_products.append({
                "artikelnr": artikelnr,
                "omschrijving": info["omschrijving"] or "Onbekend product",
                "verkoopprijs": info["prijs"],
                "voorraad": 0,
                "gereserveerd": 0,
                "vrije_voorraad": 0,
                "product_type": ptype,
                "actief": True,
            })
        upsert_batch("producten", new_products, on_conflict="artikelnr")

    # Upsert headers + regels
    print("\n  Prijslijst headers upserten...")
    upsert_batch("prijslijst_headers", all_headers, on_conflict="nr")
    print("\n  Prijslijst regels upserten...")
    upsert_batch("prijslijst_regels", all_regels, on_conflict="prijslijst_nr,artikelnr")

    print(f"\n  -> {len(all_headers)} prijslijsten, {len(all_regels):,} regels geimporteerd\n")


# ============================================================
# STAP 3: Klant-koppelingen updaten (oud -> nieuw)
# ============================================================
def step3_update_klant_koppelingen():
    print("STAP 3: Klant prijslijst-koppelingen updaten\n")

    for oud, nieuw in KLANT_MAPPING.items():
        result = sb.table("debiteuren").select("debiteur_nr, naam, prijslijst_nr").eq("prijslijst_nr", oud).execute()
        klanten = result.data

        if not klanten:
            print(f"  {oud} -> {nieuw}: geen klanten gevonden")
            continue

        for k in klanten:
            sb.table("debiteuren").update({"prijslijst_nr": nieuw}).eq("debiteur_nr", k["debiteur_nr"]).execute()

        namen = ", ".join(f"{k['naam']} (#{k['debiteur_nr']})" for k in klanten[:5])
        extra = f" ... en {len(klanten) - 5} meer" if len(klanten) > 5 else ""
        print(f"  {oud} -> {nieuw}: {len(klanten)} klant(en) — {namen}{extra}")

    print()


# ============================================================
# STAP 4: Oude prijslijsten verwijderen
# ============================================================
def step4_delete_old_prijslijsten():
    print("STAP 4: Oude prijslijsten verwijderen\n")

    headers = fetch_all_rows("prijslijst_headers", "nr, naam")
    new_nrs = set(KLANT_MAPPING.values())
    keep_nrs = {KEEP_NR} | new_nrs
    keep = [h for h in headers if h["nr"] in keep_nrs]
    delete = [h for h in headers if h["nr"] not in keep_nrs]

    for h in keep:
        print(f"  BEHOUDEN: {h['nr']} — {h['naam']}")
    print(f"  TE VERWIJDEREN: {len(delete)} prijslijsten")

    if not delete:
        print("  Niets te verwijderen.\n")
        return

    delete_nrs = [h["nr"] for h in delete]

    batch_size = 50
    for i in range(0, len(delete_nrs), batch_size):
        batch = delete_nrs[i:i + batch_size]
        sb.table("prijslijst_regels").delete().in_("prijslijst_nr", batch).execute()
        sb.table("prijslijst_headers").delete().in_("nr", batch).execute()
        print(f"  Verwijderd: batch {i // batch_size + 1} ({len(batch)} prijslijsten)")

    print(f"  -> {len(delete)} prijslijsten verwijderd\n")


# ============================================================
# MAIN
# ============================================================
def main():
    print("=" * 60)
    print("=== Prijslijst Update April 2026 ===")
    print("=" * 60 + "\n")

    step1_clear_old_klant_references()
    step2_import_new_prijslijsten()
    step3_update_klant_koppelingen()
    step4_delete_old_prijslijsten()

    print("=" * 60)
    print("=== KLAAR ===")
    print("=" * 60)


if __name__ == "__main__":
    main()
