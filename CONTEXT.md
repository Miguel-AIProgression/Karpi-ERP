# Karpi RugFlow ERP — Context

ERP-portaal voor Karpi: debiteuren, producten (tapijtrollen), orders en
operationele processen (snijden, confectie, magazijn, logistiek, facturatie).
Dit document legt de domeintaal vast die meerdere modules raakt. Module-specifieke
beslissingen staan in `docs/adr/`.

## Language

### Orders & lifecycle

**Order**:
Een klantbestelling met één of meer Orderregels.
_Avoid_: bestelling, aankoop

**Orderregel**:
Eén regel op een Order; standaardmaat-artikel óf maatwerk-stuk.
_Avoid_: regel, item

**Maatwerk**:
Een orderregel met `is_maatwerk=true` die gesneden en geconfectioneerd moet worden
(eigen afmetingen, vorm, afwerking, bandkleur).
_Avoid_: op maat (oude UI-term — DB heet `maatwerk_*`)

**Basta**:
Het oude ERP-systeem van Karpi, dat tot de cutover van 2026-06-01 in gebruik was.
Voor Productie-only orders blijft Basta de bron voor labels printen, verzenden en
factureren; RugFlow doet voor die orders alleen snijden + confectie. Operators
zoeken een order in RugFlow op het Basta-ordernummer (`oud_order_nr`).
_Avoid_: oud systeem (informeel — de naam is Basta)

**Productie-only order**:
Een order die in het nieuwe systeem **alleen** de snij- en confectie-stappen
doorloopt; facturatie, verzending en transport worden in **Basta** (het oude
systeem) afgehandeld. Geïmporteerd uit Basta bij de cutover van 2026-06-01.
Herkenbaar aan een label/vlag op de Order; bereikt als eindbestemming de status
**Maatwerk afgerond** (nooit Verzonden). RugFlow dient hier als digitale snij-/
confectie-tracker + opzoek-bord (vervangt de geprinte-Excel-en-afvink-loop):
opzoekbaar op het Basta-ordernummer, met een ondubbelzinnig "afhandelen in
Basta"-signaal zodra de order is afgewerkt.
_Avoid_: legacy-order, migratie-order, dummy-order

**Maatwerk afgerond**:
Terminale order-status, uitsluitend voor Productie-only orders: bereikt zodra
álle Snijplannen van de order **confectie-afgerond** zijn (`confectie_afgerond_op`
gezet via `voltooi_confectie(p_afgerond=true)`) — niet de inpak/`Ingepakt`-stap.
Terminaal → de order valt buiten Pick & Ship, facturatie en transport. Triggert
géén annulerings-cascade (anders dan Geannuleerd). De volledige terminale-status-
logica geldt uitsluitend voor orders met de Productie-only-vlag; gewone orders
blijven ongemoeid.
_Avoid_: Afgehandeld, Klaar, Ingepakt

### Order-intake

**Intake-kanaal**:
Eén van de routes waarlangs een Order binnenkomt: EDI (Transus), Shopify,
Lightspeed (webhook + cron), e-mail, of handmatig (order-form). Elk kanaal doet
zijn eigen bron-specifieke vertaling (matching, parsing, prijsbepaling) en is
een adapter op de Order-landing.
_Avoid_: bron (te generiek — `bron_systeem` is de DB-kolom, het kanaal is het concept)

**Order-landing**:
De interne SQL-kern (gepland, 2026-06-10) die elke Order uit elk Intake-kanaal
laat landen: nummering, idempotency, regel-insert (volledige kolommenset),
status-seeding + events, en debiteur-/adres-snapshot-fallback (aangeleverde
waarden winnen; de DB vult alleen gaten — de form-override blijft een feature).
De drie bestaande RPC's (`create_edi_order`, `create_webshop_order`,
`create_order_with_lines`) blijven als adapters met ongewijzigde signatuur.
_Avoid_: gedeelde insert-RPC (het is een interne kern, geen vierde RPC)

**Order-commit**:
De pure TS-pipeline (gebouwd 2026-06-10, Fase 1) die uit form-invoer + dekking + config
een compleet commit-plan bouwt (welke orders, welke regels, verzend-toewijzing,
claims) — zonder React of I/O. Implementatie: `bouwOrderCommit` in
`frontend/src/lib/orders/order-commit.ts` (golden fixtures pinnen het gedrag);
`order-form.tsx` is de dunne schil die het plan uitvoert.
_Avoid_: saveMutation (dat is de huidige implementatie-locatie, niet het concept)

