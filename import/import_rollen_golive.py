"""
ÉÉNMALIGE rollen-nulstand (go-live) — fysieke rollen uit Basta inladen.

Leest 'Rollenvoorraad <datum>.xlsx' en zet tabel `rollen` gelijk aan de
fysieke werkelijkheid:
  - missende rol-producten worden aangemaakt (product_type='rol') + gerapporteerd;
  - elke rol uit het bestand komt binnen als status='beschikbaar' (bestaande
    reservering/snijplan-holds worden gewist — maatwerk wordt via een aparte
    route herladen);
  - in_magazijn_sinds wordt uit 'Ltste Wijz' (YYYYMMDD) gezet (FIFO, ADR-0021);
  - rollen die NIET in het bestand staan worden afgevoerd (status='verkocht').

VEILIGHEID: een INSERT/status->beschikbaar op rollen triggert auto-planning
(mig 100/111) ALS app_config.snijplanning.auto_planning.enabled aan staat.
Het script weigert te schrijven als dat zo is, tenzij --force-auto-plan.

Gebruik:
  python import_rollen_golive.py "..\\Rollenvoorraad 08-06-2026 (1).xlsx"
  python import_rollen_golive.py "..\\Rollenvoorraad 08-06-2026 (1).xlsx" --apply
"""
import argparse
from datetime import date
from pathlib import Path

import pandas as pd
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY
from sync_rollen_voorraad import parse_karpi_code
from lib.normalize import clean_value as _clean


# ── pure helpers ───────────────────────────────────────────────────────────

def parse_in_magazijn_sinds(v):
    """Ltste Wijz (YYYYMMDD als getal/tekst) -> 'YYYY-MM-DD' of None."""
    if v is None:
        return None
    if isinstance(v, float):
        if pd.isna(v):
            return None
        v = int(v)
    s = str(v).strip().split(".")[0]
    if len(s) != 8 or not s.isdigit():
        return None
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:8])).isoformat()
    except ValueError:
        return None


def bouw_insert_record(r):
    return {
        "rolnummer": str(r["rolnummer"]),
        "artikelnr": _clean(r["artikelnr"]),
        "karpi_code": _clean(r["karpi_code"]),
        "omschrijving": _clean(r["omschrijving"]),
        "lengte_cm": int(r["lengte_cm"]) if pd.notna(r["lengte_cm"]) else None,
        "breedte_cm": int(r["breedte_cm"]) if pd.notna(r["breedte_cm"]) else None,
        "oppervlak_m2": _clean(r["oppervlak_m2"]),
        "vvp_m2": _clean(r["vvp_m2"]),
        "waarde": _clean(r["waarde"]),
        "kwaliteit_code": _clean(r["kwaliteit_code"]),
        "kleur_code": _clean(r["kleur_code"]),
        "zoeksleutel": _clean(r["zoeksleutel"]),
        "in_magazijn_sinds": r["in_magazijn_sinds"],
        "status": "beschikbaar",
    }


def bouw_update_record(r):
    """Update bestaande rol: dims/waarde verversen EN reservering wissen."""
    return {
        "lengte_cm": int(r["lengte_cm"]) if pd.notna(r["lengte_cm"]) else None,
        "breedte_cm": int(r["breedte_cm"]) if pd.notna(r["breedte_cm"]) else None,
        "oppervlak_m2": _clean(r["oppervlak_m2"]),
        "vvp_m2": _clean(r["vvp_m2"]),
        "waarde": _clean(r["waarde"]),
        "in_magazijn_sinds": r["in_magazijn_sinds"],
        "status": "beschikbaar",
        "snijden_gestart_op": None,
    }


