# EDI / Transus pre-cutover: data verzamelen en vervolgstappen

Doel: voordat Karpi overstapt van Windows Connect naar de Transus API moet bewezen zijn dat inkomende orders correct worden ontvangen, automatisch orders aanmaken in RugFlow, en dat uitgaande berichten door Transus in het juiste partnerformaat worden geaccepteerd.

Dit document beschrijft:

1. Welke data en specificaties we nog moeten verzamelen.
2. Waarom die data nodig is.
3. Wat er moet gebeuren zodra alle data compleet is.
4. Wanneer we een go/no-go voor cutover mogen geven.

## Scope

V1 cutover-scope:

- Order ontvangen: inkomende `ORDERS` via Transus naar Karpi/RugFlow.
- Orderbevestiging versturen: levertijd en bevestigde aantallen terug naar klant.
- Factuur versturen: alleen voor klanten waar dit in Transus actief is.

Niet in eerste cutover zonder apart akkoord:

- Verzendbericht/DESADV. Dit vraagt waarschijnlijk extra zendingdata zoals leverbonnummer, tracking, SSCC, colli, gewicht en verzenddatum. Pas activeren als de specificatie en RugFlow-data compleet zijn.

## 1. Data Te Verzamelen

### 1.1 Transus proces-specificaties

Per proces moet uit Transus Online de specificatie worden gedownload of door Transus support worden aangeleverd.

Benodigd per proces:

- Procesnaam in Transus Online.
- Handelspartner waarop de specificatie betrekking heeft.
- Gegevensbron, bijvoorbeeld `Custom ERP`.
- Formaat: fixed-width, TransusXML, CSV of EDIFACT.
- Encoding: CP-1252, UTF-8, of XML-declared encoding.
- Recordtypes en recordlengtes.
- Verplichte velden.
- Optionele velden die partner-specifiek toch vereist kunnen zijn.
- Geldige codes voor actie/status, bijvoorbeeld acceptatie, wijziging, backorder of afwijzing.
- Voorbeelden van geslaagde testbestanden.
- Voorbeelden van foutmeldingen uit de Testen-tab.

Minimaal nodig:

| Proces | Nodig voor cutover? | Waarom |
|---|---:|---|
| Order ontvangen | Ja | Parser en ordercreatie moeten echte Transus-output accepteren. |
| Orderbevestiging versturen | Ja | Grootste risico: huidig demo-formaat is nog niet bewezen. |
| Factuur versturen | Ja, voor klanten met factuur via EDI | Factuur moet exact aansluiten op Transus/partner-validatie. |
| Verzending versturen | Nee, tenzij bewust in scope | Eerst specificatie en zendingdata-model compleet maken. |

Let op: de echte orderbevestiging uit `Bericht-ID 168911805.zip` bevat een TransusXML-bronbericht en een EDIFACT `ORDRSP` output. Dat moet expliciet worden bevestigd: moeten wij voor orderbevestiging TransusXML aanleveren, of accepteert Transus voor dit proces ook Karpi fixed-width?

### 1.2 API- en testgegevens van Transus

Benodigd:

- `ClientID`.
- `ClientKey`.
- Bevestiging dat Transus API geactiveerd is in de Connect-tegel.
- Bevestiging of IP-restricties actief zijn.
- Bevestiging of compressie/Gzip actief is.
- Test-handelspartner of M10110-testentry.
- Uitleg hoe testberichten in M10110 worden geplaatst.
- Bevestiging of testberichten via M10100 bij echte partners aankomen of intern blijven.
- Bevestiging dat Windows Connect en API niet parallel mogen draaien voor productiepartners.

Waarom:

- M10110 polling mag niet live naast Windows Connect draaien als beide dezelfde queue lezen.
- M10300 ack bepaalt of een bericht definitief uit Transus verdwijnt.
- M10100 uitgaand moet eerst met testdata bewezen zijn voordat echte klanten iets ontvangen.

### 1.3 Echte voorbeeldberichten

Per top-partner minimaal verzamelen:

