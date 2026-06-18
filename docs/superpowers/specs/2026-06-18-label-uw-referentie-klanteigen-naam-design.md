# Verzendlabel: "Uw referentie:" — klant-eigennaam voor de kwaliteit

**Datum:** 2026-06-18
**Status:** Ontwerp goedgekeurd, klaar voor implementatieplan
**Branch:** `feat/label-uw-referentie`

## Probleem

Sommige klanten hanteren een eigen, afwijkende naam voor een kwaliteit (bv. debiteur
noemt `BEAC` intern "BREDA", of Room108 noemt `LUXURY` "CHIQUE"). Op het oude systeem
stond die eigennaam op de verzendsticker als regel `Uw referentie: <eigennaam>`, direct
onder de kwaliteitscode. Op het huidige RugFlow-verzendlabel ontbreekt die regel.

Gewenst eindbeeld (compact label, linkerblok):

```
Order: ORD-2026-0353   Ref: 305494 - Huys      ← bestaande order-referentie (klant_referentie)
GALA10XX200290                                  ← kwaliteitscode (bold)
Uw referentie: BREDA                            ← NIEUW: klant-eigennaam, alleen indien aanwezig
GALA10XX200290 290x200 cm                       ← omschrijving + maat
```

De regel verschijnt **alleen** bij klanten/kwaliteiten waarvoor een eigennaam bestaat;
in alle andere gevallen blijft het label ongewijzigd.

## Databron

Bestaande tabel `klanteigen_namen` (debiteur × kwaliteit × kleur → `benaming`), opgevraagd
via RPC `resolve_klanteigen_naam(debiteur_nr, kwaliteit_code, kleur_code)` (mig 199/200).
Dezelfde bron voedt al de maatwerk-sticker (mig 295) en de orderbevestiging-PDF. De
resolve-ladder valt terug op inkoopgroep-niveau en geeft `NULL` als er geen eigennaam is.

> Term-botsing onderkend: op het label staat al `Ref:` (= `order.klant_referentie`, de
> order-referentie). De nieuwe regel heet bewust ook "Uw referentie:" — dat is een
> expliciete keuze van de gebruiker (sluit aan op hun bestaande sticker-terminologie).

## Architectuurkeuze: snapshot, geen live resolve

Het verzendlabel wordt volledig gevoed uit bevroren snapshots op `zending_colli`
(`omschrijving_snapshot`, `klant_omschrijving_snapshot`, `lengte_cm`, …), gevuld bij
`genereer_zending_colli`. We volgen exact dat patroon: de eigennaam wordt op het
shipmoment geresolved en als snapshot-kolom bevroren.

**Waarom snapshot (niet live):**
- Consistent met élk ander labelveld → de frontend leest puur één extra veld, geen
  resolve-logica, geen extra join in de label-query.
- Reprint-stabiliteit: een latere hernoeming in `klanteigen_namen` wijzigt geen reeds
  verzonden label.
- De colli draagt `kwaliteit_code` al intern; alleen `debiteur_nr` + `kleur_code` moeten
  erbij voor de resolve.

Kosten: één migratie + een voorzichtige `CREATE OR REPLACE` van de "superset"-functie
`genereer_zending_colli` (zie risico hieronder).

## Ontwerp — één verticale slice (DB → query → data-laag → UI)

### 1. Database (migratie, volgend vrij nummer ≥ 418)

> Migratienummer vlak vóór merge her-verifiëren t.o.v. `origin/main` (parallelle sessies
> claimen nummers — bekend collisierisico).

- `ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS klanteigen_naam_snapshot TEXT;`
- `CREATE OR REPLACE FUNCTION genereer_zending_colli` als **superset van mig 400**
  (volledige mig 400-body overnemen — gewicht-ladder + `klant_omschrijving_snapshot` +
  `lengte_cm`/`breedte_cm` + de mig 400 product-join via
  `COALESCE(ore.artikelnr, zr.artikelnr)`), met uitsluitend deze toevoegingen:
  - extra `LEFT JOIN orders o ON o.id = ore.order_id` (voor `o.debiteur_nr`);
  - `kleur_code := COALESCE(ore.maatwerk_kleur_code, p.kleur_code)` in de `SELECT`-scope
    (analoog aan de bestaande `kwaliteit_code`-COALESCE en aan mig 295);
  - de nieuwe kolom `klanteigen_naam_snapshot` in de `INSERT`, gevuld met
    `resolve_klanteigen_naam(o.debiteur_nr, <kwaliteit_code>, <kleur_code>)`.
  - **Raw benaming opslaan** (bv. "BREDA"), géén "Uw referentie:"-prefix — presentatie
    hoort in de UI.
