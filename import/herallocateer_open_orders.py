"""
Herallocateer open (wachtende) orders tegen de actuele voorraad
===============================================================
Roept de RPC `herallocateer_orderregel(p_order_regel_id)` aan voor elke
niet-maatwerk regel van orders die op voorraad/inkoop wachten. Die RPC is
idempotent en herwaardeert intern ook de orderstatus
(PERFORM herwaardeer_order_status, mig 318) — dus orders die nu wél gedekt
kunnen worden, verlaten automatisch 'Wacht op inkoop'/'Wacht op voorraad'.

Bedoeld als sluitstap na een voorraad-update (update_voorraad.py --commit):
nieuwe voorraad reserveert zich niet vanzelf op reeds-wachtende orders.

Gebruik:
  python herallocateer_open_orders.py            # DRY-RUN (alleen tellen)
  python herallocateer_open_orders.py --commit   # roept de RPC's aan

Vereist: import/.env met SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
"""
import sys

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

# Wachtende statussen waarvan regels opnieuw gealloceerd moeten worden.
WACHT_STATUS = ["Wacht op voorraad", "Wacht op inkoop", "Wacht op maatwerk"]


def laad_wachtende_orders(sb):
    out = []
    start = 0
    while True:
        r = (sb.table("orders").select("id,status")
             .in_("status", WACHT_STATUS)
             .range(start, start + 999).execute())
        if not r.data:
            break
        out.extend(r.data)
        if len(r.data) < 1000:
            break
        start += 1000
    return out


def laad_regels(sb, order_ids):
    """Niet-maatwerk regels met artikelnr voor de gegeven orders."""
    out = []
    for i in range(0, len(order_ids), 100):
        chunk = order_ids[i:i + 100]
        r = (sb.table("order_regels")
             .select("id,order_id,artikelnr,is_maatwerk")
             .in_("order_id", chunk).execute())
        for x in (r.data or []):
            if x.get("is_maatwerk"):
                continue
            if not x.get("artikelnr"):
                continue
            out.append(x)
    return out


def main():
    commit = "--commit" in sys.argv
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL/KEY ontbreekt in import/.env")
        sys.exit(1)
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("=" * 64)
    print(f"HERALLOCATEER OPEN ORDERS   ({'COMMIT' if commit else 'DRY-RUN'})")
    print("=" * 64)

    orders = laad_wachtende_orders(sb)
    from collections import Counter
    per_status = Counter(o["status"] for o in orders)
    print(f"Wachtende orders: {len(orders)}  {dict(per_status)}")

    regels = laad_regels(sb, [o["id"] for o in orders])
    print(f"Te herallocateren regels (niet-maatwerk, met artikelnr): {len(regels)}")

    if not commit:
        print("\nDRY-RUN: geen RPC-aanroepen. Draai met --commit om te herallocateren.")
        return

    print("\n--- HERALLOCATEREN ---")
    ok = fout = 0
    for n, r in enumerate(regels, 1):
        try:
            sb.rpc("herallocateer_orderregel", {"p_order_regel_id": r["id"]}).execute()
            ok += 1
        except Exception as e:  # noqa: BLE001
            fout += 1
            print(f"  FOUT regel {r['id']} (order {r['order_id']}): {e}")
        if n % 50 == 0:
            print(f"  {n}/{len(regels)} verwerkt")

    print(f"\nKLAAR. {ok} regels geherallocateerd, {fout} fouten.")
    print("Controleer een paar orders (bv. ORD-2026-0121): status uit 'Wacht op inkoop'.")


if __name__ == "__main__":
    main()
