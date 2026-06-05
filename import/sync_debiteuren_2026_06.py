"""
Sync debiteuren op basis van 'Debiteurenlijst per 02-6-2026.xlsx'.

Acties:
  1. 36 nieuwe debiteuren invoegen (in Excel, niet in DB)
  2.  4 debiteuren DB=Actief → Inactief (Excel Blokkade=J)
  3.  3 debiteuren DB=Inactief → Actief  (Excel Blokkade=N)
  4. 99001 FLOORPASSION WEBSHOP: interne pseudo-debiteur, NIET aangeraakt
     (niet in Excel maar bewust aangemaakt via mig 091)
  5. 862509 VME zit in debiteuren_blokkeer_lijst als 'Verwijderd op verzoek'
     maar Excel heeft Blokkade=N → wordt samen met de andere 2 op Actief gezet,
     blokkeer_lijst is informatief, niet technisch blokkerend.
"""
import io
import sys
import json
import re
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import pandas as pd
from supabase import create_client

sys.path.insert(0, str(Path(__file__).parent))
from config import BASE_DIR, SUPABASE_URL, SUPABASE_KEY

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Supabase URL/Key niet gevonden. Check import/.env")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

XLSX_PATH = BASE_DIR / "Debiteurenlijst per 02-6-2026.xlsx"

# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------

def build_verteg_map() -> dict[str, str]:
    """naam (lowercase) → code"""
    res = sb.table("vertegenwoordigers").select("naam,code").execute()
    return {r["naam"].lower(): r["code"] for r in res.data}

def build_inkoopgroep_map() -> dict[str, str]:
    """inkc-nummer als str → code  (bijv. '57' → 'INKC57')"""
    res = sb.table("inkoopgroepen").select("code").execute()
    m = {}
    for r in res.data:
        code = r["code"]  # bijv. 'INKC57'
        num = re.sub(r"[^0-9]", "", code)  # '57'
        if num:
            m[num] = code
    return m

def fetch_db_nrs() -> set[int]:
    rows = []
    offset = 0
    while True:
        res = sb.table("debiteuren").select("debiteur_nr").range(offset, offset + 999).execute()
        rows.extend(res.data)
        if len(res.data) < 1000:
            break
        offset += 1000
    return {r["debiteur_nr"] for r in rows}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def clean(val):
    """Geef None terug voor lege/NaN waarden, anders str stripped."""
    if val is None:
        return None
    if isinstance(val, float):
        import math
        if math.isnan(val):
            return None
        return str(int(val)) if val == int(val) else str(val)
    s = str(val).strip()
    return s if s else None

def extract_prijslijst(raw: str | None) -> str | None:
    if not raw:
        return None
    m = re.match(r"^(\d{4})", raw.strip())
    return m.group(1) if m else None

def extract_inkoopgroep(raw: str | None, inkmap: dict) -> str | None:
    """'57 - MUSTERRING' → 'INKC57'"""
    if not raw:
        return None
    m = re.match(r"^(\d+)", raw.strip())
    if not m:
        return None
    return inkmap.get(m.group(1))

def map_verteg(raw: str | None, vmap: dict) -> str | None:
    if not raw:
        return None
    return vmap.get(raw.strip().lower())

def blokkade_to_status(val) -> str:
    return "Inactief" if str(val).strip().upper() == "J" else "Actief"

