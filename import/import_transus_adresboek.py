"""Importeer een Transus-adresboek (per partner geexporteerd) → afleveradressen + GLN.

Transus Online heeft per handelspartner een "Adressen"-lijst met GLN-kolom. Dat is de
gezaghebbende GLN->adres-mapping die in het Custom-ERP-orderformat ontbreekt. Dit script
leest zo'n export (CSV of XLSX), koppelt elke GLN aan een afleveradres van de opgegeven
debiteur (exacte match op genormaliseerde adres+plaats -> bestaand rij krijgt de GLN,
anders nieuwe rij) en backfillt daarna de afl_* van de bijbehorende EDI-orders.

Kolommen worden op header-trefwoord herkend (gln / adres|straat / postcode|plz /
plaats|ort|stad / land). Het `.0`-float-artefact wordt gestript.

Gebruik:
  python import_transus_adresboek.py <bestand> --debiteur 150761            (dry-run)
  python import_transus_adresboek.py <bestand> --debiteur 150761 --apply
  # meerdere bestanden/debiteuren? draai per partner.
"""
import sys, os, re, csv
from config import SUPABASE_URL, SUPABASE_KEY
from supabase import create_client
from lib.normalize import norm, clean_gln as _clean_gln

LAND_MAP = {"duitsland": "DE", "germany": "DE", "deutschland": "DE",
            "nederland": "NL", "netherlands": "NL", "belgie": "BE", "belgië": "BE",
            "oostenrijk": "AT", "österreich": "AT", "austria": "AT"}

def clean_postcode(v):
    # Strip een land-letterprefix ("D-", "A-", "D- ") die Transus soms toevoegt.
    return re.sub(r"^[A-Za-z]{1,2}-\s*", "", (v or "").strip())

def clean_gln(g):
    # Transus-adresboek: strict — verwijder álle niet-cijfers uit de GLN.
    return _clean_gln(g, strict=True)

def map_land(v):
    v = (v or "").strip()
    return LAND_MAP.get(v.lower(), v if len(v) <= 3 else (v[:2].upper() or "NL")) or "NL"

def detect(headers, *keys):
    for i, h in enumerate(headers):
        hl = (h or "").strip().lower()
        if any(k in hl for k in keys):
            return i
    return None

