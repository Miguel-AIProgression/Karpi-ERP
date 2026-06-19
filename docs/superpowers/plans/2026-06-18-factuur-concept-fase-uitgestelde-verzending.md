# Plan: factuur concept-fase + uitgestelde verzending (herbouw bij verzenden)

**Datum:** 2026-06-18
**Branch:** `feat/factuur-concept-fase`
**Aanleiding:** Bugmelding "2 orders niet bij gefactureerd" (ORD-2026-0614, ORD-2026-0620). Diagnose: niets kapot — de op 18-06 ingevoerde 2-uur-verzendvertraging (mig 423) maakt de factuur **pas na 2u** aan, dus er staat in dat venster niets in de facturatie-module. Gebruiker wil: factuur **direct als concept** zichtbaar, e-mail/EDI **pas na 2u**, en order-correcties in het venster gaan automatisch mee (= "herbouwen bij verzenden").

## Probleemstelling

`genereer_factuur_voor_bundel` (mig 234 → 341, de enige live factuur-RPC) is **niet herhaalbaar**. Bij het aanmaken doet hij meteen twee onomkeerbare side-effects op de order:
1. `UPDATE order_regels SET gefactureerd = orderaantal` (oude waarde niet bewaard);
2. `INSERT INTO order_regels` van `BUNDELKORTING`/`DREMPELKORTING`-regels.

Een tweede aanroep voor dezelfde zending faalt (`no_data_found`, want `gefactureerd` is al vol). "Concept nu + bij verzenden opnieuw opbouwen" kan dus niet zonder de RPC te splitsen.

## Ontwerp: projectie + finalisatie

Splits de generatie in een **herhaalbare projectie** (concept, geen side-effects) en een **eenmalige finalisatie** (side-effects, bij verzenden).

### Nieuwe/gewijzigde RPC's (mig 428)

- **`projecteer_concept_factuur(p_zending_id BIGINT, p_factuur_id BIGINT DEFAULT NULL) RETURNS BIGINT`** — herhaalbaar, GEEN side-effects.
  - `p_factuur_id IS NULL` → `INSERT INTO facturen (... status='Concept')` met nieuw `volgend_nummer('FACT')`; anders hergebruik de bestaande factuur-header en `DELETE FROM factuur_regels WHERE factuur_id = p_factuur_id`.
  - Bouw `factuur_regels` (product + VERZEND + BUNDELKORTING/DREMPELKORTING **factuur**-regels) + totalen uit de **actuele** order — exact de mig-341-logica, MAAR:
    - **géén** `UPDATE order_regels SET gefactureerd`;
    - **géén** `INSERT INTO order_regels` (de korting-*orderregels*).
  - Product-regelselectie blijft `gefactureerd < orderaantal` (flip is nog niet gedaan, dus alles wordt meegenomen).
  - Behoudt de no-op-guard (0 te-factureren regels → `no_data_found`).
  - Return `factuur_id`.

- **`finaliseer_concept_factuur(p_zending_id BIGINT, p_factuur_id BIGINT) RETURNS BIGINT`** — eenmalig, MÉT side-effects.
  - Roept `projecteer_concept_factuur(p_zending_id, p_factuur_id)` aan → verse regels uit de actuele order (correcties in het venster gaan zo mee).
  - Past dán de side-effects toe: `UPDATE order_regels SET gefactureerd = orderaantal` + `INSERT` de `BUNDELKORTING`/`DREMPELKORTING`-orderregels (mig-341 deel 3a/3b).
  - Status blijft `Concept`; de edge function zet `Verstuurd` ná succesvolle mail/EDI (ongewijzigd).
  - Return `factuur_id`.

**Refactor-vorm:** een interne helper bevat de gedeelde "bouw regels + totalen"-logica zodat projectie en finalisatie identieke bedragen produceren. De korting-*factuur*-regels horen in de helper (staan op de factuur, concept én finaal); de korting-*orderregels* + `gefactureerd`-flip zijn de side-effects en leven alleen in `finaliseer`.

**Bron-koppeling = de queue-rij** (geen nieuwe kolom op `facturen`): `factuur_queue.factuur_id` koppelt zending ↔ concept-factuur. De drain orchestreert; `projecteer` hoeft zelf niet te zoeken.

