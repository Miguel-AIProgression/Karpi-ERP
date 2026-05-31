"""
RugFlow ERP — Nieuwe prijslijsten aanmaken + klanten koppelen (2026-05-29)

Bronbestand: brondata/debiteuren/debadres_alles-4.xlsx (kolom 'Prijslijst')
Doelprijslijsten: 0143, 0160, 0161, 0180, 0181, 0185, 0195, 0197, 0206, 0250

Stap 1: Maak prijslijst_headers aan (als die nog niet bestaan).
Stap 2: Koppel klanten (debiteuren.prijslijst_nr) via de debiteuren-export.

Gebruik:
  python maak_prijslijsten_en_koppel.py          # dry-run (toont wat er gaat)
  python maak_prijslijsten_en_koppel.py --apply  # echt uitvoeren
"""
from __future__ import annotations

import argparse
import io
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import openpyxl
from supabase import create_client

from config import BASE_DIR, SUPABASE_KEY, SUPABASE_URL

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Supabase URL/Key niet gevonden. Check import/.env")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

DEBITEUREN_FILE = BASE_DIR / "binnendienst" / "debadres_alles-4.xlsx"
TARGET_NRS = {"143", "160", "161", "180", "181", "185", "195", "197", "206", "250"}


def zpad(nr: str) -> str:
    return str(nr).strip().zfill(4)


def parse_geldig_vanaf(naam: str) -> str | None:
    """Haal datum op uit naam als 'AB 01.10.2022' of '1-3-2026'."""
    m = re.search(r"(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})", naam)
    if not m:
        return None
    day, month, year = m.groups()
    try:
        from datetime import date
        return date(int(year), int(month), int(day)).isoformat()
    except ValueError:
        return None


def lees_debiteuren() -> dict[str, list[tuple[int, str]]]:
    """Leest debadres_alles-4.xlsx en groepeert debiteur_nrs per prijslijst-nr."""
    if not DEBITEUREN_FILE.exists():
        # Probeer alternatief pad (Desktop/binnendienst)
        alt = Path.home() / "Desktop" / "binnendienst" / "debadres_alles-4.xlsx"
        if alt.exists():
            path = alt
        else:
            print(f"ERROR: {DEBITEUREN_FILE} niet gevonden")
            sys.exit(1)
    else:
        path = DEBITEUREN_FILE

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active

    debiteur_col = prijslijst_col = naam_col = pl_naam_col = None
    resultaten: dict[str, list[tuple[int, str]]] = defaultdict(list)
    pl_namen: dict[str, str] = {}

    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue
        if i == 1:
            for j, val in enumerate(row):
                if val == "Debiteur":    debiteur_col = j
                if val == "Naam":        naam_col = j
                if val == "Prijslijst":  prijslijst_col = j
            continue

        debnr  = row[debiteur_col]  if debiteur_col  is not None else None
        prijs  = row[prijslijst_col] if prijslijst_col is not None else None
        naam   = row[naam_col]      if naam_col      is not None else ""

        if not prijs or not debnr:
            continue

        prijs_str = str(prijs).strip()
        m = re.match(r"0*(\d+)\s*-?\s*(.*)", prijs_str)
        if not m:
            continue

        nr, pl_naam_raw = m.group(1), m.group(2).strip()
        if nr not in TARGET_NRS:
            continue

        if nr not in pl_namen and pl_naam_raw:
            pl_namen[nr] = pl_naam_raw

        try:
            resultaten[nr].append((int(debnr), str(naam or "")))
        except (TypeError, ValueError):
            continue

    return resultaten, pl_namen


def fetch_bestaande_headers() -> set[str]:
    res = sb.table("prijslijst_headers").select("nr").in_(
        "nr", [zpad(n) for n in TARGET_NRS]
    ).execute()
    return {r["nr"] for r in res.data}


def fetch_huidige_koppelingen(debnrs: list[int]) -> dict[int, str | None]:
    huidig: dict[int, str | None] = {}
    for i in range(0, len(debnrs), 500):
        chunk = debnrs[i:i+500]
        res = sb.table("debiteuren").select("debiteur_nr,prijslijst_nr").in_(
            "debiteur_nr", chunk
        ).execute()
        for r in res.data:
            huidig[r["debiteur_nr"]] = r["prijslijst_nr"]
    return huidig


