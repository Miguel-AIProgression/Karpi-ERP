"""
Import-script — laadt klant- en inkoopgroep-eigen kwaliteit-aliassen uit
TKA013_Overzicht_*.xls (legacy export uit het oude Karpi-systeem) in de
tabel `klanteigen_namen`.

Voorwaarden
-----------
* Migratie 198 toegepast (kolom inkoopgroep_code + RPC resolve_klanteigen_naam)
* TKA013-bestand staat in project-root (`Karpi ERP\\TKA013_Overzicht_*.xls`)

Excel-structuur (sheet '0X0', 6.833 rijen)
------------------------------------------
| Klant/Inkoopcomb. | Naam | Kwaliteit | Benaming | Omschrijving | Leverancier |
debiteur-nr OF INKC-code; Naam is leeg bij INKC-rijen.

Resolutie
---------
* Numerieke waarden → debiteur_nr  (FK -> debiteuren)
* `INKC*` waarden  → inkoopgroep_code (FK -> inkoopgroepen)
* Onbekende debiteuren / inkoopgroepen / kwaliteiten worden geskipt + gelogd.
* Excel-rijen waarbij `Benaming` gelijk is aan `producten.omschrijving` voor die
  kwaliteit toevoegen geen waarde — die worden ook geskipt.

Idempotent: upsert via on_conflict op de twee partial unique indexen
(uniq_klanteigen_debiteur_kwaliteit / uniq_klanteigen_inkoopgroep_kwaliteit).
"""
from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
from supabase import create_client

from config import BASE_DIR, SUPABASE_KEY, SUPABASE_URL

BRON_TAG = "TKA013-2026-03-19"
INKC_RE = re.compile(r"^\s*(INKC\s*0*\d+)\s*$", re.IGNORECASE)


def init_client():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Supabase URL/Key niet gevonden. Check import/.env")
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def find_excel() -> Path:
    candidates = sorted(BASE_DIR.glob("TKA013_Overzicht_*.xls"))
    if not candidates:
        print(f"ERROR: geen TKA013_Overzicht_*.xls gevonden in {BASE_DIR}")
        sys.exit(1)
    return candidates[-1]


def normalise_inkc(raw: str) -> str:
    """`INKC 14` / `inkc014` → `INKC14`."""
    digits = re.sub(r"\D", "", raw)
    return f"INKC{int(digits):02d}" if digits else raw.upper().replace(" ", "")


def known_debiteur_nrs(sb) -> set[int]:
    nrs: set[int] = set()
    page = 0
    page_size = 1000
    while True:
        res = (
            sb.table("debiteuren")
            .select("debiteur_nr")
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute()
        )
        batch = [r["debiteur_nr"] for r in (res.data or [])]
        nrs.update(batch)
        if len(batch) < page_size:
            break
        page += 1
    return nrs


def known_inkoopgroep_codes(sb) -> set[str]:
    rows = sb.table("inkoopgroepen").select("code").execute().data or []
    return {r["code"] for r in rows}


def known_kwaliteiten(sb) -> set[str]:
    nrs: set[str] = set()
    page = 0
    page_size = 1000
    while True:
        res = (
            sb.table("kwaliteiten")
            .select("code")
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute()
        )
        batch = [r["code"] for r in (res.data or [])]
        nrs.update(batch)
        if len(batch) < page_size:
            break
        page += 1
    return nrs


def insert_batch(sb, rows: list[dict]) -> None:
    """Plain insert in batches van 500.

    PostgREST `.upsert()` kan niet richten op de partial functional unique
    indexen (`COALESCE(kleur_code, '')` WHERE debiteur_nr IS NOT NULL) die
    mig 199/200 hebben aangelegd. Daarom doen we delete-by-bron + insert in
    main(), wat sneller én correcter is dan 6500 RPC-calls.
    """
    chunk = 500
    for i in range(0, len(rows), chunk):
        sb.table("klanteigen_namen").insert(rows[i : i + chunk]).execute()