### Drain-aanpassing (edge function `factuur-verzenden`), 2 fasen per run

1. **Fase 1 — concepten maken** (geen delay-gate): claim `pending`-rijen met `factuur_id IS NULL` (nieuwe RPC `claim_concept_queue_items`, `FOR UPDATE SKIP LOCKED`, race-safe) → `projecteer_concept_factuur(zending_id, NULL)` → `UPDATE factuur_queue SET factuur_id`. Concept verschijnt op de eerstvolgende cron-tik (~1 min na verzending). De rij blijft `pending`.
2. **Fase 2 — finaliseren + versturen** (delay-gate): `claim_factuur_queue_items` — nú óók gegate op `factuur_id IS NOT NULL` — claimt alleen rijen die beschikbaar zijn (`beschikbaar_op <= now()`) én een concept hebben. → `finaliseer_concept_factuur(zending_id, factuur_id)` → PDF + mail/EDI → `facturen.status='Verstuurd'` + queue `done`. (Rest van de edge function ongewijzigd.)

`claim_factuur_queue_items` (mig 428) = mig-423-body + extra `AND inner_q.factuur_id IS NOT NULL`. Return-shape ongewijzigd.

### Waarom concept via de drain en niet via de order-trigger?

De trigger `enqueue_factuur_voor_event` draait in de transactie van *pickronde voltooien*. Factuur-generatie daarin zou betekenen dat een generatie-fout het voltooien van de pickronde blokkeert. Drain-fase-1 ontkoppelt dat; de prijs is ~1 min latency op de concept-zichtbaarheid (acceptabel).

## Migratie-veiligheid

- Bestaande `pending` queue-rijen (o.a. #34/#35 nu) hebben `factuur_id IS NULL` → fase 1 maakt er een concept voor, fase 2 finaliseert na `beschikbaar_op`. Werkt zonder backfill.
- Worden #34/#35 vóór deploy al door het oude pad verstuurd (om ~20:00) → prima, dan zijn ze klaar.
- Wekelijkse cron (`zending_id IS NULL`, `type='wekelijks'`) en legacy-fallback (`genereer_factuur` / `genereer_factuur_voor_week`) blijven het oude directe pad volgen — de 2-fasen-splitsing geldt alleen voor het `zending_id`-pad.

## Slices (verticaal, in volgorde)

1. **Mig 428** — `projecteer_concept_factuur` + `finaliseer_concept_factuur` + `claim_concept_queue_items` + `claim_factuur_queue_items`-gate. Draaien op DB + probe-query op een testorder: projectie zet `gefactureerd` NIET, finalisatie wel; bedragen identiek aan het oude pad.
2. **Edge function `factuur-verzenden`** — 2-fasen-drain. Deploy + rooktest met een verse per_zending-zending: concept verschijnt < 1 min, mail pas na delay.
3. **Verificatie + docs** — CLAUDE.md-bullet (mig 423 uitbreiden), `changelog.md`, deze plan-status.

## Risico's / aandachtspunten

- **Kritieke financiële RPC** — bedragen moeten byte-identiek blijven aan mig 341. Probe vergelijkt subtotaal/btw/totaal + factuur_regels van een concept-→-finaal traject met het oude pad.
- **Retry na geslaagde finalisatie maar gefaalde mail** (opgelost) — `finaliseer_concept_factuur` (rebuild + `gefactureerd`-flip + korting-orderregels) commit als één RPC-transactie. Faalt dáárna de mail, dan zet de edge function de queue terug op `pending` voor retry — maar opnieuw finaliseren kan niet (gefactureerd is al vol → projectie-rebuild vindt 0 regels → `no_data_found`). **Oplossing: vlag `factuur_queue.gefinaliseerd_op TIMESTAMPTZ` (mig 428).** De edge function roept `finaliseer` alleen aan als `gefinaliseerd_op IS NULL` en zet 'm daarna; bij retry wordt finaliseren overgeslagen en alleen de bestaande factuur opnieuw gemaild. Robuust tegen mail-flakiness zonder de order-state te corrumperen.
- **Geen pgTAP-harnas** — DB-verificatie is handmatige probe op testorder.
