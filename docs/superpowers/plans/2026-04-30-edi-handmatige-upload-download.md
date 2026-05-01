# EDI handmatige upload/download — round-trip-test zonder Transus API

**Status:** plan opgesteld 2026-04-30
**Doel:** validatiepad bouwen waarmee Miguel/Karpi echte Transus-bestanden lokaal door de RugFlow EDI-pijplijn kan duwen *zonder* de M10110/M10100 SOAP-koppeling te activeren. Bestaande "Demo-bericht"-knop blijft naast de nieuwe upload-knop bestaan voor snelle smoke-tests.

## 1. Achtergrond

De pre-cutover validatie (zie [`docs/transus/pre-cutover-data-stappenplan.md`](../../transus/pre-cutover-data-stappenplan.md), fase C) vereist dat we per partner kunnen aantonen:

1. **Inkomend** — Transus' `.inh`-output wordt foutloos gepa rsed, debiteur wordt herkend, order wordt aangemaakt met de juiste GLN-rollen, regels matchen op GTIN.
2. **Uitgaand** — onze orderbevestiging-payload wordt door Transus' "Bekijken en testen"-tab geaccepteerd en de uitgaande EDIFACT `ORDRSP` matcht het verwachte partnerformaat.

Vandaag is dit alleen via de hardcoded "Demo-bericht"-flow mogelijk — die werkt op fictieve templates en bewijst niets over echte productie-data. Bovendien is de uitgaande payload-builder nog gebaseerd op de werkhypothese "fixed-width voor alle partners", terwijl het BDSK-voorbeeld [`orderbev-uit-bdsk-168911805.xml`](../../transus/voorbeelden/orderbev-uit-bdsk-168911805.xml) toont dat BDSK juist **TransusXML** verwacht.

## 2. Doelen / non-doelen

### Doelen

- Inkomend `.inh`-bestand kunnen uploaden via de EDI-berichten-pagina → automatisch parsen, debiteur matchen, order aanmaken, alles met `is_test=true`.
- Uitgaande payload (orderbevestiging, later factuur) kunnen downloaden als bestand, in het juiste partnerformaat.
- TransusXML-builder voor orderbevestiging implementeren naast de bestaande fixed-width-builder.
- Round-trip op echte BDSK-keten 8MRE0 in tests verankeren (fixture-test).

### Non-doelen

- Géén EDIFACT-parser/builder bouwen — Karpi krijgt nooit EDIFACT van Transus en stuurt geen EDIFACT naar Transus.
- Géén M10100/M10110 SOAP-activatie — die staat in een aparte fase en blijft pas live na deze handmatige round-trip.
- Géén DESADV (verzendbericht), géén INVOIC-builder — beide volgen pas na 2026-05-22 (eerste echte BDSK-factuur).
- Géén realtime Transus-validatieresultaten in RugFlow — user kopieert handmatig terug.

## 3. User-flow (round-trip)

```
┌──────────────┐  1. download .inh   ┌────────────────────┐
│ Transus      │ ──────────────────▶ │ Lokale download    │
│ Online       │                     │ (browser-bestand)  │
└──────────────┘                     └────────────────────┘
                                                  │
                                                  │ 2. upload knop
                                                  ▼
                                     ┌────────────────────┐
                                     │ EDI-berichten      │
                                     │ overzicht-pagina   │
                                     └────────────────────┘
                                                  │
                                                  │ 3. parse + create_edi_order
                                                  ▼
                                     ┌────────────────────┐
                                     │ Order ontstaat in  │
                                     │ orders-tabel       │
                                     │ (is_test=true)     │
                                     └────────────────────┘
                                                  │
                                                  │ 4. user klikt "Bevestigen"
                                                  ▼
                                     ┌────────────────────┐
                                     │ Uitgaand bericht   │
                                     │ in wachtrij        │
                                     └────────────────────┘
                                                  │
                                                  │ 5. user kiest format + download
                                                  ▼
┌──────────────┐  6. upload in       ┌────────────────────┐
│ Transus      │ ◀────────────────── │ XML/fixed-width    │
│ "Testen"-tab │     "Testen"-tab    │ payload-bestand    │
└──────────────┘                     └────────────────────┘
        │
        │ 7. validatie-resultaat (groen of foutmelding)
        ▼
   user kopieert resultaat terug naar bericht-detail-pagina
   (notitieveld) → handmatige status-tracking
```

## 4. Architectuur-keuzes

### 4.1 Format-detectie inkomend

Eén format te ondersteunen: **Karpi-fixed-width** (`.inh`, `.txt`).

Detectie:
- Extension whitelist: `.inh`, `.txt`.
- First-byte check: header-record begint met `'0'` (record-type) — als eerste byte iets anders is, weiger met duidelijke foutmelding.
- File-size sanity: < 100 KB. Voor multi-message gevallen (zoals BDSK 48-message) levert Transus altijd al gesplitste `.inh`'s, dus 1 file = 1 order.

