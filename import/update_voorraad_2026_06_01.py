"""
Voorraad-update o.b.v. Voorraadlijst 01-6-2026.xls
===================================================
Tweede periodieke vrije-voorraad-update (na 29-5-2026, zie
update_voorraad_2026_05.py). Zelfde beslissingen, met EEN belangrijke
correctie: de rode-regels-uitsluitlijst GROEIT per update (union), hij
wordt NIET meer overschreven.

Waarom de union noodzakelijk is (vastgesteld 2026-06-03):
  Karpi markeert de "niet meer inladen"-artikelen progressief, alfabetisch.
    - 29-5-lijst: rode regels A (ABST..) t/m F (FADE..)  -> 2917 codes
    - 1-6-lijst : rode regels E (ETII..) t/m K (KAED..)  -> 2499 codes
  De A-D-regels zijn in het 1-6-bestand NIET meer rood. Zou je de lijst
  overschrijven, dan verlies je die eerdere uitsluitingen. Daarom:
    exclude = bestaande voorraad_uitsluiten.csv  UNION  nieuwe rode regels.

Beslissingen (ongewijzigd t.o.v. 2026-05-31):
  - Scope: ALLEEN product_type='vast'. Staaltje/rol/overig NIET aangeraakt.
  - Sleutel: kolom 'Artikelnr' -> producten.artikelnr (PK).
  - Waarde: kolom 'Vrije voorraad' (kolom H). Backorder/gereserveerd op 0.
  - MAATWERK-regels (Karpi-code bevat 'MAATWERK') uitgesloten.
  - Uitgesloten artikelen (rood nu OF eerder rood): voorraad -> 0.
  - 'vast' in DB maar niet in actieve lijst: voorraad -> 0.
  - Artikelen in lijst maar niet in DB: alleen echte vaste maten met
    vrije voorraad > 0 aanmaken (^[A-Z]{3,4}\\d{2}XX, incl. ...RND).
    Broadloom/rol (geen XX-scheiding) worden gelogd + overgeslagen.
  - Negatieve vrije voorraad -> clampen naar 0.

Gebruik:
  python update_voorraad_2026_06_01.py            # DRY-RUN (rapport, geen DB)
  python update_voorraad_2026_06_01.py --commit   # schrijft naar Supabase
"""
import csv
import re
import sys
from collections import defaultdict

import xlrd
import pandas as pd
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

VOORRAADLIJST = BASE_DIR / "Voorraadlijst 01-6-2026.xls"
UITSLUITEN_CSV = BASE_DIR / "import" / "voorraad_uitsluiten.csv"
RAPPORT_DIR = BASE_DIR / "import" / "rapporten"
RAPPORT = RAPPORT_DIR / "voorraad_update_2026_06_01.xlsx"

COMMIT = "--commit" in sys.argv

# Kolom-indices in de .xls (header op rij index 1, data vanaf rij 2)
COL_ARTNR, COL_KARPI, COL_OMS = 0, 1, 2
COL_VRIJE_VOORRAAD = 7

_QC_RE = re.compile(r"^([A-Z]{3,4})(\d{2})")
_VAST_RE = re.compile(r"^[A-Z]{3,4}\d{2}XX")
_MAAT_RECHT_RE = re.compile(r"XX(\d{3})(\d{3})$")
_MAAT_ROND_RE = re.compile(r"XX(\d{3})RND$")


def is_vaste_maat(karpi_code: str) -> bool:
    return bool(_VAST_RE.match(karpi_code or ""))


def _afgeleide_codes(karpi_code: str):
    m = _QC_RE.match(karpi_code or "")
    if not m:
        return None, None, None
    kwal, kleur = m.group(1), m.group(2)
    return kwal, kleur, f"{kwal}_{kleur}"


def _afmeting(karpi_code: str):
    code = karpi_code or ""
    m = _MAAT_RECHT_RE.search(code)
    if m:
        return int(m.group(1)), int(m.group(2)), None
    m = _MAAT_ROND_RE.search(code)
    if m:
        d = int(m.group(1))
        return d, d, "rond"
    return None, None, None


