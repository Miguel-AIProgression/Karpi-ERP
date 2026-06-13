"""
Gewicht-integriteit-check (read-only)
=====================================
Controleert de gewicht-keten die de Rhenus/Verhoek-preflight voedt:

  A. producten (vast/staaltje, maat+density compleet):
     gewicht_kg moet de vorm-aware berekening zijn
       rechthoek: lengte*breedte/10000 * density
       rond:      pi*(lengte/200)^2  * density
     Bekende vervuiling: gewicht_kg == density (kg/m2 i.p.v. stukgewicht).
  B. order_regels van open orders: gewicht_kg NULL/0 terwijl het
     product een berekenbaar gewicht heeft.
  C. zending_colli van niet-verzonden zendingen: gewicht_kg NULL/0.

Gebruik:  python check_gewicht_integriteit.py
Exit 0 = schoon, exit 1 = fouten gevonden (failing-test-semantiek).
"""
import math
import sys

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

PAGE = 1000


def fetch_all(bouw_query):
    """Haal alles gepagineerd op. bouw_query() levert een verse query-builder
    (PostgREST cap't op 1000 rijen — zelfde valkuil als het Pick & Ship
    max-rows-incident van 11-06)."""
    rows, off = [], 0
    while True:
        batch = bouw_query().range(off, off + PAGE - 1).execute().data
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        off += PAGE


def verwacht_gewicht(p, density):
    if p["vorm"] == "rond":
        return round(math.pi * (p["lengte_cm"] / 200) ** 2 * float(density), 2)
    return round(p["lengte_cm"] * p["breedte_cm"] / 10000 * float(density), 2)


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Supabase URL/Key ontbreekt (import/.env)")
        sys.exit(1)
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    fouten = 0

    # --- densities ---
    kw = {r["code"]: r["gewicht_per_m2_kg"]
          for r in fetch_all(lambda: sb.table("kwaliteiten")
                             .select("code, gewicht_per_m2_kg"))}

    # --- A: producten-cache ---
    producten = fetch_all(lambda: sb.table("producten")
        .select("artikelnr, vorm, lengte_cm, breedte_cm, gewicht_kg, kwaliteit_code")
        .in_("product_type", ["vast", "staaltje"])
        .not_.is_("lengte_cm", "null")
        .not_.is_("breedte_cm", "null"))
    dens_fout, ander_fout, voorbeelden = 0, 0, []
    for p in producten:
        d = kw.get(p["kwaliteit_code"])
        if not d or float(d) <= 0:
            continue
        g = p["gewicht_kg"]
        verw = verwacht_gewicht(p, d)
        if g is None or abs(float(g) - verw) >= 0.05:
            if g is not None and abs(float(g) - float(d)) < 0.005:
                dens_fout += 1
            else:
                ander_fout += 1
            if len(voorbeelden) < 10:
                voorbeelden.append((p["artikelnr"], p["vorm"],
                                    p["lengte_cm"], p["breedte_cm"], g, verw, d))
    print(f"[A] producten compleet: {len(producten)} | "
          f"density-als-gewicht: {dens_fout} | anders fout: {ander_fout}")
    for v in voorbeelden:
        print(f"    {v[0]} {v[1]} {v[2]}x{v[3]}: cache={v[4]} verwacht={v[5]} density={v[6]}")
    fouten += dens_fout + ander_fout

    # --- B: open orderregels ---
    open_orders = fetch_all(lambda: sb.table("orders").select("id")
        .not_.in_("status", ["Verzonden", "Geannuleerd"]))
    open_ids = {o["id"] for o in open_orders}
    regels = fetch_all(lambda: sb.table("order_regels")
        .select("id, order_id, artikelnr, is_maatwerk, gewicht_kg")
        .not_.is_("artikelnr", "null"))
    regel_fout = sum(
        1 for r in regels
        if r["order_id"] in open_ids
        and (r["gewicht_kg"] is None or float(r["gewicht_kg"]) == 0))
    print(f"[B] open orderregels met artikelnr en gewicht NULL/0: {regel_fout}"
          f" (informatief — ladder rekent live; alleen tellen, geen exit-fout)")

    # --- C: colli ---
    actieve_zendingen = fetch_all(lambda: sb.table("zendingen").select("id")
        .not_.in_("status", ["Onderweg", "Afgeleverd"]))
    z_ids = {z["id"] for z in actieve_zendingen}
    colli = fetch_all(lambda: sb.table("zending_colli")
        .select("id, zending_id, gewicht_kg"))
    colli_fout = [c for c in colli
                  if c["zending_id"] in z_ids
                  and (c["gewicht_kg"] is None or float(c["gewicht_kg"]) == 0)]
    print(f"[C] niet-verzonden colli met gewicht NULL/0: {len(colli_fout)} "
          f"{[c['id'] for c in colli_fout[:20]]}")
    fouten += len(colli_fout)

    print(f"\nTotaal fouten (A+C): {fouten}")
    sys.exit(1 if fouten > 0 else 0)


if __name__ == "__main__":
    main()
