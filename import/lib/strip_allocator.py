"""FIFO-full-width strip-allocator voor de maatwerk-reservering-migratie.

Per (kwaliteit, kleur)-groep worden stukken op rollen gelegd: elk stuk neemt de
volle rolbreedte × lengte_verbruikt_cm. FIFO op in_magazijn_sinds (oudste eerst,
NULL achteraan). Geen 2D-nesting (bewust conservatief). Pure logica, geen IO.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Roll:
    id: int
    breedte_cm: int
    lengte_cm: int
    kwaliteit: str
    kleur: str               # genormaliseerd (zonder .0)
    in_magazijn_sinds: str | None
    resterend_cm: int = field(default=0)

    def __post_init__(self):
        if not self.resterend_cm:
            self.resterend_cm = self.lengte_cm


@dataclass
class Piece:
    oud_ordernr: str
    oud_orderregel: str
    kwaliteit: str
    kleur: str               # genormaliseerd
    breedte_nodig_cm: int
    lengte_verbruikt_cm: int
    aantal: int = 1


@dataclass
class Blokkering:
    rol_id: int
    oud_ordernr: str
    oud_orderregel: str
    deel_index: int
    gereserveerde_lengte_cm: int
    breedte_nodig_cm: int
    kwaliteit: str
    kleur: str


@dataclass
class Ongedekt:
    oud_ordernr: str
    oud_orderregel: str
    deel_index: int
    kwaliteit: str
    kleur: str
    breedte_nodig_cm: int
    lengte_verbruikt_cm: int
    reden: str


_VER_TOEKOMST = "9999-12-31"


def _fifo_key(rol: Roll):
    return (rol.in_magazijn_sinds or _VER_TOEKOMST, rol.id)


def alloceer(pieces: list[Piece], rollen: list[Roll]):
    """Alloceer stukken op rollen. Returns (list[Blokkering], list[Ongedekt]).

    Muteert `rollen[*].resterend_cm` in-place. Sorteer-stabiel: FIFO op sinds.
    """
    # Groepeer rollen per (kwaliteit, kleur), FIFO-gesorteerd.
    per_groep: dict[tuple[str, str], list[Roll]] = {}
    for rol in rollen:
        per_groep.setdefault((rol.kwaliteit, rol.kleur), []).append(rol)
    for groep in per_groep.values():
        groep.sort(key=_fifo_key)

    blok: list[Blokkering] = []
    ongedekt: list[Ongedekt] = []

    for piece in pieces:
        for deel in range(1, piece.aantal + 1):
            if not piece.kwaliteit or not piece.kleur:
                ongedekt.append(_ongedekt(piece, deel, "geen kwal/kleur-parse"))
                continue
            kandidaten = per_groep.get((piece.kwaliteit, piece.kleur), [])
            if not kandidaten:
                ongedekt.append(_ongedekt(piece, deel, "geen rol in deze kwal/kleur"))
                continue
            gekozen = _kies_rol(kandidaten, piece)
            if gekozen is None:
                # Onderscheid: bestaat er wél een rol breed genoeg maar te kort?
                breed_genoeg = any(
                    r.breedte_cm >= piece.breedte_nodig_cm for r in kandidaten
                )
                reden = ("geen rol met genoeg restlengte"
                         if breed_genoeg
                         else "geen rol breedte-passend")
                ongedekt.append(_ongedekt(piece, deel, reden))
                continue
            gekozen.resterend_cm -= piece.lengte_verbruikt_cm
            blok.append(Blokkering(
                rol_id=gekozen.id,
                oud_ordernr=piece.oud_ordernr,
                oud_orderregel=piece.oud_orderregel,
                deel_index=deel,
                gereserveerde_lengte_cm=piece.lengte_verbruikt_cm,
                breedte_nodig_cm=piece.breedte_nodig_cm,
                kwaliteit=piece.kwaliteit,
                kleur=piece.kleur,
            ))
    return blok, ongedekt


def _kies_rol(kandidaten: list[Roll], piece: Piece) -> Roll | None:
    """Eerste FIFO-rol die breed genoeg is én genoeg restlengte heeft."""
    for rol in kandidaten:
        if (rol.breedte_cm >= piece.breedte_nodig_cm
                and rol.resterend_cm >= piece.lengte_verbruikt_cm):
            return rol
    return None


def _ongedekt(piece: Piece, deel: int, reden: str) -> Ongedekt:
    return Ongedekt(
        oud_ordernr=piece.oud_ordernr,
        oud_orderregel=piece.oud_orderregel,
        deel_index=deel,
        kwaliteit=piece.kwaliteit,
        kleur=piece.kleur,
        breedte_nodig_cm=piece.breedte_nodig_cm,
        lengte_verbruikt_cm=piece.lengte_verbruikt_cm,
        reden=reden,
    )