def lees_lijst():
    """Lees de .xls met opmaak -> lijst van rij-dicts incl. is_red."""
    wb = xlrd.open_workbook(str(VOORRAADLIJST), formatting_info=True)
    sh = wb.sheet_by_index(0)

    def is_red(r):
        cell = sh.cell(r, COL_ARTNR)
        xf = wb.xf_list[cell.xf_index]
        font = wb.font_list[xf.font_index]
        return wb.colour_map.get(font.colour_index) == (255, 0, 0)

    def num(v):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0

    rijen = []
    for r in range(2, sh.nrows):
        artnr = str(sh.cell(r, COL_ARTNR).value).strip()
        karpi = str(sh.cell(r, COL_KARPI).value).strip()
        if not artnr and not karpi:
            continue
        if artnr.endswith(".0"):
            artnr = artnr[:-2]
        rijen.append({
            "artikelnr": artnr,
            "karpi_code": karpi,
            "omschrijving": str(sh.cell(r, COL_OMS).value).strip(),
            "vrije_voorraad": num(sh.cell(r, COL_VRIJE_VOORRAAD).value),
            "is_red": is_red(r),
            "is_maatwerk": "MAATWERK" in karpi.upper(),
        })
    return rijen


def lees_bestaande_uitsluitlijst():
    """artikelnr -> {artikelnr, karpi_code, omschrijving} uit de skip-lijst."""
    out = {}
    if not UITSLUITEN_CSV.exists():
        return out
    with open(UITSLUITEN_CSV, encoding="utf-8") as f:
        rd = csv.reader(f, delimiter=";")
        header = next(rd, None)
        for row in rd:
            if not row or not row[0].strip():
                continue
            artnr = row[0].strip()
            out[artnr] = {
                "artikelnr": artnr,
                "karpi_code": (row[1].strip() if len(row) > 1 else ""),
                "omschrijving": (row[2].strip() if len(row) > 2 else ""),
            }
    return out


