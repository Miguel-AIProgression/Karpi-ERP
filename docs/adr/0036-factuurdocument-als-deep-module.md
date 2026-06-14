# ADR-0036: Factuurdocument als één deep module — één opgeloste factuur voor PDF én EDI-INVOIC

**Status:** Voorgesteld (2026-06-14)

## Context

Een factuur (`facturen` + `factuur_regels`, gegenereerd door `genereer_factuur_voor_bundel`)
wordt naar buiten gerenderd in drie externe representaties: de **factuur-PDF**, en de
**EDI-INVOIC** via twee aparte paden. Die drie paden leiden de factuur-inhoud elk
onafhankelijk af uit `factuur_regels` + `order_regels`/`producten`/`klant_artikelen`,
met een eigen regel-shape, een eigen metadata-resolve en een eigen BTW-verlegd-behandeling.

Concreet, op dit moment:

- **`factuur-pdf`** (edge function, on-demand) en **`factuur-verzenden`** (queue-drain)
  roepen beide `genereerFactuurPDF` aan met `FactuurPDFRegel` — de PDF toont de **rauwe**
  `factuur_regels.omschrijving`, lost géén `karpi_code`/`klant_artikel` op.
- **`factuur-verzenden` → `buildEdiFactuurInput`** (automatisch pad): lost `karpi_code`,
  `klant_artikel` (→ `buyerArticleNumber`), GTIN (`producten.ean_code`) en gewicht op,
  en bouwt `articleDescription` als `"[karpi_code] [klant_artikel||omschrijving]"`.
- **`bouw-factuur-edi` → `mapFactuurNaarInvoiceInput`** (handmatige knop in de facturatie-
  frontend, `facturen.ts`): neemt vóóraf-opgeloste data, lost géén `karpi_code`/`klant_artikel`/
  gewicht op, `articleDescription` = `omschrijving ?? artikelnr`.

**De scherpste frictie is geen DRY-smaak maar een echte bug-oppervlakte:** dezelfde factuur
levert een **ander INVOIC-bericht** afhankelijk van of hij automatisch of handmatig verstuurd
wordt — andere artikeltekst, ander artikelnummer (supplier/buyer), wél/géén gewicht. En de
PDF toont een derde variant van de artikeltekst. Er is dus geen enkele bron-van-waarheid voor
"hoe ziet een factuurregel naar buiten eruit".

Wat al wél gedeeld is: `berekenFactuurTotalen` (`factuur-bedrag.ts`) voor de totalen, en de
`btw.ts`-seam (`isBtwVerlegd`/`effectiefBtwPct`) — maar die laatste wordt alléén door de
orderbevestiging gebruikt; de factuur-PDF en de twee EDI-paden doen elk een eigen inline
BTW-verlegd-check.

Deletion-test: verwijder `buildEdiFactuurInput` en het handmatige pad bouwt een ander (armer)
INVOIC; verwijder de resolve uit één pad en hij duikt op in het andere. De "factuurregel-
presentatie"-kennis is verspreid, niet geconcentreerd — de signatuur van een ontbrekende deep
module. Het is het facturatie-analoog van het verzend-domein, waar label én pakbon al uit één
`bouwVerzenddocument` komen.

## Besluit

1. **Eén gedeelde [[Artikelpresentatie]]-resolver** `_shared/facturatie/artikel-presentatie.ts`
   draagt het oplossen van `artikelnr → { karpi_code, klant_artikel, gtin, gewicht, omschrijving }`.
   Pure transform `resolveArtikelPresentatie(rows)` + IO-helper `fetchArtikelPresentatie(supabase,
   debiteur_nr, artikelnrs)` (ADR-0033-split). Voedt zowel het Factuurdocument als de
   orderbevestiging → dezelfde artikeltekst op order­bevestiging én factuur, op papier én EDI.

2. **Eén `FactuurDocument`** (`_shared/facturatie/factuur-document.ts`): `fetchFactuurDocument(
   supabase, factuurId) → FactuurDocument` haalt factuur + `factuur_regels` + de gekoppelde
   orders/partijen op en lost de Artikelpresentatie + BTW-verlegging (via `btw.ts`) één keer op.
   `FactuurDocumentRegel` is de canonieke regel-shape (unie van wat PDF + EDI nodig hebben) en
   vervangt `FactuurPDFRegel` ∪ `FactuurEdiRegel` ∪ de inline `buildEdiFactuurInput`-regels.