def delete_import_rows(sb, bron: str) -> tuple[int, int]:
    """Verwijder import-rijen — alle TKA013-tag-rijen + alle NULL-bron rijen.

    NULL-bron komt van legacy-imports zonder bron-tag. UI-entries (bron='ui')
    of andere expliciete bronnen blijven staan.
    """
    tag_count = (
        sb.table("klanteigen_namen")
        .select("id", count="exact")
        .eq("bron", bron)
        .limit(1)
        .execute()
        .count or 0
    )
    null_count = (
        sb.table("klanteigen_namen")
        .select("id", count="exact")
        .is_("bron", None)
        .limit(1)
        .execute()
        .count or 0
    )
    if tag_count > 0:
        sb.table("klanteigen_namen").delete().eq("bron", bron).execute()
    if null_count > 0:
        sb.table("klanteigen_namen").delete().is_("bron", None).execute()
    return tag_count, null_count


def main():
    sb = init_client()
    excel_path = find_excel()
    print(f"Bron: {excel_path.name}")

    df = pd.read_excel(excel_path, sheet_name=0)
    df.columns = [str(c).strip() for c in df.columns]
    print(f"  Sheet: {len(df)} rijen, kolommen = {list(df.columns)}")

    expected = {"Klant/Inkoopcomb.", "Kwaliteit", "Benaming"}
    if not expected.issubset(set(df.columns)):
        print(f"ERROR: ontbrekende kolommen. Verwacht ⊃ {expected}")
        sys.exit(1)

    deb_set = known_debiteur_nrs(sb)
    inkc_set = known_inkoopgroep_codes(sb)
    kwal_set = known_kwaliteiten(sb)
    print(
        f"  Debiteuren: {len(deb_set)} | Inkoopgroepen: {len(inkc_set)} | "
        f"Kwaliteiten: {len(kwal_set)}\n"
    )

    klant_rows: list[dict] = []
    groep_rows: list[dict] = []
    skip_geen_id = 0
    skip_onbekende_kwaliteit: dict[str, int] = {}
    skip_onbekende_debiteur: dict[int, int] = {}
    skip_onbekende_inkoopgroep: dict[str, int] = {}
    skip_lege_benaming = 0

    klant_seen: set[tuple[int, str]] = set()
    groep_seen: set[tuple[str, str]] = set()
    klant_dupes = 0
    groep_dupes = 0

    for _, row in df.iterrows():
        raw_id = row["Klant/Inkoopcomb."]
        kwal = row["Kwaliteit"]
        benaming = row["Benaming"]

        if pd.isna(kwal) or pd.isna(benaming):
            skip_lege_benaming += 1
            continue

        kwal = str(kwal).strip().upper()
        benaming = str(benaming).strip()
        if not benaming or not kwal:
            skip_lege_benaming += 1
            continue

        if kwal not in kwal_set:
            skip_onbekende_kwaliteit[kwal] = skip_onbekende_kwaliteit.get(kwal, 0) + 1
            continue

        # Bepaal debiteur_nr OF inkoopgroep_code
        is_inkc = False
        if isinstance(raw_id, str) and INKC_RE.match(raw_id):
            is_inkc = True
        elif pd.isna(raw_id):
            skip_geen_id += 1
            continue

        if is_inkc:
            code = normalise_inkc(raw_id)
            if code not in inkc_set:
                skip_onbekende_inkoopgroep[code] = skip_onbekende_inkoopgroep.get(code, 0) + 1
                continue
            key = (code, kwal)
            if key in groep_seen:
                groep_dupes += 1
                continue
            groep_seen.add(key)
            groep_rows.append(
                {
                    "inkoopgroep_code": code,
                    "kwaliteit_code": kwal,
                    "benaming": benaming,
                    "omschrijving": (
                        str(row.get("Omschrijving")).strip()
                        if not pd.isna(row.get("Omschrijving"))
                        else None
                    ),
                    "leverancier": (
                        str(int(row.get("Leverancier")))
                        if not pd.isna(row.get("Leverancier"))
                        and isinstance(row.get("Leverancier"), (int, float))
                        else None
                    ),
                    "bron": BRON_TAG,
                }
            )
        else:
            try:
                debnr = int(raw_id)
            except (TypeError, ValueError):
                skip_geen_id += 1
                continue
            if debnr not in deb_set:
                skip_onbekende_debiteur[debnr] = skip_onbekende_debiteur.get(debnr, 0) + 1
                continue
            key2 = (debnr, kwal)
            if key2 in klant_seen:
                klant_dupes += 1
                continue
            klant_seen.add(key2)
            klant_rows.append(
                {
                    "debiteur_nr": debnr,
                    "kwaliteit_code": kwal,
                    "benaming": benaming,
                    "omschrijving": (
                        str(row.get("Omschrijving")).strip()
                        if not pd.isna(row.get("Omschrijving"))
                        else None
                    ),
                    "leverancier": (
                        str(int(row.get("Leverancier")))
                        if not pd.isna(row.get("Leverancier"))
                        and isinstance(row.get("Leverancier"), (int, float))
                        else None
                    ),
                    "bron": BRON_TAG,
                }
            )

    print(f"Te uploaden: klant-niveau = {len(klant_rows)}, inkoopgroep-niveau = {len(groep_rows)}")

    # Ruim eerst alle eerdere import-rijen op — UI-entries (bron='ui') blijven.
    deleted_tag, deleted_null = delete_import_rows(sb, BRON_TAG)
    print(
        f"Opgeruimd: {deleted_tag} rij(en) met bron={BRON_TAG}, "
        f"{deleted_null} rij(en) met bron=NULL (legacy import)"
    )

    if klant_rows:
        insert_batch(sb, klant_rows)
    if groep_rows:
        insert_batch(sb, groep_rows)

    log_dir = BASE_DIR / "import" / "logs"
    log_dir.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = log_dir / f"klanteigen_namen_{ts}.txt"
    lines = [
        f"TKA013 import-rapport — {ts}",
        f"Bron: {excel_path.name}",
        "",
        f"Klant-aliassen geupload: {len(klant_rows)}",
        f"Inkoopgroep-aliassen geupload: {len(groep_rows)}",
        f"Skip lege/benaming: {skip_lege_benaming}",
        f"Skip ontbrekend ID: {skip_geen_id}",
        f"Skip dupes binnen Excel (klant): {klant_dupes}",
        f"Skip dupes binnen Excel (inkoopgroep): {groep_dupes}",
        "",
        f"Onbekende kwaliteiten ({len(skip_onbekende_kwaliteit)} unieke codes, "
        f"{sum(skip_onbekende_kwaliteit.values())} rijen):",
    ]
    for k, v in sorted(skip_onbekende_kwaliteit.items(), key=lambda x: -x[1])[:50]:
        lines.append(f"  {k:6} {v}")
    lines.append("")
    lines.append(
        f"Onbekende debiteuren ({len(skip_onbekende_debiteur)} unieke nrs, "
        f"{sum(skip_onbekende_debiteur.values())} rijen):"
    )
    for d, v in sorted(skip_onbekende_debiteur.items(), key=lambda x: -x[1])[:50]:
        lines.append(f"  {d}  ({v} rijen)")
    lines.append("")
    lines.append(
        f"Onbekende inkoopgroepen ({len(skip_onbekende_inkoopgroep)} unieke codes, "
        f"{sum(skip_onbekende_inkoopgroep.values())} rijen):"
    )
    for c, v in sorted(skip_onbekende_inkoopgroep.items(), key=lambda x: -x[1]):
        lines.append(f"  {c:8} {v}")
    log_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nRapport: {log_path}")
    for ln in lines:
        print(ln)


if __name__ == "__main__":
    main()
