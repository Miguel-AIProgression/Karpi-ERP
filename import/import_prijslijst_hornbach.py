"""
RugFlow ERP — Hornbach-prijslijst (0251) importeren + koppelen + backfill (2026-06-04)

Bron: ../prijslijst0251_a hornbach.xlsx  (nieuw formaat met EAN-kolom)
       Artikelnr | EAN code | Omschrijving | Omschr.2 | Prijs | Techn.omschrijving | Gewicht

Stappen:
  1. prijslijst_headers: nr=0251, naam="HORNBACH PER 1-4-2026"
  2. prijslijst_regels: artikelprijzen (artikelnrs die niet in producten staan worden
     overgeslagen om FK-fouten te voorkomen — gerapporteerd)
  3. debiteuren.prijslijst_nr: koppel de ACTIEVE Hornbach-debiteur (361208) aan 0251
  4. Backfill (idee van migratie 308): vul prijs/korting_pct/bedrag op bestaande
     EDI-orderregels van Hornbach vanuit de zojuist geladen prijslijst.

Gebruik:
  python import_prijslijst_hornbach.py            # dry-run (alleen lezen + rapport)
  python import_prijslijst_hornbach.py --apply    # echt uitvoeren
"""
from __future__ import annotations

import argparse
import io
import re
import sys
from datetime import date
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import openpyxl
from supabase import create_client

from config import BASE_DIR, SUPABASE_KEY, SUPABASE_URL
from lib.supabase_helpers import upsert_batch

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Supabase URL/Key niet gevonden. Check import/.env")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

EXCEL_PATH = BASE_DIR / "prijslijst0251_a hornbach.xlsx"
PRIJSLIJST_NR = "0251"
# Alleen de ACTIEVE Hornbach-debiteur; EDI-orders landen via matchDebiteur op 361208.
# De overige Hornbach-records (361206/361207/361209/361210/361213/361214) zijn Inactief.
HORNBACH_DEBITEUR = 361208


def decimal(val: object) -> float | None:
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace(",", ".").strip())
    except (ValueError, TypeError):
        return None


def parse_datum(tekst: str) -> str | None:
    m = re.search(r"(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})", tekst or "")
    if not m:
        return None
    d, mo, y = m.groups()
    try:
        return date(int(y), int(mo), int(d)).isoformat()
    except ValueError:
        return None


def parse_excel() -> tuple[dict, list[dict]]:
    """Lees het nieuwe Hornbach-formaat (met EAN-kolom)."""
    wb = openpyxl.load_workbook(EXCEL_PATH, read_only=True, data_only=True)
    ws = wb.active

    header: dict = {}
    regels: list[dict] = []

    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue  # "Prijslijst-overzicht"
        if i == 1:
            naam = str(row[2]).strip() if row[2] else f"Prijslijst {PRIJSLIJST_NR}"
            header = {
                "nr": PRIJSLIJST_NR,
                "naam": naam,
                "geldig_vanaf": parse_datum(naam),
                "actief": True,
            }
            continue
        if i == 2:
            continue  # kolomkoppen

        artikelnr_raw = row[0]
        prijs = decimal(row[4])
        if not artikelnr_raw or prijs is None:
            continue

        try:
            artikelnr = str(int(artikelnr_raw)).zfill(9)
        except (ValueError, TypeError):
            continue

        ean = str(row[1]).strip() if len(row) > 1 and row[1] else None
        regels.append({
            "prijslijst_nr": PRIJSLIJST_NR,
            "artikelnr": artikelnr,
            "ean_code": ean,
            "omschrijving": str(row[2]).strip() if row[2] else None,
            "omschrijving_2": str(row[3]).strip() if len(row) > 3 and row[3] else None,
            "prijs": prijs,
            "gewicht": decimal(row[6]) if len(row) > 6 else None,
        })

    wb.close()
    return header, regels


def fetch_bekende_artikelnrs(arts: list[str]) -> set[str]:
    """Welke van deze artikelnrs bestaan in producten (chunked IN-query)."""
    bekend: set[str] = set()
    for i in range(0, len(arts), 300):
        res = sb.table("producten").select("artikelnr").in_("artikelnr", arts[i:i + 300]).execute()
        bekend.update(r["artikelnr"] for r in res.data)
    return bekend


