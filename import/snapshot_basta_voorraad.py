"""
Veiligheids-snapshot vóór een Basta-voorraad-import.

Dumpt de huidige producten- en rollen-staat naar timestamped CSV's in
import/snapshots/ zodat een import terugdraaibaar is. Read-only: raakt de DB
niet aan.

Gebruik:
  python snapshot_basta_voorraad.py
"""
from datetime import datetime
import csv

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY, BASE_DIR

SNAPSHOT_DIR = BASE_DIR / "import" / "snapshots"


def _dump(sb, tabel, kolommen, pad):
    rows = []
    start = 0
    while True:
        r = sb.table(tabel).select(",".join(kolommen)).range(start, start + 999).execute()
        if not r.data:
            break
        rows.extend(r.data)
        if len(r.data) < 1000:
            break
        start += 1000
    with open(pad, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=kolommen, delimiter=";")
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k) for k in kolommen})
    return len(rows)


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("ERROR: import/.env met SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ontbreekt.")
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    p_prod = SNAPSHOT_DIR / f"producten_{ts}.csv"
    p_rol = SNAPSHOT_DIR / f"rollen_{ts}.csv"
    p_snij = SNAPSHOT_DIR / f"snijplannen_{ts}.csv"

    n_prod = _dump(
        sb, "producten",
        ["artikelnr", "product_type", "voorraad", "gereserveerd", "backorder", "vrije_voorraad"],
        p_prod,
    )
    n_rol = _dump(
        sb, "rollen",
        ["id", "rolnummer", "artikelnr", "status", "lengte_cm", "breedte_cm",
         "oppervlak_m2", "in_magazijn_sinds", "snijden_gestart_op"],
        p_rol,
    )
    n_snij = _dump(
        sb, "snijplannen",
        ["id", "snijplan_nr", "order_regel_id", "rol_id", "status",
         "lengte_cm", "breedte_cm", "afleverdatum"],
        p_snij,
    )
    print(f"Snapshot geschreven:")
    print(f"  {p_prod.name} ({n_prod} producten)")
    print(f"  {p_rol.name} ({n_rol} rollen)")
    print(f"  {p_snij.name} ({n_snij} snijplannen)")


if __name__ == "__main__":
    main()
