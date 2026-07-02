from datetime import date
from pathlib import Path

from update_voorraad import parse_lijst_datum, correctie_al_verwerkt_door_basta


# ── parse_lijst_datum ────────────────────────────────────────────────────────

def test_parse_lijst_datum_uit_bestandsnaam():
    assert parse_lijst_datum(Path("Voorraadlijst 01-6-2026.xls")) == date(2026, 6, 1)
    assert parse_lijst_datum(Path("Voorraadlijst 15-6-2026 (1).xls")) == date(2026, 6, 15)


def test_parse_lijst_datum_fallback_op_vandaag():
    assert parse_lijst_datum(Path("export_zonder_datum.xls")) == date.today()


# ── correctie_al_verwerkt_door_basta ────────────────────────────────────────
# Geen dubbeltelling: een correctie van vóór de lijst-datum is al in Basta's
# eigen telling verwerkt -> moet AFGESLOTEN worden (True), niet nog eens
# opgeteld. Een correctie op/na de lijst-datum kende Basta nog niet -> moet
# TOEGEPAST blijven worden (False, blijft open).

def test_correctie_voor_lijst_datum_is_al_verwerkt():
    assert correctie_al_verwerkt_door_basta("2026-05-30T10:00:00+00:00", date(2026, 6, 1)) is True


def test_correctie_op_of_na_lijst_datum_nog_niet_verwerkt():
    assert correctie_al_verwerkt_door_basta("2026-06-01T10:00:00+00:00", date(2026, 6, 1)) is False
    assert correctie_al_verwerkt_door_basta("2026-06-05T10:00:00+00:00", date(2026, 6, 1)) is False


def test_correctie_accepteert_zulu_timestamp():
    assert correctie_al_verwerkt_door_basta("2026-05-30T10:00:00Z", date(2026, 6, 1)) is True