def bepaal_ontbrekende_producten(df, bestaande_artnr):
    """Rol-artikelen uit de bron die nog niet in producten staan (dedup)."""
    out = {}
    for _, r in df.iterrows():
        a = r["artikelnr"]
        if a and a not in bestaande_artnr and a not in out:
            out[a] = {
                "artikelnr": a,
                "karpi_code": _clean(r["karpi_code"]),
                "omschrijving": _clean(r["omschrijving"]),
                "kwaliteit_code": r["kwaliteit_code"],
                "kleur_code": r["kleur_code"],
                "zoeksleutel": r["zoeksleutel"],
                "vvp_m2": _clean(r["vvp_m2"]),
            }
    return list(out.values())


# ── bron + DB ──────────────────────────────────────────────────────────────

def load_bron(path):
    df = pd.read_excel(path)
    df = df.rename(columns={
        "Artikelnr": "artikelnr", "Karpi-code": "karpi_code",
        "Omschrijving": "omschrijving", "VVP m2": "vvp_m2",
        "Rolnummer": "rolnummer", "Lengte (m)": "lengte_m",
        "Breedte (m)": "breedte_m", "Oppervlak": "oppervlak_m2",
        "Waarde": "waarde", "Ltste Wijz": "ltste_wijz",
    })
    df["rolnummer"] = df["rolnummer"].astype(str).str.strip()
    df["artikelnr"] = df["artikelnr"].apply(lambda v: str(int(v)) if pd.notna(v) else None)
    df["lengte_cm"] = (df["lengte_m"] * 100).round().astype("Int64")
    df["breedte_cm"] = (df["breedte_m"] * 100).round().astype("Int64")
    df["in_magazijn_sinds"] = df["ltste_wijz"].apply(parse_in_magazijn_sinds)
    parsed = df["karpi_code"].apply(parse_karpi_code)
    df["kwaliteit_code"] = parsed.apply(lambda t: t[0])
    df["kleur_code"] = parsed.apply(lambda t: t[1])
    df["zoeksleutel"] = parsed.apply(lambda t: t[2])
    df = df.drop_duplicates(subset=["rolnummer"], keep="first")
    return df


def _fetch_kolomset(sb, tabel, kol, extra_select=None):
    out = set()
    start = 0
    sel = kol if extra_select is None else f"{kol},{extra_select}"
    while True:
        r = sb.table(tabel).select(sel).range(start, start + 999).execute()
        if not r.data:
            break
        out.update(str(x[kol]) for x in r.data if x[kol] is not None)
        if len(r.data) < 1000:
            break
        start += 1000
    return out


def fetch_huidige_rollen(sb):
    rows = []
    start = 0
    while True:
        r = (sb.table("rollen")
             .select("id,rolnummer,status").range(start, start + 999).execute())
        if not r.data:
            break
        rows.extend(r.data)
        if len(r.data) < 1000:
            break
        start += 1000
    return {h["rolnummer"]: h for h in rows}


def auto_planning_aan(sb):
    r = (sb.table("app_config").select("waarde")
         .eq("sleutel", "snijplanning.auto_planning").execute())
    if not r.data:
        return False
    return bool((r.data[0].get("waarde") or {}).get("enabled"))


