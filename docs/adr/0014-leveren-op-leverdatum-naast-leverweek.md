---
status: accepted
date: 2026-05-11
---

# Leveren op leverdatum naast leverweek — `lever_type`-attribuut op order

## Context

Karpi levert in ~90% van de orders **per leverweek** (B2B-groothandel): de vervoerder haalt op, levert een week later bij de klant. Met het toenemend aandeel B2C-leveringen — Floorpassion-webshop (zie [project-memory](../../README.md) en mig 117-derived consumer-flow), particuliere maatwerk-orders — wordt het echter steeds vaker nodig om **op een specifieke dag** te leveren ("donderdag 14 mei thuisbezorgd").

Onder de motorkap leeft het hele systeem al op `orders.afleverdatum` DATE. De UI dwingt de gebruiker echter een **week** te kiezen (week-picker in [order-form.tsx](../../frontend/src/components/orders/order-form.tsx)), en de bundel-, factuur- en snij-logica is op verzendweek gespiegeld (mig 228-232). Drie gevolgen daarvan zijn problematisch voor dag-orders:

1. **Pick & Ship-horizon** — een order met afleverdatum vrijdag verschijnt nu direct in Pick & Ship; de magazijnier zou 'm op dinsdag al kunnen picken en wegzetten. Voor week-orders is dat OK (hele week speling), voor een dag-belofte aan een consument is dat een breukrisico: pakket te vroeg klaar = vergeten op de pickdag, of erger: te vroeg verzonden = klant niet thuis.
2. **Snij-/productieprioriteit** — `berekenSnijAgenda` sorteert op `vroegste_afleverdatum` − `logistieke_buffer_dagen` (default 2 dagen). Voor een week-order met afleverdatum-vrijdag werkt dat (snijden t/m woensdag is veilig). Voor een dag-order op donderdag van diezelfde week is dat te krap: snijden op donderdag-zelf laat geen ruimte voor confectie + inpak + handoff aan vervoerder.
3. **Intentie verloren** — als we de specifieke dag alleen in `afleverdatum` zetten zonder vlag, kan de IO-claim-sync (mig 153, `herwaardeer_order_status`) deze stilletjes vooruit schuiven naar een latere datum als IO-claims later vallen. Voor een week-order is dat acceptabel (afspraak was "die week"); voor een dag-belofte is het een woordbreuk.

## Beslissing

Introduceer **`orders.lever_type`** als ENUM (`'week' | 'datum'`) met default `'week'`. Eén kolom — driedelig effect:

### Anker 1 — Modus-keuze tijdens orderaanmaak

In [order-form.tsx](../../frontend/src/components/orders/order-form.tsx) komt een segmented toggle "Leveren per week / Leveren op datum" naast de afleverdatum-input. Default = `client.default_lever_type` (nieuwe kolom op `debiteuren`, default `'week'`). B2C-klanten kunnen op klant-niveau standaard 'datum' krijgen.

- `lever_type='week'`: huidige flow ongewijzigd — week-picker, `afleverdatum` = vrijdag van die week.
- `lever_type='datum'`: date-picker, `afleverdatum` = die specifieke dag.

In beide gevallen wordt `verzendweek_voor_datum(afleverdatum)` afgeleid voor bundel-sleutel-berekening. **De bundel-sleutel verandert dus niet** — dag- en week-orders kunnen samen in één bundel-zending zitten als alle 4D-componenten matchen (klant × adres × vervoerder × week).

### Anker 2 — Pick-horizon = 1 werkdag vóór afleverdatum (voor dag-orders)

In [pickbaarheid.ts](../../frontend/src/modules/magazijn/queries/pickbaarheid.ts) krijgt de pickbaarheidsfilter een extra check: een order met `lever_type='datum'` verschijnt pas in Pick & Ship vanaf `werkdagMinN(afleverdatum, 1)`. Dat geeft 1 werkdag speling voor pakken + ophalen door vervoerder, en voorkomt dat de order op een verkeerde dag wordt klaargelegd.

**Bundel-impact:** een week-order die in dezelfde 4D-sleutel valt blijft direct zichtbaar; de bundel-zending wordt pas gestart als beide orders pickbaar én zichtbaar zijn. Operator-beslissing, geen RPC-wijziging nodig.

### Anker 3 — Snij-prioriteit via kritieke datum

In [bereken-agenda.ts](../../frontend/src/lib/utils/bereken-agenda.ts) wordt `vroegste_afleverdatum` per rol vervangen door **`vroegste_kritieke_datum`**:

