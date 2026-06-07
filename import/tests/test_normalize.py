import numpy as np
import pandas as pd

from lib.normalize import norm, clean_value, clean_gln


# ── norm ──────────────────────────────────────────────────────────────────

def test_norm_collapse_en_uppercase():
    assert norm("  hallo   wereld  ") == "HALLO WERELD"
    assert norm("a\t b\n c") == "A B C"


def test_norm_none_safe():
    assert norm(None) == ""
    assert norm("") == ""


# ── clean_value ─────────────────────────────────────────────────────────────

def test_clean_value_nan_en_none_en_nat():
    assert clean_value(None) is None
    assert clean_value(float("nan")) is None
    assert clean_value(np.nan) is None
    assert clean_value(pd.NaT) is None


def test_clean_value_numpy_scalars():
    r_int = clean_value(np.int64(7))
    assert r_int == 7 and isinstance(r_int, int) and not isinstance(r_int, np.integer)
    r_float = clean_value(np.float64(3.5))
    assert r_float == 3.5 and isinstance(r_float, float) and not isinstance(r_float, np.floating)


def test_clean_value_timestamp_date_fmt():
    ts = pd.Timestamp("2026-06-07 14:30:00")
    assert clean_value(ts, date_fmt="%Y-%m-%d") == "2026-06-07"
    assert clean_value(ts, date_fmt="iso") == ts.isoformat()
    # date_fmt=None laat de Timestamp onaangeroerd (oude _clean-gedrag)
    assert clean_value(ts) is ts


def test_clean_value_passthrough():
    assert clean_value("tekst") == "tekst"
    assert clean_value(42) == 42


# ── clean_gln ────────────────────────────────────────────────────────────────

def test_clean_gln_strip_float_artefact():
    assert clean_gln("9007019005225.0") == "9007019005225"
    assert clean_gln(9007019005225.0) == "9007019005225"
    assert clean_gln("  8715954999998 ") == "8715954999998"


def test_clean_gln_none_en_leeg():
    assert clean_gln(None) is None
    assert clean_gln("") is None
    assert clean_gln(np.nan) is None


def test_clean_gln_strict_verwijdert_niet_cijfers():
    assert clean_gln("D-12345.0", strict=True) == "12345"
    # niet-strict behoudt de letters/streepjes (alleen .0 weg)
    assert clean_gln("D-12345", strict=False) == "D-12345"


def test_clean_gln_dot_zero_alleen_bij_cijfers():
    # ".0" wordt niet gestript als de basis geen pure cijferreeks is
    assert clean_gln("AB.0") == "AB.0"
