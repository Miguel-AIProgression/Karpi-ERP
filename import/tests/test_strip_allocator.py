from lib.strip_allocator import Piece, Roll, alloceer


def _roll(rid, breedte, lengte, sinds, kwal="AEST", kleur="13"):
    return Roll(id=rid, breedte_cm=breedte, lengte_cm=lengte,
                kwaliteit=kwal, kleur=kleur, in_magazijn_sinds=sinds)


def _piece(ordernr, rgl, breedte, lengte, aantal=1, kwal="AEST", kleur="13"):
    return Piece(oud_ordernr=ordernr, oud_orderregel=rgl, kwaliteit=kwal,
                 kleur=kleur, breedte_nodig_cm=breedte,
                 lengte_verbruikt_cm=lengte, aantal=aantal)


def test_alloceer_enkel_stuk_op_passende_rol():
    rollen = [_roll(1, 400, 1500, "2025-01-01")]
    blok, ongedekt = alloceer([_piece("A", "1", 290, 200)], rollen)
    assert ongedekt == []
    assert len(blok) == 1
    assert blok[0].rol_id == 1
    assert blok[0].gereserveerde_lengte_cm == 200
    assert blok[0].breedte_nodig_cm == 290
    assert blok[0].deel_index == 1


def test_alloceer_fifo_kiest_oudste_rol():
    rollen = [
        _roll(1, 400, 1500, "2025-06-01"),
        _roll(2, 400, 1500, "2025-01-01"),  # ouder -> eerst
    ]
    blok, _ = alloceer([_piece("A", "1", 290, 200)], rollen)
    assert blok[0].rol_id == 2


def test_alloceer_fifo_null_sinds_achteraan():
    rollen = [
        _roll(1, 400, 1500, None),
        _roll(2, 400, 1500, "2025-06-01"),
    ]
    blok, _ = alloceer([_piece("A", "1", 290, 200)], rollen)
    assert blok[0].rol_id == 2


def test_alloceer_breedte_te_groot_is_ongedekt():
    rollen = [_roll(1, 250, 1500, "2025-01-01")]
    blok, ongedekt = alloceer([_piece("A", "1", 290, 200)], rollen)
    assert blok == []
    assert len(ongedekt) == 1
    assert "breedte" in ongedekt[0].reden.lower()


def test_alloceer_geen_kwal_kleur_match_is_ongedekt():
    rollen = [_roll(1, 400, 1500, "2025-01-01", kwal="AEST", kleur="13")]
    blok, ongedekt = alloceer([_piece("A", "1", 290, 200, kwal="VELV", kleur="24")], rollen)
    assert blok == []
    assert len(ongedekt) == 1


def test_alloceer_isoleert_kwal_kleur_groepen():
    # Een stuk uit groep (VELV,24) mag NIET op een rol uit groep (AEST,13) landen,
    # ook al is die rol breed en lang genoeg. Bewijst dat per_groep op (kwal,kleur)
    # sleutelt en niet enkel op kwaliteit.
    rollen = [
        _roll(1, 400, 1500, "2025-01-01", kwal="AEST", kleur="13"),
        _roll(2, 400, 1500, "2025-01-01", kwal="VELV", kleur="24"),
    ]
    blok, ongedekt = alloceer([_piece("A", "1", 290, 200, kwal="VELV", kleur="24")], rollen)
    assert ongedekt == []
    assert len(blok) == 1
    assert blok[0].rol_id == 2  # alleen de VELV/24-rol


def test_alloceer_uitwisselbaar_valt_terug_op_partner():
    # Geen eigen rol (VERR17), wel een uitwisselbare partner (LUXR17, zelfde kleur).
    rollen = [_roll(1, 400, 1500, "2025-01-01", kwal="LUXR", kleur="17")]
    pieces = [_piece("A", "1", 290, 200, kwal="VERR", kleur="17")]
    uitw = {("VERR", "17"): [("VERR", "17"), ("LUXR", "17")]}
    blok, ongedekt = alloceer(pieces, rollen, uitwisselbaar=uitw)
    assert ongedekt == []
    assert len(blok) == 1
    assert blok[0].rol_id == 1
    assert blok[0].kwaliteit == "VERR"        # order-kwaliteit
    assert blok[0].rol_kwaliteit == "LUXR"    # rol-kwaliteit (omgestickerd)