**Order-hydratie**:
De inverse van [[Order-commit]]: bouwt uit een **bestaande** Order de form-state
(`OrderRegelFormData[]`) waarmee de order-form de bewerk-flow opent. Tweede
adapter op het *"bron → order-form-state"*-seam dat de PO-prefill
(`mapMatchNaarPrefill`) ook bewoont. Implementatie: `hydrateerOrderRegels` in
`frontend/src/lib/orders/order-hydratie.ts`. Draagt náást de regel-velden het
**regel-input-contract** over — de display-only producten-velden
(`vrije_voorraad`, `besteld_inkoop`, `is_pseudo`, `is_dropship`) die de
form-beslissingen voeden (`berekenRegelDekking` → IO-tekort → LeverModusDialog).
Eén gedeelde helper (`metProductVelden`) zet die velden zodat een bouwer ze niet
stil kan vergeten — de oorzaak van ORD-2026-0614 (ontbrekend `vrije_voorraad`
→ vals IO-tekort op een voorradige regel). De header-rehydratie blijft in
`order-edit.tsx` (heeft client-context nodig).
_Avoid_: order-edit-mapping (de oude inline-locatie, niet het concept), rehydratie (te vaag)

### Snijden & confectie

**Snijplan**:
Eén fysiek te snijden stuk (ADR-0019: één snijplan per stuk, niet per orderregel).
Auto-aangemaakt bij INSERT van een maatwerk-orderregel (`auto_maak_snijplan`).
_Avoid_: snijopdracht, cut-plan

**Migratie-blokkering** (ADR-0028, te vervangen):
Een full-width FIFO-lengtestrip op een fysieke rol die nog-niet-gesneden oude
maatwerk-orders virtueel reserveert zodat de rollengte niet dubbel verkocht
wordt. Onzichtbaar in snijplanning/confectie. **Wordt vervangen** door echte
Productie-only orders met echte Snijplannen (één bron van waarheid voor rollengte).
_Avoid_: reservering, blokkade

### Magazijn & verzending

**Manco**:
Een Orderregel die tijdens een Pickronde fysiek **niet gevonden** is. Bij
`voltooi_pickronde` wordt de regel niet meer geblokkeerd maar **bevroren**:
gate `order_regels.pick_backorder_sinds` (uit [[Pickbaarheid]]), permanente
order-markering `orders.manco_sinds`, de regel blijft als manco op de zending
(`aantal-1`, `zending_regels.manco_aantal+1`, colli weg), en de voorraad-claim
blijft **gereserveerd zonder voorraadmutatie**. Een manco is dus géén status maar
een te-onderzoeken signaal dat de telling waarschijnlijk te hoog staat. De
binnendienst **resolvet** later (mig 518) met precies één van drie uitkomsten —
zie [[Manco-resolutie]].
_Avoid_: backorder (dat is één van de drie uitkomsten, niet de manco zelf), tekort, niet-leverbaar

**Manco-resolutie**:
De binnendienst-keuze die een [[Manco]] afhandelt, in drie expliciete uitkomsten:
**Opnieuw leveren** (tóch gevonden → gate weg → regel terug in [[Pickbaarheid]],
de volgende Pickronde levert een losse tweede [[Zending-colli|zending]] = een
*nazending*; raakt de voorraad niet), **Wacht op voorraad** (backorder op
**dezelfde** Order, claim vrij + herallocatie, komt vanzelf terug zodra er weer
voorraad is) en **Annuleren** (regel afsluiten, `te_leveren=0`). Een *nazending*
is geen aparte entiteit — hij ontstaat uit het bestaande multi-zending-mechanisme
(de al-verzonden regels zijn `is_locked`). Het afleverland (NL/DE) bepaalt alleen
de **voorgeselecteerde default** (NL→Wacht op voorraad, DE→Annuleren), niet de
beschikbaarheid — de operator overschrijft altijd (`manco_niet_leverbaar.p_actie`,
mig 522). **Voorraadcorrectie staat standaard AAN** bij Wacht op voorraad én
Annuleren (boekt `producten.voorraad` af + `herbereken_product_reservering`): dat
haalt de "spookvoorraad" weg die de bevroren claim anders bij het
vrijgeven/annuleren weer als `vrije_voorraad` zou laten claimen door dezelfde of
een volgende Order → herhaalde manco. Opt-out ("het ligt er fysiek nog") alleen
bij een klant-annulering waar het product er nog wél is.
_Avoid_: niet-leverbaar (oude tweeknoppen-term met impliciete NL/DE-splitsing)

