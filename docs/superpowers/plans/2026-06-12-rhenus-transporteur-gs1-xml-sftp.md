# Rhenus als transporteur (GS1 TransportInstruction-XML via SFTP) — Implementation Plan

**Goal:** Rhenus als derde vervoerder (na HST en Verhoek): per zending een GS1
TransportInstruction-XML (standaard "RHE", TypeVersion 3.1) genereren en via
SFTP afleveren op Rhenus' server. Anders dan bij Verhoek zijn **alle
SFTP-gegevens al bekend** (mail Rhenus → Piet-Hein, 12-06-2026), dus Fase 2 is
direct uitvoerbaar: secrets zetten + rondreis-test + `actief=TRUE`.

**Context (mails Rhenus, 12-06-2026):**
- SFTP: `sedi.de.rhenus.com`, poort 22, user `Karpi`, wachtwoord in aparte
  mail (12-06) — **NIET in de repo**, alleen als Supabase-secret.
- Bestanden afleveren in de **/in-map**; er is ook een **testmap** voor het
  testen van aanpassingen, en een /out-map (statusterugkoppeling, V2).
- **Incident `0455395`:** een legacy-bericht met `totalPackageQuantity=0` en
  géén `transportInstructionShipmentItem`-segmenten viel bij Rhenus in error —
  hun mapping verplicht ≥1 item-segment. Rhenus heeft het handmatig hersteld
  (geen heraanlevering nodig), maar onze keten moet dit **categorisch
  onmogelijk maken**: builder weigert 0 colli, orchestrator zet de rij op
  `Fout` met heldere reden.

**Architectuur:** identiek aan het Verhoek-patroon (ADR-0031, mig 374-376,
plan [2026-06-11-verhoek-transporteur-xml-sftp.md](2026-06-11-verhoek-transporteur-xml-sftp.md)):
eigen adapter-tabel `rhenus_transportorders`, cron-gedreven edge function
`rhenus-send` met pure `xml-builder.ts`, dispatch via de bestaande
`WHEN 'sftp'`-tak, dry-run-default, audit via `externe_payloads` (kanaal
`'rhenus'`) + XML-kopie in storage (`rhenus-xml/`). **Branch stapelt op
`feat/verhoek-transporteur`** (mig 374-376 + `_shared`-seams) met
`origin/main` erin gemerged (mig 377).

**Formaat-bron:** legacy-bestand `RHE260521001.xml` uit het oude systeem
(Windows Connect-tijdperk) — representatief excerpt vastgelegd in
[docs/rhenus/voorbeelden/](../../rhenus/voorbeelden/). De receiver-adressen
staan er als **één regel** (`streetAddressOne` = straat+nummer) → géén
adres-split nodig.

---

## Verschillen t.o.v. Verhoek (zelfde patroon, ander formaat)

| Aspect | Verhoek (AA2.0) | Rhenus (GS1 "RHE" 3.1) |
|---|---|---|
| XML-shape | Plat `<DATA><OrderEntry>` | SBDH-header + `<transportInstruction>` per zending |
| Adres | straat + huisnummer apart (`_shared/adres-split`) | `streetAddressOne` = volledige regel — geen split |
| Gewicht | decagram, per colli verplicht | **kg met decimalen** (`.68`, `145.44`), per colli + totaal |
| Afmetingen | Lengte+Breedte cm verplicht | `depth` (= lengte cm) per colli; `width` alleen bij pallets |
| Barcode | `ScanCode` (00-prefix configureerbaar) | `<sscc>` = 20 cijfers **mét** 00-prefix (zoals label en legacy) |
| Colli-aantal 0 | preflight-Fout (geen colli = geen ScanCode) | **harde eis Rhenus** (incident 0455395) — zelfde guard, expliciete test |
| T&T | `TrackTraceID` + OntvangerEmail | géén T&T-slot in het bericht (status via /out-map, V2) |
| Onbekenden | config-record (vragen open) | **alles bekend** — config-record alleen voor verpakkingscode/prefix-keuzes |

## Hergebruik (uit Verhoek-branch / HST)

