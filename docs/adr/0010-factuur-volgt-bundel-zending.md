---
status: accepted
date: 2026-05-08
---

# Factuur volgt bundel-zending — `factuurvoorkeur='per_zending'` vervalt

> **Numbering note**: deze ADR werd op 2026-05-08 eerst als 0009 geschreven; tijdens dezelfde dag landde ook ADR-0009 (Maatwerk-Module) op `main`. Hernummerd naar 0010 om collision te voorkomen.

## Context

`debiteuren.factuurvoorkeur` (mig 117) heeft sinds invoering twee waardes: `per_zending` en `wekelijks`. Drie eerdere ADR's (0005, 0006, 0007) noemen `per_zending` als **open-kandidaat voor activatie** — vandaag is het in de code aanwezig maar de-facto inactief, en geen klant in productie heeft 'm aanstaan.

Op 2026-05-08 bracht een grilling-sessie aan het licht waarom die open-kandidaat niet alleen niet-actief is, maar **fundamenteel tegenstrijdig** met Karpi's verzendkosten-strategie. De aanleiding was de scope-vraag van een geplande Zending-lifecycle Module (analoog aan ADR-0006); de drijfveer voor die Module zou *"per-zending-facturatie ontgrendelen"* zijn. Tijdens het uitwerken kwam de echte intentie boven:

> *"Als een klant op maandag en vrijdag een bestelling doet van €300, betaalt die nu 2× verzendkosten. Maar als we ze in dezelfde week picken en het gaat met dezelfde vervoerder, willen we de zending én factuur bundelen — 1 zending bij de vervoerder aanmelden, en op de factuur de verzendkosten als €0 zetten omdat 2×300 = €600 ≥ €500-drempel."*

`per_zending` zou dat juist breken: factureren bij elke zending betekent terugvallen op de pessimistische solo-wereld waarin elke order zijn eigen verzendkosten draagt, ongeacht of een klant er meerdere in dezelfde week heeft die fysiek samen reizen. De drempel-toets (`debiteuren.verzend_drempel`, `gratis_verzending`) werkt **alleen op bundel-niveau** — anders zit er geen volume in om over de drempel te tippen.

Daarmee is `per_zending` geen *"toekomstige uitbreiding"* zoals 0005/0006/0007 het framing'den; het is een **dood pad** dat tegen het bedrijfsbelang in zou werken als geactiveerd.

Twee onafhankelijke observaties uit het onderzoek:

1. **De bundel-sleutel ís de factuur-sleutel.** Mig 228 introduceerde een 4-dimensionale identiteit voor zending-bundeling: `(debiteur × adres-norm × vervoerder × verzendweek)`. Mig 222 materialiseert die identiteit als `zending_orders` M2M. Een bundel-zending is dus al precies "alle orderregels die op één pakbon naar één klant-adres met één vervoerder in één week vertrekken". Dat is óók de set regels die op één factuur thuishoort — anders divergeert wat de klant op de pakbon ziet en wat hij op de factuur betaalt.

2. **Mig 232 aggregeert te grof.** De huidige `genereer_factuur_voor_week(debiteur_nr, jaar_week)` maakt 1 factuur per `(debiteur × week)` met N verzendregels — één per bundel-zending van die week. Bij een klant met 2 verschillende afleveradressen in dezelfde week resulteert dat in één factuur die de boekhouding van adres A én B vermengt. De pakbonnen zijn 2 stuks, de transportbewegingen zijn 2 stuks, de drempel-toets gebeurt per bundel — alleen de factuur klontert. Dat is een aggregatie-mismatch.

## Beslissing

**De factuur volgt de bundel-zending.** Aggregatie-eenheid wordt de bundel-sleutel uit mig 228:

```
1 bundel-zending = 1 factuur
```

Een klant met N bundel-zendingen in een week krijgt N facturen. De wekelijkse cron blijft de **enqueue-trigger** (maandag 05:00 UTC), maar itereert over bundel-zendingen i.p.v. over `(debiteur, week)`-paren.

### `factuurvoorkeur='per_zending'` vervalt

Kolom `debiteuren.factuurvoorkeur` wordt **gedropt**. Sinds er nog maar één modus bestaat is het veld een dode dimensie. De drie callers — mig 223 event-listener-trigger (vervanger van mig 118), mig 122/231 wekelijkse cron, klant-detail-tab — verliezen hun `WHERE factuurvoorkeur = …`-takken.

