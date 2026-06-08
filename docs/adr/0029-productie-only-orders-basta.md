# ADR-0029: Productie-only orders uit Basta

**Status:** Geaccepteerd — 2026-06-08

> **Vervangt [ADR-0028](0028-maatwerk-voorraad-reservering-migratie.md)** — de virtuele
> `migratie_blokkering` wordt na de import + planning vrijgegeven; de echte snijplannen
> van de geïmporteerde orders worden de claim op de rollengte.

## Context

In het oude systeem **Basta** (zie [`CONTEXT.md`](../../CONTEXT.md)) staat een backlog
nog-niet-gesneden maatwerk-orders (t/m 03-06-2026, ~1.276 regels). Piet-hein wil dat
maatwerk digitaal door RugFlow's snij- + confectie-planning laten lopen — gestuurd door
de packer/auto-planner, zichtbaar op de snijplanning, gereserveerd op de fysieke rol —
in plaats van de geprinte-Excel-en-afvink-loop.

Maar: **factureren, verzenden en labels printen blijven in Basta.** Deze orders mogen
dus nooit in Pick & Ship, facturatie of transport van RugFlow opduiken. Ze hebben geen
prijs en geen new-system-debiteur-belofte; RugFlow is voor hen puur een snij-/confectie-
tracker + opzoek-bord (opzoekbaar op het Basta-ordernummer).

ADR-0028 loste het rollengte-probleem op met een aparte, virtuele tabel
`migratie_blokkering` (een full-width FIFO-lengtestrip per oude order, ontkoppeld van
`order_reserveringen`). Dat reserveerde de lengte wél, maar gaf geen snij-/confectie-
zichtbaarheid en was een tweede bron-van-waarheid naast de echte snijplannen. Door de
oude orders als **echte** orders te importeren wordt dat één bron van waarheid.

## Beslissing

Importeer elke Basta-order als een **echte `orders`-rij + echte `order_regels`** met een
expliciete schakelaar `orders.alleen_productie = true`. De bestaande trigger
`auto_maak_snijplan` maakt per stuk een echt **Snijplan** — dat snijplan is de claim op
de rollengte en **vervangt** de `migratie_blokkering`.

Kernkeuzes:

- **Label + terminale status i.p.v. losse guards.** Eén vlag `alleen_productie` (CHECK
  `chk_alleen_productie_bron`: `alleen_productie ⇒ bron_systeem='oud_systeem'`) en één
  nieuwe terminale status `'Maatwerk afgerond'` dragen de hele semantiek. Guards lezen
  de vlag uit; ze stapelen geen string-lijsten of speciale order-nummers.
- **Twee chokepoints** beheersen de levenscyclus end-to-end:
  1. **Pick & Ship-guard** — `fetchOpenOrderHeaders` filtert `alleen_productie = false`
     → een productie-only order verschijnt nooit in Pick & Ship, facturatie of transport.
  2. **`voltooi_confectie`-flip** — zodra *alle* snijplannen van de order confectie-
     afgerond zijn (`confectie_afgerond_op IS NOT NULL`), flipt de order naar
     `'Maatwerk afgerond'`. Strikt geguard op `alleen_productie = true`.
- **Standaardmaat-stukken claimen geen rollengte.** Een nieuwe vlag
  `order_regels.snijden_uit_standaardmaat` (gekopieerd naar `snijplannen` door
  `auto_maak_snijplan`) markeert stukken die uit een standaard-maat kleed worden
  gesneden i.p.v. uit een rol. `fetchStukken` sluit die uit van de rol-packing, maar
  ze blijven zichtbaar in snijplanning + confectie.
- **Afwerking via GROF+FIJN-mapper.** Basta's grove + fijne afwerkingscodes worden via
  `import/lib/afwerking_mapper.py` gemapt naar FK-veilige `afwerking_types.code`
  (B/SB/FE/SF/LO/VO/ON/ZO). Niet-herkende codes vallen terug op `B` (breedband) en
  worden gerapporteerd in de dry-run. Biasband (DA-codes) → `ON` (stickeren) in V1.
- **Verzendweek → maandag als afleverdatum.** Basta levert de verzendweek (`WW-2026`);
  het import-script zet die om naar de maandag van die ISO-week als `afleverdatum`.
- **Debiteur: echte-match-of-verzameldebiteur.** De RPC matcht het meegegeven
  debiteurnummer op een bestaande debiteur; lukt dat niet, dan landt de order op de
  verzameldebiteur **900000 'OUD SYSTEEM (PRODUCTIE)'**.
- **Idempotentie op `oud_order_nr`.** `import_productie_only_order` is idempotent: een
  partiële UNIQUE-index `orders_oud_order_nr_uniek` + een bestaans-check maken her-import
  veilig (retourneert `was_existing = true`, doet niets).

**Gouden regel:** elke wijziging is geguard op `alleen_productie = true` (resp. de
standaardmaat-vlag). Gewone orders blijven byte-voor-byte ongewijzigd.

## Gevolgen

- **Cutover van ADR-0028:** na de import + planning wordt de oude `migratie_blokkering`
  vrijgegeven; de echte snijplannen nemen de rollengte-claim over. Eén bron van waarheid.
- **Buiten facturatie/verzending:** productie-only orders tellen niet mee in Pick & Ship,
  facturatie, transport of zending-bundeling. Ze bereiken `'Maatwerk afgerond'` (nooit
  `'Verzonden'`) en triggeren géén annulerings-cascade (anders dan `'Geannuleerd'`).
- **Directe `orders.status`-mutatie (bewuste keuze).** De import gebruikt een directe
  `INSERT` (status `'In productie'`) resp. `UPDATE` (`'Maatwerk afgerond'` in
  `voltooi_confectie`) — niet `_apply_transitie` / een lifecycle-event uit de
  Order-lifecycle Module (mig 218). Dit is een import-/productie-context buiten de
  reguliere new-system-orderflow; een lifecycle-event zou allocator- en factuur-listeners
  vuren die voor deze orders bewust níet mogen draaien.
- **Additief + geguard:** alle DB-, RPC-, view- en frontend-wijzigingen zijn strikt
  additief en geguard op `alleen_productie` (resp. `snijden_uit_standaardmaat`). Geen
  bestaand pad voor gewone orders verandert van gedrag.

## Referenties

- Plan: [`docs/superpowers/plans/2026-06-08-productie-only-import-en-snijplanning.md`](../superpowers/plans/2026-06-08-productie-only-import-en-snijplanning.md)
- Migraties: **327** (schema: vlag, CHECK, enum, standaardmaat-vlaggen, verzameldebiteur,
  idempotentie-index), **328** (`auto_maak_snijplan`/`auto_sync_snijplan_maten` kopiëren
  de standaardmaat-vlag), **329** (RPC `import_productie_only_order`), **330**
  (`voltooi_confectie`-flip naar `'Maatwerk afgerond'`), **331** (view
  `snijplanning_overzicht` + 3 kolommen).
- Code: `import/lib/afwerking_mapper.py`, `import/import_productie_only.py`,
  `supabase/functions/_shared/db-helpers.ts` (`fetchStukken`),
  `frontend/src/components/orders/basta-afhandeling-paneel.tsx`.
- Domeintaal: [`CONTEXT.md`](../../CONTEXT.md) — Basta, Productie-only order,
  Maatwerk afgerond, Migratie-blokkering.
