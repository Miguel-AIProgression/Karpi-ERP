# Transus Voorbeeldberichten

Drie real-world berichten gedownload uit Transus Online op 2026-04-29, gebruikt als referentie voor de fixed-width parser/builder en als testdata.

## Bestanden

### Inkomende orders (order in / Karpi-fixed-width)

| Bestand | Bericht-ID | Partner | Bijzonderheid |
|---|---|---|---|
| `order-in-ostermann-168818626.inh` | 168818626 | Einrichtungshaus Ostermann (Leverkusen) | 23 regels, alleen single-stuks (1× 2-stuks). Toont **rijke** veldenset: GTIN + ArticleCodeBuyer + Description per regel. |
| `order-in-bdsk-168766180.inh` | 168766180 | BDSK / XXXLUTZ Wuerselen | 1 regel. Toont **schrale** veldenset: alleen GLN's + GTIN + aantal. Drie-staps-keten BY ≠ DP ≠ IV. |

### EDIFACT-bron (wat klant naar Transus stuurt)

| Bestand | Inhoud |
|---|---|
| `edifact-source-orders-ostermann.edi` | EDIFACT D96A ORDERS van Ostermann — single-message interchange |
| `edifact-source-orders-bdsk.edi` | EDIFACT D96A ORDERS van BDSK — **multi-message interchange** met 4 UNH-segmenten in 1 UNB/UNZ. Transus splitst per UNH richting Karpi. |

### Uitgaande factuur

| Bestand | Inhoud |
|---|---|
| `factuur-uit-bdsk-166794659.txt` | Karpi-fixed-width INVOIC-bron. Factuurnr 26039533, 1 regel à €68,59 BTW-vrijgesteld. |
| `edifact-output-invoic-bdsk.edi` | EDIFACT D96A INVOIC zoals BDSK het ontvangt. |
| `factuur-uit-bdsk-168849861.txt` | Karpi-fixed-width INVOIC-bron. Factuurnr 26040215, 1 regel à €59,46 BTW-vrijgesteld. |
| `edifact-output-invoic-bdsk-168849861.edi` | EDIFACT D96A INVOIC zoals BDSK het ontvangt voor bericht-ID 168849861. |

### Uitgaand verzendbericht / pakbon (DESADV)

| Bestand | Bericht-ID | Partner | Inhoud |
|---|---|---|---|
| `verzendbericht-uit-hornbach-172390327.txt` | 172390327 | Hornbach NL | Karpi-fixed-width DESADV-bron (Windows Connect, 2026-06-11). Header 291 bytes + 1 artikel-regel 245 bytes, CRLF. Pakbonnr 00456666, 5× TEDDY 43 060x090. Byte-identiek aan `EDI/Bericht-ID 172390327.zip`. Fixture voor `karpi-verzendbericht.test.ts`. |
| `edifact-output-desadv-hornbach-172390327.edi` | 172390327 | Hornbach NL | EDIFACT D:01B DESADV zoals Hornbach het ontvangt — gebruikt om de betekenis van elk bron-veld vast te stellen (kolomkaart in `karpi-verzendbericht.ts`). |

## Gebruik in tests

Deze bestanden worden geladen door `supabase/functions/_shared/transus-formats/karpi-fixed-width.test.ts`,
`supabase/functions/_shared/transus-formats/karpi-invoice-fixed-width.test.ts` en
`supabase/functions/_shared/transus-formats/karpi-verzendbericht.test.ts` als
fixtures. **Niet aanpassen** zonder de tests bij te werken — ze representeren echte productie-data van 2026-04 t/m 2026-06.

## Privacy

Klantgegevens en GLN's zijn echte productiewaarden. Niet extern delen.