- `lever_type='datum'` → `afleverdatum − dag_order_snij_buffer_werkdagen` (default 2 werkdagen, configureerbaar in `app_config`)
- `lever_type='week'` → `afleverdatum − logistieke_buffer_dagen` (bestaande regel)

Sortering en "teLaat"-markering werken voortaan op kritieke datum. Twee orders met identieke afleverdatum maar verschillende `lever_type` → dag-order krijgt voorrang. In [check-levertijd/index.ts](../../supabase/functions/check-levertijd/index.ts) wordt dezelfde regel toegepast voor capaciteitscheck en spoed-scenario.

### Anker 4 — IO-sync respecteert dag-belofte (V2-backlog, niet in deze ADR)

De huidige `herwaardeer_order_status` schuift `afleverdatum` vooruit op IO-claims (mig 153). Voor dag-orders zou dat een woordbreuk zijn — een dag-belofte moet niet stilzwijgend opschuiven. In V1 accepteren we dit risico: de gebruiker krijgt op order-detail een **datum-badge** ("📅 Levering op vr 14-05-2026") zodat opschuiven door IO-claims visueel meteen opvalt. V2: blokkeren dat de sync dag-orders verschuift, met expliciete user-bevestiging.

## Niet in scope

- Tijdslot binnen een dag ("voor 12:00") — V2-backlog.
- Automatische re-allocatie van dag→week bij capaciteitsknel — operator beslist via `check-levertijd`.
- Klant-portaal voor B2C-zelfkeuze — fase 2 webshop-integratie.
- Push naar Lightspeed eCom van werkelijke leverdag — raakt fase 2 Floorpassion-werk.

## Gevolgen

### Positief

- Eén kolom, drie effecten — minimale verbreding van schema, scope per call-site duidelijk via `lever_type`-check.
- Bundel-/factuur-flow ongewijzigd (mig 228-232 blijft intact); dag-orders glijden in de bestaande infrastructuur.
- Achterwaarts compatibel: bestaande RPC-callers (EDI-import, Floorpassion-webshop fase 1) krijgen impliciet `'week'` als default.
- Geërfde default per klant: B2C-debiteuren kunnen permanent op 'datum' staan zonder per-order-keuze.

### Negatief

- **3 mutatie-punten in snij-/pick-/levertijd-logica.** Elk pad moet `lever_type` lezen en gedrag aanpassen. Vergeten één pad = inconsistente flow. Mitigatie: end-to-end testscenario's in deze sessie + acceptatietest met dag-order.
- **Pick & Ship-bundeling kan operator verwarren:** week-order zichtbaar, dag-order nog niet → bundel-preview toont 2 orders, Pick & Ship toont er 1. Mitigatie: bundel-cluster in [bundel-cluster.ts](../../frontend/src/modules/magazijn/lib/bundel-cluster.ts) toont een hint "nog 1 dag-order verwacht op DD-MM".
- **IO-sync-conflict (Anker 4)** blijft V1-risico. Dag-belofte kan verschuiven zonder waarschuwing buiten de visuele badge. Geaccepteerd voor V1.
- **`logistieke_buffer_dagen` vs `dag_order_snij_buffer_werkdagen`** is een tweede knop. Beheer-overhead. Mitigatie: default 2 werkdagen, alleen Karpi-Productie kan 'm bijstellen.

## Alternatieven overwogen

- **Tweede DATE-kolom `gewenste_leverdatum` apart van `afleverdatum`.** Verworpen: drie kolommen voor één concept (afleverdatum, gewenste_leverdatum, week) is term-drift en breekt de IO-sync-logica (welk veld synct mee?). `lever_type` als modus-vlag op één afleverdatum-kolom is cleaner.
- **Bundel-sleutel uitbreiden naar 5D (week + dag).** Verworpen na overleg: dag- en week-orders mogen wel bundelen mits dezelfde 4D-sleutel matcht. Operator beslist bij `start_pickronden_bundel` of beide echt samen vertrekken.
- **Dag-orders nooit bundelen (altijd solo-zending).** Verworpen: verliest verzendkosten-besparing voor consumenten die meerdere orders op dezelfde dag plaatsen.
- **Klant-keuze i.p.v. order-keuze.** Verworpen: B2C-klant kan ook losse week-orders willen (bv. een doorlooptijd voor maatwerk). `default_lever_type` op debiteur + per-order-toggle geeft beide opties.

## Implementatie

- Mig 244: ENUM + kolommen.
- Mig 245: RPC's `create_order_with_lines` + `update_order_header` uitbreiden.
- Frontend: order-form toggle, pickbaarheidsfilter, snij-agenda, badges.
- Edge: `check-levertijd` lever_type-pad.
- Docs: changelog, database-schema, CLAUDE.md-bedrijfsregel.
