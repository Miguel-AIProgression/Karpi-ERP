# 0024 — Handmatige rol-CRUD via RPC-laag, géén producten.voorraad-koppeling

**Status:** Geaccepteerd · 2026-05-15

## Context
De Rollen & Reststukken-pagina was read-only. Karpi wil rollen/reststukken
handmatig kunnen toevoegen/bewerken/verwijderen voor voorraadcorrectie en
inventarisatie.

## Beslissing
Drie `SECURITY DEFINER` RPC's (`rol_handmatig_toevoegen`,
`rol_handmatig_bewerken`, `rol_verwijderen`, mig 291-293) zijn het enige
mutatiepad. Elke RPC valideert, muteert en schrijft een auditregel in de nieuwe
tabel `rol_mutaties` (mig 290) in één transactie. Verwijderen heeft een guard
(alleen `beschikbaar` of los reststuk, niet in snijplan).

**Géén `producten.voorraad`-koppeling.** Geverifieerd in de code:
- de pagina toont m²-totalen live via `SUM(rollen.oppervlak_m2)`
  (`voorraadposities`-RPC, mig 179/180);
- de order-allocator/`order_reserveringen` is alleen voor `eenheid='stuks'`
  (mig 145) — rol-producten doen daar niet aan mee;
- geen RPC/trigger onderhoudt `producten.voorraad` vanuit rollen voor
  rol-artikelen.
Koppelen zou een legacy-kolom muteren die voor rollen nergens gelezen wordt.

## Alternatieven (verworpen)
- **B — directe table-writes vanuit frontend:** niet atomair, race-condities,
  wijkt af van het RPC-mutatiepatroon. Verworpen.
- **C — `producten.voorraad` volledig afleiden uit `SUM(rollen)` via trigger:**
  grote ingreep die alle bestaande ontvangst-/snij-RPC's raakt. Buiten scope;
  eigen traject.
- **`voorraad_mutaties` hergebruiken i.p.v. `rol_mutaties`:** kan niet —
  `rol_id` is `NOT NULL` met FK (overleeft delete niet) en er is geen
  verplichte-`reden`-kolom (mig 148 + database-schema.md ⚠️-noot).

## Gevolgen
Pagina is na elke mutatie automatisch correct. Volledige audittrail. Mogelijke
drift van de legacy `producten.voorraad` voor rol-artikelen blijft bestaan maar
is functioneel irrelevant (niemand leest het voor rollen).
