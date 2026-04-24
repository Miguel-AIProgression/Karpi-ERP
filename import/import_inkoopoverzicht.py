"""
Eenmalige import van Inkoopoverzicht.xlsx (openstaande inkooporderregels) naar
de tabellen leveranciers, inkooporders en inkooporder_regels.

Scope: alleen regels met Status in {0,1} en Te leveren > 0.
Gebruik het Excel-bestand uit de root van de repo (Inkoopoverzicht.xlsx).

Draai standaard in dry-run:  python import_inkoopoverzicht.py
Schrijf wijzigingen:          python import_inkoopoverzicht.py --apply
Met custom pad:              python import_inkoopoverzicht.py --file /pad/naar/Inkoopoverzicht.xlsx
"""

import argparse
import re
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from supabase import create_client

from config import SUPABASE_KEY, SUPABASE_URL, BASE_DIR


DEFAULT_FILE = BASE_DIR / "Inkoopoverzicht.xlsx"

# Status-codes uit Excel die we behandelen als 'nog geldig'
GELDIGE_EXCEL_STATUSSEN = {0, 1}

# Leverweek-jaarbereik om dummy-datums ('01/2049, '50/2017) uit te filteren
MIN_LEVERWEEK_JAAR = 2024
MAX_LEVERWEEK_JAAR = 2030

# Leverancier-nummers die we uitsluiten omdat het interne 'orders' zijn, geen
# inkoop bij een externe partij (bv. Team snijtafel = eigen snijdienst).
UITGESLOTEN_LEVERANCIERS = {20010}


def _clean(v):
    if v is None:
        return None
    if isinstance(v, float) and np.isnan(v):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    return v


def parse_leverweek(leverweek):
    """Parse Excel-leverweek in format "NN/YYYY" (met optionele apostrof-prefix)
    naar de maandag van die ISO-week. Geeft None voor ongeldige/verdachte weken.
    """
    if leverweek is None or (isinstance(leverweek, float) and pd.isna(leverweek)):
        return None
    s = str(leverweek).strip().lstrip("'").strip()
    m = re.match(r"^(\d{1,2})/(\d{4})$", s)
    if not m:
        return None
    week = int(m.group(1))
    jaar = int(m.group(2))
    if week < 1 or week > 53:
        return None
    if jaar < MIN_LEVERWEEK_JAAR or jaar > MAX_LEVERWEEK_JAAR:
        return None
    try:
        return date.fromisocalendar(jaar, week, 1)
    except ValueError:
        return None


def laad_inkoop(path):
    print(f"Lees {path}...")
    df = pd.read_excel(path, sheet_name="Inkoopoverzicht")
    print(f"  Totaal regels in Excel: {len(df)}")

    df["_status"] = pd.to_numeric(df["Status"], errors="coerce").fillna(-1).astype(int)
    df["_besteld"] = pd.to_numeric(df["Besteld"], errors="coerce").fillna(0)
    df["_geleverd"] = pd.to_numeric(df["Geleverd"], errors="coerce").fillna(0)
    df["_te_lev"] = pd.to_numeric(df["Te leveren"], errors="coerce").fillna(0)

    open_df = df[
        df["_status"].isin(GELDIGE_EXCEL_STATUSSEN) & (df["_te_lev"] > 0)
    ].copy()

    # Filter uitgesloten leveranciers (bv. Team snijtafel = interne orders)
    voor_filter = len(open_df)
    open_df = open_df[~open_df["Leverancier nr."].isin(UITGESLOTEN_LEVERANCIERS)].copy()
    na_filter = len(open_df)
    if voor_filter != na_filter:
        print(
            f"  Uitgesloten interne leveranciers ({UITGESLOTEN_LEVERANCIERS}): "
            f"{voor_filter - na_filter} regels verwijderd"
        )

    print(f"  Openstaande regels (Status in {{0,1}} & Te leveren > 0): {len(open_df)}")
    print(f"  Unieke orders: {open_df['Ordernummer'].nunique()}")
    print(f"  Unieke artikelen: {open_df['Artikelnummer'].nunique()}")
    print(f"  Unieke leveranciers: {open_df['Leverancier nr.'].nunique()}")
    print(f"  Totaal nog te leveren (m + stuks): {open_df['_te_lev'].sum():.1f}")
    return open_df