3. **Drie dunne pure renderers** consumeren het document:
   - `naarFactuurPdfInput(doc) → FactuurPDFInput` (PDF toont voortaan de opgeloste
     Artikelpresentatie i.p.v. de rauwe omschrijving — bewuste gedragswijziging, zie consequenties);
   - `naarInvoiceInput(doc) → KarpiInvoiceInput` — **vervangt zowel `buildEdiFactuurInput`
     als `mapFactuurNaarInvoiceInput`**. `factuur-verzenden` en `bouw-factuur-edi` worden dunne
     schillen op dezelfde transform → gegarandeerd identiek INVOIC, ongeacht het pad.

4. **De orderbevestiging deelt alléén de resolver, houdt een eigen document.** Het is een ander
   lifecycle-moment (order-tijd, leest `order_regels`, er is nog geen factuur). Het deelt de
   Artikelpresentatie-resolve en de `btw.ts`-seam, maar de document-expansie blijft gescheiden.
   Dit is de smalste correcte grens — geen geforceerde abstractie over twee bronnen.

5. **Golden fixture als vangnet.** Eén fixture pint "deze factuur → deze PDF-regels én deze
   INVOIC-lines" (patroon `bundel-sleutel.contract` / `normaliseer-land.contract`), zodat de
   twee EDI-paden nooit meer kunnen divergeren.

## Bewust buiten scope

- **De factuur-generatie zelf** (`genereer_factuur_voor_bundel`, korting-opbouw, drempel) — dat
  bepaalt wélke regels op de factuur staan en met welk bedrag; dit ADR raakt alleen hoe die regels
  naar buiten gerenderd worden.
- **De verzendkosten-drempel-logica** (frontend `applyShippingLogic` vs SQL `verzendkosten_voor_bundel`)
  — aparte friction (#3 uit de review), eigen traject.
- **De dode legacy-dispatch in `factuur-verzenden`** (`type='wekelijks'`/`per_zending`-takken naar
  gedropte RPC's) — losse opruiming, niet vermengd met deze gedrags-gevoelige consolidatie.
- **De factuur-PDF lay-out** (kolommen, pagina-overflow) — ongewijzigd; alleen de regel-*inhoud*
  (artikeltekst) verandert.

## Consequenties

- **Eén bron-van-waarheid** voor de factuurregel-presentatie; PDF en beide EDI-paden tonen
  identieke artikeltekst/-nummers. De divergentie-bug is categorisch weg.
- **Bewuste gedragswijziging op de PDF:** de factuur-PDF toont voortaan de opgeloste
  Artikelpresentatie (incl. `karpi_code`) i.p.v. de rauwe `factuur_regels.omschrijving`. Dit is
  de gevraagde consistentie (besluit grilling 2026-06-14), maar verandert de zichtbare PDF-tekst —
  golden-snapshot + visuele check vóór deploy.
- **Backend-only.** Factuur-PDF's en INVOIC renderen server-side (Deno edge); geen frontend-
  rendering, dus geen cross-root-shim nodig (eenvoudiger dan het verzend-geval).
- **Testbaarheid:** de resolver en de drie renderers zijn pure functies, los te unit-testen;
  `factuur-bedrag.test.ts` + `btw.test.ts` blijven. De edge functions worden dunne schillen
  (fetch → transform → emit), waardoor de transform-logica voor het eerst zonder DB testbaar is.
- **Migratie incrementeel, vangnet eerst:** golden-snapshot van de huidige `buildEdiFactuurInput`-
  output (het rijke = canonieke doel) vóór de collapse, zodat het automatische pad gedragsneutraal
  blijft en het handmatige pad bewust naar dat contract opgetrokken wordt.
- **Documenten:** `architectuur.md` (module-graf + facturatie-flow), `data-woordenboek.md`
  (Factuurdocument, Artikelpresentatie), `changelog.md`. CONTEXT.md-termen staan al (commit ec39241).
