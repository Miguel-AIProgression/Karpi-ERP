"""
Eenmalige import van CBS-statistieknummers (goederencodes) per kwaliteit.

Aanleiding: mail Nando 17-06-2026 — buitenlandse facturen misten het
statistieknummer dat het oude systeem toonde, nodig voor de maandelijkse
CBS/Intrastat-aangifte. Alex leverde twee exports (18-06-2026):

  1. akwaliteitscodeslijst260618.txt — Kwaliteitscode / Omschrijving / goederencode
  2. agoederencode260618.txt        — Artikel / Omschrijving / Kwaliteitscode / Goederencode

Beide bestanden zijn 100% consistent met elkaar (geen kwaliteit met
tegenstrijdige codes tussen de twee bronnen). Bestand 2 is per-artikel en
dekt een paar kwaliteiten die in bestand 1 leeg stonden — daarom combineren
we: bestand 1 als primaire bron, bestand 2 als fallback voor kwaliteiten
zonder code in bestand 1.

Bedrijfsregel:
  - Lege/ontbrekende code → NULL (kwaliteit nooit naar het buitenland
    verkocht, of nog onbekend — niet urgent, zie mig 446-toelichting)
  - Leidende nullen in de bronbestanden (export-artefact, bv. "057024290")
    worden gestript → 8-cijferige CN-code ("57024290")
  - Onbekende kwaliteitscodes (niet in DB) → warning, niet fataal

Gebruik:
  python import/import_goederencodes.py --dry-run
  python import/import_goederencodes.py
"""

import sys
import argparse
import csv
from pathlib import Path

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

KWALITEITSLIJST_FILE = BASE_DIR / "akwaliteitscodeslijst260618.txt"
ARTIKEL_FILE = BASE_DIR / "agoederencode260618.txt"


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true",
                   help="Toon wijzigingen zonder DB te muteren")
    p.add_argument("--kwaliteitslijst", type=Path, default=KWALITEITSLIJST_FILE)
    p.add_argument("--artikelbestand", type=Path, default=ARTIKEL_FILE)
    return p.parse_args()


def normaliseer_code(raw: str) -> str:
    """Strip leidende nullen (export-artefact) — '057024290' -> '57024290'."""
    raw = raw.strip()
    return raw.lstrip("0") if raw else ""


def load_kwaliteitslijst(path: Path) -> dict[str, str]:
    """Kwaliteitscode -> goederencode (alleen niet-lege waarden)."""
    if not path.exists():
        sys.exit(f"ERROR: bestand niet gevonden: {path}")
    result = {}
    with open(path, encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            code = (row.get("Kwaliteitscode") or "").strip().upper()
            if not code:
                continue
            gc = normaliseer_code(row.get("goederencode") or "")
            if gc:
                result[code] = gc
    return result


def load_artikel_fallback(path: Path) -> dict[str, str]:
    """Kwaliteitscode -> goederencode, afgeleid uit het artikel-niveau-bestand."""
    if not path.exists():
        sys.exit(f"ERROR: bestand niet gevonden: {path}")
    result: dict[str, str] = {}
    with open(path, encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            code = (row.get("Kwaliteitscode") or "").strip().upper()
            gc = normaliseer_code(row.get("Goederencode") or "")
            if code and gc and code not in result:
                result[code] = gc
    return result


def fetch_existing_kwaliteiten(sb) -> dict[str, str | None]:
    result = {}
    page_size = 1000
    offset = 0
    while True:
        res = sb.table("kwaliteiten").select("code, goederencode") \
            .range(offset, offset + page_size - 1).execute()
        rows = res.data or []
        for row in rows:
            result[row["code"]] = row["goederencode"]
        if len(rows) < page_size:
            break
        offset += page_size
    return result


def main():
    args = parse_args()
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("ERROR: Supabase URL/Key niet gevonden. Check import/.env")

    print(f"[*] Laden van {args.kwaliteitslijst.name}...")
    primair = load_kwaliteitslijst(args.kwaliteitslijst)
    print(f"    {len(primair)} kwaliteiten met code.")

    print(f"[*] Laden van {args.artikelbestand.name} (fallback)...")
    fallback = load_artikel_fallback(args.artikelbestand)
    print(f"    {len(fallback)} unieke kwaliteiten met code op artikel-niveau.")

    combined: dict[str, str] = dict(primair)
    aangevuld = 0
    for code, gc in fallback.items():
        if code not in combined:
            combined[code] = gc
            aangevuld += 1
    print(f"    {aangevuld} kwaliteiten aangevuld uit het artikel-bestand.")
    print(f"    Totaal gecombineerd: {len(combined)} kwaliteiten met code.")

    print("\n[*] Bestaande kwaliteiten ophalen...")
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    existing = fetch_existing_kwaliteiten(sb)
    print(f"    {len(existing)} kwaliteiten in DB.")

    onbekend = []
    geen_wijziging = []
    te_updaten = []

    for code, new_gc in combined.items():
        if code not in existing:
            onbekend.append((code, new_gc))
            continue
        old_gc = existing[code]
        if old_gc == new_gc:
            geen_wijziging.append(code)
        else:
            te_updaten.append({"code": code, "goederencode": new_gc, "oud": old_gc})

    db_zonder_code = sorted(c for c in existing if not existing[c] and c not in combined)

    print()
    print("[*] Plan:")
    print(f"    Te updaten             : {len(te_updaten)}")
    print(f"    Geen wijziging         : {len(geen_wijziging)}")
    print(f"    Onbekend in DB         : {len(onbekend)}")
    print(f"    DB-kwaliteiten zonder code (ook na deze import): {len(db_zonder_code)}")

    if te_updaten[:10]:
        print("\n    Voorbeeld updates (eerste 10):")
        for u in te_updaten[:10]:
            print(f"      {u['code']}: {u['oud']} -> {u['goederencode']}")

    if onbekend[:10]:
        print(f"\n    Eerste {min(10, len(onbekend))} onbekende codes (niet in DB):")
        for code, gc in onbekend[:10]:
            print(f"      {code} (goederencode={gc})")

    if args.dry_run:
        print("\n[DRY-RUN] Geen wijzigingen toegepast.")
        return 0

    if not te_updaten:
        print("\n[*] Niets te doen.")
        return 0

    print(f"\n[*] {len(te_updaten)} updates uitvoeren...")
    BATCH = 100
    done = 0
    for i in range(0, len(te_updaten), BATCH):
        batch = te_updaten[i:i + BATCH]
        for u in batch:
            sb.table("kwaliteiten").update(
                {"goederencode": u["goederencode"]}
            ).eq("code", u["code"]).execute()
        done += len(batch)
        print(f"    {done}/{len(te_updaten)}")

    print(f"\n[*] Klaar. {done} kwaliteiten bijgewerkt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