| Bestaand | Voor Rhenus |
|---|---|
| `verhoek-send/sftp-client.ts` | **Verplaatst naar `_shared/sftp-client.ts`** (Taak 4) — generiek, beide adapters importeren hem |
| `enqueue_zending_naar_vervoerder` `WHEN 'sftp'`-tak (mig 375) | + `WHEN 'rhenus_sftp'`-case (mig 379) |
| `valideerVoorVervoerder`-seam + frontend-spiegel | + `rhenus_sftp`-tak: zelfde adres-eisen als Verhoek (Taak 7) |
| Queue/reaper/monitor-patroon (mig 375 ← 171/337/338) | Gespiegeld als `rhenus_transportorders` (mig 379) |
| Cron + vault-secret `cron_token` (mig 376 ← 173) | Nieuwe job `rhenus-send-elke-minuut` (mig 380) |
| `externe_payloads` + storage-bucket | kanaal `'rhenus'`, pad `rhenus-xml/` |
| `verhoek-sftp-spike` | Eigen mini-spike `rhenus-sftp-spike` (leest `RHENUS_SFTP_*`) — test tegen Rhenus' échte server/testmap |

Orchestrator-loop opnieuw gespiegeld, niet geabstraheerd. ADR-0031 zei "derde
vervoerder = moment om te generaliseren" — bewust **alleen de sftp-client**
gegeneraliseerd (pure verplaatsing, nul risico); de loop-generalisatie is
cutover-week-risico zonder directe winst en staat op de backlog.

## Live-DB-bevindingen (12-06, vóór dit plan gecheckt)

1. **Mig 374-376 zijn nog NIET geapplied** — `verhoek_sftp` bestaat nog niet
   in de live DB; `edi_partner_a`/`edi_partner_b` staan er nog (beide inactief).
2. **De live `vervoerder_selectie_regels` verwijzen naar de placeholders:**
   - id 1: DE, ≤30 kg, kleinste zijde ≥131 → `edi_partner_a` (Rhenus)
   - id 7/8: NL ≥27 kg / DE ≥30 kg, zijde ≥131 → `edi_partner_b` (Verhoek)
   - id 9/11: debiteur-pins (99001, 640505) → `edi_partner_a`
3. **Cascade-risico in mig 374 zoals hij op de Verhoek-branch stond:** de
   guarded `DELETE edi_partner_b` cascadeert naar selectie-regels → regels
   7/8 zouden bij apply stilletjes verdwijnen. **Fix in deze branch:** mig 374
   geamendeerd — regels eerst omhangen naar `verhoek_sftp`, dán pas delete.
   Mig 378 doet hetzelfde voor `edi_partner_a` → `rhenus_sftp`.
   ⚠️ **Apply mig 374 dus vanaf déze branch** (of na merge), niet vanaf de
   oude Verhoek-branch-versie.
4. Geen enkele `zendingen`- of `order_regels`-rij verwijst naar de
   placeholders — alleen de selectie-regels hangen eraan.

**Cutover-betekenis:** zodra `rhenus_sftp` op `actief=TRUE` gaat, routeren de
bestaande regels (id 1, 9, 11) DE-zendingen automatisch via Rhenus — dat ÍS de
week 24-cutover. Geen extra regel-werk nodig.

## Formaat-mapping (XML-element → bron)

Eén zending = één bestand met één `<transportInstruction>` (legacy batchte per
dag; één-per-zending houdt de queue idempotent en retries per zending).

| Element | Bron |
|---|---|
| SBDH `Sender/Identifier@Authority` | `'KARPI'` (constant) |
| SBDH `Receiver/Identifier@Authority` | `'RHENUS'` (constant) |
| SBDH `Standard` / `TypeVersion` | `'RHE'` / `'3.1'` (constant) |
| SBDH `InstanceIdentifier` | Karpi-GLN `8715954999998` (constant, zelfde als EDI) |
| SBDH `Type` | `'Transport Instruction Message'` |
| `CreationDateAndTime` / `creationDateTime` | now (ISO, ms, `Z`) |
| `transportInstructionIdentification/entityIdentification` | `zending_nr` |
| `transportInstructionFunction` | `'SHIPMENT'` |
| receiver `address` | `afl_naam`/`afl_plaats`/`afl_postcode`/landcode (`normalizeCountry`)/`afl_adres` (één regel) |
| receiver `contact/TelNumber` | `afl_telefoon` (lege tag indien onbekend) |
| shipper `address` | `app_config.bedrijfsgegevens` |
| carrier `additionalPartyIdentification` | `'Rhenus'` + `@...TypeCode="requested carrier"` |
| `totalGrossWeight` (KGM) | SUM(`zending_colli.gewicht_kg`), 2 decimalen |
| `totalPackageQuantity` / `packageTotal` | COUNT(colli) — **≥1 verplicht** |
| `plannedDelivery`/`plannedCollection` `date` | `verzenddatum ?? vandaag`, formaat `YYYY-MM-DDT` (legacy-conform, trailing `T`) |
| `transportReference/entityIdentification` | `zending_nr` |
| `transportReference/Freetext` | `Order {order_nr}` + ` Ref {orders.klant_referentie}` indien gevuld |
| item `lineItemNumber` | volgnummer binnen de zending (1..n) |
| item `logisticUnit/sscc` | `'00' + zending_colli.sscc` (config-vlag `sscc_met_00_prefix`) |
| item `Weight` | `gewicht_kg` (decimalen zoals opgeslagen) |
| item `packageTypeCode` | config `package_type_code` (default `'RLEN'`; legacy: RLEN/COLL/PLTS/HPLT) |
| item `dimension/depth` (CMS) | lengte: `order_regels.maatwerk_lengte_cm` → fallback `producten.lengte_cm` |

