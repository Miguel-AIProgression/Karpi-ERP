# Verzendlabel als één deep module (consolideer compact/staand/DPD)

**Datum:** 2026-06-18
**Branch:** `refactor/verzendlabel-een-module` (worktree `.worktrees/verzendlabel-een-module`, basis main `bb20e2f`)
**Skill-aanleiding:** `/improve-codebase-architecture` — kandidaat 1 (HST als basis).

## Aanleiding

HST- en Rhenus-labels zien er verschillend uit op dezelfde printer (ZDesigner
ZT231). Diagnose: het labelformaat is per vervoerder data
(`vervoerders.label_breedte_mm/_hoogte_mm`, gelezen door
[`labelFormaatVoor`](../../../frontend/src/modules/logistiek/lib/printset.ts)).
HST staat op **152,4 × 76,2** (mig 362); Rhenus/Verhoek hebben géén formaat-rij →
terugval op de kleine legacy-default **76,2 × 50,8**. Daardoor schaalt Rhenus
anders, oogt krapper en kapt de vaste-breedte badge "Rhenus" af tot "Rhe…".

Architectuur eronder: er zijn **drie shallow renderers** —
[`shipping-label.tsx`](../../../frontend/src/modules/logistiek/components/shipping-label.tsx)
(compact, liggend), `shipping-label-tall.tsx` (staand), `dpd-shipping-label.tsx`
(80×150, Tailwind). Elk herhaalt dezelfde data-proloog (`labelProductRegels`,
`klanteigenReferentie`, `labelBarcode`, `labelReferentie`, `labelDatumKort`, +
`hstDepot`) en dezelfde conceptuele zones (afzender, order/product, adres-kader,
vervoerder-badge, colli-telling, barcode, referentie-voet). Het frontend-register
([`registry.ts`](../../../frontend/src/modules/logistiek/registry.ts)) kent maar
drie vervoerders — HST (`api`), Rhenus (`sftp`), Verhoek (`sftp`). **Geen** actieve
`'print'`-vervoerder (→ DPD dormant) en **geen** staande vervoerder (→ Tall
dormant). Alle drie live carriers renderen vandaag via `ShippingLabelCompact`.

## Beslissingen (vastgelegd met gebruiker, grilling 2026-06-18)

- **A. Eén layout.** De HST-liggende compact-layout wordt de enige
  `Verzendlabel`-vorm. `shipping-label-tall.tsx` en `dpd-shipping-label.tsx` +
  de `isPrintType`-tak worden verwijderd. Toekomstige DPD/staande rol =
  re-introduceer dán een echte tweede adapter (twee adapters = echte seam).
- **B. HST als basis = ook formaat.** De frontend-default wordt **152,4 × 76,2**
  i.p.v. 76,2 × 50,8. De `vervoerders.label_*_mm`-kolom blijft als override-seam;
  HST staat al expliciet op die maat. Rhenus/Verhoek (NULL) erven het grote label
  automatisch — de bug-klasse "vergeten formaat-rij" verdwijnt.
- **Depot blijft één gelokaliseerde `vervoerder_code === 'hst_api'`-check** binnen
  het ene component (geen descriptor-registry nu; pas bij een tweede vervoerder
  met depot-concept). Badge-tekst is al data via `display_naam`.

## Doel-architectuur

Eén `ShippingLabel`-component dat de canonieke zone-layout rendert; de pure
data-afleiding ([`shipping-label-data.ts`](../../../frontend/src/modules/logistiek/lib/shipping-label-data.ts),
[`labelbarcode.ts`](../../../frontend/src/lib/logistiek/labelbarcode.ts)) blijft
ongewijzigd (was al goed gedeeld). De printset-pagina's renderen `<ShippingLabel>`
zonder layout-keuze. Concept in CONTEXT.md: **Verzendlabel** (toegevoegd).

## Slices

