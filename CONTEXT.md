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

**Labelbarcode**:
De Code128-waarde die fysiek op het verzendlabel staat: AI(00) + de
18-cijferige SSCC (20 cijfers). Het is een eigenschap van **ons label**, niet
van een vervoerder — dezelfde doos, ongeacht wie hem ophaalt. Daarom leeft de
encoding op één plek (`_shared/vervoerders/labelbarcode.ts`, `labelBarcode()`)
en lezen álle consumenten die: de drie label-varianten (compact/staand/DPD), de
HST-`BarCode`, de Verhoek-`ScanCode` en de Rhenus-`<sscc>`. Een colli zonder
SSCC levert geen Labelbarcode (`null`) — er mag nooit een niet-aangemelde
barcode geprint of verstuurd worden. De SSCC-waarde zelf blijft single-source
uit `zending_colli.sscc`; de Labelbarcode is de gedeelde *encoding* daarvan.
_Avoid_: scancode, SSCC-barcode (per-carrier termen — het is één label-feit)

## Relationships

- Een **Order** bevat één of meer **Orderregels**
- Elk **Intake-kanaal** is een adapter op de **Order-landing**; het handmatige
  kanaal bouwt zijn invoer via de **Order-commit**-pipeline
- Een maatwerk-**Orderregel** produceert één **Snijplan** per stuk
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