Validatie per zending (`valideerRhenusColli` + 0-colli-guard): ≥1 colli
(incident 0455395), per colli `sscc`, `gewicht_kg>0`, `lengte_cm>0`.
Breedte is bewust géén eis (rollen hebben in het legacy-formaat alleen depth).

## Config & secrets

`app_config` sleutel `'rhenus'` (mig 378, per run gelezen — wijziging = UPDATE,
geen redeploy): `sscc_met_00_prefix` (true), `package_type_code` ('RLEN'),
`bestandsnaam_prefix` ('RHE').

Bestandsnaam: `RHE_<yyyymmddHHmmss>_<zending_nr>.xml` (legacy gebruikte
`RHE<yymmdd><seq>.xml`; uniek-per-zending + timestamp is veiliger voor retries.
Mocht Rhenus aan de naamconventie hangen → alleen `bouwRhenusBestandsnaam`
aanpassen + vraag opnemen in de rondreis-mail).

Secrets: `RHENUS_SFTP_HOST` / `RHENUS_SFTP_PORT` / `RHENUS_SFTP_USER` /
`RHENUS_SFTP_PASSWORD` / `RHENUS_SFTP_REMOTE_DIR` (= `/in`, of de testmap
tijdens de rondreis) + `RHENUS_DRY_RUN` (default **true**).

## File-structuur

```
docs/adr/0032-rhenus-gs1-xml-sftp-adapter.md                ← nieuw (Taak 2)
docs/rhenus/voorbeelden/RHE260521001-excerpt.xml + README   ← nieuw (Taak 1)
supabase/migrations/374_vervoerder_verhoek_sftp.sql         ← AMENDEMENT (Taak 2: regels omhangen vóór delete)
supabase/migrations/378_vervoerder_rhenus_sftp.sql          ← nieuw (Taak 3)
supabase/migrations/379_rhenus_transportorders.sql          ← nieuw (Taak 6)
supabase/migrations/380_rhenus_send_cron.sql                ← nieuw (Taak 9)
supabase/functions/_shared/sftp-client.ts                   ← verplaatst uit verhoek-send (Taak 4)
supabase/functions/_shared/vervoerder-eisen.ts(.test.ts)    ← wijzigen (Taak 7)
frontend/src/lib/orders/vervoerder-eisen.ts                 ← wijzigen (Taak 7, spiegel)
supabase/functions/rhenus-send/types.ts                     ← nieuw (Taak 5)
supabase/functions/rhenus-send/xml-builder.ts(.test.ts)     ← nieuw (Taak 5)
supabase/functions/rhenus-send/genereer-proef-xml.ts        ← nieuw (Taak 5)
supabase/functions/rhenus-send/index.ts + deno.json         ← nieuw (Taak 8)
supabase/functions/rhenus-sftp-spike/index.ts               ← nieuw (Taak 8, wegwerp)
supabase/config.toml                                        ← +rhenus-send/-spike verify_jwt=false
docs/changelog.md, database-schema.md, architectuur.md,
CLAUDE.md                                                   ← bijwerken (Taak 10)
```

## Taken (Fase 1 — bouwen, alles dry-run-veilig)

