# ADR-0028: Maatwerk-voorraad reservering bij migratie uit oud systeem

**Status:** Geaccepteerd — 2026-06-04

## Context
De standaardafmetingen-voorraad is 1-op-1 overgenomen uit het oude systeem. Voor
maatwerk geldt een probleem: in het oude systeem worden op-maat orders NIET op de
rol gereserveerd. Zetten we de rollenvoorraad 1-op-1 over, dan missen de nog te
snijden op-maat orders hun beslag op de rollengte → het nieuwe systeem zou die
lengte als vrij beschouwen en kan dubbel verkopen.

## Beslissing
Een eenmalig migratiescript legt elke nog-niet-gesneden op-maat order vast als een
**full-width FIFO-lengtestrip** op een fysieke rol, in een aparte tabel
`migratie_blokkering` (ontkoppeld van `order_reserveringen` — dit zijn oud-systeem
orders zonder new-system order_regel_id). Methodiek spiegelt het snijden:
`breedte_nodig = max(A,B)` moet op `rol.breedte_cm` passen, `lengte_verbruikt =
min(A,B)` wordt over de volle breedte afgenomen, FIFO op `in_magazijn_sinds`. Geen
2D-nesting (bewust conservatief: liever lengte overschatten dan dubbelverkopen).

De packer ziet de blokkering als één virtuele bezette plaatsing onderaan de rol
(`fetchBezettePlaatsingen`) en plant er niet overheen; `voorraadposities` trekt de
geblokkeerde m² af. Een dagelijks release-script zet een blokkering op
`vrijgegeven` zodra de order in een nieuwere snijlijst-versie als gesneden staat.

## Gevolgen
- Geen wijziging aan `fetchBeschikbareRollen`: de lengte-aftrek loopt volledig via
  de strip-Placement in `fetchBezettePlaatsingen`. Óók daar lengte aftrekken zou
  dubbel blokkeren (de packer leidt vrije ruimte af uit breedte×lengte minus
  bezette placements).
- `migratie_blokkering` is tijdelijk: zodra alle oude orders gesneden/vrijgegeven
  zijn, is de tabel leeg en kan ze gearchiveerd worden.