def read_rows(path):
    rows = []
    if path.lower().endswith((".xlsx", ".xls")):
        import pandas as pd
        df = pd.read_excel(path, dtype=str)
        headers = list(df.columns)
        for _, r in df.iterrows():
            rows.append([("" if pd.isna(r[c]) else str(r[c])) for c in headers])
    else:
        with open(path, encoding="utf-8-sig", newline="") as f:
            sample = f.read(4096); f.seek(0)
            delim = ";" if sample.count(";") >= sample.count(",") else ","
            rd = list(csv.reader(f, delimiter=delim))
        headers, rows = rd[0], rd[1:]
    return headers, rows

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    APPLY = "--apply" in sys.argv
    if "--debiteur" not in sys.argv or not args:
        sys.exit("Gebruik: python import_transus_adresboek.py <bestand> --debiteur <nr> [--apply]")
    deb = int(sys.argv[sys.argv.index("--debiteur") + 1])
    path = args[0]

    headers, rows = read_rows(path)
    iG = detect(headers, "gln")
    iA = detect(headers, "adres", "straat", "street", "strasse")
    iP = detect(headers, "postcode", "plz", "zip")
    iC = detect(headers, "plaats", "ort", "stad", "city")
    iL = detect(headers, "land", "country")
    if iG is None or iA is None or iC is None:
        sys.exit(f"Kon GLN/adres/plaats-kolom niet vinden in headers: {headers}")
    print(f"Kolommen: GLN={headers[iG]} adres={headers[iA]} postcode={headers[iP] if iP is not None else '-'} "
          f"plaats={headers[iC]} land={headers[iL] if iL is not None else '-'}")

    book = {}  # gln -> adres
    for r in rows:
        if iG >= len(r):
            continue
        g = clean_gln(r[iG])
        if len(g) < 8:
            continue
        book[g] = {
            "adres": r[iA].strip() if iA < len(r) else "",
            "postcode": clean_postcode(r[iP]) if iP is not None and iP < len(r) else None,
            "plaats": r[iC].strip() if iC < len(r) else "",
            "land": map_land(r[iL]) if iL is not None and iL < len(r) else "DE",
        }
    print(f"GLN's in adresboek: {len(book)}  (debiteur {deb})")

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    afl = sb.table("afleveradressen").select(
        "id,adres_nr,naam,adres,plaats,gln_afleveradres").eq("debiteur_nr", deb).execute().data
    have = set(clean_gln(a["gln_afleveradres"]) for a in afl if a["gln_afleveradres"])
    maxadr = max([a["adres_nr"] or 0 for a in afl], default=0)
    loos = {}
    for a in afl:
        if not a["gln_afleveradres"]:
            loos.setdefault((norm(a["adres"]), norm(a["plaats"])), a)

    # Beperk tot GLN's die als aflever-GLN op een EDI-order van deze debiteur staan,
    # plus alle overige (future-proof). We voeren beide door maar tellen apart.
    orders = sb.table("orders").select("afleveradres_gln").eq(
        "bron_systeem", "edi").eq("debiteur_nr", deb).not_.is_("afleveradres_gln", "null").execute().data
    order_glns = set(clean_gln(o["afleveradres_gln"]) for o in orders)

    attach, create, skip = [], [], 0
    for g, ad in book.items():
        if g in have:
            skip += 1
            continue
        key = (norm(ad["adres"]), norm(ad["plaats"]))
        ex = loos.pop(key, None)  # pop: een 2e GLN op hetzelfde adres krijgt een eigen rij
        (attach if ex else create).append((g, ad, ex))

    relevant = lambda g: " <-- order" if g in order_glns else ""
    print(f"\nAl aanwezig (GLN al op afleveradres): {skip}")
    print(f"Koppelen aan bestaand afleveradres (adres+plaats exact): {len(attach)}")
    for g, ad, ex in attach[:40]:
        print(f"   {g} -> adres_nr {ex['adres_nr']}  {ex['adres']} / {ex['plaats']}{relevant(g)}")
    print(f"Nieuw afleveradres aanmaken: {len(create)}")
    for g, ad, ex in create[:40]:
        print(f"   {g} -> {ad['adres']} / {ad['postcode']} {ad['plaats']}{relevant(g)}")

    if not APPLY:
        print("\n(DRY-RUN — niets geschreven. Voeg --apply toe om toe te passen.)")
        return

    for g, ad, ex in attach:
        sb.table("afleveradressen").update({"gln_afleveradres": g}).eq("id", ex["id"]).execute()
    for g, ad, ex in create:
        maxadr += 1
        sb.table("afleveradressen").insert({
            "debiteur_nr": deb, "adres_nr": maxadr, "naam": ad["plaats"] or "EDI-vestiging",
            "gln_afleveradres": g, "adres": ad["adres"], "postcode": ad["postcode"],
            "plaats": ad["plaats"], "land": ad["land"],
        }).execute()
    print(f"\nGeschreven: {len(attach)} gekoppeld, {len(create)} nieuw.")

    # Backfill orders van deze debiteur
    afl2 = sb.table("afleveradressen").select(
        "gln_afleveradres,naam,adres,postcode,plaats,land").eq("debiteur_nr", deb).not_.is_(
        "gln_afleveradres", "null").execute().data
    amap = {clean_gln(a["gln_afleveradres"]): a for a in afl2}
    ords = sb.table("orders").select("id,afleveradres_gln,afl_naam,afl_adres,afl_postcode,afl_plaats,afl_land").eq(
        "bron_systeem", "edi").eq("debiteur_nr", deb).not_.is_("afleveradres_gln", "null").execute().data
    upd = 0
    for o in ords:
        a = amap.get(clean_gln(o["afleveradres_gln"]))
        if not a:
            continue
        new = {"afl_naam": a["naam"], "afl_adres": a["adres"], "afl_postcode": a["postcode"],
               "afl_plaats": a["plaats"], "afl_land": a["land"] or "NL"}
        if all((o.get(k) or None) == (v or None) for k, v in new.items()):
            continue
        sb.table("orders").update(new).eq("id", o["id"]).execute()
        upd += 1
    print(f"Orders gebackfilld: {upd}")

if __name__ == "__main__":
    main()
