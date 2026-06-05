"""
Import prijslijst 0149 (Hornbach per 01.08.2022) en:
  1. Laad header + regels
  2. Koppel debiteur 361208 aan prijslijst 0149
  3. Herprijst alle open Hornbach-orders (status niet Verzonden/Geannuleerd):
     - prijs per regel  → nieuwe prijs uit prijslijst 0149
     - bedrag           → prijs × orderaantal × (1 - korting_pct/100)
     - totaal_bedrag    → SUM(bedrag) per order
     Regels waarvan het artikel NIET in 0149 staat blijven ongewijzigd (en worden gerapporteerd).
"""
import sys
import re
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import openpyxl
from supabase import create_client

sys.path.insert(0, str(Path(__file__).parent))
from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

FILE          = BASE_DIR / "prijslijst0149_a.xlsx"
PRIJSLIJST_NR = "0149"
DEBITEUR_NR   = 361208
OPEN_STATUSSEN = {'Actief', 'Wacht op voorraad', 'Wacht op inkoop', 'Klaar voor picken',
                  'Klaar voor verzending', 'In behandeling'}


def upsert_batch(table, records, batch_size=500, on_conflict=None):
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        kwargs = {"on_conflict": on_conflict} if on_conflict else {}
        sb.table(table).upsert(batch, **kwargs).execute()
    print(f"  {table}: {len(records)} rijen")


def fetch_all_artikelnrs():
    rows, offset = [], 0
    while True:
        res = sb.table("producten").select("artikelnr").range(offset, offset + 999).execute()
        rows.extend(res.data)
        if len(res.data) < 1000:
            break
        offset += 1000
    return {r["artikelnr"] for r in rows}