def row_to_record(r: pd.Series, vmap: dict, inkmap: dict) -> dict:
    return {
        "debiteur_nr":    int(r["Debiteur"]),
        "naam":           clean(r.get("Naam")),
        "status":         blokkade_to_status(r.get("Blokkade", "N")),
        "adres":          clean(r.get("Standaard-adres")),
        "postcode":       clean(r.get("Postcd")),
        "plaats":         clean(r.get("Plaats")),
        "land":           clean(r.get("Land")),
        "telefoon":       clean(r.get("Tel.")),
        "fact_naam":      clean(r.get("Naam (fact.adres)")),
        "fact_adres":     clean(r.get("Adres (fact)")),
        "fact_postcode":  clean(r.get("Postc.")),
        "fact_plaats":    clean(r.get("Plaats (fact)")),
        "email_factuur":  clean(r.get("Mailadres (Fact.)")),
        "email_overig":   clean(r.get("Mailadres (overig)")),
        "betaler":        clean(r.get("Betaler")),
        "betaalconditie": clean(r.get("Conditie")),
        "btw_nummer":     clean(r.get("BTW-nummer")),
        "gln_bedrijf":    clean(r.get("EAN-Code")),
        "rayon":          clean(r.get("Rayon")),
        "rayon_naam":     clean(r.get("Rayonnaam")),
        "vertegenw_code": map_verteg(clean(r.get("Vertegenwoordiger")), vmap),
        "prijslijst_nr":  extract_prijslijst(clean(r.get("Prijslijst"))),
        "korting_pct":    float(r["% Deb.kort"]) if pd.notna(r.get("% Deb.kort")) else None,
        "inkoopgroep_code": extract_inkoopgroep(clean(r.get("Inkooporg.")), inkmap),
    }

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("Laad Excel...")
    df = pd.read_excel(XLSX_PATH, header=1)
    df["Debiteur"] = pd.to_numeric(df["Debiteur"], errors="coerce")
    df = df.dropna(subset=["Debiteur"])
    df["Debiteur"] = df["Debiteur"].astype(int)

    vmap   = build_verteg_map()
    inkmap = build_inkoopgroep_map()
    db_nrs = fetch_db_nrs()
    xlsx_nrs = set(df["Debiteur"].tolist())

    # -----------------------------------------------------------------------
    # 1. Nieuwe debiteuren invoegen
    # -----------------------------------------------------------------------
    nieuw_nrs = xlsx_nrs - db_nrs
    df_nieuw  = df[df["Debiteur"].isin(nieuw_nrs)]
    records   = [row_to_record(r, vmap, inkmap) for _, r in df_nieuw.iterrows()]

    print(f"\n=== STAP 1: {len(records)} nieuwe debiteuren invoegen ===")
    inserted = 0
    errors   = []
    for rec in records:
        try:
            sb.table("debiteuren").insert(rec).execute()
            print(f"  ✓ {rec['debiteur_nr']} — {rec['naam']}")
            inserted += 1
        except Exception as e:
            msg = f"  ✗ {rec['debiteur_nr']} — {rec['naam']}: {e}"
            print(msg)
            errors.append(msg)

    print(f"  Ingevoegd: {inserted}, fouten: {len(errors)}")

    # -----------------------------------------------------------------------
    # 2. DB=Actief → Inactief (Excel Blokkade=J)
    # -----------------------------------------------------------------------
    blokkeer_nrs = [330957, 330958, 640510, 783000]
    print(f"\n=== STAP 2: {len(blokkeer_nrs)} debiteuren → Inactief ===")
    for nr in blokkeer_nrs:
        try:
            res = sb.table("debiteuren").update({"status": "Inactief"}).eq("debiteur_nr", nr).execute()
            row = df[df["Debiteur"] == nr]
            naam = row["Naam"].values[0] if not row.empty else "?"
            print(f"  ✓ {nr} — {naam} → Inactief")
        except Exception as e:
            print(f"  ✗ {nr}: {e}")

    # -----------------------------------------------------------------------
    # 3. DB=Inactief → Actief (Excel Blokkade=N)
    # -----------------------------------------------------------------------
    activeer_nrs = [101140, 831800, 862509]
    print(f"\n=== STAP 3: {len(activeer_nrs)} debiteuren → Actief ===")
    for nr in activeer_nrs:
        try:
            sb.table("debiteuren").update({"status": "Actief"}).eq("debiteur_nr", nr).execute()
            row = df[df["Debiteur"] == nr]
            naam = row["Naam"].values[0] if not row.empty else "?"
            extra = " ⚠ was in blokkeer_lijst (Verwijderd op verzoek 2026-05-29)" if nr == 862509 else ""
            print(f"  ✓ {nr} — {naam} → Actief{extra}")
        except Exception as e:
            print(f"  ✗ {nr}: {e}")

    # -----------------------------------------------------------------------
    # 4. FLOORPASSION WEBSHOP (99001) — overgeslagen
    # -----------------------------------------------------------------------
    print("\n=== STAP 4: 99001 FLOORPASSION WEBSHOP ===")
    print("  → Overgeslagen. Interne pseudo-debiteur (mig 091), niet in Excel maar bewust aangemaakt.")

    # -----------------------------------------------------------------------
    # Samenvatting
    # -----------------------------------------------------------------------
    print("\n=== KLAAR ===")
    print(f"  Nieuw ingevoegd:    {inserted}")
    print(f"  Gezet op Inactief:  {len(blokkeer_nrs)}")
    print(f"  Gezet op Actief:    {len(activeer_nrs)}")
    print(f"  Fouten:             {len(errors)}")
    if errors:
        print("  Foutdetails:")
        for e in errors:
            print(f"    {e}")

if __name__ == "__main__":
    main()