**Pickbaarheid**:
Of een Orderregel fysiek te picken is (voorraad-claim of gereed Maatwerk-stuk),
en op order-niveau of de Order in Pick & Ship zichtbaar is. Single source is de
SQL-view `order_pickbaarheid`/`orderregel_pickbaarheid` (mig 386): de TS-laag
leidt hier niets meer zelf af. Onderscheidt zich van [[Startbaarheid]]:
pickbaarheid zegt "is het werk klaar", startbaarheid zegt "mag de pickronde nú
beginnen" (incl. vervoerder + intake-gates).
_Avoid_: leverbaar, beschikbaar (te generiek — het gaat om de pick-stap)

**Startbaarheid**:
Of een Order nú een [[Pickronde]] kan starten, en zo niet, waaróm geblokkeerd —
als één status per order in canonieke prioriteit: `in_pickronde` > `niet_pickbaar`
> `afl_adres` > `prijs` > `geen_vervoerder` > `startbaar`. Het is een eigenschap
van de **Order tegenover de pick-start**, niet van een knop of een pagina: daarom
leeft het predikaat op één plek (`modules/logistiek/lib/startbaarheid.ts`,
`bepaalStartbaarheid`) en lezen álle consumenten díé — de start-/week-/bulk-knoppen
(via `usePickbaarheid`) én de Pick & Ship-page-sectionering/selecteerbaarheid. De
prioriteit is de frontend-spiegel van de server-poort `_valideer_intake_gates`
(mig 395/396) + de geen-vervoerder-guard in `start_pickronden` (mig 373). Een
Order belandt alléén in de "Geen vervoerder mogelijk"-sectie als de vervoerder
zijn énige blocker is (ADR-0037). Bouwt bovenop [[Pickbaarheid]].
_Avoid_: pickbaarheid (dat is de onderlaag), geblokkeerd-zijn (te vaag — het is één status)

**Labelbarcode**:
De Code128-waarde die fysiek op het verzendlabel staat: AI(00) + de
18-cijferige SSCC (20 cijfers). Het is een eigenschap van **ons label**, niet
van een vervoerder — dezelfde doos, ongeacht wie hem ophaalt. Daarom leeft de
encoding op één plek (`_shared/vervoerders/labelbarcode.ts`, `labelBarcode()`)
en lezen álle consumenten die: het [[Verzendlabel]], de
HST-`BarCode`, de Verhoek-`ScanCode` en de Rhenus-`<sscc>`. Een colli zonder
SSCC levert geen Labelbarcode (`null`) — er mag nooit een niet-aangemelde
barcode geprint of verstuurd worden. De SSCC-waarde zelf blijft single-source
uit `zending_colli.sscc`; de Labelbarcode is de gedeelde *encoding* daarvan.
_Avoid_: scancode, SSCC-barcode (per-carrier termen — het is één label-feit)

**Verzendlabel**:
De fysieke sticker op één collo: één canonieke layout (liggend, het HST-ontwerp)
met afzender, order/productregels, adres-kader, vervoerder-badge, colli-telling,
[[Labelbarcode]] en referentie-voet. Het is een eigenschap van **ons pakket**,
niet van een vervoerder: álle vervoerders krijgen exact hetzelfde label, op één
gelokaliseerd verschil na — de HST-depotregel onder de badge (HST-eigen
postcode→depot-lookup). Daarom leeft de layout op **één plek** (het
`ShippingLabel`-component, met `vervoerderNaam` als data-veld), niet meer als drie
near-dubbele renderers (de oude compact/staand/DPD-varianten, elk met een eigen
kopie van de zone-layout + een eigen `vervoerder_code === 'hst_api'`-tak). Het formaat komt uit
`vervoerders.label_*_mm` met de HST-maat (152,4×76,2) als **default**, zodat een
nieuwe vervoerder zonder formaat-rij automatisch het juiste label erft i.p.v.
terug te vallen op de kleine legacy-3×2-maat (de oorzaak van het "Rhenus"-
afkappings-incident 2026-06-18). De product-/referentie-data komt uit de bevroren
[[Zending-colli]]-snapshot, gelijk aan pakbon en vervoerder-payload. Een tweede
per-vervoerder-presentatieverschil (depot voor carrier X) = pas dán een descriptor
extraheren (twee adapters = echte seam), niet speculatief vooraf.
_Avoid_: compact/staand/DPD-labelvariant, per-vervoerder labelontwerp