- Inkomende order zoals klant die naar Transus stuurt, meestal EDIFACT `ORDERS`.
- Transus-output naar Karpi, meestal `.inh`.
- Uitgaande orderbevestiging-bronbestand dat vroeger/nu door Karpi/Basta/Windows Connect wordt aangeleverd.
- Transus-output naar partner, meestal EDIFACT `ORDRSP`.
- Uitgaande factuur-bronbestand.
- Transus-output naar partner, meestal EDIFACT `INVOIC`.
- Indien later in scope: verzendbericht-bronbestand en EDIFACT `DESADV`.

Top-prioriteit:

| Partner | Waarom |
|---|---|
| BDSK | Groot volume, alle processen actief. |
| SB-Mobel BOSS | Groot volume, vroeg valideren. |
| Hornbach NL | Retailpartner, vaak strikte EDI-validatie. |
| Hammer | Top-volume, partner-specifieke uitzonderingen mogelijk. |
| Krieger | Top-volume, meenemen in regressieset. |

Per voorbeeld vastleggen:

- Bericht-ID uit Transus.
- Datum/tijd.
- Richting: in of uit.
- Berichttype.
- Partner.
- Ordernummer klant.
- Karpi ordernummer/factuurnummer.
- GLN's: BY, SU, IV, DP, eventueel SN/ZZZ.
- Aantal regels.
- Totaal aantal.
- Of het bericht test of productie was.
- Of Transus het foutloos verwerkte.

### 1.4 Handelspartner-configuratie

Per debiteur verzamelen:

- Debiteur_nr in RugFlow.
- Naam in RugFlow.
- Naam in Transus.
- Transus handelspartnernaam.
- GLN hoofdadres.
- GLN factuuradres.
- GLN afleveradressen.
- Eventuele store/location codes die geen GLN zijn.
- Welke processen actief zijn in Transus:
  - Order ontvangen.
  - Orderbevestiging versturen.
  - Factuur versturen.
  - Verzending versturen.
- Of de partner in testmodus mag.
- Contactpersoon bij klant of Transus indien foutmeldingen optreden.

Deze data voedt `edi_handelspartner_config` en voorkomt dat RugFlow orders zonder debiteur of zonder afleveradres aanmaakt.

### 1.5 Klant- en afleveradres-mapping

Voor elke EDI-klant controleren:

- `debiteuren.gln_bedrijf` gevuld en uniek.
- `afleveradressen.gln_afleveradres` gevuld voor alle EDI afleverlocaties.
- Factuuradres en afleveradres kunnen verschillen.
- Buyer `BY`, Invoicee `IV` en Delivery Party `DP` kunnen drie verschillende GLN's zijn.
- Als een aflever-GLN ontbreekt: bepalen of RugFlow de order mag aanmaken met fallback-adres, of dat het bericht in review moet blijven.

Beslissing nodig:

- Onbekende debiteur: altijd blokkeren.
- Bekende debiteur maar onbekend afleveradres: blokkeren of order aanmaken met waarschuwing.
- Onbekende GLN in testmodus: wel loggen, geen echte order.

### 1.6 Product- en artikelmapping

Per EDI-orderregel kunnen meerdere artikelcodes voorkomen:

- GTIN/EAN in `LIN`.
- Karpi artikelcode als supplier article `SA`.
- Klantartikel als buyer article `BP`.
- Omschrijving.

Benodigd:

- Controleren dat `producten.ean_code` gevuld is voor EDI-artikelen.
- Lijst met GTIN's uit voorbeeldberichten die niet matchen.
- Lijst met supplier article codes die niet matchen.
- Beslissing of matching primair op GTIN of Karpi-artikelcode gebeurt.
- Beslissing wat RugFlow doet met unmatched regels:
  - Order aanmaken met review-vlag.
  - Order blokkeren tot handmatige mapping.
  - Fout terugmelden aan Transus.

Aanbevolen:

- Inkomende orders wel loggen, maar ordercreatie blokkeren als er unmatched regels zijn bij productie.
- In testmodus unmatched regels zichtbaar maken zonder M10300 succes-ack als we de test juist willen laten falen.

