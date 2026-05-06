"""
Eenmalige import van kwaliteit-gewichten uit Karpi-legacy-export.

Bron: brondata/voorraad/akwaliteitscodeslijst-260505.xlsx
Doel: kwaliteiten.gewicht_per_m2_kg

Excel-structuur:
  Kolom A: Kwaliteitscode (str, 3-4 letters) → matcht kwaliteiten.code
  Kolom B: Omschrijving (informatief, niet geïmporteerd)
  Kolom C: Gewicht per m2 (float, kg/m²) → kwaliteiten.gewicht_per_m2_kg

Bedrijfsregels:
  - 0.0-waarden = niet ingevuld → NULL (placeholders voor display/diverse-codes)
  - Onbekende codes (niet in DB) → warning, niet fataal
  - Triggers cascaderen automatisch naar producten + open order_regels

Gebruik:
  python import/import_kwaliteit_gewichten.py --dry-run
  python import/import_kwaliteit_gewichten.py
"""

import sys
import argparse
from pathlib import Path

import pandas as pd
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY, BRONDATA_DIR

EXCEL_FILE = BRONDATA_DIR / "voorraad" / "akwaliteitscodeslijst-260505.xlsx"


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true",
                   help="Toon wijzigingen zonder DB te muteren")
    p.add_argument("--file", type=Path, default=EXCEL_FILE,
                   help=f"Pad naar Excel (default: {EXCEL_FILE})")
    return p.parse_args()


def load_excel(path: Path) -> pd.DataFrame:
    if not path.exists():
        sys.exit(f"ERROR: Excel-bestand niet gevonden: {path}")
    df = pd.read_excel(path)
    expected_cols = {"Kwaliteitscode", "Gewicht per m2"}
    missing = expected_cols - set(df.columns)
    if missing:
        sys.exit(f"ERROR: ontbrekende kolommen in Excel: {missing}")
    return df


def normalize_rows(df: pd.DataFrame) -> list[dict]:
    """Converteer Excel-rijen naar (code, gewicht|None)-tuples.

    0.0 en negatieve waarden → None (placeholder-codes).
    """
    rows = []
    for _, r in df.iterrows():
        code = r["Kwaliteitscode"]
        if pd.isna(code) or not str(code).strip():
            continue
        code = str(code).strip().upper()
        raw = r["Gewicht per m2"]
        try:
            gewicht = float(raw) if raw is not None and not pd.isna(raw) else None
        except (TypeError, ValueError):
            gewicht = None
        if gewicht is not None and gewicht <= 0:
            gewicht = None
        rows.append({"code": code, "gewicht_per_m2_kg": gewicht})
    return rows


def fetch_existing_kwaliteiten(sb) -> dict[str, float | None]:
    """Lees alle bestaande kwaliteiten met huidig gewicht."""
    result = {}
    page_size = 1000
    offset = 0
    while True:
        res = sb.table("kwaliteiten").select("code, gewicht_per_m2_kg") \
            .range(offset, offset + page_size - 1).execute()
        rows = res.data or []
        for row in rows:
            result[row["code"]] = row["gewicht_per_m2_kg"]
        if len(rows) < page_size:
            break
        offset += page_size
    return result


def main():
    args = parse_args()
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("ERROR: Supabase URL/Key niet gevonden. Check import/.env")

    print(f"[*] Laden van {args.file}...")
    df = load_excel(args.file)
    rows = normalize_rows(df)
    print(f"    {len(rows)} kwaliteit-rijen ingelezen.")
    rows_with_gewicht = [r for r in rows if r["gewicht_per_m2_kg"] is not None]
    print(f"    {len(rows_with_gewicht)} met geldig gewicht (>0).")
    print(f"    {len(rows) - len(rows_with_gewicht)} zonder gewicht (0.0/leeg, behandeld als NULL).")

    print("\n[*] Bestaande kwaliteiten ophalen...")
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    existing = fetch_existing_kwaliteiten(sb)
    print(f"    {len(existing)} kwaliteiten in DB.")

    onbekend = []
    geen_wijziging = []
    te_updaten = []  # list[dict] met code + nieuwe gewicht
    voor_te_droppen = []  # codes waar Excel NULL zegt en DB iets heeft

    for row in rows:
        code = row["code"]
        new_w = row["gewicht_per_m2_kg"]
        if code not in existing:
            onbekend.append((code, new_w))
            continue
        old_w = existing[code]
        old_f = float(old_w) if old_w is not None else None
        if old_f == new_w:
            geen_wijziging.append(code)
        elif new_w is None:
            # Excel heeft NULL/0, DB heeft waarde → laat staan, niet overschrijven
            voor_te_droppen.append((code, old_f))
        else:
            te_updaten.append({"code": code, "gewicht_per_m2_kg": new_w, "oud": old_f})

    print()
    print(f"[*] Plan:")
    print(f"    Te updaten           : {len(te_updaten)}")
    print(f"    Geen wijziging       : {len(geen_wijziging)}")
    print(f"    Excel NULL, DB heeft : {len(voor_te_droppen)} (NIET overschrijven)")
    print(f"    Onbekend in DB       : {len(onbekend)}")

    if onbekend[:20]:
        print(f"\n    Eerste {min(20, len(onbekend))} onbekende Excel-codes:")
        for code, w in onbekend[:20]:
            print(f"      {code} (gewicht={w})")

    if te_updaten[:10]:
        print(f"\n    Voorbeeld updates (eerste 10):")
        for u in te_updaten[:10]:
            print(f"      {u['code']}: {u['oud']} -> {u['gewicht_per_m2_kg']}")

    if args.dry_run:
        print("\n[DRY-RUN] Geen wijzigingen toegepast.")
        return 0

    if not te_updaten:
        print("\n[*] Niets te doen.")
        return 0

    print(f"\n[*] {len(te_updaten)} updates uitvoeren (cascade-triggers firen)...")
    BATCH = 100
    done = 0
    for i in range(0, len(te_updaten), BATCH):
        batch = te_updaten[i:i + BATCH]
        # supabase-py upsert moet alle kolommen meenemen of partial; we gebruiken
        # update per rij om alleen het gewicht-veld te raken (cascade-trigger
        # firet alleen op gewicht_per_m2_kg-wijziging, dus dit is correct).
        for u in batch:
            sb.table("kwaliteiten").update(
                {"gewicht_per_m2_kg": u["gewicht_per_m2_kg"]}
            ).eq("code", u["code"]).execute()
        done += len(batch)
        print(f"    {done}/{len(te_updaten)}")

    print(f"\n[*] Klaar. {done} kwaliteiten bijgewerkt.")
    print("    Cascade-triggers hebben producten + open orderregels herrekend.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
