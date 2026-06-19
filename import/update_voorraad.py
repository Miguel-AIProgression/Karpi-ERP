"""
Voorraad-update vaste maten — GENERIEK (elke periodieke vrije-voorraadlijst)
============================================================================
Werkt de stuks-voorraad bij uit een Karpi-export "Ovz. vrije voorraad —
alle artikelen" (`Voorraadlijst <datum>.xls`). Vervangt de losse gedateerde
scripts (update_voorraad_2026_05.py / _2026_06_01.py): geef het bestandspad
gewoon als argument mee.

Beslissingen (vastgelegd met Karpi):
  - Scope: ALLEEN product_type='vast'. Staaltje/rol/overig NIET aangeraakt.
  - Sleutel: kolom A 'Artikelnr' -> producten.artikelnr (PK).
  - Waarde:  kolom H 'Vrije voorraad' (= fysiek D - oude reserveringen F).
    HERZIEN 2026-06-15 (was kolom D 'Voorraad' (FYSIEK) sinds 2026-06-08).
    Reden: het oude systeem houdt de actuele voorraad EN alle orders van
    vóór 1-06; reserveringen daar (kolom F) zijn pre-1-06 orders die fysiek
    nog uitgeleverd worden -> die voorraad is NIET vrij voor RugFlow. RugFlow
    maakt alleen NIEUWE orders (ná 1-06). De twee order-sets zijn DISJUNCT,
    dus geen dubbel-aftrekken: baseline = kolom H, en herallocateer_open_orders.py
    trekt daar bovenop alleen RugFlow's eigen nieuwe orders af. Eindresultaat:
    vrij = fysiek - oude verplichtingen - nieuwe RugFlow-orders. (De 2026-06-08
    keuze voor kolom D negeerde de oude verplichtingen -> RugFlow toonde te veel
    vrij = oversold-risico.) Backorder/gereserveerd als baseline op 0.
  - MAATWERK-regels (Karpi-code bevat 'MAATWERK') uitgesloten.
  - Rode regels (rood font) = "niet meer inladen". Karpi markeert deze
    PROGRESSIEF ALFABETISCH per lijst, dus de uitsluitlijst is een UNION:
        exclude = bestaande voorraad_uitsluiten.csv  UNION  rode regels nu.
    Uitgesloten artikelen -> voorraad 0 + (bij --commit) toegevoegd aan de csv.
  - 'vast' in DB maar niet in actieve lijst: voorraad -> 0.
  - Nieuw in lijst maar niet in DB: alleen echte vaste maten met vrije
    voorraad > 0 aanmaken (^[A-Z]{3,4}\\d{2}XX, incl. ...RND). Broadloom/rol
    (geen XX-scheiding) worden gelogd + overgeslagen.
  - Ontbrekende kwaliteiten: elke kwaliteitscode in de actieve lijst zonder
    rij in `kwaliteiten` wordt bij --commit code-only aangemaakt (overige
    velden NULL -> Karpi verrijkt gewicht/omschrijving/collectie later). Zo
    blijft de FK producten.kwaliteit_code geldig en hoeft niets op NULL.
  - Negatieve vrije voorraad -> clampen naar 0.

Bestandsformaat: zowel .xls (klassieke export met rode-font-markering via
xlrd) als .xlsx (nieuwere export via openpyxl). LET OP: de .xlsx-export draagt
doorgaans GEEN font-opmaak -> de rode 'niet inladen'-markering ontbreekt dan.
Dat is veilig door de union-uitsluitlijst (bestaande exclusions blijven staan);
er worden enkel geen NIEUWE rode regels in zo'n ronde gedetecteerd.

Gebruik:
  python update_voorraad.py "..\\Voorraadlijst 01-6-2026.xls"            # DRY-RUN
  python update_voorraad.py "..\\Voorraadlijst 01-6-2026.xls" --commit   # schrijft

Vereist: import/.env met SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
"""
import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

import xlrd
import pandas as pd
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

UITSLUITEN_CSV = BASE_DIR / "import" / "voorraad_uitsluiten.csv"
RAPPORT_DIR = BASE_DIR / "import" / "rapporten"

# Kolom-indices in de .xls (header op rij index 1, data vanaf rij 2)
COL_ARTNR, COL_KARPI, COL_OMS = 0, 1, 2
COL_FYSIEK = 3   # kolom D 'Voorraad' (FYSIEK) — alleen ter referentie/diff
COL_VOORRAAD = 7  # kolom H 'Vrije voorraad' = baseline voor RugFlow (zie docstring)

