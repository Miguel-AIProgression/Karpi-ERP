---
status: superseded
date: 2026-07-01
superseded-by: 0040-combi-levering-als-order-status.md
---

> **Superseded door [ADR-0040](0040-combi-levering-als-order-status.md) (zelfde dag):** bij het testen bleek de Startbaarheid-gate-keuze hieronder niet de gewenste werking — een Combi-levering-order moet helemaal niet in Pick & Ship verschijnen (gelockt op commercie, eigen tab), niet zichtbaar-maar-geblokkeerd. ADR-0040 vervangt Anker 3 (Startbaarheid) door een echte `order_status`-waarde `'Wacht op combi-levering'` in het bestaande `derive_wacht_status`-model. Ankers 1, 2, 4, 5, 6, 7 hieronder (booleans, groeperingssleutel, geen nieuwe bundel-code, drempel-toets-moment, vangnet, communicatie) blijven ongewijzigd van kracht — alleen het startbaarheid/zichtbaarheid-mechanisme is vervangen. Dit document blijft staan als audit trail, niet gewijzigd.

# Combi-levering — commerciële wacht-op-drempel als Startbaarheid-gate, geen nieuwe bundel-mechaniek

## Context

Sommige klanten willen geen verzendkosten betalen voor een losse, kleine bestelling. Vandaag lost `applyShippingLogic` dit alleen *reactief* op: als het subtotaal van een order onder `debiteuren.verzend_drempel` blijft en de klant geen `gratis_verzending` heeft, wordt er direct een VERZEND-kostenregel op díe order gezet (mig 201). De bestaande Bundel-Zending (ADR-0012, 4D-sleutel `debiteur × adres-norm × vervoerder × verzendweek`) en de retroactieve drempel-toets op bundel-niveau (mig 229/232) bundelen alleen wat *toevallig* al tegelijk pickbaar is binnen dezelfde ISO-week — geen van beide houdt een order *actief* vast om op toekomstige orders te wachten.

De gebruiker wil dat een klant op klantniveau kan aangeven dat hij liever wacht: nieuwe orders die zelf onder de drempel blijven, blijven openstaan totdat het cumulatieve totaal van al zijn openstaande orders naar hetzelfde adres de drempel haalt, waarna ze samen als één zending verzonden worden. Per order moet de klant dit alsnog kunnen doorbreken ("verstuur toch, met kosten").

Grilling op 2026-07-01 legde bloot dat dit géén nieuwe bundel-implementatie vraagt: `start_pickronden` (mig 403) clamped een verstreken verzendweek al naar de huidige week vóór het groeperen, waardoor expliciet samen aangeboden orders altijd in dezelfde zending landen — ongeacht hun oorspronkelijke, onderling verschillende afleverdatum-weken. Het enige echt nieuwe stuk is de *poort* die bepaalt wanneer een order/groep orders mag starten.

## Beslissing

**Combi-levering is een extra Startbaarheid-blokkade (ADR-0037), geen nieuwe order-status en geen nieuwe bundel-mechaniek.** Productie (snijden/confectie) loopt volledig ongewijzigd door — alleen de pickronde-start wordt tegengehouden.

### Anker 1 — Twee nieuwe booleans, geen nieuwe tabellen