**Zending-colli**:
De bevroren per-pakket-snapshotrijen van een zending (`zending_colli`: sscc,
gewicht, afmetingen, omschrijving), aangemaakt bij pickronde-start door
`genereer_zending_colli`. Het zijn een eigenschap van de **fysieke zending op
het moment van inpakken**, geen live-afleiding uit order/product. Daarom haalt
één seam (`_shared/vervoerders/fetchZendingColli`) ze op en beslist als enige
welke kolommen canoniek zijn; álle vervoerder-adapters (HST, Verhoek, Rhenus)
lezen díé en herleiden afmetingen/gewicht nooit zelf uit de live
`order_regels → producten`-join. Zelfde patroon als de [[Labelbarcode]] één laag
hoger: het ophalen leeft op één plek, niet drie keer per adapter.
_Avoid_: per-adapter colli-query, live maatwerk→product-join voor verzending

**Verzend-wachtrij** (ADR-0038, mig 426 — gebouwd):
De operationele wachtrij van zendingen die naar een vervoerder verstuurd moeten
worden. Eén tabel `verzend_wachtrij`, gediscrimineerd op `vervoerder_code` — niet
drie kopieën (de oude `hst_transportorders`/`verhoek_transportorders`/
`rhenus_transportorders` blijven t/m de contract-drop nog als rollback-vangnet
staan). Het draagt alléén operationele state (`status` via enum `verzend_status`,
`retry_count`, `error_msg`, timestamps) + drie generieke correlatievelden die de
carrier-kolommen subsumeren (`extern_referentie` = transportOrderId|bestandsnaam,
`track_trace` = HST/Verhoek-T&T of NULL bij Rhenus, `document_pad` = PDF|XML) + de
unique-active-invariant op één plek (`uk_verzend_wachtrij_zending_actief`, max één
actieve rij per zending over álle carriers). De zware request/response-payload
leeft in [[Externe-payload-audit]] (`externe_payloads`), niet hier. Eén set
generieke RPC's (`enqueue_transportorder`, `claim_volgende_transportorder`,
`markeer_transportorder_verstuurd`, `markeer_transportorder_fout`,
`herstel_vastgelopen_verzending`) en één `verzend_monitor`-view (group by
`vervoerder_code`) voeden álle carriers; de dispatch `enqueue_zending_naar_vervoerder`
collapst de api/sftp-takken tot één `enqueue_transportorder(code)`. Het is de
**data-as** naast de capability-as (ADR-0034) en de process-as (ADR-0035,
verzend-orchestrator): samen maken die een vierde vervoerder een kwestie van data
+ één format-adapter, geen DDL-kopie — en sinds deze as draagt de `VerzendAdapter`
géén per-carrier RPC-namen meer (de orchestrator bezit de state-transitie-RPC's,
generiek op `vervoerderCode`).
_Avoid_: per-vervoerder transportorder-tabel, hst/verhoek/rhenus_transportorders als concept; payload-kopie op de wachtrij

### Facturatie & documenten

**Artikelpresentatie**:
De opgeloste verzameling identificatoren + tekst waarmee het artikel van een
Orderregel op een **klantdocument** verschijnt: Karpi's eigen code (`karpi_code`),
het klant-artikelnummer (`klant_artikelen.klant_artikel` → EDI `buyerArticleNumber`),
de GTIN (`producten.ean_code`), het gewicht en de definitieve omschrijving. Het is
een eigenschap van **hoe een artikel naar buiten getoond wordt**, niet van de rauwe
orderregel. Daarom leeft het oplossen ervan op **één plek** (gedeelde resolver) die
zowel het [[Factuurdocument]] als de orderbevestiging voedt — dezelfde artikeltekst
op order­bevestiging én factuur, op papier én EDI. Vóór de consolidatie loste elk
renderpad dit zelf op (`buildEdiFactuurInput` rijk, `mapFactuurNaarInvoiceInput`
kaal, factuur-PDF rauw, orderbevestiging apart) → dezelfde factuur kon per kanaal
een andere artikeltekst tonen. Zelfde patroon als [[Zending-colli]] één domein
verder: het ophalen/oplossen leeft op één plek, niet per renderpad.
_Avoid_: articleDescription-opbouw per kanaal, inline karpi_code-lookup

**Factuurdocument**:
De canonieke, opgeloste representatie van een factuur (header + regels mét
[[Artikelpresentatie]] en toegepaste BTW-verlegging via de `btw.ts`-seam),
opgebouwd uit `factuur_regels` door één seam (`fetchFactuurDocument`). De drie
externe representaties — factuur-PDF, EDI-INVOIC (automatisch via `factuur-verzenden`
én handmatig via `bouw-factuur-edi`) — zijn **dunne renderers** op dit ene document,
niet drie onafhankelijke afleidingen uit `order_regels`/`producten`. Eén golden
fixture pint "deze factuur → deze PDF-regels én deze INVOIC-lines" zodat de twee
EDI-paden nooit meer kunnen divergeren. Analoog aan het verzend-domein waar label
én pakbon uit één `bouwVerzenddocument` komen.
_Avoid_: factuur-regel-afleiding per renderpad, twee factuur→INVOIC-transforms