def laad_db_producten(sb):
    """artikelnr -> (product_type, voorraad) voor alle producten (paginated)."""
    out = {}
    start = 0
    while True:
        r = (sb.table("producten")
             .select("artikelnr,product_type,voorraad")
             .range(start, start + 999).execute())
        if not r.data:
            break
        for x in r.data:
            out[str(x["artikelnr"])] = (x["product_type"], x["voorraad"] or 0)
        if len(r.data) < 1000:
            break
        start += 1000
    return out


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Supabase URL/Key ontbreekt (import/.env)")
        sys.exit(1)
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("=" * 64)
    print(f"VOORRAAD-UPDATE 01-6-2026  ({'COMMIT' if COMMIT else 'DRY-RUN'})")
    print("=" * 64)

    rijen = lees_lijst()
    print(f"Lijst gelezen: {len(rijen)} data-rijen")

    # --- Uitsluitlijst: UNION van bestaande + nieuwe rode regels ---
    bestaand = lees_bestaande_uitsluitlijst()
    nieuwe_rode = {
        x["artikelnr"]: {
            "artikelnr": x["artikelnr"], "karpi_code": x["karpi_code"],
            "omschrijving": x["omschrijving"],
        } for x in rijen if x["is_red"]
    }
    nieuw_rood_extra = [a for a in nieuwe_rode if a not in bestaand]

    exclude = dict(bestaand)        # behoud bestaande entries
    exclude.update(nieuwe_rode)     # voeg nieuwe rode toe (overschrijft dezelfde key)
    exclude_artnr = set(exclude)

    print(f"  bestaande uitsluitlijst : {len(bestaand)}")
    print(f"  rood in 01-06           : {len(nieuwe_rode)}")
    print(f"  nieuw rood toegevoegd   : {len(nieuw_rood_extra)}")
    print(f"  uitsluitlijst NA union  : {len(exclude_artnr)}")

    # Actieve regels: niet-uitgesloten en niet-MAATWERK. Bij dubbele -> eerste.
    actief = {}
    for x in rijen:
        if x["artikelnr"] in exclude_artnr or x["is_maatwerk"]:
            continue
        actief.setdefault(x["artikelnr"], x)

    db = laad_db_producten(sb)
    vast = {a for a, (t, _) in db.items() if t == "vast"}

    # --- Acties bepalen (alleen product_type='vast') ---
    updates = []
    op_0_niet_in_lijst = []
    op_0_uitgesloten = []
    for artnr in vast:
        if artnr in exclude_artnr:
            op_0_uitgesloten.append(artnr)
        elif artnr in actief:
            updates.append((artnr, max(0, actief[artnr]["vrije_voorraad"])))
        else:
            op_0_niet_in_lijst.append(artnr)

    # Nieuwe artikelen: in actieve lijst, niet in DB. Alleen vaste maten met vrd>0.
    nieuw_alle = [x for a, x in actief.items() if a not in db]
    nieuw_vast_alle = [x for x in nieuw_alle if is_vaste_maat(x["karpi_code"])]
    nieuw = [x for x in nieuw_vast_alle if x["vrije_voorraad"] > 0]
    nieuw_vast_leeg = [x for x in nieuw_vast_alle if x["vrije_voorraad"] <= 0]
    nieuw_broadloom = [x for x in nieuw_alle if not is_vaste_maat(x["karpi_code"])]

    skip_types = {"staaltje": 0, "rol": 0, "overig": 0}
    for a, (t, _) in db.items():
        if t in skip_types:
            skip_types[t] += 1

    # --- Samenvatting ---
    print("\n--- SAMENVATTING ---")
    print(f"  vast geupdatet (uit lijst)        : {len(updates)}")
    print(f"  vast uitgesloten -> 0             : {len(op_0_uitgesloten)}")
    print(f"  vast niet in lijst -> 0           : {len(op_0_niet_in_lijst)}")
    print(f"  nieuw aanmaken (vaste maat, vrd>0): {len(nieuw)}")
    print(f"  nieuw vaste maat 0/neg -> skip    : {len(nieuw_vast_leeg)}")
    print(f"  nieuw broadloom -> overgeslagen   : {len(nieuw_broadloom)}")
    print(f"  uitsluitlijst totaal (union)      : {len(exclude_artnr)}")
    print(f"  overgeslagen staaltje             : {skip_types['staaltje']}")
    print(f"  overgeslagen rol                  : {skip_types['rol']}")
    print(f"  overgeslagen overig               : {skip_types['overig']}")

    # --- Uitsluitlijst wegschrijven (union, gesorteerd) ---
    df_uitsluiten = pd.DataFrame(
        sorted(exclude.values(), key=lambda d: d["karpi_code"] or d["artikelnr"])
    )[["artikelnr", "karpi_code", "omschrijving"]]
    if COMMIT:
        df_uitsluiten.to_csv(UITSLUITEN_CSV, sep=";", index=False)
        print(f"\nUitsluitlijst bijgewerkt: {UITSLUITEN_CSV.name} "
              f"({len(df_uitsluiten)} regels)")
    else:
        print(f"\nDRY-RUN: uitsluitlijst NIET overschreven "
              f"(zou {len(df_uitsluiten)} regels worden).")

    # --- Rapport wegschrijven ---
    RAPPORT_DIR.mkdir(exist_ok=True)
    df_nieuw = pd.DataFrame([{
        "artikelnr": x["artikelnr"], "karpi_code": x["karpi_code"],
        "omschrijving": x["omschrijving"], "voorraad": x["vrije_voorraad"],
    } for x in nieuw])
    df_broadloom = pd.DataFrame([{
        "artikelnr": x["artikelnr"], "karpi_code": x["karpi_code"],
        "omschrijving": x["omschrijving"], "voorraad_meters": x["vrije_voorraad"],
    } for x in nieuw_broadloom])
    df_op0 = pd.DataFrame({"artikelnr": sorted(op_0_niet_in_lijst)})
    df_nieuw_rood = pd.DataFrame(
        [nieuwe_rode[a] for a in nieuw_rood_extra]
    )
    df_samenvatting = pd.DataFrame([
        {"Categorie": "vast geupdatet uit lijst", "Aantal": len(updates)},
        {"Categorie": "vast uitgesloten -> 0", "Aantal": len(op_0_uitgesloten)},
        {"Categorie": "vast niet in lijst -> 0", "Aantal": len(op_0_niet_in_lijst)},
        {"Categorie": "nieuw aangemaakt (vaste maat, vrd>0)", "Aantal": len(nieuw)},
        {"Categorie": "nieuw vaste maat 0/neg overgeslagen", "Aantal": len(nieuw_vast_leeg)},
        {"Categorie": "nieuw broadloom overgeslagen", "Aantal": len(nieuw_broadloom)},
        {"Categorie": "uitsluitlijst totaal (union)", "Aantal": len(exclude_artnr)},
        {"Categorie": "nieuw rood toegevoegd deze run", "Aantal": len(nieuw_rood_extra)},
        {"Categorie": "overgeslagen staaltje", "Aantal": skip_types["staaltje"]},
        {"Categorie": "overgeslagen rol", "Aantal": skip_types["rol"]},
        {"Categorie": "overgeslagen overig", "Aantal": skip_types["overig"]},
        {"Categorie": "modus", "Aantal": "COMMIT" if COMMIT else "DRY-RUN"},
    ])
    with pd.ExcelWriter(RAPPORT, engine="openpyxl") as w:
        df_samenvatting.to_excel(w, sheet_name="Samenvatting", index=False)
        df_nieuw.to_excel(w, sheet_name="Nieuw_vaste_maat", index=False)
        df_broadloom.to_excel(w, sheet_name="Nieuw_broadloom_skip", index=False)
        df_op0.to_excel(w, sheet_name="Op_0_niet_in_lijst", index=False)
        df_nieuw_rood.to_excel(w, sheet_name="Nieuw_rood_deze_run", index=False)
        df_uitsluiten.to_excel(w, sheet_name="Uitsluitlijst_union", index=False)
    print(f"Rapport geschreven: {RAPPORT.name}")

    if not COMMIT:
        print("\nDRY-RUN: geen DB-wijzigingen. Draai met --commit om te schrijven.")
        return

    # --- COMMIT: wegschrijven naar Supabase ---
    print("\n--- SCHRIJVEN NAAR SUPABASE ---")
    CHUNK = 100
    per_waarde = defaultdict(list)
    for a, v in updates:
        per_waarde[v].append(a)
    for a in op_0_uitgesloten + op_0_niet_in_lijst:
        per_waarde[0].append(a)

    totaal = sum(len(v) for v in per_waarde.values())
    gedaan = 0
    for v, artnrs in sorted(per_waarde.items()):
        payload = {"voorraad": v, "vrije_voorraad": v,
                   "backorder": 0, "gereserveerd": 0}
        for i in range(0, len(artnrs), CHUNK):
            sb.table("producten").update(payload).in_(
                "artikelnr", artnrs[i:i + CHUNK]).execute()
        gedaan += len(artnrs)
        print(f"  update voorraad={v}: +{len(artnrs)}  ({gedaan}/{totaal})")

    # Nieuwe artikelen aanmaken (alleen vaste maten) via INSERT.
    geldige_kwal = set()
    kstart = 0
    while True:
        kr = sb.table("kwaliteiten").select("code").range(kstart, kstart + 999).execute()
        if not kr.data:
            break
        geldige_kwal.update(str(k["code"]) for k in kr.data)
        if len(kr.data) < 1000:
            break
        kstart += 1000

    rec_new = []
    zonder_kwal = []
    for x in nieuw:
        kwal, kleur, zoek = _afgeleide_codes(x["karpi_code"])
        if kwal not in geldige_kwal:
            zonder_kwal.append(x["karpi_code"])
            kwal = None
        lengte, breedte, vorm = _afmeting(x["karpi_code"])
        rec_new.append({
            "artikelnr": x["artikelnr"], "karpi_code": x["karpi_code"],
            "omschrijving": x["omschrijving"],
            "voorraad": x["vrije_voorraad"], "vrije_voorraad": x["vrije_voorraad"],
            "backorder": 0, "gereserveerd": 0,
            "kwaliteit_code": kwal, "kleur_code": kleur, "zoeksleutel": zoek,
            "lengte_cm": lengte, "breedte_cm": breedte,
            "product_type": "vast", "actief": True,
            "vorm": vorm or "rechthoek",
        })
    for i in range(0, len(rec_new), 500):
        sb.table("producten").insert(rec_new[i:i + 500]).execute()
        print(f"  insert nieuw: {min(i + 500, len(rec_new))}/{len(rec_new)}")
    if zonder_kwal:
        print(f"  ({len(zonder_kwal)} nieuw zonder kwaliteit-link: "
              f"{', '.join(sorted(set(_afgeleide_codes(k)[0] for k in zonder_kwal)))})")

    print("\nKLAAR. DB bijgewerkt.")


if __name__ == "__main__":
    main()
