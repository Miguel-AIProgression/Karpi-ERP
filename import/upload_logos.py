"""Upload klantlogo's naar Supabase Storage en zet logo_path in debiteuren."""
import re
import sys
from pathlib import Path
from config import SUPABASE_URL, SUPABASE_KEY, LOGOS_DIR
from supabase import create_client

SUPPORTED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
MIME_MAP = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}

def parse_debiteur_nr(filename: str) -> int | None:
    """Extract debiteur_nr from filename. Returns None if not numeric."""
    match = re.match(r'^(\d+)', filename)
    return int(match.group(1)) if match else None

def collect_best_logos(logo_files: list[Path]) -> dict[int, Path]:
    """Deduplicate: als meerdere bestanden dezelfde debiteur_nr hebben,
    prefer het bestand waarvan de stem exact het nummer is (bijv. 101002.jpg > 101002c.JPG)."""
    candidates: dict[int, list[Path]] = {}
    for f in logo_files:
        deb_nr = parse_debiteur_nr(f.stem)
        if deb_nr is None:
            continue
        candidates.setdefault(deb_nr, []).append(f)

    best: dict[int, Path] = {}
    for deb_nr, files in candidates.items():
        # Prefer exact match (stem == str(deb_nr)), then first alphabetically
        exact = [f for f in files if f.stem == str(deb_nr)]
        best[deb_nr] = exact[0] if exact else sorted(files)[0]
    return best

def main():
    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Haal alle debiteur_nrs op (ook inactieve — logo moet beschikbaar blijven bij heractivering)
    result = client.table('debiteuren').select('debiteur_nr').execute()
    valid_nrs = {row['debiteur_nr'] for row in result.data}
    print(f"Debiteuren in DB: {len(valid_nrs)}")

    # Verzamel uploadbare logo's en deduplicate
    all_logo_files = [f for f in LOGOS_DIR.iterdir() if f.suffix.lower() in SUPPORTED_EXTENSIONS]
    best_logos = collect_best_logos(all_logo_files)
    print(f"Logo bestanden gevonden: {len(all_logo_files)}")
    print(f"Unieke debiteur_nrs met logo: {len(best_logos)}")

    uploaded = 0
    skipped_no_match = 0
    errors = 0

    for deb_nr, logo_file in sorted(best_logos.items()):
        if deb_nr not in valid_nrs:
            skipped_no_match += 1
            continue

        storage_path = f"{deb_nr}.jpg"
        mime = MIME_MAP.get(logo_file.suffix.lower(), 'image/jpeg')

        try:
            file_bytes = logo_file.read_bytes()
            # Upload (upsert) naar storage
            client.storage.from_('logos').upload(
                storage_path,
                file_bytes,
                file_options={"content-type": mime, "upsert": "true"},
            )
            # Update logo_path in debiteuren
            client.table('debiteuren').update(
                {'logo_path': storage_path}
            ).eq('debiteur_nr', deb_nr).execute()

            uploaded += 1
            if uploaded % 100 == 0:
                print(f"  ... {uploaded} geüpload")
        except Exception as e:
            print(f"  FOUT bij {logo_file.name}: {e}", file=sys.stderr)
            errors += 1

    no_nr_files = [f for f in all_logo_files if parse_debiteur_nr(f.stem) is None]

    print(f"\nResultaat:")
    print(f"  Geüpload:          {uploaded}")
    print(f"  Geen nummer:        {len(no_nr_files)}")
    print(f"  Dubbel (geskipt):   {len(all_logo_files) - len(best_logos) - len(no_nr_files)}")
    print(f"  Geen match in DB:   {skipped_no_match}")
    print(f"  Fouten:             {errors}")

if __name__ == '__main__':
    main()
