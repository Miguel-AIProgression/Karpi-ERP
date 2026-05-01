# Rondreis-set BDSK — klantorder `8MRE0`

End-to-end testfixture voor één werkelijke EDI-orderketen met BDSK Handels.

## Order-identificatie

| Veld | Waarde |
|---|---|
| Klant-ordernummer (`OrderNumberBuyer` / `BGM+220`) | `8MRE0` |
| Karpi-ordernummer (`OrderNumberSupplier`) | `26554360` |
| OrderResponseNumber | `265543600001` |
| OrderDate | 2026-04-29 |
| OrderResponseDate | 2026-04-30 |
| Earliest/Latest delivery | 2026-05-22 |
| BuyerGLN / DeliveryPartyGLN | `9007019005430` (XXXLUTZ Wuerselen) |
| InvoiceeGLN | `9007019015989` (BDSK Handels GmbH & Co. KG) |
| EDIFACT-routing GLN (`UNB`) | `9007019010007` |
| Karpi/SupplierGLN | `8715954999998` |

## Berichten in deze keten

| Leg | Richting | Berichttype | Transus Bericht-ID / UNH-ref | Status |
|---|---|---|---|---|
| 1. ORDERS bron (van BDSK) | In | EDIFACT D96A `ORDERS` | `UNB`-ref `0000002882`, segment `UNH+00000028820027` | Aanwezig in [`BDSK/ORDERS_9007019010007_8715954999998.edi`](BDSK/ORDERS_9007019010007_8715954999998.edi) — multi-message bestand met 48 orders |
| 2. ORDERS output (naar Karpi) | In | Karpi-fixed-width `.inh` | bestandsnaam `ord168871472.inh` | Aanwezig in [`Karpi Group home fashion/ord168871472.inh`](Karpi%20Group%20home%20fashion/ord168871472.inh) |
| 3. ORDRSP bron (Karpi → Transus) | Uit | TransusXML | `OrderResponseNumber 265543600001` | Aanwezig in `../orderbev-uit-bdsk-168911805.xml` |
| 4. ORDRSP output (naar BDSK) | Uit | EDIFACT D96A `ORDRSP` | Transus Bericht-ID `168911805` | Aanwezig in `../edifact-output-ordrsp-bdsk-168911805.edi` |
| 5. INVOIC bron + output | Uit | fixed-width `.txt` + EDIFACT `INVOIC` | nnt | Volgt na levering 2026-05-22 |

> **Bericht-ID-kanttekening:** in een eerdere conversatie werd `168841472` genoemd voor de inkomende order, maar het werkelijk gedownloade `.inh` heeft Transus-ID `168871472` (zoals zichtbaar in de bestandsnaam). De bestandsnaam is leidend.

## Multi-message structuur (BDSK-patroon)

Het EDIFACT-bestand `BDSK/ORDERS_9007019010007_8715954999998.edi` bevat **48 UNH-segmenten** (orders) in 1 UNB/UNZ-interchange:

- Interchange-controlref `UNB`: `0000002882`, datum `260430:0025`.
- Segmenten genummerd `00000028820001` t/m `00000028820048`.
- Klantordernummers `8MRB7`, `8MRBA`, `8MRBE` … t/m segment 27 = **`8MRE0`** … t/m segment 48.
- Aan de Karpi-zijde levert Transus elk segment als losse `.inh` af. Dit `ord168871472.inh` is de gesplitste output voor segment `00000028820027` (klantorder `8MRE0`).

Implicatie voor de parser:
- Inkomende `.inh`-bestanden zijn altijd 1 order. Geen splitsing nodig.
- De EDIFACT-bron is alleen interessant als referentie/regressie — Karpi consumeert hem niet direct.
- Multi-message complexiteit zit dus aan **Transus' kant**, niet aan onze kant.

## Regels in deze order (3×)

| Lijn | Karpi-art (`SA`) | GTIN (`EN`) | Omschrijving | Aantal |
|---|---|---|---|---|
| 00001 | `PATS23XX080150` | `8715954176023` | PATCH FARBE 23 CA 080X150 CM | 1 |
| 00002 | `PATS92XX060090` | `8715954218143` | PATCH FARBE 92 CA 060X090 CM | 1 |
| 00003 | `PATS10XX060090` | `8715954235829` | PATCH FARBE 10 CA 060X090 CM | 1 |

Alle drie geaccepteerd (`Action=ACC`), prijzen netto, BTW 0% (intracommunautaire levering).

## Validatie-checks (parser/builder)

Zodra de keten in tests opgenomen is:

1. Parser-test: `ord168871472.inh` → `OrderNumberBuyer = "8MRE0"`, 3 regels, GTIN-set match.
2. GLN-rol-test: `BuyerGLN ≠ InvoiceeGLN ≠ EDIFACT-routing`. Drie aparte velden, drie aparte rollen.
3. Builder-test: bouw orderbev voor deze parsed order → output byte-identiek aan `../orderbev-uit-bdsk-168911805.xml` (modulo timestamps en `OrderResponseNumber`).
4. Multi-message regressie (optioneel): EDIFACT-bron parsen, segment 27 isoleren, vergelijken met `.inh` — geeft inzicht of Transus' splitsing 1-op-1 is met de UNH-segmenten.

## Privacy

Echte productie-GLN's en partner-namen. Niet extern delen.