### 1.7 Levertijd- en orderbevestigingsregels

Nodig voor orderbevestiging:

- Welke datum sturen we terug?
  - `orders.afleverdatum`.
  - Verwachte leverdatum uit voorraad/inkoopclaims.
  - Laatste leverdatum bij `in_een_keer`.
  - Eerste leverdatum bij deelleveringen.
- Welke aantallen sturen we terug?
  - Besteld aantal.
  - Bevestigd aantal.
  - Backorder/tekort aantal.
- Welke action-code gebruiken we?
  - Alles geaccepteerd.
  - Deels geaccepteerd.
  - Regel gewijzigd.
  - Regel afgewezen.
- Moet de orderbevestiging prijzen bevatten?
- Moet de orderbevestiging BTW bevatten?
- Moet het Karpi ordernummer mee naast het klantordernummer?
- Wat gebeurt er bij onbekend artikel of leverdatum onbekend?

Beslissing nodig voor V1:

- Start conservatief met alleen volledig geaccepteerde orderbevestigingen als alle regels matchen.
- Bij afwijkingen eerst handmatige review, daarna pas verzenden.

### 1.8 Factuurgegevens

Voor factuur via EDI verzamelen:

- Factuur fixed-width/XML specificatie.
- Voorbeeld van bestaande Karpi factuur-bron.
- Bijbehorende EDIFACT `INVOIC` output.
- Verplichte referenties:
  - Factuurnummer.
  - Factuurdatum.
  - Ordernummer klant.
  - Karpi ordernummer.
  - Leverbonnummer indien vereist.
  - Afleverdatum indien vereist.
- Partijen:
  - BY.
  - SU.
  - IV.
  - DP.
- BTW-regels:
  - BTW-percentage.
  - BTW-verlegd tekst/code.
  - BTW-nummers klant en Karpi.
- Totalen:
  - Regeltotaal.
  - Subtotaal.
  - BTW-bedrag.
  - Factuurtotaal.
- Prijsvelden:
  - Netto prijs.
  - Bruto prijs indien gebruikt.
  - Korting indien gebruikt.
- Eenheid:
  - PCE/PCS/stuks.
  - Meters/m2 indien later nodig.

### 1.9 Verzendberichtgegevens

Alleen verzamelen voor V2 of aparte activering:

- DESADV specificatie.
- Verzendbericht voorbeeld.
- Benodigde velden per partner.
- Leverbonnummer.
- Zendingnummer.
- Trackingnummer.
- Vervoerder.
- Verzenddatum.
- Verwachte afleverdatum.
- Colli/pallets.
- SSCC indien verplicht.
- Gewicht/volume.
- Regels met verzonden aantallen.

Go/no-go: DESADV pas aanzetten als RugFlow deze data structureel heeft.

### 1.10 Operationele afspraken

Voor cutover vastleggen:

- Wie monitort de eerste 48 uur?
- Wie mag een EDI-fout handmatig herstellen?
- Wie neemt contact op met Transus?
- Wat is de rollback-route?
- Wanneer stoppen we Windows Connect?
- Waar draait Windows Connect nu precies?
- Welke cron activeert M10110 polling?
- Welke cron activeert M10100 sending?
- Wat doen we met berichten die tijdens cutover al in de queue staan?

## 2. Wat Gebeurt Er Als Alle Data Compleet Is

### Fase A: specificaties omzetten naar code

Acties:

- Parser voor inkomende orders definitief maken op basis van echte recordlengtes.
- Builder voor orderbevestiging maken op basis van bewezen Transus inputformaat.
- Builder voor factuur maken op basis van bewezen factuurformaat.
- Encoding correct maken:
  - Fixed-width: CP-1252 bytes naar base64.
  - XML: XML-declared encoding respecteren.
- Frontend en edge-function formatter niet dubbel laten divergeren. Een bron van waarheid gebruiken of automatisch synchroniseren.

Output:

