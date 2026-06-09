"""Tests voor het productie-only import-script (Task A9).

Pint de parser-logica: verzendweek->maandag, vorm-detectie, en de mapping van
een ruwe planning-rij naar een RPC-regel (afwerking-map + ruwe maten +
uit-standaardmaat-vlag).
"""
from import_productie_only import (
    rij_naar_regel, verzendweek_naar_datum, bepaal_vorm, merge_dubbele_regels,
    parse_kwal_kleur_lenient,
)
import datetime as dt
import pytest


def _regel(rgl, lengte=300, breedte=300, afw="SB", aantal=1):
    return {
        "oud_order_nr": 26507370, "regelnummer": rgl,
        "maatwerk_lengte_cm": lengte, "maatwerk_breedte_cm": breedte,
        "maatwerk_afwerking": afw, "maatwerk_vorm": "rechthoek",
        "snijden_uit_standaardmaat": False,
        "maatwerk_kwaliteit_code": "AEST", "maatwerk_kleur_code": "14",
        "orderaantal": aantal,
    }


def test_merge_identieke_dubbele_rgl_telt_orderaantal_op():
    # Twee identieke rijen met hetzelfde rgl -> één regel, orderaantal = som.
    samengevoegd = merge_dubbele_regels([_regel(2), _regel(2)])
    assert len(samengevoegd) == 1
    assert samengevoegd[0]["regelnummer"] == 2
    assert samengevoegd[0]["orderaantal"] == 2


def test_merge_laat_schone_regels_ongemoeid():
    regels = [_regel(1), _regel(2), _regel(5)]
    samengevoegd = merge_dubbele_regels(regels)
    assert [r["regelnummer"] for r in samengevoegd] == [1, 2, 5]
    assert all(r["orderaantal"] == 1 for r in samengevoegd)


def test_merge_conflict_verschillende_maat_faalt_hard():
    # Zelfde rgl, andere maat -> geen automatische samenvoeging, harde fout.
    with pytest.raises(ValueError):
        merge_dubbele_regels([_regel(2, lengte=300), _regel(2, lengte=250)])


def test_verzendweek_naar_datum_maandag():
    assert verzendweek_naar_datum("24-2026") == dt.date(2026, 6, 8)   # maandag wk24
    assert verzendweek_naar_datum("22-2026") == dt.date(2026, 5, 25)


def test_bepaal_vorm():
    assert bepaal_vorm("300", "RND", "AESTHETIC 300cm RND") == "rond"
    assert bepaal_vorm("290", "200", "AEST 290x200 FESM*OVAAL") == "ovaal"
    assert bepaal_vorm("400", "175", "AEST 400x175") == "rechthoek"


def test_rij_naar_regel_mapt_afwerking_en_maten():
    # rij-indexen volgen snijlijst_parser-kolommen
    rij = ["AEST14MAATWERK", "AESTHETIC 14 400x175", "", "", "", "", "FESM", "400", "175", 1,
           26475680, "200000", "DIK", "12-2026", "B", 1, 22, "24-2026", "Wo 10-06-2026", 26029084, 1, "", ""]
    regel = rij_naar_regel(rij)
    assert regel["maatwerk_kwaliteit_code"] == "AEST"
    assert regel["maatwerk_kleur_code"] == "14"
    assert regel["maatwerk_lengte_cm"] == 400 and regel["maatwerk_breedte_cm"] == 175
    assert regel["maatwerk_afwerking"] == "SF"   # GROF=B + FIJN=FESM -> SF
    assert regel["snijden_uit_standaardmaat"] is False


@pytest.mark.parametrize("code,verwacht", [
    ("HARM16XX160230", ("HARM", "16")),   # letters-na-kleur (XX) -> stopt bij X
    ("GOLD12KC200290", ("GOLD", "12")),
    ("GOHA18KH060110", ("GOHA", "18")),
    ("EDGB21R3200290", ("EDGB", "21")),   # R3: regex stopt bij R, kleur = 21
    ("OFFG18FE160230", ("OFFG", "18")),
    ("LAGO13MAATWERK", ("LAGO", "13")),   # canonieke vorm valt ook leniant goed uit
    ("", None),
    ("KUNSTGRAS", None),                  # geen cijfers
])
def test_parse_kwal_kleur_lenient(code, verwacht):
    assert parse_kwal_kleur_lenient(code) == verwacht


def test_rij_naar_regel_lenient_fallback_op_xx_code():
    # Artikelcode zonder MAATWERK-suffix -> strikte parse faalt -> leniente fallback.
    rij = ["HARM16XX160230", "HARMONY Kleur 16 CA: 160x230 cm", "", "", "", "", "FE", "160", "230", 10,
           26513630, "181502", "CONTANTE VERKOPEN", "", "B", 2, 22, "16-2026", "", 26000001, 1, "", ""]
    regel = rij_naar_regel(rij)
    assert regel["maatwerk_kwaliteit_code"] == "HARM"
    assert regel["maatwerk_kleur_code"] == "16"


def test_rij_uit_standaardmaat_gevlagd():
    # 'uit 200x290 cm' staat op PL_OPMERKING (kolom 22) — de echte v2-Opmerking-kolom.
    rij = ["X14MAATWERK", "desc", "", "", "", "", "", "200", "290", 1, 26000000, "100", "KL",
           "20-2026", "B", 1, 20, "22-2026", "", 26000001, 1, "", "uit 200x290 cm"]
    regel = rij_naar_regel(rij)
    assert regel["snijden_uit_standaardmaat"] is True
