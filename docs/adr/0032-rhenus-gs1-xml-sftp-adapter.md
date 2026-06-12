# ADR-0032: Rhenus-koppeling via GS1 TransportInstruction-XML over SFTP (niet Transus-EDI)

Datum: 2026-06-12
Status: Geaccepteerd

## Context

Mig 170 zaaide Rhenus als `edi_partner_a` (type `'edi'`) in de aanname dat
transportorders via Transus zouden lopen; ADR-0031 herhaalde die aanname nog
("de 'edi'-tak blijft voor evt. toekomstige échte EDI-vervoerders (Rhenus)").
Mails Rhenus → Piet-Hein (12-06-2026) maken duidelijk dat het bestaande
legacy-kanaal gewoon doorloopt op het nieuwe platform: GS1
TransportInstruction-XML (standaard "RHE", TypeVersion 3.1, zoals legacy
`RHE260521001.xml`) aangeleverd via SFTP (`sedi.de.rhenus.com`, /in-map).
Alle credentials zijn bekend. De Rhenus-cutover staat gepland voor week 24
2026 — deze week.

Uit dezelfde mailwisseling: een legacy-bericht met `totalPackageQuantity=0`
zónder `transportInstructionShipmentItem`-segmenten (entityIdentification
0455395) viel bij Rhenus in error — hun mapping verplicht ≥1 item-segment.

## Beslissing

1. Rhenus wordt de **derde vervoerder-adapter** naar het Verhoek-patroon
   (ADR-0031, mig 374-376): adapter-tabel `rhenus_transportorders`,
   cron-gedreven edge function `rhenus-send`, pure `xml-builder.ts`,
   preflight via de `vervoerder-eisen`-seam, audit via `externe_payloads`
   (kanaal `'rhenus'`) + XML-kopie in storage (`rhenus-xml/`), dry-run-default
   via `RHENUS_DRY_RUN`.
2. Nieuwe vervoerder-rij `rhenus_sftp` (type `'sftp'`, `actief=FALSE` tot de
   rondreis-test slaagt). De placeholder `edi_partner_a` verdwijnt, maar de
   **live selectie-regels worden eerst omgehangen** (`edi_partner_a` →
   `rhenus_sftp`): de FK cascadeert bij delete en de regels (DE ≤30 kg,
   kleinste zijde ≥131 + debiteur-pins) zijn productie-data die de week
   24-cutover dragen. Mig 374 is om dezelfde reden geamendeerd voor
   `edi_partner_b` → `verhoek_sftp` (regels 7/8 bestonden nog niet toen
   ADR-0031 geschreven werd).
3. **1 zending = 1 XML-bestand** met één `<transportInstruction>`
   (`RHE_<timestamp>_<zending_nr>.xml`). `entityIdentification` =
   `zending_nr`; `<sscc>` = label-barcode (AI(00)+SSCC, 20 cijfers,
   config-vlag); `Weight`/`totalGrossWeight` in **kg met decimalen** (géén
   decagram — dat is Verhoek); `depth` = lengte in cm.
4. **≥1 colli is een harde poort** (incident 0455395): `valideerRhenusColli`
   weigert lege zendingen en ontbrekende sscc/gewicht/lengte → rij op `Fout`
   mét reden, géén upload (kansloze-poging-principe, ADR-0030).
5. De generieke SFTP-upload verhuist van `verhoek-send/sftp-client.ts` naar
   `_shared/sftp-client.ts` — pure verplaatsing, beide adapters importeren
   hem. De orchestrator-loop wordt opnieuw **gespiegeld, niet geabstraheerd**:
   ADR-0031 markeerde de derde vervoerder als generalisatie-moment, maar
   midden in de cutover-week is een drie-adapter-refactor risico zonder
   directe winst. Expliciet backlog-item.

## Gevolgen

- Go-live = secrets zetten + rondreis + `actief=TRUE`; de bestaande
  selectie-regels routeren DE-zendingen dan direct via Rhenus. Geen
  resolver- of code-wijziging nodig bij de cutover.
- `vervoerders.type='edi'` heeft geen kandidaten meer; de tak in de
  dispatch-RPC blijft bestaan voor evt. toekomstige échte EDI-carriers.
- Statusterugkoppeling via Rhenus' /out-map: V2-backlog.
- Apply-volgorde: mig 374 (geamendeerd!) t/m 380 vanaf déze branch — niet de
  oude mig 374-versie van de Verhoek-branch gebruiken.

Plan: docs/superpowers/plans/2026-06-12-rhenus-transporteur-gs1-xml-sftp.md
