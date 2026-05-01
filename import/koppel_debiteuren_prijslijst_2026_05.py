"""
RugFlow ERP — Koppel debiteuren aan nieuwe prijslijsten (mei 2026).

Bron: twee Excel-exports uit het oude systeem die per debiteur aangeven
op welke prijslijst hij hoort. De bestandsnamen verwijzen naar de OUDE
prijslijst (0150 / 0151); we mappen ze naar de NIEUWE prijslijst:

    klantenbestand prijslijst 150.xlsx  ->  prijslijst_nr = '0210'
    klantenbestand prijslijst 151.xlsx  ->  prijslijst_nr = '0211'

Het script:
  - Leest beide xlsx-bestanden uit de project-root.
  - Slaat debiteuren over die niet (meer) in de database staan.
  - Slaat debiteuren over die al op de doel-prijslijst staan (idempotent).
  - Werkt de overige debiteuren bij in batches.
"""
import io
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import openpyxl
from supabase import create_client

from config import BASE_DIR, SUPABASE_KEY, SUPABASE_URL

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Supabase URL/Key niet gevonden. Check import/.env")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

MAPPING = [
    (BASE_DIR / "klantenbestand prijslijst 150.xlsx", "0210"),
    (BASE_DIR / "klantenbestand prijslijst 151.xlsx", "0211"),
]


def read_debiteur_nrs(xlsx_path: Path) -> list[int]:
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb.active
    debs: list[int] = []
    header_seen = False
    for row in ws.iter_rows(values_only=True):
        if not row:
            continue
        if not header_seen:
            if row[0] == "Debiteur":
                header_seen = True
            continue
        v = row[0]
        if v is None:
            continue
        try:
            debs.append(int(v))
        except (TypeError, ValueError):
            continue
    return debs


def fetch_huidige(debiteur_nrs: list[int]) -> dict[int, str | None]:
    huidig: dict[int, str | None] = {}
    page = 500
    for i in range(0, len(debiteur_nrs), page):
        chunk = debiteur_nrs[i : i + page]
        res = (
            sb.table("debiteuren")
            .select("debiteur_nr,prijslijst_nr")
            .in_("debiteur_nr", chunk)
            .execute()
        )
        for r in res.data:
            huidig[r["debiteur_nr"]] = r["prijslijst_nr"]
    return huidig


def update_in_batches(debiteur_nrs: list[int], doel_nr: str) -> None:
    page = 200
    total = len(debiteur_nrs)
    for i in range(0, total, page):
        chunk = debiteur_nrs[i : i + page]
        sb.table("debiteuren").update({"prijslijst_nr": doel_nr}).in_(
            "debiteur_nr", chunk
        ).execute()
        print(f"    bijgewerkt {min(i + page, total)}/{total}")


def main() -> None:
    # Verifieer dat de doel-prijslijsten bestaan
    doelen = sorted({doel for _, doel in MAPPING})
    res = sb.table("prijslijst_headers").select("nr,naam").in_("nr", doelen).execute()
    bekend = {r["nr"]: r["naam"] for r in res.data}
    ontbreekt = [d for d in doelen if d not in bekend]
    if ontbreekt:
        print(f"ERROR: prijslijst_headers ontbreekt voor: {ontbreekt}")
        sys.exit(1)
    for d in doelen:
        print(f"Doel-prijslijst {d}: {bekend[d]}")
    print()

    grand_updated = 0
    grand_already = 0
    grand_missing: list[tuple[int, str]] = []

    for xlsx, doel_nr in MAPPING:
        if not xlsx.exists():
            print(f"OVERSLAAN: bestand niet gevonden: {xlsx}")
            continue
        print(f"=== {xlsx.name}  ->  {doel_nr} ===")
        debs = read_debiteur_nrs(xlsx)
        unieke = sorted(set(debs))
        print(f"  rijen in xlsx: {len(debs)}  unieke debiteuren: {len(unieke)}")

        huidig = fetch_huidige(unieke)
        bestaand = [d for d in unieke if d in huidig]
        ontbrekend = [d for d in unieke if d not in huidig]
        al_goed = [d for d in bestaand if huidig[d] == doel_nr]
        te_updaten = [d for d in bestaand if huidig[d] != doel_nr]

        print(f"  bestaand in DB: {len(bestaand)}")
        print(f"  ontbrekend in DB (overgeslagen): {len(ontbrekend)}")
        for nr in ontbrekend:
            grand_missing.append((nr, xlsx.name))
        print(f"  al op {doel_nr}: {len(al_goed)}")
        print(f"  te updaten: {len(te_updaten)}")

        if te_updaten:
            update_in_batches(te_updaten, doel_nr)
            grand_updated += len(te_updaten)
        grand_already += len(al_goed)
        print()

    print("=== Samenvatting ===")
    print(f"  Bijgewerkt:        {grand_updated}")
    print(f"  Al correct:        {grand_already}")
    print(f"  Ontbrekend in DB:  {len(grand_missing)}")
    for nr, src in grand_missing:
        print(f"    - {nr}  (uit {src})")


if __name__ == "__main__":
    main()