_QC_RE = re.compile(r"^([A-Z]{3,4})(\d{2})")
_VAST_RE = re.compile(r"^[A-Z]{3,4}\d{2}XX")
_MAAT_RECHT_RE = re.compile(r"XX(\d{3})(\d{3})$")
_MAAT_ROND_RE = re.compile(r"XX(\d{3})RND$")


def parse_args(argv):
    """-> (Path voorraadlijst, bool commit)."""
    commit = "--commit" in argv
    paden = [a for a in argv[1:] if not a.startswith("--")]
    if not paden:
        print("GEBRUIK: python update_voorraad.py \"<pad naar .xls>\" [--commit]")
        print("Voorbeeld: python update_voorraad.py \"..\\Voorraadlijst 01-6-2026.xls\"")
        sys.exit(1)
    pad = Path(paden[0])
    if not pad.is_absolute():
        pad = (Path.cwd() / pad).resolve()
    if not pad.exists():
        print(f"ERROR: bestand niet gevonden: {pad}")
        sys.exit(1)
    return pad, commit


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


def _num(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _maak_rij(artnr, karpi, oms, voorraad, fysiek, is_red):
    artnr = str(artnr).strip()
    karpi = str(karpi).strip()
    if not artnr and not karpi:
        return None
    if artnr.endswith(".0"):
        artnr = artnr[:-2]
    return {
        "artikelnr": artnr,
        "karpi_code": karpi,
        "omschrijving": str(oms).strip(),
        "voorraad": _num(voorraad),  # baseline = kolom H
        "fysiek": _num(fysiek),      # kolom D, referentie
        "is_red": is_red,
        "is_maatwerk": "MAATWERK" in karpi.upper(),
    }


def _lees_xls(pad: Path):
    """Klassieke .xls-export met rode-font-opmaak (xlrd)."""
    wb = xlrd.open_workbook(str(pad), formatting_info=True)
    sh = wb.sheet_by_index(0)

    def is_red(r):
        cell = sh.cell(r, COL_ARTNR)
        xf = wb.xf_list[cell.xf_index]
        font = wb.font_list[xf.font_index]
        return wb.colour_map.get(font.colour_index) == (255, 0, 0)

    rijen = []
    for r in range(2, sh.nrows):
        rij = _maak_rij(
            sh.cell(r, COL_ARTNR).value, sh.cell(r, COL_KARPI).value,
            sh.cell(r, COL_OMS).value, sh.cell(r, COL_VOORRAAD).value,
            sh.cell(r, COL_FYSIEK).value, is_red(r),
        )
        if rij:
            rijen.append(rij)
    return rijen


def _is_rood_font(cell) -> bool:
    """openpyxl: True als de font-kleur een expliciet rood (FF0000) is."""
    col = cell.font.color if cell.font else None
    rgb = getattr(col, "rgb", None) if col else None
    if not isinstance(rgb, str):
        return False
    return rgb.upper().lstrip("F").startswith("FF0000") or rgb.upper() in (
        "FFFF0000", "00FF0000", "FF0000")


def _lees_xlsx(pad: Path):
    """Nieuwere .xlsx-export (openpyxl). LET OP: deze export draagt doorgaans
    GEEN font-opmaak -> rode 'niet inladen'-markering ontbreekt. Dankzij de
    union-uitsluitlijst is dat veilig (bestaande exclusions blijven staan);
    er worden enkel geen NIEUWE rode regels in deze ronde gedetecteerd."""
    import openpyxl
    wb = openpyxl.load_workbook(str(pad), data_only=True)
    sh = wb[wb.sheetnames[0]]
    rijen = []
    # openpyxl is 1-based; header op rij 2 -> data vanaf rij 3
    for row in sh.iter_rows(min_row=3, values_only=False):
        c = {cell.column - 1: cell for cell in row}
        rij = _maak_rij(
            c[COL_ARTNR].value if COL_ARTNR in c else "",
            c[COL_KARPI].value if COL_KARPI in c else "",
            c[COL_OMS].value if COL_OMS in c else "",
            c[COL_VOORRAAD].value if COL_VOORRAAD in c else 0,
            c[COL_FYSIEK].value if COL_FYSIEK in c else 0,
            _is_rood_font(c[COL_ARTNR]) if COL_ARTNR in c else False,
        )
        if rij:
            rijen.append(rij)
    return rijen


def lees_lijst(pad: Path):
    """Lees de voorraadlijst (.xls of .xlsx) -> lijst van rij-dicts incl. is_red."""
    if pad.suffix.lower() == ".xlsx":
        return _lees_xlsx(pad)
    return _lees_xls(pad)


def lees_bestaande_uitsluitlijst():
    """artikelnr -> {artikelnr, karpi_code, omschrijving} uit de skip-lijst."""
    out = {}
    if not UITSLUITEN_CSV.exists():
        return out
    with open(UITSLUITEN_CSV, encoding="utf-8") as f:
        rd = csv.reader(f, delimiter=";")
        next(rd, None)  # header
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


def laad_kwaliteiten(sb):
    """set van bestaande kwaliteit-codes (paginated)."""
    codes = set()
    start = 0
    while True:
        kr = sb.table("kwaliteiten").select("code").range(start, start + 999).execute()
        if not kr.data:
            break
        codes.update(str(k["code"]) for k in kr.data)
        if len(kr.data) < 1000:
            break
        start += 1000
    return codes


def main():
    pad, commit = parse_args(sys.argv)

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Supabase URL/Key ontbreekt. Maak import/.env met")
        print("       SUPABASE_URL=... en SUPABASE_SERVICE_ROLE_KEY=...")
        sys.exit(1)
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", pad.stem).strip("_")
    rapport = RAPPORT_DIR / f"voorraad_update_{stem}.xlsx"

    print("=" * 64)
    print(f"VOORRAAD-UPDATE  ({'COMMIT' if commit else 'DRY-RUN'})")
    print(f"Bestand: {pad.name}")
    print("=" * 64)

    rijen = lees_lijst(pad)
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

    exclude = dict(bestaand)
    exclude.update(nieuwe_rode)
    exclude_artnr = set(exclude)

    print(f"  bestaande uitsluitlijst : {len(bestaand)}")
    print(f"  rood in deze lijst      : {len(nieuwe_rode)}")
    print(f"  nieuw rood toegevoegd   : {len(nieuw_rood_extra)}")
    print(f"  uitsluitlijst NA union  : {len(exclude_artnr)}")

    actief = {}
    for x in rijen:
        if x["artikelnr"] in exclude_artnr or x["is_maatwerk"]:
            continue
        actief.setdefault(x["artikelnr"], x)

    db = laad_db_producten(sb)
    vast = {a for a, (t, _) in db.items() if t == "vast"}

    updates = []
    op_0_niet_in_lijst = []
    op_0_uitgesloten = []
    for artnr in vast:
        if artnr in exclude_artnr:
            op_0_uitgesloten.append(artnr)
        elif artnr in actief:
            updates.append((artnr, max(0, actief[artnr]["voorraad"])))
        else:
            op_0_niet_in_lijst.append(artnr)

    nieuw_alle = [x for a, x in actief.items() if a not in db]
    nieuw_vast_alle = [x for x in nieuw_alle if is_vaste_maat(x["karpi_code"])]
    nieuw = [x for x in nieuw_vast_alle if x["voorraad"] > 0]
    nieuw_vast_leeg = [x for x in nieuw_vast_alle if x["voorraad"] <= 0]
    nieuw_broadloom = [x for x in nieuw_alle if not is_vaste_maat(x["karpi_code"])]

    # --- Ontbrekende kwaliteiten: codes in de actieve lijst zonder rij in
    #     kwaliteiten. Worden bij --commit code-only aangemaakt (overige velden
    #     NULL -> Karpi verrijkt gewicht/omschrijving/collectie later). ---
    geldige_kwal = laad_kwaliteiten(sb)
    ontbrekende_kwal = {}
    for x in actief.values():
        kwal, _, _ = _afgeleide_codes(x["karpi_code"])
        if kwal and kwal not in geldige_kwal and kwal not in ontbrekende_kwal:
            ontbrekende_kwal[kwal] = x["karpi_code"]

    skip_types = {"staaltje": 0, "rol": 0, "overig": 0}
    for a, (t, _) in db.items():
        if t in skip_types:
            skip_types[t] += 1

    print("\n--- SAMENVATTING ---")
    print(f"  vast geupdatet (uit lijst)        : {len(updates)}")
    print(f"  vast uitgesloten -> 0             : {len(op_0_uitgesloten)}")
    print(f"  vast niet in lijst -> 0           : {len(op_0_niet_in_lijst)}")
    print(f"  nieuw aanmaken (vaste maat, vrd>0): {len(nieuw)}")
    print(f"  nieuw vaste maat 0/neg -> skip    : {len(nieuw_vast_leeg)}")
    print(f"  nieuw broadloom -> overgeslagen   : {len(nieuw_broadloom)}")
    print(f"  ontbrekende kwaliteiten aanmaken  : {len(ontbrekende_kwal)}"
          + (f"  ({', '.join(sorted(ontbrekende_kwal))})" if ontbrekende_kwal else ""))
    print(f"  uitsluitlijst totaal (union)      : {len(exclude_artnr)}")
    print(f"  overgeslagen staaltje             : {skip_types['staaltje']}")
    print(f"  overgeslagen rol                  : {skip_types['rol']}")
    print(f"  overgeslagen overig               : {skip_types['overig']}")

    # --- Uitsluitlijst wegschrijven (union, gesorteerd) — alleen bij commit ---
    df_uitsluiten = pd.DataFrame(
        sorted(exclude.values(), key=lambda d: d["karpi_code"] or d["artikelnr"])
    )[["artikelnr", "karpi_code", "omschrijving"]]
    if commit:
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
        "omschrijving": x["omschrijving"], "voorraad": x["voorraad"],
    } for x in nieuw])
    df_broadloom = pd.DataFrame([{
        "artikelnr": x["artikelnr"], "karpi_code": x["karpi_code"],
        "omschrijving": x["omschrijving"], "voorraad_meters": x["voorraad"],
    } for x in nieuw_broadloom])
    df_op0 = pd.DataFrame({"artikelnr": sorted(op_0_niet_in_lijst)})
    df_nieuw_rood = pd.DataFrame([nieuwe_rode[a] for a in nieuw_rood_extra])
    df_kwal = pd.DataFrame(
        [{"kwaliteit_code": c, "voorbeeld_karpi_code": ontbrekende_kwal[c]}
         for c in sorted(ontbrekende_kwal)]
    )
    df_samenvatting = pd.DataFrame([
        {"Categorie": "bestand", "Aantal": pad.name},
        {"Categorie": "vast geupdatet uit lijst", "Aantal": len(updates)},
        {"Categorie": "vast uitgesloten -> 0", "Aantal": len(op_0_uitgesloten)},
        {"Categorie": "vast niet in lijst -> 0", "Aantal": len(op_0_niet_in_lijst)},
        {"Categorie": "nieuw aangemaakt (vaste maat, vrd>0)", "Aantal": len(nieuw)},
        {"Categorie": "nieuw vaste maat 0/neg overgeslagen", "Aantal": len(nieuw_vast_leeg)},
        {"Categorie": "nieuw broadloom overgeslagen", "Aantal": len(nieuw_broadloom)},
        {"Categorie": "ontbrekende kwaliteiten aangemaakt", "Aantal": len(ontbrekende_kwal)},
        {"Categorie": "uitsluitlijst totaal (union)", "Aantal": len(exclude_artnr)},
        {"Categorie": "nieuw rood toegevoegd deze run", "Aantal": len(nieuw_rood_extra)},
        {"Categorie": "overgeslagen staaltje", "Aantal": skip_types["staaltje"]},
        {"Categorie": "overgeslagen rol", "Aantal": skip_types["rol"]},
        {"Categorie": "overgeslagen overig", "Aantal": skip_types["overig"]},
        {"Categorie": "modus", "Aantal": "COMMIT" if commit else "DRY-RUN"},
    ])
    with pd.ExcelWriter(rapport, engine="openpyxl") as w:
        df_samenvatting.to_excel(w, sheet_name="Samenvatting", index=False)
        df_nieuw.to_excel(w, sheet_name="Nieuw_vaste_maat", index=False)
        df_broadloom.to_excel(w, sheet_name="Nieuw_broadloom_skip", index=False)
        df_op0.to_excel(w, sheet_name="Op_0_niet_in_lijst", index=False)
        df_nieuw_rood.to_excel(w, sheet_name="Nieuw_rood_deze_run", index=False)
        df_kwal.to_excel(w, sheet_name="Kwaliteiten_aangemaakt", index=False)
        df_uitsluiten.to_excel(w, sheet_name="Uitsluitlijst_union", index=False)
    print(f"Rapport geschreven: {rapport.name}")

    if not commit:
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

    # --- Ontbrekende kwaliteiten aanmaken (code-only) vóór de product-inserts,
    #     zodat de FK producten.kwaliteit_code -> kwaliteiten geldig blijft. ---
    if ontbrekende_kwal:
        kwal_rows = [{"code": c} for c in sorted(ontbrekende_kwal)]
        sb.table("kwaliteiten").insert(kwal_rows).execute()
        geldige_kwal.update(ontbrekende_kwal)
        print(f"  kwaliteiten aangemaakt: {len(kwal_rows)} "
              f"({', '.join(sorted(ontbrekende_kwal))})")

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
            "voorraad": x["voorraad"], "vrije_voorraad": x["voorraad"],
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
    print("LET OP: draai nu  python herallocateer_open_orders.py --commit")
    print("        zodat open orders zich opnieuw tegen de nieuwe voorraad reserveren.")


if __name__ == "__main__":
    main()