- `debiteuren.combi_levering BOOLEAN NOT NULL DEFAULT false` — klant-instelling. No-op als `gratis_verzending=true` al aanstaat (niets te besparen door te wachten).
- `orders.combi_levering_override BOOLEAN NOT NULL DEFAULT false` — instelbaar in het order-form (zelfde patroon als `afhalen`). Order gaat dan altijd het bestaande, directe pad in (`applyShippingLogic` evalueert 'm solo), ongeacht de klant-instelling.
- Dropshipment-orders (`heeftDropshipRegel`) doen **nooit** mee — ze betalen al voor hun eigen verzending. Dit is de enige automatische uitsluiting; `lever_type='datum'`-orders (exacte leverdatumtoezegging, ADR-0014) worden bewust **niet** uitgesloten — als de klant combi-levering aan heeft staan, geldt dat ook voor zijn dag-orders.

Geen nieuwe kolom voor "wacht sinds" en geen groep-tabel: de wachtgroep is een **live afgeleide verzameling**, net als `voorgestelde_zending_bundels` (mig 229) — herevalueert bij elke query, vergrendelt pas op het moment dat `start_pickronden` daadwerkelijk een zending aanmaakt. Tot dan kan een nieuwe order van dezelfde klant naar hetzelfde adres altijd nog aansluiten.

### Anker 2 — Groeperingssleutel is 2D, niet 4D

De Combi-levering-wachtgroep groepeert op `debiteur_nr × _normaliseer_afleveradres(...)` — **zonder** vervoerder en verzendweek (in tegenstelling tot de Bundel-Zending-sleutel uit mig 228). Reden: vervoerder is meestal al een afgeleide van het adres/gewicht (land-gedreven selectieregels, ADR-0030) en wordt sowieso opnieuw bepaald zodra bekend is wat er in de gecombineerde zending zit; verzendweek moet juist **niet** meedoen, want het hele punt is dat orders over meerdere weken heen wachten.

Alle openstaande, niet-eindstatus, niet-dropshipment, niet-`combi_levering_override`-orders van een klant naar één adres tellen mee in het cumulatieve subtotaal (excl. VERZEND-pseudo-regels, zelfde uitsluiting als mig 229's view). Zodra dat totaal `verzend_drempel` haalt (of de klant toch `gratis_verzending` heeft): drempel gehaald.

### Anker 3 — Startbaarheid: de hele groep of niemand

Nieuwe, laagste-prioriteit reden in de Startbaarheid-ladder (`bepaalStartbaarheid`, ADR-0037): `wacht_op_combi_levering`, ingevoegd net vóór `startbaar` — dus ná `in_pickronde`/`niet_pickbaar`/`afl_adres`/`prijs`/`geen_vervoerder`. Een order met deze instelling is pas `startbaar` als **beide** gelden:

1. het cumulatieve subtotaal van de groep de drempel haalt, én
2. **elk** lid van de groep individueel `Pickbaarheid` heeft — ook een lid dat zelf al lang klaar is.

Voorwaarde 2 is een bewuste ADR-0012-les: het ZEND-2026-0010/0006-incident ontstond precies omdat orders die "toevallig" niet gelijktijdig startbaar waren, alsnog los werden verzonden. Zodra de drempel gehaald is, wordt de groep dus behandeld **als één order** — het traagste lid bepaalt het tempo voor iedereen, en dat is een uitdrukkelijke keuze van de gebruiker tijdens de grilling-sessie, niet een neveneffect.

### Anker 4 — Geen nieuwe bundel-code voor de fysieke verzending

`start_pickronden` (mig 403) clamped een verstreken verzendweek naar de huidige week vóórdat de definitieve zending-groepering plaatsvindt. Orders die als Combi-levering-groep worden vrijgegeven en door de operator gezamenlijk gestart worden, landen daardoor automatisch in dezelfde zending, ongeacht hun individueel afwijkende oorspronkelijke afleverdatum-weken — er is dus **geen** nieuwe bundel-implementatie nodig voor eis "1 zending voor de hele groep".

De enige aanscherping: **force-solo van één lid uit een actieve Combi-levering-groep vereist een expliciete reden** (dialoog-veld, zelfde patroon als de deelzending-override, mig 473) in plaats van een stille checkbox-uitvink in de bundel-dialog — anders kan een operator per ongeluk precies de reden-van-bestaan van de klantinstelling ongedaan maken.

### Anker 5 — Drempel-toets op vrijgavemoment, niet op ordermoment

Voor een combi-levering-order wordt er bij het opslaan **geen** VERZEND-kostenregel toegevoegd (in afwijking van het huidige `applyShippingLogic`-gedrag voor niet-combi-levering-klanten). De drempel-toets gebeurt op het moment dat de groep daadwerkelijk gepickt wordt, tegen het cumulatieve bedrag van de groep op dát moment — hergebruik van de bestaande vier-paden-toets (afhalen / klant-gratis / drempel-gehaald / normaal, mig 229/232-stijl) op een nieuw moment (pickronde-start i.p.v. wekelijkse factuur-cron), niet een nieuwe berekening.

### Anker 6 — Vangnet hergebruikt de bestaande "Verzendweek verstreken"-signalering

Er komt **geen** nieuwe max-wachttijd-config en **geen** automatisch datum-opschuif-mechanisme. Een combi-levering-order krijgt bij aanmaak een normale, productie-gedreven `afleverdatum` (ongewijzigd berekend). Verstrijkt die datum zonder dat de order verzonden is, dan valt hij automatisch onder de bestaande (op moment van schrijven nog niet naar `main` gemergde, branch `fix/pick-ship-achterstallig-week-nr`) vlag "Verzendweek verstreken" in de "Vereist actie"-kaart. Dit is bewust **geen** [[Order-aandacht-gate]]-registry-item vóór dat moment — wachten is de ontworpen werking, geen datastoring. Binnendienst ziet de melding en beslist per geval: alsnog los verzenden (= `combi_levering_override` retroactief aanzetten) of de datum handmatig verlengen (order blijft in de groep). Vanuit klantperspectief "schuift de datum automatisch op", omdat er geen strikte deadline afgedwongen wordt — dit is een tekst-/verwachtingsmanagement-keuze, geen extra code.

### Anker 7 — Orderbevestiging krijgt een extra paragraaf; order-detail krijgt een terugwerkende-kracht-knop

- **Orderbevestiging** (`stuur-orderbevestiging`, mail + PDF, 4-talig): als een order bij verzendmoment van de bevestiging in de combi-levering-wachtgroep zit (klant-instelling aan, geen dropship, geen override, groep haalt de drempel op dát moment nog niet), krijgt de bevestiging een extra paragraaf die uitlegt dat er alleen geleverd wordt zodra de gecombineerde bestellingen de vrachtvrije-drempel bereiken, dat de leverdatum anders automatisch doorschuift, en dat de klant zelf voor voldoende volume kan zorgen of contact kan opnemen om alsnog met kosten te laten verzenden.
- **Order-detail**: nieuwe knop ("order in de wacht zetten voor combi-levering" of vergelijkbaar) voor het scenario waarin een klant *na* zijn orderbevestiging alsnog belt om te wachten i.p.v. verzendkosten te betalen. De knop zet in één actie `debiteuren.combi_levering=true` (met bewust, bevestigd effect: **alle** andere openstaande orders van die klant naar dat adres schuiven daardoor ook de wachtgroep-evaluatie in, niet alleen de order waarop geklikt is) en verstuurt een nieuwe orderbevestiging met de Anker-7-paragraaf voor de order waarop geklikt is.

## Overwogen alternatieven

- **Nieuwe `order_status`-waarde (bv. `'Wacht op combi-levering'`)** — afgewezen. De order ís gewoon `Klaar voor picken` (volledig gedekt/geproduceerd); alleen Startbaarheid — een laag bovenop de status, niet de status zelf — blokkeert de pickronde-start. Een nieuwe status zou het onderscheid tussen "waar zit de order in productie/logistiek" en "mag de pickronde nú starten" (ADR-0037) vervagen.
- **VERZEND-regel meteen toevoegen en later op €0 zetten bij drempel-gehaald** — afgewezen (Anker 5). Zou tijdens het wachten een misleidend voorlopig bedrag op de order tonen; de drempel-toets op vrijgavemoment hergebruikt bovendien exact de bestaande mig-229/232-logica zonder wijziging.
- **4D-sleutel (incl. vervoerder + verzendweek) hergebruiken voor de wachtgroep** — afgewezen (Anker 2). Verzendweek uitsluiten is het hele punt van de feature (over meerdere weken heen wachten); vervoerder is een afgeleide van adres/gewicht, geen onafhankelijke sleuteldimensie hier.
- **Automatisch datum-opschuif-mechanisme (cron die `afleverdatum` periodiek vooruitzet)** — afgewezen (Anker 6). Puur cosmetisch (een "verse" toekomstige datum tonen i.p.v. een verlopen datum) tegen de prijs van een nieuwe geplande taak; de bestaande "Verzendweek verstreken"-signalering + menselijke beoordeling dekt de behoefte zonder nieuwe code.
- **Maximale wachttijd als `app_config`-instelling, automatisch geforceerd verzenden na afloop** — afgewezen (Anker 6). Vervangen door hergebruik van de generieke overdue-signalering; binnendienst behoudt de beslissing (afstemmen met de klant) i.p.v. een stille automatische kostenclaim.
- **Startbaarheid per lid onafhankelijk laten (alleen het cumulatieve totaal toetsen, niet de pickbaarheid van de hele groep)** — afgewezen (Anker 3). Zou exact de ADR-0012-fout herhalen: leden die niet gelijktijdig klaar zijn, verzenden alsnog los en missen de drempel.

## Consequenties

### Migraties (nummers te bepalen bij implementatie)

- `ALTER TABLE debiteuren ADD COLUMN combi_levering BOOLEAN NOT NULL DEFAULT false;`
- `ALTER TABLE orders ADD COLUMN combi_levering_override BOOLEAN NOT NULL DEFAULT false;`
- Geen wijziging aan `order_status`, `zendingen`, `zending_orders` of de Bundel-Zending-RPC's.
- Mogelijk: uitbreiding van `_valideer_intake_gates`/`start_pickronden`'s force-solo-pad met een verplicht reden-argument voor Combi-levering-leden (analoog aan `start_deelzending`'s `p_override_reden`, mig 473).

### Frontend

- `startbaarheid.ts` (ADR-0037): nieuwe status `wacht_op_combi_levering` in de ladder, met de twee-voorwaarden-check uit Anker 3.
- `verzend-regel.ts`/`applyShippingLogic`: vroege uitstap voor combi-levering-in-wacht-orders (geen VERZEND-regel bij opslaan), analoog aan de bestaande dropship-uitstap.
- Klant-detail: nieuw vinkje naast `verzend_drempel`/`gratis_verzending`.
- Order-form: nieuw vinkje `combi_levering_override` naast `afhalen`.
- Order-detail: nieuwe "in de wacht zetten"-knop (Anker 7) + hergebruik van `DrempelProgressBar` voor een "wacht op combi-levering — €X van €Y"-indicator.
- Bundel-dialog: verplicht reden-veld bij force-solo van een Combi-levering-lid.
- `stuur-orderbevestiging`/`orderbevestiging-pdf.ts`: nieuwe, 4-talige paragraaf (Anker 7).

### Documenten

- `CONTEXT.md` — nieuwe term **Combi-levering** (dit document, al bijgewerkt tijdens de grilling-sessie).
- `docs/database-schema.md` — nieuwe kolommen `debiteuren.combi_levering` en `orders.combi_levering_override`.
- `docs/order-lifecycle.md` — Startbaarheid-ladder uitgebreid met `wacht_op_combi_levering`.
- `CLAUDE.md` — nieuwe bedrijfsregel-bullet zodra geïmplementeerd.
- `docs/changelog.md` — entry bij implementatie met verwijzing naar ADR-0039.

### Open kandidaten / afhankelijkheden

- Deze ADR veronderstelt dat de "Verzendweek verstreken"-vlag (`frontend/src/lib/orders/verzendweek-verstreken.ts`, branch `fix/pick-ship-achterstallig-week-nr`) naar `main` gemerged is vóór Combi-levering live gaat — zonder die vlag heeft Anker 6 geen vangnet.
- `debiteuren.factuurvoorkeur`/`per_zending` vs `wekelijks`: de codebase bevat een documentatie-tegenstrijdigheid (ADR-0010 verklaart de kolom gedropt, maar mig 474 leest 'm nog live) — buiten scope van deze ADR, maar relevant omdat de factuur-timing na een Combi-levering-release via de bestaande "1 zending → 1 factuur"-mechanica loopt, ongeacht hoe die tegenstrijdigheid ooit opgelost wordt.
