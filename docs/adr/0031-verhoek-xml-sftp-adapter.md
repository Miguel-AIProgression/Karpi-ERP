# ADR-0031: Verhoek-koppeling via eigen AA2.0-XML over SFTP (niet Transus-EDI)

Datum: 2026-06-11
Status: Geaccepteerd

## Context

Mig 170 zaaide Verhoek als `edi_partner_b` (type `'edi'`) in de aanname dat
verzendberichten naar Verhoek via Transus zouden lopen. Mail Gerrit Altena
(Verhoek, juni 2026): hun voorkeursmethode is hun eigen XML-formaat
"XMLstandardVerhoekEuropeAA20" (AA2.0) aangeleverd via SFTP. Wij leveren hun
formaat 1-op-1 aan op hun server; Verhoek vertaalt niets.

## Beslissing

1. Verhoek wordt een **eigen adapter** naar het HST-patroon (mig 171-173):
   adapter-tabel `verhoek_transportorders`, cron-gedreven edge function
   `verhoek-send`, pure `xml-builder.ts`, preflight via de
   `vervoerder-eisen`-seam, audit via `externe_payloads` (kanaal `'verhoek'`)
   + XML-kopie in storage. Maximaal hergebruik: `splitAdres`/`normalizeCountry`
   verhuizen naar `_shared/adres-split.ts`; switch-RPC krijgt een
   `WHEN 'sftp'`-tak; cron hergebruikt het vault-secret `cron_token`.
2. Nieuwe vervoerder-rij `verhoek_sftp` met nieuw type `'sftp'`; de
   placeholder `edi_partner_b` wordt guarded verwijderd.
3. **Twee-fasen-uitrol**: alle Verhoek-onbekenden (opdrachtgevernummer,
   ScanCode-prefix, Levering/SoortLevering-codes, Verpakkingseenheid) leven in
   `app_config` sleutel `'verhoek'` (per run gelezen); SFTP-credentials +
   `VERHOEK_DRY_RUN` als secrets. Fase 1 deployt de hele keten met
   `VERHOEK_DRY_RUN=true` (geen upload, wél XML/audit/storage); go-live =
   secrets + config-UPDATE + `actief=TRUE` — gén redeploy.
4. **1 zending = 1 XML-bestand** (`Karpi_<timestamp>_<zending_nr>.xml`).
   `Referentie` = `zending_nr`, `ScanCode` = label-barcode (`'00'+SSCC`,
   prefix configureerbaar), `Gewicht` in decagram, `Lengte`/`Breedte` in hele
   cm — verplicht per Verhoek; ontbreken ⇒ rij op Fout mét reden, gén upload.
5. SFTP vanuit de edge runtime wordt vooraf bewezen met een spike tegen een
   publieke test-SFTP-server (geen Verhoek-credentials nodig). Faalt de
   runtime ⇒ fallback: n8n-SFTP-workflow of Python-worker leegt dezelfde
   wachtrij; alleen `sftp-client.ts`/de upload-stap verschuift.

## Gevolgen

- `vervoerders.type` krijgt waarde `'sftp'`; de `'edi'`-tak blijft voor evt.
  toekomstige échte EDI-vervoerders (Rhenus).
- hst-send importeert `splitAdres` voortaan uit `_shared` (gedrag identiek;
  gaat mee bij de eerstvolgende hst-deploy).
- Derde vervoerder = moment om de orchestrator-loop te generaliseren — nu
  bewust gespiegeld, niet geabstraheerd (HST is live en stabiel).
- Statusterugkoppeling van Verhoek: V2-backlog.
