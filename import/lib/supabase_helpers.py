"""Gedeelde Supabase-batchhelpers voor import-scripts.

Eén bron van waarheid voor batch-schrijven/-lezen, zodat de ~14 lokaal
gekopieerde `upsert_batch`-varianten verdwijnen en de stille `.insert()`-
afwijking (zie `reimport_orders_2026.py`) expliciet wordt via `mode="insert"`.

`sb` is altijd een expliciete eerste parameter (geen verborgen globale) —
dat maakt de helpers testbaar met een mock-client.

Draai import-scripts vanuit `import/` als working dir; dan werkt
`from lib.supabase_helpers import upsert_batch`.
"""


def create_supabase_client():
    """Maak een Supabase-client uit import/.env (service_role key, bypasst RLS).

    Vervangt het ~13× herhaalde init-blok in de import-scripts. Valideert dat
    de env-waarden aanwezig zijn i.p.v. stil een lege client te maken.
    """
    from supabase import create_client
    from config import SUPABASE_URL, SUPABASE_KEY

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ontbreken — "
            "controleer import/.env"
        )
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def upsert_batch(sb, table, records, batch_size=500, on_conflict=None, *,
                 mode="upsert", progress=True):
    """Schrijf records in batches naar `table`.

    mode="upsert" (default) → `.upsert()`, met `on_conflict` indien opgegeven.
    mode="insert"           → `.insert()` (pure insert; faalt bij sleutel-conflict).

    De `mode="insert"`-tak bestaat zodat `reimport_orders_2026.py` zijn
    afwijkende `.insert()`-gedrag expliciet kan aanroepen i.p.v. het te
    verstoppen onder de naam "upsert".
    """
    total = len(records)
    for i in range(0, total, batch_size):
        batch = records[i:i + batch_size]
        q = sb.table(table)
        if mode == "insert":
            q.insert(batch).execute()
        elif mode == "upsert":
            kwargs = {"on_conflict": on_conflict} if on_conflict else {}
            q.upsert(batch, **kwargs).execute()
        else:
            raise ValueError(f"onbekende mode: {mode!r} (verwacht 'upsert' of 'insert')")
        if progress:
            print(f"  {table}: {min(i + batch_size, total)}/{total}")


def insert_batch(sb, table, records, batch_size=500, *, progress=True):
    """Alias voor `upsert_batch(..., mode='insert')` — pure insert in batches."""
    upsert_batch(sb, table, records, batch_size=batch_size,
                 mode="insert", progress=progress)


def batch_delete(sb, table, field, ids, size=200):
    """Verwijder rijen waar `field IN ids`, in chunks (overgenomen uit
    sync_inkoopoverzicht_2026_06.py)."""
    for i in range(0, len(ids), size):
        sb.table(table).delete().in_(field, ids[i:i + size]).execute()


def batch_select(sb, table, fields, in_field, ids, size=200):
    """Selecteer rijen waar `in_field IN ids`, in chunks, en plak de data
    aan elkaar (overgenomen uit sync_inkoopoverzicht_2026_06.py)."""
    rows = []
    for i in range(0, len(ids), size):
        res = sb.table(table).select(fields).in_(in_field, ids[i:i + size]).execute()
        rows.extend(res.data)
    return rows
