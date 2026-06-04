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
from pathlib import Path

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY
from reserveer_maatwerk_migratie import BASE, VERSIE_GLOB, bouw_gesneden_set


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    versie_paths = sorted(BASE.glob(VERSIE_GLOB))
    if not versie_paths:
        sys.exit(f"Geen versiebestanden gevonden ({VERSIE_GLOB}) in {BASE}")
    gesneden = bouw_gesneden_set(versie_paths)
    print("Gesneden in snijlijsten:", len(gesneden))

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    actief = sb.table("migratie_blokkering").select(
        "id, oud_ordernr, oud_orderregel").eq("status", "actief").execute().data or []

    vrij_ids = [
        rij["id"] for rij in actief
        if (rij["oud_ordernr"], rij["oud_orderregel"]) in gesneden
    ]
    print(f"Vrij te geven: {len(vrij_ids)} van {len(actief)} actieve blokkeringen")

    if not args.commit:
        print("DRY-RUN — niets gewijzigd. Gebruik --commit.")
        return

    for i in range(0, len(vrij_ids), 500):
        batch = vrij_ids[i:i + 500]
        sb.table("migratie_blokkering").update(
            {"status": "vrijgegeven", "vrijgegeven_op": "now()"}
        ).in_("id", batch).execute()
    print("Klaar:", len(vrij_ids), "vrijgegeven.")


if __name__ == "__main__":
    main()