def main():
    # ------------------------------------------------------------------
    # 1. Lees Excel
    # ------------------------------------------------------------------
    print("=== Import prijslijst 0149 (Hornbach) ===\n")
    wb = openpyxl.load_workbook(FILE, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    meta = rows[1]
    naam = str(meta[2]).strip() if meta[2] else "HORNBACH PER 01.08.2022"
    geldig_m = re.search(r'(\d{1,2})[\.\-](\d{1,2})[\.\-](\d{4})', naam)
    if geldig_m:
        geldig_vanaf = f"{geldig_m.group(3)}-{geldig_m.group(2).zfill(2)}-{geldig_m.group(1).zfill(2)}"
    else:
        geldig_vanaf = "2022-08-01"

    print(f"  Naam:         {naam}")
    print(f"  Geldig vanaf: {geldig_vanaf}")

    known = fetch_all_artikelnrs()

    regels, nieuwe_producten = [], []
    for row in rows[3:]:
        if not row or row[0] is None:
            continue
        try:
            artikelnr = str(int(row[0]))
        except (ValueError, TypeError):
            continue
        ean = str(int(row[1])) if row[1] is not None else None
        omschrijving   = str(row[2]).strip() if row[2] else None
        omschrijving_2 = str(row[3]).strip() if row[3] else None
        try:
            prijs = float(row[4]) if row[4] is not None else 0.0
        except (ValueError, TypeError):
            prijs = 0.0
        try:
            gewicht = float(row[6]) if len(row) > 6 and row[6] is not None else None
        except (ValueError, TypeError):
            gewicht = None

        regels.append({
            "prijslijst_nr":  PRIJSLIJST_NR,
            "artikelnr":      artikelnr,
            "omschrijving":   omschrijving,
            "omschrijving_2": omschrijving_2,
            "prijs":          prijs,
            "gewicht":        gewicht,
            "ean_code":       ean,
        })

        if artikelnr not in known:
            oms = (omschrijving or "").upper()
            if "BREED" in oms:
                ptype = "rol"
            elif "CA:" in oms:
                m = re.search(r'CA:\s*(\d+)\s*[xX]\s*(\d+)', oms)
                ptype = "staaltje" if m and int(m.group(1)) * int(m.group(2)) < 10000 else "vast"
            else:
                ptype = "overig"
            nieuwe_producten.append({
                "artikelnr":    artikelnr,
                "omschrijving": omschrijving or "Onbekend product",
                "verkoopprijs": prijs,
                "gewicht_kg":   gewicht,
                "voorraad": 0, "gereserveerd": 0, "vrije_voorraad": 0,
                "product_type": ptype,
                "actief":       True,
            })

    print(f"  {len(regels)} prijslijst-regels | {len(nieuwe_producten)} nieuwe producten\n")

    # 1a. Header
    upsert_batch("prijslijst_headers", [{
        "nr": PRIJSLIJST_NR, "naam": naam,
        "geldig_vanaf": geldig_vanaf, "actief": True,
    }], on_conflict="nr")

    # 1b. Nieuwe producten
    if nieuwe_producten:
        upsert_batch("producten", nieuwe_producten, on_conflict="artikelnr")

    # 1c. Prijsregels
    upsert_batch("prijslijst_regels", regels, on_conflict="prijslijst_nr,artikelnr")

    # Bouw prijskaart: artikelnr → prijs
    prijskaart = {r["artikelnr"]: r["prijs"] for r in regels}

    # ------------------------------------------------------------------
    # 2. Koppel debiteur
    # ------------------------------------------------------------------
    print(f"\n  Debiteur {DEBITEUR_NR} → prijslijst {PRIJSLIJST_NR} ...")
    res = sb.table("debiteuren").update({"prijslijst_nr": PRIJSLIJST_NR}) \
            .eq("debiteur_nr", DEBITEUR_NR).execute()
    naam_deb = res.data[0].get("naam", "?") if res.data else "niet gevonden"
    print(f"  ✓ {DEBITEUR_NR} ({naam_deb})")

    # ------------------------------------------------------------------
    # 3. Herprijzen open orders
    # ------------------------------------------------------------------
    print(f"\n=== Open Hornbach-orders herprijzen ===")

    orders_res = sb.table("orders").select("id,order_nr,status") \
                   .eq("debiteur_nr", DEBITEUR_NR).execute()
    open_orders = [o for o in orders_res.data if o["status"] in OPEN_STATUSSEN]
    print(f"  Open orders: {len(open_orders)}  (totaal in DB: {len(orders_res.data)})\n")

    totaal_regels_bijgewerkt = 0
    totaal_regels_niet_gevonden = []

    for order in open_orders:
        oid    = order["id"]
        onr    = order["order_nr"]
        status = order["status"]

        regels_res = sb.table("order_regels") \
                       .select("id,artikelnr,orderaantal,prijs,korting_pct,bedrag,is_maatwerk") \
                       .eq("order_id", oid).execute()

        nieuwe_totaal = 0.0
        bijgewerkt = 0

        for regel in regels_res.data:
            if regel.get("is_maatwerk"):
                # Maatwerk heeft eigen m2-prijsberekening, niet aanraken
                nieuwe_totaal += regel["bedrag"] or 0
                continue

            art = regel["artikelnr"]
            if art not in prijskaart:
                totaal_regels_niet_gevonden.append((onr, art, regel.get("bedrag", 0)))
                nieuwe_totaal += regel["bedrag"] or 0
                continue

            nieuwe_prijs = prijskaart[art]
            korting = regel.get("korting_pct") or 0.0
            nieuw_bedrag = round(nieuwe_prijs * (regel["orderaantal"] or 1) * (1 - korting / 100), 2)

            sb.table("order_regels").update({
                "prijs":  nieuwe_prijs,
                "bedrag": nieuw_bedrag,
            }).eq("id", regel["id"]).execute()

            nieuwe_totaal += nieuw_bedrag
            bijgewerkt += 1

        # Totaalbedrag op order bijwerken
        sb.table("orders").update({"totaal_bedrag": round(nieuwe_totaal, 2)}).eq("id", oid).execute()

        totaal_regels_bijgewerkt += bijgewerkt
        print(f"  ✓ {onr} [{status}]  —  {bijgewerkt} regels bijgewerkt  |  nieuw totaal: € {nieuwe_totaal:,.2f}")

    # ------------------------------------------------------------------
    # Samenvatting
    # ------------------------------------------------------------------
    print(f"\n=== KLAAR ===")
    print(f"  Prijslijst 0149 geladen:        {len(regels)} regels")
    print(f"  Debiteur gekoppeld:             {DEBITEUR_NR}")
    print(f"  Order-regels herprijsd:         {totaal_regels_bijgewerkt}")
    if totaal_regels_niet_gevonden:
        print(f"\n  ⚠ {len(totaal_regels_niet_gevonden)} regels artikel NIET in prijslijst 0149 (ongewijzigd gelaten):")
        for onr, art, bedrag in totaal_regels_niet_gevonden:
            print(f"    order {onr}  artikel {art}  bedrag € {bedrag}")


if __name__ == "__main__":
    main()