`enqueue_factuur_voor_event()` + `trg_enqueue_factuur_op_event` (mig 223, ADR-0007) worden **gedropt**. Geen `order_events`-event triggert nog automatisch een factuur — de wekelijkse cron is de enige enqueue-bron. (Mig 118's oude `trg_enqueue_factuur` op `orders.status` is al gedropt door mig 223.)

### Mig 232 wordt herzien naar bundel-niveau

`genereer_factuur_voor_week(debiteur_nr, jaar_week)` wordt vervangen door `genereer_factuur_voor_bundel(p_zending_id BIGINT)`:

- Input is een bundel-zending. De factuur-RPC leest `zending_orders` voor de set orders en aggregeert hun `order_regels` waar `gefactureerd < orderaantal`.
- De drempel-toets gebeurt op het bundel-totaal van *deze* zending — exact zoals mig 229's view 'm al berekent in `te_betalen_verzendkosten`.
- Eén VERZEND-regel per factuur (i.p.v. N), met dezelfde 4-paden-logica (afhalen / klant-gratis / drempel-gehaald / normaal).
- No-op-guard uit mig 227 blijft: als alle regels al gefactureerd zijn → `RAISE EXCEPTION` met `no_data_found`.

`enqueue_wekelijkse_verzamelfacturen` (mig 122) verandert van *"per debiteur, één queue-rij per week"* naar *"per debiteur, één queue-rij per bundel-zending van vorige week"*. Bron: bundel-zendingen met `verzendweek = vorige_week` en `status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')` waarvoor nog geen factuur bestaat.

`factuur_queue.type` ('wekelijks' / 'per_zending') wordt versimpeld — alleen 'wekelijks' blijft, en kan eventueel weg als de kolom geen andere doelen dient. `factuur_queue.order_ids[]` blijft (afgeleid uit `zending_orders` bij enqueue), maar `factuur_queue.zending_id` komt erbij als bron-FK.

### Drempel-logica concentreert in één SQL-helper

Vandaag bestaat de 4-paden-toets (afhalen / gratis_verzending / drempel-gehaald / normaal) op vier plekken (mig 229 view, mig 232 plpgsql, order-form, drempel-progressbar) — elk met eigen formulering. De aanscherping van mig 232 is een natuurlijk moment om dat te concentreren. Daarom: één SQL-functie `verzendkosten_voor_bundel(p_debiteur_nr, p_bundel_subtotaal, p_is_afhalen)` die `(te_betalen NUMERIC, status TEXT, reden TEXT)` returnt waar `status` uit de gesloten set `{gratis_afhalen, gratis_klantafspraak, gratis_drempel, betaald}` komt.

View 229 en de nieuwe `genereer_factuur_voor_bundel` consumeren 'm via een join. Kandidaat #1 uit het architectuur-rapport van 2026-05-08 (Verzendkosten-Resolver) is daarmee impliciet onderdeel van deze ADR — niet als aparte deepening, wel als onvermijdbaar gevolg van mig 232's herziening.

### Module-eigenaarschap (geen wijziging)

`modules/facturatie/` (ADR-0007) blijft de eigenaar. Geen nieuwe Module. De Zending-lifecycle Module-vraag uit het architectuur-rapport van 2026-05-08 vervalt — er is geen typed event-trigger nodig nu de factuur-flow van een query naar bundel-zendingen leeft, niet van een status-overgang op `zendingen`.

## Overwogen alternatieven

- **`per_zending` activeren met drempel-logica per losse zending** — afgewezen. Drempel-toets per losse zending is per definitie pessimistisch t.o.v. bundeling: 2× €300 in dezelfde week zou de klant 2× verzendkosten kosten omdat geen losse zending de €500-drempel haalt. Tegen het Karpi-bedrijfsbelang.

- **`per_zending` houden voor klanten zonder bundel-strategie (bv. eindklant-webshops)** — niet relevant. Floorpassion-orders (debiteur 260000) lopen via dezelfde wekelijkse cron en profiteren juist van bundeling als één klant in één week meerdere bestellingen plaatst. Geen klantsegment vraagt expliciet om "factureer mij per losse zending" — als die vraag ooit komt is het een nieuwe ADR.

- **1 factuur per `(debiteur, week)` houden, bundels alleen als sub-secties tonen** — dit is mig 232's huidige gedrag. Afgewezen tijdens grilling: de boekhoudkundige eenheid is de bundel (= 1 pakbon = 1 transportbeweging), niet de week. 2 adressen in 1 week verdienen 2 facturen omdat het 2 transportbewegingen zijn — anders moet de boekhouding handmatig splitsen.

- **Per-klant-keuze via `debiteuren.factuur_aggregatie` (`per_bundel` / `per_week`)** — afgewezen als overengineering. Het concept is operationeel gelijk: één bundel = één factuur. De keuze "alle bundels van een week op één factuur" zou alleen relevant zijn voor klanten met heel veel kleine bundels per week — die situatie bestaat in Karpi's portfolio niet en zou bovendien afhalen-bundels en multi-vervoerder-bundels op één factuur dwingen.

- **Zending-lifecycle Module bouwen voor uniformiteit met ADR-0006** — afgewezen. Zonder factuur-trigger als afnemer is het een Module zonder caller. ADR-0006 verdient zijn deepening door drie publieke RPCs en een lint-script die regressie voorkomen — vandaag bestaat geen vergelijkbare regressie-druk op `zendingen.status`-schrijvers (8 plekken, allemaal in dezelfde flow). Heroverwegen wanneer V2-multi-adres-zending of een POD-callback hook concrete druk geeft.

- **`debiteuren.factuurvoorkeur` als enum laten staan met alleen `'wekelijks'`** — afgewezen. Dode dimensie. Drop de kolom; de flow weet zelf dat er één modus is.

## Consequenties

- **Migratie 234 — drop dood pad:**
  - `DROP TRIGGER trg_enqueue_factuur_op_event ON order_events;` (mig 223)
  - `DROP FUNCTION enqueue_factuur_voor_event() CASCADE;`
  - `ALTER TABLE debiteuren DROP COLUMN factuurvoorkeur;`
  - `DROP TYPE factuurvoorkeur;` (enum-type, mig 117)

- **Migratie 235 — bundel-driven factuur:**
  - Nieuwe RPC `verzendkosten_voor_bundel(INTEGER, NUMERIC, BOOLEAN) RETURNS TABLE(te_betalen NUMERIC, status TEXT, reden TEXT)`.
  - Nieuwe RPC `genereer_factuur_voor_bundel(BIGINT)` — vervangt mig 232's `genereer_factuur_voor_week`.
  - View 229 en de nieuwe RPC consumeren `verzendkosten_voor_bundel` i.p.v. eigen CASE-takken.
  - `enqueue_wekelijkse_verzamelfacturen` herschreven: itereert over bundel-zendingen van vorige week zonder factuur i.p.v. over (debiteur, week).
  - `factuur_queue.zending_id BIGINT REFERENCES zendingen(id)` toegevoegd; `factuur_queue.type`-kolom vereenvoudigd of gedropt.
  - Drop `genereer_factuur_voor_week` (mig 232) en `genereer_factuur(BIGINT[])` (mig 119/124/227) — beide hebben geen callers meer na deze refactor.

- **Frontend:**
  - [`klant-facturering-tab.tsx`](../../frontend/src/components/klanten/klant-facturering-tab.tsx) — radio-button-blok voor factuurvoorkeur weg. Tab-naam blijft (BTW-percentage en email_factuur blijven).
  - `useUpdateKlantFactuurInstellingen`-shape verliest het `factuurvoorkeur`-veld.
  - `Factuur`-type verliest `bron_zending_id`-eventualiteit; FK staat op `factuur_queue` niet op `facturen`-row zelf (factuur-orderkoppeling blijft via `factuur_regels.order_id`).
  - Geen UI-wijziging op factuur-overzicht of factuur-detail — die tonen al "1 factuur per pakbon-bundel"-mentaal-model.

- **Tests:**
  - Bestaande contract-test op `genereer_factuur_voor_week` updaten naar `genereer_factuur_voor_bundel`. Fixture: bundel-zending met 2 orders, drempel net gehaald → 1 factuur, VERZEND=€0.
  - Nieuwe contract-test op `verzendkosten_voor_bundel` met 4 fixtures (afhalen / klant-gratis / drempel-gehaald / normaal).
  - Trigger-tests uit mig 118 verwijderen (trigger bestaat niet meer).
  - End-to-end-test: 2 orders in dezelfde week, zelfde klant+adres+vervoerder, drempel net gehaald → 1 bundel-zending, 1 factuur, €0 verzendkosten.

- **Documenten:**
  - [`data-woordenboek.md`](../data-woordenboek.md) — nieuwe term *Bundel-factuur*; *factuurvoorkeur* gemarkeerd als vervallen per ADR-0010.
  - [`architectuur.md`](../architectuur.md) — sectie "Facturatie-flow" herschreven: enige enqueue-bron is wekelijkse cron over bundel-zendingen.
  - [`changelog.md`](../changelog.md) — entry voor 2026-05-08 met ADR-0010-verwijzing en migratie-keten 234/235.
  - [`adr/0005-pickronde-sluit-de-factuur-keten.md`](0005-pickronde-sluit-de-factuur-keten.md) — open-kandidaat *"Per-zending factureren bij deelleveringen"* gesloten met verwijzing naar ADR-0010.
  - [`adr/0006-order-lifecycle-als-deep-module.md`](0006-order-lifecycle-als-deep-module.md) — open-kandidaat *"Per-zending-facturatie"* gesloten.
  - [`adr/0007-facturatie-als-deep-module.md`](0007-facturatie-als-deep-module.md) — uitbreidings-argument *"per-zending-facturatie via toekomstig event_type='zending_klaar'"* uit Beslissing-tekst aangepast (was load-bearing voor de event-driven trigger; vervalt nu).

- **Open kandidaten op de backlog** (niet in deze ADR):
  - Per-bundel-tracking-callback van vervoerders (POD = Proof of Delivery) — als V2-vraag komt om factuur te koppelen aan afgeleverd-bewijs, is dat een aparte ADR. Vandaag heeft alleen HST een tracking-callback; EDI-vervoerders sturen geen POD.
  - Credit-nota's bij niet-leverbare bundels — buiten scope, blijft op de oorspronkelijke V1-backlog.
  - Status-strings typed via Postgres-enums + generated TS-types — orthogonaal, blijft op de backlog (genoemd in ADR-0007).
