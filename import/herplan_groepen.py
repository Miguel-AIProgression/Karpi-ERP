"""
Trigger auto-plan-groep voor een lijst (kwaliteit, kleur)-groepen.
Gebruikt requests i.p.v. urllib (SSL-certificaat fix op macOS).

Gebruik:
  python herplan_groepen.py              # de 203 groepen van de 25-06 sync
  python herplan_groepen.py CISC 15      # één specifieke groep
"""
from __future__ import annotations
import sys
import time
import requests
from config import SUPABASE_URL, SUPABASE_KEY

GROEPEN_25_06 = [
    ("AEST","13"),("AEST","14"),("AEST","15"),("AEST","42"),("AEST","56"),("AEST","62"),
    ("ANDE","40"),("ANDE","62"),("ANNA","11"),("ANNA","21"),("ANNA","35"),
    ("BABY","12"),("BANG","12"),("BANG","21"),
    ("BEAC","10"),("BEAC","13"),("BEAC","16"),("BEAC","24"),
    ("BERM","17"),("BERM","21"),
    ("BILA","11"),("BILA","14"),("BILA","16"),("BILA","21"),("BILA","23"),
    ("BIRM","12"),("BIRM","14"),("BIRM","17"),("BIRM","22"),
    ("BUXK","13"),("BUXK","25"),("BUXK","45"),("BUXK","52"),("BUXS","45"),
    ("BUXV","15"),("BUXV","16"),("BUXV","23"),("BUXV","37"),
    ("CACH","12"),("CACH","18"),("CAVA","12"),("CAVA","62"),
    ("CISC","11"),("CISC","12"),("CISC","15"),("CISC","16"),("CISC","18"),
    ("CISC","21"),("CISC","23"),("CISC","24"),("CISC","25"),("CISC","32"),
    ("CISC","43"),("CISC","44"),("CISC","48"),("CISC","54"),("CISC","63"),
    ("DANT","12"),("DANT","13"),("DREA","11"),("DREA","13"),("DYST","15"),
    ("ELIA","15"),("ELIA","24"),
    ("EMIR","12"),("EMIR","13"),("EMIR","21"),("EMIR","25"),("EMIR","30"),
    ("EMIR","37"),("EMIR","45"),("EMIR","54"),
    ("ESSE","13"),("ESSE","14"),("ESSE","15"),("ESSE","17"),("ESSE","42"),
    ("ESSE","56"),("ESSE","62"),
    ("FIRE","12"),("FIRE","15"),("FIRE","19"),("FIRE","20"),
    ("FRIS","11"),("FRIS","21"),("FRIS","33"),("FRIS","35"),("FRIS","41"),
    ("GALA","10"),("GALA","12"),("GALA","14"),("GALA","15"),("GALA","18"),
    ("GALA","42"),("GALA","53"),
    ("GENT","13"),("GENT","18"),
    ("GOKI","12"),("GOKI","13"),("GOKI","15"),("GOKI","18"),("GOKI","21"),
    ("GOKI","23"),("GOKI","24"),("GOKI","36"),("GOKI","51"),
    ("GOLD","12"),("GOLD","14"),("GOLD","16"),("GOLD","17"),("GOLD","22"),
    ("HAR","65"),("HAR","99"),
    ("HARM","11"),("HARM","14"),("HARM","16"),("HARM","18"),("HARM","20"),("HARM","21"),
    ("HIGH","15"),("LAMI","15"),
    ("LIMA","14"),("LIMA","40"),("LIMA","62"),("LOOP","13"),
    ("LORA","11"),("LORA","13"),("LORA","15"),("LORA","21"),("LORA","23"),
    ("LORA","24"),("LORA","31"),
    ("LOUV","12"),("LOWL","13"),("LOWL","42"),
    ("LUXR","12"),("LUXR","14"),("LUXR","17"),("LUXR","26"),("LUXR","35"),("LUXR","39"),
    ("MARI","13"),("MARI","42"),("MARI","69"),
    ("NOMA","52"),("NOMA","62"),
    ("OASI","11"),("OASI","13"),("OASI","53"),("OUTO","15"),("PARA","15"),
    ("ROYL","13"),
    ("RUBI","15"),("RUBI","26"),("RUBI","35"),("RUBI","43"),("RUBI","44"),
    ("RUBI","62"),("RUBI","63"),
    ("SABE","12"),("SABE","62"),
    ("SEAO","13"),("SEAO","22"),("SEAO","23"),("SEAO","51"),
    ("SERN","24"),("SETI","21"),("SOLE","10"),("SOLE","12"),
    ("SPLE","12"),("SPLE","15"),("SPLE","23"),
    ("TAMA","13"),("TAMA","18"),("TAMA","21"),("TAMA","23"),
    ("TWIS","15"),("TWIS","17"),("TWIS","25"),
    ("VELV","10"),("VELV","13"),("VELV","68"),
    ("VEMI","16"),("VEMI","18"),("VEMI","22"),("VEMI","26"),("VEMI","31"),
    ("VEMI","32"),("VEMI","55"),("VEMI","69"),
    ("VERI","13"),("VERI","19"),("VERI","21"),("VERI","24"),("VERI","25"),
    ("VERR","13"),("VERR","15"),("VERR","18"),("VERR","23"),("VERR","24"),
    ("VERR","53"),("VERR","68"),
    ("VETB","35"),
]

def plan_groep(kw: str, kl: str) -> tuple[int, dict]:
    url = f"{SUPABASE_URL}/functions/v1/auto-plan-groep"
    try:
        r = requests.post(
            url,
            json={"kwaliteit_code": kw, "kleur_code": kl},
            headers={
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
            },
            timeout=180,
        )
        try:
            body = r.json()
        except Exception:
            body = {"error": r.text[:300]}
        return r.status_code, body
    except Exception as e:
        return 0, {"error": str(e)[:300]}


def main():
    if len(sys.argv) == 3:
        groepen = [(sys.argv[1].upper(), sys.argv[2])]
    else:
        groepen = GROEPEN_25_06

    totaal = len(groepen)
    print(f"Herplanning: {totaal} groepen\n")

    ok = fout = concept = 0
    fout_lijst: list[str] = []

    for i, (kw, kl) in enumerate(groepen, 1):
        status_code, body = plan_groep(kw, kl)
        label = f"{kw}/{kl}"

        if status_code in (200, 201):
            gepland = body.get('gepland', 0)
            tekort  = body.get('tekort', 0)
            c       = body.get('concept', 0)
            if c:
                concept += 1
                print(f"  [{i:3d}/{totaal}] {label:<18} gepland={gepland} tekort={tekort} ⚠ concept={c}")
            elif tekort:
                ok += 1
                print(f"  [{i:3d}/{totaal}] {label:<18} gepland={gepland} tekort={tekort}")
            else:
                ok += 1
        else:
            fout += 1
            err = body.get('error', '')[:80]
            fout_lijst.append(f"{label}: HTTP {status_code} — {err}")
            print(f"  [{i:3d}/{totaal}] {label:<18} FOUT HTTP {status_code}: {err}")

        if i % 10 == 0:
            time.sleep(1)

    print(f"\n=== RESULTAAT ===")
    print(f"  OK:               {ok}")
    print(f"  Concept (check!): {concept}")
    print(f"  Fout:             {fout}")

    if fout_lijst:
        print("\n  Fouten:")
        for f in fout_lijst:
            print(f"    {f}")

    print("\nKlaar.")


if __name__ == '__main__':
    main()