**Pakbondocument**:
De canonieke, medium-onafhankelijke representatie van een pakbon (adresblokken,
referentie-meta, bundel-groepering, per-regel display-tekst met [[Artikelpresentatie]]-
naam + OMB-omsticker, totalen), opgebouwd uit een [[Zending-colli]]-dragende
zending door één seam (`bouwPakbonDocument`). De twee externe representaties — de
geprinte React-pakbon en de pdf-lib-PDF (factuurmail-bijlage) — zijn **dunne
renderers** op dit ene document, niet twee onafhankelijke afleidingen (de oude
React-component leidde adres/naam/referentie/totalen inline in JSX af terwijl de
server hetzelfde in `bouwPakbonDocument` deed → al gedrift op routecode, OMB,
"Uw naam" en referentie). De regel-aggregatie (geleverd/besteld/gewicht-ladder,
naam-resolutie `productNamen`/`klantNaamWijktAf`) leeft één keer in `_shared/pakbon`;
de frontend `bouwVerzenddocument` deelt díé voor zijn `pakbonRegels`-tak en houdt
alleen de label-`colliRijen`-expansie (één renderer = geen seam). De **routecode**
(HST-depot) is géén document-eigenschap maar een geïnjecteerde render-context:
print-only voor de magazijn-sortering, dus de React-renderer berekent
`hstDepotVoorPostcode` en geeft 'm mee, de klant-factuurmail-PDF niet. Zelfde
patroon als [[Factuurdocument]]: één opgeloste representatie, N dunne renderers.
_Avoid_: pakbon-afleiding per renderpad, inline JSX-presentatie naast bouwPakbonDocument, routecode als document-veld

## Relationships

- Een **Order** bevat één of meer **Orderregels**
- Elk **Intake-kanaal** is een adapter op de **Order-landing**; het handmatige
  kanaal bouwt zijn invoer via de **Order-commit**-pipeline
- **Order-hydratie** is de inverse van **Order-commit**: de bewerk-flow laadt een
  bestaande **Order** terug naar dezelfde `OrderRegelFormData`-form-state-shape
- Een maatwerk-**Orderregel** produceert één **Snijplan** per stuk
- De **Order**-fase (`orders.status`) is een afleiding van de **productie**-state
  (de **Snijplannen**) én de claim-state — niet alleen de claim-state. Een
  **Snijplan** dat de `'Ingepakt'`-grens kruist herberekent daarom de wacht-status
  van zijn **Order** (mig 486-listener), zodat de order-fase en de **Pickbaarheid**
  hetzelfde productie-feit vertellen i.p.v. twee verhalen
- Een **Factuurdocument** rendert naar factuur-PDF én EDI-INVOIC; beide tonen
  dezelfde **Artikelpresentatie**, die óók de orderbevestiging voedt
- Een **Pakbondocument** rendert naar de geprinte React-pakbon én de factuurmail-PDF;
  beide lezen dezelfde **Zending-colli**-snapshot, met de routecode als
  print-only render-context (alleen op de geprinte pakbon)
- Een **Productie-only order** bereikt **Maatwerk afgerond** zodra al zijn
  **Snijplannen** geconfectioneerd zijn; hij wordt nooit **Verzonden**
- Echte **Snijplannen** van Productie-only orders **vervangen** de
  **Migratie-blokkering** als claim op de rollengte

## Example dialogue

> **Dev:** "Een Productie-only order is afgerond — moet die nu naar Pick & Ship?"
> **Domain expert:** "Nee. Die order doet in RugFlow alleen snijden en confectie.
> Zodra het maatwerk klaar is gaat hij naar Maatwerk afgerond. De magazijnier
> zoekt 'm op het Basta-ordernummer op, ziet 'afgewerkt', en print dan in Basta
> de labels — verzenden en factureren gebeurt daar."

## Flagged ambiguities

- "label" werd door de gebruiker gebruikt voor het markeren van Productie-only
  orders — geresolved als een vlag/kolom op de Order (zie ADR i.v.m. mechanisme).
- "stoppen na maatwerk" → geresolved als de terminale status **Maatwerk afgerond**,
  niet als verwijderen/archiveren.
