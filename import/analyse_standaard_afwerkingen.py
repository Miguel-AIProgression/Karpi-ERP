#!/usr/bin/env python3
"""
Analyseert op-maat planningsspreadsheet en leidt standaard afwerking per kwaliteit af.

Gebruik:
    python import/analyse_standaard_afwerkingen.py <pad_naar_excel.xlsx>

Output:
    - Tabel met tellingen per kwaliteit op de terminal
    - supabase/migrations/104_standaard_afwerkingen.sql  (gereed om te runnen)
"""

import sys
import re
from collections import defaultdict, Counter

import pandas as pd

VALID_AFWERKINGEN = {"B", "FE", "LO", "ON", "SB", "SF", "VO", "ZO"}

# Kwaliteitscodes die we negeren (catch-all / niet relevant)
SKIP_KWALITEITEN = {"MWDI", "WWWW", "MISC"}

# Patroon voor kwaliteit+kleur code, bijv. "BILA14", "CISC15", "SEAO22", "OASI11"
KWAL_KLEUR_RE = re.compile(r"^([A-Z]{4})\d{1,2}$")


def find_header_row(df: pd.DataFrame):
    """Zoek de header-rij en retourneer (rij_index, afw_kolom_index)."""
    for row_idx in range(min(10, len(df))):
        for col_idx in range(len(df.columns)):
            val = df.iat[row_idx, col_idx]
            if isinstance(val, str) and "Afw" in val:
                return row_idx, col_idx
    return None, None


def extract_kwal_code(val: str):
    """
    Geef de 4-letter kwaliteitscode terug uit een kwaliteit+kleur code.
    Bijv. "BILA14" → "BILA", "SEAO22" → "SEAO".
    """
    val = str(val).strip().upper()
    m = KWAL_KLEUR_RE.match(val)
    if m:
        return m.group(1)
    return None


def parse_sheet(df: pd.DataFrame, sheet_name: str) -> list[tuple[str, str]]:
    """
    Extraheer (kwaliteit_code, afwerking) paren uit één sheet.

    Strategie:
    - Vind de header-rij die "Afw." bevat → bepaal de afwerking-kolom.
    - Loop door data-rijen en zoek in elke rij:
        a) afwerking in de afwerking-kolom (of in het kwaliteit+kleur patroon rondom)
        b) kwaliteit+kleur code (patroon [A-Z]{4}\d{1,2}) in kolommen 8-16
    """
    header_row_idx, afw_col = find_header_row(df)
    if afw_col is None:
        print(f"    ! Geen 'Afw.' header gevonden in '{sheet_name}', overgeslagen.")
        return []

    results: list[tuple[str, str]] = []

    for row_idx in range(header_row_idx + 1, len(df)):
        row = df.iloc[row_idx]

        # ── Afwerking ophalen ─────────────────────────────────────
        afw_val = ""
        if afw_col < len(row):
            raw = df.iat[row_idx, afw_col]
            afw_val = str(raw).strip().upper() if pd.notna(raw) else ""

        # Sommige eenvoudige rijen (bovenaan de tab) hebben de afwerking
        # direct na de kwaliteitsnaam in kolom 9; probeer die als fallback.
        if afw_val not in VALID_AFWERKINGEN:
            for try_col in [9, afw_col - 1, afw_col + 1]:
                if 0 <= try_col < len(row):
                    raw2 = df.iat[row_idx, try_col]
                    candidate = str(raw2).strip().upper() if pd.notna(raw2) else ""
                    if candidate in VALID_AFWERKINGEN:
                        afw_val = candidate
                        break

        if afw_val not in VALID_AFWERKINGEN:
            continue

        # ── Kwaliteitscode ophalen ────────────────────────────────
        # Zoek in kolommen 8 t/m 15 naar een [A-Z]{4}\d{1,2} patroon.
        kwal_code: str | None = None
        for col_idx in range(8, min(16, len(row))):
            raw = df.iat[row_idx, col_idx]
            if pd.notna(raw):
                kwal_code = extract_kwal_code(str(raw))
                if kwal_code:
                    break

        # Fallback: artikel-code in kolom 0 (bijv. "BILA14MAATWERK" → "BILA")
        if kwal_code is None:
            raw0 = df.iat[row_idx, 0]
            if pd.notna(raw0):
                art_code = str(raw0).strip().upper()
                if re.match(r"^[A-Z]{4}", art_code) and art_code not in ("FALSE", "TRUE"):
                    kwal_code = art_code[:4]

        if kwal_code and kwal_code not in SKIP_KWALITEITEN:
            results.append((kwal_code, afw_val))

    return results


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    excel_path = sys.argv[1]
    print(f"\nLees: {excel_path}")

    xl = pd.ExcelFile(excel_path)
    print(f"Tabs gevonden ({len(xl.sheet_names)}): {', '.join(xl.sheet_names)}\n")

    all_pairs: list[tuple[str, str]] = []
    for sheet_name in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name=sheet_name, header=None, dtype=str)
        pairs = parse_sheet(df, sheet_name)
        print(f"  {sheet_name:<30} {len(pairs):>4} regels")
        all_pairs.extend(pairs)

    print(f"\nTotaal: {len(all_pairs)} regels over alle tabs.\n")

    if not all_pairs:
        print("Geen bruikbare data gevonden. Controleer het bestandsformaat.")
        sys.exit(1)

    # ── Tel per kwaliteit ─────────────────────────────────────────
    kwal_counters: dict[str, Counter] = defaultdict(Counter)
    for kwal, afw in all_pairs:
        kwal_counters[kwal][afw] += 1

    # ── Toon analyse ──────────────────────────────────────────────
    print(f"{'Kwaliteit':<12} {'Standaard':<10} {'%':>5}   Verdeling")
    print("─" * 60)
    standaard: dict[str, str] = {}
    for kwal in sorted(kwal_counters):
        counter = kwal_counters[kwal]
        total = sum(counter.values())
        best_afw, best_n = counter.most_common(1)[0]
        pct = best_n / total * 100
        verdeling = "  ".join(f"{a}:{n}" for a, n in counter.most_common())
        flag = "  ⚠ gemengd" if pct < 75 else ""
        print(f"  {kwal:<10} {best_afw:<10} {pct:>4.0f}%   {verdeling}{flag}")
        standaard[kwal] = best_afw

    # ── Genereer SQL migratie ─────────────────────────────────────
    sql_values = "\n".join(
        f"  ('{kwal}', '{afw}'){',' if i < len(standaard) - 1 else ''}"
        for i, (kwal, afw) in enumerate(sorted(standaard.items()))
    )

    sql = f"""\
-- Standaard afwerking per kwaliteit, afgeleid uit planningsdata.
-- Gegenereerd door import/analyse_standaard_afwerkingen.py
-- Gebruik UPSERT zodat handmatige aanpassingen later overschreven worden.

INSERT INTO kwaliteit_standaard_afwerking (kwaliteit_code, afwerking_code)
VALUES
{sql_values}
ON CONFLICT (kwaliteit_code)
  DO UPDATE SET afwerking_code = EXCLUDED.afwerking_code;
"""

    out_path = "supabase/migrations/104_standaard_afwerkingen.sql"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(sql)

    print(f"\nSQL opgeslagen → {out_path}")
    print("Controleer de ⚠-regels handmatig voor je de migratie runt.\n")


if __name__ == "__main__":
    main()
