"""
RugFlow ERP — Prijslijst Import (vanuit Excel ZIP)
Importeert klantspecifieke prijslijsten uit individuele Excel bestanden
naar prijslijst_headers + prijslijst_regels in Supabase.

Bron: wetransfer_prijslijst_2025-11-19_1107.zip (45 xlsx bestanden)
Idempotent: gebruikt upserts op bestaande conflict keys.
"""
import sys
import re
import zipfile
import io
from pathlib import Path
from datetime import datetime

# Fix Windows console encoding voor Unicode-tekens in klantnamen
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import openpyxl
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

# --- Init ---
if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Supabase URL/Key niet gevonden. Check import/.env")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

ZIP_PATH = BASE_DIR / "wetransfer_prijslijst_2025-11-19_1107.zip"
EXTRACT_DIR = BASE_DIR / "supabase" / ".temp" / "prijslijsten" / "wetransfer_prijslijst_2025-11-19_1107"

# Als True: maak ontbrekende artikelnrs automatisch aan in producten tabel.
# Als False: sla onbekende artikelnrs over (oude gedrag).
AUTO_CREATE_MISSING_PRODUCTS = True


def upsert_batch(table, records, batch_size=500, on_conflict=None):
    """Upsert records in batches"""
    total = len(records)
    for i in range(0, total, batch_size):
        batch = records[i:i + batch_size]
        kwargs = {}
        if on_conflict:
            kwargs['on_conflict'] = on_conflict
        sb.table(table).upsert(batch, **kwargs).execute()
        print(f"  {table}: {min(i + batch_size, total)}/{total}")
    print(f"   {table}: {total} rijen")


def extract_zip():
    """Extract ZIP if not already extracted."""
    if EXTRACT_DIR.exists() and any(EXTRACT_DIR.glob("*.xlsx")):
        print(f"  ZIP reeds uitgepakt in {EXTRACT_DIR}")
        return
    if not ZIP_PATH.exists():
        print(f"ERROR: ZIP bestand niet gevonden: {ZIP_PATH}")
        sys.exit(1)
    print(f"  ZIP uitpakken naar {EXTRACT_DIR}...")
    EXTRACT_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ZIP_PATH, 'r') as zf:
        for member in zf.namelist():
            # Skip macOS resource forks and lock files
            if '__MACOSX/' in member or member.startswith('~$'):
                continue
            basename = Path(member).name
            if not basename or basename.startswith('~$') or not basename.endswith('.xlsx'):
                continue
            # Extract flat into EXTRACT_DIR
            target = EXTRACT_DIR / basename
            with zf.open(member) as src, open(target, 'wb') as dst:
                dst.write(src.read())
    print(f"  ZIP uitgepakt: {len(list(EXTRACT_DIR.glob('*.xlsx')))} bestanden")


def parse_filename(filename):
    """Extract prijslijst nummer from filename like 'Prijslijst 191 Fame Flooring.xlsx'."""
    m = re.search(r'Prijslijst\s+(\d+)', filename)
    if not m:
        return None
    return m.group(1).zfill(4)


def parse_date_from_naam(naam):
    """
    Parse 'geldig_vanaf' date from naam string.
    Formats: 'PER DD.MM.YYYY', 'PER DD.MM.YY', or just 'DD.MM.YYYY' / 'DD.MM.YY' at end.
    Returns ISO date string or None.
    """
    # Try to find date pattern (DD.MM.YYYY or DD.MM.YY)
    m = re.search(r'(\d{2})\.(\d{2})\.(\d{2,4})', naam)
    if not m:
        return None
    day, month, year = m.group(1), m.group(2), m.group(3)
    if len(year) == 2:
        year = '20' + year
    try:
        dt = datetime(int(year), int(month), int(day))
        return dt.strftime('%Y-%m-%d')
    except ValueError:
        return None


