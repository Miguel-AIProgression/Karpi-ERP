from lib.snijlijst_parser import (
    normaliseer_key,
    parse_kwal_kleur,
    is_snijden_uit,
    extract_gesneden_uit_rows,
    parse_planning_rij,
    breedte_lengte_uit_maten,
)


def test_normaliseer_key_strip_float_artefact():
    assert normaliseer_key("26536240.0") == "26536240"
    assert normaliseer_key(26536240) == "26536240"
    assert normaliseer_key(6.0) == "6"
    assert normaliseer_key("  26536240 ") == "26536240"


def test_normaliseer_key_leeg_is_none():
    assert normaliseer_key(None) is None
    assert normaliseer_key("") is None
    assert normaliseer_key("   ") is None


def test_normaliseer_key_niet_numeriek_blijft_string():
    assert normaliseer_key("FPNL130883") == "FPNL130883"


def test_parse_kwal_kleur_splitst_letters_en_cijfers():
    assert parse_kwal_kleur("AEST13") == ("AEST", "13")
    assert parse_kwal_kleur("MWDI99") == ("MWDI", "99")


def test_parse_kwal_kleur_faalt_op_niet_matchend():
    assert parse_kwal_kleur("KUNSTGRAS") is None
    assert parse_kwal_kleur("") is None
    assert parse_kwal_kleur(None) is None


def test_is_snijden_uit_herkent_uit_patroon():
    assert is_snijden_uit("uit 240x340 vrij wk 23") is True
    assert is_snijden_uit("UIT 200 x 290") is True
    assert is_snijden_uit("3 rl ma wk 24 Aalten 2026009") is False
    assert is_snijden_uit("") is False
    assert is_snijden_uit(None) is False


def test_breedte_lengte_recht_stuk():
    # A=290 (maat1), B=200 (maat2) -> breedte=max=290, lengte=min=200
    assert breedte_lengte_uit_maten("290", "200") == (290, 200)
    assert breedte_lengte_uit_maten("200", "290") == (290, 200)


def test_breedte_lengte_rond_stuk():
    # RND: diameter in maat1, beide = diameter
    assert breedte_lengte_uit_maten("300", "RND") == (300, 300)
    assert breedte_lengte_uit_maten("240", "rnd") == (240, 240)


def test_extract_gesneden_dag_layout():
    # Dag-sheet: header rij-index 1, Gesneden=1, Ordernr=14, Rgl=15.
    rows = [
        ["", "", "", "", "", "", "", "TITEL", "", "", "", "", "", "", "", "", "", ""],
        ["Niet snijden", "Gesneden", "Ingepakt", "Bin", "M", "", "", "#",
         "Basis", "Oms", "Stuks", "Afw", "Groep", "Deb", "Ordernr.", "Rgl", "Vw", "v"],
        ["False", "True", "True", "True", "JA", "26031068.0", "1.0", "1.0",
         "AEST13", "oms", "1.0", "B", "Sm", "HEADLAM", "26536240.0", "6.0", "21-2026", ""],
        ["False", "False", "False", "False", "JA", "26031418.0", "2.0", "2.0",
         "AEST13", "oms", "1.0", "B", "Sm", "JANSEN", "26550330.0", "1.0", "23-2026", ""],
    ]
    assert extract_gesneden_uit_rows(rows) == {("26536240", "6")}


def test_extract_gesneden_week_layout_andere_kolommen():
    # Week-sheet: Gesneden=2, Verk.ordernr.=16, Rgl=21 (data-index varieert).
    rows = [
        ["", "True", "", "", "", "", "", "", "Planning", "", "", "", "", "", "", "", "", ""],
        ["", "Niet produceren", "Gesneden", "Ingepakt", "Bin", "Marjolein",
         "Ink.order:", "I.rg", "Kwaliteit:", "Dag", "", "", "", "", "", "",
         "Verk.ordernr.:", "Deb.nr."],
        ["", "False", "True", "True", "True", "ja", "26032079.0", "1.0",
         "Chester 15", "", "", "", "", "200.0", "290.0", "1.0", "26570480.0", ""],
    ]
    # ordernr-kolom 16, rgl-kolom 7 (I.rg)? Nee: rgl moet 'rgl'/'ordrgl' header zijn.
    # Deze week-layout heeft GEEN 'rgl'-header -> sheet wordt overgeslagen.
    assert extract_gesneden_uit_rows(rows) == set()


def test_extract_gesneden_skip_sheet_zonder_gesneden():
    rows = [["a", "b", "c"], ["x", "y", "z"]]
    assert extract_gesneden_uit_rows(rows) == set()


def test_parse_planning_rij_actief_recht():
    # 0-based kolommen; index4 kwal+kleur, 7 maat1, 8 maat2, 9 aantal,
    # 10 ordernr, 15 rgl, 22 opmerking.
    rij = [""] * 25
    rij[4] = "AEST14"; rij[7] = "400"; rij[8] = "175"; rij[9] = 1
    rij[10] = "26475680"; rij[15] = "1"; rij[22] = ""
    pr = parse_planning_rij(rij)
    assert pr is not None
    assert pr.oud_ordernr == "26475680"
    assert pr.oud_orderregel == "1"
    assert pr.kwaliteit == "AEST14"[:4] or pr.kwaliteit == "AEST"
    assert pr.kwaliteit == "AEST"
    assert pr.kleur == "14"
    assert pr.breedte_nodig_cm == 400
    assert pr.lengte_verbruikt_cm == 175
    assert pr.aantal == 1


def test_parse_planning_rij_zonder_ordernr_is_none():
    rij = [""] * 25
    rij[4] = "AEST14"; rij[7] = "400"; rij[8] = "175"
    pr = parse_planning_rij(rij)
    assert pr is None


def test_parse_planning_rij_aantal_default_1():
    rij = [""] * 25
    rij[4] = "AEST13"; rij[7] = "300"; rij[8] = "RND"
    rij[10] = "26568720"; rij[15] = "1"; rij[9] = ""
    pr = parse_planning_rij(rij)
    assert pr.aantal == 1
    assert pr.breedte_nodig_cm == 300
    assert pr.lengte_verbruikt_cm == 300