def upsert_leveranciers(supabase, df, apply):
    leveranciers = (
        df[["Leverancier nr.", "Naam", "Woonplaats"]]
        .dropna(subset=["Leverancier nr.", "Naam"])
        .drop_duplicates(subset=["Leverancier nr."])
        .sort_values("Leverancier nr.")
    )
    print(f"\n[Leveranciers] {len(leveranciers)} unieke leveranciers te upserten")

    payload = []
    for _, row in leveranciers.iterrows():
        payload.append(
            {
                "leverancier_nr": int(row["Leverancier nr."]),
                "naam": str(row["Naam"]).strip(),
                "woonplaats": _clean(row["Woonplaats"]),
                "actief": True,
            }
        )

    if not apply:
        print(f"  [dry-run] zou upsert aanroepen voor {len(payload)} leveranciers")
        return {row["leverancier_nr"]: None for row in payload}

    # Select bestaande leveranciers om te zien welke al in DB staan
    alle_nrs = [p["leverancier_nr"] for p in payload]
    resp = (
        supabase.table("leveranciers")
        .select("id, leverancier_nr")
        .in_("leverancier_nr", alle_nrs)
        .execute()
    )
    bestaand = {row["leverancier_nr"]: row["id"] for row in (resp.data or [])}

    # Insert nieuwe records
    nieuwe_payload = [p for p in payload if p["leverancier_nr"] not in bestaand]
    if nieuwe_payload:
        resp2 = supabase.table("leveranciers").insert(nieuwe_payload).execute()
        for row in resp2.data or []:
            bestaand[row["leverancier_nr"]] = row["id"]

    # Update naam/woonplaats voor rijen die al bestonden (niet voor de zojuist inserted)
    nieuwe_nrs = {p["leverancier_nr"] for p in nieuwe_payload}
    for p in payload:
        if p["leverancier_nr"] in bestaand and p["leverancier_nr"] not in nieuwe_nrs:
            supabase.table("leveranciers").update(
                {"naam": p["naam"], "woonplaats": p["woonplaats"]}
            ).eq("leverancier_nr", p["leverancier_nr"]).execute()

    print(f"  [apply] {len(bestaand)} leveranciers in DB ({len(nieuwe_payload)} nieuw)")
    return bestaand


def bepaal_order_status(regels):
    """Afleiden van inkooporder_status op basis van Excel-regels."""
    totaal_besteld = regels["_besteld"].sum()
    totaal_geleverd = regels["_geleverd"].sum()
    totaal_open = regels["_te_lev"].sum()
    if totaal_open <= 0:
        return "Ontvangen"
    if totaal_geleverd > 0 and totaal_besteld > 0:
        return "Deels ontvangen"
    return "Besteld"


def bouw_inkooporder_nr(ordernummer):
    # Volg conventie: INK-<jaar>-<zeropadded>; voor historische orders gebruiken we
    # het jaar uit het ordernummer (eerste 2 cijfers van 25xxxxxxx = 2025, 26xxxxxxx = 2026)
    s = str(int(ordernummer))
    if len(s) >= 2 and s[:2].isdigit():
        jaarprefix = int(s[:2])
        jaar = 2000 + jaarprefix
    else:
        jaar = 2026
    seq = s[-4:].zfill(4)
    return f"INK-{jaar}-{seq}"


