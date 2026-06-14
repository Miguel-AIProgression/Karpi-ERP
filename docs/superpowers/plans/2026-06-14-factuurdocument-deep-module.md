# Plan: Factuurdocument als deep module (ADR-0036)

**Branch:** `feat/factuurdocument-deep-module` (worktree `.worktrees/factuurdocument`)
**Datum:** 2026-06-14
**ADR:** [0036](../../adr/0036-factuurdocument-als-deep-module.md)

## Doel

Eén opgeloste factuur-representatie (`FactuurDocument`) die naar PDF én EDI-INVOIC rendert via
dunne pure renderers, gevoed door één gedeelde Artikelpresentatie-resolver. Heft de divergentie
op tussen de twee EDI-paden (`buildEdiFactuurInput` rijk vs `mapFactuurNaarInvoiceInput` kaal) en
de derde PDF-variant van de artikeltekst.

## Huidige situatie (bron-paden)

| Pad | Bestand | Regel-shape | Resolve |
|---|---|---|---|
| PDF on-demand | `factuur-pdf/index.ts` → `_shared/factuur-pdf.ts` | `FactuurPDFRegel` | rauwe omschrijving |
| PDF + email + EDI-queue | `factuur-verzenden/index.ts` | `FactuurPDFRegel` + inline EDI-regels | rijk (karpi_code/klant_artikel/gewicht) |
| EDI handmatig | `bouw-factuur-edi/index.ts` → `_shared/transus-formats/factuur-mapper.ts` | `FactuurEdiRegel` | kaal (alleen GTIN) |
| Orderbevestiging | `stuur-orderbevestiging` → `_shared/orderbevestiging-pdf.ts` | `OrderbevestigingRegel` | eigen karpi_code-resolve + btw.ts |

## Slices (verticaal, vangnet-eerst)

### Slice 0 — Vangnet: golden snapshot huidige output
- Karakterisatie-test die voor een representatieve factuur (multi-regel, ≥1 zonder klant_artikel,
  1 met BTW-verlegd) de **huidige** `buildEdiFactuurInput`-output (= het rijke, canonieke doel) en
  de huidige `genereerFactuurPDF`-regelinhoud vastlegt als golden fixture.
- Doel: bewijs dat het automatische EDI-pad gedragsneutraal blijft; het handmatige pad wordt
  bewust naar dit contract opgetrokken.
- **Test:** `_shared/facturatie/__tests__/golden/factuur-document.golden.json` + runner.

### Slice 1 — Artikelpresentatie-resolver (pure + IO)
- Nieuw `_shared/facturatie/artikel-presentatie.ts`:
  - pure `resolveArtikelPresentatie(regelRows, productRows, klantArtikelRows, orderRegelRows)`
    → `Map<artikelnr, ArtikelPresentatie>` met `{ karpi_code, klant_artikel, gtin, gewicht, omschrijving }`.
  - IO `fetchArtikelPresentatie(supabase, debiteur_nr, artikelnrs)` → roept de pure variant aan.
- Extraheert de resolve-logica die nu inline in `buildEdiFactuurInput` zit (regels 677-706).
- **Test:** `artikel-presentatie.test.ts` (pure transform, edge-cases: ontbrekend product, geen
  klant_artikel, maatwerk zonder gewicht).

### Slice 2 — FactuurDocument + canonieke regel-shape
- Nieuw `_shared/facturatie/factuur-document.ts`:
  - `FactuurDocument` + `FactuurDocumentRegel` (unie van PDF + EDI velden).
  - `fetchFactuurDocument(supabase, factuurId) → FactuurDocument` (factuur + factuur_regels +
    orders/partijen + Artikelpresentatie + BTW-verlegd via `btw.ts`).
- **Test:** golden uit slice 0 voeden via dit document.

### Slice 3 — EDI-renderer: collapse de twee paden
- `naarInvoiceInput(doc) → KarpiInvoiceInput` (vervangt `buildEdiFactuurInput` én
  `mapFactuurNaarInvoiceInput`).
- `factuur-verzenden` en `bouw-factuur-edi` worden dunne schillen (fetchFactuurDocument →
  naarInvoiceInput → buildKarpiInvoiceFixedWidth → edi_berichten).
- **Test:** golden bewijst byte-identiek INVOIC voor beide paden; `factuur-mapper.test.ts`
  migreert naar de nieuwe transform.
- **Let op:** `bouw-factuur-edi` V1-scope (precies 1 order) blijft een guard in de schil.

### Slice 4 — PDF-renderer
- `naarFactuurPdfInput(doc) → FactuurPDFInput`.
- `factuur-pdf` en `factuur-verzenden` PDF-pad gebruiken het. PDF toont nu de opgeloste
  Artikelpresentatie (gedragswijziging — golden + visuele check).
- **Test:** `factuur-pdf.test.ts` uitgebreid met de resolved-tekst-verwachting.

### Slice 5 — Orderbevestiging deelt de resolver
- `stuur-orderbevestiging` / `orderbevestiging-pdf` consumeren `fetchArtikelPresentatie` +
  `btw.ts` i.p.v. eigen karpi_code-resolve. Eigen document blijft.
- Smalste touch; bewijst dat de resolver gedeeld is, niet de document-expansie.

### Slice 6 — Opruimen + docs + deploy
- Verwijder dode types (`FactuurEdiRegel`, inline EDI-regelopbouw) na de collapse.
- `architectuur.md` (facturatie-flow + module-graf), `data-woordenboek.md`, `changelog.md`.
- Deploy edge functions: `factuur-verzenden`, `bouw-factuur-edi`, `factuur-pdf`,
  `stuur-orderbevestiging` (gedeelde `_shared/`-wijziging → alle vier redeployen).

## Risico's
- **Live geld-/klantpad:** facturen gaan naar klanten. Golden-snapshot vóór elke collapse;
  gedragsneutraal voor het automatische pad.
- **Zichtbare PDF-wijziging:** artikeltekst verandert. Visuele check + akkoord vóór deploy.
- **Deploy-fan-out:** vier edge functions delen `_shared/facturatie/`; deploy-checklist.

## Definition of done
- Eén `FactuurDocument` voedt PDF + beide EDI-paden; golden pint identiek INVOIC.
- Geen inline metadata-resolve meer buiten `artikel-presentatie.ts`.
- BTW-verlegd via `btw.ts` op alle paden.
- Docs bijgewerkt; vier edge functions gedeployed.
