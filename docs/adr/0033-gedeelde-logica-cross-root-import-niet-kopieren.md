# ADR-0033: Gedeelde pure logica wordt cross-root geïmporteerd, niet gekopieerd

**Status:** Geaccepteerd (2026-06-12)

## Context

Het "seam-patroon" (één pure module aan beide kanten van de Deno↔Vite-grens,
handmatig synchroon gehouden) was uitgegroeid tot vier kopieparen:
`vervoerder-eisen.ts`, `iso-week.ts`, `snijplan-status.ts` en
`email-list.ts`↔`email-recipients.ts`. De aanname "Deno-edge-modules zijn niet
door Vite importeerbaar" gold alleen voor modules met https-imports of
Deno-API's — voor pure modules niet. De repo bewees dat zelf al:
`order-lifecycle/derive-status.ts` heeft géén kopie en wordt door
frontend-contracttests rechtstreeks cross-root geïmporteerd.

Handmatige kopieën zijn dezelfde incident-klasse als het SSCC-incident van
12-06-2026 (twee generatoren voor hetzelfde gegeven → divergentie →
"geen data" op het depot): één kant aanpassen zonder de spiegel is stil
gedrag-verschil tussen UI en edge. `snijplan-status` was al gedivergeerd
(frontend-superset).

## Besluit

1. **`supabase/functions/_shared/` is de single source** voor TS-logica die
   edge én frontend delen. Andersom kan niet: Deno-deploy bundelt relatieve
   imports en kan niet betrouwbaar uit `frontend/src/` lezen.
2. **Alleen pure modules** komen in aanmerking: geen Deno-API's, geen
   https-imports, geen DB/secrets. Niet-pure logica houdt aparte modules per
   runtime (zoals `debiteur-matcher.ts` ↔ `product-matcher.ts`).
3. **De frontend importeert/re-exporteert cross-root.** Bestaande
   frontend-paden blijven als dunne shim bestaan (`export * from
   '../../../../supabase/functions/_shared/<module>'`), eventueel aangevuld met
   frontend-only functies (bv. `lokaleDatumAlsUtc` in `iso-week`).
4. **Nieuwe gedeelde logica wordt nooit gekopieerd.** Kan een module niet puur
   gemaakt worden, dan is een equivalentie-contracttest op gedeelde fixtures
   (golden-file, zoals `derive-status.golden.json`) het vangnet.
5. Vite dev-server: `server.fs.allow: ['..']` in `frontend/vite.config.ts`
   maakt het serveren van `_shared`-bestanden buiten `frontend/` mogelijk.

## Consequenties

- Divergentie tussen UI en edge is voor deze modules categorisch onmogelijk
  (deletion-test: de frontend-bestanden zijn pass-through zonder eigen logica).
- Frontend-`npm run typecheck` checkt voortaan ook de geïmporteerde
  `_shared`-modules onder de strenge frontend-compileropties.
- De Vitest-contracttests (o.a. `status-enums.contract.test.ts`) toetsen nu
  direct de bron die de edge functions gebruiken.
- `_shared`-modules die frontend-geïmporteerd worden, moeten puur blijven —
  een Deno-import toevoegen breekt de frontend-build (dat is gewenst: de
  build bewaakt de puurheid).
- Buiten scope gelaten: `werkagenda.ts` ↔ `bereken-agenda.ts` (gedocumenteerd
  gedragsverschil, apart traject als consolidatie daar gewenst is).