def upsert_inkooporders(supabase, df, leverancier_map, apply):
    orders = df.groupby("Ordernummer")
    print(f"\n[Inkooporders] {len(orders)} unieke orders te upserten")

    payload = []
    for ordernummer, groep in orders:
        eerste = groep.iloc[0]
        leverancier_nr = _clean(eerste["Leverancier nr."])
        leverancier_id = leverancier_map.get(leverancier_nr) if leverancier_nr else None
        verwacht = parse_leverweek(eerste.get("Leverweek"))
        besteldatum = eerste.get("Datum")
        if pd.notna(besteldatum):
            besteldatum = pd.Timestamp(besteldatum).date().isoformat()
        else:
            besteldatum = None

        payload.append(
            {
                "inkooporder_nr": bouw_inkooporder_nr(ordernummer),
                "oud_inkooporder_nr": int(ordernummer),
                "leverancier_id": leverancier_id,
                "besteldatum": besteldatum,
                "leverweek": str(eerste.get("Leverweek") or "").strip().lstrip("'") or None,
                "verwacht_datum": verwacht.isoformat() if verwacht else None,
                "status": bepaal_order_status(groep),
                "bron": "import",
            }
        )

    if not apply:
        print(f"  [dry-run] zou upsert aanroepen voor {len(payload)} inkooporders")
        return {row["oud_inkooporder_nr"]: None for row in payload}

    # Select bestaande orders (op oud_inkooporder_nr, in batches)
    alle_oud = [p["oud_inkooporder_nr"] for p in payload]
    bestaand = {}
    SELECT_BATCH = 200
    for i in range(0, len(alle_oud), SELECT_BATCH):
        chunk = alle_oud[i : i + SELECT_BATCH]
        resp = (
            supabase.table("inkooporders")
            .select("id, oud_inkooporder_nr")
            .in_("oud_inkooporder_nr", chunk)
            .execute()
        )
        for row in resp.data or []:
            bestaand[row["oud_inkooporder_nr"]] = row["id"]

    # Insert nieuwe
    nieuwe_payload = [p for p in payload if p["oud_inkooporder_nr"] not in bestaand]
    INSERT_BATCH = 500
    for i in range(0, len(nieuwe_payload), INSERT_BATCH):
        chunk = nieuwe_payload[i : i + INSERT_BATCH]
        resp = supabase.table("inkooporders").insert(chunk).execute()
        for row in resp.data or []:
            bestaand[row["oud_inkooporder_nr"]] = row["id"]

    # Update bestaande (status / verwacht_datum kunnen veranderd zijn)
    nieuwe_nrs = {p["oud_inkooporder_nr"] for p in nieuwe_payload}
    for p in payload:
        if p["oud_inkooporder_nr"] in bestaand and p["oud_inkooporder_nr"] not in nieuwe_nrs:
            supabase.table("inkooporders").update(
                {
                    "status": p["status"],
                    "verwacht_datum": p["verwacht_datum"],
                    "leverweek": p["leverweek"],
                }
            ).eq("oud_inkooporder_nr", p["oud_inkooporder_nr"]).execute()

    print(f"  [apply] {len(bestaand)} inkooporders in DB ({len(nieuwe_payload)} nieuw)")
    return bestaand


def upsert_regels(supabase, df, order_map, product_info, apply):
    print(f"\n[Inkooporder_regels] {len(df)} regels te upserten")

    payload = []
    onbekend = 0
    eenheid_telling = {"m": 0, "stuks": 0}
    for _, row in df.iterrows():
        ordernummer = int(row["Ordernummer"])
        inkooporder_id = order_map.get(ordernummer)
        if inkooporder_id is None and apply:
            print(f"  WARNING: geen inkooporder_id voor ordernummer {ordernummer}")
            continue

        artikelnummer = _clean(row["Artikelnummer"])
        artikelnr_str = str(int(artikelnummer)) if artikelnummer is not None else None
        product_type = product_info.get(artikelnr_str) if artikelnr_str else None
        if artikelnr_str and product_type is None and apply:
            # Artikelnr niet gevonden in DB -> NULL om FK-fout te voorkomen
            artikelnr_str = None
            onbekend += 1

        eenheid = eenheid_voor_regel(product_type, row.get("Omschrijving 1"))
        eenheid_telling[eenheid] = eenheid_telling.get(eenheid, 0) + 1

        payload.append(
            {
                "inkooporder_id": inkooporder_id,
                "regelnummer": int(row["Regel"]) if pd.notna(row["Regel"]) else 1,
                "artikelnr": artikelnr_str,
                "artikel_omschrijving": _clean(row.get("Omschrijving 1")),
                "karpi_code": _clean(row.get("Omschrijving")),
                "inkoopprijs_eur": _clean(row.get("Inkoopprijs EUR.")),
                "besteld_m": float(row["_besteld"]),
                "geleverd_m": float(row["_geleverd"]),
                "te_leveren_m": float(row["_te_lev"]),
                "eenheid": eenheid,
                "status_excel": int(row["_status"]),
            }
        )

    print(f"  Regels met onbekend artikel (-> artikelnr NULL): {onbekend}")
    print(f"  Eenheden: m={eenheid_telling['m']}  stuks={eenheid_telling['stuks']}")

    if not apply:
        print(f"  [dry-run] zou upsert aanroepen voor {len(payload)} regels")
        return 0

    # Strategie: per inkooporder eerst alle regels verwijderen en dan opnieuw insert.
    # Veiliger dan per-regel upsert zonder ON CONFLICT support, en voor import OK
    # omdat historische regels altijd herladen mogen worden. (Inserts zijn
    # idempotent want we draaien voor `bron='import'` orders.)
    orders_in_payload = list({p["inkooporder_id"] for p in payload if p["inkooporder_id"]})
    DELETE_BATCH = 100
    for i in range(0, len(orders_in_payload), DELETE_BATCH):
        chunk = orders_in_payload[i : i + DELETE_BATCH]
        supabase.table("inkooporder_regels").delete().in_("inkooporder_id", chunk).execute()

    INSERT_BATCH = 500
    total = 0
    for i in range(0, len(payload), INSERT_BATCH):
        chunk = payload[i : i + INSERT_BATCH]
        resp = supabase.table("inkooporder_regels").insert(chunk).execute()
        total += len(resp.data or [])
    print(f"  [apply] {total} regels in DB")
    return total