- Parser/builders in `supabase/functions/_shared/transus-formats/`.
- Unit tests met echte fixtures.
- Documentatie met veldposities en mapping.

### Fase B: golden fixture tests

Acties:

- Alle echte zipvoorbeelden uitpakken naar testfixtures.
- Tests maken voor:
  - Parse inkomende order.
  - Match debiteur.
  - Match afleveradres.
  - Match artikelen.
  - Maak order en orderregels.
  - Bouw orderbevestiging.
  - Bouw factuur.
  - Idempotentie bij dubbele TransactionID.
  - Foutpad bij onbekende GLN.
  - Foutpad bij onbekend artikel.

Output:

- Tests groen tegen echte berichten.
- Verschillen tussen RugFlow-output en oude Karpi/Basta-output verklaard of opgelost.

### Fase C: Transus Online upload-validatie

Acties:

- Per berichttype testbestand uploaden in Transus Online `Bekijken en testen`.
- Controleren dat alle verplichte velden groen zijn.
- EDIFACT-output downloaden en naast oud voorbeeld leggen.
- Verschillen beoordelen:
  - Acceptabel: nieuwe TransactionID, berichtdatum, orderbevestigingsnummer.
  - Niet acceptabel: ontbrekende GLN, verkeerd ordernummer, verkeerd aantal, verkeerde leverdatum, foutieve BTW of prijs.

Output:

- Per partner/proces een validatieresultaat.
- Screenshot of download van geslaagde Transus-test.
- Bekende partner-afwijkingen gedocumenteerd.

### Fase D: API rondreis in testmodus

Acties:

- Transus testentry klaarzetten voor M10110.
- `transus-poll` test draaien met cron uit of handmatig.
- Controleren:
  - Bericht komt binnen.
  - `edi_berichten` krijgt raw payload.
  - Parser maakt JSON.
  - Debiteur wordt gevonden.
  - Order wordt aangemaakt.
  - M10300 wordt pas `Status=0` na succesvolle ordercreatie.
- Order bevestigen.
- `transus-send` test draaien.
- Controleren:
  - M10100 geeft TransactionID.
  - Uitgaand bericht staat op `Verstuurd`.
  - Transus Online toont bericht foutloos.

Output:

- Een echte technische rondreis zonder productiepartner-impact.

### Fase E: productie-hardening

Acties:

- `transus-poll` van read-only naar productieflow brengen.
- `transus-send` implementeren en testen.
- Retrybeleid controleren.
- Monitoring toevoegen:
  - Foutstatus.
  - Berichten die te lang `Bezig` staan.
  - Inkomende berichten zonder debiteur.
  - Orders met unmatched regels.
  - Uitgaande berichten zonder TransactionID.
- Handmatige retry/annuleeractie in UI voorzien.
- `edi_handelspartner_config` per partner vullen.
- `test_modus` default aan houden tot cutover.

Output:

- RugFlow kan zonder handwerk ontvangen, verwerken, bevestigen en factureren voor de gekozen scope.

### Fase F: cutover-runbook uitvoeren

Voor cutover:

- Alle tests groen.
- Transus Online upload-tests groen.
- API rondreis groen.
- Windows Connect locatie en stopprocedure bekend.
- Backout-procedure bekend.
- Eerste cutover-moment gepland buiten piekdrukte.

Cutover-stappen:

1. Laatste controle: geen open `Fout`-berichten in test.
2. Windows Connect service stoppen.
3. Controleren dat Windows Connect niet automatisch herstart.
4. Supabase secrets controleren.
5. `transus-poll` cron activeren.
6. `transus-send` cron activeren.
7. Eerste M10110 handmatig of via cron controleren.
8. Eerste inkomende order volgen tot aangemaakte order.
9. Eerste orderbevestiging volgen tot M10100 TransactionID.
10. Transus Online controleren op foutloze verwerking.
11. Eerste factuur via EDI pas verzenden als order/orderbevestiging stabiel is.

Eerste 48 uur:

- Elk uur EDI-overzicht controleren.
- Foutmeldingen direct classificeren:
  - Data mapping.
  - Parser/build-fout.
  - Transus/API-fout.
  - Partner-validatiefout.
- Geen automatische bulk-retries zonder oorzaak.

## 3. Go/No-Go Criteria

Go als alles waar is:

- Inkomende echte fixtures parsen zonder structurele fouten.
- Ordercreatie werkt idempotent.
- Onbekende GLN en onbekend artikel hebben gecontroleerde foutflow.
- Orderbevestiging wordt door Transus Online geaccepteerd.
- Factuur wordt door Transus Online geaccepteerd voor klanten waar factuur via EDI actief is.
- API test met M10110, M10300 en M10100 is bewezen.
- `edi_handelspartner_config` is gevuld voor cutover-partners.
- Monitoring en handmatige herstelacties zijn beschikbaar.
- Windows Connect stop- en rollback-procedure is bekend.

No-go als een van deze punten speelt:

- Orderbevestiging-formaat is niet definitief bewezen.
- Parser accepteert echte `.inh` bestanden niet.
- M10300 ack gebeurt voordat ordercreatie zeker geslaagd is.
- `transus-send` ontbreekt of is niet getest.
- Factuur via EDI staat aan zonder gevalideerde factuur-builder.
- DESADV staat aan zonder zending-specificatie en data.
- Windows Connect en API zouden parallel op productiepartners draaien.

## 4. Voortgang dataverzameling

### Stap 1 — Transus account & API-toegang

Status: **grotendeels compleet (2026-04-30)**.

| Item | Status | Bron |
|---|---|---|
| `ClientID` | Compleet | Transus Online → Connect → WebConnect-tegel |
| `ClientKey` | Compleet | Idem |
| API geactiveerd in Connect-tegel | Compleet — knop toont "Deactiveren" | Visuele bevestiging in tegel |
| IP-adres restrictie | Uit | Connect-tegel: checkbox leeg |
| Compressie/Gzip | Uit | Connect-tegel: checkbox leeg → matcht huidige `transus-soap.ts` zonder gzip-handling |
| Login Transus Online | Werkt | Tegel zichtbaar, "Communicatie testen" knop reageert |
| M10110 testbestand-mechanisme | Aanwezig | "Communicatie testen" maakt automatisch een testbestand aan voor M10110-poll |
| Test-handelspartner naam | **Open** | Mogelijk niet nodig: Transus genereert het testbestand zelf via "Communicatie testen". Bevestigen bij Transus support of er een specifieke test-partner is voor M10100 (uitgaand). |
| Contactpersoon Transus support | **Open** | E-mailadres / telefoonnummer voor escalatie. |

**Secrets**: niet vastleggen in git. De waarden worden direct in Supabase Edge Function secrets gezet:

```bash
supabase secrets set TRANSUS_CLIENT_ID=<id> TRANSUS_CLIENT_KEY=<key> --project-ref <ref>
```

De edge function `transus-poll` leest ze al via `Deno.env.get('TRANSUS_CLIENT_ID')` / `'TRANSUS_CLIENT_KEY'` — geen code-aanpassing nodig.

**Implicaties voor de implementatie:**

- Geen IP-allowlist → Supabase Edge Functions kunnen direct uitgaand connecten zonder NAT-uitzondering.
- Geen compressie → SOAP-payloads blijven plain XML, geen gzip-decode nodig in `transus-soap.ts`.
- "Communicatie testen" zet zelf testberichten in M10110 → we kunnen meteen een rondreis-test draaien zónder een aparte test-handelspartner aan te maken.

### Stap 2 — Bewijsbestanden voor BDSK + top-5 partners

Status: **BDSK-rondreis 2 van 3 schakels compleet (2026-04-30); factuur-leg na 2026-05-22; top-4 partners nog open.**

#### Voortgang BDSK klantorder 8MRE0

Na download van Bericht-ID `168871472` (de Transus-bestandsnaam wijkt af van het eerder genoemde `168841472` — de bestandsnaam is leidend):