def maak_rol_producten(sb, ontbrekend, geldige_kwal):
    records = []
    for p in ontbrekend:
        kwal = p["kwaliteit_code"] if p["kwaliteit_code"] in geldige_kwal else None
        records.append({
            "artikelnr": p["artikelnr"], "karpi_code": p["karpi_code"],
            "omschrijving": p["omschrijving"] or p["karpi_code"],
            "voorraad": 0, "vrije_voorraad": 0, "backorder": 0, "gereserveerd": 0,
            "kwaliteit_code": kwal, "kleur_code": p["kleur_code"],
            "zoeksleutel": p["zoeksleutel"],
            "product_type": "rol", "actief": True,
        })
    for i in range(0, len(records), 500):
        sb.table("producten").insert(records[i:i + 500]).execute()
    return records


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bestand", help="pad naar Rollenvoorraad <datum>.xlsx")
    ap.add_argument("--apply", action="store_true", help="daadwerkelijk schrijven")
    ap.add_argument("--force-auto-plan", action="store_true",
                    help="schrijf ook als auto-planning aan staat (NIET aanbevolen)")
    args = ap.parse_args()

    pad = Path(args.bestand)
    if not pad.is_absolute():
        pad = (Path.cwd() / pad).resolve()
    if not pad.exists():
        raise SystemExit(f"ERROR: bestand niet gevonden: {pad}")
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("ERROR: import/.env ontbreekt (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).")

    print("=" * 64)
    print(f"ROLLEN GO-LIVE  ({'APPLY' if args.apply else 'DRY-RUN'})")
    print(f"Bestand: {pad.name}")
    print("=" * 64)

    df = load_bron(pad)
    print(f"Bron: {len(df)} unieke rollen, {df['artikelnr'].nunique()} artikelen")

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    bestaande_artnr = _fetch_kolomset(sb, "producten", "artikelnr")
    geldige_kwal = _fetch_kolomset(sb, "kwaliteiten", "code")
    ontbrekend = bepaal_ontbrekende_producten(df, bestaande_artnr)
    zonder_kwal = [p for p in ontbrekend if p["kwaliteit_code"] not in geldige_kwal]

    huidig = fetch_huidige_rollen(sb)
    bron_rolnrs = set(df["rolnummer"])
    nieuw = [r for _, r in df.iterrows() if r["rolnummer"] not in huidig]
    bestaat = [r for _, r in df.iterrows() if r["rolnummer"] in huidig]
    afvoeren = [h for rolnr, h in huidig.items() if rolnr not in bron_rolnrs]

    print("\n--- SAMENVATTING ---")
    print(f"  ontbrekende rol-producten aanmaken : {len(ontbrekend)}"
          f"  (zonder geldige kwaliteit: {len(zonder_kwal)})")
    print(f"  rollen NIEUW (insert)              : {len(nieuw)}")
    print(f"  rollen BESTAAND (refresh+reset)    : {len(bestaat)}")
    print(f"  rollen AFVOEREN (-> verkocht)      : {len(afvoeren)}")

    if not args.apply:
        print("\nDRY-RUN: geen DB-wijzigingen. Draai met --apply om te schrijven.")
        return

    if auto_planning_aan(sb) and not args.force_auto_plan:
        raise SystemExit(
            "GESTOPT: app_config.snijplanning.auto_planning.enabled staat AAN.\n"
            "Een bulk-insert/status-reset zou auto-planning triggeren (mig 100/111).\n"
            "Zet 'enabled' op false vóór de import, of draai met --force-auto-plan."
        )

    print("\n--- SCHRIJVEN NAAR SUPABASE ---")

    if ontbrekend:
        maak_rol_producten(sb, ontbrekend, geldige_kwal)
        print(f"  rol-producten aangemaakt: {len(ontbrekend)}")

    if nieuw:
        records = [bouw_insert_record(r) for r in nieuw]
        for i in range(0, len(records), 500):
            sb.table("rollen").insert(records[i:i + 500]).execute()
            print(f"  insert rollen: {min(i + 500, len(records))}/{len(records)}")

    for idx, r in enumerate(bestaat, 1):
        sb.table("rollen").update(bouw_update_record(r)).eq(
            "rolnummer", str(r["rolnummer"])).execute()
        if idx % 100 == 0:
            print(f"  refresh rollen: {idx}/{len(bestaat)}")

    if afvoeren:
        ids = [h["id"] for h in afvoeren]
        for i in range(0, len(ids), 500):
            sb.table("rollen").update({"status": "verkocht"}).in_(
                "id", ids[i:i + 500]).execute()
            print(f"  afvoeren: {min(i + 500, len(ids))}/{len(ids)}")

    print("\nKLAAR. Rollen-nulstand toegepast.")


if __name__ == "__main__":
    main()
