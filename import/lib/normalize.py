"""Gedeelde normalisatie-/opschoonhelpers voor import-scripts.

Consolideert de gekopieerde `norm`, `clean`/`_clean` (numpy/NaN/NaT-opschoning)
en `clean_gln`-varianten. Gedragsverschillen die echt nodig zijn worden via
parameters overbrugd (`date_fmt`, `strict`) i.p.v. een geforceerde merge.
"""
import re

import numpy as np
import pandas as pd


def norm(s):
    """Trim, collapse interne whitespace tot één spatie, uppercase. None-safe."""
    return re.sub(r"\s+", " ", (s or "").strip().upper())


def clean_value(v, *, date_fmt=None):
    """numpy/NaN/NaT → Python-scalar of None (JSON-serialiseerbaar).

    date_fmt:
      None          → Timestamp wordt onaangeroerd teruggegeven (zoals de oude
                       `_clean`-varianten zonder datum-conversie).
      '%Y-%m-%d'    → Timestamp.strftime('%Y-%m-%d') (date-only).
      'iso'/'isoformat' → Timestamp.isoformat().
    """
    if v is None:
        return None
    if isinstance(v, float) and np.isnan(v):
        return None
    if v is pd.NaT:
        return None
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        return float(v)
    if isinstance(v, pd.Timestamp):
        if date_fmt is None:
            return v
        if date_fmt in ("iso", "isoformat"):
            return v.isoformat()
        return v.strftime(date_fmt)
    return v


def clean_gln(g, *, strict=False):
    """Maak een GLN schoon. None-safe; lege uitkomst → None.

    Strip het Excel-float-artefact ('9007019005225.0') dat de exacte
    EDI-afleveradres-match breekt (mig 310).

    strict=False → alleen de '.0'-staart strippen (cijferstring behouden).
    strict=True  → óók alle niet-cijfers verwijderen (Transus-adresboek).
    """
    if g is None:
        return None
    if isinstance(g, float):
        if np.isnan(g):
            return None
        g = f"{int(g)}"
    else:
        g = str(g).strip()
        if g.endswith(".0") and (strict or g[:-2].isdigit()):
            g = g[:-2]
    if strict:
        g = re.sub(r"\D", "", g)
    return g or None
