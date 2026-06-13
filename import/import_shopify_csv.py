"""
Import Shopify orders uit CSV-export naar RugFlow ERP.
Filtert op orders vanaf SINCE_DATE. Idempotent op bron_order_id.
"""
import sys, io, csv, re
from datetime import datetime, timedelta
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

CSV_FILE  = BASE_DIR / "orders_export-shopify.csv"
SINCE_DATE = "2026-06-01"
BRON_SHOP  = "karpi.myshopify.com"


# ── helpers ──────────────────────────────────────────────────────────────────

def werkdagen_plus(date_str, n=7):
    d = datetime.fromisoformat(date_str)
    d += timedelta(days=n)
    return d.strftime("%Y-%m-%d")


def match_debiteur(bedrijf, naam, email):
    """Zoek debiteur op bedrijfsnaam, dan naam, dan email."""
    for zoek, waarde in [
        ("naam", bedrijf),
        ("naam", naam),
        ("email", email),
    ]:
        if not waarde:
            continue
        kolom = "email_factuur" if zoek == "email" else zoek
        r = sb.table("debiteuren").select("debiteur_nr, naam") \
              .ilike(kolom, f"%{waarde}%").limit(1).execute()
        if r.data:
            return r.data[0]["debiteur_nr"], r.data[0]["naam"]
    return None, None