- ✅ **ORDERS-leg compleet**: zowel EDIFACT-bron als Karpi-`.inh` in [`voorbeelden/rondreis-bdsk-8MRE0/`](voorbeelden/rondreis-bdsk-8MRE0/).
- ✅ **ORDRSP-leg compleet**: TransusXML-bron + EDIFACT-output al aanwezig in `voorbeelden/`.
- ⏳ **INVOIC-leg**: volgt pas na levering 2026-05-22.

**Belangrijke ontdekking — multi-message patroon:** het EDIFACT-bestand bevat **48 orders** in 1 UNB/UNZ-interchange (segment 27 = `8MRE0`). Transus splitst dit aan Karpi-zijde in 48 losse `.inh`-bestanden. Conclusie: parser hoeft **geen multi-message logica** te bevatten — splitsing zit in Transus. Multi-message check (Actie C in eerdere lijst) is hiermee impliciet beantwoord en kan van de openstaande lijst af.



**Reeds aanwezig** in [docs/transus/voorbeelden/](voorbeelden/):

| Categorie | Bestand | Bericht-ID |
|---|---|---|
| Inkomende order BDSK | `order-in-bdsk-168766180.inh` + `edifact-source-orders-bdsk.edi` | 168766180 |
| Inkomende order Ostermann | `order-in-ostermann-168818626.inh` + `edifact-source-orders-ostermann.edi` | 168818626 |
| Orderbevestiging BDSK | `orderbev-uit-bdsk-168911805.xml` + `edifact-output-ordrsp-bdsk-168911805.edi` | 168911805 |
| Factuur BDSK | `factuur-uit-bdsk-166794659.txt` + `edifact-output-invoic-bdsk.edi` | 166794659 |

**Verband tussen de bestanden:**

- De XML `orderbev-uit-bdsk-168911805.xml` en de EDIFACT `edifact-output-ordrsp-bdsk-168911805.edi` zijn **bron+output van hetzelfde bericht** (Bericht-ID 168911805): wat Karpi naar Transus stuurt resp. wat Transus daarvan voor BDSK maakt. Beide refereren aan klantordernummer `8MRE0` / Karpi-ordernr `26554360` / OrderResponseNumber `265543600001`.
- De drie BDSK-paren (order-in 168766180, orderbev-uit 168911805, factuur-uit 166794659) horen echter bij **drie verschillende klantorders**.

**Gat in dataset:** voor end-to-end validatie hebben we minimaal één **rondreis-set** nodig: order-in → orderbev-uit → factuur-uit van dezelfde klantorder. Dichtstbijzijnde kandidaat is klantorder **`8MRE0` (Karpi 26554360)**: orderbev-leg is compleet, order-in ontbreekt nog en factuur volgt pas na levering op 2026-05-22.

**Routing-observatie:** `8MRE0` toont drie verschillende BDSK-GLN's binnen één transactie — `BuyerGLN`/`DeliveryPartyGLN`=`9007019005430` (XXXLUTZ Wuerselen), `InvoiceeGLN`=`9007019015989` (BDSK Handels, factuuradres), en de EDIFACT `UNB`-routing op `9007019010007`. Parser/builder moet deze drie rollen apart houden. Dit komt overeen met de drie-staps-keten BY ≠ DP ≠ IV die ook in de bestaande inkomende order `order-in-bdsk-168766180.inh` voorkomt.

#### Te downloaden uit Transus Online

**A. BDSK-rondreis (prio 1)** — kies één van twee paden:

*A.1 — Bouw door op klantorder `8MRE0` (Karpi 26554360):*

- De inkomende ORDERS heeft Transus Bericht-ID **`168841472`** (orderbev `168911805` is hier de reactie op).
- Open in Transus Online → Berichten/Archief Bericht-ID `168841472`.
- Download het inkomende ORDERS-bericht in beide formaten:
  - EDIFACT-bron → `docs/transus/voorbeelden/rondreis-bdsk-8MRE0/edifact-source-orders-bdsk-168841472.edi`
  - Karpi-`.inh` → `docs/transus/voorbeelden/rondreis-bdsk-8MRE0/order-in-bdsk-168841472.inh`
