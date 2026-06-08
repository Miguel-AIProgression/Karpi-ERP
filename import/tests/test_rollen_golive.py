import pandas as pd

from import_rollen_golive import (
    parse_in_magazijn_sinds,
    bouw_insert_record,
    bepaal_ontbrekende_producten,
)


# ── parse_in_magazijn_sinds ────────────────────────────────────────────────

def test_parse_in_magazijn_sinds_geldig():
    assert parse_in_magazijn_sinds(20260602) == "2026-06-02"
    assert parse_in_magazijn_sinds("20251027") == "2025-10-27"
    assert parse_in_magazijn_sinds(20260602.0) == "2026-06-02"  # excel float


def test_parse_in_magazijn_sinds_leeg_of_ongeldig():
    assert parse_in_magazijn_sinds(None) is None
    assert parse_in_magazijn_sinds(float("nan")) is None
    assert parse_in_magazijn_sinds(0) is None
    assert parse_in_magazijn_sinds("") is None
    assert parse_in_magazijn_sinds("2026") is None        # te kort
    assert parse_in_magazijn_sinds(20261302) is None      # maand 13 -> ongeldig


# ── bouw_insert_record ─────────────────────────────────────────────────────

def test_bouw_insert_record_status_en_velden():
    r = pd.Series({
        "rolnummer": "AEST13 01", "artikelnr": "1487001",
        "karpi_code": "AEST13400SYN", "omschrijving": "AESTHETIC KLEUR 13 400",
        "lengte_cm": 1500, "breedte_cm": 400, "oppervlak_m2": 60.0,
        "vvp_m2": 34.67, "waarde": 2080.2,
        "kwaliteit_code": "AEST", "kleur_code": "13", "zoeksleutel": "AEST_13",
        "in_magazijn_sinds": "2026-06-02",
    })
    rec = bouw_insert_record(r)
    assert rec["status"] == "beschikbaar"
    assert rec["rolnummer"] == "AEST13 01"
    assert rec["artikelnr"] == "1487001"
    assert rec["lengte_cm"] == 1500
    assert rec["breedte_cm"] == 400
    assert rec["in_magazijn_sinds"] == "2026-06-02"
    assert "rol_type" not in rec  # wordt door DB-trigger gezet


# ── bepaal_ontbrekende_producten ───────────────────────────────────────────

def test_bepaal_ontbrekende_producten_filtert_en_dedupt():
    df = pd.DataFrame([
        {"artikelnr": "111", "karpi_code": "AAA10400SYN", "omschrijving": "A",
         "kwaliteit_code": "AAA", "kleur_code": "10", "zoeksleutel": "AAA_10",
         "vvp_m2": 1.0},
        {"artikelnr": "111", "karpi_code": "AAA10400SYN", "omschrijving": "A",
         "kwaliteit_code": "AAA", "kleur_code": "10", "zoeksleutel": "AAA_10",
         "vvp_m2": 1.0},  # dubbel artikelnr -> 1x
        {"artikelnr": "222", "karpi_code": "BBB20400SYN", "omschrijving": "B",
         "kwaliteit_code": "BBB", "kleur_code": "20", "zoeksleutel": "BBB_20",
         "vvp_m2": 2.0},
    ])
    bestaande = {"222"}  # 222 bestaat al
    ontbrekend = bepaal_ontbrekende_producten(df, bestaande)
    assert [p["artikelnr"] for p in ontbrekend] == ["111"]