def match_product(sku, naam):
    """Match artikelnr op SKU of omschrijving. Detecteer maatwerk."""
    # Maatwerk: naam bevat maatwerkwoorden of heeft geen standaard SKU
    maatwerk_patroon = re.search(r'(\d+)\s*[xX×]\s*(\d+)', naam)

    if sku:
        # Directe artikelnr match
        r = sb.table("producten").select("artikelnr, omschrijving") \
              .eq("artikelnr", sku).limit(1).execute()
        if r.data:
            return r.data[0]["artikelnr"], False, None, None, None, None
        # karpi_code match — vaste maten zoals LUXR17XX160230 staan als karpi_code, niet artikelnr.
        # MAATWERK-SKU's (bv. LAGO13MAATWERK) hier overslaan: sinds mig 353 staat
        # die code óók als karpi_code op het generieke maatwerk-artikel — een
        # match hier zou is_maatwerk=False zonder dims teruggeven. Die SKU's
        # vallen door naar de maatwerk-tak hieronder.
        if not sku.upper().endswith("MAATWERK"):
            r = sb.table("producten").select("artikelnr") \
                  .eq("karpi_code", sku).limit(1).execute()
            if r.data:
                return r.data[0]["artikelnr"], False, None, None, None, None

    if maatwerk_patroon:
        # Detecteer kwaliteitscode + kleur uit SKU
        breedte = int(maatwerk_patroon.group(1))
        lengte  = int(maatwerk_patroon.group(2))
        kwal_code  = None
        kleur_code = None
        if sku:
            # SKU bijv. VERR68XX200290 of LUXR17MAATWERK → kwaliteit VERR/LUXR,
            # kleur 68/17. NB: kwaliteit en kleur APART splitsen — de oude regex
            # r'^([A-Z]+\d*)' plakte ze aaneen ("LUXR17") en liet kleur op None,
            # waardoor het maatwerk-record nergens op kon matchen
            # (incident ORD-2026-0098 regel 1, "Luxury 17 taupe").
            # Regex-randgevallen (geaccepteerd — dit is een backfill-tool):
            # een SKU met alléén letters levert nu géén kwaliteit meer op, en
            # prefixen langer dan 6 letters matchen niet meer (de oude regex
            # pakte die nog wel).
            m = re.match(r'^([A-Z]{2,6})(\d{1,3})', sku)
            if m:
                kwal_code  = m.group(1)
                kleur_code = m.group(2)
                # Zoek generiek maatwerk-artikel: omschrijving = {KWAL}{KLEUR}MAATWERK
                # (de oude lookup zocht in `artikelnr` — daar staat een numerieke
                # code, dus die vond nooit iets).
                r = sb.table("producten").select("artikelnr") \
                      .ilike("omschrijving", f"{kwal_code}{kleur_code}MAATWERK").limit(1).execute()
                if r.data:
                    return r.data[0]["artikelnr"], True, kwal_code, kleur_code, lengte, breedte
        return None, True, kwal_code, kleur_code, lengte, breedte

    # Zoek op omschrijving (eerste woorden)
    woorden = naam.split()[:3]
    if woorden:
        r = sb.table("producten").select("artikelnr") \
              .ilike("omschrijving", f"%{' '.join(woorden)}%").limit(1).execute()
        if r.data:
            return r.data[0]["artikelnr"], False, None, None, None, None

    return None, False, None, None, None, None


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    print(f"=== Shopify CSV import (vanaf {SINCE_DATE}) ===\n")

    with open(CSV_FILE, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    # Groepeer op order-ID (meerdere regels per order mogelijk)
    orders = {}
    for row in rows:
        datum_str = row["Created at"][:10]  # "2026-06-02"
        if datum_str < SINCE_DATE:
            continue
        oid = row["Id"]
        if oid not in orders:
            orders[oid] = {"meta": row, "items": []}
        orders[oid]["items"].append(row)

    print(f"  {len(orders)} orders na {SINCE_DATE}\n")

    ok, skip, fout = 0, 0, 0

    for shopify_id, data in orders.items():
        meta  = data["meta"]
        items = data["items"]
        naam  = meta["Name"]  # "#5571"

        # Idempotentie
        bestaand = sb.table("orders").select("order_nr") \
                     .eq("bron_systeem", "shopify") \
                     .eq("bron_order_id", str(shopify_id)) \
                     .limit(1).execute()
        if bestaand.data:
            print(f"  SKIP {naam}: bestaat al als {bestaand.data[0]['order_nr']}")
            skip += 1
            continue

        # Debiteur
        bedrijf = meta.get("Shipping Company", "") or meta.get("Billing Company", "")
        afl_naam = meta.get("Shipping Name", "")
        email    = meta.get("Email", "")
        debiteur_nr, debiteur_naam = match_debiteur(bedrijf, afl_naam, email)
        if not debiteur_nr:
            print(f"  FOUT {naam}: geen debiteur gevonden (bedrijf='{bedrijf}', naam='{afl_naam}')")
            fout += 1
            continue

        orderdatum  = meta["Created at"][:10]
        afleverdatum = werkdagen_plus(orderdatum, 7)

        # Gebruik notitie als referentie (B2B PO-nummer), anders Shopify ordernummer
        notitie = (meta.get("Notes") or "").strip()
        klant_referentie = notitie if notitie else naam

        header = {
            "debiteur_nr":     debiteur_nr,
            "klant_referentie": klant_referentie,
            "orderdatum":      orderdatum,
            "afleverdatum":    afleverdatum,
            "afl_naam":        afl_naam,
            "afl_naam_2":      bedrijf or debiteur_naam or None,
            "afl_adres":       " ".join(filter(None, [meta.get("Shipping Address1",""), meta.get("Shipping Address2","")])) or None,
            "afl_postcode":    meta.get("Shipping Zip") or None,
            "afl_plaats":      meta.get("Shipping City") or None,
            "afl_land":        meta.get("Shipping Country") or "NL",
            "afl_telefoon":    meta.get("Shipping Phone") or None,
            "fact_naam":       meta.get("Billing Name") or afl_naam,
            "fact_naam_2":     meta.get("Billing Company") or debiteur_naam or None,
            "fact_adres":      " ".join(filter(None, [meta.get("Billing Address1",""), meta.get("Billing Address2","")])) or None,
            "fact_postcode":   meta.get("Billing Zip") or None,
            "fact_plaats":     meta.get("Billing City") or None,
            "fact_land":       meta.get("Billing Country") or "NL",
            "opmerkingen":     meta.get("Notes") or None,
            "bron_systeem":    "shopify",
            "bron_shop":       BRON_SHOP,
            "bron_order_id":   str(shopify_id),
        }

        regels = []
        for item in items:
            sku       = item.get("Lineitem sku", "").strip()
            item_naam = item.get("Lineitem name", "").strip()
            try:
                aantal = int(float(item.get("Lineitem quantity", 1)))
                prijs  = float(item.get("Lineitem price", 0))
            except (ValueError, TypeError):
                aantal, prijs = 1, 0.0

            artikelnr, is_mw, kwal_code, kleur_code, lengte, breedte = match_product(sku, item_naam)
            regels.append({
                "artikelnr":              artikelnr,
                "omschrijving":           item_naam[:200] if item_naam else None,
                "omschrijving_2":         None,
                "orderaantal":            aantal,
                "te_leveren":             aantal,
                "prijs":                  prijs,
                "korting_pct":            0,
                "bedrag":                 round(prijs * aantal, 2),
                "gewicht_kg":             None,
                "is_maatwerk":            is_mw,
                "maatwerk_kwaliteit_code": kwal_code,
                "maatwerk_kleur_code":    kleur_code,
                "maatwerk_lengte_cm":     lengte,
                "maatwerk_breedte_cm":    breedte,
            })

            # Verzendkosten
            try:
                verzend = float(item.get("Shipping", 0))
            except (ValueError, TypeError):
                verzend = 0.0
            if verzend > 0 and item == items[0]:
                regels.append({
                    "artikelnr":    "VERZEND",
                    "omschrijving": "Verzendkosten",
                    "omschrijving_2": None,
                    "orderaantal":  1, "te_leveren": 1,
                    "prijs": verzend, "korting_pct": 0, "bedrag": verzend,
                    "gewicht_kg": None, "is_maatwerk": False,
                    "maatwerk_kwaliteit_code": None, "maatwerk_kleur_code": None,
                    "maatwerk_lengte_cm": None, "maatwerk_breedte_cm": None,
                })

        result = sb.rpc("create_webshop_order", {"p_header": header, "p_regels": regels}).execute()
        if result.data:
            order_nr = result.data[0].get("order_nr") if isinstance(result.data, list) else result.data.get("order_nr")
            print(f"  OK  {naam} → {order_nr} | debiteur: {debiteur_naam} | {len(regels)} regels")
            ok += 1
        else:
            print(f"  FOUT {naam}: RPC gaf geen data terug")
            fout += 1

    print(f"\n=== Klaar: {ok} geïmporteerd, {skip} overgeslagen, {fout} fouten ===")


if __name__ == "__main__":
    main()
