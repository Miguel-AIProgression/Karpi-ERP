# Mail-template aan Transus (Maureen)

> Klaar om te kopiëren-plakken in het support-ticket. Combineer alle vragen in één mail
> zodat we niet stapelend hoeven te wachten.

---

**Onderwerp:** Vervolgvragen Transus API-migratie — test-handelspartner + Client-credentials + uitgaande berichtspecs

Beste Maureen,

Hartelijk dank voor je eerdere reactie op onze migratie-vragen. We zijn ondertussen begonnen met het bouwen aan onze kant en lopen tegen drie zaken aan waarop we graag jullie hulp hebben:

### 1. Test-handelspartner
We willen onze nieuwe API-koppeling kunnen valideren met een **rondreis-test** (order-in → orderbevestiging-uit → factuur-uit → ack-status "Afgeleverd") zonder dat dit bij een van onze 39 echte handelspartners aankomt.

- Kunnen jullie voor ons een **test-handelspartner met test-GLN** opzetten waarmee we deze rondreis kunnen testen?
- Het zou ons zeer helpen als we tijdens deze test-fase parallel met onze huidige Windows Connect-verbinding kunnen werken (via de test-partner alleen onze API testen, productie blijft via WC).

### 2. API Client-credentials
We hebben in Transus Online → Connect-tegel → "Transus API" de credentials nodig om M10100/M10110/M10300 te kunnen aanroepen. Zou je willen verifiëren dat deze al voor ons account geactiveerd zijn? Wij verwachten:

- **ClientID** (8-cijferig)
- **ClientKey** (12 alfanumeriek)

Als de Transus API-tegel nog niet geactiveerd is voor ons account: graag activeren met de standaard rate-limits (geen IP-restricties in eerste fase) en zonder Gzip-compressie (V2-optimalisatie).

### 3. Berichtspecificaties uitgaande berichten
Voor de "Order ontvangen" hebben we de berichtspecificatie via Transus Online kunnen downloaden — dank daarvoor. We hebben dezelfde specificatie nodig voor de andere drie processen waarvoor onze partners ons verwachten:

- **Orderbevestiging versturen** — hoe ziet de input-XML/fixed-width van Karpi naar Transus eruit, en welke velden zijn voor onze top-5 partners ondersteund?
- **Factuur versturen** — idem
- **Verzending versturen (DESADV)** — idem (we beginnen mogelijk later met dit type, want onze zending-data is nog niet volledig EDI-klaar)

Specifiek: kun je voor BDSK Handels GmbH & Co. KG (ID 9007019015989) dezelfde "berichtspecificatie"-PDF aanleveren voor deze drie uitgaande processen? BDSK is verreweg onze grootste EDI-partner (≈3.300 facturen/jaar), dus het is voor ons belangrijk dat we hun specifieke schema-vereisten kennen voordat we live gaan.

### 4. Voorzichtige bevestiging procedure
Wij begrijpen uit je eerdere antwoord dat WC en API niet parallel kunnen draaien voor dezelfde handelspartner. Klopt het dat we op cutover-moment alleen de Transus Windows Connect service hoeven te stoppen (op MITS-CA-01-009) — en dat we vanuit jullie kant verder niets hoeven te activeren?

We mikken op een cutover-moment in de loop van de komende maand. We laten je een week vooraf weten welke dag we kiezen, zodat jullie eventueel kunnen meekijken in de eerste 24 uur na switch.

Hartelijk dank,

Miguel