- **Backfill** voor niet-verzonden zendingen (`status NOT IN ('Onderweg','Afgeleverd')`),
  exact in de stijl van de mig 400-backfill, met dezelfde joins (incl. `orders` + kleur).
  Reeds verzonden zendingen blijven ongemoeid → reprint daarvan toont geen regel (bewust,
  historie-conform; oude shipments hadden de regel nooit als snapshot).
- Drift-check: na apply met `pg_get_functiondef` verifiëren dat de live-body de complete
  superset is.
- `NOTIFY pgrst, 'reload schema';`

**Carriers raken dit niet:** `klanteigen_naam_snapshot` is een puur geprint visueel
hulpmiddel; HST/Verhoek/Rhenus-payloads en de pakbon krijgen het veld niet.

### 2. Query

[zendingen.ts](../../../frontend/src/modules/logistiek/queries/zendingen.ts): voeg
`klanteigen_naam_snapshot` toe aan de `zending_colli`-select.

### 3. Data-laag (pure rij-opbouw)

[printset.ts](../../../frontend/src/modules/logistiek/lib/printset.ts):
- `LabelItem` krijgt `klanteigenNaamSnapshot: string | null`.
- `bouwVerzenddocument` mapt `c.klanteigen_naam_snapshot` op de colli-rij (naast de
  bestaande snapshot-velden).

[shipping-label-data.ts](../../../frontend/src/modules/logistiek/lib/shipping-label-data.ts):
exposeert de eigennaam voor de label-componenten (pure read; **geen** live-fallback —
consistent met de snapshot-keuze).

### 4. UI — alle drie labelvarianten

Voeg in elk component een conditionele regel `Uw referentie: {naam}` toe, direct onder de
vetgedrukte kwaliteitscode, alleen renderen bij een niet-lege waarde:
- [shipping-label.tsx](../../../frontend/src/modules/logistiek/components/shipping-label.tsx) (compact)
- [shipping-label-tall.tsx](../../../frontend/src/modules/logistiek/components/shipping-label-tall.tsx) (staand/HST)
- [dpd-shipping-label.tsx](../../../frontend/src/modules/logistiek/components/dpd-shipping-label.tsx) (DPD)

Per colli = per stuk: elke colli toont de eigennaam van zijn eigen kwaliteit; in een
multi-product zending kunnen colli's dus verschillende regels tonen.

### 5. Testen

- `printset.test.ts` uitbreiden: colli mét en zónder `klanteigen_naam_snapshot` →
  `klanteigenNaamSnapshot` correct (resp. de waarde / `null`) op `colliRijen`.
- Visuele plaatsing + print-marges verifieert de gebruiker via een echte print-test vóór
  push (conform de print-marge-valkuil: assistent claimt dit niet zelf als "geverifieerd").

## Buiten scope (YAGNI)

- Pakbon — gebruiker vroeg specifiek om de sticker.
- Carrier-payloads (HST/Verhoek/Rhenus) en DESADV.
- Beheer-UI voor `klanteigen_namen` — die data wordt al elders beheerd
  (`/debiteuren`-benaming-beheer).
- Live-fallback voor reeds verzonden (pre-snapshot) zendingen.

## Risico's

- **Superset-drift op `genereer_zending_colli`.** De `CREATE OR REPLACE` moet de volledige
  mig 400-body bevatten plus de toevoeging; een onvolledige body laat gewicht/omschrijving/
  afmetingen stilletjes vallen. Mitigatie: kopieer mig 400 §2 letterlijk als basis,
  drift-check met `pg_get_functiondef` na apply.
- **Migratienummer-collisie** bij parallelle sessies. Mitigatie: nummer her-verifiëren
  vlak vóór merge.
- **`debiteur_nr`-bron in colli-generatie.** `order_regels.order_id → orders.debiteur_nr`;
  de extra `LEFT JOIN orders` moet die correct binnenhalen (verifiëren dat `ore.order_id`
  bestaat en gevuld is).
