"""Tests voor het productie-only import-script (Task A9).

Pint de parser-logica: verzendweek->maandag, vorm-detectie, en de mapping van
een ruwe planning-rij naar een RPC-regel (afwerking-map + ruwe maten +
uit-standaardmaat-vlag).
"""
from import_productie_only import rij_naar_regel, verzendweek_naar_datum, bepaal_vorm
import datetime as dt


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


def test_rij_uit_standaardmaat_gevlagd():
    # 'uit 200x290 cm' staat op PL_OPMERKING (kolom 22) — de echte v2-Opmerking-kolom.
    rij = ["X14MAATWERK", "desc", "", "", "", "", "", "200", "290", 1, 26000000, "100", "KL",
           "20-2026", "B", 1, 20, "22-2026", "", 26000001, 1, "", "uit 200x290 cm"]
    regel = rij_naar_regel(rij)
    assert regel["snijden_uit_standaardmaat"] is True
