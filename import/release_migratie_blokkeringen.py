"""DAGELIJKS: geef migratie-blokkeringen vrij waarvan de order inmiddels gesneden is.

Leest de nieuwste snijlijst-versie(s), bouwt de gesneden-set en zet bijbehorende
migratie_blokkering-rijen op status='vrijgegeven'. Idempotent: raakt alleen
status='actief'-rijen aan.

Aanroep:
    python release_migratie_blokkeringen.py            # dry-run (toont aantal)
    python release_migratie_blokkeringen.py --commit   # voer release uit
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY
from reserveer_maatwerk_migratie import (
    BASE,
    VERSIE_GLOB,
    _fetch_alle,
    bouw_gesneden_set,
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true",
                    help="Voer de release daadwerkelijk uit (anders dry-run).")
    args = ap.parse_args()

    versie_paths = sorted(BASE.glob(VERSIE_GLOB))
    if not versie_paths:
        sys.exit(f"Geen versiebestanden gevonden ({VERSIE_GLOB}) in {BASE}")
    gesneden = bouw_gesneden_set(versie_paths)
    print("Gesneden in snijlijsten:", len(gesneden))

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    # Pagineer: bij de eerste runs staan er ~1462 actieve blokkeringen — meer dan
    # de supabase-py default van 1000, dus een ongepagineerde fetch zou rijen missen.
    actief = _fetch_alle(
        sb, "migratie_blokkering", "id, oud_ordernr, oud_orderregel",
        lambda q: q.eq("status", "actief"),
    )

    vrij_ids = [
        rij["id"] for rij in actief
        if (rij["oud_ordernr"], rij["oud_orderregel"]) in gesneden
    ]
    print(f"Vrij te geven: {len(vrij_ids)} van {len(actief)} actieve blokkeringen")

    if not args.commit:
        print("DRY-RUN — niets gewijzigd. Gebruik --commit.")
        return

    # ISO-timestamp uit Python: PostgREST stuurt de waarde als string door, en
    # Postgres cast het literal 'now()' NIET naar timestamptz (alleen 'now' wel).
    nu_iso = datetime.now(timezone.utc).isoformat()
    for i in range(0, len(vrij_ids), 500):
        batch = vrij_ids[i:i + 500]
        sb.table("migratie_blokkering").update(
            {"status": "vrijgegeven", "vrijgegeven_op": nu_iso}
        ).in_("id", batch).execute()
    print("Klaar:", len(vrij_ids), "vrijgegeven.")


if __name__ == "__main__":
    main()