def test_alloceer_uitwisselbaar_eigen_kwaliteit_eerst():
    # Eigen rol (jonger) én partner-rol (ouder) -> eigen wint, ook al is partner ouder.
    rollen = [
        _roll(1, 400, 1500, "2024-01-01", kwal="LUXR", kleur="17"),  # ouder partner
        _roll(2, 400, 1500, "2025-01-01", kwal="VERR", kleur="17"),  # jongere eigen
    ]
    pieces = [_piece("A", "1", 290, 200, kwal="VERR", kleur="17")]
    uitw = {("VERR", "17"): [("VERR", "17"), ("LUXR", "17")]}
    blok, _ = alloceer(pieces, rollen, uitwisselbaar=uitw)
    assert blok[0].rol_id == 2


def test_alloceer_zonder_uitwisselbaar_blijft_exact():
    # Default (geen uitwisselbaar-map) -> partner-rol wordt NIET gebruikt.
    rollen = [_roll(1, 400, 1500, "2025-01-01", kwal="LUXR", kleur="17")]
    pieces = [_piece("A", "1", 290, 200, kwal="VERR", kleur="17")]
    blok, ongedekt = alloceer(pieces, rollen)
    assert blok == []
    assert len(ongedekt) == 1


def test_alloceer_full_width_verbruikt_lengte_lineair():
    # 2 stukken van 200 op een rol van 1500 -> beide passen, rol houdt 1100 over.
    rollen = [_roll(1, 400, 1500, "2025-01-01")]
    pieces = [_piece("A", "1", 290, 200), _piece("B", "1", 290, 200)]
    blok, ongedekt = alloceer(pieces, rollen)
    assert ongedekt == []
    assert {b.rol_id for b in blok} == {1}
    assert sum(b.gereserveerde_lengte_cm for b in blok) == 400


def test_alloceer_loopt_over_naar_volgende_rol():
    rollen = [
        _roll(1, 400, 300, "2025-01-01"),
        _roll(2, 400, 1500, "2025-02-01"),
    ]
    pieces = [_piece("A", "1", 290, 200), _piece("B", "1", 290, 200)]
    blok, ongedekt = alloceer(pieces, rollen)
    assert ongedekt == []
    # eerste stuk past op rol 1 (300>=200), tweede niet (100<200) -> rol 2
    assert blok[0].rol_id == 1
    assert blok[1].rol_id == 2


def test_alloceer_aantal_maakt_meerdere_delen():
    rollen = [_roll(1, 400, 1500, "2025-01-01")]
    blok, ongedekt = alloceer([_piece("A", "1", 290, 200, aantal=3)], rollen)
    assert ongedekt == []
    assert len(blok) == 3
    assert sorted(b.deel_index for b in blok) == [1, 2, 3]
    assert sum(b.gereserveerde_lengte_cm for b in blok) == 600


def test_alloceer_deel_index_uniek_per_order_regel():
    # Twee aparte stukken met dezelfde (ordernr, regel) -> deel_index 1 en 2,
    # niet beide 1 (anders botst de UNIQUE-constraint bij wegschrijven).
    rollen = [_roll(1, 400, 1500, "2025-01-01")]
    pieces = [_piece("A", "5", 290, 200), _piece("A", "5", 290, 150)]
    blok, ongedekt = alloceer(pieces, rollen)
    assert ongedekt == []
    assert len(blok) == 2
    assert sorted(b.deel_index for b in blok) == [1, 2]


def test_alloceer_rond_stuk_full_width():
    rollen = [_roll(1, 400, 1500, "2025-01-01")]
    blok, ongedekt = alloceer([_piece("A", "1", 300, 300)], rollen)
    assert ongedekt == []
    assert blok[0].gereserveerde_lengte_cm == 300
    assert blok[0].breedte_nodig_cm == 300