### 4.2 Format-keuze uitgaand

Per uitgaand bericht moet de gebruiker kunnen kiezen tussen:

- **TransusXML** — `<ORDERRESPONSES>` zoals BDSK het verwacht.
- **Karpi fixed-width** — bestaande builder, voor partners waar XML niet werkt.

Default per debiteur via `edi_handelspartner_config.orderbev_format` (nieuwe kolom, enum `'transus_xml' | 'fixed_width'`, default `'transus_xml'`). UI laat altijd beide opties toe — user kan handmatig overrulen voor ad-hoc tests.

### 4.3 Idempotentie & dedup

`edi_berichten.transactie_id` is `UNIQUE`. Voor uploads:

- Genereer transactie_id als `UPLOAD-{sha256(payload)[:12]}`.
- Bij dubbele upload van hetzelfde bestand → unique-violation gevangen → dialog toont "Bestand al eerder geüpload op {datum} → bericht #{id}". Geen tweede insert.
- Voor wijzigingen aan hetzelfde Transus-bericht (bv. heruploaden na manuele bewerking) → user moet expliciet "Forceer als nieuw bericht" aanvinken; dan suffix `-{Date.now()}`.

### 4.4 Test-isolatie

Alle uploads krijgen `is_test=true`. De bestaande `ruim_edi_demo_data()` RPC ruimt al rijen op met `is_test=true` en bijbehorende orders met `bron_systeem='edi' AND bron_order_id LIKE 'DEMO-%'`. We breiden de prefix-match uit naar `('DEMO-%', 'UPLOAD-%')` zodat één opruimknop alle test-data wist.

### 4.5 Geen edge-function-aanpassingen

