# Pakbondocument als één bron — consolidatie van de twee pakbon-modules

**Datum:** 2026-06-19
**Branch:** `refactor/pakbondocument-een-bron`
**Domein:** zie CONTEXT.md → **Pakbondocument** (nieuw begrip), **Zending-colli**, **Artikelpresentatie**, **Factuurdocument** (ADR-0036, het patroon dat dit één domein verder spiegelt)

## Probleem

De pakbon leeft in twee parallelle afleidingen die dezelfde presentatie-beslissingen
onafhankelijk maken:

1. **React-pakbon** — `frontend/src/modules/logistiek/components/pakbon-document.tsx`
   (geprint). Leidt land-naam, adresblokken, referentie, bundel-groepering,
   "Uw naam", routecode en OMB inline in JSX af, bovenop `bouwVerzenddocument().pakbonRegels`
   (`printset.ts`) + `productNamen`/`klantNaamWijktAf` (`shipping-label-data.ts`).
2. **Server-PDF-pakbon** — `supabase/functions/_shared/pakbon/` (factuurmail-bijlage).
   Leidt dezelfde beslissingen af in `bouwPakbonDocument` → canoniek `PakbonDocument`,
   bovenop een **kopie** van de aggregatie (`bouwPakbonRegels`) + een kopie van
   `productNamen` + `LAND_NAMEN`.

De "single source"-comment in `aggregatie.ts` verwijst naar een Slice 2 die nooit
gebeurde. De spiegel staat los en is al gedrift:

| Beslissing | React (geprint) | Server-PDF (factuurmail) |
|---|---|---|
| Routecode | `hstDepotVoorPostcode(...)`, alléén HST | `debiteuren.route` (legacy, fout — "RHE10" op Rhenus-pakbon) |
| OMB / omsticker (mig 436) | `OMB: …`-subregel | ontbreekt (geen veld) |
| "Uw naam" | `klantNaamWijktAf(...)` | simpele `karpiNaam !== klantNaam` |
| Referentie | `externReferentie(klant_referentie)` | rauwe `klant_referentie` |

**Deletion-test:** verwijder óf de server-`bouwPakbonDocument` óf de React-inline-afleiding
→ dezelfde complexiteit verschijnt op de andere plek. Redundant, niet pass-through.

## Doel-architectuur

**Seam:** `bouwPakbonDocument(zending, { kolli, routecode? }) → PakbonDocument` in
`_shared/pakbon` wordt de **enige** pakbon-afleiding. Twee dunne renderers:
- `genereerPakbonPDF(doc, bedrijf, logo)` — factuurmail-PDF (bestaat al)
- React-`PakbonDocument` — geprint (wordt dunne renderer i.p.v. eigen afleiding)

De input-types (`PakbonZendingInput`) zijn al **structureel compatibel** met de
frontend `ZendingPrintSet` (types.ts-comment) → de React-page geeft zijn bestaande
object door, geen tweede fetch-shape.

### Twee vastgelegde keuzes (grilling 2026-06-19)

1. **Routecode = geïnjecteerde render-context**, geen document-veld. Print-only
   (magazijn-sortering), dus de React-renderer berekent `hstDepotVoorPostcode` en
   geeft 'm mee; de factuurmail-PDF geeft niets → geen routecode op de klant-PDF.
   `hst-depot.ts` blijft frontend-only (respecteert eigen "geen edge"-comment).
   `debiteuren.route` wordt uit server-fetch + builder geschrapt (was de bug).
2. **Aggregatie-scope = alleen pakbon-aggregatie delen.** `bouwVerzenddocument().pakbonRegels`
   delegeert naar de gedeelde `_shared/pakbon`-aggregatie; `colliRijen`/label-expansie
   blijft frontend (één renderer = geen seam — niet speculatief naar `_shared` trekken).

## Slices (verticaal)

### Slice 1 — onderlaag consolideren (geen gedragswijziging)
`_shared/pakbon` wordt de enige bron van de pakbon-aggregatie + naam-helpers.

- `_shared/pakbon/aggregatie.ts`:
  - voeg `klantNaamWijktAf(hoofdNaam, klantNaam, artikelnr)` toe (puur, uit `shipping-label-data.ts`).
  - `bouwPakbonRegels` levert `omstickerCodes: string[]` per regel (uniek over de colli van de regel).
- `_shared/pakbon/types.ts`:
  - `PakbonColliInput` krijgt `omsticker_snapshot: string | null`.
  - `PakbonRegel` krijgt `omstickerCodes: string[]`.
- `_shared/pakbon/fetch.ts`: `zending_colli`-SELECT krijgt `omsticker_snapshot`.
- frontend `shipping-label-data.ts`: `productNamen`, `klantNaamWijktAf`, `OmschrijvingSnapshot`,
  `RegelNamen` worden **cross-root re-exports** uit `_shared/pakbon/aggregatie.ts`
  (ADR-0033, zoals al voor `kwaliteitNaamUitVervolg`) i.p.v. lokale definities.
- frontend `printset.ts`: `bouwVerzenddocument` delegeert zijn `pakbonRegels`-tak naar
  het gedeelde `bouwPakbonRegels`; `PakbonRegel` wordt re-export van de shared type.
  `colliRijen`-expansie blijft ongewijzigd.

**Succescriterium:** `npm run build` (tsc -b, óók de testprojecten — zie
reference-memory) groen; `aggregatie.test.ts` + `pakbon-document.test.tsx`
byte-identiek groen. Géén outputwijziging.

### Slice 2 — React als dunne renderer (lost de drifts op)
- React `PakbonDocument` leest `bouwPakbonDocument(zending, { kolli, routecode })`
  i.p.v. zelf af te leiden; JSX rendert alleen nog `PakbonDocument`-velden.
- Routecode injecteren: de page berekent `hstDepotVoorPostcode` (HST-only) en geeft
  'm als prop/arg mee. `bouwPakbonDocument` krijgt `routecode?` in de opties.
- `PakbonRegelDisplay` + PDF-renderer (`pakbon-pdf.ts`) krijgen de OMB-subregel.
- "Uw naam" in de builder via `klantNaamWijktAf`; referentie via `externReferentie`
  (woont al in `_shared/referentie.ts`).
- **Golden fixture** `bouwPakbonDocument` → `PakbonDocument` pint beide renderers
  (à la ADR-0036 `KarpiInvoiceInput`). React render-karakterisering blijft als
  vangnet, verdunt daarna.

**⚠️ Bewuste outputwijziging factuurmail-PDF:** krijgt OMB, verliest de foute
legacy-routecode, andere "Uw naam"-onderdrukking. Visuele check bij 1e echte
verzending. `factuur-verzenden` opnieuw deployen (deelt `_shared/pakbon`).

### Slice 3 — opruimen
- `debiteuren.route` uit `PAKBON_SELECT` (`fetch.ts`) en uit `bouwPakbonDocument` /
  `PakbonZendingInput.orders.debiteuren`.
- dubbele `LAND_NAMEN` (één bron in `_shared/pakbon`).

## Tests / vangnet
- Slice 1: bestaande `aggregatie.test.ts` (uitgebreid met omsticker) + `pakbon-document.test.tsx`
  blijven byte-identiek groen.
- Slice 2: golden `pakbon-document.golden.json` (zending → PakbonDocument).
- `npm run build` vóór elke commit (Vercel = `tsc -b`, mist niet de testprojecten).

## Deploy
- Pure TS tot slice 2. `factuur-verzenden` herdeployen na slice 2/3 (deelt `_shared/pakbon`).
- Frontend via Vercel-git-integratie bij merge naar main.