def main(apply: bool) -> None:
    mode = "APPLY" if apply else "DRY-RUN"
    print(f"=== Prijslijsten aanmaken + koppelen [{mode}] ===\n")

    klanten_per_pl, pl_namen = lees_debiteuren()
    bestaande = fetch_bestaande_headers()

    # ── Stap 1: prijslijst_headers aanmaken ────────────────────────
    print("── Stap 1: prijslijst_headers ──")
    nieuwe_headers = []
    for nr in sorted(TARGET_NRS, key=int):
        padded = zpad(nr)
        if padded in bestaande:
            print(f"  {padded}  al aanwezig — overgeslagen")
            continue
        naam = pl_namen.get(nr, f"Prijslijst {padded}")
        geldig = parse_geldig_vanaf(naam)
        nieuwe_headers.append({
            "nr": padded,
            "naam": naam,
            "geldig_vanaf": geldig,
            "actief": True,
        })
        print(f"  {padded}  NIEUW  '{naam}'  (geldig_vanaf: {geldig})")

    if apply and nieuwe_headers:
        sb.table("prijslijst_headers").upsert(nieuwe_headers, on_conflict="nr").execute()
        print(f"  → {len(nieuwe_headers)} headers aangemaakt")
    elif nieuwe_headers:
        print(f"  → [dry-run] zou {len(nieuwe_headers)} headers aanmaken")

    # ── Stap 2: klanten koppelen ────────────────────────────────────
    print("\n── Stap 2: klanten koppelen ──")
    alle_debnrs = [debnr for klanten in klanten_per_pl.values() for debnr, _ in klanten]
    huidig = fetch_huidige_koppelingen(sorted(set(alle_debnrs)))

    grand_update = grand_al_goed = grand_niet_in_db = 0

    for nr in sorted(TARGET_NRS, key=int):
        padded = zpad(nr)
        klanten = klanten_per_pl.get(nr, [])
        if not klanten:
            print(f"\n  {padded}: geen klanten gevonden in bronbestand")
            continue

        in_db       = [(d, n) for d, n in klanten if d in huidig]
        niet_in_db  = [(d, n) for d, n in klanten if d not in huidig]
        al_goed     = [(d, n) for d, n in in_db   if huidig[d] == padded]
        te_updaten  = [(d, n) for d, n in in_db   if huidig[d] != padded]

        print(f"\n  {padded} ({pl_namen.get(nr, '')})")
        print(f"    Totaal in bron:     {len(klanten)}")
        print(f"    Al correct:         {len(al_goed)}")
        print(f"    Te koppelen:        {len(te_updaten)}")
        if niet_in_db:
            print(f"    Niet in DB (skip):  {len(niet_in_db)}")
        for debnr, naam in te_updaten[:5]:
            was = huidig.get(debnr)
            print(f"      {debnr}  {naam}  (was: {was})")
        if len(te_updaten) > 5:
            print(f"      ... en {len(te_updaten)-5} meer")

        if apply and te_updaten:
            debnrs_update = [d for d, _ in te_updaten]
            for i in range(0, len(debnrs_update), 200):
                chunk = debnrs_update[i:i+200]
                sb.table("debiteuren").update({"prijslijst_nr": padded}).in_(
                    "debiteur_nr", chunk
                ).execute()

        grand_update   += len(te_updaten)
        grand_al_goed  += len(al_goed)
        grand_niet_in_db += len(niet_in_db)

    print(f"\n=== Samenvatting [{mode}] ===")
    print(f"  Bijgewerkt:        {grand_update}")
    print(f"  Al correct:        {grand_al_goed}")
    print(f"  Niet in DB (skip): {grand_niet_in_db}")
    if not apply:
        print("\n  Voer --apply toe om echt uit te voeren.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Echt uitvoeren (standaard: dry-run)")
    args = parser.parse_args()
    main(apply=args.apply)
