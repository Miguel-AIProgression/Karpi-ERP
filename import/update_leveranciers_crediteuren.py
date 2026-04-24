"""
Verrijk bestaande leveranciers met crediteuren-info uit 'Crediteuren uitgebreid.xlsx'.

Matcht op genormaliseerde naam (uppercase, zonder spaties/punctuatie, met
strippen van trailing "(x)"-suffixen). Updatet alleen leveranciers die al
in de DB staan — voegt geen nieuwe toe.

Dry-run default: python update_leveranciers_crediteuren.py
Apply:           python update_leveranciers_crediteuren.py --apply
"""
import argparse
import re
import sys
from pathlib import Path

import pandas as pd
from supabase import create_client

from config import SUPABASE_KEY, SUPABASE_URL, BASE_DIR


DEFAULT_FILE = BASE_DIR / "Crediteuren uitgebreid.xlsx"


def normalize_naam(s):
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    s = str(s).upper().strip()
    s = re.sub(r"\s*\([^)]*\)\s*$", "", s)  # trailing "(4)" weg
    s = re.sub(r"[^A-Z0-9]", "", s)  # alleen alfanum
    return s


def parse_adres(raw):
    """Probeer NL-adres "Straat 12, 1234 AB PLAATS" → (adres, postcode, plaats).
    Voor niet-NL adressen: alles blijft in adres, postcode/plaats = None.
    """
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None, None, None
    s = str(raw).strip()
    # NL-patroon: "..., NNNN XX PLAATS"
    m = re.match(r"^(.+),\s*(\d{4}\s*[A-Z]{2})\s+(.+)$", s)
    if m:
        adres = m.group(1).strip()
        postcode = re.sub(r"\s+", " ", m.group(2)).strip()
        plaats = m.group(3).strip()
        return adres, postcode, plaats
    # Fallback: alles in adres
    return s, None, None


def bouw_update_payload(row, huidige):
    """Bouw dict met velden die we willen updaten, alleen als ze nieuwe info bevatten.
    Overschrijft huidige waarde alleen als die leeg/None is, om handmatige invoer niet te verpesten.
    """
    updates = {}
    adres, postcode, woonplaats = parse_adres(row.get("Adres"))

    if adres and not huidige.get("adres"):
        updates["adres"] = adres
    if postcode and not huidige.get("postcode"):
        updates["postcode"] = postcode
    if woonplaats and not huidige.get("woonplaats"):
        updates["woonplaats"] = woonplaats

    land = row.get("Land")
    if isinstance(land, str) and land.strip() and not huidige.get("land"):
        updates["land"] = land.strip()
    elif postcode and not huidige.get("land"):
        # Afleiden uit NL-postcode
        updates["land"] = "NL"

    mail = row.get("Mail werk")
    if isinstance(mail, str) and "@" in mail and not huidige.get("email"):
        updates["email"] = mail.strip()

    tel = row.get("Telnr. werk")
    if isinstance(tel, str) and tel.strip() and not huidige.get("telefoon"):
        updates["telefoon"] = tel.strip()
    elif tel is not None and not isinstance(tel, float) and not huidige.get("telefoon"):
        updates["telefoon"] = str(tel).strip()

    betaal = row.get("Betaalvoorwaarde")
    if isinstance(betaal, str) and betaal.strip() and not huidige.get("betaalconditie"):
        updates["betaalconditie"] = betaal.strip()

    return updates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Schrijf echt naar DB")
    parser.add_argument("--file", default=str(DEFAULT_FILE))
    args = parser.parse_args()

    path = Path(args.file)
    if not path.exists():
        print(f"FOUT: bestand niet gevonden: {path}", file=sys.stderr)
        sys.exit(1)

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("FOUT: Supabase credentials ontbreken in import/.env", file=sys.stderr)
        sys.exit(2)

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # DB-leveranciers
    resp = supabase.table("leveranciers").select("*").execute()
    db_levs = resp.data or []
    print(f"Leveranciers in DB: {len(db_levs)}")

    db_by_norm = {normalize_naam(l["naam"]): l for l in db_levs}

    # Lees crediteuren via calamine-engine (robuuster dan openpyxl voor dit bestand)
    df = pd.read_excel(path, engine="calamine")
    print(f"Crediteuren in Excel: {len(df)}")

    # Fuzzy match fallback: normalized prefix-match op ≥5 chars
    geupdated = 0
    gematcht = 0
    geen_update = 0
    niet_gevonden = []

    for _, row in df.iterrows():
        if pd.isna(row.get("Inkooprelatienummer")):
            continue
        ex_norm = normalize_naam(row.get("Inkooprelatie"))
        if not ex_norm:
            continue

        # Exact match
        db_lev = db_by_norm.get(ex_norm)
        # Fuzzy prefix (alleen als er nog niets gevonden is)
        if not db_lev and len(ex_norm) >= 5:
            for norm, lev in db_by_norm.items():
                if len(norm) >= 5 and (norm.startswith(ex_norm[:15]) or ex_norm.startswith(norm[:15])):
                    db_lev = lev
                    break
        if not db_lev:
            continue

        gematcht += 1
        updates = bouw_update_payload(row, db_lev)
        if not updates:
            geen_update += 1
            continue

        print(f"  {db_lev['leverancier_nr']:>6}  {db_lev['naam']:<32}  -> {list(updates.keys())}")

        if args.apply:
            supabase.table("leveranciers").update(updates).eq("id", db_lev["id"]).execute()
            geupdated += 1

    # Samenvatting
    print(f"\nGematcht: {gematcht}")
    if args.apply:
        print(f"Geupdatet: {geupdated}")
    else:
        print(f"Zou geupdatet hebben: {gematcht - geen_update}")
    print(f"Al compleet (geen update nodig): {geen_update}")

    # Niet-gematchte DB-leveranciers (voor de gebruiker)
    gematchte_namen = set()
    for _, row in df.iterrows():
        ex_norm = normalize_naam(row.get("Inkooprelatie"))
        if ex_norm in db_by_norm:
            gematchte_namen.add(ex_norm)
            continue
        for norm in db_by_norm:
            if len(norm) >= 5 and len(ex_norm) >= 5 and (
                norm.startswith(ex_norm[:15]) or ex_norm.startswith(norm[:15])
            ):
                gematchte_namen.add(norm)
                break

    niet_match_in_db = [l for n, l in db_by_norm.items() if n not in gematchte_namen]
    if niet_match_in_db:
        print(f"\nDB-leveranciers zonder crediteur-match (geen update):")
        for l in sorted(niet_match_in_db, key=lambda x: x.get("leverancier_nr") or 0):
            print(f"  {l['leverancier_nr']:>6}  {l['naam']}")

    if not args.apply:
        print("\n-- dry-run: niets geschreven. Gebruik --apply. --")


if __name__ == "__main__":
    main()
