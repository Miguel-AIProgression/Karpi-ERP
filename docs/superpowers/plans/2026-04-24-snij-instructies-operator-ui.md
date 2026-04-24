# Snij-instructies in rol-uitvoer-modal — operator-feedback 2026-04-24

## Context

Na de release van migratie 133/134 + packing lookahead (2026-04-24) gaf de operator feedback op drie concrete rollen:

- **IC2901TA21C (TAMA 21, 1550 cm):** de "rij"-groepering met `Lengte-mes op 866 cm` is misleidend — hij denkt dat hij één snede van 866 cm moet maken over de volle breedte van de rol. Wat hij wil doen (en wat fysiek sneller is): per stuk één lengte-snede + één breedte-snede.
- **VERR130 C (VERR 13, 1500 cm):** voor ronde stukken (280×280 rond, 265×265 rond, 220×220 rond) toont de UI de klant-maat. De operator snijdt echter vierkant +5 cm (285×285, 270×270, 225×225) en zaagt dan met de hand het rondje eruit. De huidige UI vermeldt de +5 cm snij-marge niet expliciet.
- **LORA 13 I26080LO13C (1800 cm):** mes-stand aanhouden tussen opeenvolgende stukken wanneer breedte gelijk is scheelt omstel-tijd. Nu niet als instructie zichtbaar.
- **MARI13:** opgelost in de packing lookahead (ziet optimaal 1 rol i.p.v. 3).

## Jobs-to-be-done

### JTBD 1 — Per-stuk snij-instructies
> Als snij-operator wil ik per stuk een compacte instructie-regel zien met exact welke mes-stand en lengte-positie ik moet instellen, zodat ik niet hoef te interpreteren uit een shelf-groepering.

**Voorbeeld-template (per stuk):**
```
315 × 257 cm · Breedte-mes op 315 · Lengte-mes op 257 → reststuk 85 × 257 cm
309 × 309 cm · Breedte-mes op 309 · Lengte-mes op 309 → reststuk 91 × 309 cm
300 × 300 cm · Breedte-mes op 300 · Lengte-mes op 300 → reststuk 100 × 300 cm
```

In plaats van de huidige "Rij 1 — Lengte-mes op 866 cm" groeps-header.

### JTBD 2 — Rond-marge expliciet tonen
> Als snij-operator wil ik bij ronde stukken zien dat ik vierkant +5 cm moet snijden en daarna uit de hand rond moet uitzagen, zodat ik geen 280×280 snij waar ik 285×285 had moeten snijden.

**Voorbeeld-template:**
```
280 × 280 cm (rond) · Breedte-mes op 285 · Lengte-mes op 285
  → maakt 285 × 285 vierkant · daarna uit de hand 280 rond uitzagen · reststuk 115 × 285
```

**Context:** migratie 126 (`stuk_snij_marge_cm`) past de +5 cm al toe in de packer. `fetchStukken` in `db-helpers.ts` levert het stuk met opgehoogde maat. De modal weet dus de fysieke snij-maat én de klant-maat (die op de order-regel staat). Beide moeten zichtbaar zijn.

### JTBD 3 — Mes-stand behouden als opeenvolgende stukken gelijke breedte hebben
> Als snij-operator wil ik dat de instructie vermeldt "mes op dezelfde stand laten" als de volgende stuk dezelfde breedte heeft, zodat ik geen onnodige omstel-tijd kwijt ben.

**Voorbeeld:**
```
275 × 325 cm · Breedte-mes op 325 (ongewijzigd) · Lengte-mes op 275
250 × 250 cm · Breedte-mes op 250 (nieuw) · Lengte-mes op 250 → reststuk 150 × 250
250 × 250 cm · Breedte-mes op 250 (ongewijzigd) · Lengte-mes op 250 → reststuk 150 × 250
```

## Data-bron

Alle benodigde data is al beschikbaar in `SnijplanRow` / placement:
- `lengte_cm`, `breedte_cm` — snij-maat (al incl. marge uit migratie 126 vanaf de packer-input).
- `maatwerk_lengte_cm`, `maatwerk_breedte_cm` — klant-maat (origineel).
- `maatwerk_vorm` — 'rond' / 'ovaal' / 'rechthoek'.
- `maatwerk_afwerking` — bijv. 'ZO'.
- `positie_x_cm`, `positie_y_cm`, `geroteerd` — plaatsing op de rol.

Mes-stand = `positie_x_cm + breedte` (X-eind van het stuk). Lengte-snede = `positie_y_cm + lengte`.

## Te wijzigen files

- [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx)
- Mogelijk: [frontend/src/components/snijplanning/snij-visualisatie.tsx](frontend/src/components/snijplanning/snij-visualisatie.tsx) om de volgorde-nummering 1/2/3 te tonen in de SVG.
- Helpers: `frontend/src/lib/utils/snij-marges.ts` bestaat al (TS-equivalent van migratie 126).

## Open vragen (uit te zoeken vóór implementatie)

1. **Blijft de shelf-visualisatie (SVG) staan?** Die laat mooi zien WAAR op de rol stukken liggen. Ja behouden. De wijziging is alleen in de tekst-lijst daaronder.
2. **Hoe markeren we "mes-stand gelijk als vorige"?** Tekst-label "(ongewijzigd)" achter de mes-positie, of een subtiel kleurverschil.
3. **Welke volgorde voor de stukken-lijst?** Packing-volgorde (Y-oplopend) is de meest intuïtieve voor de snijder — zo scant hij de rol van voor naar achter.
4. **Rond + ZO combi?** Migratie 126: `GREATEST(ZO+6, rond+5) = ZO+6`. Toon dat duidelijk: "+6 cm ZO-marge (rondom)".

## Prioriteit

Medium-high — niet blokkerend, maar operator-productiviteit stijgt met betere instructies.
Doen nádat we:
1. ✅ Cross-kwaliteit release-bug (migr 133).
2. ✅ Tekort-analyse UI-sync (migr 134).
3. ✅ Packing lookahead (2 passes).
4. ⬜ Deploy + verifieer bovenstaande werken in productie.
5. ⬜ **Deze wijziging** (per-stuk instructies + rond-marge tonen).
