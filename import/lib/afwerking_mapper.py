"""Map Piet-heins GROF [14] + FIJN [6] afwerkingscodes naar RugFlow afwerking_types.code.

Geldige RugFlow-codes (FK-veilig): B, SB, FE, SF, LO, VO, ON, ZO.
Resolutie: GROF is leidend; bij GROF='B' (of leeg) bepaalt FIJN de echte variant.
"""
from __future__ import annotations
import re

_GELDIGE = {"B", "SB", "FE", "SF", "LO", "VO", "ON", "ZO"}


def _norm(s) -> str:
    return str(s).strip().upper() if s is not None else ""


def _fijn_naar_code(fijn: str) -> str | None:
    """FIJN-code -> RugFlow-code, of None als niet herkend."""
    f = _norm(fijn)
    if not f:
        return None
    if f.startswith("FESM"):                      return "SF"
    if f.startswith("FEBR"):                      return "FE"
    if f.startswith("FU") or f.startswith("FUR"): return "SF"
    if re.match(r"^F\d{3}", f):                   return "SF"   # F191, F198
    if f.startswith("FE"):                        return "FE"
    if f.startswith("PE"):                        return "B"
    if f.startswith("RM"):                        return "B"
    if re.match(r"^(KI|KK|KO|KB|KC|KH|KA|KF|KG|KM)", f): return "B"  # breedband K-familie
    if f.startswith("VOLU"):                      return "VO"
    if f.startswith("LOCK"):                      return "LO"
    if f.startswith("DA"):                        return "ON"   # biasband -> stickeren in V1 (0,5%)
    return None


def is_herkend(grof, fijn) -> bool:
    """True als de code expliciet herkend is (geen default-fallback gebruikt)."""
    g = _norm(grof)
    if g in {"SB", "ZO", "ON", "FE"}:
        return True
    if g == "B" or g == "":
        return _fijn_naar_code(fijn) is not None
    return g in _GELDIGE


def map_afwerking_code(grof, fijn, omschrijving="") -> str:
    """Geef altijd een FK-veilige RugFlow-code terug. Default 'B' (breedband)."""
    g = _norm(grof)
    if g in {"SB", "ZO", "ON", "FE"}:
        return g
    if g in _GELDIGE and g != "B":
        return g
    # g == 'B' of leeg of onbekend -> probeer FIJN, anders breedband.
    code = _fijn_naar_code(fijn)
    return code if code is not None else "B"