Hele flow draait in de browser-pagina (frontend → Supabase RPC's). Edge-functions `transus-poll`/`transus-send` blijven onaangeroerd in deze fase — die activeren we pas wanneer round-trip groen is.

## 5. Implementatie-fases

### Fase 1 — Upload inkomend bericht (highest value, smallest footprint)

**Nieuwe bestanden:**

- [`frontend/src/components/edi/upload-bericht-dialog.tsx`](../../../frontend/src/components/edi/upload-bericht-dialog.tsx) — modal met file-drop, validatie, preview-stap, "Verwerken"-knop.
- [`frontend/src/lib/edi/upload-helper.ts`](../../../frontend/src/lib/edi/upload-helper.ts) — `verwerkUploadInkomend(file, options)` analoog aan `genereerDemoBerichten`.

**Bestaande bestanden uitbreiden:**

- [`frontend/src/pages/edi/berichten-overzicht.tsx`](../../../frontend/src/pages/edi/berichten-overzicht.tsx) — extra knop "Bestand uploaden" naast "Demo-bericht".

**Validatie-stappen in helper:**

1. Lees `File` als string (UTF-8; Transus levert ons al-gedecodeerd uit CP-1252 via M10110, maar bestanden uit het archief zijn ook UTF-8 omdat de browser ze zo presenteert).
2. Sanity-check: minimaal 463 bytes, eerste byte `'0'`.
3. `parseKarpiOrder(raw)` → throw bij parse-fout met regelnummer.
4. Hash payload → transactie_id.
5. Match debiteur op `gln_gefactureerd`/`gln_besteller`.
6. Insert `edi_berichten` rij (`richting='in'`, `status='Verwerkt'`, `is_test=true`, `transactie_id`, `payload_raw`, `payload_parsed`).
7. Roep `create_edi_order` RPC aan.
8. Retourneer dezelfde `DemoResult`-shape als demo-helper → UI-component kan beide flows gebruiken.

**Test-fixture:** [`docs/transus/voorbeelden/rondreis-bdsk-8MRE0/Karpi Group home fashion/ord168871472.inh`](../../transus/voorbeelden/rondreis-bdsk-8MRE0/Karpi%20Group%20home%20fashion/ord168871472.inh) — moet leiden tot:
- `OrderNumberBuyer = "8MRE0"`, leverdatum `2026-05-22`.
- 3 regels (PATS23/PATS92/PATS10), aantal 1 elk.
- Debiteur-match op `gln_gefactureerd=9007019015989` → BDSK Handels.

### Fase 2 — Download payload van uitgaand bericht

**Nieuwe bestand:** [`frontend/src/components/edi/download-payload-knop.tsx`](../../../frontend/src/components/edi/download-payload-knop.tsx) — knop met dropdown om format te kiezen + Blob-download.

**Uitbreiding:** detail-pagina uitgaande berichten (zoeken: `frontend/src/pages/edi/bericht-detail.tsx` of vergelijkbaar) — extra "Download payload"-sectie met:
- Format-dropdown (default uit `edi_handelspartner_config.orderbev_format`).
- Karakter-encoding-dropdown (UTF-8 / CP-1252 / ISO-8859-1).
- Bestandsnaam-veld (default `orderbev-{debiteur_kortnaam}-{bericht_id}.{ext}`).

**Bestand-format-conventie:**

| Format | Extension | Encoding |
|---|---|---|
| TransusXML | `.xml` | UTF-8 (XML-declaratie matcht `<?xml version="1.0"?>`) |
| Karpi fixed-width | `.txt` | CP-1252 (default voor consistency met inkomend) |

### Fase 3 — TransusXML-builder voor orderbevestiging

**Nieuwe bestand:** [`frontend/src/lib/edi/transus-xml.ts`](../../../frontend/src/lib/edi/transus-xml.ts).

**Geëxporteerde API:**

```typescript
export interface OrderbevXmlInput {
  // Header
  senderGln: string;          // Karpi 8715954999998
  recipientGln: string;       // partner factuur-GLN (BDSK = 9007019015989)
  isTestMessage: boolean;
  orderResponseNumber: string; // <OrderResponseNumber> bv. "265543600001"
  orderResponseDate: string;   // YYYYMMDD
  action: 'ACC' | 'CHA' | 'REJ';
  orderNumberBuyer: string;    // klant-PO bv. "8MRE0"
  orderNumberSupplier: string; // Karpi-ordernummer bv. "26554360"
  orderDate: string;           // YYYYMMDD
  earliestDeliveryDate: string;
  latestDeliveryDate: string;
  currencyCode: string;        // "EUR"
  buyerGln: string;            // BY
  supplierGln: string;         // SU = Karpi
  invoiceeGln: string;         // IV
  deliveryPartyGln: string;    // DP
  // Articles
  articles: Array<{
    lineNumber: string;        // gepad "00001"
    articleDescription: string;
    articleCodeSupplier: string;
    gtin: string;
    purchasePrice: number;
    articleNetPrice: number;
    vatPercentage: number;
    action: 'ACC' | 'CHA' | 'REJ';
    orderedQuantity: number;
    despatchedQuantity: number;
    deliveryDate: string;       // YYYYMMDD
  }>;
}

export function buildOrderbevTransusXml(input: OrderbevXmlInput): string;
```

**Format-decisies:**

- Geen XML-namespace.
- Indentatie zoals voorbeeld (geen indentatie, 1 element per regel met `\n`).
- Strings met spaces worden right-padded zoals `OrderNumberBuyer>8MRE0                              </` — checken of Transus dat verplicht.
- Decimal punt voor prijs (`29.73`), 2 decimalen.
- Datums als `YYYYMMDD` (geen separator).
- Encoding via XML-declaratie: `<?xml version="1.0"?>` (zoals voorbeeld — geen `encoding=` attribuut).

**Validatie-fixture:** byte-vergelijk tegen [`orderbev-uit-bdsk-168911805.xml`](../../transus/voorbeelden/orderbev-uit-bdsk-168911805.xml) modulo `OrderResponseNumber`/`OrderResponseDate`.

**OrderResponseNumber-generatie:** voorbeeld toont `265543600001` = `Karpi-ordernr (26554360)` + `suffix 01`. Voorstel: vooroplopende `bron_id` + auto-increment per order. Zet als kolom `edi_berichten.order_response_seq` (per order beginnend bij 1) — query: `COALESCE(MAX(seq), 0) + 1 WHERE bron_tabel='orders' AND bron_id=<order_id>`.

**Bevestig-helper aanpassen:** `bevestigOrderViaEdi()` krijgt extra parameter `format: 'transus_xml' | 'fixed_width'`. Roept de juiste builder aan en zet `payload_parsed.format` voor traceability.

### Fase 4 — Round-trip status-tracking (handmatig)

**Migratie 158:** voeg toe aan `edi_berichten`:
- `transus_test_status` enum (`'niet_getest' | 'goedgekeurd' | 'afgekeurd'`, default `'niet_getest'`).
- `transus_test_resultaat` text (vrij notitieveld voor copy-paste van Transus' foutmeldingen).
- `transus_test_at` timestamptz.

**UI:** detail-pagina krijgt sectie "Transus-validatie":
- 3 radio-buttons (status).
- textarea voor notities.
- timestamp wordt automatisch gezet bij wijziging.

**Doel:** Miguel kan per bericht annoteren "20 BY-velden geweigerd, mist NAD+SU"-style feedback en heeft daarmee een aanwijsbare backlog van openstaande format-issues per partner.

### Fase 5 — Cleanup-uitbreiding

**Migratie 159:** wijzig `ruim_edi_demo_data()`:

```sql
DELETE FROM orders
WHERE bron_systeem = 'edi'
  AND (bron_order_id LIKE 'DEMO-%' OR bron_order_id LIKE 'UPLOAD-%');

DELETE FROM edi_berichten
WHERE is_test = true
  AND (transactie_id LIKE 'DEMO-%' OR transactie_id LIKE 'UPLOAD-%' OR transactie_id IS NULL);
```

Knop in UI blijft "Demo-data opruimen" — label uitbreiden naar "Test-data opruimen".

## 6. Database-wijzigingen samenvatting

| Migratie | Verandering | Fase |
|---|---|---|
| 158 | `edi_handelspartner_config.orderbev_format` enum kolom | Fase 2 |
| 158 | `edi_berichten.order_response_seq` integer | Fase 3 |
| 158 | `edi_berichten.transus_test_*` velden | Fase 4 |
| 159 | `ruim_edi_demo_data()` uitbreiden | Fase 5 |

Niets daarvan breekt bestaande flows.

## 7. Test-aanpak

**Unit:**
- `karpi-fixed-width.test.ts` → uitbreiden met fixture `rondreis-bdsk-8MRE0/Karpi Group home fashion/ord168871472.inh`.
- `transus-xml.test.ts` → nieuw, byte-vergelijking met `orderbev-uit-bdsk-168911805.xml` modulo OrderResponseNumber/Date.

**End-to-end (handmatig):**
1. Cleanup: klik "Test-data opruimen".
2. Upload `ord168871472.inh` → controleer dat order ontstaat met klant-PO `8MRE0` en 3 regels.
3. Klik "Bevestigen" → kies format `TransusXML` → download.
4. Vergelijk gedownload bestand met `orderbev-uit-bdsk-168911805.xml` (alleen velden anders: `OrderResponseNumber`, `OrderResponseDate`, prijzen — voorbeeld toont 29.73/13.38/13.38 wat al bekend is uit het oorspronkelijke voorbeeld).
5. Upload de download in Transus' "Bekijken en testen"-tab van proces "Orderbevestiging versturen".
6. Noteer Transus-resultaat in detail-pagina.

## 8. Open vragen / risks

| # | Vraag | Mitigatie |
|---|---|---|
| 1 | TransusXML voor andere partners (Ostermann/Hornbach/etc): zelfde format of partner-specifieke varianten? | Format-keuze per debiteur (fase 2) — zodra eerste partner-spec terugkomt van Maureen, default per partner instellen. |
| 2 | Encoding XML: voorbeeld heeft `<?xml version="1.0"?>` zonder encoding-attribuut. UTF-8 of CP-1252? | UTF-8 default; bij Transus-fout switchen naar CP-1252 + encoding-attribuut. |
| 3 | `OrderResponseNumber` format-vrijheid? Voorbeeld is `26554360` + `01` — als we hierop botsen bij her-bevestiging dan suffix `02`. | Kolom `order_response_seq`, increment per bevestiging. |
| 4 | Padding van string-velden (`OrderNumberBuyer` heeft trailing spaces). Verplicht of optioneel? | Eerst minimaal padden naar 35 tekens (zoals voorbeeld); aanpassen op basis van Transus-feedback. |
| 5 | Wat als debiteur niet matcht op GLN? | Order niet aanmaken, bericht logged met `error_msg` + `status='Fout'`. Zelfde flow als demo-helper. |

## 9. Volgordelijkheid uitvoering

```
Fase 1 (upload inkomend) ──┐
                           ├─▶ Smoke-test BDSK 8MRE0 → bericht in en order in
Fase 3 (TransusXML)     ──┤
                           ├─▶ Download orderbev XML
Fase 2 (download)       ──┘

→ Upload in Transus Testen-tab → resultaat noteren

Fase 4 (status-tracking)  → in volgende iteratie
Fase 5 (cleanup)          → in volgende iteratie
```

Fase 1 + 2 + 3 zijn de minimale set voor een werkende round-trip.

## 10. Definition of done (fase 1+2+3)

- [ ] `ord168871472.inh` upload → order verschijnt in orders-overzicht met `is_test=true`.
- [ ] Bevestigen-knop → uitgaand bericht in wachtrij + format-dropdown geeft TransusXML output.
- [ ] Download knipt het bericht eruit met juiste filename + extension.
- [ ] Gedownloade XML lijkt 1:1 op het origineel `orderbev-uit-bdsk-168911805.xml` (modulo OrderResponseNumber/Date).
- [ ] Unit-test `transus-xml.test.ts` is groen.
- [ ] Migratie 158 toegepast (kolommen `orderbev_format` + `order_response_seq`).
- [ ] [`docs/transus/pre-cutover-data-stappenplan.md`](../../transus/pre-cutover-data-stappenplan.md) bijgewerkt met round-trip-instructies.
- [ ] [`docs/changelog.md`](../../changelog.md) heeft een entry voor deze feature.