- Map met README en verwachte bestandsnamen staat al klaar: [`rondreis-bdsk-8MRE0/`](voorbeelden/rondreis-bdsk-8MRE0/).
- Factuur volgt pas na levering 2026-05-22 — dan ronden we de keten af.

*A.2 — Pak een al-gefactureerde order (volledige rondreis nu mogelijk):*

1. Open Transus Online → Berichten/Archief.
2. Filter op handelspartner = `BDSK Handels GmbH & Co. KG` en richting "Inkomend".
3. Kies een order van de afgelopen 4 weken die **al gefactureerd** is in RugFlow.
4. Noteer de **klant-ordernummer** uit het inkomende bericht.
5. Download daarvoor alle 6 bestanden:

| # | Berichttype | Richting | Formaat |
|---|---|---|---|
| 1 | ORDERS — bron van klant | In | EDIFACT `.edi` |
| 2 | ORDERS — output naar Karpi | In | Karpi-fixed-width `.inh` |
| 3 | ORDRSP — bron Karpi → Transus | Uit | TransusXML of fixed-width |
| 4 | ORDRSP — output naar partner | Uit | EDIFACT `.edi` |
| 5 | INVOIC — bron Karpi → Transus | Uit | Karpi-fixed-width `.txt` |
| 6 | INVOIC — output naar partner | Uit | EDIFACT `.edi` |

6. Sla op onder `docs/transus/voorbeelden/rondreis-bdsk-<klantordernr>/` met sprekende bestandsnamen.

**B. Top-4 andere partners (prio 2)** — Per partner minimaal 1 order-in (`.inh` + EDIFACT-bron) + 1 orderbev-uit (XML/fw-bron + EDIFACT) + 1 factuur-uit (fw-bron + EDIFACT). Hoeven niet één rondreis te zijn — bedoeld als regressieset voor partner-specifieke veldverschillen.

| Partner | Doel |
|---|---|
| SB-Möbel BOSS | Groot volume, vroeg valideren |
| Hornbach NL | Strikte EDI-validatie verwacht |
| Hammer | Top-volume, partner-specifieke uitzonderingen mogelijk |
| Krieger | Top-volume, regressie |

**C. Multi-message check (BDSK)** — het bestaande `edifact-source-orders-bdsk.edi` bevat **4 UNH-segmenten** in 1 interchange. We hebben maar 1 `.inh`-output (168766180). Verifieer in Transus Online dat de andere 3 UNH-berichten ook elk als losse `.inh` zijn afgeleverd. Download die 3 ontbrekende `.inh`-bestanden voor splitsings-tests.

#### Per voorbeeld vastleggen (in README van rondreis-map)

- Bericht-ID uit Transus
- Datum/tijd
- Richting (in/uit) + berichttype
- Partner naam + GLN
- Klant-ordernummer
- Karpi-ordernummer / factuurnummer
- BY/SU/IV/DP GLN's
- Aantal regels + totaalaantal
- Test of productie
- Of Transus het foutloos verwerkte (groen vinkje of foutcode)

## 5. Concrete Eerstvolgende Acties

1. Download uit Transus Online de specificaties voor BDSK:
   - Order ontvangen.
   - Orderbevestiging versturen.
   - Factuur versturen.
   - Verzending versturen, alleen ter analyse.
2. Upload het echte `orderbev-uit-bdsk-168911805.xml` bestand in de Testen-tab van `Orderbevestiging versturen`.
3. Noteer of Transus XML accepteert of fixed-width verwacht.
4. Download of screenshot de veldvalidatie.
5. Verzamel minimaal 3 extra orderbevestiging-voorbeelden van andere partners.
6. Maak een partner-mapping spreadsheet met GLN's en proces-toggles.
7. Draai een artikelmatch-rapport op alle GTIN's uit de voorbeeldberichten.
8. Pas parser en builders pas daarna definitief aan.
