"""Pure parser-helpers voor de maatwerk-reservering-migratie.

Geen Supabase-afhankelijkheid: alle functies werken op losse waarden of op
lijsten-van-rijen (zoals openpyxl `iter_rows(values_only=True)` ze oplevert),
zodat ze met literal-fixtures testbaar zijn.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# Kolomindexen van tabblad 'Snijden Karpi op kwal' (0-based, data vanaf rij 2).
PL_KWALKLEUR = 4
PL_MAAT1 = 7
PL_MAAT2 = 8
PL_AANTAL = 9
PL_ORDERNR = 10
PL_RGL = 15
PL_OPMERKING = 22

_KWALKLEUR_RE = re.compile(r"^([A-Za-z]+)(\d+)$")
_SNIJDEN_UIT_RE = re.compile(r"uit\s*\d+\s*x\s*\d+", re.IGNORECASE)


def _norm(cell) -> str:
    return str(cell).strip() if cell is not None else ""


def normaliseer_key(cell) -> str | None:
    """Normaliseer een ordernr/rgl-sleutel: '26536240.0' -> '26536240'.

    Excel levert getallen vaak als float (.0-artefact). Niet-numerieke waarden
    blijven ongewijzigd (bv. webshop-codes 'FPNL130883'). Leeg -> None.
    """
    s = _norm(cell)
    if s == "":
        return None
    try:
        return str(int(float(s)))
    except ValueError:
        return s


def parse_kwal_kleur(code) -> tuple[str, str] | None:
    """'AEST13' -> ('AEST', '13'). Niet-matchend (KUNSTGRAS, leeg) -> None."""
    s = _norm(code)
    m = _KWALKLEUR_RE.match(s)
    if not m:
        return None
    return m.group(1), m.group(2)


def is_snijden_uit(opmerking) -> bool:
    """True als de opmerking 'uit NxN' bevat (wordt uit standaard karpet gesneden)."""
    return bool(_SNIJDEN_UIT_RE.search(_norm(opmerking)))


def normaliseer_kleur(kleur) -> str:
    """Strip het '.0'-Excel-artefact van een kleurcode: '13.0' -> '13'."""
    return re.sub(r"\.0+$", "", _norm(kleur))


def breedte_lengte_uit_maten(maat1, maat2) -> tuple[int, int]:
    """Geef (breedte_nodig_cm, lengte_verbruikt_cm) volgens de snijmethodiek.

    Recht stuk A×B: breedte = max(A,B), lengte = min(A,B).
    RND (maat2 == 'RND'): diameter in maat1, beide = diameter.
    """
    a = int(float(_norm(maat1)))
    m2 = _norm(maat2)
    if m2.upper() == "RND":
        return a, a
    b = int(float(m2))
    return max(a, b), min(a, b)


@dataclass
class PlanningRegel:
    oud_ordernr: str
    oud_orderregel: str
    kwaliteit: str
    kleur: str
    breedte_nodig_cm: int
    lengte_verbruikt_cm: int
    aantal: int
    opmerking: str
    rauwe_kwalkleur: str


def parse_planning_rij(rij) -> PlanningRegel | None:
    """Parse één rij van 'Snijden Karpi op kwal'. None als geen bruikbare regel.

    None bij: ontbrekend ordernr, of niet-parsebare maten. Kwal/kleur-parse-fails
    leveren wel een regel (kwaliteit/kleur leeg) zodat de allocator ze als
    'ongedekt' kan rapporteren.
    """
    rij = list(rij) + [""] * (max(PL_OPMERKING, PL_RGL) + 1 - len(rij))
    ordernr = normaliseer_key(rij[PL_ORDERNR])
    if ordernr is None:
        return None
    try:
        breedte, lengte = breedte_lengte_uit_maten(rij[PL_MAAT1], rij[PL_MAAT2])
    except ValueError:
        return None
    rgl = normaliseer_key(rij[PL_RGL]) or "1"
    try:
        aantal = int(float(_norm(rij[PL_AANTAL]))) if _norm(rij[PL_AANTAL]) else 1
    except ValueError:
        aantal = 1
    if aantal < 1:
        aantal = 1
    kk = parse_kwal_kleur(rij[PL_KWALKLEUR])
    kwaliteit, kleur = (kk if kk else ("", ""))
    return PlanningRegel(
        oud_ordernr=ordernr,
        oud_orderregel=rgl,
        kwaliteit=kwaliteit,
        kleur=kleur,
        breedte_nodig_cm=breedte,
        lengte_verbruikt_cm=lengte,
        aantal=aantal,
        opmerking=_norm(rij[PL_OPMERKING]),
        rauwe_kwalkleur=_norm(rij[PL_KWALKLEUR]),
    )


def _vind_kolommen(rows) -> tuple[int, dict] | tuple[None, None]:
    """Zoek in de eerste 3 rijen de header met 'gesneden' en map de kolommen.

    Returns (header_rij_index, {'gesn','ordernr','rgl'}) of (None, None).
    Vereist alle drie de kolommen, anders wordt de sheet overgeslagen.
    """
    for ri, r in enumerate(rows[:3]):
        if not any("gesneden" in _norm(c).lower() for c in r):
            continue
        cols: dict = {}
        for ci, c in enumerate(r):
            n = _norm(c).lower()
            if "gesneden" in n and "gesn" not in cols:
                cols["gesn"] = ci
            if ("ordernr" in n or "verk.order" in n) and "ordernr" not in cols:
                cols["ordernr"] = ci
            if n in ("rgl", "ordrgl") and "rgl" not in cols:
                cols["rgl"] = ci
        if all(k in cols for k in ("gesn", "ordernr", "rgl")):
            return ri, cols
        return None, None
    return None, None


def extract_gesneden_uit_rows(rows) -> set[tuple[str, str]]:
    """Bouw de set (ordernr, rgl) van gesneden regels uit één sheet.

    Detecteert de kolommen via de header (robuust tegen de wisselende
    week/dag-layouts). Sheets zonder volledige (gesneden, ordernr, rgl)-kolom
    leveren een lege set.
    """
    hi, cols = _vind_kolommen(rows)
    if cols is None:
        return set()
    maxc = max(cols.values())
    out: set[tuple[str, str]] = set()
    for r in rows[hi + 1:]:
        if len(r) <= maxc:
            continue
        if _norm(r[cols["gesn"]]).lower() != "true":
            continue
        o = normaliseer_key(r[cols["ordernr"]])
        rg = normaliseer_key(r[cols["rgl"]])
        if o and rg:
            out.add((o, rg))
    return out