def read_excel_file(filepath, expected_nr=None):
    """
    Read a prijslijst Excel file.
    Returns (naam, geldig_vanaf, rows) or None on failure.
    Each row is a dict with artikelnr, omschrijving, omschrijving_2, prijs, gewicht.
    If expected_nr is given, cross-validates against the nr embedded in the Excel.
    """
    try:
        wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
        ws = wb.active
        all_rows = list(ws.iter_rows(values_only=True))
        wb.close()
    except Exception as e:
        print(f"  FOUT bij lezen '{filepath.name}': {e}")
        return None

    if len(all_rows) < 3:
        return None

    # Row 1 (index 1): metadata — (prijslijst_nr_int, "NAAM PER DD.MM.YYYY", ...)
    meta_row = all_rows[1]
    naam = str(meta_row[1]).strip() if meta_row[1] else ""

    # Cross-validate: vergelijk nr uit bestandsnaam met nr in Excel cel
    if expected_nr and meta_row[0] is not None:
        try:
            excel_nr = str(int(meta_row[0])).zfill(4)
            if excel_nr != expected_nr:
                print(f"  WAARSCHUWING: bestandsnaam zegt {expected_nr}, Excel cel zegt {excel_nr}")
        except (ValueError, TypeError):
            pass

    geldig_vanaf = parse_date_from_naam(naam)

    # Data rows start at index 3
    rows = []
    for row in all_rows[3:]:
        # Skip empty rows
        if not row or row[0] is None:
            continue

        artikelnr_raw = row[0]
        # Convert int/float artikelnr to TEXT string
        try:
            artikelnr = str(int(artikelnr_raw))
        except (ValueError, TypeError):
            continue  # Skip rows with non-numeric artikelnr

        omschrijving = str(row[1]).strip() if row[1] else None
        omschrijving_2 = str(row[2]).strip() if row[2] else None
        # Column D = prijs (index 3)
        prijs_raw = row[3]
        try:
            prijs = float(prijs_raw) if prijs_raw is not None else 0.0
        except (ValueError, TypeError):
            prijs = 0.0

        # Column E (index 4) = Techn.omschrijving — SKIP
        # Column F (index 5) = Gewicht (stored as string)
        gewicht_raw = row[5] if len(row) > 5 else None
        gewicht = None
        if gewicht_raw is not None:
            try:
                gewicht = float(gewicht_raw)
            except (ValueError, TypeError):
                gewicht = None

        rows.append({
            "artikelnr": artikelnr,
            "omschrijving": omschrijving,
            "omschrijving_2": omschrijving_2,
            "prijs": prijs,
            "gewicht": gewicht,
        })

    return naam, geldig_vanaf, rows


def fetch_all_rows(table, select_cols):
    """Fetch all rows from a table, paginating past the 1000-row default limit."""
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


def fetch_linked_debiteuren():
    """Fetch all debiteuren with their prijslijst_nr for linking.
    Normalizes prijslijst_nr to zero-padded 4 chars for consistent matching."""
    rows = fetch_all_rows("debiteuren", "debiteur_nr, naam, prijslijst_nr")
    # Build map: prijslijst_nr (zero-padded) -> list of (debiteur_nr, naam)
    mapping = {}
    for row in rows:
        pnr = row["prijslijst_nr"]
        if pnr is None:
            continue
        # Normalize: strip whitespace, zero-pad to 4 chars
        pnr = pnr.strip().zfill(4)
        if pnr not in mapping:
            mapping[pnr] = []
        mapping[pnr].append((row["debiteur_nr"], row["naam"]))
    return mapping


def fetch_known_artikelnrs():
    """Fetch all artikelnr values from producten table."""
    rows = fetch_all_rows("producten", "artikelnr")
    return set(row["artikelnr"] for row in rows)


