"""Bulk auto-plan voor de geïmporteerde productie-only orders (cutover stap 5).

De bulk-import maakt snijplannen aan via de DB-trigger auto_maak_snijplan in status
'Wacht'. Die worden NIET automatisch gepland (de UI-auto-plan-trigger vuurt alleen
bij via-de-UI aangemaakte snijplannen). Dit script roept de edge function
`auto-plan-groep` aan voor elke (kwaliteit, kleur)-groep, precies zoals het
draaiboek (A10 stap 5) voorschrijft.

Effect per groep:
  - rollen beschikbaar → stukken worden gepackt + voorstel auto-goedgekeurd →
    snijplannen gaan naar 'Gepland' (verschijnen in "Te snijden").
  - geen/te weinig rol -> groep wordt overgeslagen; stukken blijven 'Wacht'
    (= echt tekort → inkoop, was in Basta ook zo: maatwerk werd niet
    op de rol gereserveerd).

LET OP: auto-plan-groep heroptimaliseert de HELE (kwaliteit, kleur)-groep
(release + herpack), inclusief eventuele live-order-stukken in diezelfde groep —
dat is het normale auto-plan-gedrag (C1 beschermt goedgekeurde voorstellen).

Dry-run (default) toont alleen de groepen. --commit roept de edge function aan.
Credentials uit import/.env via config.py.
"""
from __future__ import annotations
import argparse
import json
import urllib.error
import urllib.request
from collections import OrderedDict

import import_productie_only as M
from config import SUPABASE_URL, SUPABASE_KEY


def distinct_groepen(bestand) -> "OrderedDict[tuple[str, str], int]":
    """Geef OrderedDict {(kwaliteit, kleur): aantal_stuks} voor groepen met code.

    Lege kwaliteit/kleur (parse-fail, aparte fix) worden overgeslagen - die hebben
    geen groep om te plannen.
    """
    regels = M.lees_regels(bestand)
    groepen: "OrderedDict[tuple[str, str], int]" = OrderedDict()
    for r in regels:
        kw, kl = r["maatwerk_kwaliteit_code"], r["maatwerk_kleur_code"]
        if not kw or not kl:
            continue
        groepen[(kw, kl)] = groepen.get((kw, kl), 0) + 1
    return groepen


def plan_groep(kw: str, kl: str) -> tuple[int, dict]:
    """Roep de auto-plan-groep edge function aan. -> (http_status, json-body)."""
    url = f"{SUPABASE_URL}/functions/v1/auto-plan-groep"
    body = json.dumps({"kwaliteit_code": kw, "kleur_code": kl}).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read().decode() or "{}"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        return e.code, {"error": (e.read().decode() or "")[:300]}
    except Exception as e:  # noqa: BLE001 — best-effort cutover-tool
        return 0, {"error": str(e)[:300]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--bestand", default=M.BESTAND)
    args = ap.parse_args()

    groepen = distinct_groepen(args.bestand)
    totaal_stuks = sum(groepen.values())
    print(f"Distinct (kwaliteit, kleur)-groepen met code: {len(groepen)} "
          f"({totaal_stuks} stuks). Groepen zonder code (lege kwaliteit) worden "
          f"hier overgeslagen - die hebben een aparte parser-fix nodig.")

    if not args.commit:
        for (kw, kl), n in list(groepen.items())[:40]:
            print(f"  {kw} {kl}: {n} stuks")
        if len(groepen) > 40:
            print(f"  ... +{len(groepen) - 40} groepen")
        print("DRY-RUN — niets gepland. Draai met --commit om auto-plan te draaien.")
        return

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ontbreken in import/.env")

    ok = skip = fout = 0
    for i, ((kw, kl), n) in enumerate(groepen.items(), 1):
        status, data = plan_groep(kw, kl)
        if status == 200 and not data.get("error"):
            if data.get("skipped"):
                skip += 1
                tag = f"SKIP ({data.get('reason', 'geen rol')})"
            else:
                ok += 1
                tag = "GEPLAND"
        else:
            fout += 1
            tag = f"FOUT {status}: {data.get('error', '-')}"
        print(f"  [{i}/{len(groepen)}] {kw} {kl} ({n} stuks): {tag}")

    print(f"\nKlaar: {ok} groepen gepland, {skip} overgeslagen (geen/te weinig rol -> "
          f"inkoop), {fout} fout. Ververs de Snijplanning-pagina (F5).")


if __name__ == "__main__":
    main()