### Slice 1 — Default-formaat → 152,4 × 76,2
- [`printset.ts`](../../../frontend/src/modules/logistiek/lib/printset.ts):
  `DEFAULT_LABEL_BREEDTE_MM = 152.4`, `DEFAULT_LABEL_HOOGTE_MM = 76.2`. Comment
  bijwerken (niet meer "ZD420 3"×2"" maar "ZT231 3"×6" liggend; HST-maat als
  basis, kolom blijft override").
- **Effect:** Rhenus/Verhoek renderen direct op de grote liggende maat → "Rhe…"
  verdwijnt. Dit is op zichzelf de zichtbare fix; rest is consolidatie.
- Verifieer `printset.test.ts` (default-afhankelijkheden) blijft groen.

### Slice 2 — Eén layout: Tall weg, compact wordt de canonieke `ShippingLabel`
- In `shipping-label.tsx`: verwijder de `hoogteMm > breedteMm`-tak die naar
  `ShippingLabelTall` delegeert. `ShippingLabel` = direct de (huidige)
  `ShippingLabelCompact`-render. Inline `ShippingLabelCompact` terug tot
  `ShippingLabel` (één functie), of houd de helper maar verwijder de switch.
- Verwijder `shipping-label-tall.tsx`.
- `hstDepot`-check blijft één plek (nu alleen nog in `shipping-label.tsx`).
- `ShippingLabelProps`: `labelFormaat` blijft (formaat-override-seam); geen
  `serviceCode` (was nooit hier).
- Typecheck.

### Slice 3 — DPD weg: één render-pad in beide printset-pagina's
- Verwijder `dpd-shipping-label.tsx`.
- [`zending-printset.tsx`](../../../frontend/src/modules/logistiek/pages/zending-printset.tsx)
  en [`bulk-printset.tsx`](../../../frontend/src/modules/logistiek/pages/bulk-printset.tsx):
  vervang `labels.map(l => isPrintType ? <Dpd…> : <ShippingLabel…>)` door alleen
  `<ShippingLabel…>`. Verwijder `isPrintType`, de `DpdShippingLabel`-import en de
  `serviceCode={zending.service_code}`-prop-wiring.
- `service_code`/`type==='print'` blijven in het datamodel/vervoerder-CRUD bestaan
  (niet opruimen — out of scope), maar worden niet meer door de label-render
  geraakt. Korte comment waarom DPD-render verwijderd is (geen actieve
  `'print'`-vervoerder; her-introduceren = nieuwe adapter).
- Typecheck + `npm run build` (dode imports vangen).

### Slice 4 — Render-karakterisering (de winst: vandaag nul visuele tests)
- Nieuw `shipping-label.test.tsx` in stijl van
  [`pakbon-document.test.tsx`](../../../frontend/src/modules/logistiek/components/pakbon-document.test.tsx)
  (render → DOM-asserts). Scenario's:
  1. **HST**: `vervoerder_code='hst_api'`, NL-postcode → toont "Depot N"
     (depot-lookup), badge = "HST" volledig.
  2. **Rhenus**: `vervoerder_code='rhenus_sftp'` → géén "Depot"-tekst, badge =
     "Rhenus" volledig (niet afgekapt — assert volledige tekst aanwezig in DOM).
  3. **Barcode**: `sscc` gezet → barcode-waarde = `labelBarcode(sscc)`;
     `sscc=null` → "Geen colli-barcode geregistreerd".
  4. Zones aanwezig: order_nr, afleveradres, "X VAN Y", referentie + datum.
- `printset.test.ts` / `shipping-label-data.test.ts` ongewijzigd groen.

### Slice 5 — Docs
- CONTEXT.md: **Verzendlabel**-concept + Labelbarcode-parenthetical (gedaan op de
  branch).
- `docs/changelog.md`: entry (datum + wat + waarom).
- Eventueel `docs/architectuur.md` als daar de label-varianten genoemd staan
  (checken).

## Verificatie (vóór merge)
- `cd frontend && npm run typecheck` schoon.
- `npm run test -- shipping-label printset pakbon` (vitest) groen.
- `npm run build` schoon (geen dode imports).
- **PRINT-GATE:** gebruiker print-test HST + Rhenus naast elkaar op de ZT231 →
  bevestigt "vrijwel identiek, alleen HST heeft depot". Claude kan print niet
  zelf verifiëren. Pas dán merge naar main.

## Risico's / let op
- `service_code` + `type='print'` blijven als (nu ongebruikt door render)
  datamodel-restant. Bewust niet opruimen in deze refactor (scope-grens).
- Geen DB-migratie nodig (default zit in frontend; HST-rij staat al goed).
- Pure frontend → geen edge-function-deploy.
- Worktree mist `.env`/node_modules niet voor typecheck/vitest? → `npm ci` in
  worktree indien nodig.