# ============================================================
# MAIN
# ============================================================
def main():
    print("=== Prijslijst Import ===\n")

    # Step 1: Extract ZIP if needed
    print("1  ZIP uitpakken...")
    extract_zip()

    # Step 2: Collect all xlsx files (skip lock files)
    xlsx_files = sorted([
        f for f in EXTRACT_DIR.glob("*.xlsx")
        if not f.name.startswith('~$')
    ])
    print(f"\n  {len(xlsx_files)} Excel bestanden gevonden\n")

    if not xlsx_files:
        print("ERROR: Geen xlsx bestanden gevonden.")
        sys.exit(1)

    # Step 3: Fetch validation data
    print("2  Validatiedata ophalen...")
    debiteur_map = fetch_linked_debiteuren()
    known_artikelnrs = fetch_known_artikelnrs()
    print(f"  {sum(len(v) for v in debiteur_map.values())} debiteuren met prijslijst_nr")
    print(f"  {len(known_artikelnrs)} bekende artikelnrs in producten")

    # Collect all unknown artikelnrs across all files first (for auto-create)
    all_missing_products = {}  # artikelnr -> {omschrijving, omschrijving_2, prijs, gewicht}

    # Step 4: Process each file
    all_headers = []
    all_regels = []
    report_lines = []
    warnings_no_klant = []
    total_unknown_artikelnrs = 0

    print("3  Bestanden verwerken...\n")
    for filepath in xlsx_files:
        filename = filepath.name
        prijslijst_nr = parse_filename(filename)
        if not prijslijst_nr:
            print(f"  SKIP: Kan prijslijst nr niet parsen uit '{filename}'")
            continue

        result = read_excel_file(filepath, expected_nr=prijslijst_nr)
        if result is None:
            print(f"  SKIP: Kan '{filename}' niet lezen")
            continue

        naam, geldig_vanaf, rows = result

        # Build header record
        header = {
            "nr": prijslijst_nr,
            "naam": naam,
            "geldig_vanaf": geldig_vanaf,
            "actief": True,
        }
        all_headers.append(header)

        # Build regel records
        file_regels = []
        unknown_in_file = 0
        for row in rows:
            is_unknown = row["artikelnr"] not in known_artikelnrs
            if is_unknown:
                unknown_in_file += 1
                if AUTO_CREATE_MISSING_PRODUCTS:
                    # Collect for bulk create later
                    if row["artikelnr"] not in all_missing_products:
                        all_missing_products[row["artikelnr"]] = {
                            "omschrijving": row["omschrijving"],
                            "omschrijving_2": row["omschrijving_2"],
                            "verkoopprijs": row["prijs"],
                            "gewicht_kg": row["gewicht"],
                        }
                else:
                    continue  # Skip om FK-fouten te voorkomen

            file_regels.append({
                "prijslijst_nr": prijslijst_nr,
                "artikelnr": row["artikelnr"],
                "omschrijving": row["omschrijving"],
                "omschrijving_2": row["omschrijving_2"],
                "prijs": row["prijs"],
                "gewicht": row["gewicht"],
                "ean_code": None,
            })

        all_regels.extend(file_regels)
        total_unknown_artikelnrs += unknown_in_file

        # Linked klant(en)
        linked = debiteur_map.get(prijslijst_nr, [])
        linked_str = ", ".join(f"{naam} (#{nr})" for nr, naam in linked) if linked else "GEEN"
        if not linked:
            warnings_no_klant.append(prijslijst_nr)

        # Report line
        report_lines.append(
            f"Bestand: {filename}\n"
            f"  Prijslijst nr: {prijslijst_nr}\n"
            f"  Naam: {naam}\n"
            f"  Geldig vanaf: {geldig_vanaf or 'onbekend'}\n"
            f"  Regels: {len(file_regels)}\n"
            f"  Gekoppelde klant(en): {linked_str}\n"
            f"  Onbekende artikelnrs: {unknown_in_file}"
        )

    # Step 5: Auto-create missing products
    if AUTO_CREATE_MISSING_PRODUCTS and all_missing_products:
        print(f"\n4  {len(all_missing_products)} ontbrekende producten aanmaken in producten tabel...\n")
        new_products = []
        for artikelnr, info in all_missing_products.items():
            oms = (info["omschrijving"] or "").upper()
            if "BREED" in oms:
                ptype = "rol"
            elif "CA:" in oms:
                m = re.search(r'CA:\s*(\d+)\s*[xX]\s*(\d+)', oms)
                if m and int(m.group(1)) * int(m.group(2)) < 10000:
                    ptype = "staaltje"
                else:
                    ptype = "vast"
            else:
                ptype = "overig"
            new_products.append({
                "artikelnr": artikelnr,
                "omschrijving": info["omschrijving"] or "Onbekend product",
                "verkoopprijs": info["verkoopprijs"],
                "gewicht_kg": info["gewicht_kg"],
                "voorraad": 0,
                "gereserveerd": 0,
                "vrije_voorraad": 0,
                "product_type": ptype,
                "actief": True,
            })
        upsert_batch("producten", new_products, on_conflict="artikelnr")
        # Update known set so report is accurate
        known_artikelnrs.update(all_missing_products.keys())
        print(f"  {len(new_products)} producten aangemaakt\n")
    elif all_missing_products:
        print(f"\n  WAARSCHUWING: {len(all_missing_products)} artikelnrs niet in producten (AUTO_CREATE uit)\n")

    # Step 6: Upsert to Supabase
    print("\n5  Upsert naar Supabase...\n")
    print("  --- Prijslijst headers ---")
    upsert_batch("prijslijst_headers", all_headers, on_conflict="nr")
    print()
    print("  --- Prijslijst regels ---")
    upsert_batch("prijslijst_regels", all_regels, on_conflict="prijslijst_nr,artikelnr")

    # Step 6: Report
    print("\n" + "=" * 50)
    print("=== Prijslijst Import Rapport ===")
    print("=" * 50 + "\n")

    for line in report_lines:
        print(line)
        print()

    print("=" * 50)
    print("=== Totaal ===")
    print(f"Bestanden verwerkt: {len(report_lines)}")
    print(f"Prijslijst headers upserted: {len(all_headers)}")
    print(f"Prijslijst regels upserted: {len(all_regels):,}")
    if warnings_no_klant:
        print(f"Waarschuwingen: {len(warnings_no_klant)} prijslijsten zonder gekoppelde klant: {', '.join(warnings_no_klant)}")
    else:
        print("Waarschuwingen: geen")
    if total_unknown_artikelnrs:
        print(f"Onbekende artikelnrs (niet in producten): {total_unknown_artikelnrs} totaal")
    print()


if __name__ == "__main__":
    main()