1. ✅ Worktree `feat/rhenus-transporteur` (basis: `feat/verhoek-transporteur` + merge `origin/main`); legacy-XML-excerpt vastleggen.
2. ADR-0032 + amendement mig 374 (selectie-regels omhangen vóór de placeholder-delete).
3. Mig 378: `INSERT rhenus_sftp` (type `'sftp'`, `actief=FALSE`), regels `edi_partner_a`→`rhenus_sftp` omhangen, guarded delete `edi_partner_a` (+ herkansing `edi_partner_b`), `app_config 'rhenus'`.
4. `sftp-client.ts` → `_shared/` (imports in verhoek-send + spike mee).
5. `rhenus-send/types.ts` + `xml-builder.ts` TDD: structuur-, escaping-, gewicht-, 0-colli-tests; vergelijk tegen het legacy-excerpt.
6. Mig 379: enum + `rhenus_transportorders` + RPC's (enqueue/claim/markeer×2/reaper) + dispatch-tak + `rhenus_verzend_monitor`.
7. `vervoerder-eisen`: `rhenus_sftp`-tak (adresvelden verplicht, geen telefoon/land-eis) + tests + frontend-spiegel.
8. Orchestrator `rhenus-send/index.ts` (spiegel verhoek-send: reaper → claim-loop → preflight → build → dry-run/upload → audit → markeer) + `rhenus-sftp-spike`.
9. Mig 380: cron `rhenus-send-elke-minuut` (veilig: wachtrij leeg zolang `actief=FALSE`, en anders dry-run).
10. Docs + volledige verificatie (`deno test`, `npm run typecheck`).

## FASE 2 — Go-live-checklist (voor Miguel, na merge)

1. **Migraties applyen vanaf deze branch** (her-verifieer nummers!): 374 → 375 → 376 → 378 → 379 → 380 (377 staat al live).
2. **Secrets** (wachtwoord uit de Rhenus-mail van 12-06, NIET uit de repo):
   ```powershell
   supabase secrets set --project-ref wqzeevfobwauxkalagtn `
     RHENUS_SFTP_HOST=sedi.de.rhenus.com RHENUS_SFTP_PORT=22 `
     RHENUS_SFTP_USER=Karpi RHENUS_SFTP_PASSWORD=<mail> `
     RHENUS_SFTP_REMOTE_DIR=/in
   ```
3. **Deploys:** `supabase functions deploy rhenus-send --project-ref wqzeevfobwauxkalagtn --no-verify-jwt` (idem `rhenus-sftp-spike`; verhoek-send/spike als die nog niet stonden).
4. **Spike:** `POST /functions/v1/rhenus-sftp-spike` (Bearer CRON_TOKEN) → connect+list; daarna `?upload=1` → uploadt een spike-bestand. Overweeg eerst `RHENUS_SFTP_REMOTE_DIR=<testmap>` en vraag Rhenus de testmap-naam te bevestigen als die niet zichtbaar is in de listing.
5. **Interne dry-run-rondreis:** `SELECT enqueue_rhenus_transportorder(<zending_id>, <debiteur_nr>, TRUE);` → cron → rij `Verstuurd` (dry_run), XML in storage onder `rhenus-xml/` → visueel diffen tegen het legacy-excerpt.
6. **Echte rondreis:** `RHENUS_DRY_RUN=false` + 1 testzending → Rhenus laten bevestigen (let op: SSCC scant, gewicht/dims kloppen, Freetext leesbaar). Fouten → fix in `xml-builder.ts` mét unit-test per geval.
7. **Cutover (week 24-afspraak):** `UPDATE vervoerders SET actief=TRUE WHERE code='rhenus_sftp';` — de bestaande selectie-regels (DE ≤30 kg ≥131 cm + debiteur-pins) gaan dan direct routeren. Monitor via `rhenus_verzend_monitor`.
8. Opruimen: spike-functies verwijderen; changelog bijwerken met go-live-datum; V2-backlog: /out-map statusterugkoppeling + monitor-UI-paneel.

## Scope-afbakening (bewust NIET nu)

- Statusterugkoppeling uit de /out-map (V2, zoals Verhoek).
- Monitor-UI-paneel (SQL-view bestaat wél; UI volgt na de pilot, samen met Verhoek).
- Orchestrator-loop-generalisatie over de drie adapters (backlog).
- DPD-activatie (DE ≤130 cm-regel blijft op de inactieve `dpd`-printvervoerder wachten — los besluit).
