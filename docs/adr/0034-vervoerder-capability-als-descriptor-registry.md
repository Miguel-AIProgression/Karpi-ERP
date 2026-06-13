# ADR-0034: Vervoerder-capability als één descriptor-registry

**Status:** Geaccepteerd (2026-06-13)

## Context

ADR-0008 (mig 208–210) en ADR-0030 (mig 336) maakten de vervoerder-**keuze**
data-driven: welke vervoerder een zending krijgt, komt uit
`vervoerder_selectie_regels` + de `override → regel → geen`-resolver. Die as is
goed.

Maar de **eisen en eigenschappen** van elke vervoerder — landbereik, verplichte
preflight-velden, default-afmetingen, protocoltak, batch-limiet — stonden
hardcoded en verspreid over minstens zes plekken:

- `_shared/vervoerder-eisen.ts`: `HST_LANDEN_BEREIK=['NL']` (alléén HST), de
  carrier-code-array `['hst_api','verhoek_sftp','rhenus_sftp']` **2×**, en
  per-carrier `if`-takken voor telefoon/adres/land.
- `hst-send/payload-builder.ts`: `DEFAULT_LENGTH/WIDTH/HEIGHT/WEIGHT` (120/80/20/1),
  alléén HST (Verhoek/Rhenus eisen echte dims).
- `verhoek-send` + `rhenus-send` `xml-builder.ts`: `valideerVerhoekColli` vs.
  `valideerRhenusColli` — bijna identiek, subtiel verschillend (breedte verplicht
  bij Verhoek, niet bij Rhenus; 0-colli-guard alleen Rhenus).
- `index.ts` × 3: `MAX_PER_RUN=25` hardcoded.

Er zijn nu drie adapters (HST, Verhoek, Rhenus); een vierde raakte 4–5 bestanden
zonder dat er één plek was waar "wat kan/eist deze vervoerder" leesbaar staat.
Deletion-test: verwijder je `HST_LANDEN_BEREIK` + de carrier-arrays, dan duikt de
land-/eisen-complexiteit weer op bij elke send-functie. De logica concentreert
rond één begrip — de capabilities van een vervoerder — maar had geen huis. Dat is
de signatuur van een ontbrekende deep module.

## Besluit

1. **Eén pure descriptor-registry** `_shared/vervoerders/capabilities.ts` draagt de
   declaratieve capability-as: per carrier-code een `VerzendCapability` met
   `protocol`, `landbereik`, `preflight`-eisen (telefoon/land-check/adresvelden/
   colli + verplichte colli-velden), `defaultAfmetingen` (of `null` = geen default
   toegestaan) en `maxPerRun`.
2. **Consumers lezen de descriptor, dragen geen eigen `if code === `-takken meer.**
   `valideerVoorVervoerder` (preflight) bouwt zijn problemen declaratief uit
   `capability.preflight`; `valideerColli` leest `preflight.colliVelden` +
   `vereistColli`; de payload-builder en orchestrators lezen `defaultAfmetingen`
   resp. `maxPerRun`.
3. **De registry blijft puur** (geen DB, geen secrets), zodat de frontend hem via
   de bestaande re-export-shim deelt (ADR-0033). De `vervoerders`-tabel (mig 170)
   blijft de administratieve bron (`actief`, `display_naam`, routering-FK); de
   descriptor draagt het gedrag. Consistentie wordt geborgd via een golden-file
   contracttest (patroon `bundel-sleutel.contract` / `normaliseer-land.contract`).
4. **Een vierde vervoerder = één registry-rij + één format-adapter** (+ routering
   als data + golden-fixture-rij), niet een sweep over preflight/defaults/colli.

## Bewust buiten scope

- **De keuze-as** (`vervoerder_selectie_regels`, resolver) — al data-driven.
- **De format-builders zelf** (`bouwTransportOrderPayload`/`bouwVerhoekXml`/
  `bouwRhenusXml`) en de adres-split-verschillen — echte protocolverschillen
  (REST/JSON vs. AA2.0-XML vs. GS1-XML; decagram vs. kg; 4/2/1-veld-adres),
  by-design zoals analoog F in de SSCC-audit. Eén descriptor maakt die niet
  uniform en moet dat ook niet.
- **De orchestrator-loop-skeletten** (`verwerkRow`: claim → fetch → preflight →
  build → upload → audit → markeer) zijn óók gedupliceerd — aparte "process-as"-
  seam, sibling-kandidaat, niet in dit traject.
- **De werkelijke colli-afmetingen-bron** (SSCC-audit analoog C) en de
  **gewicht-databron** (analoog A2): dit ADR verhuist alleen default-*getallen* en
  *eisen*, niet de vraag welke bron canoniek is voor het echte gewicht/de maat.

## Consequenties

- De capability-as is op één plek leesbaar en direct testbaar i.p.v. via drie
  send-paden.
- De pure-seam-eigenschap blijft bewaakt door de frontend-build (een DB-import in
  de registry breekt `npm run typecheck`, zoals gewenst — ADR-0033).
- Slice 3 is gedragsgevoelig: de Verhoek/Rhenus colli-validaties verschillen écht;
  golden-snapshot vóór de refactor borgt dat geen eis stilletjes verzwakt/verscherpt.
- `vervoerders.type` ('api'/'edi') is sinds Verhoek/Rhenus mislabeld (SFTP ≠ EDI);
  een `protocol`-veld op de descriptor maakt de protocoltak leesbaar. Een
  SQL-kolom-correctie is optioneel en achter een eigen migratie (raakt mogelijk
  bestaande `type`-filters).