def rapport_per_leverancier(df):
    print("\n[Rapport] Top 10 leveranciers (openstaande meters):")
    agg = (
        df.groupby(["Leverancier nr.", "Naam"])
        .agg(meters=("_te_lev", "sum"), orders=("Ordernummer", "nunique"))
        .sort_values("meters", ascending=False)
        .head(10)
    )
    for (nr, naam), row in agg.iterrows():
        print(f"  {int(nr):>6}  {naam:<35}  {row['meters']:>10.1f} m  ({int(row['orders'])} orders)")


def fetch_product_info(supabase, artikelnrs, apply):
    """Haal per artikelnr de product_type op (voor eenheid-afleiding).
    Returnt dict: artikelnr_str -> product_type ('rol', 'vast', 'staaltje', 'overig', None).
    Onbekende artikelen zitten niet in de dict.
    """
    if not apply:
        return {}
    bekend = {}
    artikellist = sorted(set(str(int(a)) for a in artikelnrs if a is not None))
    BATCH = 500
    for i in range(0, len(artikellist), BATCH):
        chunk = artikellist[i : i + BATCH]
        resp = (
            supabase.table("producten")
            .select("artikelnr, product_type")
            .in_("artikelnr", chunk)
            .execute()
        )
        for row in resp.data or []:
            bekend[row["artikelnr"]] = row.get("product_type")
    print(f"  Bekende artikelen in DB: {len(bekend)} / {len(artikellist)}")
    return bekend


def eenheid_voor_regel(product_type, omschrijving_1):
    """Bepaal eenheid 'm' of 'stuks' per regel.
    Prio 1: product_type in DB ('rol' -> 'm', anders -> 'stuks').
    Fallback (onbekend product): detect op Excel-omschrijving pattern.
    """
    if product_type == "rol":
        return "m"
    if product_type in ("vast", "staaltje", "overig"):
        return "stuks"
    # Fallback: BREED in omschrijving = rol (meters), CA: = vast (stuks)
    s = str(omschrijving_1 or "").upper()
    if "BREED" in s:
        return "m"
    if "CA:" in s or "CA." in s:
        return "stuks"
    # Default: m (veilig voor rol-achtige import)
    return "m"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Schrijf echt naar DB")
    parser.add_argument("--file", default=str(DEFAULT_FILE), help="Pad naar Inkoopoverzicht.xlsx")
    args = parser.parse_args()

    path = Path(args.file)
    if not path.exists():
        print(f"FOUT: bestand niet gevonden: {path}", file=sys.stderr)
        sys.exit(1)

    df = laad_inkoop(path)

    if args.apply and (not SUPABASE_URL or not SUPABASE_KEY):
        print("FOUT: SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY ontbreekt in import/.env", file=sys.stderr)
        sys.exit(2)

    supabase = None
    if args.apply:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    artikelnrs = df["Artikelnummer"].dropna().unique()
    product_info = fetch_product_info(supabase, artikelnrs, args.apply)

    leverancier_map = upsert_leveranciers(supabase, df, args.apply)
    order_map = upsert_inkooporders(supabase, df, leverancier_map, args.apply)
    upsert_regels(supabase, df, order_map, product_info, args.apply)

    rapport_per_leverancier(df)

    if not args.apply:
        print("\n-- dry-run: er is niets naar de database geschreven. Gebruik --apply om te persisteren. --")


if __name__ == "__main__":
    main()