def backfill_orderregels(prijs_per_art: dict[str, float], apply: bool) -> int:
    """Vul prijs/korting_pct/bedrag op Hornbach EDI-orderregels (mig 308-logica)."""
    # korting_pct van de debiteur
    d = sb.table("debiteuren").select("korting_pct").eq("debiteur_nr", HORNBACH_DEBITEUR).execute()
    korting = (d.data[0].get("korting_pct") if d.data else None) or 0

    o = sb.table("orders").select("id").eq("debiteur_nr", HORNBACH_DEBITEUR).eq("bron_systeem", "edi").execute()
    order_ids = [r["id"] for r in o.data]
    if not order_ids:
        print("    geen EDI-orders voor Hornbach")
        return 0

    geraakt = 0
    for i in range(0, len(order_ids), 100):
        chunk = order_ids[i:i + 100]
        reg = sb.table("order_regels").select("id,artikelnr,orderaantal,prijs,bedrag") \
            .in_("order_id", chunk).execute()
        for r in reg.data:
            art = r["artikelnr"]
            if not art or art not in prijs_per_art:
                continue
            nieuwe_prijs = prijs_per_art[art]
            aantal = r["orderaantal"] or 1
            bedrag = round(nieuwe_prijs * aantal * (1 - korting / 100), 2)
            # Alleen aanraken bij ontbrekende of afwijkende prijs (idempotent, als mig 308)
            if r["prijs"] is None or float(r["prijs"]) != nieuwe_prijs \
               or r["bedrag"] is None or float(r["bedrag"]) == 0:
                geraakt += 1
                print(f"      regel {r['id']}: {art}  prijs {r['prijs']} -> {nieuwe_prijs}  bedrag -> {bedrag}")
                if apply:
                    sb.table("order_regels").update({
                        "prijs": nieuwe_prijs,
                        "korting_pct": korting,
                        "bedrag": bedrag,
                    }).eq("id", r["id"]).execute()
    return geraakt


def main(apply: bool) -> None:
    mode = "APPLY" if apply else "DRY-RUN"
    print(f"=== Hornbach-prijslijst {PRIJSLIJST_NR} import [{mode}] ===\n")

    if not EXCEL_PATH.exists():
        print(f"ERROR: {EXCEL_PATH} niet gevonden")
        sys.exit(1)

    # ── Stap 1+2: header + regels ──────────────────────────────────
    header, regels = parse_excel()
    print(f"── Stap 1: header ──\n  {header}\n")

    arts = [r["artikelnr"] for r in regels]
    bekend = fetch_bekende_artikelnrs(arts)
    te_importeren = [r for r in regels if r["artikelnr"] in bekend]
    overgeslagen = [r for r in regels if r["artikelnr"] not in bekend]

    print(f"── Stap 2: regels ──")
    print(f"  {len(regels)} regels in Excel; {len(te_importeren)} importeren, "
          f"{len(overgeslagen)} overgeslagen (artikelnr niet in producten)")
    for r in overgeslagen[:10]:
        print(f"    skip: {r['artikelnr']}  {r['omschrijving']}")
    if len(overgeslagen) > 10:
        print(f"    ... en {len(overgeslagen) - 10} meer")

    if apply:
        sb.table("prijslijst_headers").upsert(header, on_conflict="nr").execute()
        if te_importeren:
            upsert_batch(sb, "prijslijst_regels", te_importeren, on_conflict="prijslijst_nr,artikelnr")
        print("  -> header + regels opgeslagen")

    # ── Stap 3: debiteur koppelen ──────────────────────────────────
    print(f"\n── Stap 3: debiteur {HORNBACH_DEBITEUR} koppelen aan {PRIJSLIJST_NR} ──")
    cur = sb.table("debiteuren").select("debiteur_nr,naam,prijslijst_nr") \
        .eq("debiteur_nr", HORNBACH_DEBITEUR).execute()
    if not cur.data:
        print(f"  WAARSCHUWING: debiteur {HORNBACH_DEBITEUR} niet gevonden!")
    else:
        huidig = cur.data[0].get("prijslijst_nr")
        print(f"  {cur.data[0]['naam']}: huidige prijslijst_nr={huidig!r} -> {PRIJSLIJST_NR!r}")
        if apply and huidig != PRIJSLIJST_NR:
            sb.table("debiteuren").update({"prijslijst_nr": PRIJSLIJST_NR}) \
                .eq("debiteur_nr", HORNBACH_DEBITEUR).execute()
            print("  -> gekoppeld")

    # ── Stap 4: backfill orderregels ───────────────────────────────
    print(f"\n── Stap 4: backfill EDI-orderregels (mig 308-logica) ──")
    prijs_per_art = {r["artikelnr"]: r["prijs"] for r in te_importeren}
    geraakt = backfill_orderregels(prijs_per_art, apply)
    print(f"  {geraakt} orderregel(s) {'bijgewerkt' if apply else 'zou(den) worden bijgewerkt'}")

    print(f"\n=== Samenvatting [{mode}] ===")
    print(f"  Header:              {PRIJSLIJST_NR}  '{header['naam']}'")
    print(f"  Regels geïmporteerd: {len(te_importeren)}  (overgeslagen: {len(overgeslagen)})")
    print(f"  Debiteur gekoppeld:  {HORNBACH_DEBITEUR}")
    print(f"  Orderregels backfill:{geraakt}")
    if not apply:
        print("\n  Gebruik --apply om echt uit te voeren.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    main(apply=args.apply)
