# EDI factuur-uitgaand (INVOIC) — Implementation Plan

**Datum:** 2026-06-03 · **Vervolg op:** [`2026-04-29-edi-transus-koppeling.md`](2026-04-29-edi-transus-koppeling.md)

## Doel
De enige functionele gap na de EDI go-live dichten: facturen automatisch via EDI
(Transus M10100) naar de ~10 partners met `factuur_uit=true`. De fixed-width
INVOIC-builder bestaat al ([`karpi-invoice-fixed-width.ts`](../../../supabase/functions/_shared/transus-formats/karpi-invoice-fixed-width.ts));
er ontbreekt alleen het pad van een factuur naar de uitgaande wachtrij.

## Vastgelegde keuzes (met de gebruiker, 2026-06-03)
1. **Handmatige knop** op factuur-detail (géén DB-trigger op `facturen.status`) →
   raakt de bestaande facturatie (PDF/mail/cron) niet.
2. **Bouwplek = edge function** (niet frontend-mirror, niet in `transus-send`).
   Hergebruikt de bestaande builder in `_shared/transus-formats/`; `transus-send`
   blijft dom (stuurt alleen `payload_raw`). Volgt het bestaande
   `factuur-pdf`-invoke-patroon dat factuur-detail al gebruikt → DRY + laagst-impact.
3. **Scope V1 = alleen per-order facturen** (factuur dekt precies 1 order).
   Wekelijkse verzamelfacturen (multi-order) → later. Een factuur met >1 order →
   knop geblokkeert met duidelijke melding.

## Aannames V1 (te verifiëren bij eerste echte factuur)
- Per-order facturen (`genereer_factuur`, mig 119) bevatten alleen product-regels —
  géén VERZEND/BUNDELKORTING/DREMPELKORTING (dat is weekly-only, mig 232). Defensief:
  een regel zonder oplosbare GTIN → helder fout, geen kapot bericht versturen.
- Partijen komen van de **order**-snapshot (heeft GLN's), niet de factuur-snapshot
  (heeft geen GLN): buyer=`bes_*`+`besteller_gln`, invoicee=`fact_*`+`factuuradres_gln`,
  deliveryParty=`afl_*`+`afleveradres_gln`. `bes_*` NULL → fallback naar `fact_*`.
- `deliveryNoteNumber` (verplicht in builder) = zending-nr van de order indien
  aanwezig, anders `factuur_nr` als fallback.
- BTW: `debiteuren.btw_verlegd_intracom=TRUE` → 0% op alle regels (BTW-verlegd),
  anders `factuur_regels.btw_percentage`.

## Data-mapping (KarpiInvoiceInput ← bron)
| Veld | Bron |
|---|---|
| invoiceDate / invoiceNumber | `facturen.factuurdatum` / `factuur_nr` |
| orderNumberBuyer | `orders.klant_referentie` ?? `order_nr` |
| supplierOrderNumber | `orders.order_nr` |
| orderDate | `orders.orderdatum` |
| deliveryNoteNumber | zending-nr ?? `factuur_nr` |
| vatAmount (header) | `facturen.btw_bedrag` |
| supplier | `app_config.bedrijfsgegevens` (bedrijfsnaam/adres/postcode/plaats/land) + `gln_eigen` |
| buyer | `orders.bes_*` + `besteller_gln` (fallback `fact_*`) |
| invoicee | `orders.fact_*` + `factuuradres_gln`, vatNumber `orders.btw_nummer`??`debiteuren.btw_nummer` |
| deliveryParty | `orders.afl_*` + `afleveradres_gln` |
| customerShortName | `debiteuren.naam` |
| isTestMessage | `edi_handelspartner_config.test_modus` |
| line.gtin | `producten.ean_code` (op `factuur_regels.artikelnr`) |
| line.{supplierArticleNumber,articleDescription,quantity,netPrice,lineAmount} | `factuur_regels.{artikelnr,omschrijving,aantal,prijs,bedrag}` |
| line.vatPercentage / vatAmount | verlegd ? 0 : `factuur_regels.btw_percentage` (+ afgeleid bedrag) |

## Stappen
1. **[x] Plan** (dit bestand).
2. **Pure mapper + test** — `_shared/transus-formats/factuur-mapper.ts`
   (`mapFactuurNaarInvoiceInput(FactuurEdiData): KarpiInvoiceInput`) +
   `factuur-mapper.test.ts` (Deno). TDD: dekt BTW-verlegd, bes_*-fallback,
   missing-GTIN-throw, country-normalisatie. ← kernlogica, eerst groen.
3. **Edge function** `supabase/functions/bouw-factuur-edi/index.ts` — input
   `{factuur_id}`; service-role; valideert single-order + `factuur_uit/transus_actief`;
   haalt data op → `FactuurEdiData`; mapt; bouwt fixed-width; idempotente insert in
   `edi_berichten` (`richting='uit', berichttype='factuur', bron_tabel='facturen',
   bron_id=factuur_id, status='Wachtrij'`); returnt `{uitgaandId, reedsAanwezig}`.
4. **Frontend** — `verstuurFactuurViaEdi(factuurId)` (invoke) + `useVerstuurFactuurViaEdi`
   hook + knop "Verstuur via EDI" op factuur-detail (alleen tonen als partner
   `factuur_uit && transus_actief` én factuur single-order). Query voor partner-config.
5. **Docs** — `changelog.md` + EDI-blok in `CLAUDE.md` aanvullen + logboek §D bijwerken.

## Buiten V1
Multi-order/weekly INVOIC, auto-trigger op `facturen.status`, verzendkosten-regel
(ALC/charge) in INVOIC, DESADV.
