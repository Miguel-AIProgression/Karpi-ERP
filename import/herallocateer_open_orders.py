"""
Heralloceer alle OPEN orderregels zodat ze zich opnieuw tegen de actuele
voorraad reserveren. Draai NA een voorraad-update (update_voorraad.py).

De RPC herallocateer_orderregel is idempotent en slaat zelf maatwerk,
admin-pseudo, te_leveren<=0 en eind-status-orders over (mig 145/272). De
DB-triggers herberekenen daarna producten.gereserveerd + vrije_voorraad.

Gebruik:
  python herallocateer_open_orders.py            # DRY-RUN (telt alleen)
  python herallocateer_open_orders.py --commit   # roept de RPC per regel aan
"""
import sys

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

EINDSTATUSSEN = {"Verzonden", "Geannuleerd", "Klaar voor verzending"}


def fetch_open_order_ids(sb):
    """Order-id's die NIET in een eindstatus staan."""
    ids = []
    start = 0
    while True:
        r = sb.table("orders").select("id,status").range(start, start + 999).execute()
        if not r.data:
            break
        ids += [o["id"] for o in r.data if (o["status"] or "") not in EINDSTATUSSEN]
        if len(r.data) < 1000:
            break
        start += 1000
    return ids


def fetch_te_herallocateren_regels(sb, open_order_ids):
    """Orderregel-id's met te_leveren>0, een artikelnr en geen maatwerk."""
    regel_ids = []
    for i in range(0, len(open_order_ids), 100):
        chunk = open_order_ids[i:i + 100]
        r = (sb.table("order_regels")
             .select("id,artikelnr,te_leveren,is_maatwerk")
             .in_("order_id", chunk).gt("te_leveren", 0).execute())
        for x in r.data:
            if x.get("artikelnr") and not x.get("is_maatwerk"):
                regel_ids.append(x["id"])
    return regel_ids


def main():
    commit = "--commit" in sys.argv
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("ERROR: import/.env ontbreekt (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).")
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    open_ids = fetch_open_order_ids(sb)
    regel_ids = fetch_te_herallocateren_regels(sb, open_ids)
    print(f"Open orders: {len(open_ids)}  |  te herallokeren orderregels: {len(regel_ids)}")

    if not commit:
        print("DRY-RUN: geen RPC-aanroepen. Draai met --commit om te schrijven.")
        return

    fouten = 0
    for n, rid in enumerate(regel_ids, 1):
        try:
            sb.rpc("herallocateer_orderregel", {"p_order_regel_id": rid}).execute()
        except Exception as e:  # noqa: BLE001 — best-effort, log en ga door
            fouten += 1
            print(f"  FOUT regel {rid}: {e}")
        if n % 100 == 0:
            print(f"  {n}/{len(regel_ids)}")
    print(f"KLAAR. {len(regel_ids) - fouten} ok, {fouten} fouten.")


if __name__ == "__main__":
    main()
