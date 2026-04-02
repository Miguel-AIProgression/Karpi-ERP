"""Import product locaties uit Locaties123.xls naar Supabase.

Leest kolom A (Locatie) + kolom B (Artikelnr) uit het Excel-bestand.
Slaat "Maatw." locaties over. Updatet producten.locatie via Supabase REST API.

Gebruik:
    python import_locaties.py [--dry-run]
"""
import sys
import xlrd
from pathlib import Path

# --- Config ---
from config import SUPABASE_URL, SUPABASE_KEY, BRONDATA_DIR

LOCATIES_FILE = BRONDATA_DIR / "Locaties123.xls"
SKIP_LOCATIES = {"Maatw.", "Maatw"}  # locaties om over te slaan
BATCH_SIZE = 500


def read_locaties(filepath: Path) -> dict[str, str]:
    """Lees locaties uit Excel. Returns {artikelnr: locatie}."""
    wb = xlrd.open_workbook(str(filepath))
    ws = wb.sheet_by_index(0)

    locaties: dict[str, str] = {}
    skipped = 0

    for i in range(2, ws.nrows):  # skip header rows
        locatie = str(ws.cell_value(i, 0)).strip()
        artikelnr = str(ws.cell_value(i, 1)).strip()

        if not locatie or not artikelnr:
            continue

        # Float artikelnrs afronden (Excel leest als float)
        if artikelnr.endswith(".0"):
            artikelnr = artikelnr[:-2]

        if locatie in SKIP_LOCATIES:
            skipped += 1
            continue

        locaties[artikelnr] = locatie

    print(f"Gelezen: {len(locaties)} producten met locatie ({skipped} Maatw. overgeslagen)")
    return locaties


def update_locaties(locaties: dict[str, str], dry_run: bool = False):
    """Update producten.locatie in Supabase."""
    import urllib.request
    import json

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    success = 0
    errors = 0
    items = list(locaties.items())

    for i, (artikelnr, locatie) in enumerate(items):
        if dry_run:
            if i < 10:
                print(f"  [DRY RUN] {artikelnr} -> {locatie}")
            continue

        url = f"{SUPABASE_URL}/rest/v1/producten?artikelnr=eq.{artikelnr}"
        body = json.dumps({"locatie": locatie}).encode()
        req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")

        try:
            urllib.request.urlopen(req)
            success += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  FOUT bij {artikelnr}: {e}")

        if (i + 1) % 500 == 0:
            print(f"  Voortgang: {i + 1}/{len(items)}")

    if dry_run:
        print(f"  ... en {len(items) - min(10, len(items))} meer")
        print(f"\n[DRY RUN] Zou {len(items)} producten updaten")
    else:
        print(f"\nKlaar: {success} gelukt, {errors} fouten")


def main():
    dry_run = "--dry-run" in sys.argv

    if not LOCATIES_FILE.exists():
        print(f"FOUT: Bestand niet gevonden: {LOCATIES_FILE}")
        sys.exit(1)

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("FOUT: SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY vereist in import/.env")
        sys.exit(1)

    print(f"Bron: {LOCATIES_FILE}")
    print(f"Doel: {SUPABASE_URL}")
    if dry_run:
        print("[DRY RUN modus — geen wijzigingen]\n")

    locaties = read_locaties(LOCATIES_FILE)

    # Toon unieke locaties
    unieke = sorted(set(locaties.values()))
    print(f"Unieke locaties: {len(unieke)}")
    print(f"Voorbeelden: {', '.join(unieke[:10])}\n")

    update_locaties(locaties, dry_run=dry_run)


if __name__ == "__main__":
    main()
