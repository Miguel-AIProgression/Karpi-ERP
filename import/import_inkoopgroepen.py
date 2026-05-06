"""
Seed-script — koppelt debiteuren aan inkoopgroepen op basis van de 10
INKC*.xlsx bronbestanden in de project-root (zelfde map als CLAUDE.md).

Vereist dat migratie 189 is toegepast (tabel `inkoopgroepen` + kolom
`debiteuren.inkoopgroep_code`).

Per bestand:
  * Code = `INKC{nn}` afgeleid uit de bestandsnaam
  * Debiteur_nrs = eerste kolom die "debiteur"-achtig heet, of de eerste
    kolom met overwegend integers in het 1xxxxx-bereik
  * `UPDATE debiteuren SET inkoopgroep_code = '<code>' WHERE debiteur_nr = ?`

Idempotent — re-runnable. Output: per groep aantal succesvol gekoppeld
plus eventuele niet-gevonden debiteur_nrs.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pandas as pd
from supabase import create_client

from config import BASE_DIR, SUPABASE_KEY, SUPABASE_URL

CODE_RE = re.compile(r"^INKC\s*0*(\d+)", re.IGNORECASE)
CANDIDATE_COLS = ("debiteur", "debnr", "debiteurnr", "deb_nr", "klantnr", "klant")


def init_client():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Supabase URL/Key niet gevonden. Check import/.env")
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def code_from_filename(name: str) -> str | None:
    """`INKC02 BEGROS.xlsx` -> `INKC02`; `INKC 14 - FACHHANDELSRING.xlsx` -> `INKC14`."""
    m = CODE_RE.match(name)
    if not m:
        return None
    return f"INKC{int(m.group(1)):02d}"


def find_debiteur_column(df: pd.DataFrame) -> str | None:
    # 1) probeer een kolomnaam die "debiteur" bevat
    for col in df.columns:
        norm = str(col).strip().lower().replace(" ", "").replace(".", "")
        if any(c in norm for c in CANDIDATE_COLS):
            return col
    # 2) val terug op eerste kolom met overwegend integers in 1xxxxx-bereik
    for col in df.columns:
        ints = pd.to_numeric(df[col], errors="coerce").dropna()
        if len(ints) == 0:
            continue
        in_range = ints[(ints >= 100000) & (ints < 1000000)]
        if len(in_range) / max(len(ints), 1) > 0.7:
            return col
    return None


def parse_debiteur_nrs(path: Path) -> list[int]:
    df = pd.read_excel(path)
    col = find_debiteur_column(df)
    if col is None:
        print(f"  ⚠ {path.name}: geen debiteur-kolom gevonden — overgeslagen")
        return []
    nrs = pd.to_numeric(df[col], errors="coerce").dropna().astype(int).tolist()
    # dedupe + alleen geldig bereik
    return sorted({n for n in nrs if 100000 <= n < 1000000})


def known_codes(sb) -> set[str]:
    rows = sb.table("inkoopgroepen").select("code").execute().data or []
    return {r["code"] for r in rows}


def known_debiteur_nrs(sb) -> set[int]:
    """Pagineer alle bestaande debiteur_nrs op (max 1000 per request)."""
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


def link_groep(sb, code: str, deb_nrs: list[int], existing: set[int]) -> tuple[int, list[int]]:
    """Koppelt elk geldig debiteur_nr aan de groep. Retourneert (gekoppeld, missing)."""
    valid = [n for n in deb_nrs if n in existing]
    missing = [n for n in deb_nrs if n not in existing]
    # Eén bulk-update via .in_() — zet inkoopgroep_code voor alle valid nrs
    if valid:
        sb.table("debiteuren").update({"inkoopgroep_code": code}).in_(
            "debiteur_nr", valid
        ).execute()
    return len(valid), missing


def main():
    sb = init_client()
    codes = known_codes(sb)
    if not codes:
        print("ERROR: tabel inkoopgroepen is leeg — pas eerst migratie 189 toe")
        sys.exit(1)

    print(f"Geseede inkoopgroepen in DB: {sorted(codes)}\n")
    deb_set = known_debiteur_nrs(sb)
    print(f"Debiteuren in DB: {len(deb_set)}\n")

    files = sorted(BASE_DIR.glob("INK*.xlsx"))
    if not files:
        print(f"Geen INK*.xlsx gevonden in {BASE_DIR}")
        sys.exit(1)

    summary: list[tuple[str, str, int, int]] = []  # (code, naam, gekoppeld, missing)
    for path in files:
        code = code_from_filename(path.name)
        if code is None:
            print(f"⚠ {path.name}: geen INKC-code in bestandsnaam — overgeslagen")
            continue
        if code not in codes:
            print(f"⚠ {path.name} → {code}: niet in tabel inkoopgroepen — overgeslagen")
            continue

        nrs = parse_debiteur_nrs(path)
        gekoppeld, missing = link_groep(sb, code, nrs, deb_set)
        print(
            f"{code} ({path.stem}): {gekoppeld}/{len(nrs)} gekoppeld"
            + (f", {len(missing)} debiteur_nrs niet in DB" if missing else "")
        )
        if missing:
            sample = ", ".join(str(n) for n in missing[:10])
            extra = f" ...(+{len(missing) - 10} meer)" if len(missing) > 10 else ""
            print(f"   Niet-gevonden: {sample}{extra}")
        summary.append((code, path.stem, gekoppeld, len(missing)))

    print("\n--- Samenvatting ---")
    for code, naam, gekoppeld, missing in summary:
        print(f"  {code:8} {gekoppeld:4} gekoppeld   {missing:4} missing   {naam}")

    # Validatie tegen DB
    print("\nValidatie tegen DB (huidige aantal_leden per groep):")
    res = (
        sb.table("inkoopgroepen_met_aantal_leden")
        .select("code, naam, aantal_leden")
        .order("code")
        .execute()
    )
    for row in res.data or []:
        print(f"  {row['code']:8} {row['aantal_leden']:4}   {row['naam']}")


if __name__ == "__main__":
    main()
