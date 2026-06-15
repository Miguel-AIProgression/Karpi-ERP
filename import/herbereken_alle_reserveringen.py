"""
Herbereken de gereserveerd/vrije_voorraad-cache voor ALLE producten met claims
==============================================================================
Roept de RPC `herbereken_product_reservering(p_artikelnr)` (mig 154) aan voor
elk fysiek_artikelnr met een actieve voorraad-claim. Die RPC zet:
    gereserveerd   = SUM(order_reserveringen.aantal WHERE bron='voorraad'
                         AND status='actief' AND order NOT IN Verzonden/Geannuleerd)
    vrije_voorraad = voorraad - gereserveerd - backorder

Waarom nodig (2026-06-15): update_voorraad.py zet de baseline gereserveerd=0,
en herallocateer_open_orders.py herstelt alleen WACHT-orders. Claims op
'Klaar voor picken'-orders (763 stuks / 274 artikelen op 15-06) worden daar
overgeslagen -> hun cache zou op 0 blijven -> vrije voorraad te hoog. Deze
sluitstap herberekent de cache voor ALLE claim-artikelen, status-onafhankelijk,
en raakt GEEN order-statussen of claims (puur cache).

Sluitstap-volgorde na een voorraad-update:
    1) python update_voorraad.py "<lijst>.xls" --commit
    2) python herallocateer_open_orders.py --commit        # wacht-orders (status)
    3) python herbereken_alle_reserveringen.py --commit     # cache voor alle claims

Gebruik:
  python herbereken_alle_reserveringen.py            # DRY-RUN (alleen tellen)
  python herbereken_alle_reserveringen.py --commit   # roept de RPC's aan

Vereist: import/.env met SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
"""
import sys

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY


def laad_claim_artikelen(sb):
    """Set van fysiek_artikelnr met >=1 actieve voorraad-claim (paginated)."""
    artikelen = set()
    start = 0
    while True:
        r = (sb.table("order_reserveringen")
             .select("fysiek_artikelnr")
             .eq("bron", "voorraad").eq("status", "actief")
             .range(start, start + 999).execute())
        if not r.data:
            break
        for x in r.data:
            if x.get("fysiek_artikelnr"):
                artikelen.add(str(x["fysiek_artikelnr"]))
        if len(r.data) < 1000:
            break
        start += 1000
    return sorted(artikelen)


def main():
    commit = "--commit" in sys.argv
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL/KEY ontbreekt in import/.env")
        sys.exit(1)
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("=" * 64)
    print(f"HERBEREKEN PRODUCT-RESERVERING   ({'COMMIT' if commit else 'DRY-RUN'})")
    print("=" * 64)

    artikelen = laad_claim_artikelen(sb)
    print(f"Artikelen met actieve voorraad-claim: {len(artikelen)}")

    if not commit:
        print("\nDRY-RUN: geen RPC-aanroepen. Draai met --commit om te herberekenen.")
        return

    print("\n--- HERBEREKENEN ---")
    ok = fout = 0
    for n, artnr in enumerate(artikelen, 1):
        try:
            sb.rpc("herbereken_product_reservering",
                   {"p_artikelnr": artnr}).execute()
            ok += 1
        except Exception as e:  # noqa: BLE001
            fout += 1
            print(f"  FOUT artikel {artnr}: {e}")
        if n % 50 == 0:
            print(f"  {n}/{len(artikelen)} verwerkt")

    print(f"\nKLAAR. {ok} artikelen herberekend, {fout} fouten.")


if __name__ == "__main__":
    main()
