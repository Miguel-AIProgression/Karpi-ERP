"""Herstel vestiging-afleveradressen uit het lokale Transus EDIFACT-archief (EDI/*.zip).

De EDIFACT-bronberichten bevatten volledige NAD+DP-adressen mét GLN; de fixed-width
die Karpi via de API ontvangt niet. Dit script leest die NAD+DP-segmenten, koppelt
per (debiteur, GLN) het adres aan een bestaand GLN-loos afleveradres (exact-match op
genormaliseerde naam+plaats) of maakt anders een nieuwe afleveradres-rij, en backfillt
daarna de afl_* van de bijbehorende EDI-orders.

Gebruik:  python edi_afleveradres_uit_archief.py            (dry-run)
          python edi_afleveradres_uit_archief.py --apply    (schrijft naar DB)
"""
import sys, re, zipfile, glob, os
from config import SUPABASE_URL, SUPABASE_KEY
from supabase import create_client

APPLY = "--apply" in sys.argv
EDI_DIR = os.path.join(os.path.dirname(__file__), "..", "EDI")

from lib.normalize import norm, clean_gln

# 1. GLN -> adres uit alle .edi/.mes in de zips
gln_addr = {}
for zp in glob.glob(os.path.join(EDI_DIR, "*.zip")):
    try:
        z = zipfile.ZipFile(zp)
    except Exception:
        continue
    for name in z.namelist():
        if name.endswith("/"):
            continue
        try:
            txt = z.read(name).decode("latin-1")
        except Exception:
            continue
        for seg in re.findall(r"NAD\+(?:DP|BY)\+[^']*", txt):
            p = seg.split("+")
            if len(p) < 10 or not p[4]:
                continue
            g = clean_gln(p[2].split(":")[0])
            gln_addr.setdefault(g, {
                "naam": p[4].strip(), "adres": p[5].strip(),
                "plaats": p[6].strip(), "postcode": p[8].strip(),
                "land": p[9].strip() or "NL",
            })
print(f"GLN met adres in lokaal archief: {len(gln_addr)}")

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

orders = sb.table("orders").select(
    "id,order_nr,debiteur_nr,afleveradres_gln").eq("bron_systeem", "edi").not_.is_(
    "afleveradres_gln", "null").execute().data

# 2. Gap-orders: (debiteur, schone aflever-GLN) die nog geen afleveradres matchen.
#    Filter de afleveradressen-query op de EDI-debiteuren — anders raakt de
#    PostgREST-1000-rijen-limiet (tabel heeft 7290) en mist have_gln rijen.
edi_debs = sorted(set(o["debiteur_nr"] for o in orders))
afl = sb.table("afleveradressen").select(
    "id,debiteur_nr,adres_nr,naam,plaats,gln_afleveradres").in_(
    "debiteur_nr", edi_debs).execute().data
have_gln = set((a["debiteur_nr"], clean_gln(a["gln_afleveradres"]))
               for a in afl if a["gln_afleveradres"])

# unieke (debiteur, GLN) die ontbreken én in het archief zitten
targets = {}
for o in orders:
    g = clean_gln(o["afleveradres_gln"])
    key = (o["debiteur_nr"], g)
    if key in have_gln:
        continue
    if g in gln_addr:
        targets[key] = gln_addr[g]

print(f"Herstelbare (debiteur, GLN)-combinaties: {len(targets)}")

# index bestaande GLN-loze afleveradressen per debiteur op genormaliseerde naam+plaats
loos = {}
maxadr = {}
for a in afl:
    maxadr[a["debiteur_nr"]] = max(maxadr.get(a["debiteur_nr"], 0), a["adres_nr"] or 0)
    if not a["gln_afleveradres"]:
        loos.setdefault((a["debiteur_nr"], norm(a["naam"]), norm(a["plaats"])), a)

attach, create = [], []
for (deb, g), ad in sorted(targets.items()):
    ex = loos.get((deb, norm(ad["naam"]), norm(ad["plaats"])))
    if ex:
        attach.append((deb, g, ad, ex))
    else:
        create.append((deb, g, ad))

print(f"\n→ Koppelen aan BESTAAND afleveradres (naam+plaats exact): {len(attach)}")
for deb, g, ad, ex in attach:
    print(f"   deb {deb} GLN {g} -> adres_nr {ex['adres_nr']}  {ex['naam']} / {ex['plaats']}")
print(f"\n→ NIEUW afleveradres aanmaken: {len(create)}")
for deb, g, ad in create:
    print(f"   deb {deb} GLN {g} -> {ad['naam']} / {ad['postcode']} {ad['plaats']}")

if not APPLY:
    print("\n(DRY-RUN — niets geschreven. Draai met --apply om toe te passen.)")
    sys.exit(0)

# 3a. Koppel GLN aan bestaande rijen
for deb, g, ad, ex in attach:
    sb.table("afleveradressen").update({"gln_afleveradres": g}).eq("id", ex["id"]).execute()
# 3b. Maak nieuwe rijen
for deb, g, ad in create:
    maxadr[deb] = maxadr.get(deb, 0) + 1
    sb.table("afleveradressen").insert({
        "debiteur_nr": deb, "adres_nr": maxadr[deb], "naam": ad["naam"],
        "gln_afleveradres": g, "adres": ad["adres"], "postcode": ad["postcode"],
        "plaats": ad["plaats"], "land": ad["land"],
    }).execute()
print(f"\nGeschreven: {len(attach)} gekoppeld, {len(create)} nieuw.")

# 4. Order-backfill (zelfde logica als mig 312)
afl2 = sb.table("afleveradressen").select(
    "debiteur_nr,gln_afleveradres,naam,adres,postcode,plaats,land").in_(
    "debiteur_nr", edi_debs).not_.is_("gln_afleveradres", "null").execute().data
amap = {(a["debiteur_nr"], clean_gln(a["gln_afleveradres"])): a for a in afl2}
upd = 0
for o in orders:
    a = amap.get((o["debiteur_nr"], clean_gln(o["afleveradres_gln"])))
    if not a:
        continue
    cur = sb.table("orders").select("afl_naam,afl_adres,afl_postcode,afl_plaats,afl_land").eq(
        "id", o["id"]).single().execute().data
    new = {"afl_naam": a["naam"], "afl_adres": a["adres"], "afl_postcode": a["postcode"],
           "afl_plaats": a["plaats"], "afl_land": a["land"] or "NL"}
    if all((cur.get(k) or None) == (v or None) for k, v in new.items()):
        continue
    sb.table("orders").update(new).eq("id", o["id"]).execute()
    upd += 1
print(f"Orders gebackfilld: {upd}")
