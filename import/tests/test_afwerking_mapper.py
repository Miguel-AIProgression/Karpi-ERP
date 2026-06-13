from lib.afwerking_mapper import map_afwerking_code


def test_grof_directe_codes():
    assert map_afwerking_code("SB", "", "") == "SB"
    assert map_afwerking_code("ZO", "", "") == "ZO"
    assert map_afwerking_code("ON", "", "") == "ON"
    assert map_afwerking_code("FE", "", "") == "FE"


def test_grof_b_resolveert_via_fijn():
    assert map_afwerking_code("B", "FESM", "")  == "SF"   # smalfeston
    assert map_afwerking_code("B", "FEBR", "")  == "FE"   # breedfeston -> feston
    assert map_afwerking_code("B", "FU12", "")  == "SF"
    assert map_afwerking_code("B", "F191", "")  == "SF"
    assert map_afwerking_code("B", "PE21", "")  == "B"    # breedband
    assert map_afwerking_code("B", "RM21", "")  == "B"
    assert map_afwerking_code("B", "KI36", "")  == "B"
    assert map_afwerking_code("B", "KIKK", "")  == "B"
    assert map_afwerking_code("B", "VOLU", "")  == "VO"
    assert map_afwerking_code("B", "LOCK", "")  == "LO"


def test_biasband_da_naar_on_v1():
    assert map_afwerking_code("B", "DA12", "") == "ON"


def test_b_zonder_bruikbare_fijn_default_breedband():
    assert map_afwerking_code("B", "rol 1/ 19,7 mtr", "") == "B"
    assert map_afwerking_code("B", "", "") == "B"


def test_leeg_grof_valt_terug_op_fijn_dan_default():
    assert map_afwerking_code("", "FESM", "") == "SF"
    assert map_afwerking_code("", "", "")     == "B"   # laatste vangnet


def test_onbekende_code_is_zichtbaar_via_is_herkend():
    from lib.afwerking_mapper import is_herkend
    assert is_herkend("B", "FESM") is True
    assert is_herkend("B", "rol 1/ 19,7 mtr") is False  # default-gebruikt -> rapporteren
    assert is_herkend("SB", "") is True
